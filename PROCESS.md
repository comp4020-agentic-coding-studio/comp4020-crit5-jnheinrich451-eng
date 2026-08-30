# Process overview

## What I built

**Operation Vector** — a browser flight game. Catapult off a carrier, fly eight
waypoints through contested terrain, recover at sea. Five pilots and five
minutes; spend either and the run is lost. No tutorial: the launch runs itself,
the aircraft follows the cursor, the nav diamond says where to go.

## The moments that mattered

**Two waypoints vanished, and only one was a bug.** Shot down approaching
VALLEY, I respawned and the marker read RECOVERY — RIDGE and SEAWARD skipped.
The obvious move was to fix the respawn. Instead I reproduced it headlessly
(`mission.js` imports nothing, so the director runs in node) and found TERRAIN's
66-second fallback expired every run — the inland route takes over 75. That was
not a bug being triggered; it was the normal path. So I deleted every per-phase
timer and let the five-minute deadline carry the no-soft-lock rule, overriding
`CLAUDE.md` §10 and rewriting it to match. Bot-verified at three speeds:
121–181 s, all inside the deadline.
[`fdead5d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/fdead5d),
[`af9eb59`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/af9eb59)

**A SAM that locked but never fired.** I gave the agent the symptom, not a
guess. It read the transition table: `LAUNCH` returned
`sam.launched ? RELOAD : LAUNCH`, and firing is gated on `rounds > 0` — so a
spent site never set `launched`, and the table returned `LAUNCH` forever. §13
already demanded a spent site never acquire; the rule was missing on the way
*out*.
[`f335a03`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/f335a03)

**The phone screenshots were lying.** Fixing the 390×844 viewport, I reported an
element clipped at the right edge. It was never clipped: Chrome clamps a
headless window to a minimum, renders at *that* size, then crops the PNG to what
you asked for — so every "390×844" picture was a 500×693 layout in the right
shape. Measuring the element instead of believing the image found it, and the
harness moved onto `Emulation.setDeviceMetricsOverride`, the page now printing
its own `innerWidth` beside every shot. The real defect was invisible in CSS:
three.js's `fov` is *vertical*, so portrait showed ~34° across — the aircraft
filled the frame, and nothing looked broken.
[`0633e03`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-jnheinrich451-eng/commit/0633e03)
