# PATCH-01 — wing stores placement and the two-round salvo

Addendum to `CLAUDE.md`. Two changes, both in the weapons chain, both small.
Sections numbered **P1–P2** to stay clear of CLAUDE.md's §. HUD work is in
`HUD.md`, not here.

Nothing in this patch changes `missile.js` guidance, `targeting.js`, `rearm.js`
or the collision policies. If a diff reaches into those, the patch is being
implemented in the wrong place.

---

## P1. The AIM-9s must hang under and behind the wing

### What is wrong

On the deck view, both rounds read as **floating next to the aircraft**: they sit
level with the wing at roughly mid-span, with visible daylight between round and
airframe and no visible attachment. The seeker head is forward of the wing
leading edge and the whole body is inboard of the panel it is supposed to hang
from, so the eye reads two loose objects rather than two mounted stores.

This is a placement bug, not a model bug. The mount origin **is** the missile
body centre, so a station chosen by eye lands the body wherever the number says,
including in open air.

### The rule

**A carried round is described by its relationship to the wing skin, and the
station is derived from a measurement of that skin — never typed.**

Three constraints, all of which must hold simultaneously:

1. **Under.** The body's top surface sits `0.10–0.14 m` below the wing skin at
   the station, with a pylon closing that gap. Anything above `0.25 m` reads as
   floating regardless of how correct the number is.
2. **Behind.** The round's **nose is aft of the wing leading edge** at that
   station, and the **tail-fin cluster is at or just behind the trailing edge**.
   That is what makes a 2.85 m body read as slung under a swept wing rather than
   projecting out of it.
3. **Outboard.** The station is on the outer panel, far enough out that the
   nacelle and the tailplane are not behind the round from the chase camera.

### The derivation to implement

Replace the authored `WEAPONS.mounts` vectors with a measurement pass that runs
once, at load, after the F-15 is normalised:

```
for each side s in (−1, +1):
  x        = s · 5.2                                   // outer panel, as measured
  cast a downward ray at (x, +8, z) for z stepping 0.25 m across 0.0 .. 7.0
  keep the contiguous run of hits → that run IS the wing chord at this station
  chordFront = first z with a hit,  chordBack = last z with a hit
  skinY      = mean hit y over the run                 // underside of the panel

  bodyCentreZ = chordBack − MISSILE_LENGTH · 0.34      // nose aft of the LE,
                                                       // fins past the TE
  bodyCentreY = skinY − (bodyRadius + railHeight + clearance)   // clearance 0.12
  mount.position.set(x, bodyCentreY, bodyCentreZ)
```

- `MISSILE_LENGTH` is the normalised 2.85, read from the prototype's measured
  bounds — not the config constant, so a different missile asset still lands.
- `bodyRadius` 0.064, `railHeight` from `WEAPONS.rail.beam`.
- **Log the result**: station, measured chord, `skinY`, resulting clearance. A
  silent geometric derivation that lands in the sea is the exact failure class
  CLAUDE.md §17 warns about, and the log is the only cheap defence.

### The fallback

If the measurement pass finds **no contiguous chord run** at a station (asset
missing, wing geometry unexpected), fall back to the authored vector
`(±5.2, −0.62, 4.55)` — which is the current station with the clearance closed
and the body moved aft — and push `"stores: measured station unavailable"` onto
the load-failure list shown on the developer rail. Never fall back silently.

### The pylon is not optional

The current rail is a beam plus a strut sized from `strut.top`, and with a 0.76 m
gap it was doing the impossible: a 0.75 m strut cannot make a 0.76 m gap look
attached. With clearance at 0.12 m:

```
rail.beam   width 0.15  height 0.09  length 1.40  y = +0.11
rail.strut  width 0.11  length 0.62  top = clearance + beam.y + beam.height/2
```

The strut length now derives from the clearance, so **moving a mount can never
leave a floating round again**. That coupling is the point; do not re-author
`strut.top` as a literal.

The rail is a child of the **mount**, not of the round, so firing hides the round
and leaves the rail on the wing. That already holds — keep it.

### Verification (keep this, it is how the bug was found)

The occlusion check from Stage 03.15 stays, with a tighter reading: cast rays
from nine points along each body toward the chase camera's default position.

- **Previously acceptable:** 8 of 9 clear.
- **Now required:** 6–8 of 9 clear. A round that is *fully* visible is not under
  the wing; a round that is *fully* occluded is not readable. Partial occlusion
  by the wing it hangs from is the correct answer, and the assertion should say
  so.

### Gate

1. Both mounts: clearance under measured `skinY` is within `0.10–0.14 m`.
2. Nose `z` (`centre − 1.425`) is **greater** than `chordFront` at that station
   (nose is aft of the leading edge).
3. Fin cluster `z` (`centre + 1.15`) is **greater than or equal to** `chordBack`.
4. Strut length equals `clearance + beam.y + beam.height/2` to 1e-6 — the
   derived-not-authored assertion.
5. Occlusion 6–8 of 9 per side, symmetric within one ray.
6. Mounts are mirror images: `left.x === −right.x`, equal `y`, equal `z`.
7. The fallback path fires with a stub sampler that returns no hits, and the
   failure list contains the stores entry.

---

## P2. One trigger pull fires two missiles

### What is wanted

A press releases a **pair**, not a round. Both rounds leave, one from each rail,
0.12 s apart, at the same locked target.

### Why a ripple and not a simultaneous release

Two bodies spawning on the same frame at mirrored positions move in visual
lockstep and read as one wide object. `0.12 s` of stagger is below the threshold
where the player counts two events, and above the threshold where the two smoke
trails separate — so it reads as *one salvo of two rounds*, which is exactly the
intent. Do not make it configurable per weapon; it is a presentation constant.

### Configuration

```js
export const SALVO = {
  rounds: 2,       // released per trigger pull
  ripple: 0.12,    // seconds between releases
};
```

Loadout: **4 AIM-9, on four rails.** This is a required part of the change, not a
separate decision. With the current 2-round loadout a salvo is the entire
magazine, so the player has exactly one missile decision per rearm cycle and the
count on the HUD stops meaning anything. Four rounds = two salvos, which is what
makes the stores pips in `HUD.md` H7 worth reading.

Extend `WEAPONS.mounts` to four stations by running the P1 derivation at two
station scales per side (`x = s · 5.2` and `x = s · 4.1`), with the inboard pair
`0.55 m` further forward along the measured chord. If the inboard stations fail
their occlusion or clearance gate, **drop to two rails and `rounds: 2` with a
loadout of 2** — a working pair beats four floating rounds, and the fallback is
recorded on the developer rail (same discipline as a SAM site with nowhere to
stand, CLAUDE.md §13).

### Implementation shape

The salvo is a **queue ticked by the frame loop**, not `setTimeout`.

```js
// main.js
const salvo = { pending: [], target: null };

function tryFire() {
  if (!director.weaponsHot) return;
  if (!targeting.canFire()) { combatHud.flash(targeting.state.currentTarget ? "NO LOCK" : "NO TARGET"); return; }
  if (rounds.count === 0)   { combatHud.flash("AIM-9 EMPTY"); return; }
  if (salvo.pending.length) return;                 // a salvo in progress ignores the trigger

  const n = Math.min(SALVO.rounds, rounds.count);
  salvo.target = targeting.state.currentTarget;     // resolved ONCE, at the press
  releaseOne();                                     // first round on the press frame
  for (let i = 1; i < n; i++) salvo.pending.push(i * SALVO.ripple);

  combatHud.flash(n > 1 ? "SALVO AWAY" : "MISSILE AWAY", "info");
  audio.play(Cue.MISSILE_LAUNCH);                   // ONCE per salvo
}

function tickSalvo(dt) {
  for (let i = salvo.pending.length - 1; i >= 0; i--) {
    salvo.pending[i] -= dt;
    if (salvo.pending[i] <= 0) { salvo.pending.splice(i, 1); releaseOne(); }
  }
  if (!salvo.pending.length) salvo.target = null;
}
```

Five properties, each of which is a bug if you skip it:

1. **`setTimeout` is forbidden.** A timer that survives a crash, a checkpoint
   restore or a mission restart fires a missile out of a respawned aircraft. The
   queue is ticked by the frame loop and is therefore subject to the same
   ownership rules as everything else.
2. **The lock is resolved once, at the press.** Re-reading
   `targeting.state.currentTarget` per ripple round means round two chases
   whatever the reticle drifted onto — which looks like a targeting bug and is
   impossible to diagnose.
3. **The trigger is ignored while a salvo is in flight from the rails.** Not
   queued, not buffered. `rounds.count` is still the authority on ammunition, so
   a partial salvo (one round left) fires one and flashes `MISSILE AWAY`.
4. **One audio cue per salvo.** Two `MISSILE_LAUNCH` takes 0.12 s apart phase
   against each other and land as one loud, wrong noise. `audio.js`'s round-robin
   takes are for repeated events, not for a doubled one.
5. **`clearSalvo()` is called from every place that takes the aircraft away**:
   crash trigger, checkpoint restore, mission restart, mode change, and the
   recovery handoff. It drops pending entries **and** clears the target. Add it
   beside the existing latch-consuming calls, not as a new lifecycle hook.

### What must not change

- `rounds.next()` still picks whichever rail is loaded; `release()` still hides
  that rail's visual. Alternation falls out of the mount order, so the salvo
  visibly empties opposite wings.
- `missile.fire()` is called once per round with that round's own `mount` and
  `side`, so each body gets its own separation impulse and they diverge on their
  own. **Do not add a spread angle** — the separation impulse already does it,
  and an authored spread would fight the guidance solution.
- Guidance, fuze, authority, flares and terrain masking: untouched. A salvo is
  two ordinary rounds.

### Gate

1. One press, 4 loaded, valid lock → 2 live rounds, `rounds.count === 2`, one
   `MISSILE_LAUNCH` play, `flash === "SALVO AWAY"`.
2. Rounds leave **different** mounts with opposite `side` signs.
3. Ripple timing at 60 Hz **and** 20 Hz: the second round exists after
   `0.12 s ± one frame` of simulated time, from the queue and not from wall
   clock.
4. One press, 1 loaded → 1 round, `"MISSILE AWAY"`, no pending entries.
5. One press, 0 loaded → no round, `"AIM-9 EMPTY"`, one cue at most.
6. A press during a pending salvo is a no-op (and the latch is still consumed).
7. Target is captured at press: mutate `targeting.state.currentTarget` between
   the two releases and assert both rounds carry the original target.
8. `clearSalvo()` on crash: with one entry pending, trigger a crash and assert
   zero rounds fire across the whole 2.32 s crash-to-playable window.
9. A salvo that empties the rails starts the rearm timer at empty exactly once.
