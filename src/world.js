import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Stage 02 — World Lab.
 *
 * Every world transform lives in WORLD. Nothing else in the project is allowed
 * to hold a placement constant for the ocean, the carrier or the terrain: the
 * point of this stage is that composition is tunable from one object.
 *
 * Game space (unchanged from Stage 01): 1 unit = 1 m, +Y up, -Z forward.
 */
export const WORLD = {
  oceanY: 0,
  oceanSize: 100000, // 100 km x 100 km, comfortably past the playable world
  oceanTile: 90, // metres per texture tile

  // Fog and sky share this colour so the horizon has no seam.
  haze: 0x9cbad2,
  fogDensity: 0.000035,
  skyRadius: 46000,

  camera: { near: 0.5, far: 120000 },

  carrier: {
    url: "assets/carrier/scene.gltf",

    // The asset is a named vessel: USS Dwight D. Eisenhower (CVN-69),
    // Nimitz-class, 332.8 m overall. Preferred over the generic 300 m
    // calibration figure because the real number is known.
    targetLength: 332.8,

    position: new THREE.Vector3(0, 0, -1600), // 1.6 km ahead of the spawn
    rotationY: 0, // meaningful world heading, applied to CarrierRoot

    // Source-orientation correction, applied to CarrierModelCorrection on top
    // of the measured length-axis alignment. Use Math.PI to flip bow/stern.
    modelYaw: 0,

    // Nimitz-class draft is 11.9 m. The hull bottom is put that far below the
    // waterline; heightOffset trims it if the model has no underwater hull.
    draft: 11.9,
    heightOffset: 0,

    // Stage 02.2 reference anchors, as fractions of the measured length so
    // retuning targetLength moves them with the ship. Bow is -Z.
    references: {
      deckOffsetZ: 0.0, // deck centre, along the ship
      launchStartZ: 0.16, // aft end of the future catapult run
      launchEndZ: -0.44, // release point, short of the bow
      launchLateralX: 0.0, // centreline; move to port when the cats are chosen
      approachDistance: 1500, // metres astern of the stern
      approachAltitude: 140,
    },
  },

  terrain: {
    url: "assets/ireland/scene.gltf",

    // Deliberately game-compressed: real Ireland is ~480 km. 30 km puts the
    // whole island inside a few minutes of flight at 170-250 m/s.
    targetHorizontalSize: 30000,
    horizontalScaleMultiplier: 1,

    // The source tile carries only ~380 m of relief across its whole extent,
    // so at 1x it reads as a plain. 2x is the Stage 02 starting point; try
    // 1.0 / 1.5 / 2.0 / 2.5 and pick visually.
    verticalScaleMultiplier: 2,

    rotationY: 0,

    // This asset has no coastline of its own — it is an inland patch sitting on
    // a ~900 m pedestal, with no painted sea. So the waterline is *chosen*: the
    // terrain is sunk until the ocean plane cuts it at this percentile of its
    // area-weighted low ground, which floods the lowest valleys and leaves a
    // ragged coast. 0 = whole tile above water, 1 = whole tile submerged.
    seaLevelPercentile: 0.35,
    heightOffset: 0, // metres of waterline trim on top of the percentile

    // Placement derives from the measured land, not from a guessed number: the
    // nearest above-water ground is put this far beyond the carrier, so
    // retuning scale or waterline keeps the offshore approach the same length.
    autoPlaceFromCoast: true,
    coastOffsetFromCarrier: 6000,
    position: new THREE.Vector3(0, 0, -22000), // used when autoPlace is off
  },
};

/* ---- pure helpers (no THREE, unit-testable) ---- */

/** Which horizontal axis of a measured size is the object's length. */
export function longestHorizontalAxis(size) {
  return size.x > size.z ? "x" : "z";
}

/** Yaw that rotates that axis onto Z, the game's forward/course axis. */
export function alignYaw(axis) {
  return axis === "x" ? Math.PI / 2 : 0;
}

export function scaleToTarget(measured, target) {
  return measured > 0 ? target / measured : 1;
}

export function distanceKm(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 1000;
}

/** Percentile of a numeric list, sorted ascending. */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/**
 * The most populated bin of a height histogram, returned as the bin's centre.
 * On a carrier the flight deck is by far the largest flat surface, so the modal
 * vertex height is the deck — whereas the bounding-box top is the mast, ~47 m
 * higher. Anything that wants to put an aircraft on the deck needs this one.
 */
export function modalHeight(heights, binSize = 2) {
  if (!heights.length) return null;
  const bins = new Map();
  let bestKey = null;
  let bestCount = 0;
  for (const y of heights) {
    const k = Math.round(y / binSize);
    const n = (bins.get(k) || 0) + 1;
    bins.set(k, n);
    if (n > bestCount) {
      bestCount = n;
      bestKey = k;
    }
  }
  return bestKey * binSize;
}

/* ---- measurement ---- */

const _box = new THREE.Box3();

export function measure(object) {
  object.updateMatrixWorld(true);
  _box.setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  _box.getSize(size);
  _box.getCenter(center);
  return { size, center, min: _box.min.clone(), max: _box.max.clone() };
}

const v3 = (v) => ({ x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) });

/* ---- hierarchy ---- */

/**
 * Scene
 *  |- WorldRoot
 *      |- Ocean
 *      |- CarrierRoot -> CarrierModelCorrection -> CarrierGLTF
 *      |- TerrainRoot -> TerrainModelCorrection -> IrelandGLTF
 *
 * *Root nodes carry world placement. *ModelCorrection nodes carry everything
 * that is the source asset's fault: its axes, its units, its pivot.
 */
export function createWorldHierarchy() {
  const worldRoot = new THREE.Object3D();
  worldRoot.name = "WorldRoot";

  const ocean = buildOcean();

  const carrierRoot = new THREE.Object3D();
  carrierRoot.name = "CarrierRoot";
  const carrierCorrection = new THREE.Object3D();
  carrierCorrection.name = "CarrierModelCorrection";
  carrierRoot.add(carrierCorrection);

  const terrainRoot = new THREE.Object3D();
  terrainRoot.name = "TerrainRoot";
  const terrainCorrection = new THREE.Object3D();
  terrainCorrection.name = "TerrainModelCorrection";
  terrainRoot.add(terrainCorrection);

  carrierRoot.position.copy(WORLD.carrier.position);
  carrierRoot.rotation.y = WORLD.carrier.rotationY;
  terrainRoot.rotation.y = WORLD.terrain.rotationY;

  worldRoot.add(ocean, carrierRoot, terrainRoot);
  return { worldRoot, ocean, carrierRoot, carrierCorrection, terrainRoot, terrainCorrection };
}

/**
 * Stage 02 ocean: one large plane. Intentionally not a water shader — but it
 * does carry a faint tiling streak texture, because a flat colour gives no
 * parallax at all and this stage is partly a judgement about speed and scale.
 */
function buildOcean() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#3d5265";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(205,228,245,${0.05 + Math.random() * 0.14})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 9, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const repeat = WORLD.oceanSize / WORLD.oceanTile;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.oceanSize, WORLD.oceanSize),
    new THREE.MeshStandardMaterial({ map: tex, color: 0xc4d6e4, roughness: 0.78, metalness: 0.02 })
  );
  ocean.name = "Ocean";
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = WORLD.oceanY;
  return ocean;
}

/* ---- loading ---- */

function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, undefined, (err) =>
      reject(new Error(`${url} failed to load (${err && err.message ? err.message : "unknown error"})`))
    );
  });
}

/**
 * Stage 02.2 carrier anchors.
 *
 * CarrierRoot
 *  |- CarrierModelCorrection -> CarrierGLTF
 *  |- References
 *      |- DeckReference | LaunchStart | LaunchEnd | ApproachReference
 *
 * Positioned from the MEASURED deck height and hull length, in CarrierRoot's
 * local space, so nothing downstream ever holds a raw Sketchfab coordinate or
 * a world magic number: move or re-yaw the ship and the anchors follow.
 */
export function createCarrierReferences(carrierRoot, { length, deckY }) {
  const cfg = WORLD.carrier.references;
  const container = new THREE.Object3D();
  container.name = "References";

  // deckY is measured in world space; CarrierRoot may be offset vertically.
  const localDeckY = deckY - carrierRoot.position.y;

  const anchor = (name, x, y, z) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    container.add(o);
    return o;
  };

  const deck = anchor("DeckReference", 0, localDeckY, cfg.deckOffsetZ * length);
  const launchStart = anchor("LaunchStart", cfg.launchLateralX * length, localDeckY, cfg.launchStartZ * length);
  const launchEnd = anchor("LaunchEnd", cfg.launchLateralX * length, localDeckY, cfg.launchEndZ * length);
  // Astern and above: a future approach gate, not a landing system.
  const approach = anchor("ApproachReference", 0, localDeckY + cfg.approachAltitude, length / 2 + cfg.approachDistance);

  carrierRoot.add(container);
  carrierRoot.updateMatrixWorld(true);

  const worldOf = (o) => o.getWorldPosition(new THREE.Vector3());
  const launchRun = worldOf(launchEnd).distanceTo(worldOf(launchStart));

  return {
    container,
    deck,
    launchStart,
    launchEnd,
    approach,
    report: {
      deckY: +deckY.toFixed(1),
      local: {
        DeckReference: v3(deck.position),
        LaunchStart: v3(launchStart.position),
        LaunchEnd: v3(launchEnd.position),
        ApproachReference: v3(approach.position),
      },
      launchRunMetres: +launchRun.toFixed(1),
    },
  };
}

/**
 * Carrier normalization. Measured, not assumed: the source is a Sketchfab
 * export with a Z-up wrapper matrix, so which local axis is ship length is a
 * runtime question. Length is taken as the longest horizontal dimension and
 * rotated onto Z, the future course axis.
 */
export async function loadCarrier(root, correction) {
  const gltf = await loadGLTF(WORLD.carrier.url);
  const visual = gltf.scene;
  visual.name = "CarrierGLTF";
  visual.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });

  correction.add(visual);
  const source = measure(visual);

  const axis = longestHorizontalAxis(source.size);
  const lengthSource = axis === "x" ? source.size.x : source.size.z;
  const scale = scaleToTarget(lengthSource, WORLD.carrier.targetLength);

  correction.rotation.y = alignYaw(axis) + WORLD.carrier.modelYaw;
  correction.scale.setScalar(scale);
  correction.position.set(0, 0, 0);

  // Recentre horizontally on CarrierRoot, then drop the hull to its draft.
  let box = measure(root);
  correction.position.x -= box.center.x - root.position.x;
  correction.position.z -= box.center.z - root.position.z;
  box = measure(root);
  correction.position.y += WORLD.oceanY - WORLD.carrier.draft + WORLD.carrier.heightOffset - box.min.y;

  const final = measure(root);

  // Deck height is measured from the geometry, not inferred from the bounds:
  // the bounding-box top is the mast. A raw vertex mode is no good either —
  // hull plating outvotes the deck. So the ship's footprint is gridded and the
  // TOP surface of each cell taken; the flight deck is then the most common of
  // those, because it is the largest single upward-facing area on the vessel.
  root.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  const cells = 48;
  const spanX = Math.max(final.size.x, 1e-6);
  const spanZ = Math.max(final.size.z, 1e-6);
  const tops = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (p.y <= WORLD.oceanY) continue;
      const gj = Math.floor(((p.x - final.min.x) / spanX) * cells);
      const gi = Math.floor(((p.z - final.min.z) / spanZ) * cells);
      const k = gi * cells + gj;
      const prev = tops.get(k);
      if (prev === undefined || p.y > prev) tops.set(k, p.y);
    }
  });
  const deckY = modalHeight([...tops.values()], 1);

  const length = +Math.max(final.size.x, final.size.z).toFixed(1);
  const references = createCarrierReferences(root, {
    length,
    deckY: deckY === null ? WORLD.oceanY + 18 : deckY,
  });

  const report = {
    ok: true,
    url: WORLD.carrier.url,
    sourceSize: v3(source.size),
    lengthAxis: axis,
    scale: +scale.toFixed(5),
    normalizedSize: v3(final.size),
    length,
    beam: +Math.min(final.size.x, final.size.z).toFixed(1),
    draft: +(-final.min.y).toFixed(1),
    // Highest point on the ship: mast/island, not a surface anything lands on.
    mastAboveWater: +final.max.y.toFixed(1),
    // Flight deck: the surface a later catapult/landing stage should spawn on.
    deckY: deckY === null ? null : +deckY.toFixed(1),
    position: v3(root.position),
    rotationYDeg: +((WORLD.carrier.rotationY * 180) / Math.PI).toFixed(1),
    center: final.center.clone(),
    references: references.report,
    anchors: references,
  };
  console.log("[carrier]", report);
  return report;
}

/**
 * Area-weighted height field of a terrain subtree, in the space of `object`'s
 * parent. A grid of per-cell min/max is used rather than raw vertices because
 * the mesh is adaptive: flat ground has almost no vertices, so a vertex
 * percentile would report the mountains as typical terrain.
 */
export function sampleHeightField(object, cells = 64) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const spanX = Math.max(box.max.x - box.min.x, 1e-6);
  const spanZ = Math.max(box.max.z - box.min.z, 1e-6);
  const grid = new Array(cells * cells).fill(null);
  const p = new THREE.Vector3();

  object.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const gj = Math.min(cells - 1, Math.max(0, Math.floor(((p.x - box.min.x) / spanX) * cells)));
      const gi = Math.min(cells - 1, Math.max(0, Math.floor(((p.z - box.min.z) / spanZ) * cells)));
      const k = gi * cells + gj;
      const c = grid[k];
      if (!c) grid[k] = { min: p.y, max: p.y, z: p.z, x: p.x };
      else {
        if (p.y < c.min) c.min = p.y;
        if (p.y > c.max) {
          c.max = p.y;
          c.z = p.z;
          c.x = p.x;
        }
      }
    }
  });

  const filled = grid.filter(Boolean);
  return { cells: filled, box, lows: filled.map((c) => c.min) };
}

/**
 * Terrain normalization. Horizontal and vertical scale are separate: the source
 * Ireland tile already exaggerates elevation, and Stage 02 wants that
 * exaggeration on a dial rather than baked in.
 */
export async function loadTerrain(root, correction) {
  const gltf = await loadGLTF(WORLD.terrain.url);
  const visual = gltf.scene;
  visual.name = "IrelandGLTF";
  visual.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });

  correction.add(visual);
  const source = measure(visual);

  const horizontalSource = Math.max(source.size.x, source.size.z);
  const base = scaleToTarget(horizontalSource, WORLD.terrain.targetHorizontalSize);
  const h = base * WORLD.terrain.horizontalScaleMultiplier;
  const v = base * WORLD.terrain.verticalScaleMultiplier;

  correction.scale.set(h, v, h);
  correction.position.set(0, 0, 0);
  root.position.set(0, 0, 0);
  correction.updateMatrixWorld(true);

  // Waterline first: everything downstream (coast position, reported extents)
  // depends on where the ocean cuts this tile.
  const field = sampleHeightField(correction);
  const seaLevel = percentile(field.lows, WORLD.terrain.seaLevelPercentile);
  const waterlineY = WORLD.oceanY + WORLD.terrain.heightOffset;

  correction.position.x -= field.box.min.x + (field.box.max.x - field.box.min.x) / 2;
  correction.position.y += waterlineY - seaLevel;
  correction.updateMatrixWorld(true);

  // Nearest above-water ground on the +Z side becomes the coast the player
  // approaches; the tile's geometric edge is irrelevant once it is flooded.
  const shift = correction.position.y;
  const land = field.cells.filter((c) => c.max + shift > waterlineY);
  const landFrontZ = land.length ? Math.max(...land.map((c) => c.z)) : field.box.max.z;

  if (WORLD.terrain.autoPlaceFromCoast) {
    root.position.set(
      WORLD.terrain.position.x,
      0,
      WORLD.carrier.position.z - WORLD.terrain.coastOffsetFromCarrier - landFrontZ
    );
  } else {
    root.position.copy(WORLD.terrain.position);
  }

  const final = measure(root);
  const peak = Math.max(...land.map((c) => c.max + shift), waterlineY);
  const report = {
    ok: true,
    url: WORLD.terrain.url,
    sourceSize: v3(source.size),
    horizontalScale: +h.toFixed(5),
    verticalScale: +v.toFixed(5),
    verticalMultiplier: WORLD.terrain.verticalScaleMultiplier,
    normalizedSize: v3(final.size),
    horizontalExtent: +Math.max(final.size.x, final.size.z).toFixed(0),
    verticalRange: +final.size.y.toFixed(0),
    // What the player actually sees: relief above the chosen waterline.
    seaLevelPercentile: WORLD.terrain.seaLevelPercentile,
    peakAboveSea: +peak.toFixed(0),
    landFraction: +(land.length / field.cells.length).toFixed(3),
    position: v3(root.position),
    rotationYDeg: +((WORLD.terrain.rotationY * 180) / Math.PI).toFixed(1),
    // Cached once: the HUD must not rebuild 30 km of bounds every frame.
    nearEdgeZ: +(landFrontZ + root.position.z).toFixed(0),
    center: final.center.clone(),
  };
  console.log("[terrain]", report);
  return report;
}

/** HemisphereLight + sun. Legible relief, no shadow maps over 30 km. */
export function createWorldLighting() {
  const sun = new THREE.DirectionalLight(0xfff2df, 2.3);
  sun.position.set(-4200, 5200, 2600);
  sun.name = "Sun";
  const sky = new THREE.HemisphereLight(0xbcd6ea, 0x33424f, 1.15);
  sky.name = "SkyFill";
  return { sun, sky };
}
