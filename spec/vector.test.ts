// The week's contract tests: the game's own assertion suite, wired into
// `pnpm check` so CI gates on it.
//
// CLAUDE.md §18 wants a framework-free suite that a browser page can run and
// print a count for, and spec/README.md wants the week's checkable spec lines
// asserted here. Rather than write the assertions twice and let the two
// drift, this file IMPORTS the one suite and fails if anything in it is red.
// The browser count at tests.html and the repository gate therefore read the
// same numbers from the same code.
//
// src/flight.test.js deliberately imports no three.js, which is what lets it
// run headlessly here as well as in the page.

import { describe, expect, it } from "vitest";
import { run } from "../src/flight.test.js";

const result = run();

describe("operation vector: the game suite", () => {
  it("runs a meaningful number of checks", () => {
    // A guard against the suite silently emptying itself -- a green count of
    // zero is the failure mode a pass/fail gate cannot see on its own.
    expect(result.total).toBeGreaterThan(50);
  });

  it("is green", () => {
    const report = result.failures
      .map((f) => `  ${f.name}${f.detail ? ` — ${f.detail}` : ""}`)
      .join("\n");
    expect(result.failed, `\n${report}\n`).toBe(0);
  });
});
