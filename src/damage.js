// PlayerDamageEvent and the feedback response. CLAUDE.md §4, stage 6.
//
// Taking a hit is an EVENT, not a reset call. Missile code must never call
// anything that resets the flight state (§4's corollary) -- it emits, and a
// response policy decides what a hit MEANS. This stage's response is feedback
// only: a red veil, a HIT label, a camera kick. Stage 7 replaces the
// CONSEQUENCE without touching a line of weapon code.

/**
 * @typedef {{
 *   source: string, at: number,
 *   position: {x:number,y:number,z:number},
 *   amount: number, owner: string,
 * }} PlayerDamageEvent
 */

const HOLD_SECONDS = 0.55;
const COOLDOWN_SECONDS = 0.9;
const CAMERA_KICK = 0.5;

export function createDamageResponse({ addShake, onFeedback } = {}) {
  let hold = 0;
  let cooldown = 0;
  let taken = 0;
  let last = null;

  return {
    name: "FeedbackDamageResponse",

    /**
     * ONE RESPONSE PER HIT.
     *
     * A proximity fuze inside a 22 m sphere can trip on consecutive frames,
     * and a re-entrant response loops forever. Anything arriving while holding
     * or in cooldown is SWALLOWED -- and swallowed silently, because a warning
     * per frame is its own kind of loop.
     */
    handle(event) {
      if (hold > 0 || cooldown > 0) return false;
      hold = HOLD_SECONDS;
      cooldown = HOLD_SECONDS + COOLDOWN_SECONDS;
      taken++;
      last = event;
      if (addShake) addShake(CAMERA_KICK);
      if (onFeedback) onFeedback(event);
      return true;
    },

    tick(dt) {
      if (hold > 0) hold = Math.max(0, hold - dt);
      if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
    },

    /** 0..1, for the red veil. Presentation reads this; nothing else does. */
    veil() {
      return hold > 0 ? hold / HOLD_SECONDS : 0;
    },
    isHolding: () => hold > 0,
    hitsTaken: () => taken,
    lastEvent: () => last,

    reset() {
      hold = 0;
      cooldown = 0;
      last = null;
    },
    /** Presentation resets; the tally does not (§17.11). */
    resetAll() {
      this.reset();
      taken = 0;
    },
  };
}

export function playerDamageEvent({ source, at, position, amount, owner }) {
  return {
    source,
    at,
    position: { ...position },
    amount,
    owner,
  };
}
