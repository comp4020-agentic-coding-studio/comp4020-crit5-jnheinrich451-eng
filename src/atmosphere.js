/**
 * Stage 03.15 — cloud fields and atmospheric state.
 *
 * Clouds are sprite clusters, not volumetrics (§19): a handful of soft puff
 * textures instanced into clusters placed along the flight corridor. The system
 * publishes one number the rest of the FX stack reads — local cloud density —
 * from which humidity, visibility and the HUD advisory all follow (§23).
 */
import * as THREE from "three";

export const ATMOS = {
  // --- field layout ---
  // Corridor is the carrier-to-Ireland run: spawn (0,700,0), carrier -1600,
  // coast around -22000. Clusters are seeded along it with deliberate gaps.
  corridor: { zStart: 1500, zEnd: -28000, halfWidth: 5200 },
  layers: [
    // Low broken cloud, below and around the cruise altitude.
    { name: "low", y: [420, 760], clusters: 11, radius: [420, 820], puffs: [7, 11], puffScale: [340, 700], opacity: 0.5 },
    // Mid bank, thick enough to fly into deliberately.
    { name: "mid", y: [1150, 1650], clusters: 8, radius: [560, 1050], puffs: [8, 13], puffScale: [460, 900], opacity: 0.58 },
  ],
  // Deterministic seed: the same sky every run, so a visual comparison between
  // two builds is actually a comparison.
  seed: 20260822,
  // Clear corridors, as |z| ranges left empty so the player always has an out.
  clearBands: [[-4200, -6800], [-13500, -16000]],

  // --- density sampling ---
  // Density falls off from a cluster's centre to its radius; inside the core
  // fraction it is solid.
  coreFraction: 0.45,
  // Cloud density is only ever sampled against the nearest few clusters.
  maxDensity: 1,

  // --- immersion (§22) ---
  baseFogDensity: 0.000035, // matches WORLD.fogDensity
  cloudFogDensity: 0.0028,
  fogLambda: 2.6, // 1/s — entering cloud takes a beat, it is not a switch
  washMax: 0.34, // screen wash opacity at full density
  cloudColor: 0xdfe9f2,

  // --- humidity model (§18/§23) ---
  // Humid air exists near cloud even outside it: skimming the tops is moist.
  // The halo stays THIN on purpose (§16): it was briefly widened to 3000 m to
  // make wingtip vapor reachable, which put 94% of the flown course inside it
  // and turned VISIBLE MOISTURE into a permanent placard. Reachability was never
  // the halo's job — see VAPOR.humiditySaturate.
  baseHumidity: 0.12,
  proximityRange: 1400, // metres of "near cloud" moisture halo
  proximityHumidity: 0.62,
  cloudHumidity: 1.0,

  // --- advisory thresholds (§24) ---
  advisory: {
    // VISIBLE MOISTURE is a humidity call, not a density one: it is the cue for
    // air that will produce vapor, which happens in the halo AROUND cloud as
    // well as at its edge.
    moistureHumidity: 0.42,
    moistureDensity: 0.06,
    cloudDensity: 0.3, // CLOUD
    lowVisDensity: 0.62, // LOW VIS
    imcDensity: 0.85, // IMC
    delay: 0.45, // seconds a condition must hold before it is announced
    clearDelay: 0.8, // and before it is withdrawn
  },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

/** Deterministic PRNG so the cloud field is identical every run. */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Local cloud density at a point, 0..1. Pure — takes the cluster list, so it is
 * testable without a scene and cheap enough to call every frame (§30).
 */
export function densityAt(position, clusters, cfg = ATMOS) {
  let best = 0;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const dx = position.x - c.x;
    const dy = (position.y - c.y) * c.yStretch;
    const dz = position.z - c.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > c.radius * c.radius) continue;
    const d = Math.sqrt(d2) / c.radius;
    const v = d <= cfg.coreFraction ? 1 : smooth(1 - (d - cfg.coreFraction) / (1 - cfg.coreFraction));
    if (v > best) {
      best = v;
      if (best >= 1) return 1;
    }
  }
  return best;
}

/** Distance to the nearest cluster surface, or Infinity. Pure. */
export function distanceToCloud(position, clusters) {
  let best = Infinity;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const d = Math.hypot(position.x - c.x, (position.y - c.y) * c.yStretch, position.z - c.z) - c.radius;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Humidity from cloud density and proximity (§23). Pure. Inside cloud the air
 * is saturated; within the halo it is moist; well clear it is dry.
 */
export function humidityFor(density, distance, cfg = ATMOS) {
  if (density > 0) return cfg.proximityHumidity + (cfg.cloudHumidity - cfg.proximityHumidity) * density;
  if (!Number.isFinite(distance)) return cfg.baseHumidity;
  const near = clamp01(1 - distance / cfg.proximityRange);
  return cfg.baseHumidity + (cfg.proximityHumidity - cfg.baseHumidity) * smooth(near);
}

/**
 * Advisory text for a condition, or null. Pure — ordered most severe first.
 * Density drives the three in-cloud calls; humidity drives VISIBLE MOISTURE, so
 * skimming the outside of a bank is announced as the moist air it is (§24).
 */
export function advisoryFor(density, humidity = 0, cfg = ATMOS) {
  const a = cfg.advisory;
  if (density >= a.imcDensity) return "IMC";
  if (density >= a.lowVisDensity) return "LOW VIS";
  if (density >= a.cloudDensity) return "CLOUD";
  if (density >= a.moistureDensity || humidity >= a.moistureHumidity) return "VISIBLE MOISTURE";
  return null;
}

/**
 * Debounced advisory. A cloud wisp clipped for a tenth of a second should not
 * flash text on the HUD, and leaving a bank should not clear it instantly.
 */
export function createAdvisoryLatch(cfg = ATMOS) {
  const a = cfg.advisory;
  let shown = null;
  let pending = null;
  let held = 0;
  let humidity = 0;
  return {
    /** `hum` is optional so the latch can be exercised on density alone. */
    update(density, dt, hum = humidity) {
      humidity = hum;
      const want = advisoryFor(density, humidity, cfg);
      if (want === shown) {
        pending = null;
        held = 0;
        return shown;
      }
      if (want !== pending) {
        pending = want;
        held = 0;
      }
      held += dt;
      // Escalating takes `delay`; clearing takes longer, so a thin patch of
      // clear air inside a bank does not blink the warning off.
      const needed = want === null ? a.clearDelay : a.delay;
      if (held >= needed) {
        shown = want;
        pending = null;
        held = 0;
      }
      return shown;
    },
    get current() {
      return shown;
    },
    reset() {
      shown = pending = null;
      held = 0;
    },
  };
}

/* ---- world side ---- */

function puffTexture(rand, bright) {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  // A few overlapping soft lobes rather than one disc: a single radial gradient
  // reads as a ball, and the brief explicitly rules out hard-edged blobs (§21).
  for (let i = 0; i < 7; i++) {
    const r = size * (0.16 + rand() * 0.2);
    const x = size / 2 + (rand() - 0.5) * size * 0.42;
    const y = size / 2 + (rand() - 0.5) * size * 0.34;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    // Bright rims, softer cores — the light-through-cloud read.
    grad.addColorStop(0, `rgba(255,255,255,${bright ? 0.5 : 0.36})`);
    grad.addColorStop(0.55, `rgba(238,245,252,${bright ? 0.2 : 0.14})`);
    grad.addColorStop(1, "rgba(226,236,247,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * WorldRoot-level CloudField -> one Object3D per cluster -> sprites.
 * Clusters are the density model; the sprites are only their appearance.
 */
export function createCloudField(cfg = ATMOS) {
  const root = new THREE.Object3D();
  root.name = "CloudField";
  const rand = seededRandom(cfg.seed);
  // Three shared textures for the whole sky: instancing by reuse, not by count.
  const textures = [puffTexture(rand, true), puffTexture(rand, false), puffTexture(rand, true)];
  const materials = textures.map(
    (map) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0.5, fog: true })
  );

  const clusters = [];
  let sprites = 0;

  const inClearBand = (z) => cfg.clearBands.some(([a, b]) => z <= Math.max(a, b) && z >= Math.min(a, b));

  for (const layer of cfg.layers) {
    for (let i = 0; i < layer.clusters; i++) {
      // Spread along the corridor with jitter, skipping the clear bands.
      let z = 0;
      for (let tries = 0; tries < 8; tries++) {
        const t = (i + rand() * 0.8) / layer.clusters;
        z = cfg.corridor.zStart + (cfg.corridor.zEnd - cfg.corridor.zStart) * t;
        if (!inClearBand(z)) break;
      }
      if (inClearBand(z)) continue;

      const x = (rand() * 2 - 1) * cfg.corridor.halfWidth;
      const y = layer.y[0] + rand() * (layer.y[1] - layer.y[0]);
      const radius = layer.radius[0] + rand() * (layer.radius[1] - layer.radius[0]);

      const group = new THREE.Object3D();
      group.name = `Cloud_${layer.name}_${i}`;
      group.position.set(x, y, z);

      const count = Math.round(layer.puffs[0] + rand() * (layer.puffs[1] - layer.puffs[0]));
      for (let p = 0; p < count; p++) {
        const mat = materials[(p + i) % materials.length];
        const sprite = new THREE.Sprite(mat);
        // Flattened distribution: cloud is wider than it is tall, which is what
        // makes a cluster read as a bank rather than a sphere of cotton.
        sprite.position.set(
          (rand() * 2 - 1) * radius * 0.85,
          (rand() * 2 - 1) * radius * 0.34,
          (rand() * 2 - 1) * radius * 0.85
        );
        const s = layer.puffScale[0] + rand() * (layer.puffScale[1] - layer.puffScale[0]);
        sprite.scale.set(s, s * (0.62 + rand() * 0.3), 1);
        group.add(sprite);
        sprites++;
      }

      root.add(group);
      clusters.push({ x, y, z, radius, yStretch: 2.2, group, layer: layer.name });
    }
  }

  return {
    root,
    clusters,
    // Exposed so the day/night clock can tint the whole sky with three colour
    // writes instead of walking ~170 sprites: the materials are already shared.
    materials,
    baseOpacity: materials.map((m) => m.opacity),
    report: { clusters: clusters.length, sprites, textures: textures.length, layers: cfg.layers.map((l) => l.name) },
  };
}

/**
 * The atmosphere service. Owns the field, samples density at the aircraft, and
 * drives fog + screen wash. Publishes { density, humidity, visibility,
 * advisory } — everything else in the FX stack reads only that.
 */
export function createAtmosphere({ scene, host = document.body, cfg = ATMOS } = {}) {
  const field = createCloudField(cfg);
  if (scene) scene.add(field.root);

  // Screen wash instead of a post-process pass (§28/§30): one DOM layer costs
  // nothing and cannot be blamed for a frame-rate regression.
  const wash = document.createElement("div");
  wash.id = "cloud-wash";
  wash.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;background:radial-gradient(120% 120% at 50% 45%, rgba(246,250,255,0.96), rgba(214,228,240,0.99));transition:none";
  host.appendChild(wash);

  const latch = createAdvisoryLatch(cfg);
  const baseFogColor = new THREE.Color(scene && scene.fog ? scene.fog.color.getHex() : 0x9cbad2);
  const cloudColor = new THREE.Color(cfg.cloudColor);

  const state = {
    density: 0,
    smoothedDensity: 0,
    humidity: cfg.baseHumidity,
    distance: Infinity,
    visibility: 1,
    advisory: null,
    inCloud: false,
  };

  function update(position, dt) {
    state.density = densityAt(position, field.clusters, cfg);
    state.distance = distanceToCloud(position, field.clusters);
    state.humidity = humidityFor(state.density, state.distance, cfg);
    // Fog and wash follow a damped density so a cluster edge is a transition,
    // not a pop.
    state.smoothedDensity += (state.density - state.smoothedDensity) * (1 - Math.exp(-cfg.fogLambda * dt));
    state.inCloud = state.density > cfg.advisory.cloudDensity;
    state.visibility = 1 - state.smoothedDensity;
    state.advisory = latch.update(state.density, dt, state.humidity);

    if (scene && scene.fog) {
      scene.fog.density = cfg.baseFogDensity + (cfg.cloudFogDensity - cfg.baseFogDensity) * state.smoothedDensity;
      scene.fog.color.copy(baseFogColor).lerp(cloudColor, state.smoothedDensity);
    }
    // Capped well short of opaque: the player must never be fully blinded (§22).
    wash.style.opacity = (state.smoothedDensity * cfg.washMax).toFixed(3);
  }

  function reset() {
    state.smoothedDensity = 0;
    state.density = 0;
    state.advisory = null;
    latch.reset();
    wash.style.opacity = "0";
    if (scene && scene.fog) {
      scene.fog.density = cfg.baseFogDensity;
      scene.fog.color.copy(baseFogColor);
    }
  }

  /**
   * Stage 05.4 — the day/night clock owns the fog's BASE colour; this system
   * still owns the blend toward cloud.
   *
   * `baseFogColor` was captured once at construction and re-applied every frame,
   * so anything else writing `scene.fog.color` was silently overwritten within
   * the same frame. Rather than give fog two owners, the clock hands its horizon
   * colour in here and the cloud blend continues to work unchanged.
   */
  function setBaseFog(hex) {
    baseFogColor.setHex(hex);
  }

  /**
   * Cloud tint and opacity for the time of day (§19/§20).
   *
   * The sprite materials are SHARED across the whole field (three textures, three
   * materials), so tinting the sky's clouds is three colour writes rather than a
   * traversal of ~170 sprites. Opacity keeps a floor at night: clouds carry the
   * depth read, and clouds the same colour as the sky are clouds that are not
   * there.
   */
  function setCloudTint(hex, opacityScale = 1) {
    cloudColor.setHex(hex);
    for (let i = 0; i < field.materials.length; i++) {
      const m = field.materials[i];
      m.color.setHex(hex);
      m.opacity = (field.baseOpacity[i] ?? 0.5) * opacityScale;
    }
  }

  return { field, state, update, reset, setBaseFog, setCloudTint, cfg, report: field.report, wash };
}
