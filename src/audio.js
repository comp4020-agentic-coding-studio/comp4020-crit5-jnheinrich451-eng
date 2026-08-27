/**
 * Stage 04.5 — the audio director.
 *
 * There is no music. The brief is explicit about it, and it is the right call:
 * this game's atmosphere is an engine, a cannon and a voice telling you that
 * something has locked you. A score would sit on top of all three and make the
 * warnings less audible, which is the opposite of what the audio is for.
 *
 * So every sound here is diegetic and almost every one is INFORMATION. That
 * turns the mix into a priority problem rather than a taste problem, and the
 * whole design follows from it:
 *
 * - **Warnings outrank everything.** A cannon burst is 48 rounds a second and a
 *   missile warning is the one thing the player must hear; a naive
 *   "play the cue" implementation loses the warning under the gun. So cues carry
 *   a priority, and a higher-priority cue ducks the channels below it.
 * - **A cue that repeats is a cue nobody hears.** Every one-shot has a minimum
 *   interval, and the multi-take cues (LOCK ON ×3, MISSILE WARNING ×2) rotate
 *   through their takes so a sustained threat does not become a stutter.
 * - **Nothing plays before a user gesture.** A browser will not start audio
 *   until the player has interacted, and the mission opens on a scripted launch
 *   with no interaction in it. The director arms itself and waits.
 * - **A missing file is silence, not an exception.** Every cue is optional. The
 *   game has to be playable with an empty assets/audio directory, which is also
 *   how it was developed.
 *
 * Deliberately HTMLAudioElement rather than Web Audio: these are pre-rendered
 * one-shots and one loop, there is no filtering or spatialisation, and a pool of
 * elements per cue is both simpler and easier to reason about than a graph.
 */

export const Cue = {
  ENGINE_START: "ENGINE_START",
  ENGINE_LOOP: "ENGINE_LOOP",
  GUN: "GUN",
  LOCK: "LOCK",
  MISSILE: "MISSILE",
  MISSILE_LAUNCH: "MISSILE_LAUNCH",
  MISSILE_HIT: "MISSILE_HIT",
  FLYBY: "FLYBY",
  FLARES: "FLARES",
  ALTITUDE: "ALTITUDE",
  PULL_UP: "PULL_UP",
};

/** Higher wins. A warning must be able to duck the machinery under it. */
export const Priority = { AMBIENT: 0, WEAPON: 1, ADVISORY: 2, WARNING: 3, CRITICAL: 4 };

export const AUDIO = {
  master: 0.9,

  /**
   * One row per cue. `takes` is the rotation — the supplied LOCK ON and MISSILE
   * WARNING recordings are alternate reads of the same line, and rotating them
   * is what stops a held lock sounding like a skipping record.
   *
   * `minInterval` is the anti-spam floor, in seconds. `duck` is how far this cue
   * pushes lower-priority channels down while it plays.
   *
   * A NOTE ON DIAGNOSING SILENCE, because it cost a long detour: a media element
   * that is being paused and restarted every frame reports perfect health --
   * `readyState` 4, `paused` false, correct `duration`, full `buffered` range, no
   * error, and `play()` resolves -- and its only symptom is that `currentTime`
   * never advances. That is indistinguishable, from the outside, from a file the
   * browser cannot decode. It was NOT the files: every clip here plays, at every
   * sample rate present (8 kHz through 48 kHz). It was ENGINE_LOOP having four
   * owners across four frame-loop branches; see the single owner in main.js.
   *
   * Corollary for future debugging: probe playability with audio-probe.html, and
   * mind the order -- the autoplay policy makes the FIRST a few clips a page
   * touches look broken regardless of which clips they are.
   */
  cues: {
    ENGINE_START: { takes: ["assets/audio/engine-start.mp3"], volume: 0.55, priority: Priority.AMBIENT, minInterval: 4, voices: 1, rate: 2, noDuck: true },
    ENGINE_LOOP: { takes: ["assets/audio/engine-loop.mp3"], volume: 0.45, priority: Priority.AMBIENT, loop: true, voices: 1, noDuck: true },
    GUN: { takes: ["assets/audio/gun.mp3"], volume: 0.5, priority: Priority.WEAPON, loop: true, voices: 1 },
    LOCK: { takes: ["assets/audio/lock-1.mp3", "assets/audio/lock-2.mp3", "assets/audio/lock-3.mp3"], volume: 0.85, priority: Priority.WARNING, minInterval: 3.2, voices: 2, duck: 0.45 },
    MISSILE: { takes: ["assets/audio/missile-1.mp3", "assets/audio/missile-2.mp3"], volume: 1, priority: Priority.CRITICAL, minInterval: 2.4, voices: 2, duck: 0.3 },
    // The player's own launch and its result. WEAPON rather than WARNING: they
    // are confirmations of something the player did, and must never mask an
    // incoming-missile call.
    MISSILE_LAUNCH: { takes: ["assets/audio/missile-launch.mp3"], volume: 0.8, priority: Priority.WEAPON, minInterval: 0.4, voices: 2 },
    MISSILE_HIT: { takes: ["assets/audio/missile-hit.mp3"], volume: 0.9, priority: Priority.WEAPON, minInterval: 0.3, voices: 2 },
    // A hostile crossing close aboard. Ambient — it is atmosphere, not
    // information, and it is the one cue the player cannot act on.
    FLYBY: { takes: ["assets/audio/flyby.mp3"], volume: 0.75, priority: Priority.AMBIENT, minInterval: 4, voices: 2 },
    FLARES: { takes: ["assets/audio/flares.mp3"], volume: 0.8, priority: Priority.ADVISORY, minInterval: 0.5, voices: 2 },
    ALTITUDE: { takes: ["assets/audio/altitude.mp3"], volume: 0.85, priority: Priority.WARNING, minInterval: 3.5, voices: 1, duck: 0.45 },
    PULL_UP: { takes: ["assets/audio/pull-up.mp3"], volume: 1, priority: Priority.CRITICAL, minInterval: 1.8, voices: 1, duck: 0.3 },
  },

  /** How long a ducking cue is assumed to hold the floor for. */
  duckHold: 1.1,
  duckRelease: 2.4, // per second

  /**
   * Stage 05.6 — the loop watchdog.
   *
   * How long a channel that BELIEVES it is playing may go without its
   * `currentTime` advancing before the director treats it as stalled and tries
   * to recover it.
   *
   * This exists because "the engine is silent" was reported repeatedly while
   * every observable said it was playing: `paused` false, `readyState` 4, a
   * correct `duration`, a full `buffered` range, no `error`, a resolved `play()`
   * promise and a sane `volume`. A media element has no way to report that it is
   * producing no sound. The ONE signal that separates a playing element from a
   * wedged one is whether its clock moves — so that is what gets watched, and
   * recovery is attempted rather than the failure being logged and left.
   *
   * 0.5 s is longer than a loop wrap or a frame hitch, and short enough that a
   * stall is over before it is audible.
   */
  stallSeconds: 0.5,
  /** How many stall recoveries per channel earn a console line. */
  stallLogLimit: 3,
  /** Don't hammer play() every frame while a start is being refused. */
  retrySeconds: 0.25,

  /**
   * Engine loop: idle to full, mapped from the throttle lever.
   *
   * These multiply the cue's own gain, which is the trap: at 0.34 cue gain and a
   * 0.47 throttle factor the engine played at an effective 0.14 while the fly-by
   * one-shot sat at 0.75, so the aircraft's own engine was the quietest thing in
   * the mix and read as broken rather than as quiet. A continuous bed should sit
   * BELOW the one-shots, not five times below them.
   *
   * `engineIdle` is the floor, so the engine is present the moment the throttle
   * is off its stop rather than fading in from silence.
   */
  engineIdle: 0.3,
  engineGain: 0.5,
  enginePitchLow: 0.86,
  enginePitchHigh: 1.14,

  /**
   * 04.6 — how close a hostile has to cross for the fly-by. Generous on range
   * and strict on closure: a hostile drifting past at 20 m/s is not a fly-by, and
   * the sound is only worth having when something went past fast.
   */
  flybyRange: 340,
  flybyClosure: 120,

  /** Seconds to give a file to become playable before calling it missing. */
  readyDeadline: 3,

  /**
   * Ground-proximity warnings. Two levels, because the supplied recordings are
   * two different statements: ALTITUDE is "you are low", PULL UP is "you are
   * about to hit something". Conflating them would waste the more urgent one.
   *
   * ALTITUDE is a POSITION test (AGL, so 200 m over the sea is quiet and 200 m
   * under a 600 m ridge is not). PULL UP is a TRAJECTORY test, and that split is
   * the whole redesign below.
   */
  /**
   * ALTITUDE means "you are low AND going down".
   *
   * It used to fire on height alone, which sounds right and is not: the aircraft
   * habitually cruises at 100-250 m after the launch and flies the terrain leg
   * deliberately low, so a height-only rule fired every `minInterval` for the
   * whole sortie. That is bad on its own, and it was also silently killing the
   * engine -- every firing ducked the AMBIENT channels, so a cue repeating every
   * 3.5 s held the engine down permanently and the aircraft sounded switched off.
   *
   * Requiring a descent makes it a statement about the flight path, like PULL UP,
   * and it goes quiet the moment the player levels off -- which is exactly the
   * response the cue is asking for.
   */
  altitudeAgl: 250,

  /**
   * Seconds of player control before any ground warning may fire.
   *
   * The aircraft leaves the deck 20 m over the water and sinks briefly off the
   * bow before the wing takes over, which is a guaranteed trajectory warning at
   * the one moment the player has nothing to do with it. The launch is also the
   * loudest scripted beat in the build and must not be talked over.
   */
  warnGraceSeconds: 5,

  /**
   * PULL UP fires this many seconds before the aircraft would reach the ground
   * on its current trajectory.
   *
   * IT IS A TIME, NOT AN ALTITUDE, and the previous altitude-and-sink rule was
   * wrong in both directions:
   *
   *   - Over water it effectively never fired. The only route to it was
   *     `agl <= 110 && sink >= 14`, so a descent into the sea got a warning for
   *     the 110 m above the surface -- under two seconds at any real sink rate,
   *     and less than the cue's own minInterval. The player heard nothing and hit
   *     the water.
   *   - Over land it fired too late to act on. `forwardImminent` is deliberately
   *     defined as "penetration within the next couple of physics steps" (~30 ms)
   *     because it is a COLLISION predicate, so borrowing it as a warning turned
   *     PULL UP into an announcement that the crash had already happened.
   *
   * Six seconds is enough to raise the nose at 200 m/s and reads as a warning
   * rather than an epitaph. Raised to nine after play: six was still late enough
   * that hearing it and reacting to it were nearly the same moment. At 250 m/s
   * nine seconds is ~2.2 km of warning.
   */
  pullUpSeconds: 9,
  /**
   * How far ahead the ground is sampled, in seconds of flight, to catch the case
   * the vertical rate misses entirely: level flight toward rising ground. The
   * closure rate against terrain ahead is what makes a valley wall dangerous
   * while a valley floor is not.
   */
  lookSeconds: 6,
  /** Below this sink rate the vertical trajectory is not going anywhere. */
  minSink: 1.5,

  /**
   * Hard floor over water, in metres. Below this the sea is a PULL UP regardless
   * of trajectory.
   *
   * The time-to-impact rule that governs everything else needs a descent to have
   * something to divide by, so level flight 20 m over the waterline produced
   * silence -- correct arithmetic, useless advice. Over land that is acceptable,
   * because the corridor is flown deliberately low and the ground AHEAD supplies
   * the warning; over open sea there is nothing ahead to sample and no visual
   * scale, so height is the only cue available.
   *
   * 90 m is high enough to leave room to recover at 250 m/s and low enough that
   * an ordinary low pass over the carrier still clears it.
   *
   * WATER ONLY, deliberately. Applied over terrain it would fire continuously for
   * the whole TERRAIN leg -- the nagging-cue failure that made ALTITUDE useless
   * before it was given a descent test.
   */
  seaFloor: 90,
};

/**
 * 04.6 — has a hostile just crossed close aboard, and fast? Pure, so the rule is
 * checkable: it needs a range that has fallen inside the threshold THIS frame
 * (so it fires once per pass, not once per frame) and real closing speed.
 */
export function flybyTriggered(range, prevRange, dt, cfg = AUDIO) {
  if (!Number.isFinite(range) || !Number.isFinite(prevRange) || dt <= 0) return false;
  if (range > cfg.flybyRange || prevRange <= cfg.flybyRange) return false;
  return (prevRange - range) / dt >= cfg.flybyClosure;
}

/**
 * Which ground warning, if any. Pure — the rule is the interesting part and it
 * should be checkable without a terrain index.
 *
 * PULL UP is a TRAJECTORY test: how long until this flight path reaches the
 * ground. Two paths are considered and the sooner one wins:
 *
 *   1. Vertical — sinking toward the surface below (`agl / sink`). This is what
 *      makes the warning work over open water, where there is no terrain ahead
 *      to probe and the old rule was silent until it was far too late.
 *   2. Horizontal — ground ahead rising into the flight path. `aglAhead` is the
 *      clearance the aircraft WOULD have over the ground `lookSeconds` ahead, so
 *      a level run at a ridge closes at (agl - aglAhead) / lookSeconds even with
 *      zero sink.
 *
 * `forwardImminent` is kept as a floor, not as the trigger: by the time it is
 * true the impact is unavoidable, so on its own it is a crash announcement.
 *
 * NO ABSOLUTE-AGL TRIGGER FOR PULL UP. Flying a valley at 100 m is legitimate
 * and must stay quiet, or the cue becomes noise exactly where the player needs
 * to trust it. Being low is what ALTITUDE is for; being on a path into the
 * ground is what PULL UP is for.
 *
 * @param aglAhead clearance over the ground `cfg.lookSeconds` ahead, or null
 *   when it is unknown (no terrain index, or nothing sampled)
 */
export function groundWarning({ agl, sink = 0, aglAhead = null, forwardImminent = false, airborne = true, overWater = false }, cfg = AUDIO) {
  if (!airborne || !Number.isFinite(agl)) return null;
  if (forwardImminent) return Cue.PULL_UP;

  let seconds = Infinity;
  if (agl <= 0) seconds = 0;
  if (sink > cfg.minSink) seconds = Math.min(seconds, agl / sink);
  if (Number.isFinite(aglAhead) && aglAhead < agl && cfg.lookSeconds > 0) {
    const closure = (agl - aglAhead) / cfg.lookSeconds;
    if (closure > 0) seconds = Math.min(seconds, agl / closure);
  }

  if (seconds <= cfg.pullUpSeconds) return Cue.PULL_UP;
  // The water floor. A hard height, not a trajectory: over open sea there is no
  // terrain ahead to sample and no visual scale, so level flight at 20 m reads as
  // perfectly safe to every other rule in this function.
  if (overWater && agl <= cfg.seaFloor) return Cue.PULL_UP;
  // Low AND descending. Low and level is legitimate -- the terrain leg is flown
  // that way on purpose -- and a cue that fires there is a cue the player learns
  // to ignore.
  if (agl <= cfg.altitudeAgl && sink > cfg.minSink) return Cue.ALTITUDE;
  return null;
}

/** Seconds of flight until the current trajectory reaches the ground. Exposed
 *  for the developer rail, so the warning can be watched rather than guessed. */
export function secondsToGround({ agl, sink = 0, aglAhead = null }, cfg = AUDIO) {
  if (!Number.isFinite(agl)) return Infinity;
  let seconds = Infinity;
  if (sink > cfg.minSink) seconds = agl / sink;
  if (Number.isFinite(aglAhead) && aglAhead < agl && cfg.lookSeconds > 0) {
    const closure = (agl - aglAhead) / cfg.lookSeconds;
    if (closure > 0) seconds = Math.min(seconds, agl / closure);
  }
  return seconds;
}

/* ---- pure helpers ---- */

/** Engine loop volume and playback rate for a throttle position. */
export function engineVoice(throttle, afterburner, cfg = AUDIO) {
  const t = Math.min(1, Math.max(0, throttle));
  return {
    volume: cfg.engineIdle + cfg.engineGain * t + (afterburner ? 0.12 : 0),
    rate: cfg.enginePitchLow + (cfg.enginePitchHigh - cfg.enginePitchLow) * t,
  };
}

/**
 * Which take to use, given how many times this cue has fired. Rotation rather
 * than random: random repeats itself often enough to be noticed, and with three
 * takes a round-robin is provably never twice in a row.
 */
export function takeIndex(fired, takes) {
  return takes > 0 ? fired % takes : 0;
}

/** Should this cue be allowed to fire? Pure, so the anti-spam rule is testable. */
export function mayFire(cue, sinceLast, cfg = AUDIO) {
  const row = cfg.cues[cue];
  if (!row) return false;
  return sinceLast >= (row.minInterval || 0);
}

/* ---- the director ---- */

/**
 * @param audioFactory (src) => element, injected so the whole director can be
 *   driven in tests with stubs that record what played and at what volume.
 */
export function createAudioDirector({ cfg = AUDIO, audioFactory = null, gestureTarget = null } = {}) {
  const events = { resolved: [] };
  const emit = (kind, payload) => events[kind].forEach((fn) => fn(payload));

  const make =
    audioFactory ||
    ((src, loop) => {
      if (typeof Audio === "undefined") return null;
      const el = new Audio();
      el.src = src;
      el.loop = !!loop;
      el.preload = "auto";
      el.volume = 0;
      if (el.load) el.load();
      return el;
    });

  /** cue -> { row, voices: [el...], next, fired, last, available } */
  const channels = {};
  for (const name of Object.keys(cfg.cues)) {
    const row = cfg.cues[name];
    const voices = [];
    for (let i = 0; i < (row.voices || 1); i++) {
      // One element per take per voice: swapping `src` on a shared element
      // restarts the fetch and stutters, which is exactly what a rotation is
      // trying to avoid.
      const perTake = row.takes.map((src) => make(src, row.loop));
      voices.push(perTake);
    }
    const ch = {
      row,
      voices,
      next: 0,
      fired: 0,
      last: -Infinity,
      // Watchdog bookkeeping (see AUDIO.stallSeconds).
      stall: 0,
      lastPos: -1,
      stalls: 0,
      /**
       * Times the channel was asked to play and never got off zero. A START
       * failure, not a stall: the browser's autoplay policy refuses playback
       * until the document has had a real user gesture, and a refused element
       * reports `paused: false` for a moment while its play() promise is still
       * pending. Counting that as a stall made the watchdog blame the playback
       * rate and permanently strip the engine's pitch effect for a fault that had
       * nothing to do with it.
       */
      pending: 0,
      /** True once this channel's clock has actually moved. */
      everPlayed: false,
      retry: -Infinity,
      /** Set once a stall is blamed on playbackRate; the pitch effect is then
       *  abandoned for this channel rather than re-applied every frame. */
      rateLocked: false,
      available: row.takes.length > 0 && !!voices[0][0],
    };
    channels[name] = ch;
    /**
     * Availability is corrected by POSITIVE FAILURE only, and it is recoverable.
     *
     * The first version of this deadline asked `readyState < 3`, which is also
     * the state of an element that has simply not finished loading — browsers
     * defer media in a hidden tab — so it marked eight working files as missing
     * and silenced the whole build. Trading a false "available" for a false
     * "unavailable" is the worse bug: one over-promises, the other breaks a
     * feature that works.
     *
     * `error` and NETWORK_NO_SOURCE both mean the browser tried and found
     * nothing. `canplay` means it found something, and un-marks the cue — so a
     * slow file that resolves after the deadline still works.
     */
    const el0 = voices[0][0];
    if (el0 && el0.addEventListener) {
      el0.addEventListener("error", () => (ch.available = false));
      el0.addEventListener("canplay", () => (ch.available = true));
    }
  }

  const state = {
    armed: false,
    muted: false,
    clock: 0,
    /** 0..1 attenuation applied to AMBIENT and WEAPON while a warning holds. */
    duck: 1,
    duckUntil: -Infinity,
    duckLevel: 1,
    plays: 0,
    suppressed: 0,
    /** True between setPaused(true) and setPaused(false). See setPaused. */
    paused: false,
  };

  Object.defineProperty(state, "silent", {
    enumerable: true,
    get: () => Object.values(channels).every((c) => !c.available),
  });

  const gainFor = (name) => {
    const ch = channels[name];
    if (!ch || state.muted) return 0;
    const base = cfg.master * (ch.row.volume === undefined ? 1 : ch.row.volume);
    // Only the machinery ducks. A warning never attenuates another warning:
    // two things trying to tell you something is not the problem noise is.
    //
    // THE ENGINE IS EXEMPT (`noDuck`). It is the aircraft's own voice and the bed
    // the whole mix sits on, so ducking it for a spoken advisory is backwards --
    // and with a cue that can repeat every few seconds it is not a duck at all,
    // it is a permanent attenuation that makes the aeroplane sound switched off.
    // The gun still ducks: a cannon burst genuinely masks speech.
    const ducks = ch.row.priority <= Priority.WEAPON && !ch.row.noDuck;
    return ducks ? base * state.duck : base;
  };

  function start(el) {
    if (!el || !el.play) return;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
  }

  /**
   * Fire a one-shot. Returns true when it actually played.
   *
   * `force` skips the interval floor — used by the flare cue, where the player
   * pressed a button and silence would read as a broken control.
   */
  function play(name, { force = false } = {}) {
    const ch = channels[name];
    if (!ch || !ch.available || ch.row.loop) return false;
    if (!state.armed || state.muted) return false;
    const interval = ch.row.minInterval || 0;
    if (!force && state.clock - ch.last < interval) {
      state.suppressed += 1;
      return false;
    }
    const take = takeIndex(ch.fired, ch.row.takes.length);
    const voice = ch.voices[ch.next % ch.voices.length];
    ch.next += 1;
    ch.fired += 1;
    ch.last = state.clock;
    const el = voice[take];
    if (el) {
      el.volume = gainFor(name);
      // A cue may declare a playback rate — the engine start-up is a long clip
      // played at double speed so it fits the deck dwell without being trimmed.
      if (ch.row.rate && el.playbackRate !== undefined) el.playbackRate = ch.row.rate;
      try {
        el.currentTime = 0;
      } catch (_) {
        /* not seekable yet */
      }
      start(el);
    }
    state.plays += 1;
    // A ducking cue holds the floor for a moment so the gun does not climb back
    // over the second half of a spoken warning.
    if (ch.row.duck !== undefined) {
      state.duckLevel = Math.min(state.duckLevel, ch.row.duck);
      state.duckUntil = state.clock + cfg.duckHold;
    }
    return true;
  }

  /** Stop a one-shot early: the deck spool is cut the instant the cat fires. */
  function stop(name) {
    const ch = channels[name];
    if (!ch) return false;
    for (const voice of ch.voices) {
      for (const el of voice) {
        if (el && el.pause) el.pause();
      }
    }
    return true;
  }

  /** Start or stop a looping channel. Idempotent, so it is safe per frame. */
  function loop(name, on, { volume = null, rate = null } = {}) {
    const ch = channels[name];
    if (!ch || !ch.available || !ch.row.loop) return false;
    const el = ch.voices[0][0];
    if (!el) return false;
    if (on && state.armed && !state.muted) {
      el.volume = gainFor(name) * (volume === null ? 1 : volume);
      // `rateLocked` means a stall was already blamed on the playback rate, so
      // the pitch effect is dropped for this channel and never re-applied.
      if (rate !== null && !ch.rateLocked && el.playbackRate !== undefined) el.playbackRate = rate;
      if (el.paused !== false) {
        // Rate-limited: a refused play() would otherwise be re-issued sixty times
        // a second, and every attempt is a fresh promise for the browser to
        // reject. It also keeps a genuine autoplay block from looking like a
        // stall to the watchdog below.
        if (state.clock - ch.retry >= cfg.retrySeconds) {
          ch.retry = state.clock;
          start(el);
        }
      }
      ch.playing = true;
    } else if (ch.playing) {
      if (el.pause) el.pause();
      ch.playing = false;
    } else if (on) {
      // Armed later: remember the intent so the loop starts on the first gesture.
      ch.wanted = true;
    }
    return !!ch.playing;
  }

  function update(dt) {
    state.clock += dt;
    if (state.clock >= state.duckUntil) {
      state.duckLevel = Math.min(1, state.duckLevel + cfg.duckRelease * dt);
      if (state.duckLevel >= 1) state.duckLevel = 1;
    }
    state.duck = state.duckLevel;
    tickWatchdog(dt);
    return state;
  }

  /**
   * THE LOOP WATCHDOG. Detects a channel that believes it is playing but whose
   * clock is not moving, and repairs it.
   *
   * This is the fix for a fault that could not be observed from any property the
   * element exposes (see AUDIO.stallSeconds). Rather than diagnose it further,
   * the director now measures the only honest signal — does `currentTime` move —
   * and acts on it, cheapest suspected cause first:
   *
   *   1. PLAYBACK RATE. The engine is the only channel driven with a non-unity
   *      rate, and it is the only one that was ever reported silent. Some engines
   *      (WebKit in particular) will run a looping element at a shifted rate and
   *      emit nothing. So the rate is reset to 1 and LOCKED for that channel:
   *      losing the throttle-pitch effect is a fair trade for having an engine.
   *   2. RE-ISSUE play(). Covers a start that was refused or a decode that wedged.
   *
   * `stalls` is published so the rail can show it: a climbing count means this is
   * firing and the underlying cause is still there, which is a real diagnosis
   * rather than another guess.
   */
  function tickWatchdog(dt) {
    for (const name of Object.keys(channels)) {
      const ch = channels[name];
      if (!ch.row.loop || !ch.playing || state.muted || !ch.available) {
        ch.stall = 0;
        continue;
      }
      const el = ch.voices[0][0];
      if (!el || el.paused !== false) {
        // Not claiming to play: loop()'s retry path owns that case, not this one.
        ch.stall = 0;
        continue;
      }
      const pos = el.currentTime || 0;
      if (pos > 0.01) ch.everPlayed = true;
      // A loop wrap moves the clock backwards, which is motion, not a stall.
      if (Math.abs(pos - ch.lastPos) < 1e-4) ch.stall += dt;
      else ch.stall = 0;
      ch.lastPos = pos;

      if (ch.stall < cfg.stallSeconds) continue;
      ch.stall = 0;

      /**
       * START FAILURE vs STALL — the distinction that makes this watchdog safe.
       *
       * If the clock has NEVER moved, playback was never granted: almost always
       * the autoplay policy waiting for a user gesture. Nothing about the audio
       * configuration is wrong, so nothing is "repaired" — doing so once cost the
       * engine its throttle-pitch effect for a fault that was really "the player
       * has not clicked the page yet". Just keep asking.
       */
      if (!ch.everPlayed) {
        ch.pending += 1;
        start(el);
        if (ch.pending === 1) {
          console.warn(
            `[audio] ${name} has not been allowed to start — the browser is waiting for a user gesture (click or press a key)`,
            { readyState: el.readyState, volume: el.volume }
          );
        }
        continue;
      }

      // It WAS playing and stopped. Now a repair is justified.
      ch.stalls += 1;
      const rateWas = el.playbackRate;
      if (el.playbackRate !== undefined && el.playbackRate !== 1) {
        ch.rateLocked = true;
        el.playbackRate = 1;
      }
      start(el);
      // Logged only for the first few. A stall that cannot be repaired would
      // otherwise print twice a second forever and bury everything else on the
      // console; the count on the rail is the ongoing signal.
      if (ch.stalls <= cfg.stallLogLimit) {
        console.warn(
          `[audio] ${name} claimed to be playing but its clock was frozen — recovering`,
          { stalls: ch.stalls, rateWas, rateNow: el.playbackRate, rateLocked: ch.rateLocked, volume: el.volume, readyState: el.readyState }
        );
      }
    }
  }

  function arm() {
    if (state.armed) return state;
    state.armed = true;
    for (const name of Object.keys(channels)) {
      if (channels[name].wanted) {
        channels[name].wanted = false;
        loop(name, true);
      }
    }
    return state;
  }

  /**
   * PAUSE IS NOT MUTE, and conflating them is what produced the bug this fixes.
   *
   * `setMuted` deliberately touches only LOOPING channels — `if (!ch.row.loop)
   * continue` — because silencing a loop means stopping it, while a one-shot
   * that is already in flight is over in a moment either way. That is right for
   * the mute key and wrong for a pause.
   *
   * Reported from play: pausing on the deck froze the picture while the engine
   * start-up kept running. It is a one-shot, so mute skipped it entirely; it
   * played on behind the pause screen and finished. Then on resume the sound was
   * gone and the countdown was not, so the deck sat in silence until the
   * catapult fired.
   *
   * That gap is not cosmetic — §9 couples the two deliberately: `deckDwell` IS
   * the length of the start-up at its playback rate, so the catapult fires on
   * the recording's last note. Freeze one clock and not the other and the pair
   * cannot re-align; the longer the pause, the wider the silence.
   *
   * So pause freezes EVERY voice that is actually sounding — loops and one-shots
   * alike — and resumes exactly those on the way out. Nothing is restarted from
   * the beginning and nothing is skipped, because an element's own currentTime
   * is the position, and pausing it is what stops that position advancing.
   *
   * Mute is untouched by this and survives a pause on its own: they are separate
   * states, which is the point.
   */
  const suspended = [];
  function setPaused(on) {
    state.paused = !!on;
    if (state.paused) {
      suspended.length = 0;
      for (const name of Object.keys(channels)) {
        for (const take of channels[name].voices) {
          for (const el of take) {
            // `paused === false` rather than `!el.paused`: a stub voice in a
            // headless harness has no such property, and must not be collected.
            if (el && el.paused === false && el.pause) {
              suspended.push(el);
              el.pause();
            }
          }
        }
      }
    } else {
      for (const el of suspended) {
        const p = el.play && el.play();
        if (p && p.catch) p.catch(() => {});
      }
      suspended.length = 0;
    }
    return state.paused;
  }

  function setMuted(on) {
    state.muted = !!on;
    for (const name of Object.keys(channels)) {
      const ch = channels[name];
      if (!ch.row.loop) continue;
      const el = ch.voices[0][0];
      if (!el) continue;
      if (state.muted && el.pause) {
        el.pause();
        ch.playing = false;
      }
    }
    return state.muted;
  }

  /** Stop everything: a restart, a checkpoint restore, a mission end. */
  function reset() {
    for (const name of Object.keys(channels)) {
      const ch = channels[name];
      ch.last = -Infinity;
      ch.playing = false;
      ch.wanted = false;
      for (const voice of ch.voices) {
        for (const el of voice) {
          if (!el) continue;
          if (el.pause) el.pause();
          try {
            el.currentTime = 0;
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
    state.duck = 1;
    state.duckLevel = 1;
    state.duckUntil = -Infinity;
    return state;
  }

  if (gestureTarget && gestureTarget.addEventListener) {
    const once = { once: true };
    gestureTarget.addEventListener("keydown", arm, once);
    gestureTarget.addEventListener("pointerdown", arm, once);
  }

  /**
   * The readiness deadline. It reports, and it only ever marks a cue missing on
   * POSITIVE failure — see the constructor comment. `networkState === 3` is
   * NETWORK_NO_SOURCE: the browser looked and there was nothing there. A file
   * still loading (state 2) is left alone, because in a hidden tab that is every
   * file, and silencing them all was the bug this replaced.
   */
  if (typeof setTimeout === "function") {
    setTimeout(() => {
      for (const name of Object.keys(channels)) {
        const ch = channels[name];
        const el = ch.voices[0] && ch.voices[0][0];
        if (!el) continue;
        const failed = !!el.error || el.networkState === 3;
        if (failed) ch.available = false;
      }
      emit("resolved", report());
    }, cfg.readyDeadline * 1000);
  }

  function report() {
    const available = {};
    for (const name of Object.keys(channels)) available[name] = channels[name].available;
    const stalls = {};
    for (const name of Object.keys(channels)) if (channels[name].stalls) stalls[name] = channels[name].stalls;
    const pending = {};
    for (const name of Object.keys(channels)) if (channels[name].pending) pending[name] = channels[name].pending;
    return { available, stalls, pending, silent: state.silent, armed: state.armed };
  }

  return {
    state,
    cfg,
    channels,
    play,
    stop,
    loop,
    update,
    arm,
    reset,
    setMuted,
    setPaused,
    toggleMute: () => setMuted(!state.muted),
    get report() {
      return report();
    },
    on(kind, fn) {
      if (events[kind]) events[kind].push(fn);
    },
  };
}
