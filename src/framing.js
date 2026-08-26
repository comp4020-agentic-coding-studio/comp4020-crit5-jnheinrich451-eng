// Aspect-aware framing. Pure math, no three.js, so the assertion suite can
// exercise it headlessly -- the rule it encodes is about the two MARKING
// viewports, and a rule that can only be checked by looking at a screenshot
// is a rule that regresses quietly.

// three.js quotes camera.fov as a VERTICAL angle. That holds the vertical
// view fixed and lets the horizontal view collapse as a frame narrows:
//
//   1920x1080  aspect 1.78   64 deg vertical -> 96 deg horizontal
//    390x844   aspect 0.46   64 deg vertical -> 32 deg horizontal
//
// A third of the horizontal view is why the aircraft filled the phone frame
// and the world read as a diorama. Both are full marking environments and
// everything the brief asks for has to work cleanly at both, so hold the
// HORIZONTAL view steady and let the vertical give.
export const REF_ASPECT = 16 / 9;

// A ceiling, because preserving horizontal view exactly at aspect 0.46 asks
// for 135 degrees of vertical and bends the horizon into a fisheye. Clamping
// is the honest trade: some horizontal view is still lost in portrait, but
// the scene stays readable rather than swapping one distortion for another.
export const FOV_VERTICAL_MAX = 100;

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export function horizontalFov(verticalFov, aspect) {
  return 2 * Math.atan(Math.tan((verticalFov * RAD) / 2) * aspect) * DEG;
}

export function widenForAspect(verticalFov, aspect) {
  // Wider than the reference needs no help: the horizontal view is already
  // at least what the desktop viewport gets, and narrowing the vertical to
  // claw it back would crop the horizon out of an ultrawide frame.
  if (!(aspect > 0) || aspect >= REF_ASPECT) return verticalFov;
  const widened =
    2 * Math.atan((Math.tan((verticalFov * RAD) / 2) * REF_ASPECT) / aspect) *
    DEG;
  return Math.min(widened, FOV_VERTICAL_MAX);
}
