# Operation Vector

A third-person arcade flight game that runs in a browser tab. You are catapulted
off a carrier deck at night, fly out over open water, and take an F-15E through
contested terrain and back out to sea.

**Play it: <https://comp4020-agentic-coding-studio.github.io/comp4020-crit5-jnheinrich451-eng/>**

There is no tutorial, no menu and no briefing. The opening is a scripted
catapult launch that flies itself, and by the time it hands you the aircraft it
has already shown you what the throttle and the burner do.

## What it is

A four-minute authored sortie, plus two sandbox modes that reuse every system in
it. The aircraft, the carrier, the terrain and the missile are real glTF models,
normalised at load from their own measured bounds rather than by a typed-in
scale factor. The terrain is a 30 km heightfield with a uniform grid index over
its ~182,000 triangles, which answers a ground query in ~0.002 ms — about 2500×
faster than raycasting the same meshes, and the reason the game can afford five
collision probes at 60 Hz.

Everything else is the cheapest thing that reads correctly at 200 m/s. The ocean
is summed sine waves, not a simulation. The cannon is hitscan with occasional
tracers, because a 20 mm burst at a believable rate would be hundreds of meshes a
second. The enemy is a small state machine; the difficulty lives in the
missiles, which genuinely track you.

## Stack

Plain JavaScript ES modules and three.js — no framework, no game engine, no
backend. Vite bundles it and GitHub Pages serves it. The flight model
(`src/flight.js`) imports nothing at all, including three.js, which is what lets
the whole rules layer be tested headlessly.

## Running it

```sh
pnpm install
pnpm dev             # local dev server
pnpm check           # typecheck, build, and the full assertion suite
pnpm build           # produce dist/, which is what deploys
pnpm assets          # rebuild public/assets/ from the untracked sources
```

`tests.html` runs the game's own suite in the browser and prints a pass/fail
count — ~1490 plain assertions, no test framework. `spec/vector.test.ts` imports
that same suite so CI gates on the same numbers.

## Repository

| path | what it is |
| --- | --- |
| `index.html` | the game: canvas, overlay layers, developer rail, all CSS |
| `src/` | the modules — world, physics, flight, combat, mission, presentation |
| `src/flight.test.js` | every assertion, framework-free |
| `spec/` | the shipped invariants and this week's contract tests |
| `public/assets/` | the shipping models and audio, built by `pnpm assets` |
| `build/` | the stage plans the build was driven from |
| `CLAUDE.md` | the harness: the spec, the invariants, and why each exists |
| `PROCESS.md` | the moments that mattered, with citations |
| `PROCESS_RECORD.md` | the full append-only record those moments are chosen from |
| `CREDITS.md` | third-party models and audio, and their licences |

`assets-src/` holds the untracked 84 MB of source models and audio. It is
deliberately not called `assets/`: a directory of that name in the repo root is
served at the same URL as `public/assets/`, and vite picks between them by
timing — which once shipped a site where every model 404'd while dev looked
perfect.

## Licence

The code is mine to share; the third-party models are not all
commercial-friendly. `CREDITS.md` has the details — the short version is that
this cannot be released commercially and must stay share-alike.
