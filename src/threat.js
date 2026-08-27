/**
 * Stage 03.3 — the player's side of an engagement: what is being done to them,
 * how urgent it is, where it is coming from, and whether the barrel roll just
 * worked.
 *
 * Pure state derivation. It owns no rendering and no gameplay authority: the
 * HUD reads its published state (§11–§13, §24–§25) and the missile system asks
 * it for guidance authority (§21). Fairness lives here, so it is all in one
 * readable place rather than spread across the missile loop.
 */

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** §11 — the progression the player is taught. Exactly these four. */
export const ThreatLevel = { NONE: "NONE", TRACK: "TRACK", LOCK: "LOCK", MISSILE: "MISSILE" };

/** §25 — restrained escalation, three tiers and no screen flashing. */
export const ThreatTier = { FAR: "FAR", NEAR: "NEAR", URGENT: "URGENT" };

export const THREAT = {
  // §25 tier boundaries, in metres.
  nearRange: 1000,
  urgentRange: 500,

  /**
   * §21/§22 — the barrel-roll dodge window, as a fraction of the roll.
   *
   * The roll is 1.5 s long (ROLL.duration). `peakStart` is where the manoeuvre
   * is most violent — past the entry, into the hardest part of the helix — and
   * the window is expressed in *seconds* because that is the quantity §22 and
   * §40 are written in.
   */
  peakStart: 0.26,
  assistedWindow: 0.6, // §40: 0.60 s
  expertWindow: 0.42, // §40: 0.40–0.45 s
  rollDuration: 1.5,

  /**
   * §22/§23 — the dodge only works if the missile is committed. Inside
   * `dodgeRange` a peak manoeuvre cripples its guidance; between there and
   * `earlyRange` it degrades it partially; beyond that it does nothing at all,
   * because the round has time to reacquire.
   */
  dodgeRange: 600,
  earlyRange: 1000,
  // Turn authority left to a fully defeated round. Not zero: it keeps flying a
  // curve, so a miss reads as a miss rather than as a missile switching off.
  dodgeAuthority: 0.14,
  partialAuthority: 0.55,
  /**
   * A stern chase is the hardest geometry to barrel-roll out of — the round is
   * already going where you are going, so the manoeuvre asks less of it. Inside
   * this crossing angle the dodge is half as effective, which is the §22 "and
   * approaching from a difficult angle" clause expressed as a number.
   */
  minCrossingDeg: 25,
  tailChaseRelief: 0.5,

  /** §43 — a miss is only worth announcing if it was going to be a hit. */
  evadeRange: 900,

  // Assisted sees the warning slightly sooner (§40). Purely a display lead: the
  // missile's physics are identical in both modes.
  assistedWarnLead: 0.35,
};

/**
 * Collapse a wing of hostiles into the single `{tracking, locked, lockProgress}`
 * the threat monitor reads.
 *
 * The monitor asks one question -- "what is being done to the player" -- and the
 * answer does not get less urgent because a second aircraft is doing it. So the
 * merge is the WORST case across the wing, not an average and not the nearest:
 * one locked fighter and one merely tracking is a LOCK, and showing TRACK
 * because the other one has not got there yet would be a lie the player pays
 * for.
 *
 * `lockProgress` takes the maximum for the same reason -- it drives the lock
 * pip, and the pip should follow whichever aircraft is closest to firing.
 *
 * Pure, so the rule is asserted without a scene (§4). MISSION passes a wing of
 * one and gets exactly what it always got.
 */
export function mergeHostiles(states) {
  const out = { tracking: false, locked: false, lockProgress: 0 };
  if (!states) return out;
  for (const h of states) {
    if (!h) continue;
    if (h.tracking) out.tracking = true;
    if (h.locked) out.locked = true;
    if (typeof h.lockProgress === "number" && h.lockProgress > out.lockProgress) out.lockProgress = h.lockProgress;
  }
  return out;
}

/** §11 — one level from the hostile's state and the sky. Incoming wins. */
export function threatLevelOf({ incoming = false, locked = false, tracking = false }) {
  if (incoming) return ThreatLevel.MISSILE;
  if (locked) return ThreatLevel.LOCK;
  if (tracking) return ThreatLevel.TRACK;
  return ThreatLevel.NONE;
}

/** §25 — urgency from distance alone. */
export function warningTier(distance, cfg = THREAT) {
  if (distance <= cfg.urgentRange) return ThreatTier.URGENT;
  if (distance <= cfg.nearRange) return ThreatTier.NEAR;
  return ThreatTier.FAR;
}

/**
 * §13 — where the threat is, in the player's own frame. Returns the lateral and
 * vertical components in view space plus the arrow that best describes it.
 * `behind` is its own answer: an arrow pointing off the side of the screen for
 * something directly astern would be a lie.
 */
export function threatBearing(forward, right, up, from, to, out = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  const f = nx * forward.x + ny * forward.y + nz * forward.z;
  const r = nx * right.x + ny * right.y + nz * right.z;
  const u = nx * up.x + ny * up.y + nz * up.z;
  out.forward = f;
  out.lateral = r;
  out.vertical = u;
  out.behind = f < -0.2;
  out.range = len;
  if (out.behind) out.arrow = "\u25bc"; // astern: the one case with no on-screen direction
  else if (Math.abs(r) >= Math.abs(u)) out.arrow = r >= 0 ? "\u25b6" : "\u25c0";
  else out.arrow = u >= 0 ? "\u25b2" : "\u25bc";
  return out;
}

/** §22 — the peak window as normalized roll progress. */
export function dodgeWindow(expert, cfg = THREAT) {
  const seconds = expert ? cfg.expertWindow : cfg.assistedWindow;
  const start = cfg.peakStart;
  return { start, end: Math.min(1, start + seconds / cfg.rollDuration), seconds };
}

/** Is the running manoeuvre inside its peak window right now? */
export function inDodgePeak(maneuver, expert, cfg = THREAT) {
  if (!maneuver || maneuver.kind !== "roll") return false;
  const w = dodgeWindow(expert, cfg);
  return maneuver.t >= w.start && maneuver.t <= w.end;
}

/**
 * §21/§23 — how much turn authority an incoming round keeps this frame.
 *
 * 1 is untouched. The manoeuvre is not invulnerability: it is a range-and-aspect
 * dependent penalty, so pressing Space the instant the launch warning appears
 * buys nothing (the round is far away and has time to reacquire), and pressing
 * it late against a committed round forces the overshoot.
 *
 * `aspectDeg` is the angle between the round's heading and the player's — a
 * crossing attack is spoiled far more easily than a stern chase.
 */
export function evasionAuthority({ inPeak, range, aspectDeg }, cfg = THREAT) {
  if (!inPeak) return 1;
  let authority;
  if (range <= cfg.dodgeRange) authority = cfg.dodgeAuthority;
  else if (range <= cfg.earlyRange) {
    // Linear between the two, so there is no cliff the player can memorise.
    const k = (range - cfg.dodgeRange) / (cfg.earlyRange - cfg.dodgeRange);
    authority = cfg.dodgeAuthority + (cfg.partialAuthority - cfg.dodgeAuthority) * k;
  } else return 1;
  if (aspectDeg !== undefined && aspectDeg < cfg.minCrossingDeg) {
    authority += (1 - authority) * cfg.tailChaseRelief;
  }
  return authority;
}

/** §43 — did this expiring round ever get close enough for a miss to be news? */
export function evadeEarned(minRange, cfg = THREAT) {
  return Number.isFinite(minRange) && minRange <= cfg.evadeRange;
}

/**
 * Stateful monitor. `state` is the only thing the HUD and the dev rail read.
 */
export function createThreatMonitor(cfg = THREAT) {
  const state = {
    level: ThreatLevel.NONE,
    tier: ThreatTier.FAR,
    distance: 0,
    closing: 0,
    arrow: "",
    lateral: 0,
    vertical: 0,
    behind: false,
    incoming: 0,
    lockProgress: 0,
    /**
     * Stage 04.2 — which kind of thing is doing this to the player: "AIR" or
     * "SAM". The words TRACK / LOCK / MISSILE are unchanged (the brief asked to
     * reuse them); this is the one extra fact the HUD needs to label them, and
     * it matters because the answer to a SAM is terrain and the answer to a
     * fighter is turning.
     */
    source: "AIR",
    // §21 diagnostics: what the dodge is doing to the nearest round, if anything.
    dodgeActive: false,
    authority: 1,
  };

  const bearing = {};
  // Closing rate is a difference between frames, so the FIRST frame of a new
  // threat has nothing to difference against. Remembering *which* round was
  // nearest is the only honest way to know that: seeding from 0 reports tens of
  // thousands of m/s for a tenth of a second every time a round appears.
  let lastNearest = null;
  let lastDistance = 0;

  /**
   * @param ctx {
   *   hostile: { tracking, locked, lockProgress },
   *   incoming: array of live hostile missiles,
   *   position, forward, right, up, expert, maneuver
   * }
   */
  function update(ctx, dt) {
    const rounds = ctx.incoming || [];
    let nearest = null;
    let nearestRange = Infinity;
    for (const m of rounds) {
      const d = Math.hypot(m.position.x - ctx.position.x, m.position.y - ctx.position.y, m.position.z - ctx.position.z);
      if (d < nearestRange) {
        nearestRange = d;
        nearest = m;
      }
    }

    const h = ctx.hostile || {};
    const g = ctx.ground || {};
    state.incoming = rounds.length;
    /**
     * Two possible sources, one display. A round in the air always wins, and
     * between the two acquisition states the closer one wins — not the air one
     * by default, because a SAM at 900 m is a more urgent problem than a fighter
     * tracking from 4 km and the player should be told about the near thing.
     */
    const airLevel = threatLevelOf({ incoming: false, locked: !!h.locked, tracking: !!h.tracking });
    const groundLevel = threatLevelOf({ incoming: false, locked: !!g.locked, tracking: !!g.tracking });
    let ground = false;
    if (groundLevel !== ThreatLevel.NONE && airLevel === ThreatLevel.NONE) ground = true;
    else if (groundLevel === ThreatLevel.LOCK && airLevel === ThreatLevel.TRACK) ground = true;
    else if (groundLevel !== ThreatLevel.NONE && airLevel !== ThreatLevel.NONE) {
      ground = (g.range || Infinity) < (h.range || Infinity);
    }
    state.lockProgress = (ground ? g.lockProgress : h.lockProgress) || 0;
    state.level = threatLevelOf({
      incoming: !!nearest,
      locked: !!h.locked || !!g.locked,
      tracking: !!h.tracking || !!g.tracking,
    });
    // A live round names its own source; otherwise it is whichever acquisition
    // won above.
    state.source = nearest ? (nearest.owner === "sam" ? "SAM" : "AIR") : ground ? "SAM" : "AIR";

    if (nearest) {
      threatBearing(ctx.forward, ctx.right, ctx.up, ctx.position, nearest.position, bearing);
      state.distance = nearestRange;
      // A new round — or a different round becoming the nearest — has no history:
      // report no closure rather than the difference against someone else's range.
      state.closing = nearest === lastNearest && dt > 1e-6 ? (lastDistance - nearestRange) / dt : 0;
      lastNearest = nearest;
      lastDistance = nearestRange;
      state.arrow = bearing.arrow;
      state.lateral = bearing.lateral;
      state.vertical = bearing.vertical;
      state.behind = bearing.behind;
      // Assisted's slightly earlier warning is a tier lead, not a physics change.
      const lead = ctx.expert ? 1 : 1 + cfg.assistedWarnLead;
      state.tier = warningTier(nearestRange / lead, cfg);
      const inPeak = inDodgePeak(ctx.maneuver, ctx.expert, cfg);
      state.dodgeActive = inPeak;
      state.authority = nearest.authority === undefined ? 1 : nearest.authority;
    } else {
      state.distance = 0;
      state.closing = 0;
      state.arrow = "";
      state.behind = false;
      state.tier = ThreatTier.FAR;
      state.dodgeActive = false;
      state.authority = 1;
      lastNearest = null;
      lastDistance = 0;
    }
    return state;
  }

  /**
   * The authority hook handed to the missile system. Aspect is measured between
   * the round's heading and the player's, so "approaching from a difficult
   * angle" (§22) is a real geometric condition and not a proxy for it.
   */
  function authorityFor(m, ctx) {
    // Stage 04.2: SAM rounds are subject to the same barrel-roll rule. Their
    // terrain-masking penalty is applied by the caller, which is the only place
    // that knows where the ground is.
    if (!ctx || (m.owner !== "hostile" && m.owner !== "sam")) return 1;
    const dx = ctx.position.x - m.position.x;
    const dy = ctx.position.y - m.position.y;
    const dz = ctx.position.z - m.position.z;
    const range = Math.hypot(dx, dy, dz) || 1;
    let aspectDeg;
    const v = ctx.velocityDir;
    if (v) {
      const dot = clamp(m.dir.x * v.x + m.dir.y * v.y + m.dir.z * v.z, -1, 1);
      aspectDeg = Math.acos(dot) / DEG;
    }
    return evasionAuthority({ inPeak: ctx.inPeak, range, aspectDeg }, cfg);
  }

  function reset() {
    state.level = ThreatLevel.NONE;
    state.tier = ThreatTier.FAR;
    state.distance = 0;
    state.closing = 0;
    state.arrow = "";
    state.lateral = state.vertical = 0;
    state.behind = false;
    state.incoming = 0;
    state.lockProgress = 0;
    state.source = "AIR";
    state.dodgeActive = false;
    state.authority = 1;
    lastNearest = null;
    lastDistance = 0;
  }

  return { state, cfg, update, authorityFor, reset };
}
