# Crit 5 — Operation Vector

## What was the breakthrough that moved the work forward?

Accepting that the no-tutorial rule was a design constraint, not an obstacle to
route around. I had more ideas than the brief could carry, and the discipline
was hiding them: the game is eight waypoints and a diamond, no lore, no
briefing, nothing to read. Everything that survived had to teach itself. The
catapult launch does the work — it demonstrates the throttle and the burner
before the player has touched anything — and the cursor steering is
understood in about a second because the aircraft is already at screen centre.

Technically the breakthrough was choosing where to spend. Real terrain, six
glTF models and a day/night cycle are expensive, so the ocean is cheap sine
waves rather than a simulation and the enemy AI is a small state machine. The
difficulty comes from the missiles, which genuinely track, not from the pilot
flying them — which keeps the game readable at 200 m/s and leaves the player
the part worth having: the joy of flying the thing.

## What did this work change about who I want to be as a software developer?

That directing an agent is a communication problem, and the harness is the
communication. The turns that went badly were the ones where I described a
symptom vaguely; the ones that went well were where the project's own rules —
the spec sections, the invariants, the checks — gave the agent enough structure
to reason from. The SAM that locked but never fired was diagnosed from a plain
description of the symptom, because the transition table was already the single
place a state could change: there was exactly one place to look.

I want to be the developer who invests in that structure first, and treats a
vague bug report as my failure rather than the tool's.
