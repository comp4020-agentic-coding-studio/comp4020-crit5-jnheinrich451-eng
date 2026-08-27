/**
 * Stage 04.7 — procedural crash presentation.
 *
 * Two seconds of destruction theatre between the damage event and the respawn.
 * Presentation only: it detects nothing, decides nothing, and cannot fail a
 * mission. The failure architecture from Stage 02.3 is unchanged —
 *
 *   PlayerDamageEvent / CollisionEvent  ->  MissionCheckpointResponse  ->  respawn
 *
 * — and this file hangs off the middle box. The response policy ALREADY had the
 * shape this stage needs: `trigger()` refuses re-entry, `hold` is a window before
 * anything moves, the restore happens at full black, and the fade back in hides
 * the teleport. So there is no new state machine here and no second definition of
 * "the player is dead" (§33): the policy's `hold` stage simply got longer, and
 * the crash renders against its clock.
 *
 * The cheat, stated plainly (§5): the F-15 does not break. It keeps flying, on
 * its own momentum, tumbling, while a fireball and a smoke trail grow around it.
 * At 200 m/s that reads as catastrophic damage, and it costs one quaternion and
 * four boxes instead of a fracture solver.
 *
 * Everything is pooled and every material is shared. A crash happens rarely, so
 * the budget is small on purpose: 4 debris, 22 sparks, 26 smoke puffs, 5
 * fireball elements.
 */
import * as THREE from "three";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

/** §1 — reuse the causes gameplay already publishes; do not invent a parallel set. */
export const CrashCause = { MISSILE: "MISSILE", TERRAIN: "TERRAIN", OCEAN: "OCEAN" };

/**
 * Map a failure reason string — the one the response policy already carries — to
 * a presentation variant. One place, so a new failure reason cannot silently get
 * the wrong explosion.
 */
export function causeFromReason(reason) {
  const r = String(reason || "").toUpperCase();
  if (r.includes("OCEAN")) return CrashCause.OCEAN;
  if (r.includes("TERRAIN")) return CrashCause.TERRAIN;
  return CrashCause.MISSILE;
}

export const CRASH = {
  /* §3 — the timeline, in seconds from impact. The fade is owned by the response
     policy; these are the beats before it. */
  flashAt: 0.03,
  fireballAt: 0.08,
  tumbleAt: 0.1,
  smokeFrom: 0.15,
  smokeUntil: 1.1,
  sparksAt: 0.25,
  /** §6 — the intact aircraft stays visible this long, then fades behind smoke. */
  aircraftVisible: 0.72,
  aircraftFade: 0.28,
  /**
   * §43 — water is the exception. An ocean crash must be hidden BEFORE it is
   * under the surface, and at 220 m/s that is a fraction of a second, so the
   * variant scales the visible window rather than bending the whole timeline.
   */
  oceanVisibleScale: 0.34,

  /* §7 — tumble, generated once at crash start and then constant (§12/§35). */
  tumbleRoll: [1.8, 4.2],
  tumblePitch: [0.5, 1.6],
  tumbleYaw: [0.3, 1.1],
  /** Ramped in over this long, so the aircraft does not snap into a spin. */
  tumbleRamp: 0.22,

  /* §8/§9 — momentum, then gravity. No aerodynamics. */
  gravity: 17,
  drag: 0.16,
  /** Cause-dependent impulse added to the inherited velocity. */
  missileKick: 26,
  groundKick: 12,
  /**
   * §43 — entering water pulls the aircraft DOWN, hard. Without it an ocean
   * crash drifted two metres in three quarters of a second, which reads as the
   * aircraft skating along the surface rather than going into it.
   */
  oceanPlunge: 34,

  /* §10 — impact flash. Short, and it does not leave a glowing ball behind. */
  flashLife: 0.13,
  flashSize: 42,
  flashGrowth: 3.4,

  /* §11 — the fireball. Compact: this is a fighter, not a warhead depot. */
  fireballCount: 5,
  fireballLife: [0.42, 0.78],
  fireballSize: [12, 26],
  fireballGrowth: [26, 52],
  fireballOffset: 9,

  /* §13 — sparks. */
  sparkCount: 22,
  sparkLife: [0.24, 0.78],
  sparkSpeed: [34, 96],
  sparkInherit: 0.42,
  sparkSize: 2.6,
  sparkGravity: 26,

  /* §15/§16 — smoke. The most important layer, and world-space by design. */
  smokeRate: 15,
  smokeLife: [0.9, 1.6],
  smokeSize: [9, 16],
  smokeGrowth: [16, 30],
  smokeInherit: 0.16,
  smokeRise: 5,
  smokeDrift: 5,

  /* §18/§20 — fake debris. */
  debrisCount: 4,
  debrisLife: [1.1, 1.9],
  debrisInherit: 0.72,
  debrisImpulse: [16, 42],
  debrisSpin: 7,
  debrisGravity: 19,
  debrisScale: [0.5, 1.5],

  /* §26 — camera. One strong kick with fast decay, not sustained shake (§28). */
  kick: 2.1,
  kickDecay: 5.5,
  /** §27 — the rig loosens for this long so the tumble is watchable. */
  followTime: 1.05,
  followDistance: 34,
  followHeight: 9,
  followLag: 0.34,

  /* §30 — screen flash. Brief; the player is not blinded. */
  screenFlash: 0.14,
};

/** §22/§23/§24 — the three variants, as data rather than three code paths. */
export const CRASH_VARIANT = {
  MISSILE: { fire: 1, smoke: 1, sparks: 1, debris: 1, mist: 0, screen: "rgba(255, 214, 150, 0.85)", forward: 1, sink: 0.55, visible: 1 },
  TERRAIN: { fire: 0.85, smoke: 1.25, sparks: 1.35, debris: 1.25, mist: 0.5, screen: "rgba(255, 196, 130, 0.8)", forward: 0.35, sink: 1, visible: 0.75 },
  // Water: white and grey rather than orange, and the aircraft goes UNDER fast
  // rather than skating along the surface (§43).
  OCEAN: { fire: 0.28, smoke: 0.7, sparks: 0.55, debris: 0.8, mist: 1.4, screen: "rgba(214, 236, 246, 0.7)", forward: 0.18, sink: 2.6, visible: 0.34 },
};

/* ---- pure helpers, so the interesting rules are testable ---- */

/** §7 — one tumble, generated at crash start. Bounded, and never near zero. */
export function makeTumble(cfg = CRASH, random = Math.random) {
  const sign = () => (random() < 0.5 ? -1 : 1);
  const pick = (r) => lerp(r[0], r[1], random());
  return {
    roll: sign() * pick(cfg.tumbleRoll),
    pitch: sign() * pick(cfg.tumblePitch),
    yaw: sign() * pick(cfg.tumbleYaw),
  };
}

/**
 * §6 — aircraft opacity across the crash: visible, then hidden behind smoke.
 * `scale` shortens the window for a variant that needs the aircraft gone sooner —
 * water, where it would otherwise be visible under the surface.
 */
export function aircraftOpacity(t, cfg = CRASH, scale = 1) {
  const visible = cfg.aircraftVisible * scale;
  const fade = cfg.aircraftFade * scale;
  if (t <= visible) return 1;
  return 1 - clamp01((t - visible) / fade);
}

/** §26 — kick amplitude: instant, then decaying. Never re-triggered. */
export function kickAmplitude(t, cfg = CRASH) {
  if (t < cfg.flashAt) return 0;
  return cfg.kick * Math.exp(-(t - cfg.flashAt) * cfg.kickDecay);
}

/** §30 — screen flash alpha. */
export function screenFlashAlpha(t, cfg = CRASH) {
  return t >= cfg.screenFlash ? 0 : 1 - t / cfg.screenFlash;
}

/**
 * §27 — how much the loose crash camera is mixed in. Rises immediately, holds,
 * then releases, so the rig is handed back rather than snapping.
 */
export function followBlend(t, cfg = CRASH) {
  if (t <= 0) return 0;
  if (t < 0.12) return t / 0.12;
  if (t < cfg.followTime) return 1;
  return Math.max(0, 1 - (t - cfg.followTime) / 0.3);
}

/* ---- textures: two canvases, shared by every particle ---- */

function radialTexture(stops) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param scene  crash entities live in WORLD space, not on the aircraft — the
 *   whole point of the smoke trail is that the aircraft leaves it behind (§15).
 */
export function createCrashFx({ scene, cfg = CRASH } = {}) {
  const state = {
    active: false,
    t: 0,
    cause: CrashCause.MISSILE,
    variant: CRASH_VARIANT.MISSILE,
    tumble: { roll: 0, pitch: 0, yaw: 0 },
    /** Live counts, for the developer rail. */
    sparks: 0,
    smoke: 0,
    debris: 0,
    fire: 0,
    screenAlpha: 0,
    shake: 0,
    crashes: 0,
    /**
     * Stage 04.7b — where the crash BEGAN and which way the aircraft was going.
     * The respawn is computed from these rather than from a stored checkpoint,
     * so it is always local to the thing that killed the player. The wreck's
     * final resting place is useless for this: it is underground.
     */
    origin: new THREE.Vector3(),
    heading: 0,
  };

  // The presentation-controlled aircraft transform. main.js copies this in while
  // a crash is running, exactly as it does for the launch script.
  const pose = { position: new THREE.Vector3(), quat: new THREE.Quaternion(), opacity: 1 };
  const velocity = new THREE.Vector3();

  if (!scene) {
    // Headless (tests): the rules still run, nothing is drawn.
    return headless(state, pose, velocity, cfg);
  }

  const fireTex = radialTexture([
    [0, "rgba(255,255,246,1)"],
    [0.18, "rgba(255,226,150,0.95)"],
    [0.46, "rgba(255,142,52,0.55)"],
    [1, "rgba(180,60,20,0)"],
  ]);
  const smokeTex = radialTexture([
    [0, "rgba(70,66,62,0.72)"],
    [0.5, "rgba(48,46,44,0.4)"],
    [1, "rgba(30,30,30,0)"],
  ]);
  const mistTex = radialTexture([
    [0, "rgba(255,255,255,0.9)"],
    [0.45, "rgba(226,238,244,0.5)"],
    [1, "rgba(210,226,236,0)"],
  ]);

  const root = new THREE.Object3D();
  root.name = "CrashFx";
  scene.add(root);

  // §19 — geometries and materials built once and reused for every crash.
  const debrisGeo = [
    new THREE.BoxGeometry(2.6, 0.28, 1.4),
    new THREE.BoxGeometry(1.1, 0.3, 3.1),
    new THREE.ConeGeometry(0.85, 2.6, 4),
    new THREE.BoxGeometry(1.6, 0.9, 0.9),
  ];
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.72, metalness: 0.55 });

  const sprite = (tex, blending) =>
    new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending, depthWrite: false, fog: false }));

  const pools = { fire: [], smoke: [], spark: [], debris: [] };
  const live = { fire: [], smoke: [], spark: [], debris: [] };

  function takeSprite(kind, tex, blending) {
    const spent = pools[kind].pop();
    if (spent) {
      spent.sprite.visible = true;
      return spent;
    }
    const s = sprite(tex, blending);
    s.frustumCulled = false;
    root.add(s);
    return { sprite: s, position: new THREE.Vector3(), velocity: new THREE.Vector3(), t: 0, life: 1, size: 1, growth: 0 };
  }

  function takeDebris() {
    const spent = pools.debris.pop();
    if (spent) {
      spent.mesh.visible = true;
      return spent;
    }
    const mesh = new THREE.Mesh(debrisGeo[0], debrisMat);
    mesh.frustumCulled = false;
    root.add(mesh);
    return { mesh, position: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, life: 1 };
  }

  function retire(kind, item) {
    (item.sprite || item.mesh).visible = false;
    pools[kind].push(item);
  }

  const _fireTexOf = () => (state.cause === CrashCause.OCEAN ? mistTex : fireTex);

  /**
   * §4 — the one entry point. Called once, by the failure policy, after gameplay
   * has already decided the player is destroyed.
   */
  function start({ cause = CrashCause.MISSILE, position, quat, velocity: vel, heading = 0, impactNormal = null } = {}) {
    state.active = true;
    state.t = 0;
    state.cause = cause;
    state.variant = CRASH_VARIANT[cause] || CRASH_VARIANT.MISSILE;
    state.crashes += 1;
    state.tumble = makeTumble(cfg);
    state.screenAlpha = 1;
    state.origin.copy(position);
    state.heading = heading;

    pose.position.copy(position);
    if (quat) pose.quat.copy(quat);
    pose.opacity = 1;

    // §8 — momentum is inherited, not invented. The aircraft does not stop.
    velocity.copy(vel || new THREE.Vector3());
    velocity.multiplyScalar(state.variant.forward);
    const kick = cause === CrashCause.MISSILE ? cfg.missileKick : cfg.groundKick;
    const n = impactNormal || { x: 0, y: 1, z: 0 };
    velocity.x += n.x * kick * rand(0.3, 1) + rand(-kick, kick) * 0.35;
    velocity.y += n.y * kick * rand(0.2, 0.7);
    velocity.z += n.z * kick * rand(0.3, 1) + rand(-kick, kick) * 0.35;
    // §43 — water drags it under instead of throwing it up.
    if (cause === CrashCause.OCEAN) velocity.y -= cfg.oceanPlunge;

    spawnFlash();
    spawnFireball();
    spawnSparks(impactNormal);
    spawnDebris();
    return state;
  }

  function spawnFlash() {
    const f = takeSprite("fire", _fireTexOf(), THREE.AdditiveBlending);
    f.position.copy(pose.position);
    f.velocity.set(0, 0, 0);
    f.t = -cfg.flashAt; // negative: it appears at flashAt, not instantly
    f.life = cfg.flashLife + cfg.flashAt;
    f.size = cfg.flashSize;
    f.growth = cfg.flashSize * cfg.flashGrowth;
    f.sprite.material.map = _fireTexOf();
    live.fire.push(f);
  }

  /** §11/§12 — variation generated ONCE, then it evolves smoothly. */
  function spawnFireball() {
    const n = Math.max(2, Math.round(cfg.fireballCount * state.variant.fire + 1));
    for (let i = 0; i < n; i++) {
      const f = takeSprite("fire", _fireTexOf(), state.cause === CrashCause.OCEAN ? THREE.NormalBlending : THREE.AdditiveBlending);
      f.position.copy(pose.position);
      f.position.x += rand(-cfg.fireballOffset, cfg.fireballOffset);
      f.position.y += rand(-cfg.fireballOffset, cfg.fireballOffset) * 0.6;
      f.position.z += rand(-cfg.fireballOffset, cfg.fireballOffset);
      // Ocean: the plume goes UP rather than outward, which is what makes a
      // splash read as water instead of as a small orange explosion.
      const up = state.cause === CrashCause.OCEAN ? rand(8, 26) : rand(-4, 10);
      f.velocity.set(rand(-6, 6), up, rand(-6, 6)).add(velocity.clone().multiplyScalar(0.12));
      f.t = -cfg.fireballAt;
      f.life = rand(cfg.fireballLife[0], cfg.fireballLife[1]) + cfg.fireballAt;
      f.size = rand(cfg.fireballSize[0], cfg.fireballSize[1]);
      f.growth = rand(cfg.fireballGrowth[0], cfg.fireballGrowth[1]);
      f.sprite.material.map = _fireTexOf();
      f.sprite.material.blending = state.cause === CrashCause.OCEAN ? THREE.NormalBlending : THREE.AdditiveBlending;
      live.fire.push(f);
    }
  }

  /** §13/§14 — outward from the impact, biased along the surface normal. */
  function spawnSparks(impactNormal) {
    const n = Math.round(cfg.sparkCount * state.variant.sparks);
    for (let i = 0; i < n; i++) {
      const s = takeSprite("spark", fireTex, THREE.AdditiveBlending);
      s.position.copy(pose.position);
      const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      if (impactNormal) dir.add(new THREE.Vector3(impactNormal.x, impactNormal.y, impactNormal.z).multiplyScalar(0.9)).normalize();
      s.velocity.copy(dir).multiplyScalar(rand(cfg.sparkSpeed[0], cfg.sparkSpeed[1])).add(velocity.clone().multiplyScalar(cfg.sparkInherit));
      s.t = -cfg.sparksAt * Math.random();
      s.life = rand(cfg.sparkLife[0], cfg.sparkLife[1]);
      s.size = cfg.sparkSize;
      s.growth = -cfg.sparkSize * 0.5;
      s.sprite.material.map = fireTex;
      s.sprite.material.blending = THREE.AdditiveBlending;
      live.spark.push(s);
    }
  }

  /** §18/§20 — a few fake fragments, from the pre-built geometry. */
  function spawnDebris() {
    const n = Math.max(2, Math.round(cfg.debrisCount * state.variant.debris));
    for (let i = 0; i < n; i++) {
      const d = takeDebris();
      d.mesh.geometry = debrisGeo[i % debrisGeo.length];
      const k = rand(cfg.debrisScale[0], cfg.debrisScale[1]);
      d.mesh.scale.setScalar(k);
      d.position.copy(pose.position).add(new THREE.Vector3(rand(-4, 4), rand(-3, 3), rand(-4, 4)));
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize();
      d.velocity
        .copy(velocity)
        .multiplyScalar(cfg.debrisInherit)
        .add(dir.multiplyScalar(rand(cfg.debrisImpulse[0], cfg.debrisImpulse[1])));
      d.spin.set(rand(-cfg.debrisSpin, cfg.debrisSpin), rand(-cfg.debrisSpin, cfg.debrisSpin), rand(-cfg.debrisSpin, cfg.debrisSpin));
      d.mesh.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      d.t = 0;
      d.life = rand(cfg.debrisLife[0], cfg.debrisLife[1]);
      live.debris.push(d);
    }
  }

  /** §16 — puffs spawn at the aircraft and stay put; the aircraft flies away. */
  let smokeAccum = 0;
  function emitSmoke(dt) {
    if (state.t < cfg.smokeFrom || state.t > cfg.smokeUntil) return;
    const rate = cfg.smokeRate * state.variant.smoke;
    smokeAccum += dt * rate;
    while (smokeAccum >= 1) {
      smokeAccum -= 1;
      const ocean = state.cause === CrashCause.OCEAN;
      const s = takeSprite("smoke", ocean ? mistTex : smokeTex, THREE.NormalBlending);
      s.position.copy(pose.position).add(new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)));
      s.velocity
        .copy(velocity)
        .multiplyScalar(cfg.smokeInherit)
        .add(new THREE.Vector3(rand(-cfg.smokeDrift, cfg.smokeDrift), rand(0, cfg.smokeRise), rand(-cfg.smokeDrift, cfg.smokeDrift)));
      s.t = 0;
      s.life = rand(cfg.smokeLife[0], cfg.smokeLife[1]);
      s.size = rand(cfg.smokeSize[0], cfg.smokeSize[1]);
      s.growth = rand(cfg.smokeGrowth[0], cfg.smokeGrowth[1]);
      s.sprite.material.map = ocean ? mistTex : smokeTex;
      s.sprite.material.blending = THREE.NormalBlending;
      live.smoke.push(s);
    }
  }

  function stepSprites(list, kind, dt, gravity, dragK) {
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.t += dt;
      if (s.t >= s.life) {
        retire(kind, s);
        list.splice(i, 1);
        continue;
      }
      if (s.t < 0) {
        // Not yet born: staged by a negative clock so the layers arrive in order.
        s.sprite.material.opacity = 0;
        continue;
      }
      if (gravity) s.velocity.y -= gravity * dt;
      if (dragK) s.velocity.multiplyScalar(Math.max(0, 1 - dragK * dt));
      s.position.addScaledVector(s.velocity, dt);
      const age = clamp01(s.t / s.life);
      s.sprite.position.copy(s.position);
      s.sprite.scale.setScalar(Math.max(0.5, s.size + s.growth * age));
      // Smoke thickens then thins; fire and sparks only decay.
      s.sprite.material.opacity = kind === "smoke" ? Math.sin(age * Math.PI) * 0.85 : (1 - age) * (1 - age);
    }
  }

  function update(dt) {
    if (!state.active) {
      // Entities already in the air finish on their own after the crash ends.
      stepSprites(live.fire, "fire", dt, 0, 1.1);
      stepSprites(live.smoke, "smoke", dt, 0, 0.5);
      stepSprites(live.spark, "spark", dt, cfg.sparkGravity, 1.4);
      stepDebris(dt);
      publish();
      return state;
    }
    state.t += dt;

    // §9 — momentum, gravity, a little drag. No aerodynamics.
    velocity.y -= cfg.gravity * state.variant.sink * dt;
    velocity.multiplyScalar(Math.max(0, 1 - cfg.drag * dt));
    pose.position.addScaledVector(velocity, dt);

    // §7 — the tumble, ramped in and then constant. One quaternion, no random
    // per-frame rotation, and it works from whatever attitude the aircraft had
    // (§45) because it is applied as a local delta.
    const ramp = clamp01((state.t - cfg.tumbleAt) / cfg.tumbleRamp);
    if (ramp > 0) {
      const e = new THREE.Euler(state.tumble.pitch * ramp * dt, state.tumble.yaw * ramp * dt, state.tumble.roll * ramp * dt, "YXZ");
      pose.quat.multiply(new THREE.Quaternion().setFromEuler(e));
    }

    pose.opacity = aircraftOpacity(state.t, cfg, state.variant.visible);
    state.shake = kickAmplitude(state.t, cfg);
    state.screenAlpha = screenFlashAlpha(state.t, cfg);

    emitSmoke(dt);
    stepSprites(live.fire, "fire", dt, 0, 1.1);
    stepSprites(live.smoke, "smoke", dt, 0, 0.5);
    stepSprites(live.spark, "spark", dt, cfg.sparkGravity, 1.4);
    stepDebris(dt);
    publish();
    return state;
  }

  function stepDebris(dt) {
    for (let i = live.debris.length - 1; i >= 0; i--) {
      const d = live.debris[i];
      d.t += dt;
      if (d.t >= d.life) {
        retire("debris", d);
        live.debris.splice(i, 1);
        continue;
      }
      d.velocity.y -= cfg.debrisGravity * dt;
      d.velocity.multiplyScalar(Math.max(0, 1 - 0.22 * dt));
      d.position.addScaledVector(d.velocity, dt);
      d.mesh.position.copy(d.position);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
    }
  }

  function publish() {
    state.fire = live.fire.length;
    state.smoke = live.smoke.length;
    state.sparks = live.spark.length;
    state.debris = live.debris.length;
  }

  /** §31 — the crash is over; the fade is black. Stop driving the aircraft. */
  function finish() {
    state.active = false;
    state.shake = 0;
    state.screenAlpha = 0;
    pose.opacity = 1;
    return state;
  }

  /** §47 — nothing of the old crash survives into the new life. */
  function reset() {
    finish();
    for (const kind of ["fire", "smoke", "spark"]) {
      for (const s of live[kind]) retire(kind, s);
      live[kind].length = 0;
    }
    for (const d of live.debris) retire("debris", d);
    live.debris.length = 0;
    smokeAccum = 0;
    state.t = 0;
    publish();
    return state;
  }

  return {
    state,
    pose,
    velocity,
    cfg,
    start,
    update,
    finish,
    reset,
    get followBlend() {
      return state.active ? followBlend(state.t, cfg) : 0;
    },
    get liveCount() {
      return live.fire.length + live.smoke.length + live.spark.length + live.debris.length;
    },
  };
}

/**
 * Headless double: the rules, none of the rendering.
 *
 * It shares `start`/`update`/`finish`/`reset` SEMANTICS with the real system,
 * not just their names — the first version forgot to restore `pose.opacity` in
 * `finish()`, and a double that diverges from the thing it stands in for tests
 * nothing. Anything the real implementation guarantees about state must be
 * guaranteed here too; only the drawing is absent.
 */
function headless(state, pose, velocity, cfg) {
  const api = {
    state,
    pose,
    velocity,
    cfg,
    start({ cause = CrashCause.MISSILE, position, quat, velocity: vel, heading = 0 } = {}) {
      state.active = true;
      state.t = 0;
      state.cause = cause;
      state.variant = CRASH_VARIANT[cause] || CRASH_VARIANT.MISSILE;
      state.crashes += 1;
      state.tumble = makeTumble(cfg);
      state.screenAlpha = 1;
      state.heading = heading;
      if (position) {
        pose.position.copy(position);
        state.origin.copy(position);
      }
      if (quat) pose.quat.copy(quat);
      pose.opacity = 1;
      velocity.copy(vel || { x: 0, y: 0, z: 0 });
      velocity.multiplyScalar(state.variant.forward);
      if (cause === CrashCause.OCEAN) velocity.y -= cfg.oceanPlunge;
      return state;
    },    update(dt) {
      if (!state.active) return state;
      state.t += dt;
      velocity.y -= cfg.gravity * state.variant.sink * dt;
      velocity.multiplyScalar(Math.max(0, 1 - cfg.drag * dt));
      pose.position.addScaledVector(velocity, dt);
      pose.opacity = aircraftOpacity(state.t, cfg, state.variant.visible);
      state.shake = kickAmplitude(state.t, cfg);
      state.screenAlpha = screenFlashAlpha(state.t, cfg);
      return state;
    },
    finish() {
      state.active = false;
      state.shake = 0;
      state.screenAlpha = 0;
      pose.opacity = 1;
      return state;
    },
    reset() {
      api.finish();
      state.t = 0;
      return state;
    },
    get followBlend() {
      return state.active ? followBlend(state.t, cfg) : 0;
    },
    get liveCount() {
      return 0;
    },
  };
  return api;
}
