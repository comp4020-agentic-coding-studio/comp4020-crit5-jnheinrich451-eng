/**
 * Input abstraction. Flight code reads only { x, y, roll, throttle } in -1..1.
 * x: -1 left .. +1 right      y: -1 down .. +1 up      roll: -1 left .. +1 right
 *
 * ---------------------------------------------------------------------------
 * Stage 04.0a — MOUSE STEERING IS GONE.
 *
 * Not disabled, not defaulted off: removed. Steering is the keyboard, and the
 * mouse is a trigger.
 *
 * The report that killed it arrived four times in three stages, always in the
 * same words: "when I approach the hostile jet my fighter dodges to the right
 * and I never control this." Six fixes were shipped against it —
 *
 *   03.2b  steering became RELATIVE, measured from a claimed origin
 *   03.2c  edge drift gated on real movement, not on position
 *   03.2d  the keyboard REVOKES the mouse's claim instead of yielding back
 *   03.2e  the claim waits for the pointer to come to rest, in the interior
 *   03.2e  pointer-lock deltas, so a window edge cannot cap the stick
 *   03.3a  a spring return, so letting go of the mouse re-centres the stick
 *
 * — and every one of them was a correct fix to a real defect. The aircraft still
 * turned on its own. That is the signal worth acting on: when six correct fixes
 * do not close a bug, the bug is not in the fixes, it is in the premise.
 *
 * The premise was that a POSITION can be a stick. It cannot, on a desktop. A
 * physical stick has a spring, a detent and a hand that knows where centre is;
 * a pointer has none of those, and every one of the six fixes above is an
 * attempt to synthesise one of them from screen coordinates. Each synthetic
 * property has a failure mode, the failure modes are not independent, and their
 * union is "the aircraft banks and I did not ask it to". Stage 03.3 made that
 * fatal rather than annoying, because tracking a manoeuvring enemy with the
 * mouse is the normal thing to do, and Stage 04.0 made it cost a mission.
 *
 * So the whole surface is deleted: MOUSE, mouseAxis, lockAxis, driftOrigin,
 * springReturn, the claim state machine, the settle timer, the edge drift, the
 * pointer-lock path, the spring, and the V / B / C keys that existed only to
 * manage them. What is left cannot command bank without a key being held, which
 * is a property rather than a mitigation.
 *
 * The mouse keeps everything it was actually good at: the left button is the
 * trigger, and the lead pipper, the target bracket and the weapon cycle are
 * untouched.
 */
import { clamp, damp } from "./flight.js";

/**
 * Stage 05.0 — POINTER STEERING, reintroduced deliberately.
 *
 * Stage 04.0b deleted mouse steering after six fixes failed to close a
 * "the aircraft turns on its own" bug, and recorded the reason: a screen position
 * cannot be a stick because it has no centre, and every fix was trying to
 * synthesise one out of relative movement (a claimed origin, edge drift, claim
 * revocation, settle timers, pointer lock, a spring return). Each fixed one
 * failure mode and left the others.
 *
 * This design is not that design. The centre is not synthesised — it is the
 * aircraft, fixed at the middle of the screen, permanently. There is nothing to
 * claim, nothing to revoke, no timer and no spring, because the detent is a real
 * place the player can see. Deflection is simply distance from centre.
 *
 * Two properties make it safe where the old one was not:
 *
 * 1. **A dead zone over the aircraft.** Hovering on the F-15 commands nothing, so
 *    the aircraft holds its attitude — there is a way to let go.
 * 2. **The cursor stays visible.** The player can always see exactly what they are
 *    commanding. The old bug was invisible by construction; this one cannot be,
 *    because the input device is drawn on screen.
 *
 * A parked off-centre cursor DOES keep turning the aircraft, and that is correct
 * rather than a defect: it is a stick held over, and it looks like one.
 */
export const MOUSE = {
  /** Fractions of the half-viewport. Dead zone ≈ the aircraft, span ≈ full stick. */
  deadZone: 0.1,
  span: 0.52,
  /** Full deflection is not full authority — the mouse is smoother than a key. */
  gain: 0.95,
  /**
   * Stage 05.1 — the wheel is the throttle.
   *
   * A wheel tick is an impulse, but the flight model reads throttle as a RATE, so
   * each notch charges a small decaying value rather than jumping the lever. That
   * keeps one throttle model — a persistent lever moved at a rate — regardless of
   * whether the input came from a key or a notch.
   */
  wheelStep: 0.55,
  wheelDecay: 6,
};

/**
 * Pure: pointer position to a stick deflection, given the viewport centre.
 * Returns -1..1 per axis, y positive up.
 */
export function pointerStick(px, py, w, h, cfg = MOUSE) {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const half = Math.min(w, h) * 0.5;
  const dead = cfg.deadZone * half;
  const span = cfg.span * half;
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.hypot(dx, dy);
  if (!(dist > dead) || span <= dead) return { x: 0, y: 0 };
  const k = Math.min(1, (dist - dead) / (span - dead)) * cfg.gain;
  return { x: (dx / dist) * k, y: (-dy / dist) * k };
}

/** Whichever source is asking for more. Keyboard therefore always overrides. */
export function combineAxis(a, b) {
  return Math.abs(a) >= Math.abs(b) ? a : b;
}

/**
 * Axis keys are tracked by `event.code` — the PHYSICAL key — not by `event.key`.
 *
 * `event.key` is the character produced, and it can differ between the keydown
 * and the keyup of the same physical press: modifier state, caps lock, layout
 * switches, and IMEs all change it. When it differs, the keyup deletes a set
 * entry that is not there and the keydown's entry is orphaned FOREVER — a stuck
 * axis at full deflection, unrecoverable, because pressing the opposite key only
 * cancels it while held.
 *
 * `event.code` is the same string on press and release no matter what.
 *
 * ---------------------------------------------------------------------------
 * Stage 04.0b — THE ARROW KEYS ARE NOT FLIGHT AXES.
 *
 * This is the actual cause of "my fighter dodges right on its own", and it was
 * on screen the whole time. The dev rail's held-key readout said `ArrowRight`
 * while the stick read `in +1.00` and bank sat pinned at -70°: a physical
 * ArrowRight keydown with no matching keyup, held forever, commanding a full
 * right turn. Every mouse fix in 03.2 and 03.3 was the wrong device.
 *
 * Arrow keys were a secondary binding that nothing advertised — the legend has
 * only ever said A/D and W/S — and they are precisely the keys that browser
 * chrome, embedded preview panes and host UI use for their own navigation. So
 * they are the keys most likely to have their keyup swallowed by something else
 * taking focus mid-press, and the only ones a player can have "held" without
 * ever having meant to touch them.
 *
 * Removing them means the only keys that can stick are keys the player is
 * deliberately holding, and a key you are holding is one you can let go of.
 */
const RIGHT = ["KeyD"];
const LEFT = ["KeyA"];
const UP = ["KeyW"];
const DOWN = ["KeyS"];
const ROLL_RIGHT = ["KeyE"];
const ROLL_LEFT = ["KeyQ"];
const AXIS_KEYS = [...RIGHT, ...LEFT, ...UP, ...DOWN];
const WATCHED = [...AXIS_KEYS, ...ROLL_RIGHT, ...ROLL_LEFT];

/** How fast the keyboard axes ramp toward their target, in 1/s. */
export const KEYBOARD = { ramp: 6 };

/**
 * Stage 04.4 — pitch convention.
 *
 * Two real conventions exist and neither is wrong:
 *
 *   NOSE_UP    W pitches up      what a game does, and what a first-time
 *                                player expects from WASD
 *   NOSE_DOWN  W pitches down    what a control column does — push forward to
 *                                descend — and what anyone who has flown a sim
 *                                will reach for without thinking
 *
 * The default is NOSE_UP because the first thing this build has to survive is
 * someone being handed it cold. The toggle exists because the second thing it
 * has to survive is someone who already knows how to fly, for whom the default
 * is actively wrong: they will pull to climb and hit the sea.
 *
 * It is applied at the input boundary and nowhere else — one sign flip on
 * `input.y` — so the flight model, both flight modes, the HUD and the vapor FX
 * all see one consistent axis and none of them know the setting exists. A
 * convention is not a physics change.
 */
export const PitchMode = { NOSE_UP: "NOSE UP", NOSE_DOWN: "NOSE DOWN" };

/** Pure: the pitch axis under a convention. */
export function applyPitchMode(y, inverted) {
  return inverted ? -y : y;
}

export function createInput(target = window) {
  const input = { x: 0, y: 0, roll: 0, throttle: 0, source: "keyboard" };
  const keys = new Set();
  // Pointer position in client pixels. Seeded at the centre so an untouched mouse
  // commands nothing before its first move.
  const pointer = { x: -1, y: -1, seen: false };
  let pointerEnabled = true;
  // Physical left-hand modifiers only, tracked by event.code so the right-hand
  // Shift/Ctrl stay free for browser use. Separate from `keys` because they are
  // not flight axes and must never gate W/A/S/D.
  const mods = { shiftLeft: false, controlLeft: false };
  const kb = { x: 0, y: 0 };
  const doc = typeof document === "undefined" ? null : document;
  /**
   * Whether this document has ever held focus. The stuck-key guard below is only
   * armed once it has: a page in a background preview or a synthetic test
   * harness never has focus, and enforcing the rule there would clear keys that
   * were legitimately dispatched.
   */
  let seenFocus = false;
  const resetHandlers = [];
  const modeHandlers = [];
  const weaponHandlers = [];
  const pitchHandlers = [];
  /**
   * A PREFERENCE, not transient state: it survives reset, a mission restart and
   * a flight-mode change, exactly as the selected weapon does. Nothing about
   * putting the aircraft back should change which way the controls work.
   */
  let pitchInverted = false;

  // Latched one-shot: set on keydown, cleared by takeRoll(). A discrete
  // maneuver request must not be a held axis.
  let rollRequest = 0;
  /**
   * Stage 05.1 — flares are a latch, not an axis, and they now have two sources:
   * `Z` and the middle mouse button. Both feed one latch so nothing downstream
   * learns there are two.
   */
  let flareRequest = false;
  // Wheel-charged throttle, decaying toward zero each frame.
  let wheelThrottle = 0;
  // Same pattern for weapon release: a trigger is an event, never an axis, so
  // holding the button cannot spam the rail.
  let fireRequest = false;
  /**
   * The cannon needs the *held* state as well, because a gun burst is a duration
   * and the missile release is an instant. Both come off the same physical
   * trigger — `takeFire()` is the latched one-shot, `input.trigger` the
   * continuous read.
   */
  let triggerDown = false;
  input.trigger = false;

  const onKey = (event, down) => {
    if (event.code === "ShiftLeft") mods.shiftLeft = down;
    if (event.code === "ControlLeft") {
      mods.controlLeft = down;
      // Narrow: only the bare lever key, so Ctrl+R / Ctrl+T still reach the browser.
      if (down) event.preventDefault();
    }

    const code = event.code || "";
    if (WATCHED.includes(code)) {
      event.preventDefault();
      if (down) keys.add(code);
      else keys.delete(code);
    }
    if (!down) return; // everything below is a press
    const once = !event.repeat;
    if (code === "KeyR") resetHandlers.forEach((fn) => fn());
    if (code === "KeyM" && once) modeHandlers.forEach((fn) => fn());
    if (code === "KeyX" && once) weaponHandlers.forEach((fn) => fn());
    if (code === "KeyZ" && once) flareRequest = true;
    // Pitch convention. Its own key, because it is a setting rather than an
    // action and must never be reachable by accident mid-manoeuvre.
    if (code === "KeyI" && once) input.togglePitchMode();
    // Manual escape hatch for a lost keyup, without restarting the mission.
    if (code === "KeyC" && once) dropHeld();
    if (code === "Space") {
      event.preventDefault();
      if (!once) return;
      // Space rolls whichever way the stick is leaning, or whichever way Q/E is
      // already rolling. All three are +1 = right.
      const lean = input.roll !== 0 ? input.roll : input.x;
      rollRequest = lean < -0.05 ? -1 : 1;
    }
  };

  /**
   * The trigger is a separate handler because it needs the RELEASE too, and
   * losing that release is the same class of bug: a gun that keeps firing on its
   * own. Keyed on `code` for the same reason.
   */
  const onTriggerKey = (event, down) => {
    const code = event.code || "";
    if (code !== "KeyF" && code !== "Enter" && code !== "NumpadEnter") return;
    if (down && !event.repeat) fireRequest = true;
    triggerDown = down;
    input.trigger = down;
  };

  target.addEventListener("keydown", (e) => {
    onKey(e, true);
    onTriggerKey(e, true);
  });
  target.addEventListener("keyup", (e) => {
    onKey(e, false);
    onTriggerKey(e, false);
  });

  /**
   * Every way a held key can stop being held without a keyup arriving. Any one
   * of these leaves a stuck axis at full deflection, so they all clear.
   */
  const dropHeld = () => {
    keys.clear();
    mods.shiftLeft = mods.controlLeft = false;
    triggerDown = false;
    input.trigger = false;
  };
  target.addEventListener("blur", dropHeld);
  if (typeof document !== "undefined") {
    // Tab switch / minimise: the keyup lands on whatever has focus next.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) dropHeld();
    });
  }
  target.addEventListener("pagehide", dropHeld);
  // A context menu swallows the keyup of anything held when it opens — and with
  // the right button now bound to the weapon switch, the menu must not appear at
  // all. Both concerns, one listener.
  target.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    dropHeld();
  });

  /**
   * The wheel is the throttle. Up is more power, which matches every other
   * scroll-to-increase control a player has used.
   */
  target.addEventListener(
    "wheel",
    (event) => {
      if (!event.deltaY) return;
      event.preventDefault();
      wheelThrottle = clamp(wheelThrottle - Math.sign(event.deltaY) * MOUSE.wheelStep, -1, 1);
    },
    { passive: false }
  );

  /**
   * The left mouse button is the trigger, and that is the mouse's entire role.
   * There is deliberately no pointermove listener in this file: the flight axes
   * cannot be reached from the pointer at all, so no amount of mouse movement,
   * window-edge pushing, cursor parking or lost pointerleave can produce a bank
   * command.
   */
  target.addEventListener("pointerdown", (event) => {
    if (event.button === 0) {
      fireRequest = true;
      triggerDown = true;
      input.trigger = true;
      return;
    }
    // Stage 05.1 — the other two buttons. Both are discrete actions, which is why
    // they are buttons rather than axes: a weapon switch and a flare burst are
    // events, and holding either should do nothing extra.
    if (event.button === 1) {
      // Middle button: flares. preventDefault stops the browser's autoscroll.
      event.preventDefault();
      flareRequest = true;
    } else if (event.button === 2) {
      event.preventDefault();
      weaponHandlers.forEach((fn) => fn());
    }
  });  // Steering. Position only — no deltas, no origin tracking, no claim state. The
  // centre is the aircraft and never moves, which is the whole reason this is
  // safe where the Stage 03.2 design was not.
  target.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.seen = true;
  });
  // Leaving the window is releasing the stick: there is no off-screen deflection.
  target.addEventListener("pointerleave", () => {
    pointer.seen = false;
  });

  const releaseTrigger = () => {
    triggerDown = false;
    input.trigger = false;
  };
  target.addEventListener("pointerup", releaseTrigger);
  target.addEventListener("pointercancel", releaseTrigger);

  /** Physical keys currently held, for the dev rail. A stuck axis is visible. */
  input.heldKeys = () => [...keys];
  /** Manual escape hatch for a lost keyup, without resetting the flight. */
  input.clearHeldKeys = dropHeld;

  const axis = (pos, neg) =>
    (pos.some((k) => keys.has(k)) ? 1 : 0) - (neg.some((k) => keys.has(k)) ? 1 : 0);

  /** Keyboard ramps toward its target so key release eases back to zero. */
  input.update = (dt) => {
    input.trigger = triggerDown;
    /**
     * A key cannot be held by a player who is not typing at this document. The
     * `blur` listener above is the event-driven version of this and it is not
     * enough on its own: a keydown that arrives just as focus moves away leaves
     * the key latched, its keyup delivered to whatever took focus, and the axis
     * pinned at full deflection with nothing left to release it. Polling closes
     * that race, and it can never drop a key the player is actually holding —
     * holding one requires focus.
     */
    if (doc && doc.hasFocus) {
      if (doc.hasFocus()) seenFocus = true;
      else if (seenFocus && (keys.size || triggerDown)) dropHeld();
    }
    // Undamped: the throttle's own change rate is the inertia here. The wheel
    // charge decays, so a notch is a nudge rather than a held key.
    const keyThrottle = (mods.shiftLeft ? 1 : 0) - (mods.controlLeft ? 1 : 0);
    input.throttle = combineAxis(keyThrottle, wheelThrottle);
    wheelThrottle = damp(wheelThrottle, 0, MOUSE.wheelDecay, dt);
    // Also undamped: the flight model integrates this as a rate, and ramping it
    // here would make the angle you stop on depend on how long you held the key.
    input.roll = axis(ROLL_RIGHT, ROLL_LEFT);

    kb.x = damp(kb.x, axis(RIGHT, LEFT), KEYBOARD.ramp, dt);
    kb.y = damp(kb.y, axis(UP, DOWN), KEYBOARD.ramp, dt);

    // Pointer and keyboard both feed the same two axes; whichever is asking for
    // more wins, so a key press always overrides a resting cursor and neither
    // needs to know the other exists.
    const ps =
      pointerEnabled && pointer.seen
        ? pointerStick(pointer.x, pointer.y, window.innerWidth, window.innerHeight)
        : { x: 0, y: 0 };
    const rawX = combineAxis(clamp(kb.x, -1, 1), ps.x);
    const rawY = combineAxis(clamp(kb.y, -1, 1), ps.y);
    input.source = Math.abs(ps.x) > Math.abs(kb.x) || Math.abs(ps.y) > Math.abs(kb.y) ? "pointer" : "keyboard";

    input.x = rawX;
    // The one place the pitch convention is applied — so it covers the pointer too.
    input.y = applyPitchMode(rawY, pitchInverted);
    return input;
  };

  /** The crash and the launch script disable steering without clearing state. */
  input.setPointerEnabled = (on) => {
    pointerEnabled = !!on;
    return pointerEnabled;
  };
  input.pointerDeflection = () => (pointer.seen ? pointerStick(pointer.x, pointer.y, window.innerWidth, window.innerHeight) : { x: 0, y: 0 });

  input.setPitchInverted = (on) => {
    pitchInverted = !!on;
    pitchHandlers.forEach((fn) => fn(pitchInverted, input.pitchMode()));
    return pitchInverted;
  };
  input.togglePitchMode = () => input.setPitchInverted(!pitchInverted);
  input.pitchInverted = () => pitchInverted;
  /** The convention's name, for the HUD and the rail. */
  input.pitchMode = () => (pitchInverted ? PitchMode.NOSE_DOWN : PitchMode.NOSE_UP);
  input.onPitchModeToggle = (fn) => pitchHandlers.push(fn);

  /** Space only. Returns -1, 1, or 0, consuming the request. */
  input.takeRoll = () => {
    const r = rollRequest;
    rollRequest = 0;
    return r;
  };

  /** True once per trigger press, consumed by the caller. */
  input.takeFire = () => {
    const f = fireRequest;
    fireRequest = false;
    return f;
  };

  /** True once per flare request, from either source. */
  input.takeFlare = () => {
    const f = flareRequest;
    flareRequest = false;
    return f;
  };

  input.onReset = (fn) => resetHandlers.push(fn);
  input.onModeToggle = (fn) => modeHandlers.push(fn);
  input.onWeaponCycle = (fn) => weaponHandlers.push(fn);

  /**
   * Drop every held key and in-flight axis value. Called on reset and mode
   * change: a key still down would otherwise command the fresh state on frame
   * one, and the ramped keyboard axes would carry the old attitude in with them.
   */
  input.clearTransient = () => {
    keys.clear();
    mods.shiftLeft = mods.controlLeft = false;
    kb.x = kb.y = 0;
    input.x = input.y = input.roll = input.throttle = 0;
    rollRequest = 0;
    fireRequest = false;
    flareRequest = false;
    wheelThrottle = 0;
    triggerDown = false;
    input.trigger = false;
    // The pointer is NOT cleared: it is a physical position, not a latch, and
    // pretending the player moved their hand would be a lie. It re-reads on the
    // next move; until then a fresh aircraft holds its attitude.
    pointer.seen = false;
  };

  return input;
}
