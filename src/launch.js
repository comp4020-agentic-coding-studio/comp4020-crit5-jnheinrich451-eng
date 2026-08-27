/**
 * Stage 04.0 §6–§14 — the scripted carrier launch.
 *
 * This is not flight physics and it deliberately does not use any (§9). The
 * aircraft is attached to the launch reference frame and moved along it by an
 * authored speed curve; the flight model is not running at all until the handoff,
 * at which point it is seeded with exactly the position, attitude and speed the
 * script ended on (§14).
 *
 * Everything geometric comes from the carrier's measured LaunchStart/LaunchEnd
 * anchors (Stage 02.2) — there is no deck coordinate in this file. The stroke
 * DURATION is likewise solved from the measured run rather than authored, which
 * is the one decision in here worth stating: the deck run is 199 m, and a
 * hand-typed 2.0 s over it would mean either a 210 m/s deck exit or an aircraft
 * that stops accelerating halfway up the ship. Solving the time from the
 * geometry keeps both the exit speed and the release point honest, and the
 * clamp below keeps the *feel* inside the band the stage asks for.
 *
 * THREE-free on purpose: the caller hands in plain {x,y,z} anchor positions, so
 * the whole sequence is unit-testable without a scene.
 */

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;

export const LAUNCH = {
  /** Pivot height above the measured deck. The F-15's pivot is its bbox centre. */
  deckLift: 2.6,

  /**
   * §8 — the opening beats, in seconds from the start of the sequence.
   *
   * Stage 05.1 sets the deck dwell to the LENGTH OF THE ENGINE START-UP, played at
   * double speed — a ~22 s recording finishing in ~11 s. The sound is no longer
   * trimmed by the catapult: it runs to its end and the cat fires on the last
   * note, which is what makes the wait feel like a countdown rather than a delay.
   *
   * This couples two numbers in different files. If the recording is replaced,
   * `deckDwell` and `AUDIO.cues.ENGINE_START.rate` must be re-derived together:
   * dwell ≈ clipDuration / rate.
   */
  deckDwell: 11,
  spoolAt: 0.35, // engine start begins
  militaryAt: 7.6, // throttle visual reaches military
  afterburnerAt: 9.6, // AB ignition, plume and shock diamonds

  /**
   * §10 — gameplay numbers, not a real C-13. `end` is the deck-exit speed and
   * is re-solved if the stroke time clamps, so the release point always lands
   * on the LaunchEnd anchor.
   */
  startSpeed: 8,
  exitSpeed: 152,
  /**
   * §9 — the acceleration curve. An exponent above 1 means acceleration that
   * keeps increasing: slow tension, then a violent deck exit. 1.25 rather than
   * the suggested 2.0 because t² spends so little of the run at speed that a
   * 199 m stroke to 152 m/s would take 3.6 s, which is not "fast".
   */
  strokeExponent: 1.25,
  strokeMin: 2.2,
  strokeMax: 3.1,

  /* Climb-out: still scripted, but off the deck and rotating. */
  climbTime: 1.05,
  climbPitchDeg: 12,
  rotateTime: 0.45, // how long the nose takes to reach climb pitch
  gearUpAt: 0.58, // seconds into the climb-out (§7)
  handoffAt: 0.95, // seconds into the climb-out (§14)

  /** §10 — what the flight model is seeded with. */
  handoffSpeed: 172,
  // Handed over in afterburner rather than at the lever position that merely
  // holds 172 m/s: the plume must not die on the frame the player takes over,
  // and "released at full power" is the read the whole sequence is building to.
  handoffThrottle: 0.92,

  /** §12 — FOV. Tight on the deck, opening hard through the stroke. */
  fovDeck: 59,
  fovExit: 71,

  /**
   * §13 — cheap FX, reusing the existing camera-offset channel.
   *
   */
  /**
   * THE DECK IS STILL. The spool-up shake was removed from play: it runs for the
   * full 11 s of the engine start-up, before the player has touched anything,
   * and a camera that will not hold still for eleven seconds reads as a fault in
   * the game rather than as power in the aircraft.
   *
   * The catapult keeps its shake, which is the point — the contrast is what
   * makes the stroke hit. A still deck for eleven seconds and then the whole
   * frame moving at once is a harder cut than a shake that merely gets worse.
   */
  deckShimmer: 0,
  strokeShake: 0.3,

  /** §11 — how long the launch composition takes to hand the rig back. */
  viewBlendOut: 1.4,
};

/** §11 — the launch composition: closer, lower, tighter framing. */
export const LAUNCH_VIEW = {
  distance: 15.5,
  height: 3.2,
  framingY: -0.05,
  /**
   * The rig's forward damping is SCALED, not replaced: at 0.3 the camera swings
   * in behind the aircraft three times more slowly, which is what produces the
   * "camera position lags, aircraft surges forward" read the stage asks for.
   */
  lagScale: 0.3,
};

/* ---- the curve, as pure functions ---- */

/** Normalised acceleration profile. 0 at release, 1 at the release point. */
export const strokeEase = (u, exponent = LAUNCH.strokeExponent) => Math.pow(clamp01(u), exponent);

export function strokeSpeed(u, v0 = LAUNCH.startSpeed, v1 = LAUNCH.exitSpeed, exponent = LAUNCH.strokeExponent) {
  return lerp(v0, v1, strokeEase(u, exponent));
}

/**
 * Distance covered by the whole stroke. Closed form: the integral of
 * lerp(v0, v1, u^e) over u in 0..1 is v0 + (v1 - v0)/(e + 1).
 */
export function strokeDistance(time, v0 = LAUNCH.startSpeed, v1 = LAUNCH.exitSpeed, exponent = LAUNCH.strokeExponent) {
  return time * (v0 + (v1 - v0) / (exponent + 1));
}

/** Inverse of the above: the stroke time that covers `run` exactly. */
export function solveStrokeTime(run, v0 = LAUNCH.startSpeed, v1 = LAUNCH.exitSpeed, exponent = LAUNCH.strokeExponent) {
  const mean = v0 + (v1 - v0) / (exponent + 1);
  return mean > 1e-6 ? run / mean : 0;
}

/** ...and the other inverse: the exit speed that covers `run` in `time`. */
export function solveExitSpeed(run, time, v0 = LAUNCH.startSpeed, exponent = LAUNCH.strokeExponent) {
  if (time <= 1e-6) return v0;
  return v0 + (exponent + 1) * (run / time - v0);
}

/**
 * Reconcile the authored feel with the measured deck.
 *
 * Preferred: keep the authored exit speed and solve the time. If that time
 * falls outside the playable band it is clamped and the exit speed is re-solved
 * instead, so `strokeDistance(plan.time, v0, plan.exitSpeed)` is always the run
 * length — the aircraft leaves the cat at the release point, never before or
 * past it.
 */
export function planStroke(run, cfg = LAUNCH) {
  const wanted = solveStrokeTime(run, cfg.startSpeed, cfg.exitSpeed, cfg.strokeExponent);
  const time = clamp(wanted, cfg.strokeMin, cfg.strokeMax);
  const clamped = Math.abs(time - wanted) > 1e-6;
  const exitSpeed = clamped ? solveExitSpeed(run, time, cfg.startSpeed, cfg.strokeExponent) : cfg.exitSpeed;
  return { run, time, exitSpeed, clamped, wanted };
}

/** Total wall time from fade-in to control handoff, for one armed plan. */
export function sequenceDuration(plan, cfg = LAUNCH) {
  return cfg.deckDwell + plan.time + cfg.handoffAt;
}

/**
 * Throttle LEVER position during the opening (§8). Purely a visual: nothing is
 * accelerating the aircraft but the catapult.
 */
export function spoolThrottle(t, cfg = LAUNCH) {
  if (t < cfg.spoolAt) return 0.04;
  if (t < cfg.militaryAt) return lerp(0.04, 0.8, (t - cfg.spoolAt) / (cfg.militaryAt - cfg.spoolAt));  if (t < cfg.afterburnerAt) return lerp(0.8, 0.9, (t - cfg.militaryAt) / (cfg.afterburnerAt - cfg.militaryAt));
  return 1;
}

/** §12 — deck to exit, weighted by the square of stroke progress so it *opens*. */
export function launchFov(stage, u, cfg = LAUNCH) {
  if (stage === "DECK") return cfg.fovDeck;
  if (stage === "STROKE") return lerp(cfg.fovDeck, cfg.fovExit, clamp01(u) * clamp01(u));
  return cfg.fovExit;
}

/* ---- the sequence ---- */

export const LaunchStage = { IDLE: "IDLE", DECK: "DECK", STROKE: "STROKE", CLIMB: "CLIMB", DONE: "DONE" };

/**
 * @param cfg  LAUNCH, overridable for tests
 *
 * Usage: arm() with the two measured anchor positions, then update(dt) each
 * frame and copy `pose` into the flight state. `state.handoff` goes true on the
 * single frame the player receives control.
 */
export function createLaunchSequence({ cfg = LAUNCH } = {}) {
  const state = {
    stage: LaunchStage.IDLE,
    armed: false,
    t: 0,
    stroke: 0, // seconds into the catapult stroke
    climb: 0, // seconds into the climb-out
    u: 0, // 0..1 stroke progress
    distance: 0, // metres travelled along the launch axis
    speed: 0,
    throttle: 0,
    afterburner: false,
    gearDown: true,
    handoff: false, // true for exactly one frame
    done: false,
    /** True while the sequence is waiting for the caller (see update's `hold`). */
    held: false,
    plan: null,
    fov: cfg.fovDeck,
    shake: 0,
  };

  // The launch reference frame: an origin on the deck and a horizontal axis.
  const origin = { x: 0, y: 0, z: 0 };
  const axis = { x: 0, y: 0, z: -1 };
  const pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, speed: 0, throttle: 0, afterburner: false };

  /**
   * @param start  LaunchStart in world space (the deck spot the F-15 sits on)
   * @param end    LaunchEnd in world space (the release point, short of the bow)
   */
  function arm(start, end) {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const run = Math.hypot(dx, dz);
    axis.x = run > 1e-6 ? dx / run : 0;
    axis.z = run > 1e-6 ? dz / run : -1;
    origin.x = start.x;
    origin.y = start.y + cfg.deckLift;
    origin.z = start.z;
    state.plan = planStroke(run, cfg);
    state.armed = true;
    reset();
    return state.plan;
  }

  function reset() {
    state.stage = state.armed ? LaunchStage.DECK : LaunchStage.IDLE;
    state.t = 0;
    state.stroke = 0;
    state.climb = 0;
    state.u = 0;
    state.distance = 0;
    state.speed = 0;
    state.throttle = spoolThrottle(0, cfg);
    state.afterburner = false;
    state.gearDown = true;
    state.handoff = false;
    state.done = false;
    state.held = false;
    state.fov = cfg.fovDeck;
    state.shake = cfg.deckShimmer;
    pose.x = origin.x;
    pose.y = origin.y;
    pose.z = origin.z;
    pose.heading = Math.atan2(-axis.x, -axis.z);
    pose.pitch = 0;
    pose.speed = 0;
    pose.throttle = state.throttle;
    pose.afterburner = false;
    return state;
  }

  /**
   * Stage 05.4 — the deck can be HELD.
   *
   * A browser will not start audio before a user gesture, and the launch begins on
   * the first frame of a fresh load — so on load the engine start-up fired into a
   * blocked audio context, was marked as played, and the whole deck phase ran
   * silent. Pressing any key later armed the director, which is why cycling modes
   * appeared to "fix" it: the restart then had audio available from frame one.
   *
   * Rather than special-casing the cue, the sequence simply does not advance until
   * the caller says it may. The aircraft sits on the deck, shaking, and the
   * countdown starts when the sound can actually be heard.
   */
  function update(dt, hold = false) {
    state.handoff = false;
    if (!state.armed || state.done) return state;
    state.held = !!hold && state.stage === LaunchStage.DECK && state.t <= 0;
    if (state.held) return state;
    const plan = state.plan;
    state.t += dt;

    if (state.t < cfg.deckDwell) {
      // §6 — parked. Engines spool, the throttle rises, the burner lights, and
      // nothing moves. No wheel physics, no suspension, no throttle input.
      state.stage = LaunchStage.DECK;
      state.throttle = spoolThrottle(state.t, cfg);
      state.afterburner = state.t >= cfg.afterburnerAt;
      state.speed = 0;
      // No shake while parked. The engine start-up is the whole eleven seconds
      // of this stage and it is doing the work on its own; a shimmer that ramps
      // underneath it just makes the frame unsteady before the player has any
      // control to be unsteady with. The stroke below still shakes.
      state.shake = cfg.deckShimmer;
    } else {
      state.stroke = state.t - cfg.deckDwell;
      state.throttle = 1;
      state.afterburner = true;

      if (state.stroke < plan.time) {
        state.stage = LaunchStage.STROKE;
        state.u = clamp01(state.stroke / plan.time);
        state.speed = strokeSpeed(state.u, cfg.startSpeed, plan.exitSpeed, cfg.strokeExponent);
        // Position from the closed-form integral rather than accumulated dt, so
        // the release point is frame-rate independent and lands exactly on the
        // LaunchEnd anchor.
        state.distance = integratedDistance(state.stroke, plan);
        pose.x = origin.x + axis.x * state.distance;
        pose.y = origin.y;
        pose.z = origin.z + axis.z * state.distance;
        pose.pitch = 0;
        state.shake = cfg.strokeShake * state.u;
      } else {
        state.stage = LaunchStage.CLIMB;
        state.u = 1;
        state.climb = state.stroke - plan.time;
        const k = clamp01(state.climb / cfg.climbTime);
        state.speed = lerp(plan.exitSpeed, cfg.handoffSpeed, k);
        // Rotate off the deck rather than snapping to climb attitude.
        pose.pitch = cfg.climbPitchDeg * DEG * clamp01(state.climb / cfg.rotateTime);
        const cp = Math.cos(pose.pitch);
        pose.x += axis.x * cp * state.speed * dt;
        pose.z += axis.z * cp * state.speed * dt;
        pose.y += Math.sin(pose.pitch) * state.speed * dt;
        state.distance += state.speed * dt;
        // §7 — the gear switch is hidden inside the rotation and the burner
        // flash. Discrete variants, no animation, and an intentional cheat.
        state.gearDown = state.climb < cfg.gearUpAt;
        state.shake = cfg.strokeShake * (1 - k) * 0.6;

        if (state.climb >= cfg.handoffAt) {
          state.stage = LaunchStage.DONE;
          state.done = true;
          state.handoff = true;
          state.speed = cfg.handoffSpeed;
          state.throttle = cfg.handoffThrottle;
          state.gearDown = false;
          state.shake = 0;
        }
      }
    }

    state.fov = launchFov(state.stage === LaunchStage.DONE ? "CLIMB" : state.stage, state.u, cfg);
    pose.speed = state.speed;
    pose.throttle = state.throttle;
    pose.afterburner = state.afterburner;
    return state;
  }

  /** Closed-form distance at `t` seconds into the stroke. */
  function integratedDistance(t, plan) {
    const e = cfg.strokeExponent;
    const v0 = cfg.startSpeed;
    const v1 = plan.exitSpeed;
    const T = plan.time;
    const u = clamp01(t / T);
    // ∫0..t lerp(v0, v1, (s/T)^e) ds = v0*t + (v1-v0)*T*u^(e+1)/(e+1)
    return v0 * u * T + ((v1 - v0) * T * Math.pow(u, e + 1)) / (e + 1);
  }

  return {
    state,
    pose,
    cfg,
    arm,
    reset,
    update,
    /** Fraction of the whole sequence elapsed — drives the opening fade. */
    get progress() {
      return state.plan ? clamp01(state.t / sequenceDuration(state.plan, cfg)) : 0;
    },
    get axis() {
      return axis;
    },
  };
}
