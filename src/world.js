// Scene, ocean, sky, fog, lighting. CLAUDE.md §5, stage 1.
//
// 1 world unit = 1 metre, everywhere, with no exceptions. Stage 2 onward
// normalises every glTF asset from its MEASURED bounds to a real length, so
// this is the only place the scale of the world is decided.

import * as THREE from "three";
import { loadGLTF, normalise, recordFailure } from "./assets.js";

export const OCEAN_EXTENT = 100000; // 100 km square
export const CAMERA_NEAR = 0.5;
export const CAMERA_FAR = 120000;
export const FOG_DENSITY = 3.5e-5;

// The sky's horizon band. The fog is tinted to EXACTLY this colour, which is
// what stops a visible fog line where the water meets the sky -- fog is not
// decoration here, it is the atmospheric perspective that keeps a 30 km world
// from reading as a tabletop model.
export const HORIZON_COLOR = 0xa8c4dc;
const ZENITH_COLOR = 0x1e4f86;
const OCEAN_DEEP = 0x0d2436;
const OCEAN_SHALLOW = 0x1d5773;

// Sun direction, shared by the light, the sky glow and the ocean glint so all
// three agree about where the sun is.
export const SUN_DIR = new THREE.Vector3(0.42, 0.38, 0.82).normalize();

// Chunks that a custom ShaderMaterial must include by hand once the renderer
// has logarithmicDepthBuffer on. Miss them and the material writes ordinary
// depth while everything else writes logarithmic depth -- the ocean then
// z-fights the terrain and disappears behind the sky at range, which reads as
// "the shader is broken" rather than "the depth buffers disagree".
const LOGDEPTH_PARS_VERT = "#include <logdepthbuf_pars_vertex>";
const LOGDEPTH_VERT = "#include <logdepthbuf_vertex>";
const LOGDEPTH_PARS_FRAG = "#include <logdepthbuf_pars_fragment>";
const LOGDEPTH_FRAG = "#include <logdepthbuf_fragment>";

// <common> must come FIRST in every one of these, because the log-depth and
// fog chunks below are written against helpers it defines --
// logdepthbuf_vertex calls isPerspectiveMatrix(), which lives in <common> and
// nowhere else. Omitting it fails at SHADER LINK time, not at build time:
// `pnpm check` stays green, the page throws nothing, and the only symptom is
// a silent WebGL "program not valid" and an empty screen.
const SKY_VERT = /* glsl */ `
  #include <common>
  varying vec3 vWorld;
  ${LOGDEPTH_PARS_VERT}
  void main() {
    vWorld = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${LOGDEPTH_VERT}
  }
`;

const SKY_FRAG = /* glsl */ `
  #include <common>
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  varying vec3 vWorld;
  ${LOGDEPTH_PARS_FRAG}
  void main() {
    vec3 dir = normalize(vWorld);
    // Compress the gradient toward the horizon: a linear ramp in height puts
    // most of the interesting band overhead, where nobody is looking.
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    float band = pow(clamp(1.0 - abs(dir.y), 0.0, 1.0), 3.0);
    vec3 col = mix(uHorizon, uZenith, smoothstep(0.5, 0.92, h));
    col = mix(col, uHorizon, band * 0.85);
    // Warm glow around the sun, widest at the horizon.
    float sun = max(dot(dir, uSunDir), 0.0);
    col += vec3(0.42, 0.30, 0.16) * pow(sun, 7.0);
    col += vec3(0.20, 0.14, 0.07) * pow(sun, 2.2) * band;
    // NO below-horizon darkening. An earlier version faded the dome to 55%
    // under dir.y = 0 on the reasoning that the ocean hides it anyway. It
    // does not: the ocean plane is 100 km wide, so from 900 m its far edge
    // sits about 1 degree BELOW eye level, and the strip of dome showing
    // through just under that edge was being darkened ~12% while the fogged
    // water beside it sat at exactly the fog colour. The result was a hard
    // grey seam along the whole horizon -- the visible fog line stage 1 says
    // to avoid, arriving from the sky rather than from the fog.
    //
    // Leaving the dome at the horizon colour below the horizon is what makes
    // the seam impossible rather than merely small: fogged water and open sky
    // converge on the same value from both sides.
    gl_FragColor = vec4(col, 1.0);
    ${LOGDEPTH_FRAG}
  }
`;

const OCEAN_VERT = /* glsl */ `
  #include <common>
  varying vec3 vWorld;
  ${LOGDEPTH_PARS_VERT}
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    // MUST be named mvPosition: <fog_vertex> below is a text include that
    // reads a variable of exactly that name out of the surrounding scope.
    // Calling it anything else compiles to "undeclared identifier" inside a
    // chunk this file never shows.
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    ${LOGDEPTH_VERT}
  }
`;

// The ocean is the only thing on screen in stage 1, and a flat colour plane
// gives a player NO sense of motion -- at 900 m over featureless water you
// cannot tell 110 m/s from 250 m/s, which makes the throttle unlearnable.
// So the surface carries procedural swell whose scale is chosen to be legible
// at speed, and it fades out with distance because detail that small aliases
// into noise past a few kilometres and the fog is doing the work by then.
const OCEAN_FRAG = /* glsl */ `
  #include <common>
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSunDir;
  uniform vec3 uHorizon;
  varying vec3 vWorld;
  ${LOGDEPTH_PARS_FRAG}
  #include <fog_pars_fragment>

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    vec2 p = vWorld.xz;
    float dist = length(vWorld - cameraPosition);
    // Detail dies off between 1.5 and 12 km; past that the fog owns the pixel.
    float detail = 1.0 - smoothstep(1500.0, 12000.0, dist);

    // Three octaves of swell drifting on a fixed wind bearing. Periods are in
    // metres: ~220 m primary swell, ~70 m secondary, ~24 m chop.
    vec2 wind = vec2(0.78, 0.62);
    float s = 0.0;
    s += vnoise(p / 220.0 + wind * uTime * 0.020) * 0.55;
    s += vnoise(p / 70.0  - wind * uTime * 0.055) * 0.30;
    s += vnoise(p / 24.0  + wind * uTime * 0.130) * 0.15;
    s = (s - 0.5) * detail;

    vec3 col = mix(uDeep, uShallow, clamp(s * 1.6 + 0.5, 0.0, 1.0));

    // A cheap normal from the swell gradient, enough for a moving glint.
    float e = 3.0;
    float gx = vnoise((p + vec2(e, 0.0)) / 70.0) - vnoise((p - vec2(e, 0.0)) / 70.0);
    float gz = vnoise((p + vec2(0.0, e)) / 70.0) - vnoise((p - vec2(0.0, e)) / 70.0);
    vec3 n = normalize(vec3(-gx * detail * 6.0, 1.0, -gz * detail * 6.0));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 halfV = normalize(viewDir + uSunDir);
    float spec = pow(max(dot(n, halfV), 0.0), 90.0);
    col += vec3(1.0, 0.93, 0.78) * spec * 0.9 * detail;

    // Grazing angles pick up the sky rather than the water.
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 4.0);
    col = mix(col, uHorizon, fres * 0.75);

    gl_FragColor = vec4(col, 1.0);
    ${LOGDEPTH_FRAG}
    #include <fog_fragment>
  }
`;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // Required, not optional. Near 0.5 with a 120 km far plane has nowhere
    // near enough integer precision for both a 19 m airframe at 24 m and a
    // coastline 25 km out; without this the whole scene z-fights. §5.
    logarithmicDepthBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const horizon = new THREE.Color(HORIZON_COLOR);
  scene.fog = new THREE.FogExp2(horizon.getHex(), FOG_DENSITY);
  scene.background = horizon;

  const camera = new THREE.PerspectiveCamera(
    59,
    1,
    CAMERA_NEAR,
    CAMERA_FAR,
  );

  // ── sky ──────────────────────────────────────────────────────────────────
  // Inside the far plane so it is never clipped, and unfogged: fog on the
  // dome would flatten the gradient to one colour.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(CAMERA_FAR * 0.42, 32, 20),
    new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(ZENITH_COLOR) },
        uHorizon: { value: horizon.clone() },
        uSunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  // ── ocean ────────────────────────────────────────────────────────────────
  const oceanUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(OCEAN_DEEP) },
      uShallow: { value: new THREE.Color(OCEAN_SHALLOW) },
      uSunDir: { value: SUN_DIR.clone() },
      uHorizon: { value: horizon.clone() },
    },
  ]);
  const oceanMat = new THREE.ShaderMaterial({
    uniforms: oceanUniforms,
    vertexShader: OCEAN_VERT,
    fragmentShader: OCEAN_FRAG,
    fog: true,
  });
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(OCEAN_EXTENT, OCEAN_EXTENT, 1, 1),
    oceanMat,
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.frustumCulled = false;
  scene.add(ocean);

  // ── lighting ─────────────────────────────────────────────────────────────
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(HORIZON_COLOR, OCEAN_DEEP, 1.15));

  function resize() {
    const w = canvas.clientWidth || globalThis.innerWidth || 1;
    const h = canvas.clientHeight || globalThis.innerHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function update(dt, state) {
    oceanMat.uniforms.uTime.value += dt;
    // Keep the sky and the ocean centred on the player. The ocean is 100 km
    // and the world is 30 km, so this never shows an edge, and it means
    // neither has to be large enough to cover the whole flyable area.
    if (state) {
      sky.position.copy(camera.position);
      ocean.position.x = state.position.x;
      ocean.position.z = state.position.z;
    }
  }

  return {
    renderer,
    scene,
    camera,
    ocean,
    sky,
    sun,
    resize,
    update,
    render: () => renderer.render(scene, camera),
  };
}

// ── terrain (stage 3) ──────────────────────────────────────────────────────

export const TERRAIN_ACROSS = 30000; // 30 km, §5
export const TERRAIN_PEAK = 643;  // §5, the target for the vertical scale
export const COASTLINE_Z = -7600; // where the measured near edge is placed
const TERRAIN_URL = "./models/terrain/scene.gltf";

/**
 * Load the heightfield, normalise it from measured bounds, and position it so
 * its MEASURED coastline lands on COASTLINE_Z.
 *
 * §5: nothing hardcodes a world coordinate. -7600 is where the coast is *put*,
 * not where the mesh happens to end -- the mesh carries seabed well past the
 * waterline, so the bounding-box edge is not the coast. The report publishes
 * what was actually measured, because the mission route, the SAM placement and
 * the distance-to-coast readout all derive from it.
 */
export async function loadTerrain(scene) {
  const report = {
    ok: false,
    nearEdgeZ: COASTLINE_Z,
    across: TERRAIN_ACROSS,
    peakAboveSea: 0,
    verticalRange: 0,
    triangles: 0,
  };

  let gltf;
  try {
    gltf = await loadGLTF(TERRAIN_URL);
  } catch (err) {
    recordFailure("terrain", err && err.message ? err.message : err);
    console.warn("terrain missing -- the game stays playable over open water");
    return { report, group: null };
  }

  const model = gltf.scene;
  // Already Y-up with its long axis on Z (verified by composing the file's
  // node matrices, not by reading raw accessors -- that mistake is what made
  // the F-15 fly knife-edge). So no orientation correction, and the axis that
  // gets normalised is the longest horizontal one.
  //
  // recentre "xz", NOT "xyz": this mesh carries real bathymetry, and its own
  // y = 0 is sea level. Sliding that to the middle of the bounding box put
  // the shoreline 321 m up a hillside and made the coast measurement below
  // meaningless -- the samples then reported "land" three kilometres out to
  // sea and every number after it was quietly wrong.
  const norm = normalise(model, {
    targetLength: TERRAIN_ACROSS,
    axis: "z",
    recentre: "xz",
  });
  if (!norm.ok) {
    recordFailure("terrain", norm.reason);
    return { report, group: null };
  }

  // The vertical scale is SEPARATE, and measured rather than typed.
  //
  // §5 asks for three things at once -- 30 km across, ~643 m peak above sea,
  // ~2595 m total range -- and this asset cannot give all three under one
  // uniform factor: shrinking Ireland's 486 km to 30 km also flattens its
  // relief by the same 16x, leaving a 292 m peak and terrain with nothing to
  // hide behind. Relief is not decoration here: §13's whole SAM mechanic is
  // line-of-sight, and §10 surveys the route by looking for passes between
  // flanks. So the horizontal scale comes from the 30 km target and the
  // vertical from the 643 m one, each measured against what the mesh actually
  // is. The ratio is reported, not assumed.
  const peakBefore = norm.box.max.y;
  const verticalScale = peakBefore > 0 ? TERRAIN_PEAK / peakBefore : 1;
  model.scale.y *= verticalScale;
  model.updateWorldMatrix(true, true);

  // Collect world-space triangles once. They are needed for the coastline
  // measurement here and for the grid index in physics.js, and walking the
  // geometry twice would double the only expensive part of the load.
  model.updateWorldMatrix(true, true);
  const tris = collectTriangles(norm.holder);
  report.triangles = tris.length / 9;

  // Sea level is the model's own y = 0. Measure the coast as the largest z at
  // which the surface is still above water -- NOT the bounding-box edge.
  let coastZ = -Infinity;
  let peak = -Infinity;
  let lowest = Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const y = tris[i + 1];
    const z = tris[i + 2];
    if (y > peak) peak = y;
    if (y < lowest) lowest = y;
    if (y >= 0 && z > coastZ) coastZ = z;
  }
  if (!(coastZ > -Infinity)) coastZ = norm.box.max.z;

  const shiftZ = COASTLINE_Z - coastZ;
  norm.holder.position.z += shiftZ;
  for (let i = 2; i < tris.length; i += 3) tris[i] += shiftZ;

  report.ok = true;
  report.nearEdgeZ = COASTLINE_Z;
  report.measuredCoastZ = coastZ;
  report.shiftZ = shiftZ;
  report.peakAboveSea = peak;
  report.seabed = lowest;
  report.verticalRange = peak - lowest;
  report.extent = { x: norm.size.x, y: norm.size.y * verticalScale, z: norm.size.z };
  report.scale = norm.scale;
  report.verticalScale = verticalScale;
  report.exaggeration = verticalScale;

  scene.add(norm.holder);

  console.log(
    `terrain: ${report.triangles.toLocaleString()} tris, ` +
      `${(norm.size.x / 1000).toFixed(1)} x ${(norm.size.z / 1000).toFixed(1)} km, ` +
      `peak ${peak.toFixed(0)} m above sea, seabed ${lowest.toFixed(0)} m, ` +
      `range ${report.verticalRange.toFixed(0)} m`,
  );
  console.log(
    `terrain scale: horizontal ${norm.scale.toExponential(3)} from the 30 km ` +
      `target, vertical x${verticalScale.toFixed(2)} on top of it from the ` +
      `${TERRAIN_PEAK} m peak target (peak measured ${peakBefore.toFixed(0)} m before)`,
  );
  console.log(
    `terrain: coast measured at z=${coastZ.toFixed(0)}, shifted ${shiftZ.toFixed(0)} m ` +
      `to put it on z=${COASTLINE_Z}`,
  );
  // §5 also quotes ~2595 m total range. That is NOT the target here -- the
  // peak is -- so say plainly where the asset lands rather than letting a
  // quiet mismatch turn into "the SAM ridges are wrong" three stages later.
  if (Math.abs(report.verticalRange - 2595) > 400) {
    console.warn(
      `terrain: total range ${report.verticalRange.toFixed(0)} m against the ` +
        `~2595 m §5 quotes. The peak is on target at ${peak.toFixed(0)} m; the ` +
        `difference is all bathymetry, which nothing in the game can reach.`,
    );
  }

  return { report, group: norm.holder, triangles: tris };
}

/** Every triangle of an object as a flat world-space Float32Array (9 per tri). */
export function collectTriangles(root) {
  const out = [];
  const v = new THREE.Vector3();
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geom = node.geometry;
    const pos = geom.attributes.position;
    if (!pos) return;
    const index = geom.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i++) {
      const vi = index ? index.getX(i) : i;
      v.fromBufferAttribute(pos, vi).applyMatrix4(node.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return new Float32Array(out);
}

// A stand-in airframe for stage 1, superseded by the normalised F-15E glTF in
// stage 2. Deliberately 19.4 m long -- the same length the real asset is
// normalised to -- so the camera standoff and framing tuned against it do not
// all have to be re-tuned when the model arrives.
export function createPlaceholderAircraft() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.0, 19.4),
    new THREE.MeshStandardMaterial({ color: 0x6d7683, roughness: 0.55, metalness: 0.4 }),
  );
  group.add(body);
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(13.05, 0.5, 4.2),
    new THREE.MeshStandardMaterial({ color: 0x5a636f, roughness: 0.6, metalness: 0.4 }),
  );
  wing.position.z = 1.2;
  group.add(wing);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(5.4, 0.45, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x5a636f, roughness: 0.6, metalness: 0.4 }),
  );
  tail.position.set(0, 0.9, 8.2);
  group.add(tail);
  return group;
}
