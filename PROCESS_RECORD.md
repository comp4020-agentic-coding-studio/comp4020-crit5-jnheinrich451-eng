# Process record

The raw, append-only history that `PROCESS.md`'s few curated moments get picked
from. Oldest first. See `.claude/skills/process_record/SKILL.md` for the format.

---

## 2026-08-27 04:36 — The C5 brief, and four models in four unit systems

**Prompt:**

> Hey CC, lets begin our crit5 game work, before everything begin, please run
> checks, and know the instruction: `/comp4020:handbook`. And then we can start
> on our building

Mid-turn, asked to choose a mechanic and a fidelity level, the answer was to
take neither option: *"I will tell you later, it is all, including taking off, a
simple mission sequence, a free flight, attack missile and machine gun."* and
*"I tell you later!"*

**Result:**
Ran both gates, pulled the C5 spec off the course API, and probed the four
staged glTF models before writing any game code. `three@0.185.1` added.

The call that was not the obvious one: **I raised the no-tutorial conflict once,
then built to the answer rather than re-litigating it.** C5's spec says "no
instructions anywhere" and "a stranger reaches an ending inside five minutes";
flight controls are close to the worst case for both, and the requested scope is
takeoff → mission → free flight → missiles → guns. Naming the cost once is the
job; averaging the brief down to a carrier-landing minigame because it tests
better would have been substituting my scope for the user's. The seam that makes
it survivable is that **a jet HUD is diegetic instrumentation, not instructions**
— a target box, a lock reticle, an airspeed tape and a PULL UP callout are
things the real airframe has, so they teach without a word of tutorial. That is
now the design constraint rather than a nice-to-have.

Second call: **probe the assets before trusting them.** Parsing the four
`scene.gltf` files as plain JSON and reading the `POSITION` accessor min/max
gives real bounds with no renderer and no download. It found something a build
would have surfaced only as "the carrier is invisible and the jet is a speck":

    AIM-9         2.0 units long  → real 2.85 m   ≈ ×1.4   (metres)
    F-15E       194.1 units long  → real 19.43 m  =  ×0.1   (decimetres)
    Eisenhower 1061.8 units long  → real 332.8 m  ≈ ×0.31
    Ireland     797157 units      → real ~486 km  ≈ ×0.61  (vertical exaggerated)

Four models, four unit systems, and the carrier's long axis is **Y, not Z**. The
derivation is just each model's real-world dimension over its bounding box, but
it is what lets the flight model be written in honest m/s instead of tuned
numbers — and a flight model in real units is the difference between a jet and a
mouse cursor. Normalisation to metres happens once, at load.

Third call: **did not commit the 47 MB of assets.** Git history is permanent,
and this repo seeds six pod repos for the riff. The compression decision is the
user's and is still open, so the originals stay untracked until it lands. An
irreversible act was left undone rather than guessed at.

**Verified:**
`pnpm check` green — typecheck, build, 17 tests across 2 files. `pnpm
check:evidence` red with exactly the four expected fresh-repo failures (missing
`reflections/crit-5.md`, template comment in `PROCESS.md`, two placeholder SHAs
`a1b2c3d`/`e4f5a6b` that do not resolve) — read, not assumed to be breakage. The
probe reported `extensionsRequired: []` on all four models, which is the claim
that three.js's stock `GLTFLoader` needs no extra decoder; 234k triangles total
across the set is the claim that the weight problem is textures, not geometry
(35 MB of the 47 MB is seven image files, the worst a 10.1 MB
`metallicRoughness` map that carries no visible detail).

**Commit:** [`c5ce64b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/c5ce64b)

**What happened:**
Nothing was flagged, but the fidelity and mission questions were both deferred
rather than answered, so the turn ends with the scope known and the shape not.
Work that depends on neither — flight model, input, camera, HUD, state machine
— is what is safe to start; anything that bakes in a texture budget is not.

---

## 2026-08-27 04:52 — The skill that goes missing every week

**Prompt:**

> Ty, and could you check the `/process_record`? A skill, if you cannot find it,
> you can find in maybe `.claude/crit4`, it is about a prompt and key event
> recording!

**Result:**
Found it at `.claude/skills/process_record/SKILL.md` in the C4 repo (and its
origin in ass1), carried it here, repointed both citation URLs at
`comp4020-crit5-jnheinrich451-eng`, and started this file.

The uncomfortable part is in the prompt itself: *"if you cannot find it"*, and
*"maybe"*. The skill's own provenance section says it was carried forward once
already, and C4's record has an entry titled "Finding the skill that already
existed". **That is the same failure three weeks running**, and the obvious
response — copy it again, note it again — is the routine one. `.gitignore`
excludes `.claude/`, so the skill survives only via `git add -f`, and a fresh
starter repo begins with no `.claude/` at all. Nothing anywhere goes red when it
is absent; it is found by someone remembering it exists. Recorded in the skill's
provenance as a harness gap rather than a memory problem, with the fix named:
a sensor in `spec/` that fails `check` when a carry-forward artefact is missing.
Diagnosis committed now, sensor proposed rather than added unasked.

Separately, and not what was asked for: **the repo's secret-scanning pre-commit
hook was not running.** `package.json`'s `prepare` script sets
`core.hooksPath=.githooks`, and during `pnpm install` it printed "The system
cannot find the path specified" and exited through its own `|| true`, so the
failure was silent and `git config core.hooksPath` came back empty. Every commit
in this repo would have skipped the API-key scan. Set by hand.

**Verified:**
Staged a file containing `sk-` followed by a 20+ char mixed-case string and ran
a real `git commit`: blocked, with `.hooktest.ts:1` named. That is the hook
firing on live input, not the config value being read back — the config was
empty a minute earlier and reading it again would only have confirmed my own
write. Test file unstaged and deleted; `git status` clean apart from the
untracked `assets/`. Skill copy checked for stale `crit4` references: none, two
`crit5` URLs present. `git ls-files .claude/` confirms the force-add took.

**Commit:** [`d09cf6a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/d09cf6a)

**What happened:**
The hook find was luck, not method — I only looked at `.githooks/` because I
wanted to know what would run when I committed. A silent `|| true` in a
`prepare` script is exactly the shape of failure the proposed sensor is for, and
it argues the sensor should check *live git config*, not just file presence: the
hook file was there the whole time and proved nothing.

---

## 2026-08-27 06:26 — Operation Vector, stages 1 and 2

**Prompt:**

> Good, it is Operation Vector, you can check the Claude.md, on section 2
> Assets, we normalize to let them reconcile in a world, and the f-15 is
> relatively big than reality, but no worry, it is okay! And I upload stage 1-4
> into the instructions, please work on them first!

**Result:**
Stage 1 (world, flight model, input, chase rig, frame loop, suite) and stage 2
(the F-15E, EXPERT mode, the pitch convention). 119 checks green.

**Named a conflict rather than averaging it.** `CLAUDE.md` §0 asks for no build
step, no npm and three.js from a CDN import map; the repo's deploy job runs
`pnpm build` and uploads `dist/`, and `spec/invariants.test.ts` walks every
built page. Those cannot both hold. §0 marks the stack constraints
`__Adjustable__`, so vite stays and three.js is bundled — a no-build site never
reaches Pages at all, which fails C5 spec line 1 outright, and a CDN is a
single point of failure in a crit room where the pod plays it cold. The game is
`index.html` rather than `flight-lab.html` for the same reason: the Pages root
URL should be the game, with no click in front of it.

**Derived the arcade constants instead of tuning them.** §14 states its
fairness claim in turn radii — enemy rounds turn at 904–1146 m and "a hard
crossing manoeuvre defeats them with no countermeasure at all" — so the turn
constant comes out of that claim rather than out of feel:

    r = v^2 / (G tan b)   ->   G = v^2 / (r tan b)
    G = 250^2 / (1000 * tan 70 deg) = 22.75 m/s^2

Real gravity gives r = 2319 m there and loses the claim. The consequence is
that radius falls with speed — 462 m at cruise, 194 m at minimum — so slowing
down turns tighter, which is a real skill a player can find without being told.
That matters for a no-tutorial brief.

**One sink law for both flight modes, written on the lift direction.** The
obvious form is `cos(bank)`, which works until EXPERT can pass 90 degrees:
`cos(180 deg)` is negative, so an inverted aircraft would CLIMB by rolling
over. Written on the aircraft's up-vector instead, level is 1, the bank limit
is `cos 70 = 0.342` and reproduces the same 17.3 m/s turn cost, and inverted is
floored rather than sign-flipped.

**Verified:**
`pnpm check` green (27 vitest tests) and the game's own suite 119/0. But the
load-bearing verification was headless Chrome over CDP, driven with a
zero-dependency script — `pnpm check` can tell you the modules parse, not that
the page runs. It read off the live page: cruise 170 m/s, altitude held at 900,
course running toward -Z, `quat` a plain record with `typeof quat.copy ===
"undefined"` in the real bundle (§17.1 holding in the build, not just in the
test), FOV 64.14 exactly matching the speed-scale, and the gear sequence
up -> down -> cached-repeat -> up read off the live scene graph.

Two faults only the browser could show. Both shaders failed to LINK while
`pnpm check` stayed green, the page threw nothing, and the screen was blank:
`<logdepthbuf_vertex>` calls `isPerspectiveMatrix()` from `<common>`, which I
had not included, and `<fog_vertex>` reads a variable that must be named
`mvPosition`, which I had called `mv`. And a screenshot showed a hard grey seam
along the whole horizon that no assertion would ever have caught — the sky dome
was being darkened below eye level, while the ocean plane's far edge sits about
a degree BELOW eye level from 900 m, so fogged water met darkened sky.

**Commit:** [`6bff0a8`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/6bff0a8), [`04156a1`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/04156a1)

**What happened:**
The aircraft flew knife-edge, and the way I got there is the part worth
keeping. I read the glTF's raw POSITION accessors, saw 194.1 x 130.6 x 51.0,
concluded Z-up with +X out of the nose, and built a rotation from it. The
accessors are per-MESH local space, and every node in that file carries a
`matrix` — which my probe printed as "no transforms" because it only looked at
`rotation`, `scale` and `translation`. GLTFLoader applies those matrices, so
the model was already Y-up and my correction was computed against axes that no
longer existed.

The tempting fix was a corrected constant. Instead the orientation is now
MEASURED off the loaded object — the HUD node says which way is forward, the
gear-down node says which way is down — and it is backed by a shape check that
fails the load if the wingspan does not land on X. A real F-15E is 13.05 m
across, so that number is known independently of anything this code did, and it
is precisely what knife-edge gets wrong. §2 says never to hand-type a scale;
the same argument applies to orientation, and I had to fly it sideways to see
that.

Also found by accident, and not what was asked for: the repo's secret-scanning
pre-commit hook still was not running from the earlier turn's fix on a fresh
`pnpm install`, and the `assets/` directory the user staged is 46 MB. It is
copied into `public/models/` so the loaders work, and gitignored pending the
fidelity call, because that commit is the one step here that cannot be undone.

---

## 2026-08-27 09:44 — The pipeline closed, and stages 3 to 6

**Prompt:**

> Good, lets finish the pipeline, and fix the holes! Then Stage 5 and 6.

Preceded by *"lets add the terrain, and the aircraft carrer in stage-4 launch"*
and, on the marking environment, *"it is not real deployed on a phone, it is
like Chrome F12 show mobile interface, so all operate on PC."*

**Result:**
Stages 3 (terrain, grid index, probes, collision policy), 4 (carrier and
catapult), 5 (targeting, guns, one missile) and 6 (the hostile, the threat
monitor, damage) — 132 checks to 479.

**The pipeline hole was that nothing deployed.** `public/models` was gitignored
pending a fidelity call, so a Pages build would have served the game with no
terrain, no carrier and a placeholder box: the asset-failure fallback working
exactly as designed, on a site where nothing had failed. `pnpm assets` now
builds the shipping copies, sizing each texture by what it is FOR rather than by
one blanket factor — 2048 for baseColor, 1024 for normals, and 512 for
`metallicRoughness`, which is a DATA map carrying no detail an eye resolves at
200 m/s. 47.30 MB → 13.49 MB, 6.8 MB gzipped, and side by side the deck markings
and airframe panel lines are indistinguishable. Sources stay untracked, so a
re-encode is a rebuild rather than a second permanent copy in every clone.

**Two scale decisions where the spec could not be satisfied literally.** §5 asks
for terrain 30 km across AND a ~643 m peak, and this asset gives neither under
one factor: shrinking Ireland's 486 km to 30 km flattens its relief by the same
16× and leaves a 292 m peak with nothing to hide behind. Relief is not
decoration — §13's SAM mechanic *is* line-of-sight and §10 surveys passes
between flanks — so the horizontal scale comes from the 30 km target, the
vertical from the 643 m one, ×2.20, both measured and the ratio logged. And §9's
carrier: the deck plane is found by histogramming the AREA of up-facing
triangles by height, because the bounding-box top is the mast, not the deck.

**Verified:**
`pnpm check` green throughout; the game's suite 479/0. The load-bearing checks
were the produced measurements rather than the assertions: the terrain index
benchmarked at **2413× faster than `THREE.Raycaster` with 59/59 agreement within
0.5 m**, against §8's quoted ~2500×, and its 8.8 MB against §8's quoted ~8.9 MB.
The catapult solves T = 199.68 / (8 + 144/2.25) = 2.7733 s from the closed form,
and the suite asserts a 20 Hz frame reaches the same release point as a 60 Hz
one to 1e-6.

**Commit:** [`f09c8ef`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/f09c8ef), [`e7a66ac`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/e7a66ac), [`48dd3b0`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/48dd3b0), [`725fd59`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/725fd59), [`f371882`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/f371882)

**What happened:**
**The same bug twice in one hour, which is the part worth keeping.** `normalise()`
recentred every asset on its bounding box. For the terrain that moved sea level
to the middle of the box, so the coast measured 321 m up a hillside and the
samples reported "land" three kilometres out to sea. I fixed it, and an hour
later the carrier's flight deck measured at **y = −8** — below the sea it floats
on — because a hull's bounding box runs keel-to-masthead and its middle is
underwater. Recentring is now per-axis, and the comment on the option names both
failures, because the shape of the mistake is not "I got a number wrong" but "a
bounding box centre is not a semantic origin".

Also: the raycaster agreement check reported **0/15 and "raycaster missed 45"**,
which reads exactly like the broken index stage 3 warns about. The index was
fine. The terrain is shifted into place after its triangles are snapshotted, and
`THREE.Raycaster` reads `matrixWorld` — so the benchmark was comparing two
different worlds rather than two algorithms. Stage 3 says that check is the one
that catches a broken index; it caught a broken benchmark, which is the same
value for a different reason.

And three test failures that were all *my tests* rather than the code: a rewind
target compared against an aircraft I never flew, a fuze given one frame to
close 8 m at 5 m per frame, and a "dead zone holds attitude" claim that
contradicts ASSISTED self-centring by definition.

## 2026-08-28 01:59 — The deployed site was never the site that worked

**Prompt:**

> check the spec from the /comp4020:handbook, and check the repo and see if can
> run in the local server.

then, on being shown what was broken:

> Yes please, and I think you can use flight-lab to replace the index.html. Oh
> and for public and assets, the assets are the new one, I added two models
> F-16c and Sam. Yes please fix them.

**Result:**
Three blockers, all of the same shape: **the thing that worked locally and the
thing that ships were different objects.**

*One page, not two.* `flight-lab.html` and `index.html` both loaded
`src/main.js`, but the canvas was `#stage` in one and `#view` in the other, so
the Pages ROOT threw `Cannot read properties of null (reading 'width')` inside
three.js on its first frame while the page nobody linked to ran perfectly.
`index.html` was missing 34 of the 38 element ids `main.js` now reads. Fixed by
deleting the duplicate rather than repairing it — the divergence *is* the
defect, and PROCESS_RECORD already recorded the decision that the game should be
`index.html` "with no click in front of it". The link-preview head block moved
across with it, and all eight `CLAUDE.md` references were repointed.

*One file per URL.* `src/` had been repointed at `assets/<name>/scene.gltf`,
which dev served from the untracked 84 MB source tree — and the build, which
copies only `public/`, shipped a site where all six models 404'd to placeholder
boxes. The root cause is worth stating precisely, because it is not "someone
forgot to run the pipeline": a directory named `assets/` in the repo root and
`public/assets/` are served at **the same URL**, and vite snapshots `public/` at
boot, so `/assets/audio/gun.mp3` served the *public* copy while a probe file
created after start-up served the *root* copy. Same URL, two different bytes,
decided by timing. So the source tree is now `assets-src/` (ignored wholesale,
never served) and `public/assets/` is the only thing behind that URL. The
pipeline auto-discovers model directories instead of carrying a rename map, and
`rm`s its output first — a stale `public/models/` had shipped for days after
`src/` stopped asking for it, because a directory that still serves reports
nothing.

*The headless gate had rotted through three layers.* `spec/vector.test.ts`
imports the game's suite so CI and the browser read the same numbers. It was
failing on `location is not defined`, then `document is not defined`, then
`getContext("2d")` returning null under jsdom, and underneath all of it
`flight.test.js` no longer exported the `run()` the spec imports — caught by
`tsc`, not by the tests. **Chose one place over nine.** Nine modules paint a
sprite texture at construction; the first instinct was to guard each call site,
and that was written and then reverted, because it puts nine branches in shipped
code that exist only for a test environment. The environment is the harness's
problem: `spec/headless-canvas.ts` stubs the 2D context under a jsdom
environment. §17.13 says a double that diverges tests nothing — the divergence
here is bounded and stated: the nine sites use exactly three methods between
them (`createRadialGradient`, `fillRect`, a `fillStyle` assignment, plus
`addColorStop`), every one is painting, and not one assertion in the suite reads
a pixel.

Also corrected `CREDITS.md`, which claimed the SAM and F-16C were "credited but
not yet in the build" — they now ship, so that was a false licensing statement.

**Verified:**
Not "it builds". `pnpm check` green — typecheck, build, 3 suites, 27 tests. The
game's own suite read **1447 checks passed** off the DOM of the *built*
`tests.html`, served from `dist/` over HTTP, not from source. The built game
page was loaded in headless Chrome and its console grepped for
`placeholder|FAILED|404|Uncaught`: **no matches**, where the same grep before the
fix returned six lines naming every model. `#loading` and `#asset-note` both
came back `hidden`. Then the part that was the actual point: `md5sum` of four
assets fetched from the dev server and from the built site — `scene.gltf` for
the F-15 and the SAM, a terrain texture, and `gun.mp3` — **identical on all
four**, which is the invariant the `assets-src/` split exists to create.

**Commit:** [`f335a03`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/f335a03), [`b8bde4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/b8bde4a)

**What happened:**
Four things, and the first was mine.

**I read a truncated listing as data loss.** `mv assets assets-src` failed with
`Permission denied`, and `ls -la assets | head -3` printed `total 12`, `.`, `..`
— which I reported as the directory having been emptied. It had not: `head -3`
cut the listing at three lines and 84 MB was sitting there untouched. A pipe I
wrote myself produced the evidence I then believed. The real cause was a Windows
handle on one subdirectory, and moving the children individually cleared six of
seven, then `ireland`'s contents moved file-by-file while its now-empty
directory stayed locked for another few seconds.

**Rebuilding exposed failures the stale `dist/` had been hiding.** The first
`pnpm test` showed the invariants passing; they were reading a `dist/` built
before the divergence. A fresh build produced 13 failures — `audio-probe.html`
and `tests.html` with no description, card, viewport, landmark or `h1`. These
were already red in CI and had nothing to do with this turn's edits. `tests.html`
got the furniture it should always have had; `audio-probe.html` is a scratch
diagnostic and was excluded from the build instead of being dressed up as a page
it is not.

**The new `h1` collided with an existing one.** Adding `<h1>Operation Vector</h1>`
to the loading screen made two, because the developer rail's panel already had
one. The rail's is subordinate to the page, so it became `h2`.

**The site is 37 MB, and one file is 20 MB of it.** `sam/scene.bin` carries more
geometry than the terrain and the F-15E together, and six sites are placed in the
world. Textures compressed 57%; geometry does not compress. Recorded in
`CREDITS.md` rather than silently accepted — the brief gives a stranger five
minutes, and a cold load on crit-room wifi spends some of it.

**Still red, and not touched:** `pnpm check:evidence` fails because `PROCESS.md`
is still the template boilerplate with placeholder commit hashes. That is spec
line 6 and it is the user's to write.


## 2026-08-28 02:34 — Two waypoints vanish, and only one of them was a bug

**Prompt:**

> No worry, the process.md I can fill in the end. [...] the sam it has many
> state in the model, but we only use it to provide appearance [...] with or
> without this sam actually is fine for the whole picture of the game [...] but
> we have this sam, then we keep it. Yes you can commit first. And a bug I find,
> the fourth checkpoint NAV VALLEY, when I approach it, without reaching it, and
> I get hit by SAM. And after revival the next target jumps to last NAV
> RECOVERY, the final stage. The intermediate NAV RIDGE, NAV SEAWARD all jumped.
> Please diagnose it!

**Result:**
Committed the backlog in three pieces (`f335a03`, `b8bde4a`, `a59aea6`), then
diagnosed the nav skip. It needed two things to be true at once.

**GEOMETRY.** Terrain legs are SURVEYED from the height field, 1.2–10.5 km
inland. SEAWARD is AUTHORED at a fixed `seawardBack` 2000 m inland. Nothing
reconciles the two, so how close they land is left to the terrain. Measured on
the shipped mesh:

    TERRAIN/PASS <-> FINAL/SEAWARD   1517 m apart, SEAWARD's radius is 1600

PASS's centre is inside SEAWARD's volume, with 83 m to spare. §19 already
demands exactly this assertion for one pair — INTERCEPT and COASTLINE, "if they
touch, entering the intercept area instantly satisfies *reached the next
region*" — and the reasoning was never generalised. The pair that bit was a
different one.

**TELEPORT.** `respawnFromCrash` backs the aircraft 1800 m along its heading of
travel, which from a death between PASS and VALLEY lands it inside SEAWARD.
Nothing fires, because only the CURRENT phase's leg is ever checked. Then
TERRAIN's 98 s fallback expires, FINAL is entered, and its one leg is satisfied
on the entry frame by a position the player never flew to. `legDone` goes true
and EXTRACTION follows in the same frame. RIDGE was lost to the fallback,
SEAWARD to the overlap — both gone before the player saw either.

**The fix is scoped to PLACEMENT, not to phase entry**, and that distinction is
the whole of it. Credit is suspended for a volume the aircraft was *put* inside,
until it has flown clear of where it was put. Being inside a leg when its phase
begins is normal and correct: on a clean run the player is already inside PASS
when TERRAIN starts, because they spent DEFENSIVE flying to it.

`routeOverlaps()` generalises §19's check, and main.js logs contained pairs at
load — a surveyed route's geometry is not knowable until the terrain loads, so
it can only be reported at runtime, never asserted at build time.

**Named the cost rather than hiding it:** the geometry collision is still there.
It is now harmless, and it is now *visible* in the log, but PASS and SEAWARD
still share airspace. Re-deriving SEAWARD from the surveyed legs was offered and
declined for this pass, so the route keeps a fault it can survive.

**Verified:**
A repro before a fix, not after. `src/mission.js` imports nothing, so the
director runs standalone in node: drove it to TERRAIN with PASS behind it, killed
the player 2 km short of VALLEY, applied `respawnFromCrash`'s own retreat, and
read the transitions back. Before:

    t=111.1 FINAL      leg0 NAV=SEAWARD
    t=111.1 EXTRACTION leg0 NAV=RECOVERY      <- same timestamp

After: SEAWARD holds for 42 s and EXTRACTION arrives at t=153.2 on FINAL's own
fallback. The control run — same route, no death — is **byte-identical before
and after**, which is the bar the first attempt failed. Then the real browser on
the real terrain survey, which is where the 1517 m came from: the game's own new
warning line. Browser suite 1447 → 1464 checks, all green; `pnpm check` green.

**Commit:** [`f335a03`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/f335a03), [`b8bde4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/b8bde4a), [`a59aea6`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/a59aea6), [`fdead5d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/fdead5d)

**What happened:**
**I recommended a fix that would have broken the game, and the user picked it on
my description.** The option I wrote said arm-on-exit "fixes the whole class
regardless of route geometry". It does not: applied at phase entry it stalls the
clean run, because the player is legitimately inside PASS the moment TERRAIN
begins, so requiring an exit means overflying the waypoint and doubling back —
worse than the bug being fixed. I found it while writing the code, said so, and
narrowed the trigger to placements. The control run is what would have caught it
regardless; the point is that the recommendation went out before that run
existed.

**My reconstruction of the route was wrong by a factor of two.** I derived PASS's
position from the SAM sites the game had logged and got 696 m to SEAWARD. The
real figure, once the game measured it, is 1517 m. Same conclusion — contained
either way — but I had stated 696 m as a measurement when it was an inference,
and the test fixture built on it is now labelled as the synthetic stand-in it
always was.

**Two of the new tests were wrong on the first run, and the failure detail added
in `f335a03` is what named them.** `legDone` reads false again one line after a
leg is satisfied, because entering the next phase recomputes it against that
phase's legs — the assertion moved to the `leg` event, which records the fact
rather than the status. And route-wide containment is the wrong bar: RECOVERY
sits 200 m from COAST and contains it outright, which is harmless because they
are four phases apart. Scoped to phases adjacent in `PHASE_ORDER`.

**Still red, still the user's:** `pnpm check:evidence` — `PROCESS.md` is
boilerplate. They have said they will write it at the end.
