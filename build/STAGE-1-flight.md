# Stage 1 — A shape flying over water

**Goal:** open a browser and fly. No assets, no combat, no terrain.

Read `CLAUDE.md` §4 (architecture), §5 (scale), §17 (invariants) before starting.

---

## Files to create

```
flight-lab.html      canvas, import map, #loading, resize handling, all CSS
src/world.js         scene, ocean plane, sky, fog, lighting
src/flight.js        the flight model — ASSISTED mode only
src/input.js         keyboard + pointer → { x, y, roll, throttle }
src/chase-camera.js  the one camera rig
src/main.js          frame loop and wiring
src/flight.test.js   the assertion harness + this stage's checks
tests.html           loads the suite, prints a pass/fail count
```

---

## Three things that must be right now

Retrofitting any of these later is a rewrite, not an edit.

1. **`requestAnimationFrame` is scheduled FIRST in the frame, and the body runs
   inside `try`/`catch`.**

   ```js
   function frame() {
     requestAnimationFrame(frame);   // FIRST — before anything can throw
     try { step(); }
     catch (err) { /* log the first few, keep flying */ }
   }
   ```

   If rAF is the last statement, one thrown frame permanently ends the session and
   leaves the last rendered image on screen. You will lose hours believing a
   feature is broken when the loop is simply dead.

2. **`flight.js` must not import three.js**, and `flightState.quat` is a plain
   `{x, y, z, w}` record. Provide your own quaternion helpers as plain math
   (`quatFromEulerYXZ`, `quatForward`, `quatUp`, multiply, identity). Consumers
   copy components; nothing may call `.copy()` on it. If three.js leaks in here it
   will be load-bearing by stage 5.

3. **Track axis keys by `event.code`, never `event.key`, and arrow keys are not
   flight axes.** `key` can differ between the keydown and keyup of the same
   physical press (modifiers, caps lock, layout, IME); when it does, the keyup
   deletes a set entry that isn't there and the keydown's entry is orphaned
   permanently — a stuck axis at full deflection that no further input clears.
   Arrow keys are stolen by browser and embed chrome, so their keyup goes missing.

---

## World (`world.js`)

```
1 world unit    = 1 metre
Ocean plane       100 km square, at y = 0
Camera            near 0.5, far 120000, logarithmic depth buffer
Fog               FogExp2, density 3.5e-5, tinted to the sky's horizon band
```

The **logarithmic depth buffer is required**: near 0.5 with a 120 km far plane has
nowhere near enough integer precision for both a 19 m airframe at 24 m and a
horizon 25 km out. Without it you get z-fighting across the whole scene.

Fog is not decoration — atmospheric perspective is what stops a large world
reading as a tabletop model. Tint it to exactly the sky's horizon colour so there
is no visible fog line.

**Course runs toward −Z. Heading 0 = −Z.** Forward vectors are `(−sin h, −cos h)`.
Establish this now and use it everywhere; it appears later in bearings, break
directions, spawn offsets and the radar.

---

## Flight model (`flight.js`) — ASSISTED only

An arcade coordinated turn on Euler angles. Bank drives heading change; controls
self-centre; pitch is an angle the player holds. The aircraft cannot depart.

```
speed        min 110, cruise 170, max 250 m/s
throttle     a persistent LEVER, not an accelerator
afterburner  top 15% of lever travel
bank limit   ±70°
sink         bank-driven altitude loss — the arcade substitute for lift loss
```

**The throttle is the one control players misread.** Releasing the key must leave
the lever where it is. Do not implement it as an accelerator that decays.

Even though only one mode exists now, **write the quaternion every frame** from
the Euler angles. The renderer and camera must read one field regardless of mode,
so that stage 2 can add EXPERT without touching them.

Provide `captureFlightState(state)` / `applyFlightState(state, snapshot)` now —
stages 3 and 7 both depend on snapshots existing.

---

## Input (`input.js`)

```
W S        pitch          A D   bank          Q E   roll rate
L-Shift    throttle up    L-Ctrl throttle down    wheel  throttle
C          clear stuck keys
R          restart
```

Axes ramp toward their target rather than snapping (a damping constant around
6 /s), so key release eases back to zero.

**Clear all held keys on `blur`, `visibilitychange` (hidden), `pagehide` and
`contextmenu`.** Each is a way a held key stops being held without a keyup
arriving. Expose `heldKeys()` so the developer rail can show a stuck axis, and
bind `C` to clear them manually.

PLACEHOLDER_MOUSE_BLOCK There must be no `pointermove`
listener in this file. A screen position cannot be a stick: it has no centre, no
detent and no spring, and every attempt to synthesise those from coordinates
(relative origin, edge drift, claim revocation, settle timers, pointer lock,
spring return) fixes one failure mode and leaves the others. The flight axes must
be unreachable from the pointer as a structural property, not a policy.

---

## Camera (`chase-camera.js`)

One rig, behind and above, world-up.

```
standoff   22.5–26 (scales with speed)
height     6.5
framingY   −0.18
fov        59–71° by speed
```

Damp the forward direction, the up vector and roll **separately**. Provide a
`lagScale` multiplier on the forward damping — stage 4 and stage 9 both need it to
make a composition lag behind the aircraft.

Design the rig so alternative compositions are **blended in, never switched to**.
Later stages add three of them; a second camera object would have to be kept in
sync and would produce cuts.

**Camera shake gets exactly one channel.** Add a single offset that is subtracted
at the start of a frame and re-added at the end. Cannon fire, deck shimmer,
catapult vibration, missile impact and the crash kick will all add into it. A
second offset means the rig fights itself.

---

## Runnable state

You can open `flight-lab.html` and:

- fly a placeholder box over water
- turn by banking, and lose a little altitude doing it
- push the throttle up and have it stay there
- see speed, altitude, attitude and held keys on a developer rail (`H` toggles)

---

## Test gate

Add to `src/flight.test.js`. A `check(name, pass, detail)` helper and a pass/fail
count — no framework, no runner, no async.

- **Envelope:** speed clamps to 110–250; bank clamps to ±70°.
- **Bank → heading:** a held bank produces heading change in the correct
  direction, and zero bank produces none.
- **Throttle is a lever:** releasing the input leaves the value unchanged;
  afterburner engages only in the top 15%.
- **Sink:** banking costs altitude; level flight does not.
- **Snapshot round-trip:** `applyFlightState(s, captureFlightState(s))` is a
  no-op.
- **Quaternion:** it is a plain object with `x, y, z, w`; forward derived from it
  matches `(−sin h, −cos h)`.
- **Input ramping:** an axis reaches full deflection over the expected time and
  returns to zero on release.
- **`event.code` robustness:** a keydown/keyup pair whose `key` differs but whose
  `code` matches does not leave a stuck axis.
- **Stuck-key clearing:** `blur` clears held keys; `C` clears them.
- **Pointer:** an untouched pointer commands nothing; hovering on the aircraft
  holds attitude; right of centre banks right and left banks left; above centre is
  nose up; returning to centre stops the turn; leaving the window releases the
  stick; deflection is bounded; a degenerate viewport does not divide by zero.
- **A held key overrides a deflected cursor**, and releasing it hands the axis back.
- **`setPointerEnabled(false)`** silences steering entirely.

Green count before stage 2.
