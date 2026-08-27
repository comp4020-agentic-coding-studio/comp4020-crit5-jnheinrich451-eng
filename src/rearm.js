/**
 * Stage 04.1 §13 — automatic rearm.
 *
 * The short mission has a problem the flight lab did not: R used to be both the
 * reset and the reload, so running out of ammunition was never a real state.
 * Now R restarts the whole sortie, which means an empty aircraft two minutes in
 * is either a dead run or a reason to throw the mission away — and neither is
 * acceptable in a four-minute game where the player is expected to miss.
 *
 * So both magazines replenish on their own. The rule is deliberately the
 * simplest one that cannot be gamed:
 *
 *   the timer starts when the magazine reaches EMPTY, not when a round is fired
 *
 * Starting it on the first shot would let a player fire one AIM-9, wait, and be
 * handed a third round — the loadout would stop meaning anything. Starting it at
 * empty means the cooldown is the cost of having spent everything, and firing
 * your last round is a decision with a known price.
 *
 * The two weapons run independent timers (§13) so one is always coming back
 * while the other is out, and the player is never disarmed outright.
 *
 * THREE-free and side-effect-free apart from the callbacks it is handed, so the
 * whole rule is testable without a scene.
 */

export const REARM = {
  /** §13 — long enough to be felt, short enough to survive one engagement. */
  cooldown: 20,
};

/**
 * @param cooldown seconds from empty to full
 * @param isEmpty  () => boolean   is the magazine out right now?
 * @param refill   () => void      put the rounds back
 * @param onRearm  () => void      feedback, called once per completed cycle
 */
export function createRearmTimer({ cooldown = REARM.cooldown, isEmpty, refill, onRearm = null, label = "" } = {}) {
  const state = { label, running: false, remaining: 0, cycles: 0 };

  function update(dt) {
    const empty = !!isEmpty();
    if (!empty) {
      // Anything that put rounds back — a checkpoint restore, a mission restart
      // — cancels a running cycle rather than leaving a timer that will refill
      // an already-full magazine later.
      state.running = false;
      state.remaining = 0;
      return state;
    }
    if (!state.running) {
      state.running = true;
      state.remaining = cooldown;
      return state;
    }
    state.remaining = Math.max(0, state.remaining - dt);
    if (state.remaining > 0) return state;
    state.running = false;
    state.cycles += 1;
    refill();
    if (onRearm) onRearm(state);
    return state;
  }

  function reset() {
    state.running = false;
    state.remaining = 0;
    return state;
  }

  return {
    state,
    cooldown,
    update,
    reset,
    /** 0..1 progress toward a full magazine, for the rail. */
    get progress() {
      return state.running && cooldown > 0 ? 1 - state.remaining / cooldown : 0;
    },
  };
}

/**
 * Both magazines, as one object. Kept together only so main.js has one thing to
 * update and one thing to reset — they share no state and no timer.
 */
export function createRearmSystem({ rounds, gun, onRearm = null, cooldown = REARM.cooldown }) {
  const aim9 = createRearmTimer({
    cooldown,
    label: "AIM-9",
    isEmpty: () => (rounds ? rounds.count === 0 : false),
    refill: () => rounds && rounds.reload(),
    onRearm: () => onRearm && onRearm("AIM-9"),
  });
  const cannon = createRearmTimer({
    cooldown,
    label: "GUN",
    isEmpty: () => gun.state.ammo === 0,
    refill: () => {
      gun.state.ammo = gun.cfg.ammo;
      gun.state.dry = false;
    },
    onRearm: () => onRearm && onRearm("GUN"),
  });

  return {
    aim9,
    cannon,
    update(dt) {
      aim9.update(dt);
      cannon.update(dt);
    },
    reset() {
      aim9.reset();
      cannon.reset();
    },
    /** The soonest thing coming back, for a single rail line. */
    get pending() {
      const live = [aim9, cannon].filter((t) => t.state.running);
      if (!live.length) return null;
      live.sort((a, b) => a.state.remaining - b.state.remaining);
      return live[0].state;
    },
  };
}
