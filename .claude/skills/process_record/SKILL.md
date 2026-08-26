---
description: Append a turn to PROCESS_RECORD.md — the append-only log that PROCESS.md's curated moments get picked from. Use at the end of any turn that changed the repo, when the user says "record it" / "record this turn", or when a turn produced a correction, a thrown-away attempt, or a bug worth remembering. Also defines how a record entry gets promoted into PROCESS.md.
---

# Process record

`PROCESS.md` carries a few curated moments. That curation silently discards
everything not chosen — including the corrections, the dead ends and the
near-misses that are the most honest evidence of how the work went.
`PROCESS_RECORD.md` is where all of it lands, so the curation is a **choice made
from a full record** rather than whatever happened to be remembered at the end.

The record is not a second `PROCESS.md`. It is the accumulation `PROCESS.md` is
drawn from, which is why an entry here is written in `PROCESS.md`'s own format:
promoting a moment must be selection and trimming, never reformatting.

## When to append

- At the end of a turn that changed the repo.
- When the user says "record it", "record this turn", or invokes
  `/process_record`.
- When a turn produced no code but produced a **decision** — a spec corrected, a
  conflict named, an approach rejected. Those are entries too.

One entry per conversational turn. Append to the **bottom** of
`PROCESS_RECORD.md`; the file is oldest-first.

## Entry format

Each entry does the four jobs `PROCESS.md` asks of a moment. The headings below
map onto them one-to-one, which is the whole point of the shape.

```markdown
## YYYY-MM-DD HH:MM — <short title naming the thing, not the activity>

**Prompt:**

> the user's prompt, curated down to the load-bearing lines, verbatim where
> quoted. Note mid-turn corrections inline: *"Pls ignore the lens part!"*

**Result:**
What was built, and — the part that carries the mark — the call you made
instead of the obvious one, with the reason it beat the obvious one. Name any
spec line you overrode and why. Derivations belong here: if a number came out
of algebra rather than tuning, show the algebra.

**Verified:**
The check you ran, the viewport you looked at, the number you read off the DOM,
the phase you waited for. What you read *before* accepting the diff — not
"tests pass", but which claim you confirmed and how.

**Commit:** [`5e48816`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/5e48816)

**What happened:**
*Conditional — include only when something went wrong.* What broke, what the
user flagged, what a screenshot caught that the diff could not, what was built
and then thrown away. If the user said something was not good, it goes here in
their terms, not softened.
```

Write `**What happened:**` whenever there is something to say, and leave it out
entirely when there genuinely is not. "Nothing was flagged, but N things" is a
legitimate and common opening — a turn can be accepted and still teach
something.

## Citation rules

The commit link is the one part of an entry that a reader can check, so it is
the part with no discretion in it.

- **Always the absolute GitHub URL**, exactly as written above:
  `[`<7-char sha>`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/<7-char sha>)`.
  This is the form `PROCESS.md` already uses, and `scripts/check-evidence.ts`
  reads the sha out of the **link text**, so an entry pasted into `PROCESS.md`
  passes `pnpm check:evidence` unchanged. A relative `../../commit/<sha>` link
  does not survive the move and must not be used here.
- **Seven characters** in both the link text and the URL. Consistent length is
  what makes a scan of the file readable.
- **One `**Commit:**` line per entry**, at the end, before any
  `**What happened:**`. Several commits for one turn go on that one line,
  comma-separated.
- **A turn with no commit says so:** `**Commit:** none — <reason>`. Never omit
  the line. A missing line reads as an oversight; an explicit `none` is a fact,
  and the reason is usually the interesting part.
- **Cite the work commit, then commit the record separately.** It keeps the
  cited hash pointing at the change being described rather than at the paragraph
  describing it. Practically: finish the work, commit it, read the hash back with
  `git log --format=%h -1`, write the entry, commit the entry.

## Promoting an entry to PROCESS.md

`PROCESS.md` takes three or four moments for an assignment, and fewer for a
weekly prototype. Choose them from this file, and prefer:

- **Corrections that landed in the harness**, not in another prompt — a rule
  added to `CLAUDE.md`, a check wired up, a marker published, an attempt thrown
  away. Re-prompting until it passes is the routine case; changing what the
  agent works against is the skilled one, and it is what the marker is looking
  for.
- **Moments where the check disagreed with the assumption** — a screenshot that
  contradicted a diff, a measurement that contradicted a construction, a lint
  rule that pointed at something worse than it reported.
- **Conflicts you named rather than averaged** — two instructions that could not
  both hold, and the cost you made visible instead of choosing silently.

Prefer these over "built the thing, it worked". The repo can already show what
was built; it cannot show why this way and how you knew.

Promotion is copy, then trim: the citation format already matches, so only the
prose gets shortened. Do not delete the entry from the record when it is
promoted — the record stays append-only.

## Notes on this copy

Written in `comp4020-ass1-jnheinrich451-eng`, carried to
`comp4020-crit4-jnheinrich451-eng`, and carried here — citation URL repointed at
this repo each time. `.gitignore` excludes `.claude/`, so this file is tracked
only because it was added with `git add -f`; it holds no secrets, and it is part
of the harness a marker reads.

**It has now gone missing twice.** A fresh starter repo has no `.claude/`, and
the skill only arrives if someone remembers it exists and goes looking in last
week's directory — which is how both C4 and C5 started. That is a harness gap,
not a memory problem: see the carry-forward sensor in `spec/` for the check that
turns a silent absence into a red one.
