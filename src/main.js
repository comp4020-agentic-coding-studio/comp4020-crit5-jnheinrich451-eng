// The orchestrator: wiring, frame loop, developer rail. CLAUDE.md §3, §17.3.

import * as THREE from "three";
import {
  COASTLINE_Z,
  createPlaceholderAircraft,
  createWorld,
  loadTerrain,
} from "./world.js";
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

loadAircraft()
  .then((loaded) => {
    world.scene.remove(aircraft);
    aircraft = loaded.group;
    airframe = loaded;
    world.scene.add(aircraft);
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
  const gated = physics.getPolicy()?.overridesInput?.() ? NEUTRAL_STICK : axes;
  updateFlight(state, gated, dt);

  // §8: physics.update() also ticks the installed policy. Any branch that
  // skips physics has to tick the policy itself, or the game freezes whenever
  // physics is bypassed.
  physics.update(dt, state);
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
    `SHAKE     ${rig.shakeLevel().toFixed(3)}`,
    `ERRORS    ${errorCount}`,
    // §2: a fallback must be visible, or a build quietly flying the
    // placeholder looks like a build with a badly modelled aircraft.
    `ASSETS    ${assetFailures().length ? assetFailures().map((f) => f.name).join(", ") : "ok"}`,
  ].join("\n");
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
  world, rig, input, THREE,
};
