/**
 * Stage 04.3 — flares.
 *
 * The third answer to a missile, and the first one that is a *resource* rather
 * than a skill. Stage 03.3 gave the player the barrel roll, which is a timing
 * problem; Stage 04.2 gave them terrain, which is a geography problem. A flare
 * is neither — it is eight presses per sortie, and the interesting decision is
 * when to spend one.
 *
 * The rule is deliberately physical rather than statistical. There is no dice
 * roll, no per-missile decoy chance and no aspect table:
 *
 *   a round that passes within `seduceRadius` of a burning flare loses its target
 *
 * That is the whole logic, and everything that makes it *fair* comes out of the
 * geometry for free. Flares are ejected downward and behind, and they decelerate
 * hard while the aircraft keeps flying, so:
 *
 * - a stern chase flies straight through the cloud and is defeated;
 * - a head-on shot arrives before the flares are anywhere near its path, so
 *   panicking early buys nothing;
 * - a round already inside `seduceRadius` of the aircraft is too close to be
 *   drawn off, which is what stops a flare being a last-instant get-out.
 *
 * Same philosophy as the terrain masking in 04.2: let the world decide, so the
 * player can see why it worked.
 *
 * ---------------------------------------------------------------------------
 * 04.6 — A DECOYED ROUND IS RE-TARGETED, NOT SWITCHED OFF.
 *
 * The first version set the missile's `lost` flag, reusing the overshoot rule on
 * the theory that a defeated round is a defeated round. It made flares useless,
 * and the reason is worth writing down: `lost` FREEZES a round's heading, and a
 * round that was tracking well is already pointed at the aircraft. Freezing it
 * changes almost nothing — it flies the same line and arrives anyway. The rule
 * was right for an overshoot (where the round is by definition pointed the wrong
 * way) and completely wrong for a decoy.
 *
 * A flare does not switch a seeker off; it gives it something brighter to look
 * at. So a flare now publishes the same `{ position, alive }` contract every
 * other target in this project does, and a seduced round simply has its `target`
 * swapped. The missile system needs no changes at all: it steers at whatever it
 * has been given, so the round visibly turns and chases the flare, and its
 * proximity fuze now tests against the flare rather than the aircraft.
 *
 * When the flare burns out it goes `alive = false`, and the missile system's
 * existing "no live target" branch stops guidance — so the round coasts out and
 * expires downrange. A miss that reads as a miss, for the third time in this
 * project, by the same mechanism.
 */
import * as THREE from "three";

export const FLARE = {
  /** Presses per sortie. Restored by a checkpoint restore and by R. */
  count: 8,
  /** Flares per press. A single point of light does not read as a countermeasure. */
  perBurst: 3,
  /** Long enough to be deliberate, short enough to double-tap under pressure. */
  cooldown: 1.4,
  life: 3.2,

  /**
   * A round within this of a burning flare is decoyed. Generous, because the
   * geometry is already doing the gating — the flares have to physically be on
   * the round's path, and after a second and a half they are hundreds of metres
   * behind the aircraft. Widened from 240 m in 04.6: at 240 the cloud's own
   * standoff behind the aircraft was about the same size as the radius, so a
   * round threading between two flares could pass through the cluster untouched.
   */
  seduceRadius: 320,
  /**
   * ...but a round already this close to the AIRCRAFT cannot be drawn off. This
   * is the one number that stops flares being a panic button: inside it the round
   * is committed and the answer is the barrel roll, not a countermeasure.
   *
   * Lowered from 220 m in 04.6. 220 was set without checking what it collided
   * with: the flare cloud sits roughly 200 m astern one second after release, so
   * a stern chase reached the flares at almost exactly the range at which the
   * rule declared it too late. The two numbers cancelled each other and the
   * mechanic never fired.
   */
  minStandoff: 160,

  /* Ejection, in the aircraft's own frame. Down and out, then it falls behind. */
  ejectDown: 26,
  ejectSide: 14,
  ejectBack: 8,
  spread: 7,
  /** Flares keep almost none of the aircraft's speed \u2014 that is why they fall behind. */
  inherit: 0.28,
  drag: 1.5,
  gravity: 22,

  /* Visual. */
  size: 12,
  sizeGrowth: 1.9,
  flicker: 26,
};

/* ---- the rule, as pure functions ---- */

/**
 * Does this flare draw this round off?
 *
 * @param flareRange  distance from the round to the flare
 * @param targetRange distance from the round to the aircraft
 */
export function seduces(flareRange, targetRange, cfg = FLARE) {
  if (flareRange > cfg.seduceRadius) return false;
  // Committed rounds cannot be decoyed, and a flare must be a better answer than
  // the aircraft to be worth chasing.
  if (targetRange < cfg.minStandoff) return false;
  return flareRange <= targetRange;
}

/** Ejection velocity for one flare of a burst, in world space. */
export function ejectVelocity(index, ownVelocity, right, up, forward, cfg = FLARE) {
  // Alternate sides so a burst spreads rather than forming a line.
  const side = index % 2 === 0 ? 1 : -1;
  const lateral = cfg.ejectSide * side * (1 + (index % 3) * 0.4);
  const jitter = ((index * 37) % 11) / 11 - 0.5;
  return {
    x: ownVelocity.x * cfg.inherit + right.x * lateral - up.x * cfg.ejectDown - forward.x * cfg.ejectBack + jitter * cfg.spread,
    y: ownVelocity.y * cfg.inherit + right.y * lateral - up.y * cfg.ejectDown - forward.y * cfg.ejectBack,
    z: ownVelocity.z * cfg.inherit + right.z * lateral - up.z * cfg.ejectDown - forward.z * cfg.ejectBack + jitter * cfg.spread,
  };
}

/* ---- the visual ---- */

function flareTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,250,1)");
  grad.addColorStop(0.2, "rgba(255,228,150,0.95)");
  grad.addColorStop(0.5, "rgba(255,150,60,0.45)");
  grad.addColorStop(1, "rgba(255,90,30,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param scene  flares live in WORLD space, not on the aircraft — the same
 *   reason the gun's tracers and the vapor ribbons do. They are left behind.
 */
export function createFlareSystem({ scene, cfg = FLARE } = {}) {
  const events = { dispense: [], decoy: [] };
  const emit = (kind, payload) => events[kind].forEach((fn) => fn(payload));

  const tex = scene ? flareTexture() : null;
  const pool = [];
  const live = [];
  const state = { remaining: cfg.count, cooldown: 0, burning: 0, decoys: 0, dispensed: 0 };

  function take() {
    const spent = pool.pop();
    if (spent) return spent;
    const sprite = tex
      ? new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
      : null;
    if (sprite) {
      sprite.frustumCulled = false;
      scene.add(sprite);
    }
    // `alive` and `label` make a flare a TARGET, which is the whole trick: a
    // seduced round's target is swapped to this object and the missile system
    // needs no idea that flares exist.
    return { sprite, position: new THREE.Vector3(), velocity: new THREE.Vector3(), t: 0, alive: true, label: "FLARE", radius: 2 };
  }

  function retire(f) {
    // Dying as a target matters more than disappearing as a sprite: a round
    // chasing this flare must lose its solution the moment it burns out.
    f.alive = false;
    if (f.sprite) f.sprite.visible = false;
    if (pool.length < 48) pool.push(f);
  }

  /**
   * @param ctx { position, velocity, right, up, forward }
   * @returns true when a burst was actually released
   */
  function dispense(ctx) {
    if (state.remaining <= 0 || state.cooldown > 0) return false;
    state.remaining -= 1;
    state.dispensed += 1;
    state.cooldown = cfg.cooldown;
    for (let i = 0; i < cfg.perBurst; i++) {
      const f = take();
      f.position.copy(ctx.position);
      const v = ejectVelocity(i, ctx.velocity, ctx.right, ctx.up, ctx.forward, cfg);
      f.velocity.set(v.x, v.y, v.z);
      f.t = 0;
      f.alive = true;
      if (f.sprite) {
        f.sprite.position.copy(f.position);
        f.sprite.visible = true;
        f.sprite.material.opacity = 1;
        f.sprite.scale.setScalar(cfg.size);
      }
      live.push(f);
    }
    emit("dispense", { remaining: state.remaining });
    return true;
  }

  /**
   * @param incoming live enemy rounds (any owner that is not the player)
   * @param player   the aircraft position, for the standoff rule
   */
  function update(incoming, player, dt) {
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);

    for (let i = live.length - 1; i >= 0; i--) {
      const f = live[i];
      f.t += dt;
      if (f.t >= cfg.life) {
        retire(f);
        live.splice(i, 1);
        continue;
      }
      // Hard drag plus gravity: a flare stops almost immediately in the air's
      // frame, which is exactly why the aircraft leaves it behind.
      const k = Math.max(0, 1 - cfg.drag * dt);
      f.velocity.multiplyScalar(k);
      f.velocity.y -= cfg.gravity * dt;
      f.position.addScaledVector(f.velocity, dt);
      if (f.sprite) {
        const age = f.t / cfg.life;
        f.sprite.position.copy(f.position);
        // Flicker, not a fade: a flare burns unevenly and then goes out.
        const burn = (1 - age) * (0.72 + 0.28 * Math.sin(f.t * cfg.flicker));
        f.sprite.material.opacity = Math.max(0, burn);
        f.sprite.scale.setScalar(cfg.size * (1 + age * cfg.sizeGrowth));
      }
    }
    state.burning = live.length;

    if (!live.length || !incoming || !incoming.length) return state;

    for (const m of incoming) {
      if (m.lost || m.decoyed) continue;
      const targetRange = player ? Math.hypot(m.position.x - player.x, m.position.y - player.y, m.position.z - player.z) : Infinity;
      for (const f of live) {
        const d = Math.hypot(m.position.x - f.position.x, m.position.y - f.position.y, m.position.z - f.position.z);
        if (!seduces(d, targetRange, cfg)) continue;
        /**
         * Hand the round the flare. Nothing else: the missile system steers at
         * whatever `target` it holds and fuzes against the same object, so the
         * round turns after the flare, chases it, and cannot hit the aircraft.
         * Setting `lost` here instead — the first version — froze its heading,
         * which for a round already pointed at you is no defence at all.
         */
        m.target = f;
        m.decoyed = true;
        state.decoys += 1;
        emit("decoy", { missile: m, range: d, flare: f });
        break;
      }
    }
    return state;
  }

  function reset() {
    for (const f of live) retire(f);
    live.length = 0;
    state.remaining = cfg.count;
    state.cooldown = 0;
    state.burning = 0;
    state.decoys = 0;
    state.dispensed = 0;
    return state;
  }

  return {
    state,
    cfg,
    live,
    dispense,
    update,
    reset,
    on(kind, fn) {
      events[kind].push(fn);
    },
  };
}
