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

/** A strip that is opaque down its spine and soft at both edges. */
function softTexture() {
  const w = 32;
  const h = 4;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.abs(x / (w - 1) - 0.5) * 2;
      const a = Math.pow(Math.max(0, 1 - r * r), 1.4);
      const i = (y * w + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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

  // ── missile trails ───────────────────────────────────────────────────────
  //
  // The round must LEAVE the smoke behind, so every segment is drawn at the
  // WORLD position missile-trail.js recorded it at and is never moved again.
  // Same approach as the crash smoke below, which already got this right.
  //
  // NORMAL blending, not additive: a rocket motor's smoke is grey and it
  // OCCLUDES what is behind it. Additive smoke over the ocean turns into a pale
  // haze that reads as lens dirt.
  //
  // Pooled and reused, and the pool is shared across every round in the air --
  // a magazine of two, a hostile pair and a SAM salvo peak at well under a
  // hundred segments between them.
  // A SEGMENT IS A QUAD SPANNING ITS TWO ENDPOINTS, billboarded about the span
  // -- the same trick the engine plume uses, and for the same reason. A
  // camera-facing sprite cannot stretch along a world axis, and one segment of
  // an AIM-9's trail is 38 m long: drawn as a sprite it is either a 38 m ball
  // or a 2.6 m dot with 35 m of clear air on either side.
  const trailGeom = new THREE.PlaneGeometry(1, 1);
  const trailTex = softTexture();
  const trailMat = new THREE.MeshBasicMaterial({
    map: trailTex, color: 0xb9c0c7, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  const trailPool = [];

  function borrowTrail() {
    for (const mesh of trailPool) {
      if (!mesh.visible) {
        mesh.visible = true;
        return mesh;
      }
    }
    const mesh = new THREE.Mesh(trailGeom, trailMat.clone());
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    scene.add(mesh);
    trailPool.push(mesh);
    return mesh;
  }

  // Hoisted: this runs for every live segment of every round in the air.
  const segA = new THREE.Vector3();
  const segB = new THREE.Vector3();
  const segMid = new THREE.Vector3();
  const segAxis = new THREE.Vector3();
  const segToCam = new THREE.Vector3();
  const segRight = new THREE.Vector3();
  const segNormal = new THREE.Vector3();
  const segBasis = new THREE.Matrix4();

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

  // ── the crash presentation ───────────────────────────────────────────────
  // crash-fx.js is three-free and describes the crash as numbers; this draws
  // it. Everything is POOLED and shares two materials -- peak is ~55 live
  // entities and allocating them per crash would stutter on the frame the
  // player most needs to see clearly.
  const smokeMat = new THREE.SpriteMaterial({
    color: 0x9aa3ab, transparent: true, opacity: 0.5, depthWrite: false,
  });
  const crashGroup = new THREE.Group();
  scene.add(crashGroup);
  const crashPool = { spark: [], smoke: [], debris: [], ball: [] };
  const sparkMat = new THREE.SpriteMaterial({
    color: 0xffcf7a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ballMat = new THREE.SpriteMaterial({
    color: 0xff9a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const debrisGeoms = [
    new THREE.BoxGeometry(1.6, 0.4, 2.6),
    new THREE.BoxGeometry(0.9, 0.9, 1.4),
    new THREE.ConeGeometry(0.7, 2.2, 5),
    new THREE.BoxGeometry(2.4, 0.3, 0.8),
  ];
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x54595f, roughness: 0.8 });

  function borrow(kind, factory) {
    const pool = crashPool[kind];
    const spare = pool.find((o) => !o.visible);
    if (spare) {
      spare.visible = true;
      return spare;
    }
    const made = factory();
    crashGroup.add(made);
    pool.push(made);
    return made;
  }
  function releaseAll() {
    for (const pool of Object.values(crashPool)) {
      for (const o of pool) o.visible = false;
    }
  }

  return {
    /**
     * Draw one frame of a crash. `mist` swaps additive fire for normal-blended
     * spray, which is what makes an ocean impact read as water rather than as
     * a fire that happens to be blue.
     */
    renderCrash(crash) {
      if (!crash.state.active) {
        releaseAll();
        return;
      }
      const t = crash.state.t;
      let used = { spark: 0, smoke: 0, debris: 0, ball: 0 };

      for (const b of crash.fireball) {
        if (t < b.born) continue;
        const age = t - b.born;
        const s = borrow("ball", () => new THREE.Sprite(ballMat.clone()));
        used.ball++;
        s.position.set(
          crash.state.position.x + b.offset.x,
          crash.state.position.y + b.offset.y,
          crash.state.position.z + b.offset.z,
        );
        s.scale.setScalar(b.size * (0.4 + age * b.rate * 2.4));
        s.material.opacity = Math.max(0, 1 - age * b.rate * 1.5);
      }
      for (const sp of crash.sparks) {
        const s = borrow("spark", () => new THREE.Sprite(sparkMat));
        used.spark++;
        s.position.set(sp.position.x, sp.position.y, sp.position.z);
        s.scale.setScalar(1.4);
      }
      for (const sm of crash.smoke) {
        const s = borrow("smoke", () => new THREE.Sprite(smokeMat.clone()));
        used.smoke++;
        s.position.set(sm.position.x, sm.position.y, sm.position.z);
        s.scale.setScalar(6 + sm.age * 20);
        s.material.opacity = Math.max(0, 0.55 - sm.age * 0.5);
        // Water goes UP as spray, not outward as smoke.
        if (sm.mist > 0) s.material.color.setHex(0xcfe3ef);
      }
      for (const d of crash.debris) {
        const m = borrow("debris", () =>
          new THREE.Mesh(debrisGeoms[d.kind % debrisGeoms.length], debrisMat),
        );
        used.debris++;
        m.position.set(d.position.x, d.position.y, d.position.z);
        m.rotation.x += d.spin.x * 0.016;
        m.rotation.z += d.spin.z * 0.016;
      }

      for (const [kind, pool] of Object.entries(crashPool)) {
        for (let i = used[kind]; i < pool.length; i++) pool[i].visible = false;
      }
    },

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

    /** Draw every live segment of every trail, live rounds and orphans alike. */
    syncTrails(trails, camera) {
      let used = 0;
      trails.each((trail) => {
        for (const seg of trail.segments) {
          if (!seg.alive) continue;
          segA.set(seg.ax, seg.ay, seg.az);
          segB.set(seg.bx, seg.by, seg.bz);
          segAxis.subVectors(segB, segA);
          const length = segAxis.length();
          if (length < 1e-4) continue;
          const mesh = borrowTrail();
          used++;
          segMid.addVectors(segA, segB).multiplyScalar(0.5);
          mesh.position.copy(segMid);
          // The quad's local +Y runs along the span and it spins about that
          // axis until its face is toward the camera, so the strip reads the
          // same from every angle instead of vanishing edge-on.
          segAxis.multiplyScalar(1 / length);
          segToCam.subVectors(camera.position, segMid);
          segRight.crossVectors(segAxis, segToCam);
          if (segRight.lengthSq() < 1e-8) segRight.set(1, 0, 0);
          segRight.normalize();
          segNormal.crossVectors(segRight, segAxis).normalize();
          segBasis.makeBasis(segRight, segAxis, segNormal);
          mesh.quaternion.setFromRotationMatrix(segBasis);
          // Overlapped very slightly along the span so consecutive quads share
          // an edge rather than showing a seam at the join.
          mesh.scale.set(seg.width, length * 1.02, 1);
          mesh.material.opacity = seg.opacity;
        }
      });
      // Everything past the high-water mark goes back rather than being left
      // parked at wherever the last round died.
      for (let i = used; i < trailPool.length; i++) trailPool[i].visible = false;
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
      releaseAll();
      for (const sprite of trailPool) sprite.visible = false;
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
