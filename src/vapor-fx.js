/**
 * Stage 03.15 — air-moisture FX: wingtip vortices and body condensation silk.
 *
 * Both are driven by one simplified atmospheric model (§18): moisture from the
 * atmosphere system, load from the aircraft's own maneuvering. Neither is ever
 * on in calm cruise, and neither writes to the flight model — load is *derived*
 * from bank, stick and pitch rate, not read from a physics field that does not
 * exist.
 */
import * as THREE from "three";

export const VAPOR = {
  /**
   * Wingtip anchors in AircraftRoot space, measured AT the anchor's own spanwise
   * station (§15). The tip is tapered, so quoting the z-extent of a `|x| > t`
   * band says nothing about where the wing surface is at x = 6.5 — two earlier
   * passes did exactly that and landed z 4.95 then 4.82, both in free air behind
   * the wing. Slicing at |x| > 6.45 gives the tip chord as z 4.04–4.53, so the
   * trailing edge is 4.53 and the anchor sits just inside it at 4.50. (The first
   * pass's z 4.25 was mid-chord, i.e. inside solid wing, which left the ribbon
   * emerging from geometry and occluded from most angles.)
   */
  wingtips: [
    { name: "WingtipLeftFx", side: -1, position: new THREE.Vector3(-6.45, -0.35, 4.5) },
    { name: "WingtipRightFx", side: 1, position: new THREE.Vector3(6.45, -0.35, 4.5) },
  ],
  // The tip chord at that station, kept next to the anchors so the test asserts
  // against a measurement rather than a literal that drifts out of step.
  tipStation: { x: 6.45, zLead: 4.04, zTrail: 4.53 },

  /**
   * Body/canopy silk anchors. Plausible placement, not aerodynamics (§17):
   * intake shoulders sit at |x| ~2.0 around z -2.6, the canopy peaks at
   * y 1.09 / z -4.04.
   */
  silk: [
    { name: "IntakeLeftFx", position: new THREE.Vector3(-2.05, 0.15, -2.4), scale: 2.4 },
    { name: "IntakeRightFx", position: new THREE.Vector3(2.05, 0.15, -2.4), scale: 2.4 },
    { name: "CanopyVaporFx", position: new THREE.Vector3(0, 0.95, -3.1), scale: 2.9 },
    { name: "WingRootLeftFx", position: new THREE.Vector3(-2.6, 0.05, 1.4), scale: 2.2 },
    { name: "WingRootRightFx", position: new THREE.Vector3(2.6, 0.05, 1.4), scale: 2.2 },
  ],

  // --- trigger model ---
  humidityThreshold: 0.28, // below this, no vapor at any humidity
  // Humidity at which the moisture factor is already full. This is the halo
  // value, NOT 1.0: normalizing over threshold→1 meant a genuine halo skim at
  // humidity 0.45 produced h ≈ 0.09 — invisible — so the only apparent lever was
  // widening the halo until the whole corridor was wet (§16). Saturating at the
  // halo instead makes a skim read at full strength and leaves how much of the
  // world is humid alone. Must track ATMOS.proximityHumidity; a test asserts it.
  humiditySaturate: 0.62,
  loadThreshold: 0.34, // below this, no vapor at any load
  bankLoadDeg: 62, // bank angle that alone counts as full load
  pitchRateLoad: 26, // deg/s of pitch change that counts as full load
  stickLoad: 0.85, // stick deflection that counts as full load

  vortexRise: 3.2, // 1/s fade in
  vortexFall: 1.5, // 1/s fade out — vapor lingers a beat, it does not blink off
  silkRise: 2.4,
  silkFall: 2.0,
  // Silk needs more provocation than the wingtips: it is the rarer accent (§15).
  silkBias: 0.62,

  ribbonPoints: 26,
  ribbonWidth: 0.5,
  ribbonWidthGrowth: 2.6, // the ribbon smears wider as it ages
  // Below this the ribbon is not drawn at all, so a stale strip cannot linger.
  minVisible: 0.02,
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Maneuver load in 0..1 from what the flight model actually publishes. Pure.
 *
 * The flight model has no AoA or G-load field and this stage is not allowed to
 * add one, so load is the strongest of three honest proxies: how hard the wing
 * is banked, how fast the nose is moving, and how hard the stick is deflected.
 * Stick is included so the very start of a pull registers before bank builds.
 */
export function maneuverLoad({ bankDeg = 0, pitchRateDeg = 0, stickX = 0, stickY = 0 }, cfg = VAPOR) {
  const bank = clamp01(Math.abs(bankDeg) / cfg.bankLoadDeg);
  const rate = clamp01(Math.abs(pitchRateDeg) / cfg.pitchRateLoad);
  const stick = clamp01(Math.hypot(stickX, stickY) / cfg.stickLoad);
  return Math.max(bank, rate, stick * 0.8);
}

/**
 * Vapor intensity from moisture and load (§18). Pure. Both factors are gated:
 * dry air produces nothing however hard the turn, and calm flight produces
 * nothing however wet the air — which is what keeps the effect an event. The
 * moisture factor saturates at `humiditySaturate` (the near-cloud halo), so
 * being in moist air at all is enough; it does not require cloud interior.
 */
export function vaporIntensity(humidity, load, cfg = VAPOR) {
  if (humidity <= cfg.humidityThreshold || load <= cfg.loadThreshold) return 0;
  const h = smooth(clamp01((humidity - cfg.humidityThreshold) / (cfg.humiditySaturate - cfg.humidityThreshold)));
  const l = smooth(clamp01((load - cfg.loadThreshold) / (1 - cfg.loadThreshold)));
  return h * l;
}

/** Asymmetric approach: rises at `rise`, decays at `fall`. Pure. */
export function approach(current, target, rise, fall, dt) {
  const k = target > current ? rise : fall;
  return current + (target - current) * (1 - Math.exp(-k * dt));
}

function vaporTexture(soft = 0.55) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(255,255,255,${soft})`);
  grad.addColorStop(0.45, `rgba(240,247,255,${soft * 0.42})`);
  grad.addColorStop(1, "rgba(226,238,250,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A camera-facing ribbon trailing one wingtip. World-space points, rebuilt each
 * frame into a triangle strip — one mesh and one buffer per wing, no particles.
 */
function createRibbon(scene, cfg) {
  const n = cfg.ribbonPoints;
  const positions = new Float32Array(n * 2 * 3);
  const alphas = new Float32Array(n * 2);
  const indices = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
  geo.setIndex(indices);

  // A tiny ShaderMaterial rather than a texture: the whole look is a soft
  // along-length alpha falloff, which is one line in a fragment shader and
  // needs no image decode.
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * uOpacity);
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  const trail = [];
  for (let i = 0; i < n; i++) trail.push(new THREE.Vector3());
  return { mesh, geo, positions, alphas, mat, trail, filled: false };
}

/**
 * AircraftRoot
 *  |- VaporFx
 *      |- WingtipLeftFx | WingtipRightFx     (ribbon emitters, world-space)
 *      |- IntakeLeftFx | IntakeRightFx | CanopyVaporFx | WingRoot*Fx  (silk)
 */
export function createVaporFx(aircraftRoot, scene, cfg = VAPOR) {
  const group = new THREE.Object3D();
  group.name = "VaporFx";

  const wingtips = cfg.wingtips.map((w) => {
    const anchor = new THREE.Object3D();
    anchor.name = w.name;
    anchor.position.copy(w.position);
    anchor.userData.side = w.side;
    group.add(anchor);
    // The ribbon lives in the SCENE, not on the anchor: a trail that inherited
    // the aircraft transform would rotate with the jet instead of being left
    // behind in the air.
    return { anchor, ribbon: createRibbon(scene, cfg) };
  });

  const silkTex = vaporTexture(0.5);
  const silk = cfg.silk.map((s) => {
    const anchor = new THREE.Object3D();
    anchor.name = s.name;
    anchor.position.copy(s.position);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: silkTex, transparent: true, opacity: 0, depthWrite: false, fog: true })
    );
    sprite.scale.setScalar(s.scale);
    anchor.add(sprite);
    group.add(anchor);
    return { anchor, sprite, base: s.scale, phase: Math.random() * Math.PI * 2 };
  });

  aircraftRoot.add(group);

  let time = 0;
  const state = { vortex: 0, silk: 0, load: 0, humidity: 0, target: 0 };
  const _w = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _side = new THREE.Vector3();
  const _cam = new THREE.Vector3();

  /**
   * @param ctx { camera, humidity, bankDeg, pitchRateDeg, stickX, stickY }
   */
  function update(ctx, dt) {
    time += dt;
    const load = maneuverLoad(ctx, cfg);
    const target = vaporIntensity(ctx.humidity, load, cfg);
    state.load = load;
    state.humidity = ctx.humidity;
    state.target = target;
    state.vortex = approach(state.vortex, target, cfg.vortexRise, cfg.vortexFall, dt);
    // Silk asks for more than the wingtips before it shows at all.
    state.silk = approach(state.silk, Math.max(0, (target - cfg.silkBias) / (1 - cfg.silkBias)), cfg.silkRise, cfg.silkFall, dt);

    /* ---- wingtip ribbons ---- */
    for (const w of wingtips) {
      const r = w.ribbon;
      w.anchor.getWorldPosition(_w);
      if (!r.filled) {
        for (const p of r.trail) p.copy(_w);
        r.filled = true;
      } else {
        for (let i = 0; i < r.trail.length - 1; i++) r.trail[i].copy(r.trail[i + 1]);
        r.trail[r.trail.length - 1].copy(_w);
      }

      const vis = state.vortex > cfg.minVisible;
      r.mesh.visible = vis;
      if (!vis) continue;

      _cam.copy(ctx.camera.position);
      const n = r.trail.length;
      for (let i = 0; i < n; i++) {
        const p = r.trail[i];
        // Ribbon width faces the camera and widens with age, so the trail reads
        // as vapor smearing out rather than a flat ribbon of constant size.
        const next = r.trail[Math.min(n - 1, i + 1)];
        const prev = r.trail[Math.max(0, i - 1)];
        _dir.subVectors(next, prev);
        if (_dir.lengthSq() < 1e-9) _dir.set(0, 0, 1);
        _side.subVectors(p, _cam).cross(_dir).normalize();
        const age = 1 - i / (n - 1); // 0 at the wingtip, 1 at the oldest point
        const half = cfg.ribbonWidth * (1 + age * cfg.ribbonWidthGrowth) * 0.5;
        const o = i * 6;
        r.positions[o] = p.x + _side.x * half;
        r.positions[o + 1] = p.y + _side.y * half;
        r.positions[o + 2] = p.z + _side.z * half;
        r.positions[o + 3] = p.x - _side.x * half;
        r.positions[o + 4] = p.y - _side.y * half;
        r.positions[o + 5] = p.z - _side.z * half;
        // Fades at both ends: no hard start at the wing, no cut tail.
        const a = Math.pow(1 - age, 0.65) * Math.min(1, (1 - age) * 8 + 0.15) * (1 - Math.pow(age, 3));
        r.alphas[i * 2] = r.alphas[i * 2 + 1] = a;
      }
      r.geo.attributes.position.needsUpdate = true;
      r.geo.attributes.aAlpha.needsUpdate = true;
      r.mat.uniforms.uOpacity.value = state.vortex * 0.72;
    }

    /* ---- body silk ---- */
    const s = state.silk;
    for (const item of silk) {
      item.sprite.material.opacity = s * 0.5;
      // Slow independent breathing per patch: the sheets should not pulse in
      // unison, which would read as a blinking light rather than condensation.
      const breathe = 1 + 0.22 * Math.sin(time * 1.7 + item.phase);
      item.sprite.scale.setScalar(item.base * (0.7 + 0.5 * s) * breathe);
      item.sprite.visible = s > 0.01;
    }
  }

  /** Collapses the trails onto the wingtips so a reset leaves no streak. */
  function reset() {
    state.vortex = state.silk = 0;
    for (const w of wingtips) {
      w.ribbon.filled = false;
      w.ribbon.mesh.visible = false;
      w.ribbon.mat.uniforms.uOpacity.value = 0;
    }
    for (const item of silk) {
      item.sprite.material.opacity = 0;
      item.sprite.visible = false;
    }
  }

  return { group, wingtips, silk, state, update, reset, cfg };
}
