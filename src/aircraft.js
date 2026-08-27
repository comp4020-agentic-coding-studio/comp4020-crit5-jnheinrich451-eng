import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const TARGET_LENGTH = 19.4; // F-15E is 19.43 m nose to tail
// Default is the local asset. ?model=<url> overrides it, so the same build can
// load the glTF from a remote host (e.g. raw.githubusercontent.com) while
// scene.bin cannot be uploaded here — relative .bin/texture paths resolve
// against whatever base the URL has.
const F15_URL =
  new URLSearchParams(location.search).get("model") || "assets/f15/scene.gltf";

/**
 * AircraftRoot
 *  |- ModelCorrection -> F15Visual
 *  |- CameraTarget
 *  |- ColliderRoot
 * Gameplay transforms live on AircraftRoot only. Game space: +Y up, -Z forward.
 */
export function createAircraftHierarchy() {
  const aircraftRoot = new THREE.Object3D();
  aircraftRoot.name = "AircraftRoot";

  const modelCorrection = new THREE.Object3D();
  modelCorrection.name = "ModelCorrection";

  const cameraTarget = new THREE.Object3D();
  cameraTarget.name = "CameraTarget";

  const colliderRoot = new THREE.Object3D();
  colliderRoot.name = "ColliderRoot";

  aircraftRoot.add(modelCorrection, cameraTarget, colliderRoot);
  return { aircraftRoot, modelCorrection, cameraTarget, colliderRoot };
}

/** Uniform scale to TARGET_LENGTH, then recentre the pivot on the bounding box. */
export function normalizeModel(model, targetLength = TARGET_LENGTH) {
  model.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(model).getSize(size);

  const longest = Math.max(size.x, size.y, size.z);
  const scale = targetLength / longest;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const center = new THREE.Vector3();
  new THREE.Box3().setFromObject(model).getCenter(center);
  model.position.sub(center);

  return { scale, size, center };
}

export const GEAR_NODES = { up: "F-15E-landingOff_5", down: "F-15E-landingOn_6", lamp: "F-15E-landingOnLight_7" };

/**
 * Stage 04.0 §7 — the gear switch, as a visibility swap between the two
 * discrete variants the asset already ships. There is no animation and there
 * will not be one: the transition is hidden inside the rotation off the deck,
 * the afterburner flash and a camera that is moving hard at that instant. An
 * intentional cheat, and the cheapest believable one available.
 *
 * @param down true for the deck/launch configuration, false for clean flight
 */
export function setGearVisual(aircraft, down) {
  if (!aircraft) return null;
  const report = {};
  for (const [role, name] of Object.entries(GEAR_NODES)) {
    const node = aircraft.getObjectByName(name);
    report[name] = node ? "found" : "missing";
    if (!node) continue;
    node.visible = down ? role !== "up" : role === "up";
  }
  return report;
}

/**
 * Gear retracted for the flight lab. The three landing* nodes are toggled by
 * visibility only — no gear animation in Stage 01.
 */
export function setGearForFlight(aircraft) {
  return setGearVisual(aircraft, false);
}

function logHierarchy(gltf) {
  const rows = [];
  gltf.scene.traverse((o) => rows.push(`${o.name || "(unnamed)"}  ${o.type}`));
  console.log("[F-15] hierarchy\n" + rows.join("\n"));
  console.log("[F-15] animations:", gltf.animations.map((c) => c.name));
}

/**
 * Loads assets/f15/scene.gltf into ModelCorrection. If the asset has not been
 * dropped in yet, a scale-correct placeholder airframe is used instead so the
 * flight model stays testable. Swapping in the real glTF needs no code change.
 */
export function loadF15(modelCorrection) {
  return new Promise((resolve) => {
    new GLTFLoader().load(
      F15_URL,
      (gltf) => {
        logHierarchy(gltf);
        const visual = gltf.scene;
        visual.name = "F15Visual";
        visual.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.frustumCulled = false;
          }
        });
        const metrics = normalizeModel(visual);

        // Source model correction lives here and nowhere else.
        //
        // This Sketchfab asset is 194 units long along its +X axis with the
        // nose at +X (canopy 68..109, HUD at 101) and the wings spanning Z.
        // Its up axis already lands on +Y once the Sketchfab wrapper matrices
        // are applied, so a single +90° yaw maps nose -> game forward (0,0,-1).
        modelCorrection.rotation.set(0, Math.PI / 2, 0);
        modelCorrection.position.set(0, 0, 0);

        modelCorrection.add(visual);
        const gear = setGearForFlight(visual);
        resolve({ visual, placeholder: false, metrics, gear });
      },
      undefined,
      () => {
        const visual = buildPlaceholderAirframe();
        modelCorrection.add(visual);
        console.warn(
          `[F-15] ${F15_URL} not found — using placeholder airframe. ` +
            "Drop scene.gltf, scene.bin and textures/ into assets-src/f15/ and run `pnpm assets`."
        );
        resolve({ visual, placeholder: true, metrics: null, gear: null });
      }
    );
  });
}

/** Blocked-out F-15-proportioned massing: 19.4 m long, 13 m span, -Z forward. */
function buildPlaceholderAirframe() {
  const group = new THREE.Object3D();
  group.name = "F15Visual";

  const shell = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3c4249, roughness: 0.7, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2b38, roughness: 0.15, metalness: 0.6 });

  const add = (name, geo, mat, pos, rot, scale) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    group.add(m);
    return m;
  };

  add("fuselage", new THREE.BoxGeometry(1.9, 1.7, 12.5), shell, [0, 0, 0.6]);
  add("nose", new THREE.ConeGeometry(0.95, 5.2, 12), shell, [0, 0.05, -8.2], [-Math.PI / 2, 0, 0]);
  add("canopy", new THREE.SphereGeometry(0.85, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, [0, 0.8, -4.4], [0, 0, 0], [1, 0.7, 3.1]);

  // Wings: swept trapezoid, 13 m total span.
  const wing = new THREE.Shape();
  wing.moveTo(0, -3.4);
  wing.lineTo(5.4, 2.0);
  wing.lineTo(5.4, 3.3);
  wing.lineTo(0, 3.6);
  wing.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 0.28, bevelEnabled: false });
  add("wingRight", wingGeo, shell, [0.85, -0.15, 1.0], [Math.PI / 2, 0, 0]);
  add("wingLeft", wingGeo, shell, [-0.85, -0.15, 1.0], [Math.PI / 2, 0, 0], [-1, 1, 1]);

  // Twin vertical stabilisers + horizontal tails.
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(2.6, 0);
  fin.lineTo(3.4, 3.5);
  fin.lineTo(2.1, 3.5);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.18, bevelEnabled: false });
  add("finRight", finGeo, shell, [1.15, 0.7, 3.4], [0, Math.PI / 2, 0]);
  add("finLeft", finGeo, shell, [-1.33, 0.7, 3.4], [0, Math.PI / 2, 0]);

  const tail = new THREE.Shape();
  tail.moveTo(0, -1.9);
  tail.lineTo(3.0, 0.4);
  tail.lineTo(3.0, 1.2);
  tail.lineTo(0, 1.6);
  tail.closePath();
  const tailGeo = new THREE.ExtrudeGeometry(tail, { depth: 0.2, bevelEnabled: false });
  add("stabRight", tailGeo, shell, [1.0, 0.05, 5.7], [Math.PI / 2, 0, 0]);
  add("stabLeft", tailGeo, shell, [-1.0, 0.05, 5.7], [Math.PI / 2, 0, 0], [-1, 1, 1]);

  // Engine nacelles and exhausts.
  for (const s of [-1, 1]) {
    add(`nacelle${s > 0 ? "Right" : "Left"}`, new THREE.BoxGeometry(1.15, 1.4, 8.2), dark, [s * 1.25, -0.1, 2.4]);
    add(
      `exhaust${s > 0 ? "Right" : "Left"}`,
      new THREE.CylinderGeometry(0.6, 0.68, 1.0, 16, 1, true),
      dark,
      [s * 1.25, -0.1, 6.9],
      [Math.PI / 2, 0, 0]
    );
    add(`intake${s > 0 ? "Right" : "Left"}`, new THREE.BoxGeometry(1.0, 1.15, 1.2), dark, [s * 1.3, 0.1, -2.4]);
  }

  normalizeModel(group);
  return group;
}
