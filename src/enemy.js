/**
 * Stage 03.0 — the practice target, extended in 03.3 into a flyable airframe.
 *
 * An abstract hostile UCAV. Its scripted racetrack is still here and still what
 * it flies when nothing is happening (Stage 03.3's PATROL state), but heading is
 * no longer the only attitude it has: pitch and speed are entity state, and one
 * integrator turns whatever the caller has set into motion. The Stage 03.3 AI
 * steers by writing those three fields; the scripted path writes the same ones.
 *
 * It publishes { position, velocity, alive }, which is exactly the contract
 * targeting.js and missile.js consume, so nothing above it knows whether a
 * racetrack or a state machine is flying it.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const DEG = Math.PI / 180;

export const ENEMY = {
  // Ahead of the player spawn (0, 700, 0) on the carrier-to-Ireland course,
  // offset laterally so it is visible without being centred, and 60 m above.
  spawn: { x: 165, y: 760, z: -950 },
  spawnHeading: 0, // 0 = flying -Z, the same course as the player
  speed: 148,
  length: 9.2,

  /** Legs are (duration, turn rate). Radius at 148 m/s and 14°/s is ~605 m. */
  path: [
    { name: "straight", t: 6, rate: 0 },
    { name: "arc left", t: 13, rate: 14 * DEG },
    { name: "straight", t: 6, rate: 0 },
    { name: "arc right", t: 13, rate: -14 * DEG },
  ],

  // Visual bank while turning, purely cosmetic.
  bankPerRate: 2.6,

  /**
   * Stage 03.2 — enough health to make cannon fire meaningful and no more
   * (§24). The AIM-9 keeps its near-instant kill by taking the whole pool in
   * one hit, so nothing about missile behaviour changes.
   */
  health: 100,
};

/**
 * Stage 04.8 — the hostile flies a real F-16C.
 *
 * Normalised from MEASURED bounds like every other asset (§2): the loader reads
 * the source bounding box and computes the scale that produces 14.8 m, so a
 * different export of the same aircraft still lands at the right size and no
 * hand-typed factor can go stale.
 *
 * 14.8 m is the F-16C's real length, and it matters that it is shorter than the
 * player's 19.4 m F-15E: a head-on pass reads as a smaller, lighter aeroplane,
 * which is the correct read and comes free from using true figures.
 */
export const HOSTILE_MODEL = {
  url: "assets/f16c/scene.gltf",
  targetLength: 14.8,
  /**
   * Yaw applied to bring the source's nose onto game-forward (-Z).
   *
   * MEASURED, not guessed: with no correction the canopy, pilot and HUD glass
   * sit at z +3.4 and the rudder, engine and airbrakes at z -6.4, so the source
   * points its nose down +Z and needs half a turn. (An early pass had this at
   * PI and the hostile flew tail-first, which from the chase camera reads as a
   * strange-looking aeroplane rather than as an obviously reversed one -- so
   * the check is a node position, not an eyeball.)
   */
  modelYaw: 0,
  /**
   * Wing station for the hostile's rounds, in the normalised airframe. The
   * procedural drone's hardpoint was authored for a 9.2 m flying wing; a 14.8 m
   * F-16 with a ~9.4 m span puts its outer station further out and further
   * forward, and a round leaving the old point would appear to come out of the
   * fuselage.
   */
  hardpoint: { x: 3.4, y: -0.3, z: 0.9 },
};

/**
 * Scale to `targetLength` on the longest axis, recentre the pivot on the
 * bounding box, and yaw the source onto -Z forward.
 *
 * The longest axis IS the length for both fighters here (14.8 m against a 9.4 m
 * span), which is why a single uniform scale is honest rather than a guess. It
 * would NOT be for a delta or a flying wing, so the metrics are logged and the
 * caller can see what was measured.
 */
export function normalizeHostileModel(model, cfg = HOSTILE_MODEL) {
  const root = new THREE.Object3D();
  root.name = "HostileVisual";
  const correction = new THREE.Object3D();
  correction.name = "HostileModelCorrection";
  correction.rotation.y = cfg.modelYaw;
  root.add(correction);
  correction.add(model);

  model.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(model).getSize(size);
  const longest = Math.max(size.x, size.y, size.z);
  const scale = longest > 0 ? cfg.targetLength / longest : 1;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  // Recentre on the bounding box so the airframe rotates about its middle,
  // exactly like the procedural drone it replaces. Without this the model
  // pivots about the source's origin and yaws in a visible arc.
  const center = new THREE.Vector3();
  new THREE.Box3().setFromObject(model).getCenter(center);
  model.position.sub(center);

  const final = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(final);
  return {
    root,
    metrics: {
      sourceSize: size.toArray().map((v) => +v.toFixed(3)),
      scale: +scale.toFixed(5),
      normalizedSize: final.toArray().map((v) => +v.toFixed(2)),
      length: +Math.max(final.x, final.y, final.z).toFixed(2),
      target: cfg.targetLength,
    },
  };
}

/**
 * Loads the F-16C prototype. Resolves with `null` on failure rather than
 * rejecting: §2 requires the game to stay playable with a missing asset, and
 * the procedural flying wing already in the scene is the fallback.
 */
export function loadHostileFighter(cfg = HOSTILE_MODEL) {
  return new Promise((resolve) => {
    new GLTFLoader().load(
      cfg.url,
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            // A 14.8 m airframe closing at a combined 400 m/s crosses a frustum
            // edge inside one frame; per-mesh culling buys nothing here and pops
            // the model during a head-on pass.
            o.frustumCulled = false;
          }
        });
        const { root, metrics } = normalizeHostileModel(gltf.scene, cfg);
        console.log("[hostile] F-16C normalized", metrics);
        resolve({ prototype: root, metrics });
      },
      undefined,
      (err) => {
        console.warn(`[hostile] ${cfg.url} not found — keeping the placeholder UCAV.`, err);
        resolve(null);
      }
    );
  });
}

/**
 * Swaps the procedural visual for the loaded airframe, in place.
 *
 * The drone's ENTITY state is untouched — position, heading, health and the
 * target contract all belong to the drone, not to its mesh. Only the things
 * that are genuinely consequences of the airframe's size move: the visual, the
 * hardpoint and the collision radius.
 */
export function installHostileVisual(drone, prototype, cfg = HOSTILE_MODEL) {
  if (!drone || !prototype) return false;
  drone.root.remove(drone.visual);
  drone.root.add(prototype);
  drone.visual = prototype;
  drone.modelBacked = true;
  drone.hardpoint.position.set(cfg.hardpoint.x, cfg.hardpoint.y, cfg.hardpoint.z);
  // The radius feeds the proximity fuze and the HUD bracket, so it has to be
  // the size of the thing now on screen rather than of the box it replaced.
  drone.radius = cfg.targetLength * 0.5;
  drone.label = "F-16C";
  return true;
}

/** Dark grey-red flying wing, ~9 m span. Read as hostile, not as an F-15. */
function buildDroneVisual() {
  const group = new THREE.Object3D();
  group.name = "TargetVisual";

  const shell = new THREE.MeshStandardMaterial({ color: 0x3a3236, roughness: 0.6, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x8f2b28, roughness: 0.5, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1a1c, roughness: 0.45, metalness: 0.5 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 6.6), shell);
  body.position.z = 0.4;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.6, 10), dark);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4.1;
  group.add(nose);

  // Swept delta wing, built as one extruded blade mirrored across the centreline.
  const blade = new THREE.Shape();
  blade.moveTo(0, -2.2);
  blade.lineTo(4.3, 1.9);
  blade.lineTo(4.3, 2.7);
  blade.lineTo(0, 2.6);
  blade.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.22, bevelEnabled: false });
  for (const s of [1, -1]) {
    const wing = new THREE.Mesh(bladeGeo, accent);
    wing.position.set(s * 0.6, -0.1, 0.9);
    wing.rotation.set(Math.PI / 2, 0, 0);
    wing.scale.set(s, 1, 1);
    group.add(wing);
  }

  for (const s of [1, -1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 1.3), shell);
    fin.position.set(s * 0.85, 0.7, 3.1);
    fin.rotation.z = s * 12 * DEG;
    group.add(fin);
  }

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.7, 12), dark);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.z = 3.9;
  group.add(exhaust);

  return group;
}
/**
 * The target entity. `root` goes in the scene; `position`/`velocity`/`alive`
 * are the gameplay contract.
 */
export function createTargetDrone(cfg = ENEMY) {
  const root = new THREE.Object3D();
  root.name = "TargetDrone";
  // Heading before pitch before bank: with pitch in play, the default XYZ order
  // would tilt the yaw axis and the aircraft would corkscrew as it turned. At
  // pitch 0 the two orders are identical, so the Stage 03.0 racetrack is
  // unchanged frame for frame.
  root.rotation.order = "YXZ";
  const visual = buildDroneVisual();
  root.add(visual);

  /**
   * Stage 03.3 §16 — a missile leaves a wing, not an aircraft's centre. Under
   * the right inboard blade, forward of the wing root: the drone is 9.2 m long
   * with its blades at z 0.8–3.5, so 1.15 m out and 0.45 m down is under skin
   * and clear of the body box.
   */
  const hardpoint = new THREE.Object3D();
  hardpoint.name = "HostileHardpoint";
  hardpoint.position.set(1.15, -0.45, 0.6);
  root.add(hardpoint);

  const drone = {
    root,
    visual,
    hardpoint,
    cfg,
    position: root.position, // aliased: moving the entity moves the transform
    velocity: new THREE.Vector3(),
    heading: cfg.spawnHeading,
    // Stage 03.3: the scripted target flew flat. A pursuing fighter has to be
    // able to climb and dive, so pitch and speed are now entity state that the
    // AI writes and the integrator reads.
    pitch: 0,
    speed: cfg.speed,
    bank: 0,
    targetBank: 0,
    alive: true,
    health: cfg.health,
    maxHealth: cfg.health,
    leg: 0,
    legTime: 0,
    hitAt: -1,
    label: "HOSTILE UCAV",
    radius: cfg.length * 0.5,
  };

  resetTargetDrone(drone);
  return drone;
}

export function resetTargetDrone(drone) {
  const { cfg } = drone;
  drone.position.set(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z);
  drone.heading = cfg.spawnHeading;
  drone.pitch = 0;
  drone.speed = cfg.speed;
  drone.bank = 0;
  drone.targetBank = 0;
  drone.leg = 0;
  drone.legTime = 0;
  drone.alive = true;
  drone.health = cfg.health;
  drone.hitAt = -1;
  drone.root.visible = true;
  drone.root.rotation.set(0, cfg.spawnHeading, 0);
  drone.velocity.set(-Math.sin(cfg.spawnHeading) * cfg.speed, 0, -Math.cos(cfg.spawnHeading) * cfg.speed);
  return drone;
}

/**
 * One integration step from whatever heading/pitch/speed the caller has set:
 * velocity, position, eased bank, transform. The scripted path and the Stage
 * 03.3 AI both steer by writing those three fields and calling this, so there is
 * exactly one place that turns an attitude into motion.
 */
export function integrateDrone(drone, dt) {
  const cp = Math.cos(drone.pitch);
  drone.velocity.set(
    -Math.sin(drone.heading) * cp * drone.speed,
    Math.sin(drone.pitch) * drone.speed,
    -Math.cos(drone.heading) * cp * drone.speed
  );
  drone.position.addScaledVector(drone.velocity, dt);
  // Bank into the turn, eased so leg changes and state changes are not a snap.
  drone.bank += (drone.targetBank - drone.bank) * Math.min(1, dt * 2.2);
  drone.root.rotation.set(drone.pitch, drone.heading, drone.bank);
  return drone;
}

/** One step of the scripted path. Same heading convention as the flight model. */
export function updateTargetDrone(drone, dt) {
  if (!drone.alive) return drone;
  const { cfg } = drone;
  const leg = cfg.path[drone.leg % cfg.path.length];

  drone.legTime += dt;
  if (drone.legTime >= leg.t) {
    drone.legTime -= leg.t;
    drone.leg = (drone.leg + 1) % cfg.path.length;
  }

  drone.heading += leg.rate * dt;
  drone.targetBank = -leg.rate * cfg.bankPerRate;
  return integrateDrone(drone, dt);
}

/** Hit response for Stage 03.0: disable and hide. No debris, no crash arc. */
export function markTargetHit(drone, at = 0) {
  drone.alive = false;
  drone.health = 0;
  drone.hitAt = at;
  drone.root.visible = false;
  drone.velocity.set(0, 0, 0);
  drone.speed = 0;
  return drone;
}

/**
 * Incremental damage (§24). Returns true on the hit that kills, so the caller
 * fires its kill response exactly once — a burst that lands three rounds in one
 * frame must not produce three explosions.
 */
export function damageTarget(drone, amount, at = 0) {
  if (!drone.alive) return false;
  drone.health = Math.max(0, drone.health - amount);
  if (drone.health > 0) return false;
  markTargetHit(drone, at);
  return true;
}
