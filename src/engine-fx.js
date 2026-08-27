// The engine: exhaust plume, afterburner ring, shock diamonds. CLAUDE.md §3.
//
// THREE-FREE ON PURPOSE, exactly as crash-fx.js is. This module is the MODEL
// of the engine visual -- it decides, every frame, how long the plume is, how
// bright it is, whether the burner ring is in and where the shock diamonds sit
// -- and aircraft.js is the painter that copies those numbers onto sprites
// parented to the measured nozzles.
//
// The split is not decoration. The whole reason this module did not exist in
// the first build is that its output is looked at rather than asserted, so
// nothing went red when it was missing. Keeping the arithmetic here means the
// budget, the pooling and the burner rule are all gated headlessly, and the
// painter has no arithmetic of its own to drift from them.
//
// EVERYTHING IS POOLED. The sprite list is allocated once at construction and
// its records are mutated in place forever after; `update()` returns the same
// array with the same objects in it, and a gate asserts that identity across
// 600 frames of varying throttle. A 60 Hz effect that allocated a record per
// sprite would allocate 43,000 objects a minute for nothing.

export const ENGINE_FX = {
  // 2 sprites per nozzle: a bright short core and a longer, dimmer tail. One
  // sprite cannot both have a hot mouth and fade out over five metres.
  plumesPerNozzle: 2,
  // 3 diamonds per nozzle, not 3 in total: each nozzle has its own plume and a
  // single shared column would sit between them, in the air, attached to
  // nothing.
  diamondsPerNozzle: 3,

  plumeIdle: 0.9, // m, at throttle 0
  plumeDry: 5.5, // m, at throttle 1 with no burner
  plumeBurnerExtra: 7.5, // m of elongation the burner adds on top
  opacityIdle: 0.25,
  opacityDry: 0.75,

  ringRadius: 0.55, // m
  // The burner fades in over 0.18 s rather than cutting: a hard cut reads as a
  // bug, and the same easing runs backwards on shutdown for the same reason.
  ringFade: 0.18,

  diamondSpacing: 1.4, // m along the plume
  diamondSize: 0.34, // m
  diamondHz: 14,
  diamondLow: 0.35,
  diamondHigh: 0.7,

  // How far aft of the nozzle the plume's two sprites sit, as fractions of the
  // current plume length, and how much of it each one covers.
  // The two tubes overlap and together cover the whole plume: the core spans
  // 0.01-0.67 of its length and the tail 0.37-0.99, so neither pokes forward
  // into the engine can and there is no gap between them.
  coreAt: 0.34,
  coreSpan: 0.66,
  tailAt: 0.68,
  tailSpan: 0.62,
  // The mouth diameter, matched to the measured nozzle rather than guessed:
  // the shared tube geometry is 0.5 in radius at its forward end, so a width
  // of 1.0 puts a 1.0 m mouth on a 1.0 m nozzle.
  width: 1, // m at the nozzle mouth, widened a little by the burner
  burnerWidth: 1.15, // x width with the burner fully in
  // The tail tube is only slightly wider than the core. A large multiplier
  // reads as a funnel rather than as exhaust, and the burner plume already
  // reaches within a few metres of the chase camera at the launch standoff.
  tailWidth: 1.2,
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Plume length in metres. Monotonic non-decreasing in throttle at any fixed
 * burner weight, which is the whole readability claim: a player learns what
 * the lever does by watching the back of their own aircraft.
 */
export function plumeLength(throttle, burner = 0) {
  const t = clamp01(throttle);
  return (
    ENGINE_FX.plumeIdle +
    (ENGINE_FX.plumeDry - ENGINE_FX.plumeIdle) * t +
    ENGINE_FX.plumeBurnerExtra * clamp01(burner)
  );
}

/** Plume opacity over the same range. */
export function plumeOpacity(throttle, burner = 0) {
  const t = clamp01(throttle);
  return (
    ENGINE_FX.opacityIdle +
    (ENGINE_FX.opacityDry - ENGINE_FX.opacityIdle) * t +
    0.18 * clamp01(burner)
  );
}

/**
 * The burner's fade weight, integrated one frame at a time. Separate from the
 * boolean so the ring and the elongation share ONE easing -- a ring that fades
 * against a plume that steps is worse than either alone.
 */
export function stepBurner(weight, lit, dt) {
  const rate = dt / Math.max(ENGINE_FX.ringFade, 1e-6);
  return clamp01(lit ? weight + rate : weight - rate);
}

/**
 * Create the engine's visual model over a MEASURED set of nozzle anchors.
 *
 * `nozzles` are aircraft-local positions, measured from the airframe's own
 * geometry by aircraft.js. Nothing here types a coordinate.
 */
export function createEngineFx(nozzles) {
  const anchors = nozzles.map((n) => ({ x: n.x, y: n.y, z: n.z }));

  // The pool, built ONCE. Order is fixed and the painter matches sprites to it
  // by index, so a record can never change kind under a sprite.
  const sprites = [];
  for (let i = 0; i < anchors.length; i++) {
    for (let k = 0; k < ENGINE_FX.plumesPerNozzle; k++) {
      sprites.push({
        kind: "plume", nozzle: i, slot: k,
        x: 0, y: 0, z: 0, w: 0, h: 0, opacity: 0, visible: false,
      });
    }
    sprites.push({
      kind: "ring", nozzle: i, slot: 0,
      x: 0, y: 0, z: 0, w: 0, h: 0, opacity: 0, visible: false,
    });
    for (let k = 0; k < ENGINE_FX.diamondsPerNozzle; k++) {
      sprites.push({
        kind: "diamond", nozzle: i, slot: k,
        x: 0, y: 0, z: 0, w: 0, h: 0, opacity: 0, visible: false,
      });
    }
  }

  const state = { burner: 0, clock: 0, length: 0, throttle: 0 };

  function update(dt, { throttle = 0, afterburner = false } = {}) {
    state.clock += dt;
    state.burner = stepBurner(state.burner, afterburner === true, dt);
    state.throttle = clamp01(throttle);

    const b = state.burner;
    const len = plumeLength(state.throttle, b);
    const alpha = plumeOpacity(state.throttle, b);
    const width = ENGINE_FX.width * (1 + (ENGINE_FX.burnerWidth - 1) * b);
    state.length = len;

    // The diamond oscillation, one phase for the whole engine: they are one
    // standing pattern in one exhaust, not three independent flickers.
    const osc =
      ENGINE_FX.diamondLow +
      (ENGINE_FX.diamondHigh - ENGINE_FX.diamondLow) *
        (0.5 + 0.5 * Math.sin(state.clock * ENGINE_FX.diamondHz * Math.PI * 2));

    for (const s of sprites) {
      const a = anchors[s.nozzle];
      s.x = a.x;
      s.y = a.y;
      if (s.kind === "plume") {
        const at = s.slot === 0 ? ENGINE_FX.coreAt : ENGINE_FX.tailAt;
        const span = s.slot === 0 ? ENGINE_FX.coreSpan : ENGINE_FX.tailSpan;
        // Aft is +Z: the project's forward is -Z (§5), so the exhaust grows
        // the other way and a sign error here points the plume at the nose.
        s.z = a.z + len * at;
        s.h = len * span;
        s.w = width * (s.slot === 0 ? 1 : ENGINE_FX.tailWidth);
        s.opacity = s.slot === 0 ? alpha : alpha * 0.3;
        s.visible = true;
      } else if (s.kind === "ring") {
        s.z = a.z + ENGINE_FX.ringRadius * 0.2;
        s.w = ENGINE_FX.ringRadius * 2;
        s.h = ENGINE_FX.ringRadius * 2;
        // Dimmer than the plume it sits on: the ring is the mouth, and a
        // mouth brighter than the flame reads as a light rather than as an
        // engine. It is also the closest thing on the aircraft to the launch
        // camera, so it carries more screen area than its metre suggests.
        s.opacity = 0.5 * b;
        // The ring belongs to the burner and to nothing else, so it goes with
        // the same weight that elongates the plume.
        s.visible = b > 0;
      } else {
        // SHOCK DIAMONDS EXIST ONLY WITH THE BURNER LIT. They are a feature of
        // an over-expanded supersonic jet, so showing them at military power
        // would be showing the player something that is not happening.
        s.z = a.z + ENGINE_FX.diamondSpacing * (s.slot + 1);
        s.w = ENGINE_FX.diamondSize;
        s.h = ENGINE_FX.diamondSize;
        s.opacity = osc * b * (1 - s.slot * 0.18);
        s.visible = afterburner === true && b > 0;
      }
    }
    return sprites;
  }

  return {
    anchors,
    sprites,
    state,
    update,
    /** Presentation resets; nothing here is gameplay (§17.11). */
    clear() {
      state.burner = 0;
      state.clock = 0;
      state.length = 0;
      state.throttle = 0;
      for (const s of sprites) {
        s.opacity = 0;
        s.visible = false;
      }
    },
  };
}
