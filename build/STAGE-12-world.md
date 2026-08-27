# Stage 12 — The living world

**Goal:** an 8-minute day/night cycle, a moving ocean, and lights on the island
after dark. Presentation only — no gameplay rule changes, no weather.

Prerequisite: stage 11 green.

```
src/world-time.js    the clock, the keyframed palette, sun and moon
src/ocean.js         the GPU wave surface
src/night-lights.js  settlement and carrier lights
src/main.js          one consumer block: read the environment, write the visuals
flight-lab.html      nothing
```

---

## Scope discipline first

**No weather system.** No rain, no storms, no wind, no cloud fronts driven by the
clock. The sortie is four minutes long; a weather system is a different game and
it would have nothing to do in this one.

The cycle is a **clock**, and one normalised phase `tau` in 0..1 owns it. Nothing
else may write `tau`. Every consumer reads one interpolated palette, so the sky,
the fog, the water, the sun, the moon and the lights cannot disagree about what
time it is.

---

## The clock

```
cycle            8 real minutes = 24 visual hours
start            tau 0.18 (mid-morning)
sunrise/sunset   tau 0.045 / 0.55
sun peak         2.3        moon 0.55 (deliberately brighter than reality)
[ and ]          jump to sunrise / sunset — developer keys
```

### The trap: a saturating factor makes a flat plateau

This stage's one real defect, and it is worth the space because the shape recurs.

`dayFactor` saturates at a sun elevation of about 0.30. With a bare `day²` term
the sun therefore holds **one constant value across two thirds of the cycle**, and
the daytime keyframes were near-identical colours besides. Two minutes of flying
from the start showed *nothing changing*, and the honest report was "I'm not sure
the day/night cycle is loaded" — about a system that was working exactly as
specified.

Three fixes, all needed:

1. A gentle non-saturating elevation ramp, so midday is genuinely brighter than
   mid-morning: `sunPeak * day * day * (0.78 + 0.22 * max(0, elev))`
2. Pull the daytime keyframes apart in **colour** — morning paler and cooler,
   afternoon warmer. Colour shift is what the eye notices while the sun is at full
   strength; intensity alone is nearly invisible in daylight.
3. Shorten the cycle from 12 minutes to 8, so two minutes of flight covers a
   quarter of the day and sunset arrives about three minutes after launch.

What a player now sees from the catapult:

```
min  tau    sun    sky        water
0    0.180  2.21   #90b5d9    #346288
1    0.305  2.30   #86b0d8    #2b5c7f
2    0.430  2.16   #7fa3cb    #285072
3    0.555  0.49   #657baa    #253d56
3.5  0.617  0      #4c5a8a    night
5    0.805  0      #121b35    #0b1321
```

### Two smaller rules

- **Interpolate keyframes; never select one.** A palette that snaps between
  discrete states is the most artificial thing a cycle can do. Same for the
  lights: fade them by the night factor, never switch them.
- **Name the phase on the developer rail** (`MIDDAY 0.216`). Without it, "is the
  clock running?" can only be answered by staring at the sky, which is not a
  check — and that ambiguity is what made the flat plateau above so hard to
  report.

---

## The ocean

One mesh, one `ShaderMaterial`, three sine components on the GPU. No FFT, no fluid
solve, no reflection camera, no second render pass.

```
patch          90 km, follows the player in X/Z only, y stays at 0
grid           96×96 RADIALLY WARPED (power 2) — ~20 m cells at the centre,
               ~1.9 km at the rim. 9409 vertices either way.
waves          3 components: 0.70 m / 620 m, 0.38 m / 210 m, 0.17 m / 74 m
wave fade      flat beyond 7 km of the camera
Fresnel        base 0.012, power 6.5, CAPPED at 0.55
```

### Five defects, all shipped once

1. **The patch was 14 km, on the assumption fog would hide its edge.** It does
   not. At 3.9 km altitude the fog factor 7 km out is **0.058** — six percent — so
   the sea ended in a hard dark quadrilateral with sky beyond it. At 90 km the rim
   sits at **0.92**. Visibility is roughly `1/fogDensity` (~28 km here); compute
   it, do not guess "far enough".

2. **Do not subdivide, warp.** 96² over 90 km is a 937 m cell, coarser than the
   74 m chop, which aliases into triangular garbage. Remapping each axis by
   `|u|^2` puts the fine cells where the waves are legible and spends nothing on
   water 40 km away. Done once on the CPU at build time.

3. **Fade wave amplitude with distance.** Rim cells are kilometres across;
   displacing them as hard as the centre cells turns the horizon into slow
   enormous ripples.

4. **Cap the Fresnel blend.** Uncapped, the term reaches high values across most
   of the visible water and drags the whole surface toward the pale horizon
   colour — reported, accurately, as "like a soup, not an ocean". Water *tinted*
   by the sky reads as water; water *replaced* by it does not. The wide sheen lobe
   is the other half of the milkiness (0.12 → 0.045).

5. **A raw `ShaderMaterial` does not get the renderer's output colour-space
   conversion** that built-in materials receive. Include three's
   `<colorspace_fragment>` chunk or a mid navy renders near-black.

### The waterline is a colour boundary

Over open sea at low altitude, the **only** cue for how high you are is the
contrast between air and surface. A grey-blue sea against a pale sky has almost
none, and the report was "I can't tell if I'm near the surface".

So: hold the water **more saturated than both the sky and the horizon at every
daylight hour** (midday `#14589b`, not `#2b5c80`), and keep the small chop large
enough to read from the cockpit at 200 m/s (0.17 m, not 0.11 m). At night the
boundary switches to luminance — the haze band stays brighter than the water.

Compute the wave phase from **world** position so the pattern is stable as the
patch follows the player, and snap the mesh to a coarse step so the tessellation
does not crawl through it. Patch height stays at y = 0, which is also the collision
plane, so the visual and physical sea never disagree.

---

## Night lights

Deterministic from a fixed seed — the same island every run — and placed only
where the terrain is habitable: low, flat and inland. A few cities, more towns, a
sparse dusting. Faded in by the night factor, never toggled.

The carrier gets its own lights, positioned from the **measured** deck anchors
like everything else on it, so they land correctly whatever the asset's
proportions are.

---

## Test gate

- Midday is measurably brighter than mid-morning **and** mid-afternoon
- The daytime sky colour and water colour both actually change
- Two minutes of flight from the start moves the sky measurably, and sunset
  arrives within about four
- `tau` wraps: a preset jump or a long `dt` can never leave the cycle
- The water is more blue than the horizon at every daylight sample
- Midday water is a real blue, not a grey-blue
- The small chop is ≥ 0.15 m
- The Fresnel cap is below 0.7 and above 0.2 — a cap of 1.0 is the soup
- The ocean patch exceeds the fog visibility several times over
- Settlement placement is deterministic for a given seed, and no settlement lands
  on water

The first three are the flat-plateau regression, pinned. They are the assertions
most worth having in this stage, because that failure is invisible to every other
kind of test and looks like a broken load.

---

## Runnable state

Press `]`. Fly low over water, then climb to 4 km and look at the horizon.

Two things only your eyes can settle: whether the wave scale reads right from the
cockpit, and whether the patch edge is genuinely gone rather than pushed further
out. If a seam still shows at extreme altitude, raise `WORLD.fogDensity` slightly
or `OCEAN.patchSize` again — in that order.
