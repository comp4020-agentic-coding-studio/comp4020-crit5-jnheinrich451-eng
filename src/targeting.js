// Candidate selection and lock progression. CLAUDE.md §5, stage 5.
//
// Knows nothing about the HUD, the missile, or which weapon is selected. It is
// handed candidates and an observer, and it publishes what it is tracking.
//
// HANDING IT AN EMPTY CANDIDATE LIST IS THE NORMAL WAY TO DISABLE IT. Stage 7's
// mission does exactly that between encounters. There is deliberately no
// `enabled` flag: a second way to switch something off is a second thing to get
// out of step with the first.

import { isTargetable } from "./enemy.js";

export const LOCK_SECONDS = 1.25;
// A lock decays faster than it builds. Losing the target should cost the
// player something immediately; regaining it should not be instant.
const DECAY_RATE = 2.2;

// Beyond these a candidate is not worth tracking at all.
const MAX_ANGLE = (42 * Math.PI) / 180;
const MAX_RANGE = 9000;

export const NONE = "NONE";
export const TRACK = "TRACK";
export const LOCK = "LOCK";

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Angle between the observer's nose and a point, in radians. */
export function angleTo(observer, point) {
  const d = sub(point, observer.position);
  const n = len(d);
  if (n === 0) return 0;
  const f = observer.forward;
  const c = dot(d, f) / (n * Math.hypot(f.x, f.y, f.z));
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

/**
 * Score a candidate. Lower is better.
 *
 * Angle dominates and range breaks ties: a target on the nose at 6 km is a
 * more plausible intention than one 30 degrees off at 800 m, because the
 * player has to point at the thing they mean.
 */
export function scoreCandidate(observer, target) {
  const d = sub(target.position, observer.position);
  const range = len(d);
  const angle = angleTo(observer, target.position);
  if (angle > MAX_ANGLE || range > MAX_RANGE) return null;
  return { target, range, angle, score: angle * 4 + range / MAX_RANGE };
}

export function selectTarget(observer, candidates) {
  let best = null;
  for (const target of candidates) {
    if (!isTargetable(target)) continue;
    const scored = scoreCandidate(observer, target);
    if (!scored) continue;
    if (!best || scored.score < best.score) best = scored;
  }
  return best;
}

export function createTargeting({ lockSeconds = LOCK_SECONDS } = {}) {
  let currentTarget = null;
  let progress = 0;
  let range = Infinity;
  let angle = Infinity;

  function publish() {
    return {
      currentTarget,
      lockState: !currentTarget ? NONE : progress >= 1 ? LOCK : TRACK,
      lockProgress: progress,
      range,
      angle,
    };
  }

  return {
    /**
     * @param dt seconds
     * @param candidates anything publishing the target contract
     * @param observer {position, forward}
     */
    update(dt, candidates, observer) {
      const best = candidates && observer ? selectTarget(observer, candidates) : null;

      if (!best) {
        // No candidate: the lock decays and the target is dropped. This is the
        // path an empty list takes, which is how the mission disables it.
        progress = Math.max(0, progress - DECAY_RATE * dt);
        if (progress === 0) currentTarget = null;
        range = Infinity;
        angle = Infinity;
        return publish();
      }

      // Progress only while the SAME candidate is tracked. Switching targets
      // restarts the lock rather than inheriting the previous one's progress.
      if (best.target !== currentTarget) {
        currentTarget = best.target;
        progress = 0;
      }
      range = best.range;
      angle = best.angle;
      progress = Math.min(1, progress + dt / lockSeconds);
      return publish();
    },

    /** Drop everything. Used on a kill, a respawn or a phase change. */
    clear() {
      currentTarget = null;
      progress = 0;
      range = Infinity;
      angle = Infinity;
      return publish();
    },
    state: publish,
  };
}
