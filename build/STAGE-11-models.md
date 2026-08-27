# Stage 11 — Real airframes for the enemies

**Goal:** the hostile is an F-16C and every SAM site is a launcher standing on the
ground. No new systems, no new behaviour — two model substitutions.

Prerequisite: stage 10 green.

---

## What changes

```
src/enemy.js   HOSTILE_MODEL, normalizeHostileModel, loadHostileFighter,
               installHostileVisual
src/sam.js     SAM_MODEL, normalizeSamModel, loadSamLauncher, installSamVisual
src/main.js    both loads added to the existing Promise.all, both installs
               after it; failures pushed onto the existing fallback list
```

Nothing else. The drone's entity state, the transition tables, targeting, the gun,
the HUD bracket and the radar are untouched — which is the test of §4's
architecture, not a coincidence. If a model swap needs a change in `targeting.js`,
something published a mesh where it should have published the target contract.

```
F-16C          14.8 m length      2 per encounter, one reused instance
SAM launcher    6.9 m length      one prototype, cloned per site
```

Use the real 14.8 m. It is *shorter* than the player's 19.4 m F-15E, and that
reads correctly on a head-on pass — a smaller, lighter aeroplane. True figures pay
for themselves here.

---

## The four normalisation rules

Every one of these is a defect that shipped during this stage. They are in §2 of
the specification as well, because they are not specific to these two models.

### 1. Aircraft recentre on the centre; vehicles stand on the ground

```js
// aircraft — rotates about its middle
model.position.sub(boundingBoxCentre);

// vehicle — stands on its tracks
model.position.x -= centre.x;
model.position.z -= centre.z;
model.position.y -= box.min.y;      // bottom of the box at y = 0
```

A site's root sits at the sampled ground height. Reuse the aircraft rule on a
launcher and it is buried to its axles — which is invisible from directly above
and obvious from anywhere else.

### 2. Measure the yaw; do not eyeball it

The first pass set `modelYaw: Math.PI` on the F-16 and the hostile flew **tail
first** for an entire session. From a chase camera that reads as a strange-looking
aeroplane rather than as an obvious reversal, so looking at it is not a test.

Assert a node position instead. With the correction right, the canopy, pilot and
HUD glass end up forward on −Z and the rudder, engine and airbrakes aft:

```
canopy  z = −3.35        rudder  z = +6.48
```

Sketchfab sources arrive at whatever yaw the artist modelled at, so the number is
a property of the file. Measure it once, record what you measured, and leave it.

### 3. A merged source may have nothing to articulate

The launcher used here is a merged OBJ: **35 flat sibling meshes under one parent,
with no named turret, radar or rail node.** There is nothing to slew.

Do not guess which of 35 unnamed meshes rotates. Slew the **whole vehicle** on its
Y axis — honest to the asset, and correct for a trailer-mounted launcher, where
the rails come round to bear. Put the model *under* the existing turret node
rather than replacing it, so `samTransition`'s single write —

```js
site.turret.rotation.y = site.aimHeading;
```

— keeps working and the transition table never learns that the visual changed.

### 4. A model swap removes everything it replaces

The blockout's rails hang off the **turret**, not off the group, so removing the
group leaves them behind. The turret then drops to ground level and takes them
with it: they ended up buried 2.2 m under the launcher — present, invisible, and
impossible to attribute to anything.

Name the blockout's parts so the swap can find them, remove them explicitly, and
assert their absence afterwards.

---

## One consequence for the wreck rule

§13 requires a kill to leave a wreck in the world. `wreckSamSite` used to hide the
turret — which on a model-backed site is the *whole vehicle*, so it would delete
the evidence. Hide the turret only on the blockout:

```js
if (!site.modelBacked) site.turret.visible = false;
```

Assert both paths. This is the only rule change in the stage, and it exists
entirely because of rule 3 above.

---

## Test gate

Exercise the arithmetic with **synthetic sources**, so none of this needs a
loader, a network fetch or the real asset:

- The airframe scales to 14.8 m from measured bounds, and the scale is derived
  (`14.8 / longestAxis`) rather than authored
- The airframe's pivot lands on the bounding-box centre, not the source origin
- The launcher scales to 6.9 m and its bounding-box **bottom** sits at y = 0
- The launcher is centred on x/z, so it stands where the site stands
- The blockout's rails are findable by name before the swap and gone after it
- The hardpoint survives the swap
- The launcher is parented to the turret, and slewing the turret slews the model
- A destroyed **model-backed** site keeps its launcher visible
- A destroyed **blockout** site still loses its rails

Then check the load log. Both models report their measured source size, the
derived scale and the final dimensions — if the F-16 does not come out ~9.4 m
across at 14.8 m long, the source is not to scale and everything downstream is
guesswork.

---

## Runnable state

Fly an INTERCEPT and look at the hostile head-on. Fly the terrain leg and look at
a site from the side and from above. Kill one and look at the wreck.

That last one matters: geometry can be verified numerically, but "does it look
like an aeroplane" cannot, and a numerically perfect model can still be wrong.
