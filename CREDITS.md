# Credits

Operation Vector ships six third-party 3D models and fourteen audio files.
Every shipped model's licence text travels with it in
`public/assets/<name>/license.txt` and is deployed alongside the game.

## Licence summary — read this first

**This project cannot be released commercially, and it must stay share-alike.**

| asset | licence | commercial | share-alike | in the build |
| --- | --- | --- | --- | --- |
| F-15E Strike Eagle | CC-BY-NC-SA-4.0 | **no** | **yes** | yes |
| Ireland Terrain | CC-BY-NC-4.0 | **no** | no | yes |
| USS Dwight D. Eisenhower | CC-BY-4.0 | yes | no | yes |
| AIM-9 missile | CC-BY-4.0 | yes | no | yes |
| NOMADS SAM system | CC-BY-4.0 | yes | no | yes |
| F16-C Falcon | CC-BY-4.0 | yes | no | yes |
| `gun.mp3` (M134, Freesound) | CC-BY-NC-4.0 | **no** | no | yes |
| `flares.mp3` (flare deploy, Freesound) | CC-BY-NC-4.0 | **no** | no | yes |

The audio is listed in full further down; these two appear here because they are
the only sound files whose licences constrain the project rather than merely
permitting it. Everything from Pixabay is unconditional, and seven files from a
soundboard site carry no licence at all — recorded under
[Still open](#still-open-seven-files-from-voicemod-tuna) rather than left to
look settled.

Of the models, the two newest — the SAM launcher and the F-16C — are both plain
CC-BY, so neither tightens anything. Every constraint in this project comes from
three places and no others: the F-15E (`NC` and `SA`), the terrain (`NC`), and
the two Freesound cues (`NC`, plus an attribution that this file provides).

Two consequences worth stating deliberately rather than discovering at ship
time:

1. **Non-commercial.** Both the aircraft and the terrain are `NC`. The
   deployed prototype is coursework and is not a commercial use, but the
   combination rules out any commercial release of this build.
2. **Share-alike.** The F-15E is `SA` as well as `NC`, which the other three
   are not. A modified version — and this is one, since the model is rescaled
   and re-encoded — must carry the same licence. That clause reaches further
   than the non-commercial one: it constrains how the *derivative* may be
   licensed, not just how it may be sold.

## Models

> This work is based on "F-15E Strike Eagle - Fighter Jet - Free"
> (https://sketchfab.com/3d-models/f-15e-strike-eagle-fighter-jet-free-fff7d75490474e9b964d90cc031c8d01)
> by bohmerang (https://sketchfab.com/bohmerang) licensed under CC-BY-NC-SA-4.0
> (http://creativecommons.org/licenses/by-nc-sa/4.0/)

> This work is based on "Ireland Terrain"
> (https://sketchfab.com/3d-models/ireland-terrain-531fb2615ddf449980aecaa8fa592705)
> by Marissa Dudek (https://sketchfab.com/marissadudek) licensed under
> CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)

> This work is based on "USS DWIGHT D.EISENHOWER CVN-69 AIRCRAFT CARRIER"
> (https://sketchfab.com/3d-models/uss-dwight-deisenhower-cvn-69-aircraft-carrier-f22c344e834f4c3781f676b372a94b2d)
> by Muhamad Mirza Arrafi (https://sketchfab.com/nazidefenseforceofficial)
> licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

> This work is based on "AIM-9 missile"
> (https://sketchfab.com/3d-models/aim-9-missile-caaf15b49bac4144b6c6be577c2b872a)
> by RickSlash (https://sketchfab.com/RickSlash) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)

### The two newest

Both are now wired in and deployed: the F-16C is the hostile fighter and the
Nomad vehicle is the SAM launcher, each replacing the primitive that stood in
for it. They ship from `public/assets/f16c/` and `public/assets/sam/`, built by
`pnpm assets` from the untracked sources in `assets-src/`.

> This work is based on "NOMADS SAM system"
> (https://sketchfab.com/3d-models/nomads-sam-system-2f54eb14a7d649b68e196c1835f6a820)
> by Jeyhun1985 (https://sketchfab.com/Jeyhun1985) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)

> This work is based on "F16-C Falcon"
> (https://sketchfab.com/3d-models/f16-c-falcon-4bc2ff75dc584af2afd0aa6bd8b79015)
> by Carlos.Maciel (https://sketchfab.com/Carlos.Maciel) licensed under
> CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

`CLAUDE.md` §2 gives them their normalisation targets: the F-16C to **14.8 m**
length and the Nomad SAM vehicle to **6.9 m**. Neither needed a logic change to
land, only the same treatment every other asset got: measured normalisation,
orientation read from the LOADED object rather than from raw accessors, and a
pass through `pnpm assets`.

The SAM is by far the most expensive thing on the site: its `scene.bin` is
20.3 MB of geometry, more than the terrain and the F-15E together, and six
sites are placed in the world. Textures compress; geometry does not, so `pnpm
assets` takes the whole build only to 37 MB. That is the number to watch if the
crit room's wifi is the constraint — decimating this one mesh is where the
saving is, not in another texture pass.

**Measured before committing to either, and the two are not comparable:**

| | triangles | meshes | textures | materials |
| --- | --- | --- | --- | --- |
| F16-C Falcon | 4,504 | 19 | 3 | 4 |
| NOMADS SAM system | **265,350** | 35 | 33 | 16 |
| *(the whole Ireland terrain, for scale)* | *182,272* | *2* | *2* | *1* |

The F-16 is ideal — 4.5k triangles is cheaper than the cone it would replace
once the cone's smoothing is counted, and three textures is nothing.

The SAM is a different proposition. **One vehicle carries more geometry than
the entire island**, and the design calls for six of them. That is ~1.6 M
triangles against the 216 k the whole scene draws today, plus 33 texture binds
per site. Geometry passes through `pnpm assets` UNTOUCHED — only textures are
re-encoded — so its 20 MB `scene.bin` would ship whole and take the build from
13.5 MB to roughly 34 MB, undoing the entire compression pass and then some.

None of that makes it unusable, but it is a decision rather than a drop-in.
The honest options, cheapest first: decimate the mesh offline before it enters
`assets/`; use it for a hero site or two and keep primitives for the rest; or
accept the download and verify the frame rate on the machine the crit will
actually run on. Worth deciding deliberately — the current build holds 144 fps
under software rendering, and that headroom is what makes it safe on an unknown
laptop.

### Modifications made

All four are **rescaled at load from measured bounds** rather than edited, so
the meshes as shipped are geometrically the originals. The textures ARE
modified: `pnpm assets` re-encodes them to WebP and downscales by role
(baseColor 2048, normal 1024, metallicRoughness 512), and rewrites each glTF's
image URIs to match. See `scripts/compress-assets.ts`.

## Audio

Fourteen files, eleven cues. All fourteen are accounted for; the mapping was
cross-checked against `public/assets/audio/` and nothing is uncredited.

| cue file(s) | source | edited |
| --- | --- | --- |
| `altitude.mp3`, `pull-up.mp3` | [Voicemod Tuna 99654cf9](https://tuna.voicemod.net/sound/99654cf9-301d-4dc2-be89-9696d190d532) | yes |
| `lock-1.mp3`, `lock-2.mp3`, `lock-3.mp3` | [Voicemod Tuna 832d4f48](https://tuna.voicemod.net/sound/832d4f48-9e13-4f2a-93e8-051af86d4b9a) | yes |
| `missile-1.mp3`, `missile-2.mp3` | [Voicemod Tuna bdb78af4](https://tuna.voicemod.net/sound/bdb78af4-7942-4b0a-8357-0649493ba828) | yes |
| `missile-hit.mp3` | [Pixabay — "distant explosion" 90743](https://pixabay.com/sound-effects/film-special-effects-distant-explosion-90743/) | no |
| `missile-launch.mp3` | Pixabay — [missile search](https://pixabay.com/sound-effects/film-special-effects-launching-missile-313226/) | no |
| `engine-start.mp3`, `engine-loop.mp3` | Pixabay — [jet-engine search](https://pixabay.com/sound-effects/film-special-effects-jet-engine-starting-303626/) | yes |
| `flyby.mp3` | Pixabay — [jet search](https://pixabay.com/sound-effects/film-special-effects-fighter-jet-behind-355465/) | no |
| `gun.mp3` | Freesound — ["M134 Minigun Firing" by SoundFX.studio](https://freesound.org/people/SoundFX.studio/sounds/474125/), **CC-BY-NC 4.0** | yes — clipped |
| `flares.mp3` | Freesound — ["06647 flare deploy" by Robinhood76](https://freesound.org/people/Robinhood76/sounds/346214/), **CC-BY-NC 4.0** | no |

The three Voicemod takes were edited into the multi-take cues the mix rotates
through (`LOCK` x3, `MISSILE` x2), and the two engine files were edited into a
start-up and a seamless loop. `gun.mp3` is an 11.3 s recording clipped to a
1.5 s loop. `flares.mp3` is used as recorded — it is a purpose-made flare-deploy
sound and already the right length at 1.2 s.

### Two rows here have conditions attached

**`gun.mp3` and `flares.mp3` are both CC-BY-NC 4.0** — the only audio on this
page whose licences ask for anything. Both carry the same two conditions, and
both are met:

> "You are free to share (to copy, distribute and transmit) and to remix (to
> adapt and modify) as long as you credit the author of the sound and do not use
> the sound for commercial purposes."

- **Credit** — SoundFX.studio for the minigun, Robinhood76 for the flare, each
  named in the table with a link to the original. That naming *is* the
  attribution, which is why it lives in a file that travels with the repository
  rather than in a commit message.
- **Non-commercial** — already true of this project independently: the F-15E
  model is CC-BY-NC-SA, so nothing here was ever releasable commercially. These
  two add no constraint that was not already binding.

Everything sourced from Pixabay carries no such condition: the Pixabay Content
License requires no attribution and permits modification and use in a game. The
creators are named above anyway, because a credits file that names some authors
and not others is a worse document than one that names all of them.

### Why the gun and the flares were re-sourced

Both were soundboard clips before — myinstants — and a soundboard grants no
licence at all. It is built for Discord, not for redistribution, and these files
are committed to this repository and copied into `dist/`, so this project *does*
redistribute them. "Nobody has said no" is not "someone has said yes".

The search for replacements made that concrete rather than theoretical. Two
Voicemod Tuna candidates were checked first and rejected on the evidence of
their own pages: the minigun one is titled "A-10 Thunderbolt GAU-8 sound (War
Thunder)" and its uploader writes "This is the War Thunder GAU-8 sound effect,
not mine", while the flare one is tagged `warthunder`. A documented rip from a
commercial game is a worse position than an undocumented one, not a better one.

The M134 also suits the aircraft better than the GAU-8 did. The GAU-8 is the
A-10's gun; an F-15E carries an M61 Vulcan, and a 7.62 mm rotary is far closer
to that buzzsaw than a 30 mm tank-killer is.

The flare went through one more revision than the gun. Its first replacement was
a Pixabay road-flare recording — unconditionally licensed, but a road flare
IGNITING is a slow, hissing event, and turning it into a dispenser thump took
clipping and a speed-up. The version shipped now is a purpose-made flare-deploy
sound, 1.2 s and used unedited. It costs an attribution line the Pixabay one did
not, and is worth it: an effect that needs no surgery to fit is usually the
right effect.

### Still open: seven files from Voicemod Tuna

`altitude`, `pull-up`, `lock-1/2/3` and `missile-1/2` come from Voicemod Tuna,
which is the same kind of user-upload soundboard as myinstants and grants no
licence either. Read page by page the picture is uneven rather than uniformly
bad, and the difference matters:

- `altitude` / `pull-up` — the uploader describes it as "an F-16 warning found
  on youtube" and disclaims ownership. Known third-party origin.
- `missile-1/2` — "F15 missile warnings to scare your friends playing dcs". No
  source stated and no disclaimer: origin unknown.
- `lock-1/2/3` — no description, no attribution, no disclaimer: origin unknown.

Unknown is not the same as infringing and this page does not claim otherwise.
It is recorded because a credits table that gives a source URL for every file
implies the rights are settled, and for these seven they are not. Replacing them
means finding four voice warnings that still read as cockpit audio, which is a
real search — so this is a deliberate deferral, not an oversight.

## Libraries

- **three.js** (r185) — MIT. Bundled into the build rather than loaded from a
  CDN, so a network failure in the crit room cannot take the site down.
- **vite**, **vitest**, **sharp**, **typescript** — build and test only; none
  ships to the browser.
