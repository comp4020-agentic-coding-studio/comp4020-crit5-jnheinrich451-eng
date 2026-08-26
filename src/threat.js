// What is being done to the PLAYER. CLAUDE.md §16, stage 6.
//
// Separate from hostile.js on purpose: in stage 8 a second, completely
// different source -- ground sites -- escalates through this same display, and
// the HUD and the audio both read the escalation from here rather than each
// deciding for themselves. That is why the sound and the HUD cannot disagree.

export const NONE = "NONE";
export const TRACK = "TRACK";
export const LOCK = "LOCK";
export const MISSILE = "MISSILE";

const ORDER = { [NONE]: 0, [TRACK]: 1, [LOCK]: 2, [MISSILE]: 3 };

// The barrel roll's peak window. Expert gets a tighter one: finer control, so
// the timing is worth more.
export const EVADE_WINDOW = { ASSISTED: 0.6, EXPERT: 0.42 };
// How far authority is pulled down inside that window. Never to zero (§14): a
// defeated round keeps flying its curve and can still get lucky on the fuze,
// so a miss reads as a miss rather than as the game switching a threat off.
export const EVADE_AUTHORITY = 0.12;
const MIN_AUTHORITY = 0.06;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);

/**
 * The single point through which every counter-measure in the game works.
 *
 * The missile asks "how much guidance do I still have?" and must never learn
 * what a barrel roll, a ridge or a flare is. Stage 8 composes two more
 * penalties onto this same function.
 */
export function authorityFor(missile, evasion) {
  // A counter-measure never affects the PLAYER's own rounds.
  if (!missile || missile.owner === "player") return 1;
  if (!evasion || !(evasion.remaining > 0)) return 1;
  return Math.max(MIN_AUTHORITY, EVADE_AUTHORITY);
}

export function createThreatMonitor() {
  let level = NONE;
  let distance = Infinity;
  let closing = 0;
  let bearing = { x: 0, y: 0, z: 0 };
  let progress = 0;
  let source = null;
  let lastRange = Infinity;

  return {
    /**
     * @param acquisitions [{ level, position, label, progress }] -- anything
     *        pointing a sensor at the player, from any source.
     * @param rounds live missiles, any owner.
     */
    update(dt, { position }, acquisitions = [], rounds = []) {
      let best = NONE;
      let bestSource = null;
      let bestRange = Infinity;

      // A LIVE ROUND ALWAYS OUTRANKS AN ACQUISITION -- it is the only one of
      // the two the player cannot ignore.
      for (const round of rounds) {
        if (!round || round.owner === "player") continue;
        const d = sub(round.position, position);
        const range = len(d);
        if (range < bestRange || best !== MISSILE) {
          best = MISSILE;
          bestSource = { label: round.config?.name ?? "MISSILE", position: round.position };
          bestRange = Math.min(bestRange, range);
          bearing = d;
        }
      }

      if (best !== MISSILE) {
        for (const a of acquisitions) {
          if (!a || ORDER[a.level] === undefined || a.level === NONE) continue;
          const d = sub(a.position, position);
          const range = len(d);
          // With two acquisitions at once the CLOSER one is named: a site at
          // 900 m is more urgent than a fighter tracking from 4 km.
          const better =
            ORDER[a.level] > ORDER[best] ||
            (ORDER[a.level] === ORDER[best] && range < bestRange);
          if (better) {
            best = a.level;
            bestSource = a;
            bestRange = range;
            bearing = d;
            progress = a.progress ?? 0;
          }
        }
      }

      level = best;
      source = bestSource;
      distance = bestRange;
      closing = Number.isFinite(lastRange) ? (lastRange - bestRange) / Math.max(dt, 1e-6) : 0;
      lastRange = bestRange;
      if (best !== TRACK && best !== LOCK) progress = best === MISSILE ? 1 : 0;

      return this.state();
    },

    state: () => ({
      level,
      distance,
      closing,
      bearing,
      progress,
      source,
      // Labelled by ORIGIN, because the answer differs: terrain for a SAM,
      // turning for a fighter. Same three words, different prefix.
      label:
        level === NONE
          ? ""
          : `${source && source.origin === "sam" ? "SAM " : ""}${level}`,
    }),

    reset() {
      level = NONE;
      distance = Infinity;
      closing = 0;
      progress = 0;
      source = null;
      lastRange = Infinity;
    },
  };
}

/**
 * The barrel roll: a DISCRETE, LATCHED request, never a held axis.
 *
 * Announcing EVADE on every miss teaches the player nothing, so the caller is
 * told whether the round it defeated was actually going to hit.
 */
export function createEvasion() {
  let remaining = 0;
  let mode = "ASSISTED";
  let defeated = 0;

  return {
    request(currentMode) {
      mode = currentMode === "EXPERT" ? "EXPERT" : "ASSISTED";
      if (remaining > 0) return false; // already rolling
      remaining = EVADE_WINDOW[mode];
      return true;
    },
    update(dt) {
      if (remaining > 0) remaining = Math.max(0, remaining - dt);
    },
    get remaining() {
      return remaining;
    },
    isRolling: () => remaining > 0,
    window: () => EVADE_WINDOW[mode],
    noteDefeated() {
      defeated++;
    },
    defeatedCount: () => defeated,
    reset() {
      remaining = 0;
      defeated = 0;
    },
  };
}

/**
 * Was a round that missed actually going to hit?
 *
 * Compares the round's closest approach on its CURRENT heading against the
 * fuze radius. Only a miss that would otherwise have connected is worth
 * calling an evade.
 */
export function wouldHaveHit(round, playerPosition) {
  if (!round) return false;
  const d = sub(playerPosition, round.position);
  const v = round.velocity;
  const speed = len(v);
  if (speed === 0) return false;
  const t = (d.x * v.x + d.y * v.y + d.z * v.z) / (speed * speed);
  if (t < 0) return false;
  const miss = len({
    x: d.x - v.x * t,
    y: d.y - v.y * t,
    z: d.z - v.z * t,
  });
  return miss <= (round.config?.fuze ?? 10) * 1.6;
}
