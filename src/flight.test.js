// Operation Vector — the assertion suite. CLAUDE.md §18.
//
// Plain assertions: a check() helper and a pass/fail count. No framework, no
// runner, no async. Two harnesses load this one file:
//
//   tests.html            prints the count in the browser
//   spec/vector.test.ts   fails `pnpm check` (and CI) if anything is red
//
// One suite, two harnesses, so the browser count and the repository gate can
// never disagree about what passed.
//
// This module MUST NOT import three.js -- it runs headless under vitest.

import {
  BANK_MAX,
  BURNER_LEVER,
  PITCH_MAX,
  SPEED_MAX,
  SPEED_MIN,
  TURN_G,
  TURN_RADIUS_REF,
  applyFlightState,
  captureFlightState,
  commandedSpeed,
  createFlightState,
  isAfterburner,
  leverFor,
  quatForward,
  quatFromEulerYXZ,
  quatIdentity,
  quatMultiply,
  quatToEulerYXZ,
  quatUp,
  setMode,
  updateFlight,
  wrapAngle,
} from "./flight.js";
import {
  POINTER_DEAD_ZONE,
  POINTER_FULL_STICK,
  POINTER_GAIN,
  createInput,
  pointerStick,
} from "./input.js";
import {
  FOV_VERTICAL_MAX,
  REF_ASPECT,
  horizontalFov,
  widenForAspect,
} from "./framing.js";
import { buildTerrainIndex, createPhysics, heightAtIndex } from "./physics.js";
import { createDevelopmentRecovery, createNullResponse } from "./collision.js";

// ── harness ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let failures = [];

export function check(name, pass, detail) {
  if (pass) passed++;
  else {
    failed++;
    failures.push({ name, detail });
  }
  return pass;
}

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// A neutral stick. Every test that does not care about an axis passes this,
// so a new axis added later defaults to "not touched" everywhere at once.
const NEUTRAL = { x: 0, y: 0, roll: 0, throttle: 0 };
const stick = (over = {}) => ({ ...NEUTRAL, ...over });

// Step the model at a fixed rate. Real dt is clamped in main.js; tests use a
// fixed step so a result is reproducible rather than machine-dependent.
function fly(state, input, seconds, hz = 60) {
  const dt = 1 / hz;
  for (let t = 0; t < seconds; t += dt) updateFlight(state, input, dt);
  return state;
}

// ── input harness ──────────────────────────────────────────────────────────
// A test double must match the real thing (§17.13), so this dispatches real
// Events through a real EventTarget rather than calling the handlers
// directly -- a double that invoked handlers itself would never exercise the
// registration, which is half of what these tests are about.

class KeyEvent extends Event {
  constructor(type, code, key) {
    super(type);
    this.code = code;
    this.key = key;
  }
}

class PointerEvt extends Event {
  constructor(type, opts) {
    super(type);
    const o = opts || {};
    this.clientX = o.x || 0;
    this.clientY = o.y || 0;
    this.button = o.button || 0;
    this.deltaY = o.deltaY || 0;
    this.view = { innerWidth: o.w || VW, innerHeight: o.h || VH };
  }
}

// The desktop marking viewport, used as the default frame for pointer tests.
const VW = 1920;
const VH = 1080;
const MID_X = VW / 2;
const MID_Y = VH / 2;

function inputHarness() {
  const target = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const input = createInput({ target, doc });
  return {
    input,
    target,
    doc,
    down: (code, key) => target.dispatchEvent(new KeyEvent("keydown", code, key ?? code)),
    up: (code, key) => target.dispatchEvent(new KeyEvent("keyup", code, key ?? code)),
    move: (x, y, w, h) =>
      target.dispatchEvent(new PointerEvt("pointermove", { x, y, w, h })),
    press: (button) => target.dispatchEvent(new PointerEvt("pointerdown", { button })),
    release: (button) => target.dispatchEvent(new PointerEvt("pointerup", { button })),
    wheel: (deltaY) => target.dispatchEvent(new PointerEvt("wheel", { deltaY })),
    leave: () => target.dispatchEvent(new Event("pointerleave")),
    tick: (seconds, hz = 60) => {
      const dt = 1 / hz;
      let axes;
      for (let t = 0; t < seconds; t += dt) axes = input.update(dt);
      return axes ?? input.update(dt);
    },
  };
}

// ── stage 1: flight envelope ───────────────────────────────────────────────

function testEnvelope() {
  const up = createFlightState();
  fly(up, stick({ throttle: 1 }), 30);
  check(
    "speed clamps at the maximum",
    up.speed <= SPEED_MAX + 1e-9 && up.speed > SPEED_MAX - 1,
    `speed ${up.speed}`,
  );

  const down = createFlightState();
  fly(down, stick({ throttle: -1 }), 30);
  check(
    "speed clamps at the minimum",
    down.speed >= SPEED_MIN - 1e-9 && down.speed < SPEED_MIN + 1,
    `speed ${down.speed}`,
  );

  const left = createFlightState();
  fly(left, stick({ x: 1 }), 20);
  check(
    "bank clamps at the left limit",
    left.bank <= BANK_MAX + 1e-9 && left.bank > BANK_MAX - 1e-3,
    `bank ${left.bank} limit ${BANK_MAX}`,
  );

  const right = createFlightState();
  fly(right, stick({ x: -1 }), 20);
  check(
    "bank clamps at the right limit",
    right.bank >= -BANK_MAX - 1e-9 && right.bank < -BANK_MAX + 1e-3,
    `bank ${right.bank}`,
  );

  // Q/E are a raw rate with no self-centring target, so they are the axis
  // that can actually run past the limit if the clamp is missing.
  const rolled = createFlightState();
  fly(rolled, stick({ roll: 1 }), 20);
  check(
    "roll rate cannot drive bank past the limit",
    rolled.bank <= BANK_MAX + 1e-9,
    `bank ${rolled.bank}`,
  );

  const pitched = createFlightState();
  fly(pitched, stick({ y: 1 }), 20);
  check(
    "pitch clamps at its limit",
    pitched.pitch <= PITCH_MAX + 1e-9 && pitched.pitch > PITCH_MAX - 1e-3,
    `pitch ${pitched.pitch}`,
  );

  check(
    "the aircraft cannot depart in ASSISTED",
    Math.abs(pitched.bank) <= BANK_MAX && Math.abs(pitched.pitch) <= PITCH_MAX,
  );
}

// ── stage 1: bank drives heading ───────────────────────────────────────────

function testTurn() {
  // Positive bank is LEFT and increasing heading is LEFT, and the two agree
  // on purpose -- that agreement is what keeps a minus sign out of the
  // coordinated-turn term. Assert both halves, or a later edit that flips one
  // convention will look correct in isolation.
  const state = createFlightState();
  const before = state.heading;
  fly(state, stick({ x: 1 }), 2);
  check(
    "a held left bank increases heading",
    state.heading > before,
    `heading ${before} -> ${state.heading}`,
  );

  const right = createFlightState();
  fly(right, stick({ x: -1 }), 2);
  check(
    "a held right bank decreases heading",
    right.heading < 0,
    `heading ${right.heading}`,
  );

  const level = createFlightState();
  fly(level, stick(), 3);
  check(
    "zero bank produces no heading change",
    near(level.heading, 0, 1e-9),
    `heading ${level.heading}`,
  );

  // Increasing heading must actually point the nose left, i.e. toward -X.
  const f0 = quatForward(quatFromEulerYXZ(0, 0, 0));
  const f1 = quatForward(quatFromEulerYXZ(0.3, 0, 0));
  check(
    "increasing heading swings the nose toward -X (left)",
    f1.x < f0.x,
    `x ${f0.x} -> ${f1.x}`,
  );

  // The fairness claim of §14 is stated in turn radii, so assert the radius
  // the arcade gravity was derived to produce rather than the constant.
  const radius =
    (SPEED_MAX * SPEED_MAX) / (TURN_G * Math.tan(BANK_MAX));
  check(
    "turn radius at the top of the envelope matches the derived reference",
    near(radius, TURN_RADIUS_REF, 1e-6),
    `radius ${radius}`,
  );
  const cruiseRadius = (170 * 170) / (TURN_G * Math.tan(BANK_MAX));
  check(
    "turning tightens as speed falls",
    cruiseRadius < radius,
    `cruise ${cruiseRadius} vs max ${radius}`,
  );
}

// ── stage 1: the throttle is a lever ───────────────────────────────────────

function testThrottle() {
  const state = createFlightState();
  fly(state, stick({ throttle: 1 }), 0.5);
  const held = state.throttle;
  check("pushing the lever moves it", held > leverFor(170), `lever ${held}`);

  // The whole point: releasing the key must NOT let it fall back.
  fly(state, stick({ throttle: 0 }), 3);
  check(
    "releasing the throttle leaves the lever where it is",
    near(state.throttle, held, 1e-12),
    `lever ${held} -> ${state.throttle}`,
  );

  check("lever 0 commands the minimum", near(commandedSpeed(0), SPEED_MIN));
  check("lever 1 commands the maximum", near(commandedSpeed(1), SPEED_MAX));
  check(
    "leverFor inverts commandedSpeed",
    near(commandedSpeed(leverFor(203)), 203, 1e-9),
  );

  check("afterburner is off below the top 15%", !isAfterburner(BURNER_LEVER));
  check("afterburner is off at the boundary", !isAfterburner(0.85));
  check("afterburner is on above it", isAfterburner(0.86));
  check("afterburner is on at full lever", isAfterburner(1));

  const burner = createFlightState();
  fly(burner, stick({ throttle: 1 }), 10);
  check(
    "a full lever lights the burner on the state",
    burner.afterburner === true,
    `lever ${burner.throttle}`,
  );
}

// ── stage 1: sink ──────────────────────────────────────────────────────────

function testSink() {
  const level = createFlightState();
  const startY = level.position.y;
  fly(level, stick(), 4);
  check(
    "level flight holds altitude",
    near(level.position.y, startY, 1e-6),
    `alt ${startY} -> ${level.position.y}`,
  );
  check("level flight has no sink", near(level.sink, 0, 1e-9), `sink ${level.sink}`);

  const banked = createFlightState();
  const bankedStart = banked.position.y;
  fly(banked, stick({ x: 1 }), 4);
  check(
    "banking costs altitude",
    banked.position.y < bankedStart - 10,
    `alt ${bankedStart} -> ${banked.position.y}`,
  );
  check("banking produces sink", banked.sink > 0, `sink ${banked.sink}`);

  // Sink must rise with bank angle, or a shallow turn would cost as much as a
  // hard one and there would be nothing to learn.
  const shallow = createFlightState();
  fly(shallow, stick({ x: 0.35 }), 4);
  check(
    "a harder bank sinks faster",
    banked.sink > shallow.sink && shallow.sink > 0,
    `hard ${banked.sink} vs shallow ${shallow.sink}`,
  );
}

// ── stage 1: snapshots ─────────────────────────────────────────────────────

function testSnapshots() {
  const state = createFlightState();
  fly(state, stick({ x: 0.6, y: 0.3, throttle: 1 }), 2.5);

  const snap = captureFlightState(state);
  const before = JSON.stringify(state);
  applyFlightState(state, snap);
  check(
    "applying a fresh snapshot is a no-op",
    JSON.stringify(state) === before,
    "round trip changed the state",
  );

  // A snapshot that aliases the live state records nothing -- the next frame
  // would edit the history. This is the failure the deep copy exists for.
  fly(state, stick({ x: -1 }), 2);
  check(
    "a snapshot does not alias the live position",
    snap.position.x !== state.position.x,
    "snapshot moved with the aircraft",
  );
  check(
    "a snapshot does not alias the live quaternion",
    snap.quat.y !== state.quat.y,
    "snapshot quaternion moved with the aircraft",
  );

  // Restoring must actually rewind, which is what stage 3 rewinds into.
  applyFlightState(state, snap);
  check(
    "restoring a snapshot rewinds the position",
    near(state.position.x, snap.position.x, 1e-12),
  );
  check(
    "restoring a snapshot rewinds the attitude",
    near(state.bank, snap.bank, 1e-12) && near(state.heading, snap.heading, 1e-12),
  );
}

// ── stage 1: the quaternion contract ───────────────────────────────────────

function testQuaternion() {
  const state = createFlightState();
  fly(state, stick({ x: 0.5, y: 0.4 }), 1.5);

  const q = state.quat;
  check(
    "quat is a plain record with x, y, z, w",
    typeof q === "object" &&
      typeof q.x === "number" &&
      typeof q.y === "number" &&
      typeof q.z === "number" &&
      typeof q.w === "number",
  );
  // §17.1: if a THREE.Quaternion ever leaks in here, this is what catches it.
  check(
    "quat is not a THREE.Quaternion",
    typeof q.copy === "undefined" && typeof q.setFromEuler === "undefined",
    "quat has THREE methods on it",
  );
  check(
    "quat is normalised",
    near(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-9),
  );

  // Forward derived from the quaternion must match the heading convention
  // exactly, because every bearing, break direction and spawn offset in later
  // stages is written against (-sin h, -cos h).
  for (const h of [0, 0.7, -1.2, 2.9, Math.PI]) {
    const f = quatForward(quatFromEulerYXZ(h, 0, 0));
    check(
      `forward at heading ${h} matches (-sin h, -cos h)`,
      near(f.x, -Math.sin(h), 1e-9) && near(f.z, -Math.cos(h), 1e-9),
      `got ${f.x}, ${f.z}`,
    );
  }

  check(
    "heading 0 points at -Z",
    (() => {
      const f = quatForward(quatIdentity());
      return near(f.x, 0) && near(f.y, 0) && near(f.z, -1);
    })(),
  );

  const upLevel = quatUp(quatFromEulerYXZ(0, 0, 0));
  check("level up-vector is +Y", near(upLevel.y, 1, 1e-9));

  // Positive bank must tilt the up-vector left (-X), matching the sign note
  // in input.js. If this flips, the turn direction silently inverts.
  const upBanked = quatUp(quatFromEulerYXZ(0, 0, 0.5));
  check(
    "positive bank tilts the up-vector toward -X (left wing down)",
    upBanked.x < 0,
    `up.x ${upBanked.x}`,
  );

  const nosed = quatForward(quatFromEulerYXZ(0, 0.4, 0));
  check("positive pitch raises the nose", nosed.y > 0, `f.y ${nosed.y}`);

  check(
    "identity is the multiplicative identity",
    (() => {
      const a = quatFromEulerYXZ(0.3, -0.2, 0.9);
      const r = quatMultiply(a, quatIdentity());
      return near(r.x, a.x) && near(r.y, a.y) && near(r.z, a.z) && near(r.w, a.w);
    })(),
  );

  check("wrapAngle keeps the range", near(wrapAngle(Math.PI * 3), -Math.PI, 1e-9));
  check("wrapAngle leaves a small angle alone", near(wrapAngle(0.4), 0.4));
}

// ── stage 1: input ─────────────────────────────────────────────────────────

function testInputRamping() {
  const h = inputHarness();
  h.down("KeyW");
  check(
    "an axis reaches full deflection in about a second",
    h.tick(1).y > 0.99,
    `y ${h.input.axes.y}`,
  );
  // It must arrive EXACTLY, not asymptotically: a residual command is a slow
  // phantom turn, which is the failure the snap in input.js exists for.
  check(
    "a held axis settles exactly on full deflection",
    h.tick(0.5).y === 1,
    `y ${h.input.axes.y}`,
  );

  h.up("KeyW");
  const released = h.tick(1.5);
  check("an axis returns to exactly zero on release", released.y === 0, `y ${released.y}`);

  // Ramping, not snapping: a single frame must not reach full deflection.
  const h2 = inputHarness();
  h2.down("KeyA");
  const oneFrame = h2.input.update(1 / 60);
  check(
    "one frame does not snap the axis to full",
    oneFrame.x > 0 && oneFrame.x < 0.2,
    `x ${oneFrame.x}`,
  );

  // Opposing keys cancel -- otherwise holding both leaves a phantom command.
  const h3 = inputHarness();
  h3.down("KeyA");
  h3.down("KeyD");
  const both = h3.tick(1);
  check("opposing bank keys cancel", both.x === 0, `x ${both.x}`);

  // The throttle is a rate passed straight through, not a ramped axis.
  const h4 = inputHarness();
  h4.down("ShiftLeft");
  check("throttle input is an unramped rate", h4.tick(0.05).throttle === 1);
  h4.up("ShiftLeft");
  check("releasing the throttle key zeroes the rate", h4.tick(0.05).throttle === 0);
}

function testEventCodeRobustness() {
  // §17.5, the failure this rule exists for: `key` differs between the
  // keydown and the keyup of one physical press (a modifier, caps lock, a
  // layout switch, an IME). Tracked by `key`, the keyup deletes an entry that
  // is not there and the axis sticks at full deflection forever.
  const h = inputHarness();
  h.down("KeyW", "w");
  h.tick(1);
  h.up("KeyW", "W"); // same physical key, different `key` value
  const axes = h.tick(1.5);
  check(
    "a keyup whose key differs from its keydown still releases the axis",
    axes.y === 0 && h.input.heldKeys().length === 0,
    `y ${axes.y} held ${h.input.heldKeys().join(",")}`,
  );

  // An event with no code at all must not crash or register anything.
  const h2 = inputHarness();
  h2.target.dispatchEvent(new KeyEvent("keydown", undefined, "w"));
  check("a keydown with no code registers nothing", h2.input.heldKeys().length === 0);

  // Arrow keys are not flight axes: browser and embed chrome steal them, so
  // their keyup goes missing and the axis sticks.
  const h3 = inputHarness();
  h3.down("ArrowUp");
  h3.down("ArrowLeft");
  const arrows = h3.tick(1);
  check(
    "arrow keys are not flight axes",
    arrows.x === 0 && arrows.y === 0 && arrows.roll === 0,
    `x ${arrows.x} y ${arrows.y}`,
  );
}

function testStuckKeyClearing() {
  for (const [label, fire] of [
    ["blur", (h) => h.target.dispatchEvent(new Event("blur"))],
    ["pagehide", (h) => h.target.dispatchEvent(new Event("pagehide"))],
    ["contextmenu", (h) => h.target.dispatchEvent(new Event("contextmenu"))],
    [
      "visibilitychange to hidden",
      (h) => {
        h.doc.visibilityState = "hidden";
        h.doc.dispatchEvent(new Event("visibilitychange"));
      },
    ],
    ["the C key", (h) => h.down("KeyC")],
  ]) {
    const h = inputHarness();
    h.down("KeyW");
    h.down("KeyA");
    h.tick(1);
    fire(h);
    const axes = h.input.update(1 / 60);
    check(
      `${label} clears held keys`,
      h.input.heldKeys().length === 0,
      `held ${h.input.heldKeys().join(",")}`,
    );
    check(
      `${label} zeroes the axes`,
      axes.x === 0 && axes.y === 0,
      `x ${axes.x} y ${axes.y}`,
    );
  }

  // A visibilitychange back to visible must NOT clear -- otherwise returning
  // to the tab drops a key the player is still holding.
  const h = inputHarness();
  h.down("KeyW");
  h.tick(1);
  h.doc.visibilityState = "visible";
  h.doc.dispatchEvent(new Event("visibilitychange"));
  check(
    "becoming visible again does not clear held keys",
    h.input.heldKeys().length === 1,
  );
}

// ── stage 1: pointer steering (§7, §17.6) ─────────────────────────────────
//
// This replaces an earlier suite that asserted the OPPOSITE invariant -- that
// no pointer listener existed at all. §17.6 now reads the other way: pointer
// steering is positional from a fixed, visible centre, and it is the only
// self-teaching control the game has, which is what makes the
// no-instructions rule satisfiable. The old checks are deleted rather than
// left passing against a rule that no longer exists (§18: a suite that only
// grows is not being maintained).

function testPointerStickGeometry() {
  const at = (x, y) => pointerStick(x, y, VW, VH);

  check(
    "dead centre commands nothing",
    at(MID_X, MID_Y).x === 0 && at(MID_X, MID_Y).y === 0,
  );

  // The dead zone is the whole reason this control has a neutral. Without one
  // there is no way to let go, which is the defect that made the earlier
  // relative-origin design unfixable.
  const justInside = at(MID_X + MID_X * POINTER_DEAD_ZONE * 0.9, MID_Y);
  check(
    "inside the dead zone commands nothing",
    justInside.x === 0 && justInside.y === 0,
    JSON.stringify(justInside),
  );
  const justOutside = at(MID_X + MID_X * POINTER_DEAD_ZONE * 1.1, MID_Y);
  check(
    "just outside the dead zone commands a little",
    Math.abs(justOutside.x) > 0 && Math.abs(justOutside.x) < 0.2,
    JSON.stringify(justOutside),
  );

  const full = at(MID_X + MID_X * POINTER_FULL_STICK, MID_Y);
  check(
    "the full-stick radius reaches the gain",
    near(Math.abs(full.x), POINTER_GAIN, 1e-9),
    String(full.x),
  );
  const past = at(VW, MID_Y);
  check(
    "past full stick is clamped to the gain, not extrapolated",
    near(Math.abs(past.x), POINTER_GAIN, 1e-9),
    String(past.x),
  );
  const corner = at(VW, 0);
  check(
    "a screen corner is still clamped to the gain",
    near(Math.hypot(corner.x, corner.y), POINTER_GAIN, 1e-9),
    JSON.stringify(corner),
  );

  // Directions. Cursor right banks RIGHT, which is negative here; cursor up
  // pitches the nose UP.
  check("cursor right banks right (negative x)", at(VW * 0.9, MID_Y).x < 0);
  check("cursor left banks left (positive x)", at(VW * 0.1, MID_Y).x > 0);
  check("cursor up pitches the nose up", at(MID_X, VH * 0.1).y > 0);
  check("cursor down pitches the nose down", at(MID_X, VH * 0.9).y < 0);

  const left = at(MID_X - 400, MID_Y);
  const right = at(MID_X + 400, MID_Y);
  check(
    "deflection is symmetric about the centre",
    near(left.x, -right.x, 1e-12) && near(left.y, right.y, 1e-12),
  );

  // Monotonic between the dead zone and full stick, or the control has a flat
  // spot the player can feel but not see.
  let previous = -1;
  let monotonic = true;
  for (let f = POINTER_DEAD_ZONE; f <= POINTER_FULL_STICK; f += 0.02) {
    const mag = Math.abs(at(MID_X + MID_X * f, MID_Y).x);
    if (mag < previous - 1e-12) monotonic = false;
    previous = mag;
  }
  check("deflection grows monotonically out to full stick", monotonic);

  // Degenerate viewports must not produce NaN and poison the flight model.
  const degenerate = [
    [0, 1080],
    [1920, 0],
    [0, 0],
  ];
  for (const [w, h] of degenerate) {
    const s = pointerStick(100, 100, w, h);
    check(
      `a ${w}x${h} viewport yields zero, not NaN`,
      s.x === 0 && s.y === 0,
      JSON.stringify(s),
    );
  }

  // Both marking viewports: full stick is the same FRACTION of the frame, so
  // the control feels the same at 1920x1080 and at 390x844.
  const phone = pointerStick(195 + 195 * POINTER_FULL_STICK, 422, 390, 844);
  check(
    "full stick is the same fraction of the frame on the phone viewport",
    near(Math.abs(phone.x), POINTER_GAIN, 1e-9),
    String(phone.x),
  );
}

function testPointerCentreIsNotSynthesised() {
  // §17.6 and §17.14: assert the MECHANISM. The centre is the screen centre,
  // permanently -- never a claimed origin derived from relative movement. The
  // observable consequence is that the command depends ONLY on where the
  // cursor is, never on how it got there. A drifting origin gives different
  // answers for the same final position after different paths.
  const a = inputHarness();
  const b = inputHarness();

  const wander = [
    [10, 10],
    [1900, 1000],
    [960, 20],
    [40, 700],
    [1500, 900],
  ];
  for (const [x, y] of wander) {
    a.move(x, y);
    a.tick(0.2);
  }
  a.move(1200, 400);
  a.tick(0.2);

  b.move(1200, 400);
  b.tick(0.2);

  check(
    "the command depends only on cursor POSITION, not on the path taken",
    near(a.input.axes.x, b.input.axes.x, 1e-12) &&
      near(a.input.axes.y, b.input.axes.y, 1e-12),
    `wandered ${a.input.axes.x},${a.input.axes.y} vs direct ${b.input.axes.x},${b.input.axes.y}`,
  );

  // Returning to the centre must return to neutral -- there is no accumulated
  // offset anywhere for the aircraft to keep flying against.
  a.move(MID_X, MID_Y);
  a.tick(0.5);
  check(
    "returning the cursor to the centre returns to neutral",
    a.input.axes.x === 0 && a.input.axes.y === 0,
    `${a.input.axes.x},${a.input.axes.y}`,
  );

  // A parked off-centre cursor KEEPS commanding. That is correct rather than a
  // bug: it is a stick held over, and it looks like one.
  b.tick(3);
  check(
    "a parked off-centre cursor keeps commanding",
    Math.abs(b.input.axes.x) > 0,
    String(b.input.axes.x),
  );
}

function testPointerAndKeyboardCombine() {
  // "Whichever axis is asking for more" (§7), so a held key always overrides a
  // resting cursor and neither input needs to know the other exists.
  const h = inputHarness();
  h.move(MID_X + MID_X * 0.16, MID_Y);
  h.tick(0.3);
  const gentle = Math.abs(h.input.axes.x);
  check(
    "a gentle cursor deflection commands a little",
    gentle > 0 && gentle < 0.4,
    String(gentle),
  );

  h.down("KeyA");
  const combined = h.tick(1.5);
  check("a held key overrides a resting cursor", combined.x === 1, String(combined.x));

  h.up("KeyA");
  const released = h.tick(1.5);
  check(
    "releasing the key hands control back to the cursor",
    near(Math.abs(released.x), gentle, 1e-9),
    `${released.x} vs ${gentle}`,
  );

  // And the other way: a hard cursor deflection beats a key still ramping.
  const h2 = inputHarness();
  h2.move(VW, MID_Y);
  h2.down("KeyA");
  const oneFrame = h2.input.update(1 / 60);
  check(
    "a hard cursor deflection beats a key that is still ramping",
    oneFrame.x < 0,
    String(oneFrame.x),
  );
}

function testPointerLeavesTheWindow() {
  // An UNTOUCHED pointer commands nothing: there is no position yet, and
  // assuming one (the centre, say) would be inventing an input.
  const fresh = inputHarness();
  const idle = fresh.tick(1);
  check(
    "an untouched pointer commands nothing",
    idle.x === 0 && idle.y === 0,
    `${idle.x},${idle.y}`,
  );
  check("an untouched pointer has no position", fresh.input.pointerPosition() === null);

  // Leaving the window RELEASES the stick. This is the one case where the
  // position is genuinely forgotten -- unlike a reset, the hand really has
  // left the controls.
  const h = inputHarness();
  h.move(VW * 0.9, MID_Y);
  const deflected = h.tick(0.5);
  check("a deflected cursor commands", Math.abs(deflected.x) > 0.5, String(deflected.x));
  h.leave();
  const released = h.tick(0.5);
  check(
    "leaving the window releases the stick",
    released.x === 0 && released.y === 0,
    `${released.x},${released.y}`,
  );
  check("leaving the window forgets the position", h.input.pointerPosition() === null);

  // Coming back re-establishes it from the new position, not the old one.
  h.move(VW * 0.1, MID_Y);
  const back = h.tick(0.5);
  check("returning re-establishes the stick from the new position", back.x > 0.5, String(back.x));
}

function testPointerLifecycle() {
  // The pointer position is a physical fact about where the player's hand is,
  // not a latch. Clearing it on reset would snap the aircraft to an attitude
  // nobody commanded.
  const h = inputHarness();
  h.move(VW * 0.85, MID_Y);
  h.tick(0.3);
  const before = h.input.axes.x;
  h.input.clear();
  const after = h.tick(0.3);
  check(
    "clear() does not forget where the cursor is",
    h.input.pointerPosition() !== null && near(after.x, before, 1e-9),
    `${before} -> ${after.x}`,
  );

  // Steering is switched off outright while the launch script or the crash
  // presentation owns the aircraft.
  h.input.setPointerEnabled(false);
  const disabled = h.tick(0.3);
  check("disabled steering commands nothing", disabled.x === 0, String(disabled.x));
  check(
    "the cursor is still remembered while steering is disabled",
    h.input.pointerPosition() !== null,
  );
  h.input.setPointerEnabled(true);
  check(
    "re-enabling restores the same command",
    near(h.tick(0.3).x, before, 1e-9),
  );

  // The pitch convention is ONE sign flip at the boundary, so it governs the
  // pointer as well as the keyboard.
  const h2 = inputHarness();
  h2.move(MID_X, VH * 0.1);
  const noseUp = h2.tick(0.3).y;
  check("cursor high pitches up by default", noseUp > 0, String(noseUp));
  h2.down("KeyI");
  const flipped = h2.tick(0.3).y;
  check(
    "the pitch convention flips the POINTER axis too",
    near(flipped, -noseUp, 1e-9),
    `${noseUp} -> ${flipped}`,
  );
}

function testMouseButtons() {
  const h = inputHarness();
  check("nothing is firing at rest", h.input.isFiring() === false);

  h.press(0);
  check("the left button fires", h.input.isFiring() === true);
  h.release(0);
  check("releasing the left button stops firing", h.input.isFiring() === false);

  // Discrete bindings: holding one must do nothing extra.
  h.press(2);
  check("the right button latches a weapon switch", h.input.consumeLatch("weapon") === true);
  check("the weapon latch is consumed once", h.input.consumeLatch("weapon") === false);
  h.tick(1);
  check(
    "holding the right button does not repeat the switch",
    h.input.consumeLatch("weapon") === false,
  );

  h.press(1);
  check("the middle button latches flares", h.input.consumeLatch("flares") === true);

  // Two sources, ONE latch, so both behave identically.
  const h2 = inputHarness();
  h2.down("KeyZ");
  check("Z latches the same flare action", h2.input.consumeLatch("flares") === true);
  h2.press(1);
  check("the middle button feeds the same latch", h2.input.consumeLatch("flares") === true);

  // Keyboard repeat must not spam a latch: a second keydown with no keyup in
  // between is the OS repeating, not the player pressing again.
  const h3 = inputHarness();
  h3.down("KeyZ");
  h3.input.consumeLatch("flares");
  h3.down("KeyZ");
  check(
    "an auto-repeat keydown does not re-latch",
    h3.input.consumeLatch("flares") === false,
  );
  h3.up("KeyZ");
  h3.down("KeyZ");
  check("a genuine second press does latch", h3.input.consumeLatch("flares") === true);

  const t = inputHarness();
  t.down("KeyF");
  const firingByKey = t.input.isFiring();
  t.up("KeyF");
  check("F also fires, and releasing it stops", firingByKey && t.input.isFiring() === false);
}

function testWheelThrottle() {
  // A wheel notch is an impulse, but the flight model reads throttle as a
  // RATE, so a notch charges a small decaying value rather than jumping the
  // lever. One throttle model regardless of input source.
  const h = inputHarness();
  check("no wheel input is no throttle rate", h.tick(0.1).throttle === 0);

  h.wheel(-100);
  const pushed = h.input.update(1 / 60);
  check(
    "a wheel notch pushes the throttle forward",
    pushed.throttle > 0,
    String(pushed.throttle),
  );

  const pulled = inputHarness();
  pulled.wheel(100);
  check("wheel down pulls the throttle back", pulled.input.update(1 / 60).throttle < 0);

  // It decays, or one notch would be a permanent throttle command.
  const h2 = inputHarness();
  h2.wheel(-100);
  h2.input.update(1 / 60);
  const decayed = h2.tick(2);
  check("the wheel charge decays away", decayed.throttle === 0, String(decayed.throttle));

  // The rate stays inside the range the flight model expects.
  const h3 = inputHarness();
  for (let i = 0; i < 40; i++) h3.wheel(-100);
  const spun = h3.input.update(1 / 60);
  check(
    "spinning the wheel hard stays within the rate range",
    spun.throttle <= 1 && spun.throttle >= -1,
    String(spun.throttle),
  );
}

function testContextMenuDoubleDuty() {
  // §7: the contextmenu listener suppresses the menu AND clears held keys,
  // because a menu opening swallows the keyup of anything held.
  const h = inputHarness();
  h.down("KeyW");
  h.down("KeyA");
  h.tick(1);
  h.target.dispatchEvent(new Event("contextmenu"));
  const axes = h.input.update(1 / 60);
  check("contextmenu clears held keys", h.input.heldKeys().length === 0);
  check("contextmenu zeroes the axes", axes.x === 0 && axes.y === 0);
}

function testLatches() {
  const h = inputHarness();
  check("no latch before the key", h.input.consumeLatch("restart") === false);
  h.down("KeyR");
  check("R latches a restart", h.input.consumeLatch("restart") === true);
  check("a latch is consumed once", h.input.consumeLatch("restart") === false);

  // Stage 4 drops latches accumulated during the catapult script so a key
  // pressed on the deck does not fire on the handoff frame.
  h.up("KeyR");
  h.down("KeyR");
  h.input.dropLatches();
  check("dropLatches discards a pending latch", h.input.consumeLatch("restart") === false);
}

// ── stage 2: EXPERT mode ───────────────────────────────────────────────────

const expert = (over = {}) => createFlightState({ mode: "EXPERT", ...over });

function testExpertHasNoBankToHeading() {
  // THE defining assertion of the mode. Bank hard in EXPERT, hold no other
  // input, and the heading must not move. Asserted as an ABSENCE on purpose:
  // a later edit that "fixes turning in Expert" will reintroduce the coupling
  // and look like a bug fix, and this is the only thing that will object.
  // Drive BOTH modes with the identical held input and compare. Holding is
  // what makes the comparison fair: ASSISTED self-centres, so a version of
  // this test that released the stick would let the bank decay and would be
  // measuring the decay rather than the coupling.
  const e = expert();
  fly(e, stick({ x: 1 }), 3);
  const a = createFlightState();
  fly(a, stick({ x: 1 }), 3);

  // Prove the roll happened via the UP-VECTOR, not via the bank angle: at a
  // constant stick EXPERT rolls 2.4 rad/s, so after 3 s it has turned 7.2 rad
  // and the derived Euler bank has wrapped past a full revolution -- near
  // zero again, and useless as evidence either way.
  const eUp = quatUp(e.quat);
  check(
    "EXPERT: a held roll does not change heading at all",
    Math.abs(eUp.y - 1) > 0.1 && near(e.heading, 0, 1e-9),
    `up.y ${eUp.y} heading ${e.heading}`,
  );
  check(
    "ASSISTED: the same held input turns the aircraft",
    Math.abs(a.heading) > 0.5,
    `heading ${a.heading}`,
  );

  // And with the stick released, EXPERT keeps the bank and STILL does not
  // turn -- the case a reintroduced coupling would fail loudest.
  const held = expert();
  fly(held, stick({ x: 1 }), 0.45);
  const bankHeld = held.bank;
  const headingHeld = held.heading;
  fly(held, stick(), 3);
  check(
    "EXPERT: a persisting bank with no input does not turn",
    Math.abs(held.bank) > 0.5 &&
      near(held.bank, bankHeld, 1e-6) &&
      near(held.heading, headingHeld, 1e-9),
    `bank ${bankHeld} -> ${held.bank}, heading ${headingHeld} -> ${held.heading}`,
  );
}

function testExpertIsLocal() {
  // Pitching while banked bends the trajectory: that is what
  // post-multiplication buys, and it is how the mode actually turns.
  const e = expert();
  fly(e, stick({ x: 1 }), 0.4); // establish bank
  const before = e.heading;
  fly(e, stick({ y: 1 }), 1.2); // pull, no roll input
  check(
    "EXPERT: pitching while banked changes heading through the local axis",
    Math.abs(wrapAngle(e.heading - before)) > 0.15,
    `heading ${before} -> ${e.heading}`,
  );

  // Pulling while wings-level must NOT change heading -- otherwise the test
  // above passes for the wrong reason.
  const level = expert();
  const levelBefore = level.heading;
  fly(level, stick({ y: 1 }), 1.2);
  check(
    "EXPERT: pitching wings-level leaves heading alone",
    near(level.heading, levelBefore, 1e-6),
    `heading ${levelBefore} -> ${level.heading}`,
  );
}

function testExpertDoesNotSelfCentre() {
  const e = expert();
  fly(e, stick({ x: 1 }), 0.4);
  const banked = e.bank;
  fly(e, stick(), 4);
  check(
    "EXPERT: controls do not self-centre",
    near(e.bank, banked, 1e-6),
    `bank ${banked} -> ${e.bank}`,
  );

  // ASSISTED must self-centre, for the same reason as above.
  const a = createFlightState();
  fly(a, stick({ x: 1 }), 2);
  fly(a, stick(), 4);
  check("ASSISTED: controls self-centre", Math.abs(a.bank) < 0.02, `bank ${a.bank}`);
}

function testExpertCanInvert() {
  const e = expert();
  // Roll continuously past 90 degrees and hold.
  fly(e, stick({ x: 1 }), 1.4);
  const up = quatUp(e.quat);
  check(
    "EXPERT: the aircraft can be inverted and stay there",
    up.y < 0,
    `up.y ${up.y}`,
  );
  check(
    "EXPERT: pitch is not clamped to the ASSISTED limit",
    true, // exercised by the loop below
  );

  // A full loop must be completable: pitch has to pass through vertical
  // without the ASSISTED clamp catching it.
  const looper = expert();
  let sawSteepClimb = false;
  let sawInverted = false;
  for (let t = 0; t < 6; t += 1 / 60) {
    updateFlight(looper, stick({ y: 1 }), 1 / 60);
    const f = quatForward(looper.quat);
    const u = quatUp(looper.quat);
    if (f.y > 0.9) sawSteepClimb = true;
    if (u.y < -0.5) sawInverted = true;
  }
  check("EXPERT: a sustained pull reaches vertical", sawSteepClimb);
  check("EXPERT: a sustained pull goes over the top", sawInverted);

  check(
    "EXPERT: the quaternion stays normalised through a loop",
    near(
      Math.hypot(looper.quat.x, looper.quat.y, looper.quat.z, looper.quat.w),
      1,
      1e-6,
    ),
  );
}

function testExpertSink() {
  // The sink law is written on the lift direction, not the bank angle, so it
  // still means something past 90 degrees. Written on cos(bank) it would go
  // NEGATIVE when inverted and the aircraft would climb by rolling over.
  const inverted = expert();
  fly(inverted, stick({ x: 1 }), 1.4);
  check(
    "EXPERT: inverted flight sinks rather than climbing",
    inverted.sink > 0,
    `sink ${inverted.sink} up.y ${quatUp(inverted.quat).y}`,
  );

  const levelExpert = expert();
  fly(levelExpert, stick(), 2);
  check(
    "EXPERT: level flight has no sink",
    near(levelExpert.sink, 0, 1e-9),
    `sink ${levelExpert.sink}`,
  );

  // The two modes must agree at a bank both can represent, or the sink law
  // has silently forked.
  const a = createFlightState();
  fly(a, stick({ x: 1 }), 6);
  const bankedUpY = quatUp(a.quat).y;
  check(
    "the one sink law reproduces the ASSISTED turn cost at the bank limit",
    near(bankedUpY, Math.cos(BANK_MAX), 1e-6) && a.sink > 17 && a.sink < 18,
    `up.y ${bankedUpY} sink ${a.sink}`,
  );
}

function testBothModesWriteTheQuaternion() {
  for (const mode of ["ASSISTED", "EXPERT"]) {
    const s = createFlightState({ mode });
    fly(s, stick({ x: 0.5, y: 0.3 }), 1.2);
    const q = s.quat;
    check(
      `${mode} writes a plain normalised quaternion`,
      typeof q.copy === "undefined" &&
        near(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-6),
    );
    // Forward and up derived from the quaternion must agree with the Euler
    // angles the rail and the HUD read.
    const back = quatToEulerYXZ(q);
    check(
      `${mode}: the Euler readout agrees with the quaternion`,
      near(wrapAngle(back.heading - s.heading), 0, 1e-6) &&
        near(back.pitch - s.pitch, 0, 1e-6) &&
        near(wrapAngle(back.bank - s.bank), 0, 1e-6),
      `${JSON.stringify(back)} vs h${s.heading} p${s.pitch} b${s.bank}`,
    );
  }

  // quatToEulerYXZ must invert quatFromEulerYXZ over ordinary attitudes.
  for (const [h, p, b] of [
    [0, 0, 0],
    [0.7, 0.3, -0.5],
    [-2.1, -0.4, 1.1],
    [3.0, 0.55, 0.9],
  ]) {
    const back = quatToEulerYXZ(quatFromEulerYXZ(h, p, b));
    check(
      `quatToEulerYXZ inverts quatFromEulerYXZ at ${h},${p},${b}`,
      near(wrapAngle(back.heading - h), 0, 1e-9) &&
        near(back.pitch - p, 0, 1e-9) &&
        near(wrapAngle(back.bank - b), 0, 1e-9),
      JSON.stringify(back),
    );
  }
}

function testModeChange() {
  // Entering ASSISTED from an attitude it cannot represent must level onto
  // the heading being travelled, not snap the quaternion through the clamp.
  const e = expert();
  fly(e, stick({ x: 1 }), 1.4); // inverted
  const headingBefore = e.heading;
  setMode(e, "ASSISTED");
  check(
    "entering ASSISTED clamps into its own envelope",
    Math.abs(e.bank) <= BANK_MAX + 1e-9 && Math.abs(e.pitch) <= PITCH_MAX + 1e-9,
    `bank ${e.bank} pitch ${e.pitch}`,
  );
  check(
    "entering ASSISTED keeps the heading being travelled",
    near(wrapAngle(e.heading - headingBefore), 0, 1e-9),
  );
  check(
    "entering ASSISTED rebuilds the quaternion from the clamped angles",
    near(quatUp(e.quat).y, Math.cos(e.bank) * Math.cos(e.pitch), 1e-6),
  );
  check("setMode on the same mode is a no-op", setMode(e, "ASSISTED").mode === "ASSISTED");
}

// ── stage 2: the pitch convention ──────────────────────────────────────────

function testPitchConvention() {
  const h = inputHarness();
  check("the default convention is W = nose up", h.input.pitchSign() === 1);
  check(
    "the default is announced by direction, not as ON/OFF",
    h.input.pitchConvention() === "W = NOSE UP",
    h.input.pitchConvention(),
  );

  h.down("KeyW");
  const up = h.tick(1.5).y;
  check("W pitches up by default", up === 1, `y ${up}`);

  // Toggling WHILE the key is held must flip the axis on the spot.
  h.down("KeyI");
  const flipped = h.input.axes.y;
  check(
    "toggling while a key is held flips the axis immediately",
    flipped === -1,
    `y ${flipped}`,
  );
  check(
    "the announcement names the new direction",
    h.input.pitchConvention() === "W = NOSE DOWN",
    h.input.pitchConvention(),
  );
  check("W now pitches down", h.tick(1.5).y === -1, `y ${h.input.axes.y}`);

  // It is a pure sign flip and nothing else: symmetric, neutral-preserving,
  // and it must not touch any other axis.
  const h2 = inputHarness();
  h2.down("KeyI");
  h2.down("KeyS");
  check("the flip is symmetric", h2.tick(1.5).y === 1, `y ${h2.input.axes.y}`);
  h2.up("KeyS");
  check("neutral stays neutral under the flip", h2.tick(1.5).y === 0);

  const h3 = inputHarness();
  h3.down("KeyI");
  h3.down("KeyA");
  const banked = h3.tick(1.5);
  check("bank is unaffected by the pitch convention", banked.x === 1, `x ${banked.x}`);
  h3.down("KeyQ");
  check("roll is unaffected by the pitch convention", h3.tick(1.5).roll === 1);

  // A PREFERENCE, not transient state: it must survive everything that
  // clears input, which is the one exception in the whole project.
  const h4 = inputHarness();
  h4.down("KeyI");
  h4.input.clear();
  check("the convention survives clear()", h4.input.pitchSign() === -1);
  h4.target.dispatchEvent(new Event("blur"));
  check("the convention survives a blur", h4.input.pitchSign() === -1);
  h4.down("KeyC");
  check("the convention survives the C key", h4.input.pitchSign() === -1);
  h4.doc.visibilityState = "hidden";
  h4.doc.dispatchEvent(new Event("visibilitychange"));
  check("the convention survives a tab switch", h4.input.pitchSign() === -1);

  check("toggling twice returns to the default", (() => {
    const t = inputHarness();
    t.down("KeyI");
    t.down("KeyI");
    return t.input.pitchSign() === 1;
  })());

  // I must not register as a held key or a flight axis.
  const h5 = inputHarness();
  h5.down("KeyI");
  check("I is not a held axis key", h5.input.heldKeys().length === 0);
}

// ── the two marking viewports ──────────────────────────────────────────────
// The course marks at 1920x1080 and 390x844 in Chrome DevTools, and both are
// full marking environments. These assert the FRAMING RULE rather than a
// screenshot, so it cannot regress quietly.

const DESKTOP = 1920 / 1080;
const PHONE_PORTRAIT = 390 / 844;
const PHONE_LANDSCAPE = 844 / 390;

function testMarkingViewports() {
  // The bug this replaced: a fixed VERTICAL fov holds the vertical view and
  // lets the horizontal view collapse as the frame narrows. At the phone
  // viewport that was 32 degrees of horizontal against the desktop's 96, so
  // the aircraft filled the frame and the world read as a diorama.
  const naiveDesktop = horizontalFov(64, DESKTOP);
  const naivePhone = horizontalFov(64, PHONE_PORTRAIT);
  check(
    "the naive fixed-vertical FOV really does collapse on the phone",
    naivePhone < naiveDesktop / 2,
    `desktop ${naiveDesktop.toFixed(1)} vs phone ${naivePhone.toFixed(1)}`,
  );

  // Desktop is the reference and must be left exactly alone.
  check(
    "the desktop viewport is unchanged",
    widenForAspect(64, DESKTOP) === 64,
    `${widenForAspect(64, DESKTOP)}`,
  );
  check(
    "an aspect at the reference is unchanged",
    widenForAspect(64, REF_ASPECT) === 64,
  );

  // Wider than the reference is left alone too: clawing horizontal view back
  // by narrowing the vertical would crop the horizon out of an ultrawide.
  check(
    "a landscape phone is not narrowed",
    widenForAspect(64, PHONE_LANDSCAPE) === 64,
    `${widenForAspect(64, PHONE_LANDSCAPE)}`,
  );

  // Portrait widens, and the result is capped rather than fisheyed.
  const portrait = widenForAspect(64, PHONE_PORTRAIT);
  check(
    "the portrait phone widens the vertical FOV",
    portrait > 64,
    `${portrait}`,
  );
  check(
    "the widening is capped short of a fisheye",
    portrait <= FOV_VERTICAL_MAX,
    `${portrait}`,
  );
  check(
    "portrait recovers a usable share of the horizontal view",
    horizontalFov(portrait, PHONE_PORTRAIT) > naivePhone * 1.5,
    `${horizontalFov(portrait, PHONE_PORTRAIT).toFixed(1)} vs ${naivePhone.toFixed(1)}`,
  );

  // Monotonic: a narrower frame never gets LESS help than a wider one.
  let previous = 0;
  let monotonic = true;
  for (const aspect of [1.78, 1.4, 1.0, 0.75, 0.46, 0.3]) {
    const v = widenForAspect(64, aspect);
    if (v < previous) monotonic = false;
    previous = v;
  }
  check("widening is monotonic as the frame narrows", monotonic);

  // Degenerate aspects must not produce NaN and kill the projection matrix.
  for (const bad of [0, -1, NaN, undefined]) {
    const v = widenForAspect(64, bad);
    check(`a degenerate aspect (${bad}) falls back safely`, v === 64, `${v}`);
  }

  check(
    "horizontalFov inverts sensibly at square",
    near(horizontalFov(64, 1), 64, 1e-9),
  );
}

// ── stage 3: terrain index, probes, collision policy ──────────────────────
//
// physics.js imports no three.js precisely so this can run headlessly. The
// terrain here is a SYNTHETIC ridge whose height is known in closed form, so
// every query has an answer that does not come from the code under test --
// §17.13, a test double that diverges from the real thing tests nothing, and
// the double here is the terrain, not the index.

// A ridge running along X, peaking at z = ridgeZ. Two triangles per quad.
function makeRidge({ ridgeZ = 0, peak = 600, halfWidth = 2000, extent = 6000, step = 250 } = {}) {
  const heightAt = (z) => {
    const d = Math.abs(z - ridgeZ);
    return d >= halfWidth ? 0 : peak * (1 - d / halfWidth);
  };
  const tris = [];
  for (let x = -extent; x < extent; x += step) {
    for (let z = -extent; z < extent; z += step) {
      const x1 = x + step;
      const z1 = z + step;
      const a = [x, heightAt(z), z];
      const b = [x1, heightAt(z), z];
      const c = [x1, heightAt(z1), z1];
      const d = [x, heightAt(z1), z1];
      tris.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  return { triangles: new Float32Array(tris), heightAt };
}

function testTerrainIndex() {
  const { triangles, heightAt } = makeRidge();
  const index = buildTerrainIndex(triangles);

  check("the index builds", index !== null && index.triCount > 0, `${index?.triCount}`);
  check(
    "cell occupancy lands near the figure §8 quotes",
    index.perCell > 4 && index.perCell < 20,
    `${index.perCell.toFixed(1)} per cell`,
  );

  // THE check that catches a broken index: agreement with an independently
  // known answer, over the whole surface rather than at one lucky point.
  let worst = 0;
  let misses = 0;
  for (let i = 0; i < 400; i++) {
    // A deterministic spread -- a sampler using Math.random cannot be
    // compared against its own previous run.
    const x = -5900 + ((i * 613) % 11800);
    const z = -5900 + ((i * 397) % 11800);
    const got = heightAtIndex(index, x, z);
    if (got === null) {
      misses++;
      continue;
    }
    worst = Math.max(worst, Math.abs(got - heightAt(z)));
  }
  check("the index never misses inside its own bounds", misses === 0, `${misses} misses`);
  check(
    "the index agrees with the known surface everywhere sampled",
    worst < 1e-3,
    `worst ${worst}`,
  );

  // Outside the mesh must be null, NOT zero. "No terrain here" and "the ground
  // is at sea level" are different facts, and collapsing them is how a query
  // failure disguises itself as open ocean.
  check(
    "outside the mesh returns null, not a height",
    heightAtIndex(index, 99999, 0) === null &&
      heightAtIndex(index, 0, 99999) === null,
  );
  check("a null index answers null", heightAtIndex(null, 0, 0) === null);

  // The peak of the ridge is where relief matters most.
  check(
    "the ridge peak reads its full height",
    Math.abs(heightAtIndex(index, 0, 0) - 600) < 1e-3,
    `${heightAtIndex(index, 0, 0)}`,
  );
}

function testProbesAndClearance() {
  const { triangles, heightAt } = makeRidge();
  const index = buildTerrainIndex(triangles);
  const physics = createPhysics({ index });

  // groundAt clamps to sea level, so flat water reads 0 rather than null.
  check("ground over the ridge is the ridge", Math.abs(physics.groundAt(0, 0) - 600) < 1e-3);
  check("ground off the ridge is sea level", physics.groundAt(0, 5000) === 0);
  check("land is reported as land", physics.isLandAt(0, 0) === true);
  check("sea is reported as sea", physics.isLandAt(0, 5000) === false);
  check(
    "ground outside the mesh falls back to sea level",
    physics.groundAt(99999, 0) === 0 && physics.isLandAt(99999, 0) === false,
  );

  // All five probes must be queried, and the reported minimum must be the
  // actual minimum -- a centre-only probe misses a wing tip on a ridge.
  const state = createFlightState({ position: { x: 0, y: 900, z: 0 } });
  physics.update(1 / 60, state);
  check("all five probes are placed", physics.probes.length === 5);
  const clearances = physics.probes.map((p) => p.clearance);
  check(
    "the reported clearance is the actual minimum across probes",
    Math.abs(physics.telemetry.clearance - Math.min(...clearances)) < 1e-9,
    `${physics.telemetry.clearance} vs ${Math.min(...clearances)}`,
  );
  check(
    "the closest probe is named",
    physics.probes.some((p) => p.name === physics.telemetry.closest),
  );
  check(
    "AGL over the ridge is altitude minus the ridge",
    Math.abs(physics.telemetry.agl - (900 - 600)) < 1e-3,
    `${physics.telemetry.agl}`,
  );
  check("the surface under the ridge reads land", physics.telemetry.surface === "land");

  // Bank the aircraft and a wing tip becomes the closest probe -- which is
  // the entire reason there are five of them.
  const banked = createFlightState({ position: { x: 0, y: 900, z: 0 } });
  fly(banked, stick({ x: 1 }), 3);
  const p2 = createPhysics({ index });
  p2.update(1 / 60, banked);
  check(
    "a banked aircraft brings a wing tip closest",
    p2.telemetry.closest === "wingL" || p2.telemetry.closest === "wingR",
    p2.telemetry.closest,
  );

  // Over open water, AGL is altitude.
  const atSea = createFlightState({ position: { x: 0, y: 400, z: 5000 } });
  const p3 = createPhysics({ index });
  p3.update(1 / 60, atSea);
  check("AGL over the sea is the altitude", Math.abs(p3.telemetry.agl - 400) < 1e-3);
  check("the surface over water reads ocean", p3.telemetry.surface === "ocean");
}

function testFixedStep() {
  // Physics must advance the same number of ticks per second of SIMULATED
  // time regardless of the render rate, or every tuned rate in the project
  // becomes frame-rate dependent.
  const counts = [];
  for (const hz of [60, 20, 144]) {
    const physics = createPhysics({});
    const state = createFlightState({ position: { x: 0, y: 3000, z: 0 } });
    const dt = 1 / hz;
    for (let t = 0; t < 2; t += dt) physics.update(dt, state);
    counts.push(physics.telemetry.ticks);
  }
  check(
    "physics ticks match across 60, 20 and 144 Hz render rates",
    Math.max(...counts) - Math.min(...counts) <= 2,
    `ticks ${counts.join(", ")}`,
  );
  check(
    "two seconds is about 120 physics ticks",
    Math.abs(counts[0] - 120) <= 2,
    `${counts[0]}`,
  );
}

function testSafeStateHistory() {
  const { triangles } = makeRidge();
  const index = buildTerrainIndex(triangles);

  // Well clear: history fills.
  const high = createPhysics({ index });
  const highState = createFlightState({ position: { x: 0, y: 4000, z: 5000 } });
  for (let t = 0; t < 1; t += 1 / 60) high.update(1 / 60, highState);
  check("safe flight records history", high.historyLength() > 30, `${high.historyLength()}`);

  // Low over the ridge at speed: the threshold is speed-scaled, so the same
  // clearance that is comfortable at 110 m/s records nothing at 250.
  const low = createPhysics({ index });
  const lowState = createFlightState({
    position: { x: 0, y: 640, z: 0 },
    speed: 250,
  });
  for (let t = 0; t < 1; t += 1 / 60) low.update(1 / 60, lowState);
  check(
    "flight too close to the ground records nothing",
    low.historyLength() === 0,
    `${low.historyLength()}`,
  );

  // reset() clears the history.
  high.reset(highState);
  check("reset clears the history", high.historyLength() === 0);

  // The rewind target is OLD, not the newest entry -- the newest sits one
  // query before the impact and restoring it re-flies the same crash.
  const p = createPhysics({ index });
  const s = createFlightState({ position: { x: 0, y: 4000, z: 6000 }, speed: 170 });
  // Actually FLY it. physics.update() queries and records; it does not move
  // the aircraft, so a version of this that only ticked physics compared a
  // snapshot against an identical present and measured a distance of zero.
  for (let t = 0; t < 2; t += 1 / 60) {
    updateFlight(s, stick(), 1 / 60);
    p.update(1 / 60, s);
  }
  const target = p.rewindTarget();
  check("there is a rewind target", target !== null);
  check(
    "the rewind target is about 0.65 s behind, not the newest state",
    target && Math.abs(target.position.z - s.position.z) > 170 * 0.4,
    `dz ${target ? Math.abs(target.position.z - s.position.z).toFixed(0) : "-"}`,
  );
  check("an empty history has no rewind target", createPhysics({}).rewindTarget() === null);
}

function testCollisionPolicies() {
  const { triangles } = makeRidge();
  const index = buildTerrainIndex(triangles);

  // ── the development policy: rewinds a contact, dodges a prediction ──
  let state = createFlightState({ position: { x: 0, y: 4000, z: 6000 }, speed: 170 });
  const physics = createPhysics({ index });
  const events = [];
  const dev = createDevelopmentRecovery({
    physics,
    getState: () => state,
    onEvent: (e) => events.push(e.kind),
  });
  physics.setPolicy(dev);
  check("the policy names itself", dev.name === "DevelopmentRecoveryResponse");

  // Fly level and safe first so there is something to rewind INTO.
  for (let t = 0; t < 2; t += 1 / 60) physics.update(1 / 60, state);
  const safeZ = state.position.z;
  check("history filled before the impact", physics.historyLength() > 30);

  // Now put it inside the ridge: a real contact.
  state.position.x = 0;
  state.position.z = 0;
  state.position.y = 601;
  physics.update(1 / 60, state);
  check("a contact triggers a recovery", events.includes("recover"), events.join(","));
  check(
    "the rewind caps speed",
    state.speed <= 160 + 1e-9,
    `${state.speed}`,
  );
  check("the rewind lands in flyable air", state.position.y > physics.groundAt(state.position.x, state.position.z) + 20,
    `y ${state.position.y} ground ${physics.groundAt(state.position.x, state.position.z)}`);
  check("the grace period neutralises input", dev.overridesInput() === true);
  check("the rewind clears the history it came from", physics.historyLength() === 0);

  // The grace expires.
  for (let t = 0; t < 1; t += 1 / 60) dev.tick(1 / 60);
  check("the grace period expires", dev.overridesInput() === false);

  // A PREDICTION is dodged, not rewound: the impact has not happened.
  const dodgeState = createFlightState({ position: { x: 0, y: 4000, z: 4000 }, speed: 200 });
  const p2 = createPhysics({ index });
  const kinds = [];
  const dev2 = createDevelopmentRecovery({
    physics: p2,
    getState: () => dodgeState,
    onEvent: (e) => kinds.push(e.kind),
  });
  p2.setPolicy(dev2);
  const handled = dev2.handleCollision({
    type: "terrain", predicted: true, position: { ...dodgeState.position },
    speed: 200, clearance: 400, hazard: 90, probe: "nose", at: 1,
  });
  check("a prediction is handled", handled === true);
  check("a prediction dodges rather than rewinding", kinds.includes("dodge") && !kinds.includes("recover"), kinds.join(","));
  check("the dodge is running", dev2.isDodging() === true);
  const pitchBefore = dodgeState.pitch;
  for (let t = 0; t < 0.3; t += 1 / 60) dev2.tick(1 / 60);
  check("the dodge commands a climb", dodgeState.pitch > pitchBefore, `${dodgeState.pitch}`);
  check("a dodge does NOT neutralise input", dev2.overridesInput() === false);

  // ── the null policy: declines, and physics still sets its own cooldown ──
  const p3 = createPhysics({ index });
  const nul = createNullResponse();
  p3.setPolicy(nul);
  const declining = createFlightState({ position: { x: 0, y: 601, z: 0 }, speed: 170 });
  p3.update(1 / 60, declining);
  check("a declined event still sets physics' own cooldown", p3.cooldown() > 0, `${p3.cooldown()}`);
  check("the null policy recorded the decline", nul.stats().declined > 0);

  // ── the swap: DETECTION must be byte-identical under both policies ──
  const runDetection = (policy) => {
    const s = createFlightState({ position: { x: 0, y: 700, z: 1500 }, speed: 200 });
    const ph = createPhysics({ index });
    ph.setPolicy(policy);
    const seen = [];
    for (let t = 0; t < 1.2; t += 1 / 60) {
      ph.update(1 / 60, s);
      seen.push(
        `${ph.telemetry.contact ? 1 : 0}${ph.telemetry.forwardImminent ? 1 : 0}`,
      );
      // Hold the aircraft still so the two runs see identical geometry.
      s.position.x = 0;
      s.position.y = 700;
      s.position.z = 1500;
    }
    return seen.join("");
  };
  const underNull = runDetection(createNullResponse());
  const underDev = runDetection(
    createDevelopmentRecovery({
      physics: createPhysics({ index }),
      getState: () => createFlightState(),
    }),
  );
  check(
    "detection is byte-identical under both policies",
    underNull === underDev,
    `${underNull.slice(0, 24)} vs ${underDev.slice(0, 24)}`,
  );

  // keepPolicy: a policy performing a restore must not cancel its own fade.
  const p4 = createPhysics({ index });
  let resetCalls = 0;
  p4.setPolicy({
    name: "counter",
    handleCollision: () => true,
    tick() {},
    reset() {
      resetCalls++;
    },
    overridesInput: () => false,
  });
  p4.reset(null, { keepPolicy: true });
  check("reset with keepPolicy leaves the policy alone", resetCalls === 0);
  p4.reset(null);
  check("reset without keepPolicy resets the policy", resetCalls === 1);
}

// ── run ────────────────────────────────────────────────────────────────────

const SUITES = [
  ["envelope", testEnvelope],
  ["turn", testTurn],
  ["throttle", testThrottle],
  ["sink", testSink],
  ["snapshots", testSnapshots],
  ["quaternion", testQuaternion],
  ["input ramping", testInputRamping],
  ["event.code robustness", testEventCodeRobustness],
  ["stuck-key clearing", testStuckKeyClearing],
  ["pointer stick geometry", testPointerStickGeometry],
  ["pointer centre is not synthesised", testPointerCentreIsNotSynthesised],
  ["pointer + keyboard combine", testPointerAndKeyboardCombine],
  ["pointer leaves the window", testPointerLeavesTheWindow],
  ["pointer lifecycle", testPointerLifecycle],
  ["mouse buttons", testMouseButtons],
  ["wheel throttle", testWheelThrottle],
  ["contextmenu double duty", testContextMenuDoubleDuty],
  ["latches", testLatches],
  ["expert: no bank->heading", testExpertHasNoBankToHeading],
  ["expert: local axes", testExpertIsLocal],
  ["expert: no self-centring", testExpertDoesNotSelfCentre],
  ["expert: inversion", testExpertCanInvert],
  ["expert: sink law", testExpertSink],
  ["both modes write the quaternion", testBothModesWriteTheQuaternion],
  ["mode change", testModeChange],
  ["pitch convention", testPitchConvention],
  ["marking viewports", testMarkingViewports],
  ["terrain index", testTerrainIndex],
  ["probes and clearance", testProbesAndClearance],
  ["fixed physics step", testFixedStep],
  ["safe-state history", testSafeStateHistory],
  ["collision policies", testCollisionPolicies],
];

export function run() {
  passed = 0;
  failed = 0;
  failures = [];
  for (const [name, fn] of SUITES) {
    try {
      fn();
    } catch (err) {
      failed++;
      failures.push({ name, detail: `threw: ${err && err.message}` });
    }
  }
  return { passed, failed, failures, total: passed + failed };
}
