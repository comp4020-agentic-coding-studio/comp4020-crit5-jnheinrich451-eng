// The crash presentation. CLAUDE.md §15, stage 9.
//
// DO NOT BUILD A CRASH STATE MACHINE. MissionCheckpointResponse from stage 7
// already has the right shape -- trigger -> hold -> fade -> restore at black
// -> fade in -- so its `hold` stage IS the crash window (lengthened 0.28 ->
// 1.2 s) and this renders against that clock. Duplicate suppression then comes
// free: trigger() already refuses re-entry, which is exactly what stops a
// tumbling aircraft grinding through a mountain producing BOOM BOOM BOOM.
//
// CRASHING is NOT a new enum value. It is a THIRD OWNER of the aircraft
// transform, alongside the flight model and the launch script -- and one stale
// flag between the three is enough to strand the player.
//
// Three-free: the timeline, the variants and the spawn rule are the parts
// worth testing. combat-fx.js draws what this describes.

import { quatFromEulerYXZ, quatMultiply, quatNormalize } from "./flight.js";

export const T = {
  flash: 0.03,
  fireball: 0.08,
  tumble: 0.1,
  smoke: 0.15,
  sparks: 0.25,
  smokeStops: 1.1,
  fadeAircraft: 0.72,
  holdEnds: 1.2, // the policy's hold
  respawn: 1.7, // the policy's fadeOut ends -- restore at FULL BLACK
  playable: 2.32, // the policy's fadeIn ends
};

export const FLASH_SECONDS = 0.13;
export const FLASH_GROWTH = 3.4;
const TUMBLE_RAMP = 0.22;
const SMOKE_RATE = 15;
const SPARK_COUNT = 22;
const DEBRIS_COUNT = 4;
const GRAVITY = 9.81;
export const CAMERA_KICK = 0.62;
export const KICK_DECAY = 5.5;

// VARIANTS DIFFER AS DATA, NOT CODE PATHS (§15).
export const VARIANTS = {
  MISSILE: { fire: 1.0, smoke: 1.0, sparks: 1.0, mist: 0, forward: 1.0, sink: 0.55, visible: 1.0 },
  TERRAIN: { fire: 0.85, smoke: 1.25, sparks: 1.35, mist: 0.5, forward: 0.35, sink: 1.0, visible: 0.75 },
  // WATER NEEDS REAL WORK, NOT A PALETTE SWAP: a downward plunge impulse, 2.6x
  // gravity, and a visible window cut to a third, so the aircraft is hidden
  // BEFORE it is under the surface. Without the plunge it drifts two metres in
  // three quarters of a second and visibly skates along the top.
  OCEAN: { fire: 0.28, smoke: 0.7, sparks: 0.55, mist: 1.4, forward: 0.18, sink: 2.6, visible: 0.34 },
};
export const OCEAN_PLUNGE = 34;

/**
 * Map the failure reason to a variant IN ONE PLACE, so a new failure reason
 * cannot silently inherit the wrong explosion.
 */
export function causeFor(reason) {
  if (reason === "missile" || reason === "hit") return "MISSILE";
  if (reason === "ocean" || reason === "water") return "OCEAN";
  if (reason === "terrain" || reason === "ground") return "TERRAIN";
  // An unknown reason still gets a presentation -- silence would read as a
  // freeze, which is worse than the wrong explosion.
  return "TERRAIN";
}

/**
 * Where a respawn can safely go.
 *
 * SAMPLE A CORRIDOR ALONG THE HEADING, NOT A POINT BELOW. A levelled attitude
 * 320 m over a valley floor with a 600 m ridge 1.5 km ahead puts the player
 * back into contact within two seconds, and the crash then repeats forever.
 */
export const SPAWN_CLEARANCE = 460;
export const SPAWN_LOOKAHEAD = 4000;

export function safeSpawnAltitude(position, heading, sampleHeight, opts = {}) {
  const clearance = opts.clearance ?? SPAWN_CLEARANCE;
  const reach = opts.lookahead ?? SPAWN_LOOKAHEAD;
  // No sampler: still return a floor rather than zero. A build whose terrain
  // failed to load must respawn somewhere flyable, not at sea level.
  if (!sampleHeight) return clearance;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  let highest = -Infinity;
  // Includes d = 0, so ground AT the spawn point is caught too.
  for (let d = 0; d <= reach; d += reach / 16) {
    highest = Math.max(highest, sampleHeight(position.x + fx * d, position.z + fz * d));
  }
  return highest + clearance;
}

/**
 * The respawn, computed from WHERE THE PLAYER DIED rather than from a stored
 * checkpoint.
 *
 * NO ESCALATION. Escalation existed to climb its way out of terrain over
 * repeated deaths, and with a finite pilot count (§11) that is no longer an
 * acceptable way to converge: each attempt costs one. So the FIRST attempt is
 * simply high enough that terrain cannot be a factor -- 4000 m against a 643 m
 * peak. Escalation is the right answer only when respawns are free.
 */
export const RESPAWN_ALTITUDE = 4000;
export const RESPAWN_BACKOFF = 1800;

export function respawnFrom(impact, heading, sampleHeight, cruise = 170) {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const position = {
    x: impact.x - fx * RESPAWN_BACKOFF,
    y: 0,
    z: impact.z - fz * RESPAWN_BACKOFF,
  };
  position.y = Math.max(
    RESPAWN_ALTITUDE,
    safeSpawnAltitude(position, heading, sampleHeight),
  );
  return { position, heading, pitch: 0, bank: 0, speed: cruise, sink: 0 };
}

// ── the presentation ───────────────────────────────────────────────────────

export function createCrashFx() {
  const state = {
    active: false,
    t: 0,
    cause: "TERRAIN",
    variant: VARIANTS.TERRAIN,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    tumble: { x: 0, y: 0, z: 0 },
    aircraftOpacity: 1,
    kick: 0,
    crashes: 0,
  };

  const sparks = [];
  const debris = [];
  const smoke = [];
  const fireball = [];
  let smokeDebt = 0;
  let seeded = null;

  /** Deterministic per-crash variation: RANDOMISED ONCE AT START, then evolved
   *  smoothly. Re-randomising per frame produces a flicker, not an explosion. */
  function seedRandom(n) {
    // WARMED UP. An LCG seeded with a small integer has its first few outputs
    // dominated by the increment, so seeds 1..12 all produced the same first
    // value -- and every crash tumbled the same way. The variation is supposed
    // to be per-crash; without the warm-up it was per-nothing.
    let s = (n * 2654435761) % 4294967296;
    for (let i = 0; i < 6; i++) s = (s * 1664525 + 1013904223) % 4294967296;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  return {
    state,
    sparks,
    debris,
    smoke,
    fireball,

    start({ reason, position, velocity, quat, seed = 1 }) {
      state.active = true;
      state.t = 0;
      state.crashes++;
      state.cause = causeFor(reason);
      state.variant = VARIANTS[state.cause];
      state.position = { ...position };
      // MOMENTUM IS INHERITED. The aircraft does not stop in midair -- it keeps
      // its pre-impact momentum and sinks under gravity. At 200 m/s that reads
      // as destruction with no mesh fracture at all.
      state.velocity = {
        x: velocity.x * state.variant.forward,
        y: velocity.y * state.variant.forward,
        z: velocity.z * state.variant.forward,
      };
      if (state.cause === "OCEAN") state.velocity.y -= OCEAN_PLUNGE;
      state.quat = { ...quat };
      state.aircraftOpacity = 1;
      state.kick = CAMERA_KICK;

      const rnd = seedRandom(seed);
      seeded = rnd;
      // LATCH THE TUMBLE AT ENTRY: one angular velocity, ramped in and then
      // constant, applied as a LOCAL quaternion delta so it works from any
      // starting attitude including inverted. (Same trap as the hostile's
      // break direction in stage 6.)
      const sign = rnd() < 0.5 ? -1 : 1;
      state.tumble = {
        x: (rnd() - 0.5) * 1.6,
        y: (rnd() - 0.5) * 1.2,
        // Roll DOMINATES: a tumbling airframe reads as a roll first.
        z: sign * (2.6 + rnd() * 1.8),
      };

      sparks.length = 0;
      debris.length = 0;
      smoke.length = 0;
      fireball.length = 0;
      smokeDebt = 0;

      // Offsets, sizes and rates randomised ONCE, here.
      const balls = 5 + Math.floor(rnd() * 3);
      for (let i = 0; i < balls; i++) {
        fireball.push({
          offset: { x: (rnd() - 0.5) * 11, y: (rnd() - 0.5) * 7, z: (rnd() - 0.5) * 11 },
          size: (7 + rnd() * 9) * state.variant.fire,
          rate: 0.7 + rnd() * 0.9,
          born: T.fireball + rnd() * 0.1,
        });
      }
      return state;
    },

    update(dt, impactNormal = { x: 0, y: 1, z: 0 }) {
      if (!state.active) return state;
      state.t += dt;
      const v = state.variant;
      const rnd = seeded ?? Math.random;

      // The airframe: momentum, gravity, and the latched tumble.
      state.velocity.y -= GRAVITY * v.sink * dt;
      state.position.x += state.velocity.x * dt;
      state.position.y += state.velocity.y * dt;
      state.position.z += state.velocity.z * dt;

      if (state.t >= T.tumble) {
        const ramp = Math.min(1, (state.t - T.tumble) / TUMBLE_RAMP);
        const half = (dt * ramp) / 2;
        state.quat = quatNormalize(
          quatMultiply(state.quat, {
            x: state.tumble.x * half,
            y: state.tumble.y * half,
            z: state.tumble.z * half,
            w: 1,
          }),
        );
      }

      // KEEP THE INTACT AIRCRAFT VISIBLE for ~0.72 s, then fade it behind its
      // own smoke. Hiding it on the frame it dies is what makes a death read
      // as a bug rather than as a crash.
      // `visible` cuts the START of the fade as well as its length. For OCEAN
      // that is 0.34 x 0.72 = 0.25 s, which is what hides the aircraft BEFORE
      // it is under the surface. Applied to the duration alone, the intact
      // airframe stays fully drawn while it submerges and visibly skates along
      // the water -- exactly the failure the variant exists to prevent.
      const fadeAt = T.fadeAircraft * v.visible;
      state.aircraftOpacity =
        state.t < fadeAt
          ? 1
          : Math.max(0, 1 - (state.t - fadeAt) / (0.28 * v.visible));

      // ONE strong kick, never re-triggered: sustained shake is nauseating.
      state.kick = CAMERA_KICK * Math.exp(-KICK_DECAY * state.t);

      if (state.t >= T.sparks && sparks.length === 0) {
        for (let i = 0; i < Math.round(SPARK_COUNT * v.sparks); i++) {
          // Biased along the impact normal, 42% velocity inherited.
          sparks.push({
            position: { ...state.position },
            velocity: {
              x: state.velocity.x * 0.42 + impactNormal.x * 40 + (rnd() - 0.5) * 50,
              y: state.velocity.y * 0.42 + impactNormal.y * 40 + (rnd() - 0.5) * 50,
              z: state.velocity.z * 0.42 + impactNormal.z * 40 + (rnd() - 0.5) * 50,
            },
            age: 0,
          });
        }
      }
      if (state.t >= T.fireball && debris.length === 0) {
        for (let i = 0; i < DEBRIS_COUNT; i++) {
          debris.push({
            position: { ...state.position },
            velocity: {
              x: state.velocity.x * 0.72 + (rnd() - 0.5) * 34,
              y: state.velocity.y * 0.72 + rnd() * 22,
              z: state.velocity.z * 0.72 + (rnd() - 0.5) * 34,
            },
            spin: { x: (rnd() - 0.5) * 6, y: (rnd() - 0.5) * 6, z: (rnd() - 0.5) * 6 },
            kind: i,
            age: 0,
          });
        }
      }

      // Smoke is WORLD-SPACE, so the aircraft leaves a trail behind it rather
      // than dragging a puff along with it.
      if (state.t >= T.smoke && state.t < T.smokeStops) {
        smokeDebt += SMOKE_RATE * v.smoke * dt;
        while (smokeDebt >= 1) {
          smokeDebt -= 1;
          smoke.push({ position: { ...state.position }, age: 0, mist: v.mist });
        }
      }

      for (const s of sparks) {
        s.age += dt;
        s.velocity.y -= GRAVITY * 2 * dt;
        s.position.x += s.velocity.x * dt;
        s.position.y += s.velocity.y * dt;
        s.position.z += s.velocity.z * dt;
      }
      for (const d of debris) {
        d.age += dt;
        d.velocity.y -= GRAVITY * dt;
        d.position.x += d.velocity.x * dt;
        d.position.y += d.velocity.y * dt;
        d.position.z += d.velocity.z * dt;
      }
      for (const s of smoke) s.age += dt;

      return state;
    },

    /** Total live entities, for the ~55 peak budget in §15. */
    entityCount: () => sparks.length + debris.length + smoke.length + fireball.length,

    /** Restores aircraft opacity. Called when the crash window ends. */
    finish() {
      state.active = false;
      state.aircraftOpacity = 1;
      state.kick = 0;
    },

    reset() {
      state.active = false;
      state.t = 0;
      state.aircraftOpacity = 1;
      state.kick = 0;
      sparks.length = 0;
      debris.length = 0;
      smoke.length = 0;
      fireball.length = 0;
      smokeDebt = 0;
    },
  };
}
