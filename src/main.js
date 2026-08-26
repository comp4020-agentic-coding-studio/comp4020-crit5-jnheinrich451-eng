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
import { buildTerrainIndex, createPhysics } from "./physics.js";
import { benchmarkIndex } from "./physics-benchmark.js";
import { createDevelopmentRecovery, createNullResponse } from "./collision.js";
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
  })
  .catch((err) => console.error("terrain load failed", err));

function installPolicies() {
  policies = [
    createDevelopmentRecovery({
      physics,
      getState: () => state,
      onEvent: (e) => console.log(`collision policy: ${e.kind}`, e.event.type),
    }),
    createNullResponse(),
  ];
  physics.setPolicy(policies[policyIndex]);
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

  if (input.consumeLatch("restart")) {
    state = createFlightState();
    rig.reset(state);
  }

  // A policy can neutralise the stick -- the input that flew into the
  // mountain must not be reapplied on the restore frame. The policy is asked;
  // it never reaches into input.js itself.
  const scripted = launch?.update(dt, state) ?? false;
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
    }
    const gated = physics.getPolicy()?.overridesInput?.() ? NEUTRAL_STICK : axes;
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

  rig.update(dt, state);
  world.update(dt, state);
  world.render();

  railClock += dt;
  if (railVisible && railClock > 0.1) {
    railClock = 0;
    paintRail(axes);
  }
}

const NEUTRAL_STICK = { x: 0, y: 0, roll: 0, throttle: 0 };

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
    `LAUNCH    ${launch ? (launch.isActive() ? `t=${launch.elapsed().toFixed(1)}/${launch.plan.total.toFixed(1)}` : "handed off") : "--"}`,
    `DECK RUN  ${carrierAnchors ? carrierAnchors.runLength.toFixed(1) + " m" : "--"}`,
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
