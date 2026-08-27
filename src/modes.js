/**
 * Stage 04.2 — game modes.
 *
 * Until now there was one experience: a four-minute authored sortie you either
 * completed or restarted. The mission is the *point* of the project, but it is a
 * bad place to learn to fly, and it is a worse place to just look at the world.
 * So there are three modes, and the difference between them is a rules table
 * rather than three copies of the game.
 *
 *   MISSION   the authored sortie: phases, nav, checkpoints, a clock, an ending
 *   FREE      no clock, no phases; hostiles and SAMs keep coming; go anywhere
 *   PEACE     an empty sky, no clock, no threats — but the ground still kills
 *
 * Two things are deliberately the same in all three:
 *
 * - **Every mode starts on the carrier deck.** The catapult launch is the best
 *   thing in the build and it is also the thing that teaches the throttle and
 *   the camera, so no mode skips it.
 * - **The ground still kills you in PEACE.** "No hostiles" is not "no
 *   consequences" — a sky with nothing to hit is not a flight model, it is a
 *   screensaver. What changes is the cost: you go back to the deck, not to a
 *   checkpoint, and nothing is being timed.
 *
 * The respawn rule is the one real mechanical difference, and it falls out of
 * work that already exists: `placeOnDeck()` plus the launch sequence IS a
 * carrier respawn, so the sandbox modes get their loop for free.
 */

export const GameMode = { MISSION: "MISSION", FREE: "FREE", PEACE: "PEACE" };

export const MODE_ORDER = [GameMode.MISSION, GameMode.FREE, GameMode.PEACE];

/**
 * The whole difference between the modes. Anything that reads like a mode check
 * elsewhere in the project should be a lookup in here instead.
 */
export const MODES = {
  MISSION: {
    label: "OPERATION VECTOR",
    blurb: "authored sortie",
    phases: true, // the MissionDirector advances
    timer: true,
    nav: true,
    hostiles: true,
    sams: true,
    respawn: "CHECKPOINT",
    ending: true,
    /**
     * Stage 05.0 — only the authored sortie counts pilots. FREE and PEACE are
     * practice, and counting deaths in a sandbox turns it into a test.
     */
    lives: true,
  },
  FREE: {
    label: "FREE FLY",
    blurb: "open sky, live threats",
    phases: false,
    timer: false,
    nav: false,
    hostiles: true,
    sams: true,
    respawn: "CARRIER",
    ending: false,
    lives: false,
  },
  PEACE: {
    label: "PEACE",
    blurb: "open sky, no threats",
    phases: false,
    timer: false,
    nav: false,
    hostiles: false,
    sams: false,
    respawn: "CARRIER",
    ending: false,
    lives: false,
  },
};

export function modeRules(mode) {
  return MODES[mode] || MODES.MISSION;
}

export function nextMode(mode) {
  const i = MODE_ORDER.indexOf(mode);
  return MODE_ORDER[(i + 1) % MODE_ORDER.length];
}

/** Does this mode run the authored phase machine at all? */
export const isSandbox = (mode) => !modeRules(mode).phases;

export const SANDBOX = {
  /**
   * How long after a hostile dies before another shows up. Long enough that a
   * kill is a moment rather than a conveyor belt, short enough that FREE mode
   * does not become PEACE mode with extra steps.
   */
  hostileRespawn: 12,
  /**
   * SAM sites do NOT come back. Six of them is a finite thing to clear, and a
   * player who has spent four minutes destroying them has earned an empty
   * valley — the reward for clearing FREE mode is that you can then fly it. A
   * respawning site would make that work meaningless.
   */
  samRespawn: null,
  /** First hostile appears a beat after the player has the aircraft. */
  firstHostile: 8,

  /**
   * FREE FLY SEEDS ITS OWN SAM BATCHES, and MISSION does not.
   *
   * `samRespawn: null` above is the MISSION rule and stands: six authored sites
   * along the corridor, and clearing them earns an empty valley. That reward
   * only means anything because the mission ENDS. FREE fly does not, so a finite
   * six turns into an empty sky about four minutes in, and the mode becomes
   * PEACE with extra steps -- which is exactly what `hostileRespawn` above
   * already exists to prevent for the fighter.
   *
   * So in FREE fly the sites come in batches, seeded down the track the player
   * is actually flying. The rules below are what stop that being a conveyor
   * belt:
   *
   *   - a batch is at most `perBatch` sites, so the sky never fills up
   *   - a batch is only retired once the player is `clearRange` away from it,
   *     so sites you have destroyed stay destroyed while you can still see
   *     where they were, and sites you IGNORED are not quietly deleted out from
   *     under you either
   *   - the next batch is seeded ahead of your predicted position, not around
   *     you, so contact is something you fly into rather than something that
   *     appears on top of you
   */
  sam: {
    perBatch: 3,
    /** How far down the predicted track the batch centre sits. */
    ahead: 5200,
    /** Lateral scatter either side of the track, so it is not a firing line. */
    spread: 2000,
    /** Along-track scatter, so the three do not arrive simultaneously. */
    depth: 1400,
    /**
     * Retire a batch only once the player is this far from ALL of it. 7 km is
     * past the SAM's own 5 km detection range with room to spare, so a batch is
     * never swapped while it could still be fighting -- and never while it is
     * on the radar, whose outer ring is 6 km.
     */
    clearRange: 7000,
    /** A site must stand on land. Probed outward until it finds ground. */
    minGroundY: 30,
    probeScales: [1, 0.62, 1.34, 0.4, 1.7],
    /**
     * How long to wait before trying again when a seed placed NOTHING.
     *
     * Found by running it rather than by reading it: launching from the carrier
     * aims the prediction 5.2 km down the deck's heading, which is still open
     * water, so every site failed its ground probe and the batch came back
     * empty. An empty batch is spent by definition (samBatchSpent), so the
     * cycle re-seeded on the very next frame, and the next — 49 attempts and
     * zero sites by the time the aircraft reached EGRESS.
     *
     * The cooldown is the whole fix. It cannot wedge the mode the way refusing
     * to retry would, because the player keeps moving and the prediction moves
     * with them; it just stops the retry being a per-frame busy loop over an
     * ocean that will not have SAM sites in it whatever we ask.
     */
    retry: 6,
  },
};

/**
 * Where the player will be in a few kilometres, if they keep doing what they
 * are doing.
 *
 * Deliberately the crudest possible prediction: current position, current
 * heading, fixed distance. A turning player invalidates it immediately, which
 * is correct -- the batch is seeded once and then stays put, so a prediction
 * that tracked every input would just chase the nose around and drop sites
 * behind the aircraft.
 *
 * Heading convention is the project's: forward is (-sin h, -cos h) (§5).
 */
export function predictAhead(position, heading, cfg = SANDBOX) {
  const d = cfg.sam.ahead;
  return {
    x: position.x - Math.sin(heading) * d,
    z: position.z - Math.cos(heading) * d,
  };
}

/**
 * Lay out a batch of SAM positions around a centre, on ground.
 *
 * `groundAt` is injected rather than reached for, so the whole placement rule is
 * testable against a synthetic height field with no scene (§4). `rand` is
 * injected for the same reason: a scatter that cannot be made deterministic
 * cannot be asserted.
 *
 * A site with nowhere to stand is DROPPED, not floated -- the same rule the
 * authored placement uses (§13). Two sites on land beat three with one in the
 * sea, so this returns "up to" perBatch, not exactly perBatch.
 */
export function seedSamBatch(centre, heading, groundAt, rand = Math.random, cfg = SANDBOX) {
  const s = cfg.sam;
  const out = [];
  // Track axis, so scatter is ACROSS and ALONG the player's course rather than
  // along world axes — a batch laid out on X/Z would read as a grid from the air.
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const rx = -fz;
  const rz = fx;
  for (let i = 0; i < s.perBatch; i++) {
    const lateral = (rand() * 2 - 1) * s.spread;
    const along = (rand() * 2 - 1) * s.depth;
    let placed = null;
    for (const scale of s.probeScales) {
      const x = centre.x + rx * lateral * scale + fx * along;
      const z = centre.z + rz * lateral * scale + fz * along;
      const y = groundAt ? groundAt(x, z) : 0;
      if (Number.isFinite(y) && y >= s.minGroundY) {
        placed = { name: `SamFree${i + 1}`, x, y, z };
        break;
      }
    }
    if (placed) out.push(placed);
  }
  return out;
}

/**
 * Is this batch finished with? Only then may it be replaced.
 *
 * Two ways, and the distance one is the load-bearing half. "All dead" alone
 * would let a player who flew straight past an untouched batch never see
 * another one; distance alone would swap a batch the player is still fighting.
 * An empty batch is spent by definition — that is the seeding failure case,
 * and without it a batch that found no ground would wedge the mode forever.
 */
export function samBatchSpent(playerPosition, batch, cfg = SANDBOX) {
  if (!batch || batch.length === 0) return true;
  if (batch.every((s) => !s.alive)) return true;
  return batch.every((s) => {
    const dx = s.position.x - playerPosition.x;
    const dz = s.position.z - playerPosition.z;
    return Math.hypot(dx, dz) > cfg.sam.clearRange;
  });
}

/**
 * The sandbox driver: what MISSION's phase machine does for FREE and PEACE.
 *
 * It is deliberately tiny. There is no wave logic, no difficulty curve and no
 * director — one hostile at a time, respawning on a timer, and whatever SAM
 * sites are left. FREE mode is a place to practise, not a survival mode with a
 * hidden score.
 *
 * @param spawnHostile () => void   place and activate the hostile
 * @param setHostile   (on) => void
 * @param setSams      (on) => void
 */
export function createSandbox({ spawnHostile = null, setHostile = null, setSams = null, seedSams = null, cfg = SANDBOX } = {}) {
  const state = { mode: GameMode.FREE, live: false, respawn: 0, spawns: 0, elapsed: 0, samBatches: 0, samRetry: 0 };

  /** Called once when the player receives control in a sandbox mode. */
  function begin(mode) {
    const rules = modeRules(mode);
    state.mode = mode;
    state.live = true;
    state.elapsed = 0;
    state.spawns = 0;
    state.respawn = rules.hostiles ? cfg.firstHostile : Infinity;
    state.samBatches = 0;
    state.samRetry = 0;
    if (setSams) setSams(!!rules.sams);
    if (setHostile) setHostile(false);
    return state;
  }

  /**
   * @param hostileAlive  is the current hostile still flying?
   * @param position      the player, for the SAM batch cycle
   * @param heading       ...and where they are pointed
   * @param samsSpent     has the current batch been dealt with? (samBatchSpent)
   */
  function update({ hostileAlive, position = null, heading = 0, samsSpent = false }, dt) {
    if (!state.live) return state;
    state.elapsed += dt;

    /**
     * The SAM batch cycle, ahead of the hostile one because it has no timer:
     * a batch is replaced when it is SPENT, not on a clock. That is the whole
     * difference between seeding contact and running a spawner.
     *
     * The one clock here is the FAILURE cooldown, and it only runs when a seed
     * placed nothing — see `cfg.sam.retry`. `seedSams` returns how many sites
     * it managed to stand up, so the driver can tell "no ground under the
     * prediction" from "a batch is flying".
     */
    if (state.samRetry > 0) state.samRetry = Math.max(0, state.samRetry - dt);
    if (seedSams && position && samsSpent && state.samRetry === 0) {
      const placed = seedSams(predictAhead(position, heading, cfg), heading) || 0;
      if (placed > 0) state.samBatches += 1;
      else state.samRetry = cfg.sam.retry;
    }

    if (!Number.isFinite(state.respawn)) return state;
    if (hostileAlive) return state; // one at a time, always
    state.respawn -= dt;
    if (state.respawn > 0) return state;
    state.respawn = cfg.hostileRespawn;
    state.spawns += 1;
    if (spawnHostile) spawnHostile();
    return state;
  }

  function reset() {
    state.live = false;
    state.respawn = 0;
    state.spawns = 0;
    state.elapsed = 0;
    state.samBatches = 0;
    state.samRetry = 0;
    return state;
  }

  return { state, cfg, begin, update, reset };
}
