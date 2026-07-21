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

**Fill-bound, not draw-bound.** ~60–100 draws / ~175k tris worst case — huge
draw/tri headroom; the real limit is **additive overdraw at 4K on iGPUs**.
Post = one 12-tap JuicePass + 4×MSAA (no bloom pass); pixelRatio capped 1.5.
Govern new effects (explosions, shields, beams) by *screen coverage*, pool
everything, zero per-frame allocations in hot paths.

## Dev workflow

- Serve statically with caching off: `.claude/launch.json` name **"game"**
  (python http.server on :8741 with `Cache-Control: no-store`).
- Root-level `*-lab.html` files are standalone tools (atmosphere, ship editor,
  fleet/livery checks, pilot expressions + ElevenLabs voices, weapon icons).
  Labs must include the three.js import map in `<head>` or they die silently.
- Debug: `window.__game` exposes ship/rig/spline/race/weapons/juice/menu plus
  `warp(seconds, {throttle,...})` for deterministic no-rAF simulation.
- **QA gate:** every unmanned full-throttle lap
  (`__game.warp(120,{throttle:1})`) must complete on every track.
- Headless/browser-pane testing: rAF is throttled — screenshots force frames;
  to teleport the player set **both** `ship.s` and `ship.sTotal`.
- Verify per stage by panning the horizon on each track; regressions-check all
  three worlds after scenery/theme changes.

## Where things live

- `src/worlds/themes.js` — one theme per world; knobs include palette, fog,
  `sunAz`, `horizonMask`, `landmark {type}` (sunGate/lighthouse/spire),
  `monumentZones`, `rockCut`, `mesaStyle`, `mountainStyle`, `floraCol`,
  `birdCol`, `sky.event` ('planet' = sister planet + meteors).
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
