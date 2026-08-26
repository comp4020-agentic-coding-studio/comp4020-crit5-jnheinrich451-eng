// The F-15E: load, normalise, gear visual swap. CLAUDE.md §2, stage 2.

import * as THREE from "three";
import {
  describe,
  hierarchy,
  loadGLTF,
  normalise,
  orientationFromLandmarks,
  recordFailure,
} from "./assets.js";
import { createPlaceholderAircraft } from "./world.js";

export const AIRCRAFT_LENGTH = 19.4;
const MODEL_URL = "./models/f-15e/scene.gltf";

// The nose landmark: the HUD sits in front of the pilot, which is as far
// forward as any named node in this model gets.
const NOSE_NODE = "F-15E-hud_3";

// The model ships the landing gear as two discrete variants plus a lamp, not
// as an animation. There is no gear animation in this project and there will
// not be one -- stage 4 hides the transition inside the rotation and the
// afterburner flash, which is the cheapest believable cheat available and the
// camera is moving hard at that instant anyway.
const GEAR_UP_NODE = "F-15E-landingOff_5";
const GEAR_DOWN_NODE = "F-15E-landingOn_6";
const GEAR_LAMP_NODE = "F-15E-landingOnLight_7";

export async function loadAircraft() {
  const group = new THREE.Group();

  // Cache the last gear value so an ordinary frame costs one comparison: the
  // swap walks the hierarchy and must not run at 60 Hz.
  //
  // SEEDED null, NOT true. The loader leaves the model gear-up, so a cache
  // primed with the deck's own value makes the very first call a no-op and
  // the gear-down configuration is then unreachable for the whole mission --
  // the aircraft sits on the carrier with its wheels retracted and nothing
  // anywhere reports a fault.
  let gearCache = null;
  let gearUp = null;
  let gearDown = null;
  let gearLamp = null;

  let report = null;
  let model = null;

  try {
    const gltf = await loadGLTF(MODEL_URL);
    model = gltf.scene;

    console.log("F-15E hierarchy:", hierarchy(model).join(", "));

    // Measured, not typed: the HUD sits at the nose, the gear-down variant
    // hangs below. Those two facts about the airframe fix its orientation
    // whatever coordinate convention the exporter used.
    const orient = orientationFromLandmarks(model, {
      noseNode: NOSE_NODE,
      downNode: GEAR_DOWN_NODE,
    });
    console.log(
      `F-15E orientation: ${orient.ok ? "measured" : "FALLBACK (landmarks missing)"}` +
        (orient.forward
          ? ` forward=${orient.forward.toArray()} up=${orient.up.toArray()}`
          : ""),
    );
    if (!orient.ok) recordFailure("F-15E orientation", "landmark nodes missing");

    report = normalise(model, {
      targetLength: AIRCRAFT_LENGTH,
      axis: "z",
      orientation: orient.quaternion,
    });
    console.log(describe(report, "F-15E", AIRCRAFT_LENGTH));

    if (!report.ok) throw new Error(report.reason);

    // A shape check on the result, because "it loaded" and "it is the right
    // way up" are different claims and only one of them is obvious. A real
    // F-15E is 19.43 m long, 13.05 m across and 5.63 m tall, so after
    // normalising to 19.4 m the other two extents are known independently of
    // anything this code did. Wingspan landing on Y instead of X is exactly
    // the knife-edge failure the landmark measurement replaced.
    const s = report.size;
    if (!(s.x > s.y && s.x > 10 && s.x < 16)) {
      recordFailure(
        "F-15E orientation",
        `wingspan not on X: ${s.x.toFixed(1)} x ${s.y.toFixed(1)} x ${s.z.toFixed(1)}`,
      );
    }

    gearUp = model.getObjectByName(GEAR_UP_NODE) ?? null;
    gearDown = model.getObjectByName(GEAR_DOWN_NODE) ?? null;
    gearLamp = model.getObjectByName(GEAR_LAMP_NODE) ?? null;
    if (!gearUp || !gearDown) {
      recordFailure("F-15E gear nodes", "gear variants not found by name");
    }

    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
      // The airframe reads as plastic at default roughness against a bright
      // sky; a metal-leaning surface is what makes it a jet at 200 m/s.
      if (node.material && node.material.isMeshStandardMaterial) {
        node.material.envMapIntensity = 1.1;
      }
    });

    group.add(report.holder);
  } catch (err) {
    // §2: if an asset fails to load the game must remain playable. The
    // placeholder is already 19.4 m, so the camera standoff and framing
    // tuned against it need no adjustment when the real model is missing.
    recordFailure("F-15E airframe", err && err.message ? err.message : err);
    group.add(createPlaceholderAircraft());
  }

  function setGearVisual(down) {
    if (gearCache === down) return;
    gearCache = down;
    if (gearUp) gearUp.visible = !down;
    if (gearDown) gearDown.visible = down;
    if (gearLamp) gearLamp.visible = down;
  }

  // The loader leaves the model gear-up. Paint the initial state explicitly
  // rather than relying on that, so the first real call always has something
  // to change and the two variants can never both be visible.
  if (gearUp || gearDown) setGearVisual(false);

  return {
    group,
    setGearVisual,
    gearIsDown: () => gearCache === true,
    loaded: model !== null,
    report,
  };
}
