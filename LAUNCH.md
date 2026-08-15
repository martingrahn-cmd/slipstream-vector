# Launch copy

Every piece of text written for getting the game in front of people, in one
place, because they were scattered across a chat thread and unfindable.

Play link, used everywhere: **https://smarproc-games.itch.io/slipstream-vector**

Rules that apply to all of it: post it yourself, never ask anyone for
upvotes, read each community's rules before posting (they differ, and
breaking them is the usual reason a post gets removed), and stay to answer
for a few hours afterwards — that is where a thread lives or dies.

## Status

| Where | State |
|---|---|
| itch.io page | live |
| itch devlog | pending |
| itch Release Announcements board | pending |
| r/threejs | pending |
| r/WebGames | pending |
| r/playmygame | pending |
| r/WipeOut | pending — wait 2-3 days after the Godot recreation post |
| Hacker News Show HN | blocked: HN restricts Show HN from new accounts. Build account history first, then post |

Suggested order: devlog first (it becomes the best thing to link), then one
community per day. Never two on the same day.

---

## itch.io page

**Short description**

> Anti-gravity arcade racing. Twelve circuits, four worlds, no brakes.

**Description**

> Twelve circuits across four worlds — a sunset desert of banded buttes, a
> golden archipelago, a metropolis racing through a thunderstorm, and a polar
> ridge under the aurora. Vertical loops, corkscrews, jumps, five weapons, and
> eight rivals who talk trash over the comms.
>
> **No rubber-banding, anywhere.** Difficulty only makes the AI drive better —
> never faster. Catching up is done with slipstream physics that work
> identically for you and for them. Tuck into a rival's wake and you get the
> same tow they would.
>
> Time Trial records your best lap as a ghost you can then race against. 31
> trophies. Full gamepad support, rebindable controls.
>
> **Controls:** Arrows/WASD to drive · Shift airbrake · Space fire weapon ·
> R respawn · P pause
>
> ---
>
> **Built with three.js and no build step.** No bundler, no npm install — plain
> ES modules and an import map. Ship physics run in spline domain rather than
> world space: state is arc length along the track, lateral offset, and their
> velocities, with world position projected through the track frame. No
> colliders, no raycasts against the track. The whole scene is vertex-color
> baked with no lights at all, which is why it runs on integrated graphics.
>
> Source: https://github.com/martingrahn-cmd/slipstream-vector

**Tags:** racing · arcade · futuristic · 3d · webgl · threejs · anti-gravity ·
singleplayer · controller · retro

**AI disclosure** (itch requires it)

> Music generated with Suno, pilot portraits with Grok, and rival voice lines
> with ElevenLabs, all directed and edited by the author. Code, game design,
> track layouts, 3D geometry and all sound effects are hand-written; engine,
> wind and weapon audio is procedural Web Audio synthesis.

---

## itch devlog

**Title:** No rubber-banding, ever — Slipstream Vector is out

> Every racing game I grew up with cheated. You'd build a perfect lead over
> three laps, make one small mistake, and there they'd be — the second-place
> car, somehow doing 40 km/h more than its top speed, glued to your bumper. The
> game had decided the race should be close, and your driving was just a
> suggestion.
>
> Slipstream Vector doesn't do that. It was the first rule I wrote down and the
> only one I never bent.
>
> **The AI has no hidden speed.** Every ship on the grid runs the same physics,
> the same top speed, the same acceleration curve as yours. Raising the
> difficulty doesn't make rivals faster — it makes them *better*: they carry
> more speed through corners, hold a tighter line, use the boost pads you're
> missing. If you're four seconds ahead on lap three, you're four seconds
> ahead. Nobody is going to hand that back to you, and nobody is going to take
> it away.
>
> So how does the field stay together? The same way you do it: **slipstream.**
> Tuck into the wake of the ship ahead and you get a real tow — and so do they,
> when they're behind you. The catch-up mechanic is a physical thing that
> exists on the track, visible and available to everyone, instead of a number
> the game quietly adjusts when you're not looking. Getting reeled in feels
> earned. So does escaping.
>
> **Four worlds, and I wanted them to feel like places rather than palettes.**
> Sunset Mesa is a monument valley in the late afternoon, banded rock in
> clusters with genuinely empty desert between them, and a colossal stone gate
> framing the sun. Palm Coast is golden-hour archipelago — lagoon water,
> half-sunk islands, a lighthouse sweeping its beam across a resort strip. Neon
> Sprawl races through a thunderstorm: rain in the street canyons, lightning
> striking behind the skyline and washing the whole city pale, thunder rolling
> in seconds later because sound takes time to travel. Frostfall Ridge sits
> under the aurora, which surges on the final lap.
>
> The sky drifts over the course of a race, too. Start a race in daylight and
> finish it as dusk comes in. Nobody asked for that. It just makes the third
> lap feel different from the first.
>
> **Twelve circuits, and the fun ones don't stay flat.** Full vertical loops,
> corkscrews that roll the road through 360 degrees, jumps with real air. Coral
> Keys and Skyline Rush both put you upside down over the scenery. Grid Lock
> corkscrews inside a tunnel.
>
> **Eight rivals with names, faces and voices.** They talk to you over the
> comms — congratulate you, complain, get genuinely irritated when you take a
> place off them. Four teams, each with two drivers and their own hull
> characteristics.
>
> Time Trial records your best lap and turns it into a ghost you then race
> against — which is either meditative or infuriating depending on how the lap
> is going. There are 31 trophies, and I'd rather not tell you what the
> platinum one takes.
>
> **Where to start:** Single Race on Sunset Circuit. Learn the airbrake (Shift)
> — it's how you carry speed through the tight stuff, and the game opens up
> completely once it's in your fingers. Then Time Trial when you want to know
> how fast you actually are.
>
> Runs in the browser, no install, no account. Keyboard or gamepad. Have at it
> — and tell me what breaks.

Images: three from `press/jpg/` — Skyline Rush (the storm), Coral Keys (the
loop), Aurora Pass (the northern lights).

---

## itch.io Release Announcements board

Low-yield (topics there get 8-26 views), but three minutes. Mark it **Free**.

**Title:** Slipstream Vector — anti-grav racing with loops, storms, and an AI that never cheats

> **Play in your browser:** https://smarproc-games.itch.io/slipstream-vector
>
> Twelve circuits across four worlds — a monument-valley desert, a golden
> archipelago, a city racing through a thunderstorm, and a polar ridge under
> the aurora. Full vertical loops, corkscrews, jumps, five weapons, and eight
> rivals who talk trash over the comms.
>
> The one rule I never bent: **no rubber-banding.** The AI has no hidden speed
> — higher difficulty makes rivals drive better, never faster. If you build a
> lead, it's yours. Catching up is done with slipstream physics that work the
> same for you and for them.
>
> Free, no install, no account. Keyboard or gamepad.
>
> Arrows/WASD · Shift airbrake · Space fire · R respawn · P pause

---

## r/threejs

Start here — the technical audience, and they like seeing something finished.

**Title:** Anti-gravity racer built in three.js with no build step — physics runs in spline domain, not world space

> Been building this on and off and figured this sub would appreciate the
> technical side.
>
> Play: https://smarproc-games.itch.io/slipstream-vector
>
> No bundler, no npm install — plain ES modules and an import map. What you
> play is the source.
>
> The part I found most interesting: ship state is `(s, d, v, vd)` — arc length
> along the track spline, lateral offset, and their velocities. World position
> is a projection through the track frame at `s`. No colliders, no raycasts
> against geometry. Loops and corkscrews came almost free, because the frames
> use parallel transport and the camera's up-vector follows the frame when the
> track leaves horizontal.
>
> Also: no lights in the scene at all. Everything is vertex-color baked, which
> is why it holds up on integrated GPUs. Turned out the renderer is fill-bound
> rather than draw-bound, which inverted most of my assumptions about what to
> optimise.
>
> Twelve tracks, four worlds, keyboard or gamepad. Happy to answer anything
> about the implementation.

---

## r/WebGames

The game sells itself here, not the tech. **Upload the 16:9 trailer as native
video** — Reddit heavily favours it over links.

**Title:** Slipstream Vector — anti-gravity racer in the browser. No install, no account, works with a gamepad

> https://smarproc-games.itch.io/slipstream-vector
>
> Twelve tracks across four worlds — desert, tropics, a city in a thunderstorm,
> and a polar ridge under the aurora. Vertical loops, corkscrews, jumps, five
> weapons, eight rivals who talk trash over the comms.
>
> Arrow keys or WASD, Shift for airbrake, Space to fire. Full gamepad support.
>
> One design rule I stuck to: no rubber-banding anywhere. Difficulty only makes
> the AI drive better — never faster. Catching up is done with slipstream
> physics, which work identically for you and for them.

---

## r/playmygame

They want a concrete question, not an advert. The sub has a give-feedback-to-
get-feedback culture — comment on a few others first.

**Title:** [Feedback] Browser anti-grav racer — is the first minute clear enough?

> https://smarproc-games.itch.io/slipstream-vector
>
> What I'd most like feedback on: the first 60 seconds. Do you understand what
> to do without reading anything, and does the ship feel good to steer before
> you've learned the track? I've played it so much I can't see it fresh
> anymore.
>
> Arrows/WASD to drive, Shift is the airbrake through tight corners, Space
> fires a weapon. Gamepad works too.

---

## r/WipeOut

4.2k members, and the sidebar explicitly covers "similar anti-gravity racing
games" — this post is on-topic by the sub's own definition. A rough Godot
prototype got 131 upvotes there, so the community is receptive; a finished
twelve-track game should land. Their rule 3 forbids vague titles, so the title
below is specific. Wait a few days after any similar post so it doesn't read as
bandwagoning, and comment genuinely in other threads first.

**Title:** Bought a PlayStation in '96 because of WipEout — thirty years later I finally built my own AG racer. 12 tracks, runs in a browser

> The PlayStation I bought in 1996 came home with WipEout, and I played an
> absurd amount of it. I was also one of those people who listened to the
> soundtrack on its own — it never felt like background music, it felt like
> half the reason to play. Then both PS1 sequels, same story.
>
> Thirty years later I finally stopped admiring it and tried to build one.
>
> It's called Slipstream Vector. Free, runs in the browser, no install:
> https://smarproc-games.itch.io/slipstream-vector
>
> Twelve circuits across four worlds, four teams with different hull
> characteristics, five weapons, airbrakes on Shift, and loops and corkscrews
> for the parts that aren't trying to be serious. It has its own soundtrack,
> because after 1996 I couldn't really build one of these without caring about
> the music.
>
> The design decision I'd most like to be argued with about: **there's no
> rubber-banding at all.** Difficulty raises AI skill only — corner confidence,
> line tightness, pad usage — never speed. Catching up comes from slipstream
> physics that work identically for the player and the field. I think it's the
> right call and it makes a lead feel earned, but it does mean a bad opening
> lap stays punishing.
>
> What I'd genuinely like to hear: does the handling read as anything to you,
> or does it feel floaty? The airbrake is the part I've rewritten most and I
> still don't know if it's right.
>
> Happy to have it taken apart if it deserves it.

---

## Hacker News — when the account is old enough

HN currently restricts Show HN from new accounts. The way in is to participate
first: comment substantively in threads about WebGL, game feel, audio and
graphics optimisation for a few weeks, then post. Submit with the URL and leave
the text field EMPTY (HN takes url or text, never both) — the description goes
in as your own first comment.

**Title:** Show HN: Slipstream Vector – anti-grav racer in plain ES modules, no build step

**First comment:**

> Author here. This started as an experiment in how far you can get with plain
> ES modules and an import map — there is no build step, no bundler, no npm
> install. What you play is the source, served straight from GitHub Pages.
>
> A few things that turned out more interesting than expected:
>
> Physics runs in spline domain, not world space. Ship state is (s, d, v, vd) —
> arc length along the track, lateral offset, and their velocities. World
> position is a projection through the track frame at s. No colliders, no
> raycasts against geometry. Loops and corkscrews come free because the frames
> use parallel transport, and the camera's up-vector follows the frame.
>
> The sim is a 120 Hz fixed timestep with an accumulator, seeded RNG, and zero
> three.js imports in the physics/AI files — so the same code drives the player
> and the AI. Difficulty raises driver skill only; there is no rubber-banding
> anywhere.
>
> No lights in the scene at all. Everything is vertex-color baked, which is why
> it holds up on integrated GPUs. The renderer turned out fill-bound rather
> than draw-bound, which inverted most of my assumptions about what to optimise.
>
> Music is Suno, pilot portraits Grok, rival voices ElevenLabs — all run
> through an in-game radio-comms chain. Everything else is hand-written.
>
> Keyboard or gamepad, no install, no account. Happy to answer anything.

Keep the pass-under sound story in reserve for a follow-up question: the thump
was keyed to the ship when the player's eye is at the chase camera, 9.5m and
~170ms behind, and then the browser's own output latency sits on top of that.
It is exactly the kind of answer that makes an HN thread take off.
