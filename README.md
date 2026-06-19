# SLIPSTREAM VECTOR

A WipEout × Horizon Chase arcade racing prototype. Anti-grav ship, three
low-poly worlds, six tracks, built for graphics and game feel first.

**Worlds & tracks** (pick with ← → on the start screen; lap records persist):

| World | Tracks | Character |
|---|---|---|
| Sunset Mesa | Sunset Circuit · Mesa Run | synthwave dusk, open desert valley, spire mesas |
| Palm Coast | Lagoon Pass · Coral Keys | daylight archipelago: animated lagoon water, half-sunk islands with beaches, palms, open ocean horizon; Coral Keys has a full F-Zero LOOP |
| Neon Sprawl | Orbital Ring · Skyline Rush | night metropolis: street canyons of lit towers lining the track, glowing asphalt grid, sweeping searchlights; Skyline Rush has a LOOP + summit dive |

Each theme controls composition, not just palette: ground style
(flat/water/grid shaders), prop archetypes (rock spires / islands / tower
blocks), far-horizon density, flora, billboard frequency and one-off set
pieces (city searchlights). See `src/worlds/themes.js`.

Vertical loops are 40m-radius circles in the spline (7 control points,
corkscrewed ~30m sideways so the exit clears the entry). They work because track
frames use parallel transport and the camera's up-vector follows the frame when
the track leaves the horizontal.

**Stunt kit.** A track file can carry a `features: [...]` array (additive —
omit it and nothing changes) keyed to control-point indices. All three event
types share the same authoring surface:

```js
features: [
  { type: 'loop',      cp: 2,    dir: 1 },                       // a full vertical loop
  { type: 'corkscrew', from: 1.0, to: 2.1, turns: 1, dir: 1 },  // barrel-roll a stretch
  { type: 'jump',      cp: 3.0,  gap: 22,  lift: 11 },           // ramp + gap + land
]
```

- **Loop** generates the 6 control points of a vertical circle after control
  point `cp` (radius/twist/dir optional), reproducing the proven hand-authored
  loop shape. `spline.js _expandLoops` splices them in up front and remaps every
  other cp-indexed reference (pads, corkscrews, jumps) in one place, so the loop
  is genuinely just one line. Place it on a flat, open straight.
- **Corkscrew** overlays a 0→`turns`·360° bank sweep on top of the auto-bank
  over `[from,to]` (bypassing the ±32° clamp); the road rolls a full turn and
  the camera rolls with it. The bank-pull lateral force is suppressed past
  ±32° so the roll doesn't shove you sideways. (`spline.js _buildStunts`.)
- **Jump** opens a `gap`-metre hole in the track mesh at control point `cp` and
  gives an upward `lift` impulse at takeoff; the ship flies a ballistic arc
  (`shipPhysics.js`, JUMP_GRAVITY) and lands past the gap. Too slow and you
  come up short → respawn just past the gap. AI flies the identical physics, so
  it clears jumps the same way (fairness preserved).

Every circuit carries **2–3 events** (loop / corkscrew / jump): Sunset Circuit
loop+jump+corkscrew, Mesa Run corkscrew+jump, Lagoon Pass corkscrew+loop, Coral
Keys loop+corkscrew, Orbital Ring jump+loop, Skyline Rush loop+corkscrew+jump —
five loops in all. QA gate: every unmanned full-throttle lap
(`__game.warp(120,{throttle:1})`) must still complete on every track.

The **start/finish gantry** (`scenery.js buildGantry`) is built in a local
frame and oriented once: stepped towers with gusset braces, a deep beam + top
rail, a lit cyan/magenta neon frame (echoing the track edges), cap beacons and
an additive checker band, merged down to ~2 draw calls. The checkered line on
the road surface itself comes from the track shader (`trackMesh.js`).

## Front-end

Console-style flow: boot to a **PRESS START** title over a slow cinematic
orbit of the parked ship (gameplay HUD hidden), then the menu cards slide in.
A gliding accent cursor + value-pop tracks the focused row, every move has a
blip, and sub-panels (records, trophies) slide in. ESC always returns to the
menu (never back to the title gate).

**Everything is clickable** — the whole front-end works by mouse as well as
keyboard/gamepad. The row arrows (◀ ▶) change values, the mode strip picks the
mode, RECORDS / TROPHIES / FULLSCREEN are buttons in the menu bar, and the RACE
prompt starts the race; the pause menu rows/options click too, and an in-race
PAUSE button sits by the fullscreen button. (The HUD overlay is
`pointer-events:none` so it never eats canvas input; the interactive controls
opt back in.)

**Pause menu** (`ui/pauseMenu.js`): P (or Esc) mid-race opens a centered panel —
Resume / Restart / Options / Quit — navigable by keyboard or gamepad, in the
same neon style. Back is **Backspace** (Esc is hijacked by the browser to leave
fullscreen, so it isn't depended on); on a gamepad B backs out and Select
toggles pause. Options exposes the audio volume and a fullscreen toggle. Restart
re-runs the current race/round (championship keeps its standings); Quit returns
to the menu.

## Game modes

Top row of the menu: **CHAMPIONSHIP** (all six tracks in roster order, points
10-8-6-5-4-3-2-1 per race, standings between rounds, and at the end a full
**3D podium ceremony** (`ui/podiumScene.js`) — the top-three ships rise onto
gold/silver/bronze tiers under spotlights, confetti rains, the camera dollies
in from a wide shot to a hero shot, your ship is ringed, and the title reads
CHAMPION or P*n* OVERALL; press Enter for the standings board. Preview it
without racing via `__game.podiumDemo(rank)`. Track choice is locked to the
calendar), **SINGLE RACE** (any
track vs the field) and **TIME TRIAL** (alone, chasing records). ESC aborts
any session back to the menu. During the countdown a banner announces the
round and circuit; the last lap gets a FINAL LAP call.

The menu's ship card spins a live 3D model of your hull; the circuit card
shows a real in-world environment snapshot, the top-down outline and the
elevation profile (loops read as spikes). **RECORDS** and **TROPHIES** are
selectable buttons at the bottom of the ship card — navigate to them and press
the confirm button (Enter / a gamepad face button) to open; confirm or back
closes. No keyboard-letter shortcuts.

**Records & trophies:** beating a track's best lap or best full race is
celebrated with a slide-in banner and written to localStorage (the records
board is the high-score screen; reached via the RECORDS menu button).
**Trophies** are 31 achievements (15 bronze · 10 silver · 5 gold · 1 platinum)
— finishing, winning, clean wins, loops, records, class wins, championships, a
clean sweep, and a platinum for completing every other one. They unlock from
gameplay, persist, and pop a queued toast with a tier jingle; the gallery (the
TROPHIES menu button) shows locked/unlocked with progress per tier.
`src/ui/achievements.js`.

**Speed classes & unlocks:** the CLASS row picks a global tier — **PULSE**
(246 km/h, approachable), **SURGE** (300, full speed) and **OVERDRIVE** (354,
brutal). A class scales top speed, acceleration and AI skill *identically for
everyone*, so it changes the whole race's pace and difficulty without
breaking fairness. You start with PULSE; win the championship at a class to
unlock the next, and win the OVERDRIVE cup for a prestige gold champion
livery. Progress persists. `src/worlds/classes.js`.

**Rival difficulty:** the RIVALS row picks how hard the field drives —
**ROOKIE** (forgiving), **PRO** (the default, a real fight) and **ACE**
(brutal). It is independent of which track you pick and raises only *driver*
skill — corner confidence, line tightness, boost-pad use — never ship speed,
so the no-rubber-band rule holds. Every tier is open from the start (it's a
challenge you choose, not a reward you earn) and the choice persists.
`src/worlds/difficulty.js`.

## Racing

You start P8 in a field of 8. Pick your seat on the start screen (↑↓ rows,
←→ change): **team** (ship stats à la WipEout — Vektor Dynamics balanced,
Halcyon Raceworks handling, Razorback Velocity top speed, NovaSurge
Industries thrust), **livery** (2 per team) and **callsign** (10 to choose
from).

**Launch boost:** hold thrust through the last beat of the countdown. Nail
the 0.05–0.55 s window before START for a PERFECT START (full boost); a bit
early gives a smaller BOOST START; hold the whole countdown and you flood the
engines — nothing. The AI gets the same skill-gated chance.

**Fairness:** ship stats belong to the hull — an AI in a Razorback gets the
same +3% top speed you would. Drivers never cheat: difficulty (the RIVALS
tier you pick — ROOKIE / PRO / ACE) only raises driver skill — corner-speed
confidence, line tightness, boost-pad usage. No rubber-banding, ever. Teams
have personalities (Halcyon: smooth lines; Razorback: late brakers;
NovaSurge: boost hunters).

**Contact is solid:** ship-to-ship collisions separate positionally and trade
momentum — you can't drive through the ship ahead. A hard shunt (with a
per-pair cooldown so it doesn't machine-gun) costs the rammer speed and shoves
the leader forward; riding a bumper holds you at their pace.
`src/worlds/teams.js`, `src/ship/aiDriver.js`, `src/race.js`, `src/ui/menu.js`,
`src/ui/podium.js`.

Three.js (CDN import map), plain ES modules, no build step.

## Run

Any static file server from the project root, e.g.:

```sh
python3 -m http.server 8741
# open http://localhost:8741
```

## Controls

| Key | Action |
|---|---|
| `↑` / `W` | thrust (hold at the line for a launch boost) |
| `← →` / `A D` | steer / menu select |
| `↑ ↓` | menu rows |
| `↓` / `S` | brake |
| `Shift` | airbrake drift — release after >0.7 s for a mini-boost |
| `Enter` | confirm / start / advance / restart |
| `Esc` | back / abort to menu |
| `R` | respawn on the centerline (in race) |
| `P` | pause |
| `F` | toggle fullscreen (also the ⛶ button, bottom-left) |
| `M` | debug top-down view |

**Gamepad** (W3C standard mapping, auto-detected — just press a button):

| Control | Action |
|---|---|
| Left stick / D-pad | steer · menu navigate |
| RT / A / stick-up | thrust |
| LT / D-pad-down / stick-down | brake |
| LB / RB | airbrake drift |
| A / Start | confirm / start / advance |
| B | back / abort to menu |
| X | respawn · Select pauses |

Triggers are read analog, so you can feather the throttle. Fullscreen stays
keyboard/mouse only — `requestFullscreen` needs a user gesture a gamepad can't
grant. RECORDS and TROPHIES are selectable menu buttons (confirm to open), not
keyboard shortcuts, so they map cleanly to a pad.

Ride the blue chevron pads for a 1.2 s boost; the chain of three on the start
straight sits on the risk line next to the left wall.

## Architecture

```
index.html                 import map + HUD/menu DOM only
styles/main.css            all HUD/menu/overlay styling
src/
  main.js                  boot, fixed-step loop (120 Hz), state machine, modes, world building
  config.js                ONE flat TUNING object — every constant lives here
  race.js                  the AI field: opponents, grid, contact, positions, results/standings
  core/input.js            keyboard -> smoothed analog axes
  core/audio.js            procedural WebAudio: engine, FX, fanfares + 4 music slots
  worlds/themes.js         one theme per world: palette + scenery parameters
  worlds/teams.js          4 teams (ship variant, liveries, stats, driver skill) + callsigns
  track/tracks/            one data file per track + index.js roster (the "add a track" seam)
  track/spline.js          Catmull-Rom -> arc-length LUT -> parallel-transport frames -> frameAt(s)
  track/trackMesh.js       surface shader, walls, neon strips + fake-bloom ribbons, pad decals
  track/scenery.js         themed sky/ground shaders, mesas, pylons, gates, props + the
                           liveliness layer (drones, ambient motes, traffic, bridges, birds)
  ship/shipPhysics.js      spline-domain arcade physics; ZERO three.js imports (AI/replay seam)
  ship/shipVisual.js       procedural "Pronghorn GX-R" (+ team variants), lean/bob, engine FX
  ship/aiDriver.js         AI: racing line + brake points -> player-shaped input; ZERO three.js
  fx/cameraRig.js          chase cam (gap smoothing, FOV map, trauma shake, loop-aware up)
  fx/juice.js              feel event bus: trauma, boost envelope, hitstop, flash, contact
  fx/particles.js          speed-line tunnel, sparks, exhaust ribbons
  fx/postfx.js             composer + one JuicePass (vignette/chroma/radial blur/flash)
  ui/hud.js                DOM speed/laps/position/boost, countdown, results & standings boards
  ui/menu.js               attract menu: mode strip, track/team/livery/pilot rows, thumbnails
  ui/minimap.js            canvas minimap: track outline, pads, start line, ship + rivals
  ui/podium.js             spinning 3D ship model for the menu ship card
  ui/podiumScene.js        full-screen 3D championship podium ceremony
  ui/pauseMenu.js          in-race pause menu (resume/restart/options/quit)
assets/music/              drop-in music slots (see Sound & music)
```

Adding content: a new track is a data file in `src/track/tracks/` registered
in its `index.js`; a new world is a theme object in `src/worlds/themes.js`; a
new team is an entry in `src/worlds/teams.js`. Track edge neon (cyan left /
magenta right) and pad colors are intentionally identical across worlds — they
are gameplay language, not set dressing. Per-track best lap and best full race
persist in localStorage (`sv-best-<id>`, `sv-racebest-<id>`).

Hard boundaries: physics consumes only scalar track queries; visuals never
write physics; all feel events route through `juice.js`; everything reads
`config.js`. Ship stats live per-`ShipPhysics`-instance, so a hull drives
identically whether a human or `aiDriver.js` feeds it input — fairness by
construction.

Ship state is `(s, d, v, vd)` in the spline domain — world position is a
projection, so there are no colliders and no tunneling, ever. The AI field is
N more physics instances; ship-to-ship contact is resolved in the same domain
in `race.js`.

## Sound & music

All effects are synthesized in WebAudio at runtime — engine hum (pitch
follows speed, filter opens with throttle/boost), wind, boost whoosh, wall
thuds, scrape, ship-contact bumps, countdown, lap chime, finish & champion
fanfares and menu blips. `src/core/audio.js`. Master volume on the AUDIO menu
row (0–10, persisted).

**Music is yours to make:** five optional slots in `assets/music/` —
`menu.mp3` (the menu), `sunset.mp3` (Sunset Mesa) / `coast.mp3` (Palm Coast) /
`sprawl.mp3` (Neon Sprawl), one per world starting at START, plus `race.mp3`
as a fallback for any missing world slot. The countdown stays music-free for
tension. No file — silence, no error.

## Debug

`window.__game` exposes `ship`, `rig`, `spline`, `trackDef`, `race`, `juice`,
`audio`, `hud`, `input`, plus helpers: `state()`, `start()`, `setTrack(i)`,
`menuKey(code)`, `enter()`, `escape()`, and `warp(seconds, {steer, throttle,
brake, airbrake, ai})` — steps the sim (and the AI field unless `ai:false`)
deterministically, independent of rAF.

## Roadmap

Done: 3 worlds × 2 tracks (two with F-Zero loops), 8-ship AI field (4 teams ×
2 liveries, no rubber-banding), Championship / Single Race / Time Trial, three
speed classes with an unlock ladder + prestige livery, a chosen RIVALS
difficulty (decoupled from the track), full menu + ship select, keyboard +
gamepad input, fullscreen, procedural audio + music hooks, launch boosts,
solid collisions, records, trackside liveliness.

Not yet built (rough priority):
- **Music** — Martin composes the four tracks himself (drop-in slots ready).
- **Weapons** — under discussion; WipEout-style pad pickups (no position
  weighting, to protect the no-rubber-band rule), optionally with a hull
  energy/shield bar. Cheap in the spline domain. A natural Eliminator mode
  would pair with it.
- **Performance pass** — merge the AI field's flame/glow sprites (draws climb
  to ~90–115 with 8 ships + city props).
- **Championship persistence** — in-progress standings reset on reload (unlock
  progress already persists).
