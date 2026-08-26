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
  quatUp,
  updateFlight,
  wrapAngle,
} from "./flight.js";
import { createInput } from "./input.js";

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

function testNoPointerPath() {
  // §17.6 and §17.14: assert the MECHANISM, not the symptom. Dispatching a
  // pointer event and finding the axes unmoved would also pass if a pointer
  // listener existed but happened not to write an axis on that frame. The
  // real requirement is structural -- there is no code path from a pointer
  // event to a flight axis -- so assert that no such listener is registered.
  const h = inputHarness();
  const types = h.input.listenerTypes();
  const pointerish = types.filter((t) => /pointer|mouse|touch|wheel|drag/i.test(t));
  check(
    "input registers no pointer, mouse, touch or wheel listener",
    pointerish.length === 0,
    `found ${pointerish.join(", ")}`,
  );
  check(
    "input registers the keyboard and focus listeners it does need",
    types.includes("keydown") && types.includes("keyup") && types.includes("blur"),
    `types ${types.join(", ")}`,
  );

  // The symptom test as well, because the two together also catch a listener
  // registered somewhere other than through this module.
  for (const type of ["pointermove", "pointerdown", "mousemove", "wheel"]) {
    const evt = new Event(type);
    evt.movementX = 250;
    evt.movementY = -180;
    evt.clientX = 900;
    evt.clientY = 40;
    h.target.dispatchEvent(evt);
  }
  const axes = h.tick(0.5);
  check(
    "no pointer gesture produces any control input",
    axes.x === 0 && axes.y === 0 && axes.roll === 0 && axes.throttle === 0,
    `x ${axes.x} y ${axes.y} roll ${axes.roll} thr ${axes.throttle}`,
  );
}

function testLatches() {
  const h = inputHarness();
  check("no latch before the key", h.input.consumeLatch("restart") === false);
  h.down("KeyR");
  check("R latches a restart", h.input.consumeLatch("restart") === true);
  check("a latch is consumed once", h.input.consumeLatch("restart") === false);

  // Stage 4 drops latches accumulated during the catapult script so a key
  // pressed on the deck does not fire on the handoff frame.
  h.down("KeyR");
  h.input.dropLatches();
  check("dropLatches discards a pending latch", h.input.consumeLatch("restart") === false);
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
  ["no pointer path", testNoPointerPath],
  ["latches", testLatches],
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
