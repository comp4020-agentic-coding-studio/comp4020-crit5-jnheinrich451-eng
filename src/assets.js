// glTF loading and normalisation. CLAUDE.md §2.
//
// §3 puts normalisation in world.js; it lives here instead because the
// aircraft, the carrier and the terrain all need exactly the same treatment,
// and three copies of a measurement routine is three chances for one of them
// to drift into a hand-typed factor. §3 says the structure is not fixed.
//
// THE RULE: every asset is normalised at load from MEASURED bounds, never
// scaled by a typed constant. A replaced asset then changes nothing
// downstream; a typed factor silently invalidates every tuned number in the
// project at once -- camera standoff, probe offsets, gun range, deck anchors.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

// Assets that failed to load, shown on the developer rail. §2 requires the
// game to stay playable without any of them.
const failures = [];
export const assetFailures = () => [...failures];
export function recordFailure(name, reason) {
  failures.push({ name, reason: String(reason) });
  console.warn(`asset failed: ${name} -- ${reason}`);
}

export function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

// ── orientation ────────────────────────────────────────────────────────────
//
// DO NOT DERIVE THIS FROM THE glTF's RAW ACCESSOR BOUNDS. An earlier version
// read the POSITION accessor min/max out of the JSON, concluded the F-15E was
// Z-up with +X out of the nose, and built a rotation from that. It flew
// knife-edge. The accessors are in each MESH's local space, and every node in
// that file carries a `matrix` -- which a probe printing only `rotation`,
// `scale` and `translation` reports as "no transforms". GLTFLoader applies
// those matrices, so by the time the model is loaded it is already Y-up and
// the correction had been computed against axes that no longer existed.
//
// So: measure the LOADED object, using the model's own landmarks. The nose
// node tells you which way is forward and the landing-gear node tells you
// which way is down, whatever the exporter did on the way out.

export function orientationFromBasis(imageOfX, imageOfY, imageOfZ) {
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...imageOfX),
    new THREE.Vector3(...imageOfY),
    new THREE.Vector3(...imageOfZ),
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// Already Y-up with the nose down -Z: nothing to correct.
export const ORIENT_NONE = new THREE.Quaternion();

const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

// Snap a measured direction to the nearest signed cardinal axis. These assets
// are axis-aligned in their own space; the landmark offsets carry small
// off-axis components that would otherwise tilt the whole aircraft a degree
// or two, which reads as a permanently mistrimmed jet.
function dominantAxis(v) {
  let best = AXES[0];
  let bestDot = -Infinity;
  for (const axis of AXES) {
    const d = v.dot(axis);
    if (d > bestDot) {
      bestDot = d;
      best = axis;
    }
  }
  return best.clone();
}

function centreOf(object) {
  return new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
}

/**
 * Work out the rotation that brings a loaded model into project axes (nose
 * down -Z, up +Y, right +X) by measuring where two named landmark nodes sit
 * relative to the model's centre.
 *
 * Returns ORIENT_NONE if a landmark is missing, so a replaced asset degrades
 * to "unrotated" rather than to "rotated by a stale constant".
 */
export function orientationFromLandmarks(root, { noseNode, downNode }) {
  const nose = noseNode && root.getObjectByName(noseNode);
  const down = downNode && root.getObjectByName(downNode);
  if (!nose || !down) return { quaternion: ORIENT_NONE.clone(), ok: false };

  const centre = centreOf(root);
  const forward = dominantAxis(centreOf(nose).sub(centre).normalize());
  const downDir = dominantAxis(centreOf(down).sub(centre).normalize());
  const up = downDir.clone().negate();

  if (Math.abs(forward.dot(up)) > 0.5) {
    // The two landmarks resolved to the same axis; the model is not laid out
    // the way this expects and a guess here would be worse than none.
    return { quaternion: ORIENT_NONE.clone(), ok: false, forward, up };
  }

  const right = new THREE.Vector3().crossVectors(forward, up);

  // The model's current axes as world directions: local X is `right`, local Y
  // is `up`, local Z is BACKWARD (because forward is -Z in this project).
  // That matrix takes model space to world space, so its inverse is the
  // rotation that brings the model into project axes.
  const source = new THREE.Matrix4().makeBasis(
    right,
    up,
    forward.clone().negate(),
  );
  source.transpose(); // orthonormal, so the transpose is the inverse
  return {
    quaternion: new THREE.Quaternion().setFromRotationMatrix(source),
    ok: true,
    forward,
    up,
    right,
  };
}

// ── normalisation ──────────────────────────────────────────────────────────

/**
 * Rotate an object into project axes, measure it, and scale it so its extent
 * along `axis` equals `targetLength`. Returns the measurements so the caller
 * can log them -- §2 requires the computed result to be logged, because a
 * normalisation that silently produced the wrong scale looks exactly like a
 * camera bug.
 */
export function normalise(object, { targetLength, axis = "z", orientation }) {
  const holder = new THREE.Group();
  if (orientation) object.quaternion.copy(orientation);
  holder.add(object);

  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const sourceLength = size[axis];

  if (!(sourceLength > 0)) {
    return { holder, ok: false, reason: `zero extent on ${axis}` };
  }

  const scale = targetLength / sourceLength;
  object.scale.multiplyScalar(scale);

  // Re-measure after scaling and recentre on the origin, so the caller can
  // position the object by its middle rather than by whatever arbitrary point
  // the exporter happened to leave the pivot at. The F-15's airframe spans
  // -52..142 on its own long axis, so its pivot is nowhere near its centre.
  const scaled = new THREE.Box3().setFromObject(holder);
  const centre = scaled.getCenter(new THREE.Vector3());
  object.position.sub(centre);

  const final = new THREE.Box3().setFromObject(holder);
  return {
    holder,
    ok: true,
    scale,
    sourceLength,
    sourceSize: size.clone(),
    size: final.getSize(new THREE.Vector3()),
    box: final,
  };
}

export function describe(report, name, target) {
  if (!report.ok) return `${name}: NOT normalised (${report.reason})`;
  const s = report.size;
  return (
    `${name}: measured ${report.sourceLength.toFixed(1)} -> ${target} m ` +
    `(scale ${report.scale.toExponential(3)}), ` +
    `now ${s.x.toFixed(1)} x ${s.y.toFixed(1)} x ${s.z.toFixed(1)} m`
  );
}

// Walk a loaded scene and report its node names. Stage 2 needs these to find
// the landing-gear variants, and a hierarchy that changed under a replaced
// asset is otherwise invisible until something stops appearing.
export function hierarchy(root) {
  const names = [];
  root.traverse((node) => {
    if (node.name) names.push(`${node.type}:${node.name}`);
  });
  return names;
}
