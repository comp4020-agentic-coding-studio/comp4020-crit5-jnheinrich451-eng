// The scripted catapult launch. CLAUDE.md §9, stage 4.
//
// NO FLIGHT PHYSICS RUNS DURING THIS. The script writes the whole flight state
// and the renderer reads it, so the handoff has nothing to reconcile. No wheel
// physics, no suspension, no throttle input -- the player watches.
//
// This module imports no three.js: the curve and its two inverses are the
// part worth testing, and they are pure arithmetic.

import { BURNER_LEVER, isAfterburner, quatFromEulerYXZ } from "./flight.js";

// The speed curve across the stroke: speed(u) = lerp(V0, V1, u^EASE).
export const V0 = 8;
export const V1 = 152;
export const EASE = 1.25;

// EASE is 1.25, not 2.0. A t^2 curve needs 3.56 s to cover 199.7 m between
// these speeds, which is not "fast"; 1.25 still has acceleration increasing
// all the way to the deck edge, which is the read the sequence is building to.

// If the solved time falls outside this window, the TIME is clamped and the
// EXIT SPEED is re-solved instead, so the geometry always closes: the aircraft
// leaves at the release point on any deck, never before or past it.
export const STROKE_MIN = 2.2;
export const STROKE_MAX = 3.1;

// Handoff state, §9.
export const HANDOFF_SPEED = 172;
export const HANDOFF_THROTTLE = 0.92;
export const ROTATE_PITCH = (12 * Math.PI) / 180;

// Offsets after the release point.
const ROTATE_AFTER = 0.4;
const HANDOFF_AFTER = 0.9;
const GEAR_UP_AFTER = 0.58;

// The engine start-up is played at this rate, and the deck dwell is its
// duration divided by it -- see deckDwellFor().
export const ENGINE_START_RATE = 2;
const SHAKE_FROM = 0.02;
const SHAKE_TO = 0.16;
const BURNER_SHAKE_FACTOR = 1.5;

// ── THE SPOOL RAMP ─────────────────────────────────────────────────────────
//
// The dwell used to write a near-constant throttle while the camera shake
// ramped 0.02 -> 0.16, so the RIG told a spool-up story that the throttle, the
// afterburner and the engine visuals did not: an 11-second recording winding
// up against an aircraft that was already at 92% on frame one.
//
// Keyed in FRACTIONS OF THE DWELL, never in seconds. The dwell is derived from
// the start-up recording's own length (deckDwellFor), so a ramp authored in
// seconds would decouple the two again the moment the clip is replaced -- the
// same coupling defect the dwell itself was written to close.
//
//   0.00 -> 0.30   idle, then the first push
//   0.30 -> 0.87   the wind-up the recording is doing
//   0.87           burner lights and the throttle goes to the stop
//
export const SPOOL = {
  idleTo: 0.3,
  windTo: 0.87, // = burnerAt, as a fraction of the dwell
  idle: 0.18,
  push: 0.42,
  // THE TOP OF THE WIND-UP IS BURNER_LEVER, NOT AN AUTHORED 0.88.
  //
  // §9's ramp quotes 0.88, but flight.js puts the burner detent at 0.85 and
  // `state.afterburner` is driven by isAfterburner(throttle) so ONE RULE OWNS
  // IT. A wind-up that ran to 0.88 would therefore light the burner at
  // 0.83 x dwell -- before the point the sequence and its gate both name --
  // and the light would then be a side effect of the ramp rather than an
  // event. Topping out ON the detent makes 0.87 x dwell the exact frame the
  // burner lights, and derives the number instead of authoring a second one.
  wind: BURNER_LEVER,
  full: 1,
};

/**
 * Throttle at time `t` of a dwell of length `dwell`. Pure, so the ramp is
 * asserted directly rather than inferred from a running script.
 *
 * Monotonic non-decreasing across the whole dwell by construction: each
 * segment ends where the next begins, and the last step is upward.
 */
export function spoolThrottle(t, dwell) {
  if (!(dwell > 0)) return SPOOL.full;
  const f = t <= 0 ? 0 : t >= dwell ? 1 : t / dwell;
  if (f >= SPOOL.windTo) return SPOOL.full;
  if (f <= SPOOL.idleTo) {
    return SPOOL.idle + (SPOOL.push - SPOOL.idle) * (f / SPOOL.idleTo);
  }
  const u = (f - SPOOL.idleTo) / (SPOOL.windTo - SPOOL.idleTo);
  return SPOOL.push + (SPOOL.wind - SPOOL.push) * u;
}

// LAUNCH_VIEW, blended into the one rig -- never a second camera. §16.
export const LAUNCH_VIEW = {
  standoff: 15.5,
  height: 3.2,
  framingY: -0.05,
  lagScale: 0.34,
};
const LAUNCH_FOV_DECK = 59;
const LAUNCH_FOV_EXIT = 71;
const BLEND_OUT_SECONDS = 1.4;

// ── the stroke, in closed form ─────────────────────────────────────────────

/** Distance covered by the whole stroke of duration T. */
export function strokeDistance(T, v0 = V0, v1 = V1, e = EASE) {
  // integral of lerp(v0, v1, u^e) du over u in [0,1], times T:
  //   T * (v0 + (v1 - v0) / (e + 1))
  return T * (v0 + (v1 - v0) / (e + 1));
}

/** The duration that covers `distance` exactly. Inverts strokeDistance. */
export function solveStrokeTime(distance, v0 = V0, v1 = V1, e = EASE) {
  const perSecond = v0 + (v1 - v0) / (e + 1);
  return perSecond > 0 ? distance / perSecond : 0;
}

/** The exit speed that covers `distance` in exactly `T`. The other inverse. */
export function solveExitSpeed(distance, T, v0 = V0, e = EASE) {
  if (!(T > 0)) return v1Fallback(v0);
  return v0 + (distance / T - v0) * (e + 1);
}
const v1Fallback = (v0) => v0;

/** Speed at stroke progress u in [0, 1]. */
export function strokeSpeed(u, v0 = V0, v1 = V1, e = EASE) {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return v0 + (v1 - v0) * Math.pow(c, e);
}

/**
 * Distance travelled by time t into a stroke of duration T.
 *
 * From the closed-form integral, NOT accumulated dt, so the release point is
 * frame-rate independent: a 20 Hz frame reaches the same place as a 60 Hz one.
 */
export function strokePosition(t, T, v0 = V0, v1 = V1, e = EASE) {
  if (!(T > 0)) return 0;
  const u = t <= 0 ? 0 : t >= T ? 1 : t / T;
  return T * (v0 * u + ((v1 - v0) * Math.pow(u, e + 1)) / (e + 1));
}

/**
 * Solve the stroke against a MEASURED deck run.
 *
 * Returns the plan: how long the stroke takes, what speed it exits at, and
 * whether the time had to be clamped. §9 requires the geometry to close on any
 * deck -- so when the solved time is out of range it is the SPEED that gives,
 * never the release point.
 */
export function solveStroke(runLength, v0 = V0, v1 = V1, e = EASE) {
  const ideal = solveStrokeTime(runLength, v0, v1, e);
  if (ideal >= STROKE_MIN && ideal <= STROKE_MAX) {
    return { time: ideal, exitSpeed: v1, clamped: false, runLength };
  }
  const time = Math.min(Math.max(ideal, STROKE_MIN), STROKE_MAX);
  return {
    time,
    exitSpeed: solveExitSpeed(runLength, time, v0, e),
    clamped: true,
    runLength,
  };
}

/** The deck dwell is the start-up recording's own length at its playback rate. */
export function deckDwellFor(clipSeconds, rate = ENGINE_START_RATE) {
  return clipSeconds > 0 ? clipSeconds / rate : 11;
}

/** The whole timeline, derived from the two measurements it depends on. */
export function buildLaunchPlan({ runLength, clipSeconds }) {
  const stroke = solveStroke(runLength);
  const dwell = deckDwellFor(clipSeconds);
  const release = dwell + stroke.time;
  return {
    ...stroke,
    dwell,
    // Derived from the dwell, which is derived from the clip: the burner
    // lights on the recording's own last push, whatever length it is.
    burnerAt: dwell * SPOOL.windTo,
    fireAt: dwell,
    releaseAt: release,
    gearUpAt: release + GEAR_UP_AFTER,
    rotateAt: release + ROTATE_AFTER,
    handoffAt: release + HANDOFF_AFTER,
    total: release + HANDOFF_AFTER,
  };
}

// ── the runtime script ─────────────────────────────────────────────────────

export function createLaunch({
  anchors, clipSeconds, rig, setGear, onEvent, groundOffset = 0,
}) {
  const plan = buildLaunchPlan({
    runLength: anchors.runLength,
    clipSeconds: clipSeconds ?? 22,
  });

  // The launch reference frame: heading along the deck, toward -Z, with the
  // wheels ON the deck rather than the aircraft's centre at deck height.
  const heading = 0;
  const deckY = anchors.launchStart.y + groundOffset;
  let t = 0;
  let active = false;
  let handedOff = false;
  let blendOut = 0;
  const fired = new Set();

  function emit(name) {
    if (fired.has(name)) return;
    fired.add(name);
    if (onEvent) onEvent(name, plan);
  }

  function writeState(state) {
    const along = t <= plan.fireAt
      ? 0
      : strokePosition(t - plan.fireAt, plan.time, V0, plan.exitSpeed, EASE);

    state.position.x = anchors.launchStart.x;
    state.position.z = anchors.launchStart.z - along;
    state.heading = heading;
    state.bank = 0;
    state.sink = 0;

    if (t <= plan.fireAt) {
      state.speed = 0;
      state.pitch = 0;
      state.position.y = deckY;
      state.throttle = spoolThrottle(t, plan.dwell);
    } else if (t < plan.releaseAt) {
      state.speed = strokeSpeed(
        (t - plan.fireAt) / plan.time, V0, plan.exitSpeed, EASE,
      );
      state.pitch = 0;
      state.position.y = deckY;
      // The throttle HOLDS at the stop through the stroke: the catapult is not
      // the moment to come off the burner.
      state.throttle = SPOOL.full;
    } else {
      // Off the bow: rotate, climb away, and converge on the handoff state.
      const since = t - plan.releaseAt;
      const rotateU = Math.min(since / ROTATE_AFTER, 1);
      state.pitch = ROTATE_PITCH * rotateU;
      const speedU = Math.min(since / HANDOFF_AFTER, 1);
      state.speed = plan.exitSpeed + (HANDOFF_SPEED - plan.exitSpeed) * speedU;
      // Sink briefly off the deck edge before the wing takes over -- the deck
      // is 20 m up and a jet that rises instantly reads as a lift.
      const dip = Math.sin(Math.min(since / HANDOFF_AFTER, 1) * Math.PI) * 2.6;
      state.position.y =
        deckY - dip + since * state.speed * Math.sin(state.pitch) * 0.5;
      // Settle from the stop onto the handoff lever across the same window the
      // speed converges over, so the number the player inherits is one the
      // script arrived at rather than one it jumped to.
      state.throttle =
        SPOOL.full + (HANDOFF_THROTTLE - SPOOL.full) * Math.min(since / HANDOFF_AFTER, 1);
    }

    // ONE RULE OWNS THE AFTERBURNER: the lever position, read through
    // flight.js's own detent. A second condition here is how the HUD, the
    // sound and the plume come to disagree about whether it is lit.
    state.afterburner = isAfterburner(state.throttle);
    state.quat = quatFromEulerYXZ(state.heading, state.pitch, state.bank);
  }

  return {
    plan,

    start(state) {
      t = 0;
      active = true;
      handedOff = false;
      blendOut = 0;
      fired.clear();
      setGear?.(true); // parked on the deck, gear down
      writeState(state);
      rig?.reset(state);
      rig?.blend("launch", { ...LAUNCH_VIEW, fov: LAUNCH_FOV_DECK }, 1);
    },

    /**
     * Returns true while the script still owns the aircraft.
     *
     * `hold` is the audio gate (§9). A browser will not start audio before a
     * user gesture, and the launch begins on the first frame of a fresh load --
     * so an unheld deck fires the engine start-up into a blocked audio context,
     * marks it played, and runs the whole opening silent. (The symptom is
     * confusing: cycling game mode appears to "fix" it, because by then a
     * keypress has armed the director.) Callers pass `!audio.isArmed()`.
     *
     * THE HOLD APPLIES ONLY AT t = 0. It may DELAY a launch, never PAUSE one in
     * progress: an audio context that is lost or re-suspended mid-stroke must
     * not freeze an aircraft that is already 100 m down the deck with the
     * camera moving. Once the clock has advanced by a single frame the flag is
     * ignored for the rest of the sequence.
     */
    update(dt, state, hold = false) {
      if (!active) {
        // Blend the composition out over 1.4 s AFTER the handoff. By the time
        // it is gone the ordinary speed-driven FOV has arrived at the same
        // value from below, so there is no cut.
        if (blendOut > 0) {
          blendOut = Math.max(0, blendOut - dt);
          const w = blendOut / BLEND_OUT_SECONDS;
          const u = 1 - w;
          rig?.blend(
            "launch",
            {
              ...LAUNCH_VIEW,
              fov: LAUNCH_FOV_DECK + (LAUNCH_FOV_EXIT - LAUNCH_FOV_DECK) * u,
            },
            w,
          );
        }
        return false;
      }

      if (hold && t <= 0) {
        // Held: the aircraft sits on the deck shaking at the idle amplitude,
        // which is what makes the wait read as a jet running rather than as a
        // frozen frame. Nothing is emitted, so the countdown starts intact.
        writeState(state);
        rig?.setShake(SHAKE_FROM);
        return true;
      }

      t += dt;

      if (t >= plan.burnerAt) emit("burner");
      if (t >= plan.fireAt) emit("fire");
      if (t >= plan.releaseAt) emit("release");
      if (t >= plan.gearUpAt) {
        // A visibility swap, hidden inside the rotation and the burner flash.
        setGear?.(false);
        emit("gearUp");
      }

      writeState(state);

      // Shake ramps across the dwell rather than holding flat: a constant
      // vibration for ten seconds reads as a rendering artefact, not an engine
      // winding up. Everything goes through the ONE shake channel (§16).
      if (t <= plan.fireAt) {
        const u = plan.dwell > 0 ? t / plan.dwell : 1;
        let shake = SHAKE_FROM + (SHAKE_TO - SHAKE_FROM) * u;
        if (t >= plan.burnerAt) shake *= BURNER_SHAKE_FACTOR;
        rig?.setShake(shake);
      } else if (t < plan.releaseAt) {
        rig?.setShake(SHAKE_TO * 1.35);
      }

      // FOV opens weighted by the SQUARE of stroke progress, so the lens opens
      // rather than drifting.
      const strokeU =
        t <= plan.fireAt
          ? 0
          : Math.min((t - plan.fireAt) / plan.time, 1);
      rig?.blend(
        "launch",
        {
          ...LAUNCH_VIEW,
          fov:
            LAUNCH_FOV_DECK +
            (LAUNCH_FOV_EXIT - LAUNCH_FOV_DECK) * strokeU * strokeU,
        },
        1,
      );

      if (t >= plan.handoffAt && !handedOff) {
        handedOff = true;
        active = false;
        blendOut = BLEND_OUT_SECONDS;
        // Seed the flight model with exactly what the script ended on.
        state.speed = HANDOFF_SPEED;
        state.throttle = HANDOFF_THROTTLE;
        state.afterburner = isAfterburner(HANDOFF_THROTTLE);
        state.sink = 0;
        state.pitch = ROTATE_PITCH;
        state.bank = 0;
        state.quat = quatFromEulerYXZ(state.heading, state.pitch, state.bank);
        emit("handoff");
        return false;
      }
      return true;
    },

    isActive: () => active,
    hasHandedOff: () => handedOff,
    elapsed: () => t,
  };
}
