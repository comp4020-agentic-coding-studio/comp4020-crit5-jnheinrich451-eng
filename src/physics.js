import * as THREE from "three";
import {
  CollisionType,
  createCollisionEvent,
  createSafeStateHistory,
  createDevelopmentRecoveryResponse,
  requiredSafeClearance,
} from "./collision.js";

/**
 * Stage 02.2 — world contact. Stage 02.3 — response separation.
 *
 * The visual world stays visual. Nothing in here touches a material, a shader
 * or a visibility flag: contact is answered from geometry only, so Stage 05 can
 * re-texture Ireland without breaking collision.
 *
 * One primitive does all the work: terrainHeightAt(x, z) — a vertical ray
 * against the real terrain triangles, resolved through a static XZ grid index.
 * AGL, per-probe clearance and the forward look-ahead are all derived from it.
 */
export const PHYSICS = {
  // 60 Hz: 4.2 m of travel per step at 250 m/s instead of 8.3. The query costs
  // ~0.02 ms, so the finer step is bought with nothing.
  queryHz: 60,

  // Contact thresholds. Deliberately tight: an invisible margin that stops the
  // aircraft in clear air reads as a bug, not as physics.
  terrainContactClearance: 1.5,
  oceanContactMargin: 0.5,

  // Look-ahead is a time, not a distance, so 250 m/s gets more warning than
  // 110 m/s does. 0.20 s -> 50 m at max speed: two tenths of a second of
  // prediction, which is a warning horizon and not a force field.
  lookAheadTime: 0.2,
  minLookAhead: 20,
  lookAheadSamples: 12,

  // A forward hit is a WARNING. It only escalates to a response trigger once
  // the face is inside the distance the aircraft covers before the next couple
  // of queries — i.e. once penetration is otherwise unavoidable. This split is
  // what stopped the old 17 m look-ahead from firing recovery in clear air.
  imminentSteps: 2.5,
  minImminent: 12,

  contactCooldown: 0.6,

  // 256 x 256 over a 30 km island is a ~117 m cell: a handful of triangles per
  // cell on this asset, which is what makes the query cost vanish.
  indexCells: 256,
};

export const SURFACE = { NONE: "NONE", TERRAIN: "TERRAIN", OCEAN: "OCEAN" };
export const CONTACT = { CLEAR: "CLEAR", TERRAIN: "TERRAIN", OCEAN: "OCEAN", FORWARD: "FORWARD" };

/**
 * Aircraft-local probe points, in the normalized F-15 frame: bounding-box
 * centred, 19.4 m along Z (nose at -9.7), 13 m span, -Z forward. Kept inboard
 * of the true extremities — a probe on the very wingtip triggers on air the
 * moment the aircraft banks.
 */
export const PROBES = [
  { name: "center", local: new THREE.Vector3(0, -1.2, 0) },
  { name: "nose", local: new THREE.Vector3(0, -0.9, -8.6) },
  { name: "tail", local: new THREE.Vector3(0, -0.9, 8.6) },
  { name: "leftWing", local: new THREE.Vector3(-6.0, -0.6, 0.5) },
  { name: "rightWing", local: new THREE.Vector3(6.0, -0.6, 0.5) },
];

/* ---- pure helpers (no scene state, unit-testable) ---- */

/** Speed-scaled forward look-ahead, floored so a slow aircraft still looks. */
export function lookAheadDistance(speed) {
  return Math.max(PHYSICS.minLookAhead, (speed || 0) * PHYSICS.lookAheadTime);
}

/**
 * Which surface counts as "the ground" here. Terrain wins whenever it exists
 * above the waterline; otherwise the ocean plane is the floor. This is what
 * stops AGL reporting 700 m while the aircraft is 90 m over a mountain.
 */
export function groundReference(terrainHeight, oceanY = 0) {
  return terrainHeight !== null && terrainHeight !== undefined && terrainHeight > oceanY
    ? { height: terrainHeight, surface: SURFACE.TERRAIN }
    : { height: oceanY, surface: SURFACE.OCEAN };
}

/**
 * Contact classification. Ocean first: below the waterline the terrain height
 * under the aircraft is not the thing it just hit — and where there is no
 * terrain under the closest probe at all, water is the only surface that can
 * be touched, whatever the margin says.
 */
export function classifyContact({ minClearance, minProbeY, forwardHit, oceanY = 0, surface = SURFACE.TERRAIN }) {
  if (minProbeY <= oceanY + PHYSICS.oceanContactMargin) return CONTACT.OCEAN;
  if (Number.isFinite(minClearance) && minClearance <= PHYSICS.terrainContactClearance) {
    return surface === SURFACE.OCEAN ? CONTACT.OCEAN : CONTACT.TERRAIN;
  }
  if (forwardHit) return CONTACT.FORWARD;
  return CONTACT.CLEAR;
}

/** Distance at which a forward hazard stops being a warning and becomes contact. */
export function imminentForwardDistance(speed) {
  return Math.max(PHYSICS.minImminent, ((speed || 0) / PHYSICS.queryHz) * PHYSICS.imminentSteps);
}

/**
 * Safe states are recorded only when there is speed-appropriate air around the
 * aircraft: 40 m at 110 m/s, ~88 m at 250 m/s. A fixed 25 m was the other half
 * of the recovery loop — it recorded states that were already committed.
 */
export function isSafeToRecord(contactKind, minClearance, speed = 0) {
  return (
    contactKind === CONTACT.CLEAR &&
    Number.isFinite(minClearance) &&
    minClearance > requiredSafeClearance(speed)
  );
}

/* ---- terrain index ---- */

const _v = new THREE.Vector3();

/** Every mesh under a subtree, cached once. Geometry references only. */
export function collectMeshes(root) {
  const meshes = [];
  if (!root) return meshes;
  root.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) meshes.push(o);
  });
  return meshes;
}

function triangleCount(mesh) {
  const g = mesh.geometry;
  const n = g.index ? g.index.count : g.attributes.position.count;
  return Math.floor(n / 3);
}

/**
 * A static, world-space triangle soup plus a uniform XZ bucket grid, stored as
 * CSR arrays (offsets + items) rather than an array of arrays.
 *
 * Native Raycaster against this asset walks every triangle in the mesh whose
 * bounding box the ray touches — one mesh, ~180k triangles, so five probe rays
 * per query is milliseconds. Bucketing by footprint turns each query into a
 * handful of triangle tests. It is still exact geometry: the same triangles,
 * the same intersection, just without visiting the whole island first.
 */
export function buildTerrainIndex(meshes, cells = PHYSICS.indexCells) {
  const t0 = (typeof performance !== "undefined" ? performance : Date).now();
  let total = 0;
  for (const m of meshes) total += triangleCount(m);
  if (total === 0) return null;

  const tri = new Float32Array(total * 9);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let t = 0;

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const mw = mesh.matrixWorld;
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const o = t * 9;
      for (let k = 0; k < 3; k++) {
        _v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(mw);
        tri[o + k * 3] = _v.x;
        tri[o + k * 3 + 1] = _v.y;
        tri[o + k * 3 + 2] = _v.z;
        if (_v.x < minX) minX = _v.x;
        if (_v.x > maxX) maxX = _v.x;
        if (_v.z < minZ) minZ = _v.z;
        if (_v.z > maxZ) maxZ = _v.z;
        if (_v.y < minY) minY = _v.y;
        if (_v.y > maxY) maxY = _v.y;
      }
      t++;
    }
  }

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanZ = Math.max(maxZ - minZ, 1e-6);
  const cellX = spanX / cells;
  const cellZ = spanZ / cells;
  const cellOf = (v, min, size) => Math.min(cells - 1, Math.max(0, Math.floor((v - min) / size)));

  // Pass 1: how many buckets each triangle lands in.
  const counts = new Int32Array(cells * cells + 1);
  const range = (o) => {
    const ax = tri[o], az = tri[o + 2];
    const bx = tri[o + 3], bz = tri[o + 5];
    const cx = tri[o + 6], cz = tri[o + 8];
    return {
      j0: cellOf(Math.min(ax, bx, cx), minX, cellX),
      j1: cellOf(Math.max(ax, bx, cx), minX, cellX),
      i0: cellOf(Math.min(az, bz, cz), minZ, cellZ),
      i1: cellOf(Math.max(az, bz, cz), minZ, cellZ),
    };
  };
  for (let k = 0; k < total; k++) {
    const r = range(k * 9);
    for (let i = r.i0; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) counts[i * cells + j + 1]++;
  }
  for (let c = 0; c < cells * cells; c++) counts[c + 1] += counts[c];

  // Pass 2: fill, using a moving cursor per bucket.
  const items = new Int32Array(counts[cells * cells]);
  const cursor = counts.slice(0, cells * cells);
  for (let k = 0; k < total; k++) {
    const r = range(k * 9);
    for (let i = r.i0; i <= r.i1; i++) {
      for (let j = r.j0; j <= r.j1; j++) {
        items[cursor[i * cells + j]++] = k;
      }
    }
  }

  const buildMs = (typeof performance !== "undefined" ? performance : Date).now() - t0;
  return {
    tri,
    items,
    offsets: counts,
    cells,
    minX,
    minZ,
    maxX,
    maxZ,
    minY,
    maxY,
    cellX,
    cellZ,
    triangles: total,
    meshes: meshes.length,
    buildMs: +buildMs.toFixed(1),
    bytes: tri.byteLength + items.byteLength + counts.byteLength,
    averagePerCell: +(items.length / (cells * cells)).toFixed(2),
  };
}

const _sample = { y: null, tri: -1 };

/**
 * The one primitive, in its raw form: the highest terrain surface directly under
 * (x, z) plus the triangle that owns it. Barycentric interpolation of the
 * containing triangle, so the answer is the real surface and not a resampled
 * height field.
 *
 * The "highest" rule matters — the source tile has a solid skirt, so a lower
 * hit is the underside, not the ground.
 */
function sampleTerrain(index, x, z) {
  _sample.y = null;
  _sample.tri = -1;
  if (!index) return _sample;
  if (x < index.minX || x > index.maxX || z < index.minZ || z > index.maxZ) return _sample;
  const cells = index.cells;
  const j = Math.min(cells - 1, Math.max(0, Math.floor((x - index.minX) / index.cellX)));
  const i = Math.min(cells - 1, Math.max(0, Math.floor((z - index.minZ) / index.cellZ)));
  const c = i * cells + j;
  const start = index.offsets[c];
  const end = index.offsets[c + 1];
  const tri = index.tri;

  for (let n = start; n < end; n++) {
    const t = index.items[n];
    const o = t * 9;
    const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
    const bx = tri[o + 3], by = tri[o + 4], bz = tri[o + 5];
    const cx = tri[o + 6], cy = tri[o + 7], cz = tri[o + 8];

    // Edge functions in the XZ plane; consistent signs mean the point is inside.
    const w0 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    const w1 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
    const w2 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
    if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;
    const area = w0 + w1 + w2;
    if (area === 0) continue;
    // w1 is opposite a, w2 opposite b, w0 opposite c.
    const y = (w1 * ay + w2 * by + w0 * cy) / area;
    if (_sample.y === null || y > _sample.y) {
      _sample.y = y;
      _sample.tri = t;
    }
  }
  return _sample;
}

/** Vertical raycast: terrain height under (x, z), or null outside the island. */
export function terrainHeightAt(index, x, z) {
  return sampleTerrain(index, x, z).y;
}

/**
 * World-space surface normal under (x, z), or null where there is no terrain.
 *
 * Computed from the triangle's own vertices, which are already in world space
 * in the index — so this is not a local face normal that someone forgot to
 * transform. Always oriented upward; the caller blends it toward world up
 * because a 60° Ireland face can otherwise point almost horizontally.
 */
export function terrainNormalAt(index, x, z, out = { x: 0, y: 1, z: 0 }) {
  const s = sampleTerrain(index, x, z);
  if (s.tri < 0) return null;
  const tri = index.tri;
  const o = s.tri * 9;
  const ux = tri[o + 3] - tri[o], uy = tri[o + 4] - tri[o + 1], uz = tri[o + 5] - tri[o + 2];
  const vx = tri[o + 6] - tri[o], vy = tri[o + 7] - tri[o + 1], vz = tri[o + 8] - tri[o + 2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (!l) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
    return out;
  }
  nx /= l;
  ny /= l;
  nz /= l;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  out.x = nx;
  out.y = ny;
  out.z = nz;
  return out;
}

/**
 * Forward query, marched rather than swept: sample the terrain height under a
 * series of points along the nose axis and report the first one the aircraft
 * would be inside. Cheaper than a true triangle sweep and, at these sample
 * counts, indistinguishable for the thing it exists to catch — a wall.
 */
export function forwardTerrainHit(index, origin, dir, distance, samples = PHYSICS.lookAheadSamples) {
  if (!index) return null;
  for (let s = 1; s <= samples; s++) {
    const d = (distance * s) / samples;
    const x = origin.x + dir.x * d;
    const y = origin.y + dir.y * d;
    const z = origin.z + dir.z * d;
    const h = terrainHeightAt(index, x, z);
    if (h !== null && y <= h + PHYSICS.terrainContactClearance) {
      return { distance: d, terrainHeight: h, point: new THREE.Vector3(x, y, z) };
    }
  }
  return null;
}

/* ---- world physics ---- */

const _probeWorld = PROBES.map(() => new THREE.Vector3());
const _forward = new THREE.Vector3();
const _noseOrigin = new THREE.Vector3();
const now = () => (typeof performance !== "undefined" ? performance : Date).now();

/**
 * The contact service. Owns the terrain index, the probe transforms, the
 * contact state, the safe state and the recovery — everything that answers
 * "what is under me and am I touching it".
 *
 * Game logic later consumes `physics.state`; it must not re-query the terrain.
 */
export function createWorldPhysics({ oceanY = 0, response = null } = {}) {
  let index = null;
  let terrainMeshes = [];
  let armed = false;
  let accumulator = 0;
  let clock = 0;
  let queryCount = 0;
  let querySum = 0;

  // Detection owns the history (it is the thing that knows what "safe" means);
  // the response only reads it. Swapping the response leaves it intact.
  const history = createSafeStateHistory();
  let policy = response;

  const state = {
    ready: false,
    hasTerrainIndex: false,
    time: 0,
    alt: 0,
    agl: Infinity,
    minClearance: Infinity,
    minProbeName: null,
    minProbeIndex: -1,
    minProbeY: Infinity,
    terrainHeight: null,
    groundHeight: oceanY,
    surface: SURFACE.NONE,
    contact: false,
    contactKind: CONTACT.CLEAR,

    // The Stage 02.3 split: a body inside the surface, versus terrain close
    // along the flight vector. Only the first is unconditionally a collision.
    physicalContact: false,
    forwardHazard: false,
    forwardDistance: null,
    forwardImminent: false,
    imminentDistance: PHYSICS.minImminent,

    forwardHit: null,
    lookAhead: PHYSICS.minLookAhead,
    physicsHz: PHYSICS.queryHz,
    safeClearance: 0,
    safeStates: 0,
    safeSpan: 0,
    hasSafeState: false,
    cooldown: 0,
    recovering: false,
    recoveries: 0,
    lastEvent: null,
    probes: PROBES.map((p) => ({ name: p.name, world: new THREE.Vector3(), clearance: Infinity, terrainHeight: null, hitPoint: new THREE.Vector3(), hasHit: false })),
    queryMs: 0,
    avgQueryMs: 0,
    worstQueryMs: 0,
    queries: 0,
  };

  /** Default policy, so physics is usable (and testable) with no wiring. */
  function ensurePolicy(flightState) {
    if (!policy) policy = createDevelopmentRecoveryResponse({ history, flightState });
    return policy;
  }

  function setResponse(next) {
    policy = next;
    return policy;
  }

  function setTerrain(root) {
    terrainMeshes = collectMeshes(root);
    index = buildTerrainIndex(terrainMeshes);
    state.hasTerrainIndex = !!index;
    state.ready = true;
    // Armed even with no terrain index: ocean contact needs no geometry, and
    // an ocean-only world is a legitimate state (asset failure, open sea).
    armed = true;
    return index;
  }

  /** Terrain height under a world position, ocean-backed. Public API (§5). */
  function sampleTerrainBelow(worldPosition) {
    const h = terrainHeightAt(index, worldPosition.x, worldPosition.z);
    return {
      foundTerrain: h !== null,
      terrainHeight: h,
      distance: h === null ? Infinity : worldPosition.y - h,
      point: h === null ? null : new THREE.Vector3(worldPosition.x, h, worldPosition.z),
    };
  }

  /**
   * @param keepPolicy Stage 04.0: a checkpoint restore has to clear the safe-state
   *   history (nothing before the restore is a state to rewind to) WITHOUT
   *   resetting the response policy — the policy is the thing performing the
   *   restore, and resetting it mid-sequence would cancel its own fade and re-arm
   *   failures on the same frame.
   */
  function reset(flightState, { keepPolicy = false } = {}) {
    accumulator = 0;
    clock = 0;
    history.clear();
    if (!keepPolicy && policy && policy.reset) policy.reset();
    if (flightState) history.sample(0, flightState, Infinity);
    state.time = 0;
    state.safeStates = history.length;
    state.hasSafeState = history.length > 0;
    state.cooldown = 0;
    state.recovering = false;
    state.contact = false;
    state.physicalContact = false;
    state.forwardHazard = false;
    state.forwardImminent = false;
    state.forwardDistance = null;
    state.contactKind = CONTACT.CLEAR;
    state.forwardHit = null;
    state.lastEvent = null;
  }

  function runQuery(aircraftRoot, flightState) {
    const t0 = now();
    aircraftRoot.updateMatrixWorld(true);

    let minClearance = Infinity;
    let minProbeName = null;
    let minProbeIndex = -1;
    let minProbeY = Infinity;

    for (let i = 0; i < PROBES.length; i++) {
      const world = _probeWorld[i].copy(PROBES[i].local).applyMatrix4(aircraftRoot.matrixWorld);
      const p = state.probes[i];
      p.world.copy(world);
      const h = terrainHeightAt(index, world.x, world.z);
      const ref = groundReference(h, oceanY);
      p.terrainHeight = h;
      p.hasHit = h !== null;
      p.hitPoint.set(world.x, ref.height, world.z);
      p.clearance = world.y - ref.height;
      if (p.clearance < minClearance) {
        minClearance = p.clearance;
        minProbeName = p.name;
        minProbeIndex = i;
      }
      if (world.y < minProbeY) minProbeY = world.y;
    }

    // Centre probe defines AGL; the ground reference under it defines SURFACE.
    const centre = state.probes[0];
    const ref = groundReference(centre.terrainHeight, oceanY);
    state.terrainHeight = centre.terrainHeight;
    state.groundHeight = ref.height;
    state.surface = ref.surface;
    state.agl = aircraftRoot.position.y - ref.height;
    state.alt = aircraftRoot.position.y;
    state.minClearance = minClearance;
    state.minProbeName = minProbeName;
    state.minProbeIndex = minProbeIndex;
    state.minProbeY = minProbeY;

    // Forward look-ahead from the nose, along the aircraft's real forward axis
    // — valid banked, inverted or vertical, because it comes off the quaternion.
    _forward.set(0, 0, -1).applyQuaternion(aircraftRoot.quaternion).normalize();
    _noseOrigin.copy(state.probes[1].world);
    state.lookAhead = lookAheadDistance(flightState.speed);
    state.forwardHit = forwardTerrainHit(index, _noseOrigin, _forward, state.lookAhead);

    // The closest probe decides what was touched: over open sea its clearance
    // is measured against the waterline, so calling that terrain contact would
    // type an ocean dive as TERRAIN in the last metre.
    const closest = state.probes[minProbeIndex >= 0 ? minProbeIndex : 0];
    state.contactKind = classifyContact({
      minClearance,
      minProbeY,
      forwardHit: state.forwardHit,
      oceanY,
      surface: groundReference(closest.terrainHeight, oceanY).surface,
    });
    state.contact = state.contactKind !== CONTACT.CLEAR;

    // Warning versus contact. FORWARD is the warning band; it only escalates
    // inside imminentDistance, where the next step or two would penetrate.
    state.physicalContact = state.contactKind === CONTACT.TERRAIN || state.contactKind === CONTACT.OCEAN;
    state.forwardHazard = !!state.forwardHit;
    state.forwardDistance = state.forwardHit ? state.forwardHit.distance : null;
    state.imminentDistance = imminentForwardDistance(flightState.speed);
    state.forwardImminent = state.forwardHazard && state.forwardHit.distance <= state.imminentDistance;

    const ms = now() - t0;
    state.queryMs = ms;
    state.queries++;
    querySum += ms;
    queryCount++;
    state.avgQueryMs = querySum / queryCount;
    if (ms > state.worstQueryMs) state.worstQueryMs = ms;
  }

  const _eventNormal = { x: 0, y: 1, z: 0 };
  const _eventPos = new THREE.Vector3();

  /**
   * Turn the current contact state into a CollisionEvent. Everything past this
   * point is policy, and policy is somebody else's file.
   */
  function buildEvent(flightState) {
    const ocean = state.contactKind === CONTACT.OCEAN;
    const forwardOnly = !state.physicalContact && state.forwardImminent;
    const hit = state.forwardHit;

    if (forwardOnly && hit) {
      _eventPos.copy(hit.point);
    } else {
      const p = state.probes[state.minProbeIndex >= 0 ? state.minProbeIndex : 0];
      _eventPos.copy(p.world);
    }

    if (ocean) {
      _eventNormal.x = 0;
      _eventNormal.y = 1;
      _eventNormal.z = 0;
    } else if (!terrainNormalAt(index, _eventPos.x, _eventPos.z, _eventNormal)) {
      // No triangle under the contact point (edge of the island): world up is
      // the only honest answer.
      _eventNormal.x = 0;
      _eventNormal.y = 1;
      _eventNormal.z = 0;
    }

    return createCollisionEvent({
      type: ocean ? CollisionType.OCEAN : CollisionType.TERRAIN,
      position: _eventPos,
      normal: _eventNormal,
      speed: flightState.speed,
      timestamp: clock,
      forwardHit: forwardOnly,
      distance: forwardOnly && hit ? hit.distance : Math.max(0, state.minClearance),
      probe: forwardOnly ? "forward" : state.minProbeName,
    });
  }

  /**
   * @param dt seconds
   * @param onRecover optional post-recovery hook, so a caller can re-sync the
   *   scene graph without physics reaching into it. The response policy is the
   *   preferred seam; this stays for Stage 02.2 call sites.
   * @returns the recovery info object if a collision was handled, else false
   */
  function update(aircraftRoot, flightState, dt, onRecover, frame) {
    clock += dt;
    state.time = clock;
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
    state.recovering = state.cooldown > 0;
    // The frame stamp is passed straight through: the policy is ticked by this
    // function AND, when physics is skipped, by the caller. Only one may land.
    if (policy && policy.tick) policy.tick(dt, frame);
    if (!armed) return false;

    accumulator += dt;
    const step = 1 / PHYSICS.queryHz;
    if (accumulator < step) return false;
    // Never run the backlog: a tab returning from the background would fire a
    // dozen identical queries.
    accumulator = accumulator % step;

    runQuery(aircraftRoot, flightState);

    // Observation continues through the cooldown (§17) — only the response is
    // suppressed. Sampling is gated on being genuinely clear, so a state from
    // inside the danger region can never become a recovery target.
    state.safeClearance = requiredSafeClearance(flightState.speed);
    const recordable =
      !state.physicalContact &&
      !state.forwardImminent &&
      isSafeToRecord(CONTACT.CLEAR, state.minClearance, flightState.speed);
    if (recordable) history.sample(clock, flightState, state.minClearance);
    state.safeStates = history.length;
    state.safeSpan = history.span;
    state.hasSafeState = history.length > 0;

    const trigger = state.physicalContact || state.forwardImminent;
    if (trigger && state.cooldown <= 0) {
      const event = buildEvent(flightState);
      state.lastEvent = event;
      state.cooldown = PHYSICS.contactCooldown;
      state.recovering = true;
      state.recoveries++;
      const info = ensurePolicy(flightState).handleCollision(event);
      state.safeStates = history.length;
      state.safeSpan = history.span;
      if (onRecover) onRecover(state, event, info);
      return info || true;
    }
    return false;
  }

  return {
    state,
    PROBES,
    setTerrain,
    setResponse,
    sampleTerrainBelow,
    update,
    reset,
    history,
    get response() {
      return policy;
    },
    get index() {
      return index;
    },
    get terrainMeshes() {
      return terrainMeshes;
    },
    get lastSafeState() {
      return history.newest;
    },
  };
}

/**
 * Development benchmark: the grid index against a stock THREE.Raycaster over
 * the same meshes, on the same points. Answers §18 with numbers rather than an
 * assumption, and is the evidence for not adding a BVH dependency.
 */
export function benchmarkTerrainQuery(index, meshes, samples = 200) {
  if (!index || !meshes.length) return null;
  const pts = [];
  for (let i = 0; i < samples; i++) {
    pts.push([
      index.minX + Math.random() * (index.maxX - index.minX),
      index.minZ + Math.random() * (index.maxZ - index.minZ),
    ]);
  }

  let t0 = now();
  let hits = 0;
  for (const [x, z] of pts) if (terrainHeightAt(index, x, z) !== null) hits++;
  const gridMs = (now() - t0) / samples;

  const ray = new THREE.Raycaster();
  ray.far = Math.max(1, (index.maxY - index.minY) * 4 + 1000);
  const dir = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const rayN = Math.min(samples, 24); // enough to time; a full 200 would stall the load
  t0 = now();
  for (let i = 0; i < rayN; i++) {
    origin.set(pts[i][0], index.maxY + 10, pts[i][1]);
    ray.set(origin, dir);
    ray.intersectObjects(meshes, false);
  }
  const raycastMs = (now() - t0) / rayN;

  return {
    triangles: index.triangles,
    meshes: index.meshes,
    indexBuildMs: index.buildMs,
    indexMB: +(index.bytes / 1048576).toFixed(2),
    trianglesPerCell: index.averagePerCell,
    gridMsPerQuery: +gridMs.toFixed(4),
    raycasterMsPerQuery: +raycastMs.toFixed(4),
    speedup: +(raycastMs / Math.max(gridMs, 1e-6)).toFixed(0),
    hitRate: +(hits / samples).toFixed(2),
    perProbeSetGridMs: +(gridMs * (PROBES.length + PHYSICS.lookAheadSamples)).toFixed(3),
    perProbeSetRaycasterMs: +(raycastMs * (PROBES.length + PHYSICS.lookAheadSamples)).toFixed(3),
  };
}
