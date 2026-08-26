// Keyboard -> { x, y, roll, throttle }. CLAUDE.md §7, §17.5, §17.6.
//
// Three structural rules live in this file, each of which describes a real
// failure rather than a preference. They are commented where they are
// implemented so they survive the next edit.

// ── sign conventions ───────────────────────────────────────────────────────
// POSITIVE IS LEFT, for both bank and heading, and the two agree on purpose.
//
// Course runs toward -Z, forward is (-sin h, -cos h), so d(forward)/dh points
// at -X: increasing heading turns LEFT. A positive bank angle tilts the
// up-vector to (-sin b, cos b, 0), i.e. left wing down -- also left. Because
// they match, the coordinated-turn term in flight.js needs no minus sign, and
// there is no sign to get backwards later. A (bank left) is therefore +1.

const AXIS_KEYS = {
  // pitch: W = nose up by default (the pitch-convention toggle arrives in
  // stage 2 as a single sign flip at this boundary).
  KeyW: { axis: "y", value: 1 },
  KeyS: { axis: "y", value: -1 },
  // bank: positive is left, per the note above.
  KeyA: { axis: "x", value: 1 },
  KeyD: { axis: "x", value: -1 },
  // roll rate, trimming the bank directly.
  KeyQ: { axis: "roll", value: 1 },
  KeyE: { axis: "roll", value: -1 },
  // throttle: a RATE, which flight.js integrates into a persistent lever.
  ShiftLeft: { axis: "throttle", value: 1 },
  ControlLeft: { axis: "throttle", value: -1 },
};

// Discrete presses, latched until something consumes them. Stage 4 drops any
// latch accumulated during the catapult script so a key pressed on the deck
// does not fire on the handoff frame.
const LATCH_KEYS = {
  KeyR: "restart",
};

// Axes ramp toward their target rather than snapping, so a key release eases
// back to zero. ~6/s reaches 99.75% of full deflection in one second.
const RAMP = 6;

// How close to its target an axis must get before it snaps exactly onto it.
// At RAMP = 6 this is reached ~1.15 s after a change, so the commanded value
// settles well inside the time a player would notice.
const SNAP = 1e-3;

const RAMPED = ["x", "y", "roll"];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createInput(options = {}) {
  const target = options.target ?? globalThis;
  const doc = options.doc ?? globalThis.document ?? null;

  const held = new Set();
  const latches = new Set();
  const axes = { x: 0, y: 0, roll: 0, throttle: 0 };
  const listeners = [];

  function on(node, type, fn) {
    if (!node || typeof node.addEventListener !== "function") return;
    node.addEventListener(type, fn);
    listeners.push([node, type, fn]);
  }

  // Rule 1 (§17.5): track by event.code, NEVER event.key.
  //
  // `key` can differ between the keydown and keyup of the same physical press
  // -- modifiers, caps lock, a layout switch, an IME. When it differs, the
  // keyup deletes a set entry that is not there and the keydown's entry is
  // orphaned permanently: a stuck axis at full deflection that no further
  // input can clear. `code` is the physical key and never changes mid-press.
  function onKeyDown(event) {
    const code = event.code;
    if (!code) return;
    if (code === "KeyC") {
      clear();
      return;
    }
    if (LATCH_KEYS[code]) latches.add(LATCH_KEYS[code]);
    if (!AXIS_KEYS[code]) return;
    held.add(code);
    // Only axis keys we actually consume are swallowed, so browser and OS
    // shortcuts on every other key keep working.
    if (typeof event.preventDefault === "function") event.preventDefault();
  }

  function onKeyUp(event) {
    if (event.code) held.delete(event.code);
  }

  function clear() {
    held.clear();
    axes.x = 0;
    axes.y = 0;
    axes.roll = 0;
    axes.throttle = 0;
  }

  // Rule 3: every one of these is a way a held key stops being held without a
  // keyup ever arriving -- alt-tab, a tab switch, a bfcache navigation, a
  // right-click menu stealing focus. Without them the axis stays deflected and
  // the aircraft "turns on its own".
  on(target, "blur", clear);
  on(target, "pagehide", clear);
  on(target, "contextmenu", clear);
  on(doc, "visibilitychange", () => {
    if (doc && doc.visibilityState === "hidden") clear();
  });

  on(target, "keydown", onKeyDown);
  on(target, "keyup", onKeyUp);

  // Rule 2 (§17.6): there is NO pointermove listener in this file, and there
  // never will be one. A screen position cannot be a stick: it has no centre,
  // no detent and no spring, and every attempt to synthesise those from
  // coordinates (relative origin, edge drift, claim revocation, settle timers,
  // pointer lock, spring return) fixes one failure mode and leaves the others.
  // The flight axes are unreachable from the pointer as a STRUCTURAL property
  // -- there is no code path from a pointer event to an axis -- rather than as
  // a policy that a later edit could quietly relax.
  //
  // Arrow keys are absent from AXIS_KEYS for the same class of reason: browser
  // and embed chrome steal them, so their keyup goes missing and the axis
  // sticks. Do not add them.

  function targetFor(axis) {
    let v = 0;
    for (const code of held) {
      const bind = AXIS_KEYS[code];
      if (bind && bind.axis === axis) v += bind.value;
    }
    return clamp(v, -1, 1);
  }

  function update(dt) {
    const k = dt > 0 ? 1 - Math.exp(-RAMP * dt) : 0;
    for (const axis of RAMPED) {
      const target = targetFor(axis);
      axes[axis] += (target - axes[axis]) * k;
      // Snap the last sliver onto the TARGET, in both directions.
      //
      // An exponential approach never arrives, so a released axis keeps a
      // residual command forever: e^-6 = 0.0025 one second after release,
      // which is a 0.17 deg bank order and about 0.02 deg/s of heading. That
      // is invisible per frame and reads, a minute later, as the aircraft
      // turning on its own -- the same complaint the arrow-key and event.key
      // rules exist to prevent, arriving by a third route.
      //
      // Snapping to the target rather than to zero means a HELD axis lands
      // exactly on full deflection too, so the commanded value is always a
      // number the rest of the model can compare against exactly.
      if (Math.abs(target - axes[axis]) < SNAP) axes[axis] = target;
    }
    // The throttle input is a rate, not a position: it is passed through
    // unramped and flight.js integrates it into the lever.
    axes.throttle = targetFor("throttle");
    return axes;
  }

  return {
    axes,
    update,
    clear,
    heldKeys: () => [...held],
    isHeld: (code) => held.has(code),

    // Every event type this module actually subscribes to. Exposed so the
    // suite can assert the STRUCTURAL half of §17.6 -- that no pointer, mouse,
    // touch or wheel listener exists at all -- rather than only the symptom
    // that a dispatched pointer event happened not to move an axis.
    listenerTypes: () => listeners.map(([, type]) => type),
    consumeLatch(name) {
      if (!latches.has(name)) return false;
      latches.delete(name);
      return true;
    },
    dropLatches: () => latches.clear(),
    dispose() {
      for (const [node, type, fn] of listeners) node.removeEventListener(type, fn);
      listeners.length = 0;
      clear();
    },
  };
}
