// The smoke a launched round leaves behind. CLAUDE.md §14, DIAGNOSIS B2.
//
// missile.js says "visuals are the caller's problem", and for six stages the
// caller never solved it: the whole missile visual was a mesh plus one 3.2 m
// tail sprite. A FLAME IS NOT A TRAIL. §14 says the SAM round launches upward
// with zero inherited speed "which is what makes its trail read as a ground
// launch" -- the launch kinematics were asserted faithfully and the trail the
// sentence exists to describe was never built.
//
// WORLD-SPACE IS THE LOAD-BEARING WORD. A ribbon parented to the round moves
// with it and reads as a static ornament bolted to the missile; the round has
// to LEAVE the smoke behind. Same reasoning as the crash smoke, which already
// gets this right.
//
// Three-free, like every other rule in this project, so the budget and the
// persistence claim are asserted rather than looked at. combat-fx.js paints it.
//
// The segments OUTLIVE THE ROUND. A killed round's smoke fades out over its own
// remaining life rather than disappearing on the frame of the detonation, which
// is the difference between a kill that happened somewhere and a kill that
// happened nowhere.

// A SEGMENT IS A SPAN, NOT A PUFF, and that is the whole difference between a
// ribbon and a dotted line. One segment every life/14 seconds at an AIM-9's
// 900 m/s is a point every 38 m; drawn as a 2.6 m blob the trail is a row of
// dots with 35 m of clear air between them, which at 600 m is invisible and up
// close is a string of beads. Each segment therefore spans from where the last
// one ended to where the round is NOW -- contiguous by construction, whatever
// the round's speed or the frame rate -- and the quoted widths are the strip's
// THICKNESS across that span.
export const TRAIL = {
  // 14 POOLED SEGMENTS PER ROUND, and never a fifteenth: the array is allocated
  // once and used as a ring, so a long-lived round overwrites its oldest
  // segment rather than growing.
  segments: 14,
  life: 0.6, // s
  widthHead: 0.35, // m of strip thickness at the nozzle
  widthTail: 2.6, // m by the time it dies
  opacityHead: 0.8,
};

// One segment every life/segments seconds, so a steady round keeps exactly the
// budget alive and the spacing is the same at 20 Hz as at 60.
export const TRAIL_INTERVAL = TRAIL.life / TRAIL.segments;

/** Width of a segment at `age`. Head at the nozzle, spreading as it ages. */
export function trailWidth(age) {
  const u = Math.max(0, Math.min(1, age / TRAIL.life));
  return TRAIL.widthHead + (TRAIL.widthTail - TRAIL.widthHead) * u;
}

/** Opacity of a segment at `age`. Reaches exactly zero at the end of its life. */
export function trailOpacity(age) {
  const u = Math.max(0, Math.min(1, age / TRAIL.life));
  return TRAIL.opacityHead * (1 - u);
}

export function createTrails() {
  // round -> trail. A Map keyed by the round object itself, so nothing has to
  // invent an id and a retired round cannot collide with a fresh one.
  const live = new Map();
  // Trails whose round is gone but whose smoke has not finished burning.
  const orphans = [];
  // Retired trails, kept for reuse: a dogfight fires a round every few seconds
  // and rebuilding fourteen records each time is fourteen allocations for
  // nothing.
  const spare = [];

  function makeTrail() {
    const segments = [];
    for (let i = 0; i < TRAIL.segments; i++) {
      segments.push({
        ax: 0, ay: 0, az: 0,
        bx: 0, by: 0, bz: 0,
        age: 0, alive: false, width: 0, opacity: 0,
      });
    }
    return {
      segments, cursor: 0, since: 0, owner: "player",
      last: { x: 0, y: 0, z: 0 },
    };
  }

  function borrow(owner, position) {
    const trail = spare.pop() ?? makeTrail();
    trail.cursor = 0;
    trail.since = 0;
    trail.owner = owner;
    // The rail is where the ribbon starts. Seeded on the frame the round is
    // fired so the first segment spans from the launch point rather than from
    // wherever the origin happens to be.
    trail.last.x = position.x;
    trail.last.y = position.y;
    trail.last.z = position.z;
    for (const s of trail.segments) {
      s.alive = false;
      s.age = 0;
      s.opacity = 0;
    }
    return trail;
  }

  function retire(trail) {
    if (spare.length < 24) spare.push(trail);
  }

  function emit(trail, position) {
    const s = trail.segments[trail.cursor];
    trail.cursor = (trail.cursor + 1) % TRAIL.segments;
    // WRITTEN IN WORLD SPACE, ONCE. Nothing ever moves a segment again -- the
    // round flies away from it, which is the whole effect.
    //
    // The span runs from where the previous segment ENDED, so consecutive
    // segments share an endpoint and the ribbon has no gaps in it.
    s.ax = trail.last.x;
    s.ay = trail.last.y;
    s.az = trail.last.z;
    s.bx = position.x;
    s.by = position.y;
    s.bz = position.z;
    trail.last.x = position.x;
    trail.last.y = position.y;
    trail.last.z = position.z;
    s.age = 0;
    s.alive = true;
  }

  function age(trail, dt) {
    let anyAlive = false;
    for (const s of trail.segments) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= TRAIL.life) {
        s.alive = false;
        s.opacity = 0;
        continue;
      }
      s.width = trailWidth(s.age);
      s.opacity = trailOpacity(s.age);
      anyAlive = true;
    }
    return anyAlive;
  }

  return {
    live,
    orphans,

    update(dt, rounds) {
      // Emit for every round still in the air.
      for (const round of rounds) {
        let trail = live.get(round);
        if (!trail) {
          trail = borrow(round.owner, round.position);
          live.set(round, trail);
        }
        trail.since += dt;
        while (trail.since >= TRAIL_INTERVAL) {
          trail.since -= TRAIL_INTERVAL;
          emit(trail, round.position);
        }
      }

      // Any trail whose round has left the list is ORPHANED, not deleted: its
      // smoke keeps ageing where it was laid.
      for (const [round, trail] of live) {
        if (!rounds.includes(round)) {
          live.delete(round);
          orphans.push(trail);
        }
      }

      for (const trail of live.values()) age(trail, dt);
      for (let i = orphans.length - 1; i >= 0; i--) {
        if (!age(orphans[i], dt)) {
          retire(orphans[i]);
          orphans.splice(i, 1);
        }
      }
    },

    /** Every trail currently holding smoke, live rounds and orphans alike. */
    each(fn) {
      for (const trail of live.values()) fn(trail);
      for (const trail of orphans) fn(trail);
    },

    count() {
      let n = 0;
      this.each((t) => {
        for (const s of t.segments) if (s.alive) n++;
      });
      return n;
    },

    /**
     * PRESENTATION RESETS, GAMEPLAY DOES NOT (§17.11). A phase transition takes
     * the smoke; it does not touch a magazine, and it does not retire the round
     * that laid it -- missiles.expireOwner() is the only thing that does that.
     */
    clearFx() {
      for (const trail of live.values()) retire(trail);
      for (const trail of orphans) retire(trail);
      live.clear();
      orphans.length = 0;
    },
  };
}
