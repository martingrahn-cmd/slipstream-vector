# STATUS.md — where Slipstream Vector actually is

Written 2026-07-28 at commit `acec5c8`; refreshed 2026-08-01 at `0f80eae`,
131 commits in. This is the honest board: what is **built and verified**, what
is **open**, and what is **an idea nobody has committed to**. It is deliberately separate from `README.md` (which
describes the game as it exists to a player) and from `FIDELITY.md` /
`TERRAIN.md` (which are design records for one system each).

The rule for this file: **nothing goes in DONE that hasn't been driven or
measured.** If it was written but not verified, it belongs in OPEN.

---

## 1. Done — the game is content-complete and playable end to end

Live at <https://martingrahn-cmd.github.io/slipstream-vector/>, public repo, no
build step.

### Content
- **12 circuits across 4 worlds** — Sunset Mesa (Sunset Circuit / Mesa Run /
  Dune Drift), Palm Coast (Lagoon Pass / Coral Keys / Breaker Bay), Neon Sprawl
  (Orbital Ring / Skyline Rush / Grid Lock), Frostfall Ridge (Aurora Pass /
  Avalanche Run / Moonlit Mile).
- **Two 6-round championships** — VECTOR CUP (the classic calendar) and AURORA
  CUP (the newer circuits, finishing under the northern lights). Per-cup saves
  and resume.
- **4 teams / 8 pilots**, one livery per pilot, portraits + expression faces +
  intro videos, 172 voice clips over a radio-comms chain.
- **31 trophies** (15 bronze · 10 silver · 5 gold · 1 platinum), each shown in
  the gallery as a rendered object rather than an emoji; persisted records per
  track *and* per game mode.
- **Stunt kit** — loops, corkscrews and jumps as track-file data (`features`).

### Systems
- **Spline-domain physics** at a 120 Hz fixed step, seeded RNG, no colliders.
- **No rubber-banding, by construction.** Difficulty raises driver skill only;
  ship stats live on the hull, so an AI in a Razorback drives exactly what the
  player would. Catch-up is slipstream, identical for both.
- **Five weapons** (missiles / boost / mine / shield / homing) with a weighted
  pickup table that never looks at race position, and an AI fire policy that is
  skill-gated, never position-gated.
- **Three game modes** — Championship, Single Race, Time Trial (with a ghost).
- **"THE BAY" console menu** — 9 nav sections, fully clickable *and* fully
  gamepad-navigable, live key rebinding, circuit dossiers with route map and
  elevation trace, a live 3D garage, a 3D podium ceremony.
- **Audio** — procedural Web Audio beds (engine/wind/shield/scrape) that follow
  game state per frame, a baked ElevenLabs one-shot layer on top, and Martin's
  own five-track Suno soundtrack.
- **Credits screen** (nav 09) with the roster generated from the game's own data.

### Graphics work that has landed
- **Quality tiers** LOW / MEDIUM / FULL / ULTRA + ADAPTIVE, budgeted by
  **pixels**, not by a bare pixelRatio.
- **Post chain** — quarter-res bloom, light shafts, one JuicePass on a 2×MSAA
  HalfFloat target. The grade/vignette/dither now runs on *every* tier.
- **The world got inhabited** — grandstands with reactive crowds and camera
  flashes, wind sway on every plant on all twelve tracks, ground relief with
  contact shading, weathered rock forms, aurora rebuilt as curtains.
- **Per-vertex flat shading** everywhere, bake direction now derived from each
  world's own sun.
- **The effects came off the leash** (2026-07-30) once the additive layer was
  measured and found to cost ~0.05 of a fill: LOW got its particles back, hits
  and explosions got a staggered fireball plus shock rings, sparks became
  stretched slivers thrown from the real contact point.
- **Palm Coast got planted properly.** Every scatterer now stands on
  `groundAt()` / the island height field instead of the flat `groundY` — palms,
  rocks, scrub, mooring posts, beaches, billboards, the start gantry and the
  grandstands were each, separately, standing in the lagoon or floating.
- **The landmark works.** The lighthouse beam had never drawn: its shader
  failed to compile the moment fog was switched on. It now sweeps, fades along
  its length and flashes when it swings at you, with a lamp flare that carries
  the sweep in daylight.

### Tooling and gates
- `tools/audit-tracks.mjs` — surface-accurate self-intersection audit (3.5 m
  bar). **Currently 0 tracks failing.**
- `tools/audit-terrain.mjs` — measures terrain *intrusion* beside the racing
  line. **Currently 0.000 m on all 12.**
- `tools/audit-adaptive.mjs` — the ADAPTIVE quality controller against synthetic
  frame-time traces. **Currently all clear.** Invariant: a tier drop must be
  evidence about steady-state rendering speed, not about one bad moment. §2.6f.
- `tools/audit-overdraw.mjs` — exact fragment count of the additive layer, per
  track and per tier. **Measured 2026-07-29: ~0.05 of one screen fill, worst
  frame 0.175** — the transparent effects are not a cost. `FIDELITY.md` §5a.
- `tools/audit-pads.mjs` — weapon-pad pickup distribution. **Measured
  2026-07-29 over 238 pickups: the roll is per driver and matches the WEIGHTS
  table.** A pack crossing one pad does *not* share a weapon; see §2.5.
- `tools/press-shots.mjs` — 3 in-engine shots per circuit, scored off the
  spline, captions burned in.
- `tools/generate-voices.mjs` / `generate-sfx.mjs` — idempotent ElevenLabs
  batches driven by a manifest.
- Six standalone `*-lab.html` tools (atmosphere, ships, fleet/livery, pilot
  expressions + voices, weapon icons, SFX).

---

## 2. Open — known, real, and unfinished

### 2.1 BUG — fixed and CONFIRMED (2026-07-29)
Martin drove it on hardware: the band is gone. This section is kept as the
record of the diagnosis, not as an open item.

The minimum-pixel-width shader added in `be8ac30` rewrote `gl_Position` from
screen space for **every** vertex, reconstructing clip-space xy through the
strip *centre's* `w`. That reconstruction is only valid well in front of the
camera — and the strips run right past the camera every frame. The result was a
solid slab of neon painted across the screen, on every track and every tier.

Reproduced headless on all four worlds. Proven to be the strips, and proven not
to be the pixel floor: with the floor set to zero the band *survived*, so the
floor was innocent and the screen-space reconstruction was the fault. The guard
fix — keep the true edge vertex as the baseline, and only substitute the widened
position when the vertex is safely in front of the camera *and* genuinely under
the floor — clears the band at the same warp point on the worst case, with the
far strips still holding as continuous lines.

Confirmed clean on an M5 MacBook Air, two laps of Moonlit Mile at ULTRA. If
streaks ever reappear they are a *different* artefact and want a fresh
screenshot rather than more theorising about this one.

### 2.2 Verification the author owes himself
- **Trademark search on the name "Slipstream Vector"** before any commercial
  step. Nobody has done this.
- **Current commercial-use and attribution terms for Suno, ElevenLabs and
  xAI/Grok.** The credits screen states the assets were produced with those
  services and used under their own terms; that wording is a placeholder for a
  real reading of the current terms, not a substitute for it. three.js (MIT)
  and the SIL fonts are verified and quoted from the packages.

### 2.3 Measured but unanswered
- **Does ULTRA hold 60fps on an M4 with a 4K panel?** The rung exists at 8.3 Mpx
  (exactly 4K native) and ADAPTIVE deliberately cannot climb into it. If it
  holds, FULL's pixel budget is provably too conservative — the cap was set for
  4× MSAA and never moved when MSAA became 2×. See `FIDELITY.md` §2a.

  **Partial evidence, 2026-07-29:** ULTRA held 60fps for two laps of Moonlit
  Mile on an **M5 MacBook Air** — fanless, so that includes thermal drift. It
  does *not* settle the question. `effectiveRatio` takes `min(pixelRatio,
  sqrt(maxPixels / cssArea))`, and FULL and ULTRA share `pixelRatio: 2.0`; on a
  laptop-sized window the RATIO binds first, so ULTRA never gets near its
  8.3 Mpx budget. How near it got depends on that window's CSS size, which
  nobody recorded. The 4K case is still open, and it still needs the M4.

### 2.4 Small and unglamorous
- **Press kit is stale, and getting staler.** The 36 shots predate the ground
  relief, the aurora rewrite and the grandstands — and now also the whole city
  pass (skyline, wall lighting, window grids, three sign types, street lamps),
  the frost hills, and the city storm (driving rain, forked lightning, the fog
  wash). Regenerate with `node tools/press-shots.mjs --jpeg` (output is
  gitignored on purpose). Worth doing AFTER `ART.md` §7 steps 1-2, not before:
  the frost palette is about to change every frost frame.
- **More lengthwise road slicing on stunts.** `SLICE_STEP` is uniform, but loops
  and corkscrews are where faceting shows and where the camera lingers.
  Costs geometry, which is the axis with headroom. `FIDELITY.md` §4.4.
- **Credits: "AMANDUS" has no surname** because nobody supplied one.

### 2.5 Weapon pickups are unreadable, and it reads as a bug
Martin, in play: *"if you go over a pad in a pack, does the whole field get that
power-up? It looks like everyone gets a shield."*

Measured (`tools/audit-pads.mjs`, 238 pickups over 3 tracks): **no.** Every
racer that crosses gets an INDEPENDENT roll — `_roll()` is called per ship in
`stepFixed`'s pickup loop — and the outcome distribution sits on the WEIGHTS
table within noise. Of 60 multi-ship crossings, 6 came out all-same, all of them
pairs or triples; two ships matching by chance is a 21% event on this table.
Every large crossing was mixed (one real seven-ship pad gave *boost, missiles,
homing, boost, boost, homing, boost*).

But the observation was accurate, and the run caught the exact frame that
provokes it — Moonlit Mile, one pad, six ships: *shield, boost, missiles,
**shield, shield, shield***. Four bubbles inside a second. The cause is
readability, not fairness:

- **Shield is the only pickup you can see.** Missiles, homing, mine and boost
  are invisible until used, so a random cluster of shields is the only clustering
  that is ever *observable*.
- **The AI armours up instantly** (`want = true` the moment it holds one), which
  is rational rather than careless: `WEAPON_HOLD_TIME` is 6s, so a saved shield
  is usually a lost shield. Changing that means reopening the fizzle rule.

The cheap fix is neither the roll nor the AI: put the held weapon on rival ships
(a small glyph, or an engine-tone tell) so the other four outcomes become
visible too.

**Martin's design call (2026-07-30): no tell on the ships.** This is decided,
not pending — do not re-propose it. The effects budget went into hits,
explosions and boost instead. If the readability question ever comes back it
wants a different answer than a glyph on a hull.

### 2.6a Art notes Martin raised
- **Mountains "mera bergslika".** They were literally four-sided cones —
  pyramids — and are now angular lobed massifs. **Martin passed them
  2026-08-01**; this one is closed.
- **Island shapes "väldigt enkla på vissa ställen"** (2026-08-01). The
  diagnosis was not the silhouette of any one island: the three archetype
  factories took no arguments, so a lagoon of ~50 islands was three geometries
  repeated, and two of the three were a plain cone and a plain frustum, which a
  random Y spin cannot disguise. They take the world rng now — lobes, phase,
  bays, lean and summits are per island — and the cone and frustum became a
  blade-footed promontory with a cliff flank and a lobed two-humped sandbar.
  Unconfirmed on hardware.

### 2.6b Track lamps: SOLVED as a diagnosis, tuning in progress
Street lighting along the ribbon — masts, arms over the road, warm heads and a
soft cone each, evenly spaced for rhythm. Now IN the game, at a deliberately
conservative first intensity, while a readability pass is chosen.

The full history, so nobody re-derives it:
- **Placement is correct.** `tools/audit-props.mjs` reports the lamps at
  lateral median 0.0m from the road edge, height median 7.9m, 100% within 40m.
- **A plain `clearOfTrack()` rejects most of them** on a curved circuit: it
  tests every spline sample including the neighbours of the lamp's own section,
  and inside a corner those are closer than the margin. Fixed with the same
  arc-length exclusion `buildCanyon` uses.
- **An additive material with `fog: true` is a real bug**, fixed: fog mixes the
  colour toward the fog colour BEFORE it is added, so a warm lamp in a
  pink-fogged world adds haze instead of light. 21 of the 23 glow materials in
  scenery.js are `fog: false`; this one was not.
- **The "still invisible" verdict was wrong.** `tools/audit-visibility.mjs`
  (written for this) pixel-diffs a scenery child in and out of the frame with
  an animation-noise floor — the city RAINS, 20% of the frame changes every
  frame, so it isolates the child and averages 4 frames per state. Result: the
  lamps contribute 3.7% of the frame at mean luma delta 55 against a noise
  floor of 17, with the heatmap showing the cone row marching down the road.
  **They render and always did.** What remains is READABILITY: 0.34-opacity
  warm-white is camouflage against a skyline of warm windows, and the cones
  stop 2.6m above the road so the light never grips the asphalt.
- The readability pass is CHOSEN and shipped: four candidates (hotter heads /
  road pools / gantry underglow / grounded cones) were rendered as runtime
  variants from one parked camera. Grounding won — pools collapse to 2-6px at
  this camera height, underglow does not read, intensity alone flares. The
  shipped cone points the RIGHT way — narrow at the lamp, wide on the road.
  An intermediate version shipped it inverted (the correct orientation has a
  hard base rim at road level, and fading the rim faded the road contact with
  it); Martin caught the upside-down lamp from a screenshot. The fix is the
  lighthouse beam's recipe: a separate cone mesh with normals kept, fragment
  shader fading toward the SILHOUETTE (normal dot view) so the rim dissolves
  while the core stays lit to the ground. Contribution rose from mean delta 73
  to 155 on the same parked camera — the correct orientation reads STRONGER
  once the edge is handled properly. Intensity graded per vertex (additive RGB
  is alpha), amber against the magenta city, heads near-white at 1.1 kissing
  the bloom threshold, near-camera fade within 7-34m guarding the fill budget.

### 2.6c World 4 polish (in progress)
The snow pass is IN: moon glitter (distance-faded twinkle cells) and cold
hollows (relief tinted toward the shadow blue) in the dune shader's uSnow mode,
scrub blotches off on snow. Verified by before/after press pairs on all three
frost tracks — reads as sparkle and tonal variation in stills, twinkles in
motion.

**Hills landed too** (2026-08-03, `f8cab68`): frost terrain amp 17 -> 30, freq
0.0048 -> 0.0040, after Martin said the snow tracks were basically flat.
Measured relief near the road 12.8m -> 22.8m on all three, intrusion still
0.000m on all twelve. `TERRAIN.md` carries the record.

**And it still was not rolling — that took a different lever entirely.**
Martin, from the cockpit: the hills *"ser ut som en stor sten"*. Raising `amp`
had not helped because relief is not one number: the octave gain decides how
the height budget is spent, and at 0.48 the first octave took 58% of it, so
frost had 17.5m of its 30 in a single ~250m wave. Four octaves at gain 0.66
spread the same 30m across ~250/117/55/26m. Plus `RAMP_TO` 95 -> 72 so the
relief arrives inside the band the chase camera frames, and companion forms
round every large mass so a big rock has something small beside it to be big
against. **CONFIRMED ON HARDWARE 2026-08-05 — "böljande marken är klar".**
`ART.md` §10 and `TERRAIN.md` carry the record.

**STILL OPEN, but the diagnosis changed (2026-08-05, `ART.md` §3 B4).** The
near cliff faces (horizonMask ridge walls and rockCut) still read as flat pale
slabs — the "paper" complaint stands. But it is **not primarily geometry**, and
it is **not a separate problem from Martin's "grådaskig" snow**. Both are the
frost palette: `scenery.js:385` passes `theme.warm` and `theme.ground` straight
into `bakeFlatColors` as the LIT and SHADOW tints of every default-shaded prop
in the world, and on frost those are `0xdfe9ff` (chroma 0.125, and *bluer* than
the base) and `0xc7d4e8` (chroma 0.129). Both ends of every prop's shading are
the same near-neutral blue, so no face on any cliff has a temperature
difference from any other. Frost carries 0.16 chroma against 0.39-0.57 in every
other world, and its grade saturation is 0.96 — the only world under 1.0.

**Both shipped 2026-08-05** (`ART.md` §9). The palette now runs a temperature
split — `ground` 216° -> 222° blue at chroma 0.306, `warm` 221° -> **35°**, so
the highlight finally opposes the shadow instead of being bluer than it — plus
`grade.saturation` 0.96 -> 1.10. Measured at identical framing on Moonlit Mile:
snow chroma **0.161 -> 0.271**, tonal spread **0.15 -> 0.27**, luma 0.59 ->
0.51. Two of three `ART.md` §8 targets met; chroma fell 0.03 short of 0.30 and
that is recorded rather than rounded away.

The aurora also lights the ground now, on the sky curtains' own amplitude curve
— green excess swings **-0.029 -> +0.090** at full strength, one uniform, zero
draws.

Because `ground` and `warm` are `setBakeTheme`'s shadow and lit tints, this
relit every prop in the world in the same stroke, cliff faces included.
**Unconfirmed on hardware** — the "paper" complaint should be re-judged by
Martin's eye before it is called closed.

### 2.6d Neon Sprawl races in a storm now (2026-08-05) — DONE, one thing unpriced
**Still owed: `node tools/audit-overdraw.mjs 6,7,8` on real hardware.** The rain
went from 170 additive streaks to 1000 and nothing else about it changed — one
instanced draw, camera-local so it cannot grow with lap length. That is a pure
FILL change and fill is the ceiling, so it wants the measuring stick before
anyone claims it is free. It could not be run here: this container has only a
software rasterizer and a single 480x270 sample did not finish in 15 minutes,
where the tool is a 2-3 minute job on a real GPU. Do not quote a number for
this until it has been run — §5a of `FIDELITY.md` records that guessing at the
additive layer has already been wrong in both directions.

Martin asked what was left on the city circuits and whether it thundered or
rained there. It did both, and both were half-built. All three city tracks
share the `city` theme, so this lands on Orbital Ring, Skyline Rush and Grid
Lock at once, and on nothing else.

**The rain was there and it was invisible.** `buildMotes` seeded rain's 170
streaks along the WHOLE lap — the exact bug the SNOW was fixed for, described
in a comment in that same function, never applied to the rain. Measured on Grid
Lock (3455m): **4 streaks within 30m of the camera, 9 within 60m**, and a press
frame with exactly ONE in it. It now uses the same camera-local wrap box, at
1000 streaks in a 58m box: **171 within 30m, 789 within 60m, nearest 4m** —
and still **one draw call**, because the count is instanced and thinning it is
a live `count` write. Streaks scale in LENGTH only; scaling a drop uniformly
fattens it into a mote and the geometry is a streak for a reason.

**The lightning was a dome-wide blink with no bolt and no sound.** Three
changes, all of them in the "make it read" direction:
- **A forked channel** is drawn in the sky fragment shader, using the meteor's
  idiom: the dome is `renderOrder -1` with no depth write, so the skyline
  occludes the bolt for free and correctly, at **zero draws**. Triangle waves,
  not sines — a lightning channel is straight runs meeting at hard kinks, and a
  sum of sines only ever gives you a wiggle. One fork peels off at 40% and dies
  short of the ground. Every strike gets a fresh shape seed.
- **The world answers.** The dome wash is now biased toward the strike's
  bearing (a dome lit evenly reads as a fade, not as a bolt going off over
  there), and `main.js` lerps the **fog colour** pale for the duration —
  everything at distance is fogged, so that lights the whole skyline, the
  towers and the far road at once, again for zero draws. Deliberately NOT
  routed through `juice`: a weapon-hit flash is gameplay language and the
  weather must not borrow it.
- **Thunder.** Two ElevenLabs clips (`thunder-far` 5s, `thunder-near` 4s) fired
  at the sound's own travel time — `dist / 343`, up to four seconds — with a
  distance low-pass, because air eats the top end long before the bottom. You
  see the bolt and the boom lands later; that gap is most of what makes it read
  as weather. `_playClip` grew `delay` and `lp` options for it. Full synth
  fallback if the clips are missing, same as every other one-shot.

**The strike rate was per FRAME.** `Math.random() < 0.004` inside `update()`
meant the storm was twice as busy at 120fps as at 60 — the weather quietly
tracked your frame rate. It is now a per-second rate against a clamped derived
dt (`update()` only ever receives absolute time). Measured by stepping
`scenery.update` by hand over 300 simulated seconds at each rate: **0.180
strikes/s at 60fps, 0.187/s at 120fps** (54 and 56 strikes) — the same storm,
which is the whole point. Mean gap 5.4s.

Magnitude and distance are ONE roll, not two: the bright strikes ARE the close
ones. They were independent at first, which let a dim little bolt land 200m
away while a blinder went off a mile out. The first cut then drew magnitude as
a product of two uniforms and measured **0 close strikes in 110** — the near
crack would have been roughly one a race with the variance to miss whole races,
i.e. the dramatic half of the effect on a coin flip. A squared uniform gives
mean magnitude 0.333, mean distance 1001m (2.9s of thunder delay) and **14.3%
close strikes** over 200k samples — 3-4 a race.

### 2.6e Four bugs found and fixed (2026-08-05) — kept as the record
Found by reading, not by play. Kept here for the same reason §2.1 is: the
diagnosis is worth more than the fix.

- **A lap went missing below 1 m/s.** The lap test was gated on
  `v > 1 && prevS > 0.8L && s < 0.2L`. Cross the line slower — brake to walking
  pace, or take a wall hit at the line while a weapon disable holds the
  throttle shut — and `s` wrapped while `lap` did not. `race.progressOf` is
  `lap * length + s`, so progress fell by a WHOLE LAP and never recovered: you
  show up last and `lap` can no longer reach `totalLaps + 1`, so **the race
  cannot be finished**. Measured on a 3000m track: progress 5980 -> 3001. A lap
  IS a wrap of `s`, so the test is now just `s < prevS`. Guarded by
  `tools/audit-laps.mjs`.
- **Contact went soft after every retry.** `race.interact` stamps a per-pair
  cooldown with `this.clock`; `grid()` restarts the clock but never cleared the
  map, so every pair that shunted in the previous race carried a future-dated
  stamp into the next one and could not register a hard hit until the clock
  passed it. `buildWorld` makes a fresh `Race` on a track change, so only
  RETRY was affected — which is why it survived.
- **A dead event in the fixed step.** `shipPhysics` emitted `weaponPad` on
  every crossing for every ship and nothing in the repo listened; the
  WeaponSystem polls the latch instead. Removed — it was also a trap, since
  wiring a listener would have armed a second weapon on top of the poll.
- **`setMoteDensity` clamped only downward**, so a factor above 1 would read
  past the instance buffer. Latent — every tier passes 1.

### 2.6f ADAPTIVE was measuring the weather, not the machine (2026-08-06) — FIXED
Reported from an M4 Mac mini, 24GB, which had never run below FULL: *"NU KÄKADE
DET PRESTANDA, GICK NER TILL LOW"*. Nothing in the renderer had got slower — the
build that was actually live was a day old, since the Pages deploy for the tier
above it had timed out. The controller was the bug, in two places, and both were
lines that could never execute:

- **The frame time it judged on was clamped.** `tick()` computes
  `realDt = Math.min((now - last) / 1000, 0.05)`, correctly, so a hitch cannot
  fling the ship down the road — and that clamped value was handed straight to
  `adaptive.sample()`. Its own hitch guard is `if (dtMs > 250) return null`,
  written to throw exactly those frames away, and against a 50ms clamp it was
  unreachable. Every stall of every length arrived as a clean 50ms, and a run of
  them reads as a machine sitting at a rock-steady 20fps. Six seconds of
  ordinary browser jank cost both rungs.
- **The ceiling could never rise.** The probe that re-opens a tier sat below
  `if (!allowClimb) return null`, and the call site always passes
  `allowClimb=false` — climbs are deliberately parked and cashed at the next
  race start so the picture never changes mid-corner. So once the ceiling fell
  there was no path back short of opening OPTIONS. That had been true for the
  whole life of the mode.

Fixed: the controller is fed `rawDt`; the EMA is updated *after* the hold check
(it was above it, so the render-target reallocation and shader recompile that a
tier change CAUSES were fed into the average that judged the next one); a drop
needs 0.75s of sustained sub-threshold reading rather than one EMA crossing; a
hitch STREAK of 20 still converts into evidence, so a genuine 3fps machine can
drop; the ceiling no longer falls on a tier's FIRST failure, because six bad
seconds and a machine that truly cannot render the tier look identical from in
there and only one of them repeats; the reopen probe scales 20s → 60s → closed
with the failure count, so a machine that genuinely cannot hold FULL stops
climbing back into it after three attempts; and a new circuit clears the
evidence, since a city night in the rain says nothing about a daylight desert.

Guarded by `tools/audit-adaptive.mjs`, which reproduces the shipped drop path
verbatim so the regression is demonstrated rather than asserted: the old code
lands on LOW after a jank burst and is still there after a clean race, the new
code holds FULL or recovers in one. Verified in-browser too — the module the
page actually loads gives the same three answers. `__game.adaptive` now exposes
the controller (`fails`, `ceiling`) so "why is it on LOW" is answerable, and a
tier change logs `[gfx] ADAPTIVE FULL → MEDIUM (measured 41.2 fps)`.

**Still unmeasured:** whether anything in the last two merges is genuinely
heavier. The prime suspects are all on the fill axis — the ground shader gained
sastrugi, an aurora bounce and `uDim`, all per-fragment on a disc covering most
of the screen; rocks went from 2.4m to 5.6m; city rain went 170 → 1000
instances. `tools/audit-overdraw.mjs` on real hardware is what settles it (and
see FIDELITY.md §5a — that debt is already owed).

### 2.6g Hardware round two (2026-08-06): the streaks, the tjuff, and 47 fps
Three reports from the M4 after the ADAPTIVE fix went live, two fixed, one OPEN.

- **The slanted streaks toward the lower left are the sun shafts — again.**
  `af4b576` (July 28) killed the "ribbed chain behind the ship" by capping the
  march and fading by the DESTINATION pixel's distance from the sun. Not
  enough: the shaft input is the bloom bright pass, which carries every lane
  dash and neon strip in the frame, so a white dash mid-frame still seeded a
  0.30-UV pale streak of itself pointing at the sun. Martin's screenshot at
  1 km/h is the same diagnostic that convicted shafts the first time — the
  speed smear is zero at standstill. Fixed at the SOURCE side: each tap is now
  weighted by ITS OWN distance to the sun (`1 - smoothstep(0.12, 0.42, sd)`),
  so only light actually near the sun casts rays. Rays near the sun are
  untouched; a dash far from it contributes nothing, so it cannot streak.
- **The tjuff had one more leg to travel: the listener's audio chain.** The
  arch thump was verified 6-40ms against the CAMERA — but that is when the
  sound is HANDED TO THE BROWSER, not when it reaches an ear. Wired output
  adds ~10ms; a monitor's HDMI speakers 20-80ms; **Bluetooth 150-300ms**,
  which is bigger than the camera desync the trigger was rebuilt to fix. The
  context reports what it knows (`ctx.outputLatency + baseLatency`, exposed as
  `audio.outputLat()`), and the trigger now leads the camera cursor by the
  distance covered in that time. Wired, the lead is under a metre — inside
  the window already verified. Caveat: Safari does not report outputLatency,
  so a Safari + Bluetooth player is still late and nothing in JS can know by
  how much. If it still misses for Martin, ask what he listens through — the
  answer decides whether the next move is a manual AV-offset slider.
- **OPEN — 47-49 fps at MEDIUM on the desert is anomalous and now honest.**
  The fps readout divided frames by a sum of sim-CLAMPED dts, so every hitch
  counted as 50ms no matter how long it was — the readout flattered exactly
  the machines that were struggling (same clamp, same lesson as ADAPTIVE).
  Fixed: it accumulates raw time now. But the number itself is the mystery:
  MEDIUM measured a locked 60 on an M4 in July, and nothing in the recent
  merges prices out at 20% of a frame. The discriminating test, in OPTIONS:
  **LOW for one lap.** LOW ≈ 60 → the cost is in the post/fill side and the
  recent suspects (shafts, heat, bloom at MEDIUM) get priced on hardware.
  LOW ≈ 48 → it is not the renderer at all — CPU, browser, or machine — and
  the `[gfx]` console lines plus honest fps are the evidence to collect.

### 2.6h "Det är sekunder" — the tjuff was not late, the RINGS were silent (2026-08-06)
Martin, after the outputLat fix: same wrong-by-seconds sound on TWO devices.
Seconds ruled out every latency theory at once — the output chain is 0.3s at
its Bluetooth worst, the camera gap 213ms — and two devices ruled out the
hardware. Nothing in the code can schedule a desert sound seconds late; Web
Audio is sample-accurate. So the sound was ON TIME. The pairing was wrong.

The game is full of structures you fly THROUGH, and only one class of them
had a voice. `buildHoloRings` puts a glowing cyan hoop — the most obviously
"drive-through" object in the game — every 200m of straight on EVERY track,
silent. The start gantry: silent. Sign gantries (city, every ≥300m): silent.
Bridge decks: silent. Only the arch ribs thumped, and they begin 205m after
the start line (`LAUNCH_CLEAR`). Measured on Sunset Circuit: ring at s=0,
ring at s=200, first rib at s=205. The ear pairs a thump with the nearest
plausible structure, so every silent ring "borrowed" the next rib section's
sound — 200m at racing speed is exactly the reported few seconds, identical
on every machine because it is geometry, not latency.

Fix: `scenery.thumpS` — every pass-under's arc length with its kind — and
`audio.archPass(sn, kind)` gives each class its own voice: holo ring = thin
electric swish (mass-less, no low end), rib = the tjuff, span (gantry/sign
gantry/bridge) = heavier whoomp with a low sine under it. The start gantry
whoomps at the line every lap. Structures can stack (Orbital Ring anchors a
ring, a sign gantry and a bridge at one s), so the list sorts heaviest-first
at equal s — the 45ms rate floor keeps the first of a cluster, and that
should be the span, not the hologram. Verified in-browser: Sunset Circuit
33 pass-unders (10 rings / 22 ribs / 1 span), Orbital Ring 64 (11/40/13),
zero console errors.

The lesson for the next feel event: **when a sound seems mistimed, first ask
what the player thinks it is timed TO.** The trigger fired exactly when
designed, at the thing the designer knew about; the player was looking at a
thing the sound system had never heard of.

### 2.6i A rock on the road, and the swish gets a voice worth hearing (2026-08-06)
- **"Nu kommer det in någon sten på banan."** `buildRocks` placed against its
  OWN spline section and never tested the rest of the centreline — and the
  loop crosses over itself, so a spot a safe 20m from section A can sit dead
  on section B. The stands have footprint-tested the whole centreline since
  they landed, for exactly this reason; the rocks got away without it only
  while they were 2.4m litter. Step 6 made them 5.6m and clustered, and the
  odds caught up. Fixed with the same `clearOfTrack` bar the companions use —
  the local formula's minimum (5m + 1.6x size beyond the edge) enforced
  against EVERY section, drop after eight failed tries. Measured in-page on
  all twelve circuits: desert and frost worst case is now 5.3m+ of clearance;
  the city has no rocks. The WATER worlds still show rocks inside the road
  corridor in XZ — deliberately exempt: those are the island-reef path, and
  the road there runs on stilts above them (vertical separation an XZ test
  cannot see). If a reef rock ever pokes through a low deck, that is its own
  report and needs a height-aware test, not this one.
- **The holo swish was authored too quiet to survive the mix** — about half
  the rib tjuff's level, against an engine, wind and music that all live in
  its band. Raised ~1.7x and lengthened 50→65ms. The lesson from the LOW-tier
  grade applies to audio too: a layer you cannot perceive is not subtle, it
  is absent.
- Testing note: GitHub Pages serves with `max-age=600` — up to TEN MINUTES of
  stale modules after a deploy. A "still broken" report inside that window may
  be running the previous build; hard-reload before concluding anything.

### 2.6j The start-of-session dip, and the trigger is proven — what remains is the ear (2026-08-07)
Martin's console, first session on the honest controller: `FULL → MEDIUM
(measured 37.6 fps)`, then `MEDIUM → LOW (measured 36.4)`. **The drop bought
nothing** — 40% of the pixels gone, fps unchanged — which is the signature of
a load tiers do not govern. And it was a TIME TRIAL: no pack on screen, which
acquits the field. What is left is the browser itself warming up: Safari
compiles a Metal pipeline for each material/effect the first time it draws,
spike by spike through the first minute, and "efter en stund kan man vrida
upp det till ultra utan problem" is exactly what a warmed shader cache feels
like. The crowd's close-mode was priced and acquitted (a sine and two writes
per seat; microseconds).

Done about it:
- `adaptive.reset(idx, hold)` — the race-start hold is now 8s (launch is the
  worst moment by construction), 15s for the FIRST race of a session (the
  pipeline-compile window). Those seconds are real to play, but they are not
  evidence about steady-state speed, which is all a tier change can fix.
- Every DROP now logs the frame-time p50/p95 of its evidence window:
  `[gfx] ADAPTIVE FULL → MEDIUM (measured 37.6 fps, frame p50 17.1ms / p95
  64.0ms)`. Healthy median + spiky p95 = warming, not slow. The next "it
  dropped" report carries its own diagnosis.
- Every pass-under fire logs `[thump] RING|RIBBA|SPANN s=... cam=... v=...`.

**The trigger is now PROVEN, not argued**: a real-rAF drive (not `warp` — the
trigger lives in the render loop) on Sunset Circuit fired all 22 ribs exactly
once at -0.4..+2.7m of the camera cursor, rings the same, no phantoms, at
12fps in SwiftShader — on 60fps hardware that is ±1m ≈ ±15ms. (SPANN fired
zero times in the probe and that is CORRECT: the grid sits just past the
line, so the gantry first thumps when you complete lap 1; the probe's 150s
did not finish a lap in software GL.)

So if the sounds still feel wrong, the remaining suspects are OUTSIDE the
trigger, and the [thump] log splits them: watch the console while passing a
ring — if the LINE appears at the visual pass but the SOUND trails the line,
it is the output chain (Safari reports no outputLatency, so HDMI-monitor
speakers or Bluetooth are invisible to the lead compensation) and the fix is
a manual AV-offset slider in OPTIONS. If line and sound land together but
feel wrong, it is sound design, not timing. Also worth knowing: in a PRIVATE
window localStorage dies with the session, so common trophies re-unlock and
their mid-race jingle fires every test run — one more sound that "comes when
it shouldn't" without being any track structure.

### 2.6k Martin finds it: the ribs nobody could see (2026-08-07) — FIXED
With the [thump] log on screen he asked the question that closed the case:
*"kan det vara ribbor vi har som inte syns i spelet? t ex när vägen delar
sig?"* Exactly right. `buildArches` picked its straights on curvature alone
and never asked whether the road was WHOLE — and a split section's
centreline runs through the median island, so the ribs it placed there were
real, thumped on the trigger (his console: RIBBA s=600-739, no ribs in
sight), and were invisible from either half of the road. The trigger was
proven correct in 2.6j; the SOUND was honest; the BUILD LIST lied. Every
"the sound comes when it shouldn't" report back to the first one is this.

Fix: ribs and holo rings now require whole road — `splitHalfAt(s±14) <= 0.01`
and no `gapAt(s±10)` — same shape as the stands' footprint rule: the check
that was missing was never about the trigger, always about placement.
Verified in-page on all twelve circuits: zero rings/ribs on splits or jump
gaps (Sunset Circuit dropped exactly the four split ribs). Sign gantries at
splits are deliberately kept: the beam spans both halves and is fully
visible, so its whoomp has a visible cause.

Two instrumentation lessons out of the same session:
- **The [thump] log perturbed the measurement.** ~12 lines/s through a
  tunnel with the web inspector open drags Safari's frame p50 to ~36ms, and
  the honest controller then drops tiers BECAUSE OF THE LOGGING meant to
  debug it. [thump] is now opt-in: `__game.thumpLog(true)` (persisted as
  localStorage `sv-thumplog`). The [gfx] drop line stays always-on — one
  line per drop cannot hurt anyone.
- The p50/p95 drop diagnosis paid for itself immediately: his log showed one
  window at p50 36ms (uniform — the console cost) and another at p50 17ms /
  p95 37ms (spiky — pipeline warm-up), two different problems in two lines.

### 2.6l The road itself was the silent structure, and the whoosh was an impostor (2026-08-07) — FIXED
Same report shape again — swosh with no arch, or seconds off, or "queued" —
but this time from a TIME TRIAL (no rivals, no weapons), which narrowed the
suspects enough for a full adversarial audit. Three independent causes, all
confirmed, all in one class: 2.6k's lesson one level up. The trigger was
proven, the sound was honest, and once more THE BUILD LIST LIED — this time
by omission.

1. **The ROAD is the biggest overhead structure in the game and it had no
   voice.** Flyover decks, loop arcs, corkscrew rolls: measured with the real
   spline, 29 road-over-road crossings on 11 of 12 circuits (Grid Lock is the
   only clean one), every single one silent, nearest sounding structure up to
   264m / 4.4s away. Sunset Circuit alone: the loop's arc over its entry
   (s≈313) and exit (s≈498) — nearest thump 1.7-1.9s away — plus an 8.7m
   flyover at s≈3106. The rockCut STONE ARCHES (desert+frost, pillars + lintel
   13.5m over the deck) were silent too, and a 270m bridge deck that crosses a
   winding road twice recorded only its centre s. Fix: `findPassUnders()`
   (src/track/passUnders.js, pure spline arithmetic, no three.js — the
   buildGround/groundAt lesson: one implementation shared by the game and by
   `tools/audit-passunders.mjs`), rockCut returns its placed archS, bridges
   walk their whole deck axis. Every crossing carries a k=2 whoomp whose level
   fades with clearance (TUNING.PASSUNDER_*): a 9m deck whoomps, a 40m loop
   arc murmurs at 0.35.

2. **The near-miss whoosh was a state timer wearing an event's clothes** — and
   it is band-passed noise in the same family as the holo swish, so the ear
   filed it under "arch sound with no arch". Hold a line inside the 1.1m wall
   band through a sweeper: a whoosh every 0.55s, nothing passing — in a TIME
   TRIAL, on a track with zero rivals. Run alongside a rival (or with one
   sitting in the blind spot behind — no ds sign check) and it fired every
   0.9s at zero closing speed. It also fired mid-air over jump gaps, skimming
   a wall that does not exist. Fix: both branches trigger on EVENTS — the wall
   on ENTERING the band, a rival on actually drawing level (along-track gap
   changes sign inside the window), plus `!ship.jumping`; cooldowns remain
   only as jitter backstops. One lap of Sunset in the probe: 3 wall whooshes
   (band entries), previously a metronome.

3. **The camera cursor could move backward and re-arm everything it had just
   fired.** camS = ship.s - rig.gap + v*outputLat(): a hard hit collapses the
   speed-scaled lead (~21m in a frame on Bluetooth), outputLatency itself
   jitters, and the acceleration lunge grows gap faster than a launching ship
   travels. Any backward step was committed as a rewind, and the catch-up
   drive thumped the same structures a SECOND time — the "queued" swoshes.
   Fix: the mark only moves forward; real teleports (track build, re-grid)
   resync through a null sentinel instead of being inferred from distance.

Refuted along the way, by adversarial verification against the real
constants — worth keeping so nobody re-fixes them: holo rings are NOT
invisible against the bright skies (every material fact checked, claim
fell); the jump-shortfall respawn cannot fire phantoms; the 3-per-frame cap
and 45ms floor never audibly drop a legitimate thump.

Verified headless on Sunset Circuit (real rAF frames, thumpLog on): both
loop arcs FIRED at lvl 0.35, flyover FIRED at lvl 1.00, stone arch SPANN at
s=186, all rings/ribs exactly once, zero duplicates, zero console errors.
`[whoosh] WALL|RIVAL` now logs under the same `sv-thumplog` flag, so the
next "swosh utan orsak" report tells the two systems apart from the console.

Confirmed but deliberately not fixed here: city sign gantries can stand on
banked road (visual, city-only — own report); nearMissWhoosh takes no
output-latency lead (it has no fixed world anchor to sync to).

### 2.6m The hunt turned on its own fix, and the private window was half the ghost (2026-08-07) — FIXED
"tycker fortfarande att jag hör spökljudet" — from a Safari PRIVATE window,
which turned out to be a finding in itself. A second adversarial round
(sound census + review of 2.6l's own code + crossing visibility + Safari
specifics) confirmed SIX remaining layers:

1. **2.6l's loop murmurs were artifacts of its own detector.** MIN_DS=40
   paired the loop's OWN ribbon with itself 40m ahead — a default loop
   climbs ~37m in its steepest 40m of arc, and the pair passed the width
   test by 16cm. Every "crossing" above ~25m clearance on the roster was
   this, including both Sunset murmurs (s=313/498) — fired mid-loop with no
   crossing anywhere. And their lvl=0.35 was authored below the mix at the
   loudest moment in the game: 2.6i's "too quiet to exist" re-introduced as
   an intermittent murmur. MIN_DS=120, MAX_H=25, level floor removed (a
   floor is an on/off cliff at the ceiling). 14 true flyover decks remain
   (8.6-19.6m), all full-band audible.
2. **The wall whoosh edge-trigger re-armed itself twice over**: the speed
   gate's early return cleared the band flag mid-band (a dip-and-recover
   fired a fresh "entry"), scrape frames were excluded from membership (a
   scrape RELEASE fired), and the 1.1m boundary had no dead zone (steering
   jitter re-entered at cooldown rate). Membership is now pure geometry
   tracked every frame; speed/scrape/airtime gate only the FIRE; exit takes
   NEARMISS_WALL_EXIT=1.7m hysteresis.
3. **Respawn (R) snapped rig.gap up to ~7.7m shorter in one frame** — a
   forward camera teleport that fired every pending thump at the exact
   moment the player is reorienting. Respawn now resyncs the cursor (null
   sentinel, same as re-grid).
4. **"NEW LAP RECORD" celebrated vacuously.** Empty storage made lap one a
   "record" — and a private window has empty storage EVERY session, so the
   banner + silver jingle + record trophy fired at the first line crossing
   of every test run, stacked on the gantry whoomp and lap chime. The
   first-ever time now stores silently; the celebration requires a record
   to actually beat (isFinite(prev)).
5. **Paused toasts burst as a chord.** The toast queue drains on wall-clock
   setTimeout while pause suspends the context — every jingle note shown
   during a pause landed on the same frozen currentTime and fired at once
   on resume. A jingle nobody could hear is now dropped, not deferred.
6. **Safari reports no outputLatency**, so every synced one-shot lands late
   by the whole output chain (50-300ms through TV/monitor speakers) — the
   ring's zing audibly detaches from the ring. The 2.6j idea shipped:
   OPTIONS → AV OFFSET (0-300ms, 25ms steps, sv-avoffset), added inside
   audio.outputLat() so every consumer of the lead inherits it.

What a private window does to a test session, for the next time it comes
up: trophies and records live in localStorage, which is EMPTY every private
session — so five-plus bronze trophies re-unlock mid-race with queued
jingles, and (before fix 4) every improving lap was a "record". None of
those sounds are track structures. The census also cleared the remaining
one-shots as designed-but-unanchored: drift mini-boost plays the pad whoosh
with no pad on screen, and a crest landing thuds with no visible impact —
both deliberate, both worth knowing about when the next "ljud utan orsak"
report arrives.

### 2.6 `__game.warp()` does not step the weapon system
`weapons.stepFixed` is only called from the render loop (`main.js:1765`), so
`warp()` advances physics, AI and contact but **no pads, no pickups, no
projectiles**. Any future weapon test written against `warp` will measure
nothing and look like it passed. Both audit tools work around it by rebuilding
the fixed step by hand. Worth either fixing in `warp` or leaving here on
purpose — but not worth rediscovering.

---

## 3. Ideas — nothing here is committed

Grouped by how much they'd change the game, not by how much fun they'd be to
build.

### 3.1 Would make it a bigger game
- **Online leaderboards.** The single most-requested thing for a game that
  already stores per-track, per-mode records locally. Needs a backend, which
  this project has deliberately never had — that is the real cost, not the code.
- **Eliminator mode.** The weapon kit and the position logic already exist; the
  mode is a rule change (last place is dropped every N seconds) plus a HUD. The
  cheapest genuinely new mode available.
- **Split-screen or hot-seat.** The camera rig and the sim are already
  multi-ship; the cost is UI and fill rate, not physics.
- **A track editor**, even a crude one. `src/track/tracks/` is already the "add
  a track" seam and the audits already guard the result.

### 3.2 Would make it look better
- **Ship interiors.** Canopies are opaque shells; a visible pilot silhouette is
  a small mesh and a large readability win on the garage and podium screens.
- **Raise FULL's pixel budget** once the ULTRA question above is answered.
- **Weather as a per-race variable** rather than a per-world constant — a wet
  Coral Keys, a whiteout on Moonlit Mile. The wet-sheen and snow systems exist;
  what's missing is making them a race-time choice.
- **A long tunnel as a set piece on a city circuit** (Martin's idea). Neon
  Sprawl is the obvious host. The appeal is the contrast — the sky, the fog and
  the horizon all cut out for a few seconds and the only light is the track's
  own edges and your engines, then it spits you back into the skyline. Nothing
  in the engine does enclosure yet: the sky dome is drawn every frame and fog is
  a per-world constant, so a tunnel means a volume that overrides both while
  you're inside it. That is the actual work, not the geometry.

### 3.3 Would make it feel better
- **A real replay system.** `ship/shipPhysics.js` and `ship/aiDriver.js` are
  free of three.js *specifically* to keep the AI/replay seam open, and the
  ghost system already records and replays a line. Nobody has built the camera.
- **Rival rivalries** — a pilot who remembers you beat them last round and says
  so. The banter bank and the standings both exist; the missing piece is state
  that survives a round.

### 3.4 Explicitly considered and rejected
Kept here so the effort doesn't get spent twice:
- **Textures / PBR / bought asset packs.** Breaks the no-textures art direction,
  adds real bandwidth, and would look foreign next to the neon.
- **More particles**, before the overdraw in §2.3 is measured.
- **Motion blur.** The radial smear already sells speed, and per-object blur
  fights the flat-shaded look.
- **Tiering the ground disc.** Its cost is fill, not triangles — a coarser disc
  covers exactly as many pixels. See `FIDELITY.md` §5.2, which also records that
  the original reasoning for doing it was wrong.

---

## 4. Where the other docs are

| File | What it is |
|---|---|
| `README.md` | The game as it exists, for a human |
| `CLAUDE.md` | Hard rules, architecture invariants, QA gates, workflow |
| `FIDELITY.md` | Measured survey of what still limits the picture *technically* |
| `ART.md` | Measured survey of what limits it *pictorially*, and the order to fix it |
| `TERRAIN.md` | Design record for the ground-relief system |
| `MUSIC.md` | The soundtrack |
