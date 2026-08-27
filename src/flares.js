// The infrared countermeasure. CLAUDE.md §14, stage 8.
//
// A SEDUCED ROUND IS RE-TARGETED, NOT SWITCHED OFF. That is the whole
// mechanic, and it is the easy one to get wrong -- see seduces() below.
//
// Flares are INFRARED: they defeat a MISSILE, never a radar LOCK. A SAM that
// has you locked still has you.

import { createTarget } from "./enemy.js";

export const FLARE_CFG = {
  count: 8,
  perBurst: 3,
  cooldown: 1.4,
  burn: 3.2,
  seduceRadius: 320,
  // KEPT WELL BELOW seduceRadius. The cloud sits ~200 m astern a second after
  // release, so a standoff anywhere near that distance cancels the radius out
  // and the mechanic never fires at all. The suite asserts the relationship
  // rather than the number.
  minStandoff: 160,
  inherit: 0.28, // of the aircraft's speed
  drag: 1.9,
  gravity: 9.81,
  ejectDown: 26,
  ejectBack: 34,
};

/**
 * Should a flare take this round?
 *
 * @param flareRange  round -> flare
 * @param targetRange round -> the aircraft it is chasing
 *
 * FAIRNESS IS GEOMETRY, NOT DICE. Because flares fall behind on the player's
 * own flight path, all three cases come out of this one comparison for free:
 *
 *   stern chase  the round flies THROUGH the cloud            -> decoyed
 *   head-on      the round arrives before the flares are near -> not decoyed
 *   committed    inside minStandoff the round cannot be pulled off, and the
 *                answer is the barrel roll instead
 */
export function seduces(flareRange, targetRange, cfg = FLARE_CFG) {
  if (targetRange < cfg.minStandoff) return false; // committed
  if (flareRange > cfg.seduceRadius) return false; // cloud not near it
  // A flare further away than the target it is trying to replace is not a
  // decoy, it is a distraction.
  return flareRange < targetRange;
}

export function createFlares({ cfg = FLARE_CFG } = {}) {
  const flares = [];
  let remaining = cfg.count;
  let cooldown = 0;
  let dispensed = 0;

  return {
    flares,
    get remaining() {
      return remaining;
    },
    isReady: () => remaining > 0 && cooldown <= 0,
    dispensedCount: () => dispensed,

    /** Eject a burst DOWN AND BACK, so the cloud falls behind on the player's
     *  own flight path -- which is what produces the three cases above. */
    dispense(state, forward, now = 0) {
      if (remaining <= 0 || cooldown > 0) return 0;
      const n = Math.min(cfg.perBurst, remaining);
      remaining -= n;
      cooldown = cfg.cooldown;
      dispensed += n;
      for (let i = 0; i < n; i++) {
        // A little spread so the burst is a cloud rather than a point.
        const spread = (i - (n - 1) / 2) * 6;
        const flare = createTarget({
          label: "FLARE",
          position: {
            x: state.position.x + spread,
            y: state.position.y,
            z: state.position.z,
          },
          velocity: {
            x: forward.x * state.speed * cfg.inherit - forward.x * cfg.ejectBack,
            y: forward.y * state.speed * cfg.inherit - cfg.ejectDown,
            z: forward.z * state.speed * cfg.inherit - forward.z * cfg.ejectBack,
          },
          health: 1,
          radius: 2,
        });
        flare.burnUntil = now + cfg.burn;
        flares.push(flare);
      }
      return n;
    },

    update(dt, now = 0) {
      if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
      for (let i = flares.length - 1; i >= 0; i--) {
        const f = flares[i];
        // Heavy drag and gravity: the cloud slows hard and sinks, which is why
        // a stern chase flies through it and a head-on shot never meets it.
        const k = Math.exp(-cfg.drag * dt);
        f.velocity.x *= k;
        f.velocity.z *= k;
        f.velocity.y = f.velocity.y * k - cfg.gravity * dt;
        f.position.x += f.velocity.x * dt;
        f.position.y += f.velocity.y * dt;
        f.position.z += f.velocity.z * dt;

        if (now >= f.burnUntil) {
          // BURNT OUT: mark it dead and leave it for one more frame's cleanup.
          // The missile's existing "no live target" branch then stops guidance
          // and the round coasts out -- no new code in missile.js at all.
          f.alive = false;
        }
      }
      for (let i = flares.length - 1; i >= 0; i--) {
        if (!flares[i].alive && now > flares[i].burnUntil + 0.5) flares.splice(i, 1);
      }
    },

    /**
     * Offer the cloud to every hostile round in the air.
     *
     * RE-TARGETS, never flags. The round's `target` is swapped to the flare,
     * which publishes the same target contract everything else does, so the
     * round visibly turns and chases it and its fuze tests against it. The
     * missile system needs no changes at all.
     *
     * Do NOT instead set a "lost" flag that freezes the round's heading: a
     * round that was tracking well is ALREADY POINTED AT THE PLAYER, so
     * freezing it changes nothing and it arrives anyway. That flag is right
     * for an overshoot -- where the round is by definition pointed the wrong
     * way -- and completely wrong for a decoy. Implemented that way, flares
     * appear to do nothing.
     */
    offerTo(rounds, aircraftPosition, cfg2 = cfg) {
      let seduced = 0;
      for (const round of rounds) {
        if (!round || round.owner === "player") continue;
        if (round.seducedBy) continue;
        const target = round.target;
        if (!target || target.label === "FLARE") continue;

        const targetRange = Math.hypot(
          aircraftPosition.x - round.position.x,
          aircraftPosition.y - round.position.y,
          aircraftPosition.z - round.position.z,
        );
        let best = null;
        let bestRange = Infinity;
        for (const flare of flares) {
          if (!flare.alive) continue;
          const r = Math.hypot(
            flare.position.x - round.position.x,
            flare.position.y - round.position.y,
            flare.position.z - round.position.z,
          );
          if (r < bestRange) {
            bestRange = r;
            best = flare;
          }
        }
        if (best && seduces(bestRange, targetRange, cfg2)) {
          round.target = best;
          round.seducedBy = best;
          seduced++;
        }
      }
      return seduced;
    },

    reset() {
      flares.length = 0;
      remaining = cfg.count;
      cooldown = 0;
    },
    resetAll() {
      this.reset();
      dispensed = 0;
    },
  };
}
