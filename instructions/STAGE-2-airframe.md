# Stage 2 — The real airframe, and Expert mode

**Goal:** the F-15E flies, and there are two flight models with two conventions.

Prerequisite: stage 1 green.

---

## Files

```
src/aircraft.js   NEW — F-15 load, hierarchy, gear visual swap
src/flight.js     add EXPERT quaternion integration
src/input.js      add the I pitch-convention toggle
src/engine-fx.js  NEW (optional here) — exhaust plume, afterburner, shock diamonds
src/vapor-fx.js   NEW (optional here) — wingtip vortices, load-driven
```

---

## Asset normalisation (`aircraft.js`)

Load the F-15E glTF and **normalise from measured bounds to 19.4 m length**.

Measure the source bounding box, compute the scale that produces the target
length, apply it, and log the result. **Never scale by a hand-typed factor** — a
replaced asset then silently changes the whole world's sense of scale, and every
tuned number downstream (camera standoff, probe offsets, gun range) is wrong at
once.

Log the node hierarchy on load. You need the names of the landing-gear nodes,
which the model ships as **two discrete variants** — a gear-up mesh and a
gear-down mesh plus its lamp.

Provide `setGearVisual(aircraft, down)`: a **visibility swap between the two
variants**. There is no gear animation in this project and there will not be one;
stage 4 hides the transition inside a rotation and an afterburner flash.

Cache the last value so a normal frame costs one comparison — the swap traverses
materials and must not run at 60 Hz. **Seed the cache as `null`, not `true`.** The
loader leaves the model gear-up, so a cache primed with the deck's value makes the
first call a no-op and the gear-down configuration unreachable for the whole
mission.

If the asset fails to load, keep flying with the placeholder and record the
failure in a list the developer rail shows.

---

## EXPERT mode (`flight.js`)

`M` toggles. Both modes must write the same quaternion field, which stage 1
already arranged.

Quaternion integration in **aircraft-local space**:

```
quat = quat * delta
```

Input is angular **velocity**, not an angle. Post-multiplication is what makes the
axes local — that is the entire mechanism, and it is why pitching while banked
bends the trajectory the way a real aircraft does.

**There must be no bank → heading term anywhere in EXPERT.** That coupling is what
ASSISTED is; its absence is what EXPERT is. Write a test that asserts the
*absence*, because a well-meaning later edit that "fixes turning" in Expert will
reintroduce it.

Consequences to accept, not smooth over:

- controls do not self-centre
- the aircraft can be inverted and stay there
- the player can lose orientation

In Expert the camera should lean on the aircraft's up-vector rather than a flat
world-up roll term, so inverted flight remains readable.

Clear all transient input state on a mode change: a held key would otherwise
command the fresh model on frame one, and the ramped axes would carry the old
attitude in with them.

---

## Pitch convention (`input.js`)

```
NOSE UP     W pitches up      default
NOSE DOWN   W pitches down    the control-column convention
```

`I` toggles. Both conventions are real and neither is wrong: W = nose up is what
WASD implies to a first-time player, and W = nose down is what anyone who has
flown a sim will reach for without thinking. Defaulting to nose-up serves the
person being handed the game cold; the toggle serves the person who already flies.

**Implement it as one sign flip at the input boundary.** Nothing downstream —
neither flight model, the HUD, nor the FX — may know the setting exists. A
convention is not a physics change, so no other module should have an opinion
about it.

**It is a preference, not transient state.** Unlike every other input value, it
must survive reset, respawn and mode change. Every other reset in this project
clears everything it can reach, so this needs an explicit exception.

Announce it as `PITCH · W = NOSE DOWN`, not `INVERT ON`. A player who just pressed
the key needs to know which way W now goes, and "ON" does not tell them.

---

## Runnable state

- the F-15E flies at 19.4 m, gear up, in both modes
- `M` switches models cleanly with no attitude jump
- Expert can complete a loop and hold inverted flight
- `I` flips the pitch axis immediately, even mid-input
- (if built) the plume brightens with throttle and the burner lights in the top 15%

---

## Test gate

- **Normalisation:** the loaded length is 19.4 m within tolerance, computed from
  measured bounds rather than a constant.
- **Gear swap:** `setGearVisual(true)` shows the down variant and its lamp and
  hides the up variant; the first call always paints regardless of load state.
- **Expert has no bank → heading term.** Bank the aircraft in Expert, hold no yaw
  input, and assert heading is unchanged. Assert the opposite in Assisted.
- **Expert is local:** pitch input while banked changes heading (via the local
  axis), which is the mode's whole point.
- **Both modes write the quaternion**, and forward/up derived from it agree with
  the Euler angles in Assisted.
- **Mode change clears transient input.**
- **Pitch convention:** the pure map is a sign flip and nothing else; neutral
  stays neutral; it is symmetric; toggling while a key is held flips the axis on
  the spot; it survives a reset; and bank is unaffected.
