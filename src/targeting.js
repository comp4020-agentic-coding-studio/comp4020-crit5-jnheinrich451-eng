/**
 * Stage 03.0 — targeting.
 *
 * Deliberately knows nothing about the HUD, the missile, or the player: it is
 * handed an observer (position + forward), a list of candidate targets and a
 * screen-offset function, and it publishes a lock state. A SAM site or an enemy
 * fighter can own one of these later without a line changing.
 */

export const LockState = { NONE: "NONE", ACQUIRING: "ACQUIRING", LOCKED: "LOCKED" };

/** Why a candidate failed, for HUD copy. */
export const LockFail = {
  NO_TARGET: "NO TARGET",
  OUT_OF_RANGE: "OUT OF RANGE",
  TOO_CLOSE: "TOO CLOSE",
  OFF_BORESIGHT: "OFF BORESIGHT",
};

export const TARGETING = {
  maxRange: 5500,
  minRange: 120,
  // Half-angle of the seeker cone, measured off the aircraft's nose.
  coneDeg: 32,
  // Radial distance in NDC (0 = screen centre, 1 = screen edge). Keeps lock
  // tied to what the player can actually see, per §15.
  screenRadius: 0.62,
  acquireTime: 0.75,
  // A lock survives this long outside the cone before it breaks, so a hard
  // bank or a target crossing the reticle edge does not strobe the HUD.
  holdTime: 0.35,
  // Multiplier on the drain of acquisition progress while invalid.
  drainFactor: 2.5,
};

const DEG = Math.PI / 180;

/**
 * Range and off-boresight angle from an observer to a point. Pure; no THREE.
 * `forward` must be unit length.
 */
export function targetGeometry(position, forward, targetPos, out = {}) {
  const dx = targetPos.x - position.x;
  const dy = targetPos.y - position.y;
  const dz = targetPos.z - position.z;
  const range = Math.hypot(dx, dy, dz);
  const dot = range > 1e-6 ? (dx * forward.x + dy * forward.y + dz * forward.z) / range : 1;
  out.range = range;
  out.angleDeg = Math.acos(Math.min(1, Math.max(-1, dot))) / DEG;
  return out;
}

/**
 * Can this candidate be acquired right now? `screenOffset` is the NDC radius,
 * or null when the target is behind the camera.
 */
export function qualifies({ range, angleDeg, screenOffset }, cfg = TARGETING) {
  if (range > cfg.maxRange) return { valid: false, reason: LockFail.OUT_OF_RANGE };
  if (range < cfg.minRange) return { valid: false, reason: LockFail.TOO_CLOSE };
  if (angleDeg > cfg.coneDeg) return { valid: false, reason: LockFail.OFF_BORESIGHT };
  if (screenOffset === null || screenOffset === undefined || screenOffset > cfg.screenRadius) {
    return { valid: false, reason: LockFail.OFF_BORESIGHT };
  }
  return { valid: true, reason: null };
}

/**
 * One step of the lock machine. Mutates and returns `lock`:
 *   { state, progress, invalidFor }
 * NONE -> ACQUIRING on a valid candidate, ACQUIRING -> LOCKED when progress
 * fills, LOCKED -> NONE only after holdTime outside the envelope.
 */
export function advanceLock(lock, valid, dt, cfg = TARGETING) {
  if (valid) {
    lock.invalidFor = 0;
    if (lock.state === LockState.LOCKED) return lock;
    lock.progress = Math.min(1, lock.progress + dt / cfg.acquireTime);
    lock.state = lock.progress >= 1 ? LockState.LOCKED : LockState.ACQUIRING;
    return lock;
  }

  lock.invalidFor += dt;
  if (lock.state === LockState.LOCKED) {
    if (lock.invalidFor >= cfg.holdTime) {
      lock.state = LockState.NONE;
      lock.progress = 0;
    }
    return lock;
  }

  lock.progress = Math.max(0, lock.progress - (dt * cfg.drainFactor) / cfg.acquireTime);
  lock.state = lock.progress > 0 ? LockState.ACQUIRING : LockState.NONE;
  return lock;
}

/**
 * Stateful wrapper. `update` is given the observer and the world's candidates;
 * `state` is the only thing consumers read.
 */
export function createTargetingSystem(cfg = TARGETING) {
  const lock = { state: LockState.NONE, progress: 0, invalidFor: 0 };
  const geom = { range: 0, angleDeg: 0 };

  const state = {
    currentTarget: null,
    lockState: LockState.NONE,
    lockProgress: 0,
    targetRange: 0,
    offBoresightDeg: 0,
    screenOffset: null,
    onScreen: false,
    valid: false,
    reason: LockFail.NO_TARGET,
  };

  /**
   * @param observer  { position, forward } — forward unit length
   * @param targets   array of { position, alive } (alive optional)
   * @param screenOffsetOf  (target) => NDC radius or null when off-camera
   */
  function update(observer, targets, screenOffsetOf, dt) {
    // Nearest valid candidate wins; with one enemy this is auto-acquisition,
    // and it stays correct when there are several (§34 — no cycling UI needed).
    let best = null;
    let bestGeom = null;
    let bestOffset = null;
    let bestReason = LockFail.NO_TARGET;

    for (const t of targets || []) {
      if (!t || t.alive === false) continue;
      targetGeometry(observer.position, observer.forward, t.position, geom);
      const offset = screenOffsetOf ? screenOffsetOf(t) : 0;
      const q = qualifies({ range: geom.range, angleDeg: geom.angleDeg, screenOffset: offset }, cfg);
      if (!q.valid) {
        // Remember the closest failing candidate so the HUD can explain itself.
        if (!best && (!bestGeom || geom.range < bestGeom.range)) {
          bestGeom = { range: geom.range, angleDeg: geom.angleDeg };
          bestOffset = offset;
          bestReason = q.reason;
          state.currentTarget = t;
        }
        continue;
      }
      if (!best || geom.range < bestGeom.range) {
        best = t;
        bestGeom = { range: geom.range, angleDeg: geom.angleDeg };
        bestOffset = offset;
        bestReason = null;
      }
    }

    // A locked target that briefly fails keeps the lock alive through holdTime.
    if (!best && lock.state === LockState.LOCKED && state.currentTarget) {
      const held = state.currentTarget;
      if (held.alive !== false) {
        targetGeometry(observer.position, observer.forward, held.position, geom);
        bestGeom = { range: geom.range, angleDeg: geom.angleDeg };
        bestOffset = screenOffsetOf ? screenOffsetOf(held) : 0;
      }
    }

    if (best) state.currentTarget = best;
    else if (!bestGeom) state.currentTarget = null;

    advanceLock(lock, !!best, dt, cfg);
    if (lock.state === LockState.NONE && !best) state.currentTarget = state.currentTarget || null;

    state.lockState = lock.state;
    state.lockProgress = lock.progress;
    state.valid = !!best;
    state.reason = best ? null : bestReason;
    state.targetRange = bestGeom ? bestGeom.range : 0;
    state.offBoresightDeg = bestGeom ? bestGeom.angleDeg : 0;
    state.screenOffset = bestOffset;
    state.onScreen = bestOffset !== null && bestOffset !== undefined && bestOffset <= 1;
    return state;
  }

  function clear() {
    lock.state = LockState.NONE;
    lock.progress = 0;
    lock.invalidFor = 0;
    state.currentTarget = null;
    state.lockState = LockState.NONE;
    state.lockProgress = 0;
    state.targetRange = 0;
    state.valid = false;
    state.reason = LockFail.NO_TARGET;
    state.screenOffset = null;
    state.onScreen = false;
  }

  /** Fire authority lives with targeting, not with the HUD or the input layer. */
  const canFire = () => lock.state === LockState.LOCKED && !!state.currentTarget;

  return { state, lock, update, clear, canFire, cfg };
}
