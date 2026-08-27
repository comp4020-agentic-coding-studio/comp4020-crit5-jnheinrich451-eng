/**
 * Stage 03.0 — missile entities.
 *
 * A gameplay missile, not a simulation: constant max turn rate, a boost to a
 * capped speed, a lifetime, and a proximity fuze. Ownership is a field, not an
 * assumption — the same system will fly an enemy or SAM round later (§34).
 */
import * as THREE from "three";

export const MissileState = { LAUNCHED: "LAUNCHED", TRACKING: "TRACKING", HIT: "HIT", EXPIRED: "EXPIRED" };

export const MISSILE = {
  // Separation: 0.16 s of unguided fall off the rail before the motor lights.
  separationTime: 0.16,
  separationDown: 6.5,
  separationOut: 1.8,
  separationDamping: 4.0,

  // Inherits most of the launch aircraft's speed, then boosts well past it.
  inheritFactor: 0.9,
  minLaunchSpeed: 140,
  thrust: 620, // m/s^2 while boosting
  boostTime: 1.6,
  maxSpeed: 900,
  dragAfterBoost: 18, // m/s^2 bleed once the motor is out

  turnRateDeg: 55, // visible curve, not a snap-to-target
  lifetime: 6.5,
  hitRadius: 22,
  // Lead is proportional navigation's cheap cousin: aim where the target will
  // be, capped so a crossing target does not produce a wild off-axis command.
  maxLeadTime: 1.2,
  // Stage 03.3 §28: past this required turn the round has been defeated and
  // stops guiding. The player's AIM-9 gets a generous 150° — it is not the
  // weapon this rule exists for — while the hostile round gets 95°.
  overshootAngleDeg: 150,

  trailPoints: 44,
};

const DEG = Math.PI / 180;

/**
 * Rotate `dir` toward `desired` by at most maxRad. Pure, in-place, no THREE —
 * the piece worth unit-testing.
 */
export function steer(dir, desired, maxRad) {
  const dot = Math.min(1, Math.max(-1, dir.x * desired.x + dir.y * desired.y + dir.z * desired.z));
  const angle = Math.acos(dot);
  if (angle <= 1e-6) return dir;
  const step = Math.min(angle, maxRad);

  // Rodrigues rotation about the plane normal, not a normalized lerp: lerping
  // the chord under-turns badly at large separations (a 10 deg command applied
  // 90 deg off target delivers ~7 deg), which would quietly make the missile's
  // turn rate depend on how far off it was pointing.
  let ax = dir.y * desired.z - dir.z * desired.y;
  let ay = dir.z * desired.x - dir.x * desired.z;
  let az = dir.x * desired.y - dir.y * desired.x;
  let len = Math.hypot(ax, ay, az);
  if (len < 1e-9) {
    // Exactly antiparallel: any perpendicular axis is a valid turn plane.
    const px = Math.abs(dir.x) < 0.9 ? 1 : 0;
    ax = dir.y * 0 - dir.z * 0;
    ay = dir.z * px - dir.x * 0;
    az = dir.x * 0 - dir.y * px;
    len = Math.hypot(ax, ay, az) || 1;
  }
  ax /= len;
  ay /= len;
  az /= len;

  const c = Math.cos(step);
  const s = Math.sin(step);
  const d = ax * dir.x + ay * dir.y + az * dir.z;
  const x = dir.x * c + (ay * dir.z - az * dir.y) * s + ax * d * (1 - c);
  const y = dir.y * c + (az * dir.x - ax * dir.z) * s + ay * d * (1 - c);
  const z = dir.z * c + (ax * dir.y - ay * dir.x) * s + az * d * (1 - c);
  const l = Math.hypot(x, y, z) || 1;
  dir.x = x / l;
  dir.y = y / l;
  dir.z = z / l;
  return dir;
}

/**
 * Closest distance from point `p` to the segment a->b. A 900 m/s missile moves
 * 15 m per 60 Hz step, so a point-sample fuze can miss a 22 m sphere outright.
 */
export function segmentDistance(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const denom = abx * abx + aby * aby + abz * abz;
  const t = denom > 1e-9 ? Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / denom)) : 0;
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}

/** Boost then bleed. Pure. */
export function advanceSpeed(speed, life, dt, cfg = MISSILE) {
  const accel = life < cfg.boostTime ? cfg.thrust : -cfg.dragAfterBoost;
  return Math.max(80, Math.min(cfg.maxSpeed, speed + accel * dt));
}

/** Lead point for a moving target. Pure. */
export function leadPoint(missilePos, missileSpeed, targetPos, targetVel, cfg = MISSILE, out = {}) {
  const range = Math.hypot(targetPos.x - missilePos.x, targetPos.y - missilePos.y, targetPos.z - missilePos.z);
  const t = Math.min(cfg.maxLeadTime, range / Math.max(missileSpeed, 1));
  out.x = targetPos.x + (targetVel ? targetVel.x : 0) * t;
  out.y = targetPos.y + (targetVel ? targetVel.y : 0) * t;
  out.z = targetPos.z + (targetVel ? targetVel.z : 0) * t;
  return out;
}

/**
 * Stage 03.3 §28 — has this round been beaten?
 *
 * Two conditions, both required: the turn it would now need exceeds what it can
 * plausibly fly, and the range is opening. Angle alone would call an overshoot
 * on a round still closing head-on through a crossing geometry; opening range
 * alone would call one on a round that has simply not turned yet. Once lost it
 * stops guiding and flies out to expiry, which is what a visible miss looks
 * like (§27).
 */
export function overshooting(angleDeg, opening, range, cfg = MISSILE) {
  return opening && angleDeg >= cfg.overshootAngleDeg && range > cfg.hitRadius * 4;
}

/* ---- world-side system ---- */

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,244,214,1)");
  grad.addColorStop(0.35, "rgba(255,176,88,0.75)");
  grad.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param scene      where live missiles and bursts are parented
 * @param prototype  normalized Aim9Root (forward -Z, 2.85 m)
 * @param authorityFor  (missile) => 0..1 scale on this frame's turn rate. The
 *   Stage 03.3 barrel-roll dodge lives here: the missile system does not know
 *   what a barrel roll is, only that something has degraded its guidance (§21).
 * @param groundAt   (x, z) => surface height, for §29 terrain kills. Optional;
 *   without it a missile only expires on lifetime or on falling below the sea.
 */
export function createMissileSystem({ scene, prototype, cfg = MISSILE, authorityFor = null, groundAt = null }) {
  const live = [];
  const bursts = [];
  const tex = glowTexture();
  const glowMat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const burstMat = () => new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });

  const events = { hit: [], expire: [], launch: [] };
  const emit = (kind, payload) => events[kind].forEach((fn) => fn(payload));

  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _prev = new THREE.Vector3();
  const _desired = { x: 0, y: 0, z: 0 };
  const _lead = { x: 0, y: 0, z: 0 };
  const _look = new THREE.Vector3();

  function buildVisual() {
    const group = new THREE.Object3D();
    group.name = "MissileLive";
    if (prototype) group.add(prototype.clone(true));

    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(3.2);
    glow.position.z = 1.7; // behind the tail: forward is -Z
    group.add(glow);

    const positions = new Float32Array(cfg.trailPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.75, depthWrite: false })
    );
    trail.name = "MissileTrail";
    trail.frustumCulled = false;

    return { group, glow, trail, positions };
  }

  /**
   * @param mount   Object3D whose world transform is the launch point
   * @param target  { position, velocity, alive }
   * @param cfg     per-missile overrides — §14's ownership generalised: an enemy
   *   round is this same implementation with slower, less agile numbers, not a
   *   second missile system.
   */
  function fire({ mount, target, ownerSpeed = 0, owner = "player", side = 1, cfg: over = null }) {
    mount.updateMatrixWorld(true);
    const c = over || cfg;
    const visual = buildVisual();
    scene.add(visual.group, visual.trail);

    mount.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _right.set(1, 0, 0).applyQuaternion(_q);

    const pos = mount.getWorldPosition(new THREE.Vector3());
    const m = {
      owner,
      cfg: c,
      state: MissileState.LAUNCHED,
      position: pos,
      prev: pos.clone(),
      dir: { x: _fwd.x, y: _fwd.y, z: _fwd.z },
      speed: Math.max(c.minLaunchSpeed, ownerSpeed * c.inheritFactor),
      target,
      life: 0,
      // Miss bookkeeping (§43): how close it ever got, and whether guidance has
      // been defeated. The evade cue is earned from the first, not from a timer.
      minRange: Infinity,
      lastRange: Infinity,
      authority: 1,
      lost: false,
      // Separation velocity: off the rail and slightly outboard, damped away.
      sep: new THREE.Vector3()
        .addScaledVector(_up, -c.separationDown)
        .addScaledVector(_right, side * c.separationOut),
      visual,
      trailFilled: 0,
    };
    // Seed the whole trail at the launch point so the first frames do not draw
    // a line back to the world origin.
    for (let i = 0; i < cfg.trailPoints; i++) {
      visual.positions[i * 3] = pos.x;
      visual.positions[i * 3 + 1] = pos.y;
      visual.positions[i * 3 + 2] = pos.z;
    }
    visual.group.position.copy(pos);
    visual.group.quaternion.copy(_q);

    live.push(m);
    emit("launch", m);
    return m;
  }

  function pushTrail(m) {
    const p = m.visual.positions;
    p.copyWithin(0, 3);
    const i = (cfg.trailPoints - 1) * 3;
    p[i] = m.position.x;
    p[i + 1] = m.position.y;
    p[i + 2] = m.position.z;
    m.visual.trail.geometry.attributes.position.needsUpdate = true;
  }

  function retire(m, state) {
    m.state = state;
    scene.remove(m.visual.group, m.visual.trail);
    m.visual.trail.geometry.dispose();
  }

  function burst(position, scale = 26) {
    const sprite = new THREE.Sprite(burstMat());
    sprite.position.copy(position);
    sprite.scale.setScalar(scale * 0.35);
    scene.add(sprite);
    bursts.push({ sprite, t: 0, life: 0.55, scale });
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const m = live[i];
      const c = m.cfg || cfg;
      m.life += dt;
      m.prev.copy(m.position);

      if (m.state === MissileState.LAUNCHED && m.life >= c.separationTime) m.state = MissileState.TRACKING;

      if (m.state === MissileState.TRACKING) {
        m.speed = advanceSpeed(m.speed, m.life, dt, c);
        const t = m.target;
        if (t && t.alive !== false) {
          const range = Math.hypot(t.position.x - m.position.x, t.position.y - m.position.y, t.position.z - m.position.z);
          leadPoint(m.position, m.speed, t.position, t.velocity, c, _lead);
          _desired.x = _lead.x - m.position.x;
          _desired.y = _lead.y - m.position.y;
          _desired.z = _lead.z - m.position.z;
          const len = Math.hypot(_desired.x, _desired.y, _desired.z) || 1;
          _desired.x /= len;
          _desired.y /= len;
          _desired.z /= len;

          const dot = Math.min(1, Math.max(-1, m.dir.x * _desired.x + m.dir.y * _desired.y + m.dir.z * _desired.z));
          const angleDeg = Math.acos(dot) / DEG;
          const opening = range > m.lastRange;
          if (!m.lost && overshooting(angleDeg, opening, range, c)) m.lost = true;
          m.minRange = Math.min(m.minRange, range);
          m.lastRange = range;

          // Guidance authority is external (§21): a defeated round and a
          // disturbed one are the same thing to this loop — less turn.
          m.authority = m.lost ? 0 : authorityFor ? authorityFor(m) : 1;
          if (m.authority > 0) steer(m.dir, _desired, c.turnRateDeg * DEG * m.authority * dt);
        }
      }

      // Separation impulse decays exponentially rather than cutting out.
      const sepFactor = Math.exp(-c.separationDamping * m.life);
      m.position.x += (m.dir.x * m.speed + m.sep.x * sepFactor) * dt;
      m.position.y += (m.dir.y * m.speed + m.sep.y * sepFactor) * dt;
      m.position.z += (m.dir.z * m.speed + m.sep.z * sepFactor) * dt;

      m.visual.group.position.copy(m.position);
      _look.copy(m.position).addScaledVector(new THREE.Vector3(m.dir.x, m.dir.y, m.dir.z), 10);
      m.visual.group.lookAt(_look);
      pushTrail(m);

      const t = m.target;
      if (t && t.alive !== false && segmentDistance(m.prev, m.position, t.position) <= c.hitRadius) {
        burst(m.position, 30);
        retire(m, MissileState.HIT);
        live.splice(i, 1);
        emit("hit", { missile: m, target: t });
        continue;
      }

      // §29 — a round that flies into the island is destroyed there. Cheap: one
      // terrain sample per missile per frame, and it is what makes terrain
      // masking a real tactic later.
      const ground = groundAt ? groundAt(m.position.x, m.position.z) : null;
      if (ground !== null && ground !== undefined && m.position.y <= ground) {
        burst(m.position, 16);
        retire(m, MissileState.EXPIRED);
        live.splice(i, 1);
        emit("expire", { missile: m, reason: "TERRAIN" });
        continue;
      }

      if (m.life >= c.lifetime || m.position.y < -20) {
        retire(m, MissileState.EXPIRED);
        live.splice(i, 1);
        emit("expire", { missile: m, reason: m.life >= c.lifetime ? "TIME" : "SEA" });
      }
    }

    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.t += dt;
      const k = b.t / b.life;
      b.sprite.scale.setScalar(b.scale * (0.35 + k * 1.6));
      b.sprite.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        scene.remove(b.sprite);
        b.sprite.material.dispose();
        bursts.splice(i, 1);
      }
    }
  }

  /**
   * Stage 04.0 §44 — expire one owner's rounds without touching the other's.
   *
   * Called at every phase transition and every checkpoint restore. A missile
   * launched ninety seconds and two phases ago must not still be flying somewhere
   * offscreen, and `reset()` is too blunt for that: it would also delete the
   * player's shot that is mid-flight through the transition. Silent by design —
   * no "expire" event, because nobody missed anything.
   */
  function expireOwner(owner) {
    let removed = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].owner !== owner) continue;
      retire(live[i], MissileState.EXPIRED);
      live.splice(i, 1);
      removed += 1;
    }
    return removed;
  }

  function reset() {
    for (const m of live) retire(m, MissileState.EXPIRED);
    live.length = 0;
    for (const b of bursts) {
      scene.remove(b.sprite);
      b.sprite.material.dispose();
    }
    bursts.length = 0;
  }

  return {
    live,
    fire,
    update,
    reset,
    expireOwner,
    burst,
    get inFlight() {
      return live.length;
    },
    /** Live rounds belonging to one owner — what the threat display consumes. */
    ownedBy(owner) {
      return live.filter((m) => m.owner === owner);
    },
    on(kind, fn) {
      events[kind].push(fn);
    },
    cfg,
  };
}
