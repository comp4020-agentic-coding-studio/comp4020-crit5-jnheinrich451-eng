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
