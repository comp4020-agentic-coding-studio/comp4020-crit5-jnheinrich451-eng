/**
 * Stage 03.15 — twin-engine propulsion FX.
 *
 * Not a particle system and not combustion physics: four cheap layered pieces
 * per engine (core cone, billboard plume stack, shock diamonds, nozzle bloom)
 * driven by one normalized intensity. Additive blending does the heat work.
 *
 * Intensity comes from throttle and afterburner state — never from airspeed
 * (§4/§5). Speed only stretches the plume slightly, so a dive that gains 80 m/s
 * on idle thrust does not light the burners.
 */
import * as THREE from "three";

export const ENGINE_FX = {
  /**
   * Nozzle anchors in AircraftRoot space, re-measured from the airframe mesh by
   * slicing the aft fuselage (§28). The aft cross-section has FOUR structures,
   * and the outer pair is not the engines: solid booms at |x| 1.4–1.9 carrying
   * the stabilator and fins, and inboard of them two hollow rings spanning
   * |x| 0.30–1.02, y -0.92..-0.20 — the tailpipes. Nozzle centre is therefore
   * (±0.66, -0.56) with a 0.36 m radius, and the last body geometry inside that
   * annulus is at z 8.18, which is the exit plane. An earlier pass read the
   * booms as the nozzles and hung both plumes on the stabilator roots, ~1.05 m
   * too far outboard and 0.9 m too far aft.
   */
  nozzles: [
    { name: "EngineFxLeft", side: -1, position: new THREE.Vector3(-0.66, -0.56, 8.2) },
    { name: "EngineFxRight", side: 1, position: new THREE.Vector3(0.66, -0.56, 8.2) },
  ],
  nozzleRadius: 0.36,
  // Sanity bound for the test that keeps the anchors off the booms: measured
  // boom inner edge is |x| 1.25, so engine structure lives inboard of that.
  boomInnerX: 1.25,

  // Dry thrust: nothing below this, full dry glow at 1.0 throttle.
  dryOnset: 0.34,
  dryCeiling: 0.55, // intensity reached at full dry throttle
  abIntensity: 1.0,
  abRise: 7.0, // 1/s — AB lights fast but not instantly
  dryRise: 3.5,

  // Geometry, in metres. Deliberately SHORT. The chase camera sits almost
  // directly astern, so an axial cone is seen end-on and foreshortening turns
  // any length into an apparent beam aimed at the viewer — a 7 m plume read as
  // a 30 m searchlight over the carrier. Compact core plus bloom plus shock
  // train carries the power read instead (§6/§27).
  coreLength: 1.15,
  coreRadius: 0.32,
  /**
   * Stage 03.2 (§33): the outer plume is no longer a cone. A second cone behind
   * the first is what made the burner read as ring-and-funnel — a hard conical
   * silhouette with a visible rim, and the worst of the dead-astern
   * foreshortening. It is now a short stack of additive billboards, which has no
   * silhouette to foreshorten and no rim to see. plumeLength/plumeRadius are now
   * the extent of that stack.
   */
  plumeLength: 2.6,
  plumeRadius: 0.4,
  plumeSprites: 3,
  // Speed stretches the plume by at most this fraction, as a secondary cue.
  speedStretch: 0.18,
  speedRef: 320,

  rings: 3,
  ringSpacing: 0.42,
  ringRadius: 0.13,
  ringTube: 0.024,
  // §33: shock *diamonds*, not hoops. A torus seen from behind is a ring with a
  // hole in it, and three of them read as three hoops hanging in the air. These
  // are small stretched octahedra riding inside the core instead, which is what
  // a shock train actually looks like down the pipe.
  ringStretch: 2.2,
  // Rings are an AB-only structure: dry thrust has no visible shock train.
  ringOnset: 0.62,

  flicker: 0.09, // amplitude as a fraction of intensity
  flickerHz: [17, 29], // two incommensurate rates, so it never buzzes
  wobbleHz: 3.4,
  wobble: 0.035, // plume lateral wobble, in metres

  bloomScale: 1.7,
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Normalized visual intensity of one engine. Pure — the piece worth testing.
 * Dry thrust ramps from dryOnset to full throttle and tops out at dryCeiling;
 * afterburner is a separate, higher band so AB always reads stronger than
 * military power (§5).
 */
export function engineIntensity(throttle, afterburner, cfg = ENGINE_FX) {
  const dry = smooth(clamp01((throttle - cfg.dryOnset) / (1 - cfg.dryOnset))) * cfg.dryCeiling;
  if (!afterburner) return dry;
  // AB blends from the dry ceiling to full so lighting it is a visible step up
  // rather than a jump discontinuity.
  return Math.max(dry, cfg.dryCeiling + (cfg.abIntensity - cfg.dryCeiling) * smooth(clamp01((throttle - cfg.dryOnset) / (1 - cfg.dryOnset))));
}

/** Shock rings fade in only near the top of the range. Pure. */
export function ringOpacity(intensity, cfg = ENGINE_FX) {
  return smooth(clamp01((intensity - cfg.ringOnset) / (1 - cfg.ringOnset)));
}

/** Two-rate flicker, deterministic in time. Pure. */
export function flickerAt(time, cfg = ENGINE_FX) {
  const [a, b] = cfg.flickerHz;
  return 1 + cfg.flicker * 0.5 * (Math.sin(time * a) + Math.sin(time * b * 1.37 + 1.1));
}

function plumeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,252,242,1)");
  grad.addColorStop(0.25, "rgba(198,224,255,0.72)");
  grad.addColorStop(0.6, "rgba(255,168,92,0.34)");
  grad.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * AircraftRoot
 *  |- EngineFx
 *      |- EngineFxLeft  -> core | plume | rings | bloom
 *      |- EngineFxRight -> ...
 * Anchors are plain Object3Ds, so nothing outside this module holds a nozzle
 * coordinate (§7).
 */
export function createEngineFx(aircraftRoot, cfg = ENGINE_FX) {
  const group = new THREE.Object3D();
  group.name = "EngineFx";

  const tex = plumeTexture();
  // One material set shared by both engines: twin symmetry is guaranteed by
  // construction rather than by keeping two copies in step.
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const puffMat = new THREE.SpriteMaterial({ map: tex, color: 0xffa060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const bloomMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  // Cones open toward +Z (aft): +90° about X sends the cone's +Y apex onto +Z.
  const coreGeo = new THREE.ConeGeometry(cfg.coreRadius, cfg.coreLength, 14, 1, true);
  const ringGeo = new THREE.OctahedronGeometry(cfg.ringRadius, 0);

  const engines = cfg.nozzles.map((n) => {
    const anchor = new THREE.Object3D();
    anchor.name = n.name;
    anchor.position.copy(n.position);
    anchor.userData.side = n.side;

    const core = new THREE.Mesh(coreGeo, coreMat.clone());
    core.rotation.x = Math.PI / 2;
    core.position.z = cfg.coreLength * 0.5;
    core.name = "Core";

    const plume = new THREE.Object3D();
    plume.name = "Plume";
    const puffs = [];
    for (let i = 0; i < cfg.plumeSprites; i++) {
      const puff = new THREE.Sprite(puffMat.clone());
      puff.name = `Puff${i}`;
      puffs.push(puff);
      plume.add(puff);
    }

    const rings = [];
    for (let i = 0; i < cfg.rings; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.position.z = (i + 1) * cfg.ringSpacing;
      ring.scale.z = cfg.ringStretch;
      ring.name = `Ring${i}`;
      rings.push(ring);
      anchor.add(ring);
    }

    const bloom = new THREE.Sprite(bloomMat.clone());
    bloom.scale.setScalar(cfg.bloomScale);
    bloom.name = "Bloom";

    anchor.add(core, plume, bloom);
    group.add(anchor);
    return { anchor, core, plume, puffs, rings, bloom };
  });

  aircraftRoot.add(group);

  let time = 0;
  const state = { intensity: 0, ring: 0, afterburner: false };

  /** @param ctx { throttle, afterburner, speed } */
  function update(ctx, dt) {
    time += dt;
    const target = engineIntensity(ctx.throttle, ctx.afterburner, cfg);
    // Spooling: AB lights faster than it decays, so a throttle chop reads as
    // the burner going out rather than a hard cut.
    const rise = target > state.intensity ? (ctx.afterburner ? cfg.abRise : cfg.dryRise) : cfg.dryRise;
    state.intensity += (target - state.intensity) * (1 - Math.exp(-rise * dt));
    state.afterburner = !!ctx.afterburner;

    const i = state.intensity;
    const f = flickerAt(time, cfg);
    const ringOp = ringOpacity(i, cfg);
    state.ring = ringOp;
    // Length responds to speed only as a secondary cue (§5).
    const stretch = 1 + cfg.speedStretch * clamp01((ctx.speed || 0) / cfg.speedRef);
    const wob = Math.sin(time * cfg.wobbleHz) * cfg.wobble * i;

    for (const e of engines) {
      // 0.42 rather than 0.7: the core cone is open-ended and double-sided, so
      // seen end-on from the chase camera you are looking down its length and
      // the additive layers stack — at 0.7 the nozzle clipped to a flat white
      // plate with a hard rim. The bloom carries the brightness instead, which
      // has no edge to see (§33).
      e.core.material.opacity = 0.34 * i * f;
      e.core.scale.set(1, Math.max(0.05, i * f * stretch), 1);
      e.core.position.z = cfg.coreLength * 0.5 * i * f * stretch;

      // Billboard stack: each puff sits further aft, narrows and fades, so the
      // plume has depth without a conical edge anywhere in it (§33).
      for (let p = 0; p < e.puffs.length; p++) {
        const puff = e.puffs[p];
        const frac = (p + 0.6) / e.puffs.length;
        const breathe = 1 + 0.07 * Math.sin(time * (5.3 + p * 1.9) + p * 2.1);
        puff.position.z = frac * cfg.plumeLength * i * stretch;
        puff.position.x = wob * e.anchor.userData.side * frac;
        puff.scale.setScalar(cfg.plumeRadius * 2.4 * (1 - 0.34 * frac) * (0.5 + 0.5 * i) * breathe);
        puff.material.opacity = 0.34 * i * i * (1 - 0.5 * frac) * breathe;
        puff.visible = i > 0.01;
      }

      for (let r = 0; r < e.rings.length; r++) {
        const ring = e.rings[r];
        // Diamonds ride out with intensity and pulse slightly out of phase,
        // which is what makes the shock train read as a train rather than three
        // identical accents.
        const phase = 1 + 0.06 * Math.sin(time * 11 + r * 1.7);
        ring.position.z = (r + 1) * cfg.ringSpacing * i * phase * stretch;
        const s = (1.05 - r * 0.15) * (0.7 + 0.3 * i) * phase;
        ring.scale.set(s, s, s * cfg.ringStretch);
        // Later diamonds are fainter, so the structure has a direction.
        ring.material.opacity = ringOp * (0.34 - r * 0.09) * f;
        ring.visible = ringOp > 0.01;
      }

      // Additive white over a dark tailpipe clips to a flat plate long before
      // opacity 1: at 0.58 the nozzle read as a hard-edged white disc. 0.36
      // keeps the falloff visible, so it reads as a glow with a centre.
      e.bloom.material.opacity = 0.36 * i * f;
      e.bloom.scale.setScalar(cfg.bloomScale * (0.6 + 0.5 * i));
    }
  }

  function reset() {
    time = 0;
    state.intensity = 0;
  }

  return { group, engines, state, update, reset, cfg };
}
