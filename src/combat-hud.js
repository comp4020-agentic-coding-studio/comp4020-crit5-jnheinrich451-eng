// The SVG HUD, in three explicit layers. CLAUDE.md §16, stage 5.
//
// THE LAYERS ARE THE PRIORITY MECHANISM. Paint order is:
//
//   1  screen-fixed   instruments, threat words, messages
//   2  attitude       horizon, pitch ladder
//   3  world-tracked  target bracket, lock diamond, lead pipper
//
// In stage 7 the nav marker paints BEFORE the bracket, so a hostile always
// covers a waypoint. That is a structural guarantee rather than a rule someone
// has to remember, which is the whole reason the layers are explicit.
//
// The HUD is NOT instruction (§"No instructions, anywhere"). It is
// instrumentation, and reading an instrument is part of flying.

import * as THREE from "three";
import { LOCK, TRACK } from "./targeting.js";

const NS = "http://www.w3.org/2000/svg";

export const COLOURS = {
  green: "#8ef0c8", // instruments, good
  amber: "#ffd79a", // warning
  salmon: "#ff9b7a", // danger
  cyan: "#9fd7ff", // advisory / information
  yellow: "#ffd400", // navigation (stage 7)
};

// A gutter the flanking columns start ON, rather than are centred within.
const GUTTER = 34;

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function createCombatHud(host, camera) {
  const svg = el("svg", {
    width: "100%",
    height: "100%",
    preserveAspectRatio: "none",
    "aria-hidden": "true", // instrumentation, not content
  });
  Object.assign(svg.style, {
    position: "fixed",
    inset: "0",
    zIndex: "8",
    pointerEvents: "none",
  });

  // Layers, appended in paint order. Nothing may reorder them at runtime.
  const fixed = el("g");
  const attitude = el("g");
  const world = el("g");
  svg.append(fixed, attitude, world);
  host.append(svg);

  // ── layer 1: screen-fixed instruments ────────────────────────────────────
  // EDGE-ANCHORED, not centred. A centred column spills half its string past
  // its anchor, so respecting a gutter would require knowing the rendered text
  // width. Overlap becomes impossible only when the gutter is a hard edge the
  // text starts on.
  const leftCol = [];
  const rightCol = [];
  for (let i = 0; i < 4; i++) {
    const l = el("text", {
      x: GUTTER, y: 0, fill: COLOURS.green, "text-anchor": "start",
      "font-family": "ui-monospace, monospace", "font-size": 13,
    });
    const r = el("text", {
      x: 0, y: 0, fill: COLOURS.green, "text-anchor": "end",
      "font-family": "ui-monospace, monospace", "font-size": 13,
    });
    leftCol.push(l);
    rightCol.push(r);
    fixed.append(l, r);
  }

  const threat = el("text", {
    x: 0, y: 0, fill: COLOURS.salmon, "text-anchor": "middle",
    "font-family": "ui-monospace, monospace", "font-size": 17,
    "letter-spacing": 3,
  });
  const message = el("text", {
    x: 0, y: 0, fill: COLOURS.cyan, "text-anchor": "middle",
    "font-family": "ui-monospace, monospace", "font-size": 14,
    "letter-spacing": 4,
  });
  fixed.append(threat, message);

  // Gun cross, dead centre -- also where the aircraft is, which is what makes
  // the pointer dead zone legible.
  const cross = el("path", {
    stroke: COLOURS.green, "stroke-width": 1.4, fill: "none", opacity: 0.75,
  });
  fixed.append(cross);

  // ── layer 2: attitude ────────────────────────────────────────────────────
  const horizon = el("path", {
    stroke: COLOURS.green, "stroke-width": 1.2, fill: "none", opacity: 0.5,
  });
  attitude.append(horizon);

  // ── layer 3: world-tracked ───────────────────────────────────────────────
  const bracket = el("rect", {
    fill: "none", stroke: COLOURS.amber, "stroke-width": 2, rx: 2,
  });
  const diamond = el("path", { fill: "none", stroke: COLOURS.amber, "stroke-width": 2 });
  const pipper = el("circle", {
    r: 6, fill: "none", stroke: COLOURS.green, "stroke-width": 1.6,
  });
  const rangeText = el("text", {
    fill: COLOURS.amber, "text-anchor": "middle",
    "font-family": "ui-monospace, monospace", "font-size": 11,
  });
  world.append(bracket, diamond, pipper, rangeText);

  const projected = new THREE.Vector3();
  // Damped screen positions, so world-tracked markers do not jitter frame to
  // frame as the camera shake moves under them.
  const smooth = new Map();

  function project(point, w, h) {
    projected.set(point.x, point.y, point.z).project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * w,
      y: (1 - (projected.y * 0.5 + 0.5)) * h,
      behind: projected.z > 1,
    };
  }

  function damp(key, p, dt) {
    const previous = smooth.get(key);
    if (!previous) {
      smooth.set(key, { x: p.x, y: p.y });
      return p;
    }
    const k = 1 - Math.exp(-18 * dt);
    previous.x += (p.x - previous.x) * k;
    previous.y += (p.y - previous.y) * k;
    return { ...previous, behind: p.behind };
  }

  const hide = (node) => node.setAttribute("visibility", "hidden");
  const show = (node) => node.setAttribute("visibility", "visible");

  return {
    svg,
    setVisible(v) {
      svg.style.display = v ? "" : "none";
    },
    isVisible: () => svg.style.display !== "none",

    update(dt, view) {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      const cx = w / 2;
      const cy = h / 2;

      // Layer 1.
      const left = [
        `SPD ${view.speed.toFixed(0)}`,
        `ALT ${view.altitude.toFixed(0)}`,
        `AGL ${Number.isFinite(view.agl) ? view.agl.toFixed(0) : "--"}`,
        view.afterburner ? "AB" : "",
      ];
      const right = [
        `AIM-9 ${view.missiles}`,
        `GUN ${view.gunRounds}`,
        view.weapon,
        view.mode,
      ];
      leftCol.forEach((node, i) => {
        node.setAttribute("y", cy - 40 + i * 20);
        node.textContent = left[i];
      });
      rightCol.forEach((node, i) => {
        node.setAttribute("x", w - GUTTER);
        node.setAttribute("y", cy - 40 + i * 20);
        node.textContent = right[i];
      });

      threat.setAttribute("x", cx);
      threat.setAttribute("y", h * 0.18);
      threat.textContent = view.threat ?? "";

      message.setAttribute("x", cx);
      message.setAttribute("y", h * 0.78);
      message.textContent = view.message ?? "";

      cross.setAttribute(
        "d",
        `M${cx - 16} ${cy} h10 M${cx + 6} ${cy} h10 M${cx} ${cy - 16} v10 M${cx} ${cy + 6} v10`,
      );

      // Layer 2: a horizon line rolled and pitched with the aircraft.
      const roll = -view.bank;
      const pitchPx = (view.pitch / (Math.PI / 4)) * (h * 0.25);
      const half = w * 0.22;
      const hx = Math.cos(roll) * half;
      const hy = Math.sin(roll) * half;
      horizon.setAttribute(
        "d",
        `M${cx - hx} ${cy + pitchPx - hy} L${cx + hx} ${cy + pitchPx + hy}`,
      );

      // Layer 3.
      const target = view.target;
      if (!target || target.alive === false) {
        hide(bracket);
        hide(diamond);
        hide(rangeText);
        smooth.delete("target");
      } else {
        const raw = project(target.position, w, h);
        const p = damp("target", raw, dt);
        if (raw.behind) {
          hide(bracket);
          hide(diamond);
          hide(rangeText);
        } else {
          show(bracket);
          show(rangeText);
          // The bracket closes as the lock builds: the diamond shrinking onto
          // the target IS the lock progress, with no bar and no percentage.
          const locked = view.lockState === LOCK;
          const size = 46 - 18 * (view.lockProgress ?? 0);
          bracket.setAttribute("x", p.x - size / 2);
          bracket.setAttribute("y", p.y - size / 2);
          bracket.setAttribute("width", size);
          bracket.setAttribute("height", size);
          bracket.setAttribute("stroke", locked ? COLOURS.salmon : COLOURS.amber);

          rangeText.setAttribute("x", p.x);
          rangeText.setAttribute("y", p.y + size / 2 + 14);
          rangeText.setAttribute("fill", locked ? COLOURS.salmon : COLOURS.amber);
          rangeText.textContent = `${target.label} ${(view.range / 1000).toFixed(1)}k`;

          if (view.lockState === TRACK || locked) {
            show(diamond);
            const d = locked ? 9 : 13;
            diamond.setAttribute(
              "d",
              `M${p.x} ${p.y - d} L${p.x + d} ${p.y} L${p.x} ${p.y + d} L${p.x - d} ${p.y} Z`,
            );
            diamond.setAttribute("stroke", locked ? COLOURS.salmon : COLOURS.amber);
          } else {
            hide(diamond);
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
        }
      } else {
        hide(pipper);
        smooth.delete("lead");
      }
    },
  };
}
