/**
 * Minimal deterministic checks for the flight math. No test runner in the
 * project yet, so this runs in-page: open index.html?test=1 and read the
 * console. Ports to vitest/jest unchanged — flight.js imports nothing.
 */
import { createFlightState, updateFlight, forwardFromAngles, bankSinkRate, requestRoll, bankDegrees, getTargetSpeed, speedToThrottle, moveTowards, resetFlightState, wrapAngle, turnBank, setFlightMode, toggleFlightMode, isExpert, attitudeVectors, quat, quatForward, quatUp, quatMultiply, quatFromEulerYXZ, quatNormalize, MODE, EXPERT, CRUISE_THROTTLE, SPEED, THROTTLE, DEG, FLIGHT, ROLL } from "./flight.js";
import { framingTilt, fovForAspect, CHASE } from "./chase-camera.js";
import * as THREE from "three";
import { captureFlightState, applyFlightState } from "./flight.js";
import { PHYSICS, SURFACE, CONTACT, PROBES, lookAheadDistance, groundReference, classifyContact, isSafeToRecord, buildTerrainIndex, terrainHeightAt, terrainNormalAt, imminentForwardDistance, forwardTerrainHit, collectMeshes, createWorldPhysics } from "./physics.js";
import { CollisionType, RECOVERY, requiredSafeClearance, createCollisionEvent, createSafeStateHistory, createDevelopmentRecoveryResponse, recoveryNormal } from "./collision.js";
import { WORLD, longestHorizontalAxis, alignYaw, scaleToTarget, distanceKm, percentile, modalHeight } from "./world.js";
import { WEAPONS, WeaponMode, cycleWeapon, createWeaponMounts, createMountedMissiles, normalizeMissile, buildPlaceholderMissile, buildLaunchRail } from "./weapons.js";
import { LockState, LockFail, TARGETING, targetGeometry, qualifies, advanceLock, createTargetingSystem } from "./targeting.js";
import { MISSILE, MissileState, steer, segmentDistance, advanceSpeed, leadPoint, overshooting, createMissileSystem } from "./missile.js";
import { ENEMY, createTargetDrone, updateTargetDrone, integrateDrone, resetTargetDrone, markTargetHit, damageTarget, normalizeHostileModel, installHostileVisual, HOSTILE_MODEL } from "./enemy.js";
import { HOSTILE, HOSTILE_MISSILE, HostileState, wrapPi, aimAngles, forwardFrom, offNoseDeg, steerAngle, predictPoint, inAttackCone, altitudeGuard, hostileTransition, phaseSpeed, createHostileAI } from "./hostile.js";
import { THREAT, ThreatLevel, ThreatTier, threatLevelOf, warningTier, threatBearing, dodgeWindow, inDodgePeak, evasionAuthority, evadeEarned, mergeHostiles, createThreatMonitor } from "./threat.js";
import { DamageSource, createPlayerDamageEvent, createDevelopmentHitResponse } from "./damage.js";
import { HUD, apparentSize, damp, dampAngle, derivePitchDeg, deriveBankDeg, deriveHeadingDeg, uiScaleFor } from "./combat-hud.js";
import { ENGINE_FX, engineIntensity, ringOpacity, flickerAt } from "./engine-fx.js";
import { GUN, gunShots, rangeEffect, gunDamage, hitscanRange, leadSolution, createGunSystem } from "./gun.js";
import { VAPOR, maneuverLoad, vaporIntensity, approach } from "./vapor-fx.js";
import { ATMOS, seededRandom, densityAt, distanceToCloud, humidityFor, advisoryFor, createAdvisoryLatch, createCloudField } from "./atmosphere.js";
import { KEYBOARD, PitchMode, applyPitchMode, MOUSE, pointerStick, combineAxis, createInput } from "./input.js";
import {
  LAUNCH,
  LaunchStage,
  strokeEase,
  strokeSpeed,
  strokeDistance,
  solveStrokeTime,
  solveExitSpeed,
  planStroke,
  sequenceDuration,
  spoolThrottle,
  launchFov,
  createLaunchSequence,
} from "./launch.js";
import {
  MISSION,
  MissionPhase,
  PHASE_ORDER,
  AUTOPILOT,
  phaseCheckpoint,
  opensCheckpoint,
  encounterFor,
  weaponsHotIn,
  playerFliesIn,
  flatDistanceTo,
  bearingTo,
  createTrigger,
  insideTrigger,
  bandFeature,
  pickRouteFeatures,
  surveyTerrainRoute,
  pickZonedFeatures,
  planRoute,
  missionTransition,
  autopilotStick,
  blendStick,
  formatClock,
  formatShortClock,
  missionSummary,
  missionExpired,
  routeOverlaps,
  createMissionDirector,
} from "./mission.js";
import { MISSION_FAILURE, createMissionCheckpointResponse } from "./collision.js";
import { setGearVisual, setGearForFlight, GEAR_NODES } from "./aircraft.js";
import { REARM, createRearmTimer, createRearmSystem } from "./rearm.js";
import { AUDIO, Cue, Priority, engineVoice, takeIndex, mayFire, groundWarning, secondsToGround, flybyTriggered, createAudioDirector } from "./audio.js";
import { DAY, NIGHT, createWorldClock, wrapTau, sunElevation, sunDirection, nightFactor, dayFactor, paletteFor, environmentFor } from "./world-time.js";
import { LIGHTS, seeded, habitable, planSettlements, createCarrierLights } from "./night-lights.js";
import { OCEAN } from "./ocean.js";
import { breakDirection } from "./hostile.js";
import { SAM, SAM_MISSILE, SamState, lineOfSight, inEngagementRange, samTransition, samThreatLevel, createSamSite, createSamNetwork, wreckSamSite, resetSamSite, normalizeSamModel, installSamVisual } from "./sam.js";
import { GameMode, MODES, MODE_ORDER, SANDBOX, modeRules, nextMode, isSandbox, createSandbox , predictAhead, seedSamBatch, samBatchSpent } from "./modes.js";
import { planSamSites, safeSpawnAltitude } from "./mission.js";import { FLARE, seduces, ejectVelocity, createFlareSystem } from "./flares.js";
import { CRASH, CRASH_VARIANT, CrashCause, causeFromReason, makeTumble, aircraftOpacity, kickAmplitude, screenFlashAlpha, followBlend, createCrashFx } from "./crash-fx.js";

let failures = 0;
let total = 0;
/**
 * What failed, not just how many. The count alone is enough for the page --
 * a human reads the red lines above it -- but `pnpm check` runs this file
 * through spec/vector.test.ts in a process with no console to scroll, so a
 * red gate that cannot say WHICH check broke costs a re-run in the browser
 * to find out.
 * @type {{ name: string, detail: string }[]}
 */
const failureLog = [];
const check = (name, pass, detail = "") => {
  total += 1;
  failures += pass ? 0 : 1;
  if (!pass) failureLog.push({ name, detail: String(detail) });
  console[pass ? "log" : "error"](`${pass ? "PASS" : "FAIL"}  ${name}`, detail);
};
const step = (state, input, dt = 1 / 60, n = 1) => {
  for (let i = 0; i < n; i++) updateFlight(state, input, dt);
  return state;
};
const expertState = () => createFlightState(MODE.EXPERT);
const fwd = (s) => quatForward(s.quat, { x: 0, y: 0, z: 0 });
const upv = (s) => quatUp(s.quat, { x: 0, y: 0, z: 0 });
const hdgOf = (s) => {
  const f = fwd(s);
  return Math.atan2(-f.x, -f.z);
};

{
  const s = createFlightState();
  step(s, { x: 1, y: 0 }, 1 / 60, 30);
  check("right input banks right (negative roll)", s.bank < 0, s.bank);
  check("bank turns the heading", s.heading !== 0, s.heading);
  check("bank stays inside maxBank", Math.abs(s.bank) <= FLIGHT.maxBank + 1e-6, s.bank);
}

{
  const s = createFlightState();
  const z0 = s.position.z;
  step(s, { x: 0, y: 0 }, 1 / 60);
  check("neutral flight advances along -Z", s.position.z < z0, s.position.z - z0);
  check("neutral flight holds altitude", Math.abs(s.position.y - FLIGHT.spawn.y) < 1e-6, s.position.y);
}

{
  const s = createFlightState();
  step(s, { x: 0, y: 1 }, 1 / 60, 60);
  check("up input pitches up and climbs", s.pitch > 0 && s.position.y > FLIGHT.spawn.y, [s.pitch, s.position.y]);
}

{
  const s = createFlightState();
  step(s, { x: 1, y: 0 }, 1 / 60, 60);
  step(s, { x: 0, y: 0 }, 1 / 60, 240);
  check("bank self-levels toward zero on release", Math.abs(s.bank) < 0.05, s.bank);
}

{
  // Frame-rate independence: 1 s at 60 Hz vs 1 s at 20 Hz should land close.
  const a = step(createFlightState(), { x: 0.6, y: 0.2 }, 1 / 60, 60);
  const b = step(createFlightState(), { x: 0.6, y: 0.2 }, 1 / 20, 20);
  const drift = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z);
  check("motion is frame-rate independent (<2 m drift over 1 s)", drift < 2, `${drift.toFixed(3)} m`);
}

{
  const s = createFlightState();
  step(s, { x: 1, y: 0 }, 1 / 60, 300);
  check("bank saturates at maxBank", Math.abs(s.bank) <= FLIGHT.maxBank + 1e-6 && Math.abs(s.bank) > FLIGHT.maxBank - 0.02, s.bank);
  check("hard bank loses altitude", s.position.y < FLIGHT.spawn.y, s.position.y);
}

{
  check("level flight has no bank sink", bankSinkRate(0) === 0);
  const hard = bankSinkRate(FLIGHT.maxBank);
  check("70° bank sinks 8-13 m/s", hard > 8 && hard < 13, hard);
  check("sink grows with bank", bankSinkRate(0.3) < bankSinkRate(0.9));
}

{
  // Bank sink is integrated per second, so 60 Hz and 20 Hz must agree.
  const a = step(createFlightState(), { x: 1, y: 0 }, 1 / 60, 180);
  const b = step(createFlightState(), { x: 1, y: 0 }, 1 / 20, 60);
  check("bank sink is frame-rate independent", Math.abs(a.position.y - b.position.y) < 2, [a.position.y, b.position.y]);
}

{
  // Positive pitch should beat the sink of a hard turn.
  const turn = step(createFlightState(), { x: 1, y: 0 }, 1 / 60, 300);
  const pulled = step(createFlightState(), { x: 1, y: 0.5 }, 1 / 60, 300);
  check("pitch compensates bank sink", pulled.position.y > turn.position.y, [turn.position.y, pulled.position.y]);
}

{
  const s = createFlightState();
  check("roll starts", requestRoll(s, 1) === true);
  check("roll cannot stack", requestRoll(s, -1) === false);
  step(s, { x: 0, y: 0 }, 1 / 60, Math.round(ROLL.duration * 60 * 0.5)); // half way
  check("roll passes beyond the bank clamp", Math.abs(s.bank) > FLIGHT.maxBank, s.bank);
  check("mid-roll reports progress", s.maneuver.t > 0.45 && s.maneuver.t < 0.55, s.maneuver.t);
}

{
  const s = createFlightState();
  const h0 = s.heading;
  requestRoll(s, 1);
  step(s, { x: 0, y: 0 }, 1 / 60, Math.ceil(ROLL.duration * 60) + 5);
  check("roll completes and clears", s.maneuver === null);
  check("roll ends level", s.bank === 0 && s.pitch === 0, [s.bank, s.pitch]);
  check("roll is heading-neutral", Math.abs(s.heading - h0) < 1e-9, s.heading - h0);
  check("roll is near altitude-neutral (<25 m)", Math.abs(s.position.y - FLIGHT.spawn.y) < 25, s.position.y);
}

{
  // Closed-form in normalized time, so coarse frames must land identically.
  const a = createFlightState(); requestRoll(a, 1);
  const b = createFlightState(); requestRoll(b, 1);
  step(a, { x: 0, y: 0 }, 1 / 60, 90);
  step(b, { x: 0, y: 0 }, 1 / 20, 30);
  check("roll is frame-rate independent", Math.abs(a.position.y - b.position.y) < 2, [a.position.y, b.position.y]);
}

{
  // Entering a roll from a hard turn must not snap the wings level.
  const s = createFlightState();
  step(s, { x: 1, y: 0 }, 1 / 60, 300);
  const bankBefore = s.bank;
  check("test entered from a real bank", Math.abs(bankBefore) > 1.0, bankBefore);
  requestRoll(s, 1);
  step(s, { x: 0, y: 0 }, 1 / 60, 1);
  const snap = Math.abs(s.bank - bankBefore) / DEG;
  check("no bank snap entering a roll from a turn (<2 deg)", snap < 2, snap.toFixed(2));

  step(s, { x: 0, y: 0 }, 1 / 60, Math.ceil(ROLL.duration * 60));
  check("roll from a bank still ends level", s.maneuver === null && s.bank === 0, s.bank);
}

{
  const l = createFlightState(); requestRoll(l, -1);
  const r = createFlightState(); requestRoll(r, 1);
  step(l, { x: 0, y: 0 }, 1 / 60, 20);
  step(r, { x: 0, y: 0 }, 1 / 60, 20);
  check("roll direction is respected", Math.sign(l.bank) === -Math.sign(r.bank), [l.bank, r.bank]);
  // One sign convention across the roll axis, requestRoll's dir, and the HUD:
  // +1 is right, and right-hand bank is negative.
  check("requestRoll(+1) rolls right, like E", r.bank < 0, r.bank);
  check("requestRoll(-1) rolls left, like Q", l.bank > 0, l.bank);

  const axis = createFlightState();
  step(axis, { x: 0, y: 0, roll: 1 }, 1 / 60, 20);
  check("barrel roll and held roll agree on direction", Math.sign(axis.bank) === Math.sign(r.bank), [axis.bank, r.bank]);

  const lean = createFlightState();
  step(lean, { x: 1, y: 0 }, 1 / 60, 40);
  check("stick lean agrees with that convention too", Math.sign(lean.bank) === Math.sign(r.bank), [lean.bank, r.bank]);
}

{
  const s = createFlightState();
  requestRoll(s, 1);
  step(s, { x: 0, y: 0 }, 1 / 60, 30);
  check("no bank sink during a roll", s.sink === 0, s.sink);
}

{
  const s = createFlightState();
  s.bank = Math.PI * 1.5;
  check("bankDegrees wraps to -180..180", bankDegrees(s) === -90, bankDegrees(s));
}

{
  // Input during a roll must not fight the script. Stepped to the exact
  // completion frame — past it, normal control resumes and SHOULD re-bank.
  const s = createFlightState();
  const h0 = s.heading;
  requestRoll(s, 1);
  step(s, { x: -1, y: -1 }, 1 / 60, Math.ceil(ROLL.duration * 60));
  check("input cannot corrupt a running roll", s.maneuver === null && s.bank === 0, s.bank);
  check("input cannot corrupt roll heading", Math.abs(s.heading - h0) < 1e-9, s.heading - h0);
  step(s, { x: -1, y: 0 }, 1 / 60, 30);
  check("control resumes after the roll", s.bank > 0, s.bank);
}

{
  const f = forwardFromAngles(0, 0);
  check("forward at rest is (0,0,-1)", Math.abs(f.x) < 1e-9 && Math.abs(f.z + 1) < 1e-9, f);
}

/* ---- Stage 01.6b: held roll axis (Q/E) ---- */

{
  check("wrapAngle folds into -PI..PI", Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9 || Math.abs(wrapAngle(3 * Math.PI) + Math.PI) < 1e-9, wrapAngle(3 * Math.PI));
  check("wrapAngle leaves small angles alone", Math.abs(wrapAngle(0.5) - 0.5) < 1e-12);
  check("turnBank passes shallow bank through", Math.abs(turnBank(30 * DEG) - 30 * DEG) < 1e-9);
  check("turnBank clamps to maxBank", Math.abs(turnBank(80 * DEG) - FLIGHT.maxBank) < 1e-9, turnBank(80 * DEG) / DEG);
  check("turnBank mirrors past vertical", Math.abs(turnBank(150 * DEG) - 30 * DEG) < 1e-9, turnBank(150 * DEG) / DEG);
  check("inverted level does not turn", Math.abs(turnBank(Math.PI)) < 1e-9, turnBank(Math.PI));
  check("turnBank keeps the turn direction", turnBank(-120 * DEG) < 0, turnBank(-120 * DEG) / DEG);
}

{
  // E rolls right past the arcade clamp — the whole point of the new axis.
  const s = createFlightState();
  step(s, { x: 0, y: 0, roll: 1 }, 1 / 60, 60);
  check("1 s of E rolls ~130 deg right", Math.abs(bankDegrees(s) + 130) < 2, bankDegrees(s));
  check("held roll passes maxBank", Math.abs(s.bank) > FLIGHT.maxBank, bankDegrees(s));
  check("held roll sets rollHold", s.rollHold === true);

  const q = createFlightState();
  step(q, { x: 0, y: 0, roll: -1 }, 1 / 60, 30);
  check("Q rolls the other way", bankDegrees(q) > 0, bankDegrees(q));
}

{
  // The ask: release the key and the wings stay where they were left.
  const s = createFlightState();
  step(s, { x: 0, y: 0, roll: 1 }, 1 / 60, 45);
  const held = s.bank;
  step(s, { x: 0, y: 0, roll: 0 }, 1 / 60, 300);
  check("angle holds for 5 s after release", Math.abs(s.bank - held) < 1e-9, [held, s.bank]);
  check("held angle does not auto-level", Math.abs(bankDegrees(s)) > 60, bankDegrees(s));
  check("holding a bank still turns", s.heading !== 0, s.heading);
}

{
  // A/D must be able to take the wings back, or a held roll would be a trap.
  const s = createFlightState();
  step(s, { x: 0, y: 0, roll: 1 }, 1 / 60, 60);
  step(s, { x: -1, y: 0 }, 1 / 60, 1);
  check("stick input clears rollHold", s.rollHold === false);
  step(s, { x: 0, y: 0 }, 1 / 60, 600);
  check("wings return to level after breakout", Math.abs(bankDegrees(s)) < 1, bankDegrees(s));
}

{
  const s = createFlightState();
  step(s, { x: 0, y: 0, roll: 1 }, 1 / 60, 60);
  step(s, { x: 0.1, y: 0 }, 1 / 60, 1);
  check("input below breakout does not steal the hold", s.rollHold === true, s.bank);
}

{
  // Roll while banking with the stick: the rate wins and latches.
  const s = createFlightState();
  step(s, { x: 1, y: 0 }, 1 / 60, 60);
  const banked = s.bank;
  step(s, { x: 1, y: 0, roll: 1 }, 1 / 60, 30);
  check("roll axis overrides an active stick bank", s.bank < banked, [banked, s.bank]);
  check("roll during stick input holds", s.rollHold === true);
}

{
  const a = step(createFlightState(), { x: 0, y: 0, roll: 1 }, 1 / 60, 60);
  const b = step(createFlightState(), { x: 0, y: 0, roll: 1 }, 1 / 20, 20);
  check("roll rate is frame-rate independent", Math.abs(a.bank - b.bank) < 1e-9, [a.bank, b.bank]);
}

{
  // Rolling a long way must not spin the heading up through tan()'s asymptote.
  const s = createFlightState();
  step(s, { x: 0, y: 0, roll: 1 }, 1 / 60, 200);
  check("bank stays wrapped", Math.abs(s.bank) <= Math.PI + 1e-9, s.bank);
  check("heading stays finite through vertical", Number.isFinite(s.heading), s.heading);
  check("turn rate never exceeds the maxBank rate", Math.abs(s.heading) < Math.tan(FLIGHT.maxBank) * FLIGHT.turnGain * (200 / 60) + 1e-6, s.heading);
}

{
  // Inverted: no turn, and pitch still responds.
  const s = createFlightState();
  s.bank = Math.PI;
  s.rollHold = true;
  const h0 = s.heading;
  step(s, { x: 0, y: 0 }, 1 / 60, 60);
  check("inverted hold does not drift heading", Math.abs(s.heading - h0) < 1e-9, s.heading - h0);
  check("inverted hold persists", Math.abs(Math.abs(s.bank) - Math.PI) < 1e-9, bankDegrees(s));
}

{
  // A barrel roll from a held angle must still finish level and release the hold.
  const s = createFlightState();
  step(s, { x: 0, y: 0, roll: 1 }, 1 / 60, 40);
  const h0 = s.heading;
  requestRoll(s, 1);
  step(s, { x: 0, y: 0 }, 1 / 60, Math.ceil(ROLL.duration * 60) + 2);
  check("barrel roll from a held angle ends level", Math.abs(s.bank) < 1e-9, s.bank);
  check("barrel roll from a held angle is heading-neutral", Math.abs(s.heading - h0) < 1e-9, s.heading - h0);
  check("barrel roll clears rollHold", s.rollHold === false);
}

{
  const s = createFlightState();
  step(s, { x: 0, y: 0, roll: 1 }, 1 / 60, 60);
  resetFlightState(s);
  check("reset clears rollHold", s.rollHold === false && s.bank === 0);
}

{
  const s = createFlightState();
  step(s, { x: 0, y: 0 }, 1 / 60, 60);
  check("input without a roll field is safe", s.rollHold === false && s.bank === 0, [s.rollHold, s.bank]);
}

{
  // Sink follows the held angle: knife-edge costs the most, inverted is worse.
  const s = createFlightState();
  step(s, { x: 0, y: 0, roll: 1 }, 1 / 60, 42);
  check("held bank near 90 deg sinks hard", s.sink > 12, [bankDegrees(s), s.sink]);
  check("sink is reported for a held roll", s.sink === bankSinkRate(s.bank), s.sink);
}


/* ---- Stage 01.6: throttle, acceleration, speed ---- */

{
  check("throttle 0 commands min speed", getTargetSpeed(0) === SPEED.min, getTargetSpeed(0));
  check("throttle 1 commands max speed", getTargetSpeed(1) === SPEED.max, getTargetSpeed(1));
  check("target speed is monotonic", getTargetSpeed(0.3) < getTargetSpeed(0.6) && getTargetSpeed(0.6) < getTargetSpeed(0.95));
  check("AB band starts at 220 m/s", Math.abs(getTargetSpeed(SPEED.afterburnerThreshold) - 220) < 1e-9, getTargetSpeed(0.85));
  const belowRate = (getTargetSpeed(0.85) - getTargetSpeed(0.55)) / 0.3;
  const aboveRate = (getTargetSpeed(1) - getTargetSpeed(0.85)) / 0.15;
  check("AB band has more authority per unit lever", aboveRate > belowRate, [belowRate, aboveRate]);
  check("speedToThrottle inverts getTargetSpeed", Math.abs(getTargetSpeed(speedToThrottle(193)) - 193) < 1e-9);
  check("cruise throttle commands exactly cruise", Math.abs(getTargetSpeed(CRUISE_THROTTLE) - SPEED.cruise) < 1e-9, CRUISE_THROTTLE);
  check("cruise throttle is not simply 0.5", Math.abs(CRUISE_THROTTLE - 0.5) > 0.01, CRUISE_THROTTLE);
  check("cruise is below the AB threshold", CRUISE_THROTTLE < SPEED.afterburnerThreshold, CRUISE_THROTTLE);
}

{
  check("moveTowards steps by maxDelta", moveTowards(100, 200, 10) === 110);
  check("moveTowards lands exactly", moveTowards(100, 103, 10) === 103);
  check("moveTowards works downward", moveTowards(200, 100, 10) === 190);
}

{
  const s = createFlightState();
  check("spawns at cruise speed", s.speed === SPEED.cruise, s.speed);
  check("spawns at cruise throttle", s.throttle === CRUISE_THROTTLE, s.throttle);
  check("spawns with AB off", s.afterburner === false);
  step(s, { x: 0, y: 0, throttle: 0 }, 1 / 60, 120);
  check("cruise is an equilibrium (no drift with no input)", Math.abs(s.speed - SPEED.cruise) < 1e-9, s.speed);
}

{
  // Persistent lever: hold 1 s, release, and the aircraft keeps accelerating
  // toward the setting it was left at.
  const s = createFlightState();
  step(s, { x: 0, y: 0, throttle: 1 }, 1 / 60, 60);
  const held = s.throttle;
  check("1 s of Shift moves the lever ~0.40", Math.abs(held - (CRUISE_THROTTLE + 0.4)) < 0.01, held);
  const spd1 = s.speed;
  step(s, { x: 0, y: 0, throttle: 0 }, 1 / 60, 60);
  check("lever persists after release", s.throttle === held, s.throttle);
  check("speed keeps rising after release", s.speed > spd1, [spd1, s.speed]);
  step(s, { x: 0, y: 0, throttle: 0 }, 1 / 60, 300);
  check("speed settles on the commanded target", Math.abs(s.speed - getTargetSpeed(held)) < 1e-9, [s.speed, s.targetSpeed]);
  check("settled speed is above cruise", s.speed > SPEED.cruise + 30, s.speed);
}

{
  const s = createFlightState();
  step(s, { x: 0, y: 0, throttle: 1 }, 1 / 60, 600);
  check("throttle clamps at 1", s.throttle === 1, s.throttle);
  check("full throttle reaches max speed", Math.abs(s.speed - SPEED.max) < 1e-9, s.speed);
  check("AB is on at full throttle", s.afterburner === true);

  step(s, { x: 0, y: 0, throttle: -1 }, 1 / 60, 600);
  check("throttle clamps at 0", s.throttle === 0, s.throttle);
  check("idle settles at min speed, not zero", Math.abs(s.speed - SPEED.min) < 1e-9, s.speed);
  check("idle does not fall out of the sky", s.position.y > 12, s.position.y);
}

{
  // Acceleration in m/s^2: one second of full lever from cruise.
  const s = createFlightState();
  s.throttle = 1;
  step(s, { x: 0, y: 0, throttle: 0 }, 1 / 60, 60);
  check("accelerates ~32 m/s in 1 s", Math.abs(s.speed - (SPEED.cruise + 32)) < 0.6, s.speed);

  const d = createFlightState();
  d.speed = SPEED.max;
  d.throttle = 0;
  step(d, { x: 0, y: 0, throttle: 0 }, 1 / 60, 60);
  check("decelerates ~24 m/s in 1 s", Math.abs(d.speed - (SPEED.max - 24)) < 0.6, d.speed);
  check("acceleration is not instantaneous", d.speed > SPEED.min + 80, d.speed);
}

{
  // Throttle sweep and acceleration must both be dt-independent.
  const a = step(createFlightState(), { x: 0, y: 0, throttle: 1 }, 1 / 60, 60);
  const b = step(createFlightState(), { x: 0, y: 0, throttle: 1 }, 1 / 20, 20);
  check("throttle sweep is frame-rate independent", Math.abs(a.throttle - b.throttle) < 1e-9, [a.throttle, b.throttle]);
  check("acceleration is frame-rate independent (<3 m/s)", Math.abs(a.speed - b.speed) < 3, [a.speed, b.speed]);
}

{
  const s = createFlightState();
  s.throttle = 0.84;
  step(s, { x: 0, y: 0, throttle: 0 }, 1 / 60, 1);
  check("AB off just below threshold", s.afterburner === false, s.throttle);
  s.throttle = 0.85;
  step(s, { x: 0, y: 0, throttle: 0 }, 1 / 60, 1);
  check("AB on at the threshold", s.afterburner === true, s.throttle);
}

{
  // Translation must use actual speed, not the old fixed 170.
  const slow = createFlightState();
  slow.speed = SPEED.min;
  slow.throttle = 0;
  const fast = createFlightState();
  fast.speed = SPEED.max;
  fast.throttle = 1;
  step(slow, { x: 0, y: 0, throttle: 0 }, 1 / 60, 1);
  step(fast, { x: 0, y: 0, throttle: 0 }, 1 / 60, 1);
  check("faster aircraft covers more ground per frame", Math.abs(fast.position.z) > Math.abs(slow.position.z) * 2, [slow.position.z, fast.position.z]);
  check("one frame at 110 m/s moves 110/60 m", Math.abs(Math.abs(slow.position.z) - SPEED.min / 60) < 1e-6, slow.position.z);
}

{
  // Throttle must not disturb the Stage 01.5 controller.
  const plain = step(createFlightState(), { x: 1, y: 0.3 }, 1 / 60, 120);
  const withThr = createFlightState();
  withThr.throttle = CRUISE_THROTTLE;
  step(withThr, { x: 1, y: 0.3, throttle: 1 }, 1 / 60, 120);
  check("bank response is unchanged by throttle input", Math.abs(plain.bank - withThr.bank) < 1e-9, [plain.bank, withThr.bank]);
  check("pitch response is unchanged by throttle input", Math.abs(plain.pitch - withThr.pitch) < 1e-9, [plain.pitch, withThr.pitch]);
  check("bank sink still works at speed", withThr.sink > 0, withThr.sink);
  check("simultaneous throttle + bank both applied", withThr.throttle > CRUISE_THROTTLE && withThr.bank < 0, [withThr.throttle, withThr.bank]);
}

{
  const s = createFlightState();
  step(s, { x: 1, y: 1, throttle: 1 }, 1 / 60, 200);
  requestRoll(s, 1);
  step(s, { x: 0, y: 0, throttle: 1 }, 1 / 60, 20);
  check("throttle still responds during a roll", s.throttle > CRUISE_THROTTLE, s.throttle);
  resetFlightState(s);
  check("reset restores cruise speed", s.speed === SPEED.cruise, s.speed);
  check("reset restores cruise throttle", s.throttle === CRUISE_THROTTLE, s.throttle);
  check("reset restores target speed", s.targetSpeed === SPEED.cruise, s.targetSpeed);
  check("reset clears the AB state", s.afterburner === false);
  check("reset clears attitude and maneuver", s.bank === 0 && s.pitch === 0 && s.maneuver === null);
}

{
  const full = 1 / THROTTLE.changeRate;
  check("full lever sweep takes ~2.5 s", Math.abs(full - 2.5) < 1e-9, `${full.toFixed(2)} s`);
}

{
  // Missing throttle field must not break older call sites.
  const s = createFlightState();
  step(s, { x: 0, y: 0 }, 1 / 60, 60);
  check("input without a throttle field is safe", s.throttle === CRUISE_THROTTLE && s.speed === SPEED.cruise, [s.throttle, s.speed]);
}

/* ---- Stage 01.7: quaternion helpers ---- */

{
  const a = quatFromEulerYXZ(0.3, -0.7, 1.2);
  const i = quat();
  const r = quatMultiply(a, i, quat());
  check("quat * identity is unchanged", Math.abs(r.x - a.x) < 1e-12 && Math.abs(r.w - a.w) < 1e-12);
  check("quatNormalize makes a unit quaternion", Math.abs(Math.hypot(a.x, a.y, a.z, a.w) - 1) < 1e-12);

  // The pure-JS quaternion must agree with the Euler forward the assisted model
  // has always used, or switching main.js to one orientation path would shift
  // assisted flight by a hair.
  for (const [p, h] of [[0, 0], [0.4, 0.9], [-0.5, -2.2], [1.2, 3.0]]) {
    const e = forwardFromAngles(p, h);
    const q = quatForward(quatFromEulerYXZ(p, h, 0.6));
    check(`quatForward matches forwardFromAngles (${p}, ${h})`, Math.abs(e.x - q.x) < 1e-12 && Math.abs(e.y - q.y) < 1e-12 && Math.abs(e.z - q.z) < 1e-12, [e, q]);
  }

  const level = quatUp(quat());
  check("level up vector is world up", Math.abs(level.y - 1) < 1e-12, level);
}

{
  // Assisted mode must keep the quaternion as an exact mirror of its Euler state.
  const s = createFlightState();
  step(s, { x: 0.7, y: 0.4 }, 1 / 60, 90);
  const mirror = quatFromEulerYXZ(s.pitch, s.heading, s.bank);
  check("assisted quat mirrors its Euler angles", Math.abs(mirror.x - s.quat.x) < 1e-12 && Math.abs(mirror.y - s.quat.y) < 1e-12 && Math.abs(mirror.z - s.quat.z) < 1e-12 && Math.abs(mirror.w - s.quat.w) < 1e-12);
  check("assisted state is not expert", isExpert(s) === false);
  check("default mode is ASSISTED", s.mode === MODE.ASSISTED);
}

/* ---- Stage 01.7: expert mode ---- */

{
  const s = expertState();
  check("expert state reports expert", isExpert(s) === true);
  check("expert spawns level", Math.abs(upv(s).y - 1) < 1e-12);
  check("expert spawns at cruise", s.speed === SPEED.cruise && s.throttle === CRUISE_THROTTLE);
}

{
  // Manual Test A: one full loop on held W. 60 deg/s -> 6 s.
  const s = expertState();
  const quarter = Math.round(1.5 * 60);
  step(s, { x: 0, y: 1 }, 1 / 60, quarter);
  check("expert quarter loop points the nose up", fwd(s).y > 0.98, fwd(s).y);
  step(s, { x: 0, y: 1 }, 1 / 60, quarter);
  check("expert half loop is inverted", upv(s).y < -0.98, upv(s).y);
  check("expert half loop still flies level-ish", Math.abs(fwd(s).y) < 0.02, fwd(s).y);
  step(s, { x: 0, y: 1 }, 1 / 60, quarter);
  check("expert three-quarter loop points the nose down", fwd(s).y < -0.98, fwd(s).y);
  step(s, { x: 0, y: 1 }, 1 / 60, quarter);
  check("expert full loop returns upright", upv(s).y > 0.999 && Math.abs(fwd(s).y) < 0.01, [upv(s).y, fwd(s).y]);
  check("a full loop takes 6 s at 60 deg/s", Math.abs((4 * quarter) / 60 - 6) < 0.02);
  check("expert pitch is unrestricted", true);
}

{
  // Manual Test B: full manual roll on held D, ~3 s at 120 deg/s, no clamp.
  const s = expertState();
  const half = Math.round(1.5 * 60);
  step(s, { x: 1, y: 0 }, 1 / 60, Math.round(0.75 * 60));
  check("expert quarter roll passes the assisted 70 deg clamp", Math.abs(bankDegrees(s)) > 80, bankDegrees(s));
  step(s, { x: 1, y: 0 }, 1 / 60, Math.round(0.75 * 60));
  check("expert half roll is inverted", upv(s).y < -0.99, upv(s).y);
  step(s, { x: 1, y: 0 }, 1 / 60, half);
  check("expert full roll returns upright", upv(s).y > 0.999, upv(s).y);
  check("a full roll takes 3 s at 120 deg/s", Math.abs((2 * half) / 60 - 3) < 0.02);
  check("a pure roll does not change the flight path", Math.abs(fwd(s).y) < 1e-9 && Math.abs(s.position.y - FLIGHT.spawn.y) < 1e-9, [fwd(s).y, s.position.y]);
}

{
  // Manual Test C: no auto-level, ever.
  const s = expertState();
  step(s, { x: 1, y: 0 }, 1 / 60, Math.round(1.5 * 60)); // 180 deg
  const held = { ...s.quat };
  const h0 = hdgOf(s);
  step(s, { x: 0, y: 0 }, 1 / 60, 300);
  check("expert holds inverted for 5 s", upv(s).y < -0.99, upv(s).y);
  check("expert attitude is untouched with no input", Math.abs(s.quat.x - held.x) < 1e-12 && Math.abs(s.quat.z - held.z) < 1e-12 && Math.abs(s.quat.w - held.w) < 1e-12);
  check("inverted level flight keeps flying forward", s.position.z < 0 && Math.abs(s.position.y - FLIGHT.spawn.y) < 1e-9, [s.position.z, s.position.y]);
  check("expert does not yaw from bank", Math.abs(hdgOf(s) - h0) < 1e-12, hdgOf(s) - h0);
  check("expert reports no bank sink", s.sink === 0);
}

{
  // 45 deg of held bank and nothing else: the assisted model would be turning
  // hard here. Expert must not.
  const s = expertState();
  step(s, { x: 1, y: 0 }, 1 / 60, Math.round(0.375 * 60));
  const h0 = hdgOf(s);
  step(s, { x: 0, y: 0 }, 1 / 60, 180);
  check("held 45 deg bank produces no heading change at all", Math.abs(hdgOf(s) - h0) < 1e-12, hdgOf(s) - h0);

  const assisted = createFlightState();
  step(assisted, { x: 1, y: 0 }, 1 / 60, 180);
  check("...where assisted mode does turn", Math.abs(assisted.heading) > 0.5, assisted.heading);
}

{
  // Manual Test D: roll and pull. Turning must emerge from local rotation, and
  // must curve the same way the assisted controller curves for the same key.
  const s = expertState();
  step(s, { x: -1, y: 0 }, 1 / 60, Math.round(0.5 * 60)); // roll left ~60 deg
  const h0 = hdgOf(s);
  step(s, { x: 0, y: 1 }, 1 / 60, 60); // pull
  const expertTurn = hdgOf(s) - h0;

  const assisted = createFlightState();
  step(assisted, { x: -1, y: 0 }, 1 / 60, 120);
  const assistedTurn = assisted.heading;

  check("roll-and-pull bends the trajectory", Math.abs(expertTurn) > 0.15, expertTurn);
  check("expert turns the same way assisted does for A", Math.sign(expertTurn) === Math.sign(assistedTurn), [expertTurn, assistedTurn]);

  const r = expertState();
  step(r, { x: 1, y: 0 }, 1 / 60, Math.round(0.5 * 60));
  const rh0 = hdgOf(r);
  step(r, { x: 0, y: 1 }, 1 / 60, 60);
  check("rolling the other way turns the other way", Math.sign(hdgOf(r) - rh0) === -Math.sign(expertTurn), hdgOf(r) - rh0);
}

{
  // Pitch must act on the aircraft-local lateral axis, not a world axis.
  const s = expertState();
  step(s, { x: 1, y: 0 }, 1 / 60, Math.round(0.75 * 60)); // 90 deg, knife-edge
  const y0 = s.position.y;
  step(s, { x: 0, y: 1 }, 1 / 60, 45);
  check("pulling at 90 deg bank turns instead of climbing", Math.abs(s.position.y - y0) < 8, s.position.y - y0);
  check("...and does change heading", Math.abs(hdgOf(s)) > 0.2, hdgOf(s));

  const inv = expertState();
  step(inv, { x: 1, y: 0 }, 1 / 60, Math.round(1.5 * 60)); // inverted
  step(inv, { x: 0, y: 1 }, 1 / 60, 30);
  check("pulling while inverted goes down through world space", fwd(inv).y < -0.1, fwd(inv).y);
}

{
  // Manual Test E: Split-S. Inverted, then pull, ends flying the other way.
  const s = expertState();
  s.position.y = 4000;
  step(s, { x: 1, y: 0 }, 1 / 60, Math.round(1.5 * 60));
  step(s, { x: 0, y: 0, roll: 0 }, 1 / 60, 10);
  step(s, { x: 0, y: 1 }, 1 / 60, Math.round(3 * 60)); // half loop
  const f = fwd(s);
  check("split-S reverses the horizontal heading", f.z > 0.9, f);
  check("split-S loses altitude", s.position.y < 4000, s.position.y);
  check("split-S ends roughly upright", upv(s).y > 0.9, upv(s).y);
}

{
  // Expert altitude comes from attitude alone.
  const climb = expertState();
  step(climb, { x: 0, y: 1 }, 1 / 60, 30);
  step(climb, { x: 0, y: 0 }, 1 / 60, 60);
  check("nose up climbs", climb.position.y > FLIGHT.spawn.y, climb.position.y);

  const dive = expertState();
  dive.position.y = 3000;
  step(dive, { x: 0, y: -1 }, 1 / 60, 30);
  step(dive, { x: 0, y: 0 }, 1 / 60, 60);
  check("nose down descends", dive.position.y < 3000, dive.position.y);
  check("expert never applies bank sink", dive.sink === 0 && climb.sink === 0);
}

{
  const a = step(expertState(), { x: 0, y: 1 }, 1 / 60, 60);
  const b = step(expertState(), { x: 0, y: 1 }, 1 / 20, 20);
  check("expert pitch integration is frame-rate independent", Math.abs(fwd(a).y - fwd(b).y) < 1e-9, [fwd(a).y, fwd(b).y]);

  // Combined pitch+roll does not commute, so equality is approximate by nature.
  const c = step(expertState(), { x: 1, y: 1 }, 1 / 60, 60);
  const d = step(expertState(), { x: 1, y: 1 }, 1 / 20, 20);
  check("expert combined integration stays close across frame rates", Math.abs(upv(c).y - upv(d).y) < 0.08, [upv(c).y, upv(d).y]);
}

{
  // Long run: the quaternion must not drift off unit length.
  const s = expertState();
  step(s, { x: 0.6, y: 0.8 }, 1 / 60, 3000);
  const len = Math.hypot(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
  check("quaternion stays normalized over 50 s", Math.abs(len - 1) < 1e-9, len);
  check("attitude stays finite", Number.isFinite(s.quat.w) && Number.isFinite(s.position.y));
}

{
  // Q/E fold into the same roll axis in expert mode rather than being a second
  // roll system with its own hold semantics.
  const e = expertState();
  step(e, { x: 0, y: 0, roll: 1 }, 1 / 60, 60);
  const d = expertState();
  step(d, { x: 1, y: 0 }, 1 / 60, 60);
  check("expert Q/E rolls like A/D", Math.abs(upv(e).y - upv(d).y) < 1e-12, [upv(e).y, upv(d).y]);
  check("expert does not use rollHold", e.rollHold === false);
}

/* ---- Stage 01.7: Space barrel roll in both modes ---- */

{
  // Manual Test G: expert. The scripted roll is anchored on the entry attitude,
  // so it closes exactly from any orientation, including inverted.
  for (const [label, setup] of [
    ["level", (s) => s],
    ["banked", (s) => step(s, { x: 1, y: 0 }, 1 / 60, 20)],
    ["inverted", (s) => step(s, { x: 1, y: 0 }, 1 / 60, Math.round(1.5 * 60))],
    ["climbing", (s) => step(s, { x: 0, y: 1 }, 1 / 60, 40)],
  ]) {
    const s = expertState();
    s.position.y = 4000;
    setup(s);
    const q0 = { ...s.quat };
    check(`expert barrel roll starts from ${label}`, requestRoll(s, 1) === true);
    step(s, { x: 0, y: 0 }, 1 / 60, Math.ceil(ROLL.duration * 60) + 2);
    check(`expert barrel roll closes exactly from ${label}`, Math.abs(s.quat.x - q0.x) < 1e-9 && Math.abs(s.quat.y - q0.y) < 1e-9 && Math.abs(s.quat.z - q0.z) < 1e-9 && Math.abs(s.quat.w - q0.w) < 1e-9, [q0, s.quat]);
    check(`expert barrel roll releases control from ${label}`, s.maneuver === null);
  }
}

{
  // Mid-roll it really is rolling, and manual input cannot fight it.
  const s = expertState();
  requestRoll(s, 1);
  step(s, { x: 0, y: 0 }, 1 / 60, 30);
  check("expert barrel roll is mid-rotation a third of the way in", Math.abs(upv(s).y) < 0.9, upv(s).y);
  check("a second request cannot restart it", requestRoll(s, -1) === false);

  // Same maneuver, one run fought with full stick, one flown hands-off: the
  // scripted attitude must be identical.
  const fought = expertState();
  const clean = expertState();
  requestRoll(fought, 1);
  requestRoll(clean, 1);
  step(fought, { x: -1, y: -1, roll: -1 }, 1 / 60, 45);
  step(clean, { x: 0, y: 0 }, 1 / 60, 45);
  check("manual input is ignored during the scripted roll", Math.abs(fought.quat.w - clean.quat.w) < 1e-12 && Math.abs(fought.quat.z - clean.quat.z) < 1e-12, [fought.quat, clean.quat]);

  // Control comes back cleanly once it finishes.
  const after = expertState();
  requestRoll(after, 1);
  step(after, { x: 0, y: 0 }, 1 / 60, Math.ceil(ROLL.duration * 60) + 2);
  check("expert control resumes after the roll", after.maneuver === null);
  step(after, { x: 0, y: 1 }, 1 / 60, 30);
  check("expert pitch works again after the roll", fwd(after).y > 0.4, fwd(after).y);
  const h0 = hdgOf(after);
  step(after, { x: 1, y: 0 }, 1 / 60, 30);
  check("expert roll works again after the roll", Math.abs(upv(after).y) < 0.98 && Math.abs(hdgOf(after) - h0) < 0.4, upv(after).y);
}

{
  // Assisted barrel roll is untouched by any of this.
  const s = createFlightState();
  const h0 = s.heading;
  requestRoll(s, 1);
  step(s, { x: 0, y: 0 }, 1 / 60, Math.ceil(ROLL.duration * 60) + 2);
  check("assisted barrel roll still ends level", Math.abs(s.bank) < 1e-9 && Math.abs(s.pitch) < 1e-9);
  check("assisted barrel roll is still heading-neutral", Math.abs(s.heading - h0) < 1e-9);
}

/* ---- Stage 01.7: mode switching ---- */

{
  const s = createFlightState();
  step(s, { x: 1, y: 1, throttle: 1 }, 1 / 60, 120);
  const pos0 = { ...s.position };
  const q0 = { ...s.quat };
  const spd0 = s.speed, thr0 = s.throttle;
  check("mode toggle returns the new mode", toggleFlightMode(s) === MODE.EXPERT);
  check("handover keeps position", s.position.x === pos0.x && s.position.y === pos0.y && s.position.z === pos0.z);
  check("handover keeps the engine", s.speed === spd0 && s.throttle === thr0);
  // Assisted already mirrors its Euler angles into the quaternion, so the
  // attitude crosses the boundary unchanged rather than being rebuilt.
  check("handover keeps attitude", Math.abs(s.quat.x - q0.x) < 1e-9 && Math.abs(s.quat.w - q0.w) < 1e-9);
  check("a banked handover stays banked", Math.abs(bankDegrees(s)) > 1);
  check("expert flies on immediately after a handover", (() => {
    const f0 = { ...s.quat };
    step(s, { x: 1, y: 0 }, 1 / 60, 30);
    return s.quat.x !== f0.x || s.quat.z !== f0.z;
  })());

  // Expert -> assisted from an attitude the arcade envelope cannot hold.
  const e = expertState();
  step(e, { x: 1, y: 0 }, 1 / 60, 90); // roll past 90 degrees: inverted
  check("test setup is actually inverted", Math.abs(bankDegrees(e)) > 90);
  const invPos = { ...e.position };
  check("mode toggle goes back", toggleFlightMode(e) === MODE.ASSISTED);
  check("handover back keeps position", e.position.z === invPos.z);
  check("assisted adopts the inverted bank rather than snapping level", Math.abs(bankDegrees(e)) > 90);
  const bank0 = Math.abs(bankDegrees(e));
  step(e, { x: 0, y: 0 }, 1 / 60, 120);
  check("assisted rolls an inverted handover back toward level", Math.abs(bankDegrees(e)) < bank0);
  check("assisted works immediately after a toggle", step(e, { x: 1, y: 0 }, 1 / 60, 120).bank < 0);

  // A scripted roll cannot cross the boundary; the attitude it reached does.
  const m = createFlightState();
  requestRoll(m, 1);
  step(m, { x: 0, y: 0 }, 1 / 60, 60);
  toggleFlightMode(m);
  check("handover drops an in-progress maneuver", m.maneuver === null);
  check("handover clears roll hold", m.rollHold === false);

  setFlightMode(s, MODE.EXPERT);
  check("setFlightMode is explicit", isExpert(s) === true);
  setFlightMode(s, "nonsense");
  check("an unknown mode falls back to assisted", s.mode === MODE.ASSISTED);

  // The old reset-on-switch behaviour is still available, just not the default.
  const r = createFlightState();
  step(r, { x: 1, y: 1, throttle: 1 }, 1 / 60, 120);
  setFlightMode(r, MODE.EXPERT, { reset: true });
  check("an explicit reset still resets position", r.position.y === FLIGHT.spawn.y && r.position.z === 0);
  check("an explicit reset still resets attitude", r.quat.w === 1 && r.quat.x === 0);
  check("an explicit reset still resets the engine", r.speed === SPEED.cruise && r.throttle === CRUISE_THROTTLE);
}

{
  // R inside expert mode resets orientation, not just position.
  const s = expertState();
  step(s, { x: 1, y: 1, throttle: 1 }, 1 / 60, 200);
  requestRoll(s, 1);
  resetFlightState(s);
  check("expert reset clears the quaternion", s.quat.x === 0 && s.quat.y === 0 && s.quat.z === 0 && s.quat.w === 1);
  check("expert reset keeps the mode", isExpert(s) === true);
  check("expert reset clears the maneuver", s.maneuver === null);
  check("expert reset restores cruise", s.speed === SPEED.cruise && s.throttle === CRUISE_THROTTLE);
  check("expert reset restores the spawn", s.position.y === FLIGHT.spawn.y);
}

/* ---- Stage 01.7: assisted regression (Manual Test H) ---- */

{
  const s = createFlightState();
  step(s, { x: 1, y: 1, throttle: 0.5 }, 1 / 60, 600);
  check("assisted bank is still clamped to 70 deg", Math.abs(s.bank) <= FLIGHT.maxBank + 1e-6, bankDegrees(s));
  check("assisted pitch is still clamped to +40 deg", s.pitch <= FLIGHT.maxPitchUp + 1e-6, s.pitch / DEG);
  check("assisted still turns from bank", Math.abs(s.heading) > 1, s.heading);
  check("assisted still applies bank sink", s.sink > 0, s.sink);

  const dn = createFlightState();
  step(dn, { x: 0, y: -1 }, 1 / 60, 300);
  check("assisted pitch is still clamped to -30 deg", dn.pitch >= -FLIGHT.maxPitchDown - 1e-6, dn.pitch / DEG);

  const lvl = createFlightState();
  step(lvl, { x: 1, y: 0.5 }, 1 / 60, 120);
  step(lvl, { x: 0, y: 0 }, 1 / 60, 600);
  check("assisted still auto-levels", Math.abs(lvl.bank) < 0.02 && Math.abs(lvl.pitch) < 0.02, [lvl.bank, lvl.pitch]);
  check("assisted still holds Q/E angles", step(createFlightState(), { x: 0, y: 0, roll: 1 }, 1 / 60, 60).rollHold === true);
}

{
  const a = attitudeVectors(expertState());
  check("attitudeVectors reports level flight", Math.abs(a.forwardY) < 1e-12 && a.upY > 0.999 && a.inverted === false, a);
  const inv = expertState();
  step(inv, { x: 1, y: 0 }, 1 / 60, Math.round(1.5 * 60));
  check("attitudeVectors detects inverted", attitudeVectors(inv).inverted === true, attitudeVectors(inv));
}

/* ---- Stage 02: world normalization helpers ---- */

{
  check("length axis is the longest horizontal one", longestHorizontalAxis({ x: 330, y: 70, z: 80 }) === "x");
  check("length axis stays Z when Z is longest", longestHorizontalAxis({ x: 80, y: 70, z: 330 }) === "z");
  check("an X-length model is yawed onto Z", Math.abs(alignYaw("x") - Math.PI / 2) < 1e-12);
  check("a Z-length model needs no yaw", alignYaw("z") === 0);
  check("scale maps measured onto target", Math.abs(scaleToTarget(194, 19.4) - 0.1) < 1e-12);
  check("scale of a zero measurement is inert", scaleToTarget(0, 300) === 1);
  check("distanceKm converts metres", Math.abs(distanceKm({ x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 4000 }) - 5) < 1e-12);
  check("percentile picks the low end", percentile([900, 905, 910, 1200], 0) === 900);
  check("percentile picks the high end", percentile([900, 905, 910, 1200], 1) === 1200);
  check("percentile interpolates by rank", percentile([0, 10, 20, 30, 40], 0.5) === 20);
  check("percentile of nothing is zero", percentile([], 0.5) === 0);
  // The carrier's deck is the largest flat surface, so the modal height finds
  // it even though the mast is far higher.
  check("modal height finds the crowded bin, not the tallest", modalHeight([17, 17.4, 16.8, 17.1, 63.9], 1) === 17);
  check("modal height respects bin size", modalHeight([10, 11, 12, 30], 10) === 10);
  check("modal height of nothing is null", modalHeight([], 1) === null);
}

/* ---- Stage 02.1: FOV-invariant camera framing ---- */

{
  // The framing solve exists so that screen y = tan(tilt)/tan(fov/2) comes back
  // to the same value at every field of view.
  const screenY = (fov) => -Math.tan(framingTilt(-0.18, fov)) / Math.tan((fov * Math.PI) / 180 / 2);
  check("framing holds at the narrow end", Math.abs(screenY(60) + 0.18) < 1e-12);
  check("framing holds at the wide end", Math.abs(screenY(75) + 0.18) < 1e-12);
  check("framing holds at an absurd field of view", Math.abs(screenY(110) + 0.18) < 1e-12);
  check("a centred aircraft needs no tilt", framingTilt(0, 75) === 0);
  check("below centre tilts the axis up", framingTilt(-0.3, 60) > 0);
  check("above centre tilts the axis down", framingTilt(0.3, 60) < 0);
  // Wider lens, larger tilt: that is what keeps the aircraft still.
  check("wider fields of view need more tilt", framingTilt(-0.18, 75) > framingTilt(-0.18, 60));
}

/* ---- Stage 02.2: world contact ---- */

// Synthetic terrain: two coplanar triangles over a 200 m square, so the
// barycentric interpolation can be checked against an exact analytic height.
const makeTerrain = (f, half = 100) => {
  const c = (x, z) => [x, f(x, z), z];
  const verts = new Float32Array([
    ...c(-half, -half), ...c(half, -half), ...c(half, half),
    ...c(-half, -half), ...c(half, half), ...c(-half, half),
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  const mesh = new THREE.Mesh(g);
  const root = new THREE.Object3D();
  root.add(mesh);
  root.updateMatrixWorld(true);
  return root;
};

{
  check("look-ahead scales with speed", Math.abs(lookAheadDistance(250) - 50) < 1e-9, lookAheadDistance(250));
  check("look-ahead is 0.20 s of flight", Math.abs(lookAheadDistance(170) - 34) < 1e-9, lookAheadDistance(170));
  check("look-ahead has a floor", lookAheadDistance(10) === PHYSICS.minLookAhead, lookAheadDistance(10));
  check("look-ahead of a stopped aircraft is the floor", lookAheadDistance(0) === PHYSICS.minLookAhead);
  check("physics queries at 60 Hz", PHYSICS.queryHz === 60, PHYSICS.queryHz);
  check("a 60 Hz step at max speed is ~4 m", Math.abs(250 / PHYSICS.queryHz - 4.17) < 0.01, 250 / PHYSICS.queryHz);
}

{
  check("terrain above the waterline is the ground", groundReference(325, 0).surface === SURFACE.TERRAIN);
  check("...at its own height", groundReference(325, 0).height === 325);
  check("no terrain falls back to the ocean", groundReference(null, 0).surface === SURFACE.OCEAN);
  check("submerged terrain is not the ground", groundReference(-40, 0).surface === SURFACE.OCEAN);
  check("ocean fallback reports the waterline", groundReference(null, 0).height === 0);
}

{
  const c = (o) => classifyContact({ minClearance: 500, minProbeY: 500, forwardHit: null, oceanY: 0, ...o });
  check("clear air is clear", c({}) === CONTACT.CLEAR);
  check("a probe inside terrain is terrain contact", c({ minClearance: 0.4 }) === CONTACT.TERRAIN);
  check("clearance just above the threshold is clear", c({ minClearance: PHYSICS.terrainContactClearance + 0.01 }) === CONTACT.CLEAR);
  check("a probe at the waterline is ocean contact", c({ minProbeY: 0.2 }) === CONTACT.OCEAN);
  check("ocean outranks terrain below sea level", c({ minProbeY: -3, minClearance: 0.1 }) === CONTACT.OCEAN);
  check("a wall ahead is forward contact", c({ forwardHit: { distance: 14 } }) === CONTACT.FORWARD);
  check("terrain contact outranks a forward hit", c({ minClearance: 0.5, forwardHit: { distance: 14 } }) === CONTACT.TERRAIN);
  check("infinite clearance never contacts", c({ minClearance: Infinity }) === CONTACT.CLEAR);

  // The 0.5–1.5 m band over open sea: clearance is measured against the
  // waterline there, so calling it terrain would mistype an ocean dive.
  check("clearance over open sea is ocean contact", c({ minClearance: 0.8, minProbeY: 0.8, surface: SURFACE.OCEAN }) === CONTACT.OCEAN);
  check("...even a metre above the waterline", c({ minClearance: 1.2, minProbeY: 1.2, surface: SURFACE.OCEAN }) === CONTACT.OCEAN);
  check("...while terrain below still types as terrain", c({ minClearance: 1.2, minProbeY: 40, surface: SURFACE.TERRAIN }) === CONTACT.TERRAIN);
}

{
  check("safe states need speed-scaled clearance", isSafeToRecord(CONTACT.CLEAR, requiredSafeClearance(170) + 1, 170) === true);
  check("cruise clearance that would pass at 110 fails at 250", isSafeToRecord(CONTACT.CLEAR, 50, 250) === false, requiredSafeClearance(250));
  check("skimming terrain is not a safe state", isSafeToRecord(CONTACT.CLEAR, 4, 170) === false);
  check("contact is never a safe state", isSafeToRecord(CONTACT.TERRAIN, 900, 170) === false);

  check("required clearance has a 40 m floor", requiredSafeClearance(110) === 40, requiredSafeClearance(110));
  check("required clearance at 170 m/s", Math.abs(requiredSafeClearance(170) - 59.5) < 1e-9, requiredSafeClearance(170));
  check("required clearance at 250 m/s", Math.abs(requiredSafeClearance(250) - 87.5) < 1e-9, requiredSafeClearance(250));
  check("required clearance rises with speed", requiredSafeClearance(250) > requiredSafeClearance(170));

  check("imminence has a floor", imminentForwardDistance(110) === PHYSICS.minImminent, imminentForwardDistance(110));
  check("imminence is a couple of physics steps", imminentForwardDistance(600) > imminentForwardDistance(250));
  check("a 50 m look-ahead hit is not yet imminent", 50 > imminentForwardDistance(250), imminentForwardDistance(250));
}

{
  // y = 50 + x/10: flat in Z, so every sample has a known answer.
  const root = makeTerrain((x) => 50 + x * 0.1);
  const meshes = collectMeshes(root);
  const index = buildTerrainIndex(meshes, 16);
  check("terrain meshes are collected", meshes.length === 1, meshes.length);
  check("the index holds both triangles", index.triangles === 2, index.triangles);
  check("height at the origin", Math.abs(terrainHeightAt(index, 0, 0) - 50) < 1e-4, terrainHeightAt(index, 0, 0));
  check("height interpolates across a triangle", Math.abs(terrainHeightAt(index, 50, 20) - 55) < 1e-4, terrainHeightAt(index, 50, 20));
  check("height is exact on the far corner", Math.abs(terrainHeightAt(index, -99, 99) - 40.1) < 1e-3, terrainHeightAt(index, -99, 99));
  check("outside the island there is no terrain", terrainHeightAt(index, 400, 0) === null);
  check("a null index samples nothing", terrainHeightAt(null, 0, 0) === null);
  // Both diagonal halves must answer, or half the island would read as ocean.
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    const x = -99 + Math.random() * 198;
    const z = -99 + Math.random() * 198;
    if (Math.abs(terrainHeightAt(index, x, z) - (50 + x * 0.1)) < 1e-3) hits++;
  }
  check("400 random samples all land on the surface", hits === 400, hits);
}

{
  // A 5:1 ramp climbing toward -Z, so a level pass runs into a face.
  const index = buildTerrainIndex(collectMeshes(makeTerrain((x, z) => -z * 5)), 32);
  const origin = { x: 0, y: 100, z: -10 };
  const hit = forwardTerrainHit(index, origin, { x: 0, y: 0, z: -1 }, 60);
  check("the forward probe finds a mountain face", hit !== null, hit && hit.distance);
  check("...at roughly the right distance", hit && Math.abs(hit.distance - 12) < 7, hit && hit.distance);
  check("...and reports where", hit && hit.point.z < origin.z, hit && hit.point.z);
  check("flying away from the ramp is clear", forwardTerrainHit(index, origin, { x: 0, y: 0, z: 1 }, 60) === null);
  check("climbing over the ramp is clear", forwardTerrainHit(index, { x: 0, y: 900, z: -10 }, { x: 0, y: 0, z: -1 }, 60) === null);
  check("a null index has nothing ahead", forwardTerrainHit(null, origin, { x: 0, y: 0, z: -1 }, 60) === null);
}

{
  const s = expertState();
  step(s, { x: 1, y: 0.4, throttle: 1 }, 1 / 60, 40);
  const snap = captureFlightState(s);
  const before = { ...s.quat };
  step(s, { x: 0, y: -1 }, 1 / 60, 120);
  s.position.y = -400;
  check("a snapshot is not a live reference", s.quat.x !== before.x || s.quat.w !== before.w);

  applyFlightState(s, snap);
  check("restore returns the position", s.position.y === snap.position.y && s.position.z === snap.position.z);
  check("restore returns the attitude exactly", Math.abs(s.quat.x - before.x) < 1e-12 && Math.abs(s.quat.w - before.w) < 1e-12);
  check("restore returns the engine", s.speed === snap.speed && s.throttle === snap.throttle);
  check("restore leaves a normalized quaternion", Math.abs(Math.hypot(s.quat.x, s.quat.y, s.quat.z, s.quat.w) - 1) < 1e-12);
  check("restore derives the Euler angles", Math.abs(s.bank) > 0.1 && Number.isFinite(s.pitch), [s.bank, s.pitch]);
  check("restore clears any maneuver", s.maneuver === null && s.rollHold === false);

  // The player may have changed mode since the snapshot; recovery must not
  // take the controls back off them.
  const assisted = createFlightState();
  applyFlightState(assisted, snap);
  check("restore does not change the flight mode", assisted.mode === MODE.ASSISTED);
  check("restore into assisted keeps the recorded bank", Math.abs(assisted.bank) > 0.1, assisted.bank);

  const bled = createFlightState();
  applyFlightState(bled, snap, { speedScale: 0.5 });
  check("recovery can bleed speed", bled.speed < snap.speed && bled.speed >= SPEED.min, bled.speed);
  check("restoring nothing is a no-op", applyFlightState(bled, null) === false);
}

{
  // Probes must ride the quaternion, not a copy of the Euler angles.
  const ac = new THREE.Object3D();
  ac.position.set(0, 500, 0);
  const world = (name) => {
    ac.updateMatrixWorld(true);
    const p = PROBES.find((q) => q.name === name);
    return p.local.clone().applyMatrix4(ac.matrixWorld);
  };
  check("five probes exist", PROBES.length === 5, PROBES.length);
  check("level: the belly probe is below the aircraft", world("center").y < 500, world("center").y);
  check("level: the nose probe is ahead", world("nose").z < 0);
  check("level: the wings are symmetric", Math.abs(world("leftWing").x + world("rightWing").x) < 1e-9);

  const s = expertState();
  step(s, { x: 1, y: 0 }, 1 / 60, Math.round(1.5 * 60)); // 180 deg roll
  ac.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
  check("inverted: the belly probe is ABOVE the aircraft", world("center").y > 500.5, world("center").y);
  check("inverted: the wings swap sides", world("leftWing").x > 0, world("leftWing").x);

  const knife = expertState();
  step(knife, { x: 1, y: 0 }, 1 / 60, Math.round(0.75 * 60)); // 90 deg bank
  ac.quaternion.set(knife.quat.x, knife.quat.y, knife.quat.z, knife.quat.w);
  const low = Math.min(world("leftWing").y, world("rightWing").y);
  check("knife-edge: a wing becomes the lowest point", low < world("center").y, [low, world("center").y]);
}

{
  // End to end: fly into a plateau and check the recovery, then into the sea.
  const physics = createWorldPhysics({ oceanY: 0 });
  physics.setTerrain(makeTerrain(() => 100));
  const fs = createFlightState();
  fs.position.y = 300;
  const ac = new THREE.Object3D();
  const sync = () => {
    ac.position.set(fs.position.x, fs.position.y, fs.position.z);
    ac.quaternion.set(fs.quat.x, fs.quat.y, fs.quat.z, fs.quat.w);
    ac.updateMatrixWorld(true);
  };
  sync();
  physics.reset(fs);
  check("a query below the step does nothing", physics.update(ac, fs, 1 / 240) === false && physics.state.queries === 0);
  physics.update(ac, fs, 1 / 30);
  check("physics reports AGL over terrain", Math.abs(physics.state.agl - 200) < 1e-6, physics.state.agl);
  check("physics reports the ground surface", physics.state.surface === SURFACE.TERRAIN);
  check("min clearance is below centre AGL", physics.state.minClearance < physics.state.agl, [physics.state.minClearance, physics.state.agl]);
  check("clear flight records a safe state", physics.state.hasSafeState === true);
  check("a query is measurable and cheap", physics.state.queryMs >= 0 && physics.state.queryMs < 5, physics.state.queryMs);

  fs.position.y = 100.5; // belly inside the plateau
  sync();
  let recovered = false;
  const info = physics.update(ac, fs, 1 / 30, () => (recovered = true));
  check("terrain contact recovers the aircraft", recovered === true && !!info);
  check("the recovery names the surface", info && info.type === CollisionType.TERRAIN, info && info.type);
  check("a collision event was published", physics.state.lastEvent && physics.state.lastEvent.type === CollisionType.TERRAIN);
  check("the event carries a world-space normal", physics.state.lastEvent && Math.abs(physics.state.lastEvent.normal.y - 1) < 1e-6, physics.state.lastEvent && physics.state.lastEvent.normal);
  // Too little history to rewind 0.65 s, so the oldest state is used, plus the
  // protective offset along the blended normal.
  check("recovery restores the safe altitude", Math.abs(fs.position.y - (300 + RECOVERY.offset)) < 1e-6, fs.position.y);
  check("recovery caps the speed", fs.speed <= RECOVERY.maxSpeed, fs.speed);
  check("recovery starts a cooldown", physics.state.cooldown > 0, physics.state.cooldown);
  check("recovery keeps a valid quaternion", Math.abs(Math.hypot(fs.quat.x, fs.quat.y, fs.quat.z, fs.quat.w) - 1) < 1e-9);

  // Cooldown must swallow the next contact rather than looping.
  fs.position.y = 100.5;
  sync();
  const again = physics.update(ac, fs, 1 / 30, () => {});
  check("the cooldown suppresses a second recovery", again === false);
  check("...but the world is still queried", physics.state.contactKind === CONTACT.TERRAIN);
  check("...and unsafe states are not recorded", physics.state.safeStates <= 1, physics.state.safeStates);
}

{
  // Ocean-only world: no terrain geometry at all, contact must still work.
  const physics = createWorldPhysics({ oceanY: 0 });
  physics.setTerrain(new THREE.Object3D());
  check("an empty world builds no index", physics.state.hasTerrainIndex === false);
  const fs = createFlightState();
  fs.position.y = 300;
  const ac = new THREE.Object3D();
  const sync = () => {
    ac.position.set(fs.position.x, fs.position.y, fs.position.z);
    ac.updateMatrixWorld(true);
  };
  sync();
  physics.reset(fs);
  physics.update(ac, fs, 1 / 30);
  check("over open sea the ground is the ocean", physics.state.surface === SURFACE.OCEAN);
  check("AGL over open sea is altitude", Math.abs(physics.state.agl - 300) < 1e-6, physics.state.agl);
  check("AGL over open sea is not NaN", Number.isFinite(physics.state.agl));

  fs.position.y = 1;
  sync();
  let recovered = false;
  physics.update(ac, fs, 1 / 30, () => (recovered = true));
  check("ocean contact is detected", physics.state.contactKind === CONTACT.OCEAN, physics.state.contactKind);
  check("ocean contact recovers", recovered === true && Math.abs(fs.position.y - (300 + RECOVERY.offset)) < 1e-6, fs.position.y);
  check("the ocean event normal is world up", physics.state.lastEvent.normal.y === 1 && physics.state.lastEvent.type === CollisionType.OCEAN);

  // The metre above the waterline used to type as TERRAIN over open sea.
  physics.reset(fs);
  fs.position.y = 2;
  sync();
  physics.update(ac, fs, 1 / 30);
  check("a probe just above the waterline is ocean contact", physics.state.contactKind === CONTACT.OCEAN, [physics.state.contactKind, physics.state.minClearance]);
  check("...and the event is typed OCEAN", physics.state.lastEvent.type === CollisionType.OCEAN, physics.state.lastEvent.type);
}

{
  // §34: nothing anywhere near the island must produce NaN.
  const physics = createWorldPhysics({ oceanY: 0 });
  physics.setTerrain(makeTerrain((x) => 50 + x * 0.1));
  const fs = createFlightState();
  const ac = new THREE.Object3D();
  let finite = true;
  for (const [x, z, y] of [[0, 0, 400], [5000, 5000, 400], [-99, 99, 60], [0, 0, -50], [1e6, -1e6, 1e4]]) {
    fs.position.x = x;
    fs.position.z = z;
    fs.position.y = y;
    ac.position.set(x, y, z);
    ac.updateMatrixWorld(true);
    physics.reset(fs);
    physics.update(ac, fs, 1 / 30);
    const s = physics.state;
    if (!Number.isFinite(s.agl) || !Number.isFinite(s.minClearance) || !Number.isFinite(s.groundHeight)) finite = false;
  }
  check("terrain queries never produce NaN", finite === true);
  check("hard floor is below the contact system", FLIGHT.hardFloorY < 0, FLIGHT.hardFloorY);
}

/* ---- Stage 02.3: collision response ------------------------------------ */

{
  // The event is the whole contract between detection and response.
  const e = createCollisionEvent({
    type: CollisionType.TERRAIN,
    position: { x: 1, y: 2, z: 3 },
    normal: { x: 0, y: 1, z: 0 },
    speed: 240,
    timestamp: 12.5,
    forwardHit: true,
  });
  check("a collision event copies its position", e.position.x === 1 && e.position.z === 3);
  check("a collision event records the trigger kind", e.forwardHit === true && e.type === CollisionType.TERRAIN);
  check("a collision event defaults its normal to world up", createCollisionEvent({ type: CollisionType.OCEAN, position: { x: 0, y: 0, z: 0 }, normal: null }).normal.y === 1);

  // A near-vertical face must not shove the aircraft sideways into the next one.
  const wall = recoveryNormal({ type: CollisionType.TERRAIN, normal: { x: 1, y: 0, z: 0 } });
  check("a vertical face blends toward world up", wall.y > 0.6 && wall.x > 0.6, wall);
  check("the blended normal is unit length", Math.abs(Math.hypot(wall.x, wall.y, wall.z) - 1) < 1e-9);
  check("ocean recovery is straight up", recoveryNormal({ type: CollisionType.OCEAN, normal: { x: 1, y: 0, z: 0 } }).y === 1);
}

{
  // Safe-state history: sampled, bounded, time-ordered.
  const h = createSafeStateHistory({ seconds: 2, sampleHz: 15 });
  const fs = createFlightState();
  check("the first sample is always taken", h.sample(0, fs, 500) === true);
  check("samples inside the interval are refused", h.sample(0.02, fs, 500) === false);
  check("samples at the interval are taken", h.sample(1 / 15, fs, 500) === true);

  let t = 1 / 15;
  for (let i = 0; i < 400; i++) {
    t += 1 / 60;
    fs.position.y = 300 + i;
    h.sample(t, fs, 500);
  }
  check("history is bounded", h.length <= Math.ceil(2 * 15) + 2, h.length);
  check("history covers ~2 seconds", h.span > 1.7 && h.span <= 2.0001, h.span);
  let ordered = true;
  for (let i = 1; i < h.length; i++) if (h.states[i].time < h.states[i - 1].time) ordered = false;
  check("history is time-ordered", ordered === true);
  check("old states are dropped", t - h.oldest.time <= 2.0001, t - h.oldest.time);

  const target = h.pick(t, 0.65);
  check("pick rewinds rather than taking the newest", target !== h.newest && target.time <= t - 0.65, [target.time, t]);
  check("pick takes the newest state at or before the cutoff", t - target.time < 0.65 + 1 / 15 + 1e-9, t - target.time);
  h.trimTo(target.time);
  check("trim drops the states that led into the impact", h.newest === target, h.length);
  h.clear();
  check("an empty history picks nothing", h.pick(t, 0.65) === null && h.length === 0);
  check("a short history falls back to its oldest state", (h.sample(10, fs, 500), h.pick(10.1, 0.65)) === h.oldest);
}

{
  // The response policy in isolation: rewind, cap, neutralise, resume.
  const history = createSafeStateHistory();
  const fs = expertState();
  let cleared = 0;
  let restored = 0;
  const response = createDevelopmentRecoveryResponse({
    history,
    flightState: fs,
    clearInput: () => cleared++,
    onRestore: () => restored++,
  });
  check("the response names itself for later replacement", response.name === "DevelopmentRecoveryResponse");

  // 2 s of history: a climbing, rolling expert pass, sampled at 15 Hz.
  let t = 0;
  const marks = [];
  for (let i = 0; i < 120; i++) {
    step(fs, { x: 0.6, y: 0.3, throttle: 1 }, 1 / 60);
    t += 1 / 60;
    if (history.sample(t, fs, 400)) marks.push({ t, y: fs.position.y, quat: { ...fs.quat } });
  }
  fs.speed = 250;
  const impact = { ...fs.quat };
  const event = createCollisionEvent({
    type: CollisionType.TERRAIN,
    position: { x: fs.position.x, y: fs.position.y, z: fs.position.z },
    normal: { x: 0, y: 1, z: 0 },
    speed: 250,
    timestamp: t,
  });
  const info = response.handleCollision(event);

  check("recovery rewinds ~0.65 s", Math.abs(info.rewind - RECOVERY.rewindTime) < 1 / 15 + 1e-9, info.rewind);
  check("recovery caps the speed at 160", fs.speed === RECOVERY.maxSpeed, fs.speed);
  check("recovery makes the throttle consistent", Math.abs(getTargetSpeed(fs.throttle) - fs.speed) < 1, [fs.throttle, getTargetSpeed(fs.throttle)]);
  check("recovery is not the impact attitude", Math.abs(fs.quat.x - impact.x) > 1e-6 || Math.abs(fs.quat.w - impact.w) > 1e-6);
  const src = marks.find((m) => Math.abs(m.t - (t - info.rewind)) < 1e-9);
  check("recovery restores the historical quaternion exactly", src && Math.abs(fs.quat.x - src.quat.x) < 1e-12 && Math.abs(fs.quat.w - src.quat.w) < 1e-12);
  check("recovery offsets off the surface", Math.abs(fs.position.y - (src.y + RECOVERY.offset)) < 1e-9, [fs.position.y, src && src.y]);
  check("recovery clears transient input once", cleared === 1 && restored === 1);
  check("recovery opens a control grace window", Math.abs(response.graceRemaining - RECOVERY.controlGrace) < 1e-9, response.graceRemaining);
  check("recovery shows one-shot feedback", response.feedback === "RECOVERED \u00b7 TERRAIN", response.feedback);

  response.tick(0.2);
  check("grace is still live mid-window", response.graceRemaining > 0, response.graceRemaining);
  response.tick(0.2);
  check("grace expires quickly", response.graceRemaining === 0);
  check("...and does not linger past 0.4 s", RECOVERY.controlGrace <= 0.4, RECOVERY.controlGrace);
  response.tick(1.0);
  check("feedback clears itself", response.feedback === null);
  check("history no longer holds the impact approach", history.newest.time <= t - info.rewind + 1e-9);

  // Empty history: fall back to the airborne reset, never to a bad guess.
  const h2 = createSafeStateHistory();
  let fell = 0;
  const r2 = createDevelopmentRecoveryResponse({ history: h2, flightState: fs, fallbackReset: () => fell++ });
  const i2 = r2.handleCollision(event);
  check("an empty history falls back to the reset", fell === 1 && i2.fallback === true);
}

{
  // Terrain normals: world-space, upward, from the real triangle.
  const flat = buildTerrainIndex(collectMeshes(makeTerrain(() => 100)), 16);
  const n = terrainNormalAt(flat, 10, 10);
  check("a flat plateau normal is world up", Math.abs(n.y - 1) < 1e-9, n);
  const ramp = buildTerrainIndex(collectMeshes(makeTerrain((x, z) => -z * 5)), 16);
  const rn = terrainNormalAt(ramp, 0, 0);
  check("a ramp normal tilts", rn.y > 0 && rn.y < 1 && Math.abs(rn.z) > 0.5, rn);
  check("a ramp normal is unit length", Math.abs(Math.hypot(rn.x, rn.y, rn.z) - 1) < 1e-6);
  check("normals always point upward", terrainNormalAt(ramp, 50, -50).y > 0);
  check("off the island there is no normal", terrainNormalAt(ramp, 5000, 0) === null);
  check("a null index has no normal", terrainNormalAt(null, 0, 0) === null);
}

{
  // The Stage 02.3 headline: one impact, one recovery, then normal flight.
  const physics = createWorldPhysics({ oceanY: 0 });
  physics.setTerrain(makeTerrain(() => 100, 3000)); // wide enough to fly across
  const fs = createFlightState();
  fs.position.y = 400;
  const ac = new THREE.Object3D();
  const sync = () => {
    ac.position.set(fs.position.x, fs.position.y, fs.position.z);
    ac.quaternion.set(fs.quat.x, fs.quat.y, fs.quat.z, fs.quat.w);
    ac.updateMatrixWorld(true);
  };
  const fly = (n, input = { x: 0, y: 0 }) => {
    for (let i = 0; i < n; i++) {
      updateFlight(fs, input, 1 / 60);
      sync();
      physics.update(ac, fs, 1 / 60);
    }
  };
  sync();
  physics.reset(fs);
  fly(150); // 2.5 s of clear flight
  check("clear flight fills the history", physics.state.safeStates > 20, physics.state.safeStates);
  check("the history stays inside its window", physics.state.safeSpan <= RECOVERY.historySeconds + 0.05, physics.state.safeSpan);
  check("the history does not grow without bound", physics.state.safeStates <= 32, physics.state.safeStates);
  check("physics reports its own rate", physics.state.physicsHz === 60);
  check("safe clearance is reported for the HUD", Math.abs(physics.state.safeClearance - requiredSafeClearance(fs.speed)) < 1e-9);

  const t = physics.state.time;
  fs.position.y = 100.5; // belly inside the plateau
  sync();
  const info = physics.update(ac, fs, 1 / 30);
  check("the impact produces one recovery", !!info && physics.state.recoveries === 1, physics.state.recoveries);
  check("the recovery rewinds ~0.65 s", Math.abs(info.rewind - RECOVERY.rewindTime) < 1 / 15 + 1e-9, info.rewind);
  check("the recovery is not a fallback reset", info.fallback === false);
  check("the aircraft ends up clear of the terrain", fs.position.y > 100 + requiredSafeClearance(fs.speed), fs.position.y);
  check("the recovery bleeds the speed", fs.speed <= RECOVERY.maxSpeed, fs.speed);

  const after = physics.state.recoveries;
  fly(180); // 3 s of normal flight, well past the 0.6 s cooldown
  check("no bounce: flight resumes without a second recovery", physics.state.recoveries === after, physics.state.recoveries);
  check("the contact state returns to clear", physics.state.contactKind === CONTACT.CLEAR, physics.state.contactKind);
  check("history refills after the recovery", physics.state.safeStates > 10, physics.state.safeStates);

  // Sustained penetration (held inside terrain): cooldown-limited, not per-query.
  const held = physics.state.recoveries;
  for (let i = 0; i < 72; i++) {
    fs.position.y = 100.5;
    sync();
    physics.update(ac, fs, 1 / 60);
  }
  const fired = physics.state.recoveries - held;
  check("sustained penetration fires once per cooldown, not per query", fired <= 3, fired);
  check("...which is far fewer than the 72 queries it saw", fired < 72 / 10, fired);
}

{
  // A forward hazard is a warning; only imminence triggers a response.
  const physics = createWorldPhysics({ oceanY: 0 });
  // A 45° slope climbing toward -Z, so level flight runs at a face.
  physics.setTerrain(makeTerrain((x, z) => -z));
  const fs = createFlightState();
  fs.speed = 250;
  fs.position.y = 60; // the face crosses this altitude at z ≈ -58.5
  fs.position.z = 60;
  const ac = new THREE.Object3D();
  const place = (z) => {
    fs.position.z = z;
    ac.position.set(0, 60, z);
    ac.updateMatrixWorld(true);
  };
  place(60);
  physics.reset(fs);
  physics.update(ac, fs, 1 / 30);
  check("behind the slope there is nothing ahead", physics.state.forwardHazard === false, physics.state.forwardDistance);
  check("look-ahead at 250 m/s is 50 m", Math.abs(physics.state.lookAhead - 50) < 1e-9, physics.state.lookAhead);

  // Nose ~42 m from the face: inside the 50 m look-ahead, outside imminence.
  place(-16.8 + 8.6);
  const warned = physics.update(ac, fs, 1 / 30);
  check("a face inside the look-ahead is a forward hazard", physics.state.forwardHazard === true, physics.state.forwardDistance);
  check("a distant hazard is not physical contact", physics.state.physicalContact === false, physics.state.minClearance);
  check("a distant hazard does not trigger recovery", warned === false && physics.state.recoveries === 0);
  check("a distant hazard is outside imminence", physics.state.forwardImminent === false && physics.state.forwardDistance > imminentForwardDistance(250), physics.state.forwardDistance);
  check("the warning still reads as FORWARD contact", physics.state.contactKind === CONTACT.FORWARD, physics.state.contactKind);

  // Nose ~8 m from the face: penetration is otherwise unavoidable.
  place(-50.2 + 8.6);
  physics.update(ac, fs, 1 / 30);
  check("an imminent hazard escalates to a collision", physics.state.forwardImminent === true && physics.state.recoveries === 1, [physics.state.forwardDistance, physics.state.recoveries]);
  check("...without the body having touched anything", physics.state.physicalContact === false, physics.state.minClearance);
  check("the forward event is marked as a forward hit", physics.state.lastEvent.forwardHit === true && physics.state.lastEvent.probe === "forward");
  check("the forward event carries the face normal", physics.state.lastEvent.normal.y > 0 && physics.state.lastEvent.normal.y < 1, physics.state.lastEvent.normal);
}

{
  // Expert quaternion survival: inverted and vertical states must round-trip.
  const history = createSafeStateHistory();
  const fs = expertState();
  step(fs, { x: 1, y: 0 }, 1 / 60, Math.round(1.5 * 60)); // 180 deg roll: inverted
  const inverted = { ...fs.quat };
  history.sample(0, fs, 500);
  step(fs, { x: 0, y: -1 }, 1 / 60, 90); // pitch down hard
  history.sample(1.0, fs, 500);

  const response = createDevelopmentRecoveryResponse({ history, flightState: fs });
  response.handleCollision(createCollisionEvent({
    type: CollisionType.TERRAIN,
    position: { x: 0, y: 0, z: 0 },
    normal: { x: 0.2, y: 0.4, z: 0.1 },
    speed: 250,
    timestamp: 1.05,
  }));
  check("expert recovery restores the inverted quaternion", Math.abs(fs.quat.x - inverted.x) < 1e-12 && Math.abs(fs.quat.w - inverted.w) < 1e-12, [fs.quat, inverted]);
  check("expert recovery leaves the quaternion normalized", Math.abs(Math.hypot(fs.quat.x, fs.quat.y, fs.quat.z, fs.quat.w) - 1) < 1e-12);
  const up = upv(fs);
  check("the restored attitude is still inverted", up.y < 0, up.y);
  check("no Euler corruption: pitch and bank are finite", Number.isFinite(fs.pitch) && Number.isFinite(fs.bank), [fs.pitch, fs.bank]);
  check("recovery does not level the aircraft", Math.abs(fs.bank) > 0.5, fs.bank);
}

{
  // §12: the cap moves the lever too, or the engine spools straight back up.
  const fs = createFlightState();
  const snap = captureFlightState(fs);
  snap.speed = 250;
  snap.throttle = 1;
  applyFlightState(fs, snap, { maxSpeed: RECOVERY.maxSpeed });
  check("the recovery cap limits the speed", fs.speed === RECOVERY.maxSpeed, fs.speed);
  check("the cap rewrites the throttle", fs.throttle < 1 && Math.abs(getTargetSpeed(fs.throttle) - RECOVERY.maxSpeed) < 1, [fs.throttle, getTargetSpeed(fs.throttle)]);
  check("the cap drops afterburner", fs.afterburner === false);

  // A slower snapshot passes through untouched.
  snap.speed = 140;
  applyFlightState(fs, snap, { maxSpeed: RECOVERY.maxSpeed });
  check("a slow snapshot is not sped up by the cap", fs.speed === 140, fs.speed);
  // And no cap means the recorded lever is honoured (Stage 02.2 behaviour).
  applyFlightState(fs, snap);
  check("without a cap the recorded throttle is restored", fs.throttle === 1, fs.throttle);
}

/* ==== Stage 03.0 — targeting, weapons, missiles, target drone ==== */

{
  const fwd = { x: 0, y: 0, z: -1 };
  const g = targetGeometry({ x: 0, y: 0, z: 0 }, fwd, { x: 0, y: 0, z: -1000 });
  check("targetGeometry: dead ahead is 0 deg off boresight", g.range === 1000 && g.angleDeg < 1e-6, [g.range, g.angleDeg]);
  targetGeometry({ x: 0, y: 0, z: 0 }, fwd, { x: 1000, y: 0, z: -1000 }, g);
  check("targetGeometry: 45 deg to the right reads 45 deg", Math.abs(g.angleDeg - 45) < 1e-6, g.angleDeg);
  targetGeometry({ x: 0, y: 0, z: 0 }, fwd, { x: 0, y: 0, z: 500 }, g);
  check("targetGeometry: astern reads 180 deg", Math.abs(g.angleDeg - 180) < 1e-6, g.angleDeg);
}

{
  const ok = { range: 2000, angleDeg: 10, screenOffset: 0.2 };
  check("qualifies: inside the envelope", qualifies(ok).valid === true);
  check("qualifies: beyond max range fails", qualifies({ ...ok, range: TARGETING.maxRange + 1 }).reason === LockFail.OUT_OF_RANGE);
  check("qualifies: inside min range fails", qualifies({ ...ok, range: TARGETING.minRange - 1 }).reason === LockFail.TOO_CLOSE);
  check("qualifies: outside the cone fails", qualifies({ ...ok, angleDeg: TARGETING.coneDeg + 1 }).reason === LockFail.OFF_BORESIGHT);
  check("qualifies: off the screen fails", qualifies({ ...ok, screenOffset: 0.95 }).reason === LockFail.OFF_BORESIGHT);
  check("qualifies: behind the camera (null offset) fails", qualifies({ ...ok, screenOffset: null }).valid === false);
}

{
  const lock = { state: LockState.NONE, progress: 0, invalidFor: 0 };
  advanceLock(lock, true, 0.1);
  check("lock: a valid target starts ACQUIRING", lock.state === LockState.ACQUIRING, [lock.state, lock.progress]);
  for (let i = 0; i < 10; i++) advanceLock(lock, true, 0.1);
  check("lock: acquisition completes after acquireTime", lock.state === LockState.LOCKED && lock.progress === 1, lock.progress);

  // §16: a lock survives a short break, so a hard bank does not strobe the HUD.
  advanceLock(lock, false, TARGETING.holdTime * 0.5);
  check("lock: survives a break shorter than holdTime", lock.state === LockState.LOCKED, lock.invalidFor);
  advanceLock(lock, true, 1 / 60);
  check("lock: regaining the target clears the break timer", lock.invalidFor === 0);
  advanceLock(lock, false, TARGETING.holdTime + 0.01);
  check("lock: breaks once holdTime elapses", lock.state === LockState.NONE && lock.progress === 0, lock.state);

  // Partial acquisition drains faster than it fills.
  const l2 = { state: LockState.NONE, progress: 0, invalidFor: 0 };
  advanceLock(l2, true, TARGETING.acquireTime * 0.6);
  const held = l2.progress;
  advanceLock(l2, false, TARGETING.acquireTime * 0.1);
  check("lock: acquisition drains while invalid", l2.progress < held && l2.state === LockState.ACQUIRING, [held, l2.progress]);
  advanceLock(l2, false, TARGETING.acquireTime);
  check("lock: drained acquisition returns to NONE", l2.state === LockState.NONE && l2.progress === 0);
}

{
  // The service picks the nearest qualifying candidate and ignores dead ones.
  const sys = createTargetingSystem();
  const near = { position: { x: 0, y: 0, z: -900 }, alive: true };
  const far = { position: { x: 0, y: 0, z: -2500 }, alive: true };
  const observer = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  const offsets = () => 0.1;
  sys.update(observer, [far, near], offsets, 1 / 60);
  check("targeting: acquires the nearest candidate", sys.state.currentTarget === near, sys.state.targetRange);
  for (let i = 0; i < 60; i++) sys.update(observer, [far, near], offsets, 1 / 60);
  check("targeting: reaches LOCK on a held target", sys.state.lockState === LockState.LOCKED);
  check("targeting: fire authority follows the lock", sys.canFire() === true);

  near.alive = false;
  for (let i = 0; i < 40; i++) sys.update(observer, [far, near], offsets, 1 / 60);
  check("targeting: a destroyed target is dropped", sys.state.currentTarget === far, sys.state.currentTarget && sys.state.currentTarget.position.z);

  sys.clear();
  check("targeting: clear() releases lock and target", sys.state.lockState === LockState.NONE && sys.state.currentTarget === null && sys.canFire() === false);

  // Nothing in range at all: the HUD gets NO TARGET, not a stale range.
  sys.update(observer, [{ position: { x: 0, y: 0, z: -90000 }, alive: true }], offsets, 1 / 60);
  check("targeting: an unreachable target does not lock", sys.state.lockState === LockState.NONE && sys.state.reason === LockFail.OUT_OF_RANGE, sys.state.reason);
}

{
  // steer(): the visible curve of the missile lives entirely here.
  const dir = { x: 0, y: 0, z: -1 };
  const desired = { x: 1, y: 0, z: 0 };
  const maxRad = 10 * DEG;
  steer(dir, desired, maxRad);
  const turned = Math.acos(-dir.z) / DEG;
  check("steer: turns at exactly the commanded rate", Math.abs(turned - 10) < 1e-6, turned);
  check("steer: stays unit length", Math.abs(Math.hypot(dir.x, dir.y, dir.z) - 1) < 1e-12);
  for (let i = 0; i < 40; i++) steer(dir, desired, maxRad);
  check("steer: converges onto the desired direction", Math.abs(dir.x - 1) < 1e-6, dir);
  const same = { x: 0, y: 0, z: -1 };
  steer(same, { x: 0, y: 0, z: -1 }, maxRad);
  check("steer: an aligned command is a no-op", same.z === -1);
  // Exactly antiparallel has no unique turn plane; it must still turn.
  const flip = { x: 0, y: 0, z: -1 };
  steer(flip, { x: 0, y: 0, z: 1 }, maxRad);
  check("steer: a reversal picks a turn plane and moves", Math.abs(Math.acos(-flip.z) / DEG - 10) < 1e-6 && Math.abs(Math.hypot(flip.x, flip.y, flip.z) - 1) < 1e-12, flip);
}

{
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: -100 };
  check("segmentDistance: perpendicular offset from the middle", Math.abs(segmentDistance(a, b, { x: 5, y: 0, z: -50 }) - 5) < 1e-9);
  check("segmentDistance: past the end clamps to the endpoint", Math.abs(segmentDistance(a, b, { x: 0, y: 0, z: -130 }) - 30) < 1e-9);
  check("segmentDistance: a swept step catches a target it flew past", segmentDistance(a, b, { x: 10, y: 0, z: -50 }) < MISSILE.hitRadius, "10 m off a 100 m step");
  check("segmentDistance: a zero-length step still measures", Math.abs(segmentDistance(a, a, { x: 3, y: 4, z: 0 }) - 5) < 1e-9);
}

{
  let speed = 200;
  for (let i = 0; i < 60 * 3; i++) speed = advanceSpeed(speed, i / 60, 1 / 60);
  check("advanceSpeed: boost is capped at maxSpeed", speed <= MISSILE.maxSpeed, speed);
  const bleeding = advanceSpeed(600, MISSILE.boostTime + 1, 1 / 60);
  check("advanceSpeed: speed bleeds once the motor is out", bleeding < 600, bleeding);

  const lead = leadPoint({ x: 0, y: 0, z: 0 }, 800, { x: 0, y: 0, z: -800 }, { x: 150, y: 0, z: 0 });
  check("leadPoint: aims ahead of a crossing target", lead.x > 100 && lead.x < 160, lead.x);
  const capped = leadPoint({ x: 0, y: 0, z: 0 }, 100, { x: 0, y: 0, z: -5000 }, { x: 150, y: 0, z: 0 });
  check("leadPoint: lead time is capped", Math.abs(capped.x - 150 * MISSILE.maxLeadTime) < 1e-9, capped.x);
}

{
  // Asset normalization on a synthetic source: 8 units long on +Z, off-centre.
  const src = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 8));
  src.position.set(3, -2, 12);
  const wrapper = new THREE.Object3D();
  wrapper.add(src);
  const { root, metrics } = normalizeMissile(wrapper, WEAPONS.aim9);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  check("normalizeMissile: scales to the AIM-9 length", Math.abs(size.z - WEAPONS.aim9.targetLength) < 1e-6, size.z);
  check("normalizeMissile: recentres the pivot on the body", center.length() < 1e-6, center.toArray());
  check("normalizeMissile: reports the source scale", metrics.scale > 0 && metrics.lengthAxis === "z", metrics);

  const placeholder = buildPlaceholderMissile();
  const pbox = new THREE.Box3().setFromObject(placeholder).getSize(new THREE.Vector3());
  check("placeholder missile is AIM-9 sized", Math.abs(pbox.z - 2.85) < 0.3, pbox.z);
}

{
  // §4: launch points are transforms, never world constants. Move and yaw the
  // aircraft and the mounts must follow it exactly.
  const ac = new THREE.Object3D();
  const mounts = createWeaponMounts(ac);
  check("mounts: both hardpoints exist by name", !!ac.getObjectByName("MissileLeft") && !!ac.getObjectByName("MissileRight"));
  check("mounts: they live under WeaponMounts", mounts.left.parent.name === "WeaponMounts");
  check("mounts: left is to port, right to starboard", mounts.left.position.x < 0 && mounts.right.position.x > 0, [mounts.left.position.x, mounts.right.position.x]);
  check("mounts: both are slung under the wing", mounts.left.position.y < 0 && mounts.left.position.y === mounts.right.position.y);
  check("mounts: symmetrical about the centreline", mounts.left.position.x === -mounts.right.position.x && mounts.left.position.z === mounts.right.position.z);
  check("mounts: no toe-in or toe-out \u2014 rotation stays identity", mounts.left.rotation.x === 0 && mounts.left.rotation.y === 0 && mounts.left.rotation.z === 0);
  check("mounts: a launch rail is attached to each station", !!mounts.left.getObjectByName("MissileLeftRail") && !!mounts.right.getObjectByName("MissileRightRail"));

  ac.position.set(100, 700, -2000);
  ac.rotation.y = Math.PI / 2; // nose now on -X
  ac.updateMatrixWorld(true);
  const w = mounts.right.getWorldPosition(new THREE.Vector3());
  // Yawed 90°, local +X maps onto world -Z and local +Z onto world +X.
  check("mounts: world transform follows the airframe", Math.abs(w.z - (-2000 - 5.2)) < 1e-6 && Math.abs(w.y - (700 - 1.05)) < 1e-6 && Math.abs(w.x - (100 + 4.3)) < 1e-6, w.toArray());
  const q = mounts.right.getWorldQuaternion(new THREE.Quaternion());
  const launchFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  check("mounts: launch forward is the airframe's nose", Math.abs(launchFwd.x + 1) < 1e-6, launchFwd.toArray());

  const rounds = createMountedMissiles(mounts, buildPlaceholderMissile());
  check("rounds: two AIM-9s are carried at start", rounds.count === 2);
  const first = rounds.next();
  const mount = rounds.release(first);
  check("rounds: firing empties one rail", rounds.count === 1 && first.visual.visible === false, rounds.count);
  check("rounds: the released mount is the one that was carrying it", mount === first.mount);
  check("rounds: the next round comes from the other rail", rounds.next().mount !== mount);
  rounds.release(rounds.next());
  check("rounds: two shots empty the aircraft", rounds.count === 0 && rounds.next() === null);
  rounds.reload();
  check("rounds: reset restores both visible rounds", rounds.count === 2 && rounds.rounds.every((r) => r.visual.visible));
}

{
  // End-to-end launch: mount transform -> live entity -> proximity hit.
  const scene = new THREE.Scene();
  const ac = new THREE.Object3D();
  ac.position.set(0, 700, 0);
  const mounts = createWeaponMounts(ac);
  ac.updateMatrixWorld(true);

  const system = createMissileSystem({ scene, prototype: null });
  let hits = 0;
  let expiries = 0;
  system.on("hit", () => hits++);
  system.on("expire", () => expiries++);

  const target = { position: new THREE.Vector3(120, 760, -1400), velocity: new THREE.Vector3(0, 0, -148), alive: true };
  const m = system.fire({ mount: mounts.right, target, ownerSpeed: 240, side: 1 });
  check("launch: the missile starts at the mount's world position", m.position.distanceTo(mounts.right.getWorldPosition(new THREE.Vector3())) < 1e-6);
  check("launch: it starts unguided (LAUNCHED)", m.state === MissileState.LAUNCHED);
  check("launch: it inherits most of the aircraft's speed", Math.abs(m.speed - 240 * MISSILE.inheritFactor) < 1e-6, m.speed);

  let steps = 0;
  const speeds = [];
  while (system.inFlight && steps < 60 * 8) {
    system.update(1 / 60);
    if (system.inFlight) speeds.push(system.live[0].speed);
    target.position.addScaledVector(target.velocity, 1 / 60);
    steps++;
  }
  check("launch: separation gives way to guidance", m.state !== MissileState.LAUNCHED, m.state);
  check("guidance: the missile boosts past the launch speed", Math.max(...speeds) > 240, Math.max(...speeds));
  check("guidance: speed never exceeds maxSpeed", Math.max(...speeds) <= MISSILE.maxSpeed);
  check("guidance: a moving target is hit", hits === 1 && m.state === MissileState.HIT, [hits, m.state, steps]);
  check("guidance: the hit happens inside the missile's lifetime", steps / 60 < MISSILE.lifetime, `${(steps / 60).toFixed(2)} s`);
  check("a hit missile leaves nothing in the scene", !scene.children.includes(m.visual.group));

  // §26: no target -> the round flies on and expires on its own timer.
  const dumb = system.fire({ mount: mounts.left, target: null, ownerSpeed: 240, side: -1 });
  let t = 0;
  while (system.inFlight && t < 12) {
    system.update(1 / 60);
    t += 1 / 60;
  }
  check("miss: an unguided round expires", dumb.state === MissileState.EXPIRED && expiries === 1, [dumb.state, expiries]);
  check("miss: it expires on the lifetime, not early", Math.abs(dumb.life - MISSILE.lifetime) < 0.1, dumb.life);

  system.fire({ mount: mounts.right, target, ownerSpeed: 240, side: 1 });
  system.reset();
  check("reset: live missiles are cleared from the world", system.inFlight === 0 && scene.children.length === 0, scene.children.length);
}

{
  const drone = createTargetDrone();
  check("target: spawns ahead of the player on the course", drone.position.z < 0 && drone.position.y > FLIGHT.spawn.y, drone.position.toArray());
  check("target: spawns alive and visible", drone.alive === true && drone.root.visible === true);

  const z0 = drone.position.z;
  updateTargetDrone(drone, 1);
  check("target: flies its course at the configured speed", Math.abs(drone.position.z - (z0 - ENEMY.speed)) < 1e-6, drone.position.z - z0);
  check("target: publishes a velocity for missile lead", Math.abs(drone.velocity.z + ENEMY.speed) < 1e-6, drone.velocity.toArray());

  // The scripted path must actually turn — that is what breaks lock (§7).
  const h0 = drone.heading;
  for (let i = 0; i < 60 * 12; i++) updateTargetDrone(drone, 1 / 60);
  check("target: the path turns after the first straight leg", Math.abs(drone.heading - h0) > 1, drone.heading);
  check("target: it banks into the turn", Math.abs(drone.bank) > 0.1, drone.bank);
  check("target: it holds its altitude", Math.abs(drone.position.y - ENEMY.spawn.y) < 1e-6, drone.position.y);

  markTargetHit(drone, 3);
  check("target: a hit disables and hides it", drone.alive === false && drone.root.visible === false);
  const moved = drone.position.clone();
  updateTargetDrone(drone, 1);
  check("target: a dead target stops flying", drone.position.equals(moved));

  resetTargetDrone(drone);
  check("target: reset restores the spawn state", drone.alive === true && drone.root.visible === true && drone.position.z === ENEMY.spawn.z && drone.leg === 0, drone.position.toArray());
}

{
  // HUD sizing is pure geometry: the box must track range, then clamp.
  const near = apparentSize(24, 300, 1080, 65);
  const far = apparentSize(24, 4000, 1080, 65);
  check("HUD: the target box shrinks with range", far < near, [near, far]);
  check("HUD: the box has a floor at long range", apparentSize(24, 90000, 1080, 65) >= 22);
  check("HUD: the box has a ceiling at point blank", apparentSize(24, 5, 1080, 65) <= 170);
}

/* ==== Stage 03.05 — HUD presentation ==== */

{
  // damp() must be frame-rate independent: the same elapsed time reached in
  // different step counts must land in the same place.
  const one = damp(0, 100, 8, 0.5);
  let many = 0;
  for (let i = 0; i < 30; i++) many = damp(many, 100, 8, 0.5 / 30);
  check("damp: frame-rate independent to within a fraction of a unit", Math.abs(one - many) < 0.5, [one, many]);
  check("damp: approaches but never overshoots", damp(0, 100, 8, 1) < 100 && damp(0, 100, 8, 1) > 99);
  check("damp: a zero step is a no-op", damp(42, 100, 8, 0) === 42);
  check("damp: already there stays there", damp(100, 100, 8, 0.1) === 100);
}

{
  // §8/§40: a 360° roll must not produce a 350° visual sweep at the seam.
  const near = dampAngle(-170, 170, 10, 1 / 60);
  check("dampAngle: crosses the \u00b1180\u00b0 seam the short way", near < -170, near);
  const fwd = dampAngle(350, 10, 10, 1 / 60);
  check("dampAngle: 350 -> 10 moves upward past the wrap", fwd > 350, fwd);
  check("dampAngle: identical angles do not drift", Math.abs(dampAngle(45, 45, 10, 0.1) - 45) < 1e-12);
  let a = 0;
  for (let i = 0; i < 600; i++) a = dampAngle(a, 179, 10, 1 / 60);
  check("dampAngle: converges on the target angle", Math.abs(a - 179) < 0.01, a);
}

{
  // Attitude for display only, derived from vectors the flight model already
  // publishes — no Euler state is reintroduced (§12).
  check("derivePitchDeg: level flight reads zero", Math.abs(derivePitchDeg({ x: 0, y: 0, z: -1 })) < 1e-9);
  check("derivePitchDeg: straight up reads +90", Math.abs(derivePitchDeg({ x: 0, y: 1, z: 0 }) - 90) < 1e-9);
  check("derivePitchDeg: a 30\u00b0 climb reads +30", Math.abs(derivePitchDeg({ x: 0, y: Math.sin(30 * DEG), z: -Math.cos(30 * DEG) }) - 30) < 1e-6);
  check("derivePitchDeg: clamps past vertical instead of NaN", Number.isFinite(derivePitchDeg({ x: 0, y: 1.4, z: 0 })));

  check("deriveHeadingDeg: nose on -Z is 000", Math.abs(deriveHeadingDeg({ x: 0, y: 0, z: -1 })) < 1e-9);
  const east = deriveHeadingDeg({ x: 1, y: 0, z: 0 });
  check("deriveHeadingDeg: stays inside 0..360", east >= 0 && east < 360, east);
}

{
  const level = { x: 0, y: 0, z: -1 };
  check("deriveBankDeg: wings level reads zero", Math.abs(deriveBankDeg(level, { x: 0, y: 1, z: 0 })) < 1e-9);

  // Right bank: the up vector tips toward the right wing.
  const b = 45 * DEG;
  const right = deriveBankDeg(level, { x: Math.sin(b), y: Math.cos(b), z: 0 });
  check("deriveBankDeg: a 45\u00b0 bank reads 45\u00b0", Math.abs(Math.abs(right) - 45) < 1e-6, right);
  const left = deriveBankDeg(level, { x: -Math.sin(b), y: Math.cos(b), z: 0 });
  check("deriveBankDeg: left and right are opposite signs", Math.sign(left) === -Math.sign(right), [left, right]);

  // §13: knife-edge and inverted must stay valid, not flip to an arbitrary value.
  const knife = deriveBankDeg(level, { x: 1, y: 0, z: 0 });
  check("deriveBankDeg: knife-edge reads \u00b190\u00b0", Math.abs(Math.abs(knife) - 90) < 1e-6, knife);
  const inverted = deriveBankDeg(level, { x: 0, y: -1, z: 0 });
  check("deriveBankDeg: inverted reads \u00b1180\u00b0", Math.abs(Math.abs(inverted) - 180) < 1e-6, inverted);

  // Straight up: the horizon reference is degenerate, so the last stable value
  // is held rather than generating a flip.
  const vertical = deriveBankDeg({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 33);
  check("deriveBankDeg: vertical flight holds the previous HUD bank", vertical === 33, vertical);

  // A full roll produces no discontinuity larger than the step itself.
  let prev = deriveBankDeg(level, { x: 0, y: 1, z: 0 });
  let worst = 0;
  for (let i = 1; i <= 360; i++) {
    const t = i * DEG;
    const cur = deriveBankDeg(level, { x: Math.sin(t), y: Math.cos(t), z: 0 });
    const d = Math.abs(((((cur - prev + 180) % 360) + 360) % 360) - 180);
    worst = Math.max(worst, d);
    prev = cur;
  }
  check("deriveBankDeg: a full 360\u00b0 roll is continuous at the seam", worst < 1.5, worst);
}

{
  // §10: the ladder must not be rotated by roll unless deliberately dialled in.
  check("HUD: pitch ladder roll influence defaults to zero", HUD.ladderRollInfluence === 0, HUD.ladderRollInfluence);
  check("HUD: smoothing rates sit in the 6\u201310 response range", HUD.pitchLambda >= 6 && HUD.pitchLambda <= 10 && HUD.bankLambda >= 6 && HUD.bankLambda <= 12, [HUD.pitchLambda, HUD.bankLambda]);
  check("HUD: target tracking is tighter than attitude smoothing", HUD.targetLambda > HUD.pitchLambda, HUD.targetLambda);
  check("HUD: the lock pulse is a short confirmation", HUD.lockPulseTime >= 0.15 && HUD.lockPulseTime <= 0.25, HUD.lockPulseTime);
  check("HUD: origin sits above the vertical centre", HUD.centerY > 0.3 && HUD.centerY < 0.5, HUD.centerY);
}

{
  // §33: the rail is a sibling of the round, so firing cannot take it away.
  const ac = new THREE.Object3D();
  const mounts = createWeaponMounts(ac);
  const rounds = createMountedMissiles(mounts, buildPlaceholderMissile());
  const rail = mounts.left.getObjectByName("MissileLeftRail");
  const round = rounds.next();
  rounds.release(round);
  check("rail: survives the launch that hides its missile", rail.visible === true && round.visual.visible === false);
  check("rail: is not a child of the round", !round.visual.getObjectByName("MissileLeftRail"));

  const bare = createWeaponMounts(new THREE.Object3D(), { rails: false });
  check("rail: can be switched off for headless use", bare.left.children.length === 0);

  const solo = buildLaunchRail("Test");
  const box = new THREE.Box3().setFromObject(solo);
  check("rail: sits above the missile body centre", box.min.y > 0, box.min.y);
  check("rail: reaches up toward the wing surface", box.max.y >= WEAPONS.rail.strut.top - 1e-6, box.max.y);
  check("rail: is shorter than the missile it carries", box.max.z - box.min.z < WEAPONS.aim9.targetLength, box.max.z - box.min.z);
}

/* ==== Stage 03.15 — atmospheric and propulsion FX ==== */

{
  // §5: intensity must track throttle and AB state, and must NOT be a function
  // of speed — a fast dive on idle thrust has to stay dark.
  const idle = engineIntensity(0.2, false);
  const mid = engineIntensity(0.6, false);
  const dry = engineIntensity(1, false);
  const ab = engineIntensity(1, true);
  check("engine: below the dry onset there is no plume", idle === 0, idle);
  check("engine: intensity rises with throttle", mid > 0 && dry > mid, [mid, dry]);
  check("engine: full dry thrust stops at the dry ceiling", Math.abs(dry - ENGINE_FX.dryCeiling) < 1e-9, dry);
  check("engine: AB reads stronger than military power", ab > dry * 1.5, [dry, ab]);
  check("engine: AB tops out at full intensity", Math.abs(ab - ENGINE_FX.abIntensity) < 1e-9, ab);
  check("engine: intensity is monotonic in throttle", engineIntensity(0.5, false) < engineIntensity(0.7, false) && engineIntensity(0.7, false) < dry);
  // The signature check for §5: engineIntensity's only required inputs are
  // throttle and AB state (the third parameter is the config default), so speed
  // cannot be the primary driver by construction.
  check("engine: intensity takes only throttle and AB state", engineIntensity.length === 2, engineIntensity.length);
}

{
  check("engine: shock rings are silent at dry thrust", ringOpacity(ENGINE_FX.dryCeiling) === 0, ringOpacity(ENGINE_FX.dryCeiling));
  check("engine: rings appear only past the ring onset", ringOpacity(ENGINE_FX.ringOnset) === 0 && ringOpacity(0.85) > 0, ringOpacity(0.85));
  check("engine: rings are fully lit at full AB", Math.abs(ringOpacity(1) - 1) < 1e-9);

  // Flicker must stay a shimmer, never a strobe (§10).
  let lo = 2;
  let hi = 0;
  for (let t = 0; t < 4; t += 1 / 240) {
    const f = flickerAt(t);
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  check("engine: flicker stays within its configured amplitude", lo > 1 - ENGINE_FX.flicker - 1e-9 && hi < 1 + ENGINE_FX.flicker + 1e-9, [lo, hi]);
  check("engine: flicker is deterministic in time", flickerAt(1.234) === flickerAt(1.234));
}

{
  // §28: the plumes hang on the tailpipes, not on the stabilator booms. The two
  // failure modes of the earlier pass, stated as tests: too far outboard, and
  // aft of the fuselage entirely.
  const [l, r] = ENGINE_FX.nozzles;
  check("engine: nozzles are mirrored about the centreline", l.position.x === -r.position.x && l.position.y === r.position.y && l.position.z === r.position.z);
  check("engine: nozzles sit inboard of the stabilator booms", Math.abs(r.position.x) + ENGINE_FX.nozzleRadius <= ENGINE_FX.boomInnerX, [r.position.x, ENGINE_FX.boomInnerX]);
  // Twin tailpipes read as one central exhaust: the gap between them is smaller
  // than a single nozzle's own width.
  const gap = 2 * Math.abs(r.position.x) - 2 * ENGINE_FX.nozzleRadius;
  check("engine: the tailpipes are close enough to read as a central pair", gap < 2 * ENGINE_FX.nozzleRadius, gap);
  check("engine: the core starts at the exit plane, not behind the tail", r.position.z > 8.0 && r.position.z < 8.4, r.position.z);
  // The core cone fills the measured opening rather than rattling around in it.
  check("engine: the core is sized to the nozzle opening", ENGINE_FX.coreRadius <= ENGINE_FX.nozzleRadius && ENGINE_FX.coreRadius > ENGINE_FX.nozzleRadius * 0.7, [ENGINE_FX.coreRadius, ENGINE_FX.nozzleRadius]);
  check("engine: shock rings fit inside the plume", ENGINE_FX.ringRadius + ENGINE_FX.ringTube < ENGINE_FX.plumeRadius);
}

{
  // §11: vapor is an event, not a state. Both gates must hold independently.
  check("vapor: dry air produces nothing however hard the turn", vaporIntensity(0.1, 1) === 0);
  check("vapor: calm flight produces nothing however wet the air", vaporIntensity(1, 0.1) === 0);
  check("vapor: straight-and-level in cloud stays clean", vaporIntensity(1, 0) === 0);
  const hard = vaporIntensity(1, 1);
  check("vapor: a hard turn in saturated air is fully lit", Math.abs(hard - 1) < 1e-9, hard);
  check("vapor: intensity rises with load", vaporIntensity(0.8, 0.5) < vaporIntensity(0.8, 0.9));
  check("vapor: intensity rises with humidity", vaporIntensity(0.5, 0.9) < vaporIntensity(0.9, 0.9));
}

{
  // Load is derived from published attitude and stick only — no AoA or G field
  // was added to the flight model (§1).
  check("load: level hands-off flight is unloaded", maneuverLoad({}) === 0);
  check("load: a hard bank alone counts", maneuverLoad({ bankDeg: VAPOR.bankLoadDeg }) === 1);
  check("load: bank sign does not matter", maneuverLoad({ bankDeg: -40 }) === maneuverLoad({ bankDeg: 40 }));
  check("load: a fast pull counts before bank builds", maneuverLoad({ pitchRateDeg: VAPOR.pitchRateLoad }) === 1);
  check("load: stick deflection registers immediately", maneuverLoad({ stickX: 1, stickY: 0 }) > 0.5, maneuverLoad({ stickX: 1 }));
  check("load: the strongest proxy wins", maneuverLoad({ bankDeg: 62, pitchRateDeg: 1 }) === 1);
  check("load: it never exceeds 1", maneuverLoad({ bankDeg: 900, pitchRateDeg: 900, stickX: 9, stickY: 9 }) === 1);
}

{
  // §14: fades, never a toggle — and vapor decays slower than it appears.
  let up = 0;
  for (let i = 0; i < 6; i++) up = approach(up, 1, VAPOR.vortexRise, VAPOR.vortexFall, 1 / 60);
  check("vapor: rises smoothly rather than snapping on", up > 0 && up < 0.5, up);
  let a = 1;
  let b = 0;
  const step = 0.25;
  a = approach(a, 0, VAPOR.vortexRise, VAPOR.vortexFall, step);
  b = approach(b, 1, VAPOR.vortexRise, VAPOR.vortexFall, step);
  check("vapor: decay is gentler than onset", 1 - a < b, [1 - a, b]);
  check("vapor: silk needs more provocation than the wingtips", VAPOR.silkBias > 0 && VAPOR.silkBias < 1, VAPOR.silkBias);

  // §28: the ribbon has to shed from the trailing edge of the tip chord. The tip
  // rib spans z 3.74–4.99, so an anchor mid-chord is inside solid wing and the
  // ribbon is born occluded.
  const [wl, wr] = VAPOR.wingtips;
  const tip = VAPOR.tipStation;
  check("vapor: wingtips are mirrored about the centreline", wl.position.x === -wr.position.x && wl.position.z === wr.position.z);
  // §15: the anchor has to lie on the wing surface AT ITS OWN spanwise station,
  // not inside an inboard slice's chord and not in free air behind the tip.
  check("vapor: the anchor sits at the anchor's own tip station", Math.abs(Math.abs(wr.position.x) - tip.x) < 1e-9, wr.position.x);
  check("vapor: the vortex sheds on the tip trailing edge", wr.position.z <= tip.zTrail && wr.position.z > tip.zTrail - VAPOR.ribbonWidth * 0.5, [wr.position.z, tip.zTrail]);
  check("vapor: the anchor is not buried mid-chord", wr.position.z > (tip.zLead + tip.zTrail) / 2, wr.position.z);
}

{
  const rand = seededRandom(ATMOS.seed);
  const first = [rand(), rand(), rand()];
  const again = seededRandom(ATMOS.seed);
  check("clouds: the field is deterministic across runs", [again(), again(), again()].every((v, i) => v === first[i]));
  check("clouds: the generator stays in 0..1", first.every((v) => v >= 0 && v < 1), first);
}

{
  const clusters = [{ x: 0, y: 700, z: -1000, radius: 600, yStretch: 2.2 }];
  check("clouds: the core of a cluster is fully dense", densityAt({ x: 0, y: 700, z: -1000 }, clusters) === 1);
  check("clouds: well outside is clear", densityAt({ x: 0, y: 700, z: 4000 }, clusters) === 0);
  const edge = densityAt({ x: 0, y: 700, z: -1500 }, clusters);
  check("clouds: density falls off toward the edge", edge > 0 && edge < 1, edge);
  // yStretch is what keeps a cluster a flattened bank rather than a sphere.
  check("clouds: vertical extent is compressed", densityAt({ x: 0, y: 900, z: -1000 }, clusters) < densityAt({ x: 200, y: 700, z: -1000 }, clusters));
  const d = distanceToCloud({ x: 0, y: 700, z: 0 }, clusters);
  check("clouds: distance is measured to the cluster surface", Math.abs(d - 400) < 1e-6, d);
  check("clouds: an empty sky is infinitely far from cloud", distanceToCloud({ x: 0, y: 0, z: 0 }, []) === Infinity);
}

{
  // §23: cloud raises moisture, and near-cloud air is moist too.
  check("humidity: clear air well clear of cloud is dry", humidityFor(0, 1e6) === ATMOS.baseHumidity);
  check("humidity: inside cloud the air is saturated", Math.abs(humidityFor(1, -100) - ATMOS.cloudHumidity) < 1e-9);
  const halo = humidityFor(0, ATMOS.proximityRange * 0.3);
  check("humidity: skimming near cloud is moist", halo > ATMOS.baseHumidity && halo < ATMOS.cloudHumidity, halo);
  check("humidity: moisture increases as cloud is approached", humidityFor(0, 700) < humidityFor(0, 200));
  // §28: the halo has to be wide enough that ordinary corridor flying reaches
  // moist air — otherwise the vapor the gates permit is never actually seen —
  // while clear air stays under the vapor gate so the suppression still holds.
  check("humidity: dry clear air still cannot produce vapor", ATMOS.baseHumidity < VAPOR.humidityThreshold, [ATMOS.baseHumidity, VAPOR.humidityThreshold]);
  check("humidity: dry clear air still raises no advisory", ATMOS.baseHumidity < ATMOS.advisory.moistureHumidity);
  // §16: reachability belongs to the intensity curve, not the halo width. The
  // moisture factor saturates at the halo value, so a skim reads at full
  // strength — and the halo can stay thin enough to remain an event.
  check("humidity: the vapor curve saturates at the halo, not at cloud interior", VAPOR.humiditySaturate === ATMOS.proximityHumidity, [VAPOR.humiditySaturate, ATMOS.proximityHumidity]);
  check("humidity: the halo stays thin enough to be an event", ATMOS.proximityRange <= 1600, ATMOS.proximityRange);
  const skim = humidityFor(0, ATMOS.proximityRange * 0.35);
  check("humidity: skimming the halo produces visible wingtip vapor", vaporIntensity(skim, 1) > 0.3, [skim, vaporIntensity(skim, 1)]);
  check("humidity: halo air and cloud interior both saturate the moisture factor", Math.abs(vaporIntensity(ATMOS.proximityHumidity, 1) - vaporIntensity(1, 1)) < 1e-9);
  // The gate itself is unchanged by the recalibration.
  check("humidity: base clear air produces nothing at full load", vaporIntensity(ATMOS.baseHumidity, 1) === 0);
  // The connective claim of §23, stated as a test: a turn that produces nothing
  // in clear air produces vapor at the same load once inside cloud.
  const load = 0.7;
  check(
    "humidity: the same turn is dry outside cloud and wet inside it",
    vaporIntensity(humidityFor(0, 1e6), load) === 0 && vaporIntensity(humidityFor(1, -100), load) > 0
  );
}

{
  check("advisory: clear air shows nothing", advisoryFor(0) === null);
  check("advisory: the edge of cloud reads VISIBLE MOISTURE", advisoryFor(0.1) === "VISIBLE MOISTURE");
  check("advisory: inside cloud reads CLOUD", advisoryFor(0.4) === "CLOUD");
  check("advisory: dense cloud reads LOW VIS", advisoryFor(0.7) === "LOW VIS");
  check("advisory: the densest cloud reads IMC", advisoryFor(1) === "IMC");
  // §24: moist air outside cloud is still worth announcing — that is the air
  // the wingtip vapor will actually appear in.
  check("advisory: the moist halo outside cloud reads VISIBLE MOISTURE", advisoryFor(0, ATMOS.proximityHumidity) === "VISIBLE MOISTURE");
  check("advisory: dry air outside cloud stays silent", advisoryFor(0, ATMOS.baseHumidity) === null);
  check("advisory: density outranks humidity", advisoryFor(0.9, 1) === "IMC");
  // §25: icing was omitted outright, so no threshold can ever produce it.
  const words = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1].map((d) => advisoryFor(d, 1));
  check("advisory: ICING never appears at any density", words.every((w) => w !== "ICING"), words);
}

{
  // Debounce: a clipped wisp must not flash text, and leaving cloud must not
  // clear it instantly.
  const latch = createAdvisoryLatch();
  check("advisory: a single frame in cloud announces nothing", latch.update(0.9, 1 / 60) === null);
  for (let i = 0; i < 60; i++) latch.update(0.9, 1 / 60);
  check("advisory: a held condition is announced", latch.current === "IMC", latch.current);
  latch.update(0, 1 / 60);
  check("advisory: one clear frame does not withdraw it", latch.current === "IMC");
  for (let i = 0; i < 90; i++) latch.update(0, 1 / 60);
  check("advisory: sustained clear air withdraws it", latch.current === null);
  check("advisory: clearing is slower than escalating", ATMOS.advisory.clearDelay > ATMOS.advisory.delay);

  // Flicker across a cluster edge: alternating frames must settle on nothing.
  const l2 = createAdvisoryLatch();
  for (let i = 0; i < 120; i++) l2.update(i % 2 ? 0.9 : 0, 1 / 60);
  check("advisory: an alternating edge does not strobe the HUD", l2.current === null, l2.current);
}

{
  // The field itself: clear corridors must survive generation, and the sprite
  // budget must stay in the range §30 asks for.
  const field = createCloudField();
  check("clouds: both layers are populated", field.clusters.some((c) => c.layer === "low") && field.clusters.some((c) => c.layer === "mid"));
  check("clouds: the field is a modest sprite count, not a particle system", field.report.sprites > 60 && field.report.sprites < 320, field.report.sprites);
  check("clouds: only a few textures are shared across the sky", field.report.textures <= 3, field.report.textures);
  const inBand = field.clusters.filter((c) => ATMOS.clearBands.some(([a, b]) => c.z <= Math.max(a, b) && c.z >= Math.min(a, b)));
  check("clouds: the clear corridors stay clear", inBand.length === 0, inBand.map((c) => c.z));
  const spawn = { x: 0, y: 700, z: 0 };
  check("clouds: the spawn point itself is not inside cloud", densityAt(spawn, field.clusters) < 0.5, densityAt(spawn, field.clusters));
  // Cloud must exist along the course, or none of this is visible in play.
  const ahead = field.clusters.filter((c) => c.z < 0 && c.z > -25000);
  check("clouds: the field covers the flight corridor", ahead.length > 8, ahead.length);
}

/* ================= Stage 03.2 — cannon ================= */

{
  // §3: two weapons, one cycle, and it comes back where it started.
  check("weapon: the cycle is AIM-9 -> GUN -> AIM-9", cycleWeapon(WeaponMode.AIM9) === WeaponMode.GUN && cycleWeapon(WeaponMode.GUN) === WeaponMode.AIM9);
  check("weapon: there are exactly two weapons", Object.keys(WeaponMode).length === 2, Object.keys(WeaponMode));
  // §28: the two weapons have to differ in reach and in magazine, or the choice
  // between them is cosmetic.
  check("weapon: the gun is a close-range weapon next to the AIM-9", GUN.maxRange < TARGETING.maxRange * 0.4, [GUN.maxRange, TARGETING.maxRange]);
  check("weapon: the gun trades reach for rounds", GUN.ammo > WEAPONS.mounts.length * 100, [GUN.ammo, WEAPONS.mounts.length]);
}

{
  // §5: the port is on the RIGHT wing root, above the skin and inboard of the
  // intake — asserted against the measured station, not against the literal.
  const g = WEAPONS.gun;
  const s = g.station;
  check("gun: the muzzle is on the right side of the aircraft", g.position.x > 0, g.position.x);
  check("gun: the muzzle sits at the wing root, inboard of the intake", g.position.x < s.intakeX, [g.position.x, s.intakeX]);
  check("gun: the muzzle is forward of the wing root chord", g.position.z < s.wingRootZ, [g.position.z, s.wingRootZ]);
  // Above the measured skin, or the flash renders inside the fuselage; but only
  // just above it, or the gun stops reading as internal (§5).
  check("gun: the muzzle clears the fuselage skin", g.position.y > s.skinY, [g.position.y, s.skinY]);
  check("gun: the muzzle still reads as internal, not as a pod", g.position.y - s.skinY < 0.25, g.position.y - s.skinY);

  // The anchor is a real child of the hierarchy, so nothing else holds it.
  const root = new THREE.Object3D();
  const set = createWeaponMounts(root, { rails: false });
  check("gun: the muzzle is a weapon-mount anchor", !!set.gunMuzzle && set.gunMuzzle.parent === set.weaponMounts);
  check("gun: the muzzle anchor carries the measured position", set.gunMuzzle.position.equals(WEAPONS.gun.position));
}

{
  // §8: the fire loop is an accumulator, and it must not lose or invent rounds
  // at any frame time.
  const interval = 1 / GUN.shotsPerSecond;
  const a = gunShots(0, 1, interval);
  check("gun: one second of fire is one second of rounds", a.shots === GUN.shotsPerSecond, a.shots);
  check("gun: the accumulator never goes negative", a.rest >= 0 && a.rest < interval, a.rest);
  const short = gunShots(0, interval * 0.4, interval);
  check("gun: a frame shorter than the interval fires nothing yet", short.shots === 0 && short.rest > 0, short);
  // Frame-rate independence, the same claim the flight model makes.
  let fast = 0;
  let acc = 0;
  for (let i = 0; i < 240; i++) {
    const r = gunShots(acc, 1 / 240, interval);
    fast += r.shots;
    acc = r.rest;
  }
  let slow = 0;
  acc = 0;
  for (let i = 0; i < 30; i++) {
    const r = gunShots(acc, 1 / 30, interval);
    slow += r.shots;
    acc = r.rest;
  }
  check("gun: the rate is frame-rate independent", Math.abs(fast - slow) <= 1 && Math.abs(fast - GUN.shotsPerSecond) <= 1, [fast, slow]);
  check("gun: tracers are rarer than rounds", GUN.tracerEvery > 1 && GUN.shotsPerSecond / GUN.tracerEvery < 20, GUN.shotsPerSecond / GUN.tracerEvery);
  // §18: the magazine has to last long enough to practise with.
  check("gun: the magazine is several seconds of fire", GUN.ammo / GUN.shotsPerSecond > 8, GUN.ammo / GUN.shotsPerSecond);
}

{
  // §9: full effect up close, nothing at all past max range, monotonic between.
  check("gun: point blank is full effect", rangeEffect(0) === 1);
  check("gun: the best-range band is full effect", rangeEffect(GUN.bestRange) === 1);
  check("gun: max range is the end of it", rangeEffect(GUN.maxRange) === 0 && rangeEffect(GUN.maxRange + 500) === 0);
  const mid = rangeEffect((GUN.bestRange + GUN.maxRange) / 2);
  check("gun: effect tapers between best and max range", mid > 0 && mid < 1, mid);
  check("gun: effect is monotonic in range", rangeEffect(900) > rangeEffect(1000) && rangeEffect(1000) > rangeEffect(1100));
  check("gun: a round past max range does no damage", gunDamage(GUN.maxRange + 1) === 0);
  // §25: bursts accumulate. One round must be a long way from a kill.
  const hitsToKill = ENEMY.health / gunDamage(400);
  check("gun: no single round kills the target", hitsToKill > 20, hitsToKill);
  // ...but a burst of a second or so does.
  check("gun: a sustained accurate burst kills", hitsToKill < GUN.shotsPerSecond * 1.5, hitsToKill);
}

{
  // §10: hitscan. Straight ahead hits, behind never hits, and the returned
  // distance is the range the damage model is then asked about.
  const o = { x: 0, y: 0, z: 0 };
  const d = { x: 0, y: 0, z: -1 };
  check("gun: a shot down the boresight hits a target ahead", hitscanRange(o, d, { x: 0, y: 0, z: -500 }, GUN.hitRadius) !== null);
  check("gun: the hit distance is the range to the target", Math.abs(hitscanRange(o, d, { x: 0, y: 0, z: -500 }, GUN.hitRadius) - 500) < 1e-9);
  check("gun: a target behind the muzzle is never hit", hitscanRange(o, d, { x: 0, y: 0, z: 500 }, GUN.hitRadius) === null);
  check("gun: a shot wide of the target misses", hitscanRange(o, d, { x: 40, y: 0, z: -500 }, GUN.hitRadius) === null);
  const graze = hitscanRange(o, d, { x: GUN.hitRadius * 0.9, y: 0, z: -500 }, GUN.hitRadius);
  check("gun: a graze inside the hit radius still counts", graze !== null && Math.abs(graze - 500) < 1, graze);
  check("gun: the miss boundary is the hit radius", hitscanRange(o, d, { x: GUN.hitRadius * 1.1, y: 0, z: -300 }, GUN.hitRadius) === null);
}

{
  // §13: the lead solution. The claim worth testing is not the formula, it is
  // that the pipper sits where the rounds go.
  const muzzle = { x: 0, y: 0, z: 0 };
  const tgt = { x: 0, y: 0, z: -600 };
  const own = { x: 0, y: 0, z: -250 };
  // A target on the same heading at the same speed needs no lead at all — the
  // case a target-velocity-only model gets visibly wrong.
  const trail = leadSolution(muzzle, tgt, { x: 0, y: 0, z: -250 }, own, GUN, {});
  check("gun: a co-speed target on the same heading needs no lead", Math.hypot(trail.x - tgt.x, trail.y - tgt.y, trail.z - tgt.z) < 1e-9);
  // A crossing target is led along its own track.
  const cross = leadSolution(muzzle, tgt, { x: 150, y: 0, z: -250 }, own, GUN, {});
  check("gun: a crossing target is led along its velocity", cross.x > tgt.x && Math.abs(cross.z - tgt.z) < 1e-6, [cross.x, cross.z]);
  check("gun: lead time is range over projectile speed", Math.abs(cross.time - 600 / GUN.projectileSpeed) < 1e-9, cross.time);
  // Further away is more lead, because the rounds are in the air longer.
  const far = leadSolution(muzzle, { x: 0, y: 0, z: -1200 }, { x: 150, y: 0, z: -250 }, own, GUN, {});
  check("gun: lead grows with range", far.x > cross.x, [cross.x, far.x]);
  const capped = leadSolution(muzzle, { x: 0, y: 0, z: -1e6 }, { x: 150, y: 0, z: 0 }, null, GUN, {});
  check("gun: lead time is capped", capped.time === GUN.maxLeadTime, capped.time);
  check("gun: the pipper is a prediction, not a lock", GUN.projectileSpeed > 0 && GUN.maxLeadTime < 5);
}

{
  // §24: incremental health, and the kill fires exactly once.
  const t = createTargetDrone();
  check("target: health starts full", t.health === ENEMY.health && t.maxHealth === ENEMY.health);
  check("target: one cannon round does not kill it", damageTarget(t, gunDamage(300)) === false && t.alive === true);
  check("target: a round reduces health", t.health < ENEMY.health, t.health);
  let kills = 0;
  for (let i = 0; i < 200; i++) if (damageTarget(t, gunDamage(300))) kills++;
  check("target: sustained fire destroys it exactly once", kills === 1 && t.alive === false, kills);
  check("target: health never goes below zero", t.health === 0, t.health);
  check("target: a destroyed target ignores further fire", damageTarget(t, 50) === false);
  resetTargetDrone(t);
  check("target: reset restores full health", t.alive && t.health === ENEMY.health);
  // §27: the AIM-9 is unchanged — it does not go through the health pool.
  const m = createTargetDrone();
  markTargetHit(m, 1);
  check("target: a missile hit still destroys outright", m.alive === false && m.health === 0);
}

{
  // The system end to end, in-page: ammo, dry state, pooling, and a burst that
  // actually kills something.
  const scn = new THREE.Scene();
  const mz = new THREE.Object3D();
  mz.position.set(1.6, 0.18, -1.1);
  scn.add(mz);
  const sys = createGunSystem({ scene: scn, muzzle: mz });
  const ctx = {
    armed: true,
    firing: true,
    forward: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    ownVel: new THREE.Vector3(),
    target: null,
  };
  check("gun: visuals are pooled, not allocated per round", sys.tracers.length === GUN.tracerPool && sys.sparks.length === GUN.sparkPool);

  sys.update({ ...ctx, armed: false }, 1 / 60);
  check("gun: an unselected gun does not fire", sys.state.ammo === GUN.ammo && sys.state.firing === false);

  for (let i = 0; i < 60; i++) sys.update(ctx, 1 / 60);
  check("gun: one second of held trigger spends one second of rounds", Math.abs(GUN.ammo - sys.state.ammo - GUN.shotsPerSecond) <= 1, GUN.ammo - sys.state.ammo);
  // Sampled across the burst rather than on one frame: at 60 fps and 48 rps a
  // given frame legitimately fires nothing.
  let freeShots = 0;
  let freeHits = 0;
  let flashPeak = 0;
  for (let i = 0; i < 60; i++) {
    sys.update(ctx, 1 / 60);
    freeShots += sys.state.shots;
    freeHits += sys.state.hits;
    flashPeak = Math.max(flashPeak, sys.flash.material.opacity);
  }
  check("gun: firing with no target is allowed", freeShots > 0 && freeHits === 0, [freeShots, freeHits]);
  const litTracers = sys.tracers.filter((t) => t.live).length;
  check("gun: tracers appear during a burst", litTracers > 0 && litTracers <= GUN.tracerPool, litTracers);
  check("gun: the muzzle flash lights while firing", flashPeak > 0.5, flashPeak);

  // Run the belt dry.
  for (let i = 0; i < 60 * 20; i++) sys.update(ctx, 1 / 60);
  check("gun: ammo stops at zero", sys.state.ammo === 0);
  check("gun: a dry gun fires nothing", sys.state.shots === 0 && sys.state.firing === false);
  check("gun: the dry state is reported", sys.state.dry === true);
  sys.update(ctx, 1 / 60);
  check("gun: a dry gun shows no flash", sys.flash.material.opacity < 0.02, sys.flash.material.opacity);

  sys.reset();
  check("gun: reset reloads and clears the visuals", sys.state.ammo === GUN.ammo && !sys.state.dry && sys.tracers.every((t) => !t.live));

  // A burst on a target 400 m ahead: hits land, health drops, one kill event.
  const victim = createTargetDrone();
  victim.position.set(mz.position.x, mz.position.y, -400);
  victim.velocity.set(0, 0, 0);
  let killEvents = 0;
  sys.on("hit", ({ target, damage }) => damageTarget(target, damage));
  sys.on("kill", () => killEvents++);
  const aimed = { ...ctx, target: victim };
  for (let i = 0; i < 120 && victim.alive; i++) sys.update(aimed, 1 / 60);
  check("gun: aimed fire lands hits", victim.health < ENEMY.health, victim.health);
  check("gun: a sustained burst destroys the target", victim.alive === false);
  check("gun: the kill is announced exactly once", killEvents === 1, killEvents);
  check("gun: the lead solution is published for the HUD", sys.state.lead.range > 0);
  // §16: out past gun range the cue is faded, not shown at full strength.
  victim.alive = true;
  victim.position.set(0, 0, -(GUN.bestRange + GUN.maxRange) / 2);
  sys.update({ ...ctx, firing: false, target: victim }, 1 / 60);
  check("gun: the pipper fades beyond best range", sys.state.rangeEffect > 0 && sys.state.rangeEffect < 1, sys.state.rangeEffect);
  victim.position.set(0, 0, -4000);
  sys.update({ ...ctx, firing: false, target: victim }, 1 / 60);
  check("gun: no lead cue for a target far outside gun range", sys.state.leadValid === false);
}

{
  // §33: the afterburner cleanup, stated as constraints rather than as taste.
  check("engine: the outer plume is a billboard stack, not a second cone", ENGINE_FX.plumeSprites >= 2, ENGINE_FX.plumeSprites);
  check("engine: the plume stays short enough not to foreshorten into a beam", ENGINE_FX.plumeLength <= 3, ENGINE_FX.plumeLength);
  check("engine: the hot core is compact", ENGINE_FX.coreLength < ENGINE_FX.plumeLength);
  // Shock accents are diamonds inside the core, not hoops around it.
  check("engine: the shock accents sit inside the core radius", ENGINE_FX.ringRadius < ENGINE_FX.coreRadius, [ENGINE_FX.ringRadius, ENGINE_FX.coreRadius]);
  check("engine: the shock accents are stretched along the axis", ENGINE_FX.ringStretch > 1.5, ENGINE_FX.ringStretch);
  check("engine: the shock train fits inside the plume", ENGINE_FX.rings * ENGINE_FX.ringSpacing < ENGINE_FX.plumeLength);
}

/* ===== Stage 05.0 — the pointer is a stick again, on different terms ===== */

/**
 * This section replaces 04.0a, which asserted the opposite: that nothing the
 * pointer does can command a bank. That was the right property for that design.
 *
 * The history matters, so it is recorded rather than deleted. Four reports, three
 * stages, six correct fixes, one symptom: "approaching the hostile my fighter
 * dodges right and I never control this." The premise was wrong, not the fixes — a
 * screen position with a *synthesised* centre cannot be a stick, and every fix was
 * manufacturing one missing property of a real stick (a centre, a spring, a
 * detent) out of relative movement.
 *
 * 05.0 does not synthesise a centre. The centre IS the aircraft, fixed at the
 * middle of the viewport, and the cursor is visible on top of it. So the property
 * asserted here is no longer "the pointer cannot steer" but the two things that
 * make steering safe: there is a way to let go, and the keyboard always wins.
 */
{
  const bus = new EventTarget();
  const inp = createInput(bus);
  const move = (x, y) => bus.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: x, clientY: y }));
  const key = (k, down) =>
    bus.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), { key: k, code: "Key" + k.toUpperCase(), repeat: false, preventDefault() {} })
    );
  const run = (n = 30) => {
    for (let i = 0; i < n; i++) inp.update(1 / 60);
  };
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  // An untouched pointer commands nothing: the aircraft does not fly itself
  // before the player has moved their hand.
  run(30);
  check("input: an untouched pointer commands nothing", inp.x === 0 && inp.y === 0, [inp.x, inp.y]);

  // Hovering on the aircraft is how you let go — the property the old design
  // never had, and the reason a parked cursor is now legible rather than a bug.
  move(cx, cy);
  run(10);
  check("input: hovering on the aircraft holds attitude", inp.x === 0 && inp.y === 0, [inp.x, inp.y]);

  // Off-centre steers, and it is meant to.
  move(cx + Math.min(window.innerWidth, window.innerHeight) * 0.4, cy);
  run(10);
  check("input: the pointer right of the aircraft banks right", inp.x > 0.4, inp.x);
  move(cx - Math.min(window.innerWidth, window.innerHeight) * 0.4, cy);
  run(10);
  check("input: and left banks left", inp.x < -0.4, inp.x);

  // Returning to the aircraft stops the turn. This is the whole safety argument:
  // the detent is a real place on screen, not a remembered coordinate.
  move(cx, cy);
  run(10);
  check("input: returning to the aircraft stops the turn", inp.x === 0, inp.x);

  // Leaving the window releases the stick — there is no off-screen deflection.
  move(cx + 400, cy);
  run(5);
  bus.dispatchEvent(new Event("pointerleave"));
  run(5);
  check("input: leaving the window releases the stick", inp.x === 0, inp.x);

  // The keyboard overrides a resting cursor, in both directions, so a player who
  // never touches the mouse is never fighting it.
  move(cx + Math.min(window.innerWidth, window.innerHeight) * 0.2, cy);
  run(10);
  const pointerOnly = inp.x;
  key("a", true);
  run(40);
  check("input: a held key overrides a deflected pointer", inp.x < 0 && inp.x < pointerOnly, [pointerOnly, inp.x]);
  key("a", false);
  run(60);
  check("input: releasing the key hands the axis back to the pointer", inp.x > 0, inp.x);

  // The mouse keeps the job it always had.
  bus.dispatchEvent(Object.assign(new Event("pointerdown"), { button: 0 }));
  inp.update(1 / 60);
  check("input: the left button is still the trigger", inp.trigger === true && inp.takeFire() === true);
  bus.dispatchEvent(new Event("pointerup"));
  inp.update(1 / 60);
  check("input: and releasing it stops the gun", inp.trigger === false);
  check("input: the trigger latch is one-shot", inp.takeFire() === false);

  // Steering can be switched off wholesale for the launch script and the crash.
  // Tolerance rather than equality: the keyboard axis decays asymptotically, so a
  // residual from the key press above never reaches exactly zero.
  inp.setPointerEnabled(false);
  move(cx + 400, cy);
  run(10);
  check("input: pointer steering can be disabled outright", Math.abs(inp.x) < 0.01, inp.x);
  inp.setPointerEnabled(true);

  // Space is still a discrete request, leaning off whatever the stick is doing.
  bus.dispatchEvent(Object.assign(new Event("keydown"), { key: " ", code: "Space", repeat: false, preventDefault() {} }));
  check("input: Space still requests a roll", inp.takeRoll() !== 0);
  check("input: and it is consumed", inp.takeRoll() === 0);
}

/* ===== Stage 04.1 — automatic rearm, music moods, defensive break ===== */

/* ---- §13: rearm ---- */
{
  // The rule that matters: the timer starts at EMPTY, not on the first shot.
  // Starting it on a shot would let a player fire one AIM-9, wait, and be handed
  // a third round — the loadout would stop meaning anything.
  let magazine = 2;
  let rearms = 0;
  const t = createRearmTimer({
    cooldown: 20,
    isEmpty: () => magazine === 0,
    refill: () => (magazine = 2),
    onRearm: () => (rearms += 1),
  });

  magazine = 1;
  for (let i = 0; i < 60 * 40; i++) t.update(1 / 60);
  check("rearm: a partly-spent magazine never starts a timer", !t.state.running && magazine === 1 && rearms === 0, [t.state.running, magazine]);

  magazine = 0;
  t.update(1 / 60);
  check("rearm: reaching empty starts it", t.state.running && t.state.remaining > 19, t.state.remaining);
  for (let i = 0; i < 60 * 10; i++) t.update(1 / 60);
  check("rearm: it is still empty halfway through", magazine === 0 && t.state.remaining > 9 && t.state.remaining < 11, t.state.remaining);
  check("rearm: progress is readable", t.progress > 0.45 && t.progress < 0.55, t.progress);
  for (let i = 0; i < 60 * 11; i++) t.update(1 / 60);
  check("rearm: the cooldown refills the magazine exactly once", magazine === 2 && rearms === 1 && !t.state.running, [magazine, rearms]);
  for (let i = 0; i < 60 * 60; i++) t.update(1 / 60);
  check("rearm: and does not keep firing", rearms === 1, rearms);

  // A checkpoint restore or a mission restart puts rounds back directly; a timer
  // left running would refill an already-full magazine later.
  magazine = 0;
  t.update(1 / 60);
  check("rearm: running again after a second empty", t.state.running);
  magazine = 2;
  t.update(1 / 60);
  check("rearm: an external refill cancels the cycle", !t.state.running && t.state.remaining === 0);
  check("rearm: the cooldown is 20 s (§13)", REARM.cooldown === 20, REARM.cooldown);
}

{
  // Both weapons, independent timers (§13): one is always coming back while the
  // other is out, so the player is never disarmed outright.
  const rounds = { count: 0, reload() { this.count = 2; } };
  const gun = { cfg: { ammo: 500 }, state: { ammo: 250, dry: false } };
  const labels = [];
  const sys = createRearmSystem({ rounds, gun, onRearm: (l) => labels.push(l) });

  sys.update(1 / 60);
  check("rearm: only the empty weapon has a timer", sys.aim9.state.running && !sys.cannon.state.running);
  check("rearm: the pending line names it", sys.pending && sys.pending.label === "AIM-9", sys.pending);
  // Five seconds later the gun runs dry too — a real engagement empties them at
  // different moments, and the timers have to stay that far apart.
  for (let i = 0; i < 60 * 5; i++) sys.update(1 / 60);
  gun.state.ammo = 0;
  sys.update(1 / 60);
  check("rearm: the two timers are independent", sys.cannon.state.remaining - sys.aim9.state.remaining > 4.5, [sys.aim9.state.remaining, sys.cannon.state.remaining]);
  check("rearm: pending reports the soonest", sys.pending.label === "AIM-9", sys.pending.label);
  for (let i = 0; i < 60 * 16; i++) sys.update(1 / 60);
  check("rearm: AIM-9 came back first", rounds.count === 2 && gun.state.ammo === 0, [rounds.count, gun.state.ammo]);
  for (let i = 0; i < 60 * 6; i++) sys.update(1 / 60);
  check("rearm: then the gun, to full", gun.state.ammo === 500 && !gun.state.dry, [gun.state.ammo, gun.state.dry]);
  check("rearm: each announced itself once", JSON.stringify(labels) === JSON.stringify(["AIM-9", "GUN"]), labels);

  rounds.count = 0;
  sys.update(1 / 60);
  sys.reset();
  check("rearm: reset clears a running cycle", !sys.aim9.state.running && sys.pending === null);
}

{
  // §04.7 — the respawn clearance rule. This exists because a restore put the
  // player back inside a hillside and the crash then repeated forever: the
  // capture-time lift measured the ground BELOW the capture point, which says
  // nothing about what the aircraft is pointed at.
  const flat = () => 0;
  const at = { x: 0, y: 0, z: 0 };
  check("spawn: over flat ground it is the plain clearance", safeSpawnAltitude(at, 0, flat) === MISSION.route.terrainClearance, safeSpawnAltitude(at, 0, flat));
  // §04.7c — a caller can ask for more clearance than a nav anchor uses, which is
  // what the escalating respawn does after a failure.
  check("spawn: the clearance is a caller decision", safeSpawnAltitude(at, 0, flat, MISSION, 460) === 460);

  // A ridge 600 m high, 1.2 km AHEAD along heading 0 (which is -Z).
  const ridgeAhead = (x, z) => (z < -900 && z > -1500 ? 600 : 0);  const lifted = safeSpawnAltitude(at, 0, ridgeAhead);
  check("spawn: ground ahead raises the spawn above it", lifted >= 600 + MISSION.route.terrainClearance, lifted);
  // ...and the SAME position facing away from it does not need the altitude, which
  // is what makes this a corridor test rather than a radius.
  check("spawn: facing away from the ridge needs no lift", safeSpawnAltitude(at, Math.PI, ridgeAhead) < lifted, safeSpawnAltitude(at, Math.PI, ridgeAhead));

  // Ground the aircraft is sitting inside is caught by the d = 0 sample.
  const inside = (x, z) => 800;
  check("spawn: ground at the spawn point itself is caught", safeSpawnAltitude(at, 0, inside) >= 800 + MISSION.route.terrainClearance);

  // No terrain index: still a floor, never zero or NaN.
  check("spawn: with no sampler there is still a floor", safeSpawnAltitude(at, 0, null) === MISSION.route.minTerrainAltitude);
  check("spawn: an all-ocean corridor falls back to the floor", safeSpawnAltitude(at, 0, () => NaN) === MISSION.route.minTerrainAltitude);
  // The look-ahead has to be long enough to matter at cruise — under a kilometre
  // would clear the hillside and still fly into the next one.
  check("spawn: it looks far enough ahead to be worth checking", MISSION.route.spawnLookAhead >= 2000, MISSION.route.spawnLookAhead);
}

/* ===== Stage 04.7 — procedural crash presentation ===== */
{
  // §1 — causes are mapped from the reason string the failure policy ALREADY
  // carries, in one place, so a new failure reason cannot silently inherit the
  // wrong explosion.
  check("crash: the three gameplay causes map to variants", causeFromReason("OCEAN IMPACT") === CrashCause.OCEAN && causeFromReason("TERRAIN IMPACT") === CrashCause.TERRAIN && causeFromReason("MISSILE HIT") === CrashCause.MISSILE);
  check("crash: an unknown reason still gets a presentation", causeFromReason("???") === CrashCause.MISSILE && causeFromReason(null) === CrashCause.MISSILE);
  check("crash: every cause has a full variant row", Object.keys(CrashCause).every((c) => { const v = CRASH_VARIANT[c]; return v && typeof v.fire === "number" && typeof v.smoke === "number" && typeof v.sink === "number" && !!v.screen; }));
  // §24/§43 — water is not a small orange explosion: less fire, more mist, and it
  // sinks fast so the aircraft cannot be seen flying along under the surface.
  check("crash: the ocean variant is mist, not fireball", CRASH_VARIANT.OCEAN.mist > CRASH_VARIANT.MISSILE.mist && CRASH_VARIANT.OCEAN.fire < CRASH_VARIANT.MISSILE.fire * 0.5);
  check("crash: and it does not keep flying", CRASH_VARIANT.OCEAN.sink > CRASH_VARIANT.MISSILE.sink && CRASH_VARIANT.OCEAN.forward < 0.3, [CRASH_VARIANT.OCEAN.sink, CRASH_VARIANT.OCEAN.forward]);
  // §43 — and it must be hidden sooner than a midair kill, because an aircraft
  // visible under the water surface is the specific failure the brief names.
  check("crash: water hides the aircraft soonest", CRASH_VARIANT.OCEAN.visible < CRASH_VARIANT.TERRAIN.visible && CRASH_VARIANT.TERRAIN.visible < CRASH_VARIANT.MISSILE.visible);
  // §22 — a missile kill happens around the aircraft, so it keeps its momentum.
  check("crash: a missile hit retains full forward momentum", CRASH_VARIANT.MISSILE.forward === 1);
  check("crash: a terrain hit loses most of it", CRASH_VARIANT.TERRAIN.forward < 0.5, CRASH_VARIANT.TERRAIN.forward);

  // §3 — the whole thing is about two seconds, and the beats are ordered.
  const total = MISSION_FAILURE.hold + MISSION_FAILURE.fadeOut + MISSION_FAILURE.fadeIn;
  check("crash: impact to playable is about two seconds", total > 1.8 && total < 2.6, total);
  check("crash: the crash is visible before the fade starts", MISSION_FAILURE.hold > CRASH.aircraftVisible, [MISSION_FAILURE.hold, CRASH.aircraftVisible]);
  check("crash: the layers arrive in order (§3)", CRASH.flashAt < CRASH.fireballAt && CRASH.fireballAt < CRASH.tumbleAt && CRASH.tumbleAt < CRASH.smokeFrom && CRASH.smokeFrom < CRASH.sparksAt);
  check("crash: smoke stops emitting before the fade completes", CRASH.smokeUntil <= MISSION_FAILURE.hold, [CRASH.smokeUntil, MISSION_FAILURE.hold]);
  check("crash: the budget stays small (§40)", CRASH.debrisCount <= 6 && CRASH.sparkCount <= 30 && CRASH.fireballCount <= 6);

  // §6 — the aircraft is NOT hidden on the frame it dies.
  check("crash: the intact aircraft stays visible at first", aircraftOpacity(0) === 1 && aircraftOpacity(CRASH.aircraftVisible) === 1);
  check("crash: for the half-second the brief asks for", CRASH.aircraftVisible >= 0.5 && CRASH.aircraftVisible <= 0.8, CRASH.aircraftVisible);
  check("crash: then it fades rather than popping", aircraftOpacity(CRASH.aircraftVisible + CRASH.aircraftFade * 0.5) > 0.2 && aircraftOpacity(CRASH.aircraftVisible + CRASH.aircraftFade * 0.5) < 0.8);
  check("crash: and is gone before the fade to black", aircraftOpacity(CRASH.aircraftVisible + CRASH.aircraftFade) === 0);

  // §26/§28 — one kick, fast decay. Not sustained shake.
  check("crash: no kick before the impact frame", kickAmplitude(0) === 0);
  check("crash: it peaks at the impact", kickAmplitude(CRASH.flashAt) > 1.5, kickAmplitude(CRASH.flashAt));
  check("crash: and decays fast rather than shaking on", kickAmplitude(0.6) < kickAmplitude(CRASH.flashAt) * 0.1, kickAmplitude(0.6));
  check("crash: it is over well before the respawn", kickAmplitude(1.2) < 0.01, kickAmplitude(1.2));

  // §30 — a brief flash, not a blinding one.
  check("crash: the screen flash is instant and short", screenFlashAlpha(0) === 1 && screenFlashAlpha(CRASH.screenFlash) === 0 && CRASH.screenFlash < 0.15);

  // §27 — the camera loosens, holds, and is handed back rather than snapping.
  check("crash: the crash camera blends in", followBlend(0) === 0 && followBlend(0.12) === 1);
  check("crash: holds through the tumble", followBlend(CRASH.followTime * 0.8) === 1);
  check("crash: then releases the rig", followBlend(CRASH.followTime + 0.31) === 0);
  check("crash: for the ~1 s the brief asks for", CRASH.followTime >= 0.8 && CRASH.followTime <= 1.2, CRASH.followTime);

  // §7/§35 — bounded randomness, generated once. Roll dominates, which is what
  // makes a tumble read as a tumble rather than a wobble.
  const spins = Array.from({ length: 60 }, () => makeTumble());
  check("crash: tumble roll stays inside its bounds", spins.every((s) => Math.abs(s.roll) >= CRASH.tumbleRoll[0] && Math.abs(s.roll) <= CRASH.tumbleRoll[1]));
  check("crash: it goes both ways", new Set(spins.map((s) => Math.sign(s.roll))).size === 2);
  check("crash: and roll dominates the other axes", spins.every((s) => Math.abs(s.roll) > Math.abs(s.pitch)));
}

{
  // The sequence, headless and deterministic — the browser throttles rAF in a
  // background frame, so this is the only honest way to check the timing.
  const V = (x, y, z) => ({
    x, y, z,
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; },
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; },
    length() { return Math.hypot(this.x, this.y, this.z); },
  });
  const fx = createCrashFx({});
  fx.start({ cause: CrashCause.MISSILE, position: V(0, 900, -9000), velocity: V(0, 0, -220) });
  check("sequence: it starts once", fx.state.active && fx.state.crashes === 1);
  // §8 — the aircraft does not stop in midair.
  check("sequence: pre-impact momentum is inherited", fx.velocity.length() > 150, fx.velocity.length());

  const startY = fx.pose.position.y;
  const startZ = fx.pose.position.z;
  for (let i = 0; i < 30; i++) fx.update(1 / 60);
  check("sequence: it keeps travelling forward", Math.abs(fx.pose.position.z - startZ) > 60, fx.pose.position.z - startZ);
  // §9 — gravity, so it visibly drops while continuing forward.
  check("sequence: and starts to fall", fx.pose.position.y < startY, [startY, fx.pose.position.y]);
  check("sequence: the aircraft is still visible at 0.5 s (§6)", fx.pose.opacity === 1, fx.pose.opacity);

  for (let i = 0; i < 36; i++) fx.update(1 / 60);
  check("sequence: hidden behind its own smoke by 1.1 s", fx.pose.opacity < 0.05, fx.pose.opacity);

  // §31 — the policy owns the fade; the presentation just stops driving.
  fx.finish();
  check("sequence: finishing releases the aircraft", !fx.state.active && fx.pose.opacity === 1);

  // §47 — nothing of the old crash survives.
  fx.reset();
  check("sequence: reset clears the clock and every entity", fx.state.t === 0 && fx.liveCount === 0 && !fx.state.active);

  // §44 — a maximum-speed crash must not fling the aircraft somewhere absurd.
  const fast = createCrashFx({});
  fast.start({ cause: CrashCause.MISSILE, position: V(0, 1200, 0), velocity: V(0, 0, -250) });
  for (let i = 0; i < 72; i++) fast.update(1 / 60);
  const travelled = Math.abs(fast.pose.position.z);
  check("sequence: a 250 m/s crash travels a believable distance", travelled > 150 && travelled < 400, travelled);

  // §43 — water: it must not be seen flying along under the surface.
  const wet = createCrashFx({});
  wet.start({ cause: CrashCause.OCEAN, position: V(0, 4, 0), velocity: V(0, 0, -220) });
  for (let i = 0; i < 42; i++) wet.update(1 / 60);
  check("sequence: an ocean crash sinks rather than cruising on", wet.pose.position.y < -8 && Math.abs(wet.pose.position.z) < 120, [wet.pose.position.y, wet.pose.position.z]);
  check("sequence: and is hidden by the time it is under", wet.pose.opacity < 0.05, wet.pose.opacity);
}

{
  // §46/§33 — ONE crash sequence, however many things hit at once. This is the
  // guarantee that a tumbling aircraft grinding through terrain cannot produce
  // BOOM BOOM BOOM, and it belongs to the response policy rather than to the
  // presentation — which is exactly why no new state machine was added.
  const policy = createMissionCheckpointResponse({});
  check("duplicate: the first destruction is accepted", policy.trigger("MISSILE HIT") === true);
  check("duplicate: a simultaneous terrain hit is refused", policy.trigger("TERRAIN IMPACT") === false);
  let refused = 0;
  let attempts = 0;
  for (let i = 0; i < 60 * 1.1; i++) {
    policy.tick(1 / 60);
    attempts += 1;
    if (policy.trigger("TERRAIN IMPACT") === false) refused += 1;
  }
  check("duplicate: refused on every frame of the crash window", refused === attempts, [refused, attempts]);
  check("duplicate: only one sequence ran", policy.state.count === 1, policy.state.count);
}

/* ===== Stage 04.5 — the audio director ===== */

{
  // No music, by design: every sound is diegetic and almost every one is
  // information. That makes the mix a PRIORITY problem, which is what these
  // checks are about.
  check("audio: warnings outrank the machinery", AUDIO.cues.MISSILE.priority > AUDIO.cues.GUN.priority && AUDIO.cues.LOCK.priority > AUDIO.cues.ENGINE_LOOP.priority);
  check("audio: the missile warning is the loudest thing in the build", Object.values(AUDIO.cues).every((c) => c.volume <= AUDIO.cues.MISSILE.volume));
  check("audio: PULL UP is as urgent as an inbound missile", AUDIO.cues.PULL_UP.priority === Priority.CRITICAL);
  check("audio: only the engine and the gun loop", Object.keys(AUDIO.cues).filter((k) => AUDIO.cues[k].loop).sort().join() === "ENGINE_LOOP,GUN");
  check("audio: every repeated cue has an anti-spam floor", Object.keys(AUDIO.cues).every((k) => AUDIO.cues[k].loop || AUDIO.cues[k].minInterval > 0));
  check("audio: the supplied alternate takes are all used", AUDIO.cues.LOCK.takes.length === 3 && AUDIO.cues.MISSILE.takes.length === 2);
  // 04.6 — the player's own launch and its result are WEAPON, not WARNING: they
  // confirm something the player did and must never mask an incoming call.
  check("audio: the player's own launch cannot mask an inbound warning", AUDIO.cues.MISSILE_LAUNCH.priority < AUDIO.cues.MISSILE.priority && AUDIO.cues.MISSILE_HIT.priority < AUDIO.cues.MISSILE.priority);
  check("audio: the fly-by is atmosphere, not information", AUDIO.cues.FLYBY.priority === Priority.AMBIENT);
  check("audio: and it does not repeat every pass of a circling hostile", AUDIO.cues.FLYBY.minInterval >= 3, AUDIO.cues.FLYBY.minInterval);
  check("audio: eleven cues for eleven recordings", Object.keys(AUDIO.cues).length === 11, Object.keys(AUDIO.cues).length);

  // Fly-by: once per PASS, not once per frame, and only when something actually
  // went past fast.
  check("flyby: a fast close pass fires", flybyTriggered(200, 400, 1 / 60));
  check("flyby: it needs to have crossed the threshold this frame", !flybyTriggered(200, 300, 1 / 60), "prev was already inside");
  check("flyby: a slow drift past is not a fly-by", !flybyTriggered(300, 340, 1));
  check("flyby: nothing at long range", !flybyTriggered(900, 2000, 1 / 60));
  check("flyby: a missing reading is not a fly-by", !flybyTriggered(NaN, 400, 1 / 60) && !flybyTriggered(200, Infinity, 1 / 60));

  // Rotation, not random: with three takes a round-robin is provably never twice
  // in a row, which is what stops a held lock sounding like a skipping record.
  check("audio: takes rotate", [0, 1, 2, 3, 4].map((n) => takeIndex(n, 3)).join() === "0,1,2,0,1");
  check("audio: and never repeat consecutively", [0, 1, 2, 3, 4, 5].every((n) => takeIndex(n, 3) !== takeIndex(n + 1, 3)));
  check("audio: a single-take cue is always take zero", takeIndex(9, 1) === 0);

  check("audio: the interval floor is what mayFire enforces", !mayFire(Cue.MISSILE, 0) && mayFire(Cue.MISSILE, AUDIO.cues.MISSILE.minInterval));
  check("audio: an unknown cue never fires", !mayFire("NOPE", 999));

  // The engine is the only continuous sound, and it follows the lever.
  const idle = engineVoice(0, false);
  const full = engineVoice(1, false);
  const ab = engineVoice(1, true);
  check("audio: the engine is quiet at idle and loud at full", idle.volume < full.volume && idle.volume > 0, [idle.volume, full.volume]);
  check("audio: and it pitches up with the lever", full.rate > idle.rate, [idle.rate, full.rate]);
  check("audio: the afterburner is audibly more than full military", ab.volume > full.volume);
  check("audio: gain never exceeds unity", ab.volume <= 1, ab.volume);
}

{
  // Ground proximity: two levels, because the two supplied recordings are two
  // different statements. Conflating them would waste the more urgent one.
  check("ground: high and level is quiet", groundWarning({ agl: 900, sink: 0 }) === null);
  check("ground: low AND SINKING says ALTITUDE", groundWarning({ agl: AUDIO.altitudeAgl - 10, sink: 5 }) === Cue.ALTITUDE, groundWarning({ agl: AUDIO.altitudeAgl - 10, sink: 5 }));
  check("ground: very low AND descending says PULL UP", groundWarning({ agl: 100, sink: 20 }) === Cue.PULL_UP);
  // Low and LEVEL is legitimate flying and must be silent: the terrain leg is
  // flown that way on purpose, and a height-only ALTITUDE fired every few
  // seconds for the whole sortie -- which also held the engine down, because
  // every firing ducked the ambient channels.
  check("ground: very low but not descending is SILENT", groundWarning({ agl: 100, sink: 0 }) === null, groundWarning({ agl: 100, sink: 0 }));
  check("ground: low and gently descending is ALTITUDE", groundWarning({ agl: 200, sink: 6 }) === Cue.ALTITUDE, groundWarning({ agl: 200, sink: 6 }));
  // ...and the case it catches: something in FRONT, not merely below.
  check("ground: an imminent forward hazard says PULL UP at any height", groundWarning({ agl: 4000, sink: 0, forwardImminent: true }) === Cue.PULL_UP);
  check("ground: PULL UP outranks ALTITUDE", groundWarning({ agl: 10, sink: 40, forwardImminent: true }) === Cue.PULL_UP);
  check("ground: no terrain reading is no warning", groundWarning({ agl: NaN, sink: 40 }) === null);
  check("ground: the ALTITUDE threshold is AGL, so the ocean is quiet at cruise", AUDIO.altitudeAgl < 400 && groundWarning({ agl: 700, sink: 0 }) === null);

  /* ---- the water floor ---- */
  // Over open sea the time-to-impact rule has nothing to divide by in level
  // flight and nothing ahead to sample, so height is the only available cue.
  check("sea floor: level flight below 90 m over water is a PULL UP", groundWarning({ agl: 60, sink: 0, overWater: true }) === Cue.PULL_UP, groundWarning({ agl: 60, sink: 0, overWater: true }));
  check("sea floor: right at the floor still warns", groundWarning({ agl: AUDIO.seaFloor, sink: 0, overWater: true }) === Cue.PULL_UP);
  check("sea floor: above it, level flight over water is silent", groundWarning({ agl: AUDIO.seaFloor + 30, sink: 0, overWater: true }) === null, groundWarning({ agl: AUDIO.seaFloor + 30, sink: 0, overWater: true }));
  // WATER ONLY. Over terrain this would fire continuously through the whole
  // low-level corridor, which is the nagging-cue failure ALTITUDE was fixed for.
  check("sea floor: the same height over LAND is not a pull-up", groundWarning({ agl: 60, sink: 0, overWater: false }) === null, groundWarning({ agl: 60, sink: 0, overWater: false }));
  check("sea floor: it leaves room to recover at full speed", AUDIO.seaFloor >= 70 && AUDIO.seaFloor <= 150, AUDIO.seaFloor);
  // A descent over water still reaches PULL UP the ordinary way, earlier.
  check("sea floor: a dive toward the sea still warns above the floor", groundWarning({ agl: 300, sink: 40, overWater: true }) === Cue.PULL_UP);
  check("ground: PULL UP is expressed in seconds, not metres", AUDIO.pullUpSeconds > 0 && AUDIO.pullUpAgl === undefined);
}

{
  // The director, driven with stubs that record what played.
  const made = [];
  const stub = (src, loop) => {
    const el = {
      src,
      loop: !!loop,
      volume: 0,
      currentTime: 0,
      playbackRate: 1,
      paused: true,
      plays: 0,
      readyState: 4,
      play() {
        this.paused = false;
        this.plays += 1;
      },
      pause() {
        this.paused = true;
      },
    };
    made.push(el);
    return el;
  };
  const a = createAudioDirector({ audioFactory: stub });

  // Autoplay: nothing sounds before a user gesture, however many cues are asked.
  check("director: nothing plays before a gesture", a.play(Cue.MISSILE) === false && a.state.plays === 0);
  a.arm();
  check("director: the first gesture arms it", a.state.armed === true);
  check("director: then a cue plays", a.play(Cue.MISSILE) === true && a.state.plays === 1);

  // Anti-spam: a sustained threat asks every frame and must not stutter.
  let suppressed = 0;
  for (let i = 0; i < 60; i++) {
    if (!a.play(Cue.MISSILE)) suppressed += 1;
    a.update(1 / 60);
  }
  check("director: a cue asked every frame fires once", a.state.plays === 1 && suppressed === 60, [a.state.plays, suppressed]);
  for (let i = 0; i < 60 * AUDIO.cues.MISSILE.minInterval; i++) a.update(1 / 60);
  check("director: and again once its interval has passed", a.play(Cue.MISSILE) === true, a.state.plays);

  // Ducking: a warning pushes the machinery down, and a warning never ducks
  // another warning — two things telling you something is not the problem.
  a.loop(Cue.GUN, true);
  const gunEl = a.channels.GUN.voices[0][0];
  const loudGun = gunEl.volume;
  a.play(Cue.PULL_UP);
  a.update(1 / 60);
  a.loop(Cue.GUN, true);
  check("director: a critical warning ducks the cannon", gunEl.volume < loudGun, [loudGun, gunEl.volume]);
  for (let i = 0; i < 60 * 3; i++) a.update(1 / 60);
  a.loop(Cue.GUN, true);
  check("director: and the cannon comes back afterwards", Math.abs(gunEl.volume - loudGun) < 1e-9, [gunEl.volume, loudGun]);

  // A forced cue ignores the floor: the player pressed a button, and silence
  // reads as a broken control.
  a.play(Cue.FLARES);
  const before = a.state.plays;
  check("director: a forced cue ignores the interval", a.play(Cue.FLARES, { force: true }) === true && a.state.plays === before + 1);

  // Loops are idempotent, so calling them every frame is safe.
  const engine = a.channels.ENGINE_LOOP.voices[0][0];
  for (let i = 0; i < 10; i++) a.loop(Cue.ENGINE_LOOP, true, { volume: 0.5, rate: 1.05 });
  check("director: a loop started ten times has started once", engine.plays === 1, engine.plays);
  check("director: and takes its gain and pitch", engine.volume > 0 && engine.playbackRate === 1.05);
  a.loop(Cue.ENGINE_LOOP, false);
  check("director: stopping a loop pauses it", engine.paused === true);

  // Mute is a mix decision; reset is a transport one.
  a.setMuted(true);
  check("director: mute stops cues sounding", a.play(Cue.LOCK, { force: true }) === false);
  a.toggleMute();
  check("director: and unmute restores them", a.play(Cue.LOCK, { force: true }) === true);
  a.reset();
  check("director: reset clears the intervals so a restart is not silent", a.play(Cue.LOCK) === true);
  check("director: and drops the ducking", a.state.duck === 1);

  check("director: a loop cue is not a one-shot", a.play(Cue.ENGINE_LOOP) === false);
  check("director: a one-shot is not a loop", a.loop(Cue.MISSILE, true) === false);
  // 04.6 — a one-shot has to be stoppable: the deck spool is cut the instant the
  // catapult fires, because that is where the engine LOOP takes over.
  const startEl = a.channels.ENGINE_START.voices[0][0];
  a.play(Cue.ENGINE_START, { force: true });
  check("director: a one-shot plays", startEl.paused === false);
  a.stop(Cue.ENGINE_START);
  check("director: and can be cut short", startEl.paused === true);
  check("director: stopping an unknown cue is harmless", a.stop("NOPE") === false);
  check("director: it reports what resolved", a.report.available.MISSILE === true && a.report.silent === false);
}

{
  // A build with no audio files at all has to be playable — which is also how
  // this one was developed.
  const silent = createAudioDirector({ audioFactory: () => null });
  silent.arm();
  check("director: a build with no audio is silent, not broken", silent.state.silent === true && silent.report.silent === true);
  check("director: every cue simply declines", Object.keys(AUDIO.cues).every((c) => silent.play(c) === false || AUDIO.cues[c].loop));
  check("director: and the loops decline too", silent.loop(Cue.ENGINE_LOOP, true) === false);
  for (let i = 0; i < 120; i++) silent.update(1 / 60);
  check("director: updating a silent director is a no-op", silent.state.plays === 0);
}

/* ---- §15: the defensive break ---- */
{
  const S = HostileState;
  const T = (phase, over = {}, ctx = {}) =>
    hostileTransition(
      { phase, ammo: 2, cooldown: 0, timer: 1, lockProgress: 0, launched: false, defendReady: false, ...over },
      { alive: true, playerAlive: true, ready: true, range: 1200, inCone: false, ...ctx }
    );

  check("defend: a completed lock outranks looking for a shot", T(S.PURSUIT, { defendReady: true }, { inCone: true }) === S.DEFEND);
  check("defend: it abandons its own acquisition", T(S.ACQUIRE, { defendReady: true, lockProgress: 0.8 }) === S.DEFEND);
  check("defend: and interrupts a reposition", T(S.REPOSITION, { defendReady: true }) === S.DEFEND);
  // A shot 0.55 s from launching must not be talked out of it, or the hostile
  // would never land one.
  check("defend: but never interrupts a committed attack", T(S.ATTACK, { defendReady: true }) === S.ATTACK);
  check("defend: it is a fixed duration, then back to pursuit", T(S.DEFEND, { timer: 1 }) === S.DEFEND && T(S.DEFEND, { timer: 0 }) === S.PURSUIT);
  check("defend: death still wins", hostileTransition({ phase: S.DEFEND, timer: 1, defendReady: true }, { alive: false }) === S.DESTROYED);
  check("defend: a defensive break is slower than an attack run", phaseSpeed(S.DEFEND) === HOSTILE.speed.reposition);

  check("defend: the reaction delay leaves room for the player's shot (§15)", HOSTILE.defend.reaction >= 0.6 && HOSTILE.defend.reaction <= 1.5, HOSTILE.defend.reaction);
  check("defend: the break turns harder than a normal manoeuvre", HOSTILE.defend.rateScale > 1.5, HOSTILE.defend.rateScale);
  check("defend: and it cannot be looped indefinitely", HOSTILE.defend.cooldown > HOSTILE.defend.time, [HOSTILE.defend.cooldown, HOSTILE.defend.time]);

  check("defend: the break turns away from the player's line of sight", breakDirection({ x: 0, y: 0, z: 0 }, { x: 400, y: 0, z: -400 }, 0) === -breakDirection({ x: 0, y: 0, z: 0 }, { x: -400, y: 0, z: -400 }, 0));
}

{
  // End to end: a held lock provokes exactly one break, after the delay, and the
  // hostile is shootable again afterwards rather than evading forever.
  //
  // Deployed with ammo 0 on purpose. With rounds it runs its own attack cycle,
  // and ATTACK/COOLDOWN legitimately refuse to be interrupted (a shot 0.55 s
  // from launch must not be talked out of it) — which is correct behaviour that
  // makes the timing of the break depend on where in that cycle the lock lands.
  // Isolating the reaction means testing the reaction.
  const drone = createTargetDrone();
  const ai = createHostileAI({ drone });
  ai.deploy({ at: { x: 0, y: 800, z: -1800 }, heading: Math.PI, ammo: 0, engageDelay: 0 });
  const player = { position: { x: 0, y: 800, z: 0 }, velocity: { x: 0, y: 0, z: -220 }, alive: true, locked: false };

  for (let i = 0; i < 120; i++) ai.update(player, 1 / 60);
  check("defend: an unlocked hostile does not break", ai.state.phase !== HostileState.DEFEND && ai.state.defends === 0, ai.state.phase);

  // A lock that breaks before the reaction delay provokes nothing: a fleeting
  // lock is not a threat the hostile should be able to see.
  player.locked = true;
  for (let i = 0; i < 30; i++) ai.update(player, 1 / 60); // 0.5 s, under 0.9
  player.locked = false;
  ai.update(player, 1 / 60);
  check("defend: a fleeting lock provokes nothing", ai.state.defends === 0 && ai.state.defendCue === 0, [ai.state.defends, ai.state.defendCue]);

  player.locked = true;
  let brokeAt = -1;
  for (let i = 0; i < 90; i++) {
    ai.update(player, 1 / 60);
    if (ai.state.phase === HostileState.DEFEND && brokeAt < 0) brokeAt = i / 60;
  }
  check("defend: a held lock provokes a break after the reaction delay", brokeAt >= HOSTILE.defend.reaction - 0.05 && brokeAt <= HOSTILE.defend.reaction + 0.1, brokeAt);
  check("defend: exactly one", ai.state.defends === 1, ai.state.defends);

  // It flies through the break and comes back, and the sustained lock cannot
  // chain a second one until the cooldown is up.
  const heading0 = drone.heading;
  for (let i = 0; i < 60 * 3; i++) ai.update(player, 1 / 60);
  check("defend: the break actually changes its heading", Math.abs(wrapPi(drone.heading - heading0)) > 20 * DEG, (drone.heading - heading0) / DEG);
  check("defend: then it returns to pursuit", ai.state.phase !== HostileState.DEFEND, ai.state.phase);
  check("defend: a sustained lock cannot chain breaks", ai.state.defends === 1, ai.state.defends);
  for (let i = 0; i < 60 * 8; i++) ai.update(player, 1 / 60);
  check("defend: but once the cooldown is up it will break again", ai.state.defends === 2, ai.state.defends);

  // The altitude guard still holds through a diving break.
  check("defend: it never dives into the sea", drone.position.y >= HOSTILE.minAltitude - 60, drone.position.y);
}

/* ===== Stage 04.3 — flares ===== */

{
  // The rule is physical, not statistical: no dice roll, no per-missile decoy
  // chance. A round that passes close to a burning flare loses its solution.
  check("flare: a round inside the radius is decoyed", seduces(120, 900));
  check("flare: a round outside it is not", !seduces(FLARE.seduceRadius + 1, 900));
  // The one number that stops a flare being a panic button: a committed round is
  // past being drawn off, and the answer to that is the barrel roll.
  check("flare: a committed round cannot be decoyed", !seduces(50, FLARE.minStandoff - 1));
  check("flare: the standoff is meaningfully large", FLARE.minStandoff >= 150, FLARE.minStandoff);
  // A flare has to be a better answer than the aircraft to be worth chasing.
  check("flare: a flare further away than the target loses", !seduces(400, 300));
  // The standoff and the radius must not cancel each other out. The cloud sits
  // roughly 200 m astern a second after release, so a standoff at 220 m meant a
  // stern chase reached the flares exactly when the rule declared it too late —
  // which is why the mechanic never fired.
  check("flare: the standoff does not swallow the radius", FLARE.minStandoff < FLARE.seduceRadius * 0.75, [FLARE.minStandoff, FLARE.seduceRadius]);
  check("flare: eight presses, not eighty", FLARE.count <= 10 && FLARE.count >= 4, FLARE.count);
  check("flare: a burst is several flares", FLARE.perBurst >= 2);
  check("flare: they burn out", FLARE.life > 1 && FLARE.life < 6, FLARE.life);

  // Ejection: down, back and alternating outward, keeping almost none of the
  // aircraft's speed — which is the whole reason the aircraft leaves them behind.
  const vel = { x: 0, y: 0, z: -240 };
  const right = { x: 1, y: 0, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  const a = ejectVelocity(0, vel, right, up, fwd);
  const b = ejectVelocity(1, vel, right, up, fwd);
  check("flare: a flare is ejected downward", a.y < -20, a.y);
  check("flare: and keeps little of the aircraft's speed", Math.abs(a.z) < Math.abs(vel.z) * 0.5, a.z);
  check("flare: consecutive flares go to opposite sides", Math.sign(a.x) !== Math.sign(b.x), [a.x, b.x]);
  check("flare: so the aircraft outruns its own flares", Math.abs(a.z) < Math.abs(vel.z), [a.z, vel.z]);
}

{
  // The dispenser, driven without a scene.
  const sys = createFlareSystem({});
  const at = { position: { x: 0, y: 600, z: 0 }, velocity: { x: 0, y: 0, z: -240 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  let dispensed = 0;
  let decoys = 0;
  sys.on("dispense", () => (dispensed += 1));
  sys.on("decoy", () => (decoys += 1));

  check("dispenser: it starts full", sys.state.remaining === FLARE.count);
  check("dispenser: a press releases a burst", sys.dispense(at) === true && sys.live.length === FLARE.perBurst, sys.live.length);
  check("dispenser: and spends exactly one", sys.state.remaining === FLARE.count - 1);
  check("dispenser: a second press inside the cooldown is refused", sys.dispense(at) === false && dispensed === 1);
  for (let i = 0; i < 60 * (FLARE.cooldown + 0.1); i++) sys.update([], at.position, 1 / 60);
  check("dispenser: and allowed once it has cycled", sys.dispense(at) === true, sys.state.remaining);

  // Spend them all; the dispenser refuses rather than going negative.
  for (let i = 0; i < 40; i++) {
    for (let k = 0; k < 60 * (FLARE.cooldown + 0.1); k++) sys.update([], at.position, 1 / 60);
    sys.dispense(at);
  }
  check("dispenser: it runs out", sys.state.remaining === 0);
  check("dispenser: an empty dispenser refuses", sys.dispense(at) === false);
  check("dispenser: and never goes negative", sys.state.remaining === 0);

  sys.reset();
  check("dispenser: reset reloads it and clears the sky", sys.state.remaining === FLARE.count && sys.live.length === 0);

  // Flares burn out on their own rather than accumulating for a whole sortie.
  sys.dispense(at);
  for (let i = 0; i < 60 * (FLARE.life + 0.2); i++) sys.update([], at.position, 1 / 60);
  check("dispenser: flares expire", sys.live.length === 0 && sys.state.burning === 0);
}

{
  // Decoying, end to end — with the aircraft MOVING, which is the only honest
  // geometry. A static aircraft never leaves its flares behind, so the cloud
  // never ends up on the chaser's path and the whole mechanic looks broken.
  const sys = createFlareSystem({});
  const player = { x: 0, y: 600, z: 0 };
  const at = { position: player, velocity: { x: 0, y: 0, z: -240 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  sys.dispense(at);

  // A tail-chaser 700 m astern at 400 m/s against a 240 m/s aircraft: 160 m/s of
  // closure, straight down the line the flares were dropped on.
  const chaser = { owner: "hostile", position: { x: 0, y: 600, z: 700 }, lost: false };
  for (let i = 0; i < 60 * 3 && !chaser.lost; i++) {
    player.z -= 240 / 60;
    chaser.position.z -= 400 / 60;
    sys.update([chaser], player, 1 / 60);
  }
  check("decoy: a stern chase is defeated by the flares it flies through", chaser.decoyed === true && chaser.target && chaser.target.label === "FLARE", [chaser.decoyed, Math.round(chaser.position.z)]);
  check("decoy: it is counted", sys.state.decoys === 1, sys.state.decoys);
  /**
   * The mechanism, asserted directly, because the first version got it wrong:
   * a decoyed round is RE-TARGETED, not switched off. Setting `lost` freezes a
   * round's heading, and a round that was tracking well is already pointed at
   * the aircraft — freezing it changes nothing and it arrives anyway. That is
   * exactly the "flares are useless" report.
   */
  check("decoy: the round is re-targeted, not frozen", chaser.lost !== true && chaser.target !== player, chaser.lost);
  check("decoy: and the flare it chases is a real target", chaser.target.alive === true && !!chaser.target.position);
  // ...and when the flare burns out the round loses its solution, which the
  // missile system already handles: no live target means no guidance.
  for (let i = 0; i < 60 * (FLARE.life + 0.2); i++) sys.update([chaser], player, 1 / 60);
  check("decoy: a burnt-out flare stops being a target", chaser.target.alive === false);

  // A head-on shot arrives before the flares are anywhere near its path, so
  // panicking early buys nothing. This is the fairness half of the mechanic.
  const early = createFlareSystem({});
  const p2 = { x: 0, y: 600, z: 0 };
  const at2 = { position: p2, velocity: { x: 0, y: 0, z: -240 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  early.dispense(at2);
  const headOn = { owner: "sam", position: { x: 0, y: 600, z: -2000 }, lost: false };
  for (let i = 0; i < 60 * 3 && !headOn.decoyed; i++) {
    p2.z -= 240 / 60;
    headOn.position.z += 300 / 60; // closing from ahead
    early.update([headOn], p2, 1 / 60);
  }
  check("decoy: a head-on shot is not defeated by flares", !headOn.decoyed, [headOn.decoyed, Math.round(headOn.position.z)]);

  // A round that is already inside the standoff cannot be saved from.
  const sys2 = createFlareSystem({});
  const p3 = { x: 0, y: 600, z: 0 };
  sys2.dispense({ position: p3, velocity: { x: 0, y: 0, z: -240 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } });
  const committed = { owner: "sam", position: { x: 0, y: 600, z: 80 }, lost: false };
  for (let i = 0; i < 60; i++) sys2.update([committed], p3, 1 / 60);
  check("decoy: a round already inside the standoff is not decoyed", !committed.decoyed, committed.decoyed);

  // A round that has already lost its solution is not counted twice.
  const sys3 = createFlareSystem({});
  const p4 = { x: 0, y: 600, z: 0 };
  sys3.dispense({ position: p4, velocity: { x: 0, y: 0, z: -240 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } });
  const already = { owner: "hostile", position: { x: 0, y: 600, z: 400 }, lost: true };
  for (let i = 0; i < 60; i++) sys3.update([already], p4, 1 / 60);
  check("decoy: an already-defeated round is not re-counted", sys3.state.decoys === 0);
}

/* ===== Stage 04.2 — SAM sites, terrain masking, game modes ===== */

/* ---- line of sight: the mechanic ---- */
{
  // A ridge 300 m high sitting between x 400 and x 700.
  const ridge = (x) => (x > 400 && x < 700 ? 300 : 20);
  const ground = (x, _z) => ridge(x);
  const site = { x: 0, y: 25, z: 0 };

  check("los: flat ground between two points is clear", lineOfSight(site, { x: 300, y: 400, z: 0 }, ground));
  check("los: a ridge in the way blocks it", !lineOfSight(site, { x: 1200, y: 120, z: 0 }, ground));
  check("los: going over the ridge is clear again", lineOfSight(site, { x: 1200, y: 900, z: 0 }, ground));
  // The clearance margin is in the player's favour: a graze counts as cover.
  check("los: a graze counts as cover", !lineOfSight(site, { x: 1200, y: 305, z: 0 }, ground), SAM.losClearance);
  // Endpoints are skipped, or a site standing ON the ground would block itself.
  const solid = () => 1000;
  check("los: with no sampler everything is visible", lineOfSight(site, { x: 9, y: 9, z: 9 }, null));
  check("los: solid ground everywhere blocks everything", !lineOfSight(site, { x: 1200, y: 100, z: 0 }, solid));

  check("sam: the dead zone overhead is a way through", !inEngagementRange(100) && inEngagementRange(1500));
  check("sam: and there is an outer limit", !inEngagementRange(9000));
  check("sam: the envelope sits inside the round's own reach", SAM.maxRange < SAM_MISSILE.maxSpeed * SAM_MISSILE.lifetime, [SAM.maxRange, SAM_MISSILE.maxSpeed * SAM_MISSILE.lifetime]);
}

/* ---- the transition table ---- */
{
  const S = SamState;
  const T = (phase, over = {}, ctx = {}) =>
    samTransition({ phase, timer: 1, rounds: 3, launched: false, lostFor: 0, ...over }, { alive: true, visible: true, inRange: true, playerAlive: true, ...ctx });

  check("sam: it only acquires what it can see", T(S.SEARCH) === S.TRACK && T(S.SEARCH, {}, { visible: false }) === S.SEARCH);
  check("sam: and only inside its envelope", T(S.SEARCH, {}, { inRange: false }) === S.SEARCH);
  // A spent site is still a target and still worth a kill, but it has stopped
  // being a threat — it must not sit in LOCK forever with nothing to fire.
  check("sam: a spent site never acquires again", T(S.SEARCH, { rounds: 0 }) === S.SEARCH);
  /**
   * THE SAME RULE ON THE WAY OUT. Enforcing it only at SEARCH left LAUNCH with no
   * exit except firing: the firing branch is gated on `rounds > 0`, so a spent
   * site in LAUNCH never set `launched`, and the table returned LAUNCH forever.
   * The site then held the player in a permanent lock with no missile ever
   * arriving — reported from play as "it just locks and warns without shooting".
   */
  check("sam: a spent site cannot sit in LAUNCH", T(S.LAUNCH, { rounds: 0, launched: false }) === S.RELOAD, T(S.LAUNCH, { rounds: 0, launched: false }));
  check("sam: a spent site cannot hold a LOCK either", T(S.LOCK, { rounds: 0, timer: 5 }) === S.SEARCH, T(S.LOCK, { rounds: 0, timer: 5 }));
  check("sam: an armed site still waits in LAUNCH for its own shot", T(S.LAUNCH, { rounds: 2, launched: false }) === S.LAUNCH);
  check("sam: and leaves once the round is away", T(S.LAUNCH, { rounds: 1, launched: true }) === S.RELOAD);
  // Termination: from LAUNCH, every magazine state reaches a state that is not
  // LAUNCH within one step. No path may loop on itself.
  check(
    "sam: LAUNCH always terminates",
    [0, 1, 3].every((r) => [true, false].some(() => T(S.LAUNCH, { rounds: r, launched: true }) !== S.LAUNCH)) &&
      T(S.LAUNCH, { rounds: 0, launched: false }) !== S.LAUNCH
  );
  check("sam: tracking takes time", T(S.TRACK) === S.TRACK && T(S.TRACK, { timer: 0 }) === S.LOCK);
  check("sam: losing sight during a track drops it", T(S.TRACK, {}, { visible: false }) === S.SEARCH);
  check("sam: but a lock survives a flicker", T(S.LOCK, { lostFor: SAM.lossGrace * 0.5 }) === S.LOCK);
  check("sam: and breaks once sight is genuinely lost", T(S.LOCK, { lostFor: SAM.lossGrace + 0.1 }) === S.SEARCH);
  check("sam: flying out of the envelope breaks a lock too", T(S.LOCK, {}, { inRange: false }) === S.SEARCH);
  check("sam: a completed lock launches", T(S.LOCK, { timer: 0 }) === S.LAUNCH);
  check("sam: launching goes to reload", T(S.LAUNCH) === S.LAUNCH && T(S.LAUNCH, { launched: true }) === S.RELOAD);
  check("sam: reload is a fixed wait", T(S.RELOAD) === S.RELOAD && T(S.RELOAD, { timer: 0 }) === S.SEARCH);
  check("sam: destruction wins from every state", [S.SEARCH, S.TRACK, S.LOCK, S.LAUNCH, S.RELOAD].every((p) => T(p, {}, { alive: false }) === S.DESTROYED));
  check("sam: and is terminal", T(S.DESTROYED, {}, { alive: true }) === S.DESTROYED);

  check("sam: the player is told TRACK then LOCK, reusing the air words", samThreatLevel(S.TRACK) === "TRACK" && samThreatLevel(S.LOCK) === "LOCK" && samThreatLevel(S.LAUNCH) === "LOCK");
  check("sam: a searching or reloading site says nothing", samThreatLevel(S.SEARCH) === "NONE" && samThreatLevel(S.RELOAD) === "NONE" && samThreatLevel(S.DESTROYED) === "NONE");

  // Acquisition is slow enough that a fast covered pass survives it.
  const toLaunch = SAM.trackTime + SAM.lockTime + SAM.launchDelay;
  check("sam: nothing is in the air for nearly three seconds", toLaunch > 2.5 && toLaunch < 4, toLaunch);
  check("sam: the reload is longer than the acquisition", SAM.reload > toLaunch, [SAM.reload, toLaunch]);
}

/* ---- the round ---- */
{
  check("sam round: slower than the AIM-9, faster than the hostile's", SAM_MISSILE.maxSpeed < MISSILE.maxSpeed && SAM_MISSILE.maxSpeed > HOSTILE_MISSILE.maxSpeed, [SAM_MISSILE.maxSpeed, HOSTILE_MISSILE.maxSpeed, MISSILE.maxSpeed]);
  check("sam round: the widest turn of the three — a crossing manoeuvre beats it", SAM_MISSILE.turnRateDeg < HOSTILE_MISSILE.turnRateDeg && SAM_MISSILE.turnRateDeg < MISSILE.turnRateDeg, SAM_MISSILE.turnRateDeg);
  check("sam round: the longest legs, because it starts from a standstill", SAM_MISSILE.lifetime > HOSTILE_MISSILE.lifetime, [SAM_MISSILE.lifetime, HOSTILE_MISSILE.lifetime]);
  check("sam round: it launches upward", SAM_MISSILE.separationDown < 0, SAM_MISSILE.separationDown);
  check("sam round: it inherits no launch speed", SAM_MISSILE.inheritFactor === 0);
  // Turn radius: v / omega. Comparable to the F-15's arcade turn, which is the
  // fairness claim — the same one the hostile's round has to satisfy.
  const radius = SAM_MISSILE.maxSpeed / (SAM_MISSILE.turnRateDeg * DEG);
  check("sam round: its turn radius is beatable", radius > 900, Math.round(radius));
  check("sam round: a defeated round keeps flying a curve", SAM.maskedAuthority > 0 && SAM.maskedAuthority < 0.2, SAM.maskedAuthority);
}

/* ---- placement ---- */
{
  const legs = [
    { phase: MissionPhase.TERRAIN, name: "PASS", position: { x: 0, y: 400, z: -10000 }, radius: 1300 },
    { phase: MissionPhase.TERRAIN, name: "VALLEY", position: { x: 500, y: 400, z: -13000 }, radius: 1400 },
    { phase: MissionPhase.EGRESS, name: "COAST", position: { x: 0, y: 300, z: -4000 }, radius: 1250 },
  ];
  const land = () => 200;
  const plan = planSamSites(legs, land);
  check("placement: two sites per terrain leg", plan.length === 4, plan.length);
  check("placement: and none on a leg that is not terrain", plan.every((p) => p.leg !== "COAST"), plan.map((p) => p.leg));
  check("placement: they flank the corridor rather than sitting on it", plan.every((p) => Math.abs(p.x - (p.leg === "PASS" ? 0 : 500)) > 900), plan.map((p) => p.x));
  check("placement: both sides are used", new Set(plan.map((p) => Math.sign(p.x - (p.leg === "PASS" ? 0 : 500)))).size === 2, plan.map((p) => p.x));
  check("placement: they stand on the ground", plan.every((p) => p.y === 200), plan.map((p) => p.y));

  // The bug this probing exists for: a lateral offset can miss the land, and the
  // first build put two launchers in the sea at y = -3 and y = 14.
  const sea = () => 0;
  check("placement: a site with nowhere to stand is dropped, not floated", planSamSites(legs, sea).length === 0, planSamSites(legs, sea));
  // Land on one side only: it probes outward and finds it rather than giving up.
  const oneSided = (x) => (x > 200 ? 180 : 0);
  const found = planSamSites(legs, oneSided);
  check("placement: it probes outward for real ground", found.length > 0 && found.every((p) => p.y >= MISSION.sam.minGround), found.map((p) => [p.x, p.y]));
  check("placement: with no terrain sampler at all, no sites", planSamSites(legs, null).length === 0);
}

/* ---- the network, end to end ---- */
{
  const flat = () => 0;
  const site = createSamSite({ position: { x: 0, y: 0, z: 0 } });
  const net = createSamNetwork({ sites: [site], sampleHeight: flat });
  const player = { position: { x: 0, y: 600, z: -1500 }, alive: true };

  net.setActive(false);
  for (let i = 0; i < 600; i++) net.update(player, 1 / 60);
  check("network: an inactive network is not simulated", site.phase === SamState.SEARCH && net.state.launches === 0);
  check("network: and its sites are not drawn", site.root.visible === false);

  let launches = 0;
  net.on("launch", () => (launches += 1));
  net.setActive(true);
  check("network: activating shows the sites", site.root.visible === true);

  let firstLaunchAt = -1;
  for (let i = 0; i < 60 * 6; i++) {
    net.update(player, 1 / 60);
    if (launches && firstLaunchAt < 0) firstLaunchAt = i / 60;
  }
  const expected = SAM.trackTime + SAM.lockTime + SAM.launchDelay;
  check("network: a visible player is tracked, locked and shot at", launches === 1, launches);
  check("network: after the full acquisition time", firstLaunchAt >= expected - 0.1 && firstLaunchAt <= expected + 0.2, [firstLaunchAt, expected]);
  check("network: then it reloads rather than firing again", site.phase === SamState.RELOAD && site.rounds === SAM.rounds - 1, [site.phase, site.rounds]);

  // Terrain masking, the whole point: the same geometry behind a hill produces
  // nothing at all.
  const wall = (x, z) => (Math.abs(z) > 200 && Math.abs(z) < 1300 ? 900 : 0);
  const hidden = createSamSite({ position: { x: 0, y: 0, z: 0 } });
  const masked = createSamNetwork({ sites: [hidden], sampleHeight: wall });
  let maskedLaunches = 0;
  masked.on("launch", () => (maskedLaunches += 1));
  masked.setActive(true);
  for (let i = 0; i < 60 * 20; i++) masked.update(player, 1 / 60);
  check("network: terrain masking defeats acquisition entirely", maskedLaunches === 0 && hidden.phase === SamState.SEARCH, [maskedLaunches, hidden.phase]);
  check("network: and the site knows it cannot see", hidden.visible === false && hidden.lostFor > 19, hidden.lostFor);

  // Destroyable, and it stays in the world as a wreck.
  check("network: a live site is a targeting candidate", net.targets.length === 1);
  wreckSamSite(site);
  check("network: a destroyed site is no longer a candidate", net.targets.length === 0);
  check("network: but it is still visible — a kill should leave evidence", site.root.visible === true && site.turret.visible === false);
  check("network: and it stops threatening", net.threatSource() === null);
  net.update(player, 1 / 60);
  check("network: a dead site is not simulated", net.state.alive === 0, net.state.alive);
  resetSamSite(site);
  check("network: reset brings it back whole", site.alive && site.health === site.maxHealth && site.rounds === SAM.rounds && site.turret.visible);

  check("network: a site publishes the same target contract the drone does", site.position && site.velocity && site.alive === true && typeof site.health === "number" && typeof site.radius === "number");
  check("network: and identifies itself as ground", site.kind === "SAM" && site.label === "SAM SITE");
}

/* ---- threat display: two sources, one set of words ---- */
{
  const monitor = createThreatMonitor();
  const base = { position: { x: 0, y: 500, z: 0 }, forward: { x: 0, y: 0, z: -1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, expert: false, maneuver: null, incoming: [] };

  monitor.update({ ...base, hostile: { tracking: true, locked: false, range: 3000 }, ground: null }, 1 / 60);
  check("threat: a fighter tracking says TRACK, from the air", monitor.state.level === ThreatLevel.TRACK && monitor.state.source === "AIR");

  monitor.update({ ...base, hostile: {}, ground: { tracking: true, locked: false, lockProgress: 0.4, range: 2000 } }, 1 / 60);
  check("threat: a SAM tracking reuses the same word, labelled SAM", monitor.state.level === ThreatLevel.TRACK && monitor.state.source === "SAM");

  // A lock outranks a track whichever side it came from.
  monitor.update({ ...base, hostile: { tracking: true, range: 3000 }, ground: { locked: true, lockProgress: 1, range: 2500 } }, 1 / 60);
  check("threat: a SAM lock outranks a fighter merely tracking", monitor.state.level === ThreatLevel.LOCK && monitor.state.source === "SAM");

  // Two acquisitions at once: the nearer one is the one worth telling them about.
  monitor.update({ ...base, hostile: { locked: true, range: 4000 }, ground: { locked: true, lockProgress: 1, range: 900 } }, 1 / 60);
  check("threat: with both locked, the closer threat is named", monitor.state.source === "SAM", monitor.state.source);
  monitor.update({ ...base, hostile: { locked: true, range: 600 }, ground: { locked: true, lockProgress: 1, range: 3800 } }, 1 / 60);
  check("threat: and the other way round", monitor.state.source === "AIR", monitor.state.source);

  // A round in the air always wins, and names its own owner.
  const round = { position: { x: 0, y: 500, z: -700 }, owner: "sam", dir: { x: 0, y: 0, z: 1 }, authority: 1 };
  monitor.update({ ...base, hostile: { tracking: true, range: 100 }, ground: null, incoming: [round] }, 1 / 60);
  check("threat: a live round outranks any acquisition", monitor.state.level === ThreatLevel.MISSILE);
  check("threat: and a SAM round says so", monitor.state.source === "SAM", monitor.state.source);
  round.owner = "hostile";
  monitor.update({ ...base, hostile: {}, ground: { locked: true, range: 10 }, incoming: [round] }, 1 / 60);
  check("threat: an air round says so too", monitor.state.source === "AIR", monitor.state.source);

  // The barrel roll works on a SAM round as well; it used to return 1 for any
  // owner that was not the fighter.
  const ctx = { position: base.position, velocityDir: { x: 0, y: 0, z: -1 }, inPeak: true };
  const samRound = { owner: "sam", position: { x: 0, y: 500, z: -400 }, dir: { x: 0, y: 0, z: 1 } };
  check("threat: the barrel roll degrades a SAM round too", monitor.authorityFor(samRound, ctx) < 1, monitor.authorityFor(samRound, ctx));
  check("threat: but not the player's own", monitor.authorityFor({ ...samRound, owner: "player" }, ctx) === 1);
}

/* ---- game modes ---- */
{
  check("modes: three of them, and MISSION is first", MODE_ORDER.length === 3 && MODE_ORDER[0] === GameMode.MISSION, MODE_ORDER);
  check("modes: cycling returns to the start", nextMode(nextMode(nextMode(GameMode.MISSION))) === GameMode.MISSION);
  check("modes: every mode has a full rules row", MODE_ORDER.every((m) => { const r = modeRules(m); return typeof r.label === "string" && typeof r.phases === "boolean" && typeof r.hostiles === "boolean" && typeof r.sams === "boolean" && r.respawn; }));
  check("modes: an unknown mode falls back to the mission", modeRules("NOPE") === MODES.MISSION);

  check("modes: only MISSION runs the phase machine", !isSandbox(GameMode.MISSION) && isSandbox(GameMode.FREE) && isSandbox(GameMode.PEACE));
  check("modes: only MISSION is timed, and only MISSION has an ending", MODES.MISSION.timer && !MODES.FREE.timer && !MODES.PEACE.timer && MODES.MISSION.ending && !MODES.FREE.ending);
  check("modes: PEACE has no threats at all", !MODES.PEACE.hostiles && !MODES.PEACE.sams);
  check("modes: FREE keeps both", MODES.FREE.hostiles && MODES.FREE.sams);
  // Both sandbox modes respawn on the carrier, because placeOnDeck plus the
  // launch script already IS a carrier respawn.
  check("modes: the sandbox modes respawn on the carrier", MODES.FREE.respawn === "CARRIER" && MODES.PEACE.respawn === "CARRIER" && MODES.MISSION.respawn === "CHECKPOINT");
  // PEACE is not a screensaver: the ground still kills you.
  check("modes: PEACE still has a failure state", !!MODES.PEACE.respawn);
}

{
  let spawns = 0;
  let samsOn = null;
  const box = createSandbox({ spawnHostile: () => (spawns += 1), setSams: (on) => (samsOn = on) });

  box.begin(GameMode.PEACE);
  check("sandbox: PEACE switches the SAM network off", samsOn === false);
  for (let i = 0; i < 60 * 120; i++) box.update({ hostileAlive: false }, 1 / 60);
  check("sandbox: and never spawns anything, however long you fly", spawns === 0, spawns);
  check("sandbox: but the clock still runs for the rail", box.state.elapsed > 119, box.state.elapsed);

  box.begin(GameMode.FREE);
  check("sandbox: FREE switches the SAM network on", samsOn === true);
  for (let i = 0; i < 60 * (SANDBOX.firstHostile - 1); i++) box.update({ hostileAlive: false }, 1 / 60);
  check("sandbox: the first hostile waits a beat after the launch", spawns === 0, spawns);
  for (let i = 0; i < 60 * 2; i++) box.update({ hostileAlive: false }, 1 / 60);
  check("sandbox: then it arrives", spawns === 1, spawns);

  /**
   * FREE FLY FILLS A WING, and then stops.
   *
   * This used to be one-at-a-time, and the check here asserted that a live
   * hostile was never joined by a second. `SANDBOX.wing` replaced that rule, so
   * the check is rewritten rather than adapted (§18) -- an adapted version would
   * still be describing a design that no longer exists.
   *
   * `hostilesAlive` is a COUNT now, because a boolean cannot express "one of two
   * is flying", which is the state the mode is in for most of a fight.
   */
  check("sandbox: FREE fly flies a wing of more than one", SANDBOX.wing > 1, SANDBOX.wing);
  for (let i = 0; i < 60 * (SANDBOX.hostileRespawn + 1); i++) box.update({ hostilesAlive: 1 }, 1 / 60);
  check("sandbox: one of two alive still calls for a wingman", spawns === 2, spawns);
  // ...and a full wing freezes the clock entirely, however long you fly.
  for (let i = 0; i < 60 * 120; i++) box.update({ hostilesAlive: SANDBOX.wing }, 1 / 60);
  check("sandbox: a FULL wing is never joined by another", spawns === 2, spawns);

  /**
   * Drain to a KNOWN timer first. The previous segments leave the respawn clock
   * part-spent, and a check written against a whole `hostileRespawn` from there
   * fails on arithmetic rather than on behaviour -- which is exactly what the
   * first draft of this did.
   */
  const mark = spawns;
  for (let i = 0; i < 60 * (SANDBOX.hostileRespawn + 2) && spawns === mark; i++) box.update({ hostilesAlive: 0 }, 1 / 60);
  check("sandbox: an empty sky is refilled", spawns === mark + 1, spawns);
  // The timer is now exactly hostileRespawn, so the next two checks mean what
  // they say.
  for (let i = 0; i < 60 * (SANDBOX.hostileRespawn - 1); i++) box.update({ hostilesAlive: 0 }, 1 / 60);
  check("sandbox: a kill buys a real pause", spawns === mark + 1, spawns);
  for (let i = 0; i < 60 * 2; i++) box.update({ hostilesAlive: 0 }, 1 / 60);
  // ONE replacement, not a wing's worth: the timer runs between spawns, so
  // losing both does not put two aircraft in the air on the same frame.
  check("sandbox: and then the next one, one at a time", spawns === mark + 2, spawns);

  // SAM sites do not come back in MISSION: clearing the valley is the reward.
  // FREE fly seeds its own batches instead, which is a different rule entirely.
  check("sandbox: MISSION's SAM sites never respawn", SANDBOX.samRespawn === null);

  const atReset = spawns;
  box.reset();
  for (let i = 0; i < 60 * 60; i++) box.update({ hostilesAlive: 0 }, 1 / 60);
  check("sandbox: reset stops it dead", spawns === atReset && !box.state.live, spawns);
}

/* ---- the director parks in a sandbox mode ---- */
{
  const d = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
  d.setRoute(planRoute({ coastZ: -7600, features: [] }));
  d.setSandbox(true);
  d.reset();
  const pos = { x: 0, y: 600, z: -1546 };
  // Fly the launch, then a long way past where EGRESS would have ended.
  for (let i = 0; i < 60 * 90; i++) {
    if (d.state.phase !== MissionPhase.DECK && d.state.phase !== MissionPhase.LAUNCH) pos.z -= 220 / 60;
    d.update({ position: pos, strokeStarted: i > 60 * 1.7, launchDone: i > 60 * 5.42, hostileAlive: true, hostileSpent: false }, 1 / 60);
  }
  check("parked: every mode still flies the catapult", d.state.phase !== MissionPhase.DECK, d.state.phase);
  check("parked: but a sandbox mode stops at EGRESS and stays there", d.state.phase === MissionPhase.EGRESS && d.state.parked, [d.state.phase, d.state.parked]);
  check("parked: with no navigation", !d.state.navValid && d.state.navName === null);
  check("parked: and no clock", d.state.missionTime === 0 && !d.state.timerRunning, d.state.missionTime);
  check("parked: the mission is never completed by accident", !d.state.finished);

  // The mission mode, same input, still runs to the end.
  const m = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
  m.setRoute(planRoute({ coastZ: -7600, features: [] }));
  m.reset();
  m.update({ position: { x: 0, y: 600, z: -1546 }, strokeStarted: true, launchDone: false, hostileAlive: true, hostileSpent: false }, 1 / 60);
  m.update({ position: { x: 0, y: 600, z: -1546 }, strokeStarted: true, launchDone: true, hostileAlive: true, hostileSpent: false }, 1 / 60);
  check("parked: MISSION does not park", m.state.phase === MissionPhase.EGRESS && !m.state.parked && m.state.timerRunning);
}

/* ===== Stage 04.0b — the arrow keys are not flight axes ===== */

/**
 * The real cause of "my fighter dodges right on its own", found in a screenshot
 * rather than in the code: the dev rail's held-key field read `ArrowRight` while
 * the stick read `in +1.00` and bank sat pinned at -70°. A physical ArrowRight
 * keydown whose keyup never arrived, commanding a full right turn forever.
 *
 * Arrow keys were an unadvertised secondary binding, and they are exactly the
 * keys browser chrome and embedded preview panes steal for their own navigation
 * — so they are the ones whose keyup goes missing when something else takes
 * focus mid-press. Four rounds of mouse fixes were the wrong device entirely.
 */
{
  const bus = new EventTarget();
  const inp = createInput(bus);
  const raw = (code, down, key) =>
    bus.dispatchEvent(Object.assign(new Event(down ? "keydown" : "keyup"), { key: key || code, code, repeat: false, preventDefault() {} }));
  const run = (n = 40) => {
    for (let i = 0; i < n; i++) inp.update(1 / 60);
  };

  // The reported failure, reproduced: press ArrowRight and never release it.
  raw("ArrowRight", true);
  run(60);
  check("arrows: a stuck ArrowRight commands no bank", inp.x === 0, inp.x);
  check("arrows: and it is not even tracked as held", inp.heldKeys().length === 0, inp.heldKeys());
  for (const code of ["ArrowLeft", "ArrowUp", "ArrowDown"]) {
    raw(code, true);
  }
  run(60);
  check("arrows: no arrow key touches the flight axes", inp.x === 0 && inp.y === 0, [inp.x, inp.y]);

  // ...while the advertised keys still work, with all four arrows still "down".
  raw("KeyD", true, "d");
  run(40);
  check("arrows: D still banks right with every arrow stuck down", inp.x > 0.8, inp.x);
  raw("KeyD", false, "d");
  run(90);
  check("arrows: and releasing D still returns to centre", Math.abs(inp.x) < 0.02, inp.x);

  // C is the escape hatch for the general case: any lost keyup, one key press.
  raw("KeyW", true, "w");
  run(40);
  check("stuck keys: W is held", inp.y > 0.8 && inp.heldKeys().includes("KeyW"), [inp.y, inp.heldKeys()]);
  raw("KeyC", true, "c");
  run(90);
  check("stuck keys: C drops every held key without a mission restart", inp.heldKeys().length === 0 && Math.abs(inp.y) < 0.02, [inp.heldKeys(), inp.y]);

  // Losing focus mid-press is the mechanism by which a keyup goes missing, so
  // blur alone must already clear everything.
  raw("KeyA", true, "a");
  run(30);
  check("stuck keys: A is held", inp.x < -0.8, inp.x);
  bus.dispatchEvent(new Event("blur"));
  run(90);
  check("stuck keys: losing focus releases the stick", Math.abs(inp.x) < 0.02, inp.x);
}

/* ===================== Stage 03.3 — hostile engagement ===================== */

{
  /* Geometry: the hostile has to agree with the flight model about what a
   * heading is, or every angle in the stage is subtly wrong. */
  const o = { x: 0, y: 700, z: 0 };
  check("hostile: a point dead ahead is heading 0", Math.abs(aimAngles(o, { x: 0, y: 700, z: -100 }).heading) < 1e-9);
  check("hostile: a point to the right is a negative heading", aimAngles(o, { x: 100, y: 700, z: 0 }).heading < 0);
  const up45 = aimAngles(o, { x: 0, y: 800, z: -100 });
  check("hostile: a climbing target is a positive pitch", Math.abs(up45.pitch - 45 * DEG) < 1e-6, up45.pitch / DEG);
  check("hostile: range is range", Math.abs(up45.range - Math.hypot(100, 100)) < 1e-9);

  // forwardFrom is the inverse, and it is the drone's velocity direction.
  for (const [h, p] of [[0, 0], [1.2, 0.3], [-2.4, -0.4], [3.0, 0.2]]) {
    const f = forwardFrom(h, p, {});
    check("hostile: forwardFrom is unit length", Math.abs(Math.hypot(f.x, f.y, f.z) - 1) < 1e-9);
    const back = aimAngles({ x: 0, y: 0, z: 0 }, { x: f.x * 500, y: f.y * 500, z: f.z * 500 });
    check("hostile: heading/pitch round-trip through the forward vector", Math.abs(wrapPi(back.heading - h)) < 1e-6 && Math.abs(back.pitch - p) < 1e-6, [back.heading, h]);
  }

  check("hostile: off-nose is 0 dead ahead", offNoseDeg(0, 0, o, { x: 0, y: 700, z: -900 }) < 1e-6);
  check("hostile: off-nose is 180 dead astern", Math.abs(offNoseDeg(0, 0, o, { x: 0, y: 700, z: 900 }) - 180) < 1e-6);
  check("hostile: off-nose is 90 abeam", Math.abs(offNoseDeg(0, 0, o, { x: 900, y: 700, z: 0 }) - 90) < 1e-6);
}

{
  /* §7 — the single guarantee that stops the enemy behaving like a UFO. */
  const dt = 1 / 60;
  const rate = HOSTILE.turnRateDeg * DEG;
  let h = 0;
  const desired = Math.PI * 0.9;
  let worst = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const next = steerAngle(h, desired, rate, dt);
    worst = Math.max(worst, Math.abs(wrapPi(next - h)));
    h = next;
  }
  check("steer: no frame turns faster than the maximum rate", worst <= rate * dt + 1e-12, [worst / dt / DEG, HOSTILE.turnRateDeg]);
  check("steer: it does get there eventually", Math.abs(wrapPi(h - desired)) < 1e-6, h);

  // Across the seam it must take the short way, exactly like the HUD's dampAngle.
  const seam = steerAngle(3.0, -3.0, 10 * DEG, dt);
  check("steer: the ±180 seam is crossed the short way", seam > 3.0, seam);

  // Pitch is not an angle on a circle: no wrap, and the guard bounds it.
  const p = steerAngle(0, 5, HOSTILE.pitchRateDeg * DEG, 1, false);
  check("steer: pitch does not wrap", p > 0 && p <= HOSTILE.pitchRateDeg * DEG + 1e-12, p / DEG);
  check("guard: below the floor it is told to climb", altitudeGuard(100, -20 * DEG) > 0);
  check("guard: above the ceiling it is told to descend", altitudeGuard(9000, 20 * DEG) < 0);
  check("guard: otherwise it is clamped to the pitch limit", Math.abs(altitudeGuard(1000, 80 * DEG) - HOSTILE.maxPitchDeg * DEG) < 1e-12);

  const pred = predictPoint({ x: 0, y: 700, z: 0 }, { x: 0, y: 0, z: -250 }, 1.2, {});
  check("pursuit: the aim point leads the player", Math.abs(pred.z + 300) < 1e-9, pred.z);
}

{
  /* §9 — attack geometry. All three conditions required, none sufficient. */
  const a = HOSTILE.attack;
  check("cone: a valid geometry qualifies", inAttackCone(1400, 10));
  check("cone: too close does not", !inAttackCone(a.minRange - 1, 0));
  check("cone: too far does not", !inAttackCone(a.maxRange + 1, 0));
  check("cone: off the nose does not", !inAttackCone(1400, a.coneDeg + 1));
  check("cone: the band is the one §9 asks for", a.minRange >= 500 && a.maxRange <= 2500 && a.coneDeg >= 20 && a.coneDeg <= 35, [a.minRange, a.maxRange, a.coneDeg]);
  check("lock: acquisition takes a visible time (§10)", HOSTILE.lockTime >= 1.0 && HOSTILE.lockTime <= 1.5, HOSTILE.lockTime);
  check("lock: and there is a beat before launch (§10)", HOSTILE.launchDelay > 0.2, HOSTILE.launchDelay);
  check("pacing: the cooldown is 5–10 s (§33)", HOSTILE.cooldown >= 5 && HOSTILE.cooldown <= 10, HOSTILE.cooldown);
  check("pacing: ammunition is limited (§34)", HOSTILE.ammo >= 2 && HOSTILE.ammo <= 3, HOSTILE.ammo);

  // §8: the player must always be able to run away.
  for (const phase of Object.values(HostileState)) {
    check("speed: the hostile is never faster than the player's maximum", phaseSpeed(phase) < SPEED.max, [phase, phaseSpeed(phase)]);
  }
  check("speed: pursuit sits in the §8 band", phaseSpeed(HostileState.PURSUIT) >= 170 && phaseSpeed(HostileState.PURSUIT) <= 210);
  check("speed: an attack run is more aggressive than a patrol", phaseSpeed(HostileState.ACQUIRE) > phaseSpeed(HostileState.PATROL));
}

{
  /* §3 — the transition table, stated as a table. Every attack condition lives
   * in this one function, so these checks are the whole promotion policy. */
  const S = HostileState;
  const ai = (over = {}) => ({ phase: S.PATROL, ammo: 2, cooldown: 0, timer: 0, lockProgress: 0, launched: false, ...over });
  const ctx = (over = {}) => ({ alive: true, playerAlive: true, ready: true, range: 1400, inCone: true, ...over });

  check("fsm: patrol detects the player", hostileTransition(ai(), ctx()) === S.PURSUIT);
  check("fsm: patrol waits out the engage delay", hostileTransition(ai(), ctx({ ready: false })) === S.PATROL);
  check("fsm: patrol ignores a distant player", hostileTransition(ai(), ctx({ range: HOSTILE.detectRange + 1 })) === S.PATROL);
  check("fsm: pursuit gives up past the disengage range", hostileTransition(ai({ phase: S.PURSUIT }), ctx({ range: HOSTILE.disengageRange + 1 })) === S.PATROL);
  check("fsm: pursuit acquires inside the attack geometry", hostileTransition(ai({ phase: S.PURSUIT }), ctx()) === S.ACQUIRE);
  check("fsm: pursuit does not acquire out of the cone", hostileTransition(ai({ phase: S.PURSUIT }), ctx({ inCone: false })) === S.PURSUIT);
  check("fsm: pursuit does not acquire while cooling down", hostileTransition(ai({ phase: S.PURSUIT, cooldown: 3 }), ctx()) === S.PURSUIT);
  check("fsm: pursuit does not acquire with no missiles left", hostileTransition(ai({ phase: S.PURSUIT, ammo: 0 }), ctx()) === S.PURSUIT);
  check("fsm: acquisition holds until the lock fills", hostileTransition(ai({ phase: S.ACQUIRE, lockProgress: 0.9 }), ctx()) === S.ACQUIRE);
  check("fsm: a full lock becomes an attack", hostileTransition(ai({ phase: S.ACQUIRE, lockProgress: 1 }), ctx()) === S.ATTACK);
  check("fsm: a drained lock falls back to pursuit", hostileTransition(ai({ phase: S.ACQUIRE, lockProgress: 0 }), ctx({ inCone: false })) === S.PURSUIT);
  check("fsm: attack waits for its own launch", hostileTransition(ai({ phase: S.ATTACK }), ctx()) === S.ATTACK);
  check("fsm: a launch begins the cooldown", hostileTransition(ai({ phase: S.ATTACK, launched: true }), ctx()) === S.COOLDOWN);
  check("fsm: the break runs on a timer", hostileTransition(ai({ phase: S.COOLDOWN, timer: 1 }), ctx()) === S.COOLDOWN);
  check("fsm: then it repositions", hostileTransition(ai({ phase: S.COOLDOWN, timer: 0 }), ctx()) === S.REPOSITION);
  check("fsm: and comes back to pursuit", hostileTransition(ai({ phase: S.REPOSITION, timer: 0 }), ctx()) === S.PURSUIT);
  for (const phase of [S.PATROL, S.PURSUIT, S.ACQUIRE, S.ATTACK, S.COOLDOWN, S.REPOSITION]) {
    check("fsm: death wins from any state", hostileTransition(ai({ phase }), ctx({ alive: false })) === S.DESTROYED, phase);
  }
  check("fsm: destroyed is terminal", hostileTransition(ai({ phase: S.DESTROYED }), ctx()) === S.DESTROYED);
}

{
  /* The AI end to end against a drone entity: the loop §44 describes. */
  const drone = createTargetDrone();
  const hostile = createHostileAI({ drone });
  let launches = 0;
  hostile.on("launch", () => launches++);

  const player = { position: new THREE.Vector3(0, 700, 0), velocity: new THREE.Vector3(0, 0, -250), alive: true };
  const seen = [];
  const dt = 1 / 60;
  let worstTurn = 0;
  let prevHeading = drone.heading;
  let minAlt = Infinity;
  const launchTimes = [];
  let t = 0;
  for (let i = 0; i < 60 * 90; i++) {
    t += dt;
    player.position.z -= 250 * dt;
    const before = launches;
    hostile.update(player, dt);
    if (launches > before) launchTimes.push(t);
    const turn = Math.abs(wrapPi(drone.heading - prevHeading)) / dt;
    if (i > 1) worstTurn = Math.max(worstTurn, turn);
    prevHeading = drone.heading;
    minAlt = Math.min(minAlt, drone.position.y);
    const phase = hostile.state.phase;
    if (seen[seen.length - 1] !== phase) seen.push(phase);
  }

  check("engagement: it patrols first", seen[0] === HostileState.PATROL, seen);
  check("engagement: it pursues", seen.includes(HostileState.PURSUIT), seen);
  check("engagement: it acquires", seen.includes(HostileState.ACQUIRE), seen);
  check("engagement: it attacks", seen.includes(HostileState.ATTACK), seen);
  check("engagement: it breaks away and repositions", seen.includes(HostileState.COOLDOWN) && seen.includes(HostileState.REPOSITION), seen);
  check("engagement: acquisition never skips straight to a launch", seen.indexOf(HostileState.ACQUIRE) < seen.indexOf(HostileState.ATTACK), seen);
  check("engagement: it never turns faster than its rate limit", worstTurn <= HOSTILE.turnRateDeg * DEG * 1.001, worstTurn / DEG);
  check("engagement: it stays out of the sea", minAlt > 0, minAlt);
  check("engagement: it spends its whole magazine and no more (§34)", launches === HOSTILE.ammo && hostile.state.ammo === 0, [launches, hostile.state.ammo]);
  for (let i = 1; i < launchTimes.length; i++) {
    check("engagement: no launch inside the cooldown (§33)", launchTimes[i] - launchTimes[i - 1] >= HOSTILE.cooldown, launchTimes);
  }
  check("engagement: nothing is launched before the engage delay", launchTimes[0] > HOSTILE.engageDelay, launchTimes[0]);

  // §37: killing it stops new attacks; it does not stop rounds already away.
  hostile.reset();
  markTargetHit(drone, 1);
  launches = 0;
  for (let i = 0; i < 60 * 30; i++) hostile.update(player, dt);
  check("destroyed: a dead hostile launches nothing", launches === 0);
  check("destroyed: and reports the state", hostile.state.phase === HostileState.DESTROYED);

  // §38: reset restores the whole opponent, ammunition included.
  resetTargetDrone(drone);
  hostile.reset();
  check("reset: ammunition comes back", hostile.state.ammo === HOSTILE.ammo);
  check("reset: the machine is back at patrol", hostile.state.phase === HostileState.PATROL && hostile.state.cooldown === 0);
}

{
  /* The drone entity itself: pitch and speed are now real, and the Stage 03.0
   * racetrack has to be unchanged by that. */
  const d = createTargetDrone();
  d.pitch = 10 * DEG;
  d.speed = 200;
  const y0 = d.position.y;
  integrateDrone(d, 1);
  check("drone: a positive pitch climbs", d.position.y > y0, d.position.y - y0);
  check("drone: velocity magnitude is the commanded speed", Math.abs(d.velocity.length() - 200) < 1e-6, d.velocity.length());

  const flat = createTargetDrone();
  const alt = flat.position.y;
  for (let i = 0; i < 60 * 12; i++) updateTargetDrone(flat, 1 / 60);
  check("drone: the scripted patrol still holds its altitude", Math.abs(flat.position.y - alt) < 1e-6, flat.position.y);
  check("drone: and still flies its arc", Math.abs(flat.heading) > 0.1, flat.heading);
  check("drone: the hardpoint is off the centreline (§16)", Math.abs(flat.hardpoint.position.x) > 0.5 && flat.hardpoint.position.y < 0, flat.hardpoint.position);
}

{
  /* §11–§13, §24–§25 — what the player is told. */
  check("threat: nothing happening is NONE", threatLevelOf({}) === ThreatLevel.NONE);
  check("threat: acquisition reads TRACK", threatLevelOf({ tracking: true }) === ThreatLevel.TRACK);
  check("threat: a completed lock reads LOCK", threatLevelOf({ tracking: true, locked: true }) === ThreatLevel.LOCK);
  check("threat: a round in the air outranks both", threatLevelOf({ tracking: true, locked: true, incoming: true }) === ThreatLevel.MISSILE);
  check("threat: MISSILE is not shown merely because a hostile exists (§11)", threatLevelOf({ tracking: false, locked: false, incoming: false }) !== ThreatLevel.MISSILE);

  check("threat: over a kilometre is the calm tier", warningTier(1400) === ThreatTier.FAR);
  check("threat: inside a kilometre escalates", warningTier(800) === ThreatTier.NEAR);
  check("threat: inside 500 m is urgent", warningTier(300) === ThreatTier.URGENT);
  check("threat: the tiers are §25's", THREAT.nearRange === 1000 && THREAT.urgentRange === 500);

  // §13 — direction. Player facing -Z, right = +X, up = +Y.
  const f = { x: 0, y: 0, z: -1 };
  const r = { x: 1, y: 0, z: 0 };
  const u = { x: 0, y: 1, z: 0 };
  const at = { x: 0, y: 0, z: 0 };
  check("bearing: a threat on the right points right", threatBearing(f, r, u, at, { x: 500, y: 0, z: -100 }, {}).arrow === "\u25b6");
  check("bearing: a threat on the left points left", threatBearing(f, r, u, at, { x: -500, y: 0, z: -100 }, {}).arrow === "\u25c0");
  check("bearing: a threat above points up", threatBearing(f, r, u, at, { x: 0, y: 500, z: -100 }, {}).arrow === "\u25b2");
  const behind = threatBearing(f, r, u, at, { x: 0, y: 0, z: 900 }, {});
  check("bearing: astern is its own answer, not an arrow at the screen edge", behind.behind === true, behind);
}

{
  /* §21–§23 — the dodge. The whole point is that it is a timing skill and not a
   * button that grants invulnerability. */
  const assisted = dodgeWindow(false);
  const expert = dodgeWindow(true);
  check("dodge: the window is measured against the real roll length", THREAT.rollDuration === ROLL.duration, [THREAT.rollDuration, ROLL.duration]);
  check("dodge: assisted gets the wider window (§40)", assisted.seconds > expert.seconds, [assisted.seconds, expert.seconds]);
  check("dodge: assisted is 0.60 s (§40)", Math.abs(assisted.seconds - 0.6) < 1e-9);
  check("dodge: expert is 0.40–0.45 s (§40)", expert.seconds >= 0.4 && expert.seconds <= 0.45, expert.seconds);
  check("dodge: the window is a fraction of the manoeuvre, not all of it (§22)", assisted.end < 1 && assisted.start > 0, assisted);

  const roll = (t) => ({ kind: "roll", t });
  check("dodge: nothing before the peak", !inDodgePeak(roll(0.05), false));
  check("dodge: the peak is live mid-manoeuvre", inDodgePeak(roll(0.4), false));
  check("dodge: and over before the roll ends", !inDodgePeak(roll(0.95), false));
  check("dodge: no manoeuvre, no window", !inDodgePeak(null, false));

  check("evade: without the manoeuvre a round is untouched", evasionAuthority({ inPeak: false, range: 200 }) === 1);
  check("evade: pressed far too early it does nothing (§23)", evasionAuthority({ inPeak: true, range: 2000 }) === 1);
  const late = evasionAuthority({ inPeak: true, range: 300, aspectDeg: 60 });
  check("evade: pressed late against a committed round it cripples guidance", late <= THREAT.dodgeAuthority + 1e-9, late);
  check("evade: but never to zero — a miss must still fly like a missile", late > 0);
  const mid = evasionAuthority({ inPeak: true, range: 750, aspectDeg: 60 });
  check("evade: in between it is a partial effect, not a cliff", mid > late && mid < 1, mid);
  const stern = evasionAuthority({ inPeak: true, range: 300, aspectDeg: 5 });
  check("evade: a stern chase is harder to roll out of than a crossing shot (§22)", stern > late, [stern, late]);
  check("evade: even a stern chase is degraded", stern < 1);

  check("evade: a miss is only announced if it was going to be a hit (§43)", evadeEarned(400) && !evadeEarned(4000));
  check("evade: a round that never had a range is not an evade", !evadeEarned(Infinity));
}

{
  /* §14/§17 — the hostile round is the same implementation with different
   * numbers. If those numbers ever converge, the two weapons stop meaning
   * different things. */
  const h = HOSTILE_MISSILE;
  check("enemy missile: slower than the player's AIM-9", h.maxSpeed < MISSILE.maxSpeed, [h.maxSpeed, MISSILE.maxSpeed]);
  check("enemy missile: less agile than the player's AIM-9", h.turnRateDeg < MISSILE.turnRateDeg, [h.turnRateDeg, MISSILE.turnRateDeg]);
  check("enemy missile: speed is in the §17 band", h.maxSpeed >= 320 && h.maxSpeed <= 420, h.maxSpeed);
  check("enemy missile: lifetime is in the §17 band", h.lifetime >= 6 && h.lifetime <= 10, h.lifetime);
  check("enemy missile: the fuze is in the §19 band", h.hitRadius >= 6 && h.hitRadius <= 10, h.hitRadius);
  check("enemy missile: it gives up its turn sooner than an AIM-9 (§28)", h.overshootAngleDeg < MISSILE.overshootAngleDeg);

  // A turn radius the player can out-fly is the whole fairness claim: at
  // 250 m/s the F-15's arcade turn is comparable to the round's.
  const radius = h.maxSpeed / (h.turnRateDeg * DEG);
  check("enemy missile: its turn radius is beatable, not a snap-to-target", radius > 500, `${Math.round(radius)} m`);

  check("overshoot: both conditions are required (§28)", !overshooting(140, false, 900, h) && !overshooting(20, true, 900, h));
  check("overshoot: a beaten round is declared lost", overshooting(140, true, 900, h));
  check("overshoot: not while it is still on top of the target", !overshooting(179, true, h.hitRadius, h));
}

{
  /* The enemy round in flight, in-page. Three runs of the same geometry:
   * straight and level (it hits), a mistimed dodge (it still hits), and a timed
   * dodge (it overshoots). That triple IS §48/§49. */
  const scene = new THREE.Scene();
  const shooter = new THREE.Object3D();
  shooter.position.set(0, 700, 900);
  // Forward is -Z: from behind the player, up their tail. That is the geometry
  // the hostile's own pursuit curve produces (§6), so it is the one to test.
  scene.add(shooter);
  shooter.updateMatrixWorld(true);

  const run = ({ dodgeAt = null, expert = false }) => {
    const player = { position: new THREE.Vector3(0, 700, 0), velocity: new THREE.Vector3(0, 0, -250), alive: true };
    const monitor = createThreatMonitor();
    const evasion = { position: player.position, velocityDir: { x: 0, y: 0, z: -1 }, inPeak: false };
    const system = createMissileSystem({ scene, prototype: null, authorityFor: (m) => monitor.authorityFor(m, evasion) });
    let hit = 0;
    let expired = 0;
    let minRange = Infinity;
    system.on("hit", () => hit++);
    system.on("expire", () => expired++);
    const m = system.fire({ mount: shooter, target: player, ownerSpeed: 200, owner: "hostile", cfg: HOSTILE_MISSILE });
    let maneuver = null;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 14 && system.inFlight; i++) {
      const range = m.position.distanceTo(player.position);
      minRange = Math.min(minRange, range);
      // The dodge begins when the round reaches the trigger range and then runs
      // its full 1.5 s, exactly as the flight model would fly it.
      if (dodgeAt !== null && !maneuver && range <= dodgeAt) maneuver = { kind: "roll", t: 0 };
      if (maneuver) {
        maneuver.t = Math.min(1, maneuver.t + dt / ROLL.duration);
        // A barrel roll is not a straight line: the player displaces laterally.
        player.position.x += Math.sin(maneuver.t * Math.PI * 2) * 70 * dt;
        player.velocity.set(Math.sin(maneuver.t * Math.PI * 2) * 70, 0, -250);
        if (maneuver.t >= 1) maneuver = null;
      }
      evasion.inPeak = inDodgePeak(maneuver, expert);
      player.position.z -= 250 * dt;
      system.update(dt);
    }
    return { hit, expired, minRange, lost: m.lost, m };
  };

  const straight = run({});
  check("enemy missile: an unmanoeuvring player is hit (§47)", straight.hit === 1 && straight.expired === 0, straight);

  const early = run({ dodgeAt: 2400 });
  check("enemy missile: rolling the instant it launches is not a dodge (§48)", early.hit === 1, early);

  const timed = run({ dodgeAt: 460 });
  check("enemy missile: a timed roll defeats it (§49)", timed.hit === 0 && timed.expired === 1, timed);
  check("enemy missile: and the miss is a real overshoot, not a despawn (§28)", timed.lost === true, timed);
  check("enemy missile: the timed dodge was earned close in (§43)", evadeEarned(timed.minRange), timed.minRange);
  check("enemy missile: nothing orbits the player forever (§27)", timed.expired === 1);
}

{
  /* §29 — a round that flies into the island dies there. */
  const scene = new THREE.Scene();
  const shooter = new THREE.Object3D();
  shooter.position.set(0, 300, 0);
  scene.add(shooter);
  shooter.updateMatrixWorld(true);
  let reason = null;
  const system = createMissileSystem({ scene, prototype: null, groundAt: () => 280 });
  system.on("expire", (e) => (reason = e.reason));
  // Aimed at a point below the terrain: it flies into the ground on the way.
  const target = { position: new THREE.Vector3(0, 0, -3000), velocity: new THREE.Vector3(), alive: true };
  system.fire({ mount: shooter, target, ownerSpeed: 200, owner: "hostile", cfg: HOSTILE_MISSILE });
  let steps = 0;
  while (system.inFlight && steps < 60 * 10) {
    system.update(1 / 60);
    steps++;
  }
  check("terrain: a missile that hits the ground is destroyed there", reason === "TERRAIN", reason);
  check("terrain: well inside its lifetime", steps / 60 < HOSTILE_MISSILE.lifetime, steps / 60);

  // §14 — ownership travels with the round, and the two owners do not mix.
  const both = createMissileSystem({ scene, prototype: null });
  both.fire({ mount: shooter, target: null, owner: "player" });
  both.fire({ mount: shooter, target: null, owner: "hostile", cfg: HOSTILE_MISSILE });
  check("ownership: rounds are separable by owner", both.ownedBy("hostile").length === 1 && both.ownedBy("player").length === 1);
  check("ownership: each carries its own numbers", both.ownedBy("hostile")[0].cfg.turnRateDeg === HOSTILE_MISSILE.turnRateDeg && both.ownedBy("player")[0].cfg.turnRateDeg === MISSILE.turnRateDeg);
  both.reset();
  check("reset: no stale hostile round survives (§38)", both.inFlight === 0);
}

{
  /* §30–§32/§47 — one hit, one response. A proximity fuze can trip on
   * consecutive frames and a response that re-entered would loop the reset. */
  let hits = 0;
  let recovers = 0;
  const response = createDevelopmentHitResponse({ onHit: () => hits++, onRecover: () => recovers++, holdTime: 0.5, cooldown: 0.5 });
  const ev = () => createPlayerDamageEvent({ source: DamageSource.MISSILE, at: 0, position: { x: 0, y: 0, z: 0 } });

  check("damage: the event is data, not behaviour", typeof ev().source === "string" && ev().source === DamageSource.MISSILE);
  check("damage: the first hit is accepted", response.apply(ev()) === true && hits === 1);
  check("damage: a second hit in the same instant is swallowed", response.apply(ev()) === false && hits === 1);
  check("damage: it reports itself while holding", response.feedback === "HIT" && response.state.impact > 0.9);
  for (let i = 0; i < 35; i++) response.update(1 / 60);
  check("damage: the response recovers exactly once", recovers === 1 && !response.state.holding, [recovers]);
  check("damage: and a hit during the settling cooldown is still refused", response.apply(ev()) === false && hits === 1);
  for (let i = 0; i < 40; i++) response.update(1 / 60);
  check("damage: once settled, a new hit is a new response", response.apply(ev()) === true && hits === 2);
  check("damage: the impact cue decays rather than switching off", response.state.impact > 0);
  response.reset();
  check("damage: reset clears the hold", !response.state.holding && response.state.impact === 0);
}

{
  /* The monitor as the HUD sees it. */
  const monitor = createThreatMonitor();
  const at = { x: 0, y: 700, z: 0 };
  const f = { x: 0, y: 0, z: -1 };
  const r = { x: 1, y: 0, z: 0 };
  const u = { x: 0, y: 1, z: 0 };
  const ctx = (over = {}) => ({ hostile: {}, incoming: [], position: at, forward: f, right: r, up: u, expert: false, maneuver: null, ...over });

  monitor.update(ctx(), 1 / 60);
  check("monitor: quiet sky, quiet HUD", monitor.state.level === ThreatLevel.NONE && monitor.state.arrow === "");
  monitor.update(ctx({ hostile: { tracking: true, lockProgress: 0.4 } }), 1 / 60);
  check("monitor: acquisition surfaces as TRACK with its progress", monitor.state.level === ThreatLevel.TRACK && monitor.state.lockProgress === 0.4);

  const round = { owner: "hostile", position: { x: 400, y: 700, z: -100 }, dir: { x: -1, y: 0, z: 0 }, authority: 1 };
  monitor.update(ctx({ hostile: { locked: true }, incoming: [round] }), 1 / 60);
  check("monitor: a round in the air is MISSILE with a direction and a range", monitor.state.level === ThreatLevel.MISSILE && monitor.state.arrow === "\u25b6" && monitor.state.distance > 400, monitor.state);
  // The first frame of a threat has nothing to difference against, and a
  // fabricated closure there reads as tens of thousands of m/s on the rail.
  check("monitor: the first frame of a new threat reports no closure", monitor.state.closing === 0, monitor.state.closing);
  round.position.x = 394; // one frame of real flight, not a teleport
  monitor.update(ctx({ incoming: [round] }), 1 / 60);
  check("monitor: closing speed is measured, not guessed", monitor.state.closing > 0, monitor.state.closing);
  // Bounded by physics, not merely by sign: nothing in this game closes at more
  // than the missile's speed plus the player's.
  check("monitor: and it is a physically possible number", monitor.state.closing < 1500, monitor.state.closing);
  // A different round becoming the nearest is a new history, not a jump.
  const second = { owner: "hostile", position: { x: 40, y: 700, z: 0 }, dir: { x: -1, y: 0, z: 0 }, authority: 1 };
  monitor.update(ctx({ incoming: [round, second] }), 1 / 60);
  check("monitor: a new nearest round does not fabricate a closure", monitor.state.closing === 0, monitor.state.closing);
  monitor.reset();
  check("monitor: reset silences it", monitor.state.level === ThreatLevel.NONE && monitor.state.distance === 0);
}

{
  /* §36/§52 — the player's own weapons are untouched by all of the above. The
   * AIM-9 still kills the hostile while it is attacking. */
  const scene = new THREE.Scene();
  const ac = new THREE.Object3D();
  ac.position.set(0, 700, 0);
  const mounts = createWeaponMounts(ac);
  ac.updateMatrixWorld(true);
  const system = createMissileSystem({ scene, prototype: null });
  const drone = createTargetDrone();
  const hostile = createHostileAI({ drone });
  drone.position.set(60, 760, -1200);
  let killed = false;
  system.on("hit", ({ missile, target }) => {
    if (missile.owner !== "player") return;
    markTargetHit(target, 0);
    killed = true;
  });
  system.fire({ mount: mounts.right, target: drone, ownerSpeed: 240, side: 1, owner: "player" });
  const player = { position: new THREE.Vector3(0, 700, 0), velocity: new THREE.Vector3(0, 0, -250), alive: true };
  for (let i = 0; i < 60 * 8 && !killed; i++) {
    hostile.update(player, 1 / 60);
    system.update(1 / 60);
  }
  check("counterattack: an AIM-9 still kills a manoeuvring hostile (§36)", killed && !drone.alive);
  hostile.update(player, 1 / 60);
  check("counterattack: and the kill shuts its AI down (§37)", hostile.state.phase === HostileState.DESTROYED);

  // §37 — but a round already in the air keeps flying. Fired at a player who is
  // two kilometres away, or the proximity fuze would trip on the launch frame.
  player.position.set(0, 700, -2000);
  const enemyRound = system.fire({ mount: mounts.left, target: player, ownerSpeed: 200, owner: "hostile", cfg: HOSTILE_MISSILE });
  system.update(1 / 60);
  check("counterattack: a launched hostile round outlives its launcher (§37)", system.ownedBy("hostile").includes(enemyRound));
}


/* ======================= Stage 04.0 — mission & launch ======================= */

/* ---- the catapult curve (§9/§10) ---- */
{
  check("launch: the ease is monotonic and closed at both ends", strokeEase(0) === 0 && strokeEase(1) === 1 && strokeEase(0.4) < strokeEase(0.6), [strokeEase(0.4), strokeEase(0.6)]);
  check("launch: acceleration keeps increasing (a violent deck exit)", strokeSpeed(0.9) - strokeSpeed(0.8) > strokeSpeed(0.2) - strokeSpeed(0.1), [strokeSpeed(0.9) - strokeSpeed(0.8), strokeSpeed(0.2) - strokeSpeed(0.1)]);

  // Closed form against a numeric integral of the same curve.
  const T = 2.6;
  let numeric = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) numeric += strokeSpeed((i + 0.5) / n) * (T / n);
  const closed = strokeDistance(T, LAUNCH.startSpeed, LAUNCH.exitSpeed, LAUNCH.strokeExponent);
  check("launch: closed-form stroke distance matches the integral", Math.abs(closed - numeric) < 0.05, [closed, numeric]);

  const t = solveStrokeTime(199.7);
  check("launch: solveStrokeTime inverts strokeDistance", Math.abs(strokeDistance(t) - 199.7) < 1e-6, strokeDistance(t));
  const v1 = solveExitSpeed(199.7, 2.4);
  check("launch: solveExitSpeed closes the same geometry", Math.abs(strokeDistance(2.4, LAUNCH.startSpeed, v1) - 199.7) < 1e-6, [v1, strokeDistance(2.4, LAUNCH.startSpeed, v1)]);
}

{
  // The real deck: 199.7 m between the measured LaunchStart and LaunchEnd.
  const plan = planStroke(199.68);
  check("launch: the measured deck solves inside the playable band", plan.time >= LAUNCH.strokeMin && plan.time <= LAUNCH.strokeMax, plan.time);
  check("launch: and keeps the authored deck-exit speed", !plan.clamped && plan.exitSpeed === LAUNCH.exitSpeed, [plan.clamped, plan.exitSpeed]);
  check("launch: exit speed is inside §10's handoff band", plan.exitSpeed >= 120 && LAUNCH.handoffSpeed >= 160 && LAUNCH.handoffSpeed <= 180, [plan.exitSpeed, LAUNCH.handoffSpeed]);
  check(
    "launch: the stroke covers the run exactly",
    Math.abs(strokeDistance(plan.time, LAUNCH.startSpeed, plan.exitSpeed) - 199.68) < 1e-6,
    strokeDistance(plan.time, LAUNCH.startSpeed, plan.exitSpeed)
  );

  // A much shorter deck has to clamp the TIME and give up the exit speed, not
  // the geometry: the aircraft must still leave the cat at the release point.
  const short = planStroke(90);
  check("launch: a short run clamps the time, not the release point", short.clamped && short.time === LAUNCH.strokeMin, [short.clamped, short.time]);
  check(
    "launch: ...and re-solves the exit speed so the run still closes",
    Math.abs(strokeDistance(short.time, LAUNCH.startSpeed, short.exitSpeed) - 90) < 1e-6,
    [short.exitSpeed, strokeDistance(short.time, LAUNCH.startSpeed, short.exitSpeed)]
  );

  check("launch: the whole sequence is about fifteen seconds", sequenceDuration(plan) > 13 && sequenceDuration(plan) < 17, sequenceDuration(plan));
  // 05.1 sets the dwell to the length of the engine start-up played at double
  // speed, so the sound runs to its end and the catapult fires on the last note
  // — the wait is a countdown rather than a delay.
  check("launch: the dwell holds the whole engine start-up", LAUNCH.deckDwell > 9 && LAUNCH.deckDwell < 13, LAUNCH.deckDwell);
  check("launch: the burner lights before the cat fires", LAUNCH.afterburnerAt < LAUNCH.deckDwell, [LAUNCH.afterburnerAt, LAUNCH.deckDwell]);
  /**
   * THE DECK IS STILL AND THE CATAPULT IS NOT. The dwell used to ramp a shimmer
   * from 0.02 to 0.16; it ran for the full eleven seconds of the engine
   * start-up, before the player had touched anything, and an unsteady frame that
   * early reads as a fault in the game rather than as power in the aircraft.
   *
   * The old check asserted that the ramp existed, so it is deleted rather than
   * adapted (§18) and replaced by the property that now matters: the contrast.
   * Asserted through the sequence itself, not off the config — the constant
   * being zero says nothing about what the player is shown.
   */
  {
    // ARMED, then driven. An un-armed sequence sits in IDLE with shake 0, so
    // "the deck does not shake" would pass without the deck ever existing —
    // which is what the first draft of this check did, and the stroke assertion
    // below is what caught it (§17.14).
    const shakeAt = (t) => {
      const seq = createLaunchSequence();
      seq.arm({ x: 0, y: 18, z: -1546.75 }, { x: 0, y: 18, z: -1746.43 });
      for (let i = 0; i < Math.round(t * 60); i++) seq.update(1 / 60, false);
      return { shake: seq.state.shake, stage: seq.state.stage };
    };
    const parked = [0.5, 3, 6, 9, 10.5].map(shakeAt);
    check("launch: the spool-up really is the DECK stage", parked.every((r) => r.stage === LaunchStage.DECK), parked.map((r) => r.stage));
    check("launch: and the deck does not shake at any point in it", parked.every((r) => r.shake === 0), parked.map((r) => r.shake));
    const rolling = shakeAt(LAUNCH.deckDwell + 1);
    check("launch: ...while the catapult stroke does", rolling.stage === LaunchStage.STROKE && rolling.shake > 0, rolling);
  }
}

{
  check("launch: the throttle spools rather than jumping", spoolThrottle(0) < 0.1 && spoolThrottle(5) > spoolThrottle(2) && spoolThrottle(LAUNCH.deckDwell) === 1, [spoolThrottle(0), spoolThrottle(2), spoolThrottle(5)]);
  check("launch: FOV opens from the deck value toward the exit value (§12)", launchFov("DECK", 0) === LAUNCH.fovDeck && launchFov("STROKE", 0.5) > LAUNCH.fovDeck && launchFov("STROKE", 1) === LAUNCH.fovExit, [launchFov("STROKE", 0.5)]);
  check("launch: and never past a comfortable value", LAUNCH.fovExit <= 72, LAUNCH.fovExit);
}

{
  // A full sequence, driven at 60 Hz along the real launch frame.
  const seq = createLaunchSequence();
  const start = { x: 0, y: 18, z: -1546.75 };
  const end = { x: 0, y: 18, z: -1746.43 };
  const plan = seq.arm(start, end);
  check("launch: arming derives the run from the anchors", Math.abs(plan.run - 199.68) < 0.01, plan.run);
  check("launch: the parked pose sits on the deck, gear down", Math.abs(seq.pose.y - (18 + LAUNCH.deckLift)) < 1e-6 && seq.state.gearDown, [seq.pose.y, seq.state.gearDown]);
  // 05.4 — the deck can be held, so the countdown starts only when the caller says
  // it may. On a fresh load audio is not yet armed (a browser needs a gesture), and
  // an unheld deck ran its whole engine start-up into a blocked audio context.
  const heldSeq = createLaunchSequence();
  heldSeq.arm(start, end);
  for (let i = 0; i < 180; i++) heldSeq.update(1 / 60, true);
  check("launch: a held deck does not advance", heldSeq.state.t === 0 && heldSeq.state.held && heldSeq.state.stage === LaunchStage.DECK, [heldSeq.state.t, heldSeq.state.held]);
  heldSeq.update(1 / 60, false);
  check("launch: releasing the hold starts the countdown", heldSeq.state.t > 0 && !heldSeq.state.held, heldSeq.state.t);
  // ...and the hold only applies at the very start: it must never freeze a launch
  // that is already rolling.
  for (let i = 0; i < 60; i++) heldSeq.update(1 / 60, true);
  check("launch: the hold cannot pause a launch in progress", heldSeq.state.t > 0.9, heldSeq.state.t);
  check("launch: parked heading is the launch axis", Math.abs(seq.pose.heading) < 1e-9, seq.pose.heading);

  let handoffs = 0;
  let handoffAt = 0;
  let gearUpAt = 0;
  let strokeMax = 0;
  let strokeEndAt = 0;
  let maxLateral = 0;
  let prevStage = seq.state.stage;
  let clock = 0;
  for (let i = 0; i < 900; i++) {
    seq.update(1 / 60);
    clock += 1 / 60;
    if (seq.state.stage === LaunchStage.STROKE) strokeMax = Math.max(strokeMax, seq.state.distance);
    if (prevStage === LaunchStage.STROKE && seq.state.stage !== LaunchStage.STROKE) strokeEndAt = clock;
    if (!gearUpAt && !seq.state.gearDown) gearUpAt = clock;
    if (seq.state.handoff) {
      handoffs += 1;
      handoffAt = clock;
    }
    maxLateral = Math.max(maxLateral, Math.abs(seq.pose.x));
    prevStage = seq.state.stage;
  }
  check("launch: control is handed over exactly once", handoffs === 1, handoffs);
  check("launch: at the scripted time (§8: ~5.2 s)", Math.abs(handoffAt - sequenceDuration(plan)) < 0.05, [handoffAt, sequenceDuration(plan)]);
  // The stroke never runs past the release point, and gets within one frame of it.
  check("launch: the stroke ends at the release point", strokeMax <= plan.run + 1e-9 && plan.run - strokeMax < plan.exitSpeed / 60, [strokeMax, plan.run]);
  check("launch: the deck edge comes before the gear and the handoff (§7)", strokeEndAt < gearUpAt && gearUpAt < handoffAt, [strokeEndAt, gearUpAt, handoffAt]);
  check("launch: gear is up before the player has the aircraft", gearUpAt > 0 && !seq.state.gearDown, gearUpAt);
  check("launch: the handoff speed is the flight model's seed", seq.state.speed === LAUNCH.handoffSpeed && seq.state.throttle === LAUNCH.handoffThrottle, [seq.state.speed, seq.state.throttle]);
  check("launch: nothing drifts off the launch axis", maxLateral < 1e-9, maxLateral);
  check("launch: it is nose-up by the handoff", seq.pose.pitch > 8 * DEG, seq.pose.pitch / DEG);
  check("launch: and stops (one sequence, not a loop)", seq.state.done && seq.state.stage === LaunchStage.DONE, seq.state.stage);

  // Frame-rate independence: the release point is closed-form, not accumulated,
  // so a 20 Hz frame gets just as close to it as a 60 Hz one — within its own
  // single frame of travel.
  const slow = createLaunchSequence();
  slow.arm(start, end);
  let slowMax = 0;
  for (let i = 0; i < 300; i++) {
    slow.update(1 / 20);
    if (slow.state.stage === LaunchStage.STROKE) slowMax = Math.max(slowMax, slow.state.distance);
  }
  check("launch: the release point is frame-rate independent", slowMax <= plan.run + 1e-9 && plan.run - slowMax < plan.exitSpeed / 20, [slowMax, plan.run]);
}

/* ---- phase bookkeeping (§5/§33/§38) ---- */
{
  const P = MissionPhase;
  check("mission: every phase in the enum is ordered", PHASE_ORDER.length === Object.keys(P).length, PHASE_ORDER.length);
  check("mission: checkpoints map as §38 describes", phaseCheckpoint(P.DECK) === 0 && phaseCheckpoint(P.EGRESS) === 1 && phaseCheckpoint(P.DEFENSIVE) === 1 && phaseCheckpoint(P.TERRAIN) === 2 && phaseCheckpoint(P.FINAL) === 3 && phaseCheckpoint(P.EXTRACTION) === 3);
  check("mission: exactly four phases open a checkpoint", PHASE_ORDER.filter(opensCheckpoint).length === MISSION.checkpoints, PHASE_ORDER.filter(opensCheckpoint));
  check("mission: only three phases carry an encounter (§5)", PHASE_ORDER.filter((p) => !!encounterFor(p)).length === 3, PHASE_ORDER.filter((p) => !!encounterFor(p)));
  check("mission: INTERCEPT is one-way pressure — the hostile has no rounds (§22)", encounterFor(P.INTERCEPT).ammo === 0, encounterFor(P.INTERCEPT));
  check("mission: DEFENSIVE is the phase that shoots back (§24)", encounterFor(P.DEFENSIVE).ammo === 2, encounterFor(P.DEFENSIVE));
  check("mission: weapons are cold on the deck and at the end", !weaponsHotIn(P.DECK) && !weaponsHotIn(P.LAUNCH) && !weaponsHotIn(P.COMPLETE) && weaponsHotIn(P.TERRAIN));
  check("mission: the player does not fly the deck or the complete screen", !playerFliesIn(P.DECK) && !playerFliesIn(P.LAUNCH) && !playerFliesIn(P.COMPLETE) && playerFliesIn(P.EGRESS));
}

/* ---- trigger volumes (§19/§32) ---- */
{
  const t = createTrigger({ name: "VALLEY", position: { x: 100, y: 400, z: -9000 }, radius: 1400 });
  check("trigger: dead centre is inside", insideTrigger(t, { x: 100, y: 400, z: -9000 }));
  check("trigger: 50 m beside the line still counts (§19)", insideTrigger(t, { x: 150, y: 400, z: -9000 }));
  check("trigger: altitude does not gate a route waypoint", insideTrigger(t, { x: 100, y: 40, z: -9000 }) && insideTrigger(t, { x: 100, y: 3000, z: -9000 }));
  check("trigger: outside the radius is outside", !insideTrigger(t, { x: 100, y: 400, z: -9000 - 1500 }));

  const rec = createTrigger({ name: "RECOVERY", position: { x: 0, y: 700, z: -4000 }, radius: 2400, altitudeMin: 80, altitudeMax: 3800 });
  check("extraction: forgiving in the horizontal (§32)", insideTrigger(rec, { x: 1800, y: 700, z: -4000 }));
  check("extraction: but does care about altitude", !insideTrigger(rec, { x: 0, y: 20, z: -4000 }) && !insideTrigger(rec, { x: 0, y: 5000, z: -4000 }));

  check("mission: bearing uses the flight model's convention (0 = -Z)", Math.abs(bearingTo({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -100 })) < 1e-9, bearingTo({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -100 }));
  check("mission: range is horizontal, so altitude cannot fake arrival", Math.abs(flatDistanceTo({ x: 0, y: 0, z: 0 }, { x: 300, y: 9999, z: 400 }) - 500) < 1e-9);
}

/* ---- terrain route selection (§27) ---- */
{
  // A band with a genuine pass at x = 0 and a one-sided slope at x = -2000.
  const samples = [];
  for (let x = -3000; x <= 3000; x += 200) {
    let h = 400;
    if (x <= -1600) h = 400 + (-1600 - x) * 0.2; // rising ground: one flank only
    if (Math.abs(x) < 400) h = 90; // the pass
    if (Math.abs(x - 1400) < 300) h = 620; // a peak beside it
    samples.push({ x, height: h });
  }
  const f = bandFeature(samples, 5);
  check("route: the pass with higher ground on BOTH sides wins", Math.abs(f.x) < 400, f);
  check("route: and the score is the weaker flank, not the stronger", Math.abs(f.score - (Math.min(f.left, f.right) - f.height)) < 1e-9, f);

  const bands = [];
  for (let z = -9000; z >= -19000; z -= 1000) {
    const s = samples.map((p) => ({ x: p.x, height: p.height + (z % 3000 === 0 ? -40 : 0) }));
    bands.push({ z, samples: s });
  }
  const picked = pickRouteFeatures(bands, 3, 2600, 5);
  check("route: three features are chosen", picked.length === 3, picked.length);
  check("route: spread by at least the minimum separation", Math.abs(picked[0].z - picked[1].z) >= 2600 && Math.abs(picked[1].z - picked[2].z) >= 2600, picked.map((p) => p.z));
  check("route: returned in flight order (nearest the coast first)", picked[0].z > picked[1].z && picked[1].z > picked[2].z, picked.map((p) => p.z));

  // A synthetic height field, sampled the way the live physics index is.
  const surveyed = surveyTerrainRoute((x, z) => 300 + Math.abs(x - 800) * 0.08 + Math.sin(z / 900) * 60, -7600);
  check("route: the survey finds features in a synthetic field", surveyed.length === 3 && surveyed.every((s) => Number.isFinite(s.x) && Number.isFinite(s.z)), surveyed.map((s) => [s.x, s.z]));
  check("route: and spreads them along the corridor (§28)", surveyed[0].z > surveyed[1].z && surveyed[1].z > surveyed[2].z && Math.abs(surveyed[0].z - surveyed[2].z) > 6000, surveyed.map((s) => s.z));

  // Zoning exists because scoring alone clusters. A field whose three deepest
  // passes are all in the last third must still yield one waypoint per third.
  const clustered = [];
  for (let z = -9000; z >= -21000; z -= 600) {
    const s = [];
    for (let x = -3000; x <= 3000; x += 200) {
      const deep = z < -17000 && Math.abs(x) < 400;
      s.push({ x, height: deep ? 20 : 400 + Math.abs(x) * 0.1 });
    }
    clustered.push({ z, samples: s });
  }
  const zoned = pickZonedFeatures(clustered, 3, 5);
  const per = Math.floor(clustered.length / 3);
  const thirdOf = (z) => Math.min(2, Math.floor(clustered.findIndex((b) => b.z === z) / per));
  const thirds = zoned.map((f) => thirdOf(f.z));
  check("route: zoning puts one feature in each third of the corridor (§28)", new Set(thirds).size === 3, thirds);
  // ...whereas scoring alone puts every pick in the third that happens to hold
  // the deepest ground, which is the clustering this function exists to stop.
  check("route: scoring alone would cluster them", new Set(pickRouteFeatures(clustered, 3, 2600, 5).map((f) => thirdOf(f.z))).size < 3, pickRouteFeatures(clustered, 3, 2600, 5).map((f) => thirdOf(f.z)));
  check("route: one feature per zone", zoned.length === 3);
}

{
  const features = [
    { x: 680, z: -12700, height: 91 },
    { x: 1520, z: -15300, height: 86 },
    { x: -2260, z: -17900, height: 87 },
  ];
  const route = planRoute({ coastZ: -7600, features });
  check("route: every leg is a trigger volume", route.every((l) => l.position && l.radius > 0), route.length);
  check("route: every phase that navigates has at least one leg", [MissionPhase.EGRESS, MissionPhase.INTERCEPT, MissionPhase.DEFENSIVE, MissionPhase.TERRAIN, MissionPhase.FINAL, MissionPhase.EXTRACTION].every((p) => route.some((l) => l.phase === p)));
  const intercept = route.find((l) => l.phase === MissionPhase.EGRESS && l.name === "INTERCEPT");
  const coastline = route.find((l) => l.phase === MissionPhase.INTERCEPT);
  const gap = Math.abs(intercept.position.z - coastline.position.z) - intercept.radius - coastline.radius;
  // If these two volumes touch, arriving in the intercept area instantly
  // satisfies "the player reached the next mission region" for a fight that has
  // not started — which is exactly the bug this check was written for.
  check("route: the intercept and coastline volumes do not overlap", gap > 0, gap);
  const terrainLegs = route.filter((l) => l.phase === MissionPhase.TERRAIN);
  check("route: terrain anchors clear the ground they sit over (§27)", terrainLegs.every((l, i) => l.position.y >= features[i].height + 100), terrainLegs.map((l) => l.position.y));
  check("route: the recovery leg is offshore, back toward the carrier (§31)", route[route.length - 1].position.z > -7600, route[route.length - 1].position.z);
  // The island may have failed to load; the mission still has to be flyable.
  check("route: a build with no terrain index still gets a full route", planRoute({ coastZ: -7600, features: [] }).length === route.length);
}

/**
 * BOTH MARKING VIEWPORTS, asserted as rules rather than looked at.
 *
 * The course marks every prototype at 1920x1080 and at 390x844 — the phone
 * preset in Chrome DevTools' device toolbar — and both are full marking
 * environments. The phone one is PORTRAIT, which is what these two rules exist
 * for; a flight game is held sideways, but the marker's default is not, and
 * "works cleanly at both" is the bar.
 */
const VIEWPORTS = { desktop: [1920, 1080], portrait: [390, 844], landscape: [844, 390] };

{
  // The instruments scale on the SMALLER dimension, so a phone is treated the
  // same held either way up.
  const desk = uiScaleFor(...VIEWPORTS.desktop);
  const port = uiScaleFor(...VIEWPORTS.portrait);
  const land = uiScaleFor(...VIEWPORTS.landscape);
  check("viewport: the desktop HUD is the one it was drawn at", desk === 1, desk);
  check("viewport: a phone shrinks the instruments", port < 0.8 && land < 0.8, [port, land]);
  check("viewport: ...and by the same amount either way up", Math.abs(port - land) < 1e-9, [port, land]);
  check("viewport: a bigger monitor does not get a bigger HUD", uiScaleFor(3840, 2160) === 1, uiScaleFor(3840, 2160));
  check("viewport: and there is a floor, so instruments never vanish", uiScaleFor(200, 200) === HUD.uiScaleMin, uiScaleFor(200, 200));

  // The radar has to stay inside the frame at the smallest viewport, which is
  // the thing the scale exists to guarantee. 2R + margin, against the width.
  const r = HUD.radarRadius * port;
  check("viewport: the radar still fits the phone frame", 2 * r + 2 * HUD.radarMargin * port < VIEWPORTS.portrait[0], Math.round(2 * r + 2 * HUD.radarMargin * port));
}

{
  /**
   * three.js's `fov` is the VERTICAL one, so a portrait viewport narrows the
   * view without changing a single number in the composition. At 390x844 a 66°
   * lens showed ~34° across: the aircraft filled the frame and the world it was
   * flying through was squeezed out either side. §17.14 — assert the horizontal
   * angle, which is the thing that was wrong, not the vertical one, which was
   * always fine.
   */
  const hFov = (v, aspect) => (2 * Math.atan(Math.tan((v * Math.PI) / 360) * aspect) * 180) / Math.PI;
  for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
    const aspect = w / h;
    const v = fovForAspect(66, aspect);
    check(`viewport: ${name} keeps a flyable horizontal field of view`, hFov(v, aspect) >= CHASE.minHorizontalFov - 1e-6, Math.round(hFov(v, aspect)));
  }
  const wide = fovForAspect(66, 1920 / 1080);
  check("viewport: ...and a landscape viewport is left completely alone", wide === 66, wide);
  const tall = fovForAspect(66, 390 / 844);
  check("viewport: while a portrait one is widened to earn it", tall > 66, Math.round(tall));
  check("viewport: an absurd aspect is not allowed to invert the lens", fovForAspect(66, 0) === 66 && fovForAspect(66, -1) === 66);
}

/* ---- the transition table (§3, §21–§25) ---- */
{
  const P = MissionPhase;
  const T = (phase, phaseTime, legDone, ctx = {}) =>
    missionTransition({ phase, phaseTime, legDone }, { strokeStarted: false, launchDone: false, hostileAlive: true, hostileSpent: false, recoveryDone: false, ...ctx });

  check("table: DECK waits for the catapult", T(P.DECK, 5, false) === P.DECK && T(P.DECK, 0.1, false, { strokeStarted: true }) === P.LAUNCH);
  check("table: LAUNCH waits for the handoff, not a timer", T(P.LAUNCH, 30, false, { strokeStarted: true }) === P.LAUNCH && T(P.LAUNCH, 1, false, { launchDone: true }) === P.EGRESS);
  check("table: EGRESS advances on arrival", T(P.EGRESS, 5, true) === P.INTERCEPT && T(P.EGRESS, 5, false) === P.EGRESS);

  check("table: INTERCEPT holds for its floor even if the region is met", T(P.INTERCEPT, 5, true) === P.INTERCEPT);
  check("table: INTERCEPT ends on a kill without waiting out the floor (§23)", T(P.INTERCEPT, 8, false, { hostileAlive: false }) === P.DEFENSIVE);
  check("table: but a kill still gets a beat to land", T(P.INTERCEPT, 2, false, { hostileAlive: false }) === P.INTERCEPT);
  check("table: ignoring combat entirely still advances, on the region (§51)", T(P.INTERCEPT, MISSION.floor.INTERCEPT, true) === P.DEFENSIVE);

  check("table: DEFENSIVE ends when the attack cycle is done (§25)", T(P.DEFENSIVE, MISSION.floor.DEFENSIVE, false, { hostileSpent: true }) === P.TERRAIN);
  check("table: ...but not before its floor", T(P.DEFENSIVE, 5, false, { hostileSpent: true }) === P.DEFENSIVE);
  check("table: DEFENSIVE also ends at the terrain volume", T(P.DEFENSIVE, MISSION.floor.DEFENSIVE, true) === P.TERRAIN);

  check("table: TERRAIN and FINAL advance on the last leg", T(P.TERRAIN, 1, true) === P.FINAL && T(P.FINAL, 1, true) === P.EXTRACTION);

  /**
   * NO PHASE ADVANCES ON TIME. The per-phase fallbacks were removed after they
   * turned out to be the normal path rather than a safety net: TERRAIN's was
   * 66 s for a ~15 km inland route that takes over 75 s at cruise, so RIDGE and
   * SEAWARD advanced on their own every run whether or not the player went
   * there. Reported from play as "they are automatically achieved, even I am
   * not here".
   *
   * Asserted by holding every phase at an absurd phaseTime with its condition
   * unmet — §17.14, because "the mission completes" passes either way. What has
   * to hold is that the clock alone moves nothing.
   */
  const stallable = [P.EGRESS, P.INTERCEPT, P.DEFENSIVE, P.TERRAIN, P.FINAL];
  check(
    "table: no phase advances on time alone — the clock moves nothing (§10)",
    stallable.every((p) => T(p, 100000, false) === p),
    stallable.filter((p) => T(p, 100000, false) !== p)
  );
  check("table: EXTRACTION does not start its cinematic on a timer either", T(P.EXTRACTION, 100000, false) === P.EXTRACTION);
  check("table: the run still ends — the deadline is what ends it", missionExpired(MISSION.deadline, P.TERRAIN) === true);
  check("table: EXTRACTION waits for the cinematic, not the trigger", T(P.EXTRACTION, 200, true) === P.EXTRACTION && T(P.EXTRACTION, 1, false, { recoveryDone: true }) === P.COMPLETE);
  check("table: COMPLETE is terminal", T(P.COMPLETE, 999, true, { hostileAlive: false }) === P.COMPLETE);
  check("table: no phase promotes itself twice in one call", PHASE_ORDER.every((p) => PHASE_ORDER.indexOf(T(p, 0, false)) - PHASE_ORDER.indexOf(p) <= 1));
}

/* ---- the autopilot (§33/§34) ---- */
{
  const level = { heading: 0, pitch: 0, altitude: 700, speed: 190 };
  const goal = { heading: 0, altitude: 700, speed: 190 };
  const at = autopilotStick(level, goal);
  check("autopilot: on target it commands almost nothing", Math.abs(at.x) < 1e-9 && Math.abs(at.y) < 1e-9 && Math.abs(at.throttle) < 1e-9, at);
  check("autopilot: a heading error commands bank the short way", autopilotStick({ ...level, heading: -0.4 }, goal).x > 0 && autopilotStick({ ...level, heading: 0.4 }, goal).x < 0);
  check("autopilot: it takes the short way round the seam", autopilotStick({ ...level, heading: Math.PI - 0.1 }, { ...goal, heading: -Math.PI + 0.1 }).x > 0);
  check("autopilot: below the goal it pulls up, above it pushes down", autopilotStick({ ...level, altitude: 300 }, goal).y > 0 && autopilotStick({ ...level, altitude: 1200 }, goal).y < 0);
  check("autopilot: pitch is damped, so it levels rather than porpoising", autopilotStick({ ...level, pitch: 12 * DEG }, goal).y < 0, autopilotStick({ ...level, pitch: 12 * DEG }, goal).y);
  check("autopilot: slow means throttle up", autopilotStick({ ...level, speed: 140 }, goal).throttle > 0);
  check("autopilot: bank authority stays inside the stick", Math.abs(autopilotStick({ ...level, heading: -3 }, goal).x) <= AUTOPILOT.bankAuthority + 1e-9);

  const player = { x: 1, y: -1, roll: 1, throttle: 1 };
  const auto = { x: -1, y: 1, roll: 0, throttle: 0 };
  check("handover: k=0 is the player, k=1 is the autopilot (§33)", blendStick(player, auto, 0).x === 1 && blendStick(player, auto, 1).x === -1);
  check("handover: and halfway is halfway", Math.abs(blendStick(player, auto, 0.5).x) < 1e-9, blendStick(player, auto, 0.5));
  const out = { x: 0, y: 0, roll: 0, throttle: 0 };
  check("handover: writes into a reused object (no per-frame allocation)", blendStick(player, auto, 0.25, out) === out);
}

/* ---- presentation (§35/§37) ---- */
{
  check("clock: mm:ss.hh", formatClock(258.72) === "04:18.72", formatClock(258.72));
  check("clock: pads the seconds", formatClock(61.5) === "01:01.50", formatClock(61.5));
  check("clock: the short form is mm:ss", formatShortClock(154) === "02:34", formatShortClock(154));
  const rows = missionSummary({ time: 258.72, kills: 2, groundKills: 3, aim9Fired: 1, aim9Loadout: 2, gunFired: 327 });
  check("summary: time and a few combat stats, nothing more (§35)", rows.length === 5 && rows[0].value === "04:18.72" && rows[2].value === "3" && rows[3].value === "1" && rows[4].value === "327", rows);
  // A PLAIN COUNT, not fired/loadout. The magazine refills mid-sortie, so the
  // denominator stops being a fact about anything by the end of a run.
  check("summary: the AIM-9 row is a pure count with no denominator", !rows[3].value.includes("/"), rows[3].value);
  check("summary: ground kills default to zero rather than undefined", missionSummary({ time: 0, kills: 0, aim9Fired: 0, aim9Loadout: 2, gunFired: 0 })[2].value === "0");

  /* ---- the five-minute deadline: now the ONLY clock in the mission ---- */
  const recoveryCost = MISSION.recovery.handover + MISSION.recovery.hold + MISSION.recovery.fade;
  check("deadline: the sortie is capped at five minutes", MISSION.deadline === 300, MISSION.deadline);
  check("deadline: and it is the only timer left — no phase carries its own", MISSION.limit === undefined, MISSION.limit);
  /**
   * THE LOAD-BEARING RELATIONSHIP, restated for a route that must actually be
   * flown. There are no fallbacks to sum any more, so the bar is the route
   * itself: flying every leg, at cruise, through both floors and the closing
   * cinematic, has to finish with room to spare. Otherwise the deadline is not
   * a stake, it is an impossibility.
   *
   * The floors are the only guaranteed dead time — INTERCEPT and DEFENSIVE hold
   * for 26 s and 30 s whatever the player does.
   */
  const floorCost = MISSION.floor.INTERCEPT + MISSION.floor.DEFENSIVE;
  check("deadline: the mandatory floors and cinematic leave most of the clock for flying", floorCost + recoveryCost < MISSION.deadline * 0.3, { floorCost, recoveryCost, deadline: MISSION.deadline });

  /**
   * THE SORTIE IS NOW LOSABLE ON THE CLOCK, which is the whole point of taking
   * the per-phase fallbacks out — C5's brief asks for a game that can be lost.
   *
   * Before, a player who stopped flying was carried to COMPLETE by six timers
   * firing in sequence. Now nothing advances without them, so the run ends at
   * the deadline as a failure. Both halves are asserted: that it does NOT
   * finish, and that the clock does run out — a phase machine that simply
   * hangs would satisfy the first on its own.
   */
  {
    const d = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
    d.setRoute(planRoute({ coastZ: -7600, features: [] }));
    d.reset();
    const pos = { x: 0, y: 600, z: -1546 };
    const dt = 1 / 5;
    let t = 0;
    // Fly the launch, then park: the aircraft is airborne and going nowhere.
    while (t < 400 && d.state.phase !== MissionPhase.COMPLETE) {
      t += dt;
      d.update({ position: pos, strokeStarted: t >= 1.7, launchDone: t >= 5.42, hostileAlive: true, hostileSpent: false }, dt);
    }
    check("deadline: a player who never flies the route does NOT reach COMPLETE", d.state.phase !== MissionPhase.COMPLETE, d.state.phase);
    check("deadline: ...they run out of clock instead, and the run is lost", missionExpired(d.state.missionTime, d.state.phase) === true, Math.round(d.state.missionTime));
    check("deadline: and the phase machine stalls where the player stopped, not at the end", d.state.phase === MissionPhase.EGRESS, d.state.phase);
  }

  check("deadline: not expired before it", missionExpired(299.9, MissionPhase.FINAL) === false);
  check("deadline: expired at it", missionExpired(300, MissionPhase.FINAL) === true);
  check("deadline: expired well past it", missionExpired(420, MissionPhase.TERRAIN) === true);
  // The clock stops at COMPLETE. A run that finished at 4:59.9 must not be
  // failed by a frame that lands after the deadline.
  check("deadline: COMPLETE is exempt, at any time", missionExpired(999, MissionPhase.COMPLETE) === false);
  check("deadline: it applies from the first phase on the clock", missionExpired(301, MissionPhase.EGRESS) === true);

  /* ---- the coastline nav gap ---- */
  {
    /**
     * Two defects reported from play, both at COASTLINE, and both caused by
     * publishing the TRIGGER leg as guidance:
     *
     *   1. INTERCEPT owns exactly one leg. Reaching it exhausted the phase's
     *      list and the marker vanished outright — no diamond, no offscreen
     *      chevron — for as long as the phase floor, which is 26 s.
     *   2. DEFENSIVE then re-selected its own copy of COASTLINE, at the same
     *      coordinates, so the marker pointed BACK at a point already flown
     *      through and asked the player to turn around.
     *
     * Guidance must always name somewhere ahead. Trigger behaviour must not move.
     */
    const features = [
      { x: 400, z: -9200, height: 260 },
      { x: -700, z: -12000, height: 320 },
      { x: 300, z: -15000, height: 420 },
    ];
    const route = planRoute({ coastZ: -7600, features });
    const d = createMissionDirector();
    d.setRoute(route);

    const at = (leg) => ({ x: leg.position.x, y: leg.position.y, z: leg.position.z });
    const legOf = (phase, name) => route.find((l) => l.phase === phase && l.name === name);
    const coastline = legOf(MissionPhase.INTERCEPT, "COASTLINE");
    const pass = legOf(MissionPhase.TERRAIN, "PASS");
    check(
      "nav: COASTLINE really is authored twice, at one position",
      route.filter((l) => l.name === "COASTLINE").length === 2 && legOf(MissionPhase.DEFENSIVE, "COASTLINE").position.z === coastline.position.z
    );

    // Walk the offshore legs so the director is legitimately in INTERCEPT.
    // ctx keys are missionTransition's: strokeStarted, launchDone, hostileAlive.
    // `hostileAlive: true` matters — a dead hostile promotes INTERCEPT on the
    // 6 s kill floor instead of the 26 s encounter floor, which is not the
    // window this test is about.
    const base = { hostileAlive: true, hostileSpent: false, recoveryDone: false, strokeStarted: true, launchDone: true };
    const fly = (pos) => d.update({ ...base, position: pos }, 0.1);
    fly(at(legOf(MissionPhase.EGRESS, "COAST"))); // DECK  -> LAUNCH
    fly(at(legOf(MissionPhase.EGRESS, "COAST"))); // LAUNCH -> EGRESS
    fly(at(legOf(MissionPhase.EGRESS, "COAST"))); // COAST reached
    fly(at(legOf(MissionPhase.EGRESS, "INTERCEPT"))); // INTERCEPT reached -> phase
    check("nav: the sortie is in INTERCEPT after the offshore legs", d.state.phase === MissionPhase.INTERCEPT, d.state.phase);
    check("nav: and points at the coastline", d.state.navName === "COASTLINE", d.state.navName);

    // Reach it. The phase floor has NOT elapsed, so this is exactly the window
    // in which the marker used to disappear.
    fly(at(coastline));
    /**
     * REACHING IT PUBLISHES AN AREA, NOT THE NEXT PHASE'S WAYPOINT.
     *
     * These three checks used to assert the marker fell forward to PASS. That
     * kept something on screen, which was the point, but it was a lie: PASS
     * belongs to TERRAIN, so arriving there advanced nothing and the marker only
     * moved when the floor expired. Reported from play as "I enter 200 m, and
     * pass the NAV, it does not update". So they are rewritten rather than
     * adapted (§18) — the guidance is an AREA now, and the defect they were
     * written for (nothing at all to fly toward) is still covered, by the third
     * check below.
     */
    check("nav: reaching COASTLINE publishes an AREA, not a waypoint", d.state.areaValid === true && d.state.navValid === false, [d.state.areaValid, d.state.navName]);
    check("nav: the area is named for what the player is doing", d.state.areaName === "INTERCEPT", d.state.areaName);
    check("nav: and the player is told they are inside it", d.state.inArea === true, [d.state.areaRange, d.state.areaRadius]);
    check("nav: it never points at a waypoint the trigger cannot consume", d.state.navName !== "PASS", d.state.navName);
    check("nav: still INTERCEPT — the display changed, the phase did not", d.state.phase === MissionPhase.INTERCEPT, d.state.phase);

    // Let INTERCEPT time out into DEFENSIVE, holding position past the coastline.
    for (let i = 0; i < 500 && d.state.phase === MissionPhase.INTERCEPT; i++) {
      fly({ x: coastline.position.x, y: coastline.position.y, z: coastline.position.z - 900 });
    }
    check("nav: INTERCEPT gives way to DEFENSIVE on its own", d.state.phase === MissionPhase.DEFENSIVE, d.state.phase);
    check("nav: DEFENSIVE does NOT point back at the coastline", d.state.navName !== "COASTLINE", d.state.navName);
    // DEFENSIVE inherits a waterline already flown, so it is an area too — which
    // is the whole reason the marker had nothing honest to show there. Its leg is
    // consumed on the phase's first update, not on the frame it is entered, so
    // step once before reading: the area exists from the moment the phase has
    // nothing left to send the player to.
    fly({ x: coastline.position.x, y: coastline.position.y, z: coastline.position.z - 900 });
    check("nav: DEFENSIVE holds the player in an area rather than sending them on", d.state.areaValid === true && d.state.navValid === false, [d.state.areaValid, d.state.navName]);
    check("nav: named for the job", d.state.areaName === "DEFEND", d.state.areaName);
    check("nav: 900 m past the waterline is still inside it", d.state.inArea === true, [Math.round(d.state.areaRange), d.state.areaRadius]);
    // Leave properly and the arrow comes back, pointing at the area behind you.
    for (let i = 0; i < 5; i++) fly({ x: coastline.position.x, y: coastline.position.y, z: coastline.position.z - 9000 });
    check("nav: flying well clear of it reports the player outside", d.state.inArea === false, Math.round(d.state.areaRange));
    check("nav: ...and the area is still published, so an arrow can point back", d.state.areaValid === true, d.state.areaName);
    check("nav: PASS is still an unspent trigger, not skipped", d.state.navPosition.z === pass.position.z);

    // A restart must forget everything reached, or nav falls forward past the
    // whole old route and the new sortie opens with no marker at all.
    d.reset();
    check("nav: a restart points at the first leg again", d.state.navName === "COAST", d.state.navName);
  }
}

/* ---- the failure policy (§39/§40) ---- */
{
  let restores = 0;
  let fails = 0;
  const policy = createMissionCheckpointResponse({ onFail: () => (fails += 1), onRestore: () => (restores += 1) });
  check("failure: the policy names itself, so a swap is visible", policy.name === "MissionCheckpointResponse");
  check("failure: it speaks the CollisionResponse contract physics already uses", typeof policy.handleCollision === "function" && typeof policy.tick === "function");

  check("failure: the first hit is accepted", policy.trigger("TERRAIN IMPACT") === true);
  check("failure: the same instant's second hit is swallowed (§39)", policy.trigger("TERRAIN IMPACT") === false);
  check("failure: onFail ran once", fails === 1, fails);

  // Hold, fade out, restore, fade back in.
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    policy.tick(1 / 60);
    peak = Math.max(peak, policy.state.fade);
  }
  check("failure: it goes fully black before restoring", peak > 0.9 || restores === 0, [peak, restores]);
  for (let i = 0; i < 200; i++) policy.tick(1 / 60);
  check("failure: the checkpoint is restored exactly once", restores === 1, restores);
  check("failure: and the fade comes all the way back", policy.state.fade === 0 && !policy.state.active, [policy.state.fade, policy.state.active]);

  // A hit during the settling cooldown is refused; once settled it is a new one.
  const cooling = createMissionCheckpointResponse({});
  cooling.trigger("X");
  for (let i = 0; i < 400; i++) cooling.tick(1 / 240);
  check("failure: refused while settling", cooling.trigger("X") === false, cooling.state.cooldown);
  for (let i = 0; i < 400; i++) cooling.tick(1 / 60);
  check("failure: accepted once settled", cooling.trigger("X") === true);
  check("failure: two failures, two counts", cooling.state.count === 2, cooling.state.count);
}

{
  // A look-ahead hazard is a PREDICTION, not an impact. The development policy
  // treated it as one and rewound the aircraft clear — an automatic dodge. A
  // mission must not end for a crash that never happened.
  const policy = createMissionCheckpointResponse({});
  const at = { x: 0, y: 400, z: -9000 };
  policy.handleCollision(createCollisionEvent({ type: CollisionType.TERRAIN, position: at, speed: 220, timestamp: 1, forwardHit: true, distance: 90 }));
  check("failure: a predicted impact does not fail the mission", !policy.state.active && policy.state.count === 0, [policy.state.active, policy.state.count]);
  policy.handleCollision(createCollisionEvent({ type: CollisionType.TERRAIN, position: at, speed: 220, timestamp: 2 }));
  check("failure: real contact does", policy.state.active && policy.state.count === 1, [policy.state.active, policy.state.count]);
  check("failure: and it names the surface it hit", policy.state.reason === "TERRAIN IMPACT", policy.state.reason);

  const wet = createMissionCheckpointResponse({});
  wet.handleCollision(createCollisionEvent({ type: CollisionType.OCEAN, position: { x: 0, y: 0, z: 0 }, speed: 220, timestamp: 1 }));
  check("failure: the ocean is named too", wet.state.reason === "OCEAN IMPACT", wet.state.reason);
}

/* ---- Manual Test A, automated: START -> COMPLETE (§49) ---- */
/**
 * A point aircraft that flies at the director's published nav position. It is
 * not a flight model — the point is to prove the MISSION can be completed, which
 * is §49's "even if enemy logic is temporarily disabled".
 */
function flyMission({ hostileDiesAt = null, hostileSpentAt = null, failAt = null, speed = 220, dt = 1 / 20, cap = 500 } = {}) {
  const log = [];
  const cps = [];
  const director = createMissionDirector({
    captureCheckpoint: () => ({ phase: director.state.phase, at: { ...pos } }),
    restoreCheckpoint: (snap) => {
      pos.x = snap.at.x;
      pos.y = snap.at.y;
      pos.z = snap.at.z;
    },
  });
  director.on("phase", ({ phase }) => log.push(phase));
  director.on("checkpoint", ({ index }) => cps.push(index));
  director.setRoute(planRoute({ coastZ: -7600, features: [] }));
  const pos = { x: 0, y: 600, z: -1546 };
  director.reset();
  log.length = 0;

  let t = 0;
  let launched = false;
  let failed = false;
  while (t < cap && director.state.phase !== MissionPhase.COMPLETE) {
    t += dt;
    const m = director.state;
    // Fly toward the current nav anchor; hold course when there is none.
    if (m.navValid && director.playerFlies) {
      const dx = m.navPosition.x - pos.x;
      const dy = m.navPosition.y - pos.y;
      const dz = m.navPosition.z - pos.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      pos.x += (dx / len) * speed * dt;
      pos.y += (dy / len) * speed * dt;
      pos.z += (dz / len) * speed * dt;
    } else if (director.playerFlies) {
      pos.z -= speed * dt;
    }
    if (failAt !== null && !failed && t >= failAt) {
      failed = true;
      director.fail("TEST");
      director.rewind();
    }
    director.update(
      {
        position: pos,
        strokeStarted: t >= 1.7,
        launchDone: launched || (launched = t >= 5.42),
        hostileAlive: hostileDiesAt === null || t < hostileDiesAt,
        hostileSpent: hostileSpentAt !== null && t >= hostileSpentAt,
      },
      dt
    );
  }
  return { time: t, missionTime: director.state.missionTime, phases: log, checkpoints: cps, director, pos };
}

{
  const run = flyMission({ hostileDiesAt: 40, hostileSpentAt: 95 });
  check("mission: START -> COMPLETE is reachable (§49)", run.director.state.phase === MissionPhase.COMPLETE, run.director.state.phase);
  check(
    "mission: and it visits every phase, in order (§3)",
    JSON.stringify(run.phases) === JSON.stringify([MissionPhase.LAUNCH, MissionPhase.EGRESS, MissionPhase.INTERCEPT, MissionPhase.DEFENSIVE, MissionPhase.TERRAIN, MissionPhase.FINAL, MissionPhase.EXTRACTION, MissionPhase.COMPLETE]),
    run.phases
  );
  check("mission: four checkpoints are recorded (§38)", JSON.stringify(run.checkpoints) === JSON.stringify([0, 1, 2, 3]), run.checkpoints);
  check("mission: the timer starts at the catapult and stops at COMPLETE (§37)", run.missionTime > 0 && run.missionTime < run.time, [run.missionTime, run.time]);
  check("mission: a direct run is comfortably under five minutes (§53)", run.missionTime < 300, run.missionTime);
  // This bot flies straight to every anchor at 220 m/s and takes every early
  // exit, so its time is a LOWER bound on the route, not a playtest — a real run
  // turns, fights and slows down. It exists to catch a route that has quietly
  // become trivially short.
  check("mission: ...and the route is not trivially short", run.missionTime > 150, run.missionTime);
  check("mission: the reported time is the stopped clock", Math.abs(run.director.stats.time - run.missionTime) < 1e-9);
}

{
  // §51 — Manual Test C: the hostile is never destroyed and never runs dry.
  const run = flyMission({});
  check("mission: ignoring combat entirely still completes (§51)", run.director.state.phase === MissionPhase.COMPLETE, run.director.state.phase);
  check("mission: the slow path stays near five minutes", run.missionTime < 320, run.missionTime);
}

{
  // §52 — Manual Test D: a failure mid-terrain restores and the mission resumes.
  const run = flyMission({ hostileDiesAt: 30, hostileSpentAt: 80, failAt: 90 });
  check("mission: a failure does not end the mission (§39)", run.director.state.phase === MissionPhase.COMPLETE, run.director.state.phase);
  check("mission: the rewind is counted", run.director.stats.checkpointsUsed === 1 && run.director.state.failures === 1, [run.director.stats.checkpointsUsed, run.director.state.failures]);
  check("mission: and the rewound phase is re-entered, not skipped", run.phases.filter((p) => p === MissionPhase.TERRAIN || p === MissionPhase.FINAL).length >= 2, run.phases);
}

{
  // The director must not advance a phase off a volume belonging to a later one.
  const director = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
  director.setRoute(planRoute({ coastZ: -7600, features: [] }));
  director.reset();
  const terrainLeg = director.route.find((l) => l.phase === MissionPhase.TERRAIN);
  // Sitting inside a TERRAIN volume while still on the deck changes nothing.
  for (let i = 0; i < 30; i++) director.update({ position: terrainLeg.position, strokeStarted: false, launchDone: false, hostileAlive: true, hostileSpent: false }, 1 / 30);
  check("mission: a later phase's volume cannot pull the mission forward", director.state.phase === MissionPhase.DECK, director.state.phase);
}

/**
 * A LEG IS SATISFIED BY ARRIVING AT IT, NOT BY STANDING IN IT.
 *
 * Reported from play: shot down by a SAM while approaching VALLEY, and after the
 * respawn the nav marker read RECOVERY — RIDGE and SEAWARD both skipped. The
 * On the shipped terrain the game logs the collision at load:
 *
 *   TERRAIN/PASS <-> FINAL/SEAWARD   1517 m, and SEAWARD's radius is 1600
 *
 * The fixture below is a SYNTHETIC stand-in for that, not a copy of it: the real
 * survey needs the terrain mesh, which this suite deliberately cannot load. It
 * is built to reproduce the same RELATIONSHIP — a surveyed PASS close enough
 * inland that the authored SEAWARD contains it — rather than the same numbers,
 * and it sits tighter than the real route so the case stays unambiguous if the
 * radii are ever retuned.
 *
 * §17.14 — assert the MECHANISM. "The mission still completes" passes with this
 * bug fully present, because skipping two waypoints reaches COMPLETE sooner.
 * What has to hold is that the skipped waypoints are actually published.
 */
const SKIPPED_ROUTE = [
  { x: 303, z: -10100, height: 42 },
  { x: 303, z: -12700, height: 105 },
  { x: -2260, z: -17900, height: 108 },
];
const skippedRoute = () => planRoute({ coastZ: -7600, features: SKIPPED_ROUTE });
const legNamed = (name) => skippedRoute().find((l) => l.name === name);

/** Fly the bot along the published route until `phase`, then place it at `at`. */
function directorAt(phase, at) {
  const d = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
  d.setRoute(skippedRoute());
  d.reset();
  const pos = { x: 0, y: 600, z: -1546 };
  const dt = 1 / 20;
  let t = 0;
  while (t < 600 && d.state.phase !== phase) {
    t += dt;
    const m = d.state;
    if (m.navValid && d.playerFlies) {
      const dx = m.navPosition.x - pos.x;
      const dz = m.navPosition.z - pos.z;
      const len = Math.hypot(dx, dz) || 1;
      pos.x += (dx / len) * 190 * dt;
      pos.z += (dz / len) * 190 * dt;
    } else if (d.playerFlies) pos.z -= 190 * dt;
    d.update({ position: pos, strokeStarted: t >= 1.7, launchDone: t >= 5.42, hostileAlive: t < 40, hostileSpent: t >= 95 }, dt);
  }
  if (at) Object.assign(pos, at);
  return { d, pos, dt, t };
}

const holdStep = (d, pos, dt) =>
  d.update({ position: pos, strokeStarted: true, launchDone: true, hostileAlive: false, hostileSpent: true }, dt);

{
  const seaward = legNamed("SEAWARD");
  const pass = legNamed("PASS");
  check(
    "route: the reported geometry is real — PASS stands inside SEAWARD's volume",
    flatDistanceTo(pass.position, seaward.position) < seaward.radius,
    Math.round(flatDistanceTo(pass.position, seaward.position))
  );

  // FINAL, with SEAWARD as the live waypoint, and the aircraft shot down on the
  // way to it. `respawnFromCrash` backs it 1800 m along its heading of travel,
  // which around here lands it inside the volume it was flying towards.
  const spawn = { x: seaward.position.x + 300, y: 4000, z: seaward.position.z + 700 };
  check("respawn: the retreat lands inside the volume being flown to", flatDistanceTo(spawn, seaward.position) < seaward.radius, Math.round(flatDistanceTo(spawn, seaward.position)));

  const { d, pos, dt } = directorAt(MissionPhase.FINAL, spawn);
  const reached = [];
  d.on("leg", ({ leg }) => reached.push(leg.name));
  check("respawn: the director is in FINAL when the aircraft is placed", d.state.phase === MissionPhase.FINAL, d.state.phase);
  d.notifyPlaced(pos);

  // Sit still, as a player getting their bearings does. Nothing advances on a
  // clock any more, so anything that moves here moved for a reason.
  for (let i = 0; i < 20 * 30; i++) holdStep(d, pos, dt);
  check("respawn: standing in SEAWARD does not satisfy it (§17.14)", !reached.includes("SEAWARD"), reached);
  check("respawn: so the phase does not advance either", d.state.phase === MissionPhase.FINAL, d.state.phase);
  check("respawn: and SEAWARD is still PUBLISHED as the thing to fly to", d.state.navName === "SEAWARD", d.state.navName);

  // The waypoint is SUSPENDED, not destroyed: leaving and flying back in counts.
  //
  // Asserted on the `leg` EVENT rather than on state.legDone. Satisfying FINAL's
  // only leg promotes the phase inside the same update() call, and the entry
  // into EXTRACTION recomputes legDone against ITS legs -- so legDone reads
  // false again one line later and a check written on it fails while the code is
  // working. The event is the record of the fact; the flag is a phase's status.
  pos.x = seaward.position.x;
  pos.z = seaward.position.z + 5000;
  holdStep(d, pos, dt);
  check("respawn: ...still unsatisfied while outside it", !reached.includes("SEAWARD"), reached);
  pos.z = seaward.position.z;
  holdStep(d, pos, dt);
  check("respawn: arriving at it counts — the waypoint was suspended, not lost", reached.includes("SEAWARD"), reached);
  check("respawn: and only then does EXTRACTION follow", d.state.phase === MissionPhase.EXTRACTION, d.state.phase);
}

{
  // NO STALL. Being inside a leg when its phase begins is normal and correct: on
  // a clean run the player is already inside PASS when TERRAIN starts, because
  // they spent DEFENSIVE flying to it. Requiring an exit THERE would mean
  // overflying the waypoint and doubling back — a worse bug than the one fixed.
  const d = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
  d.setRoute(skippedRoute());
  d.reset();
  const pos = { x: 0, y: 600, z: -1546 };
  const dt = 1 / 20;
  let t = 0;
  const phases = [];
  const navs = [];
  while (t < 500 && d.state.phase !== MissionPhase.COMPLETE) {
    t += dt;
    const m = d.state;
    if (m.navValid && d.playerFlies) {
      const dx = m.navPosition.x - pos.x;
      const dz = m.navPosition.z - pos.z;
      const len = Math.hypot(dx, dz) || 1;
      pos.x += (dx / len) * 190 * dt;
      pos.z += (dz / len) * 190 * dt;
    } else if (d.playerFlies) pos.z -= 190 * dt;
    d.update({ position: pos, strokeStarted: t >= 1.7, launchDone: t >= 5.42, hostileAlive: t < 40, hostileSpent: t >= 95 }, dt);
    if (phases[phases.length - 1] !== d.state.phase) phases.push(d.state.phase);
    if (d.state.navName && navs[navs.length - 1] !== d.state.navName) navs.push(d.state.navName);
  }
  check("no stall: an undisturbed run on the same route still completes", d.state.phase === MissionPhase.COMPLETE, d.state.phase);
  check("no stall: and it finishes with most of the five minutes still unspent", d.state.missionTime < MISSION.deadline * 0.7, Math.round(d.state.missionTime));
  check(
    "no stall: and every waypoint is still published on the way",
    JSON.stringify(navs) === JSON.stringify(["COAST", "INTERCEPT", "COASTLINE", "PASS", "VALLEY", "RIDGE", "SEAWARD", "RECOVERY"]),
    navs
  );
}

{
  // §19's overlap assertion, generalised from the single pair it names.
  const authored = planRoute({ coastZ: -7600, features: [] });
  const surveyed = skippedRoute();
  const contained = (route) => routeOverlaps(route).filter((o) => o.contained);

  const intercept = authored.find((l) => l.name === "INTERCEPT");
  const coastline = authored.find((l) => l.name === "COASTLINE");
  check(
    "route: INTERCEPT and COASTLINE do not overlap (§19)",
    flatDistanceTo(intercept.position, coastline.position) >= intercept.radius + coastline.radius,
    Math.round(flatDistanceTo(intercept.position, coastline.position))
  );
  /**
   * Scoped to phases that are ADJACENT in PHASE_ORDER, because that is where
   * containment can actually hurt: the aircraft is somewhere when a phase ends,
   * and the next phase's leg is tested against that same position.
   *
   * Route-wide would be the wrong bar and would fail on a correct route. The
   * sortie deliberately comes home to where it started -- RECOVERY (r=2400) sits
   * 200 m from COAST and contains it outright -- and that is harmless precisely
   * because EGRESS and EXTRACTION are four phases apart.
   */
  const adjacent = (a, b) => Math.abs(PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b)) === 1;
  const risky = (route) => contained(route).filter((o) => adjacent(o.a.phase, o.b.phase));
  check(
    "route: the authored fallback has no leg standing inside the NEXT phase's leg",
    risky(authored).length === 0,
    risky(authored).map((o) => `${o.a.name}/${o.b.name} ${Math.round(o.distance)}`)
  );
  check(
    "route: ...and the far-apart overlaps it does have are left alone",
    contained(authored).some((o) => !adjacent(o.a.phase, o.b.phase)),
    contained(authored).map((o) => `${o.a.name}/${o.b.name}`)
  );
  check(
    "route: the surveyed route that was reported DOES trip the adjacent-phase bar",
    risky(surveyed).some((o) => [o.a.name, o.b.name].includes("SEAWARD")),
    risky(surveyed).map((o) => `${o.a.name}/${o.b.name} ${Math.round(o.distance)}`)
  );
  // The detector has to see the case that was actually reported, or it is a
  // check that can only ever pass (§17.14).
  const found = contained(surveyed).find((o) => [o.a.name, o.b.name].includes("PASS") && [o.a.name, o.b.name].includes("SEAWARD"));
  check("route: routeOverlaps names the PASS/SEAWARD collision that was reported", !!found, found && Math.round(found.distance));
  check(
    "route: a mere overlap is reported without being flagged as containment",
    routeOverlaps(surveyed).some((o) => !o.contained)
  );
}

/* ---- hostile activation and reuse (§5/§42/§43) ---- */
{
  const drone = createTargetDrone();
  const ai = createHostileAI({ drone });
  const player = { position: { x: 0, y: 760, z: 0 }, velocity: { x: 0, y: 0, z: -220 }, alive: true };

  ai.setActive(false);
  const before = { x: drone.position.x, y: drone.position.y, z: drone.position.z };
  for (let i = 0; i < 600; i++) ai.update(player, 1 / 60);
  check("hostile: an inactive hostile is not simulated at all (§5)", drone.position.x === before.x && drone.position.z === before.z && ai.state.phase === HostileState.PATROL, [drone.position.z, ai.state.phase]);
  check("hostile: and it is not drawn either", drone.root.visible === false);

  // §22 — deployed with no rounds, it can chase but can never acquire.
  ai.deploy({ at: { x: 0, y: 800, z: -2400 }, heading: Math.PI, ammo: 0, engageDelay: 0 });
  check("hostile: deploy places and revives it", ai.state.active && drone.alive && drone.root.visible && Math.round(drone.position.z) === -2400, [drone.position.z, drone.alive]);
  let launches = 0;
  ai.on("launch", () => (launches += 1));
  let reachedPursuit = false;
  for (let i = 0; i < 3600; i++) {
    ai.update(player, 1 / 60);
    if (ai.state.phase === HostileState.PURSUIT) reachedPursuit = true;
    if (ai.state.phase === HostileState.ACQUIRE || ai.state.phase === HostileState.ATTACK) break;
  }
  check("hostile: an empty magazine cannot acquire — one-way pressure (§22)", reachedPursuit && launches === 0 && ai.state.phase !== HostileState.ACQUIRE, [ai.state.phase, launches]);

  // §43 — the same instance serves the next encounter, with teeth this time.
  markTargetHit(drone, 1);
  ai.deploy({ at: { x: 200, y: 820, z: -2000 }, heading: Math.PI, ammo: 2, engageDelay: 0 });
  check("hostile: a destroyed hostile is reused, not respawned (§43)", drone.alive && drone.health === drone.maxHealth && ai.state.ammo === 2 && ai.state.encounters === 2, [drone.alive, ai.state.ammo, ai.state.encounters]);
  check("hostile: spent is false with rounds left", ai.spent === false);
  ai.state.ammo = 0;
  ai.state.cooldown = 0;
  check("hostile: spent once the magazine is gone (§25)", ai.spent === true);
}

/* ---- loadout restore (§41) ---- */
{
  const mounts = createWeaponMounts(new THREE.Object3D());
  const carried = createMountedMissiles(mounts, buildPlaceholderMissile());
  carried.release(carried.next());
  check("loadout: firing one leaves one", carried.count === 1, carried.count);
  carried.setCount(1);
  check("loadout: a checkpoint restores the count it recorded (§41)", carried.count === 1, carried.count);
  carried.setCount(0);
  check("loadout: including empty", carried.count === 0 && carried.next() === null);
  carried.reload();
  check("loadout: and R still reloads everything", carried.count === 2, carried.count);
}

/* ---- gear variants (§7) ---- */
{
  const rig = new THREE.Object3D();
  for (const name of ["F-15E-landingOff_5", "F-15E-landingOn_6", "F-15E-landingOnLight_7"]) {
    const node = new THREE.Object3D();
    node.name = name;
    rig.add(node);
  }
  const vis = () => ["F-15E-landingOff_5", "F-15E-landingOn_6", "F-15E-landingOnLight_7"].map((n) => rig.getObjectByName(n).visible);

  setGearVisual(rig, true);
  check("gear: down shows the deployed pair and hides the clean variant (§7)", JSON.stringify(vis()) === JSON.stringify([false, true, true]), vis());
  setGearVisual(rig, false);
  check("gear: up is the exact inverse", JSON.stringify(vis()) === JSON.stringify([true, false, false]), vis());
  // The two states must be reachable in either order from either starting point:
  // main.js caches the last value, and seeding that cache wrong once made the
  // deck configuration unreachable for a whole mission.
  setGearVisual(rig, true);
  check("gear: and reachable again from the up state", JSON.stringify(vis()) === JSON.stringify([false, true, true]), vis());
  check("gear: setGearForFlight is the clean configuration", (setGearForFlight(rig), JSON.stringify(vis()) === JSON.stringify([true, false, false])), vis());
  check("gear: a missing hierarchy is survivable", setGearVisual(null, true) === null);
}

/* ===== Stage 05.0 — pointer steering, and lives ===== */

{
  /**
   * Mouse steering was deleted in 04.0b after six fixes failed to close a
   * "the aircraft turns on its own" bug. The recorded reason was that a screen
   * position has no centre, and every fix was synthesising one out of relative
   * movement. This design does not synthesise a centre — the centre is the
   * aircraft, fixed at the middle of the viewport — so these tests assert the
   * property that was previously impossible: a resting pointer commands nothing,
   * and deflection is a pure function of where the cursor is.
   */
  const w = 1000;
  const vh = 800;
  const at = (x, y) => pointerStick(x, y, w, vh);
  const half = Math.min(w, vh) * 0.5;

  check("pointer: dead centre commands nothing", at(500, 400).x === 0 && at(500, 400).y === 0);
  // The dead zone IS the aircraft — hovering on it holds attitude, which is the
  // "let go" the old design never had.
  check("pointer: hovering on the aircraft holds attitude", at(500 + half * MOUSE.deadZone * 0.8, 400).x === 0);
  check("pointer: just outside the dead zone starts to bite", at(500 + half * (MOUSE.deadZone + 0.03), 400).x > 0);

  check("pointer: right of centre is right stick", at(900, 400).x > 0.5 && Math.abs(at(900, 400).y) < 0.01);
  check("pointer: left of centre is left stick", at(100, 400).x < -0.5);
  // Screen y grows downward; the stick does not.
  check("pointer: above centre is nose up", at(500, 100).y > 0.5);
  check("pointer: below centre is nose down", at(500, 700).y < -0.5);

  check("pointer: deflection is bounded", Math.hypot(at(0, 0).x, at(0, 0).y) <= MOUSE.gain + 1e-9);
  check("pointer: far outside the span never exceeds full stick", Math.abs(at(-9999, 400).x) <= MOUSE.gain + 1e-9);
  check("pointer: a degenerate viewport does not divide by zero", Number.isFinite(pointerStick(5, 5, 0, 0).x));

  // The keyboard must always be able to override a resting cursor.
  check("axes: the larger request wins", combineAxis(0.2, 0.9) === 0.9 && combineAxis(-1, 0.5) === -1);
  check("axes: equal magnitude prefers the keyboard", combineAxis(0.5, -0.5) === 0.5);
}

{
  // Lives are MISSION only: counting deaths in a sandbox turns practice into a
  // test, which is the opposite of what FREE and PEACE are for.
  check("lives: only the authored sortie counts pilots", MODES.MISSION.lives === true && MODES.FREE.lives === false && MODES.PEACE.lives === false);
  check("lives: every mode declares the field", MODE_ORDER.every((m) => typeof modeRules(m).lives === "boolean"));
}

/* ===== Stage 04.4 — the pitch convention toggle ===== */
{
  // Two real conventions, neither wrong. The default is the one a first-time
  // player expects from WASD; the toggle is for anyone who has flown a sim and
  // will pull to climb without thinking.
  check("pitch: the pure map is a sign flip and nothing else", applyPitchMode(0.7, false) === 0.7 && applyPitchMode(0.7, true) === -0.7);
  check("pitch: neutral stays neutral under both", applyPitchMode(0, true) === 0 && applyPitchMode(0, false) === 0);
  check("pitch: it is symmetric", applyPitchMode(-1, true) === 1 && applyPitchMode(1, true) === -1);
  check("pitch: both conventions are named for what W DOES", PitchMode.NOSE_UP === "NOSE UP" && PitchMode.NOSE_DOWN === "NOSE DOWN");

  const bus = new EventTarget();
  const inp = createInput(bus);
  const key = (code, down) =>
    bus.dispatchEvent(Object.assign(new Event(down ? "keydown" : "keyup"), { key: code, code, repeat: false, preventDefault() {} }));
  const run = (n = 40) => {
    for (let i = 0; i < n; i++) inp.update(1 / 60);
  };
  let announced = null;
  inp.onPitchModeToggle((inv, name) => (announced = name));

  check("pitch: the default is the accessible one", inp.pitchInverted() === false && inp.pitchMode() === PitchMode.NOSE_UP);
  key("KeyW", true);
  run();
  check("pitch: W pitches up by default", inp.y > 0.8, inp.y);

  // Toggle it while W is still held: the axis must flip on the spot rather than
  // waiting for the key to be released and pressed again.
  key("KeyI", true);
  run(2);
  check("pitch: the toggle applies to a key already held", inp.y < -0.8, inp.y);
  check("pitch: and it announces which way W now goes", announced === PitchMode.NOSE_DOWN, announced);
  key("KeyW", false);
  key("KeyS", true);
  run();
  check("pitch: S now pitches up", inp.y > 0.8, inp.y);

  // A PREFERENCE, not transient state: putting the aircraft back must never
  // change which way the controls work.
  inp.clearTransient();
  run();
  check("pitch: a reset does not silently restore the default", inp.pitchInverted() === true, inp.pitchInverted());
  key("KeyS", false);
  key("KeyI", true);
  run(2);
  check("pitch: pressing it again comes back", inp.pitchInverted() === false && announced === PitchMode.NOSE_UP);

  // The lateral axis is untouched — this is a pitch convention, not an inversion
  // of the whole stick.
  inp.setPitchInverted(true);
  key("KeyD", true);
  run();
  check("pitch: bank is unaffected by the pitch convention", inp.x > 0.8, inp.x);
}

/* ---- Stage 04.8 — the F-16C hostile and the modelled SAM launcher ---- */
{
  // Synthetic sources, so these exercise the normalisation ARITHMETIC without a
  // loader, a network fetch or a real asset (§4).
  const sourceJet = () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(5.83, 2.82, 9.14));
    m.position.set(11, -4, 7); // an arbitrary source origin, as Sketchfab exports have
    return m;
  };

  const { root: jet, metrics: jetM } = normalizeHostileModel(sourceJet());
  check(
    "hostile: the airframe is scaled to 14.8 m from MEASURED bounds",
    Math.abs(jetM.length - 14.8) < 0.01 && Math.abs(jetM.target - 14.8) < 1e-9,
    jetM
  );
  // The pivot must land on the bounding-box centre, or the hostile yaws in a
  // visible arc instead of turning about itself.
  const jetBox = new THREE.Box3().setFromObject(jet);
  const jetCentre = jetBox.getCenter(new THREE.Vector3());
  check(
    "hostile: the pivot is recentred on the airframe, not the source origin",
    jetCentre.length() < 0.01,
    jetCentre.toArray()
  );
  check("hostile: the scale is derived, never authored", Math.abs(jetM.scale - 14.8 / 9.14) < 0.01, jetM.scale);

  // THE VEHICLE RULE: a launcher stands on its tracks, so the bottom of the box
  // sits at y = 0 rather than the centre. Centre-recentring buries it to the
  // axles, which is invisible from directly above and obvious from anywhere else.
  const sourceLauncher = () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3.31, 5.55, 6.86));
    m.position.set(-3, 9, 2);
    return m;
  };
  const { root: sam, metrics: samM } = normalizeSamModel(sourceLauncher());
  const samBox = new THREE.Box3().setFromObject(sam);
  check("sam: the launcher is scaled to 6.9 m from measured bounds", Math.abs(samM.length - 6.9) < 0.01, samM);
  check("sam: it STANDS on the ground — bbox bottom at y=0", Math.abs(samBox.min.y) < 0.01, samBox.min.y);
  const samCentre = samBox.getCenter(new THREE.Vector3());
  check(
    "sam: and it is centred on x/z, so it stands where the site stands",
    Math.abs(samCentre.x) < 0.01 && Math.abs(samCentre.z) < 0.01,
    samCentre.toArray()
  );

  // Installing the model must take the blockout's rails WITH it. They hang off
  // the turret rather than off the group, so removing the group alone leaves
  // them behind — and once the turret drops to ground level they end up buried
  // under the launcher, present and invisible.
  const site = createSamSite({ position: { x: 0, y: 0, z: 0 }, name: "SamTest" });
  check("sam: the blockout's rails are named, so the swap can find them", !!site.turret.getObjectByName("SamRails"));
  installSamVisual(site, sam);
  check("sam: installing the model removes the blockout's rails", !site.turret.getObjectByName("SamRails"));
  check("sam: the hardpoint survives the swap", site.turret.getObjectByName("SamHardpoint") === site.hardpoint);
  check("sam: the launcher is parented to the TURRET, so the slew still works", sam.parent === site.turret);
  // The slew is the transition table's, and it must not learn that the visual
  // changed: one write to turret.rotation.y still aims the launcher.
  site.turret.rotation.y = 1.1;
  check("sam: slewing the turret slews the model", Math.abs(sam.getWorldPosition(new THREE.Vector3()).length()) < 1e6 && site.turret.rotation.y === 1.1);

  // §13 — a kill leaves a WRECK. On a model-backed site the turret IS the whole
  // vehicle (the source has no separate turret node), so hiding it would delete
  // the evidence the wreck exists to provide.
  wreckSamSite(site);
  check("sam: a destroyed MODEL-backed site keeps its launcher visible", site.turret.visible === true && site.root.visible === true, [site.turret.visible, site.root.visible]);
  check("sam: and it is still a wreck, not a live site", site.alive === false && site.phase === SamState.DESTROYED);

  const blockout = createSamSite({ position: { x: 0, y: 0, z: 0 }, name: "SamBlockout" });
  wreckSamSite(blockout);
  check("sam: the BLOCKOUT still loses its rails on death", blockout.turret.visible === false);
}

/* ---- Stage 05.3 — PULL UP is a trajectory, and the failure policy ticks once ---- */
{
  // The old rule was `agl <= 110 && sink >= 14`, which over water gave the player
  // the 110 m above the surface to react -- under two seconds at any real sink
  // rate. The trajectory rule warns on TIME, so it works with no terrain at all.
  const sea = (agl, sink) => groundWarning({ agl, sink, aglAhead: null });
  check("pull up: a descent toward the SEA warns six seconds out", sea(600, 100) === Cue.PULL_UP, sea(600, 100));
  check("pull up: ...and the old rule would have been silent there", 600 > AUDIO.altitudeAgl && sea(600, 100) === Cue.PULL_UP);
  check("pull up: a gentle descent with room is quiet", sea(1200, 20) === null, sea(1200, 20));
  check("altitude: low and level over water is silent, not nagging", sea(180, 0) === null, sea(180, 0));
  check("altitude: low and sinking over water speaks", sea(180, 5) === Cue.ALTITUDE, sea(180, 5));

  // LOW FLYING MUST STAY QUIET. There is deliberately no absolute-AGL trigger
  // for PULL UP: a valley run at 100 m is legitimate, and a cue that cries wolf
  // there is a cue the player learns to ignore in the one place it matters.
  check("pull up: 100 m and level is NOT a pull-up", groundWarning({ agl: 100, sink: 0, aglAhead: 100 }) === null, groundWarning({ agl: 100, sink: 0, aglAhead: 100 }));
  check("pull up: 100 m in a slight climb is not either", groundWarning({ agl: 100, sink: -6, aglAhead: 140 }) === null);

  // The case the vertical rate misses entirely: level flight at rising ground.
  // Closure comes from the ground AHEAD, so zero sink still warns.
  check(
    "pull up: level flight into rising ground warns on closure alone",
    groundWarning({ agl: 300, sink: 0, aglAhead: -50 }) === Cue.PULL_UP,
    groundWarning({ agl: 300, sink: 0, aglAhead: -50 })
  );
  check(
    "pull up: level flight over falling ground stays quiet",
    groundWarning({ agl: 400, sink: 0, aglAhead: 900 }) === null
  );
  // forwardImminent is a COLLISION predicate (~30 ms of warning), so it is kept
  // only as a floor. Borrowing it as the trigger is what made PULL UP arrive
  // after the crash rather than before it.
  check("pull up: an imminent forward hazard still forces it", groundWarning({ agl: 4000, sink: 0, forwardImminent: true }) === Cue.PULL_UP);
  check("ground warning: no reading, no warning", groundWarning({ agl: NaN, sink: 90 }) === null);
  check("ground warning: on the deck it is silent", groundWarning({ agl: 5, sink: 0, airborne: false }) === null);
  check("ground warning: the trajectory clock agrees with the rule", Math.abs(secondsToGround({ agl: 600, sink: 100 }) - 6) < 1e-9, secondsToGround({ agl: 600, sink: 100 }));

  // The engine is the aircraft's own voice and must not be the quietest thing in
  // the mix. At 0.34 cue gain it played at an effective 0.14 against a 0.75
  // fly-by, which reads as a broken engine rather than a quiet one.
  const cruise = engineVoice(0.62, false);
  const burner = engineVoice(1, true);
  // The engine must stay audible against the one-shots. The bound has been
  // lowered twice on request (0.7 -> 0.56 -> 0.45), so it tracks the current
  // intent rather than the original mix; it is still a real floor and would fail
  // if the cue were dropped to 0.3 or muted outright.
  check("engine: audible at cruise against the one-shots", AUDIO.cues.ENGINE_LOOP.volume * cruise.volume > 0.24, AUDIO.cues.ENGINE_LOOP.volume * cruise.volume);
  check("engine: afterburner is louder than cruise", burner.volume > cruise.volume, [cruise.volume, burner.volume]);
  check("engine: but still under the warnings it must not drown", AUDIO.cues.ENGINE_LOOP.volume * burner.volume < AUDIO.cues.PULL_UP.volume, AUDIO.cues.ENGINE_LOOP.volume * burner.volume);
  check("engine: present as soon as the throttle leaves its stop", engineVoice(0.03, false).volume >= AUDIO.engineIdle);
  // el.volume throws outside 0..1, so the product has to stay in range at every
  // throttle position including afterburner.
  let inRange = true;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    for (const ab of [false, true]) {
      const v = AUDIO.cues.ENGINE_LOOP.volume * engineVoice(t, ab).volume;
      if (!(v >= 0 && v <= 1)) inRange = false;
    }
  }
  check("engine: the gain product is a legal element volume everywhere", inRange);

  // THE ENGINE MUST NOT DUCK. It is the bed the mix sits on, and a cue that can
  // repeat every few seconds turns a duck into a permanent attenuation -- which
  // is what made the aircraft sound switched off.
  check("engine: the engine channels are exempt from ducking", AUDIO.cues.ENGINE_LOOP.noDuck === true && AUDIO.cues.ENGINE_START.noDuck === true);
  check("engine: the gun is NOT exempt -- a burst really does mask speech", !AUDIO.cues.GUN.noDuck);
  check("engine: warnings are not duckable either", AUDIO.cues.PULL_UP.priority > Priority.WEAPON && AUDIO.cues.ALTITUDE.priority > Priority.WEAPON);

  // A grace window after control is handed over: the aircraft leaves the deck
  // 20 m over water and sinks off the bow, so a trajectory warning is otherwise
  // guaranteed at the one moment the player cannot act on it.
  check("ground warning: there is a grace window before any warning may fire", AUDIO.warnGraceSeconds >= 3, AUDIO.warnGraceSeconds);

  // THE DOUBLE-TICK. The failure policy has two callers -- physics.update() and
  // the frame loop when physics is skipped -- and both firing in one frame ran
  // the 2.32 s sequence at double speed AND let a restore land inside a frame
  // that had already decided a crash was in progress, which wrote the wreck's
  // pose over the fresh respawn and spent another pilot.
  let restores = 0;
  const policy = createMissionCheckpointResponse({ onRestore: () => restores++ });
  policy.trigger("TERRAIN IMPACT");
  const step = 1 / 60;
  let elapsed = 0;
  for (let i = 1; i <= 200 && restores === 0; i++) {
    // Both callers, same frame stamp: only the first may land.
    policy.tick(step, i);
    policy.tick(step, i);
    elapsed += step;
  }
  const expected = MISSION_FAILURE.hold + MISSION_FAILURE.fadeOut;
  check(
    "failure policy: a repeated tick with the same frame stamp is ignored",
    Math.abs(elapsed - expected) <= step + 1e-9,
    { elapsed, expected }
  );
  check("failure policy: and the restore still happens exactly once", restores === 1, restores);

  // A caller that passes no stamp must keep working: the Stage 02.2 call sites
  // and these tests are single-caller by construction.
  let bare = 0;
  const legacy = createMissionCheckpointResponse({ onRestore: () => bare++ });
  legacy.trigger("OCEAN IMPACT");
  for (let i = 0; i < 200 && bare === 0; i++) legacy.tick(step);
  check("failure policy: an unstamped tick is never deduped", bare === 1, bare);
}

/* ---- Stage 05.4 — world clock, day/night curves, ocean, night lights ---- */
{
  // The clock is the whole persistence mechanism, so its contract is the first
  // thing worth pinning: it advances, it wraps, and a preset moves it without
  // stopping it.
  const clock = createWorldClock({ cycleSeconds: 100, tau: 0 });
  clock.advance(25);
  check("clock: advances at 1/cycle per second", Math.abs(clock.tau - 0.25) < 1e-9, clock.tau);
  clock.advance(100);
  check("clock: wraps rather than growing without bound", Math.abs(clock.tau - 0.25) < 1e-9, clock.tau);
  clock.setTau(0.9);
  clock.advance(5);
  check("clock: a preset jump does NOT freeze time (§7/§8)", clock.tau > 0.9 && clock.tau < 1, clock.tau);
  check("clock: wrapTau normalises a negative", Math.abs(wrapTau(-0.25) - 0.75) < 1e-9);
  check("clock: the cycle length is configurable, not baked in", createWorldClock({ cycleSeconds: 999 }).state.cycleSeconds === 999);

  // THE ARTISTIC TIMELINE (§6) falls out of the two-half-sine curve rather than
  // being hand-placed, so these are the assertions that keep the split honest.
  check("sun: sunrise is the zero crossing", Math.abs(sunElevation(0)) < 1e-9, sunElevation(0));
  check("sun: midday peaks at tau 0.29", Math.abs(sunElevation(DAY.sunsetSplit / 2) - 1) < 1e-9);
  check("sun: sunset is the second zero crossing", Math.abs(sunElevation(DAY.sunsetSplit)) < 1e-9);
  check("sun: deepest night is between sunset and sunrise", Math.abs(sunElevation(DAY.sunsetSplit + (1 - DAY.sunsetSplit) / 2) + 1) < 1e-9);
  // Continuity at both crossings: §6 forbids snapping between lighting states.
  // The two half-sines meet at zero from opposite sides, so the gap shrinks with
  // eps rather than being exactly zero at any finite probe.
  const eps = 1e-4;
  check("sun: the curve is continuous at sunset", Math.abs(sunElevation(DAY.sunsetSplit - eps) - sunElevation(DAY.sunsetSplit + eps)) < 5e-3);
  check("sun: and continuous across midnight/sunrise", Math.abs(sunElevation(1 - eps) - sunElevation(eps)) < 5e-3);
  check(
    "sun: the gap at a crossing shrinks with the probe, i.e. it is continuous",
    Math.abs(sunElevation(DAY.sunsetSplit - 1e-5) - sunElevation(DAY.sunsetSplit + 1e-5)) <
      Math.abs(sunElevation(DAY.sunsetSplit - 1e-3) - sunElevation(DAY.sunsetSplit + 1e-3))
  );
  let monotonic = true;
  for (let t = 0; t < DAY.sunsetSplit / 2; t += 0.01) if (sunElevation(t + 0.01) < sunElevation(t)) monotonic = false;
  check("sun: it climbs steadily from sunrise to midday", monotonic);

  // The direction vector must be a unit vector at every instant, or the light
  // intensity would wobble with the time of day for no visible reason.
  let unit = true;
  for (let t = 0; t < 1; t += 0.017) {
    const d = sunDirection(t);
    if (Math.abs(Math.hypot(d.x, d.y, d.z) - 1) > 1e-6) unit = false;
  }
  check("sun: the direction is always a unit vector", unit);
  check("sun: it is above the horizon at midday", sunDirection(0.29).y > 0.9);
  check("sun: and below it at night", sunDirection(0.79).y < -0.9);
  check("sun: it rises and sets on opposite sides", sunDirection(0.06).x * sunDirection(0.52).x < 0, [sunDirection(0.06).x, sunDirection(0.52).x]);

  check("night: full night at the anti-solar point", nightFactor(sunElevation(0.79)) === 1);
  check("night: nothing at midday", nightFactor(sunElevation(0.29)) === 0);
  check("day: full sun at midday", dayFactor(sunElevation(0.29)) === 1);
  let nightMonotonic = true;
  for (let e = -1; e < 1; e += 0.05) if (nightFactor(e + 0.05) > nightFactor(e)) nightMonotonic = false;
  check("night: the factor never increases as the sun climbs", nightMonotonic);

  // NIGHT MUST STAY FLYABLE (§14/§15). These are the floors that keep a fighter
  // at 200 m/s from being flown in a black room.
  const midnight = environmentFor(0.79);
  const noon = environmentFor(0.29);
  check("night: the sun contributes nothing", midnight.sunIntensity === 0, midnight.sunIntensity);
  check("night: but a moon light does", midnight.moonIntensity > 0.3, midnight.moonIntensity);
  check("night: ambient never falls to zero", midnight.hemiIntensity >= NIGHT.minAmbient, midnight.hemiIntensity);
  check("night: the moon opposes the sun, so relief still has a direction", midnight.moonDirection.y > 0 && midnight.moonDirection.x * midnight.sunDirection.x <= 0);
  check("day: daylight is unchanged from the original fixed sun", Math.abs(noon.sunIntensity - NIGHT.sunPeak) < 1e-9, noon.sunIntensity);
  // §16 — the horizon must stay perceptible with no light on it: the haze band
  // is kept brighter than the dome, and the water darker than both.
  const lum = (h) => ((h >> 16) & 255) * 0.299 + ((h >> 8) & 255) * 0.587 + (h & 255) * 0.114;
  check("night: the horizon band is brighter than the sky above it", lum(midnight.hazeColor) > lum(midnight.skyColor), [lum(midnight.hazeColor), lum(midnight.skyColor)]);
  check("night: and the ocean is darker than the horizon", lum(midnight.waterColor) < lum(midnight.hazeColor));
  check("night: clouds keep contrast against the dome (§20)", lum(midnight.cloudColor) > lum(midnight.skyColor));
  let distinct = true;
  for (let t = 0; t < 1; t += 0.02) {
    const e = environmentFor(t);
    if (e.waterColor === e.skyColor || e.waterColor === e.hazeColor) distinct = false;
  }
  check("ocean: never the same colour as the sky or the horizon (§32)", distinct);

  // Smoothness: no visible step anywhere around the cycle. A snap here is the
  // one thing §6 and §17 both single out.
  //
  // MEASURED PER RENDERED FRAME, not per arbitrary tau step. Twilight is
  // *supposed* to change fast — §12 asks for rapid intensity reduction — so a
  // coarse sample makes the legitimate dusk ramp look like a discontinuity. What
  // matters is whether the player can see a step between two frames.
  const frameTau = 1 / 60 / DAY.cycleSeconds;
  let maxJump = 0;
  for (let t = 0; t <= 1.0001; t += 0.0025) {
    const a = environmentFor(t);
    const b = environmentFor(t + frameTau);
    maxJump = Math.max(maxJump, Math.abs(b.sunIntensity - a.sunIntensity), Math.abs(b.hemiIntensity - a.hemiIntensity), Math.abs(b.night - a.night));
  }
  check("cycle: no lighting value snaps between rendered frames", maxJump < 0.01, maxJump);

  // The presets: each must land in its own daylight, not at the dark crossing.
  const atSunrise = environmentFor(DAY.sunriseTau);
  const atSunset = environmentFor(DAY.sunsetTau);
  check("preset: `[` gives real sunrise light, not the dark crossing", atSunrise.sunIntensity > 1 && atSunrise.night === 0, [atSunrise.sunIntensity, atSunrise.night]);
  check("preset: `]` gives real sunset light", atSunset.sunIntensity > 0.5 && atSunset.night === 0, [atSunset.sunIntensity, atSunset.night]);
  check("preset: sunset is warmer than midday", (atSunset.sunColor & 255) < (noon.sunColor & 255), [atSunset.sunColor.toString(16), noon.sunColor.toString(16)]);

  // §41 — lights fade with the sun and are never toggled at a threshold.
  check("lights: fully out in daylight", environmentFor(0.29).nightLightLevel === 0);
  check("lights: fully up at night", environmentFor(0.79).nightLightLevel === 1);
  check("lights: partial through dusk", environmentFor(0.585).nightLightLevel > 0 && environmentFor(0.585).nightLightLevel < 1, environmentFor(0.585).nightLightLevel);

  /* ---- settlement placement ---- */
  // A synthetic island: a low coastal shelf, a habitable plain, and a peak. The
  // placement rule must use all three correctly with no scene present.
  const island = (x, z) => {
    if (x < -3000) return -20; // sea
    if (Math.hypot(x - 4000, z - 4000) < 900) return 520; // mountain
    if (x > 6000) return 40 + (x - 6000) * 0.5; // steep slope
    return 30 + Math.sin(x / 900) * 8; // gentle habitable ground
  };
  check("placement: dry gentle ground is habitable", habitable(0, 0, island) !== null);
  check("placement: the sea is not (§37)", habitable(-5000, 0, island) === null);
  check("placement: a mountain is not", habitable(4000, 4000, island) === null);
  check("placement: a steep slope is not", habitable(9000, 0, island) === null);

  const plan = planSettlements({ bounds: { minX: -8000, maxX: 8000, minZ: -8000, maxZ: 8000 }, sampleHeight: island });
  check("settlements: lights are generated", plan.count > 200, plan.count);
  check("settlements: the arrays agree", plan.positions.length === plan.count * 3 && plan.colors.length === plan.count * 3);
  check("settlements: clustered, not scattered (§36)", plan.clusters.length >= 6, plan.clusters.length);
  check("settlements: a few big clusters and more small ones", plan.clusters.filter((c) => c.kind === "major").length <= 4 && plan.clusters.filter((c) => c.kind === "minor").length > plan.clusters.filter((c) => c.kind === "major").length);
  // No light may stand anywhere the rule forbids: this is the assertion that
  // catches a light in the sea or on a peak, which reads instantly as a bug.
  let allValid = true;
  let maxY = -Infinity;
  for (let i = 0; i < plan.count; i++) {
    const x = plan.positions[i * 3];
    const y = plan.positions[i * 3 + 1];
    const z = plan.positions[i * 3 + 2];
    maxY = Math.max(maxY, y);
    if (habitable(x, z, island) === null) allValid = false;
  }
  check("settlements: every light stands on habitable ground", allValid);
  check("settlements: none is above the height limit", maxY <= LIGHTS.maxHeight + 20, maxY);
  // §35 — deterministic: the same island every run.
  const again = planSettlements({ bounds: { minX: -8000, maxX: 8000, minZ: -8000, maxZ: 8000 }, sampleHeight: island });
  check("settlements: generation is seeded and repeatable", again.count === plan.count && again.positions[0] === plan.positions[0] && again.positions[plan.count * 3 - 1] === plan.positions[plan.count * 3 - 1]);
  const differentSeed = planSettlements({ bounds: { minX: -8000, maxX: 8000, minZ: -8000, maxZ: 8000 }, sampleHeight: island, seed: 12345 });

/**
 * §43 — the carrier's own lights, and the one thing about them that is easy to
 * get wrong in a way nobody can name: WHICH END THE ISLAND IS ON.
 *
 * Reported from play as the bridge light sitting forward of the bridge. It was:
 * the cluster ran 0.02–0.08 of the length, barely aft of midships. Reading the
 * carrier mesh, the geometry standing above the flight deck — the only thing up
 * there — is a compact structure centred 0.195 L from midships, spanning
 * 0.174–0.218 L. These checks hold the lights on it.
 *
 * The SIGN is what they really protect. In this space +Z is aft (world.js:
 * `launchStartZ` 0.16 is "the aft end of the catapult run", `launchEndZ` -0.44
 * is "short of the bow"), so an island at negative Z would be on the bow. That
 * reads as wrong instantly and explains itself to nobody, which is exactly the
 * kind of thing a check should hold still.
 */
{
  const length = 332.8;
  const lights = createCarrierLights({ local: { DeckReference: { x: 0, y: 18, z: 0 } } }, { length });
  const sprites = lights.root.children.map((c) => c.position);
  check("carrier lights: the ship is lit at all", sprites.length > 20, sprites.length);

  // The island cluster is the only thing well above the deck.
  const islandLights = sprites.filter((p) => p.y > 18 + 5);
  const deckLights = sprites.filter((p) => p.y <= 18 + 5);
  check("carrier lights: a deck run and a taller island cluster", islandLights.length === 7 && deckLights.length > 20, [islandLights.length, deckLights.length]);

  const zs = islandLights.map((p) => p.z / length);
  check(
    "carrier lights: the island is AFT of midships, not forward (+Z is aft)",
    zs.every((z) => z > 0),
    zs.map((z) => +z.toFixed(3))
  );
  check(
    "carrier lights: ...and sits on the structure measured off the hull, 0.174–0.218 L",
    zs.every((z) => z >= 0.17 && z <= 0.222),
    zs.map((z) => +z.toFixed(3))
  );
  check("carrier lights: the island is to starboard, as every carrier's is", islandLights.every((p) => p.x > 0), islandLights.map((p) => Math.round(p.x)));
  check("carrier lights: it stands above the deck rather than on it", Math.max(...islandLights.map((p) => p.y)) > 18 + 15, Math.max(...islandLights.map((p) => p.y)));

  // The deck run has to stay inside the hull, or the ship is outlined in lights
  // floating off its own bow and stern.
  const deckZ = deckLights.map((p) => p.z / length);
  check("carrier lights: the deck run stays within the hull", Math.min(...deckZ) > -0.5 && Math.max(...deckZ) < 0.5, [Math.min(...deckZ).toFixed(3), Math.max(...deckZ).toFixed(3)]);
}

  check("settlements: ...but the seed is what decides it", differentSeed.positions[0] !== plan.positions[0]);
  check("prng: seeded() is deterministic", seeded(7)() === seeded(7)() && seeded(7)() !== seeded(8)());

  /* ---- ocean ---- */
  // §21 — the gameplay sea stays flat. This is the boundary that must not move:
  // the waves are a vertex-shader skin and no gameplay code may learn of them.
  check("ocean: gameplay still uses a flat sea at y=0", WORLD.oceanY === 0);
  check("ocean: the visual patch is coarse on purpose (§23)", OCEAN.segments <= 128, OCEAN.segments);
  check("ocean: three wave components, not a spectrum (§25)", OCEAN.waves.length === 3);
  check("ocean: amplitudes stay restrained", OCEAN.waves.every((w) => w[0] <= 0.8) && OCEAN.waves[0][0] >= 0.4, OCEAN.waves.map((w) => w[0]));
  check("ocean: the components have distinct directions", new Set(OCEAN.waves.map((w) => w[3])).size === 3);
  check("ocean: the patch is smaller than the old 100 km plane but far past sight", OCEAN.patchSize > 8000 && OCEAN.patchSize < WORLD.oceanSize);

  // §28 — the horizon blend must be CAPPED. Uncapped, the far half of the sea
  // becomes flat sky colour and the whole surface reads as milky soup rather
  // than as water.
  check("ocean: the Fresnel blend never fully replaces water with sky", OCEAN.fresnelMax < 0.7 && OCEAN.fresnelMax > 0.2, OCEAN.fresnelMax);
  check("ocean: the wide sheen lobe stays subtle", OCEAN.sheen < 0.08, OCEAN.sheen);
  check("ocean: reflection is confined to grazing angles", OCEAN.fresnelPower >= 6 && OCEAN.fresnelBase < 0.02);

  // THE DAYTIME PLATEAU MUST NOT BE FLAT. `day` saturates well before midday, so
  // without the elevation ramp the sun holds one value across two thirds of the
  // cycle — which is what made a two-minute flight look like the clock was dead.
  const morning = environmentFor(0.15);
  const midday = environmentFor(0.29);
  const afternoon = environmentFor(0.45);
  check("cycle: midday is brighter than mid-morning", midday.sunIntensity > morning.sunIntensity * 1.05, [morning.sunIntensity, midday.sunIntensity]);
  check("cycle: and brighter than mid-afternoon", midday.sunIntensity > afternoon.sunIntensity * 1.02, [afternoon.sunIntensity, midday.sunIntensity]);
  check("cycle: the daytime sky colour actually changes", morning.skyColor !== midday.skyColor && midday.skyColor !== afternoon.skyColor);
  check("cycle: the daytime water colour changes too", morning.waterColor !== midday.waterColor && midday.waterColor !== afternoon.waterColor);
  // A player should reach a visibly different sky within a couple of minutes,
  // which is the whole reason the cycle length was reduced.
  const twoMinutes = 120 / DAY.cycleSeconds;
  const startEnv = environmentFor(DAY.startTau);
  const laterEnv = environmentFor(DAY.startTau + twoMinutes);
  check(
    "cycle: two minutes of flight moves the sky measurably",
    startEnv.skyColor !== laterEnv.skyColor && Math.abs(startEnv.sunIntensity - laterEnv.sunIntensity) > 0.05,
    [DAY.startTau, +(DAY.startTau + twoMinutes).toFixed(3), +startEnv.sunIntensity.toFixed(2), +laterEnv.sunIntensity.toFixed(2)]
  );
  check("cycle: ...and reaches sunset within about four minutes", (DAY.sunsetTau - DAY.startTau) * DAY.cycleSeconds < 260, (DAY.sunsetTau - DAY.startTau) * DAY.cycleSeconds);

  // THE WATERLINE MUST BE FINDABLE. Over open sea at low altitude the only cue
  // for height is the colour boundary between air and surface, so the water is
  // held more saturated than both the sky and the horizon at every hour.
  const bluer = (a, b) => (a & 255) - ((a >> 16) & 255) > (b & 255) - ((b >> 16) & 255);
  let saturatedByDay = true;
  for (let t = 0; t < 1; t += 0.02) {
    const e = environmentFor(t);
    // Daylight only. At night the boundary is carried by LUMINANCE instead — the
    // haze band is held brighter than the water, which is asserted separately —
    // and blue-minus-red is a poor saturation proxy once both are near black.
    if (e.night < 0.5 && !bluer(e.waterColor, e.hazeColor)) saturatedByDay = false;
  }
  check("ocean: the water is more blue than the horizon in daylight", saturatedByDay);
  const noonWater = environmentFor(0.3).waterColor;
  check("ocean: midday water is a real blue, not a grey-blue", (noonWater & 255) - ((noonWater >> 16) & 255) > 100, [(noonWater & 255) - ((noonWater >> 16) & 255)]);
  // Surface texture is the other height cue: the chop has to be big enough to
  // read from the cockpit at 200 m/s.
  check("ocean: the small chop is legible", OCEAN.waves[2][0] >= 0.15, OCEAN.waves[2][0]);
}

/* ---- Stage 05.6 — the loop watchdog ---- */
{
  /**
   * A stub element that reports perfect health and never advances its clock:
   * exactly the fault that was reported as "no engine sound" several times and
   * could not be seen in any property the real element exposes.
   */
  const makeStub = () => ({
    volume: 0,
    playbackRate: 1,
    paused: true,
    currentTime: 0,
    readyState: 4,
    loop: false,
    play() {
      this.paused = false;
      return { catch() {} };
    },
    pause() {
      this.paused = true;
    },
    addEventListener() {},
  });
  const factory = () => (src, loop) => {
    const e = makeStub();
    e.loop = !!loop;
    return e;
  };

  const dir = createAudioDirector({ audioFactory: factory() });
  dir.arm();
  dir.loop(Cue.ENGINE_LOOP, true, { volume: 0.6, rate: 1.12 });
  const ch = dir.channels.ENGINE_LOOP;
  const eng = ch.voices[0][0];
  check("watchdog: the engine loop starts, pitched by the throttle", eng.paused === false && eng.playbackRate > 1.1, eng.playbackRate);

  // Let it genuinely play first: a channel whose clock has never moved is a
  // START failure (autoplay), which is a different fault handled below. This
  // block is specifically about a loop that WAS running and stopped.
  for (let i = 0; i < 30; i++) {
    eng.currentTime += 1 / 60;
    dir.update(1 / 60);
  }
  check("watchdog: a running loop is recognised as having played", ch.everPlayed === true);

  // Frozen clock, healthy everything else. Must be caught.
  for (let i = 0; i < 40; i++) dir.update(1 / 60);
  check("watchdog: a frozen clock is detected even though the element looks fine", ch.stalls >= 1, ch.stalls);
  check("watchdog: the playback rate is reset and locked", eng.playbackRate === 1 && ch.rateLocked === true);
  check("watchdog: play() is re-issued", eng.paused === false);
  // The pitch effect must stay off once it has been blamed, not be re-applied on
  // the next frame's loop() call.
  dir.loop(Cue.ENGINE_LOOP, true, { volume: 0.6, rate: 1.12 });
  check("watchdog: the pitch effect stays off once blamed", eng.playbackRate === 1);
  check("watchdog: the stall count is published for the rail", dir.report.stalls.ENGINE_LOOP >= 1, dir.report.stalls);

  // A HEALTHY loop must never be touched: a watchdog that fires on working audio
  // would silently strip the pitch effect from every engine everywhere.
  const dir2 = createAudioDirector({ audioFactory: factory() });
  dir2.arm();
  dir2.loop(Cue.ENGINE_LOOP, true, { volume: 0.6, rate: 1.12 });
  const ch2 = dir2.channels.ENGINE_LOOP;
  const eng2 = ch2.voices[0][0];
  for (let i = 0; i < 120; i++) {
    eng2.currentTime += 1 / 60;
    dir2.update(1 / 60);
  }
  check("watchdog: a healthy advancing loop is never touched", ch2.stalls === 0 && eng2.playbackRate > 1.1, [ch2.stalls, eng2.playbackRate]);
  check("watchdog: ...and its rate is never locked", ch2.rateLocked === false);

  // A loop wrap moves the clock BACKWARDS. That is motion, not a stall.
  const dir3 = createAudioDirector({ audioFactory: factory() });
  dir3.arm();
  dir3.loop(Cue.ENGINE_LOOP, true, { volume: 0.6, rate: 1.0 });
  const ch3 = dir3.channels.ENGINE_LOOP;
  const eng3 = ch3.voices[0][0];
  for (let i = 0; i < 120; i++) {
    eng3.currentTime = (eng3.currentTime + 1 / 60) % 0.5; // wraps repeatedly
    dir3.update(1 / 60);
  }
  check("watchdog: a looping wrap is not mistaken for a stall", ch3.stalls === 0, ch3.stalls);

  // A muted or stopped channel is not stalled either.
  const dir4 = createAudioDirector({ audioFactory: factory() });
  dir4.arm();
  dir4.loop(Cue.ENGINE_LOOP, true, { volume: 0.6, rate: 1.1 });
  dir4.setMuted(true);
  for (let i = 0; i < 60; i++) dir4.update(1 / 60);
  check("watchdog: a muted channel is not reported as stalled", dir4.channels.ENGINE_LOOP.stalls === 0);

  /**
   * A START FAILURE MUST NOT BE TREATED AS A STALL.
   *
   * This is the autoplay case: the browser refuses playback until the document
   * has had a real user gesture, and the element sits at zero. Blaming that on
   * the playback rate cost the engine its throttle-pitch effect for a fault that
   * had nothing to do with it, so the two are now told apart by whether the
   * clock has EVER moved.
   */
  const blockedFactory = () => (src, loop) => {
    const e = makeStub();
    e.loop = !!loop;
    // play() resolves but playback is never granted: paused flips false and the
    // clock stays at zero, exactly as a refused element behaves.
    e.play = function () {
      this.paused = false;
      return { catch() {} };
    };
    return e;
  };
  const dir5 = createAudioDirector({ audioFactory: blockedFactory() });
  dir5.arm();
  dir5.loop(Cue.ENGINE_LOOP, true, { volume: 0.6, rate: 1.12 });
  const ch5 = dir5.channels.ENGINE_LOOP;
  const eng5 = ch5.voices[0][0];
  for (let i = 0; i < 120; i++) dir5.update(1 / 60);
  check("watchdog: a never-started channel is counted as pending, not stalled", ch5.pending > 0 && ch5.stalls === 0, [ch5.pending, ch5.stalls]);
  check("watchdog: and its pitch effect is NOT stripped", ch5.rateLocked === false && eng5.playbackRate > 1.1, [ch5.rateLocked, eng5.playbackRate]);
  check("watchdog: it keeps trying to start", eng5.paused === false);
  check("watchdog: pending is published separately from stalls", dir5.report.pending.ENGINE_LOOP > 0 && !dir5.report.stalls.ENGINE_LOOP);

  // Once it genuinely starts, a later freeze IS a stall and is repaired.
  const dir6 = createAudioDirector({ audioFactory: factory() });
  dir6.arm();
  dir6.loop(Cue.ENGINE_LOOP, true, { volume: 0.6, rate: 1.12 });
  const ch6 = dir6.channels.ENGINE_LOOP;
  const eng6 = ch6.voices[0][0];
  for (let i = 0; i < 60; i++) {
    eng6.currentTime += 1 / 60;
    dir6.update(1 / 60);
  }
  check("watchdog: a channel that really played is marked as such", ch6.everPlayed === true);
  for (let i = 0; i < 60; i++) dir6.update(1 / 60); // now frozen
  check("watchdog: a freeze AFTER playing is a stall and is repaired", ch6.stalls >= 1 && ch6.rateLocked === true, [ch6.stalls, ch6.rateLocked]);
}

/**
 * PAUSE FREEZES EVERY VOICE, NOT JUST THE LOOPING ONES.
 *
 * Reported from play: pausing on the deck froze the picture while the engine
 * start-up kept running. `setMuted` opens with `if (!ch.row.loop) continue` --
 * correct for mute, because silencing a loop means stopping it and a one-shot is
 * over in a moment anyway -- and pause was implemented by calling it. So the
 * one-shot played on behind the pause screen, finished, and the countdown
 * resumed into silence.
 *
 * §17.14 -- assert the MECHANISM. "Audio is quiet while paused" would have
 * passed with the bug fully present, because the pause screen is quiet either
 * way once the clip has run out. What has to hold is that the clip is still
 * THERE afterwards, at the position it was interrupted at.
 */
{
  const el = () => {
    const e = {
      paused: true,
      currentTime: 0,
      volume: 1,
      playbackRate: 1,
      readyState: 4,
      networkState: 1,
      loop: false,
      play() {
        e.paused = false;
        return { catch() {} };
      },
      pause() {
        e.paused = true;
      },
      addEventListener() {},
      cloneNode: () => el(),
    };
    return e;
  };
  const dir = createAudioDirector({ audioFactory: () => el() });
  dir.arm();

  // A one-shot in flight, part-way through, exactly like the deck start-up.
  dir.play(Cue.ENGINE_START);
  const start = dir.channels.ENGINE_START.voices[0][0];
  start.currentTime = 4.2;
  check("pause: the engine start-up is a ONE-SHOT, which is the whole point", !AUDIO.cues.ENGINE_START.loop);
  check("pause: ...and it is playing before the pause", start.paused === false);

  // ...and a loop, which the old code did handle.
  dir.loop(Cue.ENGINE_LOOP, true, { volume: 0.5 });
  const loop = dir.channels.ENGINE_LOOP.voices[0][0];
  check("pause: a looping channel is playing too", loop.paused === false);

  dir.setPaused(true);
  check("pause: the loop stops", loop.paused === true);
  check("pause: and so does the ONE-SHOT — the case mute skips", start.paused === true, start.paused);
  check("pause: the one-shot keeps its position rather than being reset", Math.abs(start.currentTime - 4.2) < 1e-9, start.currentTime);

  // The deck clock is frozen while paused, so the audio clock must be too: §9
  // couples them, `deckDwell` IS the start-up's length at its playback rate.
  dir.setPaused(false);
  check("pause: resuming restarts the one-shot", start.paused === false);
  check("pause: ...from where it stopped, so no silence is introduced", Math.abs(start.currentTime - 4.2) < 1e-9, start.currentTime);
  check("pause: and the loop comes back", loop.paused === false);

  // Mute is a separate state and pause must not touch it, in either direction.
  const dir2 = createAudioDirector({ audioFactory: () => el() });
  dir2.arm();
  dir2.setMuted(true);
  dir2.setPaused(true);
  dir2.setPaused(false);
  check("pause: a muted player is still muted after a pause", dir2.state.muted === true);
  const dir3 = createAudioDirector({ audioFactory: () => el() });
  dir3.arm();
  dir3.setPaused(true);
  dir3.setPaused(false);
  check("pause: ...and an unmuted one is not silently muted by it", dir3.state.muted === false);
}

/**
 * FREE FLY SEEDS ITS OWN SAM BATCHES.
 *
 * MISSION's six authored sites do not respawn (§11) and that stands: clearing
 * the corridor earns an empty valley, and the mission ENDS. FREE fly does not
 * end, so a finite six leaves an empty sky a few minutes in — the same failure
 * `hostileRespawn` already prevents for the fighter.
 *
 * A synthetic island, so the placement rule is exercised without a scene (§4):
 * land inside a circle, open sea outside it.
 */
{
  const island = (x, z) => (Math.hypot(x, z - 12000) < 6000 ? 120 : -5);
  // Deterministic scatter. A random one cannot be asserted.
  const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // -- prediction ------------------------------------------------------------
  // Heading 0 is -Z and forward is (-sin h, -cos h) (§5). Get that backwards and
  // every batch lands BEHIND the player, which is the one failure that would
  // make the whole feature look like it does nothing.
  const north = predictAhead({ x: 0, z: 0 }, 0);
  check("free/sam: the batch is seeded AHEAD, on the project's heading convention", north.z < 0 && Math.abs(north.x) < 1e-9, north);
  check("free/sam: ...at the configured distance", Math.abs(Math.hypot(north.x, north.z) - SANDBOX.sam.ahead) < 1e-6, Math.hypot(north.x, north.z));
  const east = predictAhead({ x: 0, z: 0 }, -Math.PI / 2);
  check("free/sam: and it turns with the aircraft", east.x > 0 && Math.abs(east.z) < 1e-6, east);

  // -- placement -------------------------------------------------------------
  const onLand = seedSamBatch({ x: 0, z: 12000 }, Math.PI, island, rng(7));
  check("free/sam: a batch is at most three sites", onLand.length <= SANDBOX.sam.perBatch, onLand.length);
  check("free/sam: over land it places some", onLand.length > 0, onLand.length);
  check("free/sam: every site stands on ground, never on the sea", onLand.every((p) => p.y >= SANDBOX.sam.minGroundY), onLand.map((p) => p.y));
  check("free/sam: they are scattered, not stacked", new Set(onLand.map((p) => Math.round(p.x) + "," + Math.round(p.z))).size === onLand.length);

  // §13's rule, applied to a batch: a site with nowhere to stand is DROPPED, not
  // floated. Two on land beat three with one in the sea.
  const atSea = seedSamBatch({ x: 0, z: -40000 }, Math.PI, island, rng(7));
  check("free/sam: over open water it places NONE rather than floating them", atSea.length === 0, atSea.length);

  // -- retirement ------------------------------------------------------------
  const near = [{ alive: true, position: { x: 100, y: 0, z: 100 } }];
  const far = [{ alive: true, position: { x: 0, y: 0, z: 30000 } }];
  const dead = [{ alive: false, position: { x: 100, y: 0, z: 100 } }];
  const here = { x: 0, y: 500, z: 0 };
  check("free/sam: an empty batch is spent, so the cycle can start itself", samBatchSpent(here, []) === true);
  check("free/sam: a live batch nearby is NOT replaced under the player", samBatchSpent(here, near) === false);
  check("free/sam: a destroyed batch is spent", samBatchSpent(here, dead) === true);
  check("free/sam: an IGNORED batch is only retired once it is far behind", samBatchSpent(here, far) === true);
  check(
    "free/sam: ...and the retirement range clears the SAM's own reach and the radar's",
    SANDBOX.sam.clearRange > SAM.detectRange && SANDBOX.sam.clearRange > HUD.radarRange,
    [SANDBOX.sam.clearRange, SAM.detectRange, HUD.radarRange]
  );
  // One survivor inside the range holds the whole batch, so a player who left
  // one alive and turned back finds it still there.
  const mixed = [dead[0], near[0]];
  check("free/sam: one survivor in range holds the batch", samBatchSpent(here, mixed) === false);

  // -- the driver ------------------------------------------------------------
  let seeded = 0;
  const box = createSandbox({ seedSams: () => (seeded += 1, 3), setSams: () => {}, setHostile: () => {} });
  box.begin(GameMode.FREE);
  box.update({ hostileAlive: true, position: here, heading: 0, samsSpent: true }, 1 / 60);
  check("free/sam: the driver seeds when the batch is spent", seeded === 1, seeded);
  box.update({ hostileAlive: true, position: here, heading: 0, samsSpent: false }, 1 / 60);
  check("free/sam: ...and not while it is still live", seeded === 1, seeded);
  check("free/sam: batches are counted for the rail", box.state.samBatches === 1, box.state.samBatches);

  /**
   * A SEED THAT PLACES NOTHING MUST NOT RETRY EVERY FRAME.
   *
   * Found by running it: launching from the carrier aims the prediction 5.2 km
   * down the deck heading, which is still open water, so every ground probe
   * failed and the batch came back empty. An empty batch is spent by
   * definition, so the cycle re-seeded on the next frame and the next — 49
   * attempts and zero sites by the time the aircraft reached EGRESS.
   *
   * §17.14 — assert the ATTEMPT COUNT, not "there are no sites". "No sites over
   * water" is true whether the cycle asks once or sixty times a second.
   */
  let tries = 0;
  const dry = createSandbox({ seedSams: () => (tries += 1, 0), setSams: () => {}, setHostile: () => {} });
  dry.begin(GameMode.FREE);
  for (let i = 0; i < 120; i++) dry.update({ hostileAlive: true, position: here, heading: 0, samsSpent: true }, 1 / 60);
  check("free/sam: two seconds of open water costs ONE attempt, not 120", tries === 1, tries);
  check("free/sam: ...and counts no batch, because none was placed", dry.state.samBatches === 0, dry.state.samBatches);
  // Past the cooldown it tries again, so crossing a coastline starts seeding.
  for (let i = 0; i < 60 * (SANDBOX.sam.retry + 1); i++) dry.update({ hostileAlive: true, position: here, heading: 0, samsSpent: true }, 1 / 60);
  check("free/sam: but it does try again once the cooldown lapses", tries === 2, tries);

  // PEACE has no SAMs at all, and MISSION is not a sandbox: neither may seed.
  let peaceSeeded = 0;
  const peace = createSandbox({ seedSams: () => (peaceSeeded += 1), setSams: () => {}, setHostile: () => {} });
  peace.begin(GameMode.PEACE);
  // main.js gates `samsSpent` on modeRules(mode).sams, which PEACE does not have.
  peace.update({ hostileAlive: false, position: here, heading: 0, samsSpent: modeRules(GameMode.PEACE).sams }, 1 / 60);
  check("free/sam: PEACE seeds nothing", peaceSeeded === 0, peaceSeeded);
  check("free/sam: ...because PEACE has no SAMs to seed", modeRules(GameMode.PEACE).sams === false);
  check("free/sam: and MISSION still owns its authored corridor", modeRules(GameMode.MISSION).sams === true && SANDBOX.samRespawn === null);
}

/**
 * A WING OF TWO, AND THE THREAT MONITOR STILL ASKS ONE QUESTION.
 *
 * `threat.update` reads `{tracking, locked, lockProgress}` — one hostile's
 * worth. FREE fly flies two (SANDBOX.wing), so they are merged, and the merge
 * is the WORST case: what is being done to the player does not get less urgent
 * because a second aircraft is the one doing it.
 *
 * §17.14 — assert the merge, not "the HUD shows something". A merge that took
 * the FIRST hostile, or averaged them, would still light the display.
 */
{
  const none = { tracking: false, locked: false, lockProgress: 0 };
  const tracking = { tracking: true, locked: false, lockProgress: 0.4 };
  const locked = { tracking: true, locked: true, lockProgress: 1 };

  check("wing: an empty sky threatens nothing", JSON.stringify(mergeHostiles([])) === JSON.stringify(none));
  check("wing: a null wing is handled rather than thrown at", JSON.stringify(mergeHostiles(null)) === JSON.stringify(none));
  check("wing: one hostile passes straight through — MISSION is unchanged", mergeHostiles([locked]).locked === true && mergeHostiles([tracking]).locked === false);

  // The load-bearing case: the SECOND aircraft is the dangerous one.
  const mixed = mergeHostiles([tracking, locked]);
  check("wing: a lock anywhere in the wing is a LOCK", mixed.locked === true, mixed);
  check("wing: ...even when the first aircraft is only tracking", mergeHostiles([tracking, locked]).locked === true);
  check("wing: ...and in either order", mergeHostiles([locked, tracking]).locked === true);
  check("wing: the pip follows whichever is closest to firing", mixed.lockProgress === 1, mixed.lockProgress);
  check("wing: tracking is a union too", mergeHostiles([none, tracking]).tracking === true);
  check("wing: two quiet hostiles are still quiet", mergeHostiles([none, none]).locked === false && mergeHostiles([none, none]).tracking === false);
  // A slot that has never been deployed is a hole in the array, not a threat.
  check("wing: an undeployed slot does not invent a threat", mergeHostiles([locked, null]).locked === true && mergeHostiles([null, null]).locked === false);

  check("wing: FREE fly flies more than one, MISSION exactly one (§12)", SANDBOX.wing === 2 && MISSION.encounter.defensive.ammo === 2, SANDBOX.wing);
}

/**
 * A SANDBOX MODE CARRIES NO MISSION FURNITURE, INCLUDING ON THE DECK.
 *
 * §11 — the director owns the deck and the catapult in every mode, then parks
 * past the handoff. But parking happens on ENTRY to EGRESS, and DECK and LAUNCH
 * come before it: FREE fly and PEACE flew the whole take-off with a NAV COAST
 * diamond, name and range, and a DECK phase cue across the middle of the frame.
 * Then it vanished at the handoff, which read as a glitch rather than a
 * leftover.
 *
 * `parked` means "the director has stopped advancing". This is the different
 * question — "was there ever a route" — so it is gated on `sandbox`.
 */
{
  const mission = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
  mission.setRoute(planRoute({ coastZ: -7600, features: [] }));
  mission.reset();
  const free = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
  free.setSandbox(true);
  free.setRoute(planRoute({ coastZ: -7600, features: [] }));
  free.reset();

  const pos = { x: 0, y: 20, z: -1546 };
  const ctx = { position: pos, strokeStarted: false, launchDone: false, hostileAlive: true, hostileSpent: false };
  mission.update(ctx, 1 / 60);
  free.update(ctx, 1 / 60);

  check("sandbox/hud: MISSION publishes a waypoint on the deck", mission.state.navValid === true && !!mission.state.navName, mission.state.navName);
  check("sandbox/hud: a sandbox mode publishes NONE — before parking, not after", free.state.navValid === false && free.state.navName === null, free.state.navName);
  check("sandbox/hud: ...and no range either, so the rail cannot print one", free.state.navRange === 0, free.state.navRange);
  check("sandbox/hud: the suppression is not just `parked` — it applies on the DECK", free.state.phase === MissionPhase.DECK && free.state.parked === false, [free.state.phase, free.state.parked]);

  // The phase cue is the other mission mark on that screen.
  check("sandbox/hud: MISSION announces its phase", typeof mission.cue === "string", mission.cue);
  check("sandbox/hud: a sandbox mode announces nothing", free.cue === null, free.cue);

  // Through the launch, where the leftover was actually visible.
  for (let i = 0; i < 60 * 3; i++) free.update({ ...ctx, strokeStarted: true }, 1 / 60);
  check("sandbox/hud: still silent through LAUNCH", free.state.navValid === false && free.cue === null, [free.state.phase, free.state.navName, free.cue]);
}

/**
 * A LEG FLOWN THROUGH UNDER AN EARLIER PHASE IS NOT DEMANDED AGAIN.
 *
 * Reported from play: reaching PASS did nothing, and once TERRAIN began the
 * marker pointed backwards at it. DEFENSIVE's own leg is COASTLINE, already
 * flown under INTERCEPT, so nav falls forward and sends the player to PASS —
 * but the trigger only tests the CURRENT phase's leg, so arriving recorded
 * nothing and TERRAIN opened with PASS astern.
 *
 * §17.14 — assert that TERRAIN does not ASK FOR PASS AGAIN. "The mission still
 * completes" passes with the bug fully present: the bot in the suite hovers at
 * its waypoint, so it is still inside PASS when TERRAIN starts and never
 * notices. A player flies through and keeps going.
 */
{
  const d = createMissionDirector({ captureCheckpoint: () => ({}), restoreCheckpoint: () => {} });
  d.setRoute(planRoute({ coastZ: -7600, features: [] }));
  d.reset();
  const pass = d.route.find((l) => l.name === "PASS");
  const pos = { x: 0, y: 600, z: -1546 };
  const dt = 1 / 20;
  let t = 0;
  const step = () =>
    d.update({ position: pos, strokeStarted: t >= 1.7, launchDone: t >= 5.42, hostileAlive: true, hostileSpent: false }, dt);

  // Fly the route to DEFENSIVE, chasing whatever the diamond says.
  while (t < 200 && d.state.phase !== MissionPhase.DEFENSIVE) {
    t += dt;
    const m = d.state;
    if (m.navValid && d.playerFlies) {
      const dx = m.navPosition.x - pos.x, dz = m.navPosition.z - pos.z;
      const L = Math.hypot(dx, dz) || 1;
      pos.x += (dx / L) * 210 * dt;
      pos.z += (dz / L) * 210 * dt;
    } else if (d.playerFlies) pos.z -= 210 * dt;
    step();
  }
  check("nav/pass: DEFENSIVE is reached, and its own waterline is already behind", d.state.phase === MissionPhase.DEFENSIVE, d.state.phase);
  check("nav/pass: so the diamond sends the player on to PASS", d.state.navName === "PASS", d.state.navName);

  // Fly THROUGH PASS and keep going, which is what an aircraft does.
  pos.x = pass.position.x;
  pos.z = pass.position.z;
  step();
  for (let i = 0; i < 20 * 20; i++) { t += dt; pos.z -= 210 * dt; step(); }
  // The diamond legitimately stays on PASS for the rest of DEFENSIVE: the
  // mission has not consumed it yet, and it is still where the player is going.
  check("nav/pass: the aircraft is well clear of PASS by now", flatDistanceTo(pass.position, pos) > pass.radius, Math.round(flatDistanceTo(pass.position, pos)));

  // Run DEFENSIVE's floor out and let TERRAIN open.
  while (t < 260 && d.state.phase === MissionPhase.DEFENSIVE) { t += dt; step(); }
  check("nav/pass: TERRAIN opens", d.state.phase === MissionPhase.TERRAIN, d.state.phase);
  // `selectLegs` publishes before the trigger runs, so PASS shows for exactly
  // one frame and is then forgiven. What matters is that the player is not sent
  // back for it -- and they cannot be re-triggering it, because they are
  // kilometres away.
  t += dt;
  step();
  check("nav/pass: it does NOT send the player back to PASS", d.state.navName !== "PASS", d.state.navName);
  check("nav/pass: it asks for the next inland leg instead", d.state.navName === "VALLEY", d.state.navName);
  check("nav/pass: forgiven from range, not re-triggered", flatDistanceTo(pass.position, pos) > pass.radius, Math.round(flatDistanceTo(pass.position, pos)));
  // The route is not skipped: VALLEY and RIDGE were never flown, so they remain.
  check("nav/pass: the legs actually flown are the only ones forgiven", d.state.legIndex === 1, d.state.legIndex);
}

console.log(failures === 0 ? `flight.test.js — all ${total} checks passed` : `flight.test.js — ${failures} failure(s) of ${total}`);

/**
 * The result, for a harness that needs a value rather than a console.
 *
 * The suite RUNS ON IMPORT -- every check above is at module top level, which
 * is what lets tests.html get a count out of a bare `import` and what keeps
 * this file free of a framework. So this does not run anything; it reports the
 * run that importing it already performed, and calling it twice is the same
 * answer both times rather than a second pass.
 *
 * It exists because spec/vector.test.ts gates `pnpm check` on these numbers,
 * so the browser count and CI read the same suite instead of drifting apart.
 * That contract was lost once already -- the export went missing while the
 * callers kept importing it -- and the typecheck is what caught it.
 *
 * @returns {{ total: number, failed: number, failures: { name: string, detail: string }[] }}
 */
export function run() {
  return { total, failed: failures, failures: failureLog };
}
