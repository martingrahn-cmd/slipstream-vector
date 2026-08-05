# CLAUDE.md — Slipstream Vector

WipEout × Horizon Chase neon arcade racer. Three.js via CDN import map, plain
ES modules, **no build step**. Live on GitHub Pages (public repo, "gratis
beta"). Martin writes in Swedish — **reply in Swedish**.

## Hard rules (non-negotiable)

- **Never regenerate, replace or delete Martin's curated assets:**
  `assets/music/*.mp3` (Suno, his compositions) and everything in
  `assets/pilots/` (Grok portraits, expression faces, intro videos). Code may
  *reference* them; only Martin changes them.
- **No rubber-banding, ever.** Difficulty raises driver skill only (corner
  confidence, line tightness, pad usage) — never ship speed, never position-
  based anything. Catch-up comes from slipstream physics, identical for AI
  and player.
- **Escape is never a game control** — the browser owns it (fullscreen exit).
  Menu back is Backspace; pause is P.
- **Never commit API keys** (ElevenLabs etc.) — localStorage or env only.
- Commits end with `Co-Authored-By: Claude Opus 4.8 (1M context)
  <noreply@anthropic.com>` and push directly to `main`.

## Architecture invariants

- **Spline-domain physics.** Ship state is `(s, d, v, vd)`; world position is
  a projection via `spline.frameAt(s)`. No colliders, no raycasts against the
  track. Along-track math must use the wrap/sdist helpers (the track is a
  loop — naive subtraction breaks at the seam).
- **120 Hz fixed-step sim** (accumulator in `main.js`). All gameplay
  simulation — including every weapon — steps there (`WeaponSystem.stepFixed`).
  Sim randomness uses the seeded `mulberry32` RNG; `Math.random()` /
  `performance.now()` are allowed **only** in the render path.
- Physics consumes scalar track queries only; visuals never write physics;
  all feel events route through `fx/juice.js`; every constant lives in
  `config.js` (one flat `TUNING` object).
- Ship stats live per `ShipPhysics` instance — a hull drives identically for
  human and AI (fairness by construction).
- Track edge neon (cyan left / magenta right) and pad colours are **gameplay
  language** — identical across worlds, never restyled per theme.

## Graphics budget

**Bandwidth-bound first, fill-bound second.** ~80–145 draws / ~330–670k tris
worst case (measured 2026-07-28; the old "230–390k" line predated the terrain
disc and the crowds) — still huge draw/tri headroom. Post = quarter-res bloom + light shafts +
one 12-tap JuicePass, on a 2×MSAA HalfFloat target. Govern new effects
(explosions, shields, beams) by *screen coverage*, pool everything, zero
per-frame allocations in hot paths.

**The additive layer is measured and it is not the problem.** Every transparent
effect in the game together — sparks, camera flashes, exhaust ribbons, motes,
glow ribbons, projectile glow, ship reflections — runs at **~0.05 of one screen
fill**, worst frame 0.175, touching 4–7% of the screen (measured 2026-07-29,
`tools/audit-overdraw.mjs`, four worlds × three tiers). The tier density knobs
do not order: FULL reads *below* LOW on Sunset Circuit. `motes`, which LOW cuts
to 0.3×, governs 0.001–0.013 of a fill. Do not cut particles for performance
without measuring first — the guess has already been wrong once in each
direction. `FIDELITY.md` §5a.

Because the ceiling is fill and not geometry, **form is the cheap axis**: road
slicing (`TUNING.SLICE_STEP`), hull cross-section density (`section12`) and
lengthwise loft smoothing (`loft(..., { smooth: true })`) all buy roundness at
zero extra draws and zero extra coverage. Spend there before reaching for an
effect.

`src/fx/quality.js` holds the LOW/MEDIUM/FULL tiers and the ADAPTIVE
controller. Tiers carry a **pixel budget**, not a bare pixelRatio: cost scales
with buffer AREA, so a bare ratio lets a 4K panel quietly ask for 4x the work a
1080p one does. Measured on an M4: uncapped FULL wanted 44-78 GB/s of
framebuffer traffic against ~120 GB/s of TOTAL system bandwidth, and ran at
20fps. Never cut scenery or geometry density — that makes a weak machine look
like a different game rather than the same game rendered softer.

**Before blaming an effect for a frame-rate problem, price the framebuffer.**
pixelRatio² × MSAA samples × HalfFloat is almost always the answer, and it buys
no beauty at all. Effects like bloom and shafts are 4-8 passes at 1/16 the
pixels — an order of magnitude cheaper than the resolution they were being
blamed for. The tiers were wrong about this for weeks and it kept the game
uglier than it needed to be for everyone.

`FIDELITY.md` is the measured survey of what still limits the picture. The one
finding still open there: FULL renders BELOW native on a 4K panel, because the
pixel cap was set for 4x MSAA and never moved when MSAA became 2x. (The LOW
colour grade and the frost world's bake direction were the other two; both are
fixed.)

## Dev workflow

- Serve statically with caching off: `.claude/launch.json` name **"game"**
  (python http.server on :8741 with `Cache-Control: no-store`).
- Root-level `*-lab.html` files are standalone tools (atmosphere, ship editor,
  fleet/livery checks, pilot expressions + ElevenLabs voices, weapon icons).
  Labs must include the three.js import map in `<head>` or they die silently.
- Debug: `window.__game` exposes ship/rig/spline/race/weapons/juice/menu plus
  `warp(seconds, {throttle,...})` for deterministic no-rAF simulation.
  **`warp` steps physics, AI and contact — NOT the weapon system** (that is only
  stepped in the render loop, `main.js:1765`), and **NOT any visual effect**:
  sparks, trails, shipVisual and the shock/fireball pools all update in the
  frame, so warping leaves them frozen. A weapon or effect test written against
  `warp` measures nothing and looks like it passed. Both audit tools below
  rebuild the fixed step by hand for exactly this reason.
- **Audit:** `node tools/audit-overdraw.mjs [tracks] [tiers] [samples]` — exact
  fragment count of the additive layer, per track and tier, with an optional
  heatmap dump (`OD_DUMP=<dir>`). Not a gate; a measuring stick to reach for
  before believing an effect is expensive. **Never run it with another headless
  browser alive**: a concurrent chromium in software GL corrupts the numbers
  wholesale — the same build measured 0.415 peak under load and 0.112 solo, and
  the corrupted run nearly triggered a rework of a feature that was fine. It
  counts FRAGMENTS, not brightness: dimming a material changes nothing here,
  only geometry coverage does (culling a back wall halves it; a near fade does
  not).
- **Audit:** `node tools/audit-props.mjs [track] [nameFilter]` — where scenery
  actually landed: per scenery child, its vertex count and the distribution of
  lateral distance from the road edge and height above the road surface. The
  question it answers is "I added props along the track and cannot see them —
  are they mispositioned or are they there and invisible?", which is otherwise
  six minutes of press shots per guess. A prop meant to line the road reads as a
  lateral median under ~10m with "within 40m" near 100%.
- **Audit:** `node tools/audit-pads.mjs [tracks]` — weapon-pad pickup
  distribution and what a whole pack gets off one pad. The standing answer to
  "does the field share a weapon?" (it does not; see `STATUS.md` §2.5).
- **QA gate:** `node tools/audit-terrain.mjs` guards the ground: it reports
  terrain INTRUSION near the road (how high the ground gets beside the racing
  line), not absolute clearance — the flat plane already sits exactly 1.15m
  under a circuit's lowest banked edge by construction, so an absolute bar fails
  every track before terrain does anything. Must read 0.000m.
- **QA gate:** every unmanned full-throttle lap
  (`__game.warp(120,{throttle:1})`) must complete on every track, **and**
  `node tools/audit-tracks.mjs` must pass (needs a one-off `npm i three`). The
  audit is the guard against a circuit's road cutting through itself where the
  loop crosses over — never eyeball that from one camera angle. It samples the
  real banked section plus wall tops, because a centreline check misses the
  ~4m the outer edge gains on a banked corner and everything a corkscrew does.
  Track-shape changes must clear **3.5m** surface-to-surface; the circuits that
  have always looked right sit at 3.7–4.5m.
- **Press kit:** `node tools/press-shots.mjs --jpeg` (needs `npm i playwright`
  and the dev server up). Three in-engine shots per circuit at 1920x1080 —
  chase camera, FULL quality, debug readout hidden, caption burned in. The
  shots are *scored off the spline*, not hand-picked: `vista` (heading most at
  the world's sun, less a curvature penalty), `stunt` (most inverted/banked
  frame, else the hardest corner), `stand` (a grandstand ≥350m from the other
  two). Writes PNGs plus optional JPEGs and a README. Output goes to `press/`,
  which is gitignored — regenerate it, never commit it, and re-shoot after any
  art change.
- Headless/browser-pane testing: rAF is throttled — screenshots force frames;
  to teleport the player set **both** `ship.s` and `ship.sTotal`. Note `start()`
  re-grids the field on the next step, so it *undoes* an assignment to `ship.s`
  — the press tool drives to its marks with `warp(dt, {throttle: 1})` instead,
  and an earlier version that teleported photographed the start line every
  time without appearing to fail.
- Verify per stage by panning the horizon on each track; regressions-check all
  three worlds after scenery/theme changes.
- **A ShaderMaterial that fails to compile draws NOTHING and the game keeps
  running.** The only sign is one console line among the boot noise, and the
  effect looks like it was never wired up. Two traps have each cost a session:
  a backtick inside a GLSL comment (the shader is a JS template literal —
  `node --check` passes, the page throws), and using any name but `mvPosition`
  for the model-view position when the shader includes the fog chunks. If an
  effect "does nothing", read the console before reading the maths.
- **Spline frames are LEFT-handed for `Matrix4.makeBasis`.** The frame's
  `R = T x U`, so `makeBasis(f.R, f.U, f.T)` builds a left-handed matrix and
  `setFromRotationMatrix` on it yields garbage/NaN quaternions that silently
  frustum-cull the mesh. Negate T — `makeBasis(f.R, f.U, f.T.clone().negate())`
  — which is exactly what `buildOverheads` does. Found by a probe agent whose
  injected road quads drew 82 of 103 expected draws with no error anywhere.
- **A black BLOCK in the frame means a NaN, not a black object.** The bloom
  bright pass is the narrowest point in the picture and its output is smeared
  by a quarter-res and an eighth-res blur, so one non-finite fragment anywhere
  comes back as a rectangle with a dithered fringe. `pow()` of a negative base
  is undefined in GLSL — clamp any `1.0 - varying` before raising it to a
  power, because perspective-correct interpolation lands a hair outside [0,1].
  SwiftShader does NOT reproduce it (it returns 0); Apple's driver does. The
  bright pass now carries a `!(l >= 0.0)` guard so the blast radius is one
  object instead of a third of the screen — reproduce with a NaN quad if you
  ever need to see it.

## Where things live

- `src/worlds/themes.js` — one theme per world; knobs include palette, fog,
  `sunAz`, `horizonMask`, `landmark {type}` (sunGate/lighthouse/spire),
  `monumentZones`, `rockCut`, `mesaStyle`, `mountainStyle`, `floraCol`,
  `birdCol`, `wind` (per-world sway multiplier), `sky.event` ('planet' =
  sister planet + meteors).
- `src/track/scenery.js` — the world builders. Two things there are about
  making the place feel INHABITED rather than decorated, which is a different
  axis from detail and the one that was missing longest:
  - `buildStands` — grandstands at the start/finish and the outside of the
    biggest corners, with an instanced crowd and camera flashes. It **reacts**:
    far away only the one seat in six that owns a camera fires, inside ~70m
    every seat switches to a short cycle and the crowd gets to its feet. It
    footprint-tests against the whole centreline so a stand never lands on the
    road where the loop crosses over itself.
  - `windify(material, geom, amp)` — vertex-shader sway injected into
    vegetation materials, weighted by vertex height squared, phased off world
    position so gusts sweep. Zero draws, zero triangles, one uniform a frame
    for the whole world. Amplitude is per archetype (palm ≫ spruce ≫ cactus)
    times `theme.wind`. Uniforms are exposed on `material.userData.wind`.
  - `buildMotes` is the weather. Snow AND rain live in a box that follows the
    camera and wrap around it (`wrapTo`); anything seeded along the whole lap
    is invisible on a 2–4km circuit, which is how the rain shipped for months
    at 9 streaks within 60m of the camera. One instanced draw either way.
  - The **storm** (city worlds) is `scenery.storm` — `{flash, bolt, strikes,
    mag, dist, az, seed}`. The sky shader draws the forked channel and the
    bearing-biased wash; `main.js` reads the same object to lerp the fog colour
    pale and to fire `audio.thunder(dist, mag, pan)` off the `strikes` COUNTER
    (a counter, not a flag, so a consumer can neither miss a strike nor handle
    it twice). Strike rate is per SECOND against a dt derived inside `update()`
    — it used to be per frame, which made the weather track your frame rate.
  - `buildGround` is a radially graded disc **displaced at build time** by
    `terrain.js`'s height function — one CPU implementation, sampled by the
    mesh AND by `groundAt()`, which every scatterer plants against. Deliberately
    not a vertex shader: a second GPU implementation of the noise would drift
    from the CPU one in float32 and float every rock in the world. Per-world
    `theme.terrain {amp, freq, octaves, ridge}`; a world without the block gets
    the old flat disc. `TERRAIN.md` is the design record.
- `src/track/tracks/` — one data file per track + `index.js` roster (the
  "add a track" seam). Stunts via `features: [{type:'loop'|'corkscrew'|'jump'}]`.
- `src/weapons/weaponSystem.js` — pads, five weapons, projectiles, hit/disable
  model, AI fire policy (skill-gated reaction, never position).
- `src/ui/trophyScene.js` — the 31 trophies as OBJECTS: nine procedural forms
  on a plinth, four tier metals plus a dead metal for locked, and `TrophyBaker`,
  which renders each to a data URL once and caches it (`form|tier|locked`).
  It owns a **second WebGLRenderer** — small, offscreen, created on first bake.
  The gallery fills its cards a few per frame (`_fillShots`), never all 31 in
  one go. The unlock toast deliberately stays on the emoji: it fires mid-race.
- `src/ui/banter.js` — `BanterFeed` + exported `LINES` bank: the **single
  source of truth** for pilot lines (game, labs and the voice generator all
  import it).
- `tools/generate-voices.mjs` — idempotent ElevenLabs batch TTS (manifest-
  based; clips generated + committed in `assets/voice/`). The banter feed
  calls `audio.playVoice(slug, bucket, idx)`, which lazy-loads the clip,
  plays it through a radio-comms chain (band-limit EQ + static + squelch),
  ducks the music, serialises voices, and falls back to the comms chirp.
- `tools/generate-sfx.mjs` — idempotent ElevenLabs sound-generation batch
  (config exported from `sfx-lab.html` → `tools/sfx-config.json`; clips in
  `assets/sfx/`). `audio.js` layers these one-shots ON TOP of the synth:
  synth keeps the low-end attack (hitstop/rumble sync), clip adds the
  organic chaos; missing clip → full synth fallback. Continuous beds
  (engine/wind/shield/scrape) stay purely procedural — they follow game
  state per frame, a baked file can't. Re-roll one: `--only <key>`.
- `src/ship/shipPhysics.js`, `src/ship/aiDriver.js` — zero three.js imports
  (AI/replay seam). Keep it that way.

## Verification & docs

- After feature work: reload the game tab, drive/step the affected flow,
  screenshot proof, check the console — then commit.
- Keep `README.md` (human-facing) and this file honest when systems land;
  stale docs are worse than none.
