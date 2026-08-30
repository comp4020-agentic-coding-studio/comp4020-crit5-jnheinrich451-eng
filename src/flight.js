/**
 * Stage 01 flight model — pure math, zero rendering dependencies.
 * Arcade coordinated turn: horizontal input -> bank -> heading change.
 */

export const DEG = Math.PI / 180;

/**
 * Stage 01.7. Two flight-control philosophies, deliberately not blended:
 *
 *   ASSISTED  input -> target attitude, bank drives heading, auto-level
 *   EXPERT    input -> angular velocity, local quaternion, no limits at all
 */
export const MODE = { ASSISTED: "ASSISTED", EXPERT: "EXPERT" };

/**
 * Expert rates. 360 deg loop ~= 6 s of held W, 360 deg roll ~= 3 s of held A/D.
 * Roll is deliberately twice pitch: rolling is a setup action and wants to feel
 * quick, pulling is the manoeuvre itself and wants to be readable.
 */
export const EXPERT = {
  pitchRate: 60 * DEG,
  rollRate: 120 * DEG,
};

export const FLIGHT = {
  maxBank: 70 * DEG,

  maxPitchUp: 40 * DEG,
  maxPitchDown: 30 * DEG,

  bankResponse: 4.0,
  pitchResponse: 3.2,

  turnGain: 0.45,

  // Arcade bank sink: a hard turn bleeds altitude, so the player learns to
  // pull as they bank. Not lift, not gravity — one curve, no new control.
  maxBankSink: 16,

  autoLevelBank: 2.0,
  autoLevelPitch: 0.8,

  // Stage 01.6b: Q/E are a roll RATE, not a target angle. Slower than the
  // barrel roll's 240 deg/s so a specific angle is achievable by hand.
  rollRate: 130 * DEG,
  // How far A/D must move before it takes the wings back off a held angle.
  // Above the mouse's resting jitter, below any deliberate stick input.
  rollBreakout: 0.15,

  // Stage 02 World Lab spawn: airborne, 700 m up, 1.6 km astern of the carrier
  // (which sits at z = -1600), nose already on the course toward Ireland. No
  // deck start — takeoff belongs to a later stage.
  spawn: { x: 0, y: 700, z: 0 },

  // Stage 02.2: world contact owns the sea and the ground now, so the old
  // y = 12 guard rail is gone — it sat above the ocean-contact threshold and
  // would have made an ocean impact impossible to detect. What is left is a
  // last-resort floor for the case where physics never loaded, far enough down
  // that the contact system always acts first.
  hardFloorY: -150,
};

/**
 * Barrel roll. The controlled model cannot produce this: input.x maps to a
 * TARGET BANK ANGLE clamped to maxBank, so there is no roll-rate to integrate
 * past 90°. Rather than replace that (the clamp is what keeps the arcade turn
 * legible), a roll is a scripted maneuver that borrows the orientation for its
 * duration and hands it back level.
 *
 * A real barrel roll is a helix: the aircraft rolls 360° while its nose traces
 * one circle around the flight path. Roll is closed-form in normalized time,
 * with pitch and heading offsets 90° out of phase, both returning to zero at
 * completion — so the maneuver is exactly heading-neutral.
 */
export const ROLL = {
  duration: 1.5,
  pitchAmplitude: 14 * DEG,
  yawAmplitude: 12 * DEG,
};

const TAU = Math.PI * 2;
const smoothstep = (t) => t * t * (3 - 2 * t);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Signed angle folded into -PI..PI. */
export const wrapAngle = (a) => a - TAU * Math.round(a / TAU);

/**
 * Bank angle that actually drives the turn.
 *
 * tan() runs away at 90 degrees, and past it the lift vector has rolled through
 * the vertical: at 120 degrees the horizontal component is what it was at 60,
 * and inverted-level (180) has none at all. Mirroring about 90 gives exactly
 * that, so holding past vertical smoothly stops the turn instead of pinning it
 * at max rate. The maxBank clamp then keeps tan() in the legible arcade range.
 */
export function turnBank(bank) {
  const w = wrapAngle(bank);
  const folded = Math.abs(w) > Math.PI / 2 ? Math.sign(w) * (Math.PI - Math.abs(w)) : w;
  return clamp(folded, -FLIGHT.maxBank, FLIGHT.maxBank);
}

/** Frame-rate independent exponential damping. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/* ---- quaternions -------------------------------------------------------
 *
 * Four floats, no three.js. Expert attitude has to accumulate in a quaternion
 * (unrestricted Euler state gimbal-locks at the top of a loop), but flight.js
 * is the one file with zero rendering dependencies and that is worth keeping:
 * it is what makes the whole flight model testable in isolation. main.js copies
 * state.quat straight into aircraftRoot.quaternion, which has identical layout.
 */

export const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });

export function quatIdentity(q) {
  q.x = q.y = q.z = 0;
  q.w = 1;
  return q;
}

export function quatNormalize(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= l;
  q.y /= l;
  q.z /= l;
  q.w /= l;
  return q;
}

/** out = a * b. Safe when out aliases a or b. */
export function quatMultiply(a, b, out = quat()) {
  const { x: ax, y: ay, z: az, w: aw } = a;
  const { x: bx, y: by, z: bz, w: bw } = b;
  out.x = aw * bx + ax * bw + ay * bz - az * by;
  out.y = aw * by - ax * bz + ay * bw + az * bx;
  out.z = aw * bz + ax * by - ay * bx + az * bw;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** THREE's Euler order "YXZ" — the order the assisted model has always used. */
export function quatFromEulerYXZ(pitch, heading, bank, out = quat()) {
  const c1 = Math.cos(pitch / 2), s1 = Math.sin(pitch / 2);
  const c2 = Math.cos(heading / 2), s2 = Math.sin(heading / 2);
  const c3 = Math.cos(bank / 2), s3 = Math.sin(bank / 2);
  out.x = s1 * c2 * c3 + c1 * s2 * s3;
  out.y = c1 * s2 * c3 - s1 * c2 * s3;
  out.z = c1 * c2 * s3 - s1 * s2 * c3;
  out.w = c1 * c2 * c3 + s1 * s2 * s3;
  return out;
}

/** THREE's Euler order "XYZ" — used for small per-frame deltas. */
export function quatFromEulerXYZ(x, y, z, out = quat()) {
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2), s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
  out.x = s1 * c2 * c3 + c1 * s2 * s3;
  out.y = c1 * s2 * c3 - s1 * c2 * s3;
  out.z = c1 * c2 * s3 - s1 * s2 * c3;
  out.w = c1 * c2 * c3 - s1 * s2 * s3;
  return out;
}

/** Rotate a vector by a quaternion. */
export function quatRotate(q, v, out = { x: 0, y: 0, z: 0 }) {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  out.x = v.x + w * tx + (y * tz - z * ty);
  out.y = v.y + w * ty + (z * tx - x * tz);
  out.z = v.z + w * tz + (x * ty - y * tx);
  return out;
}

const AXIS_FORWARD = { x: 0, y: 0, z: -1 };
const AXIS_UP = { x: 0, y: 1, z: 0 };

export const quatForward = (q, out) => quatRotate(q, AXIS_FORWARD, out);
export const quatUp = (q, out) => quatRotate(q, AXIS_UP, out);


/**
 * Stage 01.6 speed envelope. Gameplay numbers, not F-15 performance. Every
 * speed constant in the project lives here.
 */
export const SPEED = {
  min: 110,
  cruise: 170,
  max: 250,

  acceleration: 32, // m/s^2
  deceleration: 24, // m/s^2

  // The top 15% of lever travel is the afterburner band: it buys 30 m/s where
  // the 85% below it buys 110, so the last of the throttle reads as a distinct
  // gear rather than more of the same.
  afterburnerThreshold: 0.85,
  afterburnerSpeed: 220,
};

export const THROTTLE = {
  changeRate: 0.4, // full sweep in 2.5 s
};

/** Throttle lever position -> commanded airspeed. Piecewise, kinked at the AB band. */
export function getTargetSpeed(throttle) {
  const t = clamp(throttle, 0, 1);
  const k = SPEED.afterburnerThreshold;
  return t <= k
    ? lerp(SPEED.min, SPEED.afterburnerSpeed, t / k)
    : lerp(SPEED.afterburnerSpeed, SPEED.max, (t - k) / (1 - k));
}

/**
 * Exact inverse of getTargetSpeed — not the linear map, deliberately. Seeding
 * the lever from a *linear* inverse would command 165 m/s at spawn and the
 * aircraft would quietly decelerate out of the Stage 01 cruise on frame one.
 */
export function speedToThrottle(speed) {
  const s = clamp(speed, SPEED.min, SPEED.max);
  const k = SPEED.afterburnerThreshold;
  return s <= SPEED.afterburnerSpeed
    ? (k * (s - SPEED.min)) / (SPEED.afterburnerSpeed - SPEED.min)
    : k + (1 - k) * ((s - SPEED.afterburnerSpeed) / (SPEED.max - SPEED.afterburnerSpeed));
}

/** Lever position that holds the familiar Stage 01 cruise. ~0.464 */
export const CRUISE_THROTTLE = speedToThrottle(SPEED.cruise);

export const isAfterburner = (throttle) => throttle >= SPEED.afterburnerThreshold;

/** Rate-limited approach — acceleration stays readable in m/s^2. */
export function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function createFlightState(mode = MODE.ASSISTED) {
  return {
    mode,
    position: { ...FLIGHT.spawn },
    heading: 0,
    pitch: 0,
    bank: 0,
    // Authoritative in EXPERT; derived from the Euler angles in ASSISTED, so
    // renderer and camera read one field regardless of mode.
    quat: quat(),
    speed: SPEED.cruise,
    targetSpeed: SPEED.cruise,
    throttle: CRUISE_THROTTLE,
    afterburner: isAfterburner(CRUISE_THROTTLE),
    sink: 0,
    rollHold: false,
    maneuver: null,
  };
}

export const isExpert = (state) => state.mode === MODE.EXPERT;

/**
 * Begin a barrel roll. Ignored if one is already running, so a mashed key
 * cannot stack maneuvers or restart mid-roll.
 * @param direction >=0 right, <0 left — same convention as input.roll, i.e. a
 *   right roll drives bank NEGATIVE (matching -input.x in advanceControlled).
 */
export function requestRoll(state, direction = 1) {
  if (state.maneuver) return false;
  state.maneuver = {
    kind: "roll",
    t: 0,
    dir: direction >= 0 ? 1 : -1,
    bank0: state.bank,
    pitch0: state.pitch,
    heading0: state.heading,
    // Expert rolls about the entry attitude, so it needs the whole orientation.
    quat0: { ...state.quat },
  };
  return true;
}

/** 0..1 progress of the running maneuver, or 0 when there is none. */
export function maneuverProgress(state) {
  return state.maneuver ? state.maneuver.t : 0;
}

/** Sink rate in m/s for a given bank angle. 0 level, ~10.5 at 70°. */
export function bankSinkRate(bank) {
  return (1 - Math.cos(Math.abs(bank))) * FLIGHT.maxBankSink;
}

export function resetFlightState(state) {
  state.position.x = FLIGHT.spawn.x;
  state.position.y = FLIGHT.spawn.y;
  state.position.z = FLIGHT.spawn.z;
  state.heading = 0;
  state.pitch = 0;
  state.bank = 0;
  quatIdentity(state.quat);
  state.speed = SPEED.cruise;
  state.targetSpeed = SPEED.cruise;
  state.throttle = CRUISE_THROTTLE;
  state.afterburner = isAfterburner(CRUISE_THROTTLE);
  state.sink = 0;
  state.rollHold = false;
  state.maneuver = null;
  return state;
}

/**
 * Seamless handover (Stage 02.1): position, speed, throttle and ATTITUDE all
 * carry across. This is cheap because both controllers already maintain both
 * representations every frame — assisted mirrors its Euler angles into the
 * quaternion, expert derives Euler diagnostics from the quaternion — so a mode
 * change only has to declare which one is now authoritative and make sure the
 * other agrees.
 *
 * Handing expert an inverted or 80-degrees-nose-up attitude is safe: assisted
 * damps pitch and bank toward their targets rather than clamping them, so the
 * aircraft flies itself back inside the arcade envelope instead of snapping.
 */
/**
 * WHICH FLIGHT MODEL A RUN'S OUTCOME LEAVES YOU IN.
 *
 * Finishing the sortie promotes you to EXPERT; failing it puts you back in
 * ASSISTED. The mode survives a restart (`resetFlightState` deliberately does
 * not touch it), so the next run inherits what the last one earned.
 *
 * It is a promotion the player is never TOLD about, which is the point: §16
 * forbids a legend, so the reward has to be flown rather than announced. The
 * HUD already prints ASSISTED / EXPERT, so the change is visible without a word,
 * and `M` still toggles either way at any time — nothing here locks a key.
 *
 * The demotion is the load-bearing half. A cold player handed EXPERT banks and
 * finds the nose does not follow, which reads as a broken aeroplane rather than
 * a harder one — and they have no way to know `M` exists. Dropping back to
 * ASSISTED on a failure means the aircraft only ever gets harder for someone who
 * has just proved they can fly it.
 *
 * Pure, so the rule is asserted without a scene (§4).
 */
export function flightModeForOutcome(outcome) {
  return outcome === "COMPLETE" ? MODE.EXPERT : MODE.ASSISTED;
}

export function setFlightMode(state, mode, { reset = false } = {}) {
  state.mode = mode === MODE.EXPERT ? MODE.EXPERT : MODE.ASSISTED;
  if (reset) {
    resetFlightState(state);
    return state.mode;
  }

  // A scripted roll is expressed differently per mode (Euler targets vs. an
  // entry quaternion), so it cannot cross the boundary. Drop it and keep the
  // attitude reached so far.
  state.maneuver = null;
  state.rollHold = false;

  if (isExpert(state)) {
    quatFromEulerYXZ(state.pitch, state.heading, state.bank, state.quat);
    syncExpertDiagnostics(state);
  } else {
    // Adopt whatever the quaternion says; bank included, so a banked handover
    // keeps turning and rolls out under the assisted controller.
    syncExpertDiagnostics(state);
  }
  return state.mode;
}

export function toggleFlightMode(state, options) {
  return setFlightMode(state, isExpert(state) ? MODE.ASSISTED : MODE.EXPERT, options);
}

/**
 * Forward axis for an Euler(pitch, heading, bank) in THREE's "YXZ" order.
 * Roll about the forward axis leaves it invariant, so bank drops out.
 * Matches new Vector3(0,0,-1).applyQuaternion(setFromEuler(p,h,b,'YXZ')).
 */
export function forwardFromAngles(pitch, heading, out = { x: 0, y: 0, z: 0 }) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(heading) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(heading) * cp;
  return out;
}

const _fwd = { x: 0, y: 0, z: 0 };
const _up = { x: 0, y: 0, z: 0 };
const _dq = quat();

/**
 * Advance one step. Dispatches on mode and nothing else — the two controllers
 * share only the engine and the position integrator.
 * @param state flight state, mutated in place
 * @param input {x,y,roll,throttle} normalized control input, -1..1
 * @param dt seconds, already clamped by the caller
 */
export function updateFlight(state, input, dt) {
  advanceEngine(state, input.throttle ?? 0, dt);

  if (isExpert(state)) {
    if (state.maneuver) advanceManeuverExpert(state, dt);
    else advanceExpert(state, input, dt);
    integrateExpert(state, dt);
  } else {
    if (state.maneuver) advanceManeuver(state, dt);
    else advanceControlled(state, input, dt);
    integrate(state, dt);
    // Euler angles stay authoritative in assisted mode; the quaternion is a
    // read-only mirror for the renderer and camera.
    quatFromEulerYXZ(state.pitch, state.heading, state.bank, state.quat);
  }
  return state;
}

/**
 * Throttle -> target speed -> inertia -> actual speed. The lever is persistent:
 * releasing the key leaves it where it stands, so speed is a setting the player
 * commands rather than a key they hold.
 */
function advanceEngine(state, axis, dt) {
  const a = clamp(axis, -1, 1);
  if (a !== 0) {
    state.throttle = clamp(state.throttle + a * THROTTLE.changeRate * dt, 0, 1);
  }
  state.targetSpeed = getTargetSpeed(state.throttle);
  state.afterburner = isAfterburner(state.throttle);

  const rate = state.targetSpeed > state.speed ? SPEED.acceleration : SPEED.deceleration;
  state.speed = moveTowards(state.speed, state.targetSpeed, rate * dt);
}

/**
 * Scripted orientation. Roll runs the full 360°; the bank -> heading coupling
 * is bypassed entirely (tan() is meaningless past 90°) and replaced by the
 * helix's own yaw term, so the aircraft comes out on its entry heading.
 */
function advanceManeuver(state, dt) {
  const m = state.maneuver;
  m.t = Math.min(1, m.t + dt / ROLL.duration);
  // Accumulating dt/duration lands at 0.999…9 rather than 1 for frame counts
  // that divide evenly, which would leave the maneuver alive an extra frame
  // holding bank at exactly 2π. Snap the last sliver.
  if (m.t > 1 - 1e-9) m.t = 1;

  // Eased so the roll starts and stops without a snap at either end.
  const e = smoothstep(m.t);
  const phase = TAU * e;

  // Entry attitude is blended out over the maneuver rather than discarded:
  // rolling straight out of a 70 degree turn otherwise snaps the wings level on
  // the first frame. At e = 1 both blend terms are 0 and phase is a full turn,
  // so the end-level / heading-neutral / altitude-neutral guarantees hold.
  // dir is +1 for a roll to the RIGHT, and right-hand bank is negative, so both
  // the roll and its yaw term subtract. One convention across the axis, the
  // maneuver and the HUD label.
  state.bank = lerp(m.bank0, 0, e) - m.dir * phase;
  state.pitch = lerp(m.pitch0, 0, e) + ROLL.pitchAmplitude * Math.sin(phase);
  state.heading = m.heading0 - m.dir * ROLL.yawAmplitude * (1 - Math.cos(phase));

  if (m.t >= 1) {
    state.bank = 0;
    state.pitch = 0;
    state.heading = m.heading0;
    state.rollHold = false;
    state.maneuver = null;
  }
}

function advanceControlled(state, input, dt) {
  const ix = clamp(input.x, -1, 1);
  const iy = clamp(input.y, -1, 1);
  const ir = clamp(input.roll ?? 0, -1, 1);

  // Direct roll. Integrating a rate is what lets the wings pass 70 degrees and
  // stop anywhere; positive ir is right, matching the -ix bank convention.
  if (ir !== 0) {
    state.bank = wrapAngle(state.bank - ir * FLIGHT.rollRate * dt);
    state.rollHold = true;
  } else if (Math.abs(ix) >= FLIGHT.rollBreakout) {
    // A deliberate stick input reclaims the wings: the damped target-angle
    // controller takes over and flies the bank back into the arcade envelope.
    state.rollHold = false;
  }

  const maxPitch = iy >= 0 ? FLIGHT.maxPitchUp : FLIGHT.maxPitchDown;
  const targetPitch = iy * maxPitch;
  const pitchLambda = lerp(FLIGHT.autoLevelPitch, FLIGHT.pitchResponse, Math.abs(iy));
  state.pitch = damp(state.pitch, targetPitch, pitchLambda, dt);

  // Held angle: no auto-level, no target to damp toward. The wings stay put
  // until Q/E moves them or A/D takes them back.
  if (!state.rollHold) {
    const targetBank = -ix * FLIGHT.maxBank;
    // Gentle self-levelling near neutral input: response slackens off toward
    // the auto-level rate so releasing the stick settles rather than snaps.
    const bankLambda = lerp(FLIGHT.autoLevelBank, FLIGHT.bankResponse, Math.abs(ix));
    state.bank = damp(state.bank, targetBank, bankLambda, dt);
  }

  // Bank generates the turn. Yaw is never a direct player control.
  state.heading += Math.tan(turnBank(state.bank)) * FLIGHT.turnGain * dt;
}

/* ---- expert controller ------------------------------------------------- */

/**
 * Input is angular VELOCITY, integrated into the quaternion in aircraft-local
 * space: quat = quat * delta. Post-multiplication is what makes the axes local,
 * and it is the whole point of the mode — pitching while banked is what bends
 * the trajectory, so there is no bank -> heading term anywhere in here.
 *
 * No clamp, no auto-level, no bank sink. Release the stick and the attitude is
 * whatever you left it.
 */
function advanceExpert(state, input, dt) {
  const ix = clamp(input.x, -1, 1);
  const iy = clamp(input.y, -1, 1);
  const ir = clamp(input.roll ?? 0, -1, 1);

  const pitchDelta = iy * EXPERT.pitchRate * dt;
  // One sign inversion, at the controller boundary: right-hand stick is +x and
  // a right roll is negative about the local Z axis. Q/E fold into the same
  // axis rather than being a second roll system.
  const rollDelta = -clamp(ix + ir, -1, 1) * EXPERT.rollRate * dt;

  if (pitchDelta !== 0 || rollDelta !== 0) {
    quatFromEulerXYZ(pitchDelta, 0, rollDelta, _dq);
    quatNormalize(quatMultiply(state.quat, _dq, state.quat));
  }

  // Euler fields are diagnostic only in this mode; keep them from going stale.
  syncExpertDiagnostics(state);
}

/**
 * The scripted evasive roll, expressed as a local rotation off the entry
 * attitude instead of as Euler targets. Anchoring on quat0 means the maneuver
 * closes exactly — at t=1 the delta is identity, whatever attitude it began in,
 * including inverted or vertical.
 */
function advanceManeuverExpert(state, dt) {
  const m = state.maneuver;
  m.t = Math.min(1, m.t + dt / ROLL.duration);
  if (m.t > 1 - 1e-9) m.t = 1;

  const phase = TAU * smoothstep(m.t);
  // sin() and (cos()-1) both vanish at 0 and 2*PI and are 90 degrees out of
  // phase, so the nose traces one small circle and lands exactly where it
  // started: a helix, not a pirouette.
  quatFromEulerXYZ(
    ROLL.pitchAmplitude * Math.sin(phase),
    -m.dir * ROLL.yawAmplitude * (Math.cos(phase) - 1),
    -m.dir * phase,
    _dq
  );
  quatNormalize(quatMultiply(m.quat0, _dq, state.quat));

  if (m.t >= 1) {
    state.quat.x = m.quat0.x;
    state.quat.y = m.quat0.y;
    state.quat.z = m.quat0.z;
    state.quat.w = m.quat0.w;
    state.maneuver = null;
  }
  syncExpertDiagnostics(state);
}

/**
 * Diagnostic Euler angles derived from the quaternion. Display only — nothing
 * in the expert path reads these back, which is exactly why they can be
 * ambiguous at the poles without consequence.
 */
export function syncExpertDiagnostics(state) {
  quatForward(state.quat, _fwd);
  state.pitch = Math.asin(clamp(_fwd.y, -1, 1));
  state.heading = Math.atan2(-_fwd.x, -_fwd.z);

  // Bank from where the wings' up vector sits relative to the horizon plane.
  quatUp(state.quat, _up);
  const rx = -Math.cos(state.heading);
  const rz = Math.sin(state.heading); // right wing axis, level
  state.bank = Math.atan2(_up.x * rx + _up.z * rz, _up.y);
  return state;
}

/** Compact vertical/inverted readout for the overlay. */
export function attitudeVectors(state) {
  quatForward(state.quat, _fwd);
  quatUp(state.quat, _up);
  return { forwardY: _fwd.y, upY: _up.y, inverted: _up.y < 0 };
}

/** Shared: velocity along the forward axis, bank sink, altitude floor. */
function integrate(state, dt) {
  forwardFromAngles(state.pitch, state.heading, _fwd);
  const d = state.speed * dt;
  state.position.x += _fwd.x * d;
  state.position.y += _fwd.y * d;
  state.position.z += _fwd.z * d;

  // Bank sink competes with the climb that positive pitch already produces,
  // so holding altitude through a hard turn means pulling a little. Suppressed
  // during a roll: past 90° the cosine term would invert into a 32 m/s plunge,
  // and a barrel roll should be close to altitude-neutral anyway.
  state.sink = state.maneuver ? 0 : bankSinkRate(state.bank);
  state.position.y -= state.sink * dt;

  // Last-resort floor only (see FLIGHT.hardFloorY): normally world contact has
  // already recovered the aircraft hundreds of metres above this.
  if (state.position.y < FLIGHT.hardFloorY) {
    state.position.y = FLIGHT.hardFloorY;
    if (state.pitch < 0 && !state.maneuver) state.pitch *= 0.5;
  }
}

/**
 * Expert translation: straight down the actual local forward axis. Nose up
 * climbs, nose down descends, inverted-and-level keeps flying forward. No bank
 * sink — a scalar cosine of "bank" is meaningless once the aircraft can be
 * vertical, and §12 wants altitude to come from attitude alone for now.
 */
function integrateExpert(state, dt) {
  quatForward(state.quat, _fwd);
  const d = state.speed * dt;
  state.position.x += _fwd.x * d;
  state.position.y += _fwd.y * d;
  state.position.z += _fwd.z * d;

  state.sink = 0;

  // Same floor, but the attitude is left alone: nothing here may quietly
  // rotate the aircraft the player is flying.
  if (state.position.y < FLIGHT.hardFloorY) state.position.y = FLIGHT.hardFloorY;
}

/* ---- state snapshots (Stage 02.2 contact recovery) ---------------------- */

/**
 * A restorable flight state. Attitude travels as a quaternion, which is the
 * one representation both controllers agree on, so a snapshot taken in either
 * mode restores correctly in either mode.
 */
export function captureFlightState(state) {
  return {
    position: { x: state.position.x, y: state.position.y, z: state.position.z },
    quat: { x: state.quat.x, y: state.quat.y, z: state.quat.z, w: state.quat.w },
    speed: state.speed,
    throttle: state.throttle,
    mode: state.mode,
  };
}

/**
 * Restore a snapshot in place. The mode is deliberately NOT restored — the
 * player may have switched since, and a recovery must never take the controls
 * away. Euler angles are re-derived from the quaternion so assisted mode picks
 * up exactly the attitude that was recorded.
 *
 * @param speedScale optional bleed, so arriving at the safe point does not
 *   immediately re-fly the same impact.
 * @param maxSpeed optional ceiling (Stage 02.3 recovery cap). When given, the
 *   throttle lever is moved to match the restored speed instead of being
 *   restored from the snapshot — otherwise the engine model would spool
 *   straight back up to the speed that caused the impact.
 */
export function applyFlightState(state, snapshot, { speedScale = 1, maxSpeed = null } = {}) {
  if (!snapshot) return false;
  state.position.x = snapshot.position.x;
  state.position.y = snapshot.position.y;
  state.position.z = snapshot.position.z;
  state.quat.x = snapshot.quat.x;
  state.quat.y = snapshot.quat.y;
  state.quat.z = snapshot.quat.z;
  state.quat.w = snapshot.quat.w;
  quatNormalize(state.quat);
  // Derives pitch/heading/bank from the quaternion — which is what assisted
  // mode needs, since its Euler angles are the authoritative ones.
  syncExpertDiagnostics(state);

  let speed = snapshot.speed * speedScale;
  if (maxSpeed !== null) speed = Math.min(speed, maxSpeed);
  state.speed = clamp(speed, SPEED.min, SPEED.max);
  state.throttle = maxSpeed !== null ? speedToThrottle(state.speed) : clamp(snapshot.throttle, 0, 1);
  state.targetSpeed = getTargetSpeed(state.throttle);
  state.afterburner = isAfterburner(state.throttle);
  state.sink = 0;
  state.rollHold = false;
  state.maneuver = null;
  return true;
}

/** Bank normalized to -180..180 for display; roll passes through 360°. */
export function bankDegrees(state) {
  let deg = ((state.bank / DEG) % 360 + 540) % 360 - 180;
  if (Object.is(deg, -180)) deg = 180;
  return deg;
}

/** Heading normalized to 0..359 for display. */
export function headingDegrees(state) {
  const deg = (-state.heading / DEG) % 360;
  return (deg + 360) % 360;
}
