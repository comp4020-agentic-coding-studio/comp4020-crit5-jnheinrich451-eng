# Credits

Operation Vector ships four third-party 3D models and fourteen audio files.
Every model's licence text travels with it in `public/models/<name>/license.txt`
and is deployed alongside the game.

## Licence summary — read this first

**This project cannot be released commercially, and it must stay share-alike.**

| asset | licence | commercial | share-alike |
| --- | --- | --- | --- |
| F-15E Strike Eagle | CC-BY-NC-SA-4.0 | **no** | **yes** |
| Ireland Terrain | CC-BY-NC-4.0 | **no** | no |
| USS Dwight D. Eisenhower | CC-BY-4.0 | yes | no |
| AIM-9 missile | CC-BY-4.0 | yes | no |

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
| `missile-launch.mp3` | Pixabay — [missile search](https://pixabay.com/sound-effects/search/missile/) | no |
| `engine-start.mp3`, `engine-loop.mp3` | Pixabay — [jet-engine search](https://pixabay.com/sound-effects/search/jet-engine/) | yes |
| `flyby.mp3` | Pixabay — [jet search](https://pixabay.com/sound-effects/search/jet/) | no |
| `gun.mp3` | myinstants — [A-10 search](https://www.myinstants.com/en/search/?name=a10) | no |
| `flares.mp3` | myinstants — [flares search](https://www.myinstants.com/en/search/?name=flares) | no |

The three Voicemod takes were edited into the multi-take cues the mix rotates
through (`LOCK` x3, `MISSILE` x2), and the two engine files were edited into a
start-up and a seamless loop.

### Two things still open on this table

**Six files point at a SEARCH PAGE rather than a specific asset.** A search URL
does not identify a work or its creator, and the course asks for title, creator,
source URL and licence per asset. Still needed:

- from Pixabay: `missile-launch`, `engine-start`, `engine-loop`, `flyby` — the
  asset URL carries the uploader's name, so these should be quick to recover
  from browser history
- from myinstants: `gun`, `flares`

The other eight files — three Voicemod sounds and `missile-hit` — already point
at a specific work and need nothing further.

**myinstants is the one worth a second look.** Pixabay's Content License is
permissive and Voicemod Tuna's uploads are intended for reuse, so those rows are
low risk. myinstants is a user-upload soundboard with no per-clip licensing and
a lot of its content is ripped from games and films — an A-10 cannon and a flare
dispenser are exactly the kind of clip that tends to be. This repo goes public
and gets deployed, so it is worth either finding those two on Pixabay instead or
deciding deliberately to keep them. Confirm the terms rather than taking this
paragraph as the finding.

## Libraries

- **three.js** (r185) — MIT. Bundled into the build rather than loaded from a
  CDN, so a network failure in the crit room cannot take the site down.
- **vite**, **vitest**, **sharp**, **typescript** — build and test only; none
  ships to the browser.
