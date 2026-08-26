// The one camera rig. CLAUDE.md §16 (camera), stage 1.
//
// Alternative compositions are BLENDED IN, never switched to. Stages 4, 7 and
// 9 each add one (LAUNCH_VIEW, CRASH_VIEW, RECOVERY_VIEW); a second camera
// object would have to be kept in sync with this one and would produce a cut
// every time it took over.

import * as THREE from "three";
import { SPEED_MAX, SPEED_MIN, quatForward, quatUp } from "./flight.js";

// The standard chase composition. standoff and fov are speed-scaled between
// these pairs; a composition layer may override either with a fixed number.
const STANDOFF_SLOW = 22.5;
const STANDOFF_FAST = 26;
const FOV_SLOW = 59;
const FOV_FAST = 71;

export const STANDARD = {
  height: 6.5,
  framingY: -0.18,
  lagScale: 1,
};

// Damping rates, per second. Forward, up and roll are damped SEPARATELY: a
// single damped basis makes the rig swim in rolls, because the up-vector then
// lags the same amount as the direction of travel.
const FORWARD_DAMP = 3.4;
const UP_DAMP = 2.6;
const ROLL_DAMP = 2.2;

// How much of the aircraft's bank the camera inherits. The `1 2 3` developer
// keys move this at runtime (§7).
const DEFAULT_ROLL_INFLUENCE = 0.35;

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const lerp = (a, b, t) => a + (b - a) * t;

export function createChaseCamera(camera) {
  const smoothFwd = new THREE.Vector3(0, 0, -1);
  const smoothUp = new THREE.Vector3(0, 1, 0);
  let smoothRoll = 0;
  let rollInfluence = DEFAULT_ROLL_INFLUENCE;

  // ONE shake channel. §16: cannon fire, deck shimmer, catapult vibration,
  // missile impact and the crash kick all add into this single offset, which
  // is subtracted at the start of a frame and re-added at the end so the
  // damping above always works on the clean position. A second offset means
  // the rig fights itself, and the fight is invisible until it is violent.
  const shake = new THREE.Vector3();
  let shakeAmount = 0;
  let shakeDecay = 6;

  // Named blend layers, each {composition, weight}. Weight 0 = absent.
  const layers = new Map();

  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const clean = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function readState(state) {
    const f = quatForward(state.quat);
    const u = quatUp(state.quat);
    fwd.set(f.x, f.y, f.z).normalize();
    up.set(u.x, u.y, u.z).normalize();
  }

  // Resolve STANDARD plus every active layer into one composition. Layers are
  // applied in insertion order, each lerping the running result toward itself
  // by its own weight, so a half-weight layer is genuinely half-applied
  // rather than winning outright.
  function composition(speed) {
    const t = THREE.MathUtils.clamp(
      (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN),
      0,
      1,
    );
    let standoff = lerp(STANDOFF_SLOW, STANDOFF_FAST, t);
    let fov = lerp(FOV_SLOW, FOV_FAST, t);
    let height = STANDARD.height;
    let framingY = STANDARD.framingY;
    let lagScale = STANDARD.lagScale;

    for (const { composition: c, weight } of layers.values()) {
      if (!(weight > 0)) continue;
      const w = Math.min(weight, 1);
      if (c.standoff !== undefined) standoff = lerp(standoff, c.standoff, w);
      if (c.fov !== undefined) fov = lerp(fov, c.fov, w);
      if (c.height !== undefined) height = lerp(height, c.height, w);
      if (c.framingY !== undefined) framingY = lerp(framingY, c.framingY, w);
      if (c.lagScale !== undefined) lagScale = lerp(lagScale, c.lagScale, w);
    }
    return { standoff, fov, height, framingY, lagScale };
  }

  function update(dt, state) {
    // Remove last frame's shake before anything reads the position, so the
    // damping below never chases its own vibration.
    camera.position.sub(shake);

    readState(state);
    const c = composition(state.speed);

    // lagScale multiplies the FORWARD damping only -- that is how a
    // composition gets its lag (stage 4's catapult, stage 7's crash).
    smoothFwd.lerp(fwd, damp(FORWARD_DAMP * c.lagScale, dt)).normalize();
    smoothUp.lerp(up, damp(UP_DAMP, dt)).normalize();

    const rollTarget = state.bank * rollInfluence;
    smoothRoll += (rollTarget - smoothRoll) * damp(ROLL_DAMP, dt);

    // Behind along the damped forward, above along world-up. World-up keeps
    // the horizon level in ASSISTED; stage 2 leans this toward the aircraft's
    // own up-vector so inverted flight in EXPERT stays readable.
    clean
      .copy(state.position)
      .addScaledVector(smoothFwd, -c.standoff)
      .add(tmp.set(0, c.height, 0));

    // framingY offsets the look target down by a fraction of the standoff, so
    // the aircraft sits a little high in frame and the ground ahead is
    // visible. Scaling by standoff keeps the framing constant as the rig
    // pulls back.
    lookAt
      .copy(state.position)
      .add(tmp.set(0, c.framingY * c.standoff, 0));

    camera.position.copy(clean);
    camera.up.set(0, 1, 0).applyAxisAngle(smoothFwd, smoothRoll);
    camera.lookAt(lookAt);

    if (camera.fov !== c.fov) {
      camera.fov = c.fov;
      camera.updateProjectionMatrix();
    }

    // Decay, then re-apply. Randomised per frame is correct here -- this is
    // vibration, not a crash tumble, which §15 requires to be latched once.
    shakeAmount *= Math.exp(-shakeDecay * dt);
    if (shakeAmount < 1e-4) shakeAmount = 0;
    shake.set(
      (Math.random() - 0.5) * 2 * shakeAmount,
      (Math.random() - 0.5) * 2 * shakeAmount,
      (Math.random() - 0.5) * 2 * shakeAmount,
    );
    camera.position.add(shake);
  }

  return {
    update,

    // Snap the rig to the aircraft with no damping. Used on a respawn or a
    // mode change, where easing in from the old pose would read as a glide.
    reset(state) {
      readState(state);
      smoothFwd.copy(fwd);
      smoothUp.copy(up);
      smoothRoll = state.bank * rollInfluence;
      shake.set(0, 0, 0);
      shakeAmount = 0;
      update(1 / 60, state);
    },

    // Add a named blend layer, or update its weight. Weight 0 leaves it
    // registered but inert, which is what lets a stage fade one out.
    blend(name, composition, weight) {
      if (!(weight > 0)) {
        layers.delete(name);
        return;
      }
      layers.set(name, { composition, weight });
    },
    layerWeight: (name) => layers.get(name)?.weight ?? 0,

    // The single shake channel. Everything that shakes calls this.
    addShake(amount, decay) {
      shakeAmount = Math.max(shakeAmount, amount);
      if (decay !== undefined) shakeDecay = decay;
    },
    setShake(amount) {
      shakeAmount = amount;
    },
    shakeLevel: () => shakeAmount,

    setRollInfluence(v) {
      rollInfluence = v;
    },
    rollInfluence: () => rollInfluence,
    composition,
  };
}
