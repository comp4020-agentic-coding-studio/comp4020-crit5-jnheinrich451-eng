// CollisionEvent and the response POLICIES. CLAUDE.md §4, §8, stage 3.
//
//   physics.js  ->  CollisionEvent  ->  a response POLICY
//
// physics DETECTS and knows nothing else; a policy decides what the event
// MEANS. Both policies implement the same two-method interface so a developer
// key (`G`) can swap them live with byte-identical detection:
//
//   handleCollision(event) -> boolean   did the policy act on it?
//   tick(dt)                            drive whatever it started
//
// §4's corollary, worth restating where it is easiest to break: no weapon,
// missile or physics module may call anything that resets the flight state. If
// that seems necessary, the policy is being written in the wrong place.

import { applyFlightState } from "./flight.js";

// Speed is bled on restore: returning at 250 m/s into the same valley usually
// buys about a second before the next impact.
const REWIND_SPEED_CAP = 160;
// The stick that flew into the mountain must not be reapplied on the restore
// frame, so control is neutralised for a moment after the rewind.
const GRACE_SECONDS = 0.55;
// A predicted hazard is dodged rather than rewound -- see handleCollision.
const DODGE_PITCH = 0.42;
const DODGE_SECONDS = 0.9;

/**
 * The development policy: rewind out of trouble and keep flying.
 *
 * This is the one that makes terrain development bearable. It ACTS on a
 * forward prediction, dodging before the impact happens. Stage 7's mission
 * policy must DECLINE predictions instead -- failing a mission for a crash
 * that has not happened is the worst class of failure there is.
 */
export function createDevelopmentRecovery({ physics, getState, onEvent }) {
  let grace = 0;
  let dodge = 0;
  let recoveries = 0;
  let dodges = 0;
  let last = null;

  function rewind(event) {
    const state = getState();
    const target = physics.rewindTarget();
    if (!target) {
      // Nothing safe on record -- lift clear of the ground below rather than
      // leaving the aircraft inside it. A policy that can fail to act is a
      // policy that can freeze the game.
      state.position.y = physics.groundAt(state.position.x, state.position.z) + 260;
      state.pitch = 0;
      state.bank = 0;
    } else {
      applyFlightState(state, target);
    }
    state.speed = Math.min(state.speed, REWIND_SPEED_CAP);
    state.sink = 0;
    grace = GRACE_SECONDS;
    recoveries++;
    // Clear the history: everything in it is from the run that just failed,
    // and the newest entries are the approach to this very impact.
    physics.clearHistory();
    if (onEvent) onEvent({ kind: "recover", event, recoveries });
  }

  return {
    name: "DevelopmentRecoveryResponse",

    handleCollision(event) {
      last = event;
      if (event.predicted) {
        // The automatic dodge. Pitch up and hold it briefly rather than
        // rewinding -- the impact has not happened, and rewinding for a
        // prediction would make the aircraft unflyable near terrain.
        if (dodge <= 0) {
          dodge = DODGE_SECONDS;
          dodges++;
          if (onEvent) onEvent({ kind: "dodge", event, dodges });
        }
        return true;
      }
      rewind(event);
      return true;
    },

    tick(dt) {
      if (grace > 0) grace = Math.max(0, grace - dt);
      if (dodge > 0) {
        dodge = Math.max(0, dodge - dt);
        const state = getState();
        // Command the climb through the ordinary attitude, not by teleporting:
        // the renderer and camera then need no special case.
        if (state.pitch < DODGE_PITCH) {
          state.pitch = Math.min(DODGE_PITCH, state.pitch + dt * 2.4);
        }
        state.bank *= Math.exp(-3 * dt);
      }
    },

    reset() {
      grace = 0;
      dodge = 0;
      last = null;
    },

    // While the grace runs, the input that flew into the mountain is
    // neutralised. main.js asks; the policy does not reach into input.js.
    overridesInput: () => grace > 0,
    isDodging: () => dodge > 0,
    graceRemaining: () => grace,
    stats: () => ({ recoveries, dodges, last }),
  };
}

/**
 * A policy that declines everything. Stands in for stage 7's mission policy
 * until it exists, and exists now so the `G` swap is testable: the point of
 * the split is that DETECTION is byte-identical under both, and that cannot
 * be asserted with only one policy in the build.
 */
export function createNullResponse() {
  let declined = 0;
  return {
    name: "NullResponse",
    handleCollision(event) {
      // §8: a policy that declines a PREDICTION still leaves physics to set
      // its own cooldown, or the same prediction is raised every tick.
      declined++;
      return false;
    },
    tick() {},
    reset() {
      declined = 0;
    },
    overridesInput: () => false,
    stats: () => ({ declined }),
  };
}
