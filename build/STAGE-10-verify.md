# Stage 10 — Verify, and play it

**Goal:** confirm the build against its own acceptance criteria, then find out what
it is actually like to play.

Prerequisite: stage 9 green.

No new systems. Feature freeze from here: tuning, polish, bug fixing and
submission only.

Stages 11–13 come *after* this one and respect that freeze — two model
substitutions and presentation. Walk this checklist again once they are in; the
additions each carry their own gate, and the last three items below are theirs.

---

## Acceptance checklist

Walk every line. Each is a thing to *do*, not to read.

- [ ] `flight-lab.html` opens and flies with no console errors
- [ ] **No instruction text anywhere** — no control legend on screen, no key list in
      any player-facing document
- [ ] **A stranger reaches an ending inside five minutes without being told
      anything** — the launch runs itself, the cursor steers, the diamond leads
- [ ] **The run can be lost:** five pilots, and running out ends it on the
      `Mission Failed` screen
- [ ] Each death shows the count dropping and dispatches a replacement at 4000 m
- [ ] `tests.html` is green (target ~1400+ checks)
- [ ] The full sortie completes: deck → launch → egress → intercept → defensive →
      terrain → final → extraction → complete
- [ ] **Ignoring all combat still completes the mission** — fly straight through and
      never fire
- [ ] **Missing every waypoint still completes the mission** — fly in a circle and
      let every fallback fire
- [ ] Crashing produces the ~2.3 s presentation and an **automatic** flyable
      respawn: no key press needed, no repeated-explosion loop
- [ ] Crashing over land and over water both respawn at the fixed 4000 m floor —
      verify the post-condition check fires rather than trusting the number
- [ ] `R` recovers at any moment, including mid-crash
- [ ] `T` cycles three working modes; all three fly the catapult; PEACE still kills
      on ground contact and returns you to the deck
- [ ] `G` swaps collision policies live, and detection is identical under both
- [ ] **Terrain masking demonstrably defeats a SAM**: the same geometry flown behind
      a ridge produces no launch, and the site does not appear on the radar either
- [ ] Diving behind terrain defeats a SAM round already in the air
- [ ] Flares decoy a stern-chasing round and do **not** save you from a head-on shot
- [ ] A hard crossing turn defeats an enemy round with no countermeasure at all
- [ ] Holding a lock on the hostile makes it break after ~0.9 s
- [ ] Both magazines refill 20 s after running dry
- [ ] `I` flips the pitch axis and the setting survives a restart
- [ ] `M` switches flight models with no attitude jump; Expert can hold inverted
- [ ] **No mouse gesture produces an *unintended* control input**: hovering on the
      aircraft holds attitude, leaving the window releases the stick, and a held
      key overrides a deflected cursor
- [ ] Tab away mid-turn and back: no stuck axis (and `C` clears one if it happens)
- [ ] The HUD never overlaps the developer rail at 900 px wide
- [ ] Warnings are audible over sustained cannon fire
- [ ] The game runs with `assets/audio/` emptied, and says so in the load log
- [ ] `Esc` pauses and resumes: the world frozen, the audio silent, the scene still
      drawn, and no other key acting while paused
- [ ] The sky is visibly different two minutes after launch, and the ocean has no
      visible edge at any altitude the aircraft can reach
- [ ] The rail names the engine's audio state — `CLICK PAGE` before the first
      click, a climbing clock after it

---

## Then measure three human runs

This is the part no test replaces, and it is the one thing this project could not
do for itself.

Record, for three different players (or three genuine attempts):

```
run 1 — experienced      time, deaths, phases where they hesitated
run 2 — typical          time, deaths, anything they never noticed
run 3 — slower / first   time, deaths, where they got lost
```

**A bot flying straight lines gives you a lower bound on the route, not a
playtest.** The idealised figures are ~2:38 direct and ~2:59 ignoring combat; the
sum of every fallback is 6:32. A real player turns, aims, slows down and dies, so
expect longer — but you do not know how much longer until you watch someone.

### What to actually look for

- **Did they discover steering?** The cursor is the only self-teaching control.
  If a stranger does not find it in the first ten seconds, that is the finding
  that matters most.
- **Did they notice the nav marker?** It was made bright yellow because early
  testers did not.
- **Did they ever press `Z`?** Nothing in the game teaches the flare. The
  countermeasure needing no skill is the one most likely to go unused.
- **Did the gun feel hard or unusable?** Tracking on A/D and W/S is a real skill
  step. If it reads as unusable, widen the effective cone — **do not widen the
  pointer's authority**, and never go back to steering from relative movement.
- **Did they climb after the handoff?** They get the aircraft at ~47 m over the
  sea with the first waypoint at 320 m as the cue. A player who ignores it flies
  the whole egress at wave height.
- **Did TERRAIN feel empty or dangerous?** It is the phase most likely to read as
  filler.
- **Did the crash read as destruction**, or as the aircraft briefly behaving
  strangely? 0.72 s of intact airframe is the number to question.

### If it comes back long

Tune the **trigger radii** and the **two combat floors**. Do not add artificial
waits, and do not shorten the launch — it is the strongest moment in the build.

---

## Submission items

- [ ] **Credit every asset** with title, creator, source URL and licence. Ship
      licence text alongside any CC-BY asset.
- [ ] **Note the non-commercial constraint** if the terrain asset is CC-BY-NC — that
      rules out commercial release, and it is a decision to make deliberately rather
      than discover at ship time.
- [ ] **Credit the audio.** On the reference build these were the only assets with
      no provenance recorded, and it was the last outstanding item.
- [ ] Record the measured performance figures (frame rate, physics query cost, index
      build time) rather than estimates.
- [ ] Record the three run times from above.

---

## Deliberately out of scope

Do not add these while "polishing":

```
landing · mesh fracture · pilot ejection · parachutes · damage subsystem
component health · persistent wreckage · fuel · wingmen · scoring system
music · a second camera rig · a crash state machine · a weather system
an options or settings menu · a reflection camera · a second render pass
```

Every one of these was considered and rejected for a stated reason. If one now
seems necessary, the reason is in the relevant stage file — read it before
building.

Note that **pointer steering is not on this list**: it is required by §7. What is
out of scope is steering from *relative* movement with a synthesised origin, which
was tried, cost six fixes and never worked.
