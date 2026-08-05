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

So the next frost work item is **the palette, not the geometry**: ~8 hex values
plus one grade number, no new code, and it fixes the cliffs and the snow in one
stroke. `ART.md` §7 step 1 has the order and §8 the falsifiable targets.

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
