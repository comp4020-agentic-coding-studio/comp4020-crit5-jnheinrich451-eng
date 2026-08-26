# staged build plan

Ten stage files. Build in order; each ends in something you can open and fly, plus
a test gate.

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
```

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
