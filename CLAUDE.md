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

**Bandwidth-bound first, fill-bound second.** ~60–110 draws / ~230–390k tris
worst case — huge draw/tri headroom. Post = quarter-res bloom + light shafts +
one 12-tap JuicePass, on a 2×MSAA HalfFloat target. Govern new effects
(explosions, shields, beams) by *screen coverage*, pool everything, zero
per-frame allocations in hot paths.

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

## Dev workflow

- Serve statically with caching off: `.claude/launch.json` name **"game"**
  (python http.server on :8741 with `Cache-Control: no-store`).
- Root-level `*-lab.html` files are standalone tools (atmosphere, ship editor,
  fleet/livery checks, pilot expressions + ElevenLabs voices, weapon icons).
  Labs must include the three.js import map in `<head>` or they die silently.
- Debug: `window.__game` exposes ship/rig/spline/race/weapons/juice/menu plus
  `warp(seconds, {throttle,...})` for deterministic no-rAF simulation.
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
- Headless/browser-pane testing: rAF is throttled — screenshots force frames;
  to teleport the player set **both** `ship.s` and `ship.sTotal`.
- Verify per stage by panning the horizon on each track; regressions-check all
  three worlds after scenery/theme changes.

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
