// Scene, ocean, sky, fog, lighting. CLAUDE.md §5, stage 1.
//
// 1 world unit = 1 metre, everywhere, with no exceptions. Stage 2 onward
// normalises every glTF asset from its MEASURED bounds to a real length, so
// this is the only place the scale of the world is decided.

import * as THREE from "three";

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
