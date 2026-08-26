// The flight model. CLAUDE.md §6, §17.1.
//
// THIS MODULE MUST NOT IMPORT THREE.JS. flightState.quat is a plain
// {x,y,z,w} record and nothing may call .copy() on it. The renderer and the
// camera read one quaternion field regardless of flight mode, which is what
// lets stage 2 add EXPERT without touching either of them.

// ── conventions ────────────────────────────────────────────────────────────
// Course runs toward -Z. Heading 0 = -Z. Forward is (-sin h, -cos h).
// Established here and used in bearings, break directions, spawn offsets and
// the radar. CLAUDE.md §5.

export const SPEED_MIN = 110;
export const SPEED_CRUISE = 170;
export const SPEED_MAX = 250;
export const BANK_MAX = (70 * Math.PI) / 180;
export const PITCH_MAX = (35 * Math.PI) / 180;

// Afterburner is the top 15% of lever travel. §6.
export const BURNER_LEVER = 0.85;

// Throttle is a LEVER, not an accelerator: this is its travel rate, in
// lever-fraction per second. Releasing the key leaves it where it is.
const LEVER_RATE = 0.55;

// Thrust response: how fast speed chases the lever's commanded speed.
const SPEED_LAG = 0.45;

// Control self-centring rates (ASSISTED). Higher = crisper.
const BANK_RATE = 2.6;
const PITCH_RATE = 2.2;
// Q/E trim the bank directly as a rate, on top of the A/D angle command.
const ROLL_RATE = 1.5;

// ── the turn ───────────────────────────────────────────────────────────────
// Arcade coordinated turn: bank drives heading change. Rather than tune a
// turn rate by feel, derive it from the turn RADIUS we need at the top of the
// envelope, because §14's fairness claim is stated in radii: enemy rounds
// have radii ~904-1146 m and "a hard crossing manoeuvre defeats them with no
// countermeasure at all" only holds if the F-15 out-turns them at speed.
//
//   coordinated turn:  omega = G * tan(bank) / v        (G an arcade gravity)
//   turn radius:       r     = v / omega = v^2 / (G * tan(bank))
//   solve for G:       G     = v^2 / (r * tan(bank))
//
// Pinning r = 1000 m at v = SPEED_MAX, bank = BANK_MAX:
//   G = 250^2 / (1000 * tan 70 deg) = 62500 / 2747.5 = 22.75 m/s^2
//
// Real gravity (9.81) gives r = 2319 m there, which loses the fairness claim
// outright. The consequence of deriving it this way is that the radius falls
// with speed -- 462 m at cruise, 194 m at minimum -- so slowing down turns
// tighter, which is a real skill the player can find without being told.
export const TURN_RADIUS_REF = 1000;
export const TURN_G =
  (SPEED_MAX * SPEED_MAX) / (TURN_RADIUS_REF * Math.tan(BANK_MAX));

// Bank-driven altitude loss -- the arcade substitute for lift loss. §6.
// Scales with the load factor excess (1/cos(bank) - 1), which is 0 level and
// 1.92 at the bank limit, so a hard turn costs ~17 m/s of altitude and the
// player learns to pull while turning. That is the whole lesson of the sink
// term, and it is why it is not a flat constant.
const SINK_GAIN = 9;
// The floor on the lift direction's vertical component. Without it, knife-edge
// flight in EXPERT divides by zero and inverted flight changes sign.
const SINK_MIN_LIFT = 0.15;
const SINK_MAX = 60;

// ── quaternion helpers (plain math, no THREE) ──────────────────────────────

export function quatIdentity() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function quatMultiply(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

// YXZ order, matching the THREE.Euler order of the same name:
// R = Ry(heading) * Rx(pitch) * Rz(bank). Heading first means pitch and bank
// are applied in the aircraft frame, which is why banking does not swing the
// nose in azimuth on its own -- the heading change comes from the turn term.
export function quatFromEulerYXZ(heading, pitch, bank) {
  const ry = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
  const rx = { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) };
  const rz = { x: 0, y: 0, z: Math.sin(bank / 2), w: Math.cos(bank / 2) };
  return quatMultiply(quatMultiply(ry, rx), rz);
}

// Rotate a vector by a quaternion: v' = v + w*t + cross(q.xyz, t), where
// t = 2 * cross(q.xyz, v). Cheaper than building a rotation matrix.
function quatRotate(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function quatForward(q) {
  return quatRotate(q, { x: 0, y: 0, z: -1 });
}

export function quatUp(q) {
  return quatRotate(q, { x: 0, y: 1, z: 0 });
}

export function quatRight(q) {
  return quatRotate(q, { x: 1, y: 0, z: 0 });
}

export function quatNormalize(q) {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

// The inverse of quatFromEulerYXZ, matching the same YXZ order. EXPERT
// integrates the quaternion directly, so the Euler angles have to be read
// back OUT of it for the HUD, the camera roll term and the developer rail --
// they become a derived view of the attitude in that mode rather than its
// source. Nothing may write them back into the quaternion in EXPERT, or the
// pitch clamp would quietly forbid inverted flight.
export function quatToEulerYXZ(q) {
  const { x, y, z, w } = q;
  const m13 = 2 * (x * z + w * y);
  const m21 = 2 * (x * y + w * z);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m31 = 2 * (x * z - w * y);
  const m11 = 1 - 2 * (y * y + z * z);
  const m33 = 1 - 2 * (x * x + y * y);

  const pitch = Math.asin(clamp(-m23, -1, 1));
  // Near the pitch singularity heading and bank are not separable; pin bank
  // and put the whole rotation into heading rather than letting both spin.
  if (Math.abs(m23) < 0.9999999) {
    return { heading: Math.atan2(m13, m33), pitch, bank: Math.atan2(m21, m22) };
  }
  return { heading: Math.atan2(-m31, m11), pitch, bank: 0 };
}

// ── state ──────────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The lever position that holds a given speed. Inverse of commandedSpeed.
export function leverFor(speed) {
  return clamp((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN), 0, 1);
}

export function createFlightState(overrides = {}) {
  const state = {
    position: { x: 0, y: 900, z: 0 },
    heading: 0,
    pitch: 0,
    bank: 0,
    speed: SPEED_CRUISE,
    throttle: leverFor(SPEED_CRUISE), // a fresh state is in trim
    sink: 0,
    mode: "ASSISTED",
    afterburner: false,
    quat: quatIdentity(),
    ...overrides,
  };
  state.quat = quatFromEulerYXZ(state.heading, state.pitch, state.bank);
  return state;
}

// The speed the lever is asking for. Lever 0 -> minimum, lever 1 -> maximum.
export function commandedSpeed(throttle) {
  return SPEED_MIN + clamp(throttle, 0, 1) * (SPEED_MAX - SPEED_MIN);
}

export function isAfterburner(throttle) {
  return throttle > BURNER_LEVER;
}

// ── the step ───────────────────────────────────────────────────────────────

export function updateFlight(state, input, dt) {
  if (!(dt > 0)) return state;

  // Throttle is a persistent lever: input.throttle is a RATE (-1/0/+1), not a
  // position. Releasing the key leaves the lever where it is. §6 calls this
  // "the one control players misread" -- do not make it an accelerator.
  state.throttle = clamp(
    state.throttle + (input.throttle || 0) * LEVER_RATE * dt,
    0,
    1,
  );
  state.afterburner = isAfterburner(state.throttle);

  // Speed chases the lever rather than snapping to it.
  const target = commandedSpeed(state.throttle);
  state.speed = clamp(
    state.speed + (target - state.speed) * (1 - Math.exp(-SPEED_LAG * dt)),
    SPEED_MIN,
    SPEED_MAX,
  );

  // Both modes write the same quaternion field, so the renderer and the
  // camera read one attitude source regardless of mode. §6.
  if (state.mode === "EXPERT") stepExpert(state, input, dt);
  else stepAssisted(state, input, dt);

  // ONE sink law for both modes, expressed on the lift direction rather than
  // on the bank angle. The aircraft's up-vector is where lift points, so its
  // vertical component is how much of that lift is holding the aircraft up:
  //
  //   level      up.y = 1                 -> no sink
  //   70 deg     up.y = cos 70 = 0.342    -> 17.3 m/s, the arcade turn cost
  //   inverted   up.y = -1, floored       -> heavy sink
  //
  // Written on the bank angle instead, this breaks the moment EXPERT can go
  // past 90 degrees: cos(180 deg) is negative and the aircraft would CLIMB
  // when inverted. The floor is what keeps that from becoming a division by
  // zero at knife edge.
  const up = quatUp(state.quat);
  state.sink = clamp(
    SINK_GAIN * (1 / Math.max(up.y, SINK_MIN_LIFT) - 1),
    0,
    SINK_MAX,
  );

  // Translate along the nose, then apply the sink.
  const f = quatForward(state.quat);
  state.position.x += f.x * state.speed * dt;
  state.position.y += f.y * state.speed * dt;
  state.position.z += f.z * state.speed * dt;
  state.position.y -= state.sink * dt;

  return state;
}

function stepAssisted(state, input, dt) {
  // Controls self-centre: the axis commands an ANGLE the player holds, and
  // releasing it eases back to level. The aircraft cannot depart.
  const bankTarget = clamp(input.x || 0, -1, 1) * BANK_MAX;
  const pitchTarget = clamp(input.y || 0, -1, 1) * PITCH_MAX;

  state.bank += (bankTarget - state.bank) * (1 - Math.exp(-BANK_RATE * dt));
  // Q/E are a direct roll RATE on top of the A/D angle command.
  state.bank += clamp(input.roll || 0, -1, 1) * ROLL_RATE * dt;
  state.bank = clamp(state.bank, -BANK_MAX, BANK_MAX);

  state.pitch += (pitchTarget - state.pitch) * (1 - Math.exp(-PITCH_RATE * dt));
  state.pitch = clamp(state.pitch, -PITCH_MAX, PITCH_MAX);

  // Bank drives heading change. This coupling IS what ASSISTED is; EXPERT is
  // defined by its absence, and a test asserts that absence because a
  // well-meaning later edit that "fixes turning" in Expert will reintroduce
  // it and look like a bug fix.
  const omega = (TURN_G * Math.tan(state.bank)) / Math.max(state.speed, 1);
  state.heading = wrapAngle(state.heading + omega * dt);

  state.quat = quatFromEulerYXZ(state.heading, state.pitch, state.bank);
}

// ── EXPERT ─────────────────────────────────────────────────────────────────
// Quaternion integration in aircraft-local space. Input is angular VELOCITY,
// not an angle, and controls do not self-centre.

const EXPERT_PITCH_RATE = 1.15; // rad/s
const EXPERT_ROLL_RATE = 2.4; // rad/s

function stepExpert(state, input, dt) {
  const pitchRate = clamp(input.y || 0, -1, 1) * EXPERT_PITCH_RATE;
  const rollRate =
    (clamp(input.x || 0, -1, 1) + clamp(input.roll || 0, -1, 1)) *
    EXPERT_ROLL_RATE;

  // THERE IS NO BANK -> HEADING TERM HERE, and its absence is the entire
  // point of the mode. Heading changes only because pitching while banked
  // rotates the nose through the local axis -- which is how a real aircraft
  // turns, and why the mode rewards using bank and pitch together.
  const hx = (pitchRate * dt) / 2;
  const hz = (rollRate * dt) / 2;
  const delta = quatNormalize({ x: hx, y: 0, z: hz, w: 1 });

  // POST-multiply. quat * delta applies the rotation in the aircraft's own
  // frame; delta * quat would apply it in world axes and the mode would just
  // be a clumsier ASSISTED.
  state.quat = quatNormalize(quatMultiply(state.quat, delta));

  // Euler angles become a derived READ of the quaternion in this mode. They
  // are deliberately not clamped: the aircraft can be inverted and stay
  // there, and the player can lose orientation. Those are consequences to
  // accept, not to smooth over.
  const e = quatToEulerYXZ(state.quat);
  state.heading = e.heading;
  state.pitch = e.pitch;
  state.bank = e.bank;
}

// Switching mode must not carry the old model's attitude in through a clamp.
// ASSISTED cannot represent an inverted or steeply pitched state, so entering
// it from EXPERT levels onto the heading being travelled rather than
// snapping the quaternion through the pitch limit.
export function setMode(state, mode) {
  if (state.mode === mode) return state;
  state.mode = mode;
  if (mode === "ASSISTED") {
    state.pitch = clamp(state.pitch, -PITCH_MAX, PITCH_MAX);
    state.bank = clamp(state.bank, -BANK_MAX, BANK_MAX);
    state.quat = quatFromEulerYXZ(state.heading, state.pitch, state.bank);
  }
  return state;
}

export function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  let v = (a + Math.PI) % twoPi;
  if (v < 0) v += twoPi;
  return v - Math.PI;
}

// ── snapshots ──────────────────────────────────────────────────────────────
// Stages 3 (safe-state history), 4 (handoff) and 7 (checkpoints) all depend
// on these existing, so they land in stage 1 even though nothing calls them
// yet. Deep-copied: a snapshot that aliases the live state records nothing.

export function captureFlightState(state) {
  return {
    position: { ...state.position },
    heading: state.heading,
    pitch: state.pitch,
    bank: state.bank,
    speed: state.speed,
    throttle: state.throttle,
    sink: state.sink,
    mode: state.mode,
    afterburner: state.afterburner,
    quat: { ...state.quat },
  };
}

export function applyFlightState(state, snapshot) {
  state.position.x = snapshot.position.x;
  state.position.y = snapshot.position.y;
  state.position.z = snapshot.position.z;
  state.heading = snapshot.heading;
  state.pitch = snapshot.pitch;
  state.bank = snapshot.bank;
  state.speed = snapshot.speed;
  state.throttle = snapshot.throttle;
  state.sink = snapshot.sink;
  state.mode = snapshot.mode;
  state.afterburner = snapshot.afterburner;
  // Copy components -- never assign the record, or the snapshot and the live
  // state alias and the next frame edits history. §17.1.
  state.quat = { ...snapshot.quat };
  return state;
}
