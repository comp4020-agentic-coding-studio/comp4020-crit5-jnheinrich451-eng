// Pointer + keyboard -> { x, y, roll, throttle }. CLAUDE.md §7, §17.5, §17.6.
//
// The pointer is the PRIMARY control and the reason the no-instructions rule
// (§"No instructions, anywhere") is satisfiable at all: the aircraft sits at
// the middle of the viewport and follows the cursor, which a stranger
// discovers in about a second. WASD alone is not self-teaching.
//
// The keyboard is still fully wired and simply undocumented in-game. Every key
// works; nothing on screen says so.

// ── sign conventions ───────────────────────────────────────────────────────
// POSITIVE IS LEFT, for both bank and heading, and the two agree on purpose.
//
// Course runs toward -Z, forward is (-sin h, -cos h), so d(forward)/dh points
// at -X: increasing heading turns LEFT. A positive bank angle tilts the
// up-vector to (-sin b, cos b, 0), i.e. left wing down -- also left. Because
// they match, the coordinated-turn term in flight.js needs no minus sign.
//
// Pitch is positive nose-up before the convention flip below.

const AXIS_KEYS = {
  KeyW: { axis: "y", value: 1 },
  KeyS: { axis: "y", value: -1 },
  KeyA: { axis: "x", value: 1 },
  KeyD: { axis: "x", value: -1 },
  KeyQ: { axis: "roll", value: 1 },
  KeyE: { axis: "roll", value: -1 },
  ShiftLeft: { axis: "throttle", value: 1 },
  ControlLeft: { axis: "throttle", value: -1 },
};

// Discrete presses, latched until something consumes them.
const LATCH_KEYS = {
  KeyR: "restart",
  KeyZ: "flares",
  KeyX: "weapon",
  Space: "evade",
};

// Held (non-latched) actions. The gun reads a held state because it is a loop,
// not 48 one-shots a second (§16 audio).
const HOLD_KEYS = {
  KeyF: "fire",
};

// Mouse buttons. All of these are DISCRETE -- holding one must do nothing
// extra, so the weapon switch and the flare dispenser latch on the press edge
// and never repeat. Fire is the exception by design: it is a held state
// because the cannon is a sustained loop.
const MOUSE_BUTTONS = {
  0: { hold: "fire" },
  1: { latch: "flares" }, // middle
  2: { latch: "weapon" }, // right
};

const RAMP = 6;
const SNAP = 1e-3;
const RAMPED = ["x", "y", "roll"];

// ── pointer steering geometry (§7) ─────────────────────────────────────────
// Deflection is DISTANCE FROM THE SCREEN CENTRE, which is fixed and visible
// and never synthesised. The dead zone is what gives the control a neutral --
// hovering over the aircraft holds attitude - and its absence is precisely
// what made the earlier relative-origin design unfixable.
export const POINTER_DEAD_ZONE = 0.1;
export const POINTER_FULL_STICK = 0.52;
export const POINTER_GAIN = 0.95;

// A wheel notch is an impulse, but flight.js reads throttle as a RATE, so a
// notch charges a small decaying value instead of jumping the lever. One
// throttle model regardless of input source.
const WHEEL_IMPULSE = 0.85;
const WHEEL_DECAY = 7;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Pure pointer -> stick mapping. Exported and dependency-free so the suite can
 * assert the geometry headlessly rather than through a screenshot.
 *
 * Returns axes in the project's own convention: x positive is LEFT bank, y
 * positive is nose UP (before the pitch-convention flip).
 */
export function pointerStick(px, py, width, height) {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0 };
  const halfW = width / 2;
  const halfH = height / 2;

  // Normalised per axis, so full deflection is the same FRACTION of the
  // viewport in both directions. That matters because the two marking
  // viewports have very different aspects: a radial measure in raw pixels
  // would need a third of the travel vertically on a 390x844 frame.
  const nx = (px - halfW) / halfW;
  const ny = (halfH - py) / halfH; // screen y grows downward; flip it

  const r = Math.hypot(nx, ny);
  if (!(r > POINTER_DEAD_ZONE)) return { x: 0, y: 0 };

  const scale =
    (clamp(
      (r - POINTER_DEAD_ZONE) / (POINTER_FULL_STICK - POINTER_DEAD_ZONE),
      0,
      1,
    ) *
      POINTER_GAIN) /
    r;

  return {
    // Cursor right of centre banks RIGHT, which is negative in this project.
    x: -nx * scale,
    y: ny * scale,
  };
}

export function createInput(options = {}) {
  const target = options.target ?? globalThis;
  const doc = options.doc ?? globalThis.document ?? null;

  const held = new Set();
  const latches = new Set();
  const holds = new Set();
  const axes = { x: 0, y: 0, roll: 0, throttle: 0 };
  const keyAxes = { x: 0, y: 0, roll: 0 };
  const listeners = [];

  // The pointer's position is a PHYSICAL FACT about where the player's hand
  // is, not a latch. It is never cleared by reset, respawn or a mode change --
  // pretending the player moved their hand would be a lie, and the aircraft
  // would snap to an attitude nobody commanded.
  let pointer = null; // {x, y, w, h}
  let steeringEnabled = true;

  let wheelCharge = 0;

  // ── the pitch convention (§7) ────────────────────────────────────────────
  // NOSE UP   W / cursor up = nose up    default
  // NOSE DOWN W / cursor up = nose down  the control-column convention
  //
  // ONE SIGN FLIP at the input boundary, applied to the COMBINED pitch axis so
  // it governs the pointer and the keyboard alike -- it is a pitch convention,
  // not a keyboard convention. Nothing downstream knows the setting exists.
  let pitchSign = 1;

  function on(node, type, fn, opts) {
    if (!node || typeof node.addEventListener !== "function") return;
    node.addEventListener(type, fn, opts);
    listeners.push([node, type, fn]);
  }

  const kill = (event) => {
    if (typeof event.preventDefault === "function") event.preventDefault();
  };

  // ── keyboard ─────────────────────────────────────────────────────────────
  // §17.5: track by event.code, NEVER event.key. `key` can differ between the
  // keydown and keyup of the same physical press (modifiers, caps lock, a
  // layout switch, an IME). When it differs, the keyup deletes a set entry
  // that is not there and the keydown's entry is orphaned permanently: a stuck
  // axis at full deflection that no further input can clear.
  //
  // Arrow keys are absent from AXIS_KEYS for a related reason: browser and
  // embed chrome steal them, so their keyup goes missing. Do not add them.
  function onKeyDown(event) {
    const code = event.code;
    if (!code) return;
    if (code === "KeyC") return clear();
    if (code === "KeyI") return togglePitchConvention();
    if (HOLD_KEYS[code]) holds.add(HOLD_KEYS[code]);
    // Latch on the press EDGE, so holding the key does not repeat the action
    // once the OS keyboard repeat kicks in.
    if (LATCH_KEYS[code] && !held.has(code)) latches.add(LATCH_KEYS[code]);
    if (HOLD_KEYS[code] || LATCH_KEYS[code] || AXIS_KEYS[code]) {
      held.add(code);
      kill(event);
    }
  }

  function onKeyUp(event) {
    const code = event.code;
    if (!code) return;
    held.delete(code);
    if (HOLD_KEYS[code]) holds.delete(HOLD_KEYS[code]);
  }

  function clear() {
    held.clear();
    holds.clear();
    axes.x = 0;
    axes.y = 0;
    axes.roll = 0;
    axes.throttle = 0;
    keyAxes.x = 0;
    keyAxes.y = 0;
    keyAxes.roll = 0;
    wheelCharge = 0;
    // NOT cleared: `pointer` (a physical position, see above) and `pitchSign`
    // (a preference that must survive reset, respawn and mode change). Every
    // other reset in this project clears everything it can reach; these two
    // are the explicit exceptions.
  }

  function togglePitchConvention() {
    pitchSign = -pitchSign;
    // Flip the live ramped value too, so the axis reverses on the spot rather
    // than easing across zero over the next second.
    axes.y = -axes.y;
    keyAxes.y = -keyAxes.y;
  }

  // ── pointer ──────────────────────────────────────────────────────────────
  // §17.6: positional, from a fixed visible centre. NEVER a synthesised or
  // drifting origin. A previous design steered from a claimed origin derived
  // from relative movement and took six fixes without closing the bug, because
  // a synthesised centre has no detent the player can see or feel. If the
  // steering ever needs changing, change the mapping FROM POSITION; do not
  // reintroduce an origin that moves.
  function onPointerMove(event) {
    const w = event.view?.innerWidth ?? globalThis.innerWidth ?? 0;
    const h = event.view?.innerHeight ?? globalThis.innerHeight ?? 0;
    pointer = { x: event.clientX, y: event.clientY, w, h };
  }

  function onPointerDown(event) {
    const bind = MOUSE_BUTTONS[event.button];
    if (!bind) return;
    if (bind.hold) holds.add(bind.hold);
    if (bind.latch) latches.add(bind.latch);
    // Every mouse binding suppresses its default: the middle button otherwise
    // triggers autoscroll and the right button opens the context menu.
    kill(event);
  }

  function onPointerUp(event) {
    const bind = MOUSE_BUTTONS[event.button];
    if (bind?.hold) holds.delete(bind.hold);
  }

  function onWheel(event) {
    // Normalise the notch: deltaMode 0 is pixels, 1 is lines, 2 is pages, and
    // a trackpad sends small pixel deltas continuously. Sign is inverted so
    // wheel-up (negative deltaY) pushes the throttle FORWARD.
    const notch = event.deltaY > 0 ? -1 : event.deltaY < 0 ? 1 : 0;
    wheelCharge = clamp(wheelCharge + notch * WHEEL_IMPULSE, -2, 2);
    kill(event); // otherwise the page scrolls under the game
  }

  function onContextMenu(event) {
    // Double duty (§7): suppress the menu AND clear held keys, because a menu
    // opening swallows the keyup of anything currently held.
    kill(event);
    clear();
  }

  on(target, "keydown", onKeyDown);
  on(target, "keyup", onKeyUp);
  on(target, "blur", clear);
  on(target, "pagehide", clear);
  on(target, "contextmenu", onContextMenu);
  on(doc, "visibilitychange", () => {
    if (doc && doc.visibilityState === "hidden") clear();
  });

  on(target, "pointermove", onPointerMove);
  on(target, "pointerdown", onPointerDown);
  on(target, "pointerup", onPointerUp);
  on(target, "pointercancel", onPointerUp);
  // Not passive: the wheel handler must be able to preventDefault.
  on(target, "wheel", onWheel, { passive: false });

  function keyTargetFor(axis) {
    let v = 0;
    for (const code of held) {
      const bind = AXIS_KEYS[code];
      if (bind && bind.axis === axis) v += bind.value;
    }
    return clamp(v, -1, 1);
  }

  function pointerAxes() {
    if (!steeringEnabled || !pointer) return { x: 0, y: 0 };
    return pointerStick(pointer.x, pointer.y, pointer.w, pointer.h);
  }

  function update(dt) {
    const k = dt > 0 ? 1 - Math.exp(-RAMP * dt) : 0;

    // The keyboard axes ramp; the pointer is positional and immediate.
    for (const axis of RAMPED) {
      const t = keyTargetFor(axis);
      keyAxes[axis] += (t - keyAxes[axis]) * k;
      // Snap onto the TARGET in both directions. An exponential approach never
      // arrives, so a released axis keeps a residual command forever -- e^-6 =
      // 0.0025 one second after release, a 0.17 deg bank order and about
      // 0.02 deg/s of heading. Invisible per frame; a minute later it reads as
      // the aircraft turning on its own.
      if (Math.abs(t - keyAxes[axis]) < SNAP) keyAxes[axis] = t;
    }

    const p = pointerAxes();

    // Combine by taking WHICHEVER AXIS IS ASKING FOR MORE (§7). A held key
    // therefore always overrides a resting cursor, and neither input needs to
    // know the other exists.
    axes.x = Math.abs(keyAxes.x) >= Math.abs(p.x) ? keyAxes.x : p.x;
    axes.y = Math.abs(keyAxes.y) >= Math.abs(p.y) ? keyAxes.y : p.y;
    axes.roll = keyAxes.roll;

    // The one sign flip, on the combined axis, so it governs both sources.
    axes.y *= pitchSign;

    // Throttle: the keyboard lever keys are a rate, and a wheel notch charges
    // a decaying value that reads as the same rate. One model, two sources.
    axes.throttle = clamp(keyTargetFor("throttle") + wheelCharge, -1, 1);
    wheelCharge *= Math.exp(-WHEEL_DECAY * dt);
    if (Math.abs(wheelCharge) < 1e-3) wheelCharge = 0;

    return axes;
  }

  return {
    axes,
    update,
    clear,

    heldKeys: () => [...held],
    isHeld: (code) => held.has(code),
    listenerTypes: () => listeners.map(([, type]) => type),

    // Held actions -- the gun is the only one, because it is a sustained loop.
    isFiring: () => holds.has("fire"),
    holdsActive: () => [...holds],

    // Discrete actions. Flares have two sources (Z and the middle button)
    // feeding ONE latch, polled in the frame loop rather than acted on in a
    // handler, so both behave identically.
    consumeLatch(name) {
      if (!latches.has(name)) return false;
      latches.delete(name);
      return true;
    },
    dropLatches: () => latches.clear(),

    pitchConvention: () => (pitchSign > 0 ? "W = NOSE UP" : "W = NOSE DOWN"),
    pitchSign: () => pitchSign,
    togglePitchConvention,

    // Steering is switched off outright while the launch script or the crash
    // presentation owns the aircraft, rather than asking each of those
    // branches to remember to ignore the pointer.
    setSteeringEnabled(on) {
      steeringEnabled = !!on;
    },
    steeringEnabled: () => steeringEnabled,
    pointerPosition: () => (pointer ? { ...pointer } : null),
    pointerAxes,

    dispose() {
      for (const [node, type, fn] of listeners) node.removeEventListener(type, fn);
      listeners.length = 0;
      clear();
      pointer = null;
    },
  };
}
