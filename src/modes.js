// The rules table, and the sandbox driver. CLAUDE.md §11, stage 8.
//
// A RULES TABLE, NOT THREE COPIES OF THE GAME. Anything that reads like a mode
// check elsewhere should be a lookup here.
//
// Three-free.

export const MISSION = "MISSION";
export const FREE = "FREE";
export const PEACE = "PEACE";

export const MODE_ORDER = [MISSION, FREE, PEACE];

export const MODES = {
  [MISSION]: {
    phases: true, timer: true, nav: true,
    hostiles: true, sams: true,
    respawn: "crash-relative",
    lives: 5,
  },
  [FREE]: {
    phases: false, timer: false, nav: false,
    hostiles: true, sams: true,
    respawn: "carrier",
    lives: null, // LIVES ARE MISSION ONLY: FREE and PEACE are practice, and
                 // counting deaths in a sandbox turns it into a test.
    sandbox: true,
  },
  [PEACE]: {
    phases: false, timer: false, nav: false,
    hostiles: false, sams: false,
    respawn: "carrier",
    lives: null,
    sandbox: true,
  },
};

// Two rules identical across all three modes:
//
//  - EVERY MODE FLIES THE CATAPULT LAUNCH. It is the strongest moment in the
//    build and it is what teaches the throttle and the camera.
//  - THE GROUND STILL KILLS YOU IN PEACE. "No hostiles" is not "no
//    consequences" -- a sky with nothing to hit is a screensaver. What changes
//    is the COST: you return to the deck and nothing is timed.
export const ALWAYS = { launch: true, groundKills: true };

export const rulesFor = (mode) => MODES[mode] ?? MODES[MISSION];
export const nextMode = (mode) =>
  MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length];

/**
 * The sandbox driver, DELIBERATELY TINY: no waves, no difficulty curve, no
 * hidden score. One hostile at a time, respawning 12 s after a kill, first
 * arrival 8 s after the handoff.
 */
export const SANDBOX = { firstArrival: 8, respawnAfter: 12 };

export function createSandbox({ cfg = SANDBOX } = {}) {
  let timer = 0;
  let armed = false;
  let spawns = 0;

  return {
    spawnCount: () => spawns,
    pending: () => (armed ? Math.max(0, timer) : null),

    /** @returns true on the frame a hostile should be deployed. */
    update(dt, { mode, handedOff, hostileAlive }) {
      const rules = rulesFor(mode);
      // PEACE spawns NOTHING, however long you fly.
      if (!rules.sandbox || !rules.hostiles || !handedOff) {
        armed = false;
        return false;
      }
      if (!armed) {
        armed = true;
        timer = cfg.firstArrival;
        return false;
      }
      // ONE AT A TIME: nothing is queued while one is alive.
      if (hostileAlive) {
        timer = cfg.respawnAfter;
        return false;
      }
      timer -= dt;
      if (timer <= 0) {
        timer = cfg.respawnAfter;
        spawns++;
        return true;
      }
      return false;
    },

    reset() {
      timer = 0;
      armed = false;
    },
    resetAll() {
      this.reset();
      spawns = 0;
    },
  };
}
