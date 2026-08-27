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

**This section is incomplete and needs your confirmation before submission.**

The fourteen files in `public/assets/audio/` were sourced and renamed before I
saw them, so I can record what they are but not who made them. I am not going
to guess at attributions — a wrong credit is worse than an absent one.

What the working directory suggests, and what still needs checking:

| likely source | evidence | still needed |
| --- | --- | --- |
| Sonniss GDC Game Audio Bundle | `Sonniss.com-GDC2026-GameAudioBundle1of5.zip` … `5of5` alongside the extracted clips | which specific files came from it; the bundle's own licence terms |
| Voicemod | `f-18-lock-on-made-with-Voicemod.mp3`, `f15-missile-warnings-made-with-Voicemod.mp3` | whether these became `lock-*.mp3` / `missile-*.mp3`, and Voicemod's terms for generated audio |
| a freesound contributor | `freesound_community-distant-explosion-90743.mp3` | the contributor's name and the specific CC licence on that ID |
| an individual creator | `derrickmckinnon-jet-engine-starting-303626.mp3` | the platform, the full name and the licence |

The eleven cues and the fourteen files they map to are listed in `CLAUDE.md`
§16. Every cue is optional: the game runs silent if `public/assets/audio/` is
emptied, and the load log reports which cues resolved.

## Libraries

- **three.js** (r185) — MIT. Bundled into the build rather than loaded from a
  CDN, so a network failure in the crit room cannot take the site down.
- **vite**, **vitest**, **sharp**, **typescript** — build and test only; none
  ships to the browser.
