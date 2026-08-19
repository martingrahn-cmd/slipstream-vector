# Backlog — observed, not imagined

Everything here comes from watching or reading real people play, not from
design instinct. Ordered so that a tired evening can start at the top and stop
anywhere: cheapest and most certain first, taste last.

Nothing here is scheduled. The live browser build earned 217 upvotes and 6.4k
views on r/WipeOut in the form it already has, so none of it is urgent.

## Where the evidence came from

- **A 30-minute recorded playtest** (We Playtest Games, 2026-08-19, posted to
  r/playmygame). One player, thinking aloud, six championship rounds. The
  timestamps below are from that video's transcript. This is the densest
  source by a wide margin and worth re-reading before acting on any of it.
- **r/WipeOut**, 217 upvotes / 17 comments.
- **itch.io page comments.**
- **Code confirmation** — where a player's claim was checkable, it was checked.

---

## 1. Confirmed defect: boost cancels a weapon hit

A hit sets `input.throttle = 0` for `WEAPON_DISABLE_TIME` (1.7s), which kills
the `ACCEL * throttle` term in `shipPhysics.js`. But boost is added
unconditionally a few lines later:

```js
if (this.boostTimer > 0) { a += T.BOOST_ACCEL; this.boostTimer -= dt; }
```

So a player who is boosting when hit barely notices. The playtester found this
without seeing any code — *"When I'm on the boost mode, I don't think the
missiles do anything to me"* (8:00).

It makes weapons feel arbitrary: sometimes a hit ruins the race, sometimes
nothing happens, and the difference is invisible. Either gate the boost term
on `disabledT`, or keep it deliberately and TELL the player it is a mechanic.
Small either way; the decision is which one it is.

## 2. The first ninety seconds are not clear

This is the direct answer to the question asked on r/playmygame, and the
answer is no. Verbatim, from a player who had just read the controls:

- 1:05 *"What's this?"*
- 1:28 *"How do I—"*
- 1:37 *"How do I change the bars in here? I press WD"*
- 1:51 *"So the speed is... um, where's my little character?"*
- 2:11 *"Oh wait. Oh, now I see"*

Ninety seconds to understand the garage and ship select. Also 16:49, back in
the garage later: *"I don't know why the arrow button some moves when I press
each of these."*

Nothing about the racing caused this. It is the menu.

## 3. Communication gaps — things that exist but are invisible

Every one of these is a working mechanic the player never found. None of them
need new systems, only feedback.

- **The airbrake was never discovered.** 19:08 *"Seems I don't know what the
  air break is for."* 19:17 *"I don't think I need break on this game."* The
  most-rewritten mechanic in the game, the one r/WipeOut was asked to judge,
  did not exist for this player across 34 minutes. A single prompt during the
  first countdown would probably fix it.
- **Being disabled has no on-screen indication at all.** The only feedback for
  `disabledT` is an audio hum (`main.js:1960`). So 1.7 seconds of unexplained
  paralysis reads as the game hanging: 10:11 *"I think I have to press like W
  again"*, and again at 14:10 *"I don't know why I have to press the space
  again after I get hit to accelerate."* The mechanic is fine. The silence is
  the bug.
- **The shield cannot be figured out.** It is a held weapon deployed with the
  fire button (`weaponSystem.js` ~360), and nothing says so. 9:49 *"How do we
  even activate the seal?"*
- **No rear threat awareness.** Same line, second half: *"We don't even know
  if we're getting hit from behind."* There is a lock warning for incoming
  missiles but nothing that reads as "someone is behind you and armed".
- **Weapon identity is unclear.** 8:15 *"What did I even get? I just press
  spam space."*

## 4. Audio mix — defaults are too loud

Music defaults to 8/10 (`audio.js:11`), voice to 8/10 (`audio.js:16`).

- 5:06 *"Let's decrease the music volumes a little bit because I think it's a
  bit too loud"* — and they went into options and did it, so the slider is
  discoverable.
- 16:58, about a rival voice line: *"break markers are for prey. That's really
  loud."*

Note what this means for the "drop the AI voiceovers" ask in their written
summary: **in the session itself, the complaint attaches to volume, not to the
voices being synthetic.** The strongest reading of the raw evidence is a
crowded mix rather than an objection to AI. That is not proof — the AI
question came up independently on r/WipeOut, where an honest "generated with
Suno, edited by me" reply sat at -3 while the post ran to 217 — but the two
should not be conflated. Lowering the defaults is cheap, uncontested, and
tests the mix hypothesis for free.

Also worth knowing: **VOICE = 0 already silences the voices while keeping the
banter chips as text**, and RIVAL BANTER = OFF removes the feed entirely. The
option people ask for exists twice over; nobody finds it.

## 5. Readability

- 5:35 *"I really can't see anything once the 360 turn begins."* The corkscrew
  is unreadable while it rolls. The stunt geometry is a selling point, so this
  one matters more than its single mention suggests.
- 5:26 *"the background and the UI could use some improvements"*, repeated at
  25:16 *"Especially the background. I think the background could be
  improved."* Twice, unprompted, is a signal even without a specific ask.
- 31:21 *"didn't even see the recent pattern cuz of that car"* — rivals occlude
  pads.

## 6. Weapon pressure on the leader — perception vs code

Twice, unprompted: 10:43 *"They keep hitting missiles towards me only. Are
they focusing on me? Cuz I'm winning too much."* and 32:25 *"How come the
boats are launching a coordinated attack on me?"*

The code is innocent — AI fire policy is skill-gated and never position-aware,
which is the game's cardinal rule. But the experience is real, because when
you lead, every ship behind has you in front of them and forward-firing
weapons converge on the leader by geometry. Falling 1st → 7th repeatedly is
still a balance signal even if nothing is targeting you for winning.

Worth considering: the cardinal design rule is invisible to the player who
experiences its opposite. A "clean race" toggle (no weapons) would let the
handling and the slipstream carry a race on their own, and would cost nothing
to build — `WeaponSystem` already takes an `active` flag, because Time Trial
uses it.

## 7. Taste — the owner's call, listed so they are not lost

- Longer tracks with fewer laps. 24:45 *"This is pretty fun actually, but I
  feel like the track is a bit too short"*, 24:56 *"the tracks should be long
  and the laps should be a bit decreased."*
- Wider tracks. 11:09 *"I think this is really far. Too narrow."*
- The crowd reads as placeholder: 17:11 *"those are the audience there. Some
  rectangles cheering us from the sidelines."*

## 8. Steam scope

Strategy, cost of entry and the ranked feature argument live in
`STATUS.md` §3.1a and are not repeated here. The short version: **leaderboards
with downloadable ghosts is the one to build first** — most of the machinery
already exists in `fx/ghost.js`, and it answers what a paid release offers
when a complete free version already runs in a browser.

Two offers made publicly and still open:

- A **graphic designer from the games industry** offered pro bono work on
  r/WipeOut (grew up on the TDR house style). The weakest surfaces are the
  wordmark and the in-race HUD — and per §3 above, the HUD is also where the
  communication gaps live, so this is one job, not two.
- **We Playtest Games** offered follow-up questions with the playtester. The
  question worth spending that on: whether the voice complaint is the AI, the
  delivery, or the volume.

## What is already validated — do not "fix" these

- **Performance holds.** 34:03 *"the game does run fine. No optimization
  issues so far and no bugs."* Half an hour on someone else's machine.
- **The LOW tier does its job.** From an itch comment: *"My potato chip of a
  computer can only run it on 'low' so thank you for adding different graphic
  levels."*
- **The controls read as responsive**, from a second itch comment: *"Nice
  responsive controls and good sense of speed"* — which, together with the
  r/WipeOut player who liked how the ship tracks the road, means the floatiness
  worry is not shared by anyone who has actually played it.
- **The pass-under sounds are fixed.** Nobody has mentioned a phantom noise
  since 2.6n, including across 34 uninterrupted minutes.
