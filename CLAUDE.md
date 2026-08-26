# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so the deployed head is the only place a broken one shows up.

## The checks

`pnpm check` runs them, and `pnpm check:evidence` is the extra gate before you
ship. CI runs the same plus links, secrets and the deploy.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.

# Operation Vector

## 0. Instructions

Build the game described below.

**Stack constraints, non-negotiable:**

- Plain JavaScript, ES modules, no TypeScript
- No build step, no bundler, no npm, no `node_modules`
- three.js from a CDN import map in the HTML head
- No backend, no API, no database, no storage writes
- Static files only; `flight-lab.html` is the entry point and runs as-is

**Deliverables:**

```
flight-lab.html      canvas, overlay layers, developer rail, all CSS
tests.html           loads src/flight.test.js and prints a pass/fail count
src/*.js             the modules listed in §3
src/flight.test.js   plain assertions, no test framework
```
__Adjustable__

**Method:** build in the order of §3's dependency groups — world and flight
first, then physics, then combat, then mission and presentation. After each
group, add assertions for its rules to `src/flight.test.js` and confirm the count
is green before continuing. The test suite is the only gate; a red count blocks
further work.

Write comments that record *why*, especially where an obvious alternative was
rejected. §17 lists the traps; when you implement code that one of those covers,
say so in a comment so the constraint survives the next edit.

---

## 1. What to build

A third-person arcade F-15E combat game in the browser. A four-minute authored
sortie: catapult off a carrier, fly 6 km of open water, fight a hostile fighter,
run a low-level corridor through SAM-defended terrain, turn back out to sea for
recovery. Plus two sandbox modes that reuse every system.

Arcade flight model, cinematic presentation, real terrain mesh.

**The governing design bias is readable over realistic.** Every system should be
the cheapest thing that reads correctly at 200 m/s. Where this document specifies
a perceptual cheat, implement the cheat — do not upgrade it to a simulation.

---

## 2. Assets

Source these separately; they are not specified here beyond their required
treatment.

```
F-15E airframe    glTF. Normalise to 19.4 m length.
Carrier (CVN)     glTF. Normalise to 332.8 m length. Must expose deck anchors.
Terrain           glTF heightfield-style mesh. Normalise to 30 km across.
AIM-9 missile     glTF. Normalise to 2.85 m.
Audio             11 files, see §16. The game must run silent if absent.
```

Every asset is **normalised at load from measured bounds**, never scaled by a
hand-typed factor. Load code measures the source bounding box, computes the scale
that produces the target length, and logs the result.

The carrier must yield four local reference points, derived from its measured
bounds rather than authored: `DeckReference`, `LaunchStart`, `LaunchEnd`,
`ApproachReference`. The launch run is the measured distance between
`LaunchStart` and `LaunchEnd` — approximately 199.7 m — and §9 solves the
catapult against whatever that measurement turns out to be.

If an asset fails to load, the game must remain playable: fall back to authored
offsets and record the fallback in a failure list shown on the developer rail.

---

## 3. Proposed structure (Not fixed)

```
flight-lab.html      canvas, #loading, #fade, #crash-flash, #complete,
                     developer rail markup, all CSS
src/main.js          THE ORCHESTRATOR — wiring, frame loop, HUD text

  ── world & physics ───────────────────────────────────────────────
src/world.js         scene graph, ocean, sky, fog, asset normalisation
src/aircraft.js      F-15 load, hierarchy, gear visual swap
src/physics.js       60 Hz probe queries, terrain grid index, safe-state history
src/physics-debug.js probe and anchor visualisation
src/collision.js     CollisionEvent + the two response POLICIES
src/atmosphere.js    cloud field, humidity, advisories
src/vapor-fx.js      wingtip vortices, load-driven
src/engine-fx.js     exhaust plume, afterburner, shock diamonds

  ── flight ────────────────────────────────────────────────────────
src/flight.js        THE FLIGHT MODEL. Pure math, must not import three.js.
src/input.js         keyboard → {x, y, roll, throttle}
src/chase-camera.js  chase rig + blendable alternative compositions
src/launch.js        the scripted catapult launch

  ── combat ────────────────────────────────────────────────────────
src/weapons.js       hardpoints, mounted stores, loadout
src/targeting.js     candidate selection, lock progression
src/missile.js       ONE missile implementation, three configs
src/gun.js           hitscan cannon + tracers
src/enemy.js         the drone airframe (health, hit marking)
src/hostile.js       hostile fighter AI
src/sam.js           SAM sites, line-of-sight, network
src/flares.js        infrared countermeasure
src/threat.js        what is being done to the PLAYER
src/damage.js        PlayerDamageEvent + feedback response
src/crash-fx.js      procedural crash presentation
src/rearm.js         automatic magazine replenishment

  ── mission & presentation ───────────────────────────────────────
src/mission.js       phases, transition table, route survey, autopilot
src/modes.js         MISSION / FREE / PEACE rules table
src/combat-hud.js    SVG HUD in three layers
src/audio.js         cue table, priority, ducking

src/flight.test.js   all assertions
```

---

## 4. Architecture — the pattern to follow throughout

Every subsystem uses the same shape. This is the reason the design absorbs new
enemies, weapons and modes without rewrites, so apply it even where a direct call
would be shorter:

```
DETECTION  produces an EVENT and knows nothing else
                ↓
POLICY     decides what the event MEANS
                ↓
PRESENTATION renders it
```

Two required instances:

```
physics.js → CollisionEvent → DevelopmentRecoveryResponse   (rewind 0.65 s)
                            → MissionCheckpointResponse     (fail + respawn)
missile.js → hit event      → damage.js response            (feedback)
                            → MissionCheckpointResponse     (the failure)
```

Both collision policies must implement the same `handleCollision(event)` and
`tick(dt)` interface, and a developer key (`G`) swaps them live. Detection must be
byte-identical under both.

**Corollary to enforce:** no weapon, missile or physics module may call anything
that resets the flight state. If that seems necessary, the policy is being written
in the wrong place.

### Pure rules with injected samplers

Every non-trivial rule is a pure function with its world dependency injected, so
it is testable without a scene. Required examples:

```js
lineOfSight(from, to, sampleHeight)           // sam.js
safeSpawnAltitude(pos, heading, sampleHeight) // mission.js
surveyTerrainRoute(sampleHeight, coastZ)      // mission.js
seduces(flareRange, targetRange)              // flares.js
missionTransition(state, ctx)                 // mission.js
hostileTransition(ai, ctx)                    // hostile.js
samTransition(sam, ctx)                       // sam.js
```

A rule that requires a `THREE.Scene` to exercise will not get tested. Do not
write one.

### Transition tables

The three state machines (mission, hostile fighter, SAM site) are each **one pure
function**, and nothing else may promote a state. Do not put state changes inside
update loops — when behaviour misbehaves there must be exactly one place to look.

---

## 5. World scale and conventions

```
1 world unit    = 1 metre
F-15E             19.4 m
Carrier           332.8 m
Terrain           30 km across, ~643 m peak above sea, ~2595 m total range
Carrier position  z = −1600
Coastline         z ≈ −7600   (measured: the terrain's near edge)
Carrier→coast     6.0 km
Ocean plane       100 km
Camera            near 0.5, far 120000, logarithmic depth buffer
Fog               FogExp2, density 3.5e-5, tinted to the sky's horizon band
```

The logarithmic depth buffer is required: near 0.5 with a 120 km far plane has
nowhere near enough integer precision for both a 19 m airframe at 24 m and a
coastline 25 km out.

**Course runs toward −Z. Heading 0 = −Z.** Forward vectors are
`(−sin h, −cos h)`. This convention must appear consistently in bearing
calculations, break directions and spawn offsets.

**Nothing hardcodes a world coordinate.** Positions derive from measured asset
anchors or from the terrain report. The mission route is surveyed from the height
field at load (§10), not authored.

---

## 6. Flight model (`flight.js`)

Two modes, `M` toggles. Both must write the same quaternion, so the renderer and
camera read one field regardless of mode.

**ASSISTED** — arcade coordinated turn. Euler angles; bank drives heading change;
controls self-centre. Pitch is an angle the player holds. The aircraft cannot
depart.

**EXPERT** — quaternion integration in aircraft-local space: `quat = quat * delta`.
Input is angular *velocity*. Post-multiplication is what makes the axes local, so
pitching while banked bends the trajectory. **There must be no bank→heading term**
— that is the entire point of the mode.

```
speed        min 110, cruise 170, max 250 m/s
throttle     a persistent LEVER, not an accelerator: releasing the key leaves
             it where it is. Afterburner = top 15% of travel.
bank limit   ±70°
sink         bank-driven altitude loss — the arcade substitute for lift loss
```

Provide `captureFlightState(state)` / `applyFlightState(state, snapshot)` as a
snapshot pair.

**`flightState.quat` must be a plain `{x, y, z, w}` record, not a
THREE.Quaternion.** This module must not import three.js. Provide quaternion
helpers (`quatFromEulerYXZ`, `quatForward`, `quatUp`, multiply, identity) as plain
math. Consumers copy components; they must not call `.copy()` on it.

---

## 7. Input (`input.js`)

Keyboard for flight. The mouse is a trigger and nothing else.

```
W S        pitch                  L-Shift / L-Ctrl   throttle
A D        bank                   Space              barrel roll / evade
Q E        roll rate              I                  pitch convention toggle
LMB / F    fire (hold for gun)    X                  weapon select
Z          flares                 M                  Assisted / Expert
R          restart                C                  clear stuck keys
```

Developer keys: `H` rail · `J` HUD · `K` audio mute · `P` probes · `O` carrier
anchors · `N` nav route · `G` collision policy · `T` game mode · `1 2 3` camera
roll influence.

Three requirements, each load-bearing:

1. **Track axis keys by `event.code`, never `event.key`.** `key` can differ
   between the keydown and keyup of the same physical press (modifiers, caps lock,
   layout, IME). When it differs, the keyup deletes a set entry that isn't there
   and the keydown's entry is orphaned permanently — a stuck axis at full
   deflection that no further input clears.
2. **Arrow keys must not be flight axes.** Browser and embed chrome steal them,
   so their keyup goes missing, producing a phantom "the aircraft turns on its
   own" fault.
3. **Do not implement mouse steering.** There must be no `pointermove` listener.
   A screen position cannot be a stick: it has no centre, no detent and no
   spring, and every attempt to synthesise those from coordinates (relative
   origin, edge drift, claim revocation, settle timers, pointer lock, spring
   return) fixes one failure mode and leaves the others. The flight axes must be
   unreachable from the pointer as a structural property.

Also required: clear all held keys on `blur`, `visibilitychange` (hidden),
`pagehide` and `contextmenu` — each is a way a held key stops being held without a
keyup arriving. Expose `heldKeys()` for the developer rail so a stuck axis is
visible, and bind `C` to clear them manually.

`I` toggles the pitch convention: W = nose up (default) versus W = nose down (the
control-column convention). Implement it as **one sign flip at the input
boundary** so nothing downstream knows it exists. It is a *preference*: it must
survive reset, respawn and mode change, unlike every other transient input state.

---

## 8. Physics (`physics.js`)

```
probes            centre, nose, tail, left wing, right wing
rate              60 Hz, decoupled from the render frame
```

**Build a uniform grid index over the terrain triangles at load.** Expected
figures for a 30 km mesh: ~182,000 triangles, ~8.9 MB index, ~9.5 triangles per
cell, ~20–40 ms build, ~0.002 ms per query. Benchmark it against
`THREE.Raycaster` over the same meshes at load and log both — the raycaster costs
~4–6 ms per query, so the index is ~2500× faster. That measurement is the
justification for not taking a BVH dependency; produce it rather than asserting
it.

Maintain a **safe-state history**: a ring of recent flight snapshots recorded only
while clearance exceeds a speed-scaled threshold. The development recovery policy
rewinds into it.

`physics.update()` must also **tick the installed response policy**. Any branch
elsewhere that skips physics has to tick the policy itself — omitting this freezes
the game whenever physics is bypassed.

Detection fires on `physicalContact || forwardImminent`. The second is a
**prediction** from a forward ray. The development policy acts on it (an automatic
dodge); the mission policy must **decline it** — failing a mission for a crash
that has not happened is the worst class of failure. Physics still sets its own
cooldown when a policy declines.

---

## 9. Scripted launch (`launch.js`)

~7.1 s. **No flight physics runs during it.** The aircraft is attached to a launch
reference frame built from the carrier's measured anchors; the script writes the
whole flight state and the renderer reads it, so the handoff has nothing to
reconcile. No wheel physics, no suspension, no throttle input.

```
0.0–3.4   parked. Engine start plays alone. Camera shake ramps 0.02 → 0.16.
2.8       afterburner lights (shake ×1.5)
3.4       catapult fires. Start sound cut; engine loop takes over.
6.2       release point — exactly the measured deck run. 152 m/s.
6.6       rotate to 12° pitch, gear up
7.1       control handoff at 172 m/s, throttle 0.92, afterburner lit
```

**Solve the stroke duration from the geometry; do not author it.** The speed curve
is `lerp(8, 152, u^1.25)`. Its closed-form distance over duration `T` is
`T · (v0 + (v1 − v0)/(e + 1))`. Invert that to get the time which covers the
measured run exactly, so the release point lands on the `LaunchEnd` anchor at any
frame rate. If the solved time falls outside 2.2–3.1 s, clamp the time and
**re-solve the exit speed instead**, so the geometry always closes.

Use exponent 1.25, not 2.0: a `t²` curve needs 3.56 s to cover 199.7 m at these
speeds, which is not "fast". 1.25 still has acceleration increasing all the way to
the deck edge.

Position from the closed-form integral, not accumulated `dt`, so the release point
is frame-rate independent.

Gear is a **visibility swap between the model's two existing variants** — no
animation. Hide the transition inside the rotation and the afterburner flash.

Camera during launch is a **blend of the existing rig**, never a second camera:
standoff 15.5, height 3.2, framing −0.05, and `lagScale 0.34` to cut forward
damping so the rig falls behind on the stroke. FOV 59° → 71° weighted by the
*square* of stroke progress so the lens opens rather than drifting. Blend out over
1.4 s.

---

## 10. Mission (`mission.js`)

Nine phases, one pure transition function:

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
enemies may soft-lock a sortie. Write two tests that fly the whole mission with a
hostile that is never destroyed and never runs dry.

**The floors are required, not decorative.** Without them the combat phases end in
about twelve seconds, because the terrain-entry volume that serves as their "next
region" is close enough that flying straight through clears both encounters before
either reads as one. The kill floor is shorter, because an encounter the player
*won* should not hold them — it only needs to let the explosion land.

### Route and trigger volumes

**Legs *are* trigger volumes.** The object the HUD points at and the object that
advances the mission must be the same object, so they cannot drift apart.

Horizontal spheres — altitude must not gate a waypoint — with radii 1250–2400 m.
Only the recovery volume has an altitude band (80–3800 m). Radii are deliberately
broad: a player must never miss progression by 50 m.

Check only the *current* leg, so flying through a later volume early cannot skip
the route.

Approximate layout (all derived from the measured coast, not authored):

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

Assert that the INTERCEPT and COASTLINE volumes **do not overlap** — if they
touch, entering the intercept area instantly satisfies "reached the next region"
for a fight that has not started.

### Surveying the inland legs

Do not author the inland waypoints. Sample the corridor 1.2–10.5 km inland,
±5.2 km laterally, and score each lateral band for the best pass:

```js
bandFeature(samples, span)    // score = min(leftFlank, rightFlank) − centre
pickZonedFeatures(bands, 3)   // one feature per corridor third
```

**The score must use the weaker flank.** A valley is low ground with higher ground
on *both* sides; using the weaker side is what stops a coastal slope — one very
high flank, one at sea level — scoring as a mountain pass.

**Zone before scoring.** Greedy scoring alone clusters: the deepest passes tend to
sit in one massif, which leaves most of the corridor without a waypoint. Split the
corridor into thirds and take the best of each.

Provide an authored fallback route for a build where the terrain failed to load;
the mission must remain completable.

### Checkpoints

Four, at phase boundaries: deck, open sea, terrain entry, final approach. A
snapshot carries flight state, selected weapon and both magazine counts. Not
particles, not clouds — presentation resets, gameplay does not.

Record checkpoints **levelled and lifted**, not verbatim: level the attitude onto
the heading being travelled and lift above the ground below. A checkpoint must be
a state the player can fly *out* of; recording a mid-dive attitude 120 m over a
ridge means restoring it re-flies the same impact.

### Extraction

The closing sequence is a **virtual stick**, not a transform override:

```js
autopilotStick({heading, pitch, altitude, speed}, goal) -> {x, y, roll, throttle}
blendStick(player, auto, k, out)
```

So it flies through the ordinary flight model and obeys the same envelope, bank
sink and camera rig the player was just using, and control is handed *away* over
1.3 s rather than switched off. Level out, turn toward the carrier, settle at
620 m / 190 m/s, hold 4.4 s, fade 1.5 s. **No touchdown is shown** — the player has
already demonstrated skill; landing must not become another test.

Completion screen: time, air kills, SAM sites, AIM-9 fired/loadout, gun rounds.
`R` or Enter restarts. Enter only from that screen — it is a fire key in flight.

The mission clock starts at catapult release and stops at COMPLETE. State that in
exactly one place so no caller can start it elsewhere.

---

## 11. Game modes (`modes.js`)

A rules table, not three copies of the game. `T` cycles and restarts.

```
             phases  timer  nav  hostiles  sams  respawn
MISSION        yes    yes   yes    yes      yes  crash-relative
FREE           no     no    no     yes      yes  carrier
PEACE          no     no    no     no       no   carrier
```

Anything that reads like a mode check elsewhere should be a lookup in this table.

Two rules identical across all three modes:

- **Every mode flies the catapult launch.** It is the strongest moment in the
  build and it is what teaches the throttle and the camera.
- **The ground still kills you in PEACE.** "No hostiles" is not "no
  consequences" — a sky with nothing to hit is a screensaver. What changes is the
  cost: you return to the deck and nothing is timed.

In the sandbox modes the mission director **parks** rather than being bypassed: it
still owns the deck and the catapult, then past the handoff stops advancing, stops
timing and publishes no navigation. Assert that a parked director never completes
a mission by accident.

Sandbox driver, deliberately tiny — no waves, no difficulty curve, no hidden
score: one hostile at a time, respawning 12 s after a kill, first arrival 8 s after
handoff.

**SAM sites must not respawn.** Six is a finite thing to clear, and a player who
spent four minutes clearing the valley has earned an empty valley. A respawning
site makes that work meaningless.

---

## 12. Hostile fighter (`hostile.js`)

Eight states, one pure transition function:

```
PATROL → PURSUIT → ACQUIRE → ATTACK → COOLDOWN → REPOSITION → PURSUIT
                        ↘   DEFEND   ↗
```

```
turn rate      12°/s yaw, 7°/s pitch      (×2.1 during a defensive break)
detect         ~5000 m; disengage beyond that
attack cone    520–2500 m, 28° off its nose
lock           1.25 s, then 0.55 s to launch
cooldown       7 s between launches
magazine       INTERCEPT 0 · DEFENSIVE 2 · FINAL 1
min altitude   guarded — it must never fly into the sea
```

**`ammo: 0` is how INTERCEPT is made one-way.** The transition table already
refuses to promote PURSUIT → ACQUIRE without a round, so "it chases you but does
not shoot back yet" requires no new state and no special case. Do not add one.

**DEFEND** reacts to the player's completed lock after `0.9 s` — roughly the time
an AIM-9 needs to launch, so a ready player gets their shot and a hesitant one
watches the target leave. Requirements:

- A *fleeting* lock provokes nothing: accumulate the cue only while the lock is
  actually held, and zero it when the lock drops.
- A committed ATTACK is never interruptible — 0.55 s from lock to launch, and a
  hostile that could be talked out of a shot would never land one.
- A 6 s cooldown, so a sustained lock cannot turn it into a permanent evasion loop.
- Break for a fixed 2.8 s in one direction, with a descending pitch component if
  there is altitude to trade. It should be able to overshoot and end up worse off
  — readable opposition, not an optimal defence.

**Latch the break direction at entry.** Recomputing it per frame flips the cross
product as the aircraft turns, and it oscillates to a net heading change of
nothing.

**One instance serves all three encounters.** Provide `deploy({at, heading, ammo,
engageDelay})` that resets, repositions and re-arms it, and `setActive(on)`.
Outside those phases it must be switched off entirely: not simulated, not drawn,
and not offered to targeting as a candidate.

Deploy it ~2400 m ahead, ~900 m to an alternating side, ~140 m above, facing back
down the player's course — a head-on pass announces an intercept and puts it on
screen without a hunt.

---

## 13. SAM sites (`sam.js`)

Six states, one pure transition function:

```
SEARCH → TRACK → LOCK → LAUNCH → RELOAD → SEARCH
```

```
detect     5000 m          track      1.15 s
envelope   450–4400 m      lock       1.35 s + 0.45 s launch delay
rounds     3 per site      reload     9 s
health     60              loss grace 0.7 s
```

**Line of sight is the entire mechanic.** 14 samples along the segment with a 10 m
clearance margin in the player's favour, so a graze counts as cover. Skip the
endpoints — a site standing on the ground would otherwise report itself as an
obstruction.

It applies **twice**:

1. A site cannot *acquire* what it cannot see.
2. A round already in the air that loses sight keeps only `0.1` guidance
   authority — so diving behind a ridge defeats a shot already committed.

**Do not add a minimum-safe-altitude constant.** Low flight must be safe because
the ground is genuinely in the way. That way it works in a valley, does not work
over a plain, and the player can see why either way.

The loss grace exists so a flicker of terrain does not drop an engagement — beyond
it, the player has genuinely broken the lock.

A spent site must never acquire again: still a target, still worth a kill, but no
longer a threat. Otherwise it sits in LOCK forever with nothing to fire.

**Destroyable with no special cases.** A site publishes the same
`{position, velocity, alive, health, radius, label}` contract the drone does, so
targeting, gun, missile and the HUD bracket all work unchanged. The gun works on
ground targets for free, because a lead solution needs only a position and a
velocity and a SAM's is zero. A kill leaves a **wreck in the world** — tinted,
tilted, turret hidden — not a deletion.

Only sites within detection range and envelope pay for a line-of-sight test; six
sites × 14 samples every frame would be 84 terrain queries.

**Placement:** two per inland leg, flanking the corridor by ~1450 m so the safe
line is *between* them and low. Each site **probes outward** along its side
(scales 1.0, 0.72, 1.28, 0.48, 1.55) and takes the first position standing on
ground at least 30 m above sea level. **A site with nowhere to stand is dropped,
not floated** — five sites on land beat six with one in the sea.

---

## 14. Weapons

### One missile implementation, three configs

`missile.js` must never learn whose round it is.

```
                AIM-9    hostile    SAM
max speed        900       410       440   m/s
turn rate      55°/s     26°/s     22°/s
lifetime        6.5 s      9.5 s     11 s
fuze             22 m        8 m      10 m
turn radius     ~940 m    ~904 m   ~1146 m
```

Enemy turn radii must stay comparable to the F-15's arcade turn at 250 m/s. That
is the fairness claim: **a hard crossing manoeuvre defeats them with no
countermeasure at all.** Assert it.

The SAM round launches *upward* with zero inherited speed, which is what makes its
trail read as a ground launch.

Rounds separate from the rail before guiding, give up beyond an overshoot angle
with opening range (angle alone falsely calls an overshoot on a round still
closing through a crossing geometry), and detonate on a proximity fuze.

### Guidance authority — the single counter-measure hook

The missile asks "how much guidance do I still have?" and must not know what a
barrel roll, a flare or a ridge is:

```js
authorityFor: (m) => {
  const base = threat.authorityFor(m, evasion);        // barrel roll
  if (m.owner !== "sam") return base;
  return lineOfSight(m.position, aircraft, groundAt)   // terrain masking
    ? base : Math.min(base, SAM.maskedAuthority);
}
```

Never reduce authority to zero: a defeated round keeps flying its curve and can
still get lucky on the fuze, so a miss reads as a miss.

### Barrel roll (`Space`)

Degrades an incoming round's authority in a 0.60 s window (0.42 s in Expert — finer
control, tighter window). Announce `EVADE` only for a miss that *was* going to be a
hit, or the player learns nothing from the word.

### Gun (`gun.js`)

Hitscan gameplay, occasional tracers for visuals — a 20 mm burst at a believable
rate would be hundreds of meshes per second. 500 rounds. Provide a lead pipper.

Provide **`clearFx()` separately from `reset()`**: reset reloads the magazine,
which is not cleanup. A phase transition takes the tracers, not the ammunition.

### Flares (`flares.js`)

```
count 8 · perBurst 3 · cooldown 1.4 s · burn 3.2 s
seduceRadius 320 m · minStandoff 160 m
eject: down and back, 28% inherited speed, heavy drag, gravity
```

**A seduced round is RE-TARGETED, not switched off.** Swap the missile's `target`
to the flare — which publishes the same target contract everything else does — so
the round visibly turns and chases it, and its fuze tests against the flare. The
missile system needs no changes.

Do not instead set a "lost" flag that freezes the round's heading: a round that
was tracking well is *already pointed at the player*, so freezing it changes
nothing and it arrives anyway. That distinction is the whole mechanic.

When the flare burns out, mark it `alive = false`; the missile's existing "no live
target" branch then stops guidance and the round coasts out.

Fairness is geometry, not dice. Because flares fall behind on the player's own
flight path: a stern chase flies through them; a head-on shot arrives before they
are near it; a round inside `minStandoff` is committed and the answer is the
barrel roll. Assert all three.

Keep `minStandoff` well below `seduceRadius` — the cloud sits ~200 m astern a
second after release, so a standoff near that distance cancels the radius out and
the mechanic never fires.

Flares are infrared: they defeat a **missile**, never a radar **lock**.

### Rearm (`rearm.js`)

Both magazines replenish 20 s after reaching **empty**, on independent timers, so
one weapon is always coming back and the player is never disarmed.

**Start the timer at empty, not at the first shot.** Otherwise the player fires one
AIM-9, waits, and is handed a third round — the loadout stops meaning anything.
An external refill (checkpoint restore, restart) cancels a running cycle.

---

## 15. Failure and crash (`collision.js`, `crash-fx.js`)

```
0.00   impact. Controls disabled. Crash presentation starts.
0.03   flash + camera kick        0.15   smoke begins
0.08   fireball                   0.25   sparks
0.10   tumble ramps in            0.72   aircraft fades behind its own smoke
1.20   fade to black begins
1.70   RESPAWN at full black
2.32   playable
```

**Do not build a separate crash state machine.** `MissionCheckpointResponse`
already has the right shape — `trigger → hold → fade → restore at black → fade
in` — so make its `hold` stage the crash window (1.2 s) and render the
presentation against its clock. Duplicate suppression then comes free: `trigger()`
already refuses re-entry, which is what stops a tumbling aircraft grinding
through a mountain producing BOOM BOOM BOOM. Assert that every frame of the crash
window refuses a new failure.

The crash presentation **owns the aircraft transform** while active, exactly as
the launch script does. It is a third owner, not a new state enum. Disable weapon
fire, throttle, flares, barrel roll and weapon switch; consume and drop the
discrete latches so a trigger pull mid-explosion does not fire on the respawn
frame.

**The aircraft does not break.** It keeps its pre-impact momentum, tumbles on one
latched angular velocity, and sinks under gravity while a fireball, ~22 sparks, a
world-space smoke trail and 4 primitive fragments grow around it. At 200 m/s that
reads as destruction. Do not implement mesh fracture.

```
flash      1 additive sprite, 0.13 s, expands ×3.4 — no persistent glow
fireball   5–7 sprites, offsets/sizes/rates randomised ONCE at start
sparks     22 sprites, biased along the impact normal, 42% velocity inherited
smoke      15/s for ~0.95 s, WORLD-space so the aircraft leaves a trail
debris     4 meshes from 4 pre-built geometries, 72% velocity inherited
```

Randomise variation once at crash start, then evolve smoothly — never per frame.
Pool everything; share three textures and two materials.

Variants differ as **data, not code paths**:

```
              fire  smoke  sparks  mist  forward  sink  visible
MISSILE       1.0   1.0    1.0     0     1.00     0.55  1.00
TERRAIN       0.85  1.25   1.35    0.5   0.35     1.00  0.75
OCEAN         0.28  0.7    0.55    1.4   0.18     2.60  0.34
```

Water needs real work rather than a palette swap: a downward plunge impulse
(~34 m/s), 2.6× gravity, and a visible window cut to a third, so the aircraft is
hidden *before* it is under the surface. Its plume goes up, not outward, with
normal rather than additive blending.

Camera: one strong kick at 0.03 s decaying at `e^(−5.5t)`, never re-triggered.
Then blend in a looser composition (standoff 34, height 9, `lagScale 0.34`) for
~1.05 s so the rig trails the tumbling aircraft and the fire, smoke and debris are
watchable. Blend it back out.

Add a screen flash layer above the fade, under 0.15 s, low alpha.

### Respawn

Compute it from **where the player died**, not from a stored checkpoint:

```
back off 1800 m along the heading of travel from the point of impact
level, at cruise, sink zeroed
altitude = highest ground in the 4 km ahead + 460 m clearance
```

Sample a **corridor along the heading**, not a point below: a levelled attitude
320 m over a valley floor with a 600 m ridge 1.5 km ahead puts the player back
into contact within two seconds, and the crash repeats forever.

Escalate deliberately on repeated failure: crash again within 14 s and the next
attempt adds 260 m of altitude and 900 m of retreat, up to 4 times. Survive past
the window and the streak resets — dying twenty seconds apart in two places is not
the same problem as being trapped in one. Show the escalation on the HUD.

**An airborne death must not go through a checkpoint rewind.** A rewind restores a
checkpoint's position *and phase*, and if the phase checkpoint was never captured
it falls back to the deck one — flipping the phase to DECK and handing the
aircraft to the launch script. Restore progression (stores, stats) without
touching position or phase.

---

## 16. Presentation

### HUD (`combat-hud.js`)

SVG overlay in three explicit layers, in paint order: screen-fixed, attitude,
world-tracked.

Nav must paint **before** the target bracket, so a hostile always covers a
waypoint — priority expressed as paint order rather than as a rule.

Colour vocabulary. Do not extend it casually:

```
#8ef0c8 green    instruments, good
#ffd79a amber    warning (TRACK)
#ff9b7a salmon   danger (LOCK, MISSILE, damage)
#9fd7ff cyan     advisory / information
#ffd400 yellow   NAVIGATION
```

Nav is **yellow, not orange**, deliberately: orange sits between `warn` and
`danger`, and a bright orange waypoint reads as a threat.

Nav marker: a yellow diamond with name and range, radius 12, stroke 2. Offscreen
it becomes a yellow chevron at ~24%/22% of the viewport pointing the way round.
Hide it inside 260 m, and **suppress it entirely while a missile is inbound** — at
that moment the player needs one piece of information and it is not the waypoint.

The phase name appears once, large, for 2.7 s after a transition, eased in and out.
That is the only mission text. **No tutorial text anywhere.**

Threat display uses the same three words for both sources, labelled by origin
(`SAM TRACK` vs `TRACK`), because the answer differs — terrain for one, turning
for the other. A live round always outranks an acquisition and names its own
owner. With two acquisitions at once, the **closer** one is named: a SAM at 900 m
is more urgent than a fighter tracking from 4 km.

Left and right instrument columns must be **edge-anchored** (`text-anchor: start`
at the left gutter, `end` at the right), not centred. A centred column spills half
its string past the anchor, so respecting a gutter requires knowing the text width
— overlap becomes impossible only when the gutter is a hard edge the text starts
on. Bound the developer rail's width for the same reason: a content-sized panel
grows without limit as text lengthens.

### Radar

A heading-up polar plot in the bottom-right corner. Own-ship at centre with a
nose marker, range rings at half and full scale, 6 km outer range — the hostile's
own detection range plus a margin, so "on the radar" and "in the fight" mean the
same thing.

```
green triangle    own ship, nose up
amber diamond     air contact
amber square      ground contact
```

Five rules, each load-bearing:

- **No sweep and no scan line.** Contacts appear the instant they are detected and
  vanish the instant they are not. A rotating beam would imply a sensor model this
  game does not have, and would make the display a memory rather than a statement
  about the present.
- **Detection only.** The radar says nothing about tracking or lock. The HUD's
  bracket and lock diamond already carry that; duplicating it gives the player two
  places to read one fact and a chance for them to disagree. One colour, two
  shapes.
- **Ground contacts appear only while a site is actually emitting** (TRACK / LOCK
  / LAUNCH). Showing every SAM the moment the player is in range would hand them
  the whole threat map and quietly undo the terrain-masking mechanic of §13. This
  way flying the valley keeps the radar clean, and a square lighting up means the
  same thing as the warning in the player's ear — the display reinforces the rule
  instead of bypassing it.
- **Out of range is absent, not clamped to the rim.** An edge-held ghost implies
  knowledge the aircraft does not have.
- **Amber, not salmon.** "Something is there" is a warning, not a danger; salmon
  means a lock or a live round everywhere else in this HUD.

Blips are pooled and reused, and contacts are gathered into one reused array — a
fresh list per frame would allocate sixty times a second for nothing.

Rotate contacts into the aircraft frame with the project's heading convention:
forward is `(−sin h, −cos h)` and right is its perpendicular `(−f.z, f.x)`, so
"up" on the display is always where the nose points.

### Camera (`chase-camera.js`)

One rig. Alternative compositions are **blended in, never switched to**:

```
              standoff  height  framingY  lagScale
standard       22.5–26     6.5     −0.18      1.00
LAUNCH_VIEW      15.5      3.2     −0.05      0.34
CRASH_VIEW       34.0      9.0     −0.12      0.34
RECOVERY_VIEW    44.0     13.0     −0.10      1.50
```

Standoff and FOV scale with speed. Damp forward direction, up vector and roll
separately. `lagScale` multiplies the forward damping, which is how a composition
gets its lag.

**Camera shake has exactly one channel.** Cannon fire, deck shimmer, catapult
vibration, missile impact and the crash kick all add into the same offset, which
is subtracted at the start of a frame and re-added at the end. Do not add a second
offset — the rig will fight it.

### Audio (`audio.js`)

Eleven cues, **no music**. The atmosphere is an engine, a cannon and a voice
telling the player what has locked them; a score would sit on top of all three and
make the warnings less audible.

```
ENGINE_START   deck spool          AMBIENT    one-shot, stoppable
ENGINE_LOOP    throttle > 2%       AMBIENT    loop, gain + pitch from the lever
GUN            trigger held        WEAPON     loop
LOCK           threat = LOCK       WARNING    3 takes, 3.2 s floor, ducks to 0.45
MISSILE        threat = MISSILE    CRITICAL   2 takes, 2.4 s floor, ducks to 0.30
MISSILE_LAUNCH player fires        WEAPON     0.4 s floor
MISSILE_HIT    any kill / taking one WEAPON   0.3 s floor
FLYBY          hostile inside 340 m AMBIENT   4 s floor
FLARES         on dispense         ADVISORY   forced past its own floor
ALTITUDE       AGL < 220 m         WARNING    3.5 s floor
PULL_UP        forward hazard      CRITICAL   1.8 s floor
```

### File manifest

**11 cues, 14 files** — `LOCK` and `MISSILE` have alternate takes. Every path is
relative to the page; the paths *are* the whole interface, so dropping a correctly
named file into `assets/audio/` makes that cue work with no code change.

| cue | file(s) | volume | content |
|---|---|---|---|
| `ENGINE_START` | `assets/audio/engine-start.mp3` | 0.55 | jet engine spinning up |
| `ENGINE_LOOP` | `assets/audio/engine-loop.mp3` | 0.34 | seamless running-engine loop |
| `GUN` | `assets/audio/gun.mp3` | 0.50 | seamless cannon-fire loop |
| `LOCK` | `assets/audio/lock-1.mp3`<br>`assets/audio/lock-2.mp3`<br>`assets/audio/lock-3.mp3` | 0.85 | voice: "lock on" ×3 |
| `MISSILE` | `assets/audio/missile-1.mp3`<br>`assets/audio/missile-2.mp3` | 1.00 | voice: "missile warning" ×2 |
| `MISSILE_LAUNCH` | `assets/audio/missile-launch.mp3` | 0.80 | own AIM-9 leaving the rail |
| `MISSILE_HIT` | `assets/audio/missile-hit.mp3` | 0.90 | warhead detonation |
| `FLYBY` | `assets/audio/flyby.mp3` | 0.75 | fighter crossing close aboard |
| `FLARES` | `assets/audio/flares.mp3` | 0.80 | dispenser thump |
| `ALTITUDE` | `assets/audio/altitude.mp3` | 0.85 | voice: "altitude" |
| `PULL_UP` | `assets/audio/pull-up.mp3` | 1.00 | voice: "pull up" |

`ENGINE_LOOP` and `GUN` must loop **seamlessly** — they are the only two sustained
cues, and a click at the loop point is audible under everything else.

The two multi-take cues are the only ones that repeat often enough for a single
recording to become grating; three takes of `LOCK` rotating round-robin is
provably never the same take twice in a row.

Because almost every sound is information, the mix is a priority problem:

- **`AMBIENT < WEAPON < WARNING < CRITICAL`.** A warning ducks AMBIENT and WEAPON
  for 1.1 s. A warning never ducks another warning.
- **Every one-shot has a minimum interval.** A cue that repeats is a cue nobody
  hears.
- **Multi-take cues rotate round-robin**, so with three takes it is provably never
  twice in a row — which random selection cannot promise.
- **The gun is a loop**, not 48 one-shots a second.
- **The player's own launch is WEAPON, not WARNING** — it confirms something they
  did and must never mask an inbound call.
- **Warnings are driven from the threat monitor's own escalation**, not a second
  set of conditions, so the sound and the HUD cannot disagree.
- **Nothing plays before a user gesture.** The mission opens on a five-second
  scripted launch with no input in it, so arm on first keypress or click and never
  surface a blocked start as an error.

Ground proximity is two levels, both **AGL, not altitude above sea level**:
`PULL UP` on an imminent forward hazard or low-and-descending, `ALTITUDE` below
220 m AGL. So 200 m over the ocean is quiet and 200 m into a 600 m ridge is not.

The engine loop must **not** run during the deck phase — the start-up plays alone
while the aircraft shakes in place, and is cut the instant the catapult fires,
which is where the loop takes over.

The fly-by fires **once per pass**: it needs a range that crossed the threshold
*this frame* and at least 120 m/s of closure, so a slow drift past is not a fly-by
and a circling hostile does not retrigger.

**Missing audio files are a normal state.** Every cue is optional; the game runs
silent and reports which files resolved. Mark a cue unavailable only on **positive
failure** (an `error` event, or `networkState === NETWORK_NO_SOURCE`) — never on
`readyState < 3`, which is also the state of a file that simply has not finished
loading, and which will mark every working file as missing. Availability starts
optimistic and is corrected by a deadline that the audio module itself owns and
announces; do not put the deadline in one module and the report in another, or the
two will drift.

---

## 17. Invariants

Each of these describes a real failure. Violating one reproduces it.

1. **`flightState.quat` is a plain record.** No `.copy()`. The flight model is
   THREE-free on purpose.
2. **Re-read state after ticking a policy.** A `const` captured before
   `policy.tick()` is stale if the tick fires a callback that changes it — this is
   how a respawn gets overwritten by the wreck transform in the same frame.
3. **Schedule `requestAnimationFrame` FIRST**, then run the frame body inside a
   guard. A single thrown frame must never end the session. On a caught error
   during a crash, fail *safe toward playable* rather than leaving the player
   trapped.
4. **If you skip `physics.update()`, tick the response policy yourself.**
5. **Axis keys by `event.code`, never `event.key`.** No arrow keys as axes.
6. **No mouse steering.** Ever.
7. **One missile implementation.** New rounds are configs, not files.
8. **Enemies publish the target contract** — then targeting, gun, HUD and missile
   work with no special cases.
9. **A latched direction stays latched.** Break directions, tumble axes and dodge
   signs are chosen once at entry; recomputing per frame oscillates to zero.
10. **Every mission phase needs a time fallback.** No soft-locks.
11. **Presentation resets, gameplay does not** — and the reverse: a phase
    transition clears tracers, not ammunition.
12. **A respawn must be flyable.** Levelled, at cruise, above the ground *ahead*.
13. **A test double must match the real thing.** One that diverges tests nothing.
14. **Assert the mechanism, not the symptom.** "The round was defeated" passes
    while a counter-measure is completely broken.

---

## 18. Testing

`src/flight.test.js` is plain assertions with a `check(name, pass, detail)` helper
and a pass/fail count. No runner, no framework, no async. `tests.html` loads it;
`flight-lab.html?test=1` runs it alongside the game.

Target ~1200+ checks. What must be covered:

- **Flight math** both modes: envelope limits, bank/heading coupling in Assisted
  and its *absence* in Expert, sink, throttle as a lever, snapshot round-trip.
- **Input**: axis ramping, `event.code` robustness, stuck-key clearing, the pitch
  convention including toggling while a key is held, and that no pointer gesture
  produces a bank.
- **Every pure rule** with a synthetic sampler: line of sight over a ridge, the
  band-feature score using the weaker flank, zoning against a clustered field,
  spawn clearance with ground ahead versus behind.
- **Every transition table** across all states, floors, fallbacks and terminal
  conditions.
- **The launch curve** against a numeric integral of itself, both inverses, the
  clamp path, and a full 60 Hz *and* 20 Hz sequence asserting one handoff, the
  release point, and the deck-edge → gear → handoff ordering.
- **End-to-end missions** driven by a point aircraft: a direct run, a run that
  ignores combat entirely, and a run with a failure in the middle — each asserting
  COMPLETE, the phase order and the checkpoint count.
- **Counter-measures with correct geometry**: a *moving* aircraft for the flare
  stern chase (a static one never leaves its flares behind, and the mechanic looks
  broken), plus head-on and committed-round cases.

Delete checks when you delete the code they describe. A suite that only grows is
not being maintained.

The browser suspends `requestAnimationFrame` in a hidden or backgrounded frame,
so live timing observation of the game loop is unreliable. Drive the frame body
synchronously, or test the rule headlessly at a fixed step. Do not conclude "the
code did not run" from a frozen clock without checking whether the loop is
running at all.

---

## 19. Definition of done

- `flight-lab.html` opens and flies with no console errors
- `tests.html` is green
- The full sortie completes: deck → launch → egress → intercept → defensive →
  terrain → final → extraction → complete
- Ignoring all combat still completes the mission
- Crashing produces the ~2.3 s presentation and an automatic, flyable respawn —
  with no repeated-explosion loop and no need to press a key
- `T` cycles three working modes; all three fly the catapult; PEACE still kills on
  ground contact
- `G` swaps collision policies live with identical detection
- Terrain masking demonstrably defeats a SAM: the same geometry behind a ridge
  produces no launch, and the site does not appear on the radar either
- No mouse gesture produces any control input

### Deliberately out of scope

No landing, no mesh fracture, no pilot ejection, no damage subsystem, no
persistent wreckage, no wingmen, no scoring system, no music, no mouse steering.
