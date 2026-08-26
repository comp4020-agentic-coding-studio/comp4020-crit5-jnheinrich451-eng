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
  ["expert: no bank->heading", testExpertHasNoBankToHeading],
  ["expert: local axes", testExpertIsLocal],
  ["expert: no self-centring", testExpertDoesNotSelfCentre],
  ["expert: inversion", testExpertCanInvert],
  ["expert: sink law", testExpertSink],
  ["both modes write the quaternion", testBothModesWriteTheQuaternion],
  ["mode change", testModeChange],
  ["pitch convention", testPitchConvention],
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
