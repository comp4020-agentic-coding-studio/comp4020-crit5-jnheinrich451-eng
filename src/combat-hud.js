/**
 * Stage 03.05 — combat HUD.
 *
 * SVG overlay in three explicit layers, in paint order:
 *
 *   ScreenFixedLayer   viewport-anchored: reticle, speed, altitude, mode,
 *                      bank scale ticks, heading tape, the combat stack
 *   AttitudeLayer      screen-anchored origin, moved BY attitude: pitch ladder
 *                      (vertical translation), bank pointer, velocity marker
 *   WorldTrackedLayer  the only layer driven by world-to-screen projection:
 *                      the hostile bracket and its off-screen cue
 *
 * The HUD origin is a viewport fraction, never `aircraftRoot.project(camera)` —
 * that projection is what made the old HUD orbit the F-15 (§4). It reads state
 * and owns nothing: no targeting logic, no physics writes (§6).
 */
import * as THREE from "three";
import { LockState } from "./targeting.js";

const NS = "http://www.w3.org/2000/svg";
const DEG = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const COLOR = {
  line: "#8ef0c8",
  dim: "rgba(142, 240, 200, 0.42)",
  faint: "rgba(142, 240, 200, 0.22)",
  target: "#6fe0ff",
  lock: "#b6ffd0",
  // TRACK is deliberately quieter than LOCK: same hue, less presence, so the
  // escalation is legible without reading the word (§11).
  track: "rgba(255, 176, 122, 0.68)",
  warn: "#ffb07a",
  // Incoming-missile red. The only red in the HUD, so it can never be confused
  // with a lock, an advisory or an ammo state (§11).
  danger: "#ff6b5a",
  ab: "#ffb45a",
  // Gun lead cue: warm cream, so it is confusable with neither the green
  // boresight nor the cyan target bracket (§15).
  pipper: "#ffe2a8",
  // Atmospheric advisories read as information, not threat: cool blue, never
  // the amber reserved for warnings.
  moist: "#9fd7ff",
  // Stage 04.8 — navigation. It was the least saturated mark on the HUD, on the
  // reasoning that a waypoint is not a threat and must never compete with a lock
  // cue. That was half right: it did not compete, and players did not notice it
  // at all. Navigation the player cannot see is not restraint, it is a missing
  // feature.
  //
  // Saturated YELLOW rather than the requested orange, deliberately. Orange is
  // one step from `danger` (#ff9b7a) and adjacent to `warn` (#ffd79a), so a
  // bright orange waypoint would read as a threat — the exact confusion the
  // original restraint was protecting against. Pure yellow is unmistakably
  // visible, is the traditional steering colour, and shares no hue with anything
  // that means "something is shooting at you".
  nav: "#ffd400",
  navDim: "rgba(255, 212, 0, 0.72)",
  // Stage 04.9 — radar. Contacts are amber: "something is there" is a warning,
  // not yet a danger. Deliberately NOT salmon — the radar reports detection only,
  // and salmon means a lock or a live round, which the HUD says elsewhere.
  radar: "rgba(232, 240, 246, 0.30)",
  radarGrid: "rgba(232, 240, 246, 0.14)",
  contact: "#ffd79a",
};

export const HUD = {
  // Slightly above centre: the chase-camera F-15 sits in the lower middle, so
  // an elevated HUD origin leaves the aircraft inside the composition (§4/§5).
  centerY: 0.45,

  // Damping response rates (1/s). Higher = tighter.
  pitchLambda: 8,
  bankLambda: 10,
  headingLambda: 9,
  numberLambda: 7,
  targetLambda: 15,
  lockLambda: 12,
  velocityLambda: 9,

  // §10: the ladder translates, it does not roll with the aircraft. Exposed for
  // playtesting at 0.1 / 0.2; the default is a flat 0.
  ladderRollInfluence: 0.0,

  pxPerDeg: 7.6,
  headingPxPerDeg: 3.1,
  boxMin: 26,
  boxMax: 150,
  messageTime: 1.6,
  lockPulseTime: 0.22,
  // How far along the flight path the velocity marker is projected.
  velocityProbe: 500,
  velocityClamp: 0.3, // fraction of viewport from HUD centre

  // Stage 03.2 — gun lead pipper. Small on purpose (§15): it is a solution
  // marker, not a second reticle.
  pipperRadius: 8.5,
  pipperLambda: 14,
  // Ranging circle drawn round the boresight in GUN mode, so the two weapon
  // modes do not look identical (§17).
  gunRingRadius: 34,

  /**
   * Stage 03.3 — threat warning block. Upper centre, clear of the reticle, the
   * pitch ladder and the target bracket (§12): at 1080 the word sits at y 133
   * and the reticle's top arm at 462.
   */
  threatY: 52,
  // Pulse periods per urgency tier (§25). Slow, faster, insistent — and never a
  // full-screen flash.
  pulseFar: 1.0,
  pulseNear: 0.55,
  pulseUrgent: 0.3,
  // Peak opacity of the red veil on a hit (§32). Low: feedback, not a blackout.
  hitVeil: 0.3,

  /**
   * Stage 04.0 §17/§18 — navigation. Small, quiet and infrequent. The
   * environment is meant to do the navigating; this is a confirmation, not a
   * rail. No giant checkpoint rings unless playtesting proves the player gets
   * lost.
   */
  navRadius: 12,
  navLambda: 11,
  navEdgeX: 0.24, // offscreen cue radius, as a fraction of the viewport
  navEdgeY: 0.22,
  navHideRange: 260, // inside this the marker is redundant and just clutters
  missionCueY: 0.155,
  missionCueFade: 0.45, // seconds of fade at each end of the cue

  /**
   * Stage 04.9 — radar. Heading-up polar plot, bottom right.
   *
   * No sweep and no scan line: contacts appear the instant they are detected and
   * vanish the instant they are not, so the display states the present rather
   * than remembering where a rotating beam last looked. A sweep would also lie —
   * it implies a sensor model this game does not have.
   *
   * Range is the hostile's own detection range plus a margin, so "on the radar"
   * and "in the fight" mean the same thing.
   */
  radarRadius: 74,
  radarMargin: 20,
  radarRange: 6000,
  radarBlips: 14,

  /**
   * Stage 04.0 — the left gutter the fixed layer may not enter, and the reason
   * the flanking columns are EDGE-anchored rather than centred.
   *
   * `spdX` used to be a text centre, so half of every string spilled to the left
   * of it — which meant respecting a gutter needed `flank <= room - textWidth/2`,
   * a quantity nothing knew. Three rounds of clamping the centre could not close
   * it, and a `flankMin` floor made it structurally impossible: the floor won
   * whenever room was tight and put the column back inside the rail.
   *
   * Now the left column is left-aligned AT `spdX` and the right column
   * right-aligned at `altX`. The gutter is a hard edge the text starts on, so
   * overlap is impossible by construction rather than by arithmetic, and the
   * floor only has to keep the columns off the boresight.
   */
  flankMin: 44,

  /**
   * THE VIEWPORT THE HUD WAS DRAWN FOR, and the floor it may shrink to.
   *
   * Sizes here are pixels at a 1080-tall desktop. The positions around them are
   * already proportional (`w * 0.18`, `h * 0.075`), so at the 390x844 phone
   * viewport the layout was right and the FURNITURE was wrong: a 19 px readout
   * and a 74 px radar on a 390 px-wide frame crowd the boresight and run off the
   * corner. Both marking viewports have to work, and the phone is where most of
   * the web arrives.
   *
   * Scaled on the SMALLER dimension, so a phone gets the same treatment held
   * either way up rather than looking correct in landscape and broken in
   * portrait. The floor stops the instruments becoming unreadable in the pursuit
   * of fitting: below it, they may crowd.
   */
  uiReference: 820,
  uiScaleMin: 0.58,
};

/* ---- pure presentation math (§6–§8, §13) ---- */

/**
 * How large to draw the instruments, given a viewport.
 *
 * The HUD's POSITIONS are proportional already (`w * 0.18`, `h * 0.075`), so
 * they were right on a phone. Its FURNITURE was not: a 19 px readout and a
 * 74 px radar are a corner of a 1080-tall desktop and a third of a 390-wide
 * phone, which crowded the boresight and ran the radar off the frame.
 *
 * Driven by the SMALLER dimension, so a phone is treated the same held either
 * way up — scaling on width alone would leave portrait correct and landscape
 * oversized, and both are marked. Never above 1: a larger monitor wants the
 * same HUD, not a bigger one.
 */
export function uiScaleFor(w, h, cfg = HUD) {
  return Math.max(cfg.uiScaleMin, Math.min(1, Math.min(w, h) / cfg.uiReference));
}

/** Frame-rate-independent exponential approach. */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** damp() across the ±180° seam, so 359° -> 1° takes the short way. */
export function dampAngle(current, target, lambda, dt) {
  const delta = ((((target - current + 180) % 360) + 360) % 360) - 180;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

/** Display pitch from the aircraft's forward vector. HUD only — never physics. */
export function derivePitchDeg(forward) {
  return Math.asin(Math.min(1, Math.max(-1, forward.y))) / DEG;
}

/**
 * Signed bank about the forward axis, valid through knife-edge, inverted flight
 * and loops. `fallbackDeg` is returned when the reference is degenerate — near
 * vertical, world up projects to nothing on the wing plane and any answer would
 * be arbitrary, so the last stable value is held instead of flipping (§13).
 */
export function deriveBankDeg(forward, up, fallbackDeg = 0) {
  // World up with the forward component removed: the horizon reference in the
  // aircraft's own wing plane.
  const d = forward.y; // worldUp . forward
  const rx = -forward.x * d;
  const ry = 1 - forward.y * d;
  const rz = -forward.z * d;
  const len2 = rx * rx + ry * ry + rz * rz;
  if (len2 < 1e-5) return fallbackDeg;
  const l = Math.sqrt(len2);
  const ux = rx / l, uy = ry / l, uz = rz / l;

  const cx = uy * up.z - uz * up.y;
  const cy = uz * up.x - ux * up.z;
  const cz = ux * up.y - uy * up.x;
  const sin = forward.x * cx + forward.y * cy + forward.z * cz;
  const cos = ux * up.x + uy * up.y + uz * up.z;
  return Math.atan2(sin, cos) / DEG;
}

/** Heading in 0..360 from the forward vector, matching the flight model. */
export function deriveHeadingDeg(forward) {
  const deg = Math.atan2(-forward.x, -forward.z) / DEG;
  return ((-deg % 360) + 360) % 360;
}

const _ndc = new THREE.Vector3();

/** World point -> screen px. `behind` is the mirrored case markers must skip. */
export function projectToScreen(camera, position, width, height, out = {}) {
  _ndc.copy(position).project(camera);
  out.behind = _ndc.z > 1;
  out.ndcX = _ndc.x;
  out.ndcY = _ndc.y;
  out.offset = Math.hypot(_ndc.x, _ndc.y);
  out.x = (_ndc.x * 0.5 + 0.5) * width;
  out.y = (-_ndc.y * 0.5 + 0.5) * height;
  return out;
}

/** Apparent pixel size of an object of `metres` diameter at `range`. */
export function apparentSize(metres, range, height, fovDeg) {
  const f = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
  return Math.max(HUD.boxMin, Math.min(HUD.boxMax, (metres / Math.max(range, 1)) * f));
}

/* ---- element helpers ---- */

const el = (tag, attrs = {}, parent = null) => {
  const node = document.createElementNS(NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
};

const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Every HUD glyph records the size it was DESIGNED at, so `resize` can rescale
 * the whole instrument set from one number instead of from a list that has to
 * be kept in step with the code that creates them. A font-size written straight
 * into an attribute is invisible to a later pass; `data-base-size` is not.
 */
const text = (parent, attrs = {}) => {
  const node = el("text", { fill: COLOR.line, "font-family": MONO, "font-size": "13", "letter-spacing": "1.4", "text-anchor": "middle", ...attrs }, parent);
  node.dataset.baseSize = String(attrs["font-size"] ?? 13);
  node.dataset.baseSpacing = String(attrs["letter-spacing"] ?? 1.4);
  return node;
};

export function createCombatHud(host = document.body, cfg = HUD) {
  const svg = el("svg", { id: "combat-hud", "shape-rendering": "geometricPrecision" });
  svg.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:5";
  // Visibility is driven by style.display, not the `hidden` attribute: the HTML
  // UA stylesheet's [hidden] rule does not reach into SVG, so `svg.hidden` sets
  // the attribute and renders the HUD anyway.
  let shown = false;
  svg.style.display = "none";
  host.appendChild(svg);

  /* ================= layer roots ================= */
  // The hit veil is painted first, under every HUD layer: a damage cue must not
  // make the instruments harder to read (§32).
  const hitVeil = el("rect", { x: 0, y: 0, width: "100%", height: "100%", fill: COLOR.danger, opacity: "0" }, svg);
  const worldLayer = el("g", { id: "hud-world" }, svg);
  const attitudeLayer = el("g", { id: "hud-attitude" }, svg);
  const fixedLayer = el("g", { id: "hud-fixed" }, svg);

  /* ---- ScreenFixedLayer ---- */
  const reticle = el("g", { id: "hud-reticle", fill: "none", stroke: COLOR.line, "stroke-width": "1.4" }, fixedLayer);
  const bankScale = el("g", { id: "hud-bank-scale", fill: "none", stroke: COLOR.dim, "stroke-width": "1.2" }, fixedLayer);
  const heading = el("g", { id: "hud-heading", fill: "none", stroke: COLOR.line, "stroke-width": "1.1" }, fixedLayer);
  const readouts = el("g", { id: "hud-readouts" }, fixedLayer);

  // Boresight cross: aim reference, deliberately small.
  for (const [x1, y1, x2, y2] of [[-24, 0, -9, 0], [24, 0, 9, 0], [0, -24, 0, -9], [0, 24, 0, 9]]) {
    el("line", { x1, y1, x2, y2 }, reticle);
  }
  el("circle", { r: 1.8, cx: 0, cy: 0, fill: COLOR.line, stroke: "none" }, reticle);

  // GUN-mode ranging circle: dashed, dim, and only ever visible with the gun
  // selected — the one piece of the fixed layer that changes with weapon.
  const gunRing = el(
    "circle",
    { r: cfg.gunRingRadius, cx: 0, cy: 0, fill: "none", stroke: COLOR.dim, "stroke-width": "1", "stroke-dasharray": "3 7" },
    reticle
  );

  // Bank scale: a fixed shallow arc above the reticle, ticks at ±10/20/30/45/60.
  // The scale never moves; only the pointer does (§11).
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const r = 132;
    const rad = (a - 90) * DEG;
    const len = a === 0 ? 13 : a % 30 === 0 ? 10 : 6;
    el(
      "line",
      {
        x1: (Math.cos(rad) * r).toFixed(2),
        y1: (Math.sin(rad) * r).toFixed(2),
        x2: (Math.cos(rad) * (r - len)).toFixed(2),
        y2: (Math.sin(rad) * (r - len)).toFixed(2),
        stroke: a === 0 ? COLOR.line : COLOR.dim,
      },
      bankScale
    );
  }

  // Heading tape: ticks every 5°, labels every 10°, fixed caret.
  const headingTicks = [];
  for (let i = -6; i <= 6; i++) {
    const g = el("g", {}, heading);
    const tick = el("line", { x1: 0, y1: 0, x2: 0, y2: 8 }, g);
    const label = text(g, { x: 0, y: 23, "font-size": "11", fill: COLOR.dim, stroke: "none" });
    headingTicks.push({ g, tick, label });
  }
  el("path", { d: "M 0 -3 L -6 -12 L 6 -12 Z", fill: COLOR.line, stroke: "none" }, heading);
  const headingValue = text(heading, { y: -20, "font-size": "13", stroke: "none" });

  const spdLabel = text(readouts, { "font-size": "10", fill: COLOR.dim, "letter-spacing": "2.2" });
  const altLabel = text(readouts, { "font-size": "10", fill: COLOR.dim, "letter-spacing": "2.2" });
  const spdValue = text(readouts, { "font-size": "19" });
  const altValue = text(readouts, { "font-size": "19" });
  const spdRule = el("line", { stroke: COLOR.faint, "stroke-width": "1" }, readouts);
  const altRule = el("line", { stroke: COLOR.faint, "stroke-width": "1" }, readouts);
  const thrValue = text(readouts, { "font-size": "11", fill: COLOR.dim });
  const modeValue = text(readouts, { "font-size": "11", "letter-spacing": "3" });

  // Atmospheric advisory (§26): its own small slot under the heading tape,
  // deliberately away from the bottom combat stack so it can never displace
  // lock information. Both modes show it (§31).
  const advisoryValue = text(readouts, { "font-size": "12", "letter-spacing": "2.6", fill: COLOR.moist });
  const advisoryRule = el("line", { stroke: COLOR.moist, "stroke-width": "1", opacity: "0.5" }, readouts);

  // Combat stack: exactly three slots, filled per state (§25).
  const stackTop = text(readouts, { "font-size": "16", "letter-spacing": "3.4" });
  const stackMid = text(readouts, { "font-size": "13", "letter-spacing": "1.6" });
  const stackBottom = text(readouts, { "font-size": "13", "letter-spacing": "1.6" });

  /**
   * Stage 03.3 — the threat block (§11–§13, §24). Its own region, upper centre,
   * so it never competes with the reticle or the stores stack: TRACK / LOCK /
   * MISSILE, and for an incoming round a direction arrow and a range.
   */
  const threatGroup = el("g", { id: "hud-threat" }, fixedLayer);
  const threatWord = text(threatGroup, { "font-size": "17", "letter-spacing": "5", dx: "-2.5", fill: COLOR.warn });
  const threatArrow = text(threatGroup, { "font-size": "15", fill: COLOR.danger });
  const threatRange = text(threatGroup, { "font-size": "12.5", "letter-spacing": "2", dx: "-1", fill: COLOR.danger });
  // A hit is loud, once, in the middle of the frame — then gone (§32).
  const hitLabel = text(fixedLayer, { "font-size": "30", "letter-spacing": "9", dx: "-4.5", fill: COLOR.danger });

  /**
   * Stage 04.0 §17 — the phase cue. One word, high on the frame, for a couple of
   * seconds after a transition. It is not tutorial text (§15) and it is not a
   * persistent objective banner: the player is told where they are, once, and
   * then left alone to fly.
   */
  const missionCue = text(fixedLayer, { "font-size": "17", "letter-spacing": "8", dx: "-4", fill: COLOR.nav });

  /* ---- Stage 04.9: radar ---- */
  const radar = el("g", { id: "hud-radar" }, fixedLayer);
  const radarRing = el("circle", { r: cfg.radarRadius, fill: "rgba(6, 12, 16, 0.30)", stroke: COLOR.radar, "stroke-width": "1.2" }, radar);
  const radarMid = el("circle", { r: cfg.radarRadius * 0.5, fill: "none", stroke: COLOR.radarGrid, "stroke-width": "1" }, radar);
  const radarCrossV = el("line", { stroke: COLOR.radarGrid, "stroke-width": "1" }, radar);
  const radarCrossH = el("line", { stroke: COLOR.radarGrid, "stroke-width": "1" }, radar);
  // Own-ship: a nose marker, so "up is where I am pointing" is stated rather than
  // assumed. This is the "direction" half of the display.
  const radarNose = el("path", { d: "M 0 -7 L -4.5 3 L 4.5 3 Z", fill: COLOR.good, stroke: "none" }, radar);
  const radarLabel = text(radar, { "font-size": "9", "letter-spacing": "2", fill: COLOR.radar });

  /**
   * Blips are pooled and reused. Two shapes, ONE colour: a diamond for air, a
   * square for ground. The radar reports detection only — it deliberately says
   * nothing about tracking or lock, because the HUD's bracket and diamond already
   * carry that, and duplicating it here would give the player two places to read
   * the same fact and a chance for them to disagree.
   */
  const blips = [];
  for (let i = 0; i < cfg.radarBlips; i++) {
    const g = el("g", { fill: COLOR.contact, stroke: "none" }, radar);
    const air = el("path", { d: "M 0 -4 L 4 0 L 0 4 L -4 0 Z" }, g);
    const ground = el("rect", { x: -3.2, y: -3.2, width: 6.4, height: 6.4 }, g);
    g.style.display = "none";
    blips.push({ g, air, ground });
  }

  /* ---- AttitudeLayer ---- */
  const ladder = el("g", { id: "hud-ladder", fill: "none", stroke: COLOR.line, "stroke-width": "1.2" }, attitudeLayer);
  const bankPointer = el("g", { id: "hud-bank-pointer", fill: COLOR.line, stroke: "none" }, attitudeLayer);
  const velocityMarker = el("g", { id: "hud-velocity", fill: "none", stroke: COLOR.line, "stroke-width": "1.5" }, attitudeLayer);

  const rungs = [];
  for (const a of [-30, -20, -10, 0, 10, 20, 30]) {
    const g = el("g", {}, ladder);
    const half = a === 0 ? 138 : 58;
    const gap = a === 0 ? 46 : 20;
    // Dive rungs read as dashed, the classic climb/dive distinction.
    const dash = a < 0 ? "9 6" : "";
    for (const s of [-1, 1]) {
      const line = el("line", { x1: s * gap, y1: 0, x2: s * half, y2: 0 }, g);
      if (dash) line.setAttribute("stroke-dasharray", dash);
      if (a !== 0) el("line", { x1: s * half, y1: 0, x2: s * half, y2: a > 0 ? 6 : -6 }, g);
    }
    if (a !== 0) {
      for (const s of [-1, 1]) {
        text(g, { x: s * (half + 15), y: 4, "font-size": "10.5", fill: COLOR.dim, stroke: "none" }).textContent = String(Math.abs(a));
      }
    }
    rungs.push({ a, g });
  }

  el("path", { d: "M 0 -122 L -6.5 -111 L 6.5 -111 Z" }, bankPointer);

  // Velocity / flight-path marker: ─┐ ○ ┌─ (§16).
  el("circle", { r: 6.5, cx: 0, cy: 0 }, velocityMarker);
  el("path", { d: "M -22 -5 L -13 -5 L -13 0" }, velocityMarker);
  el("path", { d: "M 22 -5 L 13 -5 L 13 0" }, velocityMarker);
  el("line", { x1: 0, y1: -6.5, x2: 0, y2: -12 }, velocityMarker);

  /* ---- WorldTrackedLayer ---- */
  /**
   * Stage 04.0 §18 — the nav marker, projected exactly like the target bracket
   * because that is what it is: a point in space. Drawn FIRST in the world layer
   * so a hostile bracket always paints over it, which is the priority §18 asks
   * for expressed in paint order rather than in a rule.
   */
  const navMarker = el("g", { id: "hud-nav", fill: "none", stroke: COLOR.nav, "stroke-width": "2" }, worldLayer);
  {
    const r = cfg.navRadius;
    el("path", { d: `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z` }, navMarker);
    el("circle", { r: 2, cx: 0, cy: 0, fill: COLOR.nav, stroke: "none" }, navMarker);
  }
  const navLabel = text(navMarker, { y: -cfg.navRadius - 10, "font-size": "11.5", "letter-spacing": "2.4", fill: COLOR.nav, stroke: "none" });
  const navRange = text(navMarker, { y: cfg.navRadius + 17, "font-size": "12", "letter-spacing": "1.2", fill: COLOR.nav, stroke: "none" });

  // Offscreen: still a direction, not bracket furniture — but at full strength,
  // because "which way is the objective" is the one thing a lost player needs.
  const navOff = el("g", { id: "hud-nav-off", fill: COLOR.nav, stroke: "none" }, worldLayer);
  el("path", { d: "M 0 -11 L -7.5 3 L 7.5 3 Z" }, navOff);
  const navOffRange = text(navOff, { y: 18, "font-size": "11.5", fill: COLOR.nav });

  const targetMarker = el("g", { id: "hud-target", fill: "none", "stroke-width": "1.5" }, worldLayer);
  const brackets = el("g", { stroke: COLOR.target }, targetMarker);
  const bracketPaths = [];
  for (let i = 0; i < 4; i++) bracketPaths.push(el("path", { d: "" }, brackets));
  const lockDiamond = el("path", { d: "", stroke: COLOR.lock }, targetMarker);
  const targetDot = el("circle", { r: 2, cx: 0, cy: 0, fill: COLOR.target, stroke: "none" }, targetMarker);
  const lockPulse = el("circle", { r: 10, cx: 0, cy: 0, fill: "none", stroke: COLOR.lock, "stroke-width": "2" }, targetMarker);
  const targetLabel = text(targetMarker, { "font-size": "11.5", fill: COLOR.target, stroke: "none", "letter-spacing": "1.8" });
  const targetRange = text(targetMarker, { "font-size": "11.5", fill: COLOR.target, stroke: "none" });

  const offscreen = el("g", { id: "hud-offscreen", fill: COLOR.target, stroke: "none" }, worldLayer);
  el("path", { d: "M 0 -13 L -8 -25 L 8 -25 Z" }, offscreen);
  const offLabel = text(offscreen, { y: -33, "font-size": "11", fill: COLOR.target, stroke: "none" });

  /**
   * Lead pipper (§12). World-projected like the target bracket, because that is
   * what it is: a point in space, not a screen decoration. A small ring with
   * four stub ticks — nothing that could be mistaken for the boresight cross.
   */
  const pipper = el("g", { id: "hud-pipper", fill: "none", stroke: COLOR.pipper, "stroke-width": "1.3" }, worldLayer);
  el("circle", { r: cfg.pipperRadius, cx: 0, cy: 0 }, pipper);
  const pr = cfg.pipperRadius;
  for (const [x1, y1, x2, y2] of [
    [-pr - 4, 0, -pr, 0],
    [pr + 4, 0, pr, 0],
    [0, -pr - 4, 0, -pr],
    [0, pr + 4, 0, pr],
  ]) {
    el("line", { x1, y1, x2, y2 }, pipper);
  }
  el("circle", { r: 1.3, cx: 0, cy: 0, fill: COLOR.pipper, stroke: "none" }, pipper);

  /* ================= viewport ================= */
  let w = window.innerWidth;
  let h = window.innerHeight;
  /**
   * One number the whole instrument set is drawn against. 1 at the desktop
   * viewport and below it on a phone; never above 1, because a 4K monitor
   * wants the same HUD, not a bigger one.
   */
  let ui = 1;
  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    ui = uiScaleFor(w, h, cfg);
    for (const node of svg.querySelectorAll("text[data-base-size]")) {
      node.setAttribute("font-size", (Number(node.dataset.baseSize) * ui).toFixed(2));
      node.setAttribute("letter-spacing", (Number(node.dataset.baseSpacing) * ui).toFixed(2));
    }
  };
  resize();
  window.addEventListener("resize", resize);

  /**
   * Presentation state — smoothed copies of flight values, never written back
   * to the flight model (§6). `primed` skips damping on the first frame and
   * after a reset, so nothing sweeps in from a stale value.
   */
  const hudState = { pitch: 0, bank: 0, heading: 0, speed: 0, altitude: 0, targetX: 0, targetY: 0, velX: 0, velY: 0, lockProgress: 0, pipX: 0, pipY: 0, navX: 0, navY: 0 };
  let primed = false;
  let targetPrimed = false;
  let velPrimed = false;
  let pipPrimed = false;
  let navPrimed = false;
  let message = null;
  let messageT = 0;
  let pulseT = 0;
  let threatClock = 0;
  let lastLock = LockState.NONE;
  const screen = {};
  const velScreen = {};
  const pipScreen = {};
  const navScreen = {};
  const _velPoint = new THREE.Vector3();
  const _pipPoint = new THREE.Vector3();
  const _navPoint = new THREE.Vector3();

  function flash(str, kind = "warn") {
    message = { str, kind };
    messageT = cfg.messageTime;
  }

  const rangeText = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} KM` : `${Math.round(m)} M`);

  /**
   * @param ctx {
   *   camera, expert, mode, speed, alt, throttle, afterburner,
   *   forward, up, velocityDir, missiles, targeting, target
   * }
   */
  function update(ctx, dt) {
    if (!shown) return;
    const cx = w * 0.5;
    const cy = h * cfg.centerY;
    const step = Math.min(dt, 0.1); // a long stall must not teleport the HUD

    if (messageT > 0 && (messageT -= step) <= 0) message = null;
    if (pulseT > 0) pulseT -= step;

    /* ---- presentation smoothing ---- */
    const pitchDeg = derivePitchDeg(ctx.forward);
    const bankDeg = deriveBankDeg(ctx.forward, ctx.up, hudState.bank);
    const headingDeg = deriveHeadingDeg(ctx.forward);
    if (!primed) {
      hudState.pitch = pitchDeg;
      hudState.bank = bankDeg;
      hudState.heading = headingDeg;
      hudState.speed = ctx.speed;
      hudState.altitude = ctx.alt;
      primed = true;
    } else {
      hudState.pitch = damp(hudState.pitch, pitchDeg, cfg.pitchLambda, step);
      hudState.bank = dampAngle(hudState.bank, bankDeg, cfg.bankLambda, step);
      hudState.heading = dampAngle(hudState.heading, headingDeg, cfg.headingLambda, step);
      hudState.speed = damp(hudState.speed, ctx.speed, cfg.numberLambda, step);
      hudState.altitude = damp(hudState.altitude, ctx.alt, cfg.numberLambda, step);
    }

    /* ================= ScreenFixedLayer ================= */
    reticle.setAttribute("transform", `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${ui.toFixed(3)})`);
    // GUN mode gets its own reticle furniture (§17).
    const gun = ctx.gun || null;
    const gunMode = ctx.weapon === "GUN";
    gunRing.style.display = gunMode ? "" : "none";
    bankScale.setAttribute("transform", `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
    bankScale.style.display = ctx.expert ? "" : "none";

    heading.setAttribute("transform", `translate(${cx.toFixed(1)} ${Math.round(h * 0.075)})`);
    headingValue.textContent = String(Math.round(hudState.heading) % 360).padStart(3, "0");
    const tapeSpan = Math.min(150, w * 0.14);
    heading.style.display = "";
    for (let i = 0; i < headingTicks.length; i++) {
      const t = headingTicks[i];
      if (!ctx.expert) {
        // Assisted keeps the number and caret only — "minimal heading" (§14).
        t.g.setAttribute("opacity", "0");
        continue;
      }
      const base = Math.round(hudState.heading / 5) * 5;
      const deg = base + (i - 6) * 5;
      const x = (deg - hudState.heading) * cfg.headingPxPerDeg;
      t.g.setAttribute("transform", `translate(${x.toFixed(1)} 0)`);
      const norm = ((deg % 360) + 360) % 360;
      const major = norm % 10 === 0;
      t.tick.setAttribute("y2", major ? "9" : "5");
      t.label.textContent = major ? String(norm).padStart(3, "0") : "";
      t.g.setAttribute("opacity", Math.abs(x) > tapeSpan ? "0" : "1");
    }

    // Speed and altitude flank the reticle, EDGE-anchored so the gutter the
    // caller reports is a hard boundary: the left column's first pixel is spdX
    // and the right column's last pixel is altX. Both move together — an
    // asymmetric pair either side of the boresight reads as a mistake.
    const room = cx - Math.max(0, ctx.safeLeft || 0);
    const flank = Math.max(cfg.flankMin * ui, Math.min(300, Math.min(w * 0.18, room)));
    const spdX = cx - flank;
    const altX = cx + flank;
    const RULE = 68 * ui;
    for (const node of [spdLabel, spdValue, thrValue, advisoryValue]) node.setAttribute("text-anchor", "start");
    for (const node of [altLabel, altValue, modeValue]) node.setAttribute("text-anchor", "end");
    spdLabel.setAttribute("x", spdX);
    spdLabel.setAttribute("y", cy - 20);
    spdLabel.textContent = "SPD";
    spdValue.setAttribute("x", spdX);
    spdValue.setAttribute("y", cy + 4);
    spdValue.textContent = String(Math.round(hudState.speed));
    spdRule.setAttribute("x1", spdX);
    spdRule.setAttribute("x2", spdX + RULE);
    spdRule.setAttribute("y1", cy + 12);
    spdRule.setAttribute("y2", cy + 12);

    altLabel.setAttribute("x", altX);
    altLabel.setAttribute("y", cy - 20);
    altLabel.textContent = "ALT";
    altValue.setAttribute("x", altX);
    altValue.setAttribute("y", cy + 4);
    altValue.textContent = String(Math.round(hudState.altitude));
    altRule.setAttribute("x1", altX - RULE);
    altRule.setAttribute("x2", altX);
    altRule.setAttribute("y1", cy + 12);
    altRule.setAttribute("y2", cy + 12);

    thrValue.setAttribute("x", spdX);
    thrValue.setAttribute("y", cy + 30);
    thrValue.textContent = ctx.expert ? `THR ${Math.round(ctx.throttle * 100)}%${ctx.afterburner ? "  AB" : ""}` : ctx.afterburner ? "AB" : "";
    thrValue.setAttribute("fill", ctx.afterburner ? COLOR.ab : COLOR.dim);

    modeValue.setAttribute("x", altX);
    modeValue.setAttribute("y", cy + 30);
    modeValue.textContent = ctx.mode;

    // Advisory sits under the heading tape on the speed side, anchored to the
    // SAME solved x as the speed column. It used to carry its own centred
    // position, which is how a 16-character string ended up lying across the
    // developer rail while the column it belongs to was clear.
    const advY = Math.round(h * 0.075) + 42;
    advisoryValue.setAttribute("x", spdX);
    advisoryValue.setAttribute("y", advY);
    advisoryValue.textContent = ctx.advisory || "";
    const advW = Math.min(180, (ctx.advisory ? ctx.advisory.length : 0) * 7.2);
    advisoryRule.setAttribute("x1", spdX);
    advisoryRule.setAttribute("x2", spdX + advW);
    advisoryRule.setAttribute("y1", advY + 7);
    advisoryRule.setAttribute("y2", advY + 7);
    advisoryRule.style.display = ctx.advisory ? "" : "none";

    /* ---- threat block (§11–§13, §24–§25) ----
     * TRACK is a whisper, LOCK is a statement, MISSILE is a warning with a
     * direction and a range. Nothing here screams because a hostile exists.
     */
    threatClock += step;
    const threat = ctx.threat || null;
    const level = threat ? threat.level : "NONE";
    const showThreat = level !== "NONE";
    threatGroup.style.display = showThreat ? "" : "none";
    if (showThreat) {
      const ty = Math.round(h * 0.075) + cfg.threatY;
      const missile = level === "MISSILE";
      const tier = threat.tier;
      const color = missile ? COLOR.danger : level === "LOCK" ? COLOR.warn : COLOR.track;
      const period = missile ? (tier === "URGENT" ? cfg.pulseUrgent : tier === "NEAR" ? cfg.pulseNear : cfg.pulseFar) : 0.95;
      // A gentle breathing opacity, floored well above invisible: legibility
      // first, urgency second.
      const floor = missile ? (tier === "URGENT" ? 0.55 : 0.68) : level === "LOCK" ? 0.72 : 0.9;
      const pulse = level === "TRACK" ? 1 : floor + (1 - floor) * (0.5 + 0.5 * Math.cos((threatClock / period) * Math.PI * 2));

      threatWord.setAttribute("x", cx);
      threatWord.setAttribute("y", ty);
      threatWord.setAttribute("fill", color);
      threatWord.setAttribute("opacity", pulse.toFixed(2));
      // Stage 04.2 — the same three words, labelled by source. A SAM and a
      // fighter want opposite responses (terrain vs. turning), so the player has
      // to be able to tell them apart without looking away from the threat.
      threatWord.textContent = threat.source === "SAM" ? `SAM ${level}` : level;

      threatRange.style.display = missile ? "" : "none";
      threatArrow.style.display = missile && !threat.behind ? "" : "none";
      if (missile) {
        threatRange.setAttribute("x", cx);
        threatRange.setAttribute("y", ty + 21);
        threatRange.setAttribute("opacity", pulse.toFixed(2));
        // Astern is stated in words: an arrow pointing at a screen edge for
        // something directly behind the aircraft would be a lie (§13).
        threatRange.textContent = rangeText(threat.distance) + (threat.behind ? " \u00b7 ASTERN" : "");
        threatArrow.setAttribute("x", cx - 52);
        threatArrow.setAttribute("y", ty + 21);
        threatArrow.setAttribute("opacity", pulse.toFixed(2));
        threatArrow.textContent = threat.arrow;
      }
    }

    /* ---- hit feedback (§32) ---- */
    const impact = ctx.hit ? ctx.hit.impact || 0 : 0;
    hitVeil.setAttribute("opacity", (impact * cfg.hitVeil).toFixed(3));
    hitLabel.style.display = impact > 0.02 ? "" : "none";
    if (impact > 0.02) {
      hitLabel.setAttribute("x", cx);
      hitLabel.setAttribute("y", cy - 78);
      hitLabel.setAttribute("opacity", Math.min(1, impact * 1.5).toFixed(2));
      hitLabel.textContent = "HIT";
    }

    /* ---- mission phase cue (§17) ---- */
    const cue = ctx.missionCue || null;
    missionCue.style.display = cue ? "" : "none";
    if (cue) {
      missionCue.setAttribute("x", cx);
      missionCue.setAttribute("y", Math.round(h * cfg.missionCueY));
      missionCue.setAttribute("opacity", clamp01(ctx.missionCueAlpha === undefined ? 1 : ctx.missionCueAlpha).toFixed(2));
      missionCue.textContent = cue;
    }

    /* ================= AttitudeLayer ================= */
    const lockState = ctx.targeting.lockState;
    const tgt = ctx.target;
    const hasTarget = !!(tgt && tgt.alive !== false && ctx.targeting.currentTarget);
    const range = ctx.targeting.targetRange;

    ladder.style.display = ctx.expert ? "" : "none";
    bankPointer.style.display = ctx.expert ? "" : "none";
    if (ctx.expert) {
      // §10: vertical translation is the pitch cue. Roll influence is a tunable
      // that defaults to zero — the whole point of this stage.
      const tilt = (hudState.bank * cfg.ladderRollInfluence).toFixed(2);
      ladder.setAttribute("transform", `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${tilt})`);
      for (const r of rungs) {
        const dy = (hudState.pitch - r.a) * cfg.pxPerDeg;
        r.g.setAttribute("transform", `translate(0 ${dy.toFixed(1)})`);
        // Fade out rather than clip: a rung sliding past the frame edge should
        // not just vanish mid-stroke.
        const lim = h * 0.36;
        r.g.setAttribute("opacity", Math.abs(dy) > lim ? "0" : (1 - Math.max(0, Math.abs(dy) - lim * 0.7) / (lim * 0.3)).toFixed(2));
      }
      bankPointer.setAttribute("transform", `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${hudState.bank.toFixed(2)})`);
    }

    // Flight-path marker: a point along the velocity vector, projected and then
    // damped in screen space. Kept conceptually separate from boresight even
    // though arcade physics keep them close (§16).
    let velVisible = false;
    if (ctx.velocityDir) {
      _velPoint.set(
        ctx.position.x + ctx.velocityDir.x * cfg.velocityProbe,
        ctx.position.y + ctx.velocityDir.y * cfg.velocityProbe,
        ctx.position.z + ctx.velocityDir.z * cfg.velocityProbe
      );
      projectToScreen(ctx.camera, _velPoint, w, h, velScreen);
      if (!velScreen.behind) {
        // Clamped to a disc around the HUD centre so it can never fling itself
        // across the viewport (§17).
        const limit = Math.min(w, h) * cfg.velocityClamp;
        let dx = velScreen.x - cx;
        let dy = velScreen.y - cy;
        const d = Math.hypot(dx, dy);
        if (d > limit) {
          dx = (dx / d) * limit;
          dy = (dy / d) * limit;
        }
        const tx = cx + dx;
        const ty = cy + dy;
        if (!velPrimed) {
          hudState.velX = tx;
          hudState.velY = ty;
          velPrimed = true;
        } else {
          hudState.velX = damp(hudState.velX, tx, cfg.velocityLambda, step);
          hudState.velY = damp(hudState.velY, ty, cfg.velocityLambda, step);
        }
        velVisible = true;
      } else {
        velPrimed = false;
      }
    }
    velocityMarker.style.display = velVisible ? "" : "none";
    if (velVisible) velocityMarker.setAttribute("transform", `translate(${hudState.velX.toFixed(1)} ${hudState.velY.toFixed(1)})`);

    /* ---- Stage 04.9: radar ---- */
    const rad = ctx.radar || null;
    radar.style.display = rad ? "" : "none";
    if (rad) {
      const R = cfg.radarRadius * ui;
      const rx = w - cfg.radarMargin * ui - R;
      const ry = h - cfg.radarMargin * ui - R;
      radar.setAttribute("transform", `translate(${rx} ${ry})`);
      radarRing.setAttribute("r", R);
      radarMid.setAttribute("r", R * 0.5);
      radarCrossV.setAttribute("x1", 0);
      radarCrossV.setAttribute("x2", 0);
      radarCrossV.setAttribute("y1", -R);
      radarCrossV.setAttribute("y2", R);
      radarCrossH.setAttribute("x1", -R);
      radarCrossH.setAttribute("x2", R);
      radarCrossH.setAttribute("y1", 0);
      radarCrossH.setAttribute("y2", 0);
      radarLabel.setAttribute("x", 0);
      radarLabel.setAttribute("y", R + 12);
      radarLabel.textContent = `${(cfg.radarRange / 1000).toFixed(0)} KM`;

      // Heading-up: rotate every contact into the aircraft's own frame, so "up"
      // is always where the nose points. Forward is (-sin h, -cos h) and right is
      // its perpendicular (-f.z, f.x) — the project's heading convention.
      const hd = rad.heading || 0;
      const fx = -Math.sin(hd);
      const fz = -Math.cos(hd);
      const rxAxis = -fz;
      const rzAxis = fx;
      const scale = R / cfg.radarRange;
      const list = rad.contacts || [];
      for (let i = 0; i < blips.length; i++) {
        const b = blips[i];
        const c = i < list.length ? list[i] : null;
        if (!c) {
          b.g.style.display = "none";
          continue;
        }
        const dx = c.x - rad.position.x;
        const dz = c.z - rad.position.z;
        const fwd = dx * fx + dz * fz;
        const side = dx * rxAxis + dz * rzAxis;
        // Out of range is not detected, so it is simply absent — no edge-clamped
        // ghost implying knowledge the aircraft does not have.
        if (Math.hypot(fwd, side) > cfg.radarRange) {
          b.g.style.display = "none";
          continue;
        }
        b.g.style.display = "";
        b.g.setAttribute("transform", `translate(${(side * scale).toFixed(1)} ${(-fwd * scale).toFixed(1)})`);
        const ground = c.kind === "SAM";
        b.air.style.display = ground ? "none" : "";
        b.ground.style.display = ground ? "" : "none";
      }
    }

    /* ================= WorldTrackedLayer ================= */
    /* ---- navigation (§17/§18) ----
     * THE MARKER IS NEVER SUPPRESSED BY A THREAT.
     *
     * It used to vanish entirely while a missile was inbound, on the reasoning
     * that the player then needs one piece of information and it is not the
     * waypoint. In play that reads as the guidance failing at the exact moment
     * the player is manoeuvring hardest -- you break, you dive, you defeat the
     * round, and now you have lost the course as well. Losing your bearings is a
     * second penalty for being shot at, and nothing about the missile cue needs
     * the screen space: it lives in the upper-centre stack, nowhere near the
     * projected diamond.
     *
     * This is a deliberate concession against §16's original rule, kept here
     * rather than in a config flag so the reasoning travels with the code.
     * Priority is still expressed in PAINT ORDER -- nav is drawn first in this
     * layer, so a hostile bracket and a lock diamond both cover it.
     *
     * The only remaining hide is `navHideRange`: inside 260 m you have arrived,
     * the next leg is about to become current, and the marker is redundant
     * furniture rather than guidance.
     */
    const nav = ctx.nav || null;
    let navOn = false;
    let navEdge = false;
    if (nav && nav.valid && nav.range > cfg.navHideRange) {
      _navPoint.set(nav.position.x, nav.position.y, nav.position.z);
      projectToScreen(ctx.camera, _navPoint, w, h, navScreen);
      const inFrame = !navScreen.behind && navScreen.x > 30 && navScreen.x < w - 30 && navScreen.y > 30 && navScreen.y < h - 30;
      if (inFrame) {
        if (!navPrimed) {
          hudState.navX = navScreen.x;
          hudState.navY = navScreen.y;
          navPrimed = true;
        } else {
          hudState.navX = damp(hudState.navX, navScreen.x, cfg.navLambda, step);
          hudState.navY = damp(hudState.navY, navScreen.y, cfg.navLambda, step);
        }
        navOn = true;
      } else {
        navPrimed = false;
        navEdge = true;
      }
    } else {
      navPrimed = false;
    }
    navMarker.style.display = navOn ? "" : "none";
    navOff.style.display = navEdge ? "" : "none";
    if (navOn) {
      navMarker.setAttribute("transform", `translate(${hudState.navX.toFixed(1)} ${hudState.navY.toFixed(1)})`);
      navLabel.textContent = nav.name ? `NAV ${nav.name}` : "NAV";
      navRange.textContent = rangeText(nav.range);
    } else if (navEdge) {
      // Direction only, at a modest radius, pointing the way round. Behind the
      // camera the projection mirrors, so the angle is taken from the world
      // bearing instead of from the mirrored NDC.
      const ang = navScreen.behind ? Math.atan2(-navScreen.ndcY, -navScreen.ndcX) : Math.atan2(-navScreen.ndcY, navScreen.ndcX);
      const rx = Math.min(w * cfg.navEdgeX, 300);
      const ry = Math.min(h * cfg.navEdgeY, 210);
      navOff.setAttribute(
        "transform",
        `translate(${(cx + Math.cos(ang) * rx).toFixed(1)} ${(cy + Math.sin(ang) * ry).toFixed(1)}) rotate(${((ang * 180) / Math.PI + 90).toFixed(1)})`
      );
      navOffRange.textContent = rangeText(nav.range);
    }

    if (hasTarget) projectToScreen(ctx.camera, tgt.position, w, h, screen);
    // §20: behind the camera the projection mirrors, so the bracket is dropped
    // outright rather than drawn at a false position.
    const onScreen = hasTarget && !screen.behind && screen.x > -40 && screen.x < w + 40 && screen.y > -40 && screen.y < h + 40;

    targetMarker.style.display = onScreen ? "" : "none";
    offscreen.style.display = hasTarget && !screen.behind && !onScreen ? "" : "none";

    // Cloud makes the target harder to read but never impossible (§36): the
    // marker dims toward, and stops at, a still-legible floor.
    const vis = ctx.visibility === undefined ? 1 : ctx.visibility;
    const markerAlpha = (0.45 + 0.55 * clamp01(vis)).toFixed(2);
    targetMarker.setAttribute("opacity", markerAlpha);
    offscreen.setAttribute("opacity", markerAlpha);

    if (onScreen) {
      if (!targetPrimed) {
        hudState.targetX = screen.x;
        hudState.targetY = screen.y;
        targetPrimed = true;
      } else {
        hudState.targetX = damp(hudState.targetX, screen.x, cfg.targetLambda, step);
        hudState.targetY = damp(hudState.targetY, screen.y, cfg.targetLambda, step);
      }
      targetMarker.setAttribute("transform", `translate(${hudState.targetX.toFixed(1)} ${hudState.targetY.toFixed(1)})`);

      hudState.lockProgress = damp(hudState.lockProgress, lockState === LockState.LOCKED ? 1 : ctx.targeting.lockProgress, cfg.lockLambda, step);
      const p = lockState === LockState.NONE ? 0 : hudState.lockProgress;

      // §22: acquisition is the brackets closing inward from a wide stance onto
      // the target, driven by the smoothed progress rather than a state switch.
      const base = apparentSize(26, range, h, ctx.camera.fov);
      const open = base * 1.9;
      const size = open + (base - open) * p;
      const half = size / 2;
      const arm = Math.max(5, size * 0.3);
      const stroke = lockState === LockState.LOCKED ? COLOR.lock : COLOR.target;
      brackets.setAttribute("stroke", stroke);
      brackets.setAttribute("stroke-width", (1.4 + p * 0.5).toFixed(2));
      brackets.setAttribute("opacity", (0.55 + p * 0.45).toFixed(2));
      const pts = [[-half, -half, 1, 1], [half, -half, -1, 1], [half, half, -1, -1], [-half, half, 1, -1]];
      pts.forEach(([x, y, sx, sy], i) => {
        bracketPaths[i].setAttribute("d", `M ${(x + sx * arm).toFixed(1)} ${y.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)} L ${x.toFixed(1)} ${(y + sy * arm).toFixed(1)}`);
      });

      // Locked settles into a stable diamond — no continuous flashing (§23).
      const dr = half + 7;
      lockDiamond.style.display = lockState === LockState.LOCKED ? "" : "none";
      lockDiamond.setAttribute("d", `M 0 ${-dr.toFixed(1)} L ${dr.toFixed(1)} 0 L 0 ${dr.toFixed(1)} L ${-dr.toFixed(1)} 0 Z`);
      targetDot.setAttribute("fill", stroke);

      // One short ring expansion on ACQUIRING -> LOCKED.
      if (lockState === LockState.LOCKED && lastLock !== LockState.LOCKED) pulseT = cfg.lockPulseTime;
      lockPulse.style.display = pulseT > 0 ? "" : "none";
      if (pulseT > 0) {
        const k = 1 - pulseT / cfg.lockPulseTime;
        lockPulse.setAttribute("r", (half * (0.9 + k * 1.5)).toFixed(1));
        lockPulse.setAttribute("opacity", (1 - k).toFixed(2));
      }

      targetLabel.setAttribute("y", (-half - 13).toFixed(1));
      targetLabel.setAttribute("fill", stroke);
      targetLabel.textContent = ctx.expert ? tgt.label || "HOSTILE" : "";
      targetRange.setAttribute("y", (half + 19).toFixed(1));
      targetRange.setAttribute("fill", stroke);
      targetRange.textContent = rangeText(range);
    } else {
      targetPrimed = false;
      hudState.lockProgress = 0;
      if (hasTarget && !screen.behind) {
        const ang = Math.atan2(-screen.ndcY, screen.ndcX);
        const rx = Math.min(w * 0.32, 320);
        const ry = Math.min(h * 0.3, 230);
        offscreen.setAttribute("transform", `translate(${(cx + Math.cos(ang) * rx).toFixed(1)} ${(cy + Math.sin(ang) * ry).toFixed(1)}) rotate(${((ang * 180) / Math.PI + 90).toFixed(1)})`);
        offLabel.textContent = rangeText(range);
      }
    }
    lastLock = lockState;

    /* ---- gun lead pipper (§12, §16) ----
     * Shown only with the gun selected, only for a live target, only when the
     * solution is in front of the camera and inside the frame, and faded by gun
     * effectiveness at that range. A pipper that survives none of those tests is
     * not a helpful cue, it is a lie about where the rounds go.
     */
    let pipVisible = false;
    if (gunMode && gun && gun.leadValid && hasTarget) {
      _pipPoint.set(gun.lead.x, gun.lead.y, gun.lead.z);
      projectToScreen(ctx.camera, _pipPoint, w, h, pipScreen);
      const inFrame = pipScreen.x > 24 && pipScreen.x < w - 24 && pipScreen.y > 24 && pipScreen.y < h - 24;
      if (!pipScreen.behind && inFrame) {
        if (!pipPrimed) {
          hudState.pipX = pipScreen.x;
          hudState.pipY = pipScreen.y;
          pipPrimed = true;
        } else {
          hudState.pipX = damp(hudState.pipX, pipScreen.x, cfg.pipperLambda, step);
          hudState.pipY = damp(hudState.pipY, pipScreen.y, cfg.pipperLambda, step);
        }
        pipVisible = true;
      }
    }
    if (!pipVisible) pipPrimed = false;
    pipper.style.display = pipVisible ? "" : "none";
    if (pipVisible) {
      pipper.setAttribute("transform", `translate(${hudState.pipX.toFixed(1)} ${hudState.pipY.toFixed(1)}) scale(${ui.toFixed(3)})`);
      // Out past best gun range the cue dims rather than disappearing: the
      // geometry is still true, the rounds just stop mattering.
      const eff = gun.rangeEffect === undefined ? 1 : clamp01(gun.rangeEffect);
      pipper.setAttribute("opacity", (0.34 + 0.56 * eff).toFixed(2));
    }

    /* ---- combat stack: one state at a time (§25) ---- */
    // Lower RIGHT, right-aligned — not bottom centre. On the centreline there is
    // no band that clears both the airframe (which fills the middle of the
    // frame from the chase camera) and the developer legend (bottom left): at
    // 540 px the two leave no gap at all, and Stage 03.15 caught the stack lying
    // across the wing and nacelles. The lower right is where stores status
    // conventionally sits anyway, and it balances the advisory on the left.
    const stackX = Math.round(w - Math.max(42, w * 0.045));
    const stackY = Math.round(h * 0.6);
    for (const [node, dy] of [[stackTop, 0], [stackMid, 21], [stackBottom, 41]]) {
      node.setAttribute("x", stackX);
      node.setAttribute("y", stackY + dy);
      node.setAttribute("text-anchor", "end");
    }
    const ammo = `AIM-9 \u00d7${ctx.missiles}`;
    let top = "";
    let topColor = COLOR.line;
    let mid = "";
    let bottom = ammo;
    let bottomColor = ctx.missiles ? COLOR.line : COLOR.warn;

    if (gunMode && gun) {
      // GUN: no lock language anywhere. The gun does not care about the lock
      // state, and saying LOCK next to a gun ammo count would teach the player
      // the wrong thing about which weapon needs what (§28).
      top = gun.dry ? "GUN DRY" : "GUN";
      topColor = gun.dry ? COLOR.warn : COLOR.line;
      if (hasTarget) mid = `TGT ${rangeText(range)}${pipVisible ? " \u00b7 LEAD" : ""}`;
      bottom = `20MM ${gun.ammo}`;
      bottomColor = gun.ammo ? COLOR.line : COLOR.warn;
      if (message) {
        top = message.str;
        topColor = message.kind === "good" ? COLOR.lock : message.kind === "info" ? COLOR.line : COLOR.warn;
      }
    } else if (message) {
      top = message.str;
      topColor = message.kind === "good" ? COLOR.lock : message.kind === "info" ? COLOR.line : COLOR.warn;
    } else if (lockState === LockState.LOCKED) {
      top = "LOCK";
      topColor = COLOR.lock;
      mid = `TGT ${rangeText(range)}`;
    } else if (lockState === LockState.ACQUIRING) {
      top = `ACQ ${Math.round(ctx.targeting.lockProgress * 100)}%`;
      topColor = COLOR.line;
      mid = `TGT ${rangeText(range)}`;
    } else if (hasTarget && ctx.expert) {
      // Expert gets the reason it cannot lock; assisted stays quiet.
      top = ctx.targeting.reason || "";
      topColor = COLOR.dim;
      mid = `TGT ${rangeText(range)}`;
    }

    stackTop.textContent = top;
    stackTop.setAttribute("fill", topColor);
    stackMid.textContent = mid;
    stackBottom.textContent = bottom;
    stackBottom.setAttribute("fill", bottomColor);
  }

  return {
    svg,
    hudState,
    cfg,
    update,
    flash,
    /** Called on R: drop smoothing history so nothing sweeps from a stale value. */
    reset() {
      primed = targetPrimed = velPrimed = pipPrimed = navPrimed = false;
      hudState.lockProgress = 0;
      pulseT = 0;
      threatClock = 0;
      hitVeil.setAttribute("opacity", "0");
      hitLabel.style.display = "none";
      threatGroup.style.display = "none";
      navMarker.style.display = "none";
      navOff.style.display = "none";
      missionCue.style.display = "none";
      for (const b of blips) b.g.style.display = "none";
      message = null;
      messageT = 0;
      lastLock = LockState.NONE;
    },
    reveal() {
      shown = true;
      svg.style.display = "";
    },
    toggle() {
      shown = !shown;
      svg.style.display = shown ? "" : "none";
      return shown;
    },
    get hidden() {
      return !shown;
    },
  };
}
