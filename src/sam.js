// Ground threats. CLAUDE.md §13, stage 8.
//
// ONE PURE TRANSITION FUNCTION, as with the hostile. Three-free, so the table
// and the line-of-sight rule are exercised against a synthetic height field.

import { createTarget } from "./enemy.js";

export const SEARCH = "SEARCH";
export const TRACK = "TRACK";
export const LOCK = "LOCK";
export const LAUNCH = "LAUNCH";
export const RELOAD = "RELOAD";
export const DESTROYED = "DESTROYED";

export const SAM_CFG = {
  detect: 5000,
  envelopeMin: 450, // the inner DEAD ZONE -- see below
  envelopeMax: 4400,
  trackSeconds: 1.15,
  lockSeconds: 1.35,
  launchDelay: 0.45,
  reloadSeconds: 9,
  rounds: 3,
  health: 60,
  // A flicker of terrain must not drop an engagement; beyond this the player
  // has genuinely broken the lock.
  lossGrace: 0.7,
  // 14 samples with a 10 m clearance margin IN THE PLAYER'S FAVOUR, so a graze
  // counts as cover.
  losSamples: 14,
  losMargin: 10,
  maskedAuthority: 0.1,
};

// Acquisition is deliberately slow: 1.15 + 1.35 + 0.45 = 2.95 s from first
// sighting to a round in the air. A fast pass through a covered corridor
// survives; loitering in the open does not. That, plus the 9 s reload, is the
// entire difficulty dial -- there is no other knob.
export const ACQUISITION_SECONDS =
  SAM_CFG.trackSeconds + SAM_CFG.lockSeconds + SAM_CFG.launchDelay;

// §14's third config. Same implementation, different numbers.
export const SAM_MISSILE = {
  name: "SAM",
  maxSpeed: 440,
  turnRate: (22 * Math.PI) / 180,
  lifetime: 11,
  fuze: 10,
  separation: 0.25,
  damage: 60,
};

/**
 * LINE OF SIGHT IS THE ENTIRE MECHANIC.
 *
 * SKIPS THE ENDPOINTS: a site standing on the ground would otherwise report
 * ITSELF as an obstruction and never see anything at all.
 *
 * The margin is in the player's favour, so a graze counts as cover -- which is
 * what makes "get down behind that ridge" a move rather than a coin flip.
 */
export function lineOfSight(from, to, sampleHeight, cfg = SAM_CFG) {
  // No sampler means no terrain: everything is visible. A build whose terrain
  // failed to load must still be playable, not accidentally invulnerable.
  if (!sampleHeight) return true;
  const n = cfg.losSamples;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    // MINUS the margin, not plus. The margin is in the PLAYER'S favour: terrain
    // that comes within 10 m of the sight line counts as blocking it, so a
    // graze counts as cover. Written with a plus, the margin runs the other
    // way -- the site sees THROUGH 10 m of hillside, and getting down behind a
    // ridge becomes less safe than flying level. That is the opposite of the
    // mechanic, and the only symptom would be dying in cover.
    if (sampleHeight(x, z) > y - cfg.losMargin) return false;
  }
  return true;
}

/**
 * The site transition table.
 *
 * ctx: { alive, playerAlive, range, visible, rounds }
 */
export function samTransition(sam, ctx, cfg = SAM_CFG) {
  if (sam.state === DESTROYED) return DESTROYED;
  if (!ctx.alive) return DESTROYED;
  if (!ctx.playerAlive) return SEARCH;

  const inEnvelope = ctx.range >= cfg.envelopeMin && ctx.range <= cfg.envelopeMax;
  const detectable = ctx.range <= cfg.detect && inEnvelope && ctx.visible;

  switch (sam.state) {
    case SEARCH:
      // A SPENT SITE MUST NEVER ACQUIRE AGAIN -- still a target, still worth a
      // kill, but no longer a threat. Otherwise it sits in LOCK forever with
      // nothing to fire.
      if (ctx.rounds <= 0) return SEARCH;
      return detectable ? TRACK : SEARCH;

    case TRACK:
      if (ctx.rounds <= 0) return SEARCH;
      // The loss grace holds the engagement through a flicker of terrain.
      if (!detectable && sam.lossTimer > cfg.lossGrace) return SEARCH;
      return sam.stateTime >= cfg.trackSeconds ? LOCK : TRACK;

    case LOCK:
      if (ctx.rounds <= 0) return SEARCH;
      if (!detectable && sam.lossTimer > cfg.lossGrace) return SEARCH;
      return sam.stateTime >= cfg.lockSeconds ? LAUNCH : LOCK;

    case LAUNCH:
      // ONE LAUNCH PER LOCK. The round leaves on the transition OUT of this
      // state and nowhere else -- firing on both "LOCK with an expired timer"
      // and "in the LAUNCH state" spends two rounds per engagement, because
      // they are the same frame.
      return sam.stateTime >= cfg.launchDelay ? RELOAD : LAUNCH;

    case RELOAD:
      return sam.stateTime >= cfg.reloadSeconds ? SEARCH : RELOAD;

    default:
      return SEARCH;
  }
}

/**
 * Two sites per inland leg, flanking the corridor by ~1450 m so the safe line
 * is BETWEEN them and low.
 *
 * Each site PROBES OUTWARD along its side and takes the first position
 * standing on ground at least 30 m above sea level. A SITE WITH NOWHERE TO
 * STAND IS DROPPED, NOT FLOATED -- five sites on land beat six with one in the
 * sea, and the first build put two launchers in the water because a lateral
 * offset near the coast simply misses the land.
 */
export const PROBE_SCALES = [1.0, 0.72, 1.28, 0.48, 1.55];
export const FLANK_OFFSET = 1450;
const MIN_GROUND = 30;

export function placeSites(legs, groundAt, { flank = FLANK_OFFSET } = {}) {
  const sites = [];
  for (const leg of legs) {
    for (const side of [-1, 1]) {
      let placed = null;
      for (const scale of PROBE_SCALES) {
        const x = leg.x + side * flank * scale;
        const z = leg.z;
        const ground = groundAt(x, z);
        if (ground >= MIN_GROUND) {
          placed = { x, y: ground, z, ground };
          break;
        }
      }
      if (placed) sites.push({ ...placed, leg: leg.name, side });
      // else: dropped. Deliberately silent about the count -- the caller logs
      // how many stood, which is the number that matters.
    }
  }
  return sites;
}

export function createSamSite({ position, label = "SAM", cfg = SAM_CFG }) {
  const target = createTarget({
    label,
    position,
    // A SAM's velocity is ZERO, and that is exactly why the stage-5 lead
    // solution works on it for free.
    velocity: { x: 0, y: 0, z: 0 },
    health: cfg.health,
    radius: 14,
  });
  return {
    target,
    state: SEARCH,
    stateTime: 0,
    lossTimer: 0,
    rounds: cfg.rounds,
    wrecked: false,
  };
}

export function createSamNetwork({ cfg = SAM_CFG, onLaunch, onWreck } = {}) {
  let sites = [];

  return {
    get sites() {
      return sites;
    },
    /** Everything that publishes the target contract, wrecks included: a
     *  destroyed site is still a target and still worth a kill. */
    targets: () => sites.map((s) => s.target),
    liveSites: () => sites.filter((s) => s.target.alive),
    emitting: () =>
      sites.filter(
        (s) => s.state === TRACK || s.state === LOCK || s.state === LAUNCH,
      ),

    deploy(positions) {
      sites = positions.map((p, i) =>
        createSamSite({ position: p, label: "SAM", cfg }),
      );
      return sites;
    },

    update(dt, { playerState, playerAlive = true, sampleHeight }) {
      for (const sam of sites) {
        if (!sam.target.alive) {
          if (sam.state !== DESTROYED) {
            sam.state = DESTROYED;
            sam.wrecked = true;
            // A kill leaves a WRECK IN THE WORLD -- tinted, tilted, turret
            // hidden. Not a deletion: a destroyed installation should be
            // visible evidence that the player did something.
            if (onWreck) onWreck(sam);
          }
          continue;
        }

        const d = {
          x: playerState.position.x - sam.target.position.x,
          y: playerState.position.y - sam.target.position.y,
          z: playerState.position.z - sam.target.position.z,
        };
        const range = Math.hypot(d.x, d.y, d.z);

        // ONLY sites within detection range AND envelope pay for a
        // line-of-sight test. Six sites x 14 samples every frame would be 84
        // terrain queries for nothing.
        const worthTesting =
          range <= cfg.detect &&
          range >= cfg.envelopeMin &&
          range <= cfg.envelopeMax;
        const visible = worthTesting
          ? lineOfSight(
              { x: sam.target.position.x, y: sam.target.position.y + 6, z: sam.target.position.z },
              playerState.position,
              sampleHeight,
              cfg,
            )
          : false;

        sam.lossTimer = visible ? 0 : sam.lossTimer + dt;

        const next = samTransition(
          sam,
          { alive: true, playerAlive, range, visible, rounds: sam.rounds },
          cfg,
        );

        if (next !== sam.state) {
          const from = sam.state;
          sam.state = next;
          sam.stateTime = 0;
          // The one place a round leaves the rail.
          if (from === LAUNCH && next === RELOAD && sam.rounds > 0) {
            sam.rounds--;
            if (onLaunch) onLaunch(sam);
          }
        } else {
          sam.stateTime += dt;
        }
      }
    },

    /** For the threat monitor: what each emitting site is doing to the player. */
    acquisitions() {
      const out = [];
      for (const sam of this.emitting()) {
        out.push({
          level: sam.state === TRACK ? "TRACK" : "LOCK",
          position: sam.target.position,
          label: "SAM",
          origin: "sam",
          progress:
            sam.state === TRACK
              ? sam.stateTime / cfg.trackSeconds
              : Math.min(1, sam.stateTime / cfg.lockSeconds),
        });
      }
      return out;
    },

    /** SAM SITES MUST NOT RESPAWN (§11). Six is a finite thing to clear, and a
     *  player who spent four minutes clearing the valley has earned an empty
     *  valley. This only exists for a full restart. */
    reset() {
      for (const sam of sites) {
        sam.target.alive = true;
        sam.target.health = sam.target.maxHealth;
        sam.target.hitAt = -Infinity;
        sam.state = SEARCH;
        sam.stateTime = 0;
        sam.lossTimer = 0;
        sam.rounds = cfg.rounds;
        sam.wrecked = false;
      }
    },
    clear() {
      sites = [];
    },
  };
}
