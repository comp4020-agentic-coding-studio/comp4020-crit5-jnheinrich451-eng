// The orchestrator: wiring, frame loop, developer rail. CLAUDE.md §3, §17.3.

import * as THREE from "three";
import { createWorld, createPlaceholderAircraft } from "./world.js";
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
  // `G` swaps collision policies (stage 3) and `O` draws the carrier anchors
  // (stage 4); both land with the systems they belong to.
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

  updateFlight(state, axes, dt);

  // Stage 1 has no terrain, so the only floor is the ocean. Stage 3 replaces
  // this with real probes and a collision policy; until then, clamp rather
  // than let the aircraft fly under the water where nothing is visible.
  if (state.position.y < 30) {
    state.position.y = 30;
    state.sink = 0;
  }

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

const deg = (r) => ((r * 180) / Math.PI).toFixed(1);

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
