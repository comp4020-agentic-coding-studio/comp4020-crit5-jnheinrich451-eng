// The eleven-cue director. CLAUDE.md §16, stage 9.
//
// NO MUSIC. The atmosphere is an engine, a cannon and a voice telling the
// player what has locked them; a score would sit on top of all three and make
// the warnings less audible.
//
// Because almost every sound is INFORMATION, the mix is a priority problem
// rather than a volume one. The element factory is injected, so the whole
// priority/interval/rotation layer is exercised headlessly.

export const AMBIENT = 0;
export const WEAPON = 1;
export const WARNING = 2;
export const CRITICAL = 3;

const DUCK_SECONDS = 1.1;

// THE PATHS ARE THE WHOLE INTERFACE: dropping a correctly named file into
// assets/audio/ makes that cue work with no code change at all.
export const CUES = {
  ENGINE_START: {
    files: ["assets/audio/engine-start.mp3"], volume: 0.55,
    priority: AMBIENT, loop: false, minInterval: 0,
    // Double rate, so the whole recording finishes exactly as the catapult
    // fires and the wait reads as a countdown rather than a delay.
    rate: 2,
  },
  ENGINE_LOOP: { files: ["assets/audio/engine-loop.mp3"], volume: 0.34, priority: AMBIENT, loop: true },
  GUN: { files: ["assets/audio/gun.mp3"], volume: 0.5, priority: WEAPON, loop: true },
  LOCK: {
    files: ["assets/audio/lock-1.mp3", "assets/audio/lock-2.mp3", "assets/audio/lock-3.mp3"],
    volume: 0.85, priority: WARNING, minInterval: 3.2, duck: 0.45,
  },
  MISSILE: {
    files: ["assets/audio/missile-1.mp3", "assets/audio/missile-2.mp3"],
    volume: 1.0, priority: CRITICAL, minInterval: 2.4, duck: 0.3,
  },
  // THE PLAYER'S OWN LAUNCH IS WEAPON, NOT WARNING -- it confirms something
  // they did, and must never mask an inbound call.
  MISSILE_LAUNCH: { files: ["assets/audio/missile-launch.mp3"], volume: 0.8, priority: WEAPON, minInterval: 0.4 },
  MISSILE_HIT: { files: ["assets/audio/missile-hit.mp3"], volume: 0.9, priority: WEAPON, minInterval: 0.3 },
  FLYBY: { files: ["assets/audio/flyby.mp3"], volume: 0.75, priority: AMBIENT, minInterval: 4 },
  FLARES: { files: ["assets/audio/flares.mp3"], volume: 0.8, priority: AMBIENT, minInterval: 0, forced: true },
  ALTITUDE: { files: ["assets/audio/altitude.mp3"], volume: 0.85, priority: WARNING, minInterval: 3.5 },
  PULL_UP: { files: ["assets/audio/pull-up.mp3"], volume: 1.0, priority: CRITICAL, minInterval: 1.8 },
};

// Ground proximity is two levels, both AGL NOT ALTITUDE ABOVE SEA LEVEL -- so
// 200 m over the ocean is quiet and 200 m into a 600 m ridge is not.
export const ALTITUDE_AGL = 220;
export const FLYBY_RANGE = 340;
export const FLYBY_CLOSURE = 120;

export function createAudio({ createElement, cues = CUES } = {}) {
  const make =
    createElement ??
    ((src) => {
      const a = new Audio();
      a.src = src;
      a.preload = "auto";
      return a;
    });

  const voices = new Map(); // name -> { els, take, lastAt, playing, available }
  let armed = false;
  let muted = false;
  let now = 0;
  let duckUntil = 0;
  let duckTo = 1;
  const missing = [];

  for (const [name, cue] of Object.entries(cues)) {
    const els = cue.files.map((f) => make(f, cue));
    voices.set(name, {
      cue, els, take: 0, lastAt: -Infinity, playing: false,
      // AVAILABILITY STARTS OPTIMISTIC and is corrected by a deadline this
      // module OWNS. Marking a cue unavailable on readyState < 3 marks every
      // working file as missing, because that is also the state of a file that
      // simply has not finished loading yet.
      available: true,
    });
    for (const el of els) {
      if (!el || typeof el.addEventListener !== "function") continue;
      // POSITIVE FAILURE ONLY.
      el.addEventListener("error", () => markMissing(name));
    }
  }

  // The load report runs at CONSTRUCTION, not on arm(). Which files resolved is
  // a fact about the build, not about whether the player has pressed a key yet
  // -- and hanging the diagnostic off the gesture means a page nobody touched
  // reports nothing at all, which is exactly when you most want to know.
  //
  // Skipped for an injected factory: that means a test harness, and a deferred
  // console line firing out of a finished suite is noise attached to nothing.
  function markMissing(name) {
    const v = voices.get(name);
    if (!v || !v.available) return;
    v.available = false;
    missing.push(name);
  }

  /** Both the readiness deadline AND the report of its outcome live here.
   *  Splitting them across modules guarantees the two drift and the log ends
   *  up stating the opposite of the truth. */
  function auditAfter(seconds = 6) {
    setTimeout(() => {
      for (const [name, v] of voices) {
        for (const el of v.els) {
          if (el && el.networkState === 3 /* NETWORK_NO_SOURCE */) markMissing(name);
        }
      }
      const total = voices.size;
      console.log(
        missing.length === 0
          ? `audio: all ${total} cues resolved`
          : `audio: ${total - missing.length}/${total} cues resolved, missing ${missing.join(", ")}`,
      );
    }, seconds * 1000);
  }

  if (!createElement) auditAfter();

  return {
    /** NOTHING PLAYS BEFORE A USER GESTURE. The mission opens on a scripted
     *  launch with no input in it, so this is armed on the first keypress or
     *  click, and a blocked start is never surfaced as an error. */
    arm() {
      if (armed) return false;
      armed = true;
      return true;
    },
    isArmed: () => armed,
    setMuted(v) {
      muted = !!v;
      if (muted) this.stopAll();
    },
    isMuted: () => muted,
    missingCues: () => [...missing],
    isAvailable: (name) => voices.get(name)?.available ?? false,

    tick(dt) {
      now += dt;
    },
    clock: () => now,

    /** Has this cue's minimum interval elapsed? A cue that repeats is a cue
     *  nobody hears. */
    mayFire(name) {
      const v = voices.get(name);
      if (!v) return false;
      if (v.cue.forced) return true;
      const interval = v.cue.minInterval ?? 0;
      return now - v.lastAt >= interval;
    },

    /** Round-robin, so with three takes it is PROVABLY never twice in a row --
     *  which random selection cannot promise. */
    nextTake(name) {
      const v = voices.get(name);
      if (!v) return 0;
      const take = v.take;
      v.take = (v.take + 1) % v.els.length;
      return take;
    },
    currentTake: (name) => voices.get(name)?.take ?? 0,

    duckLevel() {
      return now < duckUntil ? duckTo : 1;
    },

    play(name, options = {}) {
      const v = voices.get(name);
      if (!v || !armed || muted || !v.available) return false;
      if (!options.force && !this.mayFire(name)) return false;

      v.lastAt = now;
      const take = v.els.length > 1 ? this.nextTake(name) : 0;
      const el = v.els[take];

      // A WARNING DUCKS AMBIENT AND WEAPON for 1.1 s. A WARNING NEVER DUCKS
      // ANOTHER WARNING -- the second one is the one that matters.
      if (v.cue.priority >= WARNING && v.cue.duck !== undefined) {
        duckUntil = now + DUCK_SECONDS;
        duckTo = v.cue.duck;
      }

      if (el) {
        try {
          el.loop = !!v.cue.loop;
          el.playbackRate = v.cue.rate ?? 1;
          const ducked = v.cue.priority < WARNING ? this.duckLevel() : 1;
          el.volume = (v.cue.volume ?? 1) * (options.gain ?? 1) * ducked;
          if (!v.cue.loop) el.currentTime = 0;
          const p = el.play?.();
          // Never surface a blocked start as an error.
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch {
          /* a cue that will not play is not a reason to stop the game */
        }
      }
      v.playing = true;
      return true;
    },

    /** THE GUN IS A LOOP, not 48 one-shots a second. */
    startLoop(name, gain = 1) {
      const v = voices.get(name);
      if (!v || !v.cue.loop) return false;
      if (v.playing) {
        if (v.els[0]) v.els[0].volume = (v.cue.volume ?? 1) * gain * this.duckLevel();
        return true;
      }
      return this.play(name, { force: true, gain });
    },
    stopLoop(name) {
      const v = voices.get(name);
      if (!v || !v.playing) return false;
      v.playing = false;
      for (const el of v.els) {
        try {
          el.pause?.();
        } catch {}
      }
      return true;
    },
    /** A one-shot can be stopped early -- the engine start-up is cut the
     *  instant the catapult fires. */
    stop(name) {
      return this.stopLoop(name);
    },
    isPlaying: (name) => voices.get(name)?.playing ?? false,

    stopAll() {
      for (const name of voices.keys()) this.stopLoop(name);
    },

    reset() {
      this.stopAll();
      duckUntil = 0;
      duckTo = 1;
      for (const v of voices.values()) v.lastAt = -Infinity;
    },
  };
}

/**
 * The fly-by fires ONCE PER PASS: it needs a range that crossed the threshold
 * THIS FRAME and at least 120 m/s of closure, so a slow drift past is not a
 * fly-by and a circling hostile does not retrigger.
 */
export function isFlyby(previousRange, range, closingRate) {
  return (
    previousRange > FLYBY_RANGE &&
    range <= FLYBY_RANGE &&
    closingRate >= FLYBY_CLOSURE
  );
}

/** Which ground warning, if any. Both levels read AGL. */
export function groundWarning({ agl, forwardHazard, sink, speed }) {
  if (Number.isFinite(forwardHazard) && forwardHazard < speed * 0.75) return "PULL_UP";
  if (agl < ALTITUDE_AGL * 0.6 && sink > 6) return "PULL_UP";
  if (agl < ALTITUDE_AGL) return "ALTITUDE";
  return null;
}
