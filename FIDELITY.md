# FIDELITY.md — where the picture can still get better

**Four of the items below have since been built** (frost sun direction, the LOW
grade, the ULTRA rung, contact shading). They are marked DONE in place; the
reasoning is kept because it is the record of why, and the numbers are still the
baseline anything new gets measured against.

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
3. **Neon edge antialiasing.** The track edge strips are thin, very bright
   geometry against dark road: the single worst aliasing in the game, and the
   thing MSAA helps least because the contrast is enormous. Widening the strip
   slightly with distance (a fixed *screen-space* width rather than world width)
   would do more than another MSAA sample.
4. **More lengthwise road slicing on stunts.** `SLICE_STEP` is uniform; loops
   and corkscrews are where faceting shows and where the camera lingers.
5. **Ship interiors.** Canopies are opaque shells. A visible pilot silhouette is
   a small mesh and a large readability win on the garage/podium screens.

## 5. Low-end: what would actually raise the picture

1. **Give LOW the grade back** (§2b). DONE — the JuicePass now always runs and
   only compiles out the 18-read smear.
2. **Tier the ground disc.** 27.5k tris, fixed cost, on every world, at every
   tier. LOW could take a 48x64 disc for ~6k. It is built once, so this can only
   apply at load, not on a live tier switch — which is fine, LOW is usually a
   deliberate choice or an early ADAPTIVE decision.
3. **Price the additive overdraw properly.** Sparks, camera flashes, exhaust
   ribbons, motes, glow ribbons and ship reflections are all transparent and all
   stack. This is the real fill cost on weak GPUs and the tiers currently guess
   at it with density knobs rather than measuring coverage. Worth an actual
   measurement pass before tuning further.
4. **Cap the crowd by distance, not by density.** `setDensity` thins every stand
   equally; a stand 800m away contributes nothing but instances. Distance
   culling per stand would let LOW keep a *full* nearby crowd, which is the one
   the player sees.

## 6. Things that would NOT help

Worth stating so the effort does not go here:

- **More triangles.** There is headroom, but geometry is not what limits the
  picture; §1 shows the frame is nowhere near a triangle wall.
- **Textures / PBR.** Breaks the no-textures art direction, adds real bandwidth,
  and would look foreign next to the neon. See TERRAIN.md on the asset-pack
  question.
- **More particles.** Additive overdraw is already the least-measured cost in
  the engine (§5.3). Adding to it before measuring it is how the tiers got their
  cost model wrong the first time.
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
