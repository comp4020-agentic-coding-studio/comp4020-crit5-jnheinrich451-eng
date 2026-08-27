/**
 * Stage 03.3 §30–§32 — the player taking a hit.
 *
 * Deliberately the same shape as Stage 02.3's collision architecture: the thing
 * that detects damage produces an *event* and knows nothing else; a response
 * policy decides what a hit means. Missile code never calls resetFlight() (§31),
 * so replacing this development response with a real breakup-and-crash sequence
 * later touches no weapon code.
 */

export const DamageSource = { MISSILE: "MISSILE", GUN: "GUN", TERRAIN: "TERRAIN" };

/** The event. Plain data, no behaviour — that is the point. */
export function createPlayerDamageEvent({ source = DamageSource.MISSILE, at = 0, position = null, amount = 1, owner = "hostile" } = {}) {
  return { source, at, position, amount, owner };
}

/**
 * Development response: freeze-frame feedback, then the existing combat reset.
 *
 * The one hard requirement is that a hit produces exactly ONE response (§47). A
 * proximity fuze inside a 22 m sphere can trip on consecutive frames, and a
 * response that re-entered would loop the reset forever.
 *
 * @param onHit      called once, immediately, with the event (HUD flash, shake)
 * @param onRecover  called when the hold expires (the reset)
 */
export function createDevelopmentHitResponse({ onHit = null, onRecover = null, holdTime = 1.0, cooldown = 1.2 } = {}) {
  const state = {
    hits: 0,
    holding: false,
    remaining: 0,
    cooldown: 0,
    lastSource: null,
    /** 0..1 while the hit is being felt — drives the HUD flash and the camera. */
    impact: 0,
  };
  let pending = null;

  function apply(event) {
    // Already responding, or still settling from the last one: swallow it.
    if (state.holding || state.cooldown > 0) return false;
    state.hits += 1;
    state.holding = true;
    state.remaining = holdTime;
    state.impact = 1;
    state.lastSource = event ? event.source : null;
    pending = event;
    if (onHit) onHit(event);
    return true;
  }

  function update(dt) {
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
    if (!state.holding) {
      state.impact = Math.max(0, state.impact - dt * 2.5);
      return state;
    }
    state.remaining = Math.max(0, state.remaining - dt);
    // Impact decays across the hold, so the flash and the camera kick fade
    // rather than switching off at the reset.
    state.impact = holdTime > 0 ? state.remaining / holdTime : 0;
    if (state.remaining <= 0) {
      state.holding = false;
      state.cooldown = cooldown;
      const ev = pending;
      pending = null;
      if (onRecover) onRecover(ev);
    }
    return state;
  }

  function reset() {
    state.holding = false;
    state.remaining = 0;
    state.cooldown = 0;
    state.impact = 0;
    pending = null;
    return state;
  }

  return { state, apply, update, reset, get feedback() { return state.holding ? "HIT" : null; } };
}
