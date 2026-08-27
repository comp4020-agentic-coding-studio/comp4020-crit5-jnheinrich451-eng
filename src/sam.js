/**
 * Stage 04.2 — SAM sites.
 *
 * The first ground threat, and the first enemy that cannot be out-flown. A
 * hostile fighter is beaten by turning better than it; a SAM site is beaten by
 * using the terrain, which is why this is the system that finally makes the
 * Ireland mesh part of the gameplay rather than the backdrop.
 *
 * Two design commitments, both from the playtest brief:
 *
 * 1. **Line of sight is the whole mechanic.** A site cannot acquire what it
 *    cannot see, and a round in flight that loses sight of the player keeps
 *    almost no guidance. That single rule is what turns a valley into cover and
 *    a ridge line into a decision. There is deliberately no "minimum engagement
 *    altitude" fudge: flying low works because the ground is actually in the
 *    way, not because a constant says low flying is safe.
 * 2. **It is destroyable.** A site publishes the same
 *    `{ position, velocity, alive, health }` contract the drone does, so the
 *    AIM-9, the cannon, the targeting system and the HUD bracket all work on it
 *    with no special cases, and killing one counts as a kill.
 *
 * Structurally this is the Stage 03.3 hostile again: one pure transition table,
 * every engagement condition inside it, and a launch is an *event* that the
 * caller interprets. Nothing here touches the flight model, the missile system
 * or the HUD.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The states, explicit and closed. */
export const SamState = {
  SEARCH: "SEARCH",
  TRACK: "TRACK",
  LOCK: "LOCK",
  LAUNCH: "LAUNCH",
  RELOAD: "RELOAD",
  DESTROYED: "DESTROYED",
};

export const SAM = {
  /**
   * Engagement envelope. `maxRange` is comfortably inside the round's own reach
   * so a launch is never a round that cannot arrive, and `minRange` is the dead
   * zone directly overhead — flying straight over the top of a site is a valid
   * way through it, which is a nice second answer beside terrain masking.
   */
  detectRange: 5000,
  minRange: 450,
  maxRange: 4400,

  /**
   * Acquisition is slow on purpose. The player has to be *seen for a while*
   * before anything is in the air, so a fast pass through a covered corridor is
   * survivable and loitering in the open is not. Together with the reload this
   * is the entire difficulty dial.
   */
  trackTime: 1.15,
  lockTime: 1.35,
  launchDelay: 0.45,
  reload: 9.0,
  rounds: 3,

  /**
   * How long a lock survives losing sight. Without a grace window a round of
   * terrain flicker would drop the engagement, and the site would read as
   * broken rather than as beaten.
   */
  lossGrace: 0.7,

  /** Health, in cannon terms: ~25 rounds on target, or one AIM-9. */
  health: 60,
  radius: 9,

  /** Line-of-sight sampling. 14 steps over up to 5 km is ~360 m per sample. */
  losSteps: 14,
  // Terrain within this distance BELOW the sightline still blocks it. A margin
  // in the player's favour: a graze counts as cover.
  losClearance: 10,

  /** Guidance left to a round that has lost sight of its target. */
  maskedAuthority: 0.1,

  // Cosmetic: how fast the launcher slews to face the player.
  slewRateDeg: 45,
};

/**
 * The SAM round. Same missile implementation, different numbers again — faster
 * than the hostile's air-to-air shot because it starts from a standstill and has
 * to climb, but a wider turn so a hard crossing manoeuvre still beats it.
 */
export const SAM_MISSILE = {
  separationTime: 0.35,
  separationDown: -14, // launches UP, which is what makes the smoke trail read
  separationOut: 0,
  separationDamping: 2.2,

  inheritFactor: 0,
  minLaunchSpeed: 70,
  thrust: 520,
  boostTime: 2.1,
  maxSpeed: 440,
  dragAfterBoost: 14,

  turnRateDeg: 22,
  lifetime: 11,
  hitRadius: 10,
  maxLeadTime: 1.4,

  overshootAngleDeg: 100,
  trailPoints: 52,
};

/* ---- line of sight: the mechanic, as a pure function ---- */

/**
 * Is the straight line from `from` to `to` clear of terrain?
 *
 * `sampleHeight(x, z)` is injected — it is `physics.sampleTerrainBelow` in the
 * game and a synthetic function in the tests, which is the only reason this rule
 * is testable at all. Endpoints are skipped: the site sits ON the ground, so
 * sampling its own position would report itself as an obstruction.
 */
export function lineOfSight(from, to, sampleHeight, cfg = SAM) {
  if (!sampleHeight) return true;
  const steps = cfg.losSteps;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    if (sampleHeight(x, z) > y - cfg.losClearance) return false;
  }
  return true;
}

/** Range band only. Visibility is a separate question and asked separately. */
export function inEngagementRange(range, cfg = SAM) {
  return range >= cfg.minRange && range <= cfg.maxRange;
}

/**
 * The whole transition table. Every engagement condition is in here and nowhere
 * else — no update loop may promote a state.
 *
 * @param sam { phase, timer, rounds, launched, lostFor }
 * @param ctx { alive, visible, inRange, playerAlive }
 */
export function samTransition(sam, ctx, cfg = SAM) {
  const S = SamState;
  if (!ctx.alive) return S.DESTROYED;
  const engageable = ctx.visible && ctx.inRange && ctx.playerAlive !== false;
  switch (sam.phase) {
    case S.DESTROYED:
      return S.DESTROYED;
    case S.SEARCH:
      // A spent site never acquires again. It is still a target, and still worth
      // a kill, but it has stopped being a threat.
      return engageable && sam.rounds > 0 ? S.TRACK : S.SEARCH;
    case S.TRACK:
      if (!engageable) return S.SEARCH;
      return sam.timer <= 0 ? S.LOCK : S.TRACK;
    case S.LOCK:
      // The grace window is what stops a flicker of terrain dropping the
      // engagement. Beyond it, the player has genuinely broken the lock.
      if (sam.lostFor > cfg.lossGrace) return S.SEARCH;
      if (!ctx.inRange) return S.SEARCH;
      // A site that has nothing left to fire must not hold a lock. SEARCH is the
      // only honest place for it: still a target, no longer a threat (§13).
      if (sam.rounds <= 0) return S.SEARCH;
      return sam.timer <= 0 ? S.LAUNCH : S.LOCK;
    case S.LAUNCH:
      /**
       * LAUNCH MUST BE ESCAPABLE WITHOUT FIRING.
       *
       * This case used to be `sam.launched ? S.RELOAD : S.LAUNCH` and nothing
       * else, so a site that reached LAUNCH with an empty magazine could never
       * leave: the firing branch in update() is gated on `rounds > 0`, so
       * `launched` stayed false, so the transition returned LAUNCH again, every
       * frame, forever.
       *
       * The symptom is exactly what makes it hard to attribute: the site is not
       * visibly doing anything wrong. It holds the player in LOCK, so the threat
       * monitor keeps reporting a lock, the warning keeps sounding, the HUD keeps
       * the diamond up -- and no missile ever comes, because there is none to
       * come. Reported from play as "it just locks and warns without shooting",
       * halfway through a mission, which is when a site is most likely to be
       * spent.
       *
       * §13 already required that a spent site never acquire again, and SEARCH
       * enforces it going IN. This is the same rule enforced on the way OUT.
       */
      if (sam.rounds <= 0) return S.RELOAD;
      return sam.launched ? S.RELOAD : S.LAUNCH;
    case S.RELOAD:
      return sam.timer <= 0 ? S.SEARCH : S.RELOAD;
    default:
      return S.SEARCH;
  }
}

/** What the player's threat display should call this state. */
export function samThreatLevel(phase) {
  const S = SamState;
  if (phase === S.TRACK) return "TRACK";
  if (phase === S.LOCK || phase === S.LAUNCH) return "LOCK";
  return "NONE";
}

/* ---- the visual ---- */

/** Squat tracked launcher with two rails. Reads as hostile, reads as ground. */
function buildSamVisual(cfg = SAM) {
  const group = new THREE.Object3D();
  group.name = "SamVisual";

  const shell = new THREE.MeshStandardMaterial({ color: 0x3f4a3c, roughness: 0.8, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2320, roughness: 0.6, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x8f2b28, roughness: 0.5, metalness: 0.2 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.2, 9.2), shell);
  hull.position.y = 1.6;
  group.add(hull);

  for (const s of [-1, 1]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 9.6), dark);
    track.position.set(s * 3.1, 0.75, 0);
    group.add(track);
  }

  // The turret is a child so it can slew independently of the hull.
  const turret = new THREE.Object3D();
  turret.name = "SamTurret";
  turret.position.y = 2.8;
  group.add(turret);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 1.2, 12), shell);
  group.add(base);
  base.position.y = 3.0;

  // Rails, angled up: a launcher at rest still reads as pointing somewhere.
  const rails = new THREE.Object3D();
  rails.name = "SamRails";
  rails.rotation.x = -32 * DEG;
  turret.add(rails);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 6.4), dark);
    rail.position.set(s * 1.0, 0.4, -1.2);
    rails.add(rail);
    const round = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 5.4, 10), shell);
    round.rotation.x = Math.PI / 2;
    round.position.set(s * 1.0, 0.95, -1.2);
    rails.add(round);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 10), accent);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(s * 1.0, 0.95, -4.4);
    rails.add(tip);
  }

  return { group, turret };
}

/**
 * Stage 04.8 — the sites use a real launcher model.
 *
 * 6.9 m along its longest axis, measured from the source bounds like every
 * other asset (§2).
 *
 * ONE STRUCTURAL SURPRISE, and it drives the whole design below: the source is
 * a merged OBJ — 35 flat sibling meshes under one parent, with no named turret,
 * radar or rail node. So there is nothing to slew independently. Rather than
 * fake a turret by guessing which of 35 unnamed meshes is the rotating part,
 * the WHOLE launcher traverses on its Y axis, which is both honest to the asset
 * and correct for a trailer-mounted launcher: the rails come round to bear.
 */
export const SAM_MODEL = {
  url: "assets/sam/scene.gltf",
  targetLength: 6.9,
  modelYaw: 0,
  /**
   * Launch point on the normalised launcher, in turret space. Higher and
   * further forward than the procedural blockout's (0, 4.2, -2.0), because a
   * 6.9 m vehicle is a much smaller thing than the 9.2 m box it replaces — a
   * round leaving the old point would appear from above the launcher.
   */
  hardpoint: { x: 0, y: 2.6, z: -1.1 },
};

/**
 * Scale to `targetLength`, centre on X/Z, and put the BOTTOM of the bounding
 * box at y = 0.
 *
 * Bottom-at-zero, not centre-at-zero: a site's root sits at the sampled ground
 * height, so a centre-recentred model is buried to its axles. This is the one
 * place the aircraft's normalisation rule is deliberately not reused — an
 * aeroplane rotates about its middle, a vehicle stands on its tracks.
 */
export function normalizeSamModel(model, cfg = SAM_MODEL) {
  const root = new THREE.Object3D();
  root.name = "SamLauncherVisual";
  const correction = new THREE.Object3D();
  correction.name = "SamModelCorrection";
  correction.rotation.y = cfg.modelYaw;
  root.add(correction);
  correction.add(model);

  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z);
  const scale = longest > 0 ? cfg.targetLength / longest : 1;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  scaled.getCenter(center);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= scaled.min.y;

  const final = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(final);
  return {
    root,
    metrics: {
      sourceSize: size.toArray().map((v) => +v.toFixed(3)),
      scale: +scale.toFixed(6),
      normalizedSize: final.toArray().map((v) => +v.toFixed(2)),
      length: +Math.max(final.x, final.z).toFixed(2),
      height: +final.y.toFixed(2),
      target: cfg.targetLength,
    },
  };
}

/**
 * Loads the launcher prototype. Resolves `null` on failure — the procedural
 * blockout stays, and the terrain run remains dangerous either way (§2).
 */
export function loadSamLauncher(cfg = SAM_MODEL) {
  return new Promise((resolve) => {
    new GLTFLoader().load(
      cfg.url,
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (o.isMesh) o.castShadow = false;
        });
        const { root, metrics } = normalizeSamModel(gltf.scene, cfg);
        console.log("[sam] launcher normalized", metrics);
        resolve({ prototype: root, metrics });
      },
      undefined,
      (err) => {
        console.warn(`[sam] ${cfg.url} not found — keeping the placeholder launcher.`, err);
        resolve(null);
      }
    );
  });
}

/**
 * Swaps one site's procedural blockout for a clone of the loaded launcher.
 *
 * The model goes UNDER the existing turret node rather than replacing it, so
 * `samTransition`'s slew (`site.turret.rotation.y = site.aimHeading`) keeps
 * working untouched — the transition table does not learn that the visual
 * changed, which is the whole point of it owning state and nothing else.
 */
export function installSamVisual(site, prototype, cfg = SAM_MODEL) {
  if (!site || !prototype) return false;
  // Reparent the turret to the root FIRST: it is currently a child of the
  // procedural group, and removing that group would take the turret and the
  // hardpoint with it.
  site.root.add(site.turret);
  site.root.remove(site.visual);
  // The blockout's RAILS hang off the turret, not off the group, so removing
  // the group leaves them behind. They then drop with the turret to ground
  // level and end up buried 2.2 m under the launcher -- present, invisible, and
  // impossible to attribute to anything. Remove them explicitly.
  const rails = site.turret.getObjectByName("SamRails");
  if (rails) site.turret.remove(rails);
  // The procedural turret rode on top of a 2.8 m hull. The model stands on its
  // own base, so the slew axis belongs at ground level.
  site.turret.position.set(0, 0, 0);
  site.turret.add(prototype);
  site.visual = prototype;
  site.modelBacked = true;
  site.hardpoint.position.set(cfg.hardpoint.x, cfg.hardpoint.y, cfg.hardpoint.z);
  return true;
}

/**
 * One site. `position` is where it stands; everything else it works out.
 *
 * The launch point is a child transform, not a coordinate: the same rule the
 * aircraft's hardpoints follow, so a round always leaves the rails wherever the
 * launcher happens to be pointing.
 */
export function createSamSite({ position, name = "SAM", cfg = SAM }) {
  const root = new THREE.Object3D();
  root.name = name;
  root.position.set(position.x, position.y, position.z);
  const { group, turret } = buildSamVisual(cfg);
  root.add(group);

  const hardpoint = new THREE.Object3D();
  hardpoint.name = "SamHardpoint";
  hardpoint.position.set(0, 4.2, -2.0);
  turret.add(hardpoint);

  const site = {
    kind: "SAM",
    root,
    turret,
    // Held so the model swap can remove exactly what it replaces. Without a
    // handle on the procedural group, installSamVisual() would have to guess
    // which children to drop.
    visual: group,
    modelBacked: false,
    hardpoint,
    cfg,
    // The target contract, identical to the drone's, so targeting.js, gun.js,
    // missile.js and the HUD bracket all work with no special cases.
    position: root.position,
    velocity: new THREE.Vector3(),
    speed: 0,
    alive: true,
    health: cfg.health,
    maxHealth: cfg.health,
    hitAt: -1,
    label: "SAM SITE",
    radius: cfg.radius,
    // AI state.
    phase: SamState.SEARCH,
    timer: 0,
    rounds: cfg.rounds,
    launched: false,
    visible: false,
    lostFor: 0,
    range: 0,
    lockProgress: 0,
    aimHeading: 0,
  };
  return site;
}

/** A destroyed site stays in the world as a wreck: a kill should be visible. */
export function wreckSamSite(site) {
  site.alive = false;
  site.health = 0;
  site.phase = SamState.DESTROYED;
  // Hiding the turret is how the blockout loses its rails. A model-backed site
  // keeps its launcher visible, because the turret IS the whole vehicle there
  // (the source has no separate turret node) — hiding it would delete the
  // wreck, and §13 requires a kill to leave something in the world.
  if (!site.modelBacked) site.turret.visible = false;
  // Explicitly visible: the generic kill path hides a destroyed target, and a
  // ground installation should stay in the world as evidence.
  site.root.visible = true;
  site.root.rotation.z = 0.12;
  site.root.traverse((o) => {
    if (o.isMesh && o.material && o.material.color) {
      o.material = o.material.clone();
      o.material.color.multiplyScalar(0.35);
    }
  });
  return site;
}

export function resetSamSite(site) {
  const { cfg } = site;
  site.alive = true;
  site.health = cfg.health;
  site.phase = SamState.SEARCH;
  site.timer = 0;
  site.rounds = cfg.rounds;
  site.launched = false;
  site.visible = false;
  site.lostFor = 0;
  site.lockProgress = 0;
  site.root.visible = true;
  site.root.rotation.set(0, 0, 0);
  site.turret.visible = true;
  return site;
}

/* ---- the network ---- */

/**
 * All the sites, as one updatable thing.
 *
 * @param sampleHeight (x, z) => ground height, for the line-of-sight test
 */
export function createSamNetwork({ sites = [], sampleHeight = null, cfg = SAM } = {}) {
  const events = { launch: [], kill: [] };
  const emit = (kind, payload) => events[kind].forEach((fn) => fn(payload));
  const state = { active: false, tracking: 0, locked: 0, alive: 0, launches: 0 };
  let list = sites.slice();

  function setSites(next) {
    list = next.slice();
    return list;
  }

  function enter(site, phase) {
    if (phase === site.phase) return;
    site.phase = phase;
    const S = SamState;
    if (phase === S.TRACK) site.timer = cfg.trackTime;
    if (phase === S.LOCK) site.timer = cfg.lockTime + cfg.launchDelay;
    if (phase === S.RELOAD) site.timer = cfg.reload;
    if (phase !== S.LOCK && phase !== S.LAUNCH) site.lockProgress = 0;
  }

  function update(player, dt) {
    state.tracking = 0;
    state.locked = 0;
    state.alive = 0;
    if (!state.active) return state;

    for (const site of list) {
      if (!site.alive) continue;
      state.alive += 1;
      const dx = player.position.x - site.position.x;
      const dy = player.position.y - site.position.y;
      const dz = player.position.z - site.position.z;
      site.range = Math.hypot(dx, dy, dz);

      const inRange = inEngagementRange(site.range, cfg);
      // Only sites that could actually shoot pay for a line-of-sight test. Six
      // sites × 14 samples every frame would be 84 terrain queries; gating on
      // detection range makes it a handful.
      site.visible = site.range <= cfg.detectRange && inRange ? lineOfSight(site.position, player.position, sampleHeight, cfg) : false;
      site.lostFor = site.visible ? 0 : site.lostFor + dt;

      if (site.timer > 0) site.timer = Math.max(0, site.timer - dt);

      site.launched = false;
      // Only the LAUNCH state fires, and it fires once. An earlier version also
      // fired on "LOCK with an expired timer", which is the same frame the
      // transition promotes LOCK to LAUNCH — so every engagement spent two rounds
      // and the reload never covered it.
      if (site.phase === SamState.LAUNCH && site.rounds > 0) {
        site.rounds -= 1;
        site.launched = true;
        state.launches += 1;
        site.root.updateMatrixWorld(true);
        emit("launch", { site });
      }

      // Acquisition progress, published for the HUD exactly like the hostile's.
      if (site.phase === SamState.TRACK) site.lockProgress = 1 - site.timer / cfg.trackTime;
      else if (site.phase === SamState.LOCK) site.lockProgress = 1;

      enter(site, samTransition(site, { alive: site.alive, visible: site.visible, inRange, playerAlive: player.alive !== false }, cfg));

      if (site.phase === SamState.TRACK) state.tracking += 1;
      if (site.phase === SamState.LOCK || site.phase === SamState.LAUNCH) state.locked += 1;

      // Cosmetic slew: the launcher turns toward whatever it is looking at, and
      // stops where it is when it loses the target.
      if (site.visible) {
        const want = Math.atan2(-dx, -dz);
        const delta = ((want - site.aimHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const step = cfg.slewRateDeg * DEG * dt;
        site.aimHeading += clamp(delta, -step, step);
        site.turret.rotation.y = site.aimHeading;
      }
    }
    return state;
  }

  /** The nearest site currently threatening the player, for the HUD. */
  function threatSource() {
    let best = null;
    for (const site of list) {
      if (!site.alive) continue;
      const level = samThreatLevel(site.phase);
      if (level === "NONE") continue;
      if (!best || site.range < best.range) best = site;
    }
    return best;
  }

  return {
    state,
    cfg,
    get sites() {
      return list;
    },
    setSites,
    update,
    threatSource,
    setActive(on) {
      state.active = !!on;
      for (const site of list) site.root.visible = state.active && site.alive;
      return state.active;
    },
    /** Live, engageable sites — what targeting is handed as candidates. */
    get targets() {
      return state.active ? list.filter((s) => s.alive) : [];
    },
    reset() {
      for (const site of list) resetSamSite(site);
      state.tracking = state.locked = 0;
      state.launches = 0;
      return state;
    },
    on(kind, fn) {
      events[kind].push(fn);
    },
  };
}
