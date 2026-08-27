import * as THREE from "three";
import { FLIGHT, SPEED, THROTTLE, EXPERT, MODE, DEG, createFlightState, resetFlightState, toggleFlightMode, updateFlight, headingDegrees, bankDegrees, attitudeVectors, isExpert, requestRoll, quatForward, quatUp, quatFromEulerYXZ, getTargetSpeed, isAfterburner, captureFlightState, applyFlightState } from "./flight.js";
import { createInput } from "./input.js";
import { createAircraftHierarchy, loadF15, setGearVisual } from "./aircraft.js";
import { createChaseCamera, updateChaseCamera, snapChaseCamera, setChaseView, CHASE } from "./chase-camera.js";
import { WORLD, createWorldHierarchy, createWorldLighting, loadCarrier, loadTerrain, distanceKm } from "./world.js";
import { DAY, createWorldClock, environmentFor, phaseName } from "./world-time.js";
import { OCEAN, createOcean } from "./ocean.js";
import { LIGHTS, planSettlements, createSettlementLights, createCarrierLights } from "./night-lights.js";
import { PHYSICS, PROBES, SURFACE, createWorldPhysics, benchmarkTerrainQuery } from "./physics.js";
import { RECOVERY, NEUTRAL_INPUT, MISSION_FAILURE, createDevelopmentRecoveryResponse, createMissionCheckpointResponse } from "./collision.js";
import { LAUNCH, LAUNCH_VIEW, LaunchStage, createLaunchSequence } from "./launch.js";
import {
  MISSION,
  MissionPhase,
  missionExpired,
  RECOVERY_VIEW,
  CRASH_VIEW,
  createMissionDirector,
  planRoute,
  planSamSites,
  safeSpawnAltitude,
  surveyTerrainRoute,
  encounterFor,
  autopilotStick,
  blendStick,
  bearingTo,
  formatClock,
  formatShortClock,
} from "./mission.js";
import { createPhysicsDebug, createCarrierAnchorDebug } from "./physics-debug.js";
import { WEAPONS, WeaponMode, cycleWeapon, createWeaponMounts, createMountedMissiles, loadAim9 } from "./weapons.js";
import { TARGETING, LockState, createTargetingSystem } from "./targeting.js";
import { MISSILE, createMissileSystem } from "./missile.js";
import { GUN, createGunSystem } from "./gun.js";
import { ENEMY, createTargetDrone, updateTargetDrone, resetTargetDrone, markTargetHit, damageTarget, loadHostileFighter, installHostileVisual } from "./enemy.js";
import { HOSTILE, HOSTILE_MISSILE, HostileState, createHostileAI } from "./hostile.js";
import { THREAT, ThreatLevel, createThreatMonitor, inDodgePeak, evadeEarned } from "./threat.js";
import { DamageSource, createPlayerDamageEvent, createDevelopmentHitResponse } from "./damage.js";
import { createCombatHud, projectToScreen } from "./combat-hud.js";
import { ENGINE_FX, createEngineFx } from "./engine-fx.js";
import { REARM, createRearmSystem } from "./rearm.js";
import { AUDIO, Cue, Priority, engineVoice, groundWarning, secondsToGround, flybyTriggered, createAudioDirector } from "./audio.js";
import { SAM, SAM_MISSILE, SamState, createSamSite, createSamNetwork, wreckSamSite, lineOfSight, loadSamLauncher, installSamVisual } from "./sam.js";
import { FLARE, createFlareSystem } from "./flares.js";
import { CRASH, CrashCause, causeFromReason, createCrashFx } from "./crash-fx.js";
import { GameMode, MODES, SANDBOX, modeRules, nextMode, isSandbox, createSandbox } from "./modes.js";
import { VAPOR, createVaporFx } from "./vapor-fx.js";
import { ATMOS, createAtmosphere } from "./atmosphere.js";

const canvas = document.getElementById("stage");
// Log depth: near 0.5 with a 120 km far plane has nowhere near enough integer
// precision for both a 19 m airframe at 24 m and a coastline 25 km out.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// Atmospheric perspective is what stops a 30 km island reading as a tabletop
// model. Exponential-squared so the falloff is gentle up close and total at the
// horizon, tinted to exactly the sky's horizon band so there is no fog line.
scene.fog = new THREE.FogExp2(WORLD.haze, WORLD.fogDensity);

const camera = createChaseCamera(window.innerWidth / window.innerHeight);

/* ---- sky ---- */
const hazeHex = "#" + WORLD.haze.toString(16).padStart(6, "0");
const skyCanvas = document.createElement("canvas");
skyCanvas.width = 2;
skyCanvas.height = 256;
{
  const g = skyCanvas.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#2f5f92");
  grad.addColorStop(0.6, "#7fa6c8");
  grad.addColorStop(1, hazeHex);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
}
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(WORLD.skyRadius, 24, 16),
  new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
);
sky.name = "Sky";
scene.add(sky);

/* ---- world ---- */
const world = createWorldHierarchy();
scene.add(world.worldRoot);

const { sun, sky: skyFill } = createWorldLighting();
/**
 * Stage 05.4 — the night-side light (§13).
 *
 * A second directional light opposite the sun, deliberately far brighter than
 * real moonlight. It exists so terrain, the carrier and both airframes keep
 * readable silhouettes at night: a physically honest moon leaves a fighter at
 * 200 m/s in a black room, which is not a hard night, it is a broken game.
 */
const moon = new THREE.DirectionalLight(0x9fb6d8, 0);
moon.name = "Moon";
const lighting = new THREE.Object3D();
lighting.name = "Lighting";
lighting.add(sun, skyFill, moon);
scene.add(lighting);

/**
 * THE ONE WORLD CLOCK (§1/§2).
 *
 * Module scope, created once, and NEVER reset by anything: not applyMode(), not
 * restartMission(), not a checkpoint restore, not respawnFromCrash(). That is
 * the whole persistence mechanism — there is no per-mode time to copy between
 * modes and nothing to forget to preserve, because the clock simply is not part
 * of any of those code paths. Only a page reload starts the day again.
 */
const worldClock = createWorldClock();

/**
 * The visual ocean replaces the flat lit plane. The OLD mesh stays in the
 * hierarchy but is hidden rather than deleted: `WORLD.oceanY` and everything
 * gameplay-facing still describes a flat sea at y = 0, and keeping the original
 * object makes it obvious that the waves are a skin over that plane and not a
 * new source of truth (§21).
 */
const oceanVisual = createOcean({ fogDensity: WORLD.fogDensity });
world.ocean.visible = false;
scene.add(oceanVisual.mesh);

let settlementLights = null;
let carrierLights = null;

/* ---- aircraft ---- */
const { aircraftRoot, modelCorrection, cameraTarget } = createAircraftHierarchy();
scene.add(aircraftRoot);
cameraTarget.position.set(0, 2, 0);

// Stage 03.0: hardpoints are part of the aircraft hierarchy, so a launch point
// is a transform lookup and never a world-space constant (§4).
const mountSet = createWeaponMounts(aircraftRoot);

const flightState = createFlightState();
aircraftRoot.position.set(flightState.position.x, flightState.position.y, flightState.position.z);

const input = createInput(window);

/* ---- combat ---- */
const combatRoot = new THREE.Object3D();
combatRoot.name = "CombatRoot";
scene.add(combatRoot);

const drone = createTargetDrone();
combatRoot.add(drone.root);

/**
 * Stage 03.3 — the player as a target entity.
 *
 * The hostile's missile takes the same { position, velocity, alive } contract
 * the player's AIM-9 takes, so guidance, the proximity fuze and the trail are
 * literally the same code path (§14). `position` is aliased to the transform and
 * `velocity` to the frame's measured motion, so nothing has to be copied.
 */
const playerEntity = { position: aircraftRoot.position, velocity: new THREE.Vector3(), alive: true, label: "PLAYER" };

// The hostile's brain. It owns the drone's heading/pitch/speed and nothing else
// — a launch is an event this file interprets, not something the AI performs.
const hostileAi = createHostileAI({ drone });
const threat = createThreatMonitor();
// Guidance context for the evasion hook: rebuilt each frame, read per missile.
const _evasion = { position: aircraftRoot.position, velocityDir: null, inPeak: false };

// Targeting is a service, not a UI: it is handed an observer and a candidate
// list. Nothing here knows about the HUD, and nothing about the player is
// baked in — an enemy launcher can own one of these later (§34).
const targeting = createTargetingSystem();
const combatHud = createCombatHud();
let missiles = null;
let rounds = null;
let terrainIndexed = false;

/* ---- Stage 03.2: selected weapon and the internal cannon ---- */
// One fire input, two weapons (§4): the trigger asks the selected weapon what
// to do rather than each weapon owning a key.
let weapon = WeaponMode.AIM9;
const gun = createGunSystem({ scene, muzzle: mountSet.gunMuzzle });
// Damage is applied by the owner of the target, not by the gun: gun.js reports
// a landed round and its range, and the kill response stays in one place.
gun.on("hit", ({ target, damage }) => {
  damageTarget(target, damage, performance.now() / 1000);
});
gun.on("kill", ({ target, at }) => {
  announceKill(target, at);
});
gun.on("dry", () => combatHud.flash("GUN DRY"));

/* ---- Stage 04.2: ground threats and game modes ---- */
// Ground height for everything that needs to know where the terrain is: the SAM
// line-of-sight test, SAM placement, and the missile terrain kill. One closure,
// so there is exactly one definition of "the ground" in the build.
const groundAt = (x, z) => {
  const h = physics.sampleTerrainBelow({ x, y: 0, z });
  return h.foundTerrain ? h.terrainHeight : WORLD.oceanY;
};
const samNet = createSamNetwork({ sampleHeight: groundAt });
// §Flares — an infrared countermeasure, so it defeats a round in the air and
// never a radar lock. World-space, like the tracers and the vapor: the point of
// a flare is that the aircraft leaves it behind.
const flares = createFlareSystem({ scene });
// §4 — presentation only. It detects nothing and decides nothing; the failure
// policy above owns when a crash begins and when the respawn happens.
const crashFx = createCrashFx({ scene });
const _crashVel = new THREE.Vector3();

let mode = GameMode.MISSION;
const sandbox = createSandbox({
  spawnHostile: () => deployHostile(MISSION.encounter.defensive),
  setHostile: (on) => {
    if (!on) hostileAi.setActive(false);
  },
  setSams: (on) => samNet.setActive(on),
});

/* ---- Stage 04.2: SAM launches and kills ---- */
// Same shape as the hostile's launch: an event, interpreted here. The round
// leaves the launcher's rails, not a coordinate.
samNet.on("launch", ({ site }) => {
  if (!missiles) return;
  missiles.fire({
    mount: site.hardpoint,
    target: playerEntity,
    ownerSpeed: 0,
    owner: "sam",
    side: 1,
    cfg: SAM_MISSILE,
  });
});

/**
 * One kill path for every target type. The gun and the AIM-9 both land here, and
 * a SAM site becomes a wreck rather than vanishing — a destroyed installation
 * should stay in the world as evidence that the player did something.
 */
function announceKill(target, at) {
  if (target && target.kind === "SAM") {
    wreckSamSite(target);
    director.stats.groundKills += 1;
    combatHud.flash("SAM DESTROYED", "good");
  } else {
    // This line was missing for a stage, and it is the whole "I shoot the
    // hostile and it does not die" report: the kill path was rewritten to handle
    // SAM wrecks and the ordinary case lost the call that actually kills a
    // drone. The gun still worked, because damageTarget() kills internally on the
    // fatal round — so only the AIM-9 was broken, which is exactly the weapon a
    // player uses on a fighter.
    markTargetHit(target, performance.now() / 1000);
    director.stats.kills += 1;
    combatHud.flash("TARGET DESTROYED", "good");
  }
  if (missiles) missiles.burst(at || target.position, target && target.kind === "SAM" ? 34 : 26);
  audio.play(Cue.MISSILE_HIT);
  targeting.clear();
}

flares.on("decoy", () => combatHud.flash("DECOYED", "good"));
flares.on("dispense", ({ remaining }) => {
  combatHud.flash(`FLARES ${remaining}`, "info");
  // Forced: the player pressed a button, and silence reads as a broken control
  // even when the anti-spam interval is doing its job.
  audio.play(Cue.FLARES, { force: true });
});

/* ---- Stage 04.2: game modes ---- */
function applyMode(next) {
  mode = next;
  const rules = modeRules(mode);
  director.setSandbox(!rules.phases);
  sandbox.reset();
  samNet.setActive(false);
  hostileAi.setActive(false);
  hideFailed();
  paintLives();
  return rules;
}

/* ---- Stage 03.3: taking a hit ---- */
// §31: the missile does not know what a hit means. It produces a damage event;
// this policy decides. Stage 04.0 splits that decision in two: this response is
// now the FEEDBACK half only — the veil, the label, the camera kick, and the
// single-fire guarantee that stops a 22 m fuze tripping the same hit on three
// consecutive frames. What a hit *costs* is now a mission failure, handled by
// the one policy that also handles flying into a mountain (§39).
const hitResponse = createDevelopmentHitResponse({
  holdTime: 0.8,
  cooldown: 1.0,
  onHit: () => {
    targeting.clear();
    audio.play(Cue.MISSILE_HIT, { force: true });
    missionFailure.trigger("MISSILE HIT");
  },
  onRecover: null,
});

/* ================= Stage 04.0 — the mission ================= */

// The scripted opening (§6–§14). It owns the aircraft from the first frame until
// the handoff and uses no flight physics at all.
const launch = createLaunchSequence();
let launchAnchors = null;
// How much of the launch camera composition is still mixed in. 1 through the
// sequence, easing to 0 afterwards, so the rig is handed back without a cut.
let viewHold = 0;
let gearDown = null;
let f15Visual = null;
let startCueFired = false;
/**
 * Stage 05.3 — an undocumented kill switch for pointer steering (`V`).
 *
 * Deliberately absent from every legend and every player-facing document: it is a
 * developer escape hatch, not a setting. It exists because pointer steering is the
 * one control that cannot be "not pressed" — a cursor is always somewhere — so if
 * it ever misbehaves in front of an audience there has to be a way to fall back to
 * the keyboard without restarting.
 *
 * Separate from `input.setPointerEnabled()`, which the frame loop rewrites every
 * frame to hand the aircraft to the launch script and the crash. This is the
 * player's preference; that is the system's gating. The two are ANDed, and this one
 * survives reset, respawn and mode change.
 */
let pointerAllowed = true;
let openingFade = 0;
let openingFadeAt = -Infinity;
let openingFadeTimer = 0;

// §16 — navigation anchors are real (invisible) transforms in the scene, so no
// mission logic anywhere holds a world coordinate. NavRoot is also what the N
// key draws when the route needs checking.
const navRoot = new THREE.Object3D();
navRoot.name = "NavRoot";
scene.add(navRoot);
let navDebug = null;

/**
 * §41 — a checkpoint snapshot. Enough to continue cleanly, and nothing about
 * particles, clouds or plumes: presentation resets, gameplay does not.
 */
function captureMissionState() {
  const flight = captureFlightState(flightState);
  /**
   * A checkpoint has to be a state the player can fly OUT of. Recording the
   * attitude verbatim would allow one to be taken mid-dive at 120 m over a
   * ridge, and restoring it would re-fly the same impact — which is exactly the
   * trap Stage 02.3 found one layer down, where the newest safe state sat one
   * query before the collision. So a checkpoint is levelled onto the heading it
   * was travelling and lifted to real air.
   */
  const ground = terrainIndexed ? physics.sampleTerrainBelow(flightState.position) : null;
  const floor = (ground && ground.foundTerrain ? ground.terrainHeight : WORLD.oceanY) + MISSION.route.terrainClearance;
  flight.position.y = Math.max(flight.position.y, floor);
  quatFromEulerYXZ(0, flightState.heading, 0, flight.quat);
  return {
    flight,
    // Recorded so the restore can tell a real checkpoint from the deck.
    heading: flightState.heading,
    weapon,
    aim9: rounds ? rounds.count : 2,
    gunAmmo: gun.state.ammo,
    // Checkpoint 0 is the deck, and restoring it means re-running the catapult
    // rather than dropping the player into the air above a carrier.
    onDeck: director.state.phase === MissionPhase.DECK || director.state.phase === MissionPhase.LAUNCH,
  };
}

/**
 * Guarantee a respawn is in flyable air — enforced at RESTORE time, against the
 * terrain that is actually there.
 *
 * The capture-time lift is not sufficient and could not be. It samples the ground
 * directly below the capture point, which says nothing about whether that point
 * sits inside a hillside, nor about what the aircraft is POINTED AT. Restoring a
 * levelled attitude 320 m over a valley floor with a 600 m ridge 400 m ahead puts
 * the player back into contact within two seconds, the policy fails them again,
 * and the crash repeats forever — which is the reported bug.
 *
 * So the corridor ahead of the restored heading is sampled and the aircraft is
 * lifted above the HIGHEST ground in it. A respawn that begins a second from a
 * mountain is not a respawn.
 */
/**
 * Stage 04.7b — the respawn is computed from the CRASH, not from a stored
 * checkpoint.
 *
 * The corridor lift below was the right rule applied to the wrong position. A
 * checkpoint records where the player was when a phase BEGAN — possibly
 * kilometres away and inside anything — so two rounds of fixing the altitude
 * could not fix the fact that the horizontal position was never checked at all.
 *
 * The spawn is now local to the thing that killed you: back off along your own
 * direction of travel from the point of impact, level, at an altitude that clears
 * the ground ahead. That is the player's own suggestion, generalised — `z + value`
 * is only correct while heading is -Z, and keeping `y` is precisely what traps
 * you, because `y` is the altitude you died at.
 *
 * It is better play, too: you get another run at the ridge that beat you rather
 * than being teleported back to the start of the leg.
 */
const RESPAWN = { retreat: 1800, clearance: 460 };

function respawnFromCrash() {
  const h = crashFx.state.heading;
  // Forward is (-sin h, -cos h), so backing off is the positive of that.
  const x = crashFx.state.origin.x + Math.sin(h) * RESPAWN.retreat;
  const z = crashFx.state.origin.z + Math.cos(h) * RESPAWN.retreat;
  /**
   * Stage 05.0 — a fixed generous altitude, not an escalating one.
   *
   * The escalation existed to climb its way out of terrain over repeated deaths.
   * With five aircraft that is no longer an acceptable way to converge, because
   * each attempt costs a pilot. Take the higher of the corridor clearance and the
   * flat floor.
   *
   * 05.2 raised it back to 4000 m: at 2000 m the aircraft was reported ending up
   * in the ocean again. Geometrically that should be impossible — the value is a
   * lower bound on absolute altitude and the island peaks at 643 m — so 4000 m is
   * masking something rather than fixing it. The post-condition check below exists
   * to catch the real cause the next time it happens instead of hiding it.
   */
  const y = Math.max(LIVES.respawnAltitude, safeSpawnAltitude({ x, z }, h, terrainIndexed ? groundAt : null, MISSION, RESPAWN.clearance));
  flightState.position.x = x;
  flightState.position.y = y;
  flightState.position.z = z;
  flightState.heading = h;
  flightState.pitch = 0;
  flightState.bank = 0;
  flightState.sink = 0;
  flightState.rollHold = false;
  flightState.maneuver = null;
  flightState.speed = SPEED.cruise;
  flightState.targetSpeed = SPEED.cruise;
  quatFromEulerYXZ(0, h, 0, flightState.quat);
  syncAircraft();
  setGear(false);
  setAircraftOpacity(1);
  // keepPolicy: the policy performing this restore must not reset itself.
  physics.reset(flightState, { keepPolicy: true });
  snapChaseCamera();
  viewHold = 0;
  input.clearTransient();
  prevPitchDeg = flightState.pitch / DEG;
  pitchRateDeg = 0;
  /**
   * 05.2 — post-condition, not a belt-and-braces lift.
   *
   * The respawn altitude is a floor on ABSOLUTE altitude, so ending up in the sea
   * should be impossible. It was reported anyway at 2000 m, which means some other
   * writer is touching the transform after this runs. Verify the invariant here and
   * log loudly when it does not hold: the numbers in that log name the culprit,
   * whereas raising the floor only hides it.
   */
  const below = terrainIndexed ? groundAt(flightState.position.x, flightState.position.z) : WORLD.oceanY;
  if (flightState.position.y < below + RESPAWN.clearance) {
    console.warn("[respawn] post-condition failed — something moved the aircraft after the respawn", {
      wanted: Math.round(y),
      actual: Math.round(flightState.position.y),
      groundBelow: Math.round(below),
    });
    flightState.position.y = below + RESPAWN.clearance;
    syncAircraft();
  }
  console.log("[respawn]", { impact: [Math.round(crashFx.state.origin.x), Math.round(crashFx.state.origin.z)], spawn: [Math.round(x), Math.round(y), Math.round(z)], headingDeg: Math.round((h * 180) / Math.PI), lives });
  // Diegetic, and deliberately a little cold: the aircraft you were flying is
  // gone, and so is whoever was in it.
  combatHud.flash("A NEW PILOT IS NOW DEPLOYED TO YOUR LOCATION", "info");
  return { x, y, z };
}

function ensureSafeSpawn(flight, heading) {
  flight.position.y = Math.max(flight.position.y, safeSpawnAltitude(flight.position, heading, terrainIndexed ? groundAt : null));
  return flight;
}

function restoreMissionState(snapshot) {
  if (!snapshot) return;
  clearEncounterFx();
  if (snapshot.onDeck) {
    placeOnDeck();
  } else {
    // Clearance is enforced HERE, not at capture: the terrain is what it is now,
    // and a snapshot cannot know what it will be restored into.
    ensureSafeSpawn(snapshot.flight, snapshot.heading || 0);
    applyFlightState(flightState, snapshot.flight);
    // A respawn is level and at cruise. Restoring a dive — or the crash's own
    // terminal speed — hands the player an aircraft already in trouble.
    flightState.speed = Math.max(flightState.speed, SPEED.cruise);
    flightState.targetSpeed = flightState.speed;
    flightState.sink = 0;
    syncAircraft();
    // keepPolicy: the policy performing this restore must not reset itself.
    physics.reset(flightState, { keepPolicy: true });
    setGear(false);
    snapChaseCamera();
    viewHold = 0;
  }
  if (rounds) rounds.setCount(snapshot.aim9);
  gun.state.ammo = snapshot.gunAmmo;
  gun.state.dry = false;
  weapon = snapshot.weapon;
  input.clearTransient();
  combatHud.reset();
  engineFx.reset();
  vaporFx.reset();
  atmosphere.reset();
  prevPitchDeg = flightState.pitch / DEG;
  pitchRateDeg = 0;
}

const director = createMissionDirector({
  captureCheckpoint: captureMissionState,
  restoreCheckpoint: restoreMissionState,
});

/**
 * §39/§40 — the mission response policy. Terrain collision detection is
 * unchanged; only what happens about it is different. It also serves missile
 * hits through trigger(), so one failure model covers both.
 */
const missionFailure = createMissionCheckpointResponse({
  onFail: (reason) => {
    combatHud.flash(reason);
    director.fail(reason);
    /**
     * §2/§4 — the crash presentation starts here and nowhere else: after
     * gameplay has already decided the player is destroyed. It is handed the
     * aircraft's live transform and velocity, so the theatre begins from exactly
     * the attitude and momentum the player had — including inverted (§45).
     */
    _crashVel.copy(_fwdV).multiplyScalar(flightState.speed);
    crashFx.start({
      cause: causeFromReason(reason),
      position: aircraftRoot.position,
      quat: aircraftRoot.quaternion,
      velocity: _crashVel,
      heading: flightState.heading,
      impactNormal: physics.state.contactNormal || null,
    });
    // §34 — silence what is no longer true. The cannon loop and the warnings
    // belong to an aircraft that is now falling.
    audio.loop(Cue.GUN, false);
    audio.play(Cue.MISSILE_HIT, { force: true });
  },
  // §25 in MISSION: back to the last checkpoint. In FREE and PEACE there are no
  // checkpoints, and the answer the brief asked for is the obvious one — you
  // respawn on the carrier and fly off it again. That is the same call R makes,
  // which is why the sandbox modes needed no respawn code of their own.
  //
  // §31/§32 — this fires at full black, so the crash is cleaned and the aircraft
  // repositioned inside the same invisible frame. The respawn DESTINATION logic is
  // untouched; the presentation only delayed the call.
  onRestore: () => {
    crashFx.reset();
    if (modeRules(mode).respawn === "CARRIER") {
      restartMission();
      return;
    }
    /**
     * An airborne death does NOT go through `director.rewind()`.
     *
     * Three attempts at this failed for the same reason: rewind restores a
     * checkpoint's POSITION and PHASE, and both fought the fix. If the checkpoint
     * for the current phase was never captured it falls back to the deck one,
     * which flips the phase to DECK — handing the aircraft to the launch script
     * and undoing any repositioning. The player ended up exactly where they died,
     * inside the terrain, killed again on a loop.
     *
     * So progression is restored WITHOUT touching position or phase: you keep the
     * phase you died in, you get your stores back, and you respawn behind the
     * thing that killed you. There is no checkpoint table in this path at all,
     * which is why it cannot depend on one being present.
     */
    if (director.playerFlies) {
      /**
       * Stage 05.0 — a pilot is spent HERE, at the restore, not at the impact.
       * The number is what the player has left to fly, so it drops when the
       * replacement is dispatched rather than when the old aircraft is hit.
       */
      if (modeRules(mode).lives !== false) {
        lives -= 1;
        paintLives();
        if (lives <= 0) {
          missionFailed();
          return;
        }
      }
      director.stats.checkpointsUsed += 1;
      const cp = director.checkpoints[director.state.checkpoint];
      if (cp && cp.snapshot) {
        if (rounds) rounds.setCount(cp.snapshot.aim9);
        gun.state.ammo = cp.snapshot.gunAmmo;
        weapon = cp.snapshot.weapon;
      } else {
        if (rounds) rounds.reload();
        gun.state.ammo = gun.cfg.ammo;
      }
      gun.state.dry = false;
      clearEncounterFx();
      combatHud.reset();
      engineFx.reset();
      vaporFx.reset();
      atmosphere.reset();
      if (rearm) rearm.reset();
      respawnFromCrash();
      return;
    }
    // Died before the handoff — the launch script owns this, so re-run it.
    director.rewind();
  },
});

/**
 * §44/§45 — what an encounter leaves behind. Called at every phase transition
 * and every checkpoint restore: no missile from a fight that ended ninety
 * seconds ago, no tracers from a burst nobody remembers, no target marker for a
 * hostile that is no longer part of the mission.
 */
function clearEncounterFx() {
  if (missiles) {
    missiles.expireOwner("hostile");
    missiles.expireOwner("sam");
  }
  gun.clearFx();
  threat.reset();
  hitResponse.reset();
}
/**
 * §42/§43 — one hostile instance, three encounters. It is repositioned in front
 * of the player and given the ammunition the encounter calls for; INTERCEPT's
 * zero rounds is what makes that phase one-way pressure without a new state.
 */
function deployHostile(enc) {
  const e = MISSION.encounter;
  quatForward(flightState.quat, _fwd);
  const side = hostileAi.state.encounters % 2 === 0 ? 1 : -1;
  const at = {
    x: aircraftRoot.position.x + _fwd.x * e.ahead - _fwd.z * side * e.lateral,
    y: Math.max(HOSTILE.minAltitude + 60, aircraftRoot.position.y + e.above),
    z: aircraftRoot.position.z + _fwd.z * e.ahead + _fwd.x * side * e.lateral,
  };
  // Facing back down the player's course: a head-on pass is how an intercept
  // announces itself, and it puts the hostile on screen without a hunt.
  hostileAi.deploy({ at, heading: Math.atan2(-_fwd.x, -_fwd.z) + Math.PI, ammo: enc.ammo, engageDelay: enc.engageDelay });
}

director.on("phase", ({ phase }) => {
  clearEncounterFx();
  if (phase === MissionPhase.LAUNCH) director.startTimer();
  const rules = modeRules(mode);
  // §SAM — the ground threat belongs to TERRAIN, which is the phase that used to
  // be the breather. That is the trade the brief asked for.
  samNet.setActive(rules.sams && phase === MissionPhase.TERRAIN);
  const enc = rules.hostiles ? encounterFor(phase) : null;
  if (enc) {
    deployHostile(enc);
  } else {
    // §5 — do not simulate what the player cannot interact with.
    hostileAi.setActive(false);
    targeting.clear();
  }
  if (phase === MissionPhase.COMPLETE) showComplete();
  else hideComplete();
  // A sandbox mode has flown the launch and the director has parked: the sandbox
  // driver takes over from here.
  if (phase === MissionPhase.EGRESS && isSandbox(mode)) sandbox.begin(mode);
});

director.on("leg", ({ leg }) => combatHud.flash(`NAV ${leg.name} REACHED`, "good"));

/**
 * Stage 05.0 — lives.
 *
 * The sortie could not previously be lost: every phase had a time fallback and
 * every crash respawned, so COMPLETE was the only ending. A game that cannot be
 * lost has no stakes, and the spec asks for an ending that can be a loss.
 *
 * Five pilots. The fallbacks stay — nothing soft-locks, and you still cannot lose
 * on the clock — but you can run out of aircraft.
 *
 * MISSION only. FREE and PEACE are practice; counting deaths there would turn a
 * sandbox into a test.
 */
const LIVES = {
  start: 5,
  /**
   * A fixed, generous respawn altitude, replacing the escalating one.
   *
   * The escalation existed because respawns kept landing in terrain and needed to
   * climb their way out over repeated deaths. With only five aircraft that is no
   * longer an acceptable way to converge — each attempt costs a pilot. So the
   * first attempt is simply high enough that terrain cannot be a factor: the
   * island peaks at 643 m.
   */
  respawnAltitude: 4000,
};

let lives = LIVES.start;
const livesEl = document.getElementById("lives");
const livesCountEl = document.getElementById("lives-count");
const failedEl = document.getElementById("failed");
const failedStatsEl = document.getElementById("failed-stats");
const failedLineEl = document.getElementById("failed-line");

function paintLives() {
  const counted = modeRules(mode).lives !== false;
  livesEl.hidden = !counted;
  if (!counted) return;
  livesCountEl.textContent = String(Math.max(0, lives));
  livesEl.classList.toggle("low", lives === 2);
  livesEl.classList.toggle("critical", lives <= 1);
}

/**
 * The loss screen. `reason` picks the line under the title — the only difference
 * between the two ways to lose, because they are the same KIND of event and
 * should read that way (§36).
 */
function showFailed(reason) {
  failedLineEl.textContent =
    reason === "TIME"
      ? "Enemy reinforcements have arrived. The recovery window is closed."
      : "The squadron has no one left to send.";
  failedStatsEl.innerHTML = director.summary.map((row) => `<dt>${row.label}</dt><dd>${row.value}</dd>`).join("");
  failedEl.hidden = false;
}
function hideFailed() {
  failedEl.hidden = true;
}

/** §16 — build the anchors, then hand the director the route that reads them. */
function buildRoute() {
  const coastZ = terrainReport ? terrainReport.nearEdgeZ : WORLD.carrier.position.z - WORLD.terrain.coastOffsetFromCarrier;
  // §27 — the inland legs are chosen from the geometry that is actually there:
  // the corridor is sampled and the deepest pass in each band wins. No terrain
  // was modified to fit a theoretical route.
  const features = terrainIndexed
    ? surveyTerrainRoute((x, z) => {
        const h = physics.sampleTerrainBelow({ x, y: 0, z });
        return h.foundTerrain ? h.terrainHeight : WORLD.oceanY;
      }, coastZ)
    : [];
  const route = planRoute({ coastZ, features });

  navRoot.clear();
  const debugGroup = new THREE.Object3D();
  debugGroup.name = "NavDebug";
  debugGroup.visible = false;
  for (const leg of route) {
    const anchor = new THREE.Object3D();
    anchor.name = `Nav${leg.name}`;
    anchor.position.set(leg.position.x, leg.position.y, leg.position.z);
    navRoot.add(anchor);
    const ring = new THREE.Mesh(
      new THREE.SphereGeometry(leg.radius, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x9fd7ff, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false, fog: false })
    );
    ring.position.copy(anchor.position);
    debugGroup.add(ring);
  }
  navRoot.add(debugGroup);
  navDebug = { toggle: () => (debugGroup.visible = !debugGroup.visible) };

  director.setRoute(route);
  console.log("[mission] route", { coastZ, features, legs: route.map((l) => `${l.phase}/${l.name} @ ${Math.round(l.position.x)},${Math.round(l.position.z)} r${l.radius}`) });
  return route;
}

function setGear(down) {
  // Seeded null, not true: loadF15() leaves the model gear-UP, so a cache primed
  // with the deck value made the first setGear(true) a no-op and the gear-down
  // configuration unreachable for the whole mission. The first call must always
  // paint, whatever the asset happened to load as.
  if (down === gearDown) return;
  gearDown = down;
  setGearVisual(f15Visual, down);
}

/**
 * §6 — fade the intact aircraft out behind its own smoke, rather than hiding it
 * on the frame it dies. Cached, so a normal frame costs one comparison: the
 * traversal writes to every material in the model and must not run at 60 Hz.
 */
let aircraftOpacity = 1;
function setAircraftOpacity(v) {
  const next = Math.max(0, Math.min(1, v));
  if (Math.abs(next - aircraftOpacity) < 0.01) return;
  aircraftOpacity = next;
  if (!f15Visual) return;
  f15Visual.visible = next > 0.01;
  f15Visual.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.transparent = next < 0.999;
      m.opacity = next;
      m.depthWrite = next > 0.5;
    }
  });
}

/** §6 — parked on the deck, attached to the launch frame. No wheel physics. */
function placeOnDeck() {
  // The start-up cue is fired once per launch; arm it here rather than in the
  // frame loop, so every path onto the deck resets it.
  startCueFired = false;
  audio.stop(Cue.ENGINE_START);
  if (launchAnchors) launch.arm(launchAnchors.start, launchAnchors.end);
  else launch.reset();
  const p = launch.pose;
  flightState.position.x = p.x;
  flightState.position.y = p.y;
  flightState.position.z = p.z;
  flightState.heading = p.heading;
  flightState.pitch = 0;
  flightState.bank = 0;
  flightState.speed = 0;
  flightState.targetSpeed = 0;
  flightState.throttle = p.throttle;
  flightState.afterburner = false;
  flightState.sink = 0;
  flightState.rollHold = false;
  flightState.maneuver = null;
  quatFromEulerYXZ(0, p.heading, 0, flightState.quat);
  syncAircraft();
  setGear(true);
  viewHold = 1;
  snapChaseCamera();
}

/** §14 — scripted motion off, flight controller on, nothing visibly snapping. */
function handoff() {
  flightState.speed = LAUNCH.handoffSpeed;
  flightState.throttle = LAUNCH.handoffThrottle;
  flightState.targetSpeed = getTargetSpeed(flightState.throttle);
  flightState.afterburner = isAfterburner(flightState.throttle);
  flightState.sink = 0;
  syncAircraft();
  // Safe-state history starts here: nothing before the handoff is a state the
  // player could be recovered to.
  physics.reset(flightState);
  setGear(false);
  viewHold = 1;
  input.clearTransient();
}

/**
 * Stage 05.0 — the loss ending.
 *
 * Freezes the sortie the way COMPLETE does, so a win and a loss are the same kind
 * of event rather than two different mechanisms. The mission clock stops, the
 * aircraft is left where it fell, and R restarts.
 */
function missionFailed(reason = "OUT OF PILOTS") {
  missionFailure.reset();
  crashFx.reset();
  setAircraftOpacity(1);
  hostileAi.setActive(false);
  samNet.setActive(false);
  targeting.clear();
  clearEncounterFx();
  director.state.timerRunning = false;
  director.stats.time = director.state.missionTime;
  lives = 0;
  paintLives();
  fadeEl.style.opacity = "0";
  showFailed(reason);
}

/** R, and the complete screen's R/Enter. §36 — one call resets everything. */
function restartMission() {
  hideComplete();
  hideFailed();
  lives = LIVES.start;
  paintLives();
  missionFailure.reset();
  placeOnDeck();
  applyReset();
  director.reset();
  hostileAi.setActive(false);
  samNet.setActive(false);
  sandbox.reset();
  targeting.clear();
  audio.reset();
  beginOpeningFade();
}

/**
 * The opening fade is driven by the WALL CLOCK and backed by a timeout, not by
 * accumulated frame time.
 *
 * A page that loads in a background tab or an unfocused preview never runs a
 * single animation frame, so a fade that only decays inside the loop leaves the
 * whole viewport black — canvas, HUD and diagnostics — with no way to tell that
 * anything loaded at all. The timeout clears it regardless of whether the loop
 * ever ran; the loop's own read is the smooth version of the same value.
 */
function beginOpeningFade() {
  openingFade = MISSION.fadeIn;
  openingFadeAt = performance.now();
  fadeEl.style.opacity = "1";
  clearTimeout(openingFadeTimer);
  openingFadeTimer = setTimeout(() => {
    openingFade = 0;
    applyFade();
  }, MISSION.fadeIn * 1000);
}

/** One fade layer, three sources: whichever is darkest wins. */
function applyFade() {
  const fade = Math.max(missionFailure.state.fade, director.state.fade, openingFade / MISSION.fadeIn);
  fadeEl.style.opacity = fade.toFixed(3);
  return fade;
}

const _autoGoal = { heading: 0, altitude: MISSION.recovery.altitude, speed: MISSION.recovery.speed };
const _stick = { x: 0, y: 0, roll: 0, throttle: 0 };

/** §34 — level out, turn toward the ship, hold cruise. That is the whole trick. */
function recoveryGoal() {
  const home = carrierReport ? carrierReport.center : { x: 0, y: 0, z: WORLD.carrier.position.z };
  _autoGoal.heading = bearingTo(aircraftRoot.position, home);
  return _autoGoal;
}

// Reused object: the HUD reads the nav cue every frame and must not allocate.
const _navCtx = { valid: false, position: null, name: null, range: 0 };
function navCtx() {
  const m = director.state;
  _navCtx.valid = m.navValid;
  _navCtx.position = m.navPosition;
  _navCtx.name = m.navName;
  _navCtx.range = m.navRange;
  return _navCtx;
}

// §16: the round leaves a wing hardpoint, never the aircraft's centre.
hostileAi.on("launch", () => {
  if (!missiles) return;
  // The drone moved this frame; its hardpoint's world transform has to be
  // current or the round leaves from where the enemy was, not where it is.
  drone.root.updateMatrixWorld(true);
  missiles.fire({
    mount: drone.hardpoint,
    target: playerEntity,
    ownerSpeed: drone.speed,
    owner: "hostile",
    side: 1,
    cfg: HOSTILE_MISSILE,
  });
});

/* ---- Stage 04.1/04.5: rearm and audio ---- */
// §13 — built after `rounds` exists, so it is created in the load block. The
// binding lives here because the frame loop and the reset both reach for it.
let rearm = null;
/**
 * §04.5 — NO MUSIC. Every sound in the build is diegetic and almost every one is
 * information: the engine, the cannon, and a voice telling you what has locked
 * you. Created now so the first user gesture arms it during the load screen.
 */
const audio = createAudioDirector({ gestureTarget: window });

/* ---- Stage 03.15 atmospheric FX ---- */
// Three independent systems, each additive and each reading published state
// only. Nothing here writes to flightState or to physics.
const engineFx = createEngineFx(aircraftRoot);
const vaporFx = createVaporFx(aircraftRoot, scene);
const atmosphere = createAtmosphere({ scene });
// Pitch rate is the one load proxy that has to be differentiated here: the
// flight model publishes attitude, not rates, and this stage may not add a
// field to it. Tracked in degrees per second across the frame.
let prevPitchDeg = flightState.pitch / DEG;
let pitchRateDeg = 0;

const _fwd = { x: 0, y: 0, z: -1 };
// HUD-only attitude inputs. Derived from the aircraft quaternion every frame so
// the display works through knife-edge, inverted flight and loops without any
// Euler state feeding back into the flight model (§12).
const _up = { x: 0, y: 1, z: 0 };
// Gun dispersion needs a third axis. right = forward × up holds through
// inverted flight, which an assumed world-up reference would not.
const _right = new THREE.Vector3();
const _fwdV = new THREE.Vector3();
const _upV = new THREE.Vector3();
const _ownVel = new THREE.Vector3();
const _velDir = new THREE.Vector3(0, 0, -1);
// Camera jitter while the cannon fires, removed before the rig runs so it never
// accumulates into the chase camera's own damping (§23).
const _gunShake = new THREE.Vector3();
const _prevPos = new THREE.Vector3().copy(aircraftRoot.position);
const _screen = {};
// Reused candidate list for targeting: the drone plus every live SAM site. A
// fresh array per frame would allocate 60 times a second for no reason.
const _candidates = [];
// Previous hostile range, so the fly-by fires once per pass.
let _prevHostileRange = Infinity;
// Seconds until the current trajectory reaches the ground, published for the
// developer rail: the PULL UP rule is now a time, so the time has to be visible
// or the only way to check it is to crash.
let _tti = Infinity;
// How long the player has actually been flying. Ground warnings are silent below
// AUDIO.warnGraceSeconds, so the launch and every respawn are never talked over.
let playerFliesFor = 0;
// Reused radar contact list: the drone plus every SAM currently emitting. A fresh
// array per frame would allocate 60 times a second for no reason.
const _contacts = [];
/**
 * Stage 04.9 — what the radar knows.
 *
 * Detection only. Air contact appears whenever the hostile is active and alive;
 * ground contacts appear only while a site is actually EMITTING at the player
 * (TRACK / LOCK / LAUNCH), which is deliberate. Showing every site the moment the
 * player is in range would hand them the whole threat map and quietly undo the
 * terrain-masking mechanic — whereas this way flying the valley keeps the radar
 * clean, and a site lighting up on it means the same thing as the warning in the
 * player's ear. The display reinforces the rule instead of bypassing it.
 */
function radarContacts() {
  _contacts.length = 0;
  if (hostileAi.state.active && drone.alive) _contacts.push({ x: drone.position.x, z: drone.position.z, kind: "AIR" });
  for (const s of samNet.sites) {
    if (!s.alive) continue;
    if (s.phase !== SamState.TRACK && s.phase !== SamState.LOCK && s.phase !== SamState.LAUNCH) continue;
    _contacts.push({ x: s.position.x, z: s.position.z, kind: "SAM" });
  }
  return _contacts;
}

const _radar = { position: null, heading: 0, contacts: _contacts };
function radarCtx() {
  _radar.position = aircraftRoot.position;
  _radar.heading = flightState.heading;
  _radar.contacts = radarContacts();
  return _radar;
}

const observer = { position: aircraftRoot.position, forward: _fwd };

// NDC radius of a target, or null when it is behind the camera — the "near the
// centre of screen" half of the acquisition rule (§15).
const screenOffsetOf = (t) => {
  projectToScreen(camera, t.position, window.innerWidth, window.innerHeight, _screen);
  return _screen.behind ? null : _screen.offset;
};

function tryFire() {
  if (!missiles || !rounds) return;
  if (!targeting.canFire()) {
    combatHud.flash(targeting.state.currentTarget ? "NO LOCK" : "NO TARGET");
    return;
  }
  const round = rounds.next();
  if (!round) {
    combatHud.flash("AIM-9 EMPTY");
    return;
  }
  // The visible round leaves the wing and a live entity takes its place at the
  // same world transform — that continuity is the whole launch read (§19).
  const mount = rounds.release(round);
  missiles.fire({
    mount,
    target: targeting.state.currentTarget,
    ownerSpeed: flightState.speed,
    side: mount.userData.side,
    owner: "player",
  });
  combatHud.flash("MISSILE AWAY", "info");
  audio.play(Cue.MISSILE_LAUNCH);
  director.stats.aim9Fired += 1;
}

/** One trigger, two weapons (§4). The selected weapon decides what it means. */
function handleFireInput() {
  const pressed = input.takeFire();
  // §33 — weapons go cold once the recovery sequence begins. The latch is still
  // consumed, so nothing fires on the frame control comes back.
  if (!director.weaponsHot) return;
  // The latch is consumed either way — a press made in GUN mode must not fire a
  // missile the moment the player switches back.
  if (weapon === WeaponMode.AIM9 && pressed) tryFire();
}

/* ---- physics ---- */
// Layered under the flight model, not into it: the contact service reads
// AircraftRoot and only ever writes back through a whole-state restore.
const physics = createWorldPhysics({ oceanY: WORLD.oceanY });
const physicsDebug = createPhysicsDebug(scene, PROBES);
let anchorDebug = null;

function syncAircraft() {
  aircraftRoot.quaternion.set(flightState.quat.x, flightState.quat.y, flightState.quat.z, flightState.quat.w);
  aircraftRoot.position.set(flightState.position.x, flightState.position.y, flightState.position.z);
}

/**
 * Stage 02.3: the response policy is injected, not built in. Detection hands it
 * a CollisionEvent and knows nothing else — replacing this object with a crash
 * sequence later touches no terrain code and no flight code.
 */
const recovery = createDevelopmentRecoveryResponse({
  history: physics.history,
  flightState,
  clearInput: () => input.clearTransient(),
  onRestore: () => syncAircraft(),
  // Empty history (a collision inside the first second) falls back to the
  // Stage 02 airborne reset rather than inventing a position.
  fallbackReset: () => {
    resetFlightState(flightState);
    syncAircraft();
    snapChaseCamera();
  },
});
physics.setResponse(recovery);

/**
 * §40 — the active response POLICY, swappable at runtime (G). Detection is
 * identical either way; this is the only thing that differs between "rewind me
 * 0.65 s so I can keep testing terrain" and "that was a failure, go back to the
 * checkpoint". Keeping both live is the point of having separated them.
 */
let physicsPolicy = recovery;
function setResponsePolicy(next) {
  physicsPolicy = next;
  physics.setResponse(next);
  next.reset();
  return next.name;
}

function applyReset() {
  syncAircraft();
  input.clearTransient();
  physics.reset(flightState);
  snapChaseCamera();
  resetCombat();
}

/**
 * R restores one combat test state, not two: flight reset and combat reset are
 * the same key, so there is no way to end up with a fresh aircraft and a stale
 * battle (§31). Live missiles, bursts, lock and ammo all go with it.
 */
function resetCombat() {
  // The crash presentation goes first: it is the one system that OWNS the aircraft
  // transform, so leaving it active would have the theatre keep driving a freshly
  // respawned aircraft. This also makes R an unconditional escape hatch — the key
  // handler runs outside the render loop, so R recovers the game even if a crash
  // somehow leaves the loop wedged.
  crashFx.reset();
  setAircraftOpacity(1);
  if (missiles) missiles.reset();
  if (rounds) rounds.reload();
  // Ammo resets; the *selected* weapon does not. R restores the battle, not the
  // player's choice of how to fight it.
  gun.reset();
  resetTargetDrone(drone);
  // §38: the enemy, its AI, its ammunition and every threat display go back with
  // everything else. No stale hostile missile survives a reset — missiles.reset()
  // above clears both owners' rounds.
  hostileAi.reset();
  threat.reset();
  hitResponse.reset();
  if (rearm) rearm.reset();
  samNet.reset();
  flares.reset();
  audio.reset();
  playerEntity.velocity.set(0, 0, 0);
  playerEntity.alive = true;
  targeting.clear();
  // Drop HUD smoothing history too, or the ladder and target bracket sweep in
  // from wherever they were before the reset.
  combatHud.reset();
  _prevPos.copy(aircraftRoot.position);
  // FX carry visible history — a plume mid-spool, ribbons in the air, fog part
  // way into a cloud — so they reset with everything else.
  engineFx.reset();
  vaporFx.reset();
  atmosphere.reset();
  prevPitchDeg = flightState.pitch / DEG;
  pitchRateDeg = 0;
}

input.onReset(() => {
  // §36 — R is now the mission restart, not a combat reset: phase, player,
  // hostiles, missiles, gun ammo, launch state, navigation and damage state all
  // go back together. There is no key that leaves half a mission behind.
  restartMission();
});

input.onModeToggle(() => {
  // Seamless: position, speed and attitude all carry over, so nothing is
  // re-placed and the camera is left to damp across the up-vector change.
  toggleFlightMode(flightState);
  input.clearTransient();
  updateHud(1);
});

input.onWeaponCycle(() => {
  weapon = cycleWeapon(weapon);
  combatHud.flash(weapon === WeaponMode.GUN ? "GUN SELECTED" : "AIM-9 SELECTED", "info");
});

// §04.4 — the pitch convention. Announced in the words that say what the key
// does, not as "INVERT ON": a player who has just pressed it needs to know which
// way W now goes, and "ON" does not tell them.
input.onPitchModeToggle((inverted, name) => combatHud.flash(`PITCH \u00b7 W = ${name}`, "info"));

// Steering is the keyboard (04.0a). The mouse keeps the trigger, the weapon
// cycle and the lead pipper — the three things it was actually good at.

/* ---- overlay ----
 * 18 rows, not 23: Stage 03.15 folded related readings onto shared lines so the
 * rail fits its box at 540 px instead of silently cropping its last five rows.
 * Every fold keeps every value — nothing was dropped to make room.
 */
const keysEl = document.getElementById("keys");
const hud = {
  root: document.getElementById("hud"),
  mode: document.getElementById("v-mode"),
  spd: document.getElementById("v-spd"),  thr: document.getElementById("v-thr"),
  pbh: document.getElementById("v-pbh"),
  alt: document.getElementById("v-alt"),
  mnvr: document.getElementById("v-mnvr"),
  fov: document.getElementById("v-fov"),
  ref: document.getElementById("v-ref"),
  clr: document.getElementById("v-clr"),
  ctc: document.getElementById("v-ctc"),  fwd: document.getElementById("v-fwd"),
  phys: document.getElementById("v-phys"),
  recv: document.getElementById("v-recv"),
  qry: document.getElementById("v-qry"),
  tgt: document.getElementById("v-tgt"),
  host: document.getElementById("v-host"),
  sam: document.getElementById("v-sam"),
  thrt: document.getElementById("v-thrt"),
  ammo: document.getElementById("v-ammo"),
  eng: document.getElementById("v-eng"),
  atm: document.getElementById("v-atm"),
  msn: document.getElementById("v-msn"),
  nav: document.getElementById("v-nav"),
};

/* ---- Stage 04.0 presentation shells ---- */
const fadeEl = document.getElementById("fade");
const completeEl = document.getElementById("complete");
const completeStatsEl = document.getElementById("complete-stats");
const completeTitleEl = document.getElementById("complete-title");

/** §35 — compact run information. Time and a few combat stats, nothing more. */function showComplete() {
  completeTitleEl.textContent = `${MISSION.title} Complete`;
  completeStatsEl.innerHTML = director.summary.map((row) => `<dt>${row.label}</dt><dd>${row.value}</dd>`).join("");
  completeEl.hidden = false;
}
function hideComplete() {
  completeEl.hidden = true;
}

/**
 * How much of the left edge the developer rail is occupying, in px, so the
 * combat HUD can keep its instruments out from under it. Measured rather than
 * assumed: the rail's width comes from its own content and changes with the
 * longest row. Hidden rail means no gutter at all.
 */
let hudSafeLeft = 0;
function measureRail() {
  hudSafeLeft = hud.root.hidden ? 0 : Math.round(hud.root.getBoundingClientRect().right) + 24;
  return hudSafeLeft;
}
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  /**
   * Stage 05.5 — ESC pauses and resumes. One key, both directions.
   *
   * Handled before every other binding and returns immediately: while paused the
   * only key that does anything is the one that unpauses, so a stray H or T
   * cannot toggle overlays or restart the mission behind the pause screen.
   */
  if (e.key === "Escape") {
    setPaused(!paused);
    e.preventDefault();
    return;
  }
  if (paused) {
    /**
     * K WHILE PAUSED IS ALLOWED, and it is the one exception to the rule below.
     *
     * Muting is a comfort control, not a game action: it cannot advance the
     * mission, spend a pilot or move the aircraft, so there is no reason to
     * refuse it. Refusing it made the mute key look broken -- a paused player
     * pressing K got silence either way and no feedback, and reasonably
     * concluded the binding was dead.
     *
     * It edits the player's REMEMBERED preference, because the pause is already
     * forcing silence; `mutedBeforePause` is what gets restored on resume, so
     * that is the value the keypress has to change. Feedback goes on the pause
     * overlay, since the HUD is not being updated while paused.
     */
    if (k === "k") {
      mutedBeforePause = !mutedBeforePause;
      if (pauseHintEl) pauseHintEl.textContent = mutedBeforePause ? "Esc to resume \u00b7 audio off" : "Esc to resume";
      e.preventDefault();
    }
    return;
  }
  // H owns the whole developer overlay — stats panel and key legend together —
  // so what is left on screen is the combat interface alone (§35).
  if (k === "h") {
    hud.root.hidden = !hud.root.hidden;
    if (keysEl) keysEl.hidden = hud.root.hidden;
    measureRail();
  }
  if (k === "j") combatHud.toggle();
  // §Flares — handled in the frame loop now, because there are two sources (Z and
  // the middle mouse button) feeding one latch in input.js.
  if (k === "k") combatHud.flash(audio.toggleMute() ? "AUDIO OFF" : "AUDIO ON", "info");
  // Stage 05.3 — the pointer-steering kill switch. Undocumented on purpose; see
  // the note on `pointerAllowed`.
  if (k === "v") {
    pointerAllowed = !pointerAllowed;
    combatHud.flash(pointerAllowed ? "MOUSE STEERING ON" : "MOUSE STEERING OFF", "info");
  }
  if (k === "p") physicsDebug.toggle();
  /**
   * Stage 05.4 — the only two time controls there are (§7/§8/§10).
   *
   * A preset MOVES the clock and then lets it run: neither key freezes time, and
   * there is deliberately no slider, no pause, no noon/midnight button and no
   * time acceleration. They work identically in all three modes because they set
   * the one global clock, and the result survives a mode switch for the same
   * reason — nothing resets it.
   */
  if (k === "[") {
    worldClock.setTau(DAY.sunriseTau);
    combatHud.flash("SUNRISE", "info");
  }
  if (k === "]") {
    worldClock.setTau(DAY.sunsetTau);
    combatHud.flash("SUNSET", "info");
  }
  if (k === "o" && anchorDebug) anchorDebug.toggle();
  // §16/§19 — draw the route: every nav anchor and its trigger volume.
  if (k === "n" && navDebug) navDebug.toggle();
  // Stage 04.2 — cycle mode. A mode change restarts, because every mode starts
  // on the deck and half a mission in the wrong ruleset is not a state.
  if (k === "t") {
    const rules = applyMode(nextMode(mode));
    restartMission();
    combatHud.flash(rules.label, "info");
  }
  // §40 — A/B the two response policies without touching detection.
  if (k === "g") {
    const name = setResponsePolicy(physicsPolicy === recovery ? missionFailure : recovery);
    combatHud.flash(name === "MissionCheckpointResponse" ? "MISSION FAILURE ON" : "DEV RECOVERY ON", "info");
  }
  // §36 — Enter restarts, but only from an ending screen: Enter is the secondary
  // trigger during flight and must not double as a reset key.
  if (k === "enter" && (director.state.phase === MissionPhase.COMPLETE || !failedEl.hidden)) restartMission();
  // A/B the experimental camera roll without touching the rig.
  if (k === "1") CHASE.rollInfluence = 0.0;
  if (k === "2") CHASE.rollInfluence = 0.1;
  if (k === "3") CHASE.rollInfluence = 0.15;
});

const signed = (v, digits = 1) => (v >= 0 ? "+" : "") + v.toFixed(digits);
const BAR_CELLS = 10;
// Drawn as cells rather than █/░ glyphs: the shade glyph renders shorter than
// the full block in most monospace faces, so the empty half of the bar sat low.
const throttleBar = (t) => {
  const filled = Math.round(t * BAR_CELLS);
  let html = "";
  for (let i = 0; i < BAR_CELLS; i++) {
    html += `<i class="cell${i < filled ? " on" : ""}"></i>`;
  }
  return html;
};
let fps = 0;
let hudClock = 0;

// Static after load: 30 km of geometry is never re-measured per frame.
let carrierReport = null;
let terrainReport = null;

function updateHud(dt) {
  hudClock += dt;
  fps += (1 / Math.max(dt, 1 / 240) - fps) * 0.12;
  if (hudClock < 0.1 || hud.root.hidden) return;
  hudClock = 0;
  // Re-measured on the HUD's own 10 Hz tick, not just on load and resize. The
  // rail's width is content-driven, so it changes when a row's TEXT changes —
  // which no layout event reports. A load-time-only sample was frozen at the
  // narrowest the panel ever is.
  measureRail();
  const expert = isExpert(flightState);
  if (hud.mode) {
    hud.mode.textContent = flightState.mode;
    hud.mode.style.color = expert ? "#9fe6b0" : "#e8f0f6";
  }
  hud.spd.textContent = `${Math.round(flightState.speed)} \u2192 ${Math.round(flightState.targetSpeed)} m/s`;
  hud.thr.innerHTML = `<span class="bar">${throttleBar(flightState.throttle)}</span> ${Math.round(flightState.throttle * 100)}%${flightState.afterburner ? " AB" : ""}`;
  hud.thr.style.color = flightState.afterburner ? "#ffb45a" : "#e8f0f6";
  // Expert Euler values are derived from the quaternion and drive nothing, so
  // they are marked with ~ rather than shown as if they were authoritative.
  const mark = expert ? "~" : "";
  // P B H carries the attitude mode too: FREE with the derived vectors in
  // Expert, STABILISED in Assisted (was its own ATT row).
  const a = expert ? attitudeVectors(flightState) : null;
  hud.pbh.innerHTML =
    `${mark}${signed(flightState.pitch / DEG)}\u00b0 \u00b7 ${mark}${signed(bankDegrees(flightState))}\u00b0 \u00b7 ${mark}${String(Math.round(headingDegrees(flightState))).padStart(3, "0")}\u00b0` +
    (expert
      ? ` <span style="color:${a.inverted ? "#ffd79a" : "rgba(232,240,246,0.55)"}">FREE ${signed(a.forwardY, 2)}/${signed(a.upY, 2)}${a.inverted ? " INV" : ""}</span>`
      : ` <span style="color:rgba(232,240,246,0.4)">STABILISED</span>`);
  // ALT carries AGL and the closest probe with it: everything about "how near
  // the ground am I" on one line (was ALT + CLR).
  const p0 = physics.state;
  hud.alt.innerHTML =
    `${Math.round(aircraftRoot.position.y)} m \u00b7 agl ${p0.queries ? metres(p0.agl) : "\u2014"} \u00b7 sink ${flightState.sink.toFixed(1)}` +
    (p0.queries ? ` \u00b7 <span style="color:${p0.minClearance <= p0.safeClearance ? "#ffd79a" : "#e8f0f6"}">clr ${metres(p0.minClearance)} ${p0.surface}</span>` : "");
  const mv = flightState.maneuver;
  // MNVR carries the camera/input line with it (was MNVR + FOV).
  const tail = ` <span style="color:rgba(232,240,246,0.55)">${camera.fov.toFixed(0)}\u00b0 \u00b7 in ${signed(input.x, 1)}/${signed(input.y, 1)}${input.roll ? ` r${signed(input.roll, 0)}` : ""}${input.pitchInverted() ? " \u00b7 INV" : ""}${input.heldKeys().length ? " \u00b7 " + input.heldKeys().join(" ") : ""}</span>`;
  if (mv) {
    hud.mnvr.innerHTML = `<span style="color:#ffd79a">BARREL ${mv.dir < 0 ? "L" : "R"} ${Math.round(mv.t * 100)}%</span>` + tail;
  } else if (flightState.rollHold) {
    hud.mnvr.innerHTML = `<span style="color:#9fd7ff">ROLL HOLD ${signed(bankDegrees(flightState), 0)}\u00b0</span>` + tail;
  } else {
    hud.mnvr.innerHTML = `<span style="color:rgba(232,240,246,0.45)">\u2014</span>` + tail;
  }

  // REF folds onto the FX row now, so this block only prepares the text.
  let refText = "";
  if (carrierReport || terrainReport) {
    const parts = [];
    if (carrierReport) parts.push(`carr ${distanceKm(aircraftRoot.position, carrierReport.center).toFixed(1)}`);
    if (terrainReport) {
      const toCoast = (aircraftRoot.position.z - terrainReport.nearEdgeZ) / 1000;
      parts.push(toCoast > 0 ? `coast ${toCoast.toFixed(1)}` : `inland ${(-toCoast).toFixed(1)}`);
    }
    refText = parts.join(" \u00b7 ") + " km";
  }
  hud.refText = refText;

  updatePhysicsHud();
  updateCombatRows();
  updateMissionRows();
}

const PHASE_COLOR = {
  DECK: "rgba(232, 240, 246, 0.6)",
  LAUNCH: "#ffb45a",
  EGRESS: "#e8f0f6",
  INTERCEPT: "#ffd79a",
  DEFENSIVE: "#ff9b7a",
  TERRAIN: "#e8d9a8",
  FINAL: "#ffd79a",
  EXTRACTION: "#9fd7ff",
  COMPLETE: "#9fe6b0",
};

/** §48 — the mission overlay. Developer rail only; the player sees none of it. */
function updateMissionRows() {
  const m = director.state;
  const rules = modeRules(mode);
  // In a sandbox mode the phase machine is parked, so the row reports the mode
  // and what the sandbox driver is doing instead of a phase that never changes.
  if (m.parked) {
    hud.msn.textContent = `${rules.label} \u00b7 ${formatShortClock(sandbox.state.elapsed)}` + (rules.hostiles ? ` \u00b7 ${sandbox.state.spawns} spwn` : "") + (m.failures ? ` \u00b7 ${m.failures} dn` : "");
    hud.msn.style.color = mode === GameMode.PEACE ? "#9fe6b0" : "#9fd7ff";
  } else {
    hud.msn.textContent =
      `${m.phase} ${formatShortClock(m.phaseTime)} \u00b7 t ${formatShortClock(m.missionTime)} \u00b7 cp${m.checkpoint}` +
      (m.failures ? ` \u00b7 ${m.failures}f` : "") +
      (m.recovering ? ` \u00b7 AUTO ${Math.round(m.autopilot * 100)}%` : "");
    hud.msn.style.color = PHASE_COLOR[m.phase] || "#e8f0f6";
  }

  const legs = director.legs;
  hud.nav.textContent = m.navValid
    ? `${m.navName} \u00b7 ${metres(m.navRange)} \u00b7 leg ${Math.min(m.legIndex + 1, legs.length)}/${legs.length}`
    : m.parked
      ? `\u2014 \u00b7 ${rules.blurb}`
      : legs.length
        ? `\u2014 \u00b7 leg ${legs.length}/${legs.length} met`
        : "\u2014";
  hud.nav.style.color = m.navValid ? "#d6e8f0" : "rgba(232, 240, 246, 0.45)";

  // Stage 04.2 — the ground picture. Line of sight is the mechanic, so whether a
  // site can currently SEE the player is the one thing that has to be visible
  // when the behaviour needs explaining.
  const s = samNet.state;
  if (!s.active) {
    hud.sam.textContent = "\u2014";
    hud.sam.style.color = "rgba(232, 240, 246, 0.45)";
  } else {
    const src = samNet.threatSource();
    const seen = samNet.sites.filter((k) => k.alive && k.visible).length;
    hud.sam.textContent =
      `${s.alive}/${samNet.sites.length} \u00b7 ${seen} seen` +
      (src ? ` \u00b7 ${src.phase} ${metres(src.range)} \u00b7 r${src.rounds}` : "") +
      (s.launches ? ` \u00b7 ${s.launches} shot` : "");
    hud.sam.style.color = s.locked ? "#ff9b7a" : s.tracking ? "#ffd79a" : seen ? "#e8d9a8" : "rgba(232, 240, 246, 0.6)";
  }
}

const LOCK_COLOR = { NONE: "rgba(232, 240, 246, 0.45)", ACQUIRING: "#ffd79a", LOCKED: "#9fe6b0" };
// §39 — AI state terminology stays in the diagnostic rail. The player sees
// TRACK / LOCK / MISSILE and nothing else.
const HOSTILE_COLOR = {
  PATROL: "rgba(232, 240, 246, 0.5)",
  PURSUIT: "#e8f0f6",
  ACQUIRE: "#ffd79a",
  ATTACK: "#ff9b7a",
  DEFEND: "#ffd79a",
  COOLDOWN: "#9fd7ff",
  REPOSITION: "#9fd7ff",
  DESTROYED: "rgba(159, 230, 176, 0.7)",
};const THREAT_COLOR = { NONE: "rgba(232, 240, 246, 0.45)", TRACK: "#ffd79a", LOCK: "#ffb45a", MISSILE: "#ff9b7a" };

/** Dev-rail mirror of the combat state — the floating HUD is the player's. */
function updateCombatRows() {
  const t = targeting.state;
  const label = t.lockState === LockState.LOCKED ? "LOCK" : t.lockState === LockState.ACQUIRING ? `ACQ ${Math.round(t.lockProgress * 100)}%` : t.reason || "NO TARGET";
  const hp = drone.alive && drone.health < drone.maxHealth ? ` \u00b7 hp ${Math.round(drone.health)}` : "";
  hud.tgt.textContent = (t.currentTarget ? `${label} \u00b7 ${metres(t.targetRange)} \u00b7 ${t.offBoresightDeg.toFixed(0)}\u00b0` : label) + hp;
  hud.tgt.style.color = LOCK_COLOR[t.lockState];

  const h = hostileAi.state;
  hud.host.textContent =
    h.phase === HostileState.DESTROYED
      ? "DESTROYED"
      : `${h.phase} \u00b7 ${metres(h.range)} \u00b7 ${h.angleDeg.toFixed(0)}\u00b0` +
        (h.phase === HostileState.ACQUIRE ? ` \u00b7 lock ${Math.round(h.lockProgress * 100)}%` : "") +
        ` \u00b7 ammo ${h.ammo}` +
        (h.cooldown > 0 ? ` \u00b7 cd ${h.cooldown.toFixed(1)}s` : "") +
        // §15 — the reaction cue, so "why did it break" is answerable.
        (h.lockedOn && h.defendCue > 0 && h.phase !== HostileState.DEFEND ? ` \u00b7 REACT ${h.defendCue.toFixed(1)}s` : "") +
        (h.defends ? ` \u00b7 ${h.defends} brk` : "");
  hud.host.style.color = HOSTILE_COLOR[h.phase] || "#e8f0f6";

  const th = threat.state;
  hud.thrt.textContent =
    th.level === ThreatLevel.NONE
      ? "\u2014"
      : th.level === ThreatLevel.MISSILE
        ? `MISSILE \u00b7 ${metres(th.distance)} ${th.arrow}${th.behind ? " ASTERN" : ""} \u00b7 ${th.tier}` +
          ` \u00b7 cls ${Math.round(th.closing)}` +
          (th.dodgeActive ? ` \u00b7 DODGE auth ${th.authority.toFixed(2)}` : "")
        : th.level;
  hud.thrt.style.color = THREAT_COLOR[th.level] || "#e8f0f6";

  // AMMO carries both magazines and which one is selected, rather than taking a
  // 19th row: Stage 03.15 already found the rail's ceiling.
  const count = rounds ? rounds.count : 0;
  const flying = missiles ? missiles.inFlight : 0;
  const on = "#e8f0f6";
  const off = "rgba(232, 240, 246, 0.4)";
  const gunSel = weapon === WeaponMode.GUN;
  // §13 — a magazine that is coming back says so, with the count of seconds. An
  // empty weapon and an empty weapon with 4 s left on it are different states.
  const pending = rearm ? rearm.pending : null;
  const rearmText = pending ? ` \u00b7 ${pending.label} ${Math.ceil(pending.remaining)}s` : "";
  hud.ammo.innerHTML =
    `<span style="color:${gunSel ? off : count ? on : "#ffd79a"}">${gunSel ? "" : "\u203a"}AIM-9 ${count}</span> \u00b7 ` +
    `<span style="color:${!gunSel ? off : gun.state.ammo ? on : "#ffd79a"}">${gunSel ? "\u203a" : ""}GUN ${gun.state.ammo}</span> \u00b7 ` +
    `<span style="color:${flares.state.remaining ? on : "#ffd79a"}">FLR ${flares.state.remaining}</span>` +
    `${flying ? ` \u00b7 ${flying} live` : ""}` +
    (rearmText ? `<span style="color:#9fd7ff">${rearmText}</span>` : "");

  const e = engineFx.state;
  const a = atmosphere.state;
  const v = vaporFx.state;
  // FX folded onto one row: engine, cloud, load and vapor. Stage 04.2 needed the
  // physics rows back and this is the block that could afford to give.
  hud.atm.textContent =
    `${Math.round(e.intensity * 100)}%${e.afterburner ? " AB" : ""}` +
    ` \u00b7 cld ${a.density.toFixed(2)} \u00b7 vap ${v.vortex.toFixed(2)}` +
    // Stage 05.4 — the clock, stated in words and in tau. Without this the only
    // way to answer "is the day/night cycle actually running?" is to stare at
    // the sky and guess, which is not a check.
    ` \u00b7 ${phaseName(worldClock.tau)} ${worldClock.tau.toFixed(3)}` +
    // The engine loop's own playback clock. It has now been reported silent
    // twice while measurably playing, so the element's state goes on the rail:
    // a number that is advancing means audio is running and the problem is
    // downstream (tab muted, output device, autoplay warm-up), while a number
    // frozen at 0 is the pause/restart fault this row exists to catch.
    ` \u00b7 eng ${engineAudioLabel()}` +
    // A non-zero stall count means the watchdog is repairing a loop that stopped
    // on its own. Amber, because the audio is being fixed rather than working.
    (audio.channels.ENGINE_LOOP.stalls
      ? ` \u00b7 <span style="color:#ffd79a">stall ${audio.channels.ENGINE_LOOP.stalls}</span>`
      : "") +
    (a.advisory ? ` \u00b7 ${a.advisory}` : "") +
    (hud.refText ? ` \u00b7 ${hud.refText}` : "");
  hud.atm.style.color = a.advisory ? "#9fd7ff" : e.afterburner ? "#ffb45a" : "rgba(232, 240, 246, 0.45)";
}

const SURFACE_COLOR = { TERRAIN: "#e8d9a8", OCEAN: "#9fd7ff", NONE: "rgba(232, 240, 246, 0.45)" };
const CONTACT_COLOR = { CLEAR: "#9fe6b0", TERRAIN: "#ff9b7a", OCEAN: "#9fd7ff", FORWARD: "#ffd79a" };
const metres = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`);

function updatePhysicsHud() {
  const p = physics.state;
  if (!p.queries) return;

  // CTC carries what we are touching, what we are about to touch, AND the
  // recovery feedback: everything the collision-response policy does, on the one
  // line the G key exists to let you observe.
  const fb = physicsPolicy.feedback;
  const last = physicsPolicy.last;
  const tail = fb
    ? ` \u00b7 <span style="color:#ffd79a">${fb}${physicsPolicy === recovery && last.rewind ? ` -${last.rewind.toFixed(2)}s` : ""}</span>`
    : physicsPolicy.recoveries
      ? ` \u00b7 <span style="color:rgba(232,240,246,0.5)">${physicsPolicy.recoveries} rec</span>`
      : "";
  hud.ctc.innerHTML =
    `<span style="color:${CONTACT_COLOR[p.contactKind] || "#e8f0f6"}">${p.contactKind}</span>` +
    ` \u00b7 <span style="color:${p.forwardImminent ? "#ff9b7a" : p.forwardHazard ? "#ffd79a" : "rgba(232,240,246,0.45)"}">` +
    (p.forwardHazard ? `fwd ${p.forwardDistance.toFixed(0)} m${p.forwardImminent ? " !" : ""}` : `fwd ${p.lookAhead.toFixed(0)} m`) +
    "</span>" +
    // The trajectory clock the PULL UP cue reads. Amber inside the warning
    // window, so a warning that should have fired and did not is visible.
    (Number.isFinite(_tti)
      ? ` \u00b7 <span style="color:${_tti <= AUDIO.pullUpSeconds ? "#ff9b7a" : "rgba(232,240,246,0.45)"}">gnd ${_tti.toFixed(1)} s</span>`
      : "") +
    tail;

  // PHYS carries the clearance, the query cost and the frame rate: one physics
  // row instead of five.
  hud.phys.innerHTML =
    `${p.physicsHz} Hz \u00b7 <span style="color:${p.minClearance <= p.safeClearance ? "#ffd79a" : "#e8f0f6"}">${p.minProbeName || "\u2014"} ${metres(p.minClearance)}</span>` +
    ` \u00b7 ${p.safeStates} st \u00b7 ${p.avgQueryMs.toFixed(2)} ms \u00b7 ${Math.round(fps)} fps`;
}

/**
 * Push one instant of world time into every visual that depends on it.
 *
 * Everything here is derived from the single `env` record, so no two systems can
 * disagree about what time it is — the sky, the fog, the clouds, the ocean, the
 * settlement lights and the carrier lights are all reading the same numbers.
 */
function applyEnvironment(env, dt) {
  sun.color.setHex(env.sunColor);
  sun.intensity = env.sunIntensity;
  // Directional lights are positioned, not aimed: three.js takes the direction
  // from position toward the target (the origin here). Pushed far out so the
  // light stays parallel across a 30 km island.
  sun.position.set(env.sunDirection.x * 8000, env.sunDirection.y * 8000, env.sunDirection.z * 8000);

  moon.color.setHex(env.moonColor);
  moon.intensity = env.moonIntensity;
  moon.position.set(env.moonDirection.x * 8000, env.moonDirection.y * 8000, env.moonDirection.z * 8000);

  skyFill.color.setHex(env.hemiSky);
  skyFill.groundColor.setHex(env.hemiGround);
  skyFill.intensity = env.hemiIntensity;

  // The dome keeps its painted gradient and is TINTED: a MeshBasicMaterial's
  // colour multiplies its map, so one colour write re-times the whole sky
  // without rebuilding the texture every frame.
  sky.material.color.setHex(env.skyColor);

  /**
   * Fog is owned by atmosphere.js, which lerps from its own captured base colour
   * toward the cloud colour every frame. Writing scene.fog.color here would be
   * overwritten a few lines later, so the BASE is handed over instead and the
   * cloud system keeps its authority over the blend.
   */
  atmosphere.setBaseFog(env.hazeColor);
  atmosphere.setCloudTint(env.cloudColor, env.cloudOpacityScale);

  oceanVisual.follow(aircraftRoot.position);
  oceanVisual.apply(env, dt);

  if (settlementLights) settlementLights.apply(env);
  if (carrierLights) carrierLights.apply(env);
}

/**
 * The engine's audio state, in words, for the developer rail.
 *
 * "No engine sound" has been reported several times and has had a different
 * cause each time, so the rail now distinguishes the three possibilities instead
 * of showing one ambiguous number:
 *
 *   CLICK PAGE  the browser has refused to start audio and is waiting for a real
 *               user gesture in this document. Not a bug — click the canvas.
 *   MUTE        the player pressed K, or the game is paused.
 *   OFF         the engine is legitimately not running (on the deck, crashed).
 *   12.3s       the loop's own clock, advancing. Audio is working; if nothing is
 *               audible the fault is the output device or the tab's volume.
 */
function engineAudioLabel() {
  const ch = audio.channels.ENGINE_LOOP;
  const el = ch.voices[0][0];
  if (!el) return "\u2014";
  if (audio.state.muted) return "MUTE";
  if (!ch.playing) return "OFF";
  if (!ch.everPlayed) return `<span style="color:#ffd79a">CLICK PAGE</span>`;
  return `${el.currentTime.toFixed(1)}s`;
}

/* ---- loop ---- */
let lastTime = performance.now();
/**
 * A monotonic frame stamp, handed to every caller that advances the failure
 * policy. The policy ignores a repeated stamp, so the double-tick above is
 * structurally impossible rather than merely commented against: physics.update()
 * and the crash branch can both call tick() in the same frame and only the first
 * one counts.
 */
let frameId = 0;

/**
 * Stage 05.5 — pause state.
 *
 * Module scope beside the frame loop, because pausing is a property of the LOOP,
 * not of the mission, the mode or the flight model. None of those learn about
 * it: the loop simply stops advancing them, which is why pausing cannot corrupt
 * a launch, a crash sequence or a checkpoint the way a per-system pause flag
 * could.
 */
let paused = false;
const pauseEl = document.getElementById("pause");
const pauseHintEl = pauseEl ? pauseEl.querySelector(".hint") : null;

function setPaused(on) {
  if (paused === on) return paused;
  paused = on;
  if (pauseEl) pauseEl.hidden = !paused;
  /**
   * Silence while paused, and restore what the player had. The engine loop is a
   * continuous sound: leaving it running behind a pause screen is the single most
   * obvious way to make a pause feel broken. `setMuted` pauses the looping
   * channels outright, so this also stops the gun mid-burst.
   *
   * The player's own mute (K) is remembered and re-applied, so pausing never
   * silently turns their audio back on.
   */
  if (paused) {
    mutedBeforePause = audio.isMuted ? audio.isMuted() : audio.state.muted;
    audio.setMuted(true);
  } else {
    audio.setMuted(mutedBeforePause);
  }
  // Steering is a stick; a paused game must not be flown by a moving cursor.
  //
  // RESTORE it on resume rather than leaving it off. This line used to pass a
  // flat `false`, so the first pause of a session permanently disabled pointer
  // steering -- the game kept flying, the cursor did nothing, and the cause was
  // three systems away from the symptom.
  input.setPointerEnabled(!paused && pointerAllowed);
  if (pauseHintEl) pauseHintEl.textContent = mutedBeforePause ? "Esc to resume \u00b7 audio off" : "Esc to resume";
  return paused;
}
let mutedBeforePause = false;

function step() {
  const now = performance.now();
  frameId++;
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;

  /**
   * Stage 05.5 — PAUSE.
   *
   * A single early return, placed after `lastTime` is updated so the frame the
   * player unpauses on has a normal dt rather than the whole paused duration
   * (which the 1/30 clamp would swallow anyway, but relying on a clamp to hide a
   * bug is not a design). Nothing is simulated, nothing is ticked, no policy
   * advances, no audio is driven — but the scene is still RENDERED, so the paused
   * world sits there and looks like the world instead of a black screen.
   */
  if (paused) {
    renderer.render(scene, camera);
    return;
  }

  input.update(dt);
  // Last frame's cannon jitter comes off before anything reads the camera.
  camera.position.sub(_gunShake);

  const phase = director.state.phase;
  const scripted = !director.playerFlies;
  /**
   * THE FAILURE POLICY IS TICKED EXACTLY ONCE PER FRAME, HERE, BEFORE ANYTHING
   * READS CRASH STATE.
   *
   * Two rules collided and produced the worst bug in the build:
   *
   *   1. Tick the policy BEFORE reading `crashing`, so a restore that happens
   *      this frame is respected and the crash branch does not copy the wreck's
   *      transform over the fresh respawn.
   *   2. Tick the policy even when physics is skipped (crash or scripted
   *      flight), because physics.update() is normally what advances it.
   *
   * Each was implemented as its own guarded call, with equivalent conditions --
   * so whenever a crash was active the policy was advanced TWICE per frame. The
   * whole 2.32 s sequence ran at double speed, and worse, `crashing` was
   * captured BETWEEN the two calls: when the second one fired `onRestore`, the
   * `if (crashing)` branch below still ran and wrote the wreck pose straight
   * over the aircraft that had just been respawned at 4000 m. Whether it
   * happened at all depended on which of the two ticks crossed the fade
   * threshold, which is exactly why it presented as "sometimes" -- and once it
   * happened the aircraft was back at the impact point, so it crashed again
   * immediately and spent another pilot, until the sortie ran out of aircraft.
   *
   * ONE call, ONE condition, and `crashing` read after it. Do not add a second
   * tick for a new branch: widen this condition instead.
   */
  if (crashFx.state.active || scripted || physicsPolicy !== missionFailure) missionFailure.tick(dt, frameId);
  const crashing = crashFx.state.active;
  // The pointer is a stick, so it must not fight an owner that is not the player.
  // Disabled outright during the launch script and the crash, rather than having
  // those branches remember to ignore it.
  input.setPointerEnabled(pointerAllowed && !crashing && !scripted && director.state.autopilot < 0.5);

  if (crashing) {
    /* ---- §6–§9: destruction theatre ----
     * No flight model, no physics query, no input. The aircraft carries its
     * pre-impact momentum, tumbles, and sinks; nothing here can fail the mission
     * again (§33) because the policy that started this refuses re-entry.
     */
    crashFx.update(dt);
    // Discrete requests made during the crash are consumed and dropped, so a
    // trigger pull mid-explosion does not fire on the respawn frame (§2/§47).
    input.takeRoll();
    input.takeFire();
    const p = crashFx.pose;
    flightState.position.x = p.position.x;
    flightState.position.y = p.position.y;
    flightState.position.z = p.position.z;
    // flightState.quat is a plain {x,y,z,w} record, NOT a THREE.Quaternion — the
    // flight model is deliberately THREE-free. Calling .copy() on it threw on the
    // first crash frame and killed the render loop, which is why the whole game
    // froze at the moment of impact instead of exploding.
    flightState.quat.x = p.quat.x;
    flightState.quat.y = p.quat.y;
    flightState.quat.z = p.quat.z;
    flightState.quat.w = p.quat.w;
    flightState.speed = crashFx.velocity.length();
    flightState.maneuver = null;
    aircraftRoot.position.copy(p.position);
    aircraftRoot.quaternion.copy(p.quat);
    // §6 — the intact aircraft stays visible, then fades behind its own smoke.
    setAircraftOpacity(p.opacity);
    // §34 — the engine fails with the aircraft rather than droning on.
    audio.loop(Cue.GUN, false);
  } else if (scripted && phase !== MissionPhase.COMPLETE) {
    /* ---- §6/§9: the aircraft is attached to the launch frame ----
     * No flight physics, no wheel physics, no throttle input. The script writes
     * the whole flight state and the renderer reads it, so the handoff has
     * nothing to reconcile.
     */
    launch.update(dt, !audio.state.armed);
    /**
     * 04.6 — the deck is the ENGINE START and nothing else. The loop used to run
     * from the first frame (the throttle is above idle immediately), so the two
     * sounds overlapped for the whole dwell and the start-up was inaudible under
     * a running engine. Now the start plays alone while the aircraft shakes in
     * place, and it is CUT the instant the catapult fires — which is where the
     * loop takes over, because that is the moment there is something to sustain.
     */
    /**
     * 05.2 — the start-up is fired ONCE per launch, not every frame.
     *
     * It was called unconditionally while the stage was DECK and left to the cue's
     * own `minInterval` to suppress repeats. That works for a warning that fires
     * occasionally and fails completely here: the interval is 4 s and the dwell is
     * now 11 s, so the clip retriggered twice mid-play and three copies overlapped.
     * A cue whose whole purpose is to run to its end exactly once cannot be
     * governed by a rate limiter.
     */
    if (launch.state.stage === LaunchStage.DECK) {
      if (!startCueFired && launch.state.t >= LAUNCH.spoolAt) {
        startCueFired = true;
        audio.play(Cue.ENGINE_START, { force: true });
      }
    } else {
      audio.stop(Cue.ENGINE_START);
    }
    // Discrete requests made while the script is flying are consumed and
    // dropped, so a barrel roll pressed on the deck does not fire the instant
    // the player receives control.
    input.takeRoll();
    input.takeFire();
    const p = launch.pose;
    flightState.position.x = p.x;
    flightState.position.y = p.y;
    flightState.position.z = p.z;
    flightState.heading = p.heading;
    flightState.pitch = p.pitch;
    flightState.bank = 0;
    flightState.speed = p.speed;
    flightState.targetSpeed = p.speed;
    flightState.throttle = p.throttle;
    flightState.afterburner = p.afterburner;
    flightState.sink = 0;
    flightState.maneuver = null;
    quatFromEulerYXZ(p.pitch, p.heading, 0, flightState.quat);
    syncAircraft();
    setGear(launch.state.gearDown);
    if (launch.state.handoff) handoff();
  } else if (phase === MissionPhase.COMPLETE) {
    // Frozen frame behind the complete screen. Nothing integrates, nothing
    // spawns, and the world is still there if the player wants to look at it.
    syncAircraft();
    audio.loop(Cue.GUN, false);
  } else {
    // Post-recovery grace: the stick that flew into the mountain is not handed
    // back for 0.3 s, so a rewind reads as a reset instead of a re-impact.
    const graced = physicsPolicy.graceRemaining > 0;
    const roll = input.takeRoll();
    const auto = director.state.autopilot;
    // §33 — the closing sequence flies through the ordinary flight model with a
    // synthesised stick, blended in over a second, so control is handed away
    // rather than switched off.
    let stick = graced ? NEUTRAL_INPUT : input;
    if (auto > 0) {
      stick = blendStick(
        graced ? NEUTRAL_INPUT : input,
        autopilotStick(
          { heading: flightState.heading, pitch: flightState.pitch, altitude: aircraftRoot.position.y, speed: flightState.speed },
          recoveryGoal()
        ),
        auto,
        _stick
      );
    }
    if (roll !== 0 && !graced && auto < 0.4) requestRoll(flightState, roll);

    updateFlight(flightState, stick, dt);

    // One orientation path for both modes: the flight model owns the quaternion.
    syncAircraft();

    // World contact runs on the transform that was just written. It produces a
    // CollisionEvent; the response policy is the only thing that moves the
    // aircraft outside the flight model.
    physics.update(aircraftRoot, flightState, dt, undefined, frameId);
  }

  /* ---- §3/§19: the director. Reads published state, decides the mission. ---- */
  director.update(
    {
      position: aircraftRoot.position,
      strokeStarted: launch.state.stage !== LaunchStage.DECK && launch.state.stage !== LaunchStage.IDLE,
      launchDone: launch.state.done,
      hostileAlive: drone.alive,
      hostileSpent: hostileAi.spent && (!missiles || missiles.ownedBy("hostile").length === 0),
    },
    dt
  );

  /**
   * THE FIVE-MINUTE DEADLINE (§10).
   *
   * A policy in the orchestrator, not a phase in the transition table: the table
   * promotes phases and nothing else, and "the run is over" is a decision about
   * the run rather than a tenth phase (§4). One call site, reading one pure rule.
   *
   * MISSION only, gated on the mode's own timer rule — the sandbox modes are
   * practice, and a deadline would turn them into a test (§11). Guarded on the
   * loss screen being hidden so it fires once rather than on every frame after.
   *
   * `modeRules(mode)` is resolved here rather than reaching for a `rules` binding:
   * an earlier version of this line referenced one that does not exist in this
   * scope, and the §17.3 frame guard absorbed the ReferenceError sixty times a
   * second — the game kept flying, the deadline never fired, and the only trace
   * was "recovered from a thrown frame" in the log.
   */
  if (modeRules(mode).timer && failedEl.hidden && missionExpired(director.state.missionTime, phase)) {
    combatHud.flash("REINFORCEMENTS INBOUND", "danger");
    missionFailed("TIME");
    return;
  }

  /* ---- §11/§12: the launch composition, blended out rather than cut ---- */
  if (scripted && phase !== MissionPhase.COMPLETE) {
    setChaseView(1, LAUNCH_VIEW, launch.state.fov);
  } else if (viewHold > 0) {
    viewHold = Math.max(0, viewHold - dt / LAUNCH.viewBlendOut);
    setChaseView(viewHold, LAUNCH_VIEW, LAUNCH.fovExit);
  } else if (director.state.autopilot > 0) {
    setChaseView(director.state.autopilot, RECOVERY_VIEW, null);
  } else if (crashFx.followBlend > 0) {
    // §27 — the rig loosens rather than detaching: further out, higher, and with
    // its forward damping cut so it lags behind the tumbling aircraft. That lag
    // is what lets the player actually see the fire, smoke and debris before the
    // fade, and it reuses the launch composition channel rather than adding a
    // second camera.
    setChaseView(crashFx.followBlend, CRASH_VIEW, null);
  } else {
    setChaseView(0, null, null);
  }

  // The opening fade and the closing fade share one layer, and a failure can
  // overlay either — whichever is darkest wins. Read from the wall clock so a
  // page that spent time hidden does not owe itself a fade.
  openingFade = Math.max(0, MISSION.fadeIn - (performance.now() - openingFadeAt) / 1000);
  applyFade();

  updateChaseCamera(camera, aircraftRoot, flightState, dt);
  // Gun jitter is applied to the camera *after* the rig has run and removed
  // before it runs again, so the chase damping never chases the vibration. It
  // uses last frame's fire state, which at 145 fps is not a perceivable lag.
  // Stage 03.3 §32 folds the missile-impact kick into the same offset rather
  // than adding a second one the rig could fight.
  const impact = hitResponse.state.impact;
  const crashShake = crashFx.state.shake;
  if (gun.state.firing || impact > 0.01 || launch.state.shake > 0.001 || crashShake > 0.001) {
    // §13 — the deck shimmer and the catapult vibration reuse the existing
    // camera-offset channel rather than adding a second one the rig could fight.
    // §26 adds the crash kick to the same channel, for the same reason: one
    // strong impulse with fast decay, never sustained shake (§28).
    const amp = (gun.state.firing ? GUN.shake : 0) + impact * 0.55 + launch.state.shake + crashShake;
    _gunShake.set((Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp, 0).applyQuaternion(camera.quaternion);
  } else {
    _gunShake.set(0, 0, 0);
  }
  camera.position.add(_gunShake);
  // Projection for the HUD happens before render, so the camera's inverse has
  // to be current or the target box trails a frame behind the world.
  camera.updateMatrixWorld(true);
  physicsDebug.update(physics.state, aircraftRoot);

  /* ---- combat, layered on top of an untouched flight/physics step ---- */
  quatForward(flightState.quat, _fwd);
  quatUp(flightState.quat, _up);
  // Actual trajectory from the frame's world displacement, so the flight-path
  // marker reflects bank sink and the altitude floor rather than just where the
  // nose points. Falls back to boresight when standing still.
  _velDir.subVectors(aircraftRoot.position, _prevPos);
  if (_velDir.lengthSq() > 1e-6) _velDir.normalize();
  else _velDir.set(_fwd.x, _fwd.y, _fwd.z);
  _prevPos.copy(aircraftRoot.position);

  _fwdV.set(_fwd.x, _fwd.y, _fwd.z);
  _upV.set(_up.x, _up.y, _up.z);
  _right.crossVectors(_fwdV, _upV).normalize();
  _ownVel.copy(_velDir).multiplyScalar(flightState.speed);
  // The player's published velocity: what the hostile leads and what its
  // missile leads. Measured, not assumed from the nose vector.
  playerEntity.velocity.copy(_ownVel);

  // The hostile flies itself: patrol path, pursuit curve, break and reposition
  // all live behind one state machine (§3). It is handed published player state
  // and never reads the flight model.
  // §15 — including whether the player has a completed lock on it. Published
  // state, exactly like position and velocity: the AI reads the same fact the
  // player's HUD is showing, not the HUD itself.
  playerEntity.locked = targeting.state.lockState === LockState.LOCKED && targeting.state.currentTarget === drone;
  hostileAi.update(playerEntity, dt);
  // Ground threats. Static, so there is no integration step — only acquisition,
  // line of sight and a launch.
  samNet.update(playerEntity, dt);
  if (isSandbox(mode)) sandbox.update({ hostileAlive: hostileAi.state.active && drone.alive }, dt);

  // §5 — an inactive hostile is not a target, either. Handing targeting an empty
  // list is what stops the player locking a drone that is not in the mission yet.
  const engaged = hostileAi.state.active && drone.alive;
  _candidates.length = 0;
  if (engaged) _candidates.push(drone);
  for (const s of samNet.targets) _candidates.push(s);
  targeting.update(observer, _candidates, screenOffsetOf, dt);
  handleFireInput();
  // §21/§22: the dodge window is evaluated once per frame, here, and read by
  // every incoming round through the authority hook.
  _evasion.inPeak = inDodgePeak(flightState.maneuver, isExpert(flightState));
  _evasion.velocityDir = _velDir;
  if (missiles) missiles.update(dt);

  // Threat state after the missiles have moved, so the range the player reads is
  // the range the fuze is working with.
  threat.update(
    {
      hostile: hostileAi.state,
      // Both owners' rounds, so a SAM shot escalates the display the same way a
      // fighter's does and the nearest one wins.
      incoming: missiles ? missiles.live.filter((m) => m.owner === "hostile" || m.owner === "sam") : [],
      ground: (() => {
        const src = samNet.threatSource();
        return src
          ? { tracking: src.phase === SamState.TRACK, locked: src.phase === SamState.LOCK || src.phase === SamState.LAUNCH, lockProgress: src.lockProgress, range: src.range }
          : null;
      })(),
      position: aircraftRoot.position,
      forward: _fwdV,
      right: _right,
      up: _upV,
      expert: isExpert(flightState),
      maneuver: flightState.maneuver,
    },
    dt
  );
  hitResponse.update(dt);

  // The cannon runs whether or not it is selected: `armed` gates firing, while
  // the lead solution is computed either way so switching to GUN shows a pipper
  // on the first frame instead of a frame later.
  gun.update(
    {
      armed: weapon === WeaponMode.GUN && director.weaponsHot,
      firing: input.trigger && director.weaponsHot,
      forward: _fwdV,
      right: _right,
      up: _upV,
      ownVel: _ownVel,
      // Whatever the targeting system has settled on — which may be a SAM site.
      // The gun works on ground targets with no special case because the lead
      // solution only needs a position and a velocity, and a SAM's is zero.
      target: targeting.state.currentTarget || (engaged ? drone : null),
    },
    dt
  );
  director.stats.gunFired += gun.state.shots;

  // §Flares — one latch, two sources (Z and the middle mouse button). Polled here
  // rather than in a key handler so both behave identically, and gated on weapons
  // being hot: no countermeasures under the closing autopilot.
  if (input.takeFlare() && director.weaponsHot) {
    if (!flares.dispense({ position: aircraftRoot.position, velocity: _ownVel, right: _right, up: _upV, forward: _fwdV })) {
      if (flares.state.remaining <= 0) combatHud.flash("NO FLARES");
    }
  }

  /* ---- §04.5: audio, driven entirely from published state ---- */
  // The engine is the only continuous sound: a loop whose gain and pitch follow
  // the throttle lever. It does NOT run on the deck — see the launch branch.
  /**
   * THE ENGINE LOOP HAS EXACTLY ONE OWNER: this line.
   *
   * It previously had four. The crash branch, the deck branch and the COMPLETE
   * branch each switched it off for their own good reason, and then this line --
   * running later in the SAME frame -- switched it back on, because its condition
   * only knew about the deck. So every frame the element was paused and restarted,
   * `start()` reset currentTime to 0, and the loop never advanced past a single
   * frame of audio: `paused` read false, `readyState` read 4, no error was
   * thrown, and the aircraft was silent. What you could hear was the restart
   * itself -- a click or a burst, not an engine.
   *
   * A media element cannot be owned by four branches. Every condition that
   * silences the engine belongs in THIS expression; do not add a fifth caller.
   */
  const onDeck = scripted && launch.state.stage === LaunchStage.DECK;
  const ev = engineVoice(flightState.throttle, flightState.afterburner);
  const engineRunning =
    !onDeck && // the deck belongs to the start-up cue alone
    !crashing && // §34 the engine fails with the aircraft
    phase !== MissionPhase.COMPLETE && // frozen frame behind the end screen
    flightState.throttle > 0.02;
  audio.loop(Cue.ENGINE_LOOP, engineRunning, { volume: ev.volume, rate: ev.rate });
  // The cannon is a loop too, gated on the trigger — 48 rounds a second is not a
  // sequence of one-shots, and treating it as one would drown every warning.
  audio.loop(Cue.GUN, gun.state.firing);

  // Warnings, from the threat monitor's own escalation so the sound and the word
  // on the HUD can never disagree.
  const tl = threat.state.level;
  if (tl === ThreatLevel.MISSILE) audio.play(Cue.MISSILE);
  else if (tl === ThreatLevel.LOCK) audio.play(Cue.LOCK);

  // Ground proximity. ALTITUDE is "low and descending"; PULL UP is a trajectory
  // test, and needs the ground AHEAD as well as the ground below, or level flight
  // into a ridge reads as safe until impact.
  //
  // NOTHING FIRES UNTIL THE PLAYER HAS ACTUALLY BEEN FLYING FOR A FEW SECONDS.
  // On the deck and through the catapult the aircraft is 20 m over water and
  // sinks off the bow before the wing takes over, so a trajectory warning is
  // guaranteed at the exact moment the player has no control and the launch's own
  // sound should own the mix. `playerFliesFor` resets whenever control is taken
  // away, so the grace also covers a respawn and the recovery autopilot.
  if (director.playerFlies) playerFliesFor += dt;
  else playerFliesFor = 0;
  if (director.playerFlies && playerFliesFor >= AUDIO.warnGraceSeconds && physics.state.queries) {
    const look = AUDIO.lookSeconds * Math.max(flightState.speed, 1);
    // Forward is (-sin h, -cos h). Sampled on the heading rather than the
    // quaternion's nose: the warning is about where the aircraft is GOING.
    const ax = flightState.position.x - Math.sin(flightState.heading) * look;
    const az = flightState.position.z - Math.cos(flightState.heading) * look;
    // Clearance the aircraft WOULD have over that ground if it held this height.
    // Null when there is no terrain index, so the rule falls back to the
    // vertical test rather than inventing a number.
    const aglAhead = terrainIndexed ? flightState.position.y - groundAt(ax, az) : null;
    const warn = groundWarning({
      agl: physics.state.agl,
      sink: flightState.sink,
      aglAhead,
      forwardImminent: physics.state.forwardImminent,
      airborne: true,
      // The water floor is height-only and water-only (§16). Over terrain the
      // corridor is flown low on purpose and the forward probe supplies the
      // warning instead.
      overWater: physics.state.surface === SURFACE.OCEAN,
    });
    if (warn) audio.play(warn);
    _tti = secondsToGround({ agl: physics.state.agl, sink: flightState.sink, aglAhead });
  } else {
    _tti = Infinity;
  }

  // 04.6 — a hostile crossing close aboard, once per pass rather than once per
  // frame. Atmosphere, and the only cue the player cannot act on.
  if (engaged) {
    const hr = hostileAi.state.range;
    if (flybyTriggered(hr, _prevHostileRange, dt)) audio.play(Cue.FLYBY);
    _prevHostileRange = hr;
  } else {
    _prevHostileRange = Infinity;
  }
  // §Flares — moved and tested against every enemy round in the air. Order
  // matters: this runs AFTER missiles.update() so a round that was decoyed this
  // frame has already had its guidance zeroed by the time it next steers.
  flares.update(
    missiles ? missiles.live.filter((m) => m.owner !== "player") : [],
    aircraftRoot.position,
    dt
  );
  // §13 — both magazines come back on their own, on independent timers, so an
  // empty aircraft two minutes in is a pause rather than a dead run.
  if (rearm) rearm.update(dt);
  audio.update(dt);

  /* ---- atmospheric FX: read published state, write only their own visuals ---- */
  /**
   * §2/§48-50 — the environment is advanced HERE, once, for every mode. There is
   * no per-mode branch: MISSION, FREE and PEACE all read the same clock, which
   * is why switching modes cannot change the time of day.
   */
  worldClock.advance(dt);
  const env = environmentFor(worldClock.tau);
  applyEnvironment(env, dt);

  atmosphere.update(aircraftRoot.position, dt);

  const pitchNow = flightState.pitch / DEG;
  // Damped so a single-frame attitude jump (a recovery restore, a mode switch)
  // cannot read as a 400 deg/s pull and light the vapor for one frame.
  const rawRate = dt > 1e-4 ? (pitchNow - prevPitchDeg) / dt : 0;
  pitchRateDeg += (rawRate - pitchRateDeg) * Math.min(1, dt * 9);
  prevPitchDeg = pitchNow;

  engineFx.update({ throttle: flightState.throttle, afterburner: flightState.afterburner, speed: flightState.speed }, dt);
  vaporFx.update(
    {
      camera,
      humidity: atmosphere.state.humidity,
      bankDeg: bankDegrees(flightState),
      pitchRateDeg,
      stickX: input.x,
      stickY: input.y,
    },
    dt
  );

  combatHud.update(
    {
      camera,
      expert: isExpert(flightState),
      mode: flightState.mode,
      speed: flightState.speed,
      alt: aircraftRoot.position.y,
      throttle: flightState.throttle,
      afterburner: flightState.afterburner,
      position: aircraftRoot.position,
      forward: _fwd,
      up: _up,
      velocityDir: _velDir,
      missiles: rounds ? rounds.count : 0,
      weapon,
      gun: gun.state,
      targeting: targeting.state,
      // The target the HUD brackets is whatever targeting settled on — which may
      // be a SAM site. This was hardcoded to the drone, so a locked ground target
      // drew no bracket, no lock diamond and no range: the lock worked and the
      // player had no way to know, which reads exactly like "I cannot lock SAM".
      target: targeting.state.currentTarget || (engaged ? drone : null),
      advisory: atmosphere.state.advisory,
      // Cloud dims the target bracket rather than hiding it: harder to read,
      // never impossible (§36).
      visibility: atmosphere.state.visibility,
      threat: threat.state,
      hit: hitResponse.state,
      // §17/§18 — the navigation cue. Quiet, world-projected, and suppressed
      // entirely while a missile is inbound.
      nav: navCtx(),
      radar: radarCtx(),
      missionCue: director.cue,
      missionCueAlpha: director.cueAlpha,
      // Keep the instruments clear of the developer rail at narrow widths.
      safeLeft: hudSafeLeft,
    },
    dt
  );

  // The ocean is 100 km wide and static — only the sky rides the camera.
  sky.position.copy(camera.position);

  updateHud(dt);
  renderer.render(scene, camera);
}

let frameErrors = 0;

/**
 * The render loop, made unkillable.
 *
 * `requestAnimationFrame` used to be the LAST statement of the frame body, so a
 * single thrown exception anywhere in a frame meant the loop was never
 * rescheduled and the game stopped dead — leaving the last rendered image on
 * screen. That is exactly how a crash presentation bug turned into "the whole
 * game is frozen with a fireball on it": the theatre started, one frame threw,
 * and nothing ever ran again. A presentation defect should never be able to end
 * the session.
 *
 * So: schedule first, then run the frame inside a guard. A bad frame is skipped,
 * not fatal. The error is logged (the first few times — a throw that repeats every
 * frame must not flood the console), and if it happened while the player was
 * being killed we fail SAFE toward playable rather than leaving them stuck
 * watching an explosion that will never end.
 */
function frame() {
  requestAnimationFrame(frame);
  try {
    step();
  } catch (err) {
    frameErrors += 1;
    if (frameErrors <= 3) console.error("[frame] recovered from a thrown frame", err);
    if (crashFx.state.active || missionFailure.state.active) {
      // The crash could not be presented. Do not trap the player in it.
      missionFailure.reset();
      restartMission();
    }
  }
}

/* ---- load, then fly ---- */
const loadingEl = document.getElementById("loading");
const noteEl = document.getElementById("asset-note");
const failures = [];

const settle = (label, promise) =>
  promise.then(
    (value) => value,
    (err) => {
      console.error(`[world] ${label} FAILED —`, err);
      failures.push(`${label}: ${err.message || err}`);
      return null;
    }
  );

Promise.all([
  settle("F-15", loadF15(modelCorrection)),
  settle("carrier", loadCarrier(world.carrierRoot, world.carrierCorrection)),
  settle("terrain", loadTerrain(world.terrainRoot, world.terrainCorrection)),
  settle("AIM-9", loadAim9()),
  settle("F-16C", loadHostileFighter()),
  settle("SAM launcher", loadSamLauncher()),
]).then(([f15, carrier, terrain, aim9, hostileModel, samModel]) => {
  carrierReport = carrier;
  terrainReport = terrain;

  // Weapons come up with the world: the prototype is cloned onto the mounts and
  // again per launch, so the glTF is parsed exactly once.
  const prototype = (aim9 && aim9.prototype) || null;
  rounds = createMountedMissiles(mountSet, prototype);
  missiles = createMissileSystem({
    scene,
    prototype,
    // §21: the missile system does not know what a barrel roll is. It asks how
    // much guidance this round still has, and the threat monitor answers.
    //
    // Stage 04.2 composes a second, independent penalty on top for SAM rounds:
    // one that has lost sight of the player keeps almost nothing. That belongs
    // here rather than in threat.js, because this is the only layer that knows
    // where the ground is — and it means terrain masking defeats a round already
    // in the air, not just an acquisition.
    authorityFor: (m) => {
      const base = threat.authorityFor(m, _evasion);
      if (m.owner !== "sam") return base;
      return lineOfSight(m.position, aircraftRoot.position, groundAt) ? base : Math.min(base, SAM.maskedAuthority);
    },
    // §29: a round that flies into the island dies there. One terrain sample per
    // missile per frame, on the index physics already built.
    groundAt: (x, z) => {
      const h = physics.sampleTerrainBelow({ x, y: 0, z });
      return h.foundTerrain ? h.terrainHeight : WORLD.oceanY;
    },
  });
  missiles.on("hit", ({ missile, target }) => {
    if (missile.owner === "hostile" || missile.owner === "sam") {
      // §30/§31 — an event, not a reset call.
      hitResponse.apply(
        createPlayerDamageEvent({ source: DamageSource.MISSILE, at: performance.now() / 1000, position: missile.position })
      );
      return;
    }
    announceKill(target, missile.position);
  });
  missiles.on("expire", ({ missile }) => {
    if (missile.owner === "hostile" || missile.owner === "sam") {
      // §43 — only announce a miss that was going to be a hit, or the player
      // learns nothing from the word.
      if (evadeEarned(missile.minRange)) {
        combatHud.flash("EVADE", "good");
        director.stats.evasions += 1;
      }
      return;
    }
    if (targeting.state.currentTarget) combatHud.flash("MISSILE LOST");
  });
  if (aim9 && aim9.placeholder) failures.push("AIM-9: placeholder missile body in use");

  // Physics comes up only once the terrain geometry exists (§34): queries
  // against an undefined island are the one edge case worth designing out
  // rather than guarding at every call site.
  const index = physics.setTerrain(world.terrainRoot);
  terrainIndexed = !!index;
  physics.reset(flightState);
  if (index) {
    console.log("[physics] terrain index", benchmarkTerrainQuery(index, physics.terrainMeshes));
  } else {
    console.warn("[physics] no terrain geometry — ocean contact only");
  }
  if (carrier && carrier.anchors) {
    anchorDebug = createCarrierAnchorDebug(carrier.anchors);
    console.log("[carrier] references", carrier.references);
  }

  /* ---- Stage 05.4: night lights ---- */
  /**
   * Built once, after the terrain exists, because placement is terrain-aware:
   * every light is queried against the real height field so none of them stand
   * in the sea or on a peak (§37). Doing it at load costs a few hundred terrain
   * queries once and nothing per frame.
   */
  if (terrainIndexed && terrain && terrain.ok) {
    const halfX = (terrain.normalizedSize ? terrain.normalizedSize.x : 24857) / 2;
    const spanZ = terrain.normalizedSize ? terrain.normalizedSize.z : 30000;
    const bounds = {
      minX: -halfX * 0.86,
      maxX: halfX * 0.86,
      minZ: terrain.nearEdgeZ - spanZ * 0.9,
      maxZ: terrain.nearEdgeZ - 400,
    };
    const plan = planSettlements({ bounds, sampleHeight: groundAt });
    settlementLights = createSettlementLights(plan);
    scene.add(settlementLights.points);
    console.log("[lights] settlements", {
      lights: plan.count,
      major: plan.clusters.filter((c) => c.kind === "major").length,
      minor: plan.clusters.filter((c) => c.kind === "minor").length,
      draws: 1,
    });
  }
  if (carrier && carrier.references) {
    carrierLights = createCarrierLights(carrier.references, { length: carrier.length });
    world.carrierRoot.add(carrierLights.root);
  }

  /* ---- Stage 04.0: arm the mission ---- */
  f15Visual = (f15 && f15.visual) || null;
  if (carrier && carrier.anchors) {
    // §6 — the deck spot and the release point come from the measured anchors.
    // There is not a single deck coordinate in the launch or mission code.
    launchAnchors = {
      start: carrier.anchors.launchStart.getWorldPosition(new THREE.Vector3()),
      end: carrier.anchors.launchEnd.getWorldPosition(new THREE.Vector3()),
    };
  } else {
    // The carrier failed to load. The mission still has to be flyable, so the
    // launch frame falls back to the authored offsets on an assumed deck height.
    const L = WORLD.carrier.targetLength;
    const ref = WORLD.carrier.references;
    const cz = WORLD.carrier.position.z;
    launchAnchors = {
      start: new THREE.Vector3(0, 20, cz + ref.launchStartZ * L),
      end: new THREE.Vector3(0, 20, cz + ref.launchEndZ * L),
    };
    failures.push("carrier: launch frame using authored fallback anchors");
  }
  const plan = launch.arm(launchAnchors.start, launchAnchors.end);
  const route = buildRoute();
  // Stage 04.2 — six sites, placed from the surveyed terrain route and dropped
  // onto the ground. Two per inland leg, flanking the corridor.
  const samPlan = planSamSites(route, groundAt);
  const sites = samPlan.map((p) => createSamSite({ position: p, name: p.name }));
  // One loaded prototype, one clone per site: three.js clone(true) copies the
  // node tree and REUSES geometries and materials, so six launchers cost six
  // transform hierarchies rather than six copies of a 20 MB mesh.
  if (samModel) for (const s of sites) installSamVisual(s, samModel.prototype.clone(true));
  else failures.push("SAM launcher: placeholder blockout in use");
  for (const s of sites) combatRoot.add(s.root);
  samNet.setSites(sites);
  samNet.setActive(false);
  console.log("[sam] sites", samPlan.map((p) => `${p.name} @ ${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`));
  // §13 — rearm needs the loaded stores, so it is built here and nowhere else.
  rearm = createRearmSystem({
    rounds,
    gun,
    onRearm: (label) => combatHud.flash(`${label} REARMED`, "good"),
  });
  console.log("[audio]", audio.report);
  // Availability is settled by a readiness deadline inside the director, not by
  // `error` events — those never fire for a missing file on this server. The
  // director announces the settled picture itself, so the log cannot drift out of
  // step with the deadline the way a second hand-typed timeout did.
  audio.on("resolved", (report) => console.log("[audio] resolved", report));
  // §40 — the mission owns the collision response from here. G swaps back to
  // the development rewind without touching detection.
  setResponsePolicy(missionFailure);
  applyMode(mode);
  restartMission();
  console.log("[launch] plan", {
    runMetres: +plan.run.toFixed(1),
    strokeSeconds: +plan.time.toFixed(2),
    exitSpeed: +plan.exitSpeed.toFixed(1),
    clampedFrom: +plan.wanted.toFixed(2),
    handoffSpeed: LAUNCH.handoffSpeed,
    totalSeconds: +(LAUNCH.deckDwell + plan.time + LAUNCH.handoffAt).toFixed(2),
  });

  if (f15 && f15.placeholder) failures.push("F-15: placeholder airframe in use");
  // The hostile is ONE instance reused by every encounter (§43), so its visual
  // is swapped once here rather than per deploy.
  if (hostileModel) installHostileVisual(drone, hostileModel.prototype);
  else failures.push("F-16C: placeholder UCAV in use");
  if (failures.length) {
    noteEl.innerHTML = failures.map((f) => `asset error &mdash; ${f}`).join("<br />");
    noteEl.hidden = false;
  }

  console.log("[world] scale check", {
    f15Length: 19.4,
    carrierLength: carrier && carrier.length,
    carrierToCoastKm: carrier && terrain ? +((carrier.position.z - terrain.nearEdgeZ) / 1000).toFixed(2) : null,
    spawnToCarrierKm: carrier ? +distanceKm(flightState.position, carrier.center).toFixed(2) : null,
    ocean: `${WORLD.oceanSize / 1000} km`,
    camera: { near: camera.near, far: camera.far },
    fog: { type: "FogExp2", color: hazeHex, density: WORLD.fogDensity },
  });

  console.log("[atmos] cloud field", atmosphere.report);

  window.__flightLab = { scene, camera, aircraftRoot, flightState, world, WORLD, FLIGHT, SPEED, THROTTLE, EXPERT, CHASE, PHYSICS, RECOVERY, physics, recovery, physicsDebug, carrier, terrain, WEAPONS, TARGETING, MISSILE, ENEMY, GUN, HOSTILE, HOSTILE_MISSILE, THREAT, mountSet, rounds, missiles, targeting, drone, hostileAi, threat, hitResponse, playerEntity, combatHud, tryFire, gun, WeaponMode, get weapon() { return weapon; }, input, ENGINE_FX, VAPOR, ATMOS, engineFx, vaporFx, atmosphere, MISSION, MissionPhase, LAUNCH, MISSION_FAILURE, director, launch, missionFailure, navRoot, restartMission, REARM, AUDIO, Cue, Priority, audio, SAM, SAM_MISSILE, SamState, samNet, FLARE, flares, CRASH, CrashCause, crashFx, step, GameMode, MODES, SANDBOX, sandbox, applyMode, lineOfSight, get mode() { return mode; }, get rearm() { return rearm; }, get route() { return director.route; }, get policy() { return physicsPolicy.name; } , worldClock, DAY, environmentFor, oceanVisual, OCEAN, LIGHTS, get settlementLights() { return settlementLights; }, get carrierLights() { return carrierLights; }, sun, moon, skyFill, sky, atmosphere };

  loadingEl.hidden = true;
  combatHud.reveal();
  measureRail();
  lastTime = performance.now();
  frame();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  measureRail();
});

if (new URLSearchParams(location.search).has("test")) import("./flight.test.js");
