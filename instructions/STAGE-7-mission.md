# Stage 7 — The sortie

**Goal:** the full nine-phase mission completes.

Prerequisite: stage 6 green.

This is the second of the three stages that can cost you a day, and the specific
danger is **anything with a stored position** — a checkpoint captured in one place
and restored into different terrain.

---

## Files

```
src/mission.js    NEW — phases, transition table, route survey, triggers,
                  checkpoints, autopilot
src/collision.js  add MissionCheckpointResponse (G swaps the two policies)
src/combat-hud.js add nav marker, phase cue
flight-lab.html   add #fade and the #complete screen
```

---

## Phases

**One pure transition function.** Nothing else may promote a phase.

```
DECK → LAUNCH → EGRESS → INTERCEPT → DEFENSIVE → TERRAIN → FINAL → EXTRACTION → COMPLETE
```

| phase | advances on | floor | fallback |
|---|---|---|---|
| DECK | catapult fires | — | — |
| LAUNCH | control handoff | — | — |
| EGRESS | intercept waypoint reached | — | 44 s |
| INTERCEPT | kill, or next region reached | 26 s (6 s after a kill) | 52 s |
| DEFENSIVE | kill, magazine spent, or next region | 30 s (6 s after a kill) | 58 s |
| TERRAIN | last of three inland legs | — | 98 s |
| FINAL | seaward waypoint reached | — | 62 s |
| EXTRACTION | recovery cinematic ends | — | 78 s to start |
| COMPLETE | terminal | — | — |

**Every phase needs a time fallback.** No combination of missed shots or ignored
enemies may soft-lock a sortie. There is no way to lose on time — the clock is a
stopwatch and the fallbacks only ever push the player forward.

**The floors are required, not decorative.** Without them the combat phases end in
about twelve seconds: the coastline volume that serves as their "next region" is
close enough that flying straight through clears both encounters before either
reads as one. The kill floor is much shorter because an encounter the player *won*
should not hold them — it only needs to let the explosion land.

---

## Trigger volumes

**Legs *are* trigger volumes.** The object the HUD points at and the object that
advances the mission must be the same object, so they cannot drift apart.

Horizontal spheres — **altitude must not gate a waypoint** — with radii
1250–2400 m. Only the recovery volume has an altitude band (80–3800 m).

Radii are deliberately broad: a player must never miss progression by 50 m.

**Check only the current leg**, so flying through a later volume early cannot skip
the route.

```
COAST       offshore, altitude 320 m as the post-launch climb cue
INTERCEPT   offshore, radius 1300
COASTLINE   just past the waterline; serves INTERCEPT and DEFENSIVE
PASS        surveyed inland leg 1
VALLEY      surveyed inland leg 2
RIDGE       surveyed inland leg 3
SEAWARD     inland, on the way back out
RECOVERY    offshore, radius 2400, altitude band 80–3800 m
```

**Assert that INTERCEPT and COASTLINE do not overlap.** If they touch, entering the
intercept area instantly satisfies "reached the next region" for a fight that has
not started. This check exists because they did touch.

---

## Surveying the inland legs

Do not author the inland waypoints. Sample the corridor **1.2–10.5 km inland,
±5.2 km laterally**, and score each lateral band:

```js
bandFeature(samples, span)      // score = min(leftFlank, rightFlank) − centre
pickZonedFeatures(bands, 3)     // one feature per corridor third
```

**The score must use the weaker flank.** A valley is low ground with higher ground
on *both* sides; using the weaker side is what stops a coastal slope — one very
high flank, one at sea level — scoring as a mountain pass.

**Zone before scoring.** Greedy scoring alone clusters: the deepest passes tend to
sit in one massif, leaving most of the corridor without a waypoint. Split into
thirds and take the best of each.

Both functions take an injected `sampleHeight(x, z)`, so they are testable against
a synthetic height field with no scene.

Provide an **authored fallback route** for a build where terrain failed to load.
The mission must remain completable.

---

## Checkpoints

Four, at phase boundaries: deck, open sea, terrain entry, final approach.

A snapshot carries flight state, selected weapon and both magazine counts. **Not
particles, not clouds** — presentation resets, gameplay does not.

Record them **levelled and lifted**, not verbatim: level the attitude onto the
heading being travelled and lift above the ground below. A checkpoint must be a
state the player can fly *out* of; recording a mid-dive attitude 120 m over a ridge
means restoring it re-flies the same impact.

Restore the loadout with `setCount(n)` from stage 5, not `reload()` — otherwise
crashing is the cheapest way to refill the rails.

---

## MissionCheckpointResponse (`collision.js`)

The second policy. Same `handleCollision(event)` / `tick(dt)` interface, so `G`
swaps the two with **byte-identical detection**.

```
trigger → hold → fadeOut → restore at full black → fadeIn → settled
hold 0.28 (stage 9 lengthens this)  ·  fadeOut 0.5  ·  fadeIn 0.62
cooldown 0.55 after settling
```

Three requirements:

- **`trigger()` refuses re-entry** while active or cooling down. A proximity fuze
  or a terrain probe can trip on consecutive frames.
- **Restore at full black**, so the player never sees the teleport.
- **Decline forward predictions.** Detection fires on
  `physicalContact || forwardImminent`, and the second is a *prediction*. Stage 3's
  development policy acts on it — that is its automatic dodge. Failing a mission
  for a crash that has not happened is the worst class of failure, so this policy
  fails on contact **only**. If the prediction was right, real contact arrives a
  moment later and fails the run for something the player can see.

Serve missile hits through the same policy, so one failure model covers both.

---

**Lives.** If the game has a finite pilot count (`../CLAUDE.md` §11), the
checkpoint restore is where one is spent. The count is what the player has left to
fly, so it drops when the replacement is dispatched rather than when the aircraft
is hit — and reaching zero ends the run on a loss screen rather than respawning.

## Extraction

The closing sequence is a **virtual stick, not a transform override**:

```js
autopilotStick({ heading, pitch, altitude, speed }, goal) -> { x, y, roll, throttle }
blendStick(player, auto, k, out)
```

So it flies through the ordinary flight model and obeys the same envelope, bank
sink and camera rig the player was just using — and control is handed *away* over
1.3 s rather than switched off.

Level out, turn toward the carrier, settle at 620 m / 190 m/s, hold 4.4 s, fade
1.5 s. **No touchdown is shown**: the player has already demonstrated skill, and
landing must not become another test.

Use a fourth blended camera composition (standoff 44, height 13, `lagScale 1.5`).

Completion screen: time, air kills, SAM sites, AIM-9 fired/loadout, gun rounds.
`R` or Enter restarts — **Enter only from that screen**, since it is a fire key in
flight.

**The mission clock starts at catapult release and stops at COMPLETE. State that
in exactly one place** so no caller can start it elsewhere.

---

## Encounters and cleanup

Deploy the stage-6 hostile per phase:

```
INTERCEPT   ammo 0, engage delay 3.0
DEFENSIVE   ammo 2, engage delay 2.0
FINAL       ammo 1, engage delay 1.5
```

Deploy it ~2400 m ahead, ~900 m to an alternating side, ~140 m above, **facing
back down the player's course** — a head-on pass announces an intercept and puts it
on screen without a hunt.

Outside those phases, `setActive(false)` and hand targeting an empty list.

At every phase transition and every restore: `missiles.expireOwner("hostile")`,
`gun.clearFx()`, reset the threat monitor and the hit response. Note both are the
*surgical* versions from stage 5 — `missiles.reset()` would delete the player's
in-flight shot and `gun.reset()` would refill the magazine.

---

## Nav marker (`combat-hud.js`)

Drawn **first in the world layer**, so a hostile bracket always paints over it —
priority as paint order rather than as a rule.

A **yellow** (`#ffd400`) diamond, radius 12, stroke 2, with name and range.
Offscreen it becomes a yellow chevron at ~24%/22% of the viewport pointing the way
round.

Yellow, **not orange**: orange sits between the amber warning and the salmon
danger, and a bright orange waypoint reads as a threat.

Hide it inside 260 m, and **suppress it entirely while a missile is inbound** — at
that moment the player needs one piece of information and it is not the waypoint.

The phase name appears once, large, for 2.7 s after a transition, eased in and out.
**That is the only mission text. No tutorial text anywhere.**

---

## Runnable state

- a full sortie runs deck → launch → … → complete with no input beyond flying
- the yellow diamond leads you through the route; `N` draws every volume
- ignoring the hostile entirely still completes the mission
- crashing fades out, restores a checkpoint, and fades back in
- `G` swaps between rewind and mission-failure with identical detection

---

## Test gate

- **The transition table** across every phase, floor, kill-grace and fallback.
- **INTERCEPT and COASTLINE volumes do not overlap.**
- **Trigger volumes:** dead centre is inside; 50 m off-line still counts; altitude
  does not gate a route waypoint; the recovery band does gate.
- **`bandFeature` uses the weaker flank** — build a synthetic pass beside a
  one-sided slope and assert the pass wins.
- **Zoning spreads a clustered field** where pure scoring would not.
- **The route plan** gives every navigating phase at least one leg, terrain anchors
  clear the ground they sit over, and a no-terrain build still gets a full route.
- **A later phase's volume cannot pull the mission forward.**
- **Three end-to-end runs** with a point aircraft: direct, combat ignored entirely,
  and one with a failure in the middle — each asserting COMPLETE, the phase order,
  and four checkpoints.
- **The clock** starts at the catapult and the reported time is the stopped clock.
- **The failure policy:** first hit accepted, simultaneous second refused, restore
  fires exactly once at full black, refused during the settling cooldown.
- **A predicted impact does not fail the mission; real contact does.**
- **Autopilot:** on target it commands nothing; a heading error banks the short way
  round the ±180° seam; below the goal it pulls up; a nose-high attitude damps
  rather than porpoising; `blendStick` at k=0 is the player and k=1 is the
  autopilot.
