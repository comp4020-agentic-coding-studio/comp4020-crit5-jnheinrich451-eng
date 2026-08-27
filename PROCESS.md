# Process overview

## What I built

**Operation Vector** — a browser flight game. You are catapulted off a carrier,
fly eight waypoints through contested terrain, and are recovered at sea. Five
pilots and five minutes; spend either and the run is lost. Two sandbox modes
reuse every system. No tutorial: the launch runs itself, the aircraft follows
the cursor, and the nav diamond says where to go.

## The moments that mattered

**Two waypoints vanished, and only one of them was a bug.** Shot down
approaching VALLEY, I respawned and the marker read RECOVERY — RIDGE and SEAWARD
skipped. The obvious move was to fix the respawn. Instead I reproduced it
headlessly (`mission.js` imports nothing, so the director runs in node) and
found two causes: the crash retreat drops the aircraft inside SEAWARD's volume,
which the next phase satisfies on its entry frame; and TERRAIN's 66-second
fallback expired every run, because the inland route takes over 75. The second
was not a bug being triggered — it was the normal path. So I deleted every
per-phase timer and let the five-minute deadline carry the no-soft-lock rule,
overriding `CLAUDE.md` §10 and rewriting it to match. That exposed a soft-lock
the timers had hidden, in a phase whose waypoint sat behind the player. Verified
by bot at three speeds: 121–181 s, all inside the deadline.
[`fdead5d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/fdead5d),
[`af9eb59`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/af9eb59)

**A SAM that locked but never fired.** The warning stayed up, out of range, for
the rest of the mission. I gave the agent the symptom, not a guess. It read the
transition table: `LAUNCH` returned `sam.launched ? RELOAD : LAUNCH`, and the
firing branch is gated on `rounds > 0` — so a spent site never set `launched`,
and the table returned `LAUNCH` forever. §13 already demanded that a spent site
never acquire; this was the same rule missing on the way *out*.
[`f335a03`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/f335a03)
