/**
 * Stage 04.0 — the mission layer.
 *
 * Everything under this file already worked. Nothing in here flies the
 * aircraft, fires a weapon, or samples the terrain: the director's whole job is
 * to answer five questions (§4) —
 *
 *   what phase are we in / what should be active / where should the player go /
 *   what advances the mission / where does a failure put them back
 *
 * — and to do it from published state, exactly the way the Stage 03.3 hostile AI
 * reads the player. The transition table is one pure function (§3) for the same
 * reason the hostile's is: when the mission misbehaves, there is one place to
 * look, and nineteen tests can drive it without a scene.
 *
 * THREE-free. Positions are plain {x, y, z}; the anchors themselves are created
 * by main.js and read through this file's geometry helpers.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** §3 — the phases, explicit and closed. */
export const MissionPhase = {
  DECK: "DECK",
  LAUNCH: "LAUNCH",
  EGRESS: "EGRESS",
  INTERCEPT: "INTERCEPT",
  DEFENSIVE: "DEFENSIVE",
  TERRAIN: "TERRAIN",
  FINAL: "FINAL",
  EXTRACTION: "EXTRACTION",
  COMPLETE: "COMPLETE",
};

/** Order matters only for the debug overlay and the "phase N of 9" read. */
export const PHASE_ORDER = [
  MissionPhase.DECK,
  MissionPhase.LAUNCH,
  MissionPhase.EGRESS,
  MissionPhase.INTERCEPT,
  MissionPhase.DEFENSIVE,
  MissionPhase.TERRAIN,
  MissionPhase.FINAL,
  MissionPhase.EXTRACTION,
  MissionPhase.COMPLETE,
];

export const MISSION = {
  title: "VECTOR",


  /**
   * THE ONLY CLOCK IN THE MISSION, and the only way to lose to one (5:00 of
   * mission time, which starts at catapult release and stops at COMPLETE — the
   * scripted launch is outside it).
   *
   * Every phase used to carry its own time fallback as well, so that no missed
   * shot or ignored enemy could soft-lock a sortie. They were removed, because
   * in play they were not a safety net, they were the normal path:
   *
   *   TERRAIN's fallback was 66 s. Flying PASS -> VALLEY -> RIDGE is ~15 km,
   *   over 75 s at cruise before a single SAM is dodged. FINAL's was 42 s for
   *   an 8 km leg. Both expired every run, so RIDGE and SEAWARD advanced on
   *   their own whether or not the player ever went there — reported from play
   *   as "they are automatically achieved, even I am not here".
   *
   * A waypoint that arrives without being flown to is not a waypoint. So phases
   * now advance ONLY on their own condition — a kill, a magazine, a volume
   * actually entered — and the route is strictly sequential: PASS is reachable
   * before SEAWARD and SEAWARD only after PASS, whatever airspace they share,
   * because a phase's legs are checked in order and only the current one counts.
   *
   * §10's guarantee is kept, by a different mechanism. The invariant it was
   * written to protect is "no combination of missed shots or ignored enemies may
   * SOFT-LOCK a sortie" — the run must always end. It always does: past this
   * deadline the recovery window has closed and the run is lost, diegetically to
   * enemy reinforcements. What changed is that the ending can now be a LOSS
   * rather than a free pass, which is what C5's brief asks for in the first
   * place — a game has to be losable.
   *
   * The cost, stated: a slow or unlucky player can now run out of clock where
   * before they were carried to COMPLETE. That is the intent.
   */
  deadline: 300,
  /**
   * ...and a floor on the two combat phases. Without one they are over in twelve
   * seconds: the terrain-entry volume that serves as their "next mission region"
   * (§23/§25) is only a few kilometres past the intercept point, so a player
   * flying straight through would clear both encounters before either had time to
   * read as one. `kill` is the exception — an encounter the player has actually
   * WON should not hold them, only give the explosion a few seconds to land.
   */
  floor: { INTERCEPT: 26, DEFENSIVE: 30, kill: 6 },

  /**
   * §18 — THE COMBAT AREA, and the answer to a waypoint that cannot be reached.
   *
   * A combat phase holds the player with a floor while its own waypoint is
   * already behind them — DEFENSIVE inherits a COASTLINE flown under INTERCEPT.
   * The marker used to fall forward to the NEXT phase's waypoint just to have
   * something to show, and that was a lie: arriving there advanced nothing, and
   * the marker only moved when the floor expired. Reported from play as "I enter
   * 200 m, and pass the NAV, it does not update... it will wait after a while".
   *
   * So during those phases there is no destination, and the display says so
   * differently: an AREA rather than a point. Inside it there is no marker at
   * all — the wordless way of saying you are where you should be — and the radar
   * ring lights instead. Outside it, an arrow points back.
   *
   * The radius is generous on purpose. This is "the fight is around here", not a
   * gate to thread.
   */
  area: { radius: 3400 },

  /** §19 — broad volumes. The player must never miss progression by 50 m. */
  radius: { leg: 1250, intercept: 1300, terrain: 1300, valley: 1400, ridge: 1400, seaward: 1600, extraction: 2400 },

  /** §32 — forgiving. No alignment, no gear, no landing speed. */
  extraction: { altitudeMin: 80, altitudeMax: 3800 },

  /** §33/§34 — the closing cinematic, in seconds from the extraction trigger. */
  recovery: { handover: 1.3, hold: 4.4, fade: 1.5, altitude: 620, speed: 190 },

  /** §42/§43 — one hostile instance, three encounters. */
  encounter: {
    ahead: 2400, // metres in front of the player when it is (re)deployed
    lateral: 900,
    above: 140,
    /**
     * INTERCEPT is deployed CLOSER and nearly head-on, and it is the only
     * encounter that overrides the placement.
     *
     * Reported twice as "the INTERCEPT phase has no hostile fighter", and the
     * report was fair even though the deploy was working perfectly: measured in
     * the running game, the aircraft was there for the whole phase and merged to
     * 59 m. It just could not be FOUND. At the shared offsets it arrives 900 m
     * off a 2400 m nose -- 21 degrees, near the edge of the windscreen -- where
     * a 14.8 m airframe is about ten pixels against a dark coastline.
     *
     * Every other encounter announces itself by shooting: TRACK, then LOCK, then
     * a missile call. This one carries no rounds on purpose (below), so it makes
     * no sound and raises no warning, and the only tell is a radar diamond. The
     * fix has to be geometric, because the silence is the design.
     *
     * So it comes down the player's throat instead. Same aircraft, same zero
     * rounds; it simply passes through the middle of the frame rather than the
     * corner of it.
     */
    intercept: { ammo: 0, engageDelay: 3.0, ahead: 1700, lateral: 300, above: 70 }, // one-way pressure: the player attacks
    defensive: { ammo: 2, engageDelay: 2.0 }, // return fire — TRACK / LOCK / MISSILE
    final: { ammo: 1, engageDelay: 1.5 },
  },

  /** §16 — route shape, as offsets from measured world references. */
  route: {
    coastLead: 3400, // NavCoast, metres seaward of the coast
    interceptLead: 2400, // NavIntercept, metres seaward of the coast
    // NavCoastline sits just past the waterline. Its volume and NavIntercept's
    // must not overlap, or entering the intercept area would satisfy the
    // "reached the next region" condition for a fight that has not started.
    terrainEntry: -300,
    coastAltitude: 320, // reachable from a 45 m deck exit without a hard climb
    surveyFrom: 1200, // terrain survey corridor, metres inland of the coast
    // Stage 04.2 cut this from 13500. SAM sites add ~30 s of engagement to the
    // TERRAIN phase, and the brief asked to keep the sortie near four minutes,
    // so the route pays for them out of its own length rather than the clock.
    surveyTo: 10500,
    surveyHalfWidth: 5200,
    surveyStep: 420,
    surveySeparation: 2600,
    seawardBack: 2000, // NavSeaward, metres inland of the coast on the way out
    extractionLead: 3600, // NavExtraction, metres seaward of the coast
    cruiseAltitude: 700,
    terrainClearance: 320, // anchor altitude above the ground it sits over
    minTerrainAltitude: 240,
    /** §04.7 — how far ahead a respawn checks for ground before it commits. */
    spawnLookAhead: 4000,
    spawnStep: 300,
    /**
     * How far the aircraft must fly from where it was PLACED before that
     * placement stops suppressing leg credit. See `armCurrentLeg` below.
     *
     * Larger than every leg radius except RECOVERY's 2400, so by the time it
     * lapses the aircraft has genuinely left any volume it was dropped into.
     */
    placedClear: 2600,
  },

  /** §38 — four checkpoints, not one every few seconds. */
  checkpoints: 4,

  /**
   * Stage 04.2 — where the SAM sites stand.
   *
   * Two per terrain leg, offset to either side of the corridor rather than on
   * it: a site directly on the route is either a wall or scenery, whereas a pair
   * flanking it means the safe line is *between* them and low, which is the
   * behaviour the terrain masking is there to reward.
   */
  sam: {
    perLeg: 2,
    lateral: 1450,
    along: 700,
    lift: 0,
    minGround: 30,
    probes: [1, 0.72, 1.28, 0.48, 1.55],
    /**
     * THE DEFEND AREA GETS ITS OWN BATTERY, and the first inland leg gets none.
     *
     * DEFENSIVE used to be a pure air fight held open by a floor, with the
     * nearest ground threat 2.9 km beyond its edge — a phase called DEFEND with
     * nothing to defend against. Meanwhile the first inland leg carried a pair
     * sitting right where DEFENSIVE hands over to TERRAIN, which reads as a
     * threat belonging to neither phase.
     *
     * So the pair moves forward into the area that needs it. `defendCount` sites
     * are laid along the course INLAND of the DEFEND centre rather than around
     * it: the centre sits ~300 m past the waterline, where the ground is at sea
     * level and every probe would fail `minGround` and be dropped (§13). The
     * offsets below stay inside the area's 3400 m radius while standing on real
     * ground.
     */
    defendCount: 3,
    defendAlong: [1800, 2400, 3000],
    skipFirstTerrainLeg: true,
  },

  cueTime: 2.7,
  fadeIn: 1.2,
};

/** §38 — which checkpoint owns a phase. */
export function phaseCheckpoint(phase) {
  const P = MissionPhase;
  switch (phase) {
    case P.DECK:
    case P.LAUNCH:
      return 0;
    case P.EGRESS:
    case P.INTERCEPT:
    case P.DEFENSIVE:
      return 1;
    case P.TERRAIN:
      return 2;
    default:
      return 3;
  }
}

/** Phases at which a fresh checkpoint is recorded. */
export function opensCheckpoint(phase) {
  const P = MissionPhase;
  return phase === P.DECK || phase === P.EGRESS || phase === P.TERRAIN || phase === P.FINAL;
}

/** §5 — is the hostile allowed to exist in this phase at all? */
export function encounterFor(phase, cfg = MISSION) {
  const P = MissionPhase;
  if (phase === P.INTERCEPT) return cfg.encounter.intercept;
  if (phase === P.DEFENSIVE) return cfg.encounter.defensive;
  if (phase === P.FINAL) return cfg.encounter.final;
  return null;
}

/**
 * Where an encounter puts its aircraft, relative to the player.
 *
 * A pure rule with the config injected (§4), so the geometry is testable without
 * a scene -- main.js only supplies the player's transform. An encounter that
 * names none of these inherits the shared offsets, which is what DEFENSIVE and
 * FINAL do: they are found by being shot at, and do not need the help.
 */
export function deployOffsetFor(enc, cfg = MISSION) {
  const e = cfg.encounter;
  return {
    ahead: enc && enc.ahead !== undefined ? enc.ahead : e.ahead,
    lateral: enc && enc.lateral !== undefined ? enc.lateral : e.lateral,
    above: enc && enc.above !== undefined ? enc.above : e.above,
  };
}

/** §33 — are the player's weapons live? */
export function weaponsHotIn(phase) {
  const P = MissionPhase;
  return phase !== P.DECK && phase !== P.LAUNCH && phase !== P.COMPLETE;
}

/** Is the player flying the aircraft, or is a script? */
export function playerFliesIn(phase) {
  const P = MissionPhase;
  return phase !== P.DECK && phase !== P.LAUNCH && phase !== P.COMPLETE;
}

/* ---- geometry (§19) ---- */

export const wrapPi = (a) => a - TAU * Math.round(a / TAU);

export function distanceTo(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Horizontal range only — altitude must not decide whether a waypoint is met. */
export function flatDistanceTo(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Flight-model heading convention: 0 = -Z. */
export function bearingTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/**
 * §19 — a trigger volume. A horizontal sphere with an optional altitude band,
 * because "reach the valley" should not fail because the player is 200 m high,
 * while "you are at the recovery point" legitimately cares that they are not on
 * the seabed or in the stratosphere (§32).
 */
export function createTrigger({ name, phase = null, position, radius, altitudeMin = null, altitudeMax = null, nextPhase = null }) {
  return { name, phase, position: { x: position.x, y: position.y, z: position.z }, radius, altitudeMin, altitudeMax, nextPhase };
}

export function insideTrigger(trigger, position) {
  if (!trigger) return false;
  if (flatDistanceTo(trigger.position, position) > trigger.radius) return false;
  if (trigger.altitudeMin !== null && position.y < trigger.altitudeMin) return false;
  if (trigger.altitudeMax !== null && position.y > trigger.altitudeMax) return false;
  return true;
}

/* ---- terrain route selection (§27) ---- */

/**
 * The best pass through one lateral band of terrain.
 *
 * A valley is not "low ground" — that is just the sea. It is low ground with
 * HIGHER ground on both sides, so the score is the weaker of the two flanks
 * minus the centre. Using the weaker side is what stops a coastal slope, which
 * has one very high flank and one at sea level, from scoring as a mountain pass.
 *
 * @param samples ascending in x: [{ x, height }]
 * @param span    how many samples out to look for a flank
 */
export function bandFeature(samples, span = 5) {
  let best = null;
  for (let i = span; i < samples.length - span; i++) {
    const h = samples[i].height;
    let left = -Infinity;
    let right = -Infinity;
    for (let k = 1; k <= span; k++) {
      if (samples[i - k].height > left) left = samples[i - k].height;
      if (samples[i + k].height > right) right = samples[i + k].height;
    }
    const score = Math.min(left, right) - h;
    if (!best || score > best.score) best = { x: samples[i].x, height: h, score, left, right };
  }
  return best;
}

/**
 * §27 — pick 2–3 features from the geometry that already exists, spread along
 * the route so the legs are not stacked on top of each other. Greedy by score
 * with a minimum separation, then returned in flight order (nearest the coast
 * first, i.e. descending z since the course runs toward -Z).
 */
export function pickRouteFeatures(bands, count = 3, minSeparation = 2600, span = 5) {
  const scored = [];
  for (const band of bands) {
    const f = bandFeature(band.samples, span);
    if (f && Number.isFinite(f.score)) scored.push({ z: band.z, ...f });
  }
  scored.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const c of scored) {
    if (chosen.length >= count) break;
    if (chosen.some((k) => Math.abs(k.z - c.z) < minSeparation)) continue;
    chosen.push(c);
  }
  chosen.sort((a, b) => b.z - a.z);
  return chosen;
}

/**
 * §27/§28 — one feature per ZONE, rather than the three highest-scoring bands in
 * the corridor.
 *
 * Scoring alone clusters, and on this island it clusters badly: the deepest
 * passes all sit in the same mountain group, so a purely greedy pick left the
 * first seven kilometres inland with no waypoint and the last three with all of
 * them. Splitting the corridor first spaces the route along it — which is what a
 * route is for.
 */
export function pickZonedFeatures(bands, count = 3, span = 5) {
  const out = [];
  const per = Math.max(1, Math.floor(bands.length / count));
  for (let i = 0; i < count; i++) {
    const zone = bands.slice(i * per, i === count - 1 ? bands.length : (i + 1) * per);
    const best = pickRouteFeatures(zone, 1, 0, span);
    if (best.length) out.push(best[0]);
  }
  out.sort((a, b) => b.z - a.z);
  return out;
}

/**
 * Sample the live terrain into bands and pick the route through it.
 * `sampleHeight(x, z)` is physics.sampleTerrainBelow, injected so this stays
 * testable with a synthetic height function.
 */
export function surveyTerrainRoute(sampleHeight, coastZ, cfg = MISSION) {
  const r = cfg.route;
  const bands = [];
  for (let d = r.surveyFrom; d <= r.surveyTo; d += r.surveySeparation / 2) {
    const z = coastZ - d;
    const samples = [];
    for (let x = -r.surveyHalfWidth; x <= r.surveyHalfWidth; x += r.surveyStep) {
      samples.push({ x, height: sampleHeight(x, z) });
    }
    bands.push({ z, samples });
  }
  return pickZonedFeatures(bands, 3, 5);
}

/**
 * §16 — the whole route as authored anchors, derived from measured references.
 * No mission logic anywhere holds a world constant; it holds an anchor name.
 *
 * @param coastZ    terrain report's nearEdgeZ
 * @param features  surveyTerrainRoute() output, or [] for the offshore fallback
 */
export function planRoute({ coastZ, features = [], cfg = MISSION }) {
  const r = cfg.route;
  const alt = (groundHeight) => Math.max(r.minTerrainAltitude, groundHeight + r.terrainClearance);
  // Without a terrain index the inland legs still have to exist, so they fall
  // back to a straight authored course. The mission must be completable on a
  // build where the island failed to load.
  const fallback = [
    { x: -900, z: coastZ - 4600, height: 0 },
    { x: 1400, z: coastZ - 9200, height: 0 },
    { x: -600, z: coastZ - 13600, height: 0 },
  ];
  const f = features.length >= 3 ? features : fallback;
  // Legs ARE trigger volumes (§19): the thing the HUD points at and the thing that
  // advances the mission are the same object, so they cannot drift apart.
  const leg = (name, phase, x, y, z, radius, bounds = null) =>
    createTrigger({ name, phase, position: { x, y, z }, radius, altitudeMin: bounds ? bounds.min : null, altitudeMax: bounds ? bounds.max : null });

  return [
    leg("COAST", MissionPhase.EGRESS, 0, r.coastAltitude, coastZ + r.coastLead, cfg.radius.leg),
    leg("INTERCEPT", MissionPhase.EGRESS, 520, r.cruiseAltitude - 140, coastZ + r.interceptLead, cfg.radius.intercept),
    leg("COASTLINE", MissionPhase.INTERCEPT, f[0].x * 0.5, r.cruiseAltitude - 200, coastZ + r.terrainEntry, cfg.radius.terrain),
    leg("COASTLINE", MissionPhase.DEFENSIVE, f[0].x * 0.5, r.cruiseAltitude - 200, coastZ + r.terrainEntry, cfg.radius.terrain),
    leg("PASS", MissionPhase.TERRAIN, f[0].x, alt(f[0].height), f[0].z, cfg.radius.terrain),
    leg("VALLEY", MissionPhase.TERRAIN, f[1].x, alt(f[1].height), f[1].z, cfg.radius.valley),
    leg("RIDGE", MissionPhase.TERRAIN, f[2].x, alt(f[2].height), f[2].z, cfg.radius.ridge),
    leg("SEAWARD", MissionPhase.FINAL, f[1].x * -0.6, r.cruiseAltitude, coastZ - r.seawardBack, cfg.radius.seaward),
    leg("RECOVERY", MissionPhase.EXTRACTION, 0, r.cruiseAltitude, coastZ + r.extractionLead, cfg.radius.extraction, {
      min: cfg.extraction.altitudeMin,
      max: cfg.extraction.altitudeMax,
    }),
  ];
}

/**
 * Stage 04.2 — SAM positions, derived from the terrain route rather than
 * authored. Two per inland leg, flanking the corridor, standing on the ground.
 *
 * The flanking offset is the whole point — a site ON the route is either a wall
 * or scenery, whereas a pair either side means the safe line is *between* them
 * and low, which is what terrain masking is there to reward. But an offset can
 * also miss the land: the first build of this put two launchers in the sea at
 * y = -3 and y = 14. So each site probes outward along its side and takes the
 * first position standing on real ground, and a site with nowhere to stand is
 * dropped rather than floated. Five sites on land beat six with one at sea.
 *
 * `groundAt(x, z)` is injected so this is testable with a synthetic height
 * field, and so a build with no terrain index degrades to no sites rather than
 * to sites at sea level.
 */
export function planSamSites(legs, groundAt = null, cfg = MISSION) {
  const s = cfg.sam;
  const out = [];

  /**
   * The DEFEND battery. Laid along the course inland of the area's centre, so
   * the sites stand on ground while remaining inside the area the player is
   * being held in. Sides alternate so it is a corridor to thread, not a wall.
   */
  const defend = legs.find((l) => l.phase === MissionPhase.DEFENSIVE);
  if (defend) {
    for (let k = 0; k < s.defendCount; k++) {
      const along = s.defendAlong[k] ?? s.defendAlong[s.defendAlong.length - 1];
      const z = defend.position.z - along; // -Z is inland (§5)
      /**
       * Each site tries its PREFERRED flank first and then the other one.
       *
       * The inland legs can afford a single fixed side because they sit on the
       * island proper. This battery sits a kilometre or two past a waterline
       * that is not a straight edge, so a fixed side puts most of its probes
       * over water: measured on the shipped terrain, one site of three found
       * ground and the other two were dropped (§13). Falling back to the far
       * flank keeps the battery at strength without floating anything.
       */
      const preferred = k % 2 === 0 ? 1 : -1;
      let placed = null;
      for (const side of [preferred, -preferred]) {
        for (const scale of s.probes) {
          const x = defend.position.x + side * s.lateral * scale;
          const y = groundAt ? groundAt(x, z) : -Infinity;
          if (y >= s.minGround) {
            placed = { name: `SamDEFEND${k + 1}`, x, y: y + s.lift, z, leg: "DEFEND", offset: +(side * s.lateral * scale).toFixed(0) };
            break;
          }
        }
        if (placed) break;
      }
      if (placed) out.push(placed);
    }
  }

  // The first inland leg is left clear: its pair used to sit exactly where
  // DEFENSIVE hands over to TERRAIN, which belongs to neither phase. Those
  // sites are the ones now standing in the DEFEND area above.
  const allTerrain = legs.filter((l) => l.phase === MissionPhase.TERRAIN);
  const terrainLegs = s.skipFirstTerrainLeg ? allTerrain.slice(1) : allTerrain;
  terrainLegs.forEach((leg, i) => {
    for (let k = 0; k < s.perLeg; k++) {
      // Alternate which side leads, so the flanking pattern does not become a
      // memorisable left-right-left corridor.
      const side = (i + k) % 2 === 0 ? 1 : -1;
      const z = leg.position.z + (k === 0 ? -s.along : s.along);
      let placed = null;
      for (const scale of s.probes) {
        const x = leg.position.x + side * s.lateral * scale;
        const y = groundAt ? groundAt(x, z) : -Infinity;
        if (y >= s.minGround) {
          placed = { name: `Sam${leg.name}${k + 1}`, x, y: y + s.lift, z, leg: leg.name, offset: +(s.lateral * scale).toFixed(0) };
          break;
        }
      }
      if (placed) out.push(placed);
    }
  });
  return out;
}

/**
 * Stage 04.7 — the altitude a respawn must clear.
 *
 * Enforced at RESTORE time, not at capture, because a snapshot cannot know what
 * the terrain will be when it is used. The capture-time lift samples the ground
 * directly below the capture point, which says nothing about whether that point
 * sits inside a hillside — nor about what the aircraft is POINTED AT. Restoring a
 * levelled attitude 320 m over a valley floor with a 600 m ridge 400 m ahead puts
 * the player back into contact within two seconds; the policy fails them again,
 * and the crash repeats forever.
 *
 * So the corridor ahead of the restored heading is sampled and the floor is the
 * HIGHEST ground in it. A respawn that begins a second from a mountain is not a
 * respawn.
 *
 * @param sampleHeight (x, z) => ground height, injected — so the rule is testable
 *   against a synthetic hill, exactly like lineOfSight and surveyTerrainRoute.
 * @returns the minimum safe altitude for that position and heading
 */
export function safeSpawnAltitude(position, heading, sampleHeight, cfg = MISSION, clearance = null) {
  const r = cfg.route;
  // Respawn clearance is a caller decision: a nav anchor's 320 m proved tight for
  // a spawn, and repeated failures escalate it further.
  const lift = clearance === null ? r.terrainClearance : clearance;
  if (!sampleHeight) return r.minTerrainAltitude;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  let highest = -Infinity;
  // Sampled well beyond the aircraft's reaction distance: at cruise, 4 km is a
  // little over twenty seconds — enough for the player to see rising ground and
  // turn, rather than merely to notice it.
  for (let d = 0; d <= r.spawnLookAhead; d += r.spawnStep) {
    const h = sampleHeight(position.x + fx * d, position.z + fz * d);
    if (Number.isFinite(h) && h > highest) highest = h;
  }
  if (!Number.isFinite(highest)) return r.minTerrainAltitude;
  return Math.max(r.minTerrainAltitude, highest + lift);
}

/**
 * Every pair of legs whose trigger volumes share airspace, as a pure report.
 *
 * §19 already demands one instance of this by hand — "assert that the INTERCEPT
 * and COASTLINE volumes do not overlap", because if they touch, entering the
 * intercept area instantly satisfies "reached the next region" for a fight that
 * has not started. That reasoning was never generalised, and the case that bit
 * was a different pair entirely: on a surveyed route PASS(TERRAIN) came out
 * 696 m from SEAWARD(FINAL), close enough that PASS's centre lies inside
 * SEAWARD's volume.
 *
 * Overlap is not automatically a fault. The route deliberately revisits its own
 * airspace — RECOVERY sits almost on top of COAST, because the sortie flies out
 * and comes home — and that is harmless when the phases are far apart in time.
 * It is `contained` that is worth reading: one leg's centre inside another's
 * volume means a player standing on one waypoint is standing on the other.
 *
 * The two COASTLINE copies are excluded. They are authored at identical
 * coordinates on purpose, so one waterline can serve as the "next region" for
 * two consecutive encounters (§19).
 *
 * @returns {{ a: object, b: object, distance: number, contained: boolean }[]}
 */
export function routeOverlaps(route) {
  const out = [];
  for (let i = 0; i < route.length; i++) {
    for (let j = i + 1; j < route.length; j++) {
      const a = route[i];
      const b = route[j];
      if (a.name === b.name) continue;
      const distance = flatDistanceTo(a.position, b.position);
      if (distance >= a.radius + b.radius) continue;
      out.push({ a, b, distance, contained: distance < Math.max(a.radius, b.radius) });
    }
  }
  return out;
}

/* ---- the transition table (§3) ---- *//**
 * The one place a phase may change. Every condition in the stage brief lives
 * here, and nothing in an update loop is allowed to promote a phase — the same
 * rule Stage 03.3 applied to the hostile, for the same reason.
 *
 * @param m   { phase, phaseTime, legDone }
 * @param ctx { strokeStarted, launchDone, hostileAlive, hostileSpent, recoveryDone }
 */
export function missionTransition(m, ctx, cfg = MISSION) {
  const P = MissionPhase;
  const t = m.phaseTime;
  switch (m.phase) {
    case P.DECK:
      return ctx.strokeStarted ? P.LAUNCH : P.DECK;
    case P.LAUNCH:
      return ctx.launchDone ? P.EGRESS : P.LAUNCH;
    case P.EGRESS:
      // §21 — arriving advances it. Nothing else does.
      return m.legDone ? P.INTERCEPT : P.EGRESS;
    case P.INTERCEPT:
      // §23 — a kill, or reaching the next region. Never "destroy the hostile"
      // alone: two missed AIM-9s must not end the mission.
      if (!ctx.hostileAlive && t >= cfg.floor.kill) return P.DEFENSIVE;
      if (t < cfg.floor.INTERCEPT) return P.INTERCEPT;
      return m.legDone ? P.DEFENSIVE : P.INTERCEPT;
    case P.DEFENSIVE:
      // §25 — a kill, a completed attack cycle (magazine gone and nothing in the
      // air), or the terrain-entry volume.
      if (!ctx.hostileAlive && t >= cfg.floor.kill) return P.TERRAIN;
      if (t < cfg.floor.DEFENSIVE) return P.DEFENSIVE;
      return ctx.hostileSpent || m.legDone ? P.TERRAIN : P.DEFENSIVE;
    case P.TERRAIN:
      return m.legDone ? P.FINAL : P.TERRAIN;
    case P.FINAL:
      return m.legDone ? P.EXTRACTION : P.FINAL;
    case P.EXTRACTION:
      return ctx.recoveryDone ? P.COMPLETE : P.EXTRACTION;
    case P.COMPLETE:
      return P.COMPLETE;
    default:
      return m.phase;
  }
}

/* ---- autopilot (§33/§34) ---- */

export const AUTOPILOT = {
  headingBand: 26 * DEG, // heading error that commands full bank
  bankAuthority: 0.85,
  altitudeBand: 240, // altitude error that commands full pitch
  pitchDamping: 0.4,
  speedBand: 14,
};

/**
 * A virtual stick. The extraction cinematic does NOT move the aircraft directly
 * — it flies it through the ordinary flight model with a synthesised input, so
 * the closing sequence obeys the same envelope, the same bank sink and the same
 * camera rig the player just used. Nothing in here is flight physics (§4); it is
 * a controller, and it is pure so the convergence is testable.
 */
export function autopilotStick(ctx, goal, cfg = AUTOPILOT) {
  const hErr = wrapPi(goal.heading - ctx.heading);
  const x = clamp(hErr / cfg.headingBand, -1, 1) * cfg.bankAuthority;
  const aErr = (goal.altitude ?? ctx.altitude) - ctx.altitude;
  const y = clamp(aErr / cfg.altitudeBand - (ctx.pitch / (14 * DEG)) * cfg.pitchDamping, -1, 1);
  const throttle = clamp(((goal.speed ?? ctx.speed) - ctx.speed) / cfg.speedBand, -1, 1);
  return { x, y, roll: 0, throttle };
}

/** §33 — control is taken away gradually, not switched off. k: 0 player, 1 auto. */
export function blendStick(player, auto, k, out = {}) {
  const t = clamp(k, 0, 1);
  out.x = player.x * (1 - t) + auto.x * t;
  out.y = player.y * (1 - t) + auto.y * t;
  out.roll = (player.roll || 0) * (1 - t) + auto.roll * t;
  out.throttle = (player.throttle || 0) * (1 - t) + auto.throttle * t;
  return out;
}

/**
 * §34 — the closing composition: wider, further out, higher. The cheat is that
 * this is a camera move and an autopilot, not a landing system.
 */
export const RECOVERY_VIEW = { distance: 44, height: 13, framingY: -0.1, lagScale: 1.5 };

/**
 * Stage 04.7 §27 — the crash-follow composition. Further out and higher than the
 * chase, with its forward damping cut hard so the rig visibly trails the
 * tumbling aircraft instead of staying locked behind it. That lag is what lets
 * the player see the fire, the smoke and the debris before the fade.
 */
export const CRASH_VIEW = { distance: 34, height: 9, framingY: -0.12, lagScale: 0.34 };

/* ---- presentation helpers ---- */

/** mm:ss.hh — the only place mission time is formatted. */
export function formatClock(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rem.toFixed(2).padStart(5, "0")}`;
}

export function formatShortClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** §35 — compact run information. Time and a few combat stats, nothing more. */
export function missionSummary(stats, cfg = MISSION) {
  return [
    { label: "TIME", value: formatClock(stats.time) },
    { label: "AIR KILLS", value: String(stats.kills) },
    { label: "SAM SITES", value: String(stats.groundKills || 0) },
    // A plain count, not `fired/loadout`. The magazine refills mid-sortie (§rearm),
    // so "1/2" invited the reading "one of two available" when it meant "one of
    // the two I started with" — and by the end the denominator is not a fact about
    // anything. How many rounds you spent is the statistic.
    { label: "AIM-9", value: String(stats.aim9Fired) },
    { label: "GUN", value: String(stats.gunFired) },
  ];
}

/**
 * Has the sortie run out of time? Pure, so the deadline is testable without a
 * scene and cannot be evaluated in two places with different conditions.
 *
 * COMPLETE is exempt: the clock stops there, and a run that finished at 4:59.9
 * must not be failed by a later frame.
 */
export function missionExpired(missionTime, phase, cfg = MISSION) {
  if (phase === MissionPhase.COMPLETE) return false;
  return missionTime >= cfg.deadline;
}

/* ---- the director ---- */

/**
 * @param captureCheckpoint  () => snapshot   — main.js owns what a snapshot is
 * @param restoreCheckpoint  (snapshot) => void
 */
export function createMissionDirector({ cfg = MISSION, captureCheckpoint = null, restoreCheckpoint = null } = {}) {
  const events = { phase: [], leg: [], checkpoint: [], complete: [], fail: [] };
  const emit = (kind, payload) => events[kind].forEach((fn) => fn(payload));

  const state = {
    phase: MissionPhase.DECK,
    prevPhase: null,
    phaseTime: 0,
    missionTime: 0,
    timerRunning: false,
    checkpoint: 0,
    legIndex: 0,
    legDone: false,
    navName: null,
    navRange: 0,
    navPosition: { x: 0, y: 0, z: 0 },
    navValid: false,
    /**
     * The combat area, published INSTEAD of a waypoint while a floor holds the
     * player in a phase whose own leg is already behind them. Additive: nothing
     * in the transition table reads any of it, so the mission logic is unchanged.
     */
    areaValid: false,
    areaName: null,
    areaPosition: { x: 0, y: 0, z: 0 },
    areaRadius: 0,
    areaRange: 0,
    inArea: false,
    /** 0 while the player flies; ramps to 1 through the closing cinematic. */
    autopilot: 0,
    recovering: false,
    recoveryTime: 0,
    recoveryDone: false,
    fade: 0,
    failures: 0,
    finished: false,
    /**
     * Stage 04.2 — FREE and PEACE run the launch and then stop. The director is
     * still the thing that owns the deck and the catapult in every mode (no mode
     * skips the launch), so rather than bypass it, it parks: past the handoff it
     * stops advancing, stops timing and publishes no navigation.
     */
    sandbox: false,
    parked: false,
  };

  const stats = { time: 0, kills: 0, groundKills: 0, aim9Fired: 0, aim9Loadout: 2, gunFired: 0, gunHits: 0, evasions: 0, checkpointsUsed: 0 };

  /**
   * A LEG IS SATISFIED BY ARRIVING AT IT, NOT BY STANDING IN IT.
   *
   * Reported from play: killed by a SAM while approaching VALLEY, and after the
   * respawn the nav marker was on RECOVERY — RIDGE and SEAWARD both gone. The
   * cause is two volumes sharing airspace plus one teleport. Measured on the
   * shipped terrain, and logged by main.js at load:
   *
   *   TERRAIN/PASS <-> FINAL/SEAWARD   1517 m apart, and SEAWARD's radius is 1600
   *
   * So PASS's centre lies inside SEAWARD's volume, with 83 m to spare — close
   * enough that standing on one waypoint is standing on the other, and marginal
   * enough that a different survey could make it worse. The collision is between
   * a leg the terrain survey DERIVES (PASS, 1.2-10.5 km inland) and one the
   * config AUTHORS (SEAWARD, a fixed `seawardBack` 2000 m inland); nothing
   * reconciles the two, so how close they land is left to the height field.
   *
   * `respawnFromCrash` backs the aircraft 1800 m along its heading of travel,
   * which from a death between PASS and VALLEY lands it back inside SEAWARD's
   * volume. Nothing fires yet, because only the CURRENT phase's leg is ever
   * checked. Then TERRAIN's 98 s fallback expires, FINAL is entered, and its one
   * leg is satisfied on the entry frame by a position the player never flew to.
   * legDone goes true and EXTRACTION follows in the same frame. Two waypoints
   * vanish at once and the sortie skips to its ending.
   *
   * The guard is deliberately scoped to PLACEMENT, not to phase entry. Being
   * inside a leg when its phase begins is NORMAL and correct — on a clean run
   * the player is already inside PASS when TERRAIN starts, because they spent
   * DEFENSIVE flying to it. Requiring an exit there would mean overflying the
   * waypoint and doubling back, which is a worse bug than the one being fixed.
   * What is not normal is being PUT somewhere by a respawn or a checkpoint
   * restore. So credit is suspended only for a volume the aircraft was placed
   * inside, and only until it has flown clear of where it was placed.
   */
  let placedAt = null;
  let armed = true;

  let route = [];
  let legs = [];
  const checkpoints = new Array(cfg.checkpoints).fill(null);
  let cue = null;
  let cueT = 0;

  function setRoute(plan) {
    route = plan.slice();
    stats.aim9Loadout = stats.aim9Loadout || 2;
    selectLegs();
    return route;
  }

  /**
   * Decide whether the CURRENT leg may be satisfied by simply being inside it.
   *
   * It may not, if the aircraft was placed inside it and has not yet flown clear
   * of where it was placed. In that case the leg arms on the way OUT, so it
   * still counts the moment the player flies back in — the waypoint is not lost,
   * it just has to be reached.
   */
  function armCurrentLeg() {
    const leg = legs[state.legIndex];
    // A leg already flown through needs no arming: the guard exists to stop a
    // PLACEMENT handing out credit, and this was earned in the air. Without it a
    // respawn inside such a leg strands it — `armed` false and `inside` true,
    // so neither branch of the trigger can fire.
    if (leg && (satisfied.has(legKey(leg)) || flownThrough.has(legKey(leg)))) {
      armed = true;
      return;
    }
    armed = !(placedAt && leg && insideTrigger(leg, placedAt));
  }

  /**
   * The aircraft was PUT here rather than flying here — a crash respawn, or a
   * checkpoint restore. Called by the orchestrator after it writes the transform,
   * because the director cannot see a position it was not handed.
   */
  function notifyPlaced(position) {
    placedAt = position ? { x: position.x, y: position.y, z: position.z } : null;
    armCurrentLeg();
    return placedAt;
  }

  /** Legs belonging to the current phase, in order. */
  function selectLegs() {
    legs = route.filter((l) => l.phase === state.phase);
    state.legIndex = 0;
    state.legDone = legs.length === 0;
    // Re-armed against the placement, not the phase: a phase entered while the
    // aircraft still sits where a respawn dropped it must not hand out credit
    // for a waypoint it was dropped on top of.
    armCurrentLeg();
    publishArea();
    publishNav();
  }

  /**
   * Legs whose trigger volume the player has already entered, keyed by name and
   * position rather than by identity.
   *
   * By position on purpose: COASTLINE is authored TWICE, once for INTERCEPT and
   * once for DEFENSIVE, at the same coordinates — that is how one waterline can
   * serve as the "next region" for two consecutive encounters. Keying by identity
   * would treat the second copy as somewhere new and send the player back to a
   * point they had already flown through.
   */
  const satisfied = new Set();
  /**
   * Legs the aircraft has genuinely flown through, as opposed to legs the
   * MISSION has consumed. The two are not the same, and that gap is the bug.
   *
   * Reported from play: reaching PASS did nothing, and once TERRAIN began the
   * marker pointed backwards at it. During DEFENSIVE's 30 s floor its own leg is
   * COASTLINE — already flown under INTERCEPT — so nav falls forward and sends
   * the player to PASS. They fly to it, through it, and nothing records that,
   * because the trigger only tests the CURRENT PHASE's leg. TERRAIN then opens
   * with PASS kilometres astern. Measured with a turn-rate-limited bot at
   * 240 m/s: twelve seconds of flying back, and a player who carries on inland
   * never returns at all.
   */
  const flownThrough = new Set();
  const legKey = (l) => `${l.name}@${Math.round(l.position.x)},${Math.round(l.position.z)}`;

  /** The first leg in route order the player has not yet reached. */
  function nextUnsatisfied() {
    for (const l of route) if (!satisfied.has(legKey(l))) return l;
    return null;
  }

  /**
   * NAVIGATION FALLS FORWARD; TRIGGERS DO NOT.
   *
   * Two separate questions that used to share one answer: "which volume advances
   * the mission" (the current phase's current leg, and nothing else — §10, so
   * flying through a later volume early cannot skip the route) and "where is the
   * player going next" (the next unreached point on the whole route).
   *
   * Publishing the trigger leg as guidance produced two defects at the coastline,
   * both reported from play:
   *
   *   1. INTERCEPT owns exactly one leg. Reaching it exhausted the phase's list,
   *      `legs[legIndex]` went undefined and the marker VANISHED -- for as long as
   *      the phase's 26 s floor, with no diamond and no offscreen chevron. A new
   *      player has nothing at all to fly toward.
   *   2. DEFENSIVE then re-selected its own copy of COASTLINE, which is the point
   *      just flown through, so the marker pointed BACKWARDS and asked the player
   *      to turn around.
   *
   * So guidance now skips any leg already satisfied and walks the route for the
   * next real destination. The trigger check below is untouched, which is why this
   * changes no phase timing.
   */
  /** Phases that hold the player in a region rather than sending them to a point. */
  const AREA_PHASE = { [MissionPhase.INTERCEPT]: "INTERCEPT", [MissionPhase.DEFENSIVE]: "DEFEND" };

  /**
   * An area is published when the phase is a combat one AND its own legs are
   * done — exactly the window in which nav had nothing honest to show. While one
   * is up `publishNav` yields, so the player sees an area or a waypoint, never
   * both.
   */
  function publishArea() {
    const name = AREA_PHASE[state.phase];
    const own = legs.length ? legs[legs.length - 1] : null;
    const on = !!name && !!own && state.legDone && !state.sandbox;
    state.areaValid = on;
    state.areaName = on ? name : null;
    state.areaRadius = on ? cfg.area.radius : 0;
    if (on) {
      state.areaPosition.x = own.position.x;
      state.areaPosition.y = own.position.y;
      state.areaPosition.z = own.position.z;
    } else {
      state.areaRange = 0;
      state.inArea = false;
    }
    return on;
  }

  function publishNav() {
    /**
     * §11 — A SANDBOX MODE HAS NO NAVIGATION, AT ANY PHASE.
     *
     * The director owns the deck and the catapult in every mode (no mode skips
     * the launch), and past the handoff it parks. But parking happens on entry
     * to EGRESS, which is a moment too late: DECK and LAUNCH still published a
     * leg, so FREE fly and PEACE flew the whole take-off with a NAV COAST
     * diamond, name and range on screen — directions to the first waypoint of a
     * mission the player is not on. It then vanished at the handoff, which made
     * it read as a glitch rather than as a leftover.
     *
     * Gating on `sandbox` rather than on `parked` is the fix: parked is "the
     * director has stopped advancing", and this is "there was never a route".
     */
    if (state.sandbox) {
      state.navValid = false;
      state.navName = null;
      state.navRange = 0;
      return;
    }
    // An area outranks a waypoint: while one is up there is no destination to
    // publish, and falling forward into the next phase is what made the marker
    // lie in the first place.
    if (state.areaValid) {
      state.navValid = false;
      state.navName = null;
      state.navRange = 0;
      return;
    }
    let leg = legs[state.legIndex] || null;
    if (!leg || satisfied.has(legKey(leg))) leg = nextUnsatisfied();
    state.navValid = !!leg;
    state.navName = leg ? leg.name : null;
    if (leg) {
      state.navPosition.x = leg.position.x;
      state.navPosition.y = leg.position.y;
      state.navPosition.z = leg.position.z;
    }
  }

  function enter(next) {
    if (next === state.phase) return;
    state.prevPhase = state.phase;
    state.phase = next;
    state.phaseTime = 0;
    state.recovering = false;
    state.recoveryTime = 0;
    state.recoveryDone = false;
    if (next === MissionPhase.COMPLETE) state.autopilot = 0;
    // §37 — the mission clock starts at catapult release. Stated once, here, so
    // no caller can start it somewhere else.
    if (next === MissionPhase.LAUNCH) state.timerRunning = !state.sandbox;
    // §12 — in a sandbox mode, EGRESS is where the director stops.
    if (next === MissionPhase.EGRESS && state.sandbox) state.parked = true;
    selectLegs();
    state.checkpoint = phaseCheckpoint(next);
    if (opensCheckpoint(next) && captureCheckpoint) {
      checkpoints[state.checkpoint] = { index: state.checkpoint, phase: next, missionTime: state.missionTime, snapshot: captureCheckpoint() };
      emit("checkpoint", { index: state.checkpoint, phase: next });
    }
    cue = next;
    cueT = cfg.cueTime;
    if (next === MissionPhase.COMPLETE) {
      state.finished = true;
      stats.time = state.missionTime;
      state.timerRunning = false;
      emit("complete", { stats, state });
    }
    emit("phase", { phase: next, from: state.prevPhase, checkpoint: state.checkpoint });
  }

  /**
   * @param ctx {
   *   position, strokeStarted, launchDone, hostileAlive, hostileSpent
   * }
   */
  function update(ctx, dt) {
    state.phaseTime += dt;
    if (state.timerRunning) state.missionTime += dt;
    if (cueT > 0 && (cueT -= dt) <= 0) cue = null;

    // Parked: the launch has been flown and this mode has no phases to advance.
    // Nothing below runs, so there is no nav, no leg progression, no clock and no
    // ending — the sandbox driver owns what happens next.
    if (state.parked) {
      state.navValid = false;
      state.navName = null;
      state.navRange = 0;
      return state;
    }

    // Leg progression: broad volumes, checked against the CURRENT leg only, so
    // flying through a later volume early cannot skip the route.
    /**
     * RECORD WHERE THE AIRCRAFT HAS BEEN — narrowly.
     *
     * This phase's own legs always: `legIndex` still walks them in order, so
     * recording them out of order cannot skip anything, it only saves flying one
     * twice.
     *
     * The NEXT phase's first leg only once this phase's own legs are done. That
     * restriction is load-bearing, and two earlier attempts died without it,
     * both caught by the suite rather than by reading:
     *
     *   - recording every leg banks RECOVERY during EGRESS, because the sortie
     *     comes home to where it started and the two volumes sit 200 m apart.
     *     The direct run fell from ~150 s to 96.8 s.
     *   - recording the next phase's legs unconditionally banks SEAWARD while
     *     the player is at PASS, because those two overlap by design — 1517 m
     *     apart, PASS's centre inside SEAWARD's volume. FINAL then had nothing
     *     left to fly.
     *
     * Gating on `legDone` closes both: a phase with unflown legs of its own
     * records nothing beyond itself, so the only leg that can ever be banked
     * early is the doorway the player was actually sent to.
     */
    if (ctx.position && !placedAt) {
      for (const l of legs) if (insideTrigger(l, ctx.position)) flownThrough.add(legKey(l));
      if (state.legDone) {
        const i = PHASE_ORDER.indexOf(state.phase);
        const doorway = route.find((l) => l.phase === PHASE_ORDER[i + 1]);
        if (doorway && insideTrigger(doorway, ctx.position)) flownThrough.add(legKey(doorway));
      }
    }

    // A placement stops suppressing credit once the aircraft has flown clear of
    // it. Checked before the trigger, so the frame the player earns their way
    // out is the frame the guard lifts.
    if (placedAt && ctx.position && flatDistanceTo(placedAt, ctx.position) > cfg.route.placedClear) placedAt = null;

    if (!state.legDone && legs.length) {
      const leg = legs[state.legIndex];
      /**
       * A POINT ALREADY FLOWN THROUGH COUNTS, and does not have to be flown
       * through twice.
       *
       * COASTLINE is authored twice on purpose, at identical coordinates, so one
       * waterline can serve as the "next region" for two consecutive encounters
       * (§19). INTERCEPT consumes it first; DEFENSIVE then inherits a waypoint
       * that is BEHIND the player, several kilometres back out to sea.
       *
       * `publishNav` already skipped it — that is what "navigation falls forward"
       * above is for — so nav pointed inland at PASS while the trigger sat
       * waiting on a volume the player was flying away from. The two disagreed,
       * and only DEFENSIVE's 40 s time fallback hid it. Removing the fallbacks
       * turned that disagreement into a hard stall: the phase could never end,
       * and the sortie ran to the deadline and was lost.
       *
       * So the trigger now reads the same `satisfied` set nav does. This is not
       * a free pass: the key is name-and-position, so it fires only for a point
       * the player genuinely flew through under an earlier phase. Every leg with
       * its own coordinates — PASS, VALLEY, RIDGE, SEAWARD, RECOVERY — still has
       * to be reached, in order, exactly once.
       */
      const alreadyFlown = satisfied.has(legKey(leg)) || flownThrough.has(legKey(leg));
      const inside = alreadyFlown || insideTrigger(leg, ctx.position);
      // Arms on the way OUT: a leg the aircraft was placed inside becomes
      // available again the moment it is left, so flying back in still counts.
      if (!armed && !inside) armed = true;
      if (armed && inside) {
        satisfied.add(legKey(leg));
        emit("leg", { leg, index: state.legIndex, phase: state.phase });
        state.legIndex += 1;
        if (state.legIndex >= legs.length) state.legDone = true;
        publishArea();
        // The NEXT leg gets the same test against the same placement — one
        // respawn can sit inside two volumes.
        armCurrentLeg();
        publishNav();
      }
    }
    publishNavRange(ctx.position);

    // §31/§32 — arriving at the recovery point (or running out of patience)
    // starts the closing sequence. It is a sub-state of EXTRACTION rather than a
    // tenth phase: the enum in §3 is the contract.
    if (state.phase === MissionPhase.EXTRACTION) {
      // Reaching the recovery volume is the ONLY thing that starts the closing
      // sequence. There is no "start it anyway" timer: a sortie that is never
      // flown home is not a sortie that finishes itself, it is one the deadline
      // ends as a loss.
      if (!state.recovering && state.legDone) {
        state.recovering = true;
        state.recoveryTime = 0;
      }
      if (state.recovering) {
        state.recoveryTime += dt;
        const r = cfg.recovery;
        state.autopilot = Math.min(1, state.recoveryTime / r.handover);
        const fadeStart = r.handover + r.hold;
        state.fade = state.recoveryTime <= fadeStart ? 0 : Math.min(1, (state.recoveryTime - fadeStart) / r.fade);
        state.recoveryDone = state.recoveryTime >= fadeStart + r.fade;
      }
    }

    enter(
      missionTransition(
        state,
        {
          strokeStarted: !!ctx.strokeStarted,
          launchDone: !!ctx.launchDone,
          hostileAlive: ctx.hostileAlive !== false,
          hostileSpent: !!ctx.hostileSpent,
          recoveryDone: state.recoveryDone,
        },
        cfg
      )
    );
    return state;
  }

  function publishNavRange(position) {
    state.navRange = state.navValid ? flatDistanceTo(state.navPosition, position) : 0;
    if (state.areaValid) {
      state.areaRange = flatDistanceTo(state.areaPosition, position);
      state.inArea = state.areaRange <= state.areaRadius;
    }
  }

  /** §37 — the timer starts at catapult release and is stated once, here. */
  function startTimer() {
    state.timerRunning = true;
  }

  /** §39 — a failure is a request to go back, not a phase. */
  function fail(reason) {
    state.failures += 1;
    emit("fail", { reason, phase: state.phase, checkpoint: state.checkpoint });
    return checkpoints[state.checkpoint] || checkpoints[0] || null;
  }

  /** Restore the checkpoint the current phase belongs to (§41). */
  function rewind() {
    const cp = checkpoints[state.checkpoint] || checkpoints[0];
    if (!cp) return null;
    stats.checkpointsUsed += 1;
    state.prevPhase = state.phase;
    state.phase = cp.phase;
    state.phaseTime = 0;
    state.missionTime = cp.missionTime;
    state.checkpoint = cp.index;
    state.recovering = false;
    state.recoveryTime = 0;
    state.recoveryDone = false;
    state.autopilot = 0;
    selectLegs();
    if (restoreCheckpoint) restoreCheckpoint(cp.snapshot, cp);
    cue = cp.phase;
    cueT = cfg.cueTime;
    emit("phase", { phase: cp.phase, from: state.prevPhase, checkpoint: cp.index, rewound: true });
    return cp;
  }

  function reset() {
    placedAt = null;
    armed = true;
    state.phase = MissionPhase.DECK;
    state.prevPhase = null;
    state.phaseTime = 0;
    state.missionTime = 0;
    state.timerRunning = false;
    state.checkpoint = 0;
    state.autopilot = 0;
    state.recovering = false;
    state.recoveryTime = 0;
    state.recoveryDone = false;
    state.fade = 0;
    state.failures = 0;
    state.finished = false;
    state.parked = false;
    stats.time = 0;
    stats.kills = 0;
    stats.groundKills = 0;
    stats.aim9Fired = 0;
    stats.gunFired = 0;
    stats.gunHits = 0;
    stats.evasions = 0;
    stats.checkpointsUsed = 0;
    for (let i = 0; i < checkpoints.length; i++) checkpoints[i] = null;
    // A fresh sortie has reached nothing. Must precede selectLegs(), which
    // publishes nav and would otherwise fall forward past the whole old route.
    satisfied.clear();
    flownThrough.clear();
    selectLegs();
    if (captureCheckpoint) {
      checkpoints[0] = { index: 0, phase: MissionPhase.DECK, missionTime: 0, snapshot: captureCheckpoint() };
      emit("checkpoint", { index: 0, phase: MissionPhase.DECK });
    }
    cue = MissionPhase.DECK;
    cueT = cfg.cueTime;
    return state;
  }

  return {
    state,
    stats,
    cfg,
    setRoute,
    update,
    startTimer,
    fail,
    rewind,
    reset,
    notifyPlaced,
    /** MISSION runs the phase machine; FREE and PEACE park after the launch. */
    setSandbox(on) {
      state.sandbox = !!on;
      return state.sandbox;
    },
    get route() {
      return route;
    },
    get legs() {
      return legs;
    },
    get checkpoints() {
      return checkpoints;
    },
    /**
     * Phase name to show for a couple of seconds after a transition (§17).
     *
     * Silent in a sandbox mode, for the same reason there is no nav there: §11's
     * rules table says FREE and PEACE have no phases, so announcing DECK and
     * LAUNCH across the middle of the frame is naming a structure the player is
     * not inside. The director still HAS those phases -- it owns the deck and
     * the catapult in every mode -- it just has nothing to say about them.
     */
    get cue() {
      return !state.sandbox && cueT > 0 ? cue : null;
    },
    /** Eased in and out, so the cue arrives and leaves rather than blinking. */
    get cueAlpha() {
      if (cueT <= 0) return 0;
      const f = cfg.cueTime * 0.18;
      const elapsed = cfg.cueTime - cueT;
      return Math.min(1, Math.min(elapsed, cueT) / f);
    },
    get encounter() {
      return encounterFor(state.phase, cfg);
    },
    get weaponsHot() {
      return weaponsHotIn(state.phase) && state.autopilot < 0.5;
    },
    get playerFlies() {
      return playerFliesIn(state.phase);
    },
    get summary() {
      return missionSummary(stats, cfg);
    },
    on(kind, fn) {
      events[kind].push(fn);
    },
  };
}
