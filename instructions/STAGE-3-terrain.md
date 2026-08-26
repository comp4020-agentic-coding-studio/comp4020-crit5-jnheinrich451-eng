# Stage 3 — Terrain, probes, and being rewound

**Goal:** fly into Ireland and be rewound out of it.

Prerequisite: stage 2 green.

This is the first of the three stages most likely to cost you a day. The grid
index is simple; its failure mode — **silently reporting no terrain** — is
invisible until something depends on it.

---

## Files

```
src/world.js         add terrain load/normalise + a terrain report
src/physics.js       NEW — grid index, five probes, 60 Hz, safe-state history
src/collision.js     NEW — CollisionEvent + DevelopmentRecoveryResponse
src/physics-debug.js NEW — probe visualisation (P key)
```

---

## Terrain (`world.js`)

Load the heightfield-style glTF and **normalise from measured bounds to 30 km
across**. Expect ~643 m peak above sea level and ~2595 m total vertical range.

Position it so its near edge sits at **z ≈ −7600**. Do not author that number as
the coastline — **measure it and publish it in a terrain report**, because every
downstream system derives from it: the mission route, the SAM placement, the
"distance to coast" readout. Log the report.

The report needs at least: `nearEdgeZ`, horizontal extent, vertical range, peak
above sea, and whether the load succeeded.

If the terrain fails to load, the game must stay playable over open water and the
failure must appear in the rail's list.

---

## The grid index (`physics.js`)

Build a **uniform grid over the terrain triangles at load**. Expected figures for
a 30 km mesh:

```
triangles          ~182,000
index size         ~8.9 MB
triangles per cell ~9.5
build time         ~20–40 ms, once
query cost         ~0.002 ms
```

**Benchmark it against `THREE.Raycaster` over the same meshes at load and log
both.** The raycaster costs ~4–6 ms per query, so the index is roughly 2500×
faster. That measurement is the entire justification for not taking a BVH
dependency — produce it rather than asserting it, and keep it in the load log so a
future regression is visible.

**Sanity-check ground heights at known coordinates** and log them. A query that
returns "no terrain found" when terrain is present is the failure that eats a day,
and it does not announce itself: everything downstream just quietly treats the
world as ocean.

---

## Probes

```
probes   centre, nose, tail, left wing, right wing
rate     60 Hz, decoupled from the render frame
```

Publish per-frame: minimum clearance, which probe is closest, the surface beneath
(land or ocean), AGL, and a forward look-ahead distance.

Use a fixed-step accumulator so physics runs at 60 Hz regardless of frame rate.

---

## Safe-state history

Maintain a ring of recent flight snapshots, recorded **only while clearance
exceeds a speed-scaled threshold**. This is what the recovery policy rewinds into.

The threshold must scale with speed: 60 m of clearance at 110 m/s is comfortable
and at 250 m/s is already an impact.

**The newest safe state is not safe enough.** The most recent recorded snapshot
often sits one query before the collision, so rewinding to it re-flies the same
impact. Rewind to a state ~0.65 s old and bleed the speed on restore.

---

## CollisionEvent and the policy split (`collision.js`)

This is the architecture from `CLAUDE.md` §4, and stage 7 depends on it existing
now:

```
physics.js  →  CollisionEvent  →  a response POLICY
```

`physics.js` **detects and knows nothing else.** It produces an event with the
contact type (terrain / ocean), position, speed, timestamp, and whether it came
from a forward prediction. It must never decide what a collision means.

Build one policy this stage:

**`DevelopmentRecoveryResponse`** — rewind 0.65 s into the safe-state history,
cap speed at ~160 m/s, clear input, and hand control back after a short grace
period. Neutralise the stick during that grace: the input that flew into the
mountain must not be reapplied on the restore frame.

Both this policy and stage 7's must implement the same `handleCollision(event)`
and `tick(dt)` interface, so a developer key can swap them with **byte-identical
detection**.

**`physics.update()` must also tick the installed policy.** Any branch elsewhere
that skips physics has to tick the policy itself — stages 4 and 9 both add such a
branch, and omitting the tick freezes the game.

### Prediction versus contact

Detection fires on `physicalContact || forwardImminent`. The second is a
**prediction** from a forward ray, not a collision.

This policy *acts* on the prediction — that is the automatic dodge that makes
terrain development bearable. Stage 7's policy must **decline** it. Design the
event so a policy can tell the two apart, and give physics its own cooldown for
when a policy declines.

---

## Debug view (`physics-debug.js`)

`P` toggles. Draw the five probes and their clearance. You will use this
constantly in stages 7 and 8, and it is far cheaper to build now than to add while
chasing a terrain bug.

---

## Runnable state

- the island is there, correctly scaled, with fog doing the distance work
- flying into a hillside rewinds you 0.65 s with speed bled off
- the rail shows clearance, closest probe, surface, AGL and forward hazard
- `P` shows the probes
- the load log carries the index figures and the raycaster comparison

---

## Test gate

- **Index agrees with the raycaster.** Cast the same rays through both and assert
  the same hit heights within tolerance. This is the check that catches a broken
  index.
- **The benchmark logs both costs** and the index is at least two orders of
  magnitude faster.
- **Clearance and AGL are correct** over land and over sea, at a known coordinate.
- **Probe set:** all five probes are queried; the reported minimum is the actual
  minimum.
- **Fixed step:** physics advances the same number of ticks per second of
  simulated time at 60 Hz and 20 Hz render rates.
- **Safe-state history** records only above the speed-scaled threshold, and is
  cleared on reset.
- **Rewind lands in flyable air** and caps speed.
- **Grace period neutralises input** for its duration.
- **A declined prediction still sets physics' own cooldown.**
- **`physics.reset(state, { keepPolicy })`** clears history without resetting the
  policy — stage 7 needs this, because the policy performing a restore must not
  cancel its own fade.
