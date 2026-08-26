// Hitscan cannon, tracers and the lead pipper. CLAUDE.md §14, stage 5.
//
// HITSCAN GAMEPLAY, OCCASIONAL TRACERS FOR VISUALS. A 20 mm burst at a
// believable rate would be hundreds of meshes a second; the shots are resolved
// instantly and only some are drawn.
//
// Three-free: the lead solution and the magazine are the parts worth testing.

export const MAGAZINE = 500;
// Rounds per second, and the muzzle velocity the lead solution assumes.
const RATE = 22;
const MUZZLE = 1020;
export const GUN_RANGE = 2400;
const CONE = (2.2 * Math.PI) / 180;
const DAMAGE = 9;
// Only one round in this many leaves a tracer.
const TRACER_EVERY = 3;
const TRACER_LIFE = 0.35;
const SHAKE = 0.055;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Where to aim for a moving target.
 *
 * Solve for the time of flight at which a round leaving now arrives where the
 * target will be: |P + Vt| = st. That is a quadratic in t, and the smaller
 * positive root is the first interception.
 *
 * The solution needs only a POSITION and a VELOCITY, which is exactly why it
 * works on ground targets for free in stage 8 -- a SAM's velocity is zero, and
 * the answer collapses to the target's own position.
 */
export function leadSolution(origin, target, muzzle = MUZZLE) {
  const p = sub(target.position, origin);
  const v = target.velocity ?? { x: 0, y: 0, z: 0 };

  const a = dot(v, v) - muzzle * muzzle;
  const b = 2 * dot(p, v);
  const c = dot(p, p);

  let t;
  if (Math.abs(a) < 1e-6) {
    // Target closing at exactly muzzle speed: the quadratic degenerates.
    t = Math.abs(b) > 1e-9 ? -c / b : 0;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return { point: { ...target.position }, time: 0, solved: false };
    const root = Math.sqrt(disc);
    const t1 = (-b + root) / (2 * a);
    const t2 = (-b - root) / (2 * a);
    const positive = [t1, t2].filter((x) => x > 0);
    if (positive.length === 0) {
      return { point: { ...target.position }, time: 0, solved: false };
    }
    t = Math.min(...positive);
  }

  return {
    point: {
      x: target.position.x + v.x * t,
      y: target.position.y + v.y * t,
      z: target.position.z + v.z * t,
    },
    time: t,
    solved: true,
  };
}

export function createGun({ magazine = MAGAZINE, onHit, addShake } = {}) {
  let rounds = magazine;
  let cooldown = 0;
  let fired = 0;
  const tracers = [];

  return {
    tracers,
    get rounds() {
      return rounds;
    },
    isEmpty: () => rounds <= 0,

    /**
     * @param firing whether the trigger is held
     * @param origin muzzle position
     * @param forward unit vector down the barrel
     * @param candidates anything publishing the target contract
     */
    update(dt, { firing, origin, forward, candidates = [], now = 0 }) {
      // Tracers age out whether or not the trigger is held.
      for (let i = tracers.length - 1; i >= 0; i--) {
        tracers[i].age += dt;
        if (tracers[i].age > TRACER_LIFE) tracers.splice(i, 1);
      }

      cooldown -= dt;
      if (!firing || rounds <= 0) return [];

      const hits = [];
      while (cooldown <= 0 && rounds > 0) {
        cooldown += 1 / RATE;
        rounds--;
        fired++;

        // Hitscan: resolve instantly against the cone.
        let hit = null;
        for (const target of candidates) {
          if (!target || target.alive === false) continue;
          const d = sub(target.position, origin);
          const range = len(d);
          if (range > GUN_RANGE || range === 0) continue;
          const cos = dot(d, forward) / range;
          if (cos <= 0) continue;
          const angle = Math.acos(Math.min(1, cos));
          // Widen the cone by the target's own size, so a big target is
          // genuinely easier to hit than a small one at the same range.
          if (angle > CONE + Math.atan2(target.radius ?? 0, range)) continue;
          if (!hit || range < hit.range) hit = { target, range };
        }

        if (hit) {
          hits.push(hit);
          if (onHit) onHit(hit.target, DAMAGE, now);
        }

        if (fired % TRACER_EVERY === 0) {
          tracers.push({
            from: { ...origin },
            to: hit
              ? { ...hit.target.position }
              : {
                  x: origin.x + forward.x * GUN_RANGE,
                  y: origin.y + forward.y * GUN_RANGE,
                  z: origin.z + forward.z * GUN_RANGE,
                },
            age: 0,
          });
        }
        if (addShake) addShake(SHAKE);
      }
      return hits;
    },

    /**
     * CLEANUP ONLY. Deliberately separate from reset(): a phase transition in
     * stage 7 takes the tracers, not the ammunition, and conflating the two
     * silently disarms the player at every phase change.
     */
    clearFx() {
      tracers.length = 0;
    },

    /** Reloads the magazine. This is NOT cleanup. */
    reset() {
      rounds = magazine;
      cooldown = 0;
      fired = 0;
    },

    setRounds(n) {
      rounds = Math.max(0, Math.min(magazine, n));
    },
  };
}
