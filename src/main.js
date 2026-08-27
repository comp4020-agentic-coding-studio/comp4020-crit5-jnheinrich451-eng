// The orchestrator: wiring, frame loop, developer rail. CLAUDE.md §3, §17.3.

import * as THREE from "three";
import {
  COASTLINE_Z,
  createPlaceholderAircraft,
  createWorld,
  loadCarrier,
  loadTerrain,
} from "./world.js";
import { createLaunch } from "./launch.js";
import { createWeapons } from "./weapons.js";
import { createDrone, damageTarget } from "./enemy.js";
import { createTargeting, LOCK } from "./targeting.js";
import { AIM9, createMissileSystem } from "./missile.js";
import { createGun, leadSolution } from "./gun.js";
import { createCombatHud } from "./combat-hud.js";
import { createCombatFx } from "./combat-fx.js";
import { HOSTILE_MISSILE, createHostile } from "./hostile.js";
import {
  authorityFor,
  createEvasion,
  createThreatMonitor,
  wouldHaveHit,
} from "./threat.js";
import { createDamageResponse, playerDamageEvent } from "./damage.js";
import {
  COMPLETE, DECK, DEFENSIVE, EXTRACTION, FINAL, INTERCEPT, LAUNCH, TERRAIN,
  autopilotStick, blendStick, buildRoute, captureCheckpoint, createMission,
} from "./mission.js";
import { applyFlightState } from "./flight.js";
import {
  SAM_MISSILE, createSamNetwork, lineOfSight, placeSites,
} from "./sam.js";
import { createFlares } from "./flares.js";
import { createRearm } from "./rearm.js";
import { MISSION, createSandbox, nextMode, rulesFor } from "./modes.js";
import { quatForward } from "./flight.js";
import { buildTerrainIndex, createPhysics } from "./physics.js";
import { benchmarkIndex } from "./physics-benchmark.js";
import { createDevelopmentRecovery, createMissionCheckpointResponse } from "./collision.js";
import { createPhysicsDebug } from "./physics-debug.js";
import { createChaseCamera } from "./chase-camera.js";
import { createInput } from "./input.js";
import { loadAircraft } from "./aircraft.js";
import { assetFailures } from "./assets.js";
import {
  BANK_MAX,
  createFlightState,
  setMode,
  updateFlight,
  commandedSpeed,
} from "./flight.js";

const canvas = document.getElementById("view");
const loading = document.getElementById("loading");
const rail = document.getElementById("rail");

const world = createWorld(canvas);
const rig = createChaseCamera(world.camera);
const input = createInput({ target: window, doc: document });

// The placeholder flies immediately; the real airframe swaps in when it
// arrives. Both are 19.4 m, so nothing tuned against one is wrong for the
// other, and a failed load is a visual downgrade rather than a broken game.
let aircraft = createPlaceholderAircraft();
world.scene.add(aircraft);
let airframe = null;

let state = createFlightState();
rig.reset(state);

// Until the deck is ready the aircraft is HELD, not flown. Otherwise the
// opening second of every session is a jet cruising at 900 m over open water
// that then teleports onto a carrier -- which is both a worse first frame and
// a lie about where the sortie starts.
let held = true;

// ── terrain, physics, the collision policy ───────────────────────────────
let physics = createPhysics({});
let physicsDebug = null;
let policies = [];
let policyIndex = 0;
let terrainReport = null;
let carrierAnchors = null;
let launch = null;
let anchorHelper = null;
let launchClipSeconds = null;

// ── combat (stage 5) ─────────────────────────────────────────────────────
let weapons = null;
let weapon = "AIM-9";
const drone = createDrone({ centre: { x: 700, y: 950, z: -4600 } });
const targeting = createTargeting();
const fx = createCombatFx(world.scene);
const hud = createCombatHud(document.body, world.camera);
let clock = 0;

const gun = createGun({
  onHit: (target, damage, at) => {
    if (damageTarget(target, damage, at)) onKill(target);
  },
  addShake: (a) => rig.addShake(a),
});

const hostile = createHostile({
  onLaunch: (from, forward) => {
    missiles.fire({
      config: HOSTILE_MISSILE,
      owner: "hostile",
      position: { ...from.position },
      direction: forward,
      speed: 205,
      target: playerTarget,
    });
  },
});
const threatMonitor = createThreatMonitor();
const evasion = createEvasion();

// The player, published through the SAME target contract everything else uses,
// so an enemy round needs no special case to chase it.
const playerTarget = {
  label: "PLAYER", alive: true, health: 100, maxHealth: 100, radius: 8,
  hitAt: -Infinity,
  position: state.position,
  velocity: { x: 0, y: 0, z: 0 },
};

const damage = createDamageResponse({
  addShake: (a) => rig.addShake(a),
  onFeedback: () => {
    message = "HIT";
    messageUntil = clock + 1.2;
  },
});

const missiles = createMissileSystem({
  // THE single counter-measure hook (§14). The barrel roll attaches here and
  // the missile never learns what a barrel roll is. Stage 8 composes terrain
  // masking and flares onto this same function.
  // THE COMPOSED HOOK (§13). main.js is the only layer that knows where the
  // ground is, so terrain masking composes onto stage 6's barrel roll here --
  // and the missile still knows nothing about terrain, flares or rolls.
  authorityFor: (m) => {
    const base = authorityFor(m, evasion);
    if (m.owner !== "sam") return base;
    return lineOfSight(m.position, state.position, (x, z) => physics.groundAt(x, z))
      ? base
      : Math.min(base, 0.1);
  },
  onEvent: (event) => {
    if (event.kind !== "hit") return;
    fx.burst(event.round.position, 30);
    if (event.target === playerTarget) {
      // An EVENT, not a reset call. The response decides what it means, and
      // swallows the re-entry a 22 m fuze produces on consecutive frames.
      damage.handle(
        playerDamageEvent({
          source: "missile", at: clock, position: event.round.position,
          amount: event.round.config.damage, owner: event.round.owner,
        }),
      );
      return;
    }
    if (damageTarget(event.target, event.round.config.damage, clock)) {
      onKill(event.target);
    }
  },
});

function onKill(target) {
  fx.burst(target.position, 46);
  mission?.noteKill(target.label === "SAM" ? "sam" : "air");
  // Clearing the lock on a kill is what stops the bracket sitting on a corpse.
  targeting.clear();
  message = `${target.label} DESTROYED`;
  messageUntil = clock + 2.4;
}

let message = "";
let messageUntil = 0;
let threat = "";
let mission = null;
let route = null;
let phaseCue = "";
let phaseCueAge = 99;
let extraction = 0;
let routeHelper = null;
const fadeEl = document.getElementById("fade");
const completeEl = document.getElementById("complete");
const completeRows = document.getElementById("complete-rows");

// Deploy the stage-6 hostile per phase (§7). One instance, three encounters.
let mode = MISSION;
const sandbox = createSandbox();
const flares = createFlares();
const rearm = createRearm({
  onRefill: (name) => {
    message = `${name} REARMED`;
    messageUntil = clock + 1.8;
  },
});
const sams = createSamNetwork({
  onLaunch: (sam) => {
    missiles.fire({
      config: SAM_MISSILE,
      owner: "sam",
      position: {
        x: sam.target.position.x,
        y: sam.target.position.y + 14,
        z: sam.target.position.z,
      },
      // LAUNCHES UPWARD WITH ZERO INHERITED SPEED, which is what makes the
      // trail read as a ground launch rather than as a round appearing.
      direction: { x: 0, y: 1, z: 0 },
      speed: 0,
      target: playerTarget,
    });
  },
  onWreck: (sam) => wreckSam(sam),
});

const ENCOUNTERS = {
  [INTERCEPT]: { ammo: 0, engageDelay: 3.0 },
  [DEFENSIVE]: { ammo: 2, engageDelay: 2.0 },
  [FINAL]: { ammo: 1, engageDelay: 1.5 },
};

loadTerrain(world.scene)
  .then(({ report, group, triangles }) => {
    terrainReport = report;
    if (!report.ok || !triangles) return;

    const index = buildTerrainIndex(triangles);
    physics = createPhysics({ index });

    // Sanity-check known coordinates and LOG them. A query that returns "no
    // terrain" where terrain is present is the failure that eats a day: it
    // does not announce itself, everything downstream just quietly treats the
    // world as ocean, and every symptom points somewhere else.
    const probes = [
      ["just inside the coast", 0, COASTLINE_Z - 500],
      ["4 km inland", 0, COASTLINE_Z - 4000],
      ["9 km inland", 0, COASTLINE_Z - 9000],
      ["offshore (should be sea)", 0, COASTLINE_Z + 3000],
    ];
    for (const [label, x, z] of probes) {
      console.log(
        `terrain sample ${label}: ground ${physics.groundAt(x, z).toFixed(1)} m, ` +
          `${physics.isLandAt(x, z) ? "land" : "ocean"}`,
      );
    }

    const meshes = [];
    group.traverse((n) => n.isMesh && meshes.push(n));
    // MUST update world matrices first. The terrain is shifted into place
    // AFTER its triangles are snapshotted, and THREE.Raycaster reads
    // matrixWorld -- so without this the raycaster tests the mesh at its
    // pre-shift position, 22.6 km away. That is what made the first
    // agreement run report 0/15 and "raycaster missed 45": the benchmark was
    // comparing two different worlds, not two different algorithms.
    world.scene.updateMatrixWorld(true);
    benchmarkIndex(index, meshes);

    installPolicies();
    physicsDebug = createPhysicsDebug(world.scene, physics);
    buildMission();
  })
  .catch((err) => console.error("terrain load failed", err));

function installPolicies() {
  policies = [
    // The SHIPPED policy: a collision fails the run and restores a checkpoint.
    createMissionCheckpointResponse({
      onFail: () => {
        message = "MISSION FAILED";
        messageUntil = clock + 2.2;
      },
      onRestore: () => restoreCheckpoint(),
      onFade: (v) => {
        if (fadeEl) fadeEl.style.opacity = String(v);
      },
    }),
    // The DEVELOPMENT policy from stage 3, still here and still swappable.
    createDevelopmentRecovery({
      physics,
      getState: () => state,
      onEvent: (e) => console.log(`collision policy: ${e.kind}`, e.event.type),
    }),
  ];
  physics.setPolicy(policies[policyIndex]);
}

/**
 * Restore the latest checkpoint. Note the SURGICAL cleanup: expireOwner and
 * clearFx, never missiles.clear() or gun.reset() -- the first would delete the
 * player's in-flight shot and the second would refill the magazine, making a
 * crash the cheapest way to rearm.
 */
function restoreCheckpoint() {
  const cp = mission?.latestCheckpoint();
  if (cp) {
    applyFlightState(state, cp.snapshot);
    weapon = cp.weapon;
    // setCount(n), NOT reload() -- a checkpoint restores the loadout it
    // RECORDED (§7).
    weapons?.setCount(cp.missiles);
    gun.setRounds(cp.gunRounds);
  }
  missiles.expireOwner("hostile");
  gun.clearFx();
  threatMonitor.reset();
  damage.reset();
  evasion.reset();
  physics.reset(state, { keepPolicy: true });
  rig.reset(state);
}
installPolicies();

// The carrier and the catapult. Every mode flies the launch (§11), so it is
// started as soon as both the deck and the airframe are known.
Promise.all([loadCarrier(world.scene), measureClip("./assets/audio/engine-start.mp3")])
  .then(([{ anchors, report }, clipSeconds]) => {
    carrierAnchors = anchors;
    console.log(
      `engine start-up measured ${clipSeconds.toFixed(2)} s -> deck dwell ` +
        `${(clipSeconds / 2).toFixed(2)} s at double speed`,
    );
    launchClipSeconds = clipSeconds;
    anchorHelper = createAnchorHelper(anchors);
    world.scene.add(anchorHelper);
    startLaunch(clipSeconds);
  })
  .catch((err) => console.error("carrier load failed", err));

/**
 * The deck dwell is the start-up recording's own length, not an authored
 * number: the catapult fires on its last note, which makes the wait read as a
 * countdown rather than a delay. Measuring it here keeps the two coupled
 * values (§9) derived from one source.
 */
function measureClip(url) {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const done = (v) => resolve(v);
    audio.addEventListener("loadedmetadata", () => done(audio.duration || 22));
    // Missing audio is a NORMAL state (§16). Fall back rather than hanging the
    // whole launch on a file that may not be there.
    audio.addEventListener("error", () => done(22));
    setTimeout(() => done(audio.duration || 22), 4000);
    audio.src = url;
  });
}

/**
 * R restarts the SORTIE, not just the flight state.
 *
 * An earlier version rebuilt the flight state alone, which dropped the player
 * into mid-air at the spawn altitude with the launch already spent -- the
 * strongest moment in the build, unreachable for the rest of the session.
 * Every mode flies the catapult (§11), and that has to include a restart.
 */
function restartSortie() {
  state = createFlightState();
  physics.reset(state);
  // reset() reloads; clearFx() cleans up. They are separate for exactly this
  // reason -- a restart wants both, a phase change wants only one.
  gun.reset();
  gun.clearFx();
  missiles.clear();
  fx.clear();
  targeting.clear();
  weapons?.reload();
  drone.reset();
  threatMonitor.reset();
  evasion.reset();
  damage.resetAll();
  hostile.setActive(false);
  mission?.reset();
  extraction = 0;
  phaseCue = "";
  phaseCueAge = 99;
  if (completeEl) completeEl.hidden = true;
  if (fadeEl) fadeEl.style.opacity = "0";
  policies.forEach((p) => p.resetAll?.() ?? p.reset?.());
  flares.resetAll();
  rearm.reset();
  sandbox.resetAll();
  // A full restart resets the sites. They do NOT respawn mid-sortie: six is a
  // finite thing to clear, and a player who spent four minutes clearing the
  // valley has earned an empty valley.
  sams.reset();
  for (const [sam, mesh] of samMeshes) restoreSamMesh(sam, mesh);
  if (launchClipSeconds !== null && carrierAnchors) startLaunch(launchClipSeconds);
  else rig.reset(state);
}

function buildMission() {
  if (!carrierAnchors) return;
  route = buildRoute({
    carrierZ: carrierAnchors.deck.z,
    coastZ: terrainReport?.ok ? terrainReport.nearEdgeZ : COASTLINE_Z,
    // The survey is handed the height field as a FUNCTION, which is why it is
    // testable against a synthetic one with no scene (§4).
    sampleHeight: terrainReport?.ok ? (x, z) => physics.groundAt(x, z) : null,
  });
  console.log(
    `route: ${route.surveyed ? "surveyed" : "AUTHORED FALLBACK"}, ` +
      route.legs.map((l) => `${l.name}@${l.z.toFixed(0)}`).join(" -> "),
  );
  mission = createMission({
    route,
    onPhase: (to, from) => {
      phaseCue = to;
      phaseCueAge = 0;
      onPhaseChange(to, from);
    },
  });
  // Two per inland leg, flanking the corridor. A site with nowhere to stand is
  // DROPPED, not floated.
  const inland = route.legs.filter((l) => l.phase === TERRAIN);
  const placed = placeSites(inland, (x, z) => physics.groundAt(x, z));
  sams.deploy(placed.map((p) => ({ x: p.x, y: p.y + 6, z: p.z })));
  console.log(
    `SAM sites: ${placed.length} of ${inland.length * 2} stood on land ` +
      `(${placed.map((p) => `${p.leg}${p.side > 0 ? "R" : "L"}@${p.ground.toFixed(0)}m`).join(", ")})`,
  );
  buildSamMeshes();

  routeHelper = createRouteHelper(route);
  world.scene.add(routeHelper);
}

function onPhaseChange(to, from) {
  // At EVERY phase transition: the surgical cleanup, for the same reason as
  // the restore above.
  missiles.expireOwner("hostile");
  gun.clearFx();
  threatMonitor.reset();
  damage.reset();

  const encounter = ENCOUNTERS[to];
  if (encounter) {
    // Deploy ~2400 m ahead, ~900 m to an ALTERNATING side, ~140 m above,
    // facing back down the player's course -- a head-on pass announces an
    // intercept and puts it on screen without a hunt.
    const side = hostile.ai.encounters % 2 === 0 ? 1 : -1;
    const f = quatForward(state.quat);
    hostile.deploy({
      at: {
        x: state.position.x + f.x * 2400 + side * 900,
        y: Math.max(400, state.position.y + 140),
        z: state.position.z + f.z * 2400,
      },
      heading: Math.atan2(-(-f.x), -(-f.z)),
      ammo: encounter.ammo,
      engageDelay: encounter.engageDelay,
    });
  } else {
    // Outside those phases it is switched off ENTIRELY and handed no
    // candidates -- not simulated, not drawn, not targetable.
    hostile.setActive(false);
  }

  // Four checkpoints, at phase boundaries: deck, open sea, terrain entry,
  // final approach.
  const CHECKPOINT_AT = [LAUNCH, INTERCEPT, TERRAIN, FINAL];
  if (CHECKPOINT_AT.includes(to)) {
    const f = quatForward(state.quat);
    // Lifted above the ground AHEAD, not the ground below: a levelled attitude
    // over a valley floor with a ridge 1.5 km ahead is not a flyable state.
    let ground = 0;
    for (let d = 0; d <= 4000; d += 400) {
      ground = Math.max(
        ground,
        physics.groundAt(state.position.x + f.x * d, state.position.z + f.z * d),
      );
    }
    mission.addCheckpoint(
      captureCheckpoint(state, {
        groundAhead: ground,
        weapon,
        missiles: weapons ? weapons.count : 2,
        gunRounds: gun.rounds,
        phase: to,
      }),
    );
  }

  if (to === EXTRACTION) extraction = 0;
  if (to === COMPLETE) showComplete();
}

function showComplete() {
  if (!completeEl || !completeRows) return;
  const s = mission.mission.stats;
  const rows = [
    ["TIME", `${mission.elapsed().toFixed(1)} s`],
    ["AIR KILLS", String(s.airKills)],
    ["SAM SITES", String(s.samKills)],
    ["AIM-9", `${s.missilesFired} / ${(weapons?.capacity ?? 2)}`],
    ["GUN ROUNDS", String(s.gunFired)],
  ];
  completeRows.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    completeRows.append(dt, dd);
  }
  completeEl.hidden = false;
}

function startLaunch(clipSeconds) {
  if (!carrierAnchors) return;
  launch = createLaunch({
    anchors: carrierAnchors,
    clipSeconds,
    rig,
    setGear: (down) => airframe?.setGearVisual(down),
    groundOffset: airframe?.groundOffset() ?? 2.95,
    onEvent: (name, plan) => console.log(`launch: ${name} at t=${plan[name + "At"] ?? "-"}`),
  });
  console.log("launch plan:", JSON.stringify(launch.plan));
  launch.start(state);
  held = false;
  // Steering is disabled outright while the script owns the aircraft, rather
  // than asking the frame loop to remember to ignore the pointer (§7).
  input.setPointerEnabled(false);
}

loadAircraft()
  .then((loaded) => {
    world.scene.remove(aircraft);
    aircraft = loaded.group;
    airframe = loaded;
    world.scene.add(aircraft);
    createWeapons(aircraft).then((w) => {
      weapons = w;
    });
    // The airframe may arrive after the carrier; re-seat the launch so the
    // parked pose uses the MEASURED wheel offset rather than the fallback.
    if (launchClipSeconds !== null) startLaunch(launchClipSeconds);
  })
  .catch((err) => console.error("aircraft load failed", err));

// Developer rail, `H`. Off by default: a player must never open this page and
// find a wall of telemetry. §7 lists the rest of the developer keys.
let railVisible = false;
let railClock = 0;

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyH") {
    railVisible = !railVisible;
    rail.hidden = !railVisible;
  }
  if (event.code === "KeyM") {
    setMode(state, state.mode === "ASSISTED" ? "EXPERT" : "ASSISTED");
    // Clear transient input on a mode change: a held key would otherwise
    // command the fresh model on frame one, and the ramped axes would carry
    // the old attitude in with them. input.clear() deliberately leaves the
    // pitch convention alone -- it is a preference, not transient state.
    input.clear();
    rig.reset(state);
  }
  if (event.code === "KeyP" && physicsDebug) physicsDebug.toggle();
  if (event.code === "KeyJ") hud.setVisible(!hud.isVisible());
  if (event.code === "KeyT") {
    // T cycles AND restarts: every mode starts on the deck, and half a mission
    // in the wrong ruleset is not a state worth supporting.
    mode = nextMode(mode);
    console.log(`mode -> ${mode}`);
    restartSortie();
  }
  if (event.code === "KeyN" && routeHelper) {
    routeHelper.visible = !routeHelper.visible;
  }
  // Enter restarts ONLY from the completion screen -- it is a fire key in
  // flight, and a player pulling the trigger should never restart the sortie.
  if (event.code === "Enter" && completeEl && !completeEl.hidden) restartSortie();
  if (event.code === "KeyO" && anchorHelper) {
    anchorHelper.visible = !anchorHelper.visible;
  }
  if (event.code === "KeyG") {
    // Swap the collision policy live. DETECTION is byte-identical under both;
    // only the response differs, which is the whole point of §4's split.
    policyIndex = (policyIndex + 1) % policies.length;
    physics.setPolicy(policies[policyIndex]);
    console.log(`collision policy -> ${policies[policyIndex].name}`);
  }
  // `O` draws the carrier anchors (stage 4), with the system it belongs to.
});

// The frame loop. §17.3 and stage 1's rule 1: schedule the NEXT frame FIRST,
// then run the body inside a guard. If rAF were the last statement, a single
// thrown frame would permanently end the session and leave the last rendered
// image on screen -- which reads exactly like a feature being broken, and
// costs hours before anyone suspects the loop is simply dead.
let errorCount = 0;
let last = 0;

function frame(now) {
  requestAnimationFrame(frame); // FIRST -- before anything can throw
  try {
    step(now);
  } catch (err) {
    // Log the first few and keep flying. Failing safe toward playable is the
    // rule; a silent freeze is the failure this guard exists to prevent.
    if (errorCount++ < 5) console.error("frame error", err);
  }
}

function step(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
  last = now;

  const axes = input.update(dt);

  if (input.consumeLatch("restart")) restartSortie();

  // A policy can neutralise the stick -- the input that flew into the
  // mountain must not be reapplied on the restore frame. The policy is asked;
  // it never reaches into input.js itself.
  if (held) {
    // Nothing to simulate yet, but the policy must still be ticked (§17.4) --
    // a branch that skips physics and forgets this freezes the game.
    physics.getPolicy()?.tick(dt);
  }
  const scripted = held ? true : (launch?.update(dt, state) ?? false);
  if (scripted) {
    // §9: no flight physics runs during the launch, and §17.4 -- a branch that
    // skips physics.update() must tick the response policy ITSELF, or the game
    // freezes for the whole eleven seconds on the deck.
    physics.getPolicy()?.tick(dt);
  } else {
    if (launch?.hasHandedOff() && !input.pointerEnabled()) {
      input.setPointerEnabled(true);
      // Drop any latch accumulated on the deck, so a key pressed during the
      // script does not fire on the handoff frame.
      input.dropLatches();
      // Stage 7's mission director will own this. Until then, one encounter
      // deploys on handoff so the dogfight is reachable.
      hostile.deploy({
        at: { x: state.position.x + 900, y: state.position.y + 140, z: state.position.z - 2400 },
        heading: 0,
        ammo: 2,
        engageDelay: 6,
      });
    }
    let gated = physics.getPolicy()?.overridesInput?.() ? NEUTRAL_STICK : axes;

    // EXTRACTION is a VIRTUAL STICK, not a transform override: it flies
    // through the ordinary flight model and obeys the same envelope, bank sink
    // and camera rig the player was just using, and control is handed AWAY
    // over 1.3 s rather than switched off.
    if (mission && mission.mission.phase === EXTRACTION && carrierAnchors) {
      const home = carrierAnchors.approach;
      const dx = home.x - state.position.x;
      const dz = home.z - state.position.z;
      const auto = autopilotStick(
        {
          heading: state.heading, pitch: state.pitch,
          altitude: state.position.y, speed: state.speed,
        },
        { heading: Math.atan2(-dx, -dz), altitude: 620, speed: 190 },
      );
      gated = blendStick(gated, auto, Math.min(1, extraction / 1.3), {});
      rig.blend("recovery", RECOVERY_VIEW, Math.min(1, extraction / 1.3));
    }

    updateFlight(state, gated, dt);

    // §8: physics.update() also ticks the installed policy. Any branch that
    // skips physics has to tick the policy itself, or the game freezes
    // whenever physics is bypassed.
    physics.update(dt, state);
  }
  physicsDebug?.update(state);

  aircraft.position.copy(state.position);
  aircraft.quaternion.set(
    state.quat.x,
    state.quat.y,
    state.quat.z,
    state.quat.w,
  );

  // ── combat ─────────────────────────────────────────────────────────────
  clock += dt;
  drone.update(dt);

  const forward = quatForward(state.quat);
  const observer = { position: state.position, forward };
  // An empty candidate list is how targeting is switched OFF (§5) -- there is
  // deliberately no enabled flag, so the launch script simply offers nothing.
  const candidates = [];
  if (!scripted) {
    if (drone.target.alive) candidates.push(drone.target);
    // An INACTIVE hostile is not offered to targeting at all (§12).
    if (hostile.isActive() && hostile.target.alive) candidates.push(hostile.target);
  }
  const track = targeting.update(dt, candidates, observer);

  if (!scripted && input.consumeLatch("weapon")) {
    weapon = weapon === "AIM-9" ? "GUN" : "AIM-9";
  }

  const firing = !scripted && input.isFiring();
  const lead =
    track.currentTarget && weapon === "GUN"
      ? leadSolution(state.position, track.currentTarget).point
      : null;

  if (weapon === "GUN") {
    gun.update(dt, {
      firing,
      origin: state.position,
      forward,
      candidates,
      now: clock,
    });
  } else if (firing && track.lockState === LOCK && weapons && weapons.count > 0) {
    const released = weapons.release();
    if (released) {
      missiles.fire({
        config: AIM9,
        owner: "player",
        position: released.position,
        direction: forward,
        speed: state.speed,
        target: track.currentTarget,
      });
      message = "MISSILE AWAY";
      messageUntil = clock + 1.6;
    }
  }

  // ── the hostile, the threat monitor, evasion ───────────────────────────
  playerTarget.velocity.x = forward.x * state.speed;
  playerTarget.velocity.y = forward.y * state.speed;
  playerTarget.velocity.z = forward.z * state.speed;

  // The sandbox driver: one hostile at a time, and nothing at all in PEACE.
  if (
    sandbox.update(dt, {
      mode,
      handedOff: launch ? launch.hasHandedOff() : false,
      hostileAlive: hostile.isActive() && hostile.target.alive,
    })
  ) {
    const side = hostile.ai.encounters % 2 === 0 ? 1 : -1;
    hostile.deploy({
      at: {
        x: state.position.x + forward.x * 2400 + side * 900,
        y: Math.max(400, state.position.y + 140),
        z: state.position.z + forward.z * 2400,
      },
      heading: 0,
      ammo: 2,
      engageDelay: 2,
    });
  }

  if (!scripted && input.consumeLatch("evade")) evasion.request(state.mode);
  evasion.update(dt);
  damage.tick(dt);

  hostile.update(dt, {
    playerState: state,
    playerAlive: true,
    playerLockedOnMe:
      track.lockState === LOCK && track.currentTarget === hostile.target,
  });

  // What the hostile is doing TO the player, published for the monitor.
  const acquisitions = [];
  if (hostile.isActive() && hostile.target.alive) {
    const s = hostile.ai.state;
    const level = s === "ACQUIRE" ? "TRACK" : s === "ATTACK" ? "LOCK" : "NONE";
    if (level !== "NONE") {
      acquisitions.push({
        level, position: hostile.target.position, label: "HOSTILE",
        progress: Math.min(1, hostile.ai.lockTimer / 1.25),
      });
    }
  }
  // ── ground threats ─────────────────────────────────────────────────────
  const rules = rulesFor(mode);
  if (rules.sams && !scripted) {
    sams.update(dt, {
      playerState: state,
      sampleHeight: (x, z) => physics.groundAt(x, z),
    });
    for (const a of sams.acquisitions()) acquisitions.push(a);
    for (const sam of sams.liveSites()) candidates.push(sam.target);
  }
  updateSamMeshes();

  // ── flares ─────────────────────────────────────────────────────────────
  if (!scripted && input.consumeLatch("flares")) {
    if (flares.dispense(state, forward, clock) > 0) {
      message = "FLARES";
      messageUntil = clock + 1.1;
    }
  }
  flares.update(dt, clock);
  // Offered to every hostile round: the round's TARGET is swapped, never a
  // flag set. missile.js needs no changes at all.
  flares.offerTo(missiles.rounds, state.position);

  // ── rearm ──────────────────────────────────────────────────────────────
  rearm.update(dt, {
    "AIM-9": weapons
      ? { isEmpty: () => weapons.count === 0, refill: () => weapons.reload() }
      : null,
    GUN: { isEmpty: () => gun.isEmpty(), refill: () => gun.reset() },
  });

  const t = threatMonitor.update(dt, state, acquisitions, missiles.rounds);
  threat = t.label;

  // ── the mission ────────────────────────────────────────────────────────
  phaseCueAge += dt;
  let navLeg = null;
  if (mission && rules.phases) {
    const result = mission.update(dt, {
      position: state.position,
      fired: launch ? launch.elapsed() >= launch.plan.fireAt : false,
      handedOff: launch ? launch.hasHandedOff() : false,
      magazineSpent: hostile.spent(missiles.countFor("hostile")),
      cinematicDone: extraction >= EXTRACTION_SECONDS,
    });
    navLeg = result.leg;
    if (mission.mission.phase === EXTRACTION) extraction += dt;
  }

  // EVADE is announced only for a miss that WAS going to be a hit -- otherwise
  // the word teaches the player nothing about whether the roll worked.
  const wereGoingToHit = evasion.isRolling()
    ? missiles.rounds.filter((r) => r.owner !== "player" && wouldHaveHit(r, state.position))
    : [];

  missiles.update(dt, clock);

  if (wereGoingToHit.length && !wereGoingToHit.some((r) => r.detonated)) {
    if (wereGoingToHit.some((r) => !missiles.rounds.includes(r) || !wouldHaveHit(r, state.position))) {
      evasion.noteDefeated();
      message = "EVADE";
      messageUntil = clock + 1.4;
    }
  }
  fx.syncMissiles(missiles.rounds);
  fx.syncTracers(gun.tracers);
  fx.update(dt);
  updateDroneMesh();
  updateHostileMesh();

  rig.update(dt, state);
  world.update(dt, state);

  if (clock > messageUntil) message = "";
  if (hud.isVisible()) {
    hud.update(dt, {
      speed: state.speed,
      altitude: state.position.y,
      agl: physics.telemetry.agl,
      afterburner: state.afterburner,
      bank: state.bank,
      pitch: state.pitch,
      missiles: weapons ? weapons.count : 0,
      flares: flares.remaining,
      gunRounds: gun.rounds,
      weapon,
      mode: state.mode,
      target: track.currentTarget,
      lockState: track.lockState,
      lockProgress: track.lockProgress,
      range: track.range,
      lead,
      threat,
      threatLevel: t.level,
      message,
      position: state.position,
      heading: state.heading,
      // GROUND CONTACTS APPEAR ONLY WHILE A SITE IS ACTUALLY EMITTING.
      // Showing every SAM the moment the player is in range would hand them
      // the whole threat map and quietly undo the terrain-masking mechanic --
      // flying the valley keeps the radar clean, and a square lighting up
      // means the same thing as the warning in the player's ear.
      contacts: radarContacts(),
      nav: rules.nav ? navLeg : null,
      phaseCue,
      phaseCueAge,
    });
  }

  world.render();

  railClock += dt;
  if (railVisible && railClock > 0.1) {
    railClock = 0;
    paintRail(axes);
  }
}

const NEUTRAL_STICK = { x: 0, y: 0, roll: 0, throttle: 0 };
// A fourth blended composition (§7). Never a second camera.
const RECOVERY_VIEW = { standoff: 44, height: 13, framingY: -0.1, lagScale: 1.5 };
// Level out, turn home, settle, hold 4.4 s, fade 1.5 s. No touchdown is shown:
// the player has already demonstrated skill and landing must not become
// another test.
const EXTRACTION_SECONDS = 1.3 + 4.4 + 1.5;

const deg = (r) => ((r * 180) / Math.PI).toFixed(1);
const m = (v) => (Number.isFinite(v) ? v.toFixed(0) + " m" : "--");

function paintRail(axes) {
  const held = input.heldKeys();
  rail.textContent = [
    `MODE      ${state.mode}`,
    `SPEED     ${state.speed.toFixed(1)} m/s   (cmd ${commandedSpeed(state.throttle).toFixed(0)})`,
    `THROTTLE  ${(state.throttle * 100).toFixed(0)}%${state.afterburner ? "  AB" : ""}`,
    `ALT       ${state.position.y.toFixed(0)} m`,
    `SINK      ${state.sink.toFixed(1)} m/s`,
    `HDG       ${deg(state.heading)}`,
    `PITCH     ${deg(state.pitch)}`,
    `BANK      ${deg(state.bank)}  / ${deg(BANK_MAX)}`,
    `POS       ${state.position.x.toFixed(0)}, ${state.position.z.toFixed(0)}`,
    `AXES      x ${axes.x.toFixed(2)}  y ${axes.y.toFixed(2)}  roll ${axes.roll.toFixed(2)}  thr ${axes.throttle}`,
    `PITCH CV  ${input.pitchConvention()}`,
    `GEAR      ${airframe ? (airframe.gearIsDown() ? "DOWN" : "UP") : "--"}`,
    // A stuck axis is invisible in every other readout; this is the line that
    // makes it obvious. §7.
    `KEYS      ${held.length ? held.join(" ") : "--"}`,
    `CLEAR     ${m(physics.telemetry.clearance)}  (${physics.telemetry.closest})`,
    `AGL       ${m(physics.telemetry.agl)}  over ${physics.telemetry.surface}`,
    `FWD HAZ   ${m(physics.telemetry.forwardHazard)}${physics.telemetry.forwardImminent ? "  IMMINENT" : ""}`,
    `POLICY    ${physics.getPolicy()?.name ?? "--"}  (G)`,
    `HISTORY   ${physics.historyLength()} safe states`,
    `COAST     z=${terrainReport?.ok ? terrainReport.nearEdgeZ : "--"}`,
    `PHASE     ${mission ? `${mission.mission.phase} ${mission.mission.phaseTime.toFixed(1)}s` : "--"}`,
    `NAV       ${mission?.currentLeg()?.name ?? "--"}  clock ${mission ? mission.elapsed().toFixed(1) : "--"}s`,
    `ROUTE     ${route ? (route.surveyed ? "surveyed" : "authored") : "--"}  checkpoints ${mission?.mission.checkpoints.length ?? 0}`,
    `LAUNCH    ${held ? "waiting for the deck" : launch ? (launch.isActive() ? `t=${launch.elapsed().toFixed(1)}/${launch.plan.total.toFixed(1)}` : "handed off") : "--"}`,
    `DECK RUN  ${carrierAnchors ? carrierAnchors.runLength.toFixed(1) + " m" : "--"}`,
    `WEAPON    ${weapon}   AIM-9 ${weapons ? weapons.count : "--"}   GUN ${gun.rounds}`,
    `HOSTILE   ${hostile.isActive() ? hostile.ai.state + " ammo " + hostile.ai.ammo : "off"}  threat ${threat || "--"}`,
    `MODE      ${mode}  sams ${sams.liveSites().length}/${sams.sites.length}  flares ${flares.remaining}`,
    `REARM     ${rearm.active().length ? rearm.active().map((n) => `${n} ${rearm.remaining(n).toFixed(0)}s`).join("  ") : "--"}`,
    `EVADE     ${evasion.isRolling() ? "ROLLING" : "--"}  defeated ${evasion.defeatedCount()}  hits ${damage.hitsTaken()}`,
    `TRACK     ${targeting.state().lockState} ${(targeting.state().lockProgress * 100).toFixed(0)}%  rounds ${missiles.rounds.length}`,
    `SHAKE     ${rig.shakeLevel().toFixed(3)}`,
    `ERRORS    ${errorCount}`,
    // §2: a fallback must be visible, or a build quietly flying the
    // placeholder looks like a build with a badly modelled aircraft.
    `ASSETS    ${assetFailures().length ? assetFailures().map((f) => f.name).join(", ") : "ok"}`,
  ].join("\n");
}

/** The four measured anchors, drawn on `O`. */
function createAnchorHelper(anchors) {
  const group = new THREE.Group();
  group.visible = false;
  const colours = { deck: 0x9fd7ff, launchStart: 0x8ef0c8, launchEnd: 0xffd400, approach: 0xff9b7a };
  for (const [name, colour] of Object.entries(colours)) {
    const a = anchors[name];
    if (!a) continue;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(4, 10, 8),
      new THREE.MeshBasicMaterial({ color: colour }),
    );
    mesh.position.set(a.x, a.y, a.z);
    group.add(mesh);
  }
  // The run itself, so "launched through the deck instead of along it" is
  // visible rather than inferred.
  const line = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(anchors.launchStart.x, anchors.launchStart.y, anchors.launchStart.z),
    new THREE.Vector3(anchors.launchEnd.x, anchors.launchEnd.y, anchors.launchEnd.z),
  ]);
  group.add(new THREE.Line(line, new THREE.LineBasicMaterial({ color: 0xffd400 })));
  return group;
}

// A visible drone: the target contract carries no mesh, on purpose, because
// stage 8's SAM sites publish the same shape from a completely different body.
let droneMesh = null;
function updateDroneMesh() {
  if (!droneMesh) {
    droneMesh = new THREE.Mesh(
      new THREE.ConeGeometry(3.2, 13, 6),
      new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.5, metalness: 0.4 }),
    );
    droneMesh.rotation.x = -Math.PI / 2;
    world.scene.add(droneMesh);
  }
  droneMesh.visible = drone.target.alive;
  if (!drone.target.alive) return;
  droneMesh.position.set(
    drone.target.position.x, drone.target.position.y, drone.target.position.z,
  );
  // Flash on a hit: feedback that is not a number.
  const flash = Math.max(0, 1 - (clock - drone.target.hitAt) / 0.18);
  droneMesh.material.emissive.setRGB(flash, flash * 0.4, 0);
}

/** Every trigger volume, drawn on `N`. */
function createRouteHelper(route) {
  const group = new THREE.Group();
  group.visible = false;
  for (const leg of route.legs) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(leg.radius - 24, leg.radius, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffd400, side: THREE.DoubleSide, transparent: true, opacity: 0.45,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(leg.x, (leg.ground ?? 0) + 60, leg.z);
    group.add(ring);
  }
  return group;
}

// ── SAM meshes and wrecks ────────────────────────────────────────────────
const samMeshes = new Map();
const contactList = [];

function buildSamMeshes() {
  for (const sam of sams.sites) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 9, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a5148, roughness: 0.8 }),
    );
    base.position.y = 2.5;
    const turret = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.2, 9),
      new THREE.MeshStandardMaterial({ color: 0x5d6659, roughness: 0.7 }),
    );
    turret.position.y = 6.5;
    turret.rotation.x = -0.5;
    group.add(base, turret);
    group.position.set(
      sam.target.position.x, sam.target.position.y - 6, sam.target.position.z,
    );
    world.scene.add(group);
    samMeshes.set(sam, { group, base, turret });
  }
}

function updateSamMeshes() {
  for (const [sam, mesh] of samMeshes) {
    if (sam.wrecked) continue;
    const flash = Math.max(0, 1 - (clock - sam.target.hitAt) / 0.18);
    mesh.base.material.emissive.setRGB(flash, flash * 0.4, 0);
  }
}

/**
 * A wreck STAYS IN THE WORLD: tinted, tilted, turret hidden. Not a deletion --
 * a destroyed installation should be visible evidence that the player did
 * something. Visibility is set EXPLICITLY, because the generic kill path hides
 * dead targets.
 */
function wreckSam(sam) {
  const mesh = samMeshes.get(sam);
  if (!mesh) return;
  mesh.group.visible = true;
  mesh.turret.visible = false;
  mesh.base.material.color.setHex(0x2a2622);
  mesh.base.material.emissive.setRGB(0, 0, 0);
  mesh.group.rotation.z = 0.32;
  fx.burst(sam.target.position, 40);
}

function restoreSamMesh(sam, mesh) {
  mesh.group.visible = true;
  mesh.turret.visible = true;
  mesh.base.material.color.setHex(0x4a5148);
  mesh.group.rotation.z = 0;
}

function radarContacts() {
  contactList.length = 0;
  if (hostile.isActive() && hostile.target.alive) {
    contactList.push({ position: hostile.target.position, ground: false });
  }
  if (drone.target.alive) {
    contactList.push({ position: drone.target.position, ground: false });
  }
  for (const sam of sams.emitting()) {
    contactList.push({ position: sam.target.position, ground: true });
  }
  return contactList;
}

let hostileMesh = null;
function updateHostileMesh() {
  if (!hostileMesh) {
    hostileMesh = new THREE.Mesh(
      new THREE.ConeGeometry(4, 16, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b5a4e, roughness: 0.55, metalness: 0.35 }),
    );
    hostileMesh.rotation.x = -Math.PI / 2;
    world.scene.add(hostileMesh);
  }
  // Inactive means NOT DRAWN, as well as not simulated and not targetable.
  hostileMesh.visible = hostile.isActive() && hostile.target.alive;
  if (!hostileMesh.visible) return;
  const p = hostile.target.position;
  hostileMesh.position.set(p.x, p.y, p.z);
  const f = hostile.forward();
  hostileMesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, -1), new THREE.Vector3(f.x, f.y, f.z).normalize(),
  );
  const flash = Math.max(0, 1 - (clock - hostile.target.hitAt) / 0.18);
  hostileMesh.material.emissive.setRGB(flash, flash * 0.4, 0);
}

function onResize() {
  world.resize();
}
window.addEventListener("resize", onResize);
onResize();

if (loading) loading.hidden = true;
requestAnimationFrame(frame);

// §18: `?test=1` runs the assertion suite alongside the game, so the checks
// can be exercised against the same build the player is flying rather than a
// separate page that could drift from it.
if (new URLSearchParams(location.search).has("test")) {
  import("./flight.test.js").then((suite) => {
    const result = suite.run();
    console.log(`flight.test.js: ${result.passed} passed, ${result.failed} failed`);
    for (const f of result.failures) console.error("FAIL", f.name, f.detail ?? "");
  });
}

// Expose a handle for the developer rail and for driving the page from a
// headless browser. Not used by gameplay.
globalThis.__vector = {
  get state() { return state; },
  get airframe() { return airframe; },
  get launch() { return launch; },
  get anchors() { return carrierAnchors; },
  get physics() { return physics; },
  world, rig, input, THREE,
};
