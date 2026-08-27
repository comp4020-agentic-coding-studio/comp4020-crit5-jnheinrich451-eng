// Automatic magazine replenishment. CLAUDE.md §14, stage 8.
//
// Both magazines replenish 20 s after reaching EMPTY, on INDEPENDENT timers,
// so one weapon is always coming back and the player is never disarmed.
//
// Three-free.

export const REARM_SECONDS = 20;

/**
 * @param weapons {name: {isEmpty(), refill()}}
 */
export function createRearm({ seconds = REARM_SECONDS, onRefill } = {}) {
  const timers = new Map();

  return {
    /** Seconds left on a weapon's cycle, or null if none is running. */
    remaining: (name) => (timers.has(name) ? timers.get(name) : null),
    isCycling: (name) => timers.has(name),
    active: () => [...timers.keys()],

    update(dt, weapons) {
      for (const [name, weapon] of Object.entries(weapons)) {
        if (!weapon) continue;
        const empty = weapon.isEmpty();

        if (!empty) {
          // AN EXTERNAL REFILL CANCELS A RUNNING CYCLE -- a checkpoint restore
          // or a restart -- so a timer started before it cannot later top up a
          // magazine that is already full.
          timers.delete(name);
          continue;
        }

        // START THE TIMER AT EMPTY, NOT AT THE FIRST SHOT. Otherwise the
        // player fires one AIM-9, waits, and is handed a third round: the
        // loadout stops meaning anything at all.
        if (!timers.has(name)) {
          timers.set(name, seconds);
          continue;
        }

        const left = timers.get(name) - dt;
        if (left <= 0) {
          timers.delete(name);
          weapon.refill();
          if (onRefill) onRefill(name);
        } else {
          timers.set(name, left);
        }
      }
    },

    reset() {
      timers.clear();
    },
  };
}
