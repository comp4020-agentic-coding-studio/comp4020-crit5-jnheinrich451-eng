/**
 * Stage 05.4 — the world clock and the time-of-day colour curves.
 *
 * PURE MATH, NO three.js. Everything here is a function of one number: `tau`,
 * the normalised position in the day, 0..1. That is what makes the whole
 * day/night system testable without a scene — the renderer-facing modules
 * (ocean.js, night-lights.js, main.js) only read values this file computes.
 *
 * ONE CLOCK FOR THE WHOLE GAME. There is deliberately no per-mode time: the
 * clock is created once at module load and is never reset by a mode change, a
 * mission restart, a checkpoint restore or a respawn. The game mode changes;
 * the world does not. Only a page reload starts the day again.
 */

export const DAY = {
  /**
   * 8 real minutes = 24 visual hours.
   *
   * Was 12. Reduced after play: two minutes of flying from the default start
   * covered tau 0.18 to 0.35, which is entirely inside the daytime plateau where
   * the sun is at full intensity and the palette barely moves — so nothing
   * visibly changed and the cycle looked broken when it was working exactly as
   * specified. At 8 minutes the same two minutes cover a quarter of the day and
   * reach afternoon, and sunset arrives about three minutes after launch.
   *
   * Still configurable, and still nothing here derives a constant from it.
   */
  cycleSeconds: 8 * 60,

  /**
   * Where a fresh page load begins. Mid-morning: the sortie was authored and
   * tuned in daylight, so the default opening still looks like the deck the
   * launch was designed against, and the player reaches sunset by flying rather
   * than by starting there.
   */
  startTau: 0.18,

  /**
   * The two manual presets (`[` and `]`).
   *
   * NEITHER SITS AT ZERO SUN ELEVATION, deliberately. The astronomical moment of
   * sunrise/sunset is the darkest point of both events: measured on the curve it
   * gives sun intensity 0.03 and night factor 0.38, so pressing the key handed
   * the player a dim world with the streetlights already coming on. Offsetting
   * each preset a little into its own daylight side puts the sun just above the
   * horizon, where the warm palette is doing its most obvious work — which is
   * what a player pressing "sunset" is actually asking to see.
   */
  sunriseTau: 0.045,
  sunsetTau: 0.55,

  /**
   * Sunset splits the cycle into a long day and a shorter night, which is what
   * puts the spec's timeline on the curve exactly: midday lands at 0.29, night
   * at 0.79, and sunrise/sunset are the two zero crossings. See sunElevation().
   */
  sunsetSplit: 0.58,
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Wrap into 0..1, so a preset jump or a long dt can never leave the cycle. */
export function wrapTau(tau) {
  const t = tau % 1;
  return t < 0 ? t + 1 : t;
}

/**
 * The clock. Deliberately tiny and deliberately mutable-by-one-owner: `advance`
 * is called from the frame loop and `setTau` from the two preset keys, and
 * nothing else may write it.
 */
export function createWorldClock({ cycleSeconds = DAY.cycleSeconds, tau = DAY.startTau } = {}) {
  const state = { tau: wrapTau(tau), cycleSeconds, elapsed: 0 };
  return {
    state,
    get tau() {
      return state.tau;
    },
    advance(dt) {
      if (!(dt > 0)) return state.tau;
      state.elapsed += dt;
      state.tau = wrapTau(state.tau + dt / state.cycleSeconds);
      return state.tau;
    },
    /** A preset jump moves the clock and then LETS IT RUN. Never freezes it. */
    setTau(next) {
      state.tau = wrapTau(next);
      return state.tau;
    },
  };
}

/**
 * Sun elevation, -1 (deepest night) .. +1 (midday), as a function of tau.
 *
 * Two half-sines rather than one full sine, split at sunset. A single
 * `sin(2*pi*tau)` would put midday at 0.25 and sunset at 0.50; splitting at
 * `sunsetSplit` stretches the day and compresses the night so the spec's
 * artistic timeline falls out of the curve instead of being hand-placed:
 *
 *   tau 0.00  sunrise   elevation  0 (rising)
 *   tau 0.29  midday    elevation +1
 *   tau 0.58  sunset    elevation  0 (falling)
 *   tau 0.79  night     elevation -1
 *   tau 1.00  sunrise   elevation  0 (rising)
 *
 * Continuous and smooth at both crossings, which is what §6 requires: nothing
 * in the lighting may snap between discrete states.
 */
export function sunElevation(tau, cfg = DAY) {
  const t = wrapTau(tau);
  const split = cfg.sunsetSplit;
  if (t < split) return Math.sin(Math.PI * (t / split));
  return -Math.sin(Math.PI * ((t - split) / (1 - split)));
}

/**
 * Unit vector pointing FROM the world TOWARD the sun.
 *
 * The azimuth sweeps a half circle across the day so the sun rises on one side
 * and sets on the other, with a modest Z tilt so the light is never exactly
 * along the course (-Z) — a sun directly ahead or directly behind flattens the
 * terrain relief the player reads the valleys by. No astronomical accuracy is
 * attempted or wanted (§11).
 */
export function sunDirection(tau, cfg = DAY) {
  const t = wrapTau(tau);
  const y = sunElevation(t, cfg);
  // Azimuth continues turning through the night, so the moon-side light comes
  // from the opposite quarter to the day's sun without a second rule.
  const az = Math.PI * (t < cfg.sunsetSplit ? t / cfg.sunsetSplit : 1 + (t - cfg.sunsetSplit) / (1 - cfg.sunsetSplit));
  const horiz = Math.sqrt(Math.max(0, 1 - y * y));
  const x = Math.cos(az) * horiz;
  const z = Math.sin(az) * horiz * 0.42;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/**
 * How night it is, 0..1, from sun elevation.
 *
 * Driven by elevation rather than by tau so every consumer — sky, fog, ocean,
 * settlement lights, carrier lights — is reading the same single quantity and
 * they cannot disagree about whether it is night (§41/§44). The band is wide
 * (+0.10 down to -0.16) because dusk is the interesting part and a narrow band
 * makes the lights pop on like a switch.
 */
export function nightFactor(elevation) {
  return clamp01((0.1 - elevation) / 0.26);
}

/** How much the sun is doing, 0..1. Zero a little before it reaches the horizon. */
export function dayFactor(elevation) {
  return clamp01((elevation + 0.04) / 0.34);
}

/* ---- colour ---- */

const rgb = (hex) => ({ r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 });
const hex = (c) => (Math.round(c.r) << 16) | (Math.round(c.g) << 8) | Math.round(c.b);
const mixRgb = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });

/**
 * Keyframes around the cycle. Interpolated, never selected: §6 and §17 both
 * insist the transitions are continuous, so this table is only the corners.
 *
 * `sky` is the dome and the fog's base colour; `haze` is the horizon band, kept
 * a little brighter than the sky at night so the horizon stays perceptible with
 * no light on it (§16) — that separation is what Expert mode is flown on.
 *
 * THE WATER IS DELIBERATELY MORE SATURATED THAN THE SKY AT EVERY HOUR. It was a
 * grey-blue close to the haze, which made the waterline hard to find: at low
 * altitude over open sea there was no colour boundary between air and surface,
 * so there was no cue for how high you were. A genuinely blue sea against a pale
 * sky gives that boundary back, and the contrast is what the eye judges height
 * from when there is nothing else out there.
 */
const KEYS = [
  // tau, sun light, sky/dome, horizon haze, ambient sky, ambient ground, deep water, cloud tint
  { tau: 0.0, sun: 0xffb173, sky: 0x6f86b4, haze: 0xf0b48c, hemiSky: 0xb9c8e2, hemiGround: 0x4a4a52, water: 0x1b3f68, cloud: 0xf2d3c0 },
  // Morning is deliberately PALER and cooler than midday, and afternoon warmer:
  // the daytime keyframes used to be near-identical, which is why an hour of
  // flying in daylight showed no change at all. Colour shift is what the eye
  // notices while the sun is at full strength.
  { tau: 0.15, sun: 0xffe6c4, sky: 0x92b6d9, haze: 0xd8e2ea, hemiSky: 0xcfe0f0, hemiGround: 0x565c62, water: 0x1d63a2, cloud: 0xf4f2ee },
  { tau: 0.3, sun: 0xfff4e2, sky: 0x86b0d8, haze: 0x9cbad2, hemiSky: 0xbcd6ea, hemiGround: 0x33424f, water: 0x14589b, cloud: 0xdfe9f2 },
  { tau: 0.48, sun: 0xffe3b4, sky: 0x7c9ec6, haze: 0xbcc0c4, hemiSky: 0xb4c6dc, hemiGround: 0x3c4148, water: 0x134a80, cloud: 0xe8e4dc },
  { tau: 0.58, sun: 0xff9a4e, sky: 0x5d6fa0, haze: 0xe8a566, hemiSky: 0x9fa8c6, hemiGround: 0x4a4048, water: 0x16304f, cloud: 0xf0b585 },
  { tau: 0.68, sun: 0x8f6ea8, sky: 0x2f3866, haze: 0x8c6f9c, hemiSky: 0x5a6490, hemiGround: 0x2e2c3c, water: 0x101f38, cloud: 0x7d7c9c },
  { tau: 0.78, sun: 0x5a74a8, sky: 0x111a33, haze: 0x2b3a5c, hemiSky: 0x2b3a60, hemiGround: 0x14161f, water: 0x060f1e, cloud: 0x39435e },
  { tau: 0.92, sun: 0x6b7fb0, sky: 0x16203c, haze: 0x3a4668, hemiSky: 0x33406a, hemiGround: 0x181a24, water: 0x08121f, cloud: 0x424d68 },
  { tau: 1.0, sun: 0xffb173, sky: 0x6f86b4, haze: 0xf0b48c, hemiSky: 0xb9c8e2, hemiGround: 0x4a4a52, water: 0x1b3f68, cloud: 0xf2d3c0 },
];

/** Interpolated keyframe colours at `tau`. */
export function paletteFor(tau) {
  const t = wrapTau(tau);
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1].tau) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const span = b.tau - a.tau;
  const k = span > 0 ? clamp01((t - a.tau) / span) : 0;
  return {
    sun: hex(mixRgb(rgb(a.sun), rgb(b.sun), k)),
    sky: hex(mixRgb(rgb(a.sky), rgb(b.sky), k)),
    haze: hex(mixRgb(rgb(a.haze), rgb(b.haze), k)),
    hemiSky: hex(mixRgb(rgb(a.hemiSky), rgb(b.hemiSky), k)),
    hemiGround: hex(mixRgb(rgb(a.hemiGround), rgb(b.hemiGround), k)),
    water: hex(mixRgb(rgb(a.water), rgb(b.water), k)),
    cloud: hex(mixRgb(rgb(a.cloud), rgb(b.cloud), k)),
  };
}

/**
 * Everything the renderer needs for one instant, from one number.
 *
 * NIGHT MUST STAY FLYABLE (§14/§15). The floors below are gameplay values, not
 * physical ones: `moon` is far stronger than real moonlight and the hemisphere
 * light never falls under `minAmbient`, because a fighter at 200 m/s in a black
 * world is not a hard night, it is a broken game. Terrain lands around 12-20%
 * of its daylight brightness, which is the band §14 asks for.
 */
export const NIGHT = {
  minAmbient: 0.4, // hemisphere floor: silhouettes stay readable
  moonIntensity: 0.55, // deliberately brighter than reality
  moonColor: 0x9fb6d8,
  sunPeak: 2.3, // matches the original fixed sun, so daylight is unchanged
  hemiPeak: 1.15,
};

/**
 * A human name for the current instant, for the developer rail.
 *
 * The cycle is otherwise only observable by looking at the sky, which makes
 * "is the clock even running?" an unanswerable question. Named bands make the
 * clock legible without adding a time control the spec rules out (§10).
 */
export function phaseName(tau) {
  const t = wrapTau(tau);
  if (t < 0.08) return "SUNRISE";
  if (t < 0.22) return "MORNING";
  if (t < 0.4) return "MIDDAY";
  if (t < 0.52) return "AFTERNOON";
  if (t < 0.62) return "SUNSET";
  if (t < 0.72) return "TWILIGHT";
  if (t < 0.88) return "NIGHT";
  return "PRE-DAWN";
}

export function environmentFor(tau, cfg = DAY) {
  const t = wrapTau(tau);
  const elev = sunElevation(t, cfg);
  const night = nightFactor(elev);
  const day = dayFactor(elev);
  const pal = paletteFor(t);
  const dir = sunDirection(t, cfg);

  return {
    tau: t,
    elevation: elev,
    night,
    day,
    sunDirection: dir,
    /** The moon sits opposite the sun, so night relief comes from one side. */
    moonDirection: { x: -dir.x, y: Math.abs(dir.y) * 0.55 + 0.25, z: -dir.z },
    sunColor: pal.sun,
    /**
     * Squared falloff: the last of the light goes quickly, which is what makes
     * twilight read as twilight rather than as a long dim afternoon (§12).
     *
     * The trailing elevation term is a gentle daytime ramp — midday is 100% and
     * mid-morning about 87% — so the plateau between sunrise and sunset is not
     * perfectly flat. Without it `day` saturates at an elevation of 0.30 and the
     * sun holds one constant value across two thirds of the cycle.
     */
    sunIntensity: NIGHT.sunPeak * day * day * (0.78 + 0.22 * Math.max(0, elev)),
    moonColor: NIGHT.moonColor,
    moonIntensity: NIGHT.moonIntensity * night,
    skyColor: pal.sky,
    hazeColor: pal.haze,
    hemiSky: pal.hemiSky,
    hemiGround: pal.hemiGround,
    hemiIntensity: lerp(NIGHT.hemiPeak, NIGHT.minAmbient, night),
    waterColor: pal.water,
    cloudColor: pal.cloud,
    // Clouds must not vanish into the night sky: they carry the depth read, so
    // they keep a floor of contrast against the dome (§20).
    cloudOpacityScale: lerp(1, 0.72, night),
    /** Drives settlement lights, carrier lights and the ocean's night look. */
    nightLightLevel: night,
  };
}
