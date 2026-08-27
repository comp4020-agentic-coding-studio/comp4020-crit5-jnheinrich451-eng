# Stage 8 — Ground threats, countermeasures, modes

**Goal:** the terrain run is dangerous, and `T` cycles three modes.

Prerequisite: stage 7 green.

---

## Files

```
src/sam.js         NEW — sites, line of sight, the network
src/flares.js      NEW — the infrared countermeasure
src/rearm.js       NEW — automatic replenishment
src/modes.js       NEW — the rules table + sandbox driver
src/combat-hud.js  add the radar
```

---

## SAM sites (`sam.js`)

**One pure transition function**, as with the hostile.

```
SEARCH → TRACK → LOCK → LAUNCH → RELOAD → SEARCH
                                          DESTROYED (terminal)
```

```
detect     5000 m          track      1.15 s
envelope   450–4400 m      lock       1.35 s + 0.45 s launch delay
rounds     3 per site      reload     9 s
health     60              loss grace 0.7 s
```

Acquisition is deliberately slow — **2.95 s from first sighting to a round in the
air**. A fast pass through a covered corridor survives; loitering in the open does
not. That, plus the reload, is the entire difficulty dial.

The inner 450 m is a **dead zone**: flying straight over the top is a valid second
answer, and a nice one to discover.

### Line of sight is the entire mechanic

```js
lineOfSight(from, to, sampleHeight, cfg) -> boolean
```

14 samples along the segment, with a **10 m clearance margin in the player's
favour** so a graze counts as cover. **Skip the endpoints** — a site standing on
the ground would otherwise report itself as an obstruction.

It applies **twice**, and the second is the part that matters:

1. A site cannot *acquire* what it cannot see.
2. A round already in the air that loses sight keeps only **0.1** guidance
   authority — so diving behind a ridge defeats a shot already committed.

The second is composed onto stage 6's authority hook in `main.js`, because that is
the only layer that knows where the ground is:

```js
authorityFor: (m) => {
  const base = threat.authorityFor(m, evasion);
  if (m.owner !== "sam") return base;
  return lineOfSight(m.position, aircraft, groundAt) ? base : Math.min(base, 0.1);
}
```

The missile still knows nothing about terrain.

**Do not add a minimum-safe-altitude constant.** Low flight must be safe because
the ground is genuinely in the way. That way it works in a valley, does not work
over a plain, and the player can see why either way. A constant would make it
arbitrary and unlearnable.

The **loss grace** exists so a flicker of terrain does not drop an engagement.
Beyond it, the player has genuinely broken the lock.

**A spent site must never acquire again** — still a target, still worth a kill, but
no longer a threat. Otherwise it sits in LOCK forever with nothing to fire.

**Guard that at every edge, not just at `SEARCH`.** Enforcing it only on the way in
leaves `LAUNCH` with no exit except firing — and firing is itself gated on having a
round, so a site that reaches LAUNCH empty never sets `launched` and the table
returns LAUNCH forever. It then holds a permanent lock with no missile ever
arriving, which reads in play as "the SAM locks and warns but never shoots" and
appears halfway through a sortie, when a site is most likely to be spent. So
`LAUNCH` → `RELOAD` on an empty magazine, and `LOCK` → `SEARCH` on one.

### Destroyable with no special cases

A site publishes the **stage-5 target contract** — `{ position, velocity, alive,
health, radius, label }` — so targeting, the gun, the missile and the HUD bracket
all work unchanged. The gun works on ground targets for free, because a lead
solution needs only a position and a velocity and a SAM's is zero.

A kill leaves a **wreck in the world**: tinted, tilted, turret hidden. Not a
deletion — a destroyed installation should be visible evidence that the player did
something. Set its visibility explicitly, since the generic kill path hides dead
targets.

### The round

```
SAM   440 m/s · 22°/s turn · 11 s life · 10 m fuze · turn radius ~1146 m
```

The widest turn of the three rounds, so a hard crossing manoeuvre still beats it.
It launches **upward with zero inherited speed**, which is what makes the trail
read as a ground launch.

### Placement

Two per inland leg, flanking the corridor by ~1450 m so the safe line is *between*
them and low.

Each site **probes outward** along its side (scales 1.0, 0.72, 1.28, 0.48, 1.55)
and takes the first position standing on ground at least 30 m above sea level.
**A site with nowhere to stand is dropped, not floated** — five sites on land beat
six with one in the sea. (The first build put two launchers in the water; a lateral
offset near the coast simply misses the land.)

Only sites within detection range **and** envelope pay for a line-of-sight test.
Six sites × 14 samples every frame would be 84 terrain queries for nothing.

---

## Flares (`flares.js`)

```
count 8 · perBurst 3 · cooldown 1.4 s · burn 3.2 s
seduceRadius 320 m · minStandoff 160 m
eject: down and back, 28% inherited speed, heavy drag, gravity
```

### A seduced round is RE-TARGETED, not switched off

This is the whole mechanic and it is easy to get wrong. Swap the missile's
`target` to the flare, which publishes the same target contract everything else
does. The round visibly turns and chases it, and its fuze tests against the flare.
**The missile system needs no changes at all.**

Do **not** instead set a "lost" flag that freezes the round's heading. A round that
was tracking well is *already pointed at the player*, so freezing it changes
nothing and it arrives anyway. That flag is correct for an overshoot — where the
round is by definition pointed the wrong way — and completely wrong for a decoy.
Implementing it that way makes flares appear to do nothing.

When the flare burns out, mark it `alive = false`; the missile's existing "no live
target" branch then stops guidance and the round coasts out.

### Fairness is geometry, not dice

Flares fall behind on the player's own flight path, which produces all three cases
for free:

- a **stern chase** flies through the cloud and is decoyed;
- a **head-on shot** arrives before the flares are near it, so panicking early buys
  nothing;
- a round inside `minStandoff` is **committed** and the answer is the barrel roll.

**Keep `minStandoff` well below `seduceRadius`.** The cloud sits ~200 m astern a
second after release, so a standoff near that distance cancels the radius out and
the mechanic never fires at all. Assert the relationship.

Flares are infrared: they defeat a **missile**, never a radar **lock**. A SAM that
has you locked still has you.

---

## Rearm (`rearm.js`)

Both magazines replenish **20 s after reaching empty**, on independent timers, so
one weapon is always coming back and the player is never disarmed.

**Start the timer at empty, not at the first shot.** Otherwise the player fires one
AIM-9, waits, and is handed a third round — the loadout stops meaning anything.

An external refill (checkpoint restore, restart) cancels a running cycle, so a
timer cannot later top up an already-full magazine.

---

## Modes (`modes.js`)

A **rules table, not three copies of the game**. `T` cycles and restarts — a mode
change restarts because every mode starts on the deck, and half a mission in the
wrong ruleset is not a state worth supporting.

```
             phases  timer  nav  hostiles  sams  respawn         lives
MISSION        yes    yes   yes    yes      yes  crash-relative  5
FREE           no     no    no     yes      yes  carrier         —
PEACE          no     no    no     no       no   carrier         —
```

Anything that reads like a mode check elsewhere should be a lookup in this table.

**Lives are MISSION only** — see `../CLAUDE.md` §11. FREE and PEACE are practice,
and counting deaths in a sandbox turns it into a test.

Two rules identical across all three:

- **Every mode flies the catapult launch.** It is the strongest moment in the build
  and it is what teaches the throttle and the camera.
- **The ground still kills you in PEACE.** "No hostiles" is not "no consequences" —
  a sky with nothing to hit is a screensaver. What changes is the cost: you return
  to the deck and nothing is timed.

In the sandbox modes the mission director **parks** rather than being bypassed. It
still owns the deck and the catapult, then past the handoff stops advancing, stops
timing and publishes no navigation. Assert that a parked director never completes a
mission by accident.

The sandbox driver is deliberately tiny — no waves, no difficulty curve, no hidden
score: one hostile at a time, respawning 12 s after a kill, first arrival 8 s after
handoff.

**SAM sites must not respawn.** Six is a finite thing to clear, and a player who
spent four minutes clearing the valley has earned an empty valley.

The carrier respawn needs no new code: `placeOnDeck()` plus the launch script
already *is* a carrier respawn.

---

## Radar (`combat-hud.js`)

Heading-up polar plot, bottom-right. Own-ship at centre with a nose marker, range
rings at half and full scale, **6 km outer range** — the hostile's own detection
range plus a margin, so "on the radar" and "in the fight" mean the same thing.

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
- **Detection only.** The radar says nothing about tracking or lock — the bracket
  and lock diamond already carry that, and duplicating it gives the player two
  places to read one fact and a chance for them to disagree. One colour, two
  shapes.
- **Ground contacts appear only while a site is actually emitting** (TRACK / LOCK /
  LAUNCH). Showing every SAM the moment the player is in range would hand them the
  whole threat map and quietly undo the terrain-masking mechanic. This way flying
  the valley keeps the radar clean, and a square lighting up means the same thing
  as the warning in the player's ear.
- **Out of range is absent, not clamped to the rim.** An edge-held ghost implies
  knowledge the aircraft does not have.
- **Amber, not salmon.** "Something is there" is a warning, not a danger.

Pool the blips and gather contacts into one reused array — a fresh list per frame
would allocate sixty times a second for nothing.

Rotate contacts into the aircraft frame with the project's convention: forward is
`(−sin h, −cos h)` and right is its perpendicular `(−f.z, f.x)`, so "up" is always
where the nose points.

---

## Threat display

Use the **same three words for both sources**, labelled by origin (`SAM TRACK` vs
`TRACK`), because the answer differs — terrain for one, turning for the other.

A live round always outranks an acquisition and names its own owner. With two
acquisitions at once, the **closer** one is named: a SAM at 900 m is more urgent
than a fighter tracking from 4 km.

---

## Runnable state

- five sites stand on real ground, flanking the terrain corridor
- flying the valley floor produces no locks and a clean radar
- climbing produces `SAM TRACK`, then `SAM LOCK`, then a round off the ground
- diving behind a ridge defeats a committed shot
- `Z` throws flares; a stern-chasing round turns and chases them instead
- both magazines come back 20 s after running dry
- `T` cycles three working modes

---

## Test gate

- **Line of sight:** clear over flat ground; blocked by a ridge; clear again from
  above it; a graze counts as cover; solid ground blocks everything; no sampler
  means visible.
- **`samTransition`:** the full table, including that a spent site never acquires,
  the loss grace holds a lock through a flicker but not beyond, and leaving the
  envelope breaks a lock. Plus **termination**: for every magazine value, no state
  leaves itself as itself — specifically that a spent site can neither sit in
  LAUNCH nor hold a LOCK, while an armed one still waits in LAUNCH for its shot.
- **One launch per LOCK**, not two. (Firing on both "LOCK with expired timer" and
  the LAUNCH state spends two rounds per engagement — they are the same frame.)
- **A masked site never launches**, however long the player loiters.
- **Placement** rejects the sea, probes outward for land, and drops a site with
  nowhere to stand.
- **A wreck** stays visible, stops threatening, and is no longer a candidate.
- **The SAM round** has the widest turn of the three and inherits no launch speed.
- **`seduces`:** inside the radius decoys; outside does not; a committed round
  cannot be decoyed; a flare further away than the target loses; and
  `minStandoff < seduceRadius` by a real margin.
- **Decoy end-to-end with a MOVING aircraft.** A static aircraft never leaves its
  flares behind, so the cloud never reaches the chaser's path and the mechanic
  looks broken while being correct. Assert the round's `target` becomes the flare
  and that it is **not** merely flagged lost.
- **A head-on shot is not decoyed.**
- **A burnt-out flare stops being a target.**
- **Rearm:** a partly-spent magazine never starts a timer; reaching empty does;
  it refills exactly once; an external refill cancels a running cycle; the two
  weapons run independent timers.
- **The modes table** is complete for all three modes, and PEACE still has a
  failure state.
- **The sandbox driver** spawns nothing in PEACE however long you fly, one at a
  time in FREE, and SAM sites never respawn.
- **A parked director never completes a mission.**
