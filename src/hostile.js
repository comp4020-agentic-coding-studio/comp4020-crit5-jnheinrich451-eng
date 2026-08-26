// The hostile fighter. CLAUDE.md §12, stage 6.
//
// EIGHT STATES, ONE PURE TRANSITION FUNCTION, AND NOTHING ELSE MAY PROMOTE A
// STATE. Every engagement condition lives inside hostileTransition, so when
// the behaviour misbehaves there is exactly one place to look. Do not put a
// state change inside the update loop.
//
// Three-free, so the whole table is exercised without a scene.

import { createTarget } from "./enemy.js";

export const PATROL = "PATROL";
export const PURSUIT = "PURSUIT";
export const ACQUIRE = "ACQUIRE";
export const ATTACK = "ATTACK";
export const COOLDOWN = "COOLDOWN";
export const REPOSITION = "REPOSITION";
export const DEFEND = "DEFEND";
export const DESTROYED = "DESTROYED";

export const HOSTILE_CFG = {
  detect: 5000,
  coneMin: 520,
  coneMax: 2500,
  coneAngle: (28 * Math.PI) / 180,
  lockSeconds: 1.25,
  launchDelay: 0.55, // from lock to launch, and NOT interruptible
  cooldownSeconds: 7,
  repositionSeconds: 4.5,
  // The player must HOLD a completed lock this long before it breaks --
  // roughly the time an AIM-9 needs to launch. A ready player gets the shot; a
  // hesitant one watches the target leave. That delay IS the skill expression.
  defendReaction: 0.9,
  defendSeconds: 2.8,
  defendCooldown: 6,
  yawRate: (12 * Math.PI) / 180,
  pitchRate: (7 * Math.PI) / 180,
  breakFactor: 2.1,
  speed: 205,
  minAltitude: 260,
};

// §14's table, as DATA. missile.js never learns whose round this is.
export const HOSTILE_MISSILE = {
  name: "HOSTILE",
  maxSpeed: 410,
  turnRate: (26 * Math.PI) / 180,
  lifetime: 9.5,
  fuze: 8,
  separation: 0.2,
  damage: 55,
};

/**
 * The transition table. Pure: it reads `ai` and published facts in `ctx`, and
 * returns the state that should hold next. It never mutates either.
 *
 * ctx: { alive, playerAlive, ready, range, inCone, lockCue }
 *   lockCue is how long the PLAYER has held a completed lock on this aircraft.
 */
export function hostileTransition(ai, ctx, cfg = HOSTILE_CFG) {
  // Death wins from every state, and DESTROYED is terminal.
  if (ai.state === DESTROYED) return DESTROYED;
  if (!ctx.alive) return DESTROYED;

  // Nothing to fight.
  if (!ctx.playerAlive || !ctx.ready) return PATROL;

  // A committed ATTACK is NEVER interruptible: 0.55 s from lock to launch, and
  // a hostile that could be talked out of a shot would never land one. So the
  // DEFEND check sits below ATTACK, not above it.
  if (ai.state === ATTACK) {
    return ai.stateTime >= cfg.launchDelay ? COOLDOWN : ATTACK;
  }

  // Break when the player has HELD a completed lock long enough, and only if
  // the break is off cooldown -- otherwise a sustained lock becomes a
  // permanent evasion loop the player can never shoot it out of.
  if (
    ai.state !== DEFEND &&
    ctx.lockCue >= cfg.defendReaction &&
    ai.defendCooldown <= 0
  ) {
    return DEFEND;
  }

  switch (ai.state) {
    case DEFEND:
      return ai.stateTime >= cfg.defendSeconds ? REPOSITION : DEFEND;

    case PATROL:
      return ctx.range <= cfg.detect ? PURSUIT : PATROL;

    case PURSUIT:
      if (ctx.range > cfg.detect) return PATROL;
      // `ammo: 0` IS THE DESIGN TOOL. The table already refuses to promote
      // without a round, so stage 7's first encounter -- "it chases you but
      // does not shoot back yet" -- needs no new state and no special case.
      // Do not add one.
      if (ctx.inCone && ai.ammo > 0) return ACQUIRE;
      return PURSUIT;

    case ACQUIRE:
      if (ctx.range > cfg.detect) return PATROL;
      if (!ctx.inCone || ai.ammo <= 0) return PURSUIT;
      return ai.lockTimer >= cfg.lockSeconds ? ATTACK : ACQUIRE;

    case COOLDOWN:
      return ai.stateTime >= cfg.cooldownSeconds ? REPOSITION : COOLDOWN;

    case REPOSITION:
      return ai.stateTime >= cfg.repositionSeconds ? PURSUIT : REPOSITION;

    default:
      return PATROL;
  }
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const wrap = (a) => {
  const two = Math.PI * 2;
  let v = (a + Math.PI) % two;
  if (v < 0) v += two;
  return v - Math.PI;
};

export function createHostile({ cfg = HOSTILE_CFG, onLaunch } = {}) {
  const target = createTarget({ label: "HOSTILE", health: 100, radius: 11 });

  const ai = {
    state: PATROL,
    stateTime: 0,
    lockTimer: 0,
    lockCue: 0,
    defendCooldown: 0,
    ammo: 0,
    heading: Math.PI,
    pitch: 0,
    // LATCHED at entry to DEFEND. Recomputing per frame flips the cross
    // product as the aircraft turns, and the break oscillates to a net heading
    // change of nothing. (The same trap returns in stage 9's crash tumble.)
    breakSign: 1,
    encounters: 0,
    engageDelay: 0,
  };

  let active = false;

  function forward() {
    // Project's convention: forward is (-sin h, -cos h). §5.
    const c = Math.cos(ai.pitch);
    return {
      x: -Math.sin(ai.heading) * c,
      y: Math.sin(ai.pitch),
      z: -Math.cos(ai.heading) * c,
    };
  }

  function facts(playerState, playerAlive) {
    const d = sub(playerState.position, target.position);
    const range = len(d);
    const f = forward();
    const cos = range > 0 ? (d.x * f.x + d.y * f.y + d.z * f.z) / range : 0;
    const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
    return {
      alive: target.alive,
      playerAlive,
      ready: active && ai.engageDelay <= 0,
      range,
      inCone:
        range >= cfg.coneMin && range <= cfg.coneMax && angle <= cfg.coneAngle,
      lockCue: ai.lockCue,
      bearing: d,
    };
  }

  function steerToward(point, dt, factor) {
    const d = sub(point, target.position);
    const wantHeading = Math.atan2(-d.x, -d.z);
    const flat = Math.hypot(d.x, d.z);
    const wantPitch = Math.atan2(d.y, flat);
    const yaw = cfg.yawRate * factor * dt;
    const pitch = cfg.pitchRate * factor * dt;
    const dh = wrap(wantHeading - ai.heading);
    ai.heading = wrap(ai.heading + Math.max(-yaw, Math.min(yaw, dh)));
    const dp = wantPitch - ai.pitch;
    ai.pitch += Math.max(-pitch, Math.min(pitch, dp));
  }

  return {
    ai,
    target,
    cfg,
    isActive: () => active,
    /** True only when the magazine is empty AND nothing is still in the air. */
    spent: (roundsInAir = 0) => ai.ammo <= 0 && roundsInAir === 0,

    /**
     * One instance serves all three encounters. Resets, repositions, re-arms.
     * The encounter COUNT survives the reset -- it is what alternates which
     * side the aircraft appears on.
     */
    deploy({ at, heading = Math.PI, ammo = 0, engageDelay = 0 }) {
      const encounters = ai.encounters;
      target.alive = true;
      target.health = target.maxHealth;
      target.hitAt = -Infinity;
      target.position.x = at.x;
      target.position.y = at.y;
      target.position.z = at.z;
      target.velocity.x = 0;
      target.velocity.y = 0;
      target.velocity.z = 0;
      ai.state = PATROL;
      ai.stateTime = 0;
      ai.lockTimer = 0;
      ai.lockCue = 0;
      ai.defendCooldown = 0;
      ai.ammo = ammo;
      ai.heading = heading;
      ai.pitch = 0;
      ai.encounters = encounters + 1;
      ai.engageDelay = engageDelay;
      active = true;
    },

    setActive(on) {
      active = !!on;
    },

    /**
     * @param playerLockedOnMe whether the PLAYER holds a completed lock on
     *        this aircraft. Accumulated only while actually held.
     */
    update(dt, { playerState, playerAlive = true, playerLockedOnMe = false }) {
      // INACTIVE MEANS INACTIVE: not simulated, not moved, not drawn, and not
      // offered to targeting as a candidate.
      if (!active || !target.alive) return;

      if (ai.engageDelay > 0) ai.engageDelay = Math.max(0, ai.engageDelay - dt);
      if (ai.defendCooldown > 0) {
        ai.defendCooldown = Math.max(0, ai.defendCooldown - dt);
      }

      // A FLEETING LOCK PROVOKES NOTHING: the cue accumulates only while the
      // lock is actually held, and is zeroed the moment it drops. A hostile
      // that reacted to a momentary lock would be reading the player's HUD.
      ai.lockCue = playerLockedOnMe ? ai.lockCue + dt : 0;

      const ctx = facts(playerState, playerAlive);

      if (ctx.inCone && ai.state === ACQUIRE) ai.lockTimer += dt;
      else if (ai.state !== ACQUIRE) ai.lockTimer = 0;

      const next = hostileTransition(ai, ctx, cfg);
      if (next !== ai.state) {
        const previous = ai.state;
        ai.state = next;
        ai.stateTime = 0;
        if (next === DEFEND) {
          // Latch the direction ONCE, here.
          ai.breakSign = ctx.bearing.x >= 0 ? -1 : 1;
          ai.lockCue = 0;
          ai.defendCooldown = cfg.defendCooldown;
        }
        if (next === COOLDOWN && previous === ATTACK && ai.ammo > 0) {
          ai.ammo--;
          if (onLaunch) onLaunch(target, forward(), ai);
        }
        if (next === ACQUIRE) ai.lockTimer = 0;
      } else {
        ai.stateTime += dt;
      }

      // Movement. Every state steers; only the factor and the point differ.
      let factor = 1;
      let point = playerState.position;
      if (ai.state === DEFEND) {
        factor = cfg.breakFactor;
        // Break in the LATCHED direction, trading altitude if there is any.
        const away = ai.heading + ai.breakSign * (Math.PI * 0.55);
        point = {
          x: target.position.x - Math.sin(away) * 3000,
          y: Math.max(cfg.minAltitude + 60, target.position.y - 400),
          z: target.position.z - Math.cos(away) * 3000,
        };
      } else if (ai.state === REPOSITION) {
        point = {
          x: playerState.position.x + ai.breakSign * 1800,
          y: playerState.position.y + 220,
          z: playerState.position.z - 1800,
        };
      } else if (ai.state === PATROL) {
        point = {
          x: target.position.x - Math.sin(ai.heading) * 2000,
          y: target.position.y,
          z: target.position.z - Math.cos(ai.heading) * 2000,
        };
      }
      steerToward(point, dt, factor);

      const f = forward();
      target.velocity.x = f.x * cfg.speed;
      target.velocity.y = f.y * cfg.speed;
      target.velocity.z = f.z * cfg.speed;
      target.position.x += target.velocity.x * dt;
      target.position.y += target.velocity.y * dt;
      target.position.z += target.velocity.z * dt;

      // THE ALTITUDE GUARD: it must never fly into the sea, including through
      // a diving break. Clamped after integration so no path can slip past it.
      if (target.position.y < cfg.minAltitude) {
        target.position.y = cfg.minAltitude;
        if (ai.pitch < 0) ai.pitch = 0;
        target.velocity.y = Math.max(0, target.velocity.y);
      }
    },

    forward,
  };
}
