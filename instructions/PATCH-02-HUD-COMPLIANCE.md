# PATCH-02 — HUD compliance check (no design change)

This patch adds **nothing**. `HUD.md` is the baseline and stays exactly as
written; two of its sections were not applied and this is the order to apply
them. If a diff here changes a layout number, a size, a region or a rule, it is
wrong — revert it.

## Two clarifications first — these are NOT defects, do not "fix" them

1. **The developer rail is not the HUD.** The top-left parameter block is `#hud`
   in `flight-lab.html`, toggled by `H`, and `HUD.md` never governed it. It being
   hidden by default is correct. Do not move rail content onto the combat HUD,
   and do not change its default visibility.
2. **An empty combat HUD on the deck is correct.** During `DECK`/`LAUNCH` there
   is no target and weapons are cold, so the combat stack (H8) draws no slots and
   the world-tracked bracket, lock diamond and threat block have nothing to
   track. Do not add a placeholder, a dash, an "ARMED" line or a zeroed lock
   readout. The player learns the combat HUD exists when there is something to
   fight, which is `HUD.md` H1 principle 2.

## Defect C1 — the palette was only partly adopted (H12)

Primary values (`SPD`, `ALT` and their numbers) render in the developer rail's
near-white `#e8f0f6` instead of `line #cfe8d8`. The stores panel appears to mix
both.

- Every HUD node takes its fill from the `COLOR` table in `combat-hud.js`, and no
  HUD node may carry a literal colour string.
- Grep the module for `#` hex literals outside the `COLOR` table declaration; the
  correct count is **zero**. Add that as an assertion so a future symbol cannot
  reintroduce one.
- `main.js` may pass *state* to the HUD (afterburner lit, AGL value, pilots
  remaining) but never a colour. If a colour is currently being passed in, delete
  the parameter and derive it inside the HUD from the state.

## Defect C2 — the contrast floor is not on the glyphs (H4)

`L A U N C H` over the sky is unreadable, and every label is thinner than the
spec.

- The casing must come from the shared `text()` helper, applied to **every** text
  node, with **`paint-order: stroke fill`**. Without paint-order the stroke
  paints over the glyph — which both hides the casing and visually thins the
  letter, and is the most likely single cause of what is on screen.
- Values: `stroke rgba(4, 8, 10, 0.62)`, `stroke-width 2.6u` on text and `1.8u`
  on thin symbol strokes, `stroke-linejoin: round`.
- The phase cue and the nav label are the two worst cases in the build (large
  letter-spacing, low-alpha fill, bright sky behind). Screenshot both against the
  deck-view sky, not against terrain.
- No `filter` on any HUD node.

## Gate

Add to `src/flight.test.js`:

1. Zero hex colour literals in `combat-hud.js` outside the `COLOR` table.
2. Every `text` node under `#combat-hud` has a non-empty stroke, a stroke width
   > 0 and computed `paint-order` beginning with `stroke`.
3. `SPD`/`ALT` value nodes resolve to `COLOR.line`, not to any near-white value —
   assert the exact string from the table.
4. No node under `#combat-hud` has a `filter` attribute or style.

Then re-run the `HUD.md` H13 gates unchanged and report the count. Show me the
deck view and one in-combat frame.
