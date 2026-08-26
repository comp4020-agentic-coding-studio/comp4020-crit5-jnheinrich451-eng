# Stage 6 — An enemy that fights back

**Goal:** a real dogfight you can lose.

Prerequisite: stage 5 green.

---

## Files

```
src/hostile.js  NEW — the 8-state FSM, HOSTILE_MISSILE config
src/threat.js   NEW — TRACK/LOCK/MISSILE escalation, the authority hook
src/damage.js   NEW — PlayerDamageEvent + feedback response
src/flight.js   add the barrel roll manoeuvre
```

---

## The FSM (`hostile.js`)

**One pure transition function, and nothing else may promote a state.** Put every
engagement condition inside it. When behaviour misbehaves there must be exactly one
place to look.

```
PATROL → PURSUIT → ACQUIRE → ATTACK → COOLDOWN → REPOSITION → PURSUIT
                        ↘   DEFEND   ↗
                                              DESTROYED (terminal)
```

```
turn rate      12°/s yaw, 7°/s pitch    (×2.1 during a defensive break)
detect         ~5000 m; disengage beyond that
attack cone    520–2500 m, 28° off its nose
lock           1.25 s, then 0.55 s to launch
cooldown       7 s between launches
magazine       set per encounter (stage 7 supplies it)
min altitude   guarded — it must never fly into the sea
```

Signature: `hostileTransition(ai, ctx, cfg)` where `ctx` carries only published
facts (alive, playerAlive, ready, range, inCone). Testable with no scene.

### `ammo: 0` is a design tool, not an edge case

Stage 7 deploys this aircraft with zero rounds for the first encounter. The
transition table **already** refuses to promote PURSUIT → ACQUIRE without a round,
so "it chases you but does not shoot back yet" requires **no new state and no
special case**. Do not add one.

### DEFEND — reacting to the player's lock

The hostile breaks when the player has held a completed lock on it for **0.9 s** —
roughly the time an AIM-9 needs to launch. A ready player gets their shot; a
hesitant one watches the target leave. That delay *is* the skill expression.

Four requirements:

- **A fleeting lock provokes nothing.** Accumulate the cue only while the lock is
  actually held, and zero it the moment the lock drops. A hostile that reacts to a
  momentary lock is reading the player's HUD.
- **A committed ATTACK is never interruptible.** It is 0.55 s from lock to launch,
  and a hostile that could be talked out of a shot would never land one.
- **6 s cooldown**, so a sustained lock cannot turn it into a permanent evasion
  loop the player can never shoot it out of.
- **Break for a fixed 2.8 s in one direction**, with a descending pitch component
  if there is altitude to trade. It should be able to overshoot and end up worse
  off — readable opposition, not an optimal defence.

**Latch the break direction at entry.** Compute which way to turn once, store it,
and use the stored value for the whole break. Recomputing per frame flips the cross
product as the aircraft turns, and it oscillates to a net heading change of
nothing. (This same trap appears again in stage 9 for the crash tumble.)

### One instance, many encounters

Provide `deploy({ at, heading, ammo, engageDelay })` that resets, repositions and
re-arms, plus `setActive(on)`. Stage 7 reuses one aircraft for all three
encounters.

**An inactive hostile must be switched off entirely** — not simulated, not drawn,
and not offered to targeting as a candidate. Assert that ten seconds of updates on
an inactive hostile moves it zero metres.

Note that `deploy()` must preserve the encounter *count* across its internal
reset — that count is what alternates which side it appears on.

---

## Threat monitor (`threat.js`)

What is being done to the **player**. Separate from `hostile.js` on purpose: in
stage 8 a second, completely different source (ground sites) escalates through the
same display.

```
NONE → TRACK → LOCK → MISSILE
```

A live round always outranks an acquisition. Publish level, distance, closing
rate, a bearing arrow, and lock progress.

### The authority hook

This is the single point through which every counter-measure in the game works:

```js
authorityFor(missile, evasionCtx) -> 0..1
```

The missile from stage 5 asks "how much guidance do I still have?" and must never
learn what a barrel roll, a ridge or a flare is. Stage 8 composes two more
penalties onto this same function.

**Never reduce authority to zero.** A defeated round keeps flying its curve and can
still get lucky on the fuze, so a miss reads as a miss rather than as the game
switching a threat off.

---

## The hostile's round

Same implementation, different numbers:

```
                AIM-9    hostile
max speed        900       410   m/s
turn rate      55°/s     26°/s
lifetime        6.5 s      9.5 s
fuze             22 m        8 m
turn radius     ~940 m    ~904 m
```

**The fairness claim is the turn radius.** It must stay comparable to the F-15's
arcade turn at 250 m/s, which means *a hard crossing manoeuvre defeats the round
with no countermeasure at all*. Assert this — it is the difference between an
enemy missile that teaches manoeuvring and one that feels like a dice roll.

---

## Barrel roll (`Space`)

A discrete, latched request — never a held axis. Degrades an incoming round's
authority during a peak window:

```
0.60 s in Assisted
0.42 s in Expert    (finer control, so a tighter window)
```

Announce `EVADE` **only for a miss that was going to be a hit.** Announcing every
miss teaches the player nothing about whether the roll worked.

---

## Taking a hit (`damage.js`)

An **event**, not a reset call:

```
PlayerDamageEvent { source, at, position, amount, owner }
```

Missile code must never call anything that resets the flight state. A response
policy decides what a hit means — this stage's is feedback only (a red veil, a
`HIT` label, a camera kick), and stage 7 replaces the *consequence* without
touching a line of weapon code.

**One hard requirement: a hit produces exactly one response.** A proximity fuze
inside a 22 m sphere can trip on consecutive frames, and a re-entrant response
loops forever. Swallow anything arriving while holding or in cooldown.

---

## Runnable state

- the hostile patrols, detects you, and closes
- it acquires, locks, and launches; you get TRACK → LOCK → MISSILE warnings
- `Space` at the right moment defeats a round that would have hit
- holding a lock on it for ~0.9 s makes it break hard
- being hit produces feedback (and, for now, a development reset)

---

## Test gate

- **The whole transition table**, every state and every promotion condition,
  including that death wins from all of them and DESTROYED is terminal.
- **`ammo: 0` cannot reach ACQUIRE** even in a perfect firing position.
- **DEFEND:** a fleeting lock provokes nothing; a held lock provokes a break after
  the reaction delay; a committed ATTACK is not interruptible; a sustained lock
  cannot chain breaks inside the cooldown; the break changes heading by a
  meaningful amount (this is what catches an unlatched direction).
- **Altitude guard:** the hostile never descends below its floor, including
  through a diving break.
- **Inactive means inactive:** ten seconds of updates moves it zero metres and it
  is not drawn.
- **`deploy()`** revives, repositions, re-arms, and preserves the encounter count.
- **`spent`** is true only when the magazine is empty *and* nothing is in the air.
- **Turn-radius fairness:** the hostile's round is comparable to the player's turn.
- **Threat escalation:** a live round outranks any acquisition.
- **Authority:** the barrel roll degrades an incoming round but never to zero, and
  never affects the player's own rounds.
- **Damage response fires once** per hit and swallows re-entry.
