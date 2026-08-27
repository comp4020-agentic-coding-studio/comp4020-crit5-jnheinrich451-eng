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
};

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
export function createSandbox({ spawnHostile = null, setHostile = null, setSams = null, cfg = SANDBOX } = {}) {
  const state = { mode: GameMode.FREE, live: false, respawn: 0, spawns: 0, elapsed: 0 };

  /** Called once when the player receives control in a sandbox mode. */
  function begin(mode) {
    const rules = modeRules(mode);
    state.mode = mode;
    state.live = true;
    state.elapsed = 0;
    state.spawns = 0;
    state.respawn = rules.hostiles ? cfg.firstHostile : Infinity;
    if (setSams) setSams(!!rules.sams);
    if (setHostile) setHostile(false);
    return state;
  }

  /** @param hostileAlive is the current hostile still flying? */
  function update({ hostileAlive }, dt) {
    if (!state.live) return state;
    state.elapsed += dt;
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
    return state;
  }

  return { state, cfg, begin, update, reset };
}
