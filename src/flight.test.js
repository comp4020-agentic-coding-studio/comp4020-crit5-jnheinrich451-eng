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
import {
  createDevelopmentRecovery,
  MC,
  createMissionCheckpointResponse,
  createNullResponse,
} from "./collision.js";
import {
  COMPLETE, DECK, DEFENSIVE, EGRESS, EXTRACTION, FINAL, INTERCEPT, LAUNCH,
  PHASES, TERRAIN,
  autopilotStick, bandFeature, blendStick, buildRoute, captureCheckpoint,
  createMission, inVolume, missionTransition, pickZonedFeatures,
  surveyTerrainRoute, volumesOverlap,
} from "./mission.js";
import {
  ACQUISITION_SECONDS, PROBE_SCALES, SAM_MISSILE,
  createSamNetwork, lineOfSight, placeSites, samTransition,
} from "./sam.js";
import { FLARE_CFG, createFlares, seduces } from "./flares.js";
import { createRearm } from "./rearm.js";
import {
  ALWAYS, FREE, MISSION, PEACE, createSandbox, nextMode, rulesFor,
} from "./modes.js";
import {
  RESPAWN_ALTITUDE, RESPAWN_BACKOFF, SPAWN_CLEARANCE, T, VARIANTS,
  causeFor, createCrashFx, respawnFrom, safeSpawnAltitude,
} from "./crash-fx.js";
import {
  AMBIENT, CRITICAL, CUES, WARNING, WEAPON,
  createAudio, groundWarning, isFlyby,
} from "./audio.js";
import {
  AGL_DANGER, AGL_WARN, C, CASING, FLANK_FRACTION, RADAR_MARGIN,
  RADAR_RADIUS, RAMP, STACK_SLOTS,
  aglReadout, flankColumns, flankOffset, fontPx, hudScale, modeSegment,
  stackY, storesPanel,
} from "./hud-layout.js";
import {
  EASE,
  HANDOFF_SPEED,
  HANDOFF_THROTTLE,
  ROTATE_PITCH,
  STROKE_MAX,
  STROKE_MIN,
  V0,
  V1,
  buildLaunchPlan,
  createLaunch,
  deckDwellFor,
  solveExitSpeed,
  solveStroke,
  solveStrokeTime,
  strokeDistance,
  strokePosition,
  strokeSpeed,
} from "./launch.js";
import {
  createDrone,
  createTarget,
  damageTarget,
  isTargetable,
} from "./enemy.js";
import { createTargeting } from "./targeting.js";
import {
  AIM9,
  createMissileSystem,
  hasOvershot,
  turnRadius,
} from "./missile.js";
import { createGun, leadSolution } from "./gun.js";
import {
  HOSTILE_CFG,
  HOSTILE_MISSILE,
  createHostile,
  hostileTransition,
} from "./hostile.js";
import {
  EVADE_WINDOW,
  authorityFor,
  createEvasion,
  createThreatMonitor,
  wouldHaveHit,
} from "./threat.js";
import { createDamageResponse, playerDamageEvent } from "./damage.js";

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

// ── stage 4: the carrier and the catapult ─────────────────────────────────
//
// launch.js imports no three.js, so the curve and both its inverses are
// exercised here directly. The reference deck is the MEASURED one from the
// carrier asset: 199.7 m between the two anchors.

const DECK_RUN = 199.68;

const deckAnchors = (run = DECK_RUN, deckY = 20) => ({
  deck: { x: 0, y: deckY, z: -1600 },
  launchStart: { x: 0, y: deckY, z: -1533.4 },
  launchEnd: { x: 0, y: deckY, z: -1533.4 - run },
  approach: { x: 0, y: deckY + 120, z: -1200 },
  runLength: run,
  deckY,
  deckLength: 332.8,
  measured: true,
});

function testStrokeCurve() {
  // Closed at both ends, and monotonic in between.
  check("the ease starts at v0", strokeSpeed(0) === V0);
  check("the ease ends at v1", Math.abs(strokeSpeed(1) - V1) < 1e-9);
  let previous = -1;
  let monotonic = true;
  for (let u = 0; u <= 1.0001; u += 0.01) {
    const v = strokeSpeed(u);
    if (v < previous - 1e-12) monotonic = false;
    previous = v;
  }
  check("the ease is monotonic", monotonic);
  check("the ease clamps outside [0,1]", strokeSpeed(-1) === V0 && strokeSpeed(2) === V1);

  // ACCELERATION INCREASES all the way to the deck edge -- that is the read
  // the sequence is building to, and it is why the exponent is 1.25 and not
  // some ease that flattens at the end.
  const firstTenth = strokeSpeed(0.1) - strokeSpeed(0);
  const lastTenth = strokeSpeed(1) - strokeSpeed(0.9);
  check(
    "the last tenth of the stroke covers more speed than the first",
    lastTenth > firstTenth,
    `first ${firstTenth.toFixed(2)} vs last ${lastTenth.toFixed(2)}`,
  );

  // A t^2 curve would need 3.56 s for this run, which is not "fast" -- assert
  // the claim the comment makes, so a later edit to the exponent has to face it.
  check(
    "a squared ease would need about 3.56 s for the measured run",
    Math.abs(solveStrokeTime(DECK_RUN, V0, V1, 2) - 3.56) < 0.02,
    `${solveStrokeTime(DECK_RUN, V0, V1, 2).toFixed(3)} s`,
  );
}

function testClosedFormMatchesItsOwnIntegral() {
  // The closed form must match a NUMERIC integral of the very same curve, to
  // within a few centimetres. This is the check that catches an algebra slip
  // in the integral, which would otherwise show up only as a release point
  // that drifts off the bow.
  for (const T of [2.2, 2.7733, 3.1]) {
    let sum = 0;
    const steps = 20000;
    for (let i = 0; i < steps; i++) {
      sum += strokeSpeed((i + 0.5) / steps) * (T / steps);
    }
    const closed = strokeDistance(T);
    check(
      `closed-form distance matches a numeric integral at T=${T}`,
      Math.abs(closed - sum) < 0.03,
      `closed ${closed.toFixed(4)} vs numeric ${sum.toFixed(4)}`,
    );
  }

  // strokePosition is the partial integral, so it must land on strokeDistance.
  const T = 2.7733;
  check(
    "strokePosition at t=T equals the whole stroke distance",
    Math.abs(strokePosition(T, T) - strokeDistance(T)) < 1e-9,
  );
  check("strokePosition at t=0 is zero", strokePosition(0, T) === 0);
  check(
    "strokePosition is monotonic",
    (() => {
      let prev = -1;
      for (let t = 0; t <= T; t += T / 200) {
        const s = strokePosition(t, T);
        if (s < prev - 1e-12) return false;
        prev = s;
      }
      return true;
    })(),
  );
  check("a zero-duration stroke covers nothing", strokePosition(1, 0) === 0);
}

function testBothInverses() {
  // solveStrokeTime inverts strokeDistance.
  for (const d of [90, 150, DECK_RUN, 260]) {
    const T = solveStrokeTime(d);
    check(
      `solveStrokeTime inverts strokeDistance at ${d} m`,
      Math.abs(strokeDistance(T) - d) < 1e-9,
      `${strokeDistance(T)}`,
    );
  }
  // solveExitSpeed closes the same geometry from the other side.
  for (const [d, T] of [[90, 2.2], [DECK_RUN, 2.7733], [400, 3.1]]) {
    const v1 = solveExitSpeed(d, T);
    check(
      `solveExitSpeed closes ${d} m in ${T} s`,
      Math.abs(strokeDistance(T, V0, v1) - d) < 1e-9,
      `v1 ${v1.toFixed(2)}`,
    );
  }
  check("solveExitSpeed on a zero duration does not divide by zero", Number.isFinite(solveExitSpeed(100, 0)));
}

function testSolveAgainstDecks() {
  // The MEASURED deck solves inside the window and keeps the authored speed.
  const measured = solveStroke(DECK_RUN);
  check(
    "the measured deck solves inside 2.2-3.1 s",
    measured.time >= STROKE_MIN && measured.time <= STROKE_MAX,
    `${measured.time.toFixed(4)} s`,
  );
  check("the measured deck keeps the authored exit speed", measured.exitSpeed === V1);
  check("the measured deck is not clamped", measured.clamped === false);
  check(
    "the measured deck solves to about 2.77 s",
    Math.abs(measured.time - 2.7733) < 0.01,
    `${measured.time}`,
  );
  check(
    "the solved stroke covers the run exactly",
    Math.abs(strokeDistance(measured.time, V0, measured.exitSpeed) - DECK_RUN) < 1e-6,
  );

  // A SHORT deck clamps the time and re-solves the SPEED -- the geometry
  // always closes, because the aircraft must leave at the release point on any
  // deck, never before it and never past it.
  const short = solveStroke(90);
  check("a 90 m deck clamps the time", short.clamped === true);
  check("a 90 m deck clamps to the minimum", Math.abs(short.time - STROKE_MIN) < 1e-9);
  check(
    "a 90 m deck re-solves a lower exit speed",
    short.exitSpeed < V1,
    `${short.exitSpeed.toFixed(1)} m/s`,
  );
  check(
    "the short deck still closes exactly",
    Math.abs(strokeDistance(short.time, V0, short.exitSpeed) - 90) < 1e-9,
    `${strokeDistance(short.time, V0, short.exitSpeed)}`,
  );

  // And a very LONG deck clamps the other way.
  const long = solveStroke(400);
  check("a 400 m deck clamps to the maximum", Math.abs(long.time - STROKE_MAX) < 1e-9);
  check("a 400 m deck re-solves a higher exit speed", long.exitSpeed > V1);
  check(
    "the long deck still closes exactly",
    Math.abs(strokeDistance(long.time, V0, long.exitSpeed) - 400) < 1e-9,
  );
}

function testDeckDwellIsMeasured() {
  // The dwell is the start-up recording's own length at its playback rate --
  // not an authored number. Replace the recording and the wait follows it.
  check(
    "a 22.99 s clip at double speed gives an 11.49 s dwell",
    Math.abs(deckDwellFor(22.99) - 11.495) < 1e-9,
    `${deckDwellFor(22.99)}`,
  );
  check("a longer clip lengthens the dwell", deckDwellFor(30) > deckDwellFor(22));
  check("a missing clip falls back rather than firing instantly", deckDwellFor(0) > 5);

  const plan = buildLaunchPlan({ runLength: DECK_RUN, clipSeconds: 22.99 });
  check("the catapult fires at the end of the dwell", plan.fireAt === plan.dwell);
  check(
    "the burner lights before the catapult fires",
    plan.burnerAt < plan.fireAt && plan.fireAt - plan.burnerAt < 2,
    `${plan.burnerAt} -> ${plan.fireAt}`,
  );
  // The ordering the whole sequence depends on.
  check(
    "ordering: fire -> release -> gear up -> handoff",
    plan.fireAt < plan.releaseAt &&
      plan.releaseAt < plan.gearUpAt &&
      plan.gearUpAt < plan.handoffAt,
    JSON.stringify(plan),
  );
  check(
    "rotation begins before the gear comes up",
    plan.rotateAt < plan.gearUpAt,
    `${plan.rotateAt} vs ${plan.gearUpAt}`,
  );
}

/** Run the whole scripted sequence at a fixed rate and record what happened. */
function flyLaunch(hz, run = DECK_RUN) {
  const anchors = deckAnchors(run);
  const state = createFlightState();
  const events = [];
  const gear = [];
  const fovs = [];
  const rig = {
    reset() {},
    setShake() {},
    blend(name, composition) {
      if (composition.fov !== undefined) fovs.push(composition.fov);
    },
  };
  const launch = createLaunch({
    anchors,
    clipSeconds: 22.99,
    rig,
    groundOffset: 2.95,
    setGear: (down) => gear.push(down),
    onEvent: (name) => events.push(name),
  });
  launch.start(state);

  const dt = 1 / hz;
  let handoffs = 0;
  let maxAlong = 0;
  let lateral = 0;
  let pastRelease = 0;
  let ticks = 0;
  const parked = { ...state.position };

  while (ticks < hz * 25) {
    ticks++;
    const before = launch.isActive();
    launch.update(dt, state);
    if (before && !launch.isActive()) handoffs++;
    const along = anchors.launchStart.z - state.position.z;
    if (along > maxAlong) maxAlong = along;
    lateral = Math.max(lateral, Math.abs(state.position.x - anchors.launchStart.x));
    if (launch.elapsed() <= launch.plan.releaseAt) {
      pastRelease = Math.max(pastRelease, along - run);
    }
    if (!launch.isActive() && launch.hasHandedOff()) break;
  }
  return { launch, state, events, gear, fovs, handoffs, maxAlong, lateral, pastRelease, parked, anchors };
}

function testLaunchSequence() {
  for (const hz of [60, 20]) {
    const r = flyLaunch(hz);
    check(`${hz} Hz: exactly one handoff`, r.handoffs === 1, `${r.handoffs}`);
    check(
      `${hz} Hz: the handoff happens at the planned time`,
      Math.abs(r.launch.elapsed() - r.launch.plan.handoffAt) < 2 / hz,
      `${r.launch.elapsed().toFixed(3)} vs ${r.launch.plan.handoffAt.toFixed(3)}`,
    );
    check(
      `${hz} Hz: the stroke never runs past the release point`,
      r.pastRelease <= 0.001,
      `overshoot ${r.pastRelease.toFixed(4)} m`,
    );
    check(
      `${hz} Hz: the stroke gets within one frame of the release point`,
      DECK_RUN - Math.min(r.maxAlong, DECK_RUN) < 1e-6,
      `reached ${Math.min(r.maxAlong, DECK_RUN).toFixed(4)} of ${DECK_RUN}`,
    );
    check(`${hz} Hz: no lateral drift`, r.lateral < 1e-9, `${r.lateral}`);
    check(
      `${hz} Hz: seeded at the handoff speed`,
      Math.abs(r.state.speed - HANDOFF_SPEED) < 1e-9,
      `${r.state.speed}`,
    );
    check(
      `${hz} Hz: seeded at the handoff throttle, in burner`,
      r.state.throttle === HANDOFF_THROTTLE && r.state.afterburner === true,
      `${r.state.throttle}`,
    );
    check(
      `${hz} Hz: nose-up at the handoff`,
      Math.abs(r.state.pitch - ROTATE_PITCH) < 1e-9,
      `${r.state.pitch}`,
    );
    check(`${hz} Hz: sink is zeroed at the handoff`, r.state.sink === 0);
    check(
      `${hz} Hz: the ordering held`,
      r.events.join(",") === "burner,fire,release,gearUp,handoff",
      r.events.join(","),
    );
    check(
      `${hz} Hz: gear goes down on the deck and up after the release`,
      r.gear[0] === true && r.gear[r.gear.length - 1] === false,
      JSON.stringify(r.gear),
    );
  }

  // THE frame-rate independence claim: the release point is computed from the
  // closed-form integral, so 20 Hz must reach the same place as 60 Hz.
  const fast = flyLaunch(60);
  const slow = flyLaunch(20);
  check(
    "the release point is frame-rate independent",
    Math.abs(Math.min(fast.maxAlong, DECK_RUN) - Math.min(slow.maxAlong, DECK_RUN)) < 1e-6,
    `60 Hz ${fast.maxAlong.toFixed(4)} vs 20 Hz ${slow.maxAlong.toFixed(4)}`,
  );
}

function testParkedPose() {
  const anchors = deckAnchors();
  const state = createFlightState();
  const launch = createLaunch({ anchors, clipSeconds: 22.99, groundOffset: 2.95, setGear: () => {} });
  launch.start(state);

  check("the parked pose sits at the launch start", state.position.z === anchors.launchStart.z);
  check(
    "the parked pose sits ON the deck, not in it",
    Math.abs(state.position.y - (anchors.deckY + 2.95)) < 1e-9,
    `${state.position.y} vs deck ${anchors.deckY}`,
  );
  check("the parked pose is stationary", state.speed === 0);
  check("the parked pose is level", state.pitch === 0 && state.bank === 0);
  check(
    "the parked pose heads along the launch axis",
    state.heading === 0,
    `${state.heading}`,
  );

  // Gear DOWN on the deck -- and the cache is seeded null so the very first
  // call actually paints (stage 2's rule, exercised end to end here).
  const gear = [];
  const s2 = createFlightState();
  createLaunch({ anchors, clipSeconds: 22.99, setGear: (d) => gear.push(d) }).start(s2);
  check("gear is put down for the deck", gear[0] === true, JSON.stringify(gear));
}

function testLaunchCameraBlend() {
  const r = flyLaunch(60);
  check("the launch composition was blended in", r.fovs.length > 0);
  const first = r.fovs[0];
  const peak = Math.max(...r.fovs);
  check("FOV opens from the deck value", Math.abs(first - 59) < 1e-9, `${first}`);
  check("FOV opens toward the exit value", peak > 70 && peak <= 71 + 1e-9, `${peak}`);
  check(
    "FOV never opens past a comfortable maximum",
    peak <= 71 + 1e-9,
    `${peak}`,
  );
  // Weighted by the SQUARE of stroke progress, so it opens rather than drifts:
  // at half the stroke it should still be near the bottom of the range.
  const half = r.fovs[Math.floor(r.fovs.length * 0.5)];
  check(
    "FOV is still low at the midpoint (squared weighting, not linear)",
    half < 59 + (71 - 59) * 0.5,
    `${half}`,
  );
}

function testLaunchOwnsTheAircraft() {
  const anchors = deckAnchors();
  const state = createFlightState();
  const launch = createLaunch({ anchors, clipSeconds: 22.99, groundOffset: 2.95, setGear: () => {} });
  launch.start(state);
  check("the script owns the aircraft while running", launch.isActive() === true);

  // No flight physics runs during the script: the state is WRITTEN, so a stick
  // input must change nothing at all.
  const before = JSON.stringify(state);
  launch.update(1 / 60, state);
  const scripted = JSON.stringify(state);
  const other = createFlightState();
  const l2 = createLaunch({ anchors, clipSeconds: 22.99, groundOffset: 2.95, setGear: () => {} });
  l2.start(other);
  updateFlight(other, stick({ x: 1, y: 1, throttle: 1 }), 0); // dt 0 -> no-op
  l2.update(1 / 60, other);
  check(
    "the script writes the whole state regardless of input",
    JSON.stringify(other) === scripted,
    "scripted states diverged",
  );
  check("the state did advance", scripted !== before);

  const r = flyLaunch(60);
  check("the script releases the aircraft after the handoff", r.launch.isActive() === false);
  check("the handoff is recorded", r.launch.hasHandedOff() === true);
}

// ── stage 5: targeting, guns, one missile ─────────────────────────────────
//
// targeting.js, missile.js, gun.js and enemy.js all import no three.js, so the
// rules are exercised here rather than inferred from a screenshot.

const observerAt = (position, forward = { x: 0, y: 0, z: -1 }) => ({
  position,
  forward,
});

function testTargetContract() {
  // §5: the contract is load-bearing. Stage 8's SAM sites publish this same
  // shape, and targeting, the gun, the missile and the HUD bracket then work
  // on ground targets with no special cases at all.
  const t = createTarget({ label: "DRONE" });
  for (const field of ["position", "velocity", "alive", "health", "maxHealth", "radius", "label", "hitAt"]) {
    check(`the target contract exposes ${field}`, field in t);
  }
  check("a fresh target is targetable", isTargetable(t) === true);
  check("a dead target is not targetable", (() => {
    const d = createTarget();
    d.alive = false;
    return isTargetable(d) === false;
  })());
  check("a bare object is not targetable", isTargetable({}) === false);

  // A stationary ground target satisfies the same contract -- the shape that
  // makes stage 8 free.
  const sam = createTarget({ label: "SAM", velocity: { x: 0, y: 0, z: 0 } });
  check("a zero-velocity target still satisfies the contract", isTargetable(sam));

  // damageTarget returns true ONCE, on the transition to dead, so a caller can
  // award a kill exactly once however many rounds land in the same frame.
  const victim = createTarget({ health: 20 });
  check("damage below the threshold does not kill", damageTarget(victim, 5, 1) === false);
  check("damage records the hit time", victim.hitAt === 1);
  check("the killing blow returns true", damageTarget(victim, 100, 2) === true);
  check("health floors at zero", victim.health === 0);
  check("a dead target reports no second kill", damageTarget(victim, 100, 3) === false);

  // The drone publishes a WRITTEN velocity, not one differenced from
  // positions: the lead solution and the missile both read it, and a
  // differenced velocity lags a frame at exactly the moment it matters.
  const drone = createDrone({ centre: { x: 0, y: 900, z: -3000 } });
  drone.update(1 / 60);
  const speed = Math.hypot(drone.target.velocity.x, drone.target.velocity.z);
  check("the drone publishes a real velocity", speed > 100, `${speed.toFixed(1)}`);
  drone.target.alive = false;
  drone.update(1 / 60);
  check(
    "a dead drone stops moving",
    drone.target.velocity.x === 0 && drone.target.velocity.z === 0,
  );
}

function testLockProgression() {
  const targeting = createTargeting();
  const target = createTarget({ position: { x: 0, y: 900, z: -2000 } });
  const observer = observerAt({ x: 0, y: 900, z: 0 });

  check("nothing is tracked before an update", targeting.state().lockState === "NONE");

  // Lock progresses only while the SAME candidate is tracked.
  let s = targeting.update(0.5, [target], observer);
  check("tracking begins", s.lockState === "TRACK" && s.currentTarget === target);
  check("progress is partial after half the lock time", s.lockProgress > 0.3 && s.lockProgress < 0.5, `${s.lockProgress}`);
  s = targeting.update(0.9, [target], observer);
  check("a steady track reaches lock", s.lockState === "LOCK", `${s.lockProgress}`);
  check("progress saturates at 1", s.lockProgress === 1);

  // AN EMPTY CANDIDATE LIST IS THE NORMAL WAY TO DISABLE IT (§5) -- there is
  // deliberately no enabled flag, and stage 7 relies on this between
  // encounters.
  s = targeting.update(0.2, [], observer);
  check("an empty list decays the lock", s.lockProgress < 1, `${s.lockProgress}`);
  s = targeting.update(2, [], observer);
  check("an empty list clears the lock", s.lockProgress === 0);
  check("an empty list produces no target", s.currentTarget === null);
  check("an empty list reports NONE", s.lockState === "NONE");

  // Switching target RESTARTS the lock rather than inheriting progress.
  const t2 = createTargeting();
  const a = createTarget({ label: "A", position: { x: 0, y: 900, z: -2000 } });
  const b = createTarget({ label: "B", position: { x: 60, y: 900, z: -1900 } });
  t2.update(1.0, [a], observer);
  const progressed = t2.state().lockProgress;
  check("the first target progressed", progressed > 0.5);
  a.alive = false;
  const sw = t2.update(1 / 60, [a, b], observer);
  check("switching target picks the live one", sw.currentTarget === b);
  check("switching target restarts the lock", sw.lockProgress < 0.1, `${sw.lockProgress}`);

  // Off the nose and out of range are both rejected.
  const behind = createTarget({ position: { x: 0, y: 900, z: 2000 } });
  check(
    "a target behind the nose is not a candidate",
    targeting.update(1, [behind], observer).currentTarget === null,
  );
  const far = createTarget({ position: { x: 0, y: 900, z: -40000 } });
  check(
    "a target beyond max range is not a candidate",
    targeting.update(1, [far], observer).currentTarget === null,
  );
  // The nearer of two on the nose wins.
  const near = createTarget({ label: "N", position: { x: 0, y: 900, z: -1200 } });
  const distant = createTarget({ label: "F", position: { x: 0, y: 900, z: -5000 } });
  const t3 = createTargeting();
  check(
    "the closer of two targets on the nose is selected",
    t3.update(1 / 60, [distant, near], observer).currentTarget === near,
  );
}

function testLeadSolution() {
  const origin = { x: 0, y: 0, z: 0 };

  // A STATIONARY target: the pipper is the target itself.
  const still = createTarget({ position: { x: 0, y: 0, z: -1000 } });
  const s = leadSolution(origin, still);
  check("the lead on a stationary target is the target",
    Math.abs(s.point.x - 0) < 1e-6 && Math.abs(s.point.z + 1000) < 1e-6,
    JSON.stringify(s.point));
  check("a stationary solution is solved", s.solved === true);

  // A CROSSING target: the pipper leads it, on the side it is moving toward.
  const crossing = createTarget({
    position: { x: 0, y: 0, z: -1000 },
    velocity: { x: 200, y: 0, z: 0 },
  });
  const c = leadSolution(origin, crossing);
  check("the lead on a crossing target is ahead of it", c.point.x > 0, `${c.point.x}`);
  check("the lead time is positive and short", c.time > 0 && c.time < 2, `${c.time}`);
  check(
    "the lead offset is about velocity x time",
    Math.abs(c.point.x - 200 * c.time) < 1e-6,
  );

  // It works for a target crossing the other way, symmetrically.
  const other = createTarget({
    position: { x: 0, y: 0, z: -1000 },
    velocity: { x: -200, y: 0, z: 0 },
  });
  check("the lead is symmetric", Math.abs(leadSolution(origin, other).point.x + c.point.x) < 1e-6);

  // A target with no velocity field at all must not throw -- the SAM case.
  const bare = { position: { x: 0, y: 0, z: -800 } };
  check("a target with no velocity resolves to itself",
    Math.abs(leadSolution(origin, bare).point.z + 800) < 1e-6);
}

function testMissileGuidance() {
  // A round fired at a stationary target ahead should hit.
  const events = [];
  const sys = createMissileSystem({ onEvent: (e) => events.push(e.kind) });
  const target = createTarget({ position: { x: 0, y: 0, z: -1500 }, radius: 9 });
  sys.fire({
    owner: "player",
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    speed: 250,
    target,
  });
  check("firing emits a fire event", events.includes("fire"));
  check("the round is in the air", sys.rounds.length === 1);

  for (let t = 0; t < 5 && sys.rounds.length; t += 1 / 60) sys.update(1 / 60, t);
  check("a straight shot hits", events.includes("hit"), events.join(","));

  // SEPARATION: the round flies straight before it guides, so it does not
  // appear to steer out of the cockpit on frame one.
  const sys2 = createMissileSystem({});
  const offset = createTarget({ position: { x: 900, y: 0, z: -900 } });
  const round = sys2.fire({
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    speed: 250,
    target: offset,
  });
  sys2.update(0.05, 0);
  check(
    "the round has not begun steering during separation",
    Math.abs(round.velocity.x) < 1e-9,
    `${round.velocity.x}`,
  );
  sys2.update(0.6, 0.6);
  check("the round steers after separation", Math.abs(round.velocity.x) > 1, `${round.velocity.x}`);

  // THE FUZE detonates within its radius and not outside it.
  const sys3 = createMissileSystem({ onEvent: () => {} });
  const near = createTarget({ position: { x: 0, y: 0, z: -30 }, radius: 0 });
  const r3 = sys3.fire({
    position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 },
    speed: 200, target: near,
  });
  // Several frames, not one: the round leaves the rail at ~315 m/s and covers
  // about 5 m per frame, so closing the last 8 m to the fuze radius takes more
  // than a single update. A one-frame version of this failed for that reason
  // and said nothing at all about the fuze.
  for (let t = 0; t < 0.3 && !r3.detonated; t += 1 / 60) sys3.update(1 / 60, t);
  check("the fuze fires inside its radius", r3.detonated === true, `${r3.detonated}`);

  const sys4 = createMissileSystem({});
  const wide = createTarget({ position: { x: 400, y: 0, z: -30 }, radius: 0 });
  const r4 = sys4.fire({
    position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 },
    speed: 200, target: wide,
  });
  for (let t = 0; t < 0.3; t += 1 / 60) sys4.update(1 / 60, t);
  check("the fuze does not fire outside its radius", r4.detonated !== true);

  // Lifetime expiry.
  const sys5 = createMissileSystem({ onEvent: (e) => events.push("e:" + e.reason) });
  sys5.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 }, target: null });
  for (let t = 0; t < 8; t += 1 / 60) sys5.update(1 / 60, t);
  check("a round with no target expires on its lifetime", sys5.rounds.length === 0);
}

function testOvershootNeedsAngleAndOpeningRange() {
  // THE SUBTLE RULE (§14). Angle alone falsely calls an overshoot on a round
  // still closing through a crossing geometry, and the round then coasts past
  // a target it would have hit.
  const closingWide = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: -800 },
  };
  const beside = createTarget({ position: { x: 900, y: 0, z: 30 } });
  // Well past the overshoot ANGLE, but the range is still closing.
  check(
    "a wide angle with a CLOSING range is not an overshoot",
    hasOvershot(closingWide, beside, -12) === false,
  );
  check(
    "a wide angle with an OPENING range is an overshoot",
    hasOvershot(closingWide, beside, +12) === true,
  );
  // A narrow angle is never an overshoot, whatever the range is doing.
  const ahead = createTarget({ position: { x: 0, y: 0, z: -900 } });
  check(
    "a target dead ahead is never an overshoot",
    hasOvershot(closingWide, ahead, +12) === false,
  );
  check("no target is never an overshoot", hasOvershot(closingWide, null, 5) === false);
}

function testDefeatedRoundKeepsFlying() {
  // A defeated round keeps flying its curve and can still get lucky on the
  // fuze, so a miss reads as a miss rather than as the round switching off.
  const sys = createMissileSystem({ authorityFor: () => 0 });
  const target = createTarget({ position: { x: 2000, y: 0, z: -2000 } });
  const round = sys.fire({
    position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 },
    speed: 300, target,
  });
  const before = { ...round.position };
  for (let t = 0; t < 1; t += 1 / 60) sys.update(1 / 60, t);
  check("a fully defeated round is still in the air", sys.rounds.length === 1);
  check(
    "a fully defeated round is still moving",
    Math.abs(round.position.z - before.z) > 100,
    `${round.position.z}`,
  );
  check(
    "authority is floored above zero, so the round still curves",
    round.authority > 0,
    `${round.authority}`,
  );
}

function testExpireOwner() {
  const sys = createMissileSystem({});
  const target = createTarget({ position: { x: 0, y: 0, z: -3000 } });
  sys.fire({ owner: "player", position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 }, target });
  sys.fire({ owner: "hostile", position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 }, target });
  sys.fire({ owner: "hostile", position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 }, target });
  check("three rounds are up", sys.rounds.length === 3);
  check("player has one", sys.countFor("player") === 1);

  const retired = sys.expireOwner("hostile");
  check("expireOwner retires only that owner", retired === 2 && sys.rounds.length === 1);
  check("the player's round is untouched", sys.countFor("player") === 1);
  check("expiring an unknown owner retires nothing", sys.expireOwner("sam") === 0);
}

function testMissileTurnRadius() {
  // §14's fairness claim is stated in radii: the F-15 turns at 1000 m at
  // 250 m/s, so a hard crossing manoeuvre must be able to defeat these.
  const r = turnRadius(AIM9);
  check(
    "the AIM-9 turn radius is in §14's expected range",
    r > 850 && r < 1000,
    `${r.toFixed(0)} m`,
  );
  check(
    "the AIM-9 is out-turnable by the F-15 at the top of its envelope",
    r >= TURN_RADIUS_REF * 0.85,
    `missile ${r.toFixed(0)} vs aircraft ${TURN_RADIUS_REF}`,
  );
}

function testGunMagazineAndFx() {
  const hits = [];
  const gun = createGun({ onHit: (t) => hits.push(t) });
  check("the magazine starts full", gun.rounds === 500);

  const target = createTarget({ position: { x: 0, y: 0, z: -600 }, radius: 9, health: 1e6 });
  gun.update(0.5, {
    firing: true,
    origin: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    candidates: [target],
  });
  check("holding the trigger spends rounds", gun.rounds < 500, `${gun.rounds}`);
  check("rounds on target register hits", hits.length > 0, `${hits.length}`);
  check("tracers are drawn for some rounds, not all",
    gun.tracers.length > 0 && gun.tracers.length < 500 - gun.rounds,
    `${gun.tracers.length} tracers for ${500 - gun.rounds} rounds`);

  // A target off the nose is not hit.
  const gun2 = createGun({ onHit: () => hits.push("wide") });
  const wide = createTarget({ position: { x: 900, y: 0, z: -600 }, radius: 9 });
  const before = hits.length;
  gun2.update(0.5, {
    firing: true, origin: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 }, candidates: [wide],
  });
  check("a target well off the nose is not hit", hits.length === before);

  // THE SEPARATION THAT MATTERS: clearFx() does not touch ammunition;
  // reset() does. Conflating them silently disarms the player at every phase
  // change in stage 7.
  const spent = gun.rounds;
  gun.clearFx();
  check("clearFx removes the tracers", gun.tracers.length === 0);
  check("clearFx does NOT touch the ammunition", gun.rounds === spent, `${gun.rounds}`);
  gun.reset();
  check("reset reloads the magazine", gun.rounds === 500);

  // Empty means empty.
  const gun3 = createGun({ magazine: 3 });
  gun3.update(5, {
    firing: true, origin: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 }, candidates: [],
  });
  check("the magazine empties", gun3.rounds === 0 && gun3.isEmpty() === true);
  gun3.update(5, {
    firing: true, origin: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 }, candidates: [],
  });
  check("an empty gun cannot go negative", gun3.rounds === 0);
}

// ── stage 6: an enemy that fights back ────────────────────────────────────

const AI = (over = {}) => ({
  state: "PATROL", stateTime: 0, lockTimer: 0, lockCue: 0,
  defendCooldown: 0, ammo: 2, ...over,
});
const CTX = (over = {}) => ({
  alive: true, playerAlive: true, ready: true,
  range: 1500, inCone: true, lockCue: 0, ...over,
});

function testHostileTransitionTable() {
  const T = hostileTransition;

  // Death wins from EVERY state, and DESTROYED is terminal.
  for (const state of ["PATROL", "PURSUIT", "ACQUIRE", "ATTACK", "COOLDOWN", "REPOSITION", "DEFEND"]) {
    check(
      `death wins from ${state}`,
      T(AI({ state }), CTX({ alive: false })) === "DESTROYED",
    );
  }
  check(
    "DESTROYED is terminal even if it somehow revives",
    T(AI({ state: "DESTROYED" }), CTX({ alive: true })) === "DESTROYED",
  );

  // Not ready, or no player: back to PATROL.
  check("an unready hostile patrols", T(AI({ state: "PURSUIT" }), CTX({ ready: false })) === "PATROL");
  check("a dead player is not pursued", T(AI({ state: "ACQUIRE" }), CTX({ playerAlive: false })) === "PATROL");

  // PATROL -> PURSUIT on detection, and back out beyond it.
  check("PATROL holds beyond detection", T(AI({ state: "PATROL" }), CTX({ range: 9000 })) === "PATROL");
  check("PATROL promotes inside detection", T(AI({ state: "PATROL" }), CTX({ range: 4000 })) === "PURSUIT");
  check("PURSUIT drops beyond detection", T(AI({ state: "PURSUIT" }), CTX({ range: 9000 })) === "PATROL");

  // PURSUIT -> ACQUIRE only in the cone AND with a round.
  check("PURSUIT holds outside the cone", T(AI({ state: "PURSUIT" }), CTX({ inCone: false })) === "PURSUIT");
  check("PURSUIT promotes in the cone", T(AI({ state: "PURSUIT" }), CTX({ inCone: true })) === "ACQUIRE");

  // ACQUIRE -> ATTACK on a completed lock; falls back out of the cone.
  check(
    "ACQUIRE holds while the lock builds",
    T(AI({ state: "ACQUIRE", lockTimer: 0.5 }), CTX()) === "ACQUIRE",
  );
  check(
    "ACQUIRE promotes on a completed lock",
    T(AI({ state: "ACQUIRE", lockTimer: 1.3 }), CTX()) === "ATTACK",
  );
  check(
    "ACQUIRE falls back when the player leaves the cone",
    T(AI({ state: "ACQUIRE", lockTimer: 1.3 }), CTX({ inCone: false })) === "PURSUIT",
  );

  // ATTACK -> COOLDOWN -> REPOSITION -> PURSUIT.
  check("ATTACK holds before the launch delay", T(AI({ state: "ATTACK", stateTime: 0.2 }), CTX()) === "ATTACK");
  check("ATTACK launches after the delay", T(AI({ state: "ATTACK", stateTime: 0.6 }), CTX()) === "COOLDOWN");
  check("COOLDOWN holds", T(AI({ state: "COOLDOWN", stateTime: 3 }), CTX()) === "COOLDOWN");
  check("COOLDOWN releases after 7 s", T(AI({ state: "COOLDOWN", stateTime: 7.1 }), CTX()) === "REPOSITION");
  check("REPOSITION returns to PURSUIT", T(AI({ state: "REPOSITION", stateTime: 5 }), CTX()) === "PURSUIT");

  // The transition function is PURE: it must not mutate what it is handed.
  const ai = AI({ state: "PURSUIT" });
  const before = JSON.stringify(ai);
  T(ai, CTX());
  check("the transition function does not mutate the ai", JSON.stringify(ai) === before);
}

function testAmmoZeroIsTheDesignTool() {
  // §12: "it chases you but does not shoot back yet" must need NO new state
  // and NO special case -- the table already refuses to promote without a
  // round. A perfect firing position with an empty magazine stays in PURSUIT.
  const perfect = CTX({ range: 1200, inCone: true });
  check(
    "ammo 0 cannot reach ACQUIRE from a perfect firing position",
    hostileTransition(AI({ state: "PURSUIT", ammo: 0 }), perfect) === "PURSUIT",
  );
  check(
    "ammo 0 falls out of ACQUIRE",
    hostileTransition(AI({ state: "ACQUIRE", ammo: 0, lockTimer: 9 }), perfect) === "PURSUIT",
  );
  check(
    "one round is enough to promote",
    hostileTransition(AI({ state: "PURSUIT", ammo: 1 }), perfect) === "ACQUIRE",
  );
  // And it still pursues -- being harmless is not being passive.
  check(
    "an unarmed hostile still pursues",
    hostileTransition(AI({ state: "PATROL", ammo: 0 }), perfect) === "PURSUIT",
  );
}

function testDefendRules() {
  const T = hostileTransition;
  const cfg = HOSTILE_CFG;

  // A FLEETING lock provokes nothing.
  check(
    "a lock held briefly does not provoke a break",
    T(AI({ state: "PURSUIT" }), CTX({ lockCue: 0.3 })) === "ACQUIRE",
  );
  check(
    "a lock held past the reaction delay provokes a break",
    T(AI({ state: "PURSUIT" }), CTX({ lockCue: cfg.defendReaction + 0.01 })) === "DEFEND",
  );

  // A COMMITTED ATTACK IS NEVER INTERRUPTIBLE. 0.55 s from lock to launch, and
  // a hostile that could be talked out of a shot would never land one.
  check(
    "a committed ATTACK ignores the player's lock",
    T(AI({ state: "ATTACK", stateTime: 0.2 }), CTX({ lockCue: 5 })) === "ATTACK",
  );
  check(
    "a committed ATTACK still completes its launch",
    T(AI({ state: "ATTACK", stateTime: 0.9 }), CTX({ lockCue: 5 })) === "COOLDOWN",
  );

  // A sustained lock cannot CHAIN breaks inside the cooldown -- otherwise it
  // becomes a permanent evasion loop the player can never shoot it out of.
  check(
    "a break on cooldown is refused",
    T(AI({ state: "PURSUIT", defendCooldown: 3 }), CTX({ lockCue: 5 })) === "ACQUIRE",
  );
  check(
    "DEFEND runs its full 2.8 s",
    T(AI({ state: "DEFEND", stateTime: 1.4 }), CTX({ lockCue: 5 })) === "DEFEND",
  );
  check(
    "DEFEND ends in REPOSITION",
    T(AI({ state: "DEFEND", stateTime: 3 }), CTX({ lockCue: 0 })) === "REPOSITION",
  );
}

function testBreakDirectionIsLatched() {
  // THE TEST THAT CATCHES AN UNLATCHED DIRECTION. Recomputing which way to
  // turn every frame flips the cross product as the aircraft turns, and the
  // break oscillates to a net heading change of nothing.
  const h = createHostile();
  h.deploy({ at: { x: 900, y: 1200, z: -2500 }, heading: 0, ammo: 2 });
  const player = createFlightState({ position: { x: 0, y: 1200, z: 0 } });

  // Hold a completed lock until it breaks.
  let broke = false;
  for (let t = 0; t < 3 && !broke; t += 1 / 60) {
    h.update(1 / 60, { playerState: player, playerLockedOnMe: true });
    if (h.ai.state === "DEFEND") broke = true;
  }
  check("a held lock makes it break", broke, h.ai.state);
  const latched = h.ai.breakSign;
  const headingAtEntry = h.ai.heading;

  for (let t = 0; t < 2.6; t += 1 / 60) {
    h.update(1 / 60, { playerState: player, playerLockedOnMe: true });
  }
  check("the latched direction never changed", h.ai.breakSign === latched, `${h.ai.breakSign}`);
  const swept = Math.abs(wrapAngle(h.ai.heading - headingAtEntry));
  check(
    "the break changes heading by a meaningful amount",
    swept > 0.5,
    `${((swept * 180) / Math.PI).toFixed(1)} deg`,
  );
}

function testAltitudeGuard() {
  // It must NEVER fly into the sea, including through a diving break.
  const h = createHostile();
  h.deploy({ at: { x: 400, y: 320, z: -2000 }, heading: 0, ammo: 2 });
  // A player far below, so every steering instinct points it downward.
  const player = createFlightState({ position: { x: 0, y: 5, z: 0 } });
  let lowest = Infinity;
  for (let t = 0; t < 25; t += 1 / 60) {
    h.update(1 / 60, { playerState: player, playerLockedOnMe: t > 4 && t < 9 });
    lowest = Math.min(lowest, h.target.position.y);
  }
  check(
    "the hostile never descends below its floor",
    lowest >= HOSTILE_CFG.minAltitude - 1e-6,
    `lowest ${lowest.toFixed(1)} vs floor ${HOSTILE_CFG.minAltitude}`,
  );
  check("it did get pushed down toward the floor", lowest < 400, `${lowest.toFixed(1)}`);
}

function testInactiveMeansInactive() {
  const h = createHostile();
  h.deploy({ at: { x: 500, y: 1000, z: -3000 }, heading: 0, ammo: 2 });
  h.setActive(false);
  const before = { ...h.target.position };
  const player = createFlightState({ position: { x: 0, y: 1000, z: 0 } });
  for (let t = 0; t < 10; t += 1 / 60) {
    h.update(1 / 60, { playerState: player, playerLockedOnMe: true });
  }
  const moved = Math.hypot(
    h.target.position.x - before.x,
    h.target.position.y - before.y,
    h.target.position.z - before.z,
  );
  check("ten seconds of updates on an inactive hostile moves it zero metres", moved === 0, `${moved}`);
  check("an inactive hostile reports itself inactive", h.isActive() === false);
  check("an inactive hostile does not change state", h.ai.state === "PATROL");
}

function testDeployAndSpent() {
  const h = createHostile();
  check("a fresh hostile has no encounters", h.ai.encounters === 0);

  h.deploy({ at: { x: 100, y: 900, z: -1000 }, heading: 1, ammo: 2 });
  check("deploy counts the encounter", h.ai.encounters === 1);
  check("deploy arms it", h.ai.ammo === 2);
  check("deploy positions it", h.target.position.x === 100 && h.target.position.z === -1000);
  check("deploy activates it", h.isActive() === true);

  // Kill it, then redeploy: it must REVIVE, and the count must survive the
  // internal reset -- that count is what alternates which side it appears on.
  h.target.alive = false;
  h.target.health = 0;
  h.ai.ammo = 0;
  h.deploy({ at: { x: -400, y: 1200, z: -5000 }, heading: 2, ammo: 1 });
  check("deploy revives it", h.target.alive === true && h.target.health === h.target.maxHealth);
  check("deploy re-arms it", h.ai.ammo === 1);
  check("deploy repositions it", h.target.position.x === -400);
  check("the encounter count SURVIVES the reset", h.ai.encounters === 2, `${h.ai.encounters}`);

  // `spent` is true only when the magazine is empty AND nothing is in the air.
  check("armed is not spent", h.spent(0) === false);
  h.ai.ammo = 0;
  check("empty with a round still flying is NOT spent", h.spent(1) === false);
  check("empty with nothing in the air IS spent", h.spent(0) === true);
}

function testHostileRoundFairness() {
  // §14: the fairness claim is the turn RADIUS. It must stay comparable to the
  // F-15's arcade turn at 250 m/s, which is what makes a hard crossing
  // manoeuvre defeat the round with no countermeasure at all.
  const r = turnRadius(HOSTILE_MISSILE);
  check(
    "the hostile round's turn radius is near §14's ~904 m",
    r > 800 && r < 1000,
    `${r.toFixed(0)} m`,
  );
  check(
    "a hard crossing manoeuvre can defeat it: radius >= the aircraft's",
    r >= TURN_RADIUS_REF * 0.85,
    `round ${r.toFixed(0)} vs aircraft ${TURN_RADIUS_REF}`,
  );
  check(
    "the hostile round is slower and turns wider than the AIM-9",
    HOSTILE_MISSILE.maxSpeed < AIM9.maxSpeed &&
      HOSTILE_MISSILE.turnRate < AIM9.turnRate,
  );
  check(
    "it is the SAME implementation, differing only as data",
    HOSTILE_MISSILE.name !== AIM9.name &&
      typeof HOSTILE_MISSILE.fuze === "number",
  );
}

function testThreatEscalation() {
  const monitor = createThreatMonitor();
  const at = { position: { x: 0, y: 1000, z: 0 } };

  check("nothing is a threat at rest", monitor.update(1 / 60, at, [], []).level === "NONE");

  const tracking = [{ level: "TRACK", position: { x: 0, y: 1000, z: -4000 }, progress: 0.3 }];
  check("an acquisition escalates to TRACK", monitor.update(1 / 60, at, tracking, []).level === "TRACK");

  const locking = [{ level: "LOCK", position: { x: 0, y: 1000, z: -3000 }, progress: 1 }];
  check("a lock outranks a track", monitor.update(1 / 60, at, locking, []).level === "LOCK");

  // A LIVE ROUND ALWAYS OUTRANKS AN ACQUISITION -- it is the only one of the
  // two the player cannot ignore.
  const round = {
    owner: "hostile", position: { x: 0, y: 1000, z: -900 },
    config: { name: "HOSTILE", fuze: 8 },
  };
  const s = monitor.update(1 / 60, at, locking, [round]);
  check("a live round outranks any acquisition", s.level === "MISSILE", s.level);

  // The player's own round is never a threat to the player.
  const mine = { owner: "player", position: { x: 0, y: 1000, z: -400 }, config: { name: "AIM-9" } };
  check(
    "the player's own round is not a threat",
    monitor.update(1 / 60, at, [], [mine]).level === "NONE",
  );

  // Two acquisitions at once: the CLOSER one is named. A site at 900 m is more
  // urgent than a fighter tracking from 4 km.
  const m2 = createThreatMonitor();
  const near = { level: "LOCK", position: { x: 0, y: 1000, z: -900 }, origin: "sam", label: "SAM" };
  const far = { level: "LOCK", position: { x: 0, y: 1000, z: -4000 }, label: "HOSTILE" };
  const picked = m2.update(1 / 60, at, [far, near], []);
  check("with two equal acquisitions the closer is named", picked.source === near, picked.source?.label);
  check("the label carries the origin", picked.label === "SAM LOCK", picked.label);
}

function testAuthorityHook() {
  const evasion = createEvasion();
  const hostileRound = { owner: "hostile", config: HOSTILE_MISSILE };
  const playerRound = { owner: "player", config: AIM9 };

  check("no roll means full authority", authorityFor(hostileRound, evasion) === 1);

  check("the roll is a latched request", evasion.request("ASSISTED") === true);
  check("a second request while rolling is refused", evasion.request("ASSISTED") === false);
  check("the roll is running", evasion.isRolling() === true);

  const degraded = authorityFor(hostileRound, evasion);
  check("the roll degrades an incoming round", degraded < 1, `${degraded}`);
  // NEVER TO ZERO: a defeated round keeps flying its curve and can still get
  // lucky on the fuze, so a miss reads as a miss.
  check("authority is never reduced to zero", degraded > 0, `${degraded}`);

  // AND IT NEVER AFFECTS THE PLAYER'S OWN ROUNDS.
  check("the roll does not affect the player's own rounds", authorityFor(playerRound, evasion) === 1);

  // Expert gets a tighter window: finer control, so the timing is worth more.
  const e2 = createEvasion();
  e2.request("EXPERT");
  check("Expert's window is tighter than Assisted's", e2.window() < EVADE_WINDOW.ASSISTED);
  check("the Assisted window is 0.60 s", EVADE_WINDOW.ASSISTED === 0.6);
  check("the Expert window is 0.42 s", EVADE_WINDOW.EXPERT === 0.42);

  // The window expires.
  for (let t = 0; t < 1; t += 1 / 60) evasion.update(1 / 60);
  check("the roll window expires", evasion.isRolling() === false);
  check("authority returns to full", authorityFor(hostileRound, evasion) === 1);

  // wouldHaveHit: only a miss that WAS going to connect is worth announcing.
  const onTarget = {
    position: { x: 0, y: 0, z: -400 }, velocity: { x: 0, y: 0, z: 400 },
    config: { fuze: 8 },
  };
  check("a round on a collision course would have hit", wouldHaveHit(onTarget, { x: 0, y: 0, z: 0 }));
  const wide = {
    position: { x: 900, y: 0, z: -400 }, velocity: { x: 0, y: 0, z: 400 },
    config: { fuze: 8 },
  };
  check("a round passing wide would not have hit", wouldHaveHit(wide, { x: 0, y: 0, z: 0 }) === false);
  const receding = {
    position: { x: 0, y: 0, z: 400 }, velocity: { x: 0, y: 0, z: 400 },
    config: { fuze: 8 },
  };
  check("a round already past is not a would-have-hit", wouldHaveHit(receding, { x: 0, y: 0, z: 0 }) === false);
}

function testDamageResponseFiresOnce() {
  const feedback = [];
  const damage = createDamageResponse({ onFeedback: (e) => feedback.push(e) });
  const event = playerDamageEvent({
    source: "missile", at: 1, position: { x: 0, y: 0, z: 0 },
    amount: 55, owner: "hostile",
  });

  check("the first hit is handled", damage.handle(event) === true);
  check("feedback fired once", feedback.length === 1);

  // A 22 m proximity fuze can trip on CONSECUTIVE FRAMES, and a re-entrant
  // response loops forever. Everything arriving while holding or in cooldown
  // is swallowed.
  check("a same-frame re-entry is swallowed", damage.handle(event) === false);
  check("no second feedback", feedback.length === 1);
  for (let t = 0; t < 0.5; t += 1 / 60) damage.tick(1 / 60);
  check("still swallowed during the hold", damage.handle(event) === false);
  check("the veil is showing during the hold", damage.veil() > 0);

  for (let t = 0; t < 1.6; t += 1 / 60) damage.tick(1 / 60);
  check("the veil clears", damage.veil() === 0);
  check("a later hit is handled again", damage.handle(event) === true);
  check("the tally counted both", damage.hitsTaken() === 2);

  // The event carries what a response needs and is a COPY of the position.
  const captured = damage.lastEvent();
  for (const field of ["source", "at", "position", "amount", "owner"]) {
    check(`the damage event carries ${field}`, field in captured);
  }
  // Presentation resets; the tally does not (§17.11).
  damage.reset();
  check("reset clears the presentation", damage.veil() === 0);
  check("reset does NOT clear the tally", damage.hitsTaken() === 2);
  damage.resetAll();
  check("resetAll clears the tally", damage.hitsTaken() === 0);
}

// ── stage 7: the sortie ───────────────────────────────────────────────────
//
// The dangerous thing in this stage is anything with a STORED POSITION -- a
// checkpoint captured in one place and restored into different terrain -- and
// that is only testable against a synthetic height field with no scene.

const MCTX = (over = {}) => ({
  fired: false, handedOff: false, legReached: false, killedAt: null,
  magazineSpent: false, cinematicDone: false, phaseTime: 0, ...over,
});

function testMissionTransitionTable() {
  const T = missionTransition;

  check("DECK waits for the catapult", T({ phase: DECK }, MCTX()) === DECK);
  check("DECK advances when it fires", T({ phase: DECK }, MCTX({ fired: true })) === LAUNCH);
  check("LAUNCH waits for the handoff", T({ phase: LAUNCH }, MCTX()) === LAUNCH);
  check("LAUNCH advances on the handoff", T({ phase: LAUNCH }, MCTX({ handedOff: true })) === EGRESS);
  check("EGRESS waits for its waypoint", T({ phase: EGRESS }, MCTX({ phaseTime: 10 })) === EGRESS);
  check("EGRESS advances on the waypoint", T({ phase: EGRESS }, MCTX({ legReached: true })) === INTERCEPT);

  // THE FLOORS ARE REQUIRED, NOT DECORATIVE. Without them the combat phases end
  // in about twelve seconds: the coastline volume that serves as their "next
  // region" is close enough that flying straight through clears both
  // encounters before either reads as one.
  check(
    "INTERCEPT will not advance below its floor even at the waypoint",
    T({ phase: INTERCEPT }, MCTX({ legReached: true, phaseTime: 10 })) === INTERCEPT,
  );
  check(
    "INTERCEPT advances at the waypoint above its floor",
    T({ phase: INTERCEPT }, MCTX({ legReached: true, phaseTime: 30 })) === DEFENSIVE,
  );
  // The KILL floor is much shorter: an encounter the player WON should not
  // hold them -- it only needs to let the explosion land.
  check(
    "a kill shortens the floor to 6 s",
    T({ phase: INTERCEPT }, MCTX({ killedAt: 8, phaseTime: 14.1 })) === DEFENSIVE,
  );
  check(
    "a kill still respects its own 6 s",
    T({ phase: INTERCEPT }, MCTX({ killedAt: 8, phaseTime: 11 })) === INTERCEPT,
  );

  // DEFENSIVE also advances on a spent magazine.
  check(
    "DEFENSIVE advances on a spent magazine",
    T({ phase: DEFENSIVE }, MCTX({ magazineSpent: true, phaseTime: 35 })) === TERRAIN,
  );

  check("TERRAIN advances on its last leg", T({ phase: TERRAIN }, MCTX({ legReached: true })) === FINAL);
  check("FINAL advances on the seaward leg", T({ phase: FINAL }, MCTX({ legReached: true })) === EXTRACTION);
  check(
    "EXTRACTION waits for the cinematic",
    T({ phase: EXTRACTION }, MCTX({ phaseTime: 5 })) === EXTRACTION,
  );
  check(
    "EXTRACTION completes when the cinematic ends",
    T({ phase: EXTRACTION }, MCTX({ cinematicDone: true })) === COMPLETE,
  );
  check("COMPLETE is terminal", T({ phase: COMPLETE }, MCTX({ legReached: true })) === COMPLETE);

  // EVERY PHASE NEEDS A TIME FALLBACK (§17.10). No combination of missed shots
  // or ignored enemies may soft-lock a sortie.
  for (const [phase, next] of [
    [EGRESS, INTERCEPT], [INTERCEPT, DEFENSIVE], [DEFENSIVE, TERRAIN],
    [TERRAIN, FINAL], [FINAL, EXTRACTION], [EXTRACTION, COMPLETE],
  ]) {
    const fallback = PHASES[phase].fallback;
    check(
      `${phase} has a finite fallback`,
      Number.isFinite(fallback),
      `${fallback}`,
    );
    check(
      `${phase} falls through on time alone`,
      T({ phase }, MCTX({ phaseTime: fallback + 0.1 })) === next,
    );
  }

  // The transition function is PURE.
  const m = { phase: INTERCEPT };
  const before = JSON.stringify(m);
  T(m, MCTX({ phaseTime: 99 }));
  check("missionTransition does not mutate the mission", JSON.stringify(m) === before);
}

function testTriggerVolumes() {
  const v = { name: "TEST", x: 100, z: -2000, radius: 1300 };
  check("dead centre is inside", inVolume(v, { x: 100, y: 900, z: -2000 }));
  check("50 m off-line still counts", inVolume(v, { x: 150, y: 900, z: -2000 }));
  check("just inside the rim counts", inVolume(v, { x: 100 + 1290, y: 900, z: -2000 }));
  check("just outside does not", inVolume(v, { x: 100 + 1310, y: 900, z: -2000 }) === false);

  // ALTITUDE MUST NOT GATE A ROUTE WAYPOINT: a player flying the whole sortie
  // on the deck still progresses.
  check("altitude does not gate a route waypoint at 30 m", inVolume(v, { x: 100, y: 30, z: -2000 }));
  check("nor at 9 km", inVolume(v, { x: 100, y: 9000, z: -2000 }));

  // The recovery volume is the ONLY one with a band: arriving home at 12 km is
  // not arriving home.
  const rec = { name: "RECOVERY", x: 0, z: -1200, radius: 2400, band: { min: 80, max: 3800 } };
  check("the recovery band admits a sane altitude", inVolume(rec, { x: 0, y: 600, z: -1200 }));
  check("the recovery band rejects the deck", inVolume(rec, { x: 0, y: 20, z: -1200 }) === false);
  check("the recovery band rejects the stratosphere", inVolume(rec, { x: 0, y: 9000, z: -1200 }) === false);

  // §7: "Assert that INTERCEPT and COASTLINE do not overlap. This check exists
  // because they did touch." If they touch, entering the intercept area
  // instantly satisfies "reached the next region" for a fight that has not
  // started.
  const route = buildRoute({ carrierZ: -1600, coastZ: -7600, sampleHeight: null });
  const byName = Object.fromEntries(route.legs.map((l) => [l.name, l]));
  check(
    "INTERCEPT and COASTLINE volumes do not overlap",
    volumesOverlap(byName.INTERCEPT, byName.COASTLINE) === false,
    `gap ${(Math.abs(byName.INTERCEPT.z - byName.COASTLINE.z) - byName.INTERCEPT.radius - byName.COASTLINE.radius).toFixed(0)} m`,
  );
  check("volumesOverlap detects an actual overlap", volumesOverlap(
    { x: 0, z: 0, radius: 100 }, { x: 0, z: 150, radius: 100 },
  ) === true);
}

// A synthetic height field: a genuine pass (low ground with high ground BOTH
// sides) at x = -2000, and a one-sided coastal slope at x = +3000 that a
// stronger-flank score would wrongly prefer.
function syntheticTerrain(x, z) {
  const pass = 600 - 520 * Math.exp(-((x + 2000) ** 2) / (2 * 700 ** 2));
  const slope = Math.max(0, Math.min(900, (x - 1500) * 0.35));
  return Math.max(pass, slope);
}

function testBandFeatureUsesTheWeakerFlank() {
  // A genuine pass: high, low, high.
  const pass = bandFeature([500, 500, 80, 500, 500], 2);
  check("a genuine pass scores positively", pass.score > 300, `${pass.score}`);
  check("the pass is found at its centre", pass.index === 2, `${pass.index}`);

  // A ONE-SIDED SLOPE: high on the left, sea level on the right. A score using
  // the STRONGER flank would rate this as highly as the pass; using the weaker
  // one rates it at zero, which is the whole point.
  const slope = bandFeature([900, 900, 80, 0, 0], 2);
  check(
    "a one-sided slope scores at or below zero",
    slope.score <= 0,
    `${slope.score}`,
  );
  check(
    "the genuine pass beats the one-sided slope",
    pass.score > slope.score,
    `pass ${pass.score} vs slope ${slope.score}`,
  );

  // And on the synthetic field, the surveyed waypoint must land on the pass
  // side rather than out on the coastal slope.
  const route = surveyTerrainRoute(syntheticTerrain, 0, { rows: 9, cols: 41, span: 4 });
  check("the survey returns three legs", route.length === 3, `${route.length}`);
  check(
    "every surveyed leg sits on the pass, not the one-sided slope",
    route.every((leg) => leg.x < 0),
    route.map((l) => l.x.toFixed(0)).join(", "),
  );

  check("a band too short to have flanks yields nothing", bandFeature([1, 2], 3) === null);
}

function testZoningSpreadsAClusteredField() {
  // ZONE BEFORE SCORING. Greedy scoring alone clusters: the deepest passes
  // tend to sit in one massif, leaving most of the corridor without a
  // waypoint and the route doubling back on itself.
  //
  // This field puts the three BEST scores adjacent at the start, so pure
  // scoring would take all three from one place.
  const bands = [];
  for (let i = 0; i < 30; i++) {
    const score = i < 3 ? 900 - i : 100 + (i % 7);
    bands.push({ z: -i * 300, feature: { index: 5, score, centre: 0 } });
  }
  const picked = pickZonedFeatures(bands, 3);
  check("zoning returns one feature per third", picked.length === 3);
  const zones = picked.map((b) => Math.floor(bands.indexOf(b) / 10));
  check(
    "the three picks land in three different thirds",
    new Set(zones).size === 3,
    `zones ${zones.join(",")}`,
  );
  // Pure greedy would have taken indices 0, 1, 2 -- all in the first third.
  check(
    "zoning did NOT take all three from the cluster",
    !(bands.indexOf(picked[1]) < 3 && bands.indexOf(picked[2]) < 3),
  );
  check("an empty field yields nothing", pickZonedFeatures([], 3).length === 0);
}

function testRoutePlan() {
  const surveyed = buildRoute({
    carrierZ: -1600, coastZ: -7600, sampleHeight: syntheticTerrain,
  });
  check("a surveyed route is marked surveyed", surveyed.surveyed === true);
  check("the route has eight legs", surveyed.legs.length === 8, `${surveyed.legs.length}`);

  // Every navigating phase gets at least one leg.
  for (const phase of [EGRESS, INTERCEPT, DEFENSIVE, TERRAIN, FINAL, EXTRACTION]) {
    check(
      `${phase} has at least one leg`,
      surveyed.legs.some((l) => l.phase === phase),
    );
  }
  check("TERRAIN has three legs", surveyed.legs.filter((l) => l.phase === TERRAIN).length === 3);

  // The legs run inland then back out to sea, in order.
  const zs = surveyed.legs.map((l) => l.z);
  check("the route runs inland", zs[3] < zs[0], `${zs[0]} -> ${zs[3]}`);
  check("and turns back out to sea", zs[7] > zs[5], `${zs[5]} -> ${zs[7]}`);

  // Terrain anchors clear the ground they sit over.
  for (const leg of surveyed.legs.filter((l) => l.phase === TERRAIN)) {
    check(
      `${leg.name} sits over ground it can clear`,
      leg.ground < 700,
      `${leg.ground?.toFixed(0)}`,
    );
  }

  // A NO-TERRAIN BUILD STILL GETS A FULL ROUTE. The mission must remain
  // completable when the asset failed to load.
  const authored = buildRoute({ carrierZ: -1600, coastZ: -7600, sampleHeight: null });
  check("a no-terrain build is marked authored", authored.surveyed === false);
  check("a no-terrain build still has eight legs", authored.legs.length === 8);
  check(
    "a no-terrain build still has three inland legs",
    authored.legs.filter((l) => l.phase === TERRAIN).length === 3,
  );
}

// A point aircraft that simply flies to whatever leg it is given.
function flyMission({ ignoreCombat = false, failAt = null } = {}) {
  const route = buildRoute({ carrierZ: -1600, coastZ: -7600, sampleHeight: syntheticTerrain });
  const seen = [];
  const mission = createMission({ route, onPhase: (to) => seen.push(to) });
  const position = { x: 0, y: 900, z: -1600 };
  let extraction = 0;
  let failed = false;

  const dt = 1 / 30;
  for (let t = 0; t < 400; t += dt) {
    const leg = mission.currentLeg();
    if (leg) {
      // Fly straight at the current leg at a plausible speed.
      const dx = leg.x - position.x;
      const dz = leg.z - position.z;
      const d = Math.hypot(dx, dz) || 1;
      position.x += (dx / d) * 210 * dt;
      position.z += (dz / d) * 210 * dt;
      position.y = leg.band ? 600 : 900;
    }
    if (mission.mission.phase === EXTRACTION) extraction += dt;

    // A kill in the combat phases, unless combat is being ignored entirely.
    if (
      !ignoreCombat &&
      (mission.mission.phase === INTERCEPT || mission.mission.phase === DEFENSIVE) &&
      mission.mission.phaseTime > 4 &&
      mission.mission.killedAt === null
    ) {
      mission.noteKill("air");
    }

    if (failAt && !failed && mission.mission.phase === failAt) {
      failed = true;
      // A failure in the middle: the checkpoint restore puts the aircraft
      // back, but the mission must still reach COMPLETE.
      mission.addCheckpoint(
        captureCheckpoint(
          { position, heading: 0, pitch: 0.4, bank: 0.9, speed: 240, throttle: 0.6, sink: 3, mode: "ASSISTED", afterburner: false, quat: { x: 0, y: 0, z: 0, w: 1 } },
          { groundAhead: 500, weapon: "GUN", missiles: 1, gunRounds: 220, phase: failAt },
        ),
      );
    }

    mission.update(dt, {
      position,
      fired: t > 1,
      handedOff: t > 2,
      magazineSpent: ignoreCombat,
      cinematicDone: extraction >= 7.2,
    });
    if (mission.mission.phase === COMPLETE) break;
  }
  return { mission, seen, position };
}

function testEndToEndMissions() {
  // 1. A direct run.
  const direct = flyMission();
  check("a direct run completes", direct.mission.mission.phase === COMPLETE, direct.seen.join(" -> "));
  check(
    "a direct run visits the phases in order",
    direct.seen.join(",") === [LAUNCH, EGRESS, INTERCEPT, DEFENSIVE, TERRAIN, FINAL, EXTRACTION, COMPLETE].join(","),
    direct.seen.join(","),
  );

  // 2. IGNORING ALL COMBAT still completes the mission. This is the run that
  // proves no combination of missed shots or ignored enemies soft-locks it.
  const pacifist = flyMission({ ignoreCombat: true });
  check(
    "ignoring combat entirely still completes",
    pacifist.mission.mission.phase === COMPLETE,
    pacifist.seen.join(" -> "),
  );
  check(
    "the pacifist run recorded no kills",
    pacifist.mission.mission.stats.airKills === 0,
  );

  // 3. A failure in the middle still completes.
  const failed = flyMission({ failAt: TERRAIN });
  check(
    "a failure in the middle still completes",
    failed.mission.mission.phase === COMPLETE,
    failed.seen.join(" -> "),
  );

  // Four checkpoints in a run that records them at the boundaries.
  const cps = flyMission();
  for (const phase of [LAUNCH, INTERCEPT, TERRAIN, FINAL]) {
    cps.mission.addCheckpoint({ phase, snapshot: {}, weapon: "AIM-9", missiles: 2, gunRounds: 500 });
  }
  check("four checkpoints are recorded", cps.mission.mission.checkpoints.length === 4);
  check("the latest checkpoint is the last recorded", cps.mission.latestCheckpoint().phase === FINAL);

  // A LATER PHASE'S VOLUME CANNOT PULL THE MISSION FORWARD: only the current
  // leg is checked.
  const route = buildRoute({ carrierZ: -1600, coastZ: -7600, sampleHeight: syntheticTerrain });
  const skipper = createMission({ route });
  const recovery = route.legs[route.legs.length - 1];
  for (let i = 0; i < 60; i++) {
    skipper.update(1 / 30, {
      position: { x: recovery.x, y: 600, z: recovery.z },
      fired: false, handedOff: false, magazineSpent: false, cinematicDone: false,
    });
  }
  check(
    "sitting inside the LAST volume does not skip the route",
    skipper.mission.legIndex === 0,
    `legIndex ${skipper.mission.legIndex}`,
  );
  check("and the phase is still DECK", skipper.mission.phase === DECK);
}

function testMissionClock() {
  const route = buildRoute({ carrierZ: -1600, coastZ: -7600, sampleHeight: null });
  const m = createMission({ route });
  check("the clock is not running on the deck", m.mission.running === false);
  m.update(1, { position: { x: 0, y: 20, z: -1600 }, fired: false, handedOff: false });
  check("the clock stays at zero before the catapult", m.elapsed() === 0);

  // THE CLOCK STARTS AT THE CATAPULT, stated in exactly one place.
  m.update(1 / 30, { position: { x: 0, y: 20, z: -1600 }, fired: true, handedOff: false });
  check("the catapult starts the clock", m.mission.running === true);
  for (let i = 0; i < 30; i++) {
    m.update(1 / 30, { position: { x: 0, y: 20, z: -1600 }, fired: true, handedOff: false });
  }
  check("the clock advances", m.elapsed() > 0.9, `${m.elapsed()}`);

  // And STOPS at COMPLETE: the reported time is the stopped clock.
  m.mission.phase = EXTRACTION;
  m.mission.phaseTime = 0;
  m.update(1 / 30, { position: { x: 0, y: 600, z: -1600 }, cinematicDone: true });
  check("COMPLETE stops the clock", m.mission.running === false);
  const stopped = m.elapsed();
  for (let i = 0; i < 60; i++) {
    m.update(1 / 30, { position: { x: 0, y: 600, z: -1600 }, cinematicDone: true });
  }
  check("the reported time is the STOPPED clock", m.elapsed() === stopped, `${m.elapsed()} vs ${stopped}`);
}

function testCheckpointIsFlyable() {
  // A checkpoint must be a state the player can fly OUT of. Recording a
  // mid-dive attitude 120 m over a ridge means restoring it re-flies the same
  // impact, and the run then fails in the same place forever.
  const diving = {
    position: { x: 0, y: 620, z: -9000 },
    heading: 1.2, pitch: -0.6, bank: 1.1, speed: 250, throttle: 0.9,
    sink: 40, mode: "ASSISTED", afterburner: true,
    quat: { x: 0, y: 0, z: 0, w: 1 },
  };
  const cp = captureCheckpoint(diving, {
    groundAhead: 600, weapon: "GUN", missiles: 1, gunRounds: 210, phase: TERRAIN,
  });

  check("the checkpoint is LEVELLED", cp.snapshot.pitch === 0 && cp.snapshot.bank === 0);
  check("the sink is zeroed", cp.snapshot.sink === 0);
  check(
    "the checkpoint is LIFTED above the ground AHEAD",
    cp.snapshot.position.y >= 600 + 400,
    `${cp.snapshot.position.y}`,
  );
  check("the heading being travelled is kept", cp.snapshot.heading === 1.2);
  check("it carries the selected weapon", cp.weapon === "GUN");
  check("it carries BOTH magazines", cp.missiles === 1 && cp.gunRounds === 210);
  // Restoring the loadout it RECORDED, not a full one -- otherwise crashing is
  // the cheapest way to refill the rails.
  check("the recorded loadout is not silently a full one", cp.missiles !== 2);

  // A checkpoint over open water is not needlessly lifted.
  const level = captureCheckpoint(
    { ...diving, position: { x: 0, y: 900, z: -3000 } },
    { groundAhead: 0, weapon: "AIM-9", missiles: 2, gunRounds: 500, phase: INTERCEPT },
  );
  check("a high checkpoint over water keeps its altitude", level.snapshot.position.y === 900);
}

function testMissionFailurePolicy() {
  const restores = [];
  const fades = [];
  const policy = createMissionCheckpointResponse({
    onRestore: () => restores.push(1),
    onFade: (v) => fades.push(v),
  });
  const contact = { type: "terrain", predicted: false, position: { x: 0, y: 0, z: 0 }, speed: 200 };

  check("the policy names itself", policy.name === "MissionCheckpointResponse");
  check("the first hit is accepted", policy.handleCollision(contact) === true);
  // A proximity fuze or a terrain probe trips on CONSECUTIVE frames; without
  // this the fade restarts every frame and the screen never clears.
  check("a simultaneous second is refused", policy.handleCollision(contact) === false);
  check("the stick is neutralised", policy.overridesInput() === true);
  check("no restore yet", restores.length === 0);

  // RESTORE AT FULL BLACK, so the player never sees the teleport.
  let fadeAtRestore = null;
  // A SEPARATE tally: the policy above was triggered but never ticked, so it
  // never restored. Sharing one array counted its non-restore as a restore.
  const p2Restores = [];
  const p2 = createMissionCheckpointResponse({
    onRestore: () => {
      fadeAtRestore = p2.fade();
      p2Restores.push(1);
    },
  });
  p2.handleCollision(contact);
  for (let t = 0; t < 3; t += 1 / 60) p2.tick(1 / 60);
  check("the restore fired exactly once", p2Restores.length === 1, `${p2Restores.length}`);
  check("a policy that is never ticked never restores", restores.length === 0);
  check("the restore happened at FULL BLACK", fadeAtRestore === 1, `${fadeAtRestore}`);
  check("the policy returns to idle", p2.isActive() === false);
  check("the stick is handed back", p2.overridesInput() === false);
  check("the fade is clear again", p2.fade() === 0);

  // Refused during the settling cooldown.
  // Derived from MC rather than hardcoded: stage 9 lengthens `hold` from 0.28
  // to 1.2 so the policy's clock can carry the crash presentation, and a test
  // with the old total baked in fails for a change that is correct.
  const cycle = MC.hold + MC.fadeOut + MC.fadeIn + MC.cooldown;
  const p3 = createMissionCheckpointResponse({});
  p3.handleCollision(contact);
  for (let t = 0; t < cycle - 0.2; t += 1 / 60) p3.tick(1 / 60);
  check("still refused during the settling cooldown", p3.handleCollision(contact) === false, p3.stage());
  for (let t = 0; t < 0.5; t += 1 / 60) p3.tick(1 / 60);
  check("accepted once fully settled", p3.handleCollision(contact) === true);

  // A PREDICTED IMPACT DOES NOT FAIL THE MISSION; REAL CONTACT DOES. Failing a
  // run for a crash that has not happened is the worst class of failure.
  const p4 = createMissionCheckpointResponse({});
  check(
    "a predicted impact is declined",
    p4.handleCollision({ ...contact, predicted: true }) === false,
  );
  check("and leaves the policy idle", p4.isActive() === false);
  check("real contact a moment later does fail", p4.handleCollision(contact) === true);

  // Both policies share the interface, which is what makes the `G` swap safe.
  const dev = createDevelopmentRecovery({
    physics: createPhysics({}), getState: () => createFlightState(),
  });
  for (const method of ["handleCollision", "tick", "reset", "overridesInput"]) {
    check(`both policies implement ${method}`,
      typeof dev[method] === "function" && typeof p4[method] === "function");
  }
}

function testAutopilot() {
  const level = { heading: 0, pitch: 0, altitude: 620, speed: 190 };

  // ON TARGET IT COMMANDS NOTHING.
  const still = autopilotStick(level, { heading: 0, altitude: 620, speed: 190 });
  check(
    "on target the autopilot commands nothing",
    Math.abs(still.x) < 1e-9 && Math.abs(still.y) < 1e-9 && Math.abs(still.throttle) < 1e-9,
    JSON.stringify(still),
  );

  // A heading error banks -- and THE SHORT WAY ROUND THE +-180 SEAM. Without
  // the wrap a goal one degree the other side of north banks 359 degrees.
  const justPast = autopilotStick(
    { ...level, heading: Math.PI - 0.05 },
    { heading: -Math.PI + 0.05, altitude: 620, speed: 190 },
  );
  check(
    "a goal across the +-180 seam banks the SHORT way",
    justPast.x > 0 && justPast.x <= 1,
    `${justPast.x}`,
  );
  check(
    "a plain left goal banks left",
    autopilotStick(level, { heading: 0.4, altitude: 620, speed: 190 }).x > 0,
  );
  check(
    "a plain right goal banks right",
    autopilotStick(level, { heading: -0.4, altitude: 620, speed: 190 }).x < 0,
  );

  // Below the goal it pulls up.
  check(
    "below the goal altitude it pulls up",
    autopilotStick({ ...level, altitude: 200 }, { altitude: 620, speed: 190, heading: 0 }).y > 0,
  );
  check(
    "above the goal altitude it pushes down",
    autopilotStick({ ...level, altitude: 1400 }, { altitude: 620, speed: 190, heading: 0 }).y < 0,
  );

  // A NOSE-HIGH ATTITUDE DAMPS rather than porpoising: it must not keep
  // pulling while already climbing hard, overshoot, and push just as hard back.
  const noseHigh = autopilotStick(
    { heading: 0, pitch: 0.5, altitude: 560, speed: 190 },
    { heading: 0, altitude: 620, speed: 190 },
  );
  check(
    "already nose-high and slightly low, it damps rather than pulling",
    noseHigh.y < 0,
    `${noseHigh.y}`,
  );

  // Throttle chases the speed goal.
  check(
    "slow commands throttle up",
    autopilotStick({ ...level, speed: 140 }, { speed: 190, altitude: 620, heading: 0 }).throttle > 0,
  );
  check(
    "fast commands throttle back",
    autopilotStick({ ...level, speed: 240 }, { speed: 190, altitude: 620, heading: 0 }).throttle < 0,
  );

  // blendStick: k = 0 is the player, k = 1 is the autopilot.
  const player = { x: -1, y: 0.5, roll: 0.3, throttle: 1 };
  const auto = { x: 1, y: -0.5, roll: 0, throttle: -1 };
  const at0 = blendStick(player, auto, 0, {});
  check("k=0 is the player", at0.x === player.x && at0.throttle === player.throttle);
  const at1 = blendStick(player, auto, 1, {});
  check("k=1 is the autopilot", at1.x === auto.x && at1.throttle === auto.throttle);
  const half = blendStick(player, auto, 0.5, {});
  check("k=0.5 is halfway", Math.abs(half.x) < 1e-9, `${half.x}`);
  check("k is clamped", blendStick(player, auto, 9, {}).x === auto.x);
}

// ── stage 8: ground threats, countermeasures, modes ───────────────────────

// A ridge running along X, peaking at z = -1000, 400 m tall.
const ridgeAt = (x, z) => {
  const d = Math.abs(z + 1000);
  return d >= 500 ? 0 : 400 * (1 - d / 500);
};

function testLineOfSight() {
  const flatGround = () => 0;
  const low = { x: 0, y: 100, z: 0 };
  const far = { x: 0, y: 100, z: -2000 };

  check("clear over flat ground", lineOfSight(low, far, flatGround) === true);
  // The ridge sits between them at 400 m; both ends are at 100 m.
  check("a ridge blocks the line", lineOfSight(low, far, ridgeAt) === false);
  // From above the ridge, clear again.
  check(
    "clear again from above the ridge",
    lineOfSight({ ...low, y: 900 }, { ...far, y: 900 }, ridgeAt) === true,
  );

  // A GRAZE COUNTS AS COVER: the 10 m margin is in the player's favour, so a
  // line passing just over the crest is still called blocked.
  const grazing = lineOfSight(
    { x: 0, y: 405, z: 0 }, { x: 0, y: 405, z: -2000 }, ridgeAt,
  );
  check("a graze counts as cover", grazing === false, `${grazing}`);
  check(
    "well clear of the crest is visible",
    lineOfSight({ x: 0, y: 460, z: 0 }, { x: 0, y: 460, z: -2000 }, ridgeAt) === true,
  );

  // SKIPS THE ENDPOINTS: a site standing ON the ground would otherwise report
  // ITSELF as an obstruction and never see anything at all.
  const onTheGround = { x: 0, y: 0, z: -3000 };
  check(
    "a site standing on the ground is not blocked by its own ground",
    lineOfSight(onTheGround, { x: 0, y: 800, z: -3000 }, flatGround) === true,
  );

  check("solid ground blocks everything", lineOfSight(low, far, () => 9000) === false);
  // NO SAMPLER MEANS VISIBLE: a build whose terrain failed to load must be
  // playable, not accidentally invulnerable.
  check("no sampler means visible", lineOfSight(low, far, null) === true);
}

const SAM = (over = {}) => ({ state: "SEARCH", stateTime: 0, lossTimer: 0, ...over });
const SCTX = (over = {}) => ({
  alive: true, playerAlive: true, range: 2000, visible: true, rounds: 3, ...over,
});

function testSamTransitionTable() {
  const T = samTransition;

  check("death wins", T(SAM({ state: "LOCK" }), SCTX({ alive: false })) === "DESTROYED");
  check("DESTROYED is terminal", T(SAM({ state: "DESTROYED" }), SCTX()) === "DESTROYED");

  check("SEARCH holds with nothing visible", T(SAM(), SCTX({ visible: false })) === "SEARCH");
  check("SEARCH acquires what it can see", T(SAM(), SCTX()) === "TRACK");
  check("SEARCH ignores anything beyond detection", T(SAM(), SCTX({ range: 9000 })) === "SEARCH");
  // The inner 450 m is a DEAD ZONE: flying straight over the top is a valid
  // second answer, and a nice one to discover.
  check("the inner dead zone is safe", T(SAM(), SCTX({ range: 300 })) === "SEARCH");
  check("beyond the envelope is safe", T(SAM(), SCTX({ range: 4800 })) === "SEARCH");

  check("TRACK builds", T(SAM({ state: "TRACK", stateTime: 0.5 }), SCTX()) === "TRACK");
  check("TRACK promotes at 1.15 s", T(SAM({ state: "TRACK", stateTime: 1.2 }), SCTX()) === "LOCK");
  check("LOCK builds", T(SAM({ state: "LOCK", stateTime: 0.5 }), SCTX()) === "LOCK");
  check("LOCK promotes at 1.35 s", T(SAM({ state: "LOCK", stateTime: 1.4 }), SCTX()) === "LAUNCH");
  check("LAUNCH holds for its delay", T(SAM({ state: "LAUNCH", stateTime: 0.2 }), SCTX()) === "LAUNCH");
  check("LAUNCH releases after 0.45 s", T(SAM({ state: "LAUNCH", stateTime: 0.5 }), SCTX()) === "RELOAD");
  check("RELOAD holds", T(SAM({ state: "RELOAD", stateTime: 5 }), SCTX()) === "RELOAD");
  check("RELOAD returns to SEARCH after 9 s", T(SAM({ state: "RELOAD", stateTime: 9.1 }), SCTX()) === "SEARCH");

  // A SPENT SITE MUST NEVER ACQUIRE AGAIN -- still a target, still worth a
  // kill, but no longer a threat. Otherwise it sits in LOCK forever with
  // nothing to fire.
  check("a spent site does not acquire", T(SAM(), SCTX({ rounds: 0 })) === "SEARCH");
  check("a spent site drops a track", T(SAM({ state: "TRACK", stateTime: 2 }), SCTX({ rounds: 0 })) === "SEARCH");
  check("a spent site drops a lock", T(SAM({ state: "LOCK", stateTime: 2 }), SCTX({ rounds: 0 })) === "SEARCH");

  // THE LOSS GRACE holds a lock through a flicker of terrain, but not beyond.
  check(
    "a flicker does not drop the lock",
    T(SAM({ state: "LOCK", stateTime: 0.5, lossTimer: 0.3 }), SCTX({ visible: false })) === "LOCK",
  );
  check(
    "beyond the grace the lock is dropped",
    T(SAM({ state: "LOCK", stateTime: 0.5, lossTimer: 0.9 }), SCTX({ visible: false })) === "SEARCH",
  );
  // Leaving the ENVELOPE breaks a lock the same way.
  check(
    "leaving the envelope breaks a lock",
    T(SAM({ state: "LOCK", stateTime: 0.5, lossTimer: 0.9 }), SCTX({ range: 6000 })) === "SEARCH",
  );

  // Acquisition is deliberately slow: 2.95 s from first sighting to a round in
  // the air. That, plus the reload, is the entire difficulty dial.
  check(
    "acquisition takes about 2.95 s end to end",
    Math.abs(ACQUISITION_SECONDS - 2.95) < 1e-9,
    `${ACQUISITION_SECONDS}`,
  );
}

function testOneLaunchPerLock() {
  // §8: firing on both "LOCK with an expired timer" AND the LAUNCH state
  // spends TWO rounds per engagement, because they are the same frame.
  const launches = [];
  const net = createSamNetwork({ onLaunch: (s) => launches.push(s) });
  net.deploy([{ x: 0, y: 100, z: -2000 }]);
  const player = createFlightState({ position: { x: 0, y: 900, z: 0 } });

  for (let t = 0; t < 6; t += 1 / 60) {
    net.update(1 / 60, { playerState: player, sampleHeight: () => 0 });
  }
  check("exactly one launch per engagement", launches.length === 1, `${launches.length}`);
  check("exactly one round was spent", net.sites[0].rounds === 2, `${net.sites[0].rounds}`);

  // Three engagements empty it, and then it never fires again.
  for (let t = 0; t < 60; t += 1 / 60) {
    net.update(1 / 60, { playerState: player, sampleHeight: () => 0 });
  }
  check("a site fires at most its magazine", launches.length <= 3, `${launches.length}`);
  check("a spent site stays in SEARCH", net.sites[0].rounds === 0 && net.sites[0].state === "SEARCH");
}

function testMaskedSiteNeverLaunches() {
  // A MASKED SITE NEVER LAUNCHES, however long the player loiters. This is the
  // mechanic: low flight is safe because the ground is genuinely in the way,
  // not because of a minimum-safe-altitude constant.
  const launches = [];
  const net = createSamNetwork({ onLaunch: () => launches.push(1) });
  // The site is beyond the ridge from the player.
  net.deploy([{ x: 0, y: 10, z: -2000 }]);
  const player = createFlightState({ position: { x: 0, y: 60, z: 0 } });

  for (let t = 0; t < 30; t += 1 / 60) {
    net.update(1 / 60, { playerState: player, sampleHeight: ridgeAt });
  }
  check("a masked site never launches", launches.length === 0, `${launches.length}`);
  check("and never leaves SEARCH", net.sites[0].state === "SEARCH", net.sites[0].state);

  // Climb over the ridge and it acquires.
  const high = createFlightState({ position: { x: 0, y: 1400, z: 0 } });
  for (let t = 0; t < 6; t += 1 / 60) {
    net.update(1 / 60, { playerState: high, sampleHeight: ridgeAt });
  }
  check("climbing into view produces a launch", launches.length === 1, `${launches.length}`);
}

function testSamPlacement() {
  const legs = [{ name: "PASS", x: 0, z: -3000 }, { name: "VALLEY", x: 0, z: -6000 }];

  // Land everywhere: both flanks stand.
  const onLand = placeSites(legs, () => 120);
  check("two sites per leg on good ground", onLand.length === 4, `${onLand.length}`);
  check("they flank the corridor on both sides", (() => {
    const sides = new Set(onLand.map((s) => s.side));
    return sides.has(-1) && sides.has(1);
  })());

  // ALL SEA: every site is DROPPED, not floated. Five sites on land beat six
  // with one in the water.
  const atSea = placeSites(legs, () => 0);
  check("a site with nowhere to stand is dropped", atSea.length === 0, `${atSea.length}`);

  // Land only on one side: it probes OUTWARD and takes the first position
  // standing on ground at least 30 m above sea level.
  const oneSided = placeSites(legs, (x) => (x < 0 ? 200 : 0));
  check("only the side with land is used", oneSided.length === 2, `${oneSided.length}`);
  check("and it is the land side", oneSided.every((s) => s.side === -1));

  // The probe scales let it reach land further out than the nominal flank.
  const farLand = placeSites(legs, (x) => (Math.abs(x) > 1800 ? 90 : 0));
  check(
    "probing outward finds land beyond the nominal flank",
    farLand.length === 4,
    `${farLand.length}`,
  );
  check("the probe scales start at the nominal offset", PROBE_SCALES[0] === 1.0);
}

function testSamWreckAndContract() {
  const net = createSamNetwork({});
  net.deploy([{ x: 0, y: 100, z: -2000 }]);
  const sam = net.sites[0];

  // THE STAGE-5 TARGET CONTRACT, unchanged -- which is what makes targeting,
  // the gun, the missile and the HUD bracket work on ground targets for free.
  check("a site publishes the target contract", isTargetable(sam.target));
  for (const field of ["position", "velocity", "alive", "health", "radius", "label"]) {
    check(`a site publishes ${field}`, field in sam.target);
  }
  // A SAM's velocity is ZERO, so the lead solution collapses to its position.
  const lead = leadSolution({ x: 0, y: 900, z: 0 }, sam.target);
  check(
    "the lead solution on a SAM is the SAM itself",
    Math.abs(lead.point.z - sam.target.position.z) < 1e-6,
  );

  // A wreck: still a target, no longer a threat.
  const wrecks = [];
  const net2 = createSamNetwork({ onWreck: (s) => wrecks.push(s) });
  net2.deploy([{ x: 0, y: 100, z: -2000 }]);
  const player = createFlightState({ position: { x: 0, y: 900, z: 0 } });
  damageTarget(net2.sites[0].target, 999, 0);
  net2.update(1 / 60, { playerState: player, sampleHeight: () => 0 });
  check("a killed site produces a wreck", wrecks.length === 1);
  check("a wreck is DESTROYED", net2.sites[0].state === "DESTROYED");
  check("a wreck is no longer a live site", net2.liveSites().length === 0);
  check("a wreck is not emitting", net2.emitting().length === 0);
  // It is still in the world -- not a deletion.
  check("a wreck is still in the site list", net2.sites.length === 1);

  for (let t = 0; t < 20; t += 1 / 60) {
    net2.update(1 / 60, { playerState: player, sampleHeight: () => 0 });
  }
  check("a wreck never acquires again", net2.emitting().length === 0);
}

function testSamRound() {
  const r = turnRadius(SAM_MISSILE);
  check(
    "the SAM round has the widest turn of the three",
    r > turnRadius(HOSTILE_MISSILE) && r > turnRadius(AIM9),
    `sam ${r.toFixed(0)}, hostile ${turnRadius(HOSTILE_MISSILE).toFixed(0)}, aim9 ${turnRadius(AIM9).toFixed(0)}`,
  );
  check("its radius is near §14's ~1146 m", r > 1050 && r < 1250, `${r.toFixed(0)}`);
  check(
    "so a hard crossing manoeuvre still beats it",
    r > TURN_RADIUS_REF,
    `round ${r.toFixed(0)} vs aircraft ${TURN_RADIUS_REF}`,
  );

  // IT LAUNCHES UPWARD WITH ZERO INHERITED SPEED, which is what makes the
  // trail read as a ground launch.
  const sys = createMissileSystem({});
  const round = sys.fire({
    config: SAM_MISSILE, owner: "sam",
    position: { x: 0, y: 20, z: 0 }, direction: { x: 0, y: 1, z: 0 },
    speed: 0, target: null,
  });
  check("it leaves the ground going UP", round.velocity.y > 0 && Math.abs(round.velocity.x) < 1e-9);
  check("and inherits no lateral speed", Math.abs(round.velocity.z) < 1e-9);
}

function testSeduces() {
  check("inside the radius decoys", seduces(200, 900) === true);
  check("outside the radius does not", seduces(500, 900) === false);
  // A COMMITTED round cannot be decoyed -- the answer is the barrel roll.
  check("a committed round cannot be decoyed", seduces(50, 100) === false);
  // A flare further away than the target is a distraction, not a decoy.
  check("a flare further than the target loses", seduces(800, 400) === false);

  // KEEP minStandoff WELL BELOW seduceRadius. The cloud sits ~200 m astern a
  // second after release, so a standoff near that distance cancels the radius
  // out and the mechanic never fires at all. Assert the RELATIONSHIP.
  check(
    "minStandoff is well below seduceRadius",
    FLARE_CFG.minStandoff < FLARE_CFG.seduceRadius * 0.6,
    `${FLARE_CFG.minStandoff} vs ${FLARE_CFG.seduceRadius}`,
  );
}

function testDecoyEndToEndWithAMovingAircraft() {
  // §8 IS EMPHATIC ABOUT THIS: a STATIC aircraft never leaves its flares
  // behind, so the cloud never reaches the chaser's path and the mechanic
  // looks broken while being perfectly correct.
  const flares = createFlares();
  const sys = createMissileSystem({});
  const state = createFlightState({ position: { x: 0, y: 900, z: 0 }, speed: 220 });
  const player = {
    label: "PLAYER", alive: true, health: 100, maxHealth: 100, radius: 8,
    hitAt: -Infinity, position: state.position, velocity: { x: 0, y: 0, z: -220 },
  };

  // A STERN CHASE: the round is behind and closing.
  const round = sys.fire({
    config: HOSTILE_MISSILE, owner: "hostile",
    position: { x: 0, y: 900, z: 1400 },
    direction: { x: 0, y: 0, z: -1 }, speed: 300, target: player,
  });
  const originalTarget = round.target;

  flares.dispense(state, { x: 0, y: 0, z: -1 }, 0);
  check("a burst is dispensed", flares.flares.length === 3, `${flares.flares.length}`);

  let seduced = false;
  for (let t = 0; t < 3 && !seduced; t += 1 / 60) {
    // THE AIRCRAFT KEEPS FLYING, which is what leaves the cloud behind.
    updateFlight(state, stick(), 1 / 60);
    flares.update(1 / 60, t);
    flares.offerTo(sys.rounds, state.position);
    sys.update(1 / 60, t);
    if (round.target && round.target.label === "FLARE") seduced = true;
  }
  check("a stern-chasing round is decoyed", seduced, `target ${round.target?.label}`);
  // RE-TARGETED, NOT FLAGGED. A "lost" flag would freeze the heading of a
  // round already pointed at the player, so it would arrive anyway.
  check("the round's TARGET was swapped", round.target !== originalTarget);
  check("it was not merely flagged lost", round.givenUp !== true);
  check("it is chasing an actual flare", round.target.label === "FLARE");

  // A HEAD-ON shot arrives before the flares are near it: panicking early
  // buys nothing.
  const f2 = createFlares();
  const sys2 = createMissileSystem({});
  const s2 = createFlightState({ position: { x: 0, y: 900, z: 0 }, speed: 220 });
  const p2 = { ...player, position: s2.position };
  const headOn = sys2.fire({
    config: HOSTILE_MISSILE, owner: "hostile",
    position: { x: 0, y: 900, z: -2200 },
    direction: { x: 0, y: 0, z: 1 }, speed: 300, target: p2,
  });
  f2.dispense(s2, { x: 0, y: 0, z: -1 }, 0);
  let headOnSeduced = false;
  for (let t = 0; t < 2; t += 1 / 60) {
    updateFlight(s2, stick(), 1 / 60);
    f2.update(1 / 60, t);
    f2.offerTo(sys2.rounds, s2.position);
    sys2.update(1 / 60, t);
    if (headOn.target && headOn.target.label === "FLARE") headOnSeduced = true;
  }
  check("a head-on shot is not decoyed", headOnSeduced === false);

  // A BURNT-OUT FLARE STOPS BEING A TARGET, and the missile's existing "no
  // live target" branch then stops guidance -- no change in missile.js.
  const f3 = createFlares();
  const s3 = createFlightState({ position: { x: 0, y: 900, z: 0 } });
  f3.dispense(s3, { x: 0, y: 0, z: -1 }, 0);
  const flare = f3.flares[0];
  check("a fresh flare is alive", flare.alive === true);
  f3.update(1 / 60, FLARE_CFG.burn + 0.1);
  check("a burnt-out flare stops being a target", flare.alive === false);

  // Flares are INFRARED: they defeat a missile, never a radar LOCK.
  check("the dispenser is finite", createFlares().remaining === FLARE_CFG.count);
  const f4 = createFlares();
  const s4 = createFlightState();
  f4.dispense(s4, { x: 0, y: 0, z: -1 }, 0);
  check("a burst spends perBurst flares", f4.remaining === FLARE_CFG.count - FLARE_CFG.perBurst);
  check("the cooldown blocks an immediate second burst", f4.dispense(s4, { x: 0, y: 0, z: -1 }, 0) === 0);
}

function testRearm() {
  const refills = [];
  const rearm = createRearm({ seconds: 20, onRefill: (n) => refills.push(n) });
  let missiles = 2;
  let rounds = 500;
  const weapons = {
    "AIM-9": { isEmpty: () => missiles === 0, refill: () => (missiles = 2) },
    GUN: { isEmpty: () => rounds === 0, refill: () => (rounds = 500) },
  };

  // A PARTLY-SPENT magazine never starts a timer. START AT EMPTY, NOT AT THE
  // FIRST SHOT -- otherwise the player fires one AIM-9, waits, and is handed a
  // third round, and the loadout stops meaning anything.
  missiles = 1;
  rearm.update(1, weapons);
  check("a partly-spent magazine starts no timer", rearm.isCycling("AIM-9") === false);

  missiles = 0;
  rearm.update(1 / 60, weapons);
  check("reaching empty starts the timer", rearm.isCycling("AIM-9") === true);
  check("the gun is untouched", rearm.isCycling("GUN") === false);

  for (let t = 0; t < 19; t += 1 / 60) rearm.update(1 / 60, weapons);
  check("it has not refilled early", missiles === 0);
  for (let t = 0; t < 2; t += 1 / 60) rearm.update(1 / 60, weapons);
  check("it refills after 20 s", missiles === 2, `${missiles}`);
  check("the refill fired once", refills.length === 1, `${refills.length}`);
  check("and the timer is gone", rearm.isCycling("AIM-9") === false);

  // INDEPENDENT TIMERS, so one weapon is always coming back.
  missiles = 0;
  rearm.update(1 / 60, weapons);
  for (let t = 0; t < 10; t += 1 / 60) rearm.update(1 / 60, weapons);
  rounds = 0;
  rearm.update(1 / 60, weapons);
  check("both timers run at once", rearm.active().length === 2);
  check(
    "and they are at different points",
    Math.abs(rearm.remaining("AIM-9") - rearm.remaining("GUN")) > 5,
    `${rearm.remaining("AIM-9")} vs ${rearm.remaining("GUN")}`,
  );

  // AN EXTERNAL REFILL CANCELS A RUNNING CYCLE -- a checkpoint restore or a
  // restart -- so a timer cannot later top up an already-full magazine.
  missiles = 2;
  rearm.update(1 / 60, weapons);
  check("an external refill cancels the cycle", rearm.isCycling("AIM-9") === false);
  check("the other weapon keeps its timer", rearm.isCycling("GUN") === true);
}

function testModesTable() {
  for (const mode of [MISSION, FREE, PEACE]) {
    const r = rulesFor(mode);
    for (const key of ["phases", "timer", "nav", "hostiles", "sams", "respawn"]) {
      check(`${mode} defines ${key}`, key in r);
    }
  }
  check("MISSION runs phases, a timer and nav", (() => {
    const r = rulesFor(MISSION);
    return r.phases && r.timer && r.nav;
  })());
  check("FREE has no phases, timer or nav", (() => {
    const r = rulesFor(FREE);
    return !r.phases && !r.timer && !r.nav;
  })());
  check("PEACE has no hostiles and no sams", (() => {
    const r = rulesFor(PEACE);
    return !r.hostiles && !r.sams;
  })());

  // LIVES ARE MISSION ONLY: FREE and PEACE are practice, and counting deaths
  // in a sandbox turns it into a test.
  check("MISSION has five lives", rulesFor(MISSION).lives === 5);
  check("FREE has no life count", rulesFor(FREE).lives === null);
  check("PEACE has no life count", rulesFor(PEACE).lives === null);

  // Two rules identical across all three.
  check("every mode flies the catapult", ALWAYS.launch === true);
  // THE GROUND STILL KILLS YOU IN PEACE. "No hostiles" is not "no
  // consequences" -- a sky with nothing to hit is a screensaver.
  check("PEACE still has a failure state", ALWAYS.groundKills === true);
  check("PEACE returns you to the carrier", rulesFor(PEACE).respawn === "carrier");
  check("MISSION respawns crash-relative", rulesFor(MISSION).respawn === "crash-relative");

  check("T cycles all three and returns", nextMode(nextMode(nextMode(MISSION))) === MISSION);
}

function testSandboxDriver() {
  // PEACE SPAWNS NOTHING, however long you fly.
  const peace = createSandbox();
  let spawned = 0;
  for (let t = 0; t < 120; t += 1 / 30) {
    if (peace.update(1 / 30, { mode: PEACE, handedOff: true, hostileAlive: false })) spawned++;
  }
  check("PEACE spawns nothing in two minutes", spawned === 0, `${spawned}`);

  // FREE: ONE AT A TIME, first arrival 8 s after handoff.
  const free = createSandbox();
  let first = null;
  for (let t = 0; t < 20; t += 1 / 30) {
    if (free.update(1 / 30, { mode: FREE, handedOff: true, hostileAlive: false })) {
      first = t;
      break;
    }
  }
  check("FREE spawns after about 8 s", first !== null && first > 7 && first < 9, `${first}`);

  // Nothing more arrives while one is alive.
  let extra = 0;
  for (let t = 0; t < 60; t += 1 / 30) {
    if (free.update(1 / 30, { mode: FREE, handedOff: true, hostileAlive: true })) extra++;
  }
  check("nothing spawns while one is alive", extra === 0, `${extra}`);

  // And a replacement arrives 12 s after the kill.
  let second = null;
  for (let t = 0; t < 20; t += 1 / 30) {
    if (free.update(1 / 30, { mode: FREE, handedOff: true, hostileAlive: false })) {
      second = t;
      break;
    }
  }
  check("a replacement arrives after about 12 s", second !== null && second > 11 && second < 13, `${second}`);

  // Nothing spawns before the handoff -- every mode flies the catapult first.
  const early = createSandbox();
  let before = 0;
  for (let t = 0; t < 30; t += 1 / 30) {
    if (early.update(1 / 30, { mode: FREE, handedOff: false, hostileAlive: false })) before++;
  }
  check("nothing spawns before the handoff", before === 0);
}

function testParkedDirectorNeverCompletes() {
  // In the sandbox modes the director PARKS rather than being bypassed: it
  // still owns the deck and the catapult, then past the handoff stops
  // advancing, stops timing and publishes no navigation.
  const route = buildRoute({ carrierZ: -1600, coastZ: -7600, sampleHeight: null });
  const m = createMission({ route });
  m.park();

  // Fly it all the way through every volume for a long time.
  for (let t = 0; t < 300; t += 1 / 30) {
    const leg = m.currentLeg();
    m.update(1 / 30, {
      position: leg ? { x: leg.x, y: 600, z: leg.z } : { x: 0, y: 600, z: -1600 },
      fired: true, handedOff: true, magazineSpent: true, cinematicDone: true,
    });
  }
  check(
    "a parked director never completes a mission",
    m.mission.phase !== COMPLETE,
    m.mission.phase,
  );
  check("a parked director stops at EGRESS", m.mission.phase === EGRESS, m.mission.phase);
  check("and publishes no completion time", m.mission.stopped === null);
}

// ── stage 9: dying well, and sound ────────────────────────────────────────

const crashStart = (over = {}) => ({
  reason: "terrain",
  position: { x: 0, y: 600, z: 0 },
  velocity: { x: 0, y: 0, z: -200 },
  quat: { x: 0, y: 0, z: 0, w: 1 },
  seed: 7,
  ...over,
});

function runCrash(over = {}, seconds = 2.4) {
  const crash = createCrashFx();
  crash.start(crashStart(over));
  const frames = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    crash.update(1 / 60);
    frames.push({
      t: crash.state.t,
      opacity: crash.state.aircraftOpacity,
      kick: crash.state.kick,
      y: crash.state.position.y,
      z: crash.state.position.z,
      sparks: crash.sparks.length,
      smoke: crash.smoke.length,
      debris: crash.debris.length,
      entities: crash.entityCount(),
    });
  }
  return { crash, frames };
}

function testCrashCauseMapping() {
  // Mapped IN ONE PLACE, so a new failure reason cannot silently inherit the
  // wrong explosion.
  check("terrain maps to TERRAIN", causeFor("terrain") === "TERRAIN");
  check("ground maps to TERRAIN", causeFor("ground") === "TERRAIN");
  check("ocean maps to OCEAN", causeFor("ocean") === "OCEAN");
  check("missile maps to MISSILE", causeFor("missile") === "MISSILE");
  // AN UNKNOWN REASON STILL GETS A PRESENTATION -- silence would read as a
  // freeze, which is worse than the wrong explosion.
  check("an unknown reason still gets a presentation", VARIANTS[causeFor("wat")] !== undefined);
  for (const name of ["MISSILE", "TERRAIN", "OCEAN"]) {
    const v = VARIANTS[name];
    for (const key of ["fire", "smoke", "sparks", "mist", "forward", "sink", "visible"]) {
      check(`${name} defines ${key}`, key in v);
    }
  }
  // The variants differ as DATA, not code paths.
  check("OCEAN sinks hardest", VARIANTS.OCEAN.sink > VARIANTS.TERRAIN.sink);
  check("OCEAN is least visible", VARIANTS.OCEAN.visible < VARIANTS.TERRAIN.visible);
  check("OCEAN has the most mist and the least fire", (() => {
    const o = VARIANTS.OCEAN;
    return o.mist > VARIANTS.TERRAIN.mist && o.fire < VARIANTS.MISSILE.fire;
  })());
}

function testCrashTimelineOrdering() {
  check("flash before fireball", T.flash < T.fireball);
  check("fireball before tumble", T.fireball < T.tumble);
  check("tumble before smoke", T.tumble < T.smoke);
  check("smoke before sparks", T.smoke < T.sparks);
  // The crash must be VISIBLE before the fade starts.
  check("the crash is visible before the fade begins", T.sparks < T.holdEnds);
  // And the smoke must stop emitting before the fade completes.
  check("smoke stops before the fade completes", T.smokeStops < T.respawn);
  check("respawn is at full black", T.respawn === T.holdEnds + 0.5);
  check(
    "impact to playable is about 2.3 s",
    Math.abs(T.playable - 2.32) < 1e-9,
    `${T.playable}`,
  );
  // The policy's hold IS the crash window -- not a second state machine.
  check("the policy hold matches the crash window", MC.hold === T.holdEnds, `${MC.hold}`);
  check(
    "the policy timeline reaches playable at the same moment",
    Math.abs(MC.hold + MC.fadeOut + MC.fadeIn - T.playable) < 1e-9,
  );
}

function testCrashAircraftVisibility() {
  const { frames } = runCrash();
  const at = (t) => frames.find((f) => f.t >= t);
  // KEEP THE INTACT AIRCRAFT VISIBLE for ~0.72 s. Hiding it on the frame it
  // dies is what makes a death read as a bug.
  check("the aircraft is fully visible at 0.5 s", at(0.5).opacity === 1, `${at(0.5).opacity}`);
  check("the aircraft is hidden by 1.0 s", at(1.0).opacity < 0.05, `${at(1.0).opacity}`);
  check("opacity never goes negative", frames.every((f) => f.opacity >= 0));
}

function testCrashCamera() {
  const { frames } = runCrash();
  // ONE strong kick at impact, decaying fast, NEVER re-triggered: sustained
  // shake is nauseating.
  check("the kick peaks at impact", frames[0].kick > 0.4, `${frames[0].kick}`);
  let monotonic = true;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].kick > frames[i - 1].kick + 1e-9) monotonic = false;
  }
  check("the kick only ever decays -- never re-triggered", monotonic);
  const atRespawn = frames.find((f) => f.t >= T.respawn);
  check("the kick is negligible by the respawn", atRespawn.kick < 0.01, `${atRespawn.kick}`);
}

function testCrashTumbleAndMomentum() {
  // THE TUMBLE IS LATCHED at entry -- one angular velocity, applied as a LOCAL
  // quaternion delta so it works from any starting attitude including
  // inverted. (Same trap as the hostile's break direction in stage 6.)
  const seen = [];
  for (let seed = 1; seed <= 12; seed++) {
    const c = createCrashFx();
    c.start(crashStart({ seed }));
    const latched = { ...c.state.tumble };
    for (let t = 0; t < 1; t += 1 / 60) c.update(1 / 60);
    check(
      `seed ${seed}: the tumble never changed`,
      c.state.tumble.x === latched.x && c.state.tumble.z === latched.z,
    );
    seen.push(latched.z);
  }
  check("the tumble goes both ways across seeds", seen.some((z) => z > 0) && seen.some((z) => z < 0));
  check("the tumble is bounded", seen.every((z) => Math.abs(z) < 6), `max ${Math.max(...seen.map(Math.abs))}`);
  // ROLL DOMINATES: a tumbling airframe reads as a roll first.
  const c = createCrashFx();
  c.start(crashStart({ seed: 3 }));
  check(
    "roll dominates the other axes",
    Math.abs(c.state.tumble.z) > Math.abs(c.state.tumble.x) &&
      Math.abs(c.state.tumble.z) > Math.abs(c.state.tumble.y),
    JSON.stringify(c.state.tumble),
  );
  check("the quaternion stays normalised through the tumble", (() => {
    for (let t = 0; t < 1.2; t += 1 / 60) c.update(1 / 60);
    const q = c.state.quat;
    return Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-6;
  })());

  // MOMENTUM IS INHERITED -- the aircraft does not stop in midair -- and it
  // FALLS while continuing forward.
  const { frames } = runCrash({ velocity: { x: 0, y: 0, z: -250 } });
  const end = frames[frames.length - 1];
  check("the aircraft keeps moving forward", end.z < -30, `${end.z}`);
  check("and falls while doing it", end.y < 600, `${end.y}`);
  // A 250 m/s crash travels a BELIEVABLE distance rather than teleporting.
  const travelled = Math.abs(end.z);
  check(
    "a 250 m/s crash travels a believable distance",
    travelled > 40 && travelled < 260,
    `${travelled.toFixed(0)} m in ${end.t.toFixed(2)} s`,
  );
}

function testOceanCrashSinks() {
  // WATER NEEDS REAL WORK, NOT A PALETTE SWAP. Without the plunge impulse the
  // aircraft drifts two metres in three quarters of a second and visibly
  // skates along the surface.
  const ocean = runCrash({ reason: "ocean", position: { x: 0, y: 4, z: 0 } });
  const terrain = runCrash({ reason: "terrain", position: { x: 0, y: 4, z: 0 } });
  const oceanEnd = ocean.frames[ocean.frames.length - 1];
  const terrainEnd = terrain.frames[terrain.frames.length - 1];
  check("an ocean crash goes under", oceanEnd.y < -20, `${oceanEnd.y.toFixed(1)}`);
  check(
    "it sinks far faster than a terrain impact",
    oceanEnd.y < terrainEnd.y - 20,
    `ocean ${oceanEnd.y.toFixed(1)} vs terrain ${terrainEnd.y.toFixed(1)}`,
  );
  // Hidden BEFORE it is meaningfully under, so the intact airframe is never
  // seen submerged and skating along the surface.
  const hiddenAt = ocean.frames.find((f) => f.opacity < 0.05);
  const deepAt = ocean.frames.find((f) => f.y < -25);
  check(
    "it is hidden before it is meaningfully under",
    hiddenAt && deepAt && hiddenAt.t < deepAt.t,
    `hidden ${hiddenAt?.t.toFixed(2)}s, deep ${deepAt?.t.toFixed(2)}s`,
  );
  // And far sooner than a terrain impact fades.
  const terrainHidden = terrain.frames.find((f) => f.opacity < 0.05);
  check(
    "an ocean crash fades far sooner than a terrain one",
    hiddenAt.t < terrainHidden.t - 0.3,
    `ocean ${hiddenAt.t.toFixed(2)}s vs terrain ${terrainHidden.t.toFixed(2)}s`,
  );
}

function testCrashDuplicateSuppression() {
  // DUPLICATE SUPPRESSION ON EVERY FRAME of the crash window. A tumbling
  // aircraft grinding through a mountain must not produce BOOM BOOM BOOM.
  const policy = createMissionCheckpointResponse({});
  const contact = { type: "terrain", predicted: false, position: { x: 0, y: 0, z: 0 }, speed: 200 };
  check("the first impact is accepted", policy.handleCollision(contact) === true);
  let extra = 0;
  for (let t = 0; t < T.holdEnds; t += 1 / 60) {
    if (policy.handleCollision(contact)) extra++;
    policy.tick(1 / 60);
  }
  check("every frame of the crash window is refused", extra === 0, `${extra}`);
  check("the failure count stayed at one", policy.failures() === 1, `${policy.failures()}`);

  // reset() clears the clock and every entity; finish() restores opacity.
  const { crash } = runCrash();
  check("entities exist mid-crash", crash.entityCount() > 0);
  check("the entity peak is within budget", crash.entityCount() < 90, `${crash.entityCount()}`);
  crash.reset();
  check("reset clears the clock", crash.state.t === 0);
  check("reset clears every entity", crash.entityCount() === 0);
  check("reset restores opacity", crash.state.aircraftOpacity === 1);

  const c2 = createCrashFx();
  c2.start(crashStart());
  for (let t = 0; t < 1; t += 1 / 60) c2.update(1 / 60);
  c2.finish();
  check("finish restores aircraft opacity", c2.state.aircraftOpacity === 1);
  check("finish ends the crash", c2.state.active === false);
}

function testSpawnClearance() {
  const flat = () => 0;
  // Flat ground gives the plain clearance.
  check(
    "flat ground gives the plain clearance",
    safeSpawnAltitude({ x: 0, y: 0, z: 0 }, 0, flat) === SPAWN_CLEARANCE,
  );

  // GROUND *AHEAD* RAISES IT. Heading 0 is -Z, so a ridge at negative z is
  // ahead. This is the whole point: a levelled attitude 320 m over a valley
  // floor with a 600 m ridge 1.5 km ahead puts the player back into contact
  // within two seconds and the crash repeats forever.
  const ridgeAhead = (x, z) => (z < -1000 && z > -2000 ? 600 : 0);
  check(
    "ground ahead raises the spawn",
    safeSpawnAltitude({ x: 0, y: 0, z: 0 }, 0, ridgeAhead) === 600 + SPAWN_CLEARANCE,
    `${safeSpawnAltitude({ x: 0, y: 0, z: 0 }, 0, ridgeAhead)}`,
  );
  // THE SAME POSITION FACING AWAY DOES NOT -- which is what proves it samples
  // a corridor along the heading rather than a disc around the point.
  check(
    "the same position facing away does not",
    safeSpawnAltitude({ x: 0, y: 0, z: 0 }, Math.PI, ridgeAhead) === SPAWN_CLEARANCE,
  );
  // Ground at the spawn POINT itself is caught too (the d = 0 sample).
  const underfoot = (x, z) => (Math.abs(z) < 50 ? 900 : 0);
  check(
    "ground at the spawn point itself is caught",
    safeSpawnAltitude({ x: 0, y: 0, z: 0 }, 0, underfoot) === 900 + SPAWN_CLEARANCE,
  );
  // No sampler still yields a floor.
  check("no sampler still yields a floor", safeSpawnAltitude({ x: 0, y: 0, z: 0 }, 0, null) === SPAWN_CLEARANCE);

  // The respawn: backed off along the heading of travel, levelled, at cruise.
  const spawn = respawnFrom({ x: 0, y: 100, z: -5000 }, 0, flat);
  check("the respawn backs off along the heading", spawn.position.z > -5000, `${spawn.position.z}`);
  check(
    "it backs off the full distance",
    Math.abs(spawn.position.z - (-5000 + RESPAWN_BACKOFF)) < 1e-6,
  );
  check("the respawn is levelled", spawn.pitch === 0 && spawn.bank === 0);
  check("sink is zeroed", spawn.sink === 0);
  // NO ESCALATION: with a finite pilot count, converging over several deaths
  // costs the player the run, so the FIRST attempt is simply high enough that
  // terrain cannot be a factor -- 4000 m against a 643 m peak.
  check(
    "the respawn is high enough that terrain cannot be a factor",
    spawn.position.y >= RESPAWN_ALTITUDE,
    `${spawn.position.y}`,
  );
  check("4000 m clears the 643 m peak by a wide margin", RESPAWN_ALTITUDE > 643 * 5);
  // A very tall ridge still raises it above the fixed floor.
  const huge = respawnFrom({ x: 0, y: 100, z: -5000 }, 0, () => 6000);
  check("a taller obstacle still raises the floor", huge.position.y > RESPAWN_ALTITUDE, `${huge.position.y}`);
}

// ── audio ─────────────────────────────────────────────────────────────────

function fakeAudio() {
  const made = [];
  const el = () => {
    const listeners = {};
    const e = {
      src: "", loop: false, volume: 1, currentTime: 0, playbackRate: 1,
      networkState: 1, paused: true,
      addEventListener: (t, fn) => (listeners[t] = fn),
      play() { this.paused = false; },
      pause() { this.paused = true; },
      fail() { listeners.error?.(); },
    };
    made.push(e);
    return e;
  };
  return { el, made };
}

function testAudioPriorityAndDucking() {
  check("priorities are ordered AMBIENT < WEAPON < WARNING < CRITICAL",
    AMBIENT < WEAPON && WEAPON < WARNING && WARNING < CRITICAL);
  check("the engine loop is AMBIENT", CUES.ENGINE_LOOP.priority === AMBIENT);
  check("the gun is WEAPON", CUES.GUN.priority === WEAPON);
  check("LOCK is a WARNING", CUES.LOCK.priority === WARNING);
  check("MISSILE is CRITICAL", CUES.MISSILE.priority === CRITICAL);
  // THE PLAYER'S OWN LAUNCH IS WEAPON, NOT WARNING -- it confirms something
  // they did and must never mask an inbound call.
  check("the player's own launch is WEAPON, not WARNING", CUES.MISSILE_LAUNCH.priority === WEAPON);
  // THE GUN IS A LOOP, not 48 one-shots a second.
  check("the gun is a loop", CUES.GUN.loop === true);
  check("the engine loop loops", CUES.ENGINE_LOOP.loop === true);
  check("warnings are not loops", !CUES.LOCK.loop && !CUES.PULL_UP.loop);

  const { el } = fakeAudio();
  const audio = createAudio({ createElement: el });
  audio.arm();
  check("no duck at rest", audio.duckLevel() === 1);
  audio.play("LOCK");
  check("a warning ducks", audio.duckLevel() < 1, `${audio.duckLevel()}`);
  const afterWarning = audio.duckLevel();
  // A WARNING NEVER DUCKS ANOTHER WARNING -- the second is the one that
  // matters, and pushing it down would bury the information.
  audio.tick(4);
  audio.play("MISSILE");
  const afterCritical = audio.duckLevel();
  check("a critical cue ducks harder than a warning", afterCritical < afterWarning,
    `${afterCritical} vs ${afterWarning}`);
  audio.tick(2);
  check("the duck expires", audio.duckLevel() === 1);
}

function testAudioIntervalsAndTakes() {
  const { el } = fakeAudio();
  const audio = createAudio({ createElement: el });
  audio.arm();

  // EVERY ONE-SHOT HAS A MINIMUM INTERVAL: a cue that repeats is a cue nobody
  // hears.
  check("the first LOCK fires", audio.play("LOCK") === true);
  check("an immediate second is refused", audio.play("LOCK") === false);
  audio.tick(1);
  check("still refused inside the interval", audio.mayFire("LOCK") === false);
  audio.tick(3);
  check("allowed once the interval has passed", audio.mayFire("LOCK") === true);

  // FLARES is forced past its own floor -- it confirms a deliberate action.
  check("a forced cue ignores its floor", audio.mayFire("FLARES") === true);

  // MULTI-TAKE CUES ROTATE ROUND-ROBIN, so with three takes it is PROVABLY
  // never twice in a row -- which random selection cannot promise.
  const a2 = createAudio({ createElement: el });
  a2.arm();
  const takes = [];
  for (let i = 0; i < 9; i++) takes.push(a2.nextTake("LOCK"));
  check("three takes rotate 0,1,2", takes.join("") === "012012012", takes.join(""));
  check("no take repeats consecutively", takes.every((t, i) => i === 0 || t !== takes[i - 1]));
  const two = [];
  for (let i = 0; i < 6; i++) two.push(a2.nextTake("MISSILE"));
  check("two takes alternate", two.join("") === "010101", two.join(""));

  // A one-shot cannot be looped, and a one-shot CAN be stopped early -- the
  // engine start-up is cut the instant the catapult fires.
  const a3 = createAudio({ createElement: el });
  a3.arm();
  check("startLoop refuses a one-shot", a3.startLoop("LOCK") === false);
  check("startLoop accepts the gun", a3.startLoop("GUN") === true);
  a3.play("ENGINE_START", { force: true });
  check("the start-up is playing", a3.isPlaying("ENGINE_START") === true);
  check("a one-shot can be stopped early", a3.stop("ENGINE_START") === true);
  check("and is then not playing", a3.isPlaying("ENGINE_START") === false);
  check("the start-up plays at double rate", CUES.ENGINE_START.rate === 2);
}

function testAudioGesturesAndMissingFiles() {
  const { el, made } = fakeAudio();
  const audio = createAudio({ createElement: el });
  // NOTHING PLAYS BEFORE A USER GESTURE.
  check("nothing plays before a gesture", audio.play("LOCK") === false);
  check("arming reports the first time only", audio.arm() === true && audio.arm() === false);
  check("and then it plays", audio.play("LOCK") === true);

  audio.setMuted(true);
  check("muted plays nothing", audio.play("MISSILE") === false);
  audio.setMuted(false);
  check("unmuted plays again", audio.play("MISSILE") === true);

  // MISSING AUDIO FILES ARE A NORMAL STATE. Marked unavailable only on
  // POSITIVE FAILURE -- never on readyState < 3, which is also the state of a
  // file that simply has not finished loading and which would mark every
  // working file as missing.
  check("every cue starts available", audio.missingCues().length === 0);
  check("a cue that has not loaded yet is still available", audio.isAvailable("PULL_UP") === true);
  made[0].fail();
  check("a positive error marks a cue missing", audio.missingCues().length === 1);
  const failedName = audio.missingCues()[0];
  check("a missing cue does not play", audio.play(failedName) === false);
  check("the rest still play", audio.play("PULL_UP") === true);
  // The game runs silent rather than throwing.
  const silent = createAudio({ createElement: () => null });
  silent.arm();
  check("a build with no audio at all does not throw", silent.play("LOCK") === true);
}

function testGroundWarningsAndFlyby() {
  // BOTH LEVELS READ AGL, NOT ALTITUDE ABOVE SEA LEVEL -- so 200 m over the
  // ocean is quiet and 200 m into a 600 m ridge is not.
  check(
    "high above the ground is quiet",
    groundWarning({ agl: 900, forwardHazard: Infinity, sink: 0, speed: 200 }) === null,
  );
  check(
    "low AGL calls ALTITUDE",
    groundWarning({ agl: 180, forwardHazard: Infinity, sink: 0, speed: 200 }) === "ALTITUDE",
  );
  check(
    "an imminent forward hazard calls PULL UP",
    groundWarning({ agl: 900, forwardHazard: 100, sink: 0, speed: 200 }) === "PULL_UP",
  );
  check(
    "low and descending calls PULL UP",
    groundWarning({ agl: 100, forwardHazard: Infinity, sink: 20, speed: 200 }) === "PULL_UP",
  );
  // THE POINT OF USING AGL: the SAME altitude reads differently depending on
  // what is underneath. 200 m over open water is 200 m AGL; 200 m over a 600 m
  // ridge is 400 m INSIDE it. An earlier version of this check asserted 201 m
  // AGL was quiet, which is simply false -- the threshold is 220.
  const overWater = groundWarning({
    agl: 200, forwardHazard: Infinity, sink: 0, speed: 200,
  });
  const overRidge = groundWarning({
    agl: 200 - 600, forwardHazard: 120, sink: 0, speed: 200,
  });
  check("200 m over water is only an ALTITUDE call", overWater === "ALTITUDE", String(overWater));
  check("the same altitude into a ridge is a PULL UP", overRidge === "PULL_UP", String(overRidge));
  check(
    "well clear of the sea is silent",
    groundWarning({ agl: 400, forwardHazard: Infinity, sink: 0, speed: 200 }) === null,
  );

  // THE FLY-BY FIRES ONCE PER PASS: a range that crossed the threshold THIS
  // FRAME plus real closure.
  check("a crossing with closure is a fly-by", isFlyby(400, 300, 300) === true);
  check("a slow drift past is not", isFlyby(400, 300, 20) === false);
  check("already inside is not a new pass", isFlyby(300, 280, 300) === false);
  check("still outside is not", isFlyby(900, 800, 300) === false);
}

// ── HUD.md H13 gates ──────────────────────────────────────────────────────

function testHudScale() {
  // H13.1
  check("hudScale(720) clamps to the lower bound", hudScale(720) === 0.85, String(hudScale(720)));
  check("hudScale(1080) is exactly 1", hudScale(1080) === 1, String(hudScale(1080)));
  check("hudScale(1440) is 1.333", Math.abs(hudScale(1440) - 4 / 3) < 1e-9);
  check("hudScale(2160) clamps to the upper bound", hudScale(2160) === 2.0, String(hudScale(2160)));
  check("a degenerate height falls back to the floor", hudScale(0) === 0.85);

  // The smallest ramp entry must never render below 11 CSS px. The ramp's
  // smallest is 10 and the lower clamp is 0.85, so 8.5 -- the scale alone
  // cannot satisfy this and the absolute floor is what does.
  const smallest = Math.min(...Object.values(RAMP).map((r) => r.size));
  check("the smallest ramp entry is the 10-referenced label", smallest === 10, String(smallest));
  for (const height of [720, 900, 1080, 1440, 2160]) {
    const px = fontPx("radarLabel", hudScale(height));
    check(`the smallest text at ${height}p is at least 11 px`, px >= 11, String(px));
  }
  check(
    "the floor does not shrink type that is already large enough",
    fontPx("primary", hudScale(1080)) === 26,
  );

  // THE DPR TRAP (H3): the SVG viewBox is already in CSS pixels, so the browser
  // has handled devicePixelRatio before any of this runs. Multiplying by it
  // double-counts and produces the enormous-HUD bug.
  //
  // Asserted as BEHAVIOUR rather than by grepping the source: move the global
  // devicePixelRatio and the scale must not budge. A source scan proves only
  // that one spelling is absent; this proves the value cannot depend on it,
  // however it were reached.
  const savedDpr = globalThis.devicePixelRatio;
  const atDpr = (dpr) => {
    Object.defineProperty(globalThis, "devicePixelRatio", {
      value: dpr, configurable: true, writable: true,
    });
    return hudScale(1080);
  };
  const one = atDpr(1);
  const three = atDpr(3);
  const fractional = atDpr(2.625);
  if (savedDpr === undefined) delete globalThis.devicePixelRatio;
  else {
    Object.defineProperty(globalThis, "devicePixelRatio", {
      value: savedDpr, configurable: true, writable: true,
    });
  }
  check(
    "the scale unit does not depend on devicePixelRatio",
    one === 1 && three === 1 && fractional === 1,
    `dpr1 ${one}, dpr3 ${three}, dpr2.625 ${fractional}`,
  );
}

function testFlankLayout() {
  // H13.2
  const u = hudScale(1080);
  const widths = [1280, 1920, 2560, 3840];
  const flanks = widths.map((w) => flankOffset(w, u));
  check(
    "flank is monotonic in width",
    flanks.every((f, i) => i === 0 || f >= flanks[i - 1]),
    flanks.map((f) => f.toFixed(1)).join(", "),
  );
  check("flank is never below 92u", flanks.every((f) => f >= 92 * u));
  check("flank is never above 300u", flanks.every((f) => f <= 300 * u));

  // 0.14 x w replaces 0.18: at 2500 px the columns sat 300 px off centre while
  // the boresight cross was 13 px wide, so nothing occupied the middle third.
  check(
    "the flank fraction is 0.14, not 0.18",
    FLANK_FRACTION === 0.14,
    String(FLANK_FRACTION),
  );
  check(
    "at 2560 the columns are pulled in from the old 0.18 placement",
    flankOffset(2560, u) < 0.18 * 2560,
    `${flankOffset(2560, u).toFixed(0)} vs ${(0.18 * 2560).toFixed(0)}`,
  );

  // A 320 px developer rail must never be crossed.
  for (const w of widths) {
    const col = flankColumns(w, u, 320);
    check(`spdX clears a 320 px rail at w=${w}`, col.spdX > 320 - 1e-9, String(col.spdX));
  }
  // safeLeft only ever RAISES the floor -- it can never pull a column inward.
  const free = flankColumns(1920, u, 0);
  const railed = flankColumns(1920, u, 900);
  check("safeLeft raises the floor", railed.spdX === 900, String(railed.spdX));
  check("safeLeft never moves the right column", railed.altX === free.altX);
  check("with no rail the column sits at cx - flank", free.spdX === 960 - free.flank);
}

function testAglReadout() {
  // H13.5. AGL OVER WATER READS AN EM DASH, NOT ZERO: a dash means "not a
  // factor", a zero means "you are about to die", and the sea must not cry
  // wolf for the four minutes of the sortie flown over it.
  const water = aglReadout(0, true);
  check("AGL over water is an em dash", water.text === "—", water.text);
  check("and it is dim, not a warning colour", water.colour === C.dim);
  check("a non-finite AGL is also a dash", aglReadout(Infinity, false).text === "—");

  check("AGL 300 is neutral", aglReadout(300, false).colour === C.line);
  check("AGL 200 is amber", aglReadout(200, false).colour === C.warn);
  check("AGL 100 is salmon", aglReadout(100, false).colour === C.danger);
  check("AGL 300 prints the number", aglReadout(300, false).text === "300");
  check("the thresholds are 220 and 110", AGL_WARN === 220 && AGL_DANGER === 110);
}

function testStoresPanel() {
  // H13.6
  const u = hudScale(1080);
  const base = {
    w: 1920, h: 1080, u, weapon: "AIM-9", missiles: 4, missileCapacity: 4,
    gunRounds: 500, flares: 8,
  };
  const panel = storesPanel(base);
  check("the panel is right-anchored", panel.anchor === "end");
  check("it has three rows", panel.rows.length === 3);

  // THE SELECTED WEAPON IS MARKED BY POSITION AND GLYPH, NOT BY COLOUR ALONE:
  // colour-only selection fails for a colour-blind player and fails again on a
  // bright deck.
  const selected = panel.rows.find((r) => r.selected);
  check("the selected row carries a marker glyph", selected.marker === "›", selected.marker);
  check("unselected rows carry no marker", panel.rows.filter((r) => !r.selected).every((r) => r.marker.trim() === ""));
  check("the selected row is full brightness", selected.colour === C.line);
  check("unselected rows are dim", panel.rows.find((r) => r.key === "GUN").colour === C.dim);
  const gunSelected = storesPanel({ ...base, weapon: "GUN" });
  check("selection follows the weapon", gunSelected.rows.find((r) => r.key === "GUN").marker === "›");

  // PIPS, NOT JUST DIGITS. Two AIM-9 is a quantity a player must FEEL.
  check("four of four is four full pips", panel.rows[0].glyph === "▮▮▮▮", panel.rows[0].glyph);
  const two = storesPanel({ ...base, missiles: 2 });
  check("two of four is two full and two hollow", two.rows[0].glyph === "▮▮▭▭", two.rows[0].glyph);

  // EMPTY IS AMBER, NEVER HIDDEN. A row that disappears when empty teaches
  // nothing.
  const dry = storesPanel({ ...base, missiles: 0 });
  check("an empty magazine is still present", dry.rows.length === 3);
  check("an empty magazine is amber", dry.rows[0].colour === C.warn, dry.rows[0].colour);
  check("an empty magazine has hollow pips", dry.rows[0].glyph === "▭▭▭▭", dry.rows[0].glyph);
  check("the empty row still prints its count", dry.rows[0].count === 0);

  // The gun is a FRACTION, not a count, so it gets an eight-cell bar.
  check("a full gun is eight lit cells", panel.rows[1].glyph === "▬".repeat(8), panel.rows[1].glyph);
  const half = storesPanel({ ...base, gunRounds: 250 });
  check("a half gun is four lit cells", half.rows[1].glyph === "▬▬▬▬▭▭▭▭", half.rows[1].glyph);

  // THE REARM LINE ONLY EXISTS WHILE A TIMER RUNS, and names WHICH magazine.
  check("no rearm line when no timer runs", panel.rearm === null);
  const rearming = storesPanel({ ...base, rearm: { name: "AIM-9", seconds: 11.2 } });
  check("a running timer produces a line", rearming.rearm !== null);
  check("and it names the magazine", rearming.rearm.text.includes("AIM-9"), rearming.rearm.text);
  check("and it is amber", rearming.rearm.colour === C.warn);
  check("and it rounds up the seconds", rearming.rearm.text.includes("12s"), rearming.rearm.text);

  // H13.7: the panel must clear the radar ring at BOTH ends of the u clamp --
  // the two places a collision would first appear.
  //
  // Measured against the ring's TRUE top (2r + margin above the bottom), not
  // against `r + margin` as H13.7 words it -- that is the ring's CENTRE line,
  // and a panel can clear it while still overlapping the upper half of the
  // ring. The weaker reading passed here while the live nodes overlapped by
  // 58 px at 2560x1440.
  for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]) {
    const uu = hudScale(h);
    const p = storesPanel({ ...base, w, h, u: uu });
    const trueRadarTop = h - (2 * RADAR_RADIUS + RADAR_MARGIN) * uu;
    check(
      `stores clears the radar RING at ${w}x${h}`,
      p.bottom <= trueRadarTop && p.top < trueRadarTop,
      `bottom ${p.bottom.toFixed(0)}, ring top ${trueRadarTop.toFixed(0)}`,
    );
    check(
      `stores also clears H13.7's stated line at ${w}x${h}`,
      p.top < h - (RADAR_RADIUS + RADAR_MARGIN) * uu,
    );
  }
}

function testModeSegment() {
  // H13.9
  const u = hudScale(1080);
  const mission = modeSegment({ h: 1080, u, mode: "ASSISTED", lives: 5 });
  check("MISSION shows the pilot count", mission.text.includes("5 PILOTS"), mission.text);
  check("it is bottom-left anchored", mission.anchor === "start");

  // PILOTS is MISSION ONLY: counting deaths in a sandbox turns practice into a
  // test, so the segment is ABSENT ENTIRELY in FREE and PEACE.
  const free = modeSegment({ h: 1080, u, mode: "ASSISTED", lives: null });
  check("FREE has no PILOTS segment", !free.text.includes("PILOT"), free.text);
  check("and no pilots part at all", free.parts.length === 1);
  const peace = modeSegment({ h: 1080, u, mode: "EXPERT", lives: undefined });
  check("PEACE has no PILOTS segment", !peace.text.includes("PILOT"), peace.text);

  // EXPERT renders in the good tint, so the modes are distinguishable at a
  // glance without reading the word.
  check("EXPERT is the good tint", modeSegment({ h: 1080, u, mode: "EXPERT", lives: 5 }).parts[0].colour === C.good);
  check("ASSISTED is not", mission.parts[0].colour !== C.good);

  // Pilots shift amber at 2, salmon at 1.
  check("5 pilots is dim", modeSegment({ h: 1080, u, mode: "ASSISTED", lives: 5 }).parts[1].colour === C.dim);
  check("2 pilots is amber", modeSegment({ h: 1080, u, mode: "ASSISTED", lives: 2 }).parts[1].colour === C.warn);
  check("1 pilot is salmon", modeSegment({ h: 1080, u, mode: "ASSISTED", lives: 1 }).parts[1].colour === C.danger);
  check("1 pilot is singular", modeSegment({ h: 1080, u, mode: "ASSISTED", lives: 1 }).text.includes("1 PILOT"), "plural");

  // The mode brightens for 1.2 s after M, then settles back.
  check("a fresh mode change is bright", modeSegment({ h: 1080, u, mode: "ASSISTED", lives: 5, modeChangedAgo: 0.4 }).parts[0].colour === C.line);
  check("and settles back after 1.2 s", modeSegment({ h: 1080, u, mode: "ASSISTED", lives: 5, modeChangedAgo: 2 }).parts[0].colour === C.dim);
}

function testStackAndColours() {
  // H13.8: the stack has EXACTLY THREE slots. A fourth line of combat text is
  // a redesign of the stack, not an addition to it.
  check("the stack has exactly three slots", STACK_SLOTS.length === 3, String(STACK_SLOTS.length));
  check("the slots descend", STACK_SLOTS[0] < STACK_SLOTS[1] && STACK_SLOTS[1] < STACK_SLOTS[2]);
  check("stackY maps them onto a viewport", stackY(1000).join(",") === "630,665,695");

  // H12: six hues and no gradients.
  for (const key of ["line", "dim", "faint", "good", "nav", "warn", "danger", "ab", "radar"]) {
    check(`the palette defines ${key}`, typeof C[key] === "string" && C[key].length > 0);
  }
  check("no colour is a gradient", Object.values(C).every((v) => !v.includes("gradient")));

  // H4: the casing contract the shared text() helper applies.
  check("the casing paints stroke under fill", CASING.paintOrder === "stroke fill");
  check("the casing is a dark translucent stroke", CASING.stroke.startsWith("rgba(4, 8, 10"));
  check("text casing is 2.6u", CASING.textWidth === 2.6);
  check("symbol casing is 1.8u", CASING.symbolWidth === 1.8);
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
  ["stroke curve", testStrokeCurve],
  ["closed form vs its own integral", testClosedFormMatchesItsOwnIntegral],
  ["both stroke inverses", testBothInverses],
  ["solving against decks", testSolveAgainstDecks],
  ["deck dwell is measured", testDeckDwellIsMeasured],
  ["launch sequence at 60 and 20 Hz", testLaunchSequence],
  ["parked pose", testParkedPose],
  ["launch camera blend", testLaunchCameraBlend],
  ["the script owns the aircraft", testLaunchOwnsTheAircraft],
  ["target contract", testTargetContract],
  ["lock progression", testLockProgression],
  ["lead solution", testLeadSolution],
  ["missile guidance", testMissileGuidance],
  ["overshoot needs angle AND opening range", testOvershootNeedsAngleAndOpeningRange],
  ["a defeated round keeps flying", testDefeatedRoundKeepsFlying],
  ["expireOwner", testExpireOwner],
  ["missile turn radius", testMissileTurnRadius],
  ["gun magazine and fx", testGunMagazineAndFx],
  ["hostile transition table", testHostileTransitionTable],
  ["ammo 0 is the design tool", testAmmoZeroIsTheDesignTool],
  ["DEFEND rules", testDefendRules],
  ["the break direction is latched", testBreakDirectionIsLatched],
  ["hostile altitude guard", testAltitudeGuard],
  ["inactive means inactive", testInactiveMeansInactive],
  ["deploy and spent", testDeployAndSpent],
  ["hostile round fairness", testHostileRoundFairness],
  ["threat escalation", testThreatEscalation],
  ["the authority hook", testAuthorityHook],
  ["damage response fires once", testDamageResponseFiresOnce],
  ["mission transition table", testMissionTransitionTable],
  ["trigger volumes", testTriggerVolumes],
  ["bandFeature uses the weaker flank", testBandFeatureUsesTheWeakerFlank],
  ["zoning spreads a clustered field", testZoningSpreadsAClusteredField],
  ["the route plan", testRoutePlan],
  ["end-to-end missions", testEndToEndMissions],
  ["the mission clock", testMissionClock],
  ["a checkpoint is flyable", testCheckpointIsFlyable],
  ["the mission failure policy", testMissionFailurePolicy],
  ["the extraction autopilot", testAutopilot],
  ["line of sight", testLineOfSight],
  ["SAM transition table", testSamTransitionTable],
  ["one launch per lock", testOneLaunchPerLock],
  ["a masked site never launches", testMaskedSiteNeverLaunches],
  ["SAM placement", testSamPlacement],
  ["SAM wreck and contract", testSamWreckAndContract],
  ["the SAM round", testSamRound],
  ["seduces", testSeduces],
  ["decoy end to end with a MOVING aircraft", testDecoyEndToEndWithAMovingAircraft],
  ["rearm", testRearm],
  ["the modes table", testModesTable],
  ["the sandbox driver", testSandboxDriver],
  ["a parked director never completes", testParkedDirectorNeverCompletes],
  ["crash cause mapping", testCrashCauseMapping],
  ["crash timeline ordering", testCrashTimelineOrdering],
  ["the aircraft stays visible, then fades", testCrashAircraftVisibility],
  ["the crash camera kick", testCrashCamera],
  ["tumble is latched, momentum inherited", testCrashTumbleAndMomentum],
  ["an ocean crash sinks", testOceanCrashSinks],
  ["crash duplicate suppression", testCrashDuplicateSuppression],
  ["spawn clearance", testSpawnClearance],
  ["audio priority and ducking", testAudioPriorityAndDucking],
  ["audio intervals and takes", testAudioIntervalsAndTakes],
  ["audio gestures and missing files", testAudioGesturesAndMissingFiles],
  ["ground warnings and the fly-by", testGroundWarningsAndFlyby],
  ["HUD scale unit", testHudScale],
  ["HUD flank layout", testFlankLayout],
  ["HUD AGL readout", testAglReadout],
  ["HUD stores panel", testStoresPanel],
  ["HUD mode and pilots", testModeSegment],
  ["HUD stack and colours", testStackAndColours],
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
