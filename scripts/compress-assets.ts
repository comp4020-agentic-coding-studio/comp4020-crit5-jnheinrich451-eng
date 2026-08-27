// Build the shipping assets from the sources. CLAUDE.md §2.
//
// The sources are 84 MB, most of it in texture files. That is not a repository
// problem so much as a CRIT ROOM problem: the pod opens the deployed URL cold
// on shared wifi, and a player staring at a loading screen has already lost
// part of the five minutes the brief gives them.
//
// WHY THE SOURCE TREE IS `assets-src/` AND NOT `assets/`
// -----------------------------------------------------
// It used to be `assets/`, next to a derived copy under `public/assets/`. Both
// are served at the SAME URL -- vite mounts `public/` at the site root, and the
// root `assets/` directory is already there -- so `/assets/audio/gun.mp3` had
// two files behind it and no rule saying which won. Measured, it was neither,
// consistently: vite snapshots `public/` at boot, so a file that existed at
// start-up served the PUBLIC copy while one created later served the ROOT copy.
// The same URL, two different bytes, decided by timing.
//
// That is what hid the bug this script now prevents. src/ was repointed at
// `assets/<name>/scene.gltf`, dev served it from the root source tree and
// looked perfect, and the build -- which copies only `public/` -- shipped a
// site where all six models 404'd and every airframe fell back to a placeholder
// box. Dev was green on files the deploy never had.
//
// So: `assets-src/` is SOURCE, untracked, never served. `public/assets/` is
// OUTPUT, committed, and the only thing behind that URL in dev and in the
// build alike. One URL, one file, dev and prod byte-identical.
//
// Nothing here is a judgement about how the game should look. Each texture is
// resized by what it is FOR:
//
//   baseColor          the only map a player actually looks at -> 2048, WebP
//   normal             surface detail, still visible at speed -> 1024, WebP
//   metallicRoughness  a DATA map: roughness in G, metalness in B. It carries
//                      no detail an eye can resolve, and at 19.4 m across at
//                      200 m/s nobody is reading its gradients -> 512
//
// Run with `pnpm assets`. The originals stay untracked in assets-src/, so this
// is re-runnable and reversible; only its output is committed.

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import sharp from "sharp";

const SOURCE = "assets-src";
const OUT = "public/assets";

// Audio ships byte-for-byte. CLAUDE.md §16 pins these paths -- "the paths ARE
// the whole interface" -- and re-encoding a cue would change what the mix was
// balanced against, so this directory is copied, never processed.
const VERBATIM = new Set(["audio"]);

// No source -> shipped rename map any more. The source directories are already
// the short, stable names the URLs in src/ use (f15, f16c, carrier, ireland,
// aim9, sam), so a model is added by dropping it in and re-running -- there is
// no second place to remember to edit. The old map existed because the sources
// were named things like `f-15e_strike_eagle_-_fighter_jet_-_free`.

type Rule = { match: RegExp; size: number; quality: number };

// Longest match wins, so metallicRoughness is tested before baseColor.
const RULES: Rule[] = [
  { match: /metallicRoughness/i, size: 512, quality: 72 },
  { match: /normal/i, size: 1024, quality: 80 },
  { match: /baseColor|diffuse|albedo/i, size: 2048, quality: 82 },
];
const DEFAULT_RULE: Rule = { match: /.*/, size: 1024, quality: 80 };

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function ruleFor(name: string): Rule {
  return RULES.find((r) => r.match.test(name)) ?? DEFAULT_RULE;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const mb = (n: number) => (n / 1e6).toFixed(2).padStart(7);

async function copy(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, await readFile(from));
}

async function main() {
  let sourceTotal = 0;
  let shippedTotal = 0;
  const rows: string[] = [];

  let dirs: string[];
  try {
    dirs = (await readdir(SOURCE, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    console.error(
      `${SOURCE}/ is not present. It holds the untracked source assets; ` +
        `nothing to build. public/assets/ keeps whatever is already committed.`,
    );
    return;
  }

  // Rebuild from empty. A stale directory here is invisible -- it ships, it
  // serves, and nothing reports it -- which is how public/models/ survived
  // long after src/ stopped asking for it.
  await rm(OUT, { recursive: true, force: true });

  for (const name of dirs) {
    const src = join(SOURCE, name);

    for (const file of await walk(src)) {
      const rel = relative(src, file);
      const ext = extname(file).toLowerCase();
      const bytes = (await stat(file)).size;
      sourceTotal += bytes;

      // Licence files ship too: these are third-party assets and their terms
      // travel with them. A stray "<name> scene.bin.txt" in one source
      // package is a duplicate of the binary, not a licence -- skip it.
      if (ext === ".txt" && /scene\.bin/i.test(rel)) continue;

      if (VERBATIM.has(name) || ext === ".txt" || !IMAGE.has(ext)) {
        // .gltf and .bin pass through untouched -- the geometry costs almost
        // nothing next to the textures.
        await copy(file, join(OUT, name, rel));
        shippedTotal += bytes;
        continue;
      }

      const rule = ruleFor(rel);
      const dest = join(OUT, name, rel.replace(/\.(png|jpe?g)$/i, ".webp"));
      await mkdir(dirname(dest), { recursive: true });

      const image = sharp(file);
      const meta = await image.metadata();
      const out = await image
        .resize({
          width: Math.min(rule.size, meta.width ?? rule.size),
          height: Math.min(rule.size, meta.height ?? rule.size),
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: rule.quality, effort: 5 })
        .toBuffer();
      await writeFile(dest, out);
      shippedTotal += out.length;

      rows.push(
        `  ${name}/${rel.padEnd(46)} ${meta.width}x${meta.height} -> ` +
          `${rule.size}px  ${mb(bytes)} -> ${mb(out.length)} MB`,
      );
    }

    if (VERBATIM.has(name)) {
      rows.push(`  ${name}/: copied verbatim`);
      continue;
    }

    // Every texture is now .webp, so the glTF's image URIs have to follow.
    // Rewriting the manifest is what makes the swap invisible to the loader.
    const manifest = join(OUT, name, "scene.gltf");
    try {
      const json = JSON.parse(await readFile(manifest, "utf8"));
      for (const image of json.images ?? []) {
        if (image.uri) image.uri = image.uri.replace(/\.(png|jpe?g)$/i, ".webp");
      }
      await writeFile(manifest, JSON.stringify(json));
      rows.push(`  ${name}/scene.gltf: image URIs repointed at .webp`);
    } catch (err) {
      console.error(`could not rewrite ${manifest}:`, err);
      process.exitCode = 1;
    }
  }

  console.log(rows.join("\n"));
  console.log(
    `\ntotal ${mb(sourceTotal)} MB -> ${mb(shippedTotal)} MB ` +
      `(${((1 - shippedTotal / sourceTotal) * 100).toFixed(1)}% smaller)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
