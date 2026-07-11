# SLIPSTREAM VECTOR

A WipEout × Horizon Chase arcade racer. Anti-grav ship, three low-poly worlds,
six tracks, five weapons, and eight rivals who trash-talk you over the comms —
built for graphics and game feel first.

**Worlds & tracks** (pick with ← → on the start screen; lap records persist):

| World | Tracks | Character |
|---|---|---|
| Sunset Mesa | Sunset Circuit · Mesa Run | bright late afternoon over a monument valley: banded buttes in clusters with empty dune flats between, a canyon rock-cut pass, raptors circling the colossal **Sun Gate** arch that frames the striped sun |
| Palm Coast | Lagoon Pass · Coral Keys | golden-hour archipelago: animated lagoon water, half-sunk islands with beaches, palms, a red-and-white **lighthouse** sweeping its beam over a resort strip; Coral Keys has a full F-Zero LOOP |
| Neon Sprawl | Orbital Ring · Skyline Rush | blue-hour metropolis: street canyons of lit towers lining the track, **the Spire** anchoring the skyline, glowing asphalt grid, sweeping searchlights; Skyline Rush has a LOOP + summit dive |

Each theme controls composition, not just palette: ground style
(flat/water/grid shaders), prop archetypes (rock spires / islands / tower
blocks), far-horizon density, flora, billboard frequency, ribbed tunnel arches
over the long straights (`archMax`) and one-off set pieces (city searchlights).
On top of that each world gets **directed composition**: one iconic landmark
placed on a meaningful azimuth (`landmark`, usually the sun's), a shaped
horizon (`horizonMask` thins or boosts the far-mountain rings per angular
window), monument **zones** that cluster the scatter into dense stretches with
genuinely empty flats between (`monumentZones`), and per-world one-offs — the
desert's ~230 m canyon rock-cut with stone arches over the road (`rockCut`), a
dim sister planet + meteor streaks in its sky (`sky.event`). Big rock masses
carry baked sediment **strata** bands, so nothing reads as an untextured
block. See `src/worlds/themes.js`.

**Detail & dynamism.** The road surface shader carries expansion joints, corner
skid marks, a per-sector tint and a centre **energy spine** that flows forward
faster the quicker you go (speed sold by the world, never by shake) — all free,
no extra geometry. Worlds run dense instanced scatter. Over a race the sky
**drifts**: the sun sinks, the mood deepens and stars come out; desert air
shimmers with heat-haze and the neon city gets the odd lightning flash. The
player's ship reacts too — a boost bloom surges behind it and a brake strip
lights under braking. Everything stays inside the graphics budget — the
renderer is **fill-bound, not draw-bound** (~60–100 draws / ~175k tris worst
case; the real limit is additive overdraw at 4K on iGPUs, so effects are
pooled and governed by screen coverage).

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

## Front-end — "THE BAY"

Console-style flow: boot to a **PRESS START** title over a slow cinematic
orbit of the parked ship (gameplay HUD hidden), then the console slides in.
It's laid out like a ship's operating system: a **left nav rail** lists the
sections vertically — Championship · Single Race · Time Trial · Garage ·
Options · Controls · Records · Trophies — which you move through with ↑ ↓ (a
glowing caret tracks the highlight). **Enter drops *into* a section**, focus moving to its
content rows in the middle column; Backspace returns you to the rail. A top
status rail shows the current section + live telemetry, and a huge ghost numeral
sits behind the content. Every section slides in with its own boot label.

The **Garage** is the showpiece: a wide neon display bay where your hull turns
on a lit pedestal between sensor pillars and corner ticks, team identity to the
left, livery / pilot to the right. The race sections (Championship / Single /
Time) put the circuit previews — environment snapshot, top-down outline,
elevation profile — in a framed viewport beside the settings, and a big **GO**
button (pulsing when focused) launches the race. The 3D ship viewer and the
preview canvases are shared and **reparented** into whichever section is active.

**Options** has its own section: separate **MUSIC** and **SFX** volume bars,
gamepad **DEADZONE** (low / medium / high) and **RUMBLE** toggle, **FULLSCREEN**,
a **MOTION FX** switch (reduced-motion — disables the slide-ins, pulses and
camera shake), **PILOT INTRO** (FIRST RACE / ALWAYS / OFF) and **RIVAL
BANTER** (ON / OFF), and a controls legend.

**Controls** is a live key-rebinding screen: a list of the driving actions
(steer left/right, accelerate, brake, airbrake) plus fire weapon, respawn and
pause, each showing its current key. Press Enter on a row and a **PRESS A KEY** overlay
captures the next keypress as the new binding (Esc cancels); binding a key that
another action already uses moves it off the old action, and a **RESET TO
DEFAULTS** row restores everything. Bindings persist to localStorage. Menu
navigation, confirm/back and fullscreen stay fixed, and the gamepad keeps its
standard W3C mapping (so it still works regardless of how the keys are remapped).

**Everything is clickable** — the whole front-end works by mouse as well as
keyboard/gamepad. Click a nav item to enter its section, click a row to focus it
and its ◀ ▶ arrows to change the value, click GO to race; the pause menu rows/
options click too, and an in-race PAUSE button sits by the fullscreen button.
(The HUD overlay is `pointer-events:none` so it never eats canvas input; the
interactive controls opt back in.) Below ~1120px the layout tightens and below
~900px it collapses to the rail plus a single content column.

**Pause menu** (`ui/pauseMenu.js`): P (or Esc) mid-race opens a centered panel —
Resume / Restart / Options / Quit — navigable by keyboard or gamepad, in the
same neon style. Back is **Backspace** (Esc is hijacked by the browser to leave
fullscreen, so it isn't depended on); on a gamepad B backs out and Select
toggles pause. Options exposes the SFX volume and a fullscreen toggle. Restart
re-runs the current race/round (championship keeps its standings); Quit returns
to the menu.

## Game modes

The nav rail's race sections: **CHAMPIONSHIP** (all six tracks in roster order, points
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

The Garage spins a live 3D model of your hull; the race sections show a real
in-world environment snapshot, the top-down outline and the elevation profile
(loops read as spikes). **RECORDS** and **TROPHIES** are their own nav-rail
sections — move to them and press Enter to open; Backspace returns to the rail.
No keyboard-letter shortcuts, so the whole menu maps cleanly to a gamepad.

**Records & trophies:** beating a track's best lap or best full race is
celebrated with a slide-in banner and written to localStorage (the records
board is the high-score screen; reached via the RECORDS nav section).
**Trophies** are 31 achievements (15 bronze · 10 silver · 5 gold · 1 platinum)
— finishing, winning, clean wins, loops, records, class wins, championships, a
clean sweep, and a platinum for completing every other one. They unlock from
gameplay, persist, and pop a queued toast with a tier jingle; the gallery (the
TROPHIES nav section) shows locked/unlocked with progress per tier.
`src/ui/achievements.js`.

**Speed classes & unlocks:** the CLASS row picks a global tier — **PULSE**
(246 km/h, approachable), **SURGE** (300, full speed) and **OVERDRIVE** (354,
brutal). A class scales top speed, acceleration and AI skill *identically for
everyone*, so it changes the whole race's pace and difficulty without
breaking fairness. You start with PULSE; win the championship at a class to
unlock the next, and win the OVERDRIVE cup for a prestige gold champion
livery. Progress persists. `src/worlds/classes.js`.

**Rival difficulty:** the RIVALS row picks how hard the field drives —
**ROOKIE** (forgiving), **PRO** (the default, a real fight), **ACE** (brutal)
and **APEX** ("the field races like it hates you"). It is independent of which
track you pick and raises only *driver* skill — corner confidence, line
tightness, boost-pad use, weapon reaction time — never ship speed, so the
no-rubber-band rule holds. Every tier is open from the start (it's a
challenge you choose, not a reward you earn) and the choice persists.
`src/worlds/difficulty.js`.

## Racing

You start P8 in a field of 8. Pick your seat on the start screen (↑↓ rows,
←→ change): **team** (ship stats à la WipEout — Vektor Dynamics balanced,
Halcyon Raceworks handling, Razorback Velocity top speed, NovaSurge
Industries thrust), **livery** (2 per team) and **callsign** (10 to choose
from).

**Race start:** entering a track plays a ~1s cinematic camera sweep down to your
ship while the world music fades up (crossfading from the menu, no hard cut),
then the 3-2-1 lights. **Launch boost:** hold thrust through the last beat of the
countdown. Nail the 0.05–0.55 s window before START for a PERFECT START (full
boost); a bit early gives a smaller BOOST START; hold the whole countdown and you
flood the engines — nothing. The AI gets the same skill-gated chance.

**Fairness:** ship stats belong to the hull — an AI in a Razorback gets the
same +3% top speed you would. Drivers never cheat: difficulty (the RIVALS
tier you pick — ROOKIE / PRO / ACE) only raises driver skill — corner-speed
confidence, line tightness, boost-pad usage. No rubber-banding, ever. Teams
have personalities (Halcyon: smooth lines; Razorback: late brakers;
NovaSurge: boost hunters).

**Slipstream:** sit in another ship's wake — just behind, roughly in line — and
the reduced drag plus a small thrust nudge give you ~6–12% more top speed to
close and slingshot past (`race.computeDraft`, tuned in `config.js`). It's the
*fair* catch-up the game is named for: the clean-air leader gets none, and the
exact same physics apply to the AI, so it never rubber-bands — the wake just
keeps the pack together and rewards whoever positions into it. A cyan
SLIPSTREAM cue fades in when you're in the tow.

**Contact is solid:** ship-to-ship collisions separate positionally and trade
momentum — you can't drive through the ship ahead. A hard shunt (with a
per-pair cooldown so it doesn't machine-gun) costs the rammer speed and shoves
the leader forward; riding a bumper holds you at their pace.
`src/worlds/teams.js`, `src/ship/aiDriver.js`, `src/race.js`, `src/ui/menu.js`,
`src/ui/podium.js`.

## Weapons

Five gold pads per lap arm a random weapon (`src/weapons/weaponSystem.js`).
Cross a live pad empty-handed and the HUD slot fills; fire with **Space**
(rebindable) or gamepad **Y**. Grabbing a pad spends it *globally* for ~4 s —
the decal dims and a gold charge line sweeps back up as it recharges, so pad
denial is a real tactic. The roll is seeded and **never looks at race
position**: same odds in P1 as in P8.

- **Missiles** — a 3-shot salvo, fired straight ahead at +25 m/s.
- **Homing** — locks the nearest ship ahead within 90 m and tracks laterally;
  fires straight if nothing locks. A thick smoke-and-flame trail marks both.
- **Mine** — dropped behind; arms after 0.5 s and lives 25 s. After a short
  grace window it hits *anyone* who crosses it — including whoever dropped it.
- **Boost** — a 1.6 s surge through the normal boost pipeline.
- **Shield** — a fresnel bubble that absorbs exactly one hit, and expires on
  its own after 6 s so nobody rides permanently bubbled.

A hit **disables** the victim for 1.7 s — throttle dies, steering goes mushy,
brakes still work, and the ship coasts on honest momentum (never a scripted
stop). Hits detonate with a pooled fireball, rising smoke, a debris burst and
an expanding shockwave ring, all governed by distance so the fill budget
holds. Getting hit yourself adds a white flash, an FOV kick, controller rumble
and a paralysis hum until control returns.

**AI combat is skill-gated, never position-gated** — the fairness rule
extends to weapons. Every rival fires from the same trigger conditions the
player would (target windows, straightaways for boost); lower driver skill
only reacts *slower*. There is no gap-to-leader term anywhere in the weapon
code: weapons are combat, never catch-up. Weapons are off in Time Trial.

## Rivals with faces

Race events feed a corner **comms feed** (`src/ui/banter.js`): get hit and the
shooter gloats, block a shot with your shield and the victim celebrates,
overtake someone and they seethe. Each chip shows the pilot's face in one of
three expressions — **glad**, **arg** (angry) or the neutral portrait — with a
per-pilot line bank (`LINES`, the single source of truth the game, the labs
and the voice generator all import). Pacing keeps it tasteful: one chip per
1.1 s, 3.7 s on screen, a 4 s per-pilot cooldown, max three visible. The
player never speaks — the feed is the field reacting to *you*. Toggle: OPTIONS
→ RIVAL BANTER.

Before each race your **pilot hails you on video** in the same comms frame
(Grok-generated intro clips per pilot, with a static-portrait fallback if
video can't play). OPTIONS → PILOT INTRO picks FIRST RACE / ALWAYS / OFF.
Groundwork for real *voices* is in place — `tools/generate-voices.mjs`
batch-generates ElevenLabs TTS for the whole line bank from a voice config
exported by `pilot-expression-lab.html` — but no voice audio ships yet.

Three.js (CDN import map), plain ES modules, no build step.

## Run

Any static file server from the project root, e.g.:

```sh
python3 -m http.server 8741
# open http://localhost:8741
```

## Controls

The driving keys below are defaults — **remap them in the Controls menu section**
(steer, accelerate, brake, airbrake, fire weapon, respawn, pause). Menu
navigation, confirm/back and fullscreen are fixed.

| Key | Action |
|---|---|
| `↑` / `W` | thrust (hold at the line for a launch boost) |
| `← →` / `A D` | steer · change the focused menu value |
| `↑ ↓` / `W S` | move the nav rail / section rows |
| `↓` / `S` | brake |
| `Shift` | airbrake drift — release after >0.7 s for a mini-boost |
| `Space` | fire the held weapon |
| `Enter` | confirm · enter a section · start · advance |
| `Backspace` | back (menu section → rail, pause) |
| `Esc` | pause (in race) — also leaves fullscreen, so menu back is Backspace |
| `R` | respawn on the centerline (in race) |
| `P` | pause |
| `F` | toggle fullscreen (also the ⛶ button, bottom-left, and an Options row) |
| `M` | debug top-down view |

**Gamepad** (W3C standard mapping, auto-detected — just press a button):

| Control | Action |
|---|---|
| Left stick / D-pad | steer · menu navigate |
| RT / A / stick-up | thrust |
| LT / D-pad-down / stick-down | brake |
| LB / RB | airbrake drift |
| Y | fire the held weapon |
| A / Start | confirm / start / advance |
| B | back / abort to menu |
| X | respawn · Select pauses |

Triggers are read analog, so you can feather the throttle. Fullscreen stays
keyboard/mouse only — `requestFullscreen` needs a user gesture a gamepad can't
grant. RECORDS and TROPHIES are their own nav-rail sections (Enter to open), not
keyboard shortcuts, so they map cleanly to a pad. The stick **deadzone** and
**rumble** are tunable in the Options section (rumble fires on wall hits, ship
contact and boosts).

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
  core/input.js            keyboard/gamepad -> smoothed analog axes; data-driven rebinding
  core/audio.js            procedural WebAudio: engine, FX, weapons, fanfares + music slots
  worlds/themes.js         one theme per world: palette, light mood + composition knobs
  worlds/teams.js          4 teams (ship variant, liveries, stats, driver skill) + callsigns
  worlds/classes.js        speed classes: PULSE / SURGE / OVERDRIVE + unlock ladder
  worlds/difficulty.js     RIVALS tiers: ROOKIE / PRO / ACE / APEX (driver skill only)
  weapons/weaponSystem.js  pads, 5 weapons, projectiles + trails, hit/disable, AI fire policy
  weapons/icons.js         HUD weapon glyphs
  track/tracks/            one data file per track + index.js roster (the "add a track" seam)
  track/spline.js          Catmull-Rom -> arc-length LUT -> parallel-transport frames -> frameAt(s)
  track/trackMesh.js       surface shader, walls, neon strips + fake-bloom ribbons, pad decals
  track/scenery.js         themed sky/ground shaders, mesas, landmarks, monument zones,
                           rock cut, strata bake, pylons, gates, props + the liveliness
                           layer (drones, ambient motes, traffic, bridges, birds)
  ship/shipPhysics.js      spline-domain arcade physics; ZERO three.js imports (AI/replay seam)
  ship/shipVisual.js       cel-shaded team hulls (liveries, turbines, shield bubble, engine FX)
  ship/aiDriver.js         AI: racing line + brake points -> player-shaped input; ZERO three.js
  fx/cameraRig.js          chase cam (gap smoothing, FOV map, trauma shake, loop-aware up)
  fx/juice.js              feel event bus: trauma, boost envelope, hitstop, flash, contact
  fx/particles.js          sparks, exhaust ribbons, projectile trails
  fx/postfx.js             composer + one JuicePass (vignette/chroma/radial blur/flash)
  fx/ghost.js              time-trial ghost record/playback
  ui/hud.js                DOM speed/laps/position/boost/weapon slot, countdown, results boards
  ui/menu.js               "THE BAY" console controller: nav rail + section focus, thumbnails
  ui/banter.js             the rival comms feed + LINES bank (single source of truth)
  ui/achievements.js       31 trophies: unlock logic, persistence, toasts, gallery
  ui/minimap.js            canvas minimap: track outline, pads, start line, ship + rivals
  ui/podium.js             spinning 3D ship model for the Garage display bay
  ui/podiumScene.js        full-screen 3D championship podium ceremony
  ui/pauseMenu.js          in-race pause menu (resume/restart/options/quit)
  ui/logos.js              team logo glyphs
assets/music/              Martin's soundtrack (see Sound & music)
assets/pilots/             Grok portraits, glad/arg expression faces, intro videos
tools/generate-voices.mjs  idempotent ElevenLabs batch TTS for the LINES bank
pilot-expression-lab.html  pilot face/expression + voice-casting lab
*-lab.html / *-editor.html standalone tuning labs (atmosphere, ship, fleet,
                           livery, weapon icons) — need the import map in <head>
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
fanfares and menu blips. `src/core/audio.js`. **Music and SFX have separate
volumes** (0–10 each, persisted), set on their own rows in the Options section;
SFX is also adjustable from the in-race pause menu.

**The soundtrack is Martin's own** and ships with the game: `menu.mp3` (the
menu), `sunset.mp3` (Sunset Mesa), `coast.mp3` (Palm Coast) and `sprawl.mp3`
(Neon Sprawl), each world's track starting at START. The system reads five
slots in `assets/music/` — those four plus an optional `race.mp3` fallback for
any world slot left empty. The countdown stays music-free for tension. Missing
file — silence, no error.

## Debug

`window.__game` exposes `ship`, `rig`, `spline`, `trackDef`, `race`,
`weapons`, `juice`, `audio`, `hud`, `input`, plus helpers: `state()`,
`start()`, `setTrack(i)`, `menuKey(code)`, `enter()`, `escape()`,
`podiumDemo(rank)`, and `warp(seconds, {steer, throttle, brake, airbrake,
ai})` — steps the sim (and the AI field unless `ai:false`) deterministically,
independent of rAF.

## Roadmap

Done: 3 worlds × 2 tracks with loops/corkscrews/jumps, 8-ship AI field (no
rubber-banding, ever), full **weapons combat** with AI that fights back,
rival **banter feed** + pilot intro videos + expression faces, Championship /
Single Race / Time Trial, three speed classes with an unlock ladder +
prestige livery, four RIVALS tiers up to APEX, "THE BAY" console menu with
rebindable controls, keyboard + gamepad, procedural audio + Martin's original
soundtrack + a rocket-launch/explosion SFX layer, 31 trophies, records,
world-uplift pass 1 (landmarks, directed horizons, monument zones, rock cut,
light moods per world).

Next (rough priority):
- **Pilot voices** — cast 8 ElevenLabs voices in the lab, batch-generate the
  LINES bank, play clips from the comms feed (music duck, queue, an OPTIONS
  TEXT / TEXT+VOICE / OFF switch).
- **Missile lock-on warning** — rising beeps → constant tone + a warning
  triangle ~1 s before impact.
- **Post-race flow** — clearer results → next-step path (and menu guidance
  for new players).
- **Content block** — a 4th world and one new track per world → 12 tracks,
  two 6-track cups. World uplift stages 2–4 land first so every new track is
  born prettier.
- **Online leaderboards**, graphics quality tiers for weaker laptops, an
  Eliminator mode built on the weapon kit, packaging/trailer for a possible
  Steam release.
