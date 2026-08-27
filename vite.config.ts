import { readdirSync } from "node:fs";
import { join } from "node:path";
// from "vitest/config", not "vite": vite's own defineConfig has no `test` key
// in its type, so the vitest options below would fail `pnpm typecheck`. It
// re-exports vite's config unchanged with that key added.
import { defineConfig } from "vitest/config";

// Every .html file in the repo is a page and a build entry, so a multi-page
// hand-written site needs no build config: add pages, link them, ship.
// (Vite's default would build only the root index.html and silently drop the
// rest from dist/ — fine locally, 404s deployed.)
// `assets` and `public` hold tens of megabytes of models and audio and not one
// .html between them; walking them on every config load is pure cost.
const SKIP = new Set([
  "node_modules", "dist", "spec", "scripts", "reflections", "assets", "public",
  "instructions",
]);

function htmlEntries(dir = "."): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlEntries(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

// `base: "./"` makes built asset URLs relative, so the site works under any
// GitHub Pages path (username.github.io/your-repo/) without further config.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: htmlEntries(),
    },
  },
  server: {
    watch: {
      // DO NOT WATCH assets/. It holds the untracked SOURCE models -- 47 MB
      // and growing -- and nothing in it reaches the build: `pnpm assets`
      // derives public/models/ from it, and only public/ is copied.
      //
      // Watching it is not merely wasteful, it is fragile. Dropping a new
      // model in there killed the dev server outright:
      //
      //   Error: EBUSY: resource busy or locked, watch
      //   'assets/models/nomads_sam_system/scene.bin'
      //
      // A 20 MB file still being written cannot be watched on Windows, and
      // chokidar raises that as an unhandled error rather than skipping the
      // file. So the failure mode of ADDING AN ASSET was the whole dev server
      // exiting with a stack trace about a file the build never reads.
      // Widened after this recurred on `instructions/` -- a spec document being
      // written killed the server the same way a model did. Ignoring one
      // directory at a time treats instances; the CLASS is "anything the
      // browser never fetches". Nothing below reaches a page: assets/ holds
      // untracked sources that `pnpm assets` derives public/ from, and the
      // rest is prose.
      ignored: [
        "**/assets/**",
        "**/dist/**",
        "**/instructions/**",
        "**/reflections/**",
        "**/*.md",
        "**/.git/**",
      ],
    },
  },

  test: {
    // Vitest's default glob would collect `src/flight.test.js` directly and
    // fail it as "no test suite found": that file is the GAME's suite —
    // plain assertions with its own pass/fail count, framework-free by
    // design (CLAUDE.md §18) — and it has no describe/it blocks to find.
    //
    // It still runs under `pnpm check`, but through `spec/vector.test.ts`,
    // which imports it and asserts the count is green. One suite, two
    // harnesses; this glob just says which files are vitest's to drive.
    include: ["spec/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
