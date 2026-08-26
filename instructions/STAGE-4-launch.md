# Stage 4 — The carrier and the catapult

**Goal:** every session begins with a launch that hands you the aircraft at
172 m/s.

Prerequisite: stage 3 green.

**This is the single most valuable milestone in the build.** It is also what
teaches the player the throttle and the camera, so get it feeling right before any
combat exists. Do not rush it to reach the weapons.

---

## Files

```
src/world.js    add carrier load + the four measured anchors
src/launch.js   NEW — the solved stroke, LAUNCH_VIEW blend
```

---

## Carrier (`world.js`)

Load the CVN glTF and **normalise from measured bounds to 332.8 m length**.
Position it at **z = −1600**, which puts it 6.0 km from the coast measured in
stage 3.

Derive four local reference points **from the measured bounds, not authored
offsets**:

```
DeckReference        the deck plane
LaunchStart          where the aircraft sits
LaunchEnd            the release point, short of the bow
ApproachReference    used in stage 7 for recovery
```

The **launch run is the measured distance between `LaunchStart` and `LaunchEnd`** —
approximately 199.7 m on the reference asset, but §"Solving the stroke" below
works against whatever it actually is. Log the anchors and the run length.

Add an `O` key that draws the anchors. You will want it the first time the
aircraft launches through the deck instead of along it.

If the carrier fails to load, fall back to authored offsets on an assumed deck
height so the mission remains flyable, and record the fallback.

---

## The sequence (`launch.js`)

~7.1 s total. **No flight physics runs during it.** The aircraft is attached to a
launch reference frame built from the anchors; the script writes the whole flight
state and the renderer reads it, so the handoff has nothing to reconcile.

No wheel physics, no suspension, no throttle input. The player watches.

```
0.0–11.0   parked. The engine start-up plays IN FULL at double speed (a ~22 s
           recording finishing in ~11 s). Camera shake ramps 0.02 → 0.16.
9.6        afterburner lights (shake ×1.5)
11.0       catapult fires on the start-up's last note. Engine loop takes over.
13.8       release point — exactly the measured deck run. 152 m/s.
14.2       rotate to 12° pitch, gear up
14.7       control handoff at 172 m/s, throttle 0.92, afterburner lit
```

**The deck dwell is the LENGTH OF THE ENGINE START-UP**, played at double speed —
not an authored number. The sound runs to its end and the catapult fires on its
last note, which makes the wait read as a countdown rather than a delay.

This couples two values in different files: if the recording is replaced,
re-derive `deckDwell ≈ clipDuration / rate` together with the cue's playback rate.

Ramp the shake across the dwell rather than holding it flat; a constant vibration
for ten seconds reads as a rendering artefact rather than an engine winding up.

Hand over **in afterburner at lever 0.92**, not at the lever position that merely
sustains 172 m/s. The plume must not die on the frame the player takes over, and
"released at full power" is the read the sequence is building to.

---

## Solving the stroke — do not author the duration

The speed curve is:

```
speed(u) = lerp(8, 152, u^1.25)        u = 0..1 across the stroke
```

Its closed-form distance over duration `T` is:

```
distance = T · (v0 + (v1 − v0) / (e + 1))
```

**Invert that to get the time that covers the measured run exactly**, so the
release point lands on the `LaunchEnd` anchor at any frame rate. Provide both
inverses: solve for time given the run, and solve for exit speed given a time.

If the solved time falls outside **2.2–3.1 s**, clamp the time and **re-solve the
exit speed instead**, so the geometry always closes. The aircraft must leave the
catapult at the release point on any deck, never before or past it.

**Use exponent 1.25, not 2.0.** A `t²` curve needs 3.56 s to cover 199.7 m at these
speeds, which is not "fast". 1.25 still has acceleration increasing all the way to
the deck edge, which is the read you want.

**Compute position from the closed-form integral, not accumulated `dt`**, so the
release point is frame-rate independent. A 20 Hz frame must reach the same place as
a 60 Hz one.

---

## Gear

A **visibility swap between the model's two variants** from stage 2 — no animation.
Retract at 0.58 s into the climb-out.

Hide the transition inside the rotation and the afterburner flash. It is an
intentional cheat and the cheapest believable one available: the camera is moving
hard at that instant and the player is watching the nose come up.

---

## Camera — blend, never switch

Use the `lagScale` hook from stage 1. This is a **blend of the existing rig**, not
a second camera:

```
LAUNCH_VIEW   standoff 15.5   height 3.2   framingY −0.05   lagScale 0.34
```

Closer and lower than the chase. **`lagScale 0.34` cuts the rig's forward damping
to a third**, so the camera falls behind as the aircraft surges — that lag is the
whole effect, and it lives in the rig's damping where stage 1 put it.

FOV **59° → 71°, weighted by the square of stroke progress**, so the lens opens
rather than drifting. Blend the whole composition out over 1.4 s after handoff; by
the time it is gone the ordinary speed-driven FOV has arrived at the same value
from below, so there is no cut.

Deck shimmer and catapult vibration go into the **single shake channel** from
stage 1. Do not add a second offset.

---

## Handoff

On the handoff frame, seed the flight model with exactly what the script ended on:
position, attitude, 172 m/s, throttle 0.92, afterburner lit, sink zeroed.

Start the safe-state history **here** — nothing before the handoff is a state the
player could be recovered to.

Consume and drop any discrete input latches (roll request, fire) accumulated
during the script, so a key pressed on the deck does not fire the instant control
arrives.

---

## Runnable state

- the aircraft sits on the deck, shaking, engines spooling, burner lighting
- the catapult throws it up the deck and it leaves at the bow, not through it
- it rotates, the gear comes up, and you have control at 172 m/s in afterburner
- the camera is tight on the deck, lags on the stroke, and widens out smoothly
- `O` draws the anchors; the load log carries the solved plan

---

## Test gate

- **The ease is monotonic and closed at both ends**; acceleration increases
  (the last tenth of the stroke covers more speed than the first).
- **Closed-form distance matches a numeric integral of its own curve** to within
  a few centimetres.
- **`solveStrokeTime` inverts `strokeDistance`**, and `solveExitSpeed` closes the
  same geometry.
- **The measured deck solves inside 2.2–3.1 s** and keeps the authored exit speed.
- **A short deck (say 90 m) clamps the time and re-solves the speed**, and the run
  still closes exactly.
- **A full 60 Hz sequence** asserts: exactly one handoff, at the expected time; the
  stroke never runs past the release point and gets within one frame of it; the
  ordering deck-edge → gear-up → handoff; the seeded speed and throttle; zero
  lateral drift; nose-up attitude at handoff.
- **The same at 20 Hz** — the release point is frame-rate independent.
- **The parked pose** sits on the measured deck with gear down and heading along
  the launch axis.
- **The dwell matches the start-up clip** at its declared playback rate, so the
  catapult fires as the sound ends.
- **The start-up cue fires exactly ONCE per launch.** Trigger it from a flag reset
  when the aircraft is placed on the deck — not every frame governed by the cue's
  `minInterval`. An interval floor is a rate limiter for a cue that fires
  occasionally; a clip whose whole purpose is to run to its end once will retrigger
  mid-play the moment the dwell exceeds the interval, and copies overlap.
- **A held deck does not advance, and the hold cannot pause a launch already
  rolling.** `update(dt, hold)` freezes the sequence at t = 0 only. Pass
  `!audio.state.armed`: a browser blocks audio until a user gesture, and the launch
  starts on frame one of a fresh load, so without the hold the entire opening plays
  silent and the start-up is consumed against a blocked context.
- FOV opens from the deck value toward the exit value and never past a comfortable
  maximum.
