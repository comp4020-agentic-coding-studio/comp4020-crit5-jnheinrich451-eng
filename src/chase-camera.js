import * as THREE from "three";

/** Racing-game third-person chase camera: behind, above, world-up, damped. */
export const CHASE = {
  distance: 24, // cruise standoff; see targetDistance()
  height: 6.5,
  lookAhead: 28, // horizontal lead only — vertical framing comes from framingY
  forwardDamping: 3.0, // how fast the rig swings around behind a turn
  aimDamping: 5.0,

  // Where the aircraft sits vertically in frame, in normalized screen units:
  // 0 is dead centre, -1 the bottom edge, +1 the top. The aim axis is solved
  // for this every frame, so it holds at ANY field of view — which is the whole
  // point. Aiming at a fixed point ahead of the aircraft instead (the obvious
  // way) leaves the aircraft's ANGLE off-axis fixed, so its screen position is
  // angle/fov: widening the lens then slides the aircraft toward centre and
  // squeezes the headroom above it. -0.18 keeps a little sky above the nose.
  framingY: -0.18,

  // Speed -> FOV, now driven by actual airspeed. Anchored so 170 m/s lands on
  // ~66°, the Stage 01.5 composition: the change should read at the ends of the
  // envelope, not as a camera that moved.
  minSpeed: 110,
  maxSpeed: 250,
  minFov: 60,
  maxFov: 75,
  fovDamping: 3.0,

  // Very subtle speed standoff, also anchored on cruise: 110 -> 22.5 m,
  // 170 -> 24 m (unchanged), 250 -> 26 m. The aircraft stays the hero.
  minDistance: 22.5,
  maxDistance: 26,

  // 0.00 world-stabilised, 0.10 / 0.15 experimental. Never matches the
  // aircraft: chase mode wants a mostly stable horizon.
  rollInfluence: 0.0,
  rollDamping: 4.0,

  // EXPERT only. 1.0 = the rig is bolted to the tail: camera up IS aircraft up,
  // so rolling rolls the world and inverted flight puts the sea overhead. This
  // is deliberately the GoPro read that Stage 01.7 first avoided — dial it back
  // toward 0.3 for a horizon-stabilised chase instead.
  expertUpInfluence: 1.0,
  // Floor on the influence near vertical. With expertUpInfluence at 1.0 this is
  // a no-op; it only matters if the value above is lowered, where a mostly
  // world-up vector goes parallel to the view direction and lookAt() degenerates.
  expertUpVerticalStart: 0.6,
  expertUpVerticalFull: 0.97,
  expertUpDamping: 7.0,
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Stage 04.0 §11/§12 — a temporary alternative composition, blended in rather
 * than switched to. The rig itself is untouched: `blend` weights an override
 * over the speed-driven standoff, height, framing and FOV, so the carrier launch
 * can borrow a closer, lower, laggier camera and then hand it back without a cut
 * (and without a second camera rig that would have to be kept in sync).
 */
const view = { blend: 0, distance: 0, height: 0, framingY: 0, lagScale: 1, fov: 0, fovWeight: 0 };

/**
 * @param blend  0 = the standard chase camera, 1 = fully the supplied composition
 * @param over   { distance, height, framingY, lagScale } — any subset
 * @param fov    optional FOV target that overrides the speed curve while blended
 */
export function setChaseView(blend, over = null, fov = null) {
  view.blend = THREE.MathUtils.clamp(blend, 0, 1);
  if (over) {
    if (over.distance !== undefined) view.distance = over.distance;
    if (over.height !== undefined) view.height = over.height;
    if (over.framingY !== undefined) view.framingY = over.framingY;
    view.lagScale = over.lagScale === undefined ? 1 : over.lagScale;
  }
  view.fov = fov === null ? 0 : fov;
  view.fovWeight = fov === null ? 0 : view.blend;
  return view;
}

export function chaseView() {
  return view;
}

export function createChaseCamera(aspect) {
  // Far plane covers the 100 km ocean's visible span past the sky shell; near
  // stays tight for the 19 m airframe at a 24 m standoff. Depth precision over
  // that range comes from the renderer's logarithmic depth buffer.
  const camera = new THREE.PerspectiveCamera(CHASE.minFov, aspect, 0.5, 120000);
  camera.up.copy(WORLD_UP);
  return camera;
}

const forward = new THREE.Vector3();
const smoothedForward = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const smoothedTarget = new THREE.Vector3();
const up = new THREE.Vector3();
const aircraftUp = new THREE.Vector3();
const targetUp = new THREE.Vector3();
const smoothedUp = new THREE.Vector3(0, 1, 0);
const toAircraft = new THREE.Vector3();
const aimHoriz = new THREE.Vector3();
const viewAxis = new THREE.Vector3();
let smoothedRoll = 0;
let initialised = false;

const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

const speedT = (speed) =>
  THREE.MathUtils.clamp((speed - CHASE.minSpeed) / (CHASE.maxSpeed - CHASE.minSpeed), 0, 1);

export function targetFov(speed) {
  return THREE.MathUtils.lerp(CHASE.minFov, CHASE.maxFov, speedT(speed));
}

/** The FOV the rig should be heading toward, launch override included. */
export function blendedFov(speed) {
  const base = targetFov(speed);
  return view.fovWeight > 0 ? THREE.MathUtils.lerp(base, view.fov, view.fovWeight) : base;
}

export function targetDistance(speed) {
  return THREE.MathUtils.lerp(CHASE.minDistance, CHASE.maxDistance, speedT(speed));
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Angle to tilt the view axis off the aircraft direction so the aircraft lands
 * at `screenY`. Perspective projection puts a point at screen y =
 * tan(angle)/tan(fov/2), so inverting that makes the framing FOV-invariant:
 * widen the lens and the extra field of view is added around the aircraft
 * rather than sliding it across frame.
 */
export function framingTilt(screenY, fovDeg) {
  return Math.atan(-screenY * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
}

/**
 * Aircraft-up influence for a given view direction. Flat at expertUpInfluence
 * across normal attitudes, ramping to 1 only inside the vertical cone where a
 * world-up camera has no valid orientation left.
 */
export function expertUpInfluence(forwardY) {
  const v = Math.abs(forwardY);
  const t = THREE.MathUtils.clamp(
    (v - CHASE.expertUpVerticalStart) /
      (CHASE.expertUpVerticalFull - CHASE.expertUpVerticalStart),
    0,
    1
  );
  return THREE.MathUtils.lerp(CHASE.expertUpInfluence, 1, smoothstep(t));
}

/**
 * The lag lives in the rig's *direction*, not in its position.
 *
 * Damping the camera position toward a target that translates at 170 m/s
 * settles at a steady-state error of speed/lambda — 42 m of extra standoff
 * that also drifts with any speed change. Instead the camera sits rigidly at
 * distance/height behind a damped forward axis: standoff stays exact at any
 * speed, while turns still show the camera swinging in behind the aircraft.
 */
export function updateChaseCamera(camera, aircraftRoot, flightState, dt) {
  const expert = flightState.mode === "EXPERT";
  forward.set(0, 0, -1).applyQuaternion(aircraftRoot.quaternion).normalize();

  // Expert: the rig's own up axis is the aircraft's, so the standoff, the look
  // target and the view all tilt together and the camera stays behind the tail
  // through a roll. Assisted keeps world up exactly — untouched.
  if (expert) {
    aircraftUp.set(0, 1, 0).applyQuaternion(aircraftRoot.quaternion).normalize();
    targetUp.set(0, 1, 0).lerp(aircraftUp, expertUpInfluence(forward.y)).normalize();
  } else {
    targetUp.copy(WORLD_UP);
  }

  // Suppressed during a maneuver: bank sweeps through 360°, which at 10%
  // influence would lurch the camera 36° and hide the roll it exists to show.
  // Expert has no separate roll term — the up vector above already carries it.
  const rollTarget =
    expert || flightState.maneuver ? 0 : flightState.bank * CHASE.rollInfluence;

  if (!initialised) {
    smoothedForward.copy(forward);
    smoothedUp.copy(targetUp);
    smoothedRoll = rollTarget;
    camera.fov = blendedFov(flightState.speed);
    camera.updateProjectionMatrix();
  } else {
    // Forward damping is scaled by the active composition: a lower lagScale is
    // what makes the camera fall behind on the catapult stroke (§11).
    const lag = CHASE.forwardDamping * THREE.MathUtils.lerp(1, view.lagScale, view.blend);
    smoothedForward.lerp(forward, 1 - Math.exp(-lag * dt)).normalize();
    smoothedUp.lerp(targetUp, 1 - Math.exp(-CHASE.expertUpDamping * dt)).normalize();
    smoothedRoll = damp(smoothedRoll, rollTarget, CHASE.rollDamping, dt);

    const fov = damp(camera.fov, blendedFov(flightState.speed), CHASE.fovDamping, dt);
    if (Math.abs(fov - camera.fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  // Aim: horizontal lead comes from the damped forward axis, vertical framing
  // is solved. Only the azimuth of this target is used.
  lookTarget.copy(aircraftRoot.position).addScaledVector(forward, CHASE.lookAhead);

  if (!initialised) {
    smoothedTarget.copy(lookTarget);
    initialised = true;
  } else {
    smoothedTarget.lerp(lookTarget, 1 - Math.exp(-CHASE.aimDamping * dt));
  }

  // Speed is already inertial, so the standoff needs no damping of its own.
  CHASE.distance = THREE.MathUtils.lerp(targetDistance(flightState.speed), view.distance, view.blend);
  const height = THREE.MathUtils.lerp(CHASE.height, view.height, view.blend);
  const framingY = THREE.MathUtils.lerp(CHASE.framingY, view.framingY, view.blend);

  camera.position
    .copy(aircraftRoot.position)
    .addScaledVector(smoothedForward, -CHASE.distance)
    .addScaledVector(smoothedUp, height);

  up.copy(smoothedUp);
  if (smoothedRoll !== 0) up.applyAxisAngle(smoothedForward, smoothedRoll);
  camera.up.copy(up);

  // Solve the aim axis: take the aircraft's elevation relative to the rig's up
  // axis, add the framing tilt, and rebuild the axis on the damped target's
  // azimuth. Horizontal lead survives (the aircraft still slides sideways out
  // of a turn); vertical position is pinned at framingY for every FOV.
  toAircraft.copy(aircraftRoot.position).sub(camera.position);
  const range = toAircraft.length() || 1;
  toAircraft.divideScalar(range);

  aimHoriz.copy(smoothedTarget).sub(camera.position);
  aimHoriz.addScaledVector(up, -aimHoriz.dot(up));
  // Degenerate only if the aim is exactly along up; fall back to the tail axis.
  if (aimHoriz.lengthSq() < 1e-8) {
    aimHoriz.copy(smoothedForward).addScaledVector(up, -smoothedForward.dot(up));
  }
  aimHoriz.normalize();

  const elevation =
    Math.asin(THREE.MathUtils.clamp(toAircraft.dot(up), -1, 1)) +
    framingTilt(framingY, camera.fov);
  viewAxis
    .copy(aimHoriz)
    .multiplyScalar(Math.cos(elevation))
    .addScaledVector(up, Math.sin(elevation));

  camera.lookAt(viewAxis.multiplyScalar(range).add(camera.position));
}

export function snapChaseCamera() {
  initialised = false;
}
