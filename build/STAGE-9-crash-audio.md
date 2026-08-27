# Stage 9 — Dying well, and sound

**Goal:** crashing produces ~2.3 s of destruction and an automatic flyable
respawn.

Prerequisite: stage 8 green.

This is the third of the three stages that can cost you a day. The reason is
specific: **three separate owners of the aircraft transform** — the flight model,
the launch script, and now the crash presentation — and one stale flag between
them is enough to strand the player.

---

## Files

```
src/crash-fx.js   NEW — the procedural crash presentation
src/audio.js      NEW — the 11-cue director
flight-lab.html   add #crash-flash
src/collision.js  lengthen MISSION_FAILURE.hold to 1.2
```

---

## Do not build a crash state machine

`MissionCheckpointResponse` from stage 7 **already has the right shape**:

```
trigger → hold → fade → restore at black → fade in
```

Make its `hold` stage the crash window (0.28 → **1.2 s**) and render the
presentation against its clock. Duplicate suppression then comes free — `trigger()`
already refuses re-entry, which is exactly what stops a tumbling aircraft grinding
through a mountain producing BOOM BOOM BOOM.

`CRASHING` is **not a new enum value.** It is a third owner of the aircraft
transform, alongside the launch script.

---

## Timeline

```
0.00   impact. Controls disabled. Presentation starts.
0.03   flash + camera kick        0.15   smoke begins
0.08   fireball                   0.25   sparks
0.10   tumble ramps in            0.72   aircraft fades behind its own smoke
1.20   fade to black begins       (policy: hold ends)
1.70   RESPAWN at full black      (policy: fadeOut ends)
2.32   playable                   (policy: fadeIn ends)
```

---

## The cheat

**The aircraft does not break.** It keeps its pre-impact momentum, tumbles on one
latched angular velocity, and sinks under gravity while a fireball, sparks, a
world-space smoke trail and four primitive fragments grow around it. At 200 m/s
that reads as destruction. Do not implement mesh fracture, wing detachment or
per-triangle debris.

**Keep the intact aircraft visible for ~0.72 s**, then fade it. Hiding it on the
frame it dies is what makes a death read as a bug.

```
flash      1 additive sprite, 0.13 s, expands ×3.4 — no persistent glow
fireball   5–7 sprites, offsets/sizes/rates randomised ONCE at start
sparks     22 sprites, biased along the impact normal, 42% velocity inherited
smoke      15/s for ~0.95 s, WORLD-space so the aircraft leaves a trail
debris     4 meshes from 4 pre-built geometries, 72% velocity inherited
```

**Randomise variation once at crash start, then evolve smoothly.** Re-randomising
per frame produces a flicker, not an explosion. Pool everything; share three
textures and two materials. Peak ~55 live entities.

**Latch the tumble at entry** — one angular velocity, ramped in over 0.22 s and
then constant, applied as a *local* quaternion delta so it works from any starting
attitude including inverted. (Same trap as the hostile's break direction in
stage 6.)

---

## Variants — data, not code paths

```
              fire  smoke  sparks  mist  forward  sink  visible
MISSILE       1.0   1.0    1.0     0     1.00     0.55  1.00
TERRAIN       0.85  1.25   1.35    0.5   0.35     1.00  0.75
OCEAN         0.28  0.7    0.55    1.4   0.18     2.60  0.34
```

**Water needs real work, not a palette swap.** Give it a downward plunge impulse
(~34 m/s), 2.6× gravity, and a visible window cut to a third, so the aircraft is
hidden *before* it is under the surface. Its plume goes up rather than outward, with
normal rather than additive blending, so it reads as spray. Without the plunge the
aircraft drifts two metres in three quarters of a second and visibly skates along
the surface.

Map the cause from the failure reason string the policy already carries, in **one
place**, so a new failure reason cannot silently inherit the wrong explosion.

---

## Camera

One strong kick at 0.03 s decaying at `e^(−5.5t)`, **never re-triggered** — sustained
shake is nauseating. It goes into the **single shake channel** from stage 1.

Then blend in a looser composition for ~1.05 s so the rig trails the tumbling
aircraft and the fire, smoke and debris are watchable:

```
CRASH_VIEW   standoff 34   height 9   framingY −0.12   lagScale 0.34
```

Blend it back out. Add a screen flash layer **above** the fade, under 0.15 s, low
alpha — separate elements so neither can strand the other on.

---

## While crashing

Disable weapon fire, throttle, flares, barrel roll and weapon switch. **Consume and
drop the discrete latches** so a trigger pull mid-explosion does not fire on the
respawn frame.

Two things that will bite:

1. **`physics.update()` is skipped during a crash** — a destroyed aircraft runs no
   collision queries. So the failure policy must be ticked explicitly, or it sits
   in `hold` forever, the fade never starts, and the respawn never comes.
2. **Re-read `crashFx.state.active` *after* ticking the policy.** The tick is what
   fires the restore, which ends the crash and repositions the aircraft. A flag
   captured before the tick is stale, and the crash branch then copies the wreck's
   transform straight back over the fresh respawn — putting the player back inside
   the terrain they were just lifted out of.

---

## Respawn

Computed from **where the player died**, not from a stored checkpoint:

```
back off 1800 m along the heading of travel from the point of impact
level, at cruise, sink zeroed
altitude = highest ground in the 4 km ahead + 460 m clearance
```

**Sample a corridor along the heading, not a point below.** A levelled attitude
320 m over a valley floor with a 600 m ridge 1.5 km ahead puts the player back into
contact within two seconds and the crash repeats forever.

**Escalate deliberately** on repeated failure — unless the game has a finite pilot
count, in which case do not: see the lives rule in `../CLAUDE.md` §11. With five
aircraft, converging on a safe spawn over several deaths costs the player the run,
so the first attempt must simply be high enough that terrain cannot be a factor —
**4000 m against a 643 m peak**. Escalation is the right answer only when respawns
are free.

**Verify the respawn as a post-condition.** The altitude is a floor on absolute
altitude, so ending up in the sea should be impossible; it was reported anyway at a
lower floor, which means another writer can touch the transform afterwards. Check
clearance immediately after repositioning and log loudly when it fails — raising
the floor hides that bug, the check names it.

**An airborne death must not go through a checkpoint rewind.** A rewind restores a
checkpoint's position *and phase*, and if the phase checkpoint was never captured
it falls back to the deck one — flipping the phase to DECK and handing the aircraft
to the launch script. Restore progression (stores, stats) without touching position
or phase.

---

## Audio (`audio.js`)

Eleven cues, **no music.** The atmosphere is an engine, a cannon and a voice telling
the player what has locked them; a score would sit on top of all three and make the
warnings less audible.

```
ENGINE_START   deck spool          AMBIENT    one-shot, stoppable, rate ×2
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

**11 cues, 14 files** — `LOCK` and `MISSILE` carry alternate takes. The paths *are*
the whole interface: dropping a correctly named file into `assets/audio/` makes
that cue work with no code change.

| cue | file(s) | volume | content |
|---|---|---|---|
| `ENGINE_START` | `assets/audio/engine-start.mp3` | 0.55 | jet engine spinning up |
| `ENGINE_LOOP` | `assets/audio/engine-loop.mp3` | 0.34 | seamless running-engine loop |
| `GUN` | `assets/audio/gun.mp3` | 0.50 | seamless cannon-fire loop |
| `LOCK` | `lock-1.mp3` / `lock-2.mp3` / `lock-3.mp3` | 0.85 | voice: "lock on" ×3 |
| `MISSILE` | `missile-1.mp3` / `missile-2.mp3` | 1.00 | voice: "missile warning" ×2 |
| `MISSILE_LAUNCH` | `assets/audio/missile-launch.mp3` | 0.80 | own AIM-9 leaving the rail |
| `MISSILE_HIT` | `assets/audio/missile-hit.mp3` | 0.90 | warhead detonation |
| `FLYBY` | `assets/audio/flyby.mp3` | 0.75 | fighter crossing close aboard |
| `FLARES` | `assets/audio/flares.mp3` | 0.80 | dispenser thump |
| `ALTITUDE` | `assets/audio/altitude.mp3` | 0.85 | voice: "altitude" |
| `PULL_UP` | `assets/audio/pull-up.mp3` | 1.00 | voice: "pull up" |

`ENGINE_LOOP` and `GUN` must loop **seamlessly** — they are the only sustained
cues, and a click at the loop point is audible under everything else.

The two multi-take cues are the only ones that fire often enough for a single
recording to grate.

Because almost every sound is information, the mix is a **priority problem**:
- **`AMBIENT < WEAPON < WARNING < CRITICAL`.** A warning ducks AMBIENT and WEAPON
  for 1.1 s. A warning never ducks another warning.
- **Every one-shot has a minimum interval.** A cue that repeats is a cue nobody
  hears.
- **Multi-take cues rotate round-robin**, so with three takes it is provably never
  twice in a row — which random selection cannot promise.
- **The gun is a loop**, not 48 one-shots a second.
- **The player's own launch is WEAPON, not WARNING** — it confirms something they
  did and must never mask an inbound call.
- **Warnings are driven from the threat monitor's own escalation**, not a second set
  of conditions, so the sound and the HUD cannot disagree.
- **Nothing plays before a user gesture.** The mission opens on a five-second
  scripted launch with no input in it, so arm on the first keypress or click and
  never surface a blocked start as an error.

Ground proximity is two levels, both **AGL not altitude above sea level**, so 200 m
over the ocean is quiet and 200 m into a 600 m ridge is not.

**The engine loop must not run during the deck phase.** The start-up plays alone
while the aircraft shakes in place, at **double playback rate** so the whole
recording finishes exactly as the catapult fires — the wait becomes a countdown
rather than a delay. Fire it **once per launch from a flag**, not every frame
governed by the cue's `minInterval`: an interval floor is a rate limiter, and a
clip meant to run to its end once will retrigger mid-play as soon as the dwell
exceeds the interval. The loop takes over at the catapult, which is also the first
moment there is something for a loop to sustain.

The fly-by fires **once per pass**: it needs a range that crossed the threshold
*this frame* and at least 120 m/s of closure, so a slow drift past is not a fly-by
and a circling hostile does not retrigger.

At crash start: stop the cannon loop, drop the engine loop, and let the warnings
die with the aircraft.

**Missing audio files are a normal state.** Every cue is optional; the game runs
silent and reports which files resolved. Mark a cue unavailable only on **positive
failure** (an `error` event, or `networkState === NETWORK_NO_SOURCE`) — never on
`readyState < 3`, which is also the state of a file that simply has not finished
loading and which will mark every working file as missing. Have the audio module
own **both** the readiness deadline and the report of its outcome; splitting them
across modules guarantees the two drift and the log states the opposite of the
truth.

---

## Runnable state

- a missile hit or a terrain impact produces flash, tumble, fireball, smoke trail
  and debris, then fades and respawns you **without any input**
- an ocean crash goes under rather than skating along the surface
- repeated crashes escalate the respawn visibly
- `R` recovers instantly at any point, including mid-crash
- engine, gun, warnings and callouts all play, with warnings audible over the gun

---

## Test gate

- **Cause mapping** covers all three reasons and an unknown reason still gets a
  presentation.
- **Timeline ordering**: flash < fireball < tumble < smoke < sparks; the crash is
  visible before the fade starts; smoke stops emitting before the fade completes;
  total impact-to-playable is ~2.3 s.
- **The aircraft stays visible** at 0.5 s and is hidden by ~1.0 s.
- **The camera kick** peaks at impact, decays fast, and is negligible by the
  respawn.
- **The tumble** is bounded, goes both ways, and roll dominates the other axes.
- **Momentum is inherited** — the aircraft does not stop in midair — and it falls
  while continuing forward.
- **A 250 m/s crash** travels a believable distance rather than teleporting.
- **An ocean crash sinks** and is hidden by the time it is under.
- **Duplicate suppression on every frame of the crash window**, with the count
  staying at one.
- **`reset()` clears the clock and every entity**; `finish()` restores aircraft
  opacity.
- **Spawn clearance:** flat ground gives the plain clearance; ground *ahead* raises
  it; the same position facing away does not; ground at the spawn point itself is
  caught; no sampler still yields a floor.
- **Audio:** priority ordering; a warning ducks ambient and weapon but not another
  warning; `mayFire` respects the minimum interval; takes rotate rather than
  repeating; the gun is a loop and a one-shot cannot be looped; a one-shot can be
  stopped early; ground warnings use AGL; the fly-by fires once per pass and not on
  a slow drift; a build with no audio files is silent and reports itself so.
