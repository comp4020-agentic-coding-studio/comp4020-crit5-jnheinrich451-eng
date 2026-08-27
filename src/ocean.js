/**
 * Stage 05.4 — the visual ocean.
 *
 * ONE CRITICAL BOUNDARY: this file changes NOTHING about gameplay. Collision,
 * AGL, crash detection and the carrier's placement all keep using the flat
 * `WORLD.oceanY` plane at y = 0 (§21). The waves here exist only in the vertex
 * shader; no CPU code, and nothing in physics.js, ever reads them. If a wave
 * height ever needs to be queried by gameplay, that is a different feature and
 * this is the wrong file for it.
 *
 * The whole surface is one mesh with a custom ShaderMaterial: three Gerstner-ish
 * sine components on the GPU, a cheap Fresnel blend toward the horizon colour,
 * and a single specular lobe for the sun glitter. No FFT, no fluid solve, no
 * reflection camera, no second render pass (§22/§P).
 */
import * as THREE from "three";

export const OCEAN = {
  /**
   * The patch that follows the player.
   *
   * 90 km, not 14 km. The first attempt used a 14 km patch on the reasoning that
   * fog would hide its edge — it does not: at 3.9 km altitude the fog factor at
   * 7 km out is only 6%, so the sea ended in a hard dark quadrilateral with sky
   * beyond it (§24 exists precisely to forbid that). Visibility here is roughly
   * 1/fogDensity ≈ 28 km, so the edge has to sit several times further out than
   * that before haze genuinely swallows it.
   */
  patchSize: 90000,
  /**
   * 96 x 96 segments over 90 km would be a 937 m cell — coarser than the 74 m
   * chop wavelength, which aliases into visible triangular garbage. So the grid
   * is WARPED instead of uniform: see warpGrid(). Vertices bunch up near the
   * player (~20 m cells) and stretch toward the rim (~11 km cells), which puts
   * the resolution where the waves are actually legible and spends nothing on
   * water that is 40 km away and fogged out.
   */
  segments: 96,
  /** Exponent of the radial warp. 2 gives ~20 m cells at the centre. */
  warpPower: 2,

  /**
   * Waves fade out with distance from the camera.
   *
   * Without this the far vertices — which are kilometres apart — displace by the
   * same amplitude as the near ones and the horizon develops slow, enormous
   * ripples. Beyond this radius the surface is flat, which is invisible anyway
   * under the haze.
   */
  waveFade: 7000,

  /**
   * Three directional components (§25). Amplitudes are restrained on purpose —
   * this is ocean seen from a fast jet, not a sailing simulator, and tall waves
   * next to a flat collision plane look wrong the moment the player descends.
   *
   * [amplitude m, wavelength m, speed m/s, direction radians]
   */
  waves: [
    [0.7, 620, 11.0, 0.35], // large swell
    [0.38, 210, 7.5, 1.15], // medium
    [0.17, 74, 4.2, 2.42], // small chop — raised: this is the scale the eye
    // judges height from when there is nothing else over open water.
  ],

  /**
   * How much horizon colour the surface picks up at grazing angles.
   *
   * TUNED DOWN from base 0.028 / power 5, which made the sea read as "soup": a
   * milky sheen washed across the whole surface because the Fresnel term was
   * reaching high values over most of the visible water and dragging it toward
   * the pale horizon colour. A higher power keeps the reflection confined to
   * genuinely grazing angles, and the mix is capped below 1 in the shader so
   * water is never *replaced* by sky — it is only tinted by it.
   */
  fresnelPower: 6.5,
  fresnelBase: 0.012,
  /** Ceiling on the horizon blend. Below 1 on purpose: see above. */
  fresnelMax: 0.55,
  specularPower: 220,
  /** The wide, weak lobe that widens the glitter path. Was 0.12 — also soup. */
  sheen: 0.045,
};

/**
 * Warp a uniform grid into a radially graded one, in place.
 *
 * Each axis is remapped by |u|^power, keeping the sign: the centre keeps fine
 * spacing and the rim stretches. Done ONCE at build time on the CPU — this is
 * not per-frame work, and §26's "no CPU vertex updates" is about animation.
 */
export function warpGrid(geometry, half, power) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / half;
    const y = pos.getY(i) / half;
    pos.setX(i, Math.sign(x) * Math.pow(Math.abs(x), power) * half);
    pos.setY(i, Math.sign(y) * Math.pow(Math.abs(y), power) * half);
  }
  pos.needsUpdate = true;
  return geometry;
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uTime;
uniform vec3 uWaveA;   // amplitude, wavelength, speed  (packed per component)
uniform vec3 uWaveB;
uniform vec3 uWaveC;
uniform vec3 uWaveDir; // the three directions, radians
uniform float uWaveFade;
varying vec3 vWorld;
varying vec3 vNormal2;

// One sine component. Returns height and accumulates the analytic slope, so the
// normal comes from the same expression as the displacement and cannot drift
// out of step with it.
float comp(vec3 w, float dirAngle, vec2 p, float t, inout vec2 slope) {
  vec2 dir = vec2(cos(dirAngle), sin(dirAngle));
  float k = 6.2831853 / w.y;              // wave number from wavelength
  float phase = k * dot(dir, p) + t * w.z * k;
  slope += dir * (w.x * k * cos(phase));
  return w.x * sin(phase);
}

void main() {
  // The mesh is rotated flat, so its local XY is world XZ. World position is
  // needed for the wave phase or the waves would slide with the patch as it
  // follows the player, which reads as the whole sea sliding sideways.
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 p = world.xz;
  vec2 slope = vec2(0.0);
  float h = 0.0;
  h += comp(uWaveA, uWaveDir.x, p, uTime, slope);
  h += comp(uWaveB, uWaveDir.y, p, uTime, slope);
  h += comp(uWaveC, uWaveDir.z, p, uTime, slope);

  // Amplitude falls off with distance from the eye. The rim cells are kilometres
  // across, so displacing them by the same amount as the fine centre cells turns
  // the horizon into slow enormous ripples.
  float d = length(world.xz - cameraPosition.xz);
  float fade = 1.0 - smoothstep(uWaveFade * 0.35, uWaveFade, d);
  world.y += h * fade;
  slope *= fade;

  vWorld = world.xyz;
  vNormal2 = normalize(vec3(-slope.x, 1.0, -slope.y));
  gl_Position = projectionMatrix * viewMatrix * world;

  /**
   * LOGARITHMIC DEPTH. The renderer runs with logarithmicDepthBuffer: true, and
   * a raw ShaderMaterial does NOT receive the depth chunks that built-in
   * materials get. Without them this mesh wrote LINEAR depth while every other
   * object in the scene wrote logarithmic depth, so the two are not comparable:
   * the sky dome won the depth test over near water and the ocean rendered as a
   * hard-edged wedge with sky showing through it. Must come after gl_Position.
   */
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uDeep;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunStrength;
uniform float uFresnelBase;
uniform float uFresnelPower;
uniform float uFresnelMax;
uniform float uSpecPower;
uniform float uSheen;
uniform float uFogDensity;
uniform vec3 uFogColor;
varying vec3 vWorld;
varying vec3 vNormal2;

void main() {
  // Pairs with logdepthbuf_vertex: writes gl_FragDepthEXT so this surface sorts
  // against the rest of the scene instead of against a different depth scale.
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal2);
  vec3 v = normalize(cameraPosition - vWorld);

  // Cheap Fresnel (§28): grazing angles take the horizon colour, steep angles
  // the deep water colour. CAPPED at uFresnelMax — an uncapped blend turns the
  // far half of the sea into flat sky colour, which is what made it look like
  // soup rather than water. Water tinted by the sky still reads as water; water
  // replaced by the sky does not.
  float f = uFresnelBase + (1.0 - uFresnelBase) * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), uFresnelPower);
  vec3 base = mix(uDeep, uHorizon, clamp(f, 0.0, uFresnelMax));

  // One specular lobe for the sun/moon glitter. Narrow and elongated by the
  // wave normals themselves rather than by an anisotropic term.
  vec3 h = normalize(uSunDir + v);
  float spec = pow(max(dot(n, h), 0.0), uSpecPower) * uSunStrength;
  // A wide, weak lobe underneath widens the glitter path so it reads as a track
  // across the water rather than as a single bright dot. Kept low: this term is
  // the other half of the milky look when it is turned up.
  float sheen = pow(max(dot(n, h), 0.0), 12.0) * uSunStrength * uSheen;

  vec3 col = base + uSunColor * (spec + sheen);

  // Matched to the scene's FogExp2 so the ocean meets the sky with no seam.
  float d = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);

  /**
   * COLOUR SPACE. A raw ShaderMaterial does not get the renderer's output
   * conversion that built-in materials receive, so linear values written here
   * reach an sRGB framebuffer unconverted and the ocean renders far darker than
   * its own colour — a mid navy came out looking near-black. three.js provides
   * the chunk; include it rather than hand-rolling a 1/2.2 pow.
   */
  #include <colorspace_fragment>
}
`;

/**
 * Builds the visual ocean. `follow(position)` keeps the patch under the player
 * and `apply(env)` pushes one frame of time-of-day values in.
 */
export function createOcean({ fogDensity = 0.000035, cfg = OCEAN } = {}) {
  const geometry = warpGrid(
    new THREE.PlaneGeometry(cfg.patchSize, cfg.patchSize, cfg.segments, cfg.segments),
    cfg.patchSize / 2,
    cfg.warpPower
  );
  const uniforms = {
    uTime: { value: 0 },
    uWaveA: { value: new THREE.Vector3(cfg.waves[0][0], cfg.waves[0][1], cfg.waves[0][2]) },
    uWaveB: { value: new THREE.Vector3(cfg.waves[1][0], cfg.waves[1][1], cfg.waves[1][2]) },
    uWaveC: { value: new THREE.Vector3(cfg.waves[2][0], cfg.waves[2][1], cfg.waves[2][2]) },
    uWaveDir: { value: new THREE.Vector3(cfg.waves[0][3], cfg.waves[1][3], cfg.waves[2][3]) },
    uWaveFade: { value: cfg.waveFade },
    uDeep: { value: new THREE.Color(0x2b5c80) },
    uHorizon: { value: new THREE.Color(0x9cbad2) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xfff4e2) },
    uSunStrength: { value: 1 },
    uFresnelBase: { value: cfg.fresnelBase },
    uFresnelPower: { value: cfg.fresnelPower },
    uFresnelMax: { value: cfg.fresnelMax },
    uSpecPower: { value: cfg.specularPower },
    uSheen: { value: cfg.sheen },
    uFogDensity: { value: fogDensity },
    uFogColor: { value: new THREE.Color(0x9cbad2) },
  };

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: false })
  );
  mesh.name = "OceanVisual";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  // The patch is re-centred on the player every frame, so it is never outside
  // the frustum in a way three.js could usefully cull, and its bounding sphere
  // is meaningless after the vertex displacement anyway.
  mesh.frustumCulled = false;
  // Default render order: with correct logarithmic depth the sea sorts against
   // the sky and the terrain on its own. Forcing it to draw first was papering
  // over the depth mismatch above, and hid which of the two was wrong.
  mesh.renderOrder = 0;

  return {
    mesh,
    uniforms,

    /**
     * §24 — the infinite-ocean cheat. The patch follows the player in X/Z only;
     * height stays at y = 0, which is also the collision plane, so the visual
     * and the physical sea never disagree about where the water is.
     *
     * Snapped to a coarse step rather than followed continuously: the wave phase
     * is computed from WORLD position, so the pattern is stable in the world
     * either way, but moving the mesh a fraction of a metre per frame makes the
     * tessellation crawl through it. The step is far smaller than the visible
     * patch, so the edge stays well outside the fog limit regardless.
     */
    follow(position) {
      const step = 128;
      mesh.position.x = Math.round(position.x / step) * step;
      mesh.position.z = Math.round(position.z / step) * step;
    },

    /** One frame of clock. `env` is world-time.js's environmentFor(). */
    apply(env, dt) {
      uniforms.uTime.value += dt;
      uniforms.uDeep.value.setHex(env.waterColor);
      uniforms.uHorizon.value.setHex(env.hazeColor);
      uniforms.uFogColor.value.setHex(env.hazeColor);
      // The glitter follows whichever body is up, and takes its colour — so the
      // sunset track is gold and the night track is a faint cool sheen (§31/§32).
      const lit = env.day >= env.night ? env.sunDirection : env.moonDirection;
      uniforms.uSunDir.value.set(lit.x, lit.y, lit.z);
      uniforms.uSunColor.value.setHex(env.day >= env.night ? env.sunColor : env.moonColor);
      uniforms.uSunStrength.value = Math.max(env.day, env.night * 0.22);
    },

    setFogDensity(d) {
      uniforms.uFogDensity.value = d;
    },
  };
}
