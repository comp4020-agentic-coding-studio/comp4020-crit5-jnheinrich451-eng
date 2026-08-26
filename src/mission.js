// The sortie: phases, route, checkpoints, autopilot. CLAUDE.md §10, stage 7.
//
// ONE PURE TRANSITION FUNCTION, and nothing else may promote a phase.
//
// Three-free, because the dangerous part of this stage is anything with a
// STORED POSITION -- a checkpoint captured in one place and restored into
// different terrain -- and that is only testable against a synthetic height
// field with no scene in the way.

import { captureFlightState } from "./flight.js";

export const DECK = "DECK";
export const LAUNCH = "LAUNCH";
export const EGRESS = "EGRESS";
export const INTERCEPT = "INTERCEPT";
export const DEFENSIVE = "DEFENSIVE";
export const TERRAIN = "TERRAIN";
export const FINAL = "FINAL";
export const EXTRACTION = "EXTRACTION";
export const COMPLETE = "COMPLETE";

export const PHASE_ORDER = [
  DECK, LAUNCH, EGRESS, INTERCEPT, DEFENSIVE, TERRAIN, FINAL, EXTRACTION, COMPLETE,
];

// §10's table, as data. Floors are REQUIRED, not decorative: without them the
// combat phases end in about twelve seconds, because the coastline volume that
// serves as their "next region" is close enough that flying straight through
// clears both encounters before either reads as one. The kill floor is much
// shorter, because an encounter the player WON should not hold them -- it only
// needs to let the explosion land.
export const PHASES = {
  [DECK]: { fallback: Infinity },
  [LAUNCH]: { fallback: Infinity },
  [EGRESS]: { fallback: 44 },
  [INTERCEPT]: { floor: 26, killFloor: 6, fallback: 52 },
  [DEFENSIVE]: { floor: 30, killFloor: 6, fallback: 58 },
  [TERRAIN]: { fallback: 98 },
  [FINAL]: { fallback: 62 },
  [EXTRACTION]: { fallback: 78 },
  [COMPLETE]: { fallback: Infinity },
};

/**
 * The phase transition. Pure: reads the mission and published facts, returns
 * the phase that should hold next, mutates nothing.
 *
 * ctx: { fired, handedOff, legReached, killedAt, magazineSpent, cinematicDone,
 *        phaseTime }
 */
export function missionTransition(mission, ctx) {
  const phase = mission.phase;
  if (phase === COMPLETE) return COMPLETE;

  const cfg = PHASES[phase] ?? {};
  const t = ctx.phaseTime;

  // EVERY PHASE NEEDS A TIME FALLBACK (§17.10). No combination of missed shots
  // or ignored enemies may soft-lock a sortie. There is no way to LOSE on time
  // -- the clock is a stopwatch, and the fallbacks only ever push forward.
  if (t >= cfg.fallback) return nextPhase(phase);

  switch (phase) {
    case DECK:
      return ctx.fired ? LAUNCH : DECK;
    case LAUNCH:
      return ctx.handedOff ? EGRESS : LAUNCH;
    case EGRESS:
      return ctx.legReached ? INTERCEPT : EGRESS;

    case INTERCEPT:
    case DEFENSIVE: {
      // The floor moves once the player has won: 6 s after the kill rather
      // than the full phase floor.
      const floor =
        ctx.killedAt !== null && ctx.killedAt !== undefined
          ? ctx.killedAt + cfg.killFloor
          : cfg.floor;
      if (t < floor) return phase;
      const done =
        ctx.killedAt !== null && ctx.killedAt !== undefined
          ? true
          : ctx.legReached || (phase === DEFENSIVE && ctx.magazineSpent);
      return done ? nextPhase(phase) : phase;
    }

    case TERRAIN:
      // Advances only on the LAST of the three inland legs.
      return ctx.legReached ? FINAL : TERRAIN;
    case FINAL:
      return ctx.legReached ? EXTRACTION : FINAL;
    case EXTRACTION:
      return ctx.cinematicDone ? COMPLETE : EXTRACTION;
    default:
      return phase;
  }
}

function nextPhase(phase) {
  const i = PHASE_ORDER.indexOf(phase);
  return i < 0 || i >= PHASE_ORDER.length - 1 ? COMPLETE : PHASE_ORDER[i + 1];
}

// ── trigger volumes ────────────────────────────────────────────────────────
//
// LEGS *ARE* TRIGGER VOLUMES. The object the HUD points at and the object that
// advances the mission are the same object, so they cannot drift apart.

/**
 * Horizontal spheres: ALTITUDE MUST NOT GATE A WAYPOINT. Only the recovery
 * volume carries a band, because arriving home at 12 km is not arriving home.
 * Radii are deliberately broad -- a player must never miss progression by 50 m.
 */
export function inVolume(volume, position) {
  const dx = position.x - volume.x;
  const dz = position.z - volume.z;
  if (dx * dx + dz * dz > volume.radius * volume.radius) return false;
  if (volume.band) {
    return position.y >= volume.band.min && position.y <= volume.band.max;
  }
  return true;
}

export function volumesOverlap(a, b) {
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  return d < a.radius + b.radius;
}

// ── surveying the inland legs ──────────────────────────────────────────────

/**
 * Score one lateral profile for the best pass through it.
 *
 * THE SCORE USES THE WEAKER FLANK. A valley is low ground with higher ground on
 * BOTH sides; scoring on the stronger side lets a coastal slope -- one very
 * high flank, one at sea level -- score as a mountain pass, and the route then
 * runs along a cliff edge instead of between two ridges.
 */
export function bandFeature(samples, span = 3) {
  if (!samples || samples.length < span * 2 + 1) return null;
  let best = null;
  for (let i = span; i < samples.length - span; i++) {
    let left = -Infinity;
    let right = -Infinity;
    for (let k = 1; k <= span; k++) {
      left = Math.max(left, samples[i - k]);
      right = Math.max(right, samples[i + k]);
    }
    const centre = samples[i];
    const score = Math.min(left, right) - centre;
    if (!best || score > best.score) {
      best = { index: i, score, centre, left, right };
    }
  }
  return best;
}

/**
 * One feature per corridor third.
 *
 * ZONE BEFORE SCORING. Greedy scoring alone clusters: the deepest passes tend
 * to sit in one massif, which leaves most of the corridor without a waypoint
 * and the route doubling back on itself.
 */
export function pickZonedFeatures(bands, count = 3) {
  const usable = bands.filter((b) => b && b.feature);
  if (usable.length === 0) return [];
  const picked = [];
  const per = Math.max(1, Math.floor(usable.length / count));
  for (let zone = 0; zone < count; zone++) {
    const from = zone * per;
    const to = zone === count - 1 ? usable.length : (zone + 1) * per;
    let best = null;
    for (let i = from; i < to; i++) {
      if (!best || usable[i].feature.score > best.feature.score) best = usable[i];
    }
    if (best) picked.push(best);
  }
  return picked;
}

/**
 * Survey the corridor and return three inland waypoints.
 *
 * `sampleHeight` is INJECTED, so this is exercised against a synthetic height
 * field with no scene. §4: a rule that requires a THREE.Scene to exercise will
 * not get tested -- do not write one.
 */
export function surveyTerrainRoute(sampleHeight, coastZ, options = {}) {
  const nearInland = options.nearInland ?? 1200;
  const farInland = options.farInland ?? 10500;
  const lateral = options.lateral ?? 5200;
  const rows = options.rows ?? 24;
  const cols = options.cols ?? 27;
  const span = options.span ?? 3;

  const bands = [];
  for (let r = 0; r < rows; r++) {
    const z = coastZ - (nearInland + ((farInland - nearInland) * r) / (rows - 1));
    const samples = [];
    const xs = [];
    for (let c = 0; c < cols; c++) {
      const x = -lateral + (2 * lateral * c) / (cols - 1);
      xs.push(x);
      samples.push(sampleHeight(x, z));
    }
    const feature = bandFeature(samples, span);
    bands.push({ z, xs, samples, feature });
  }

  return pickZonedFeatures(bands, 3).map((band, i) => ({
    name: ["PASS", "VALLEY", "RIDGE"][i] ?? `LEG ${i + 1}`,
    x: band.xs[band.feature.index],
    z: band.z,
    radius: 1400,
    ground: band.feature.centre,
    score: band.feature.score,
  }));
}

/** Used when the terrain failed to load. The mission must stay completable. */
export function authoredInlandRoute(coastZ) {
  return [
    { name: "PASS", x: -1400, z: coastZ - 2600, radius: 1400, ground: 0, authored: true },
    { name: "VALLEY", x: 900, z: coastZ - 6000, radius: 1400, ground: 0, authored: true },
    { name: "RIDGE", x: -600, z: coastZ - 9400, radius: 1400, ground: 0, authored: true },
  ];
}

/**
 * The whole route. Offshore legs derive from the carrier and the measured
 * coast; inland legs are surveyed. NOTHING HARDCODES A WORLD COORDINATE (§5).
 */
export function buildRoute({ carrierZ, coastZ, sampleHeight }) {
  const inland = sampleHeight
    ? surveyTerrainRoute(sampleHeight, coastZ)
    : authoredInlandRoute(coastZ);
  const legs = inland.length === 3 ? inland : authoredInlandRoute(coastZ);

  // ── the offshore legs, spaced so the required pair CANNOT touch ──────────
  //
  // §7: "Assert that INTERCEPT and COASTLINE do not overlap. This check exists
  // because they did touch." If they touch, entering the intercept area
  // instantly satisfies "reached the next region" for a fight that has not
  // started -- so the separation is CONSTRUCTED here rather than hoped for.
  //
  // The carrier-to-coast corridor is only ~6 km and the three offshore radii
  // sum to more than that, so the midpoint placement genuinely does not fit:
  // it put INTERCEPT and COASTLINE 700 m INSIDE one another. INTERCEPT is
  // therefore pushed back off COASTLINE until the gap is real.
  //
  // COAST and INTERCEPT may still overlap, and that is fine: only the CURRENT
  // leg is checked, and INTERCEPT's 26 s floor is exactly what covers a "next
  // region" the player is already standing in.
  const COASTLINE_RADIUS = 1250;
  const INTERCEPT_RADIUS = 1300;
  const MIN_GAP = 400;
  const coastlineZ = coastZ + 700;
  const needed = INTERCEPT_RADIUS + COASTLINE_RADIUS + MIN_GAP;
  const midpoint = (carrierZ + coastlineZ) / 2;
  const interceptZ =
    Math.abs(midpoint - coastlineZ) < needed ? coastlineZ + needed : midpoint;

  return {
    legs: [
      // The post-launch climb cue: named at 320 m, but altitude does NOT gate
      // it -- a player who stays low still progresses.
      { name: "COAST", x: 0, z: carrierZ - 1100, radius: 1250, cueAltitude: 320, phase: EGRESS },
      { name: "INTERCEPT", x: 0, z: interceptZ, radius: INTERCEPT_RADIUS, phase: INTERCEPT },
      { name: "COASTLINE", x: 0, z: coastlineZ, radius: COASTLINE_RADIUS, phase: DEFENSIVE },
      { ...legs[0], phase: TERRAIN },
      { ...legs[1], phase: TERRAIN },
      { ...legs[2], phase: TERRAIN },
      { name: "SEAWARD", x: 0, z: coastZ - 1800, radius: 1600, phase: FINAL },
      {
        name: "RECOVERY", x: 0, z: carrierZ + 400, radius: 2400,
        // The ONLY volume with an altitude band: arriving home at 12 km is not
        // arriving home.
        band: { min: 80, max: 3800 },
        phase: EXTRACTION,
      },
    ],
    surveyed: !legs[0].authored,
  };
}

// ── checkpoints ────────────────────────────────────────────────────────────

/**
 * Record a checkpoint LEVELLED AND LIFTED, not verbatim.
 *
 * A checkpoint must be a state the player can fly OUT of. Recording a mid-dive
 * attitude 120 m over a ridge means restoring it re-flies the same impact, and
 * the run then fails in the same place forever.
 *
 * Carries flight state, the selected weapon and both magazines. NOT particles,
 * not clouds: presentation resets, gameplay does not (§17.11).
 */
export function captureCheckpoint(state, { groundAhead = 0, weapon, missiles, gunRounds, phase, clearance = 420 }) {
  const snapshot = captureFlightState(state);
  snapshot.pitch = 0;
  snapshot.bank = 0;
  snapshot.sink = 0;
  snapshot.position.y = Math.max(snapshot.position.y, groundAhead + clearance);
  return { snapshot, weapon, missiles, gunRounds, phase };
}

// ── the autopilot ──────────────────────────────────────────────────────────

const AP_BANK = 1.0;
const AP_PITCH = 0.9;
const AP_THROTTLE = 0.7;

const wrap = (a) => {
  const two = Math.PI * 2;
  let v = (a + Math.PI) % two;
  if (v < 0) v += two;
  return v - Math.PI;
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * A VIRTUAL STICK, not a transform override.
 *
 * The extraction flies through the ordinary flight model and obeys the same
 * envelope, bank sink and camera rig the player was just using. Control is
 * handed AWAY over 1.3 s rather than switched off, which is why this returns
 * axes rather than a pose.
 */
export function autopilotStick({ heading, pitch, altitude, speed }, goal) {
  // The SHORT way round the +-180 degree seam. Without the wrap a goal one
  // degree the other side of north banks the aircraft 359 degrees.
  const headingError = wrap((goal.heading ?? heading) - heading);
  const x = clamp(headingError * 1.4, -1, 1) * AP_BANK;

  const altitudeError = (goal.altitude ?? altitude) - altitude;
  // Damp on the CURRENT pitch as well as the altitude error, or the autopilot
  // porpoises: it keeps pulling while already nose-high, overshoots, and then
  // pushes just as hard the other way.
  const y = clamp(altitudeError / 260 - pitch * 1.9, -1, 1) * AP_PITCH;

  const speedError = (goal.speed ?? speed) - speed;
  const throttle = clamp(speedError / 12, -1, 1) * AP_THROTTLE;

  return { x, y, roll: 0, throttle };
}

/** k = 0 is the player, k = 1 is the autopilot. */
export function blendStick(player, auto, k, out = {}) {
  const t = clamp(k, 0, 1);
  out.x = player.x + (auto.x - player.x) * t;
  out.y = player.y + (auto.y - player.y) * t;
  out.roll = (player.roll ?? 0) + ((auto.roll ?? 0) - (player.roll ?? 0)) * t;
  out.throttle =
    (player.throttle ?? 0) + ((auto.throttle ?? 0) - (player.throttle ?? 0)) * t;
  return out;
}

// ── the director ───────────────────────────────────────────────────────────

export function createMission({ route, onPhase, onCheckpoint } = {}) {
  const mission = {
    phase: DECK,
    phaseTime: 0,
    legIndex: 0,
    killedAt: null,
    // THE MISSION CLOCK. Started at the catapult and stopped at COMPLETE, and
    // stated HERE so no caller can start it somewhere else.
    clock: 0,
    running: false,
    stopped: null,
    checkpoints: [],
    parked: false,
    stats: { airKills: 0, samKills: 0, missilesFired: 0, gunFired: 0 },
  };

  let legs = route?.legs ?? [];

  function currentLeg() {
    // CHECK ONLY THE CURRENT LEG, so flying through a later volume early
    // cannot pull the mission forward past a fight that has not happened.
    return legs[mission.legIndex] ?? null;
  }

  return {
    mission,
    get legs() {
      return legs;
    },
    setRoute(next) {
      legs = next?.legs ?? [];
    },
    currentLeg,

    /** In FREE and PEACE the director PARKS: it still owns the deck and the
     *  catapult, then past the handoff stops advancing, stops timing and
     *  publishes no navigation. It is not bypassed (§11). */
    park() {
      mission.parked = true;
    },

    startClock() {
      if (!mission.running && mission.stopped === null) mission.running = true;
    },

    update(dt, ctx) {
      mission.phaseTime += dt;
      if (mission.running) mission.clock += dt;

      // The current leg is the trigger volume AND the thing the HUD points at.
      const leg = currentLeg();
      const reached = leg && ctx.position ? inVolume(leg, ctx.position) : false;
      let legReached = false;
      if (reached) {
        // TERRAIN advances only on the LAST of its three legs, so consuming a
        // leg and advancing the phase are different things.
        const consumed = leg;
        mission.legIndex++;
        const next = currentLeg();
        legReached = !next || next.phase !== consumed.phase;
      }

      if (mission.parked && mission.phase === EGRESS) {
        // Parked: past the handoff it stops advancing and publishes nothing.
        return { phase: mission.phase, changed: false, leg: null };
      }

      const next = missionTransition(mission, {
        ...ctx,
        legReached,
        killedAt: mission.killedAt,
        phaseTime: mission.phaseTime,
      });

      if (next !== mission.phase) {
        const from = mission.phase;
        mission.phase = next;
        mission.phaseTime = 0;
        mission.killedAt = null;
        if (next === LAUNCH) this.startClock();
        if (next === COMPLETE) {
          mission.running = false;
          mission.stopped = mission.clock;
        }
        if (onPhase) onPhase(next, from);
        return { phase: next, changed: true, from, leg: currentLeg() };
      }
      return { phase: mission.phase, changed: false, leg: currentLeg() };
    },

    noteKill(kind) {
      if (mission.killedAt === null) mission.killedAt = mission.phaseTime;
      if (kind === "sam") mission.stats.samKills++;
      else mission.stats.airKills++;
    },

    addCheckpoint(cp) {
      mission.checkpoints.push(cp);
      if (onCheckpoint) onCheckpoint(cp);
      return cp;
    },
    latestCheckpoint: () =>
      mission.checkpoints[mission.checkpoints.length - 1] ?? null,

    elapsed: () => (mission.stopped !== null ? mission.stopped : mission.clock),

    reset() {
      mission.phase = DECK;
      mission.phaseTime = 0;
      mission.legIndex = 0;
      mission.killedAt = null;
      mission.clock = 0;
      mission.running = false;
      mission.stopped = null;
      mission.checkpoints.length = 0;
      mission.stats.airKills = 0;
      mission.stats.samKills = 0;
      mission.stats.missilesFired = 0;
      mission.stats.gunFired = 0;
    },
  };
}
