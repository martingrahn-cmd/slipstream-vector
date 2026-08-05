# FIDELITY.md — where the picture can still get better

**Six of the items below have since been built** (frost sun direction, the LOW
grade, the ULTRA rung, contact shading, neon edge width, crowd update culling),
one was **dropped after the reasoning turned out to be wrong** (§5.2) and one
was **measured and turned out not to be a cost at all** (§5a, the additive
overdraw). They are marked in place; the reasoning is kept because it is the
record of why, and the numbers are still the baseline anything new gets measured
against.

A measured survey, not a wishlist. Every number here came from the running game
on 2026-07-28; the method is at the bottom so it can be repeated and argued
with. Ordered by *visible gain per unit of work*, which is not the same order as
"most impressive technique".

The one-line summary: **the geometry is fine, the pixels are not.** The engine
has huge draw and triangle headroom and is spending it well. What limits the
picture is resolution on big screens, a colour grade that is switched off on the
tier that needs it most, and a lighting direction that disagrees with the sun on
a quarter of the game.

---

## 1. What a frame costs today (measured)

Chase camera, ~9s into a race, 1600x900 CSS.

| Circuit | LOW | MEDIUM | FULL |
|---|---|---|---|
| Sunset Circuit | 101 draws / 486k tris | 111 / 491k | 136 / 671k |
| Coral Keys | 97 / 399k | 121 / 384k | 133 / 544k |
| Grid Lock | 117 / 509k | 124 / 511k | 145 / 667k |
| Aurora Pass | 96 / 455k | 105 / 460k | 80 / 331k |

Caveats, because these are easy to over-read: the sim keeps running between tier
switches, so the camera is in a slightly different place for each column — the
Aurora Pass FULL row is *lower* than its LOW row for exactly that reason, not
because FULL is cheaper. Treat these as the right order of magnitude, not as a
controlled A/B.

**CLAUDE.md's stated budget of "~230–390k tris worst case" is stale.** The real
figure is 400–670k. Nothing is wrong with that — the budget was always a
statement about which axis has headroom, and it still does — but the number in
the doc should say what the game actually draws.

Biggest geometry owners, Sunset Circuit:

```
  35840 tris    560 instances   roadside tufts
  27520 tris      1 mesh        the ground disc          <- new, and now the
  22464 tris   3024 instances   grandstands + crowd         largest single mesh
  13024 tris     44 instances   arches
  12600 tris    210 instances   scrub
```

Two things worth noticing. The ground disc I added for the terrain is now the
biggest single non-instanced mesh in the game and is **identical on every
world and not tiered**. And the crowd went straight into the top three.

---

## 2. The two things that are provably wrong right now

### 2a. FULL renders BELOW native resolution on big screens

`effectiveRatio()` caps FULL at 4.2 Mpx. What that means per panel:

| Panel | LOW | MEDIUM | FULL |
|---|---|---|---|
| 1080p | 0.75 | 1.00 | **1.42** |
| 1440p | 0.57 | 0.84 | **1.07** |
| MacBook Air 13" (2560x1664) | 0.53 | 0.78 | **0.99** |
| 4K | 0.38 | 0.56 | **0.71** |

1.0 means native. So on a 4K panel, FULL renders at 2733x1538 and upscales —
**the game is softest on the biggest, most expensive screens**, which is exactly
backwards from what someone who bought that screen expects. On the MacBook Air
it is a hair under native. Only at 1080p does it supersample.

That cap was set for a real reason: an uncapped 2.0 on 4K meant an 8.3 Mpx
buffer, and at the **4x MSAA** in force at the time that was ~44 GB/s of
framebuffer traffic against ~120 GB/s of total system bandwidth on an M4. It ran
at 20fps.

But MSAA came down to 2x in the same pass, and the cap never moved. At 2x, a
full 8.3 Mpx buffer costs about **8 GB/s** — and the capped 4.2 Mpx buffer we
ship today costs **4.0 GB/s**. The cap is roughly **2x more conservative than
the current MSAA setting justifies**.

This is the single biggest available fidelity win and it is a number change, not
a feature. It wants measuring on Martin's M4 with a 4K panel before shipping,
because the calculation above prices only the colour buffer — depth, the
composer's ping-pong targets and the bloom chain ride on top.

### 2b. LOW throws away the colour grade, not just the effects — DONE

LOW sets `post: false`, which disables the whole JuicePass. That pass carries
the speed effects — but it also carries:

- the **per-world filmic grade** (`gradeContrast`, `gradeSat`, set by
  `applyTheme`; the desert is 1.05/1.14, the city 1.08/1.10)
- the **vignette** and its per-world zenith tint
- the **ordered dither** that hides HalfFloat banding in the sky gradient

So LOW is not "the same game rendered softer" — it is a **different colour
treatment**, flatter and with open corners. That directly contradicts the tier
doctrine in CLAUDE.md, which was written to stop a weak machine looking like a
different game.

The fix is to split the pass: grade + vignette + dither is a handful of ALU with
one texture read and should run on every tier; chroma, radial smear and heat
haze are the 18-read part and can stay FULL/MEDIUM. LOW would get its own colour
identity back for roughly the cost of one extra full-screen read at 1.2 Mpx.

---

## 3. A real defect: the frost world is lit from the wrong direction — DONE

`bakeFlatColors` shades every solid in the world against one global constant,
`TUNING.SUN_DIR = [-0.4, 0.25, -1]` — an azimuth of **-158°**. The sky draws its
sun from `theme.sky.sunAz`. Three of the four worlds leave `sunAz` unset and get
the default `[-0.35, -0.94]`, which is **-160°** — a 1° mismatch, i.e. correct.

**Frost sets `sunAz: [0.62, -0.78]`, which is +141.5°. That is 60° away from the
direction everything in the world is shaded from.** Every rock, spruce, mesa and
grandstand on Aurora Pass, Avalanche Run and Moonlit Mile is lit from one side
while the sky's light source sits well round to the other.

Nobody has named it because flat-shaded low-poly hides a lot, and the frost
world is dark. But it is a quarter of the game shaded wrong, and the fix is to
derive the bake direction from `theme.sky.sunAz` in `setBakeTheme` instead of
reading a module constant. Cost: zero at runtime, it is all bake-time.

---

## 4. High-end: what would actually raise the picture

Ranked by visible gain per unit of work.

1. **Raise FULL's pixel budget** (§2a). PARTLY DONE: an explicit ULTRA rung at
   8.3Mpx now exists — exactly 4K native — and ADAPTIVE cannot climb into it.
   FULL is deliberately unchanged, because it is the measured-good default on
   an M4 and moving it would risk that on the strongest evidence we have.
   Whether ULTRA holds 60fps on a 4K M4 is the open question.
2. **Contact shading where things meet the ground.** DONE — Nothing in the world is
   grounded: ships have a blob shadow, scenery has none. Now that the ground has
   relief this is the most conspicuous absence in the frame. The cheap version
   costs *zero draws*: darken the ground disc's own vertex colours in a radius
   around every large scatterer at build time, the same way the terrain is
   displaced at build time. It will not track a moving sun — nothing here does.
3. **Neon edge antialiasing.** DONE — the strips now hold a minimum width in
   PIXELS. Each vertex carries the strip's centre line and its half-width
   offset; the vertex shader projects both, measures the half-width in pixels,
   and pushes the vertex out along the same screen direction if it is under the
   floor (1.35px). Near strips are untouched. Far ones hold a steady thin line
   instead of dissolving into a crawling row of dots — which is what they did,
   and it was the worst aliasing in the frame.
4. **More lengthwise road slicing on stunts.** `SLICE_STEP` is uniform; loops
   and corkscrews are where faceting shows and where the camera lingers.
5. **Ship interiors.** Canopies are opaque shells. A visible pilot silhouette is
   a small mesh and a large readability win on the garage/podium screens.

## 5. Low-end: what would actually raise the picture

1. **Give LOW the grade back** (§2b). DONE — the JuicePass now always runs and
   only compiles out the 18-read smear.
2. ~~**Tier the ground disc.**~~ **DROPPED, and the reasoning was wrong.** The
   idea was that 27.5k fixed triangles is worth cutting at LOW. But the disc's
   cost is not its triangles — it is *fill*: it covers most of the screen, and a
   coarser disc covers exactly as many pixels. Tiering it would have bought ~5%
   of the vertex count, 0% of the fill, and cost the dunes their shape. This is
   the same mistake the tiers made the first time round, made by me, in a
   document written to warn against it.
3. ~~**Price the additive overdraw properly.**~~ **MEASURED 2026-07-29, and it
   is not a cost at all.** See §5a below. The suspicion was that sparks, camera
   flashes, exhaust ribbons, motes, glow ribbons and ship reflections stack into
   the real fill cost on weak GPUs. They do not: the whole additive layer runs
   at **~0.05 of one screen fill**, worst frame measured 0.175. The density
   knobs the tiers use to govern it are steering roughly one percent of the
   frame.
4. **Cap the crowd by distance, not by density.** DONE, though not as written.
   The instances still draw — it is one instanced call either way, and culling
   them would need the seat array recompacted. What was removed is the per-frame
   CPU work: a stand beyond 190m no longer gets its bob and flash cycle
   recomputed, and the instance buffer is only re-uploaded when something
   actually moved. That is most of the system's cost on a weak machine and it is
   invisible, because `near` was already 0 out there.

## 5a. The additive layer, measured (2026-07-29)

> **The CITY numbers below are superseded and NOT re-measured (2026-08-05).**
> The rain went from 170 additive streaks to 1000 when the city storm landed —
> same single instanced draw, but a pure FILL change, and fill is the ceiling.
> `node tools/audit-overdraw.mjs 6,7,8` on real hardware is owed before anyone
> quotes a city figure from this table. It could not be run in the container
> the change was made in: software rasteriser, and a single 480x270 sample did
> not finish in 15 minutes against the 2-3 it takes on a GPU. Desert, coast and
> frost are untouched by that change and still stand. See `STATUS.md` §2.6d.

`node tools/audit-overdraw.mjs 0,5,8,11 low,medium,full 3`, one track per world,
three regimes each (clean racing / scraping a wall for sparks / a firefight),
counted at 1280x720. **1.000 would mean one extra full-screen layer of blended
fill per frame.**

| Circuit | LOW | MEDIUM | FULL | worst frame | coverage | max stack |
|---|---|---|---|---|---|---|
| Sunset Circuit | 0.079 | 0.096 | 0.052 | 0.163 | 4–7% | 6 |
| Breaker Bay | 0.045 | 0.046 | 0.089 | 0.175 | 4–7% | 6 |
| Grid Lock | 0.056 | 0.052 | 0.060 | 0.080 | 4–5% | 5 |
| Moonlit Mile | 0.051 | 0.050 | 0.050 | 0.062 | 4% | 6 |

Where it goes, averaged over all twelve runs:

```
  ships    0.018 - 0.063   engine flames, exhaust ribbons, cores   <- the big one
  other    0.019 - 0.033   neon edge strips, pads, arches, rounds  <- remarkably flat
  scenery  0.001 - 0.013   motes and glow ribbons                  <- nothing
```

Three findings, in order of how much they should change what we do:

**The whole additive layer is ~5% of one screen fill.** Against a post chain
whose JuicePass alone is a full-screen 12-tap read, and an opaque pass that is
1.0 fills before anything else, every transparent effect in the game together is
low single-digit percent of the frame's fill work. It is not what holds a weak
machine back, and it never was.

**The tiers do not order.** Sunset Circuit reads FULL (0.052) *below* LOW
(0.079); Breaker Bay reads FULL at double LOW; Moonlit Mile reads 0.051 / 0.050 /
0.050. What moves the number is where the camera is standing and whether
something is scraping a wall — not the tier. At three samples per combination
the tier effect, if there is one, is smaller than the positional variance. That
is the honest statement: not "the knobs do nothing", but "the knobs move less
than the noise".

**`motes` is the clearest waste.** It is the knob LOW cuts hardest (0.3x), and
the entire scenery-additive budget it governs is 0.001–0.013 of a screen fill.
LOW is trading the world's atmosphere for one part in a thousand of the frame.
This is §2b's mistake again in the other direction: a tier taking something
visible away to buy something unmeasurable.

What this does NOT cover: the post chain's own additive composite (priced
separately, §1), grandstand camera flashes at close range (they fire inside
~70m and no run forced a pass tight against a stand), and any statistical
separation between the three regimes — only the peaks are clear.

## 6. Things that would NOT help

Worth stating so the effort does not go here:

- **More triangles.** There is headroom, but geometry is not what limits the
  picture; §1 shows the frame is nowhere near a triangle wall.
- **Textures / PBR.** Breaks the no-textures art direction, adds real bandwidth,
  and would look foreign next to the neon. See TERRAIN.md on the asset-pack
  question.
- ~~**More particles.**~~ This entry said additive overdraw was the least-measured
  cost in the engine and that adding to it before measuring it was how the tiers
  got their cost model wrong. The first half is now false (§5a) and the second
  half was the right instinct pointed at the wrong target: the measurement says
  there is headroom here, not danger. Particles are still governed by screen
  coverage, but "we have not priced this" is no longer the reason to say no.
- **Motion blur.** Considered and declined; the radial smear already sells speed
  and a per-object blur would fight the flat-shaded look.

---

## Method

- Per-tier draw/tri: `qualityState()` plus the HUD stats line, at a fixed race
  time, switching tiers between screenshots.
- Geometry inventory: walk `__game.scenery.group`, count
  `index.count/3` (or `position.count/3`) times `InstancedMesh.count` per child.
- Effective resolution: `effectiveRatio()` from `src/fx/quality.js`, evaluated
  against real panel sizes.
- Bandwidth: buffer pixels x 8 bytes (HalfFloat RGBA) x MSAA samples x 60. This
  prices ONE fill of the colour buffer and is a floor, not a total.
- Lighting mismatch: azimuth of `TUNING.SUN_DIR` in XZ versus each theme's
  `sky.sunAz`.
- Additive overdraw (§5a): `tools/audit-overdraw.mjs`. Two passes into a float
  target — solids first for depth, then the additive objects alone with a flat
  material that adds exactly 1.0 per fragment — summed over the buffer.

  Two things that make this measurement easy to get wrong and both of which
  produced entirely plausible wrong numbers on the way here:

  - **`visible = false` prunes the whole subtree** in three.js, so hiding a
    solid hull also hides the additive engine glow parented under it. Isolate
    with LAYERS, which are per-object.
  - **The effects update in the RENDER path**, not the fixed step:
    `sparks.update`, `shipVisual.update`, `trails.update` and the shock/fireball
    pools all live in `main.js`'s frame, so `__game.warp()` — and any
    hand-rolled sim loop — leaves every one of them frozen. Measuring that
    reports three identical regime columns and a zero for the ships. The frames
    that count have to come from the game's own loop.
