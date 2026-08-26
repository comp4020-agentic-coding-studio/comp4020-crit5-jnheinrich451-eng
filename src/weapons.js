// Hardpoints and mounted stores. CLAUDE.md §14, stage 5.

import * as THREE from "three";
import { describe, loadGLTF, normalise, recordFailure } from "./assets.js";

export const AIM9_LENGTH = 2.85;
const MISSILE_URL = "./models/aim-9/scene.gltf";

// Rail positions in aircraft-local metres. The F-15E normalises to 13.05 m
// across, so these sit under the wings rather than at a guessed offset.
const RAILS = [
  { name: "L", x: -4.6, y: -0.55, z: 0.4 },
  { name: "R", x: 4.6, y: -0.55, z: 0.4 },
];

/**
 * Mount the stores as CHILD TRANSFORMS of the aircraft, not as tracked
 * coordinates. A round then always leaves the rail wherever the aircraft
 * happens to be pointing, at any attitude, with no per-frame maths at all --
 * and inverted, knife-edge and mid-barrel-roll launches are correct for free.
 */
export async function createWeapons(aircraftGroup) {
  const rails = RAILS.map((r) => ({ ...r, mount: new THREE.Group(), loaded: true }));
  for (const rail of rails) {
    rail.mount.position.set(rail.x, rail.y, rail.z);
    aircraftGroup.add(rail.mount);
  }

  let report = null;
  try {
    const gltf = await loadGLTF(MISSILE_URL);
    const norm = normalise(gltf.scene, { targetLength: AIM9_LENGTH, axis: "z" });
    report = norm;
    console.log(describe(norm, "AIM-9", AIM9_LENGTH));
    if (norm.ok) {
      for (const rail of rails) {
        rail.mount.add(norm.holder.clone(true));
      }
    }
  } catch (err) {
    recordFailure("AIM-9", err && err.message ? err.message : err);
    // A visible stand-in, so an empty rail is still visibly a rail.
    for (const rail of rails) {
      const stub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, AIM9_LENGTH, 8),
        new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.5 }),
      );
      stub.rotation.x = Math.PI / 2;
      rail.mount.add(stub);
    }
  }

  const worldPosition = new THREE.Vector3();

  return {
    rails,
    report,
    get count() {
      return rails.filter((r) => r.loaded).length;
    },
    get capacity() {
      return rails.length;
    },

    /** The next loaded rail, or null. */
    next() {
      return rails.find((r) => r.loaded) ?? null;
    },

    /** Release from a rail: hide its store and report where it left from. */
    release(rail) {
      const chosen = rail ?? rails.find((r) => r.loaded);
      if (!chosen || !chosen.loaded) return null;
      chosen.loaded = false;
      chosen.mount.visible = false;
      chosen.mount.getWorldPosition(worldPosition);
      return { rail: chosen, position: worldPosition.clone() };
    },

    reload() {
      for (const rail of rails) {
        rail.loaded = true;
        rail.mount.visible = true;
      }
    },

    /**
     * Restore an exact count. Stage 7's checkpoints need this: reloading to
     * full on a restore would make flying into a mountain the cheapest way to
     * refill the rails.
     */
    setCount(n) {
      const wanted = Math.max(0, Math.min(rails.length, n));
      rails.forEach((rail, i) => {
        rail.loaded = i < wanted;
        rail.mount.visible = rail.loaded;
      });
    },
  };
}
