# Stage 5 — Targeting, guns, one missile

**Goal:** lock a passive drone and kill it with either weapon.

Prerequisite: stage 4 green.

---

## Files

```
src/weapons.js    NEW — hardpoints, mounted stores, loadout
src/enemy.js      NEW — the drone airframe (health, hit marking)
src/targeting.js  NEW — candidate selection, lock progression
src/missile.js    NEW — ONE implementation, AIM-9 config only
src/gun.js        NEW — hitscan cannon + tracers + lead pipper
src/combat-hud.js NEW — the three layers
```

---

## Hardpoints (`weapons.js`)

Mount two AIM-9s as **child transforms of the aircraft**, not tracked
coordinates. A round then always leaves the rail wherever the aircraft happens to
be pointing, at any attitude, with no per-frame maths.

Normalise the missile asset to **2.85 m** from measured bounds.

Provide `next()`, `release(rail)`, `reload()`, `count`, and **`setCount(n)`**.
That last one matters in stage 7: a checkpoint must restore the loadout it
recorded, and reloading to full would make flying into a mountain the cheapest way
to refill the rails.

Hide a rail's visual when its round is released.

---

## The drone (`enemy.js`)

An abstract target that later becomes a hostile fighter. It must publish what
every consumer needs and nothing more:

```
{ position, velocity, alive, health, maxHealth, radius, label, hitAt }
```

**This is the target contract, and it is load-bearing.** In stage 8 SAM sites
publish the same shape, and targeting, the gun, the missile and the HUD bracket
then work on ground targets with no special cases at all. Design it now as a
contract, not as "the drone's fields".

Provide `damageTarget(target, amount, at)` and `markTargetHit(target, at)`. Flash
the mesh briefly on a hit so the player gets feedback that is not a number.

---

## Targeting (`targeting.js`)

Knows nothing about the HUD, the missile or the player's weapon.

```
lock time      1.25 s of steady tracking
```

Take a list of **candidates** each frame plus an observer (position, forward) and a
screen-offset function. Score by a combination of angle off the nose and range;
progress a lock while the best candidate stays the same; decay it when it does not.

Publish `{ currentTarget, lockState, lockProgress, range, angle }`.

**Handing it an empty candidate list must be the normal way to disable it** — in
stage 7 the mission does exactly that between encounters. Do not add an
`enabled` flag.

---

## One missile, three configs (`missile.js`)

**`missile.js` must never learn whose round it is.** Only the AIM-9 config exists
this stage; stages 6 and 8 add the other two as data.

```
AIM-9   900 m/s max · 55°/s turn · 6.5 s life · 22 m proximity fuze
```

Behaviour:

- **Separate from the rail before guiding** — a round that steers on frame one
  looks like it was fired from the cockpit.
- **Give up beyond an overshoot angle *with opening range*.** Angle alone falsely
  calls an overshoot on a round still closing through a crossing geometry, and the
  round then coasts past a target it would have hit.
- **Detonate on a proximity fuze**, not on exact intersection.
- A defeated round **keeps flying its curve** and can still get lucky on the fuze,
  so a miss reads as a miss.

Provide a **guidance-authority hook** now, even though nothing uses it yet:

```js
authorityFor: (missile) => 1
```

Stages 6 and 8 attach the barrel roll, terrain masking and flares to this single
function. The missile must never learn what any of those are.

Also provide `expireOwner(owner)` — stage 7 needs to retire one side's rounds at a
phase transition without deleting the player's shot that is mid-flight.

Emit events (`hit`, `expire`) rather than acting. The caller decides what a hit
means — that is the architecture from `CLAUDE.md` §4.

---

## Gun (`gun.js`)

**Hitscan gameplay, occasional tracers for visuals.** A 20 mm burst at a
believable rate would be hundreds of meshes per second; the shots are resolved
instantly and only some are drawn.

```
500 rounds
```

Provide a **lead pipper** — where to aim for a moving target. The solution needs
only a position and a velocity, which is why in stage 8 it works on ground targets
for free (a SAM's velocity is zero).

**Provide `clearFx()` separately from `reset()`.** `reset()` reloads the magazine,
which is not cleanup. A phase transition in stage 7 takes the tracers, not the
ammunition. Getting this wrong silently disarms the player at every phase change.

Cannon fire adds into the **single camera shake channel** from stage 1.

---

## HUD (`combat-hud.js`)

SVG overlay in **three explicit layers, in paint order**:

```
1  screen-fixed   instruments, threat words, messages
2  attitude       horizon, pitch ladder
3  world-tracked  target bracket, lock diamond, lead pipper
```

Paint order is how priority is expressed later: in stage 7 the nav marker paints
*before* the bracket, so a hostile always covers a waypoint, and that is a
structural guarantee rather than a rule someone has to remember.

Colour vocabulary — establish it now and do not extend it casually:

```
#8ef0c8 green    instruments, good
#ffd79a amber    warning
#ff9b7a salmon   danger
#9fd7ff cyan     advisory / information
```

**Edge-anchor the flanking instrument columns**: `text-anchor: start` at the left
gutter, `end` at the right. A centred column spills half its string past its
anchor, so respecting a gutter would require knowing the rendered text width.
Overlap becomes impossible only when the gutter is a hard edge the text starts on.
Bound the developer rail's width for the same reason — a content-sized panel grows
without limit as its text lengthens, and will eventually cover the airspeed
readout.

Damp world-tracked markers toward their projected position so they do not jitter.

---

## Runnable state

- a passive drone flies a patrol path
- holding it on the nose builds a lock; the diamond closes; `MISSILE AWAY` fires
- the missile separates, guides, and detonates on proximity
- the gun works, with tracers and a usable lead pipper
- `X` switches weapons; the rail shows both magazines
- killing the drone produces a burst and clears the lock

---

## Test gate

- **Lock progresses** only while the same candidate is tracked, and **decays** when
  it is not.
- **An empty candidate list clears the lock** and produces no target.
- **The lead solution** puts the pipper ahead of a crossing target, and equals the
  target position for a stationary one.
- **The overshoot rule requires angle *and* opening range** — a round closing
  head-on through a crossing geometry is not called an overshoot.
- **The fuze detonates within its radius** and not outside it.
- **A defeated round keeps flying** rather than being deleted.
- **`clearFx()` does not touch ammunition; `reset()` does.**
- **`expireOwner()` retires only that owner's rounds.**
- **The target contract:** the drone exposes position, velocity, alive, health,
  radius and label.
- **Turn radius** of the AIM-9 (`v / ω`) is in the expected range — stage 6
  compares enemy rounds against it for fairness.
