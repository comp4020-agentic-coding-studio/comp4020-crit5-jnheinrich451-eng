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
const SKIP = new Set(["node_modules", "dist", "spec", "scripts", "reflections"]);

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
