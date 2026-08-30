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
- Static files only; `index.html` is the entry point and runs as-is

**Deliverables:**

```
index.html           canvas, overlay layers, developer rail, all CSS
tests.html           loads src/flight.test.js and prints a pass/fail count
audio-probe.html      playability probe for audio assets — see §16
src/*.js             the modules listed in §3
src/flight.test.js   plain assertions, no test framework
```

**Method:** build in the order of §0.1. Each stage ends in a **runnable state** and
a **test gate** — something you can open and fly, plus assertions for the rules
just added. Do not proceed past a red count.

Write comments that record *why*, especially where an obvious alternative was
rejected. §17 lists the traps; when you implement code that one of those covers,
say so in a comment so the constraint survives the next edit.

---

## 0.1 Build order

Ten stages. Every one of them produces something you can open in a browser and
look at — there is never a phase where you are assembling modules that do not yet
run. That matters more than it sounds: this design has several systems whose bugs
are only visible in motion.

### Three things to get right in stage 1, because retrofitting them is painful

1. **`requestAnimationFrame` is scheduled FIRST in the frame, with the body in a
   `try`/`catch`** (§17.3). Added later, this is a rewrite of the loop; added now,
   it costs four lines. Without it, any thrown frame silently ends the session and
   you will spend a long time thinking a feature is broken when the loop is simply
   dead.
2. **`flight.js` must not import three.js**, and `flightState.quat` is a plain
   `{x,y,z,w}` record (§17.1). If three.js leaks in early it will be load-bearing
   by stage 5.
3. **Axis keys by `event.code`, and no arrow keys** (§17.5). A stuck axis is
   indistinguishable from a flight-model bug, and you will chase the wrong one.
4. **Pointer steering is positional from the screen centre, with a dead zone over
   the aircraft** (§7). It is the only self-teaching control the game has, and
   §16's "no instructions" rule depends on it existing. Never steer from a
   synthesised or drifting origin.

### Stage 1 — A shape flying over water

```
index.html        canvas, import map, resize, #loading
src/world.js      scene, ocean plane, sky, fog, lighting
src/flight.js     ASSISTED mode only
src/input.js      keyboard axes, throttle lever
src/chase-camera.js  the one rig
src/main.js       frame loop, wiring
```

Use a placeholder box for the aircraft. **Runnable:** you can fly it, turn by
banking, and the throttle holds its position.
**Gate:** envelope limits, bank→heading coupling, throttle-as-lever, snapshot
round-trip, input axis ramping, `event.code` robustness, stuck-key clearing.

### Stage 2 — The real airframe, and Expert mode

```
src/aircraft.js   load + normalise the F-15, gear node swap
src/flight.js     add EXPERT quaternion integration, M toggle
src/input.js      add the I pitch-convention toggle
```

**Runnable:** the F-15 flies in both modes; Expert can hold inverted.
**Gate:** Expert has **no** bank→heading term (assert its absence); the pitch
convention flips a held key immediately and survives a reset.

### Stage 3 — Terrain, probes, and being rewound

```
src/world.js         terrain load/normalise + terrain report
src/physics.js       grid index, five probes, 60 Hz, safe-state history, benchmark
src/collision.js     CollisionEvent + DevelopmentRecoveryResponse
src/physics-debug.js probe visualisation (P)
```

**Runnable:** you can fly into Ireland and be rewound 0.65 s.
**Gate:** the index agrees with `THREE.Raycaster` on the same rays; the benchmark
logs both costs; clearance and AGL are correct over land and sea.

### Stage 4 — The carrier and the catapult

```
src/world.js    carrier load + the four measured anchors
src/launch.js   the solved stroke, LAUNCH_VIEW blend
```

**Runnable:** every session now begins with a launch and hands you the aircraft at
172 m/s. This is the single most valuable milestone in the build — it is also what
teaches the throttle and camera, so get it feeling right before adding combat.
**Gate:** the closed-form stroke distance matches a numeric integral of its own
curve; both inverses; the clamp path; a full 60 Hz **and** 20 Hz sequence
asserting one handoff, the release point, and deck-edge → gear → handoff ordering.

### Stage 5 — Targeting, guns, one missile

```
src/weapons.js    hardpoints, mounted stores
src/enemy.js      the drone airframe
src/targeting.js  candidates, lock progression
src/missile.js    ONE implementation, AIM-9 config only
src/gun.js        hitscan + tracers + lead pipper
src/combat-hud.js the three layers, bracket, lock diamond, instruments
```

**Runnable:** you can lock a passive drone and kill it with either weapon.
**Gate:** lock progression and decay, the lead solution, the overshoot rule
(angle **and** opening range), `clearFx()` separate from `reset()`.

### Stage 6 — An enemy that fights back

```
src/hostile.js  the 8-state FSM, HOSTILE_MISSILE config
src/threat.js   TRACK/LOCK/MISSILE escalation, the authority hook
src/damage.js   PlayerDamageEvent + feedback response
```

Add the barrel roll here, as the first consumer of guidance authority.
**Runnable:** a real dogfight you can lose.
**Gate:** the whole transition table; DEFEND's fleeting-lock rule,
non-interruptible ATTACK and cooldown; the latched break direction; the fairness
assertion on turn radii.

### Stage 7 — The sortie

```
src/mission.js    phases, transition table, route survey, triggers, checkpoints,
                  autopilot
src/collision.js  add MissionCheckpointResponse (G swaps the two)
src/combat-hud.js add nav marker, phase cue
index.html        add #fade and the #complete screen
```

**Runnable:** the full nine-phase mission completes.
**Gate:** the transition table across every phase and floor, and that no phase
advances on time; the
INTERCEPT/COASTLINE non-overlap; `bandFeature` using the weaker flank; zoning
against a clustered field; three end-to-end runs (direct, combat ignored, one
failure) each asserting COMPLETE and the phase order.

### Stage 8 — Ground threats, countermeasures, modes

```
src/sam.js     sites, line of sight, the network
src/flares.js  the infrared countermeasure
src/rearm.js   automatic replenishment
src/modes.js   the MISSION/FREE/PEACE rules table + sandbox driver
src/combat-hud.js add the radar
```

**Runnable:** the terrain run is dangerous, and `T` cycles three modes.
**Gate:** line of sight over a ridge and the clearance margin; `samTransition`
including spent sites and the loss grace; placement rejecting the sea; `seduces`
with a **moving** aircraft plus head-on and committed cases; rearm starting at
empty; the modes table; a parked director never completing a mission.

### Stage 9 — Dying well, and sound

```
src/crash-fx.js  the procedural crash presentation
src/audio.js     the 11-cue director
index.html       add #crash-flash
```

The crash reuses `MissionCheckpointResponse`'s `hold` stage — do not add a state
machine (§15).
**Runnable:** crashing produces ~2.3 s of destruction and an automatic flyable
respawn.
**Gate:** the crash timeline and budgets; duplicate suppression on every frame of
the window; the ocean variant going under rather than skating; audio priority,
ducking, round-robin takes, and the availability rule from §16.

### Stage 10 — Verify against §19

Walk §19 as a checklist. Then measure three human runs and record the times — a
bot flying straight lines gives you a lower bound on the route, not a playtest,
and no amount of green tests substitutes for it.

### Stages 11–13 — after the feature freeze

The game is complete and playable at stage 10, and the freeze holds: these three
add **no new systems**. They are model substitutions and presentation, each
runnable and gated like every stage above.

```
Stage 11  real airframes for the enemies — F-16C hostile, SAM launcher (§2)
Stage 12  the living world — day/night clock, dynamic ocean, night lights (§16)
Stage 13  comfort and honesty — warning thresholds, the audio watchdog, pause
```

Do stage 13 last and do not skip it. It contains no features at all, and it is
where the build stops lying about its own state: a warning that fires when the
player cannot act, a loop that reports healthy and plays nothing, and a game with
no way to stop are all things a green test suite will never mention.

### Where the schedule risk actually is

Not in the flight model. In this order, the systems most likely to cost you a day
are, in descending order:

1. **Terrain queries** (stage 3) — the grid index is simple but the failure mode
   (silently reporting no terrain) is invisible until something depends on it.
   Log the benchmark and sanity-check ground heights at known coordinates.
2. **The crash/respawn handoff** (stage 9) — three separate owners of the aircraft
   transform (flight model, launch script, crash presentation) and one stale flag
   between them is enough to strand the player. §17.2 is the specific trap.
3. **Anything with a stored position** (stage 7) — a checkpoint captured in one
   place and restored into different terrain. §15's respawn rule exists because of
   this.

---

## 1. What to build

A third-person arcade F-15E combat game in the browser. A four-minute authored
sortie: catapult off a carrier, fly 6 km of open water, fight a hostile F-16C,
run a low-level corridor through SAM-defended terrain, turn back out to sea for
recovery. Plus two sandbox modes that reuse every system.

The world is alive but not simulated: an 8-minute day/night cycle, a GPU wave
ocean, and lights that come up on the island after dark. **No weather system** —
that is a different game, and this one is four minutes long.

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
F-16C airframe    glTF. Normalise to 14.8 m length.  The hostile fighter.
Carrier (CVN)     glTF. Normalise to 332.8 m length. Must expose deck anchors.
Terrain           glTF heightfield-style mesh. Normalise to 30 km across.
AIM-9 missile     glTF. Normalise to 2.85 m.
SAM launcher      glTF. Normalise to 6.9 m length.   Stands on the ground.
Audio             14 files in assets/audio/ — the manifest is in §16.
                  The game must run silent if absent.
```

Every asset is **normalised at load from measured bounds**, never scaled by a
hand-typed factor. Load code measures the source bounding box, computes the scale
that produces the target length, and logs the result.

The hostile is **shorter than the player's aircraft** (14.8 m against 19.4 m), and
that is worth having: a head-on pass reads as a smaller, lighter aeroplane, and it
comes free from using true figures. A useful confirmation that a source is to
scale rather than stretched: at 14.8 m length the F-16C's span should measure
~9.4 m, which is its real figure.

### Four rules for normalising a downloaded model

Each of these is a defect that shipped once.

1. **Aircraft recentre on the bounding-box centre; vehicles put the bottom of the
   box at y = 0.** An aeroplane rotates about its middle, a launcher stands on its
   tracks — and a site's root sits at the sampled ground height, so a
   centre-recentred vehicle is buried to its axles.
2. **Measure the yaw correction; do not eyeball it.** Sources arrive at whatever
   yaw the artist modelled at. Check a *node position* — the canopy and pilot must
   end up forward of the rudder and engine on the −Z axis. A tail-first aircraft
   from a chase camera reads as a strange-looking aeroplane, not as an obviously
   reversed one, so the eye is not a good enough test.
3. **A merged source may have nothing to articulate.** A launcher exported as one
   merged OBJ is a flat list of unnamed sibling meshes with no turret, radar or
   rail node. Do not guess which of thirty-five meshes rotates: slew the WHOLE
   vehicle on its Y axis, which is honest to the asset and correct for a
   trailer-mounted launcher — the rails come round to bear.
4. **A model swap must remove everything it replaces.** The procedural blockout's
   parts are not all children of one group; anything parented to the turret
   survives a swap of the group, then drops to ground level and ends up buried
   under the new model — present, invisible, and impossible to attribute. Name
   the blockout's parts so the swap can find them, and assert their absence
   afterwards.

The scale, the yaw and the recentring are **three separate nodes**, so no
correction can quietly absorb another.

The carrier must yield four local reference points, derived from its measured
bounds rather than authored: `DeckReference`, `LaunchStart`, `LaunchEnd`,
`ApproachReference`. The launch run is the measured distance between
`LaunchStart` and `LaunchEnd` — approximately 199.7 m — and §9 solves the
catapult against whatever that measurement turns out to be.

If an asset fails to load, the game must remain playable: fall back to authored
offsets and record the fallback in a failure list shown on the developer rail.

---

## 3. Modules to create

```
index.html           canvas, #loading, #fade, #crash-flash, #complete,
                     developer rail markup, all CSS
src/main.js          THE ORCHESTRATOR — wiring, frame loop, HUD text

  ── world & physics ───────────────────────────────────────────────
src/world.js         scene graph, sky, fog, asset normalisation
src/world-time.js    the day/night clock, keyframed palette, sun & moon
src/ocean.js         the GPU wave surface (one ShaderMaterial)
src/night-lights.js  settlement and carrier lights, faded by the night factor
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

**The run's outcome sets the model for the next one.** Finishing the sortie
promotes the player to EXPERT; failing it puts them back in ASSISTED. The mode
survives a restart — `resetFlightState` deliberately does not touch it — so a
run inherits what the last one earned.

It is never announced. §16 forbids a legend, so the promotion has to be *flown*
rather than read: the HUD's existing `ASSISTED` / `EXPERT` row is the only tell,
and `M` still toggles either way at any time. Nothing here locks a key.

The demotion is the load-bearing half. A cold player handed EXPERT banks, finds
the nose does not follow, and reads it as a broken aeroplane rather than a
harder one — and has no way to discover `M`. Dropping back on a failure means
the aircraft only ever gets harder for someone who has just proved they can fly
it, which matters most on a shared keyboard where the next person inherits
whatever the last run left behind.

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
LMB / F    fire (hold for gun)    X / RMB            weapon select
Z / MMB    flares                 M                  Assisted / Expert
R          restart                C                  clear stuck keys
wheel      throttle               Esc                pause / resume
```

`Esc` both pauses and resumes — one key, both directions. It is handled **before
every other binding and returns immediately**, so while paused the only key that
does anything is the one that unpauses; a stray `H` or `T` must not toggle an
overlay or restart the mission behind the pause screen. See §16.

The mouse carries four things: **move** steers, **left** fires, **right** switches
weapon, **middle** dispenses flares, **wheel** moves the throttle. All four
non-steering bindings are discrete, which is why they are buttons rather than
axes — holding any of them must do nothing extra.

Each mouse binding must `preventDefault()`: the middle button otherwise triggers
autoscroll, the right button opens the context menu, and the wheel scrolls the
page. The `contextmenu` listener does double duty — it suppresses the menu **and**
clears held keys, since a menu opening swallows the keyup of anything held.

A wheel notch is an impulse, but the flight model reads throttle as a **rate**, so
each notch charges a small decaying value rather than jumping the lever. That
keeps one throttle model regardless of input source.

Flares have two sources (`Z` and the middle button) feeding **one latch**, polled
in the frame loop rather than in a key handler, so both behave identically.

Developer keys: `H` rail · `J` HUD · `K` audio mute · `P` probes · `O` carrier
anchors · `N` nav route · `G` collision policy · `T` game mode · `1 2 3` camera
roll influence · `[` `]` jump the clock to sunrise / sunset.

### Pointer steering — the aircraft is the centre

The aircraft sits at the middle of the viewport and follows the cursor. Deflection
is distance from centre:

```
dead zone   0.10 of the half-viewport   — hovering on the aircraft holds attitude
full stick  0.52 of the half-viewport
gain        0.95
```

Provide `pointerStick(px, py, w, h)` as a pure function, and combine it with the
keyboard by taking **whichever axis is asking for more**, so a held key always
overrides a resting cursor and neither input needs to know the other exists.

Three properties are load-bearing:

1. **The centre is not synthesised.** It is the screen centre, permanently. An
   earlier version of this project tried to steer from a *claimed* origin derived
   from relative movement, and it failed six times — see below.
2. **A dead zone over the aircraft is the way to let go.** Without it there is no
   neutral, which is the defect that made the earlier attempt unfixable.
3. **The cursor stays visible.** The player can always see what they are
   commanding. A parked off-centre cursor *does* keep turning the aircraft, and
   that is correct rather than a bug — it is a stick held over, and it looks like
   one.

Steering is disabled outright while the launch script or the crash presentation
owns the aircraft, rather than having those branches remember to ignore it. The
pointer position is **not** cleared on reset: it is a physical position, not a
latch, and pretending the player moved their hand would be a lie.

**What not to build.** Do not steer from relative movement with a synthesised
centre. That design was tried and abandoned after six fixes — a claimed origin,
movement-gated edge drift, keyboard claim revocation, a settle timer,
pointer-lock deltas and a spring return — each of which fixed a real defect and
none of which closed the bug, because a synthesised centre has no detent the
player can see or feel. If steering ever needs changing, change the mapping from
position; do not reintroduce an origin that moves.

Three further requirements, each load-bearing:

1. **Track axis keys by `event.code`, never `event.key`.** `key` can differ
   between the keydown and keyup of the same physical press (modifiers, caps lock,
   layout, IME). When it differs, the keyup deletes a set entry that isn't there
   and the keydown's entry is orphaned permanently — a stuck axis at full
   deflection that no further input clears.
2. **Arrow keys must not be flight axes.** Browser and embed chrome steal them,
   so their keyup goes missing, producing a phantom "the aircraft turns on its
   own" fault.
3. **Do not steer from relative movement.** See the pointer-steering note above:
   position from a fixed visible centre is the design; a synthesised origin is
   not.

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
0.0–11.0   parked. The engine start-up plays IN FULL at double speed (a ~22 s
           recording finishing in ~11 s), fired once. NO SHAKE — see below.
9.6        afterburner lights
11.0       catapult fires on the start-up's last note. Engine loop takes over.
13.8       release point — exactly the measured deck run. 152 m/s.
14.2       rotate to 12° pitch, gear up
14.7       control handoff at 172 m/s, throttle 0.92, afterburner lit
```

**The deck is STILL, and the catapult is not.** The spool-up shimmer this
timeline used to ramp (0.02 → 0.16, ×1.5 on the burner) is gone. It ran for the
full eleven seconds of the start-up, before the player had touched anything, and
a camera that will not hold still for eleven seconds reads as a fault in the game
rather than as power in the aircraft. The stroke keeps its shake, and the
contrast is what makes it land: a still deck and then the whole frame moving at
once is a harder cut than a shake that merely gets worse.

**The deck must be HELD until audio is armed.** A browser will not start audio
before a user gesture, and the launch begins on the first frame of a fresh load —
so an unheld deck fires the engine start-up into a blocked audio context, marks it
played, and runs the whole opening silent. (The symptom is confusing: cycling game
mode appears to "fix" it, because by then a keypress has armed the director.) Give
`update(dt, hold)` a hold flag, pass `!audio.state.armed`, and let the aircraft sit
on the deck shaking until the countdown can actually be heard. The hold must apply
**only at t = 0** — it can delay a launch, never pause one in progress.

**The deck dwell is the length of the engine start-up, not an authored number.**
The sound runs to its end and the catapult fires on the last note, which makes the
wait read as a countdown rather than a delay. This couples two values in different
files — if the recording changes, re-derive `deckDwell ≈ clipDuration / rate`
together with the cue's playback rate.

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

| phase | advances on | floor |
|---|---|---|
| DECK | catapult fires | — |
| LAUNCH | control handoff | — |
| EGRESS | intercept waypoint reached | — |
| INTERCEPT | kill, or next region reached | 26 s (6 s after a kill) |
| DEFENSIVE | kill, magazine spent, or next region | 30 s (6 s after a kill) |
| TERRAIN | last of three inland legs | — |
| FINAL | seaward waypoint reached | — |
| EXTRACTION | recovery cinematic ends | — |
| COMPLETE | terminal | — |

**No phase advances on time.** There is one clock in the mission and it is the
five-minute deadline below.

Each phase used to carry its own time fallback as well. In play they were not a
safety net, they were the normal path: TERRAIN's was 66 s for an inland route
that is ~15 km — over 75 s at cruise before a single SAM is dodged — and FINAL's
was 42 s for an 8 km leg. Both expired on every run, so RIDGE and SEAWARD
advanced whether or not the player ever went there. A waypoint that arrives
without being flown to is not a waypoint.

The route is therefore strictly sequential, and two legs may share airspace
without harm: PASS is reachable before SEAWARD and SEAWARD only after PASS,
because a phase's legs are checked **in order** and only the current one counts.

One consequence to keep: **a leg the player already flew through under an earlier
phase counts immediately.** COASTLINE is authored twice at identical coordinates
so one waterline can serve two consecutive encounters — INTERCEPT consumes it,
and DEFENSIVE would otherwise inherit a waypoint kilometres behind the player and
never end. Nav already skipped it; the trigger has to agree, or the two disagree
and the phase stalls.

**That applies to a leg flown under the previous phase too, and it is narrower
than it sounds.** Reported from play: reaching PASS did nothing, and once
TERRAIN began the marker pointed backwards at it. DEFENSIVE's own leg is the
already-flown COASTLINE, so nav falls forward and sends the player to PASS —
which the trigger never records, because it only tests the current phase's leg.
Measured at 240 m/s: twelve seconds of flying back, and a player who carries on
inland never returns.

So the director records where the aircraft has actually been, and the trigger
reads that too. The scoping is what makes it safe, and two wider versions were
tried and rejected because the route revisits its own airspace on purpose:

- record **this phase's own legs** freely — `legIndex` still walks them in
  order, so nothing can be skipped, only saved from being flown twice
- record the **next phase's first leg only once this phase's legs are done** —
  its doorway, not its route

Recording everything banks RECOVERY during EGRESS (200 m from COAST) and the run
falls to 96 s. Recording the next phase unconditionally banks SEAWARD while the
player is at PASS, because those two overlap by 1517 m. A placement never
records: being put somewhere is not flying through it.

### The five-minute deadline

**The sortie is capped at 300 s of mission clock.** Past it the recovery window
has closed and the run is lost — diegetically, enemy reinforcements arrive. The
loss screen is the same furniture as the out-of-pilots one, with its own line.

It is a **policy in the orchestrator reading one pure rule** (`missionExpired`),
not a tenth phase: the transition table promotes phases and nothing else, and
"the run is over" is a decision about the run (§4). MISSION only — a deadline in a
sandbox mode would turn practice into a test (§11).

**The deadline is what guarantees no soft-lock.** The rule that matters is that
the run must always END; it does not have to end in a win. No combination of
missed shots or ignored enemies can hang a sortie, because the clock closes it
either way — and a run that never flies its route is now a LOSS rather than a
free pass, which is what a losable game requires. Assert both halves: that such a
run does not reach COMPLETE, and that the clock does run out. A phase machine
that simply hangs satisfies the first on its own.

The bar the route must clear is that flying every leg, at cruise, through both
floors and the closing cinematic, finishes with room to spare — otherwise the
deadline is not a stake, it is an impossibility. Measure it with the bot and keep
the margin visible; a straight-line bot is a lower bound on the route, not a
playtest.

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

### Navigation falls forward; triggers do not

Two separate questions, and they must not share one answer: **which volume
advances the mission** (the current phase's current leg, and nothing else) versus
**where is the player going next** (the next unreached point on the whole route).

Publishing the trigger leg as guidance produced two defects at the coastline:

1. INTERCEPT owns exactly one leg. Reaching it exhausted the phase's list, so the
   marker **vanished outright** — no diamond, no offscreen chevron — for as long as
   the phase's 26 s floor. A new player has nothing at all to fly toward.
2. DEFENSIVE then re-selected *its own copy* of COASTLINE, at the same
   coordinates, so the marker pointed **backwards** and asked the player to turn
   around.

So guidance skips any leg already reached and walks the route in flight order for
the next real destination. Track reached legs **by name and position, not by
identity** — COASTLINE is deliberately authored twice, and keying by identity
treats the second copy as somewhere new. Clear that record on restart, before
publishing nav, or a fresh sortie falls forward past the whole old route and opens
with no marker.

The trigger check is untouched by this, which is why it changes no phase timing.

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

Completion screen: time, air kills, SAM sites, AIM-9 fired, gun rounds. The
AIM-9 row is a **plain count**, not `fired/loadout`: the magazine refills
mid-sortie, so by the end the denominator is not a fact about anything. `R` or
Enter restarts. Enter only from that screen — it is a fire key in flight.

The mission clock starts at catapult release and stops at COMPLETE. State that in
exactly one place so no caller can start it elsewhere.

---

## 11. Game modes (`modes.js`)

A rules table, not three copies of the game. `T` cycles and restarts.

```
             phases  timer  nav  hostiles  sams  respawn         lives
MISSION        yes    yes   yes    yes      yes  crash-relative  5
FREE           no     no    no     yes      yes  carrier         —
PEACE          no     no    no     no       no   carrier         —
```

### Lives, and the loss ending

The sortie must be **losable**. Five pilots in MISSION; a death spends one, and
running out ends the run on a `Mission Failed` screen.

```
start              5
respawn altitude   4000 m, fixed
```

- **The count is shown top-right** — `5 LIVES REMAINING` — and shifts amber at 2,
  salmon at 1. It is not instruction; it is the squadron's state.
- **Spend the pilot at the restore, not at the impact.** The number is what the
  player has left to fly, so it drops when the replacement is dispatched.
- Announce it diegetically: `A NEW PILOT IS NOW DEPLOYED TO YOUR LOCATION`. The
  aircraft you were flying is gone, and so is whoever was in it.
- **A fixed 4000 m respawn replaces the escalating one.** Escalation existed to
  climb its way out of terrain over repeated deaths; with a finite pilot count that
  is no longer an acceptable way to converge, because each attempt costs one. The
  island peaks at 643 m, so 4000 m takes terrain out of the question. 2000 m was
  tried and the aircraft was still reported ending up in the sea — which is
  geometrically impossible for an absolute-altitude floor, so verify the invariant
  with a **post-condition check after the respawn** and log loudly when it fails.
  Raising the floor hides that bug; the check names it.
- **The loss screen mirrors the win screen** — same furniture, salmon instead of
  green — so a win and a loss read as the same kind of event. It carries the same
  summary rows and `R` / Enter restarts.
- **There are two ways to lose, and the clock is one of them.** Running out of
  pilots is the other. Nothing soft-locks — the deadline always closes the run —
  but a sortie that is never flown home is failed rather than finished.

**Lives are MISSION only.** FREE and PEACE are practice, and counting deaths in a
sandbox turns it into a test.

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

**No mission furniture at all in a sandbox mode, including on the deck.** Parking
happens on entry to EGRESS, and DECK and LAUNCH come before it — so gating the
nav marker and the phase cue on `parked` leaves FREE fly and PEACE flying the
whole take-off with a `NAV COAST` diamond, name and range, and a `DECK` cue
across the middle of the frame. It then vanishes at the handoff, which reads as
a glitch rather than as a leftover. Gate them on **`sandbox`**: `parked` means
"the director has stopped advancing", and this is the different question, "was
there ever a route".

**Every hostile slot is deactivated on a restart, not just the lead.** A hostile
AI's `reset()` restores its constructed default, which is active — so a restart
hands the whole wing back on, and switching off only `wing[0]` leaves a wingman
flying over the carrier during the catapult launch. That is a live target the
player can lock before they have the aircraft, which §5 rules out.

Sandbox driver, deliberately tiny — no waves, no difficulty curve, no hidden
score. First arrival 8 s after handoff, and a replacement 12 s after a kill.

**FREE fly flies a wing of two; MISSION flies exactly one.** §12's "one instance
serves all three encounters" is a MISSION rule and it still holds — the
encounter table deploys `wing[0]` and nothing else, with the magazine the phase
calls for. The sandbox says how full its own sky is, and two is the number: a
second aircraft turns a duel into something you have to keep track of, which is
the point, while three is a scramble where the player is mostly reacting to the
one they did not see. The difficulty this mode wants comes from the missiles.

Three things a wing needs that a single hostile did not:

- **The threat monitor is fed the WORST case across the wing**
  (`mergeHostiles`), not the first and not the nearest. One locked and one
  merely tracking is a `LOCK` — what is being done to the player does not get
  less urgent because a second aircraft is doing it.
- **Each aircraft fires its own rounds.** Subscribe to `launch` per instance; one
  subscription closing over a single drone sends every wingman's missile off the
  leader's rail.
- **The wingman's side is LATCHED when the lead deploys** (§17.9). Recomputing
  it is wrong twice over: adding the wing index to each aircraft's own encounter
  count cancels when the counters differ by one, and reading the lead's counter
  live fails because the lead's own deploy increments it. Both were measured
  putting two aircraft on the same side, 540 m apart.

**SAM sites must not respawn in MISSION.** Six is a finite thing to clear, and a
player who spent four minutes clearing the valley has earned an empty valley. A
respawning site makes that work meaningless.

**FREE fly seeds its own, because it never ends.** That reward only means
something because the mission finishes; an endless mode with six finite sites is
an empty sky a few minutes in — the same failure `hostileRespawn` already exists
to prevent for the fighter. So FREE fly starts with an empty sky and seeds
batches down the track the player is actually flying:

- at most **three sites per batch**, seeded ~5.2 km ahead of the player's
  current heading, scattered across and along that track rather than on world
  axes, so a batch never reads as a grid
- **a batch is retired only once the player is 7 km from all of it** — past the
  SAM's own 5 km detection and the radar's 6 km ring, so a batch is never
  swapped while it could still be fighting or still be on the display. Sites you
  destroyed stay destroyed while you can still see where they were; sites you
  ignored are not deleted out from under you either
- a site with nowhere to stand is **dropped, not floated** (§13), so a batch is
  "up to three", and over open water it is none
- a seed that places nothing waits before retrying. Without that the empty batch
  reads as spent and the cycle re-seeds every frame: measured, 49 attempts and
  zero sites in the time it took to fly off the carrier

The prediction is deliberately the crudest possible — position, heading, fixed
distance. A turning player invalidates it immediately, which is correct: the
batch is seeded once and stays put, and a prediction that tracked every input
would chase the nose around and drop sites behind the aircraft.

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

**INTERCEPT overrides that placement, and it is the only encounter that does**
(~1700 m ahead, ~300 m to the side, ~70 m above). Reported twice as "the
INTERCEPT phase has no hostile fighter" while the deploy was working perfectly:
measured in the running game, the aircraft was present for the whole phase and
merged to 59 m. It could not be *found*. 900 m off a 2400 m nose is 21° — the
edge of the windscreen — where a 14.8 m airframe is about ten pixels of dark
aeroplane against a dark coastline.

The other two encounters are found by being shot at: TRACK, then LOCK, then a
missile call. This one carries no rounds on purpose, so it makes no sound and
raises no warning, and a radar diamond is the only other tell. The silence is
the design, so the fix has to be geometric — same aircraft, same zero rounds,
passing through the middle of the frame rather than the corner of it. Express it
as a per-encounter override of the shared offsets (`deployOffsetFor`), so an
encounter that names none of them inherits all three.

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

**Enforce that on the way OUT as well as the way in.** Guarding only the
`SEARCH → TRACK` promotion leaves `LAUNCH` with no exit except firing — and the
firing branch is itself gated on having a round, so a site that reaches LAUNCH
empty never sets its `launched` flag, and the table returns LAUNCH again on every
frame, permanently. The symptom is hard to attribute because the site looks
blameless: it holds the player in LOCK, the threat monitor keeps reporting a lock,
the warning keeps sounding, the HUD keeps the diamond up, and no missile ever
arrives because there is none to arrive. It reads as "the SAM locks me and warns
me but never shoots", and it shows up halfway through a sortie, which is when a
site is most likely to be spent.

So `LAUNCH` returns `RELOAD` on an empty magazine, and `LOCK` falls back to
`SEARCH` on one. Assert that **every** magazine state leaves LAUNCH within one
step: no state in any of these three tables may loop on itself.

**Destroyable with no special cases.** A site publishes the same
`{position, velocity, alive, health, radius, label}` contract the drone does, so
targeting, gun, missile and the HUD bracket all work unchanged. The gun works on
ground targets for free, because a lead solution needs only a position and a
velocity and a SAM's is zero. A kill leaves a **wreck in the world** — tinted,
tilted, turret hidden — not a deletion.

Only sites within detection range and envelope pay for a line-of-sight test; six
sites × 14 samples every frame would be 84 terrain queries.

**Placement:** a battery of three in the DEFEND area, then two per inland leg
from the second one onward, flanking the corridor by ~1450 m so the safe line is
*between* them and low.

**The DEFEND area has its own battery, and the first inland leg has none.**
DEFENSIVE was a phase called DEFEND with nothing to defend against — the nearest
ground threat sat 2.9 km beyond the area's edge — while the first inland leg
carried a pair standing exactly where DEFENSIVE hands over to TERRAIN, a threat
belonging to neither phase. The pair moved forward into the area that needed it,
and ground threats are live from DEFENSIVE rather than only in TERRAIN: a site
that cannot shoot during the phase it was placed for is furniture.

Two details the terrain forces, both measured on the shipped mesh:

- the battery is laid **along the course inland** of the area's centre, not
  around it. The centre sits ~300 m past the waterline, where the ground is at
  sea level and every probe fails `minGround`.
- each site tries its **preferred flank and then the other**. The inland legs
  can afford a fixed side because they sit on the island proper; this one sits
  past a waterline that is not a straight edge, and with a fixed side only one
  of three found ground. With the fallback all three stand — though on this
  island they end up on the same flank, because that is where the land is. Each site **probes outward** along its side
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

### No instructions, anywhere

The game must teach itself: **no instruction text on screen or off.** There is no
control legend, no tutorial, no key list in the repository's player-facing docs.

What teaches instead:

- **The catapult launch runs itself** and demonstrates the throttle climbing and
  the burner lighting before the player has touched anything.
- **The aircraft is at screen centre and follows the cursor**, which is
  discoverable in about a second. This is the main reason pointer steering was
  reintroduced — WASD alone is not self-teaching.
- **The nav diamond** says where to go without words.
- **Consequence teaches the rest.** Fly into a hill and you lose a pilot.

The HUD is **not** instruction — it is instrumentation, and reading an instrument
is part of flying. Threat words (`LOCK`, `MISSILE`, `PULL UP`) are information
about the world, not directions to the player.

Accept the consequence: a first-time player will probably never discover flares,
the weapon switch or the pitch-convention toggle. That is the cost of the rule,
and the rule is the requirement. Do not add a legend behind a toggle — that only
puts the violation one keypress away.

Every key still works; it is simply undocumented in-game.

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
Hide it inside 260 m — you have arrived and the next leg is about to become
current, so it is furniture rather than guidance.

### An AREA, when there is nowhere to fly

A combat phase holds the player with a floor while its own waypoint is already
behind them: DEFENSIVE inherits a COASTLINE flown under INTERCEPT. The marker
used to fall forward to the NEXT phase's waypoint simply to have something to
show, and that is a **lie** — arriving there advances nothing, because the
trigger only tests the current phase's leg. Reported from play as "I enter
200 m, and pass the NAV, it does not update... it will wait after a while".

So those phases publish an **area** instead of a point, and the two are mutually
exclusive — the player sees one or the other, never both:

- **inside it**, there is no marker at all, and the radar ring lights yellow and
  breathes slowly. No arrow IS the message: you are where you should be. The
  phase name sits in the mission-cue row, which the transient cue yields to
  rather than drawing the same word twice in two sizes.
- **outside it**, the ordinary marker returns, pointing back at the area — the
  same diamond and chevron code, fed the area's centre, so there is no second
  renderer to keep in step.

Radius is generous (3400 m): this is "the fight is around here", not a gate to
thread. The area is published from `state`, and **nothing in the transition
table reads it** — it is a display change, not a mission-logic change, which is
what keeps it out of the way of the floors and the route.

Four fixes that treated this as a routing problem were built and reverted first,
each caught by a check protecting an earlier reported defect: recording every leg
flown banks RECOVERY during EGRESS (200 m from COAST) and the run falls to 96 s;
recording the next phase's legs banks SEAWARD while the player is at PASS (they
overlap by 1517 m); capping how far the marker looks ahead blanks it on the deck;
and cutting a combat floor when the player leaves collapses DEFENSIVE to 0.1 s so
the phase that shoots back never happens. The display was the right place all
along.

**A threat never suppresses it.** The marker used to vanish while a missile was
inbound, on the reasoning that the player then needs one piece of information and
it is not the waypoint. That is wrong in play: the guidance disappears at the
exact moment the player is manoeuvring hardest, so defeating a round costs them
the course as well — a second penalty for being shot at. Nothing about the missile
cue needs the space either; it lives in the upper-centre stack, nowhere near the
projected diamond. Priority stays expressed in **paint order** — nav is drawn
first in the world layer, so a hostile bracket and a lock diamond cover it
without either of them having to switch it off.

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
ENGINE_START   deck spool          AMBIENT    one-shot, stoppable, rate ×2, noDuck
ENGINE_LOOP    throttle > 2%       AMBIENT    loop, gain + pitch from the lever, noDuck
GUN            trigger held        WEAPON     loop
LOCK           threat = LOCK       WARNING    3 takes, 3.2 s floor, ducks to 0.45
MISSILE        threat = MISSILE    CRITICAL   2 takes, 2.4 s floor, ducks to 0.30
MISSILE_LAUNCH player fires        WEAPON     0.4 s floor
MISSILE_HIT    any kill / taking one WEAPON   0.3 s floor
FLYBY          hostile inside 340 m AMBIENT   4 s floor
FLARES         on dispense         ADVISORY   forced past its own floor
ALTITUDE       low AND descending  WARNING    3.5 s floor
PULL_UP        < 9 s to impact     CRITICAL   1.8 s floor
```

### File manifest

**11 cues, 14 files** — `LOCK` and `MISSILE` have alternate takes. Every path is
relative to the page; the paths *are* the whole interface, so dropping a correctly
named file into `assets/audio/` makes that cue work with no code change.

| cue | file(s) | volume | content |
|---|---|---|---|
| `ENGINE_START` | `assets/audio/engine-start.mp3` | 0.55 | jet engine spinning up |
| `ENGINE_LOOP` | `assets/audio/engine-loop.mp3` | 0.56 | seamless running-engine loop |
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
- **The engine is exempt from ducking** (`noDuck`). It is the aircraft's own voice
  and the bed the whole mix sits on, so attenuating it for a spoken advisory is
  backwards — and with a cue that can repeat every few seconds it is not a duck at
  all, it is a permanent attenuation that makes the aeroplane sound switched off.
  The gun still ducks: a cannon burst genuinely does mask speech.
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

Ground proximity is two levels, both from **AGL, not altitude above sea level**.
Neither is a bare height threshold, and both took several passes to get right:

- **`PULL UP` is a TIME, not a height** — fewer than 9 s to impact on the current
  trajectory, from sink rate and from the ground sampled 6 s ahead. A height
  threshold cannot work at both 110 and 250 m/s, and it fires far too late over
  rising ground: by the time a low number is reached the aircraft is committed.
  Nine seconds is ~2.2 km of warning. It also works over water, where there is no
  terrain ahead to probe.
- **`ALTITUDE` is low AND descending** — below 250 m AGL with a sink rate over
  1.5 m/s. Low and level is legitimate flying: the terrain leg is flown that way
  on purpose. A height-only rule fires every `minInterval` for the whole sortie,
  which is a cue the player learns to ignore, and — because every firing ducked
  the ambient channels — it also held the engine down permanently and made the
  aircraft sound switched off.
- **Neither may fire in the first 5 s of player control.** The aircraft leaves the
  deck ~20 m over the water and sinks briefly off the bow before the wing takes
  over, which is a guaranteed trajectory warning at the one moment the player has
  nothing to do with it — and the launch is the loudest scripted beat in the build
  and must not be talked over. The grace timer resets whenever control is taken
  away, so it covers every respawn and the recovery autopilot too.

- **A hard floor of 90 m applies over WATER ONLY** — below it the sea is a
  `PULL UP` regardless of trajectory. The time-to-impact rule needs a descent to
  have something to divide by, so level flight 20 m over the waterline was silent:
  correct arithmetic, useless advice. Over land that is acceptable, because the
  corridor is flown deliberately low and the ground *ahead* supplies the warning;
  over open sea there is nothing ahead to sample and no visual scale, so height is
  the only cue there is. Do **not** extend this floor to terrain — it would fire
  continuously for the whole TERRAIN leg, which is the nagging-cue failure that
  `ALTITUDE` was given a descent test to fix.

So 200 m over the ocean in level flight is quiet, 60 m over the ocean is not, and
200 m descending into a 600 m ridge is not.

The engine loop must **not** run during the deck phase — the start-up plays alone
while the aircraft shakes in place, at double playback rate so the whole recording
finishes exactly as the catapult fires. The loop takes over from there, which is
also the first moment there is something for a loop to sustain.

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

### One owner per media element

**A looping cue must be commanded from exactly one expression.** The engine loop
once had four owners — the crash branch, the deck branch and the mission-complete
branch each switched it off for a good reason, and the drive line, running later in
the *same frame*, switched it back on because its condition only knew about the
deck. Every frame the element was paused and restarted, `currentTime` reset to
zero, and the loop never got past a single frame of audio. What the player heard
was the restart: a click or a burst, not an engine.

Every condition that silences a loop belongs in that one expression. This is the
same rule as §17's single-owner rules for the aircraft transform and the mission
clock, and it fails the same way — silently, with everything reporting healthy.

### The loop watchdog

**A media element cannot tell you it is producing no sound.** "No engine" was
reported repeatedly while every observable said the audio was fine: `paused` false,
`readyState` 4, a correct `duration`, a fully populated `buffered` range, no
`error`, a resolved `play()` promise and a sane `volume`. `decodeAudioData` decodes
the same bytes perfectly.

The one honest signal is whether `currentTime` moves. So the director watches it,
and distinguishes **two faults that look identical from outside**:

```
never moved     a START failure. The browser is refusing playback until the
                document has had a real user gesture. Nothing is misconfigured;
                keep asking, and say so on the rail ("CLICK PAGE").
moved, stopped  a genuine STALL. Reset playbackRate to 1 and LOCK it (some
                engines mute a looping element at a shifted rate), re-issue
                play(), and count it.
```

Conflating the two is a real defect and not a hypothetical one: a watchdog that
blames the playback rate for an autoplay block permanently strips the engine's
throttle-pitch effect for a fault that has nothing to do with it. Gate the repair
on whether the clock has *ever* moved.

Rate-limit the retry (~4/s). A refused `play()` re-issued every frame is sixty
promises a second for the browser to reject, and it makes a genuine autoplay block
look like a stall. Cap the console output per channel: a stall that cannot be
repaired would otherwise print twice a second forever and bury everything else.

Publish both counts. The developer rail must name which of four states the engine
is in — `CLICK PAGE`, `MUTE`, `OFF`, or a climbing clock — because "no engine
sound" has had a different cause every time it has been reported, and one
ambiguous number cannot tell them apart. If the rail shows a climbing clock and
nothing is audible, the fault is downstream of the game entirely.

Ship `audio-probe.html`: a standalone page that plays each file and reports whether
its clock advanced. Run every new audio asset through it before wiring it into the
cue table. **Mind the order it probes in** — the autoplay policy makes the first few
clips a page touches look broken regardless of which clips they are, and that
artefact is easy to mistake for a property of the files. It cost a wrong diagnosis
once (three clips re-encoded to WAV to fix a fault that was never in them);
reversing the probe order is what exposed it.

### Day and night (`world-time.js`, `night-lights.js`)

A clock, not a weather system. One normalised phase `tau` in 0..1 owns everything;
nothing else may write it, and every consumer reads one interpolated palette so
the sky, the fog, the water, the sun, the moon and the lights cannot disagree.

```
cycle            8 real minutes = 24 visual hours
start            tau 0.18 (mid-morning)
sunrise/sunset   tau 0.045 / 0.55
sun peak         2.3        moon 0.55 (brighter than reality, on purpose)
```

- **Interpolate keyframes; never select one.** A palette that snaps between
  discrete states is the most artificial thing a cycle can do. The same goes for
  the lights: fade them by the night factor rather than switching them on.
- **The daytime plateau must not be flat.** `dayFactor` saturates well before
  midday, so with a bare `day²` term the sun holds one constant value across two
  thirds of the cycle — two minutes of flying then shows *nothing changing* and
  the cycle looks broken when it is working exactly as specified. Add a gentle
  elevation ramp (midday 100%, mid-morning ~87%) and pull the morning and
  afternoon keyframes apart in colour: morning paler and cooler, afternoon warmer.
  **Colour shift is what the eye notices while the sun is at full strength.**
- **A player must reach a visibly different sky within about two minutes**, and
  sunset within about three. That requirement is what sets the cycle length; it
  was 12 minutes and nothing read as moving.
- **Name the phase on the developer rail** (`MIDDAY 0.216`). Otherwise "is the
  clock even running?" is unanswerable except by staring at the sky.
- Settlement lights are **deterministic** from a fixed seed — the same island
  every run — and placed only where the terrain is habitable (low, flat, inland).

No weather, no clouds driven by the clock, no time-of-day control in the game.
`[` and `]` jump to sunrise and sunset for inspection; they are developer keys.

### Ocean (`ocean.js`)

One mesh, one `ShaderMaterial`, three sine components on the GPU. No FFT, no fluid
solve, no reflection camera, no second render pass — this is the cheapest thing
that reads correctly at 200 m/s, per §1.

```
patch          90 km, follows the player in X/Z only
grid           96×96, RADIALLY WARPED (power 2): ~20 m cells at the centre,
               ~1.9 km at the rim — 9409 vertices either way
waves          3 components, amplitudes 0.70 / 0.38 / 0.17 m
wave fade      flat beyond 7 km of the camera
Fresnel        base 0.012, power 6.5, CAPPED at 0.55
```

Five rules, each one a defect that shipped:

1. **The patch must be several times the fog's visibility, not just "far".** A
   14 km patch was chosen on the assumption fog would hide its edge; at 3.9 km
   altitude the fog factor 7 km out is 0.058, so the sea ended in a hard dark
   quadrilateral with sky beyond it. At 90 km the rim sits at 0.92. Visibility is
   roughly `1/fogDensity` — compute it rather than guessing.
2. **Warp the grid rather than subdividing it.** 96² over 90 km is a 937 m cell,
   coarser than the 74 m chop, which aliases into triangular garbage. Warping
   radially puts the resolution where the waves are legible and spends nothing on
   water 40 km away.
3. **Fade wave amplitude with distance.** Rim cells are kilometres across;
   displacing them as hard as the fine centre cells turns the horizon into slow
   enormous ripples.
4. **Cap the Fresnel blend.** Uncapped, the far half of the sea becomes flat sky
   colour and the whole surface reads as milky soup. Water *tinted* by the sky
   still reads as water; water *replaced* by it does not.
5. **A raw `ShaderMaterial` does not get the renderer's output colour conversion**
   that built-in materials receive. Include three's `<colorspace_fragment>` chunk
   or linear values reach an sRGB framebuffer unconverted and a mid navy renders
   near-black.

The wave phase is computed from **world** position, so the pattern is stable in
the world as the patch follows the player; snap the mesh to a coarse step so the
tessellation does not crawl. Patch height stays at y = 0, which is also the
collision plane, so the visual and physical sea never disagree.

**The water is held more saturated than the sky and the horizon at every daylight
hour.** Over open sea at low altitude the only cue for height is the colour
boundary between air and surface, and a grey-blue sea against a pale sky has
almost none — there is no waterline to find. At night the boundary is carried by
luminance instead: the haze band stays brighter than the water.

### Pause

`Esc`. The smallest possible interface: a title, a rule, and one line saying how
to get back in. **No quit** — the tab is the quit. No options, no settings, no
volume slider; every one of those is a menu, and this game does not have menus.
Same furniture as the win and loss screens so it reads as part of the family.

- **Pause is a property of the frame LOOP, not of the mission, the mode or the
  flight model.** One early return; none of those systems learns about it. That is
  why pausing cannot corrupt a launch, a crash sequence or a checkpoint the way a
  per-system pause flag could.
- **Place the return after the frame's timestamp is updated**, so the frame the
  player resumes on has a normal `dt` rather than the whole paused duration. The
  `dt` clamp would swallow it anyway; relying on a clamp to hide a bug is not a
  design.
- **Keep rendering.** The paused world sits there and looks like the world, not
  like a black screen.
- **Silence the audio and restore what the player had.** A continuous engine
  running behind a pause screen is the most obvious way to make a pause feel
  broken. Remember the player's own mute (`K`) so pausing never turns their audio
  back on.
- Disable pointer steering while paused: a paused game must not be flown by a
  moving cursor.

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
6. **Pointer steering is positional from a fixed, visible centre** — the aircraft
   at screen centre, with a dead zone over it. Never a synthesised or drifting
   origin.
7. **One missile implementation.** New rounds are configs, not files.
8. **Enemies publish the target contract** — then targeting, gun, HUD and missile
   work with no special cases.
9. **A latched direction stays latched.** Break directions, tumble axes and dodge
   signs are chosen once at entry; recomputing per frame oscillates to zero.
10. **The run must always end.** No soft-locks — but ending is not the same as
    winning, and no phase may advance on a clock of its own. One deadline closes
    the sortie; everything else is reached by flying to it.
11. **Presentation resets, gameplay does not** — and the reverse: a phase
    transition clears tracers, not ammunition.
12. **A respawn must be flyable.** Levelled, at cruise, above the ground *ahead*.
13. **A test double must match the real thing.** One that diverges tests nothing.
14. **Assert the mechanism, not the symptom.** "The round was defeated" passes
    while a counter-measure is completely broken.
15. **One owner per media element.** Every condition that silences a loop lives in
    one expression. Four owners across four frame-loop branches pause and restart
    the element every frame; it reports perfectly healthy and plays nothing.
16. **Distinguish a start failure from a stall.** "Never played" is the autoplay
    policy waiting for a user gesture and needs no repair; "played, then froze"
    does. Gate any repair on whether the clock has *ever* moved, or a watchdog will
    strip a working feature to fix a fault that is not there.
17. **A vehicle stands on the ground; an aircraft rotates about its middle.** Two
    different normalisations. Using the aircraft rule on a launcher buries it.
18. **A model swap removes everything it replaces.** Anything parented to a node
    the swap keeps survives, drops, and ends up buried and invisible.
19. **Measure a model's forward axis from a node position.** Tail-first reads as
    an odd-looking aeroplane, not as an obvious reversal, so the eye is not a test.
20. **A patch that follows the player must exceed the fog's visibility several
    times over.** "Far away" is not a number; `1/fogDensity` is.
21. **A raw `ShaderMaterial` needs the output colour-space conversion** that
    built-in materials get for free. Without it everything renders too dark.
22. **A saturating factor makes a flat plateau.** Anything driven by one needs a
    second, non-saturating term, or two thirds of a cycle shows no change and the
    system looks dead while working exactly as specified.
23. **A threshold that must hold at two speeds should be a TIME, not a distance.**
    `PULL UP` at 110 and at 250 m/s is the case that proves it.
24. **A warning that fires while the player has no control teaches nothing.** Give
    every advisory a grace window after control is handed over, and reset it
    whenever control is taken away.
25. **Guard a resource rule at every edge of the state machine, not just the
    entry.** "A spent site never acquires" enforced only at `SEARCH` left `LAUNCH`
    with no exit but firing, and firing needed the resource it no longer had — a
    permanent lock with no missile. Assert that every state leaves itself within
    one step, for every value of the resource.

---

## 18. Testing

`src/flight.test.js` is plain assertions with a `check(name, pass, detail)` helper
and a pass/fail count. No runner, no framework, no async. `tests.html` loads it;
`index.html?test=1` runs it alongside the game.

Target ~1400+ checks. What must be covered:

- **Flight math** both modes: envelope limits, bank/heading coupling in Assisted
  and its *absence* in Expert, sink, throttle as a lever, snapshot round-trip.
- **Input**: axis ramping, `event.code` robustness, stuck-key clearing, the pitch
  convention including toggling while a key is held, and that no pointer gesture
  produces a bank.
- **Every pure rule** with a synthetic sampler: line of sight over a ridge, the
  band-feature score using the weaker flank, zoning against a clustered field,
  spawn clearance with ground ahead versus behind.
- **Every transition table** across all states, floors and terminal conditions,
  including that no mission phase advances on time alone.
- **The launch curve** against a numeric integral of itself, both inverses, the
  clamp path, and a full 60 Hz *and* 20 Hz sequence asserting one handoff, the
  release point, and the deck-edge → gear → handoff ordering.
- **End-to-end missions** driven by a point aircraft: a direct run, a run that
  ignores combat entirely, and a run with a failure in the middle — each asserting
  COMPLETE, the phase order and the checkpoint count.
- **Counter-measures with correct geometry**: a *moving* aircraft for the flare
  stern chase (a static one never leaves its flares behind, and the mechanic looks
  broken), plus head-on and committed-round cases.
- **Asset normalisation without a loader**: synthetic sources with an arbitrary
  origin, asserting the aircraft rule (pivot on the bounding-box centre) and the
  vehicle rule (bottom of the box at y = 0) separately, plus that a model swap
  removes the blockout's parts and that the turret slew still works through it.
- **The day/night cycle as arithmetic**: midday measurably brighter than
  mid-morning *and* mid-afternoon, the daytime palette actually changing, and two
  minutes of flight from the start moving the sky — the assertions that pin the
  flat-plateau regression.
- **The loop watchdog with a stub that reports perfect health and never
  advances**: a frozen clock detected, the rate reset and locked, a healthy
  advancing loop never touched, a loop *wrap* not mistaken for a stall, a muted
  channel not reported as stalled, and — separately — a never-started channel
  counted as pending with its pitch effect left alone.

Delete checks when you delete the code they describe. A suite that only grows is
not being maintained.

The browser suspends `requestAnimationFrame` in a hidden or backgrounded frame,
so live timing observation of the game loop is unreliable. Drive the frame body
synchronously, or test the rule headlessly at a fixed step. Do not conclude "the
code did not run" from a frozen clock without checking whether the loop is
running at all.

---

## 19. Definition of done

- `index.html` opens and flies with no console errors
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
- No mouse gesture produces any *unintended* control input: hovering on the
  aircraft holds attitude, leaving the window releases the stick, and a held key
  overrides a deflected cursor
- `Esc` pauses and resumes; the world is frozen, the audio silent, the scene still
  drawn, and no other key acts while paused
- The sky is visibly different two minutes after launch and reaches sunset within
  about three
- The ocean has no visible edge at any altitude the aircraft can reach, and the
  waterline is findable from the air
- The hostile is an F-16C at 14.8 m and every SAM site is a launcher standing on
  the ground — no floating, no burial, nose forward
- The developer rail names the engine's audio state, so "no sound" is diagnosable
  without a debugger

### Deliberately out of scope

No landing, no mesh fracture, no pilot ejection, no damage subsystem, no
persistent wreckage, no wingmen, no scoring system, no music, no weather system,
no options or settings menu, no reflection camera, no second render pass.

**Pointer steering is IN** — see §7. An earlier revision of this document listed
it here; it was reintroduced because §16's no-instructions rule depends on having
one self-teaching control, and WASD alone is not one. What remains out of scope is
steering from *relative* movement with a synthesised origin, which was tried, cost
six fixes and never worked.
