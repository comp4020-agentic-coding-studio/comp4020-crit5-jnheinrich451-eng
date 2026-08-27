/**
 * Stage 05.4 — procedural night lights: settlements on Ireland, and the
 * carrier's own deck lighting.
 *
 * VISUAL ONLY. Nothing here illuminates anything: there are no PointLights, no
 * shadow casters and no contribution to the lighting solution (§33). They are
 * emissive dots that read as inhabited land from the air, which is the entire
 * purpose — at night the island otherwise has no scale and no life.
 *
 * The whole settlement field is ONE THREE.Points draw call with one shared
 * texture (§34). The placement rule is a pure function with the height field
 * injected, so it is testable against a synthetic island with no scene (§4).
 */
import * as THREE from "three";

export const LIGHTS = {
  /** Deterministic: the same island every run (§35). */
  seed: 0x5eed1e,

  major: 3, // cities
  minor: 10, // towns
  sparse: 190, // isolated farms and cottages

  /** Per-cluster light counts and radii, in metres. */
  majorLights: [150, 260],
  majorRadius: [900, 1600],
  minorLights: [26, 60],
  minorRadius: [260, 520],

  /**
   * Placement limits (§37). Lights want low, flat, coastal-ish ground: nobody
   * builds a town on a 600 m ridge, and a dot on a peak instantly reads as a bug.
   */
  minHeight: 6, // above this to be dry land, not sea
  maxHeight: 210, // below this to be habitable ground
  maxSlope: 0.16, // rise over run across a 120 m probe
  slopeProbe: 120,

  /** Warm domestic light, with a few cool ones for variety (§39). */
  warmColors: [0xffd9a0, 0xffc880, 0xffe6c0, 0xffb96a],
  coolColors: [0xcfe0ff, 0xdfe8f5],
  coolFraction: 0.12,

  size: 26, // sprite size in metres — a town light is not a streetlamp
  sizeJitter: 0.5,
};

/** Tiny deterministic PRNG (mulberry32). Local so this module stays standalone. */
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, so clusters fall off radially instead of filling a disc. */
function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Is this a place a town would stand? Pure, with the height field injected.
 *
 * Slope is measured as a cross probe rather than a gradient of the real mesh:
 * four samples is enough to reject a hillside and costs four terrain queries at
 * load, not per frame.
 */
export function habitable(x, z, sampleHeight, cfg = LIGHTS) {
  const h = sampleHeight(x, z);
  if (!Number.isFinite(h)) return null;
  if (h < cfg.minHeight || h > cfg.maxHeight) return null;
  const d = cfg.slopeProbe;
  const hx = Math.abs(sampleHeight(x + d, z) - sampleHeight(x - d, z)) / (2 * d);
  const hz = Math.abs(sampleHeight(x, z + d) - sampleHeight(x, z - d)) / (2 * d);
  if (Math.max(hx, hz) > cfg.maxSlope) return null;
  return h;
}

/**
 * Plan the settlement field. Returns flat arrays ready for a BufferGeometry.
 *
 * CLUSTERED, NEVER SCATTERED (§36). Uniform noise across the island reads as
 * glitter — the eye recognises inhabited land by the pattern of a dense core
 * with a thinning skirt and dark country between towns, so the generator makes
 * exactly that: a few cities, more towns, and a sparse dusting.
 */
export function planSettlements({ bounds, sampleHeight, cfg = LIGHTS, seed = null } = {}) {
  const rand = seeded(seed === null ? cfg.seed : seed);
  const positions = [];
  const colors = [];
  const sizes = [];
  const clusters = [];

  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;

  // A cluster centre has to be habitable itself, or a city ends up half in the
  // sea. Bounded attempts, because a badly shaped island might have nowhere.
  const findCentre = () => {
    for (let attempt = 0; attempt < 260; attempt++) {
      const x = bounds.minX + rand() * spanX;
      const z = bounds.minZ + rand() * spanZ;
      if (habitable(x, z, sampleHeight, cfg) !== null) return { x, z };
    }
    return null;
  };

  const emit = (x, z, rand01) => {
    const h = habitable(x, z, sampleHeight, cfg);
    if (h === null) return false; // silently dropped: no ocean lights, no peaks
    const cool = rand01 < cfg.coolFraction;
    const palette = cool ? cfg.coolColors : cfg.warmColors;
    const c = new THREE.Color(palette[Math.floor(rand() * palette.length)]);
    // Static per-light brightness variation (§40). No twinkling: a coastline
    // that flickers looks like Christmas lights, not like a town.
    const b = 0.55 + rand() * 0.45;
    positions.push(x, h + 8, z);
    colors.push(c.r * b, c.g * b, c.b * b);
    sizes.push(cfg.size * (1 - cfg.sizeJitter * 0.5 + rand() * cfg.sizeJitter));
    return true;
  };

  const buildCluster = (countRange, radiusRange, kind) => {
    const centre = findCentre();
    if (!centre) return;
    const count = Math.round(countRange[0] + rand() * (countRange[1] - countRange[0]));
    const radius = radiusRange[0] + rand() * (radiusRange[1] - radiusRange[0]);
    let placed = 0;
    for (let i = 0; i < count; i++) {
      // Gaussian radius, uniform angle: dense core, thinning skirt.
      const r = Math.abs(gaussian(rand)) * radius * 0.45;
      const a = rand() * Math.PI * 2;
      if (emit(centre.x + Math.cos(a) * r, centre.z + Math.sin(a) * r, rand())) placed++;
    }
    if (placed > 0) clusters.push({ kind, x: centre.x, z: centre.z, radius, lights: placed });
  };

  for (let i = 0; i < cfg.major; i++) buildCluster(cfg.majorLights, cfg.majorRadius, "major");
  for (let i = 0; i < cfg.minor; i++) buildCluster(cfg.minorLights, cfg.minorRadius, "minor");
  for (let i = 0; i < cfg.sparse; i++) {
    emit(bounds.minX + rand() * spanX, bounds.minZ + rand() * spanZ, rand());
  }

  return { positions, colors, sizes, clusters, count: sizes.length };
}

/** Soft round dot, shared by every light in the field. */
function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,250,235,0.55)");
  grad.addColorStop(1, "rgba(255,240,210,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * One Points object for the whole island.
 *
 * Sized in WORLD metres, not screen pixels: `gl_PointSize` is divided by view
 * depth in the shader, so a town keeps its physical footprint as the player
 * climbs instead of turning into a uniform sheet of dots at altitude.
 */
export function createSettlementLights(plan) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(plan.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(plan.colors, 3));
  geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(plan.sizes, 1));

  const uniforms = {
    uOpacity: { value: 0 },
    uMap: { value: dotTexture() },
    uScale: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aSize;
      uniform float uScale;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Perspective-correct: physical size in metres, clamped so a distant
        // city stays a visible speck rather than dropping below one pixel.
        gl_PointSize = clamp(aSize * uScale * 300.0 / -mv.z, 1.0, 22.0);
        gl_Position = projectionMatrix * mv;
        // The renderer uses a logarithmic depth buffer; a raw ShaderMaterial has
        // to opt in or these points sort against a different depth scale than
        // the terrain they stand on.
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying vec3 vColor;
      void main() {
        #include <logdepthbuf_fragment>
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor, 1.0) * t * uOpacity;
        #include <colorspace_fragment>
      }
    `,
  });
  material.vertexColors = true;

  const points = new THREE.Points(geometry, material);
  points.name = "SettlementLights";
  points.frustumCulled = false;
  points.renderOrder = 2;
  points.visible = false;

  return {
    points,
    plan,
    /**
     * §41 — faded by the night factor, never toggled. A hard threshold turns the
     * whole island on in one frame, which is the single most artificial thing a
     * day/night cycle can do.
     */
    apply(env) {
      const o = env.nightLightLevel;
      uniforms.uOpacity.value = o;
      // Hidden outright at full daylight so the draw call costs nothing when
      // there is nothing to see.
      points.visible = o > 0.01;
    },
  };
}

/**
 * §43 — carrier deck lighting: emissive sprites along the deck edges and the
 * island, positioned from the ship's MEASURED anchors rather than authored
 * offsets, so they land correctly whatever the asset's proportions are.
 */
export function createCarrierLights(references, { length = 332.8 } = {}) {
  const root = new THREE.Object3D();
  root.name = "CarrierLights";
  root.visible = false;

  const tex = dotTexture();
  const material = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffd39a,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const deckY = references && references.local ? references.local.DeckReference.y : 18;

  // Deck edge runs, port and starboard, plus a short row across the stern.
  const halfBeam = length * 0.13;
  const from = -length * 0.44;
  const to = length * 0.42;
  const step = length * 0.055;
  for (let z = from; z <= to; z += step) {
    for (const side of [-1, 1]) {
      const s = new THREE.Sprite(material);
      s.position.set(side * halfBeam, deckY + 1.4, z);
      s.scale.setScalar(9);
      root.add(s);
    }
  }
  // The island: a taller, brighter cluster so the ship has a recognisable shape
  // from the air rather than a flat outline of dots.
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(material);
    s.position.set(halfBeam * 0.72, deckY + 6 + i * 3.4, length * (0.02 + 0.03 * (i % 3)));
    s.scale.setScalar(7);
    root.add(s);
  }

  return {
    root,
    /** Same night factor as the settlements, so the world lights up together. */
    apply(env) {
      const o = env.nightLightLevel;
      material.opacity = o * 0.95;
      root.visible = o > 0.01;
    },
  };
}
