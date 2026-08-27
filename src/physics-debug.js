import * as THREE from "three";

/**
 * Development-only visualization for Stage 02.2. Deliberately crude: spheres,
 * lines and axes. None of this is part of the visual design, and nothing in the
 * physics path reads it — deleting this file must leave contact behaviour
 * identical.
 *
 * depthTest is off throughout so probes stay visible through the airframe.
 */
const basic = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false, fog: false });
const lineMat = (color, opacity = 1) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, fog: false });

const PROBE_COLORS = {
  center: 0x9fd7ff,
  nose: 0xffd79a,
  tail: 0xffd79a,
  leftWing: 0x9fe6b0,
  rightWing: 0x9fe6b0,
};

/** Probe markers, their down-rays, ground hits and the forward look-ahead ray. */
export function createPhysicsDebug(scene, probes) {
  const group = new THREE.Object3D();
  group.name = "PhysicsDebug";
  group.visible = false;
  group.renderOrder = 999;

  const markers = probes.map((p) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), basic(PROBE_COLORS[p.name] || 0xffffff));
    m.name = `Probe_${p.name}`;
    group.add(m);
    return m;
  });

  const hits = probes.map((p) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), basic(PROBE_COLORS[p.name] || 0xffffff, 0.75));
    m.name = `Hit_${p.name}`;
    group.add(m);
    return m;
  });

  // One LineSegments for all five down-rays: two vertices per probe.
  const downGeo = new THREE.BufferGeometry();
  const downPos = new Float32Array(probes.length * 6);
  downGeo.setAttribute("position", new THREE.BufferAttribute(downPos, 3));
  const downLines = new THREE.LineSegments(downGeo, lineMat(0x9fd7ff, 0.55));
  downLines.name = "DownRays";
  group.add(downLines);

  // Wing-to-wing and nose-to-tail cross, so the probe cage reads as a shape.
  const crossGeo = new THREE.BufferGeometry();
  const crossPos = new Float32Array(12);
  crossGeo.setAttribute("position", new THREE.BufferAttribute(crossPos, 3));
  const cross = new THREE.LineSegments(crossGeo, lineMat(0xe8f0f6, 0.4));
  cross.name = "ProbeCage";
  group.add(cross);

  const fwdGeo = new THREE.BufferGeometry();
  const fwdPos = new Float32Array(6);
  fwdGeo.setAttribute("position", new THREE.BufferAttribute(fwdPos, 3));
  const fwdMaterial = lineMat(0x8fe1a0, 0.9);
  const fwdLine = new THREE.Line(fwdGeo, fwdMaterial);
  fwdLine.name = "ForwardRay";
  group.add(fwdLine);

  const fwdHit = new THREE.Mesh(new THREE.OctahedronGeometry(3.4), basic(0xff7a5a, 0.9));
  fwdHit.name = "ForwardHit";
  fwdHit.visible = false;
  group.add(fwdHit);

  scene.add(group);

  const forward = new THREE.Vector3();
  const end = new THREE.Vector3();

  /** Called every frame while visible; reads physics state, writes nothing. */
  function update(state, aircraftRoot) {
    if (!group.visible) return;
    const byName = {};
    state.probes.forEach((p, i) => {
      byName[p.name] = p;
      markers[i].position.copy(p.world);
      hits[i].visible = p.clearance < 4000;
      hits[i].position.copy(p.hitPoint);
      const o = i * 6;
      downPos[o] = p.world.x;
      downPos[o + 1] = p.world.y;
      downPos[o + 2] = p.world.z;
      downPos[o + 3] = p.hitPoint.x;
      downPos[o + 4] = Math.max(p.hitPoint.y, p.world.y - 4000);
      downPos[o + 5] = p.hitPoint.z;
    });
    downGeo.attributes.position.needsUpdate = true;

    const seg = [byName.leftWing, byName.rightWing, byName.nose, byName.tail];
    seg.forEach((p, i) => {
      if (!p) return;
      crossPos[i * 3] = p.world.x;
      crossPos[i * 3 + 1] = p.world.y;
      crossPos[i * 3 + 2] = p.world.z;
    });
    crossGeo.attributes.position.needsUpdate = true;

    forward.set(0, 0, -1).applyQuaternion(aircraftRoot.quaternion).normalize();
    const nose = byName.nose ? byName.nose.world : aircraftRoot.position;
    end.copy(nose).addScaledVector(forward, state.lookAhead);
    fwdPos[0] = nose.x;
    fwdPos[1] = nose.y;
    fwdPos[2] = nose.z;
    fwdPos[3] = end.x;
    fwdPos[4] = end.y;
    fwdPos[5] = end.z;
    fwdGeo.attributes.position.needsUpdate = true;

    fwdMaterial.color.setHex(state.forwardImminent ? 0xff7a5a : state.forwardHazard ? 0xffd79a : 0x8fe1a0);
    fwdHit.visible = !!state.forwardHit;
    if (state.forwardHit) fwdHit.position.copy(state.forwardHit.point);
  }

  return {
    group,
    update,
    toggle() {
      group.visible = !group.visible;
      return group.visible;
    },
    get visible() {
      return group.visible;
    },
  };
}

const ANCHOR_COLORS = {
  DeckReference: 0x9fd7ff,
  LaunchStart: 0x9fe6b0,
  LaunchEnd: 0xffd79a,
  ApproachReference: 0xe0a6ff,
};

/**
 * Carrier anchor helpers, parented to the anchors themselves — so they show the
 * real transforms rather than a copy of them, yaw included.
 */
export function createCarrierAnchorDebug(anchors) {
  const shown = [anchors.deck, anchors.launchStart, anchors.launchEnd, anchors.approach];
  for (const a of shown) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 10), basic(ANCHOR_COLORS[a.name] || 0xffffff));
    dot.name = `${a.name}_Marker`;
    const axes = new THREE.AxesHelper(a === anchors.approach ? 120 : 40);
    axes.material.depthTest = false;
    axes.material.fog = false;
    a.add(dot, axes);
  }

  // Launch path, drawn in the References container's local space.
  const geo = new THREE.BufferGeometry().setFromPoints([
    anchors.launchStart.position.clone(),
    anchors.launchEnd.position.clone(),
  ]);
  const path = new THREE.Line(geo, lineMat(0x9fe6b0, 0.95));
  path.name = "LaunchPath";
  anchors.container.add(path);

  anchors.container.visible = false;
  anchors.container.renderOrder = 999;

  return {
    group: anchors.container,
    toggle() {
      anchors.container.visible = !anchors.container.visible;
      return anchors.container.visible;
    },
    get visible() {
      return anchors.container.visible;
    },
  };
}
