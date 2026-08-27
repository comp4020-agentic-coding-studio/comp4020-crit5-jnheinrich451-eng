// The SVG HUD. CLAUDE.md §16, HUD.md H2-H12.
//
// THE LAYERS ARE THE PRIORITY MECHANISM. Paint order is fixed at construction
// and nothing may reorder it at runtime:
//
//   1  world-tracked   nav marker, target bracket, lock diamond, lead pipper
//   2  attitude        horizon
//   3  screen-fixed    boresight, flight state, stores, threat, stack, radar
//
// The nav marker is appended FIRST inside the world layer, so a hostile
// bracket always paints over a waypoint -- priority as paint order rather than
// as a rule someone has to remember.
//
// This file is a PAINTER. Every number it draws comes from hud-layout.js, so
// the geometry is exercised headlessly by the gates rather than by a
// screenshot, and there is no arithmetic here to drift from it.
//
// The HUD is NOT instruction (§"No instructions, anywhere"). It is
// instrumentation, and reading an instrument is part of flying.

import * as THREE from "three";
import { LOCK, TRACK } from "./targeting.js";
import {
  BORESIGHT_Y, C, CASING, RADAR_MARGIN, RADAR_RADIUS, THREAT_Y,
  aglReadout, flankColumns, fontPx, hudScale, modeSegment, spacingPx,
  stackY, storesPanel, weightOf,
} from "./hud-layout.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * C1 (PATCH-02). THE ONLY SOURCE OF COLOUR ON THIS DISPLAY.
 *
 * Every HUD node takes its fill from here and no HUD node may carry a literal
 * colour string -- a gate greps this module and hud-layout.js for hex literals
 * outside the table declaration and requires a count of zero, so a symbol
 * added later cannot reintroduce one.
 *
 * main.js may pass STATE (afterburner lit, AGL value, pilots remaining) but
 * never a colour. The `stackTopColour` parameter it used to pass was deleted
 * rather than defaulted: a colour that can be supplied from outside is a
 * second palette waiting to happen.
 */
export const COLOR = C;
export const COLOURS = C;

const MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

function node(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function createCombatHud(host, camera) {
  const svg = node("svg", {
    id: "combat-hud",
    width: "100%",
    height: "100%",
    preserveAspectRatio: "none",
    "aria-hidden": "true", // instrumentation, not content
  });
  Object.assign(svg.style, {
    position: "fixed", inset: "0", zIndex: "8", pointerEvents: "none",
  });

  const world = node("g");
  const attitude = node("g");
  const fixed = node("g");
  // A FOURTH LAYER, above the other three, holding the phase cue alone.
  //
  // The reveal envelope dims the three instrument layers together; the cue is
  // EXEMPT, because it is the one thing on screen that is about the mission
  // rather than about the aircraft, and DECK and LAUNCH are phases the player
  // should be told they are in. Its own 2.7 s fade is unaffected -- one
  // element, two independent opacities, on different nodes.
  const cue = node("g");
  svg.append(world, attitude, fixed, cue);
  host.append(svg);

  // The instrument layers, as a list, so the envelope cannot be applied to two
  // of three and quietly leave the stores panel lit over a parked jet.
  const symbology = [world, attitude, fixed];

  // Live scale, recomputed on resize only (H3).
  let u = hudScale(host.clientHeight || window.innerHeight || 1080);

  /**
   * THE SHARED TEXT HELPER (H4). Every text node on the HUD is made here, and
   * every one therefore carries the casing stroke -- so a symbol added later
   * cannot forget it. The gate asserts THE HELPER applies it rather than
   * asserting each call site, which is what makes the rule survive an edit.
   *
   * A casing stroke rather than an SVG `filter`: a filter on a node updated
   * every frame re-rasters that node every frame, and there are ~40 of them.
   * Not a translucent panel either -- a panel occludes the world, and the
   * world is the game.
   */
  function text(role, attrs = {}) {
    const el = node("text", {
      "font-family": MONO,
      "paint-order": CASING.paintOrder,
      stroke: CASING.stroke,
      "stroke-width": CASING.textWidth * u,
      "stroke-linejoin": CASING.linejoin,
      fill: C.line,
      ...attrs,
    });
    el.setAttribute("data-role", role);
    return el;
  }

  /** Thin symbol strokes carry the casing too, via a doubled path. */
  function cased(attrs = {}) {
    const g = node("g");
    const width = Number(attrs["stroke-width"] ?? 1.4);
    const casing = node("path", {
      fill: "none", stroke: CASING.stroke,
      "stroke-width": width + CASING.symbolWidth * u,
      "stroke-linejoin": CASING.linejoin, "stroke-linecap": "round",
    });
    const line = node("path", { fill: "none", ...attrs });
    g.append(casing, line);
    return {
      g,
      set(d) {
        casing.setAttribute("d", d);
        line.setAttribute("d", d);
      },
      colour(c) {
        line.setAttribute("stroke", c);
      },
      show(v) {
        g.setAttribute("visibility", v ? "visible" : "hidden");
      },
    };
  }

  function restyle() {
    for (const el of svg.querySelectorAll("text")) {
      // C2: paint-order is what makes the casing a casing. Without it the
      // stroke paints OVER the glyph, which both hides the outline and
      // visually thins the letter -- the most likely single cause of
      // `L A U N C H` being unreadable over sky.
      el.setAttribute("paint-order", CASING.paintOrder);
      const heavy = el.getAttribute("data-heavy-casing") === "1";
      el.setAttribute("stroke-width", String(CASING.textWidth * u * (heavy ? 1.6 : 1)));
      const role = el.getAttribute("data-role");
      if (!role) continue;
      el.setAttribute("font-size", String(fontPx(role, u)));
      el.setAttribute("letter-spacing", String(spacingPx(role, u)));
      el.setAttribute("font-weight", String(weightOf(role)));
    }
  }

  // ── layer 1: world-tracked ───────────────────────────────────────────────
  const navDiamond = cased({ stroke: C.nav, "stroke-width": 2 });
  const navText = text("radarLabel", { fill: C.nav, "text-anchor": "middle" });
  const navChevron = cased({ stroke: C.nav, "stroke-width": 2.4 });
  world.append(navDiamond.g, navText, navChevron.g);

  const bracket = node("rect", { fill: "none", stroke: C.warn, "stroke-width": 2, rx: 2 });
  const diamond = cased({ stroke: C.warn, "stroke-width": 2 });
  const pipper = node("circle", { fill: "none", stroke: C.line, "stroke-width": 1.6 });
  const rangeText = text("radarLabel", { fill: C.warn, "text-anchor": "middle" });
  world.append(bracket, diamond.g, pipper, rangeText);

  // ── layer 2: attitude ────────────────────────────────────────────────────
  //
  // DELIBERATELY EMPTY. The horizon bar that used to live here was removed on
  // instruction: at boresight height it drew a hard horizontal rule straight
  // across the airframe, which read as a bar sitting on top of the aircraft
  // rather than as an attitude reference.
  //
  // HUD.md H2 never asked for one -- this layer is specified as "pitch ladder,
  // bank pointer, velocity marker" (H6), none of which is built. The layer is
  // kept so paint order stays fixed and those three have somewhere to land
  // without renumbering anything.

  // ── layer 3: screen-fixed ────────────────────────────────────────────────
  const boresight = cased({ stroke: C.line, "stroke-width": 1.4 });
  fixed.append(boresight.g);

  // H5.1: two numbers a side, EDGE-ANCHORED.
  const spdLabel = text("label", { fill: C.dim, "text-anchor": "start" });
  const spdValue = text("primary", { "text-anchor": "start" });
  const spdRule = cased({ stroke: C.faint, "stroke-width": 1 });
  const thrValue = text("secondary", { fill: C.dim, "text-anchor": "start" });
  const altLabel = text("label", { fill: C.dim, "text-anchor": "end" });
  const altValue = text("primary", { "text-anchor": "end" });
  const altRule = cased({ stroke: C.faint, "stroke-width": 1 });
  const aglValue = text("secondary", { fill: C.dim, "text-anchor": "end" });
  spdLabel.id = "hud-spd-label";
  spdValue.id = "hud-spd";
  altLabel.id = "hud-alt-label";
  altValue.id = "hud-alt";
  fixed.append(spdLabel, spdValue, spdRule.g, thrValue, altLabel, altValue, altRule.g, aglValue);

  const threatWord = text("threat", { fill: C.danger, "text-anchor": "middle" });
  // C2: the phase cue is the single worst case in the build -- large letter
  // spacing, low-alpha fill, bright sky behind. It carries a heavier casing
  // than the shared default, because a 30u glyph needs proportionally more
  // outline to hold an edge than a 15u one does.
  const phaseCue = text("hit", { fill: C.nav, "text-anchor": "middle" });
  phaseCue.setAttribute("data-heavy-casing", "1");
  fixed.append(threatWord);
  cue.append(phaseCue);

  // H8: EXACTLY THREE SLOTS. A fourth line is a redesign of the stack, not an
  // addition to it.
  const stack = [
    text("stackTop", { "text-anchor": "middle" }),
    text("stackLower", { fill: C.dim, "text-anchor": "middle" }),
    text("stackLower", { fill: C.dim, "text-anchor": "middle" }),
  ];
  const stackGroup = node("g", { id: "combat-stack" });
  stackGroup.append(...stack);
  fixed.append(stackGroup);

  // H7: stores, bottom right, above the radar.
  const storesGroup = node("g", { id: "hud-stores" });
  const storesLabel = text("label", { fill: C.dim, "text-anchor": "end" });
  const storesRows = [
    text("secondary", { "text-anchor": "end" }),
    text("secondary", { "text-anchor": "end" }),
    text("secondary", { "text-anchor": "end" }),
  ];
  const storesRearm = text("stackLower", { fill: C.warn, "text-anchor": "end" });
  storesGroup.append(storesLabel, ...storesRows, storesRearm);
  fixed.append(storesGroup);

  // H10: mode and pilots, bottom left.
  const modeText = text("label", { "text-anchor": "start" });
  modeText.id = "hud-mode";
  fixed.append(modeText);

  // H11: radar, bottom right below the stores.
  const radarGroup = node("g", { id: "hud-radar" });
  const radarRing = node("circle", { fill: "none", stroke: C.radar, "stroke-width": 1, opacity: 0.34 });
  const radarInner = node("circle", { fill: "none", stroke: C.radar, "stroke-width": 1, opacity: 0.2 });
  const ownShip = cased({ stroke: C.good, "stroke-width": 1.6 });
  radarGroup.append(radarRing, radarInner, ownShip.g);
  fixed.append(radarGroup);
  const blips = [];
  const contactScratch = [];
  function blip(i) {
    if (!blips[i]) {
      const b = cased({ stroke: C.warn, "stroke-width": 1.6 });
      blips[i] = b;
      radarGroup.append(b.g);
    }
    return blips[i];
  }

  restyle();

  const projected = new THREE.Vector3();
  const smooth = new Map();
  const hide = (n) => n.setAttribute("visibility", "hidden");
  const show = (n) => n.setAttribute("visibility", "visible");
  const put = (n, x, y, s) => {
    n.setAttribute("x", x);
    n.setAttribute("y", y);
    if (s !== undefined) n.textContent = s;
  };

  function project(point, w, h) {
    projected.set(point.x, point.y, point.z).project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * w,
      y: (1 - (projected.y * 0.5 + 0.5)) * h,
      behind: projected.z > 1,
    };
  }
  function damp(key, p, dt) {
    const prev = smooth.get(key);
    if (!prev) {
      smooth.set(key, { x: p.x, y: p.y });
      return p;
    }
    const k = 1 - Math.exp(-18 * dt);
    prev.x += (p.x - prev.x) * k;
    prev.y += (p.y - prev.y) * k;
    return { x: prev.x, y: prev.y, behind: p.behind };
  }

  return {
    svg,
    scale: () => u,
    setVisible(v) {
      svg.style.display = v ? "" : "none";
    },
    isVisible: () => svg.style.display !== "none",

    /**
     * The reveal envelope (HUD.md H5, new state). One opacity on the three
     * instrument layers -- NOT a per-symbol schedule.
     *
     * `null` on a layer is not the same as `1`: the gate reads these attributes
     * off the live nodes, so the value is always written explicitly.
     */
    setReveal(alpha) {
      const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
      for (const layer of symbology) layer.setAttribute("opacity", String(a));
      // A layer at zero still hit-tests and still costs layout; `display` is
      // what actually takes it out of the frame.
      for (const layer of symbology) layer.style.display = a > 0 ? "" : "none";
    },
    reveal: () => Number(fixed.getAttribute("opacity") ?? 1),

    resize(width, height) {
      u = hudScale(height);
      restyle();
    },

    update(dt, view) {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      const cx = w / 2;
      const by = h * BORESIGHT_Y;

      // ── flight state (H5.1) ────────────────────────────────────────────
      const col = flankColumns(w, u, view.safeLeft ?? 0);
      const gap = 26 * u;
      put(spdLabel, col.spdX, by - gap * 1.5, "SPD");
      put(spdValue, col.spdX, by - gap * 0.4, view.speed.toFixed(0));
      spdRule.set(`M${col.spdX} ${by + gap * 0.05} h${68 * u}`);
      put(
        thrValue, col.spdX, by + gap * 0.85,
        `THR ${(view.throttle * 100).toFixed(0)}%${view.afterburner ? "  AB" : ""}`,
      );
      thrValue.setAttribute("fill", view.afterburner ? C.ab : C.dim);

      put(altLabel, col.altX, by - gap * 1.5, "ALT");
      put(altValue, col.altX, by - gap * 0.4, view.altitude.toFixed(0));
      altRule.set(`M${col.altX - 68 * u} ${by + gap * 0.05} h${68 * u}`);
      const agl = aglReadout(view.agl, view.overWater);
      put(aglValue, col.altX, by + gap * 0.85, `AGL ${agl.text}`);
      aglValue.setAttribute("fill", agl.colour);

      boresight.set(
        `M${cx - 9 * u} ${by} h${5 * u} M${cx + 4 * u} ${by} h${5 * u} ` +
          `M${cx} ${by - 9 * u} v${5 * u} M${cx} ${by + 4 * u} v${5 * u}`,
      );

      // ── threat, phase, stack (H8, H9) ──────────────────────────────────
      put(threatWord, cx, THREAT_Y * u, view.threat ?? "");
      put(phaseCue, cx, h * 0.155);
      if (view.phaseCue && view.phaseCueAge < 2.7) {
        const p = view.phaseCueAge / 2.7;
        phaseCue.textContent = view.phaseCue;
        phaseCue.setAttribute(
          "opacity",
          String(Math.max(0, Math.min(1, Math.min(p / 0.18, (1 - p) / 0.28)))),
        );
      } else {
        phaseCue.textContent = "";
      }
      const ys = stackY(h);
      const slots = [view.stackTop ?? "", view.stackMid ?? "", view.stackLow ?? ""];
      stack.forEach((n, i) => put(n, cx, ys[i], slots[i]));
      // C1: derived from STATE, never passed in. `tone` is a word, not a hue.
      stack[0].setAttribute(
        "fill",
        view.stackTone === "danger"
          ? COLOR.danger
          : view.stackTone === "warn"
            ? COLOR.warn
            : COLOR.line,
      );

      // ── stores (H7) ────────────────────────────────────────────────────
      const stores = storesPanel({
        w, h, u,
        weapon: view.weapon,
        missiles: view.missiles,
        missileCapacity: view.missileCapacity,
        gunRounds: view.gunRounds,
        flares: view.flares,
        rearm: view.rearm,
      });
      put(storesLabel, stores.x, stores.labelY, "STORES");
      storesRows.forEach((n, i) => {
        const row = stores.rows[i];
        put(n, stores.x, row.y, `${row.marker} ${row.label} ${row.count}  ${row.glyph}`);
        n.setAttribute("fill", row.colour);
      });
      if (stores.rearm) {
        show(storesRearm);
        put(storesRearm, stores.x, stores.rearm.y, stores.rearm.text);
      } else {
        hide(storesRearm);
        storesRearm.textContent = "";
      }

      // ── mode and pilots (H10) ──────────────────────────────────────────
      const seg = modeSegment({
        h, u, mode: view.mode, lives: view.lives, modeChangedAgo: view.modeChangedAgo,
      });
      put(modeText, seg.x, seg.y, seg.text);
      modeText.setAttribute("fill", seg.parts[0].colour);

      // ── radar (H11) ────────────────────────────────────────────────────
      const rr = RADAR_RADIUS * u;
      const rcx = w - rr - RADAR_MARGIN * u;
      const rcy = h - rr - RADAR_MARGIN * u;
      radarRing.setAttribute("cx", rcx);
      radarRing.setAttribute("cy", rcy);
      radarRing.setAttribute("r", rr);
      radarInner.setAttribute("cx", rcx);
      radarInner.setAttribute("cy", rcy);
      radarInner.setAttribute("r", rr / 2);
      ownShip.set(
        `M${rcx} ${rcy - 7 * u} L${rcx + 5 * u} ${rcy + 5 * u} L${rcx} ${rcy + 2 * u} L${rcx - 5 * u} ${rcy + 5 * u} Z`,
      );
      contactScratch.length = 0;
      for (const c of view.contacts ?? []) contactScratch.push(c);
      const fx = -Math.sin(view.heading);
      const fz = -Math.cos(view.heading);
      let drawn = 0;
      for (const c of contactScratch) {
        if (drawn >= 14) break;
        const dx = c.position.x - view.position.x;
        const dz = c.position.z - view.position.z;
        const range = Math.hypot(dx, dz);
        if (range > 6000) continue; // absent, never clamped to the rim
        const ahead = (dx * fx + dz * fz) / 6000;
        const right = (dx * -fz + dz * fx) / 6000;
        const bx = rcx + right * rr;
        const byy = rcy - ahead * rr;
        const b = blip(drawn++);
        b.show(true);
        const d = 4 * u;
        b.set(
          c.ground
            ? `M${bx - d} ${byy - d} h${d * 2} v${d * 2} h${-d * 2} Z`
            : `M${bx} ${byy - d} L${bx + d} ${byy} L${bx} ${byy + d} L${bx - d} ${byy} Z`,
        );
      }
      for (let i = drawn; i < blips.length; i++) blips[i].show(false);

      // ── world-tracked ──────────────────────────────────────────────────
      const nav = view.threatLevel === "MISSILE" ? null : view.nav;
      if (!nav) {
        navDiamond.show(false);
        hide(navText);
        navChevron.show(false);
        smooth.delete("nav");
      } else {
        const navRange = Math.hypot(nav.x - view.position.x, nav.z - view.position.z);
        const raw = project({ x: nav.x, y: view.position.y, z: nav.z }, w, h);
        if (navRange < 260) {
          navDiamond.show(false);
          hide(navText);
          navChevron.show(false);
        } else if (raw.behind || raw.x < 0 || raw.x > w || raw.y < 0 || raw.y > h) {
          navDiamond.show(false);
          hide(navText);
          navChevron.show(true);
          let ax = raw.x - cx;
          let ay = raw.y - h / 2;
          if (raw.behind) {
            ax = -ax;
            ay = -ay;
          }
          const a = Math.atan2(ay, ax);
          const px = cx + Math.cos(a) * w * 0.24;
          const py = h / 2 + Math.sin(a) * h * 0.22;
          const t1 = 13 * u;
          navChevron.set(
            `M${px - Math.sin(a) * t1} ${py + Math.cos(a) * t1} L${px + Math.cos(a) * t1} ${py + Math.sin(a) * t1} L${px + Math.sin(a) * t1} ${py - Math.cos(a) * t1}`,
          );
        } else {
          navChevron.show(false);
          const p = damp("nav", raw, dt);
          navDiamond.show(true);
          show(navText);
          const d = 12 * u;
          navDiamond.set(
            `M${p.x} ${p.y - d} L${p.x + d} ${p.y} L${p.x} ${p.y + d} L${p.x - d} ${p.y} Z`,
          );
          put(navText, p.x, p.y + d + 14 * u, `${nav.name} ${(navRange / 1000).toFixed(1)}k`);
        }
      }

      const target = view.target;
      if (!target || target.alive === false) {
        hide(bracket);
        diamond.show(false);
        hide(rangeText);
        smooth.delete("target");
      } else {
        const raw = project(target.position, w, h);
        const p = damp("target", raw, dt);
        if (raw.behind) {
          hide(bracket);
          diamond.show(false);
          hide(rangeText);
        } else {
          show(bracket);
          show(rangeText);
          const locked = view.lockState === LOCK;
          const size = Math.max(26 * u, Math.min(150 * u, (46 - 18 * (view.lockProgress ?? 0)) * u));
          bracket.setAttribute("x", p.x - size / 2);
          bracket.setAttribute("y", p.y - size / 2);
          bracket.setAttribute("width", size);
          bracket.setAttribute("height", size);
          bracket.setAttribute("stroke", locked ? C.danger : C.warn);
          put(rangeText, p.x, p.y + size / 2 + 14 * u, `${target.label} ${(view.range / 1000).toFixed(1)}k`);
          rangeText.setAttribute("fill", locked ? C.danger : C.warn);
          if (view.lockState === TRACK || locked) {
            diamond.show(true);
            const d = (locked ? 9 : 13) * u;
            diamond.set(`M${p.x} ${p.y - d} L${p.x + d} ${p.y} L${p.x} ${p.y + d} L${p.x - d} ${p.y} Z`);
            diamond.colour(locked ? C.danger : C.warn);
          } else {
            diamond.show(false);
          }
        }
      }

      if (view.lead && view.weapon === "GUN") {
        const raw = project(view.lead, w, h);
        if (raw.behind) hide(pipper);
        else {
          const p = damp("lead", raw, dt);
          show(pipper);
          pipper.setAttribute("cx", p.x);
          pipper.setAttribute("cy", p.y);
          pipper.setAttribute("r", 6 * u);
        }
      } else {
        hide(pipper);
        smooth.delete("lead");
      }

    },
  };
}
