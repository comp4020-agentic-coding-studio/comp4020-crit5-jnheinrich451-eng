/**
 * Stage 03.3 — hostile combat behaviour.
 *
 * A compact game-state machine, not a dogfight simulation (§2). The hostile's
 * whole job is: find the player, get into a threatening position, telegraph the
 * attack, fire, give the player a chance to react, break away and come back.
 *
 * Everything here reads the player's published state and writes only to the
 * drone entity it was handed. It never touches the flight model, the HUD or the
 * missile system — a launch is an *event*, and main.js decides what a launch
 * means (§14/§16).
 *
 * Steering is rate-limited heading + pitch rather than quaternion slerp (§7).
 * The constraint that stops the enemy looking like a UFO is the maximum angular
 * rate, not the representation, and heading/pitch is the convention the drone
 * entity and the flight model already use — so a bank angle, a velocity vector
 * and a HUD heading all mean the same thing across the project.
 */

import { integrateDrone, updateTargetDrone } from "./enemy.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** §3 — the states, explicit and closed. */
export const HostileState = {
  PATROL: "PATROL",
  PURSUIT: "PURSUIT",
  ACQUIRE: "ACQUIRE",
  ATTACK: "ATTACK",
  DEFEND: "DEFEND",
  COOLDOWN: "COOLDOWN",
  REPOSITION: "REPOSITION",
  DESTROYED: "DESTROYED",
};

export const HOSTILE = {
  /** §5/§6 — engagement envelope. Wider out than in, so detection cannot chatter. */
  detectRange: 4200,
  disengageRange: 7000,
  /**
   * The hostile spends the first seconds of a life patrolling whatever the
   * geometry says. The drone spawns a kilometre ahead of the player, so without
   * this it would leave PATROL on frame one and the state would exist only in
   * the log. It is also plain fairness: no engagement begins the instant the
   * player presses R.
   */
  engageDelay: 5.0,

  /**
   * §8 — comparable to the player, never permanently faster. The player's
   * maximum is well above `reposition`, so separation is always achievable.
   */
  speed: { patrol: 168, pursuit: 198, aggressive: 228, reposition: 234, accel: 26 },

  /** §7 — the whole reason it reads as an aircraft. */
  turnRateDeg: 12,
  pitchRateDeg: 7,
  maxPitchDeg: 22,

  // Cosmetic bank, derived from the yaw rate actually achieved this frame.
  bankPerRate: 3.4,
  maxBankDeg: 68,

  /** §6 — lead the player, then aim at a point behind them: a pursuit curve. */
  pursuitPrediction: 1.1,
  trailFactor: 0.16,
  trailMin: 60,
  trailMax: 320,

  /** §9 — attack geometry. Gameplay parameters, tuned visually. */
  attack: { minRange: 520, maxRange: 2500, coneDeg: 28 },

  /** §10/§11 — acquisition takes visible time, then a beat before launch. */
  lockTime: 1.25,
  lockDrain: 1.8, // multiplier on progress drain while geometry is invalid
  launchDelay: 0.55,

  /** §33/§34 — no missile spam, finite pressure. */
  cooldown: 7.0,
  ammo: 2,

  /** §35 — break away, then turn back. */
  breakTime: 3.2,
  breakTurnDeg: 15,
  repositionTime: 5.0,
  repositionOffset: 900,

  /**
   * Stage 04.1 §15 — reacting to the player's lock.
   *
   * The delay is the feature, not an implementation compromise. A hostile that
   * breaks on the frame the lock completes is reading the player's HUD, and it
   * feels like it: the shot becomes impossible and the player learns that
   * locking is pointless. `reaction` is roughly the time the AIM-9 needs to
   * launch, so a player who is ready gets their shot away and a player who
   * hesitates watches the target leave. That is the whole skill expression.
   *
   * The break is also deliberately beatable — it turns hard in ONE direction for
   * a fixed time, so it can overshoot, expose its planform, and end up worse off
   * than it started (§15). Readable opposition, not an optimal defence.
   */
  defend: { reaction: 0.9, time: 2.8, turnDeg: 15, pitchDeg: 14, rateScale: 2.1, cooldown: 6.0 },

  // Keeps the hostile out of the ocean and out of the stratosphere without a
  // terrain query: it is an opponent, not a physics object.
  minAltitude: 240,
  maxAltitude: 3400,
};

/**
 * §14/§17 — the hostile round. Same implementation as the AIM-9, different
 * numbers: slower, less agile, shorter-legged, tighter fuze. Passed per-missile
 * to the shared missile system rather than forking it.
 */
export const HOSTILE_MISSILE = {
  separationTime: 0.12,
  separationDown: 3.2,
  separationOut: 1.0,
  separationDamping: 4.0,

  inheritFactor: 0.9,
  minLaunchSpeed: 150,
  thrust: 420,
  boostTime: 1.5,
  /**
   * §17: 320–420. Near the top of the band on purpose — the hostile's preferred
   * geometry is the player's rear hemisphere (§6), so most shots are stern
   * chases where only the 160 m/s of closure over a fleeing 250 m/s player
   * counts. At 380 a long tail shot could not physically arrive inside its
   * lifetime, which would make the enemy's whole magazine decorative.
   */
  maxSpeed: 410,
  dragAfterBoost: 12,

  /**
   * §18 — strong but limited. At 380 m/s, 26°/s is an 837 m turn radius, which a
   * hard crossing turn by a 250 m/s player can defeat. The AIM-9's 55°/s would
   * be unloseable at these ranges.
   */
  turnRateDeg: 26,
  lifetime: 9.5, // §17: 6–10, long enough for a stern shot to arrive
  hitRadius: 8, // §19: 6–10
  maxLeadTime: 1.0,

  /** §28 — past this required turn the round has been beaten; it stops guiding. */
  overshootAngleDeg: 95,
  trailPoints: 44,
};

/* ---- pure geometry and steering (the testable half) ---- */

export const wrapPi = (a) => a - TAU * Math.round(a / TAU);

/** Heading/pitch/range of `to` as seen from `from`. Flight-model convention. */
export function aimAngles(from, to, out = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const flat = Math.hypot(dx, dz);
  out.range = Math.hypot(dx, dy, dz);
  // heading 0 = -Z, matching the flight model and the drone entity.
  out.heading = Math.atan2(-dx, -dz);
  out.pitch = Math.atan2(dy, Math.max(flat, 1e-6));
  return out;
}

/** Unit forward from heading/pitch. Same convention as the drone's velocity. */
export function forwardFrom(heading, pitch, out = {}) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(heading) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(heading) * cp;
  return out;
}

/** Angle off the hostile's nose to a world point, in degrees. */
export function offNoseDeg(heading, pitch, from, to) {
  const f = forwardFrom(heading, pitch, {});
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return 0;
  const dot = (dx * f.x + dy * f.y + dz * f.z) / len;
  return Math.acos(clamp(dot, -1, 1)) / DEG;
}

/**
 * Move `current` toward `desired` by at most `maxRate * dt`. This one function
 * is the entire "no instant rotation" guarantee (§7); everything else just
 * chooses a desired angle.
 */
export function steerAngle(current, desired, maxRate, dt, wrap = true) {
  const delta = wrap ? wrapPi(desired - current) : desired - current;
  const step = Math.abs(maxRate) * dt;
  return current + clamp(delta, -step, step);
}

/** §6 — the player, `t` seconds from now, at constant velocity. */
export function predictPoint(pos, vel, t, out = {}) {
  out.x = pos.x + (vel ? vel.x : 0) * t;
  out.y = pos.y + (vel ? vel.y : 0) * t;
  out.z = pos.z + (vel ? vel.z : 0) * t;
  return out;
}

/** §9 — may acquisition begin? Range band AND forward cone, both required. */
export function inAttackCone(range, angleDeg, cfg = HOSTILE) {
  return range >= cfg.attack.minRange && range <= cfg.attack.maxRange && angleDeg <= cfg.attack.coneDeg;
}

/** Keeps a desired pitch from flying the hostile into the sea or off the top. */
export function altitudeGuard(y, desiredPitch, cfg = HOSTILE) {
  if (y < cfg.minAltitude) return Math.max(desiredPitch, 6 * DEG);
  if (y > cfg.maxAltitude) return Math.min(desiredPitch, -6 * DEG);
  return clamp(desiredPitch, -cfg.maxPitchDeg * DEG, cfg.maxPitchDeg * DEG);
}

/**
 * §3 — the whole transition table, in one pure function. Attack conditions live
 * here and nowhere else: no update loop may promote its own state.
 *
 * @param ai   { phase, ammo, cooldown, timer, lockProgress, launched, defendReady }
 * @param ctx  { alive, playerAlive, ready, range, inCone }
 */
export function hostileTransition(ai, ctx, cfg = HOSTILE) {
  const S = HostileState;
  if (!ctx.alive) return S.DESTROYED;
  switch (ai.phase) {
    case S.DESTROYED:
      return S.DESTROYED;
    case S.PATROL:
      return ctx.playerAlive && ctx.ready !== false && ctx.range <= cfg.detectRange ? S.PURSUIT : S.PATROL;
    case S.PURSUIT:
      if (ctx.range > cfg.disengageRange) return S.PATROL;
      // §15 — being locked outranks looking for a shot. A hostile that pressed on
      // into a completed lock would simply be a target.
      if (ai.defendReady) return S.DEFEND;
      if (ai.ammo > 0 && ai.cooldown <= 0 && ctx.inCone) return S.ACQUIRE;
      return S.PURSUIT;
    case S.ACQUIRE:
      if (ai.defendReady) return S.DEFEND;
      if (ai.lockProgress >= 1) return S.ATTACK;
      if (ai.lockProgress <= 0 && !ctx.inCone) return S.PURSUIT;
      return S.ACQUIRE;
    case S.ATTACK:
      // Deliberately NOT interruptible: it is 0.55 s from lock to launch, and a
      // hostile that could be talked out of a shot it had already committed to
      // would never land one.
      return ai.launched ? S.COOLDOWN : S.ATTACK;
    case S.DEFEND:
      return ai.timer <= 0 ? S.PURSUIT : S.DEFEND;
    case S.COOLDOWN:
      return ai.timer <= 0 ? S.REPOSITION : S.COOLDOWN;
    case S.REPOSITION:
      if (ai.defendReady) return S.DEFEND;
      return ai.timer <= 0 ? S.PURSUIT : S.REPOSITION;
    default:
      return S.PATROL;
  }
}

/** Target speed for a phase. Kept beside the states so pacing reads in one place. */
export function phaseSpeed(phase, cfg = HOSTILE) {
  const S = HostileState;
  switch (phase) {
    case S.PATROL:
      return cfg.speed.patrol;
    case S.ACQUIRE:
    case S.ATTACK:
      return cfg.speed.aggressive;
    case S.DEFEND:
    case S.COOLDOWN:
    case S.REPOSITION:
      return cfg.speed.reposition;
    case S.DESTROYED:
      return 0;
    default:
      return cfg.speed.pursuit;
  }
}

/**
 * §15 — which way to break, and how hard. Away from the player's line of sight
 * rather than away from the hostile's own nose: the point is to leave the cone
 * the player is aiming down, and that cone is defined from the player.
 *
 * Returns the sign of the turn. Chosen by cross product so the break is never a
 * coin flip that turns through the aircraft shooting at it.
 */
export function breakDirection(from, to, heading) {
  const f = forwardFrom(heading, 0, {});
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return f.x * dz - f.z * dx >= 0 ? -1 : 1;
}

/* ---- the stateful driver ---- */

/**
 * @param drone   the entity from enemy.js — this AI owns its heading/pitch/speed
 * @param patrol  (drone, dt) => void, the scripted path used while unengaged
 */
export function createHostileAI({ drone, patrol = updateTargetDrone, integrate = integrateDrone, cfg = HOSTILE }) {
  const events = { launch: [], phase: [] };
  const emit = (kind, payload) => events[kind].forEach((fn) => fn(payload));

  const ai = {
    phase: HostileState.PATROL,
    prevPhase: HostileState.PATROL,
    timer: 0,
    cooldown: 0,
    age: 0,
    lockProgress: 0,
    ammo: cfg.ammo,
    launched: false,
    breakDir: 1,
    range: 0,
    angleDeg: 0,
    inCone: false,
    // Published for the dev rail and the player's threat display.
    tracking: false,
    locked: false,
    /**
     * Stage 04.0 §5/§42 — an inactive hostile is not simulated at all. The
     * mission director owns this flag; nothing in here sets it.
     */
    active: true,
    encounters: 0,
    /**
     * §15 — how long the player's lock has been held on us, and whether that has
     * passed the reaction delay. `defendCooldown` stops a sustained lock turning
     * the hostile into a permanent evasion loop it can never be shot out of.
     */
    lockedOn: false,
    defendCue: 0,
    defendReady: false,
    defendCooldown: 0,
    defends: 0,
    /**
     * Which way the break turns, LATCHED on entry. Recomputing it per frame
     * looks reasonable and is not: as the hostile turns away the cross product
     * flips sign, the break reverses, and the aircraft oscillates to a net
     * heading change of nothing. Stage 03.3's COOLDOWN already solved this by
     * choosing a side once at launch; this is the same rule.
     */
    defendDir: 1,
    breakCandidate: 1,
  };

  const _aim = {};
  const _pred = { x: 0, y: 0, z: 0 };
  const _goal = { x: 0, y: 0, z: 0 };

  function enter(next) {
    if (next === ai.phase) return;
    ai.prevPhase = ai.phase;
    ai.phase = next;
    const S = HostileState;
    if (next === S.ACQUIRE) ai.lockProgress = 0;
    if (next === S.ATTACK) ai.timer = cfg.launchDelay;
    if (next === S.DEFEND) {
      ai.timer = cfg.defend.time;
      ai.defendCue = 0;
      ai.defendReady = false;
      ai.defendCooldown = cfg.defend.cooldown;
      ai.defends += 1;
      ai.defendDir = ai.breakCandidate;
    }
    if (next === S.COOLDOWN) ai.timer = cfg.breakTime;
    if (next === S.REPOSITION) ai.timer = cfg.repositionTime;
    if (next !== S.ACQUIRE && next !== S.ATTACK) ai.lockProgress = 0;
    if (next === S.PATROL) ai.launched = false;
    emit("phase", { phase: next, from: ai.prevPhase });
  }

  /**
   * @param ctx { position, velocity, alive }  the player, as published state
   */
  function update(ctx, dt) {
    const S = HostileState;
    // §5 — do not simulate an enemy the player cannot perceive or interact with.
    if (!ai.active) {
      ai.tracking = ai.locked = false;
      ai.lockProgress = 0;
      return ai;
    }
    if (!drone.alive) {
      if (ai.phase !== S.DESTROYED) enter(S.DESTROYED);
      ai.tracking = ai.locked = false;
      ai.lockProgress = 0;
      return ai;
    }

    // Geometry first: every transition condition is derived from it.
    aimAngles(drone.position, ctx.position, _aim);
    ai.range = _aim.range;
    ai.angleDeg = offNoseDeg(drone.heading, drone.pitch, drone.position, ctx.position);
    ai.inCone = inAttackCone(ai.range, ai.angleDeg, cfg);
    // Which way a break WOULD go from here. Sampled every frame, consumed once,
    // when DEFEND is entered.
    ai.breakCandidate = breakDirection(drone.position, ctx.position, drone.heading);

    if (ai.cooldown > 0) ai.cooldown = Math.max(0, ai.cooldown - dt);
    if (ai.timer > 0) ai.timer = Math.max(0, ai.timer - dt);
    if (ai.defendCooldown > 0) ai.defendCooldown = Math.max(0, ai.defendCooldown - dt);
    ai.age += dt;

    /* §15 — the reaction to being locked. The cue accumulates only while the
     * lock is actually held, so a lock that breaks before the reaction delay
     * elapses provokes nothing: a fleeting lock is not a threat the hostile
     * should be able to see. */
    ai.lockedOn = !!ctx.locked;
    if (ai.lockedOn && ai.defendCooldown <= 0 && ai.phase !== S.ATTACK) {
      ai.defendCue += dt;
    } else if (!ai.lockedOn) {
      ai.defendCue = 0;
    }
    ai.defendReady = ai.defendCue >= cfg.defend.reaction && ai.defendCooldown <= 0;

    // Acquisition is the only thing that accumulates, and only in ACQUIRE.
    if (ai.phase === S.ACQUIRE) {
      ai.lockProgress = ai.inCone
        ? Math.min(1, ai.lockProgress + dt / cfg.lockTime)
        : Math.max(0, ai.lockProgress - (dt * cfg.lockDrain) / cfg.lockTime);
    }

    // ATTACK fires exactly once, when its launch delay runs out.
    ai.launched = false;
    if (ai.phase === S.ATTACK && ai.timer <= 0 && ai.ammo > 0) {
      ai.ammo -= 1;
      ai.cooldown = cfg.cooldown;
      ai.launched = true;
      // Break away from whichever side the player is on, so the escape is not
      // a coin flip that sometimes flies through them.
      const f = forwardFrom(drone.heading, drone.pitch, {});
      const dx = ctx.position.x - drone.position.x;
      const dz = ctx.position.z - drone.position.z;
      ai.breakDir = f.x * dz - f.z * dx >= 0 ? -1 : 1;
      emit("launch", { ai, drone });
    }

    enter(hostileTransition(ai, { alive: drone.alive, playerAlive: ctx.alive !== false, ready: ai.age >= cfg.engageDelay, range: ai.range, inCone: ai.inCone }, cfg));
    ai.tracking = ai.phase === S.ACQUIRE;
    ai.locked = ai.phase === S.ATTACK;

    // Speed eases toward the phase target — a state change is not a throttle jump.
    const wanted = phaseSpeed(ai.phase, cfg);
    const dv = clamp(wanted - drone.speed, -cfg.speed.accel * dt, cfg.speed.accel * dt);
    drone.speed += dv;

    if (ai.phase === S.PATROL) {
      // Unengaged: the scripted racetrack, levelling out of whatever the last
      // engagement left behind.
      drone.pitch = steerAngle(drone.pitch, 0, cfg.pitchRateDeg * DEG, dt, false);
      if (patrol) patrol(drone, dt);
      return ai;
    }

    /* ---- pick an aim point, then steer toward it at a limited rate ---- */
    const lead = cfg.pursuitPrediction;
    predictPoint(ctx.position, ctx.velocity, lead, _pred);
    _goal.x = _pred.x;
    _goal.y = _pred.y;
    _goal.z = _pred.z;

    if (ai.phase === S.PURSUIT) {
      // Aim behind the player rather than at them: at long range that is a
      // curve into the rear hemisphere, and close in it collapses to a
      // near-direct chase (§6).
      const v = ctx.velocity;
      const vlen = v ? Math.hypot(v.x, v.y, v.z) : 0;
      if (vlen > 1) {
        const trail = clamp(ai.range * cfg.trailFactor, cfg.trailMin, cfg.trailMax);
        _goal.x -= (v.x / vlen) * trail;
        _goal.y -= (v.y / vlen) * trail;
        _goal.z -= (v.z / vlen) * trail;
      }
    } else if (ai.phase === S.DEFEND) {
      /* §15 — the defensive break. Hard turn away from the player's line of
       * sight plus a pitch component, at a little over twice the normal rate,
       * for a fixed time. No aim point: it is trying to LEAVE a cone, not to
       * arrive anywhere, and the fixed duration is what lets it overshoot and
       * hand the player a second chance. */
      const dir = ai.defendDir;
      const desiredHeading = drone.heading + dir * cfg.defend.turnDeg * DEG;
      // Down and away if there is room, up if there is not: a descending break
      // trades altitude for turn rate, which is what an aircraft actually does.
      const wantPitch = drone.position.y > cfg.minAltitude + 400 ? -cfg.defend.pitchDeg * DEG : cfg.defend.pitchDeg * DEG;
      stepAttitude(drone, desiredHeading, altitudeGuard(drone.position.y, wantPitch, cfg), dt, cfg.defend.rateScale);
      integrate(drone, dt);
      return ai;
    } else if (ai.phase === S.COOLDOWN) {
      // Scripted break: hold a turn away from the player and fly out (§35).
      // No aim point at all — this is the one phase that ignores the target.
      const desiredHeading = drone.heading + ai.breakDir * cfg.breakTurnDeg * DEG;
      stepAttitude(drone, desiredHeading, altitudeGuard(drone.position.y, 0, cfg), dt);
      integrate(drone, dt);
      return ai;
    } else if (ai.phase === S.REPOSITION) {
      // Turn back, but toward a point offset to one side of the player, so it
      // arrives with an angle instead of merging head-on.
      const f = forwardFrom(drone.heading, drone.pitch, {});
      const lx = -f.z;
      const lz = f.x;
      _goal.x = ctx.position.x + lx * ai.breakDir * cfg.repositionOffset;
      _goal.z = ctx.position.z + lz * ai.breakDir * cfg.repositionOffset;
    }

    aimAngles(drone.position, _goal, _aim);
    stepAttitude(drone, _aim.heading, altitudeGuard(drone.position.y, _aim.pitch, cfg), dt);
    integrate(drone, dt);
    return ai;
  }

  /** Rate-limited attitude change, plus the cosmetic bank it implies. */
  function stepAttitude(d, desiredHeading, desiredPitch, dt, rateScale = 1) {
    const h0 = d.heading;
    d.heading = steerAngle(d.heading, desiredHeading, cfg.turnRateDeg * rateScale * DEG, dt);
    d.pitch = steerAngle(d.pitch, desiredPitch, cfg.pitchRateDeg * rateScale * DEG, dt, false);
    const rate = dt > 1e-6 ? wrapPi(d.heading - h0) / dt : 0;
    d.targetBank = clamp(-rate * cfg.bankPerRate, -cfg.maxBankDeg * DEG, cfg.maxBankDeg * DEG);
  }

  function reset() {
    ai.phase = ai.prevPhase = HostileState.PATROL;
    ai.timer = 0;
    ai.cooldown = 0;
    ai.age = 0;
    ai.lockProgress = 0;
    ai.ammo = cfg.ammo;
    ai.launched = false;
    ai.tracking = ai.locked = false;
    ai.range = 0;
    ai.angleDeg = 0;
    ai.inCone = false;
    ai.breakDir = 1;
    ai.active = true;
    ai.encounters = 0;
    ai.lockedOn = false;
    ai.defendCue = 0;
    ai.defendReady = false;
    ai.defendCooldown = 0;
    ai.defends = 0;
    ai.defendDir = 1;
    ai.breakCandidate = 1;
    return ai;
  }

  /**
   * Stage 04.0 §5 — phase activation. A disabled hostile stops thinking AND
   * stops being drawn, so DECK, TERRAIN and EXTRACTION cost nothing for an enemy
   * that is not part of them.
   */
  function setActive(on) {
    ai.active = !!on;
    drone.root.visible = ai.active && drone.alive;
    return ai.active;
  }

  /**
   * Stage 04.0 §42/§43 — reuse, not spawning.
   *
   * One hostile instance serves INTERCEPT, DEFENSIVE and FINAL: it is reset,
   * repositioned relative to the player and given the ammunition that encounter
   * calls for. `ammo: 0` is how INTERCEPT is made one-way — the transition table
   * already refuses to promote PURSUIT to ACQUIRE without a round, so "it does
   * not shoot back yet" needs no new state and no special case.
   *
   * @param at     world position to place it at
   * @param heading heading to place it on
   * @param ammo    rounds for this encounter
   * @param engageDelay seconds of PATROL before it may engage
   */
  function deploy({ at, heading = 0, ammo = cfg.ammo, engageDelay = null, speed = null } = {}) {
    // The encounter count survives the reset: it is a record of how many times
    // this instance has been used, which is exactly what reset() must not erase.
    const encounters = ai.encounters + 1;
    reset();
    ai.encounters = encounters;
    ai.ammo = ammo;
    // A negative age is how the engage delay is expressed per encounter without
    // mutating the shared config: `ready` is age >= cfg.engageDelay.
    ai.age = engageDelay === null ? 0 : cfg.engageDelay - engageDelay;
    if (at) drone.position.set(at.x, at.y, at.z);
    drone.heading = heading;
    drone.pitch = 0;
    drone.bank = 0;
    drone.targetBank = 0;
    drone.speed = speed === null ? cfg.speed.patrol : speed;
    drone.alive = true;
    drone.health = drone.maxHealth;
    drone.hitAt = -1;
    drone.leg = 0;
    drone.legTime = 0;
    drone.root.rotation.set(0, heading, 0);
    integrate(drone, 0);
    setActive(true);
    return ai;
  }

  return {
    state: ai,
    cfg,
    update,
    reset,
    setActive,
    deploy,
    /** §25 — the attack cycle is over: magazine gone and nothing left to run. */
    get spent() {
      return ai.ammo <= 0 && ai.cooldown <= 0;
    },
    on(kind, fn) {
      events[kind].push(fn);
    },
  };
}
