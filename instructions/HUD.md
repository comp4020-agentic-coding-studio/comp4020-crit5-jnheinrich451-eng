# HUD.md — head-up display specification

Addendum to `CLAUDE.md`. Sections are numbered **H1–H12** so they never collide
with CLAUDE.md's §. Where this document and CLAUDE.md disagree on a HUD number,
this document wins; on anything else, CLAUDE.md wins.

Everything here is implementable in `src/combat-hud.js` plus the HUD text block
in `src/main.js`. No new module, no new dependency, no CSS framework.

---

## H1. What the HUD is for

The player is 24 m behind their own aircraft at 200 m/s. Everything on screen has
to be readable in **one glance, from peripheral vision, over a bright grey carrier
deck and a bright sky**. That is the whole design constraint, and it is the reason
for every rule below.

Three principles, in priority order:

1. **Legibility beats fidelity.** This is not an F-15 HUD replica. If a real
   symbol is unreadable at a glance, it does not go on.
2. **Information, never instruction** (CLAUDE.md §16). `AIM-9 2` is state.
   `PRESS F TO FIRE` is a tutorial and is forbidden.
3. **Nothing moves that does not mean something.** A number that jitters at rest
   is noise. Damp every displayed value; never print raw physics.

### The three defects this document exists to fix

Observed on the current build (carrier deck, 2495 px viewport):

- **D1 — the text is too small and too far apart.** Font sizes are authored in
  fixed pixels, so on a large display the readouts shrink to ~0.5% of viewport
  height and the left and right columns end up a screen apart with nothing
  between them. The eye has to travel to read two numbers.
- **D2 — no contrast floor.** Thin unstroked green glyphs over a light deck and a
  hazy horizon. On the deck, `SPD 0` is nearly invisible.
- **D3 — stores and aircraft mode are stacked in the flight-instrument column.**
  `AIM-9 2 / GUN 500 / AIM-9 / ASSISTED` in one right-hand block puts a magazine
  count, a weapon selection and a flight-model mode at the same rank as
  altitude, and forces the eye to parse four unrelated things in one column.

---

## H2. Layers — unchanged from CLAUDE.md, restated for completeness

SVG overlay, `position: fixed; inset: 0; pointer-events: none`, one `viewBox`
matching the CSS pixel viewport. Paint order:

```
hitVeil            damage flash, painted UNDER everything (§32)
WorldTrackedLayer  target bracket, off-screen cue, nav marker, SAM brackets
AttitudeLayer      pitch ladder, bank pointer, velocity marker
ScreenFixedLayer   reticle, readouts, stores, threat, stack, radar
```

A symbol lives in exactly one layer. If a symbol seems to need two, it is two
symbols.

---

## H3. The scale unit `u` — the fix for D1

**Every font size, offset, radius and stroke width in the HUD is expressed in
`u`, never in raw pixels.**

```js
// One place, recomputed on resize only.
const u = clamp(viewportHeight / 1080, 0.85, 2.0);
```

- `1080` is the authoring reference: the HUD was designed at 1920×1080 and every
  number in this document is a 1080-referenced value.
- The **lower clamp** stops a short window from making the HUD unreadable.
- The **upper clamp** stops a 5K display from turning the HUD into a billboard.
- Scale by **height**, not width: an ultrawide window has more room sideways but
  the same viewing distance, and a width-driven unit inflates type on a letterbox
  for no reason.

**Trap.** Do not scale by `devicePixelRatio`. The SVG viewBox is already in CSS
pixels, so DPR is handled by the browser; multiplying by it double-counts and
produces the enormous-HUD bug.

**Gate.** Assert `u` at 720p, 1080p, 1440p and 2160p, and assert that the
smallest text on the HUD (the 10-referenced labels) is never below **11 CSS px**
after scaling.

### Type ramp (all × `u`)

| role | size | letter-spacing | weight |
|---|---|---|---|
| primary value (SPD, ALT) | 26 | 0.5 | 500 |
| secondary value (AGL, THR, counts) | 15 | 1.2 | 400 |
| label (SPD, ALT, STORES) | 11 | 2.2 | 400 |
| combat stack top slot | 17 | 3.4 | 500 |
| combat stack lower slots | 13 | 1.6 | 400 |
| threat word | 18 | 5.0 | 500 |
| hit word | 30 | 9.0 | 500 |
| radar label | 10 | 2.0 | 400 |

Monospace throughout — a changing digit must not reflow the string.

---

## H4. Contrast floor — the fix for D2

Every text node and every thin stroke on the HUD carries a dark casing:

```
paint-order: stroke fill
stroke: rgba(4, 8, 10, 0.62)
stroke-width: 2.6u   (text)   /  1.8u (thin symbol strokes)
stroke-linejoin: round
```

Why a stroke and not a drop shadow: an SVG `filter` on a per-frame-updated node
costs a re-raster of that node every frame, and there are ~40 of them. A casing
stroke is free.

Why not a translucent panel behind the readouts: a panel occludes the world, and
the world is the game. Casing keeps the HUD transparent and still readable over
the deck.

**Gate.** No `filter` on any HUD node. Every `text` node created by
`combat-hud.js` gets the casing attributes from the shared `text()` helper — the
gate asserts the helper applies them, so a future symbol cannot forget.

---

## H5. Layout — the fix for D3

Five regions. Each owns one *kind* of information, and nothing crosses regions.

```
┌──────────────────────────────────────────────────────────────────┐
│                      PHASE CUE (H9)                              │
│                       THREAT (H8)                                │
│                                                                  │
│         SPD ┤        · boresight ·        ├ ALT                  │
│      flight state              (H6)          flight state        │
│                                                                  │
│                    COMBAT STACK (H8)                             │
│                                                                  │
│  ASSISTED · 5 PILOTS                          STORES (H7)        │
│  aircraft mode (H10)                             radar (H11)     │
└──────────────────────────────────────────────────────────────────┘
```

### H5.1 Flanking flight state

Two columns either side of the boresight, at boresight height.

```
flank = clamp(min(0.14 · w, 260u), 92u, 300u)     // distance from screen centre
spdX  = cx − flank        left column, text-anchor: start
altX  = cx + flank        right column, text-anchor: end
```

`0.14 · w` replaces the current `0.18 · w`: at 2500 px the columns were 300 px
off centre *and* the boresight cross was 13 px wide, so nothing occupied the
middle third of the screen. Pulling them in is most of the D1 fix.

**The gutter rule stands** (it was earned): the left column is left-aligned **at**
`spdX`, the right column right-aligned **at** `altX`. Never centre-anchored, never
clamped by a computed text width. `safeLeft` from the developer rail only raises
the floor; it can never push a column back across the rail.

Left column, top to bottom:

```
SPD              label, 11u, dim
172              primary, 26u
────────         rule, 68u, faint
THR  84%  AB     secondary, 15u; AB in amber only when lit
```

Right column, top to bottom:

```
ALT              label, 11u, dim
 4210            primary, 26u
────────         rule, 68u, faint, right-aligned
AGL  318         secondary, 15u; amber below 220, salmon below 110
```

Speed goes left and altitude right because that is the universal convention and
a pilot-shaped player already knows it. `AGL` sits under `ALT` because it answers
the same question, and it is the number that kills you in the terrain run.

**AGL over water reads `—`, not `0`.** A dash means "not a factor"; a zero means
"you are about to die", and the sea must not cry wolf for four minutes.

### H5.2 What leaves the flight columns

- `AIM-9 n`, `GUN n`, `FLR n`, selected weapon → **stores panel, bottom right**
  (H7).
- `ASSISTED` / `EXPERT` → **bottom left** (H10).

That is the entire D3 fix: the flanks become a two-number instrument, and the
weapon state becomes one readable block where the player's eye already goes for
the radar.

---

## H6. Boresight, velocity marker, ladder, tapes

```
boresight     cross, 9u arms, 1.4u stroke, at (cx, h · 0.45)
gun ring      dashed circle r 34u, GUN mode only, dim
velocity      small circle r 5u with three 4u ticks, clamped to 0.30 of viewport
pitch ladder  7.6u px/deg, translates only — ladderRollInfluence default 0
bank scale    fixed ticks at 0, ±15, ±30, ±45, ±60; pointer in the attitude layer
heading tape  3.1u px/deg, top of the reticle block, ticks every 10°, labels 30°
```

`centerY = 0.45` stays: the chase F-15 sits low in frame and an origin at true
centre puts the ladder through the airframe.

The velocity marker is the one symbol allowed to disagree with the boresight —
that disagreement *is* the information (where you are going vs where you are
pointing), and it is how a player learns bank sink without being told.

---

## H7. Stores panel — bottom right, above the radar

One block, right-aligned, sitting `radarRadius + radarMargin + 34u` above the
viewport bottom so it can never collide with the radar ring.

```
STORES                                    label, 11u, dim

› AIM-9   2   ▮▮                          15u; selected row carries ›
  GUN   500   ▬▬▬▬▬▬▭▭                    15u
  FLR     8   ▮▮▮▮▮▮▮▮                    15u
  AIM-9 REARM 12s                         13u, amber, only while a timer runs
```

Rules:

- **The selected weapon is marked by position and glyph, not by colour alone.**
  `›` plus full-brightness text for the selected row; unselected rows drop to
  `dim`. Colour-only selection fails for a colour-blind player and fails again on
  a bright deck.
- **Pips, not just digits.** Two AIM-9 is a *quantity a player must feel*; `▮▮`
  is read without counting. The gun uses a 8-cell bar because 500 rounds is a
  fraction, not a count.
- **Empty is amber, never hidden.** `AIM-9 0` in amber with hollow pips. A row
  that disappears when empty teaches nothing.
- **The rearm line only exists while a timer runs** (CLAUDE.md §14 rearm) and
  names which magazine, because both timers are independent.
- **No hardpoint diagram.** A wing silhouette with two rounds on it was
  considered and rejected: the airframe in the middle of the screen already shows
  the rounds hanging on the rails (that is the point of the mounted stores), so a
  diagram would be a second, worse copy of information the player can already
  see.

`live n` (rounds in the air) belongs in the **combat stack**, not here: it is an
event, not an inventory.

---

## H8. Threat, stack, and target marks

Unchanged in behaviour, restated with the `u` ramp and the new casing.

```
threat block   y = 52u, upper centre. Word + direction arrow + range.
               Pulse period by tier: 1.0 / 0.55 / 0.3 s. Never a full-screen flash.
combat stack   three slots at h·0.63, h·0.665, h·0.695 — centred.
               top: LOCK / LOCKING / MISSILE AWAY / EVADE / GUN DRY
               mid: target label + range
               bottom: `n live` and lock-progress dots
bracket        world-tracked, apparentSize clamped 26u..150u
lock diamond   world-tracked; pulses once on acquisition (lockPulseTime 0.22)
```

The stack has **exactly three slots**. A fourth line of combat text is a redesign
of the stack, not an addition to it.

---

## H9. Navigation and phase cue

```
nav marker   r 12u, hidden inside 260 m, edge cue at 0.24/0.22 of viewport
phase cue    y = h · 0.155, one word, 0.45 s fade each end, nav colour
```

The phase cue is a statement of where you are, once. It is not an objective
banner, and it never persists.

---

## H10. Aircraft mode and pilots — bottom left

```
ASSISTED · 5 PILOTS
```

- 11u label ramp, dim; mode brightens for 1.2 s after `M` is pressed, then
  settles back — a mode change is worth a glance, not a permanent light.
- `EXPERT` renders in the good/green tint so the two modes are distinguishable
  at a glance without reading the word.
- Pilots remaining shifts **amber at 2, salmon at 1** (CLAUDE.md §11). MISSION
  only; the segment is absent entirely in FREE and PEACE.
- Bottom left because it is the least urgent information on the display and the
  corner diagonally opposite the radar is the quietest real estate on screen.

---

## H11. Radar

Bottom right, below the stores panel. `radarRadius 74u`, range 6000 m,
heading-up, no sweep, max 14 blips. Triangle for air, square for ground, hollow
for a wreck. Detection only — the radar says nothing about lock, because lock is
the HUD's job and duplicating it would let the two disagree.

---

## H12. Colour

```
line     #cfe8d8   primary symbology
dim      rgba(207,232,216,0.62)
faint    rgba(207,232,216,0.30)
good     #9fe6b0   Expert mode, healthy counts
nav      #8fd0ff   navigation, phase cue
warn     #ffd79a   low AGL, empty magazine, rearm, 2 pilots
danger   #ff9a8f   incoming missile, hit, 1 pilot, loss
ab       #ffb45a   afterburner
radar    rgba(143,208,255,0.75)
```

Six hues total and no gradients. Amber and salmon are the only colours that ever
appear unprompted, which is what makes them mean something.

---

## H13. Gates for this document

Add to `src/flight.test.js`. All pure, none needs a `THREE.Scene`.

1. `hudScale(720) === 0.85` (clamped), `hudScale(1080) === 1`, `hudScale(2160)`
   clamped to 2.0; smallest ramp entry × `hudScale(720) ≥ 11`.
2. Flank at `w = 1280, 1920, 2560, 3840`: monotonic, never below `92u`, never
   above `300u`, and `spdX > safeLeft` for a 320 px developer rail.
3. Left column is `text-anchor: start` at `spdX`; right column `end` at `altX` —
   asserted on the live nodes, since this is the invariant that took three
   rounds to get right.
4. Every `text` node under `#combat-hud` has a casing stroke and
   `paint-order: stroke fill`.
5. AGL over water renders `—`; AGL 300/200/100 render neutral/warn/danger.
6. Stores panel: selected row carries `›`; empty magazine renders amber with
   hollow pips; rearm line absent when no timer runs, present and labelled when
   one does.
7. Stores panel top edge sits above `h − (radarRadius + radarMargin)` at 720p
   and at 2160p — the two ends of the `u` clamp are where a collision would
   first appear.
8. Combat stack has exactly three text nodes.
9. `PILOTS` segment absent in FREE and PEACE.
