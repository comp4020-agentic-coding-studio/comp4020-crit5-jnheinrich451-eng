# build/ — staged build plan

Thirteen stage files. Build in order; each ends in something you can open and fly,
plus a test gate.

`../CLAUDE.md` is the full specification — architecture, world scale, every
subsystem, the invariant list and the definition of done. These files are the
sequence and the per-stage detail.

```
STAGE-1-flight.md       a placeholder shape flying over water
STAGE-2-airframe.md     the real F-15E, Expert mode, pitch convention
STAGE-3-terrain.md      terrain, the grid index, probes, being rewound
STAGE-4-launch.md       the carrier and the solved catapult
STAGE-5-weapons.md      targeting, gun, one missile, a passive drone
STAGE-6-hostile.md      an enemy that fights back
STAGE-7-mission.md      the nine-phase sortie
STAGE-8-ground.md       SAM sites, flares, rearm, game modes, radar
STAGE-9-crash-audio.md  the crash presentation and the audio director
STAGE-10-verify.md      acceptance checklist and three human runs

── after the feature freeze ─────────────────────────────────────────
STAGE-11-models.md      F-16C hostile and a real SAM launcher
STAGE-12-world.md       day/night clock, dynamic ocean, night lights
STAGE-13-comfort.md     warning thresholds, the audio watchdog, pause
```

The game is complete and playable at stage 10, and the freeze holds: **11–13 add
no new systems.** They are model substitutions and presentation.

Do stage 13 last and do not skip it. It contains no features at all, and it is
where the build stops lying about its own state — a warning that fires when the
player cannot act, a loop that reports healthy and plays nothing, and a game with
no way to stop are all things a green test suite will never mention.

## The three stage-1 non-negotiables

Retrofitting any of these is a rewrite rather than an edit:

1. `requestAnimationFrame` scheduled **first** in the frame, body in a
   `try`/`catch`. One thrown frame otherwise ends the session silently.
2. `flight.js` must not import three.js, and `flightState.quat` is a plain
   `{x,y,z,w}` record.
3. Axis keys tracked by `event.code`, and arrow keys are not flight axes.

## Where the schedule risk actually is

Not the flight model:

1. **Terrain queries** (stage 3) — the index is simple, but its failure mode
   (silently reporting no terrain) is invisible until something depends on it.
2. **The crash/respawn handoff** (stage 9) — three owners of the aircraft
   transform, and one stale flag between them strands the player.
3. **Anything with a stored position** (stage 7) — a checkpoint captured in one
   place and restored into different terrain.
4. **Anything with more than one owner** (stage 13) — the engine loop had four
   branches switching it on and off in the same frame, and it cost four rounds of
   misdiagnosis because a media element reports perfect health while playing
   nothing. The pattern generalises: a single-owner rule is cheap to write and
   expensive to retrofit.

## A note on what tests do not catch

Three of the four hardest faults in this project were invisible to assertions:

- a **flat daytime plateau** in a cycle that was working exactly as specified
  (stage 12) — the arithmetic was right and nothing changed on screen
- an **ocean patch edge** that fog was assumed to hide and did not (stage 12)
- an **audio loop with four owners** that reported healthy on every property a
  media element exposes (stage 13)

Each was found by measuring the one signal that distinguishes working from
broken — a colour difference, a fog factor, a clock advancing — and then asserting
*that*. When something looks wrong and every test is green, find the number that
separates the two states before changing any code.
