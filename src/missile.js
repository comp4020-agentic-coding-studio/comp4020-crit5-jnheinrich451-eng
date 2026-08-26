// ONE missile implementation. CLAUDE.md §14, stage 5.
//
// missile.js MUST NEVER LEARN WHOSE ROUND IT IS. Stages 6 and 8 add the hostile
// and SAM rounds as CONFIGS, not as files. If this module ever grows an
// `if (owner === ...)`, the design has been lost.
//
// Three-free: the flight of a round is arithmetic, and it is the part worth
// testing. Visuals are the caller's problem.

// §14's table. Turn radius is v / omega, and the fairness claim of §14 is
// stated in radii: the F-15 turns at 1000 m at 250 m/s, so a hard crossing
// manoeuvre defeats these with no countermeasure at all.
export const AIM9 = {
  name: "AIM-9",
  maxSpeed: 900,
  turnRate: (55 * Math.PI) / 180,
  lifetime: 6.5,
  fuze: 22,
  separation: 0.18, // seconds of straight flight before guidance begins
  damage: 100,
};

// Beyond this angle AND with the range opening, the round has overshot.
const OVERSHOOT_ANGLE = (75 * Math.PI) / 180;
// Guidance authority is never reduced to zero (§14): a defeated round keeps
// flying its curve and can still get lucky on the fuze, so a miss reads as a
// miss rather than as the round switching off.
const MIN_AUTHORITY = 0.06;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });
function norm(v) {
  const n = len(v) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Has the round overshot?
 *
 * ANGLE ALONE IS NOT ENOUGH, and this is the subtle one. A round closing
 * head-on through a crossing geometry can sit well past the overshoot angle
 * while still reducing range fast -- calling that an overshoot makes it coast
 * past a target it would have hit. The range must be OPENING as well.
 */
export function hasOvershot(round, target, closingRate) {
  if (!target) return false;
  const toTarget = sub(target.position, round.position);
  const range = len(toTarget);
  if (range === 0) return false;
  const angle = Math.acos(
    Math.min(1, Math.max(-1, dot(norm(toTarget), norm(round.velocity)))),
  );
  return angle > OVERSHOOT_ANGLE && closingRate > 0;
}

/** Turn radius implied by a config, in metres. §14's fairness figure. */
export function turnRadius(config) {
  return config.maxSpeed / config.turnRate;
}

export function createMissileSystem({ authorityFor, onEvent } = {}) {
  const rounds = [];
  let nextId = 1;

  const authority = authorityFor ?? (() => 1);

  function emit(kind, round, extra) {
    if (onEvent) onEvent({ kind, round, ...extra });
  }

  return {
    rounds,

    /**
     * @param config one of the three data configs -- the module does not know
     *               which, and must not start caring.
     */
    fire({ config = AIM9, owner = "player", position, direction, speed = 0, target = null }) {
      const dir = norm(direction);
      const round = {
        id: nextId++,
        config,
        owner,
        target,
        position: { ...position },
        // Inherits the launcher's speed along its own axis, so a round fired
        // at 250 m/s does not appear to leave the rail backwards.
        velocity: scale(dir, Math.max(speed, config.maxSpeed * 0.35)),
        age: 0,
        alive: true,
        detonated: false,
        lastRange: target ? len(sub(target.position, position)) : Infinity,
      };
      rounds.push(round);
      emit("fire", round);
      return round;
    },

    update(dt, now = 0) {
      for (const round of rounds) {
        if (!round.alive) continue;
        round.age += dt;

        if (round.age >= round.config.lifetime) {
          round.alive = false;
          emit("expire", round, { reason: "lifetime" });
          continue;
        }

        // Accelerate toward the config's maximum along the current heading.
        const speed = len(round.velocity);
        const wanted = Math.min(round.config.maxSpeed, speed + 900 * dt);
        round.velocity = scale(norm(round.velocity), wanted);

        const target = round.target;
        const live = target && target.alive !== false;

        // SEPARATE BEFORE GUIDING. A round that steers on frame one looks as
        // though it was fired from the cockpit rather than from the rail.
        if (live && round.age >= round.config.separation && !round.givenUp) {
          const toTarget = sub(target.position, round.position);
          const range = len(toTarget);
          const closing = range - round.lastRange;
          round.lastRange = range;

          if (hasOvershot(round, target, closing)) {
            // Give up STEERING, not flying. The round keeps its curve.
            round.givenUp = true;
            emit("overshoot", round);
          } else {
            // The single counter-measure hook. The missile asks how much
            // guidance it still has and must never learn what a barrel roll, a
            // flare or a ridge is -- stages 6 and 8 attach all three here.
            const a = Math.max(MIN_AUTHORITY, Math.min(1, authority(round)));
            round.authority = a;

            const desired = norm(toTarget);
            const current = norm(round.velocity);
            const axis = cross(current, desired);
            const axisLen = len(axis);
            if (axisLen > 1e-9) {
              const angle = Math.acos(
                Math.min(1, Math.max(-1, dot(current, desired))),
              );
              const step = Math.min(angle, round.config.turnRate * a * dt);
              round.velocity = rotateAbout(round.velocity, scale(axis, 1 / axisLen), step);
            }
          }
        } else if (live) {
          round.lastRange = len(sub(target.position, round.position));
        }

        round.position.x += round.velocity.x * dt;
        round.position.y += round.velocity.y * dt;
        round.position.z += round.velocity.z * dt;

        // PROXIMITY FUZE, not exact intersection: two objects moving at a
        // combined 1100 m/s step ~18 m per frame, so an intersection test
        // would miss almost every time.
        if (live) {
          const range = len(sub(target.position, round.position));
          if (range <= round.config.fuze + (target.radius ?? 0)) {
            round.alive = false;
            round.detonated = true;
            emit("hit", round, { target, range });
            continue;
          }
        }
      }

      // Compact in place rather than reallocating: this runs every frame.
      for (let i = rounds.length - 1; i >= 0; i--) {
        if (!rounds[i].alive) rounds.splice(i, 1);
      }
    },

    /**
     * Retire one side's rounds at a phase transition WITHOUT deleting the
     * player's shot that is mid-flight. Stage 7 needs exactly this.
     */
    expireOwner(owner) {
      let retired = 0;
      for (let i = rounds.length - 1; i >= 0; i--) {
        if (rounds[i].owner === owner) {
          emit("expire", rounds[i], { reason: "owner" });
          rounds.splice(i, 1);
          retired++;
        }
      }
      return retired;
    },

    countFor: (owner) => rounds.filter((r) => r.owner === owner).length,
    clear() {
      rounds.length = 0;
    },
  };
}

/** Rodrigues rotation of v about a unit axis by `angle`. */
function rotateAbout(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return {
    x: v.x * c + k.x * s + axis.x * d,
    y: v.y * c + k.y * s + axis.y * d,
    z: v.z * c + k.z * s + axis.z * d,
  };
}
