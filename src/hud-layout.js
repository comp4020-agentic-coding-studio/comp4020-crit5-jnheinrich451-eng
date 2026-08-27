// HUD geometry, type ramp and colour. HUD.md H3, H5, H7, H10, H12.
//
// Three-free and DOM-free on purpose: every number the HUD draws is decided
// here, so the gates exercise the LAYOUT rather than a screenshot, and
// combat-hud.js becomes a painter that adds no arithmetic of its own.

// ── H3. The scale unit ─────────────────────────────────────────────────────
//
// Every font size, offset, radius and stroke width in the HUD is expressed in
// `u`, never in raw pixels. 1080 is the authoring reference.
//
// Scaled by HEIGHT, not width: an ultrawide window has more room sideways but
// the same viewing distance, and a width-driven unit inflates type on a
// letterbox for no reason.
//
// THE DPR TRAP (H3): do NOT multiply this by devicePixelRatio. The SVG viewBox
// is already in CSS pixels, so the browser has handled DPR before this runs;
// multiplying by it again double-counts and produces the enormous-HUD bug.
// There is deliberately no reference to devicePixelRatio anywhere in this file
// or in combat-hud.js, and a gate asserts it.
export const HUD_REFERENCE_HEIGHT = 1080;
export const HUD_SCALE_MIN = 0.85; // a short window must stay readable
export const HUD_SCALE_MAX = 2.0; // a 5K display must not become a billboard

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function hudScale(viewportHeight) {
  if (!(viewportHeight > 0)) return HUD_SCALE_MIN;
  return clamp(viewportHeight / HUD_REFERENCE_HEIGHT, HUD_SCALE_MIN, HUD_SCALE_MAX);
}

// H3's gate requires the smallest label never to fall below 11 CSS px. The
// ramp's smallest entry is 10 and the lower clamp is 0.85, which lands at 8.5
// -- so the scale alone cannot satisfy it and an absolute floor is required.
// The floor is on the RENDERED size only; layout still uses `u` throughout, so
// the floor cannot drag spacing around with it.
export const MIN_FONT_PX = 11;

/** Type ramp (HUD.md H3), all quoted at the 1080 reference. */
export const RAMP = {
  primary: { size: 26, spacing: 0.5, weight: 500 },
  secondary: { size: 15, spacing: 1.2, weight: 400 },
  label: { size: 11, spacing: 2.2, weight: 400 },
  stackTop: { size: 17, spacing: 3.4, weight: 500 },
  stackLower: { size: 13, spacing: 1.6, weight: 400 },
  threat: { size: 18, spacing: 5.0, weight: 500 },
  hit: { size: 30, spacing: 9.0, weight: 500 },
  radarLabel: { size: 10, spacing: 2.0, weight: 400 },
};

export const fontPx = (role, u) =>
  Math.max((RAMP[role]?.size ?? 15) * u, MIN_FONT_PX);
export const spacingPx = (role, u) => (RAMP[role]?.spacing ?? 1) * u;
export const weightOf = (role) => RAMP[role]?.weight ?? 400;

// ── H12. Colour ────────────────────────────────────────────────────────────
// Six hues and no gradients. Amber and salmon are the only colours that ever
// appear unprompted, which is what makes them mean something.
export const C = {
  line: "#cfe8d8",
  dim: "rgba(207,232,216,0.62)",
  faint: "rgba(207,232,216,0.30)",
  good: "#9fe6b0",
  nav: "#8fd0ff",
  warn: "#ffd79a",
  danger: "#ff9a8f",
  ab: "#ffb45a",
  radar: "rgba(143,208,255,0.75)",
};

// ── H4. The contrast floor ─────────────────────────────────────────────────
// A casing stroke, not a drop shadow: an SVG filter on a per-frame-updated node
// re-rasters that node every frame and there are ~40 of them. A casing stroke
// is free. Not a translucent panel either -- a panel occludes the world, and
// the world is the game.
export const CASING = {
  paintOrder: "stroke fill",
  stroke: "rgba(4, 8, 10, 0.62)",
  textWidth: 2.6, // x u
  symbolWidth: 1.8, // x u
  linejoin: "round",
};

// ── H5.1 Flanking flight state ─────────────────────────────────────────────
//
// 0.14 x w replaces 0.18: at 2500 px the columns sat 300 px off centre while
// the boresight cross was 13 px wide, so nothing at all occupied the middle
// third of the screen. Pulling them in is most of the D1 fix.
export const FLANK_FRACTION = 0.14;

export function flankOffset(w, u) {
  return clamp(Math.min(FLANK_FRACTION * w, 260 * u), 92 * u, 300 * u);
}

/**
 * THE EDGE-ANCHORING INVARIANT (H5.1), earned over three rounds of bugs and
 * not up for redesign:
 *
 *   the left column is left-aligned AT spdX  (text-anchor: start)
 *   the right column is right-aligned AT altX (text-anchor: end)
 *
 * Never centre-anchored, never clamped by a computed text width. A centred
 * column spills half its string past its anchor, so respecting a gutter would
 * require knowing the rendered width of text that changes every frame.
 *
 * `safeLeft` only ever RAISES the floor -- it can never push a column back
 * across the developer rail.
 */
export function flankColumns(w, u, safeLeft = 0) {
  const cx = w / 2;
  const flank = flankOffset(w, u);
  return {
    flank,
    cx,
    spdX: Math.max(cx - flank, safeLeft),
    altX: cx + flank,
    spdAnchor: "start",
    altAnchor: "end",
  };
}

// ── H5.1 AGL ───────────────────────────────────────────────────────────────
export const AGL_WARN = 220;
export const AGL_DANGER = 110;

/**
 * AGL OVER WATER READS AN EM DASH, NOT ZERO. A dash means "not a factor"; a
 * zero means "you are about to die", and the sea must not cry wolf for the
 * four minutes of the sortie that are flown over it.
 */
export function aglReadout(agl, overWater) {
  if (overWater || !Number.isFinite(agl)) {
    return { text: "—", colour: C.dim };
  }
  const rounded = Math.round(agl);
  if (agl < AGL_DANGER) return { text: String(rounded), colour: C.danger };
  if (agl < AGL_WARN) return { text: String(rounded), colour: C.warn };
  return { text: String(rounded), colour: C.line };
}

// ── H7. Stores panel ───────────────────────────────────────────────────────
export const RADAR_RADIUS = 74; // x u
export const RADAR_MARGIN = 26; // x u
const STORES_GAP = 34; // x u above the radar ring
const STORES_LINE = 21; // x u between rows

/** Pips a player reads without counting. Hollow when empty. */
export function pips(count, capacity, full = "▮", empty = "▭") {
  const n = Math.max(0, Math.min(capacity, count));
  return full.repeat(n) + empty.repeat(Math.max(0, capacity - n));
}

/** The gun is a fraction, not a count, so it gets an eight-cell bar. */
export function bar(value, max, cells = 8, full = "▬", empty = "▭") {
  if (!(max > 0)) return empty.repeat(cells);
  const lit = Math.round(clamp(value / max, 0, 1) * cells);
  return full.repeat(lit) + empty.repeat(cells - lit);
}

/**
 * The stores block, bottom right, above the radar.
 *
 * The selected weapon is marked BY POSITION AND GLYPH, not by colour alone:
 * colour-only selection fails for a colour-blind player and fails again on a
 * bright deck. Empty is AMBER, never hidden -- a row that disappears when
 * empty teaches nothing.
 */
export function storesPanel({
  w, h, u, weapon, missiles, missileCapacity = 4,
  gunRounds, gunCapacity = 500, flares, flareCapacity = 8, rearm = null,
}) {
  const rows = [
    {
      key: "AIM-9",
      label: "AIM-9",
      count: missiles,
      glyph: pips(missiles, missileCapacity),
      empty: missiles === 0,
    },
    {
      key: "GUN",
      label: "GUN",
      count: gunRounds,
      glyph: bar(gunRounds, gunCapacity),
      empty: gunRounds === 0,
    },
    {
      key: "FLR",
      label: "FLR",
      count: flares,
      glyph: pips(flares, flareCapacity),
      empty: flares === 0,
    },
  ].map((row) => ({
    ...row,
    selected: row.key === weapon,
    marker: row.key === weapon ? "›" : " ",
    colour: row.empty ? C.warn : row.key === weapon ? C.line : C.dim,
  }));

  // The rearm line ONLY exists while a timer runs, and names WHICH magazine,
  // because the two timers are independent.
  const rearmLine = rearm
    ? { text: `${rearm.name} REARM ${Math.ceil(rearm.seconds)}s`, colour: C.warn }
    : null;

  // The radar ring's TOP edge is 2r + margin above the viewport bottom, not
  // r + margin: the ring is centred at r + margin, so its top is another r
  // beyond that.
  //
  // H7 requires this panel to sit where "it can never collide with the radar
  // ring", but H13.7's gate only asks that the top clear
  // `h - (radarRadius + radarMargin)` -- which is the ring's CENTRE line. Both
  // the quoted offset and that gate can be satisfied while the panel still
  // overlaps the upper half of the ring, and at 2560x1440 it did, by 58 px on
  // the live nodes. Measured from the true top instead, so the stated intent
  // holds rather than the weaker letter of the gate.
  const radarTop = h - (2 * RADAR_RADIUS + RADAR_MARGIN) * u;
  const bottom = radarTop - STORES_GAP * u;
  const lineHeight = STORES_LINE * u;
  const lineCount = rows.length + (rearmLine ? 1 : 0);
  // Rows stack upward from `bottom`; the label sits above them all.
  const firstRowY = bottom - (lineCount - 1) * lineHeight;
  const labelY = firstRowY - lineHeight;

  return {
    x: w - RADAR_MARGIN * u,
    anchor: "end",
    labelY,
    top: labelY - fontPx("label", u),
    bottom,
    lineHeight,
    radarTop,
    rows: rows.map((row, i) => ({ ...row, y: firstRowY + i * lineHeight })),
    rearm: rearmLine ? { ...rearmLine, y: bottom } : null,
  };
}

// ── H10. Aircraft mode and pilots, bottom left ─────────────────────────────
export function modeSegment({ h, u, mode, lives, modeChangedAgo = 99 }) {
  // The mode brightens for 1.2 s after M, then settles back: a mode change is
  // worth a glance, not a permanent light.
  const fresh = modeChangedAgo < 1.2;
  const parts = [
    {
      text: mode,
      // EXPERT renders in the good tint, so the two modes are distinguishable
      // at a glance without reading the word.
      colour: mode === "EXPERT" ? C.good : fresh ? C.line : C.dim,
    },
  ];
  // MISSION only: the segment is ABSENT ENTIRELY in FREE and PEACE, because
  // counting deaths in a sandbox turns practice into a test.
  if (lives !== null && lives !== undefined) {
    parts.push({
      text: `${lives} PILOT${lives === 1 ? "" : "S"}`,
      colour: lives <= 1 ? C.danger : lives <= 2 ? C.warn : C.dim,
    });
  }
  return {
    x: RADAR_MARGIN * u,
    y: h - RADAR_MARGIN * u,
    anchor: "start",
    text: parts.map((p) => p.text).join(" · "),
    parts,
  };
}

// ── H8. The combat stack ───────────────────────────────────────────────────
// EXACTLY THREE SLOTS. A fourth line of combat text is a redesign of the
// stack, not an addition to it.
export const STACK_SLOTS = [0.63, 0.665, 0.695];
export const stackY = (h) => STACK_SLOTS.map((f) => h * f);

// ── H6 / H9 anchors ────────────────────────────────────────────────────────
// centerY 0.45 stays: the chase F-15 sits low in frame, and an origin at true
// centre puts the ladder through the airframe.
export const BORESIGHT_Y = 0.45;
export const THREAT_Y = 52; // x u from the top
export const PHASE_CUE_Y = 0.155;
