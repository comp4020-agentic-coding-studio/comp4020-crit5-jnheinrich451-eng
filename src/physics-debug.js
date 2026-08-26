// Probe visualisation, `P`. CLAUDE.md §3, stage 3.
//
// Built now rather than when a terrain bug is already being chased. Stages 7
// and 8 lean on it constantly, and "is the probe where I think it is" is not a
// question the developer rail's numbers can answer -- five clearances that all
// read 400 m look identical whether the probes are on the wing tips or all
// stacked at the origin.

import * as THREE from "three";

const OK = 0x8ef0c8; // green: instruments, good
const WARN = 0xffd79a; // amber
const DANGER = 0xff9b7a; // salmon

// Clearance below which a probe stops reading as comfortable. Speed-scaled at
// the call site so a 60 m gap at 250 m/s does not paint green.
const WARN_RATIO = 0.9;
const DANGER_RATIO = 0.35;

export function createPhysicsDebug(scene, physics) {
  const group = new THREE.Group();
  group.visible = false;
  group.frustumCulled = false;
  scene.add(group);

  const markerGeom = new THREE.SphereGeometry(0.9, 8, 6);
  const markers = [];
  const dropGeom = new THREE.BufferGeometry();
  const dropPositions = new Float32Array(physics.probes.length * 6);
  dropGeom.setAttribute("position", new THREE.BufferAttribute(dropPositions, 3));
  const drops = new THREE.LineSegments(
    dropGeom,
    new THREE.LineBasicMaterial({ color: OK, transparent: true, opacity: 0.55 }),
  );
  drops.frustumCulled = false;
  group.add(drops);

  for (const _ of physics.probes) {
    const m = new THREE.Mesh(
      markerGeom,
      new THREE.MeshBasicMaterial({ color: OK }),
    );
    m.frustumCulled = false;
    markers.push(m);
    group.add(m);
  }

  // The forward look-ahead ray, which is the input to the PREDICTION half of
  // detection. Seeing where it ends is the difference between "the dodge fired
  // early" and "the ray is pointing somewhere else entirely".
  const rayGeom = new THREE.BufferGeometry();
  const rayPositions = new Float32Array(6);
  rayGeom.setAttribute("position", new THREE.BufferAttribute(rayPositions, 3));
  const ray = new THREE.Line(
    rayGeom,
    new THREE.LineBasicMaterial({ color: WARN }),
  );
  ray.frustumCulled = false;
  group.add(ray);

  return {
    group,
    toggle() {
      group.visible = !group.visible;
      return group.visible;
    },
    setVisible(v) {
      group.visible = v;
    },
    visible: () => group.visible,

    update(state) {
      if (!group.visible) return;
      const warnAt = state.speed * WARN_RATIO;
      const dangerAt = state.speed * DANGER_RATIO;

      physics.probes.forEach((p, i) => {
        markers[i].position.set(p.world.x, p.world.y, p.world.z);
        const colour =
          p.clearance < dangerAt ? DANGER : p.clearance < warnAt ? WARN : OK;
        markers[i].material.color.setHex(colour);

        // A vertical drop line to the surface under each probe: the clearance
        // number and the gap you can see then have to agree.
        const o = i * 6;
        dropPositions[o] = p.world.x;
        dropPositions[o + 1] = p.world.y;
        dropPositions[o + 2] = p.world.z;
        dropPositions[o + 3] = p.world.x;
        dropPositions[o + 4] = p.ground;
        dropPositions[o + 5] = p.world.z;
      });
      dropGeom.attributes.position.needsUpdate = true;

      const hazard = physics.telemetry.forwardHazard;
      const reach = Number.isFinite(hazard) ? hazard : state.speed * 2.2;
      const q = state.quat;
      // forward = quat * (0,0,-1), inlined to avoid an allocation per frame.
      const tx = 2 * (q.y * -1 - 0);
      const ty = 2 * (0 - q.x * -1);
      const fx = q.w * tx + (q.y * 0 - q.z * ty);
      const fy = q.w * ty + (q.z * tx - 0);
      const fz = -1 + (q.x * ty - q.y * tx);
      const n = Math.hypot(fx, fy, fz) || 1;
      rayPositions[0] = state.position.x;
      rayPositions[1] = state.position.y;
      rayPositions[2] = state.position.z;
      rayPositions[3] = state.position.x + (fx / n) * reach;
      rayPositions[4] = state.position.y + (fy / n) * reach;
      rayPositions[5] = state.position.z + (fz / n) * reach;
      rayGeom.attributes.position.needsUpdate = true;
      ray.material.color.setHex(
        physics.telemetry.forwardImminent ? DANGER : WARN,
      );
    },
  };
}
