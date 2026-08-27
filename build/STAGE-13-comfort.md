# Stage 13 — Comfort, and honesty about state

**Goal:** the warnings fire when they are useful, the audio reports its own
failures, and the game can be stopped.

Prerequisite: stage 12 green.

```
src/audio.js     warning rules, noDuck, the loop watchdog
src/main.js      ONE owner for the engine loop, the pause gate, the rail readout
flight-lab.html  #pause
audio-probe.html a standalone playability probe for audio assets
```

**No features.** This is the stage where the build stops lying about its own
state, and every item in it is a fault a green test suite never mentioned. Do it
last and do not skip it.

---

## 1. The engine loop had four owners

The single worst bug in the project, and the cheapest to fix once seen.

The crash branch, the deck branch and the mission-complete branch each switched
the engine loop off for a good reason. Then the drive line, running **later in the
same frame**, switched it back on — because its condition only knew about the deck.

So every frame the element was paused and restarted, `start()` reset `currentTime`
to zero, and the loop never advanced past a single frame of audio. Measured:
`advanced: 0.000` over 900 ms of wall clock. And every observable said it was
fine — `paused: false`, `readyState: 4`, correct `duration`, full `buffered` range,
no `error`, `play()` resolved, `volume` 0.554.

What the player heard was the restart itself: a click or a burst on the deck, and
silence in flight. It was reported four times, with a different theory each time.

**A media element cannot be owned by four branches.** Every condition that
silences a loop goes in one expression:

```js
const engineRunning =
  !onDeck &&                            // the deck belongs to the start-up cue
  !crashing &&                          // §34 the engine fails with the aircraft
  phase !== MissionPhase.COMPLETE &&    // frozen frame behind the end screen
  flightState.throttle > 0.02;
audio.loop(Cue.ENGINE_LOOP, engineRunning, { volume: ev.volume, rate: ev.rate });
```

Do not add a fifth caller. This is the same rule as the single-owner rules for the
aircraft transform and the mission clock, and it fails the same way — silently,
with everything reporting healthy.

---

## 2. The watchdog, and the distinction that makes it safe

Since an element cannot report that it is producing no sound, watch the one honest
signal: **does `currentTime` move.** Then separate two faults that look identical
from outside.

```
never moved     a START failure — the browser is refusing playback until the
                document has had a real user gesture. Nothing is misconfigured.
                Keep asking; say so on the rail.
moved, stopped  a genuine STALL — reset playbackRate to 1 and LOCK it (some
                engines mute a looping element at a shifted rate), re-issue
                play(), and count it.
```

**Conflating them is a real defect, not a hypothetical one.** The first version of
this watchdog did, caught an autoplay block, blamed the playback rate, and
permanently stripped the engine's throttle-pitch effect to fix a fault that had
nothing to do with it. Gate any repair on whether the clock has *ever* moved.

Two smaller rules:

- **Rate-limit the retry** (~4/s). A refused `play()` re-issued every frame is
  sixty rejected promises a second, and it makes a genuine autoplay block look
  like a stall.
- **Cap the console output per channel** (3 lines). A stall that cannot be
  repaired prints twice a second forever and buries everything else.

### The rail must name the state

Four states, because "no engine sound" has had a different cause every single time
it has been reported:

```
CLICK PAGE   the browser has not granted playback — click the canvas
MUTE         the player pressed K, or the game is paused
OFF          the engine is legitimately not running (deck, crash)
12.3s        the loop's own clock, advancing — audio works; if nothing is
             audible the fault is the output device or the tab volume
```

One ambiguous number cannot distinguish those, and the cost of not distinguishing
them is measured in days.

### `audio-probe.html`

A standalone page that plays each file and reports whether its clock advanced.
Run every new audio asset through it before wiring it into the cue table.

**Mind the order it probes in.** The autoplay policy makes the first few clips a
page touches look broken *regardless of which clips they are* — and that artefact
is very easy to mistake for a property of the files. It produced a confident wrong
diagnosis here (three clips identified as unstreamable by sample rate and
re-encoded to WAV, for a fault that was never in them). Reversing the probe order
is what exposed it: the known-good clips failed and the suspects played.

Keep the trap documented in the file itself.

---

## 3. Warnings that fire when the player can act

Three changes, and the first two are also §17 invariants.

**`PULL UP` is a TIME, not a height.** Fewer than 9 s to impact on the current
trajectory, from sink rate and from the ground sampled 6 s ahead. A height
threshold cannot hold at both 110 and 250 m/s, and over rising ground it fires far
too late — by the time a low number is reached the aircraft is committed, which was
reported exactly that way: "once I hear it, I can't pull up". Nine seconds is
~2.2 km of warning, and a time also works over water, where there is no terrain
ahead to probe.

**`ALTITUDE` is low AND descending** — below 250 m AGL with sink over 1.5 m/s. Low
and level is legitimate flying; the terrain leg is flown that way on purpose. A
height-only rule fires every `minInterval` for the whole sortie, which is a cue the
player learns to ignore — *and* it silently killed the engine, because every firing
ducked the ambient channels and a cue repeating every 3.5 s is not a duck, it is a
permanent attenuation.

**Nothing fires in the first 5 s of player control.** The aircraft leaves the deck
~20 m over the water and sinks briefly off the bow before the wing takes over: a
guaranteed trajectory warning at the one moment the player has nothing to do with
it, over the loudest scripted beat in the build. Reset the grace whenever control
is taken away, so it covers every respawn and the recovery autopilot.

**And the engine is exempt from ducking** (`noDuck`). It is the aircraft's own
voice and the bed the whole mix sits on. The gun still ducks — a cannon burst
genuinely masks speech.

---

## 4. Pause

`Esc`, both directions. A title, a rule, one line saying how to get back in.

**No quit** — the tab is the quit. No options, no settings, no volume slider. Every
one of those is a menu, and this game does not have menus. Same furniture as the
win and loss screens so it reads as part of the same family.

- **Pause is a property of the frame LOOP**, not of the mission, the mode or the
  flight model. One early return; none of those systems learns about it. That is
  precisely why pausing cannot corrupt a launch, a crash sequence or a checkpoint
  the way a per-system pause flag could.
- **Put the return after the frame's timestamp is updated**, so the resume frame
  gets a normal `dt` rather than the whole paused duration. The `dt` clamp would
  swallow it anyway; relying on a clamp to hide a bug is not a design.
- **Keep rendering.** The frozen world looks like the world, not like a crash.
- **Handle `Esc` before every other binding and return.** While paused the only
  key that acts is the one that unpauses — a stray `T` must not restart the
  mission behind the pause screen.
- **Silence the audio and restore what the player had**, remembering their own
  mute (`K`), and disable pointer steering: a paused game must not be flown by a
  moving cursor.

---

## Test gate

- A frozen clock is detected even though the element reports perfect health
- The playback rate is reset and locked, and `play()` re-issued
- The pitch effect stays off once blamed, rather than being re-applied next frame
- A healthy advancing loop is **never** touched, and its rate is never locked
- A loop **wrap** (clock moving backwards) is not mistaken for a stall
- A muted or stopped channel is not reported as stalled
- A never-started channel is counted as **pending**, not stalled, and keeps its
  pitch effect
- Once a channel has genuinely played, a later freeze **is** a stall and is repaired
- `PULL UP` fires on time-to-impact, including level flight into rising ground
- Low and level is silent; low and descending speaks
- 200 m over the ocean at cruise is silent
- The engine channels carry `noDuck`; the gun does not; warnings are not duckable
- There is a grace window of at least 3 s before any ground warning

Pause is verified live rather than by assertion: freeze, confirm `tau` and position
are identical across two seconds, confirm the overlay is up and the audio muted,
press `T` and `]` and confirm neither acts, then resume and confirm the clock runs
again.

---

## Runnable state

Load the page and click it. The deck start-up should play in full and the catapult
fire on its last note; the rail should read `eng CLICK PAGE` before the click and a
climbing clock after. Fly for a minute at wave height and confirm the warnings stay
quiet while you are level. Press `Esc` mid-turn.

---

## Definition of done for the whole build

Walk §19 of `../CLAUDE.md`. Then the one thing none of this replaces: **three human
runs**, per stage 10. Every timing figure in this project is still a bot flying
straight lines.
