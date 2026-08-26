// Meshes for the things missile.js and gun.js only ever describe as numbers.
//
// Those two modules are three-free so the suite can exercise them headlessly;
// this is the other half. Everything here is POOLED and shares its materials:
// a 22-round-per-second cannon that allocated a mesh per tracer would allocate
// more objects than the whole rest of the game combined.

import * as THREE from "three";

const TRACER_COLOUR = 0xffd79a;
const MISSILE_COLOUR = 0xd8dde5;
const PLUME_COLOUR = 0xffc078;

export function createCombatFx(scene) {
  // ── missiles ─────────────────────────────────────────────────────────────
  const missileGeom = new THREE.CylinderGeometry(0.14, 0.14, 2.85, 8);
  missileGeom.rotateX(Math.PI / 2); // point down -Z, the project's forward
  const missileMat = new THREE.MeshStandardMaterial({
    color: MISSILE_COLOUR, roughness: 0.45, metalness: 0.5,
  });
  const plumeMat = new THREE.SpriteMaterial({
    color: PLUME_COLOUR, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const missilePool = [];

  function acquireMissile() {
    const spare = missilePool.find((m) => !m.inUse);
    if (spare) {
      spare.inUse = true;
      spare.group.visible = true;
      return spare;
    }
    const group = new THREE.Group();
    group.add(new THREE.Mesh(missileGeom, missileMat));
    const plume = new THREE.Sprite(plumeMat);
    plume.scale.set(3.2, 3.2, 1);
    plume.position.z = 2.1;
    group.add(plume);
    scene.add(group);
    const entry = { group, inUse: true };
    missilePool.push(entry);
    return entry;
  }

  // ── tracers ──────────────────────────────────────────────────────────────
  // One LineSegments for ALL tracers, rewritten each frame. A mesh per tracer
  // would be a draw call per round in the air.
  const MAX_TRACERS = 64;
  const tracerPositions = new Float32Array(MAX_TRACERS * 6);
  const tracerGeom = new THREE.BufferGeometry();
  tracerGeom.setAttribute("position", new THREE.BufferAttribute(tracerPositions, 3));
  const tracers = new THREE.LineSegments(
    tracerGeom,
    new THREE.LineBasicMaterial({
      color: TRACER_COLOUR, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  tracers.frustumCulled = false;
  scene.add(tracers);

  // ── kill burst ───────────────────────────────────────────────────────────
  const burstMat = new THREE.SpriteMaterial({
    color: 0xffb15e, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const bursts = [];

  const forward = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  return {
    /** Match the pool to the rounds actually in the air. */
    syncMissiles(rounds) {
      for (const entry of missilePool) entry.claimed = false;
      for (const round of rounds) {
        const entry = round.__fx?.inUse ? round.__fx : acquireMissile();
        round.__fx = entry;
        entry.claimed = true;
        entry.group.position.set(round.position.x, round.position.y, round.position.z);
        forward.set(round.velocity.x, round.velocity.y, round.velocity.z).normalize();
        entry.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), forward);
      }
      for (const entry of missilePool) {
        if (!entry.claimed && entry.inUse) {
          entry.inUse = false;
          entry.group.visible = false;
        }
      }
    },

    syncTracers(list) {
      const n = Math.min(list.length, MAX_TRACERS);
      for (let i = 0; i < n; i++) {
        const t = list[i];
        const o = i * 6;
        tracerPositions[o] = t.from.x;
        tracerPositions[o + 1] = t.from.y;
        tracerPositions[o + 2] = t.from.z;
        tracerPositions[o + 3] = t.to.x;
        tracerPositions[o + 4] = t.to.y;
        tracerPositions[o + 5] = t.to.z;
      }
      // Collapse the unused slots onto a point rather than leaving stale
      // geometry pointing at wherever the last burst went.
      for (let i = n; i < MAX_TRACERS; i++) {
        tracerPositions.set([0, -99999, 0, 0, -99999, 0], i * 6);
      }
      tracerGeom.attributes.position.needsUpdate = true;
      tracers.visible = n > 0;
    },

    burst(position, scale = 26) {
      const sprite = new THREE.Sprite(burstMat.clone());
      sprite.position.set(position.x, position.y, position.z);
      sprite.scale.setScalar(scale * 0.4);
      scene.add(sprite);
      bursts.push({ sprite, age: 0, life: 0.55, scale });
    },

    update(dt) {
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.age += dt;
        const u = b.age / b.life;
        if (u >= 1) {
          scene.remove(b.sprite);
          b.sprite.material.dispose();
          bursts.splice(i, 1);
          continue;
        }
        b.sprite.scale.setScalar(b.scale * (0.4 + u * 1.6));
        b.sprite.material.opacity = 1 - u;
      }
    },

    clear() {
      for (const entry of missilePool) {
        entry.inUse = false;
        entry.group.visible = false;
      }
      this.syncTracers([]);
      for (const b of bursts) {
        scene.remove(b.sprite);
        b.sprite.material.dispose();
      }
      bursts.length = 0;
    },
  };
}
