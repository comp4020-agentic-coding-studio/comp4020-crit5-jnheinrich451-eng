# DIAGNOSIS — why the CC build does not feel like a fighter

Read against `comp4020-crit5-jnheinrich451-eng/` as delivered. Every claim below
cites the file and line in **their** tree. This document changes no code.

---

## A. The root cause, in one sentence

**Every gate in `CLAUDE.md` is an assertion, and an assertion cannot see an
exhaust plume — so the build is excellent at the half of the spec that is
testable and absent at the half that is looked at.**

That is not a diligence failure. It is an instruction failure, and it is
measurable: of the 30 modules `CLAUDE.md` §3 requires, the three that are missing
are `engine-fx.js`, `vapor-fx.js` and `atmosphere.js` — **the only three whose
entire output is presentation**. Nothing in the gate list goes red when they do
not exist.

Your six complaints sort cleanly along that seam:

| complaint | layer | in the gates? |
|---|---|---|
| no afterburner ring | presentation | no |
| missile has no trail | presentation | no |
| HUD on the deck | presentation | no |
| engine-start does not match the AB push | timing coupling | partly |
| mission NAV wrong | **rules** | yes — and it slipped anyway |
| "not fighter way" overall | presentation | no |

Five of six were invisible to the verification you gave it. The sixth is a real
logic bug that the gates *should* have caught, and §D explains why they did not.

---

## B. Defect by defect, with evidence

### B1. No afterburner, no exhaust, no vapor, no cloud field

`src/engine-fx.js`, `src/vapor-fx.js` and `src/atmosphere.js` **do not exist**.
`CLAUDE.md` §3 names all three with their contents ("exhaust plume, afterburner,
shock diamonds"; "wingtip vortices, load-driven"; "cloud field, humidity,
advisories").

What exists instead is `src/combat-fx.js`, whose header says it covers "the
things `missile.js` and `gun.js` only ever describe as numbers" — missile body,
tracers, gun burst, crash pool. The engine is not in its scope, and nothing else
picked it up. The only surviving reference to the afterburner as a *visual* is a
comment in `aircraft.js:24` about hiding the gear swap inside "the afterburner
flash" — a flash that was never built.

So `state.afterburner` is a boolean that changes a HUD colour
(`combat-hud.js:303`) and a shake multiplier (`launch.js:265`) and nothing else.
At 92% throttle on the catapult, the jet is visually idle.

### B2. The launched missile has no trail

`combat-fx.js:35–39` is the whole missile visual: one mesh, plus one
`PLUME_COLOUR` sprite scaled 3.2 and parked at `z = 2.1`. A tail sprite is a
flame, not a trail. The smoke material at `combat-fx.js:78` is allocated but
consumed **only** by the crash pool (`:149–151`).

`missile.js:8` says "Visuals are the caller's problem" — correct division of
labour, and then the caller never solved it. That comment plus a missing consumer
is the signature of this whole class of miss.

Note what the spec *did* protect: `CLAUDE.md` §14 says the SAM round launches
upward with zero inherited speed "which is what makes its trail read as a ground
launch", and their `flight.test.js:3663` faithfully asserts the *launch
kinematics* of that sentence. The trail the sentence exists to describe was never
built. The test passes. The feature is missing.

### B3. `engine-start.mp3` does not match the spool-up or the AB push

Two distinct causes, both mechanical.

**(i) The deck is never held for audio.** `CLAUDE.md` §9 is explicit: give
`update(dt, hold)` a hold flag, pass `!audio.state.armed`. Their signature is
`launch.js:224 → update(dt, state)`. **There is no hold parameter and nothing
passes an armed flag.** `main.js:1351` bails out of the whole audio director
while unarmed, and the start-up is behind an `engineStarted` latch
(`main.js:1358–1362`), so on a fresh load the catapult sequence runs while the
clip has not started. The player's first keypress arms the director mid-dwell —
or after the shot — and the recording begins from its first note against whatever
is on screen at that moment. §9 predicted this symptom, including the detail that
cycling game mode appears to "fix" it.

**(ii) There is no spool ramp to match.** During the dwell the script writes a
constant `state.throttle = HANDOFF_THROTTLE` (`launch.js:189`, `:203`) and flips
`state.afterburner = t >= plan.burnerAt` (`:205`). The shake ramps 0.02 → 0.16
correctly (`:264`), so the *camera* tells a spool-up story while the throttle
number, the AB state and (per B1) the engine visuals tell none. A recording that
winds up over 11 s is playing against an aircraft that was already at 92% on
frame 1.

The coupling the spec *did* land: `deckDwellFor()` (`launch.js:119`) derives the
dwell from the measured clip, and `flight.test.js:1919` asserts it. The dwell is
right. What happens *during* the dwell is not.

### B4. Mission NAV is wrong — and this one is a genuine logic bug

`mission.js:268`:

```js
{ name: "COAST", x: 0, z: carrierZ - 1100, radius: 1250, cueAltitude: 320, phase: EGRESS }
```

The carrier is at `z = −1600`; COAST sits 1100 m ahead of it with a **1250 m
radius**. The parked aircraft is therefore **inside its own first waypoint** on
frame one. `update()` consumes it immediately (`mission.js:410–416`), `legIndex`
becomes 1, and the nav marker points at INTERCEPT — which is exactly what your
screenshot shows: `INTERCEPT 2.4k` while sitting on the catapult with the phase
cue reading LAUNCH.

Consequences beyond the wrong label: the post-launch climb cue is spent before
the launch, and EGRESS's "intercept waypoint reached" advance is now one leg
closer than authored, so the sortie's opening is skewed for every run.

Two fixes, and you want both:

- **Geometric:** COAST must stand off by at least its own radius plus a margin —
  `z = carrierZ − (radius + 900)`, with an assertion that the *launch start
  anchor* is outside leg 0.
- **Structural:** no leg may be consumed while the launch script owns the
  aircraft. Gate leg consumption on the control handoff (`playerFlies`), so a
  volume placed too close can never again silently eat a waypoint.

This slipped past a very thorough test suite because §10's required assertion was
"INTERCEPT and COASTLINE do not overlap" — a leg-versus-leg check. Nobody was
asked to assert **leg versus the aircraft's start position**, and so nobody did.

### B5. The HUD is fully lit on the deck

This one is mine, not theirs: `HUD.md` specifies *what* the HUD shows and never
says *when it comes alive*, so CC drew it from frame one. It is behaving as
written.

The fighter-way answer: during DECK and LAUNCH the player has no authority —
throttle, stick and weapons are all owned by the script — so every number on the
display is unactionable, and a full instrument set over a parked jet reads as a
menu rather than a cockpit. The HUD should come up **with the aircraft**: dark on
the deck, symbology fading in across ~0.4 s from catapult release, complete by
the handoff. It also buys the launch its own visual identity, which is the moment
the spec calls the most valuable in the build.

### B6. The stack has drifted, and it is a graded claim

`package.json` carries `vite`, `vitest`, `typescript`, `sharp`, `jsdom` and
`packageManager: pnpm@11.9.0`; the entry point is `index.html`; there is a
`spec/*.test.ts` suite and a `vite.config.ts`.

`CLAUDE.md` §0 says, as non-negotiable: no build step, no bundler, no npm, no
`node_modules`, static files only, **`flight-lab.html` is the entry point and runs
as-is**, and `src/flight.test.js` holds plain assertions with no test framework.

They kept `flight.test.js` and `tests.html` — the spec's own gate survives — but
the project around it is now a bundled TypeScript app. Decide deliberately which
way this goes and write it down: either amend §0 to bless Vite (and say why), or
hold the constraint. What you must not do is let it stay ambiguous, because "runs
as-is from a static file" is a claim your submission makes.

---

## C. What CC actually did well — keep this

Worth stating, because the fix should not disturb it: the *rules* layer is
faithful and in places better than the spec. `solveStroke` clamps time and
re-solves exit speed exactly as §9 demands (`launch.js:104–116`). `bandFeature`
uses the weaker flank and `pickZonedFeatures` zones before scoring
(`mission.js:139`, `:165`). The INTERCEPT/COASTLINE non-overlap is enforced by
construction with a computed `needed` gap (`mission.js:255–262`) rather than
asserted after the fact. `deckDwellFor` derives from the measured clip. Parked
mode is a park, not a bypass (`mission.js:397`). The comments record *why*, which
is what §0 asked for.

This is a build with a strong skeleton and no skin.

---

## D. How to control Claude Code so this does not recur

The lesson generalises to one rule:

> **CC optimises for the gate, not the sentence. Any requirement whose gate is
> not in the same medium as the requirement will be met on paper and missed in
> fact.**

Six instructions that operationalise it. Add them to `CLAUDE.md` §0 — they cost
you nothing and they close every miss above.

**D1. Visual requirements get visual gates.** A screenshot at a named time, with
a required-element list. Not "the afterburner is visible" but:

```
FRAME GATES (screenshot, list what is visible, one line each)
  t = 0.5 s   deck, parked: HUD dark, gear down, exhaust glow present, no trail
  t = 10.0 s  pre-fire: AB lit, plume elongated, shake visible, HUD still dark
  t = 11.4 s  stroke: HUD symbology fading in, FOV opened, rig trailing
  t = 15.0 s  handoff: full HUD, gear up, vapor at the wingtips under load
  first missile + 0.3 s: continuous trail ≥ 60 m behind the round
```

CC cannot fake a screenshot list. It is the cheapest instruction in this
document.

**D2. Require a module manifest per stage.** "Report every file `§3` names:
present, absent, or substituted — and for each substitution, which file absorbed
it and which requirements moved with it." Three missing modules would have been
one line in a table instead of a month of feel.

**D3. Ban unclaimed handoffs.** A comment like "visuals are the caller's problem"
must name the caller and the gate that proves the caller did it. Otherwise the
sentence is a licence to skip.

**D4. Make every cross-file coupling an assertion in the smaller module.** You
have at least four: clip length ↔ deck dwell (done, and it held), clearance ↔
strut length, leg radius ↔ start position, throttle ramp ↔ start-up recording. A
`## COUPLINGS` section listing them, each with the file that owns the assertion,
turns invisible drift into a red test.

**D5. State the aircraft-authority table once.** Who owns the transform, the
throttle, the HUD and the weapons in each of: DECK, LAUNCH, PLAYER, CRASH,
RECOVERY. Both the HUD-on-deck miss and the launch-hold miss are authority
questions answered per-file instead of centrally.

**D6. Gate the stack.** "`flight-lab.html` opens from `file://` with no server,
no `node_modules` in the tree, no `package.json` dependency on a bundler" is
three lines and it is either true or false.

And two things to stop doing:

- **Never ask for "polish", "feel", or "make it more fighter-like".** Name the
  artefact and its budget: "a 14-segment ribbon trail, 0.6 s life, additive,
  one shared texture, pooled". CC builds what is countable.
- **Never accept a green count as evidence of a stage.** Ask for the count *and*
  the frame gates *and* the manifest. Their suite is large and honest, and it was
  still blind to five of your six complaints.

---

## E. Fix order

Smallest and most diagnostic first; each is independently shippable.

1. **NAV / leg-zero bug** (B4) — rules-level, ten minutes, and it is currently
   skewing every run's opening.
2. **Launch hold + spool ramp** (B3) — restores the countdown reading that the
   whole opening depends on.
3. **`engine-fx.js`** (B1) — exhaust plume, AB ring, shock diamonds. This is the
   single largest "fighter way" gain per line of code.
4. **Missile trail** (B2) — the second largest, and it is one pooled ribbon.
5. **HUD deck state** (B5) — dark on deck, fades in from the catapult.
6. **Stack decision** (B6) — a paragraph in `CLAUDE.md`, not code.

`vapor-fx.js` and `atmosphere.js` stay unbuilt until 1–5 land. They are the next
tier of the same win, and they are worth nothing while the engine is invisible.

The paste-ready order for CC is `PROMPT-CC-02-FIGHTER-FEEL.md`.
