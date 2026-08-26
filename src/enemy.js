// The target contract, and the drone that first publishes it. §5, stage 5.
//
// THE CONTRACT IS THE POINT. In stage 8 SAM sites publish this same shape, and
// targeting, the gun, the missile and the HUD bracket then work on ground
// targets with no special cases at all -- a lead solution needs a position and
// a velocity, and a SAM's velocity is zero. Design it as a contract, not as
// "the drone's fields".
//
// Three-free on purpose: everything here is exercised headlessly.

/**
 * @typedef {{
 *   position: {x:number,y:number,z:number},
 *   velocity: {x:number,y:number,z:number},
 *   alive: boolean, health: number, maxHealth: number,
 *   radius: number, label: string, hitAt: number,
 * }} Target
 */

export function createTarget({
  label = "TARGET",
  position = { x: 0, y: 0, z: 0 },
  velocity = { x: 0, y: 0, z: 0 },
  health = 100,
  radius = 9,
} = {}) {
  return {
    label,
    position: { ...position },
    velocity: { ...velocity },
    alive: true,
    health,
    maxHealth: health,
    radius,
    hitAt: -Infinity,
  };
}

/** Everything a consumer needs to treat an object as a target. */
export function isTargetable(t) {
  return (
    !!t &&
    t.alive === true &&
    t.position &&
    t.velocity &&
    typeof t.radius === "number" &&
    typeof t.label === "string"
  );
}

export function markTargetHit(target, at) {
  if (!target) return;
  target.hitAt = at;
}

/**
 * Apply damage. Returns true only on the transition to dead, so a caller can
 * award a kill exactly once however many rounds land in the same frame.
 */
export function damageTarget(target, amount, at) {
  if (!target || !target.alive) return false;
  target.health -= amount;
  markTargetHit(target, at);
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    return true;
  }
  return false;
}

/** How recently it was hit, 0..1, for a mesh flash that is not a number. */
export function hitFlash(target, now, duration = 0.18) {
  if (!target || !Number.isFinite(target.hitAt)) return 0;
  const since = now - target.hitAt;
  if (since < 0 || since > duration) return 0;
  return 1 - since / duration;
}

// ── the drone ──────────────────────────────────────────────────────────────
// A passive airframe flying a patrol so there is something to lock before
// stage 6 builds something that shoots back. It publishes the contract above
// and nothing else.

export function createDrone({
  label = "DRONE",
  centre = { x: 0, y: 900, z: -4000 },
  radiusPath = 900,
  speed = 150,
  health = 100,
  phase = 0,
} = {}) {
  const target = createTarget({
    label,
    position: { ...centre },
    health,
    radius: 9,
  });
  let t = phase;

  return {
    target,
    /** Fly the patrol. Velocity is WRITTEN, not inferred: the lead solution
     *  and the missile both read it, and a velocity derived by differencing
     *  positions lags by a frame at exactly the moment it matters. */
    update(dt) {
      if (!target.alive) {
        target.velocity.x = 0;
        target.velocity.y = 0;
        target.velocity.z = 0;
        return;
      }
      t += dt;
      const omega = speed / radiusPath;
      const a = t * omega;
      target.position.x = centre.x + Math.cos(a) * radiusPath;
      target.position.z = centre.z + Math.sin(a) * radiusPath;
      target.position.y = centre.y;
      target.velocity.x = -Math.sin(a) * speed;
      target.velocity.z = Math.cos(a) * speed;
      target.velocity.y = 0;
    },
    reset() {
      target.alive = true;
      target.health = target.maxHealth;
      target.hitAt = -Infinity;
      t = phase;
    },
  };
}
