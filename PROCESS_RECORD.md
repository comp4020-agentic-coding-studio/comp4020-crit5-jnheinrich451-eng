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
