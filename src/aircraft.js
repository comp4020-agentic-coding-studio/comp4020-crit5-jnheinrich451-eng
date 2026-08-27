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
import { createEngineFx } from "./engine-fx.js";

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

// ── the nozzles ────────────────────────────────────────────────────────────

// The rearmost slice of the airframe to look in, as a fraction of its length.
const REAR_SLICE = 0.05;
const NOZZLE_BIN = 0.25; // m, the lateral histogram's bin width
// Authored only as the asset-failure fallback (§2), and recorded as a failure
// when it is used.
const FALLBACK_NOZZLES = [
  { x: -1.6, y: -0.6, z: 9.1 },
  { x: 1.6, y: -0.6, z: 9.1 },
];

/**
 * MEASURE the exhaust nozzles from the airframe's own geometry.
 *
 * Every anchor in this project is measured rather than typed (§2), and this one
 * cannot simply be "the rearmost point": on an F-15 the stabilator trailing
 * edges are the rearmost thing on the model, at |x| ~ 4.0, and a centroid of
 * the last two per cent of the airframe lands on THEM rather than on the
 * nozzles at |x| ~ 1.6. A plume drawn there hangs off the tailplanes.
 *
 * So the rule is DENSITY, not extremity: a tessellated nozzle exit is a ring of
 * many vertices at one radius, while a trailing edge is a thin line of few. Bin
 * the rear slice laterally, take the modal bin on each side, and centroid the
 * vertices around it.
 */
export function measureNozzles(holder, box) {
  if (!holder || !box) return { ok: false, nozzles: FALLBACK_NOZZLES, reason: "no geometry" };
  holder.updateMatrixWorld(true);
  const length = box.max.z - box.min.z;
  const cut = box.max.z - length * REAR_SLICE;
  const p = new THREE.Vector3();

  // side -> bin index -> { n, sx, sy, zmax }
  const bins = [new Map(), new Map()];
  holder.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (p.z < cut || p.x === 0) continue;
      const side = p.x < 0 ? 0 : 1;
      const key = Math.round(Math.abs(p.x) / NOZZLE_BIN);
      const bin = bins[side].get(key) ?? { n: 0, sx: 0, sy: 0, zmax: -Infinity };
      bin.n++;
      bin.sx += p.x;
      bin.sy += p.y;
      if (p.z > bin.zmax) bin.zmax = p.z;
      bins[side].set(key, bin);
    }
  });

  const picked = bins.map((side) => {
    let best = null;
    for (const bin of side.values()) if (!best || bin.n > best.n) best = bin;
    return best;
  });
  if (!picked[0] || !picked[1]) {
    return { ok: false, nozzles: FALLBACK_NOZZLES, reason: "no rear geometry to bin" };
  }

  const nozzles = picked.map((b) => ({
    x: b.sx / b.n,
    y: b.sy / b.n,
    // The exit plane, not the centroid: the plume starts where the metal ends.
    z: b.zmax,
  }));

  // A shape check on the result, for the same reason the wingspan one exists:
  // "it measured something" and "it measured the nozzles" are different claims.
  // Two nozzles, mirrored, inboard, below the centreline.
  const halfSpan = Math.max(Math.abs(box.max.x), Math.abs(box.min.x));
  const mirrored = Math.abs(Math.abs(nozzles[0].x) - Math.abs(nozzles[1].x)) < 0.6;
  const inboard = nozzles.every((n) => Math.abs(n.x) < halfSpan * 0.45);
  if (!mirrored || !inboard) {
    return {
      ok: false,
      nozzles: FALLBACK_NOZZLES,
      reason:
        `implausible: x ${nozzles[0].x.toFixed(2)} / ${nozzles[1].x.toFixed(2)} ` +
        `of half-span ${halfSpan.toFixed(2)}`,
      measured: nozzles,
    };
  }
  return { ok: true, nozzles, counts: picked.map((b) => b.n) };
}

// ── the painter ────────────────────────────────────────────────────────────

/** A soft radial blob, drawn once and shared by the diamonds. */
function blobTexture(hollow) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (hollow) {
    // The burner ring: hollow, so it reads as a mouth rather than as a ball.
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.55, "rgba(255,255,255,0)");
    g.addColorStop(0.8, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.65)");
    g.addColorStop(1, "rgba(255,255,255,0)");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The plume's own texture: opaque at the nozzle, gone by the tail, and soft
 * across the width so the flame has no edge.
 */
function plumeTexture() {
  const w = 32;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    // CanvasTexture flips Y, so the BOTTOM row of the canvas is v = 0. The
    // quad's -Y edge sits at the nozzle, so that row is the hot end. Getting
    // this backwards puts the bright end behind the aircraft and the fade
    // inside the engine, which reads as a light leak rather than as exhaust.
    const along = Math.pow(y / (h - 1), 2.6);
    for (let x = 0; x < w; x++) {
      const r = Math.abs(x / (w - 1) - 0.5) * 2;
      const across = Math.pow(Math.max(0, 1 - r * r), 1.6);
      const i = (y * w + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(255 * along * across);
    }
  }
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// How much clear air to leave between the end of the plume and the camera.
const PLUME_LENS_MARGIN = 2.5; // m

const PLUME_TINT = 0xffa257;
const BURNER_TINT = 0x9fc4ff;
const DIAMOND_TINT = 0xd8e6ff;

/**
 * Build the objects for one engine model and parent them to `group`.
 *
 * THE PLUME IS A QUAD BILLBOARDED ABOUT THE EXHAUST AXIS, not a sprite and not
 * a tube. Both of those were tried against the launch camera and both failed,
 * for opposite reasons:
 *
 *   a SPRITE is a camera-facing billboard, so its "height" is a screen-space
 *   axis -- scaling one to a 13 m plume drew a 13 m VERTICAL BAR standing
 *   through the aircraft.
 *
 *   a TUBE elongates correctly, but the chase rig sits behind the exhaust and
 *   looks straight down it: additive geometry gave a bright pipe rim around a
 *   hollow interior, and the soft-across-the-width texture ran around the
 *   circumference rather than across the silhouette, lighting one side.
 *
 * A quad that keeps its long axis along the exhaust and spins about that axis
 * to face the camera has neither problem: it elongates in the right direction
 * AND presents its soft edges to the viewer from every angle. It is still two
 * per nozzle, still one shared texture, still additive, still pooled --
 * everything the budget was protecting survives; the primitive is the only
 * thing that changed.
 *
 * The ring and the diamonds stay sprites: they are small and round, which is
 * what a camera-facing billboard is good at.
 *
 * EVERY OBJECT IS MADE HERE, ONCE, matched to the model's fixed pool by index.
 * render() copies numbers onto them and allocates nothing -- the vectors and
 * the matrix it needs are hoisted out of the loop for the same reason.
 */
export function attachEngineFx(group, engine) {
  const blob = blobTexture(false);
  const ring = blobTexture(true);
  const plume = plumeTexture();

  // A unit quad whose LOCAL +Y is the exhaust axis. Shifted so its -Y edge sits
  // on the origin, which lets render() place it by the nozzle end rather than
  // by its middle -- one fewer offset to keep in step with the length.
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);

  const made = engine.sprites.map((rec) => {
    if (rec.kind === "plume") {
      const mesh = new THREE.Mesh(
        quad,
        new THREE.MeshBasicMaterial({
          map: plume,
          color: PLUME_TINT,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.renderOrder = -1;
      mesh.visible = false;
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    }
    const material = new THREE.SpriteMaterial({
      map: rec.kind === "ring" ? ring : blob,
      color: rec.kind === "ring" ? BURNER_TINT : DIAMOND_TINT,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = -1;
    sprite.visible = false;
    group.add(sprite);
    return sprite;
  });

  // Hoisted: render() runs 12 times a frame and must allocate nothing.
  const nozzleWorld = new THREE.Vector3();
  const camLocal = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 0, 1); // aft, since forward is -Z (§5)
  const right = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  return {
    objects: made,

    /**
     * THE PLUME MUST NOT REACH THE LENS -- a deliberate perceptual cheat rather
     * than a simulation (§1).
     *
     * A lit burner is 13 m long and LAUNCH_VIEW stands the rig 15.5 m off the
     * aircraft's CENTRE, which is barely 6 m behind a 19.4 m airframe's tail.
     * Drawn honestly the plume passes straight through the camera. So the drawn
     * length is clamped to stop short of it, and the offsets scale with it so
     * the shape stays a plume rather than a stub with a gap behind it.
     *
     * It is a CLAMP, not a redesign: at the ordinary chase standoff the nozzle
     * is ~17 m from the camera and the limit exceeds the full 13 m, so this
     * changes nothing in flight. It bites only where the rig is deliberately
     * close, which is exactly where it has to.
     */
    render(camera) {
      let limit = 1;
      if (camera) {
        nozzleWorld.set(engine.anchors[0].x, engine.anchors[0].y, engine.anchors[0].z);
        group.localToWorld(nozzleWorld);
        const room = nozzleWorld.distanceTo(camera.position) - PLUME_LENS_MARGIN;
        const len = engine.state.length;
        limit = len > 0 ? Math.max(0, Math.min(1, room / len)) : 0;
        camLocal.copy(camera.position);
        group.worldToLocal(camLocal);
      }
      for (let i = 0; i < made.length; i++) {
        const rec = engine.sprites[i];
        const obj = made[i];
        const anchor = engine.anchors[rec.nozzle];
        if (rec.kind !== "plume") {
          obj.visible = rec.visible && rec.opacity > 0.004;
          if (!obj.visible) continue;
          obj.position.set(rec.x, rec.y, rec.z);
          obj.scale.set(rec.w, rec.h, 1);
          obj.material.opacity = rec.opacity;
          continue;
        }
        obj.visible = rec.visible && rec.opacity > 0.004 && limit > 0.02;
        if (!obj.visible) continue;
        // The quad hangs from the nozzle end, so both the start and the length
        // carry the clamp and the two tubes stay in the same proportion.
        const start = anchor.z + (rec.z - rec.h / 2 - anchor.z) * limit;
        obj.position.set(rec.x, rec.y, start);
        obj.scale.set(rec.w, rec.h * limit, 1);
        obj.material.opacity = rec.opacity;

        // Spin about the exhaust axis until the quad's face is toward the
        // camera. Degenerate only when the camera is exactly on the axis, where
        // any roll is as good as any other -- so the fallback is arbitrary.
        toCam.copy(camLocal).sub(obj.position);
        right.crossVectors(axis, toCam);
        if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
        right.normalize();
        normal.crossVectors(right, axis).normalize();
        basis.makeBasis(right, axis, normal);
        obj.quaternion.setFromRotationMatrix(basis);
      }
    },
    dispose() {
      for (const obj of made) {
        group.remove(obj);
        obj.material.dispose();
      }
      quad.dispose();
      blob.dispose();
      ring.dispose();
      plume.dispose();
    },
  };
}

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
  let groundOffset = 2.95;
  let nozzles = FALLBACK_NOZZLES;

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

    // How far the wheels sit below the aircraft's ORIGIN, measured with the
    // gear down. normalise() recentres the model on its bounding box, so the
    // origin is the middle of the airframe -- parking it at deck height buries
    // the lower half in the deck. Measured, because it depends on the model.
    if (report.box) groundOffset = -report.box.min.y;

    // Measured before the holder is parented, so the vertices come out in the
    // aircraft's own frame rather than in world space.
    const noz = measureNozzles(report.holder, report.box);
    nozzles = noz.nozzles;
    console.log(
      `F-15E nozzles: ${noz.ok ? "measured" : "FALLBACK"} ` +
        nozzles.map((n) => `(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)})`).join(" ") +
        (noz.ok ? ` from ${noz.counts.join("/")} verts` : ` -- ${noz.reason}`),
    );
    if (!noz.ok) recordFailure("F-15E nozzles", noz.reason);

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

  // The engine's visual model and its painter. Built even on the placeholder
  // path: §2 requires the game to stay playable when an asset is missing, and a
  // fallback airframe with no exhaust would hide the failure rather than show
  // it.
  const engine = createEngineFx(nozzles);
  const engineView = attachEngineFx(group, engine);

  return {
    group,
    engine,
    nozzles,
    /** Advance the engine model and paint it. One call, so no caller can tick
     *  one without the other and leave the plume a frame stale. */
    updateEngineFx(dt, state, camera) {
      engine.update(dt, {
        throttle: state.throttle,
        afterburner: state.afterburner,
      });
      engineView.render(camera);
    },
    clearEngineFx() {
      engine.clear();
      engineView.render(null);
    },
    setGearVisual,
    gearIsDown: () => gearCache === true,
    // Add this to a surface height to park the wheels ON it rather than in it.
    groundOffset: () => groundOffset,
    loaded: model !== null,
    report,
  };
}
