// Terrain queries, probes, safe-state history. CLAUDE.md §8, stage 3.
//
// This module imports NO three.js, for the same reason flight.js does not:
// the assertion suite has to be able to exercise the grid index and the
// probes headlessly. The THREE.Raycaster comparison lives next door in
// physics-benchmark.js, which is the only part that genuinely needs a scene.
//
// physics.js DETECTS AND KNOWS NOTHING ELSE. It produces a CollisionEvent and
// hands it to an installed policy; it never decides what a collision means.
// That split is §4's whole architecture and stage 7 depends on it existing
// now.
//
// The grid index below is simple. Its failure mode is not: a query that
// returns "no terrain" when terrain is present looks exactly like open ocean,
// and every downstream system quietly agrees. That is why the build logs its
// figures, sanity-checks known coordinates, and is benchmarked against
// THREE.Raycaster rather than merely asserted to be faster.

import { captureFlightState, applyFlightState } from "./flight.js";

export const PHYSICS_HZ = 60;
const FIXED_DT = 1 / PHYSICS_HZ;
// A render frame can stall (a tab switch, a texture upload). Cap the catch-up
// so one long frame cannot spend a second inside the physics loop.
const MAX_STEPS_PER_FRAME = 6;

// Probe offsets in aircraft-local metres. The F-15E normalises to 19.4 m long
// and 13.05 m across, so these are the actual extremities rather than a guess:
// a wing tip touching a ridge is a crash, and a centre-only probe misses it.
export const PROBE_OFFSETS = [
  { name: "centre", x: 0, y: 0, z: 0 },
  { name: "nose", x: 0, y: 0, z: -9.7 },
  { name: "tail", x: 0, y: 0, z: 9.7 },
  { name: "wingL", x: -6.5, y: 0, z: 0 },
  { name: "wingR", x: 6.5, y: 0, z: 0 },
];

// Clearance below which a snapshot is NOT worth recording, scaled by speed.
// 60 m at 110 m/s is comfortable; the same 60 m at 250 m/s is already an
// impact, so a flat threshold would fill the history with states that are not
// survivable to return to.
const SAFE_CLEARANCE_PER_SPEED = 0.55;
const SAFE_HISTORY_SECONDS = 2.0;
// Rewind depth. The NEWEST safe state is not safe enough -- it usually sits
// one query before the collision, so restoring it re-flies the same impact.
export const REWIND_SECONDS = 0.65;

// How far ahead the forward ray looks, in seconds of travel.
const LOOKAHEAD_SECONDS = 2.2;
// Contact margin: the probes are points, the airframe is not.
const CONTACT_MARGIN = 3.5;

// ── the uniform grid index ─────────────────────────────────────────────────

/**
 * A CSR-style uniform grid over triangle XZ bounding boxes.
 *
 * Flat typed arrays rather than an array of arrays: 182k triangles across
 * ~19k cells would otherwise be ~19k separate JS arrays, and the pointer
 * chasing costs more than the intersection maths it is meant to save.
 */
// 4.5, not §8's quoted 9.5 -- that figure is triangles per cell, and a
// triangle that straddles a cell boundary is stored in every cell it touches.
// Sizing directly for 9.5 measured about 20 entries per cell; halving the
// target lands the MEASURED occupancy near the figure §8 actually quotes.
export function buildTerrainIndex(triangles, targetPerCell = 4.5) {
  const t0 = now();
  const triCount = triangles.length / 9;
  if (triCount === 0) return null;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < triangles.length; i += 3) {
    const x = triangles[i];
    const z = triangles[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  // Choose the cell size from the triangle count and the area, so a replaced
  // terrain of a different size still lands near the target occupancy.
  const area = Math.max((maxX - minX) * (maxZ - minZ), 1);
  const cells = Math.max(1, Math.round(triCount / targetPerCell));
  const cellSize = Math.max(Math.sqrt(area / cells), 1);
  const nx = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));

  const cellOf = (v, min) => Math.floor((v - min) / cellSize);

  // Pass 1: how many cells does each triangle touch?
  const counts = new Int32Array(nx * nz + 1);
  const spanOf = (i) => {
    const ax = triangles[i * 9], az = triangles[i * 9 + 2];
    const bx = triangles[i * 9 + 3], bz = triangles[i * 9 + 5];
    const cx = triangles[i * 9 + 6], cz = triangles[i * 9 + 8];
    return {
      x0: clampI(cellOf(Math.min(ax, bx, cx), minX), 0, nx - 1),
      x1: clampI(cellOf(Math.max(ax, bx, cx), minX), 0, nx - 1),
      z0: clampI(cellOf(Math.min(az, bz, cz), minZ), 0, nz - 1),
      z1: clampI(cellOf(Math.max(az, bz, cz), minZ), 0, nz - 1),
    };
  };

  let entries = 0;
  for (let i = 0; i < triCount; i++) {
    const s = spanOf(i);
    const n = (s.x1 - s.x0 + 1) * (s.z1 - s.z0 + 1);
    entries += n;
    for (let cz = s.z0; cz <= s.z1; cz++)
      for (let cx = s.x0; cx <= s.x1; cx++) counts[cz * nx + cx + 1]++;
  }

  // Prefix sum into offsets, then fill.
  const offsets = counts;
  for (let i = 1; i < offsets.length; i++) offsets[i] += offsets[i - 1];
  const items = new Int32Array(entries);
  const cursor = Int32Array.from(offsets.subarray(0, offsets.length - 1));
  for (let i = 0; i < triCount; i++) {
    const s = spanOf(i);
    for (let cz = s.z0; cz <= s.z1; cz++)
      for (let cx = s.x0; cx <= s.x1; cx++) items[cursor[cz * nx + cx]++] = i;
  }

  const bytes = offsets.byteLength + items.byteLength + triangles.byteLength;
  const buildMs = now() - t0;

  return {
    triangles, offsets, items, nx, nz, cellSize, minX, minZ, maxX, maxZ,
    triCount, entries, buildMs, bytes,
    perCell: entries / (nx * nz),
  };
}

const clampI = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Highest surface at (x, z), or null where there is no terrain.
 *
 * Returns the MAXIMUM hit rather than the first: a coastal mesh folds back on
 * itself, and taking the first triangle found would put the aircraft
 * underneath an overhang with a cheerful clearance reading.
 */
export function heightAtIndex(index, x, z) {
  if (!index) return null;
  if (x < index.minX || x > index.maxX || z < index.minZ || z > index.maxZ) {
    return null;
  }
  const cx = clampI(Math.floor((x - index.minX) / index.cellSize), 0, index.nx - 1);
  const cz = clampI(Math.floor((z - index.minZ) / index.cellSize), 0, index.nz - 1);
  const cell = cz * index.nx + cx;
  const start = index.offsets[cell];
  const end = index.offsets[cell + 1];
  const T = index.triangles;

  let best = null;
  for (let k = start; k < end; k++) {
    const i = index.items[k] * 9;
    const ax = T[i], ay = T[i + 1], az = T[i + 2];
    const bx = T[i + 3], by = T[i + 4], bz = T[i + 5];
    const cx2 = T[i + 6], cy = T[i + 7], cz2 = T[i + 8];

    // Barycentric containment in the XZ plane.
    const d = (bz - cz2) * (ax - cx2) + (cx2 - bx) * (az - cz2);
    if (d === 0) continue;
    const w0 = ((bz - cz2) * (x - cx2) + (cx2 - bx) * (z - cz2)) / d;
    if (w0 < 0 || w0 > 1) continue;
    const w1 = ((cz2 - az) * (x - cx2) + (ax - cx2) * (z - cz2)) / d;
    if (w1 < 0 || w1 > 1) continue;
    const w2 = 1 - w0 - w1;
    if (w2 < 0 || w2 > 1) continue;

    const y = w0 * ay + w1 * by + w2 * cy;
    if (best === null || y > best) best = y;
  }
  return best;
}

// ── the physics system ─────────────────────────────────────────────────────

export function createPhysics(options = {}) {
  const index = options.index ?? null;
  const seaLevel = options.seaLevel ?? 0;

  let policy = null;
  let accumulator = 0;
  let cooldown = 0;

  const probes = PROBE_OFFSETS.map((p) => ({
    ...p, world: { x: 0, y: 0, z: 0 }, ground: seaLevel, clearance: Infinity,
    onLand: false,
  }));

  const telemetry = {
    clearance: Infinity,
    closest: "centre",
    surface: "ocean",
    agl: Infinity,
    groundBelow: seaLevel,
    forwardHazard: Infinity,
    forwardImminent: false,
    contact: false,
    ticks: 0,
  };

  const history = [];
  const HISTORY_MAX = Math.round(SAFE_HISTORY_SECONDS * PHYSICS_HZ);

  /** Ground height at a world point: terrain if there is any, else the sea. */
  function groundAt(x, z) {
    const h = heightAtIndex(index, x, z);
    return h === null ? seaLevel : Math.max(h, seaLevel);
  }

  /** Whether the surface under a point is land rather than water. */
  function isLandAt(x, z) {
    const h = heightAtIndex(index, x, z);
    return h !== null && h > seaLevel;
  }

  function updateProbes(state) {
    const q = state.quat;
    // Rotate each local offset into world space by hand -- this runs 5x per
    // physics tick at 60 Hz and allocating five THREE.Vector3s for it would be
    // 18,000 objects a second for nothing.
    let minClear = Infinity;
    let closest = probes[0];
    for (const p of probes) {
      const v = rotate(q, p.x, p.y, p.z);
      p.world.x = state.position.x + v.x;
      p.world.y = state.position.y + v.y;
      p.world.z = state.position.z + v.z;
      p.ground = groundAt(p.world.x, p.world.z);
      p.onLand = isLandAt(p.world.x, p.world.z);
      p.clearance = p.world.y - p.ground;
      if (p.clearance < minClear) {
        minClear = p.clearance;
        closest = p;
      }
    }
    telemetry.clearance = minClear;
    telemetry.closest = closest.name;
    telemetry.groundBelow = groundAt(state.position.x, state.position.z);
    telemetry.agl = state.position.y - telemetry.groundBelow;
    telemetry.surface = isLandAt(state.position.x, state.position.z)
      ? "land"
      : "ocean";
    return minClear;
  }

  /**
   * March a ray along the flight path and report the distance at which the
   * ground first rises into it. This is a PREDICTION, not a contact, and the
   * two policies treat it very differently (§8).
   */
  function lookAhead(state) {
    const f = forwardOf(state.quat);
    const range = state.speed * LOOKAHEAD_SECONDS;
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const d = (range * i) / steps;
      const x = state.position.x + f.x * d;
      const y = state.position.y + f.y * d - 0.5 * state.sink * (d / state.speed);
      const z = state.position.z + f.z * d;
      if (y - groundAt(x, z) <= CONTACT_MARGIN) return d;
    }
    return Infinity;
  }

  function step(state, dt) {
    telemetry.ticks++;
    const clearance = updateProbes(state);
    const hazard = lookAhead(state);
    telemetry.forwardHazard = hazard;

    const physicalContact = clearance <= CONTACT_MARGIN;
    const forwardImminent = hazard < state.speed * 0.75;
    telemetry.contact = physicalContact;
    telemetry.forwardImminent = forwardImminent;

    if (cooldown > 0) cooldown -= dt;

    // Record only while genuinely safe. A history full of near-misses is a
    // history that rewinds you into the hill you were about to hit.
    if (clearance > state.speed * SAFE_CLEARANCE_PER_SPEED && !physicalContact) {
      history.push(captureFlightState(state));
      if (history.length > HISTORY_MAX) history.shift();
    }

    if ((physicalContact || forwardImminent) && cooldown <= 0) {
      const event = {
        type: telemetry.surface === "land" ? "terrain" : "ocean",
        predicted: !physicalContact && forwardImminent,
        position: { ...state.position },
        speed: state.speed,
        clearance,
        hazard,
        probe: telemetry.closest,
        at: telemetry.ticks * FIXED_DT,
      };
      const handled = policy ? policy.handleCollision(event) : false;
      // Physics sets its own cooldown even when a policy DECLINES, or a
      // declined prediction is re-raised every single tick.
      cooldown = handled ? 0.6 : 0.35;
    }
  }

  return {
    telemetry,
    probes,
    index,
    groundAt,
    isLandAt,
    lookAhead,

    setPolicy(p) {
      policy = p;
    },
    getPolicy: () => policy,

    /**
     * Fixed-step accumulator, so physics runs at 60 Hz regardless of the
     * render rate. §8: this MUST also tick the installed policy -- any branch
     * elsewhere that skips physics has to tick the policy itself, and omitting
     * that freezes the game whenever physics is bypassed.
     */
    update(dt, state) {
      accumulator = Math.min(accumulator + dt, FIXED_DT * MAX_STEPS_PER_FRAME);
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        step(state, FIXED_DT);
        accumulator -= FIXED_DT;
        steps++;
      }
      if (policy) policy.tick(dt);
      return steps;
    },

    /** A snapshot ~REWIND_SECONDS old, or the oldest there is. */
    rewindTarget() {
      if (history.length === 0) return null;
      const back = Math.round(REWIND_SECONDS * PHYSICS_HZ);
      return history[Math.max(0, history.length - 1 - back)];
    },
    historyLength: () => history.length,
    clearHistory: () => {
      history.length = 0;
    },

    /**
     * §8/stage 3: `keepPolicy` exists because the policy performing a restore
     * must not cancel its own fade -- resetting physics from inside a policy
     * callback would otherwise wipe the state machine mid-transition.
     */
    reset(state, opts = {}) {
      history.length = 0;
      accumulator = 0;
      cooldown = 0;
      telemetry.contact = false;
      telemetry.forwardImminent = false;
      if (!opts.keepPolicy && policy && policy.reset) policy.reset();
      if (state) updateProbes(state);
    },

    setCooldown(v) {
      cooldown = v;
    },
    cooldown: () => cooldown,
  };
}

// Local helpers, duplicated from flight.js deliberately: physics runs these
// five times per tick and importing the object-returning versions would
// allocate. Kept adjacent to their use so the duplication is visible.
function rotate(q, x, y, z) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return {
    x: x + q.w * tx + (q.y * tz - q.z * ty),
    y: y + q.w * ty + (q.z * tx - q.x * tz),
    z: z + q.w * tz + (q.x * ty - q.y * tx),
  };
}
const forwardOf = (q) => rotate(q, 0, 0, -1);
