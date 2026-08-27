/**
 * Stage 03.2 — internal cannon.
 *
 * Gameplay is hitscan, visuals are occasional tracers (§6): a 20 mm burst at a
 * believable rate would be hundreds of meshes per second, and none of them
 * would be what decides a hit. So the ray decides the hit and the tracers only
 * say which way the rounds went.
 *
 * The muzzle is not a coordinate in here — it is an Object3D handed in from
 * weapons.js, the same contract missile.js uses for a launch rail (§5).
 */
import * as THREE from "three";

export const GUN = {
  ammo: 500,

  /**
   * Gameplay fire rate, not the M61's 6000 rpm. 48 simulated rounds per second
   * still reads as a cannon buzz and makes the 500-round magazine ~10 s of
   * continuous fire, which is a playtestable amount of ammunition; at a true
   * 100 rps the whole belt is gone in five seconds (§8).
   */
  shotsPerSecond: 48,
  // A tracer every Nth simulated round: ~8/s, enough to read a direction
  // without a wall of lines (§21).
  tracerEvery: 6,
  // Impact sparks are rarer still — every hit spawning a sprite turns a burst
  // into a solid flash (§25).
  sparkEvery: 3,

  /**
   * Used for lead prediction only — no round object ever travels at it (§14).
   * 1000 m/s is close to real 20 mm muzzle velocity in the world's own units.
   */
  projectileSpeed: 1000,
  // Cap on predicted flight time, so a target at extreme range cannot throw the
  // pipper into the next county.
  maxLeadTime: 2.0,

  // Range roles (§9): full effect inside best, tapering to nothing at max.
  bestRange: 800,
  maxRange: 1200,

  // Health per hit at full effect. 100 HP / 2.4 ≈ 42 hits ≈ 0.87 s of rounds
  // ON the target — bursts accumulate, one snapshot does not kill (§25).
  damagePerHit: 2.4,

  // Forgiving but not silly: the drone is 9.2 m long, so its own radius is 4.6.
  hitRadius: 7,
  // Per-round dispersion, radians. 2.5 mrad is 2 m of scatter at 800 m: the
  // burst has a texture without the gun feeling broken.
  dispersion: 0.0025,

  // Visuals.
  flashTime: 0.05,
  flashScale: 1.15,
  tracerSpeed: 1400,
  tracerLife: 0.32,
  tracerLength: 26,
  tracerPool: 20,
  sparkLife: 0.2,
  sparkScale: 6,
  sparkPool: 14,

  // §23: alive, not uncontrollable. 3.5 cm of camera jitter.
  shake: 0.035,
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * How many rounds this frame, and what is left on the accumulator. Pure — the
 * fire loop of §8, kept out of the render code so it can be tested at silly
 * frame times.
 */
export function gunShots(accumulator, dt, interval) {
  const acc = accumulator + dt;
  const shots = Math.floor(acc / interval);
  return { shots, rest: acc - shots * interval };
}

/**
 * Effectiveness by range: 1 inside bestRange, smoothly to 0 at maxRange, 0
 * beyond. This is the whole of "GUN = close, AIM-9 = far" (§9/§28). Pure.
 */
export function rangeEffect(range, cfg = GUN) {
  if (range <= cfg.bestRange) return 1;
  if (range >= cfg.maxRange) return 0;
  return 1 - smooth(clamp01((range - cfg.bestRange) / (cfg.maxRange - cfg.bestRange)));
}

/** Damage of one landed round at a given range. Pure. */
export function gunDamage(range, cfg = GUN) {
  return cfg.damagePerHit * rangeEffect(range, cfg);
}

/**
 * Ray/sphere hitscan. Returns the distance along `dir` to the closest approach
 * when it passes within `radius`, else null. `dir` must be unit length. Pure.
 *
 * Closest-approach rather than an exact entry point: at these speeds the
 * difference is under a metre and the entry-point solve costs a square root
 * that decides nothing.
 */
export function hitscanRange(origin, dir, targetPos, radius) {
  const dx = targetPos.x - origin.x;
  const dy = targetPos.y - origin.y;
  const dz = targetPos.z - origin.z;
  const along = dx * dir.x + dy * dir.y + dz * dir.z;
  if (along <= 0) return null; // behind the muzzle
  const perp = Math.hypot(dx - dir.x * along, dy - dir.y * along, dz - dir.z * along);
  return perp <= radius ? along : null;
}

/**
 * Where to aim (§13). Simple model on purpose: travel time from range and
 * projectile speed, target advanced by that time.
 *
 * The one refinement over the letter of §13 is that velocity is *relative* —
 * the shells leave an aircraft that is itself doing 250 m/s, so in the shooter's
 * frame only the closing motion matters. Without it the pipper leads a
 * co-speed, co-heading target that needs no lead at all. Pure.
 */
export function leadSolution(muzzle, targetPos, targetVel, ownVel, cfg = GUN, out = {}) {
  const dx = targetPos.x - muzzle.x;
  const dy = targetPos.y - muzzle.y;
  const dz = targetPos.z - muzzle.z;
  const range = Math.hypot(dx, dy, dz);
  const t = Math.min(cfg.maxLeadTime, range / Math.max(cfg.projectileSpeed, 1));
  const vx = (targetVel ? targetVel.x : 0) - (ownVel ? ownVel.x : 0);
  const vy = (targetVel ? targetVel.y : 0) - (ownVel ? ownVel.y : 0);
  const vz = (targetVel ? targetVel.z : 0) - (ownVel ? ownVel.z : 0);
  out.x = targetPos.x + vx * t;
  out.y = targetPos.y + vy * t;
  out.z = targetPos.z + vz * t;
  out.range = range;
  out.time = t;
  return out;
}

function sparkTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,246,1)");
  grad.addColorStop(0.3, "rgba(255,224,150,0.72)");
  grad.addColorStop(0.7, "rgba(255,150,70,0.22)");
  grad.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param scene    where tracers and sparks live (world space — a tracer must
 *                 not inherit the aircraft transform, same reason as the vapor
 *                 ribbons)
 * @param muzzle   Object3D whose world transform is the gun port
 */
export function createGunSystem({ scene, muzzle, cfg = GUN }) {
  const tex = sparkTexture();
  const flashMat = new THREE.SpriteMaterial({ map: tex, color: 0xfff0c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const flash = new THREE.Sprite(flashMat);
  flash.name = "GunFlash";
  flash.scale.setScalar(cfg.flashScale);
  muzzle.add(flash);

  // Pools, built once. Sustained fire must not allocate (§32).
  const tracers = [];
  for (let i = 0; i < cfg.tracerPool; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffd79a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    );
    line.name = `Tracer${i}`;
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, live: false, t: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3() });
  }

  const sparks = [];
  for (let i = 0; i < cfg.sparkPool; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sprite.name = `GunSpark${i}`;
    sprite.visible = false;
    scene.add(sprite);
    sparks.push({ sprite, live: false, t: 0 });
  }

  const events = { hit: [], kill: [], dry: [] };
  const emit = (kind, payload) => events[kind].forEach((fn) => fn(payload));

  const state = {
    ammo: cfg.ammo,
    firing: false,
    shots: 0, // rounds simulated this frame
    hits: 0, // rounds that landed this frame
    burst: 0, // rounds fired in the current trigger pull
    lead: { x: 0, y: 0, z: 0, range: 0, time: 0 },
    leadValid: false,
    rangeEffect: 0,
    dry: false,
  };

  let acc = 0;
  let shotCounter = 0;
  let hitCounter = 0;
  let flashT = 0;
  const _mz = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _hit = new THREE.Vector3();
  const interval = 1 / cfg.shotsPerSecond;

  const takeTracer = () => tracers.find((t) => !t.live) || tracers[shotCounter % tracers.length];
  const takeSpark = () => sparks.find((s) => !s.live) || sparks[hitCounter % sparks.length];

  function spawnTracer(origin, dir) {
    const t = takeTracer();
    t.live = true;
    t.t = 0;
    t.origin.copy(origin);
    t.dir.copy(dir);
    t.line.visible = true;
  }

  function spawnSpark(at) {
    const s = takeSpark();
    s.live = true;
    s.t = 0;
    s.sprite.position.copy(at);
    s.sprite.scale.setScalar(cfg.sparkScale * 0.5);
    s.sprite.visible = true;
  }

  /**
   * @param ctx {
   *   firing, forward, right, up, ownVel, target,
   *   armed  — false when the gun is not the selected weapon
   * }
   */
  function update(ctx, dt) {
    muzzle.updateMatrixWorld(true);
    muzzle.getWorldPosition(_mz);

    const target = ctx.target && ctx.target.alive !== false ? ctx.target : null;

    // Lead is computed whenever there is a target, armed or not: the HUD decides
    // whether to draw it, and computing it costs one square root (§12).
    if (target) {
      leadSolution(_mz, target.position, target.velocity, ctx.ownVel, cfg, state.lead);
      state.rangeEffect = rangeEffect(state.lead.range, cfg);
      state.leadValid = state.lead.range <= cfg.maxRange * 1.25;
    } else {
      state.leadValid = false;
      state.rangeEffect = 0;
    }

    const wantFire = !!(ctx.armed && ctx.firing && state.ammo > 0);
    if (ctx.armed && ctx.firing && state.ammo <= 0 && !state.dry) {
      state.dry = true;
      emit("dry", {});
    }
    if (!ctx.firing || !ctx.armed) {
      state.burst = 0;
      if (state.ammo > 0) state.dry = false;
    }
    state.firing = wantFire;
    state.shots = 0;
    state.hits = 0;

    if (!wantFire) {
      acc = 0;
    } else {
      const { shots, rest } = gunShots(acc, dt, interval);
      acc = rest;
      const fired = Math.min(shots, state.ammo);
      state.shots = fired;
      state.ammo -= fired;
      state.burst += fired;
      if (fired > 0) flashT = cfg.flashTime;

      for (let i = 0; i < fired; i++) {
        shotCounter++;
        // Boresight plus a little scatter. Aircraft forward, per §10 — the
        // muzzle's 1.6 m offset from the centreline is 0.1° of parallax at
        // 800 m and is not worth a second aim vector.
        _dir.copy(ctx.forward);
        if (cfg.dispersion > 0) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * cfg.dispersion;
          _dir.addScaledVector(ctx.right, Math.cos(a) * r).addScaledVector(ctx.up, Math.sin(a) * r).normalize();
        }

        if (shotCounter % cfg.tracerEvery === 0) spawnTracer(_mz, _dir);

        if (!target) continue;
        const d = hitscanRange(_mz, _dir, target.position, cfg.hitRadius);
        if (d === null || d > cfg.maxRange) continue;
        const dmg = gunDamage(d, cfg);
        if (dmg <= 0) continue;
        state.hits++;
        hitCounter++;
        if (hitCounter % cfg.sparkEvery === 0) {
          _hit.copy(_mz).addScaledVector(_dir, d);
          spawnSpark(_hit);
        }
        emit("hit", { target, range: d, damage: dmg });
        if (target.health !== undefined && target.health <= 0) {
          emit("kill", { target, at: _hit.copy(target.position) });
          break;
        }
      }
      if (state.ammo <= 0) state.dry = true;
    }

    /* ---- visuals ---- */
    if (flashT > 0) flashT -= dt;
    const fk = Math.max(0, flashT / cfg.flashTime);
    flashMat.opacity = 0.9 * fk;
    // Compact, and it grows *in* rather than out: a flash that expands reads as
    // an explosion (§20).
    flash.scale.setScalar(cfg.flashScale * (0.6 + 0.4 * fk));
    flash.visible = fk > 0.01;

    for (const t of tracers) {
      if (!t.live) continue;
      t.t += dt;
      const k = t.t / cfg.tracerLife;
      if (k >= 1) {
        t.live = false;
        t.line.visible = false;
        t.line.material.opacity = 0;
        continue;
      }
      const head = cfg.tracerSpeed * t.t;
      const tail = Math.max(0, head - cfg.tracerLength);
      const p = t.line.geometry.attributes.position;
      p.setXYZ(0, t.origin.x + t.dir.x * tail, t.origin.y + t.dir.y * tail, t.origin.z + t.dir.z * tail);
      p.setXYZ(1, t.origin.x + t.dir.x * head, t.origin.y + t.dir.y * head, t.origin.z + t.dir.z * head);
      p.needsUpdate = true;
      // Bright at birth, gone well before it reaches the horizon (§22).
      t.line.material.opacity = 0.85 * (1 - k) * (1 - k);
    }

    for (const s of sparks) {
      if (!s.live) continue;
      s.t += dt;
      const k = s.t / cfg.sparkLife;
      if (k >= 1) {
        s.live = false;
        s.sprite.visible = false;
        s.sprite.material.opacity = 0;
        continue;
      }
      s.sprite.material.opacity = 1 - k;
      s.sprite.scale.setScalar(cfg.sparkScale * (0.5 + k * 0.9));
    }
  }

  function reset() {
    state.ammo = cfg.ammo;
    state.firing = false;
    state.shots = state.hits = state.burst = 0;
    state.dry = false;
    state.leadValid = false;
    acc = 0;
    shotCounter = hitCounter = 0;
    flashT = 0;
    flashMat.opacity = 0;
    flash.visible = false;
    for (const t of tracers) {
      t.live = false;
      t.line.visible = false;
      t.line.material.opacity = 0;
    }
    for (const s of sparks) {
      s.live = false;
      s.sprite.visible = false;
      s.sprite.material.opacity = 0;
    }
  }

  /**
   * Stage 04.0 §45 — drop the visual debris without touching the magazine.
   * `reset()` reloads the gun, which is wrong at a phase transition: the mission
   * takes the tracers and sparks of a finished encounter away, not the player's
   * remaining ammunition.
   */
  function clearFx() {
    flashT = 0;
    flashMat.opacity = 0;
    flash.visible = false;
    for (const t of tracers) {
      t.live = false;
      t.line.visible = false;
      t.line.material.opacity = 0;
    }
    for (const s of sparks) {
      s.live = false;
      s.sprite.visible = false;
      s.sprite.material.opacity = 0;
    }
  }

  return {
    state,
    cfg,
    flash,
    tracers,
    sparks,
    update,
    reset,
    clearFx,
    on(kind, fn) {
      events[kind].push(fn);
    },
  };
}
