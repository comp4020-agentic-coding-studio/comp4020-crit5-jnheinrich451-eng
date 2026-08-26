// Build the shipping textures from the source models. CLAUDE.md §2.
//
// The source assets are 46 MB, 35 MB of that in seven texture files. That is
// not a repository problem so much as a CRIT ROOM problem: the pod opens the
// deployed URL cold on shared wifi, and a player staring at a loading screen
// has already lost part of the five minutes the brief gives them.
//
// Nothing here is a judgement about how the game should look. Each texture is
// resized by what it is FOR:
//
//   baseColor          the only map a player actually looks at -> 2048, WebP
//   normal             surface detail, still visible at speed -> 1024, WebP
//   metallicRoughness  a DATA map: roughness in G, metalness in B. It carries
//                      no detail an eye can resolve, and at 19.4 m across at
//                      200 m/s nobody is reading its gradients -> 512
//   terrain baseColor  seen from 900 m and fogged past 12 km -> 2048
//
// Run with `pnpm assets`. The originals stay untracked in assets/models/, so
// this is re-runnable and reversible; only its output is committed.

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import sharp from "sharp";

const SOURCE = "assets/models";
const OUT = "public/models";

// Source directory -> shipped directory. Renamed on the way so the URLs in
// src/ stay short and stable if a model is ever replaced.
const MODELS: Record<string, string> = {
  "f-15e_strike_eagle_-_fighter_jet_-_free": "f-15e",
  "uss_dwight_d.eisenhower_cvn-69_aircraft_carrier": "carrier",
  ireland_terrain: "terrain",
  "aim-9_missile": "aim-9",
};

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

async function main() {
  let sourceTotal = 0;
  let shippedTotal = 0;
  const rows: string[] = [];

  for (const [from, to] of Object.entries(MODELS)) {
    const src = join(SOURCE, from);
    try {
      await stat(src);
    } catch {
      console.warn(`skip ${from}: not present`);
      continue;
    }

    for (const file of await walk(src)) {
      const rel = relative(src, file);
      const ext = extname(file).toLowerCase();
      const bytes = (await stat(file)).size;
      sourceTotal += bytes;

      // Licence files ship too: these are third-party assets and their terms
      // travel with them. A stray "<name> scene.bin.txt" in one source
      // package is a duplicate of the binary, not a licence -- skip it.
      if (ext === ".txt" && /scene\.bin/i.test(rel)) continue;
      if (ext === ".txt") {
        const dest = join(OUT, to, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, await readFile(file));
        shippedTotal += bytes;
        continue;
      }

      if (!IMAGE.has(ext)) {
        // .gltf and .bin pass through untouched -- the geometry is 234k
        // triangles across all four models and costs almost nothing.
        const dest = join(OUT, to, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, await readFile(file));
        shippedTotal += bytes;
        continue;
      }

      const rule = ruleFor(rel);
      const dest = join(OUT, to, rel.replace(/\.(png|jpe?g)$/i, ".webp"));
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
        `  ${to}/${rel.padEnd(44)} ${meta.width}x${meta.height} -> ` +
          `${rule.size}px  ${mb(bytes)} -> ${mb(out.length)} MB`,
      );
    }

    // Every texture is now .webp, so the glTF's image URIs have to follow.
    // Rewriting the manifest is what makes the swap invisible to the loader.
    const manifest = join(OUT, to, "scene.gltf");
    try {
      const json = JSON.parse(await readFile(manifest, "utf8"));
      for (const image of json.images ?? []) {
        if (image.uri) image.uri = image.uri.replace(/\.(png|jpe?g)$/i, ".webp");
      }
      await writeFile(manifest, JSON.stringify(json));
      rows.push(`  ${to}/scene.gltf: image URIs repointed at .webp`);
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
