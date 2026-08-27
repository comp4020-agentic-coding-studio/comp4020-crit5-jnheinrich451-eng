// The one place that makes the game's own suite runnable off a page.
//
// src/flight.test.js is framework-free and runs on import (CLAUDE.md §18), and
// spec/vector.test.ts imports it so `pnpm check` gates on the same numbers
// tests.html prints. That only works if the modules it pulls in can be loaded
// outside a browser, and nine of them paint a sprite texture at construction:
//
//   atmosphere, crash-fx, engine-fx, flares, gun, missile, night-lights,
//   vapor-fx, world
//
// Under bare node they threw on `document`; under jsdom `document` exists but
// `getContext("2d")` returns null, because jsdom ships no rasteriser. Both were
// hit, in that order, and each one killed the whole import -- so a single
// missing 2D context was enough to take 1447 assertions off the gate.
//
// The environment is jsdom (see vite.config.ts), which supplies document,
// window.innerWidth and location -- flight.test.js needs all three for the
// pointer-steering checks. This file adds the only thing jsdom is missing.
//
// WHY A STUB IS HONEST HERE, given §17.13 ("a test double must match the real
// thing"): the nine call sites use exactly three methods between them --
// createRadialGradient, fillRect and a fillStyle assignment, plus addColorStop
// on the gradient -- and every one of them is PAINTING. Not one assertion in
// the suite reads a pixel; what they assert is geometry, timing and state.
// So the divergence is bounded to the image, and the image is not under test.
// If a check ever does need to read a texture, it will fail loudly against
// this stub rather than quietly pass -- which is the behaviour §17.13 wants.
//
// Deliberately NOT solved by guarding each call site: that is nine branches in
// shipped code that exist only for a test environment, and nine places to look
// when one of them is wrong. The environment is the harness's problem.

const gradient = {
  addColorStop() {},
};

const context2d = {
  fillStyle: "",
  createRadialGradient: () => gradient,
  createLinearGradient: () => gradient,
  fillRect() {},
};

// Unconditional: this file is only ever loaded as a vitest setup file, so the
// canvas here is always jsdom's. Its own getContext logs a "not implemented"
// console error before returning null, which buries the real output of a red
// run in noise -- replacing it removes that too.
const proto = globalThis.HTMLCanvasElement?.prototype;
if (proto) {
  proto.getContext = ((kind: string) =>
    kind === "2d" ? context2d : null) as typeof proto.getContext;
}
