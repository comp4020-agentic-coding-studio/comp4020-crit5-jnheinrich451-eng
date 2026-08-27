/**
 * Stage 03.0 — weapon assets and aircraft hardpoints.
 *
 * Two responsibilities, deliberately separated:
 *   1. normalize the AIM-9 source asset into a known-forward, known-length
 *      prototype that gameplay code can clone without touching Sketchfab nodes,
 *   2. own the aircraft's weapon anchors, so nothing else in the project holds
 *      a launch position. Missiles spawn from a mount's world transform.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const WEAPONS = {
  aim9: {
    url: "assets/aim9/scene.gltf",
    // AIM-9M: 2.85 m long, 0.127 m body diameter. Length is the calibration
    // axis; the source asset is ~2 units long, so nothing here trusts its units.
    targetLength: 2.85,
    // The Sketchfab wrapper matrices land this model nose-first along +Z, and
    // game space is -Z forward. One 180° yaw is the whole correction — the same
    // convention as the F-15's ModelCorrection.
    modelYaw: Math.PI,
  },

  /**
   * Wing-station anchors, in AircraftRoot space (F-15 normalized to 19.4 m,
   * nose at -Z). The mount origin IS the missile body centre, so y is the
   * clearance below the wing surface — the round hangs beneath the wing on a
   * rail rather than sitting flush against it (§27/§28).
   *
   * Measured from the model's own vertices and then confirmed by occlusion
   * raycast, not by eye. This F-15 is heavily swept: the wing chord runs
   * z -0.5..2.4 at |x| = 3 but z 2.8..5.4 at |x| = 5.2, with the outer-panel
   * underside at y ≈ -0.29. "Under the wing" therefore means well outboard AND
   * well aft — stations chosen nearer the aircraft centre put the rounds either
   * in open air beside the tailplane or completely behind the nacelles.
   *
   * Final station: 5.2 out, 1.05 down, 4.3 aft — 0.76 m of clearance under the
   * wing (a realistic Sidewinder drop) with the 2.85 m body centred on the
   * outer-panel chord. Verified by casting rays from nine points along each
   * body toward the chase camera: 8 of 9 clear the airframe, so both rounds
   * read as slung under the wing from the default view instead of being hidden
   * by it.
   *
   * No rotation — the body stays parallel to the longitudinal axis, with
   * source-axis correction living in Aim9ModelCorrection (§29).
   */
  mounts: [
    { name: "MissileLeft", side: -1, position: new THREE.Vector3(-5.2, -1.05, 4.3) },
    { name: "MissileRight", side: 1, position: new THREE.Vector3(5.2, -1.05, 4.3) },
  ],

  /**
   * Stage 03.2 — the internal cannon port. No external gun pod, no cannon
   * model (§5): one anchor, used for the muzzle flash, the tracer origin and
   * the hitscan origin alike, so there is exactly one answer to "where does
   * the gun fire from".
   *
   * Measured, like every other anchor here. Binning the airframe's top surface
   * over x 0.8..2.8 / z -4.5..2.5 gives a flat shoulder along the right wing
   * root at y 0.04..0.10 (skin y 0.09 at x 1.50, 0.04 at x 1.75), running from
   * the intake lip aft past the wing leading edge. The real F-15 carries the
   * M61 in exactly that fairing, above the right intake and just forward of the
   * wing root, so the port sits at x 1.60, z -1.10 with y 0.18 — about 0.11 m
   * clear of the skin, enough that the flash is not buried inside the fuselage
   * and close enough that it still reads as internal.
   */
  gun: {
    name: "GunMuzzle",
    position: new THREE.Vector3(1.6, 0.18, -1.1),
    // The measurement the position is derived from, kept beside it so the test
    // asserts against the airframe rather than against a literal (cf. the
    // wingtip `tipStation` in Stage 03.15).
    station: { skinY: 0.09, intakeX: 2.05, wingRootZ: 1.4 },
  },

  /**
   * The rail that visually connects missile to wing. Cheap boxes, no pylon
   * detail (§30): a rail beam just above the body and a short strut up to the
   * wing surface. `strutTop` is where the wing underside sits relative to the
   * mount, so moving a mount down lengthens its strut automatically.
   */
  rail: {
    beam: { width: 0.15, height: 0.09, length: 1.4, y: 0.11 },
    strut: { width: 0.11, length: 0.75, top: 0.76 },
    color: 0x24262a,
  },
};

/**
 * AircraftRoot
 *  |- WeaponMounts
 *      |- MissileLeft
 *      |- MissileRight
 * Plain Object3D anchors: no logic, no geometry of their own. Everything that
 * needs a launch point asks a mount for its world transform.
 */
/** Selected weapon. Two entries, and §2 says it stays two. */
export const WeaponMode = { AIM9: "AIM-9", GUN: "GUN" };

/** AIM-9 -> GUN -> AIM-9. Pure. */
export function cycleWeapon(mode) {
  return mode === WeaponMode.AIM9 ? WeaponMode.GUN : WeaponMode.AIM9;
}

export function createWeaponMounts(aircraftRoot, { rails = true } = {}) {
  const weaponMounts = new THREE.Object3D();
  weaponMounts.name = "WeaponMounts";

  const list = WEAPONS.mounts.map((cfg) => {
    const mount = new THREE.Object3D();
    mount.name = cfg.name;
    mount.position.copy(cfg.position);
    mount.userData.side = cfg.side;
    // The rail is a child of the mount but NOT of the round, so firing hides
    // the missile and leaves the rail behind (§33).
    if (rails) mount.add(buildLaunchRail(cfg.name));
    weaponMounts.add(mount);
    return mount;
  });

  // The gun port is a hardpoint like any other: it hangs off WeaponMounts, so
  // the cannon system never holds a coordinate of its own.
  const gunMuzzle = new THREE.Object3D();
  gunMuzzle.name = WEAPONS.gun.name;
  gunMuzzle.position.copy(WEAPONS.gun.position);
  weaponMounts.add(gunMuzzle);

  aircraftRoot.add(weaponMounts);
  return { weaponMounts, list, gunMuzzle, left: list[0], right: list[1] };
}

/** Two boxes: a rail beam over the missile and a strut up to the wing. */
export function buildLaunchRail(name = "Rail", cfg = WEAPONS.rail) {
  const group = new THREE.Object3D();
  group.name = `${name}Rail`;
  const mat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.65, metalness: 0.35 });

  const beam = new THREE.Mesh(new THREE.BoxGeometry(cfg.beam.width, cfg.beam.height, cfg.beam.length), mat);
  beam.position.y = cfg.beam.y;
  group.add(beam);

  // Spans from the top of the beam to the wing surface, however far that is.
  const bottom = cfg.beam.y + cfg.beam.height * 0.5;
  const height = Math.max(0.05, cfg.strut.top - bottom);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(cfg.strut.width, height, cfg.strut.length), mat);
  strut.position.y = bottom + height * 0.5;
  group.add(strut);

  return group;
}

/**
 * Aim9Root
 *  |- Aim9ModelCorrection   scale + yaw + pivot recentre
 *      |- Aim9GLTF          untouched source hierarchy
 * Forward is local -Z, length is exactly targetLength, pivot is the body
 * centre. Returned root is a prototype: clone(true) it per instance.
 */
export function normalizeMissile(model, { targetLength, modelYaw } = WEAPONS.aim9) {
  const root = new THREE.Object3D();
  root.name = "Aim9Root";
  const correction = new THREE.Object3D();
  correction.name = "Aim9ModelCorrection";
  model.name = "Aim9GLTF";
  correction.add(model);
  root.add(correction);

  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const scale = longest > 0 ? targetLength / longest : 1;

  correction.scale.setScalar(scale);
  correction.rotation.set(0, modelYaw, 0);
  root.updateMatrixWorld(true);

  // Root is still detached and at the origin, so "world" here is root space.
  const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  correction.position.sub(center);
  root.updateMatrixWorld(true);

  const final = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return {
    root,
    correction,
    metrics: {
      sourceSize: size.toArray().map((v) => +v.toFixed(3)),
      scale: +scale.toFixed(4),
      lengthAxis: size.x > size.z ? (size.x > size.y ? "x" : "y") : size.z > size.y ? "z" : "y",
      normalized: final.toArray().map((v) => +v.toFixed(3)),
    },
  };
}

/** Loads the AIM-9 prototype. Falls back to a scale-correct blockout. */
export function loadAim9(url = WEAPONS.aim9.url) {
  return new Promise((resolve) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            // A 2.85 m body at 900 m/s crosses a frustum edge inside one frame;
            // culling it per-mesh buys nothing and pops the model at launch.
            o.frustumCulled = false;
          }
        });
        const { root, metrics } = normalizeMissile(gltf.scene);
        console.log("[aim9] normalized", metrics);
        resolve({ prototype: root, placeholder: false, metrics });
      },
      undefined,
      () => {
        console.warn(`[aim9] ${url} not found — using placeholder missile body.`);
        resolve({ prototype: buildPlaceholderMissile(), placeholder: true, metrics: null });
      }
    );
  });
}

/** 2.85 m blockout: seeker dome, body, canards, tail fins. Forward is -Z. */
export function buildPlaceholderMissile() {
  const root = new THREE.Object3D();
  root.name = "Aim9Root";
  const correction = new THREE.Object3D();
  correction.name = "Aim9ModelCorrection";
  root.add(correction);

  const body = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.5, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.4, metalness: 0.5 });

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 2.45, 14), body);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = 0.15;
  correction.add(tube);

  const seeker = new THREE.Mesh(new THREE.ConeGeometry(0.064, 0.4, 14), dark);
  seeker.rotation.x = -Math.PI / 2;
  seeker.position.z = -1.28;
  correction.add(seeker);

  const finGeo = new THREE.BoxGeometry(0.34, 0.02, 0.3);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    for (const [z, s] of [[-0.85, 0.75], [1.2, 1]]) {
      const fin = new THREE.Mesh(finGeo, dark);
      fin.position.set(Math.cos(a) * 0.2 * s, Math.sin(a) * 0.2 * s, z);
      fin.rotation.z = a;
      fin.scale.setScalar(s);
      correction.add(fin);
    }
  }
  return root;
}

/**
 * The visible carried rounds. One clone parented to each mount; firing hides
 * the clone on that mount, so ammo state is legible on the airframe itself and
 * the HUD count is a confirmation rather than the only feedback.
 */
export function createMountedMissiles(mountSet, prototype) {
  const carried = mountSet.list.map((mount) => {
    const visual = prototype.clone(true);
    visual.name = `${mount.name}Round`;
    mount.add(visual);
    return { mount, visual, loaded: true };
  });

  return {
    rounds: carried,
    get count() {
      return carried.filter((r) => r.loaded).length;
    },
    /** Next round to fire: alternates by taking whichever side is still loaded. */
    next() {
      return carried.find((r) => r.loaded) || null;
    },
    release(round) {
      round.loaded = false;
      round.visual.visible = false;
      return round.mount;
    },
    reload() {
      for (const r of carried) {
        r.loaded = true;
        r.visual.visible = true;
      }
    },
    /**
     * Stage 04.0 §41 — restore a specific loadout. A checkpoint has to put the
     * stores back exactly as they were when it was recorded; reloading to full
     * would make flying into a mountain the cheapest way to refill the rails.
     */
    setCount(n) {
      const want = Math.max(0, Math.min(carried.length, n | 0));
      carried.forEach((r, i) => {
        r.loaded = i < want;
        r.visual.visible = r.loaded;
      });
      return want;
    },
  };
}
