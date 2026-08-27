/**
 * Stage 02.3 — collision response.
 *
 * Detection lives in physics.js and answers one question: "what am I touching".
 * This file answers the other one: "what should happen about it". The two are
 * joined only by a CollisionEvent, so the development rewind implemented here
 * can later be swapped for a crash sequence without the terrain index, the
 * probes or the forward query changing at all.
 *
 *   WorldPhysics -> CollisionEvent -> CollisionResponse
 *
 * Deliberately THREE-free: events carry plain {x, y, z}, so every policy below
 * is unit-testable without a scene.
 */
import { applyFlightState, captureFlightState } from "./flight.js";

export const CollisionType = { TERRAIN: "TERRAIN", OCEAN: "OCEAN" };

export const RECOVERY = {
  // ~2 s of history at 15 Hz. Enough to rewind well behind an impact, small
  // enough that the whole buffer is 32 pooled snapshots.
  historySeconds: 2.0,
  sampleHz: 15,

  // Rewind target. The newest safe state is the trap: it sits one query before
  // the impact, pointing at the same rock, so restoring it re-impacts inside a
  // frame or two. 0.65 s upstream is far enough to fly out of.
  rewindTime: 0.65,

  // A state only counts as safe with real air around it, and "real" scales with
  // speed: 40 m at 110 m/s, ~88 m at 250 m/s.
  minSafeClearance: 40,
  safeClearanceFactor: 0.35,

  // Arriving back at 250 m/s re-flies the impact. Capped, with the throttle
  // lever moved to match so the engine model does not immediately spool back up.
  maxSpeed: 160,

  // Short neutral window so the stick input that caused the impact is not
  // instantly reapplied. Long enough to read as a reset, short enough not to
  // feel like lost control.
  controlGrace: 0.3,

  // Push off the surface along a blend of the triangle normal and world up.
  // The Ireland mesh has spiky faces; a pure face normal can point sideways.
  offset: 4,
  normalBlend: 0.5,

  feedbackSeconds: 0.9,
};

/** Speed-scaled clearance a state must have to be worth rewinding to. */
export function requiredSafeClearance(speed) {
  return Math.max(RECOVERY.minSafeClearance, (speed || 0) * RECOVERY.safeClearanceFactor);
}

/**
 * The one thing detection hands to response. `forwardHit` records that the
 * trigger was an imminent look-ahead hazard rather than a body already inside
 * the surface — a distinction the HUD (and later a warning tone) wants kept.
 */
export function createCollisionEvent({ type, position, normal, speed, timestamp, forwardHit = false, distance = 0, probe = null }) {
  return {
    type,
    position: { x: position.x, y: position.y, z: position.z },
    normal: normal ? { x: normal.x, y: normal.y, z: normal.z } : { x: 0, y: 1, z: 0 },
    speed: speed || 0,
    timestamp: timestamp || 0,
    forwardHit,
    distance,
    probe,
  };
}

const blank = () => ({
  time: 0,
  position: { x: 0, y: 0, z: 0 },
  quat: { x: 0, y: 0, z: 0, w: 1 },
  speed: 0,
  throttle: 0,
  mode: null,
  minimumClearance: 0,
});

/**
 * Bounded, time-ordered safe-state history.
 *
 * Sampled on a timer rather than per frame, and written into pooled snapshots,
 * so a two-hour session allocates the same 32 objects as the first second.
 */
export function createSafeStateHistory({ seconds = RECOVERY.historySeconds, sampleHz = RECOVERY.sampleHz } = {}) {
  const interval = 1 / sampleHz;
  const states = [];
  const pool = [];
  let lastSampleTime = -Infinity;

  const release = (s) => {
    if (pool.length < 64) pool.push(s);
  };

  function prune(time) {
    while (states.length && time - states[0].time > seconds) release(states.shift());
  }

  /** @returns true when a snapshot was actually taken. */
  function sample(time, flightState, minimumClearance) {
    prune(time);
    if (time - lastSampleTime < interval) return false;
    lastSampleTime = time;
    const s = pool.pop() || blank();
    const src = flightState;
    s.time = time;
    s.position.x = src.position.x;
    s.position.y = src.position.y;
    s.position.z = src.position.z;
    s.quat.x = src.quat.x;
    s.quat.y = src.quat.y;
    s.quat.z = src.quat.z;
    s.quat.w = src.quat.w;
    s.speed = src.speed;
    s.throttle = src.throttle;
    s.mode = src.mode;
    s.minimumClearance = Number.isFinite(minimumClearance) ? minimumClearance : Infinity;
    states.push(s);
    return true;
  }

  /**
   * Newest state at or before (time - rewind); the oldest state if the whole
   * buffer is newer than that; null if there is no history at all.
   */
  function pick(time, rewind = RECOVERY.rewindTime) {
    if (!states.length) return null;
    const cutoff = time - rewind;
    for (let i = states.length - 1; i >= 0; i--) {
      if (states[i].time <= cutoff) return states[i];
    }
    return states[0];
  }

  /** Drop everything newer than a restored state — those led into the impact. */
  function trimTo(time) {
    while (states.length && states[states.length - 1].time > time) release(states.pop());
    lastSampleTime = -Infinity;
  }

  function clear() {
    while (states.length) release(states.pop());
    lastSampleTime = -Infinity;
  }

  return {
    sample,
    pick,
    trimTo,
    clear,
    prune,
    states,
    get length() {
      return states.length;
    },
    get span() {
      return states.length ? states[states.length - 1].time - states[0].time : 0;
    },
    get oldest() {
      return states[0] || null;
    },
    get newest() {
      return states[states.length - 1] || null;
    },
  };
}

/**
 * Offset direction for a recovery: away from the surface, but leaned toward
 * world up so a near-vertical face normal cannot shove the aircraft sideways
 * into the next triangle.
 */
export function recoveryNormal(event, out = { x: 0, y: 1, z: 0 }) {
  if (event.type === CollisionType.OCEAN) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
    return out;
  }
  const b = RECOVERY.normalBlend;
  out.x = event.normal.x * b;
  out.y = 1 - b + event.normal.y * b;
  out.z = event.normal.z * b;
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l;
  out.y /= l;
  out.z /= l;
  return out;
}

const _n = { x: 0, y: 1, z: 0 };

/**
 * The development policy: rewind, bleed speed, hand the controls back.
 *
 * It is not a crash and it is not a bounce — no reflection, no restitution,
 * nothing that makes an F-15 behave like a ball. A future GameCrashResponse
 * implements the same handleCollision(event) and physics never knows.
 */
export function createDevelopmentRecoveryResponse({ history, flightState, onRestore, clearInput, fallbackReset } = {}) {
  let graceRemaining = 0;
  let feedbackRemaining = 0;
  let count = 0;
  const last = { type: null, rewind: 0, fallback: false, forwardHit: false, at: 0, index: 0 };

  function handleCollision(event) {
    const target = history.pick(event.timestamp, RECOVERY.rewindTime);
    let fallback = false;

    if (target) {
      applyFlightState(flightState, target, { maxSpeed: RECOVERY.maxSpeed });
      recoveryNormal(event, _n);
      flightState.position.x += _n.x * RECOVERY.offset;
      flightState.position.y += _n.y * RECOVERY.offset;
      flightState.position.z += _n.z * RECOVERY.offset;
      history.trimTo(target.time);
    } else {
      fallback = true;
      if (fallbackReset) fallbackReset();
      history.clear();
    }

    count++;
    last.type = event.type;
    last.rewind = target ? Math.max(0, event.timestamp - target.time) : 0;
    last.fallback = fallback;
    last.forwardHit = !!event.forwardHit;
    last.at = event.timestamp;
    last.index = count;

    graceRemaining = RECOVERY.controlGrace;
    feedbackRemaining = RECOVERY.feedbackSeconds;
    if (clearInput) clearInput();
    if (onRestore) onRestore(last);
    return last;
  }

  function tick(dt) {
    if (graceRemaining > 0) graceRemaining = Math.max(0, graceRemaining - dt);
    if (feedbackRemaining > 0) feedbackRemaining = Math.max(0, feedbackRemaining - dt);
  }

  function reset() {
    graceRemaining = 0;
    feedbackRemaining = 0;
    last.type = null;
    last.rewind = 0;
    last.fallback = false;
  }

  return {
    name: "DevelopmentRecoveryResponse",
    handleCollision,
    tick,
    reset,
    last,
    get graceRemaining() {
      return graceRemaining;
    },
    get feedbackRemaining() {
      return feedbackRemaining;
    },
    get recoveries() {
      return count;
    },
    /** "RECOVERED · TERRAIN" while the feedback window is open. */
    get feedback() {
      return feedbackRemaining > 0 && last.type ? `RECOVERED \u00b7 ${last.type}` : null;
    },
  };
}

/**
 * Stage 04.0 §39/§40 — the MISSION response policy.
 *
 * This is the whole reason detection and response were separated in Stage 02.3.
 * Terrain collision is not touched: the same CollisionEvent now arrives at a
 * policy that fails the sortie and restores a checkpoint instead of rewinding
 * two thirds of a second. Swapping the two is one call to physics.setResponse().
 *
 * It also serves missile hits, through trigger(), so a mission failure looks and
 * lasts the same however it was earned. That matters more than it sounds: a
 * player who cannot tell "you flew into a mountain" from "you were shot down"
 * apart from the word on screen has one failure model to learn, not two.
 *
 * @param onFail     (reason) => void   feedback: the word, the sound, the shake
 * @param onRestore  (reason) => void   put the aircraft back (the director does)
 * @param onSettled  ()       => void   the fade is out; the mission is live again
 */
export const MISSION_FAILURE = {
  /**
   * Stage 04.7 — this is the CRASH WINDOW, and it is why there is no separate
   * crash state machine.
   *
   * It was 0.28 s: long enough for a HIT label and nothing else, which is what
   * §39 asked for at the time. The crash presentation needs the aircraft to be
   * visibly destroyed BEFORE the fade starts — tumbling, burning, shedding a
   * smoke trail — so the window grew to 1.2 s and the presentation renders
   * against this clock. The policy's existing guarantees carry over unchanged:
   * `active` already refuses re-entry (§33), the restore already happens at full
   * black (§31), and the fade back in already hides the teleport (§32).
   *
   * Total impact to playable: 1.2 + 0.5 + 0.62 = 2.32 s.
   */
  hold: 1.2,
  fadeOut: 0.5,
  fadeIn: 0.62,
  // Refuse new failures across the whole sequence and a little past it, for the
  // same reason the Stage 03.3 hit response does: a proximity fuze or a terrain
  // probe can trip on consecutive frames, and a re-entrant policy loops forever.
  // With a tumbling aircraft still intersecting terrain this is now load-bearing
  // rather than defensive (§33).
  cooldown: 0.55,
};

export function createMissionCheckpointResponse({ onFail = null, onRestore = null, onSettled = null, cfg = MISSION_FAILURE } = {}) {
  const state = { active: false, stage: "idle", t: 0, fade: 0, reason: null, count: 0, cooldown: 0 };
  /**
   * The last frame stamp this policy was advanced on.
   *
   * The policy has two callers -- physics.update() normally, and the frame loop
   * directly whenever physics is skipped (a crash, or scripted flight). Both
   * firing in one frame ran the whole 2.32 s sequence at double speed and, far
   * worse, let a restore land in the middle of a frame that had already decided
   * a crash was in progress -- which wrote the wreck's pose over the fresh
   * respawn and cost the player another aircraft. Deduping on a caller-supplied
   * stamp makes that impossible instead of merely discouraged.
   *
   * A caller that passes no stamp always ticks: the tests and the Stage 02.2
   * call sites predate this and are single-caller by construction.
   */
  let lastFrame = null;

  /** @returns true when this failure was accepted, false when swallowed. */
  function trigger(reason) {
    if (state.active || state.cooldown > 0) return false;
    state.active = true;
    state.stage = "hold";
    state.t = 0;
    state.reason = reason || "IMPACT";
    state.count += 1;
    if (onFail) onFail(state.reason);
    return true;
  }

  /**
   * The CollisionResponse contract physics.js already speaks.
   *
   * Look-ahead events are DECLINED. Detection fires on
   * `physicalContact || forwardImminent`, and the second of those is a
   * prediction: the probe is clear, but a ray says the ground is close ahead.
   * Under the development policy that prediction was the whole feature — it
   * rewound the aircraft before it ever touched anything, an automatic dodge on
   * the player's behalf. Carried into a mission it becomes a failure for a crash
   * that has not happened, which is the worst kind: the player is levelling out
   * of a valley, clears the ridge, and the run ends anyway.
   *
   * So the mission fails on contact and only on contact. Physics still sets its
   * own cooldown when we decline, so the aircraft simply keeps flying — and if
   * the prediction was right, real contact arrives a moment later and fails the
   * run for a reason the player can see.
   */
  function handleCollision(event) {
    if (event.forwardHit) return state;
    trigger(event.type === CollisionType.OCEAN ? "OCEAN IMPACT" : "TERRAIN IMPACT");
    return state;
  }

  function tick(dt, frame) {
    if (frame !== undefined && frame !== null && frame === lastFrame) return state;
    lastFrame = frame ?? lastFrame;
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
    if (!state.active) {
      state.fade = Math.max(0, state.fade - dt / cfg.fadeIn);
      return state;
    }
    state.t += dt;
    if (state.stage === "hold") {
      if (state.t >= cfg.hold) {
        state.stage = "out";
        state.t = 0;
      }
    } else if (state.stage === "out") {
      state.fade = Math.min(1, state.t / cfg.fadeOut);
      if (state.t >= cfg.fadeOut) {
        // Restored at full black: the player never sees the teleport.
        if (onRestore) onRestore(state.reason);
        state.stage = "in";
        state.t = 0;
      }
    } else if (state.stage === "in") {
      state.fade = Math.max(0, 1 - state.t / cfg.fadeIn);
      if (state.t >= cfg.fadeIn) {
        state.active = false;
        state.stage = "idle";
        state.fade = 0;
        state.cooldown = cfg.cooldown;
        if (onSettled) onSettled();
      }
    }
    return state;
  }

  function reset() {
    state.active = false;
    state.stage = "idle";
    state.t = 0;
    state.fade = 0;
    state.reason = null;
    state.cooldown = 0;
    return state;
  }

  return {
    name: "MissionCheckpointResponse",
    state,
    cfg,
    trigger,
    handleCollision,
    tick,
    reset,
    get graceRemaining() {
      // Controls stay neutral for the whole sequence: the stick that flew into
      // the mountain must not be reapplied on the restore frame.
      return state.active ? 1 : 0;
    },
    get feedbackRemaining() {
      return state.active ? 1 : 0;
    },
    get recoveries() {
      return state.count;
    },
    get feedback() {
      return state.active ? state.reason : null;
    },
    /** The dev rail reads the same `last` shape the development policy exposes. */
    last: state,
  };
}

/** Snapshot of the live state, for callers that want one outside the history. */
export const snapshotOf = captureFlightState;

/** Neutral control axes for the post-recovery grace window. */
export const NEUTRAL_INPUT = Object.freeze({ x: 0, y: 0, roll: 0, throttle: 0 });
