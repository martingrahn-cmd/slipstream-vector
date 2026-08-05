# ART.md — what the picture is doing wrong, and in what order to fix it

Written 2026-08-05. **§7 steps 1, 2 and 4-on-desert have shipped; step 3 is in
but did not beat its own numbers; steps 5-6 have not started. See §9.**

It exists because "the snow feels drab" is a true observation that three
different technical explanations would each fit, and picking the wrong one
costs a week. Every claim below is measured off real in-engine frames or read
out of the code, and the measurement recipe is in §7 so the next person can
check rather than argue.

Companion docs: `FIDELITY.md` is what limits the picture *technically*;
this is what limits it *pictorially*. They are different lists.

---

## 1. What was measured

Frames shot in-engine at 1280x720, FULL quality, chase camera, four worlds.
Crops taken on each world's large ground field with the road and sky excluded.
Luma is Rec.709 on the sRGB triple; chroma is `(max-min)/255`.

| surface | luma p50 | tonal spread (p10-p90) | **chroma** |
|---|---|---|---|
| frost snowfield | 0.59-0.71 | 0.06-0.15 | **0.16** |
| desert sand | 0.70 | 0.07 | 0.40 |
| desert mesas | 0.59 | 0.13 | 0.50 |
| tropic water | 0.37 | 0.43 | 0.57 |
| city mid-ground | 0.13 | 0.18 | 0.39 |

And the gameplay language, measured on the same frames:

| world | ground | **magenta edge** | cyan edge |
|---|---|---|---|
| Neon Sprawl | 0.13 | **0.26** | 0.69 |
| Sunset Mesa | 0.70 | **0.47** | 0.71 |
| Frostfall Ridge | 0.61 | **0.33** | 0.70 |

---

## 2. Finding A — the gameplay language changes polarity between worlds

`CLAUDE.md` says the track-edge neon is gameplay language: cyan left, magenta
right, identical across worlds, never restyled per theme. The **colours** are
identical. The **contrast** is not, and contrast is what makes a thing read.

- In the city, magenta is **lighter** than the ground (0.26 vs 0.13). It glows.
- On desert and frost it is **darker** than the ground (0.47 vs 0.70; 0.33 vs
  0.61). It reads as a line painted on the floor.
- Cyan on desert sits at 0.71 against a 0.70 ground: **zero value contrast.**
  It survives on hue alone.

So the rule is honoured in the letter and broken in the effect. Half the
gameplay language inverts polarity depending on which world you loaded.

**Why it happens is arithmetic, not styling.** The two constants are not equal
in value to begin with (`config.js:231-232`):

| | hex | sRGB luma |
|---|---|---|
| `EDGE_L` cyan | `0x00f0ff` | **0.745** |
| `EDGE_R` magenta | `0xff2ec8` | **0.398** |

A 0.35 gap. Magenta at 0.40 is therefore darker than *any* ground above 0.40 —
which is desert (0.70) and frost (0.61), and is not city (0.13). Nothing
per-world is required to explain it; the language is asymmetric at the source
and the worlds simply fall on either side of the line.

**And the neon cannot be fixed per world even if we wanted to.** The strip
builder never receives the theme — `buildEdgeStrips(spline)` takes the spline
only, where every other builder in `trackMesh.js` takes `(spline, theme)` — and
the material is opaque, unlit, unfogged, `fog: false`, with a fragment shader
that writes `vColor` and nothing else. The strip core is constant by
construction, which is exactly what the rule wants. What little world variation
the measurements show comes from downstream: the per-world grade saturation,
and the additive glow ribbon, which adds onto whatever the world drew behind it
and so lifts less, proportionally, over a bright ground.

**The fix is therefore the ground, and only the ground.** Bring desert and
frost down toward where the city already sits. Tinting the neon per world would
require giving the strip builder a theme dependency it deliberately does not
have.

## 3. Finding B — frost is the only world that is both pale and colourless

Martin: *"snön känns lite för grådaskig."* Measured, he is right, and it is not
subtle — frost carries **less than half the chroma of any other world**
(0.16 against 0.39-0.57). Three separate causes stack:

**B1. The palette is grey by construction.** Every large frost surface is a
near-neutral:

| field | hex | luma | chroma |
|---|---|---|---|
| `ground` | `0xc7d4e8` | 0.83 | **0.129** |
| `groundB` | `0xa7b9d6` | 0.72 | 0.184 |
| `warm` | `0xdfe9ff` | 0.91 | **0.125** |
| `sand` | `0xdde8f6` | 0.90 | **0.098** |
| `mesaRim` | `0xeef4ff` | 0.95 | **0.067** |
| `mesaLit` | `0xb2c4e0` | 0.76 | 0.180 |
| `mesaShadow` | `0x44548e` | 0.33 | 0.290 |

Desert's ground is `0xd0a068` — chroma **0.408** at a similar lightness.
Only `mesaShadow` has real colour, and it is the one that covers least screen.

Worse: `warm` is described in `themes.js` as "moonlight 'warm' highlight —
actually the coldest light", and it is true — it is *bluer* than the base. So
the highlight and the shadow are the same hue at different lightnesses. **There
is no temperature separation anywhere in the world.** That is the definition of
a monochrome picture, and it is why it reads as drab rather than as cold.

**B2. The grade removes what little colour there is.** `theme.grade.saturation`
is **0.96 on frost — the only world in the game below 1.0.** Desert 1.14,
tropic 1.12, city 1.10. The least chromatic world is the only one whose grade
actively desaturates it.

**B3. The aurora — the one genuinely colourful thing in the world — never
touches the ground.** It is a sky-shader effect. The scene contains **no
lights at all**: every ground and prop material is `MeshBasicMaterial` with
vertex colours baked at build time by `bakeFlatColors`. So the northern lights
build all race long, own the zenith, and contribute exactly **zero** to the
snow underneath them. In life that reflected light is the entire reason a
moonlit-aurora scene is beautiful.

**B4. The same two colours also shade every prop in the world — which means
"grådaskig" and the "paper" cliff faces are ONE problem, not two.**
`scenery.js:385` passes the theme straight into the baker:

```js
setBakeTheme(theme.mesaRim, theme.ground, theme.warm, theme.sky.sunAz);
```

and `bakeFlatColors` builds every default-shaded face from exactly those:

```js
const lit    = base.clone().lerp(new THREE.Color(BAKE_WARM), 0.22);
const shadow = base.clone().multiplyScalar(0.5).lerp(new THREE.Color(BAKE_SHADOW_TINT), 0.25);
const rim    = new THREE.Color(BAKE_RIM);
```

So on frost the lit face of every rock, spruce, pole, sculpture, hut and cliff
is pulled 22% toward `warm` (0xdfe9ff, chroma 0.125, *bluer* than the base it
sits on) and the shadow face 25% toward `ground` (0xc7d4e8, chroma 0.129).
**Both ends of every prop's shading are the same near-neutral blue.** That is
why `STATUS.md` §2.6c's cliff faces read as flat pale slabs: it is not
primarily their geometry, it is that they have no temperature difference
between their lit and unlit sides. `mesaRim` at chroma 0.067 means the rim
light carries none either.

This is the good news in the whole document. Fixing B1 — two hex values — fixes
the props at the same time, for free, on every frost track, with no new code.

**Housekeeping found on the way** (trivial, but this is where it is written
down): `warmCrown: 0xffffff` has **no consumer anywhere** in `src/` or the
labs; `sand: 0xdde8f6` is **dead on frost** (only tropic reads it), while the
frost drift hump hardcodes that same literal at `scenery.js:2943` instead of
reading the theme.

## 4. Finding C — the near band is flat by construction, on every world

This is the deepest one, and it explains why the frost hills work
(`f8cab68`, amp 17 -> 30) did not change how the snow feels.

`terrain.js` has two constants:

```js
const FLAT_TO = 26;    // metres from the road edge that stay dead flat
const RAMP_TO = 95;    // ...and where the terrain reaches full amplitude
```

Everything within **26 m of the road is dead flat**, by design, to protect the
racing line. The snow shader's cold-hollows pass — the thing that is supposed
to give the snow tonal variation — keys off `vY`, the vertex's own displaced
height:

```glsl
float hollow = (1.0 - smoothstep(1.0, 14.0, vY)) * uSnow;
col = mix(col, uShadow, hollow * 0.34);
```

Inside 26 m, `vY` is **exactly 0 everywhere**, so `hollow` is a **constant 1**.
A constant is a flat tint, not a gradient. The band you actually look at at
250 km/h is the one band where the effect mathematically cannot vary. Raising
the terrain amplitude cannot help: it changes nothing inside 26 m.

The only near-field variation left is the dune-band term, and its contrast is
tiny on both affected worlds — the two band colours differ by 0.10-0.11 luma,
mixed at 0.55, for an **effective range of 0.056 (desert) and 0.059 (frost)**.
That matches the measured spreads of 0.07 and 0.06 exactly.

So: **desert and frost share a structural flatness**, and it is not the
terrain, the tier, or the geometry. Desert gets away with it because it is a
saturated warm field; frost does not, because it is a grey one. That is the
whole difference between "sand" and "drab".

## 5. Finding D — the sky drifts, the world does not

`col *= mix(1.0, 0.78, progress)` exists only in the sky fragment shader.
`raceProgress` has exactly two consumers and both are the sky. Over a race the
backdrop drops 22% while the ground, road, props and ships stay put, so by the
last lap the sand is *relatively brighter* against the sky than it was at the
start. That is the opposite of dusk falling, and it is why the mood drift never
quite lands.

**The pass order decides how to fix this**, and it is unambiguous
(`postfx.js:342-377`):

```
RenderPass -> BloomPass -> JuicePass -> OutputPass
```

Bloom sits **before** the grade. Therefore:

- Darkening in the **grade** (after bloom) dims the whole picture *including*
  the glow. Self-consistent, but the neon does not step forward — you get an
  evenly turned-down image.
- Darkening in the **scene** (before bloom) shrinks what the ground contributes
  to the bright pass while the neon keeps its own brightness. Contrast rises,
  and **the neon steps forward as the world darkens** — which is the effect
  actually wanted, and it is also what the sky's existing `x0.78` already does.

So this belongs in the scene, not in the grade. It also fixes Finding A for
free on the back half of every race.

## 6. Finding E — the middle ground is empty on three of four worlds

Foreground (road, ship) is strong. Background (mesas, skyline, ridges) is
strong. Between roughly 40 and 150 m there is a flat plain with small,
evenly-sized objects scattered on it, and the eye has nothing to hold.

The city is the exception: the canyon tower rows fill exactly that band, which
is why it reads as a **place** while the others read as **a road across a
field**.

The scatter reads as litter rather than landscape, and the code says exactly
why. Every near-band scatterer picks its size from a range about 2-3x wide,
all of it small, and picks its position from a flat uniform along the lap:

| builder | count | size expression | placement |
|---|---|---|---|
| `buildRocks` | desert 340, frost 240 | `0.5 + rng() * 1.9` (world radius) | `rng() * spline.length` |
| `buildScrub` | desert 210 | `1 + rng() * 1.5` | `rng() * spline.length` |
| `buildRoadside` | 240-560 | `0.8 + rng() * 1.2` | `rng() * spline.length` |
| `buildBillboards` | every 130-320m | **fixed 11 x 5.5 — one size** | by curvature |

So the largest natural form anywhere in the near band of a wilderness world is
a **2.4 m rock**, and nothing anywhere clusters — `rng() * spline.length` is a
flat uniform, with no zones and no rejection. Real landscape is a few big
forms, some medium, many small, and they clump. This is the same diagnosis the
islands got ("three geometries repeated") and the frost cliff faces have now
("boxes with vertex jitter"). It is the project's recurring weakness:
**quantity without hierarchy.**

The fix is therefore not "more rocks". It is a size hierarchy with forms at 5,
10 and 20 m, and a clustering rule so the field has empty stretches to make the
clusters read. `monumentZones` (frost) and `buildCanyon` (city) are the two
places in the file that already do something like this.

---

## 7. The order to do them in

Ranked by felt change per unit of work. The first two are hours, not days.

**1. Give frost a temperature split.** Palette only, ~8 hex values. Blue in the
shadows, neutral-to-warm in the lights, base value down from 0.83 toward ~0.50.
Set `grade.saturation` to at least 1.05 like every other world. This is the
direct answer to "grådaskig" and it needs no new code at all — and per B4 it
also fixes the cliff faces and every other prop in the world in the same
stroke, because `ground` and `warm` ARE the baker's shadow and lit tints.
Judge it on props as well as on snow: that is the same change's blast radius.

**2. Let the aurora light the snow.** The frost sky already computes an aurora
amplitude that grows over the race. Feed the same value to the snow shader as a
faint chromatic wash keyed to the aurora's own colour and bearing. One uniform,
zero draws. It fixes B3 and gives frost the one thing no other world has — and
because it grows with `raceProgress`, it is Finding D's mechanism arriving
early on one world, where it can be judged cheaply.

**3. Widen the near-band variation with something that is not terrain height.**
Finding C means `hollow` can never vary inside 26 m. Open the dune-band A/B gap
(the cheapest half: it is two hex values and it doubles the range), and add a
world-XZ-keyed scour/drift term the way the desert's mid-scale ripples already
work. Do NOT reach for the terrain amplitude again — it provably cannot help.

**4. Bring the desert and frost ground values down.** Restores the gameplay
language's polarity (Finding A). Do this after 1-3 so the two changes are
judged together rather than fighting each other.

**5. World-wide light drift, in the scene and before bloom** (Finding D).
Bigger blast radius — it touches every material — so it wants 1-4 settled
first. Risks to check when it happens: HUD readability, the LOW tier which has
no post at all, and whether the neon stepping forward is *too* strong by the
final lap.

**6. Middle-ground mass** (Finding E). The biggest job and the one with the
most authored content in it. `buildCanyon` is the model that already works.

## 8. How to verify any of it

The claim to beat is a number, not an opinion. Shoot a frame in-engine, then:

```python
from PIL import Image
def L(r,g,b): return (0.2126*r+0.7152*g+0.0722*b)/255
def chroma(r,g,b): return (max(r,g,b)-min(r,g,b))/255
d = [q for q in Image.open(shot).convert('RGB').crop(box).getdata() if L(*q) > 0.35]
lum, ch = sorted(L(*q) for q in d), sorted(chroma(*q) for q in d)
n = len(lum)
print(lum[n//10], lum[n//2], lum[9*n//10], ch[n//2])   # p10, p50, p90, chroma
```

Crop the large ground field, exclude road and sky, and drop anything under 0.35
luma so the road does not contaminate the sample — that mistake made the frost
snowfield read as having a 0.63 tonal spread when the truth is 0.06-0.15.

Targets, so success is falsifiable:

- frost ground chroma **0.16 -> 0.30+**, i.e. inside the range every other
  world already occupies
- frost and desert ground tonal spread **0.07 -> 0.15+**, i.e. what the mesas
  already manage
- magenta edge **lighter than the ground on every world**, which is the only
  statement of Finding A that matters

---

## 9. What shipped (2026-08-05)

### Step 1 — the frost temperature split

Palette only, plus one grade number. No new code.

| field | was | now | what changed |
|---|---|---|---|
| `ground` | `0xc7d4e8` | `0x7189bf` | luma 0.83 -> 0.53, chroma 0.129 -> **0.306** |
| `groundB` | `0xa7b9d6` | `0xaabee0` | band range 0.059 -> **0.113**, nearly double |
| `warm` | `0xdfe9ff` | `0xffecd2` | hue **221° -> 35°** |
| `mesaShadow` | `0x44548e` | `0x36478a` | chroma 0.290 -> 0.329 |
| `mesaLit` | `0xb2c4e0` | `0x9fb4d8` | chroma 0.180 -> 0.224 |
| `mesaRim` | `0xeef4ff` | `0xdcecff` | chroma 0.067 -> 0.137 |
| `rock` | `0x8ca4c6` | `0x6f86ad` | chroma 0.227 -> 0.243 |
| `sand` | `0xdde8f6` | `0xc8daf2` | was dead on frost; now drives the drift humps |
| `grade.saturation` | `0.96` | `1.10` | no longer the only world under 1.0 |

The number that matters is not in any single row. `ground` sat at 216° and
`warm` — the *highlight* — at 221°: a five-degree split, i.e. the light was
bluer than the shadow it was meant to oppose. It is now **222° against 35°**.
That is the whole of "grådaskig".

`warmCrown` was deleted (no consumer anywhere), and `scenery.js`'s frost drift
hump now reads `theme.sand` instead of hardcoding the same literal.

**Measured, identical framing, Moonlit Mile at s=430, FULL:**

| | before | after | §8 target | |
|---|---|---|---|---|
| chroma | 0.161 | **0.271** | 0.30+ | short by 0.03 |
| tonal spread | 0.15 | **0.27** | 0.15+ | met, and then some |
| luma p50 | 0.59 | **0.51** | down | met |

Two of three targets met. Chroma landed at 0.271 against a stated 0.30 — a 68%
rise, but the target was missed and saying so is the point of having set it.
The remaining lever is the light band: `groundB` is deliberately a pale
wind-scoured crest colour, and mixing toward it costs chroma. Pushing it is a
tuning pass against Martin's eye on real hardware, not a blind edit here.

Because `ground` and `warm` ARE `setBakeTheme`'s shadow and lit tints (§3 B4),
this also relit every prop in the world — rocks, spruces, poles, sculptures,
huts and the cliff faces of `STATUS.md` §2.6c — in the same stroke.

### Step 2 — the aurora lights the snow

The frost sky already grows an aurora over the race. The ground now rides the
**same amplitude expression** the sky curtains use — `(0.4 + 0.5*progress) *
(1 + 1.4*flare)` — as a bounded mix toward the curtains' own green, biased
toward crests because the light arrives from above:

```glsl
float aur = uAurora * uSnow;
col = mix(col, uAuroraCol, aur * (0.35 + 0.65 * crest) * 0.22);
```

Mixed rather than added, so it tints instead of blowing out — snow under an
aurora goes green, it does not go white. One uniform, **zero draws**, gated on
`uSnow` so no other world pays for it. It also opens the tonal range rather
than sliding it, because it is the one term that is brightest where the cold
pools are darkest.

It grows through a race: ~0.09 of mix at the start, ~0.20 by the last lap.

**Measured A/B, identical camera, `uAurora` forced 0 then 0.9:**

| | luma | chroma | green excess |
|---|---|---|---|
| off | 0.502 | 0.275 | **-0.029** |
| on | 0.602 | 0.227 | **+0.090** |

Green excess is `(G - (R+B)/2)`, the aurora's own tell. It swings **0.119**,
from blue-leaning to distinctly green-lit: the snow is being lit by the sky.

Two honest costs in that table. The mix **raises luma by 0.10** at full
amplitude, which partly gives back the value drop step 1 bought — step 4, when
it comes, has to budget for the last lap and not just the first. And **chroma
falls 0.275 -> 0.227**, because a blue surface mixed toward a green light
passes through teal, and `max-min` undersells a teal. Both states are far above
the 0.161 the world started at, and a green snowfield at the climax of the
AURORA CUP is the right picture — but the metric moves the wrong way and that
is worth knowing before anyone reads §8 as a scoreboard.

Verified in-engine: `uAurora` 0.9 at progress 1, `colA #7189bf`, `warm
#ffecd2`, `saturation 1.10`, console **clean** — no shader errors on any world.

### Still open from this document

Steps 3-6 — near-band variation that is not keyed on terrain height, the
desert/frost ground values, the world-wide light drift before bloom, and
middle-ground mass. And the chroma target above, by 0.03.

### Steps 3 and 4 (2026-08-05) — one landed, one is honestly incomplete

**Step 4 on DESERT worked.** Sand `0xd0a068 -> 0xb98a52`, band
`0xe2bc84 -> 0xcda66c`, chroma deliberately held (0.408 -> 0.404) because
desert survives a tonally flat field precisely by being a saturated one.

| desert | before | after |
|---|---|---|
| luma p50 | 0.697 | **0.575** |
| saturation | 0.464 | **0.553** |

The neon reads against the sand now instead of on it, and the world is still a
warm sunset desert rather than a night one.

**Step 3 on FROST did not survive its own measurement, and that is recorded
rather than smoothed over.** The sastrugi is in — wind-carved ridges keyed on
world XZ, `abs(sin)` for the sharp-trough profile, in hashed patches, troughs
pooling toward `uShadow`. It is visible in a frame and it addresses Finding C
correctly: it is the only near-band variation that the `FLAT_TO = 26` flattening
cannot erase. But on the measurement crop it costs what step 1 bought:

| frost | before all | step 1 | steps 1-3 |
|---|---|---|---|
| luma p50 | 0.588 | 0.511 | 0.525 |
| tonal spread | 0.149 | **0.270** | 0.177 |
| saturation | 0.230 | **0.417** | 0.327 |

Three iterations were spent on it. The first lifted crests toward `colB` at
0.34 and took saturation all the way back to the pre-pass value — `colB` is a
pale, low-chroma scour colour, so pulling toward it undoes a temperature pass.
At 0.14 it was still net negative. Troughs-only moved the number not at all,
which is the tell that the crop is not dominated by what I thought it was.

**Step 4 was tried on frost and BACKED OFF.** Taking the snowpack to `0x5b76ad`
for Finding A's sake cost saturation 0.417 -> 0.327. The mechanism is real and
worth keeping: frost carries 850 additive snow flakes plus the moon glitter,
and **an additive white overlay is relative** — over a darker base the same
flakes wash out proportionally more colour. Finding A and Finding B pull
opposite ways on this one world, and B is the complaint Martin actually made.
Desert has no additive weather to amplify, so it keeps its full drop.

**A flaw in §8's own metric, found here.** `chroma = (max-min)/255` scales with
brightness, so darkening a surface lowers it even at identical saturation. Use
HSV saturation `(max-min)/max` for any change that moves value. The §8 targets
were written in the wrong unit and the numbers above are quoted in both.

**What is not established.** Whether step 3 is a net gain on frost — it looks
right in a frame and measures worse on a crop, and I could not resolve that
inside the render budget here (one frame is ~10 minutes in this container's
software rasteriser). And the §8 polarity target: the magenta probe is not
robust to the ground changing underneath it, so the "magenta lighter than the
ground" claim is **unmeasured**, not met. Both want Martin's eye and a machine
with a GPU.

---

## 10. Hardware feedback round (2026-08-05, Martin on a real GPU)

Four things, from three frames on Frostfall Ridge. Two were bugs with exact
causes; one is a feature; one is the biggest remaining art item and is NOT done.

### Fixed — the aurora had a seam

`aAz = atan(d.x, d.z)` jumps from +pi to -pi at one bearing, and `sin(k * aAz)`
only survives that jump when **k is a whole number**. The curtain's three fold
harmonics were `2.1/3.0/3.9`, `4.6/5.9/7.2` and `9.1/11.1/13.1` — eight of the
nine fractional. `fold` drives both the hem height and the brightness gate, so
the whole curtain stepped at that bearing.

Proven rather than eyeballed: `|fold(+pi) - fold(-pi)|` measured **1.48 / 0.51 /
1.43** across the three curtains before, and **~1e-15** after.

Worth noting for the next person: the RAY terms in the same shader already used
46, 3 and 97 — all integers. The rule was known, applied there, and never
carried across to the fold. Same family as the cloud-band seam already in
`CLAUDE.md`.

### Fixed — a spruce growing out of a boulder

`buildFlora` tested `clearOfTrack` and nothing else, so it never asked whether a
spot was already occupied. It now also tests `clearOfOccluders` against the
footprint registry the contact shading already maintains (large forms, radius
>= 12), and — the part that makes it a rule rather than a preference — an
instance that still has a boulder in it after eight attempts is **dropped**
instead of placed. One missing spruce in 170 is invisible; one in a rock is
what got photographed.

### Added — the ribs make a sound

Arch ribs sit 5.5m apart, so at racing speed you pass ~14 a second. `archPass`
is 90ms of band-passed air with a little low body under it, pitch and brightness
riding speed, purely procedural — a baked clip fourteen times a second
announces itself as a loop. Counted off the ship's arc length rather than a
trigger volume so it cannot be missed at speed, and counted AROUND THE LOOP so
the last rib of a lap and the first of the next are 5.5m apart and not 3km.
Logic tested over a full lap including the seam: six ribs, once each, and a
1500m warp fires nothing instead of a burst.

### Done — "vill ha ojämn mark, böljande landskap"

Martin's words about the frost hills: *"ser ut som en stor sten"*, and about the
grey blocks: *"inte så spännande"*. This is the real remaining art item and it
is Findings C and E together, now confirmed from the cockpit rather than
inferred from a crop:

- The big forms are `mesaStyle: 'rocks'` at `mesaMax: 175` — single smooth
  faceted masses. They read as boulders because that is what they are: one
  blob each, no strata, no silhouette hierarchy, no smaller forms gathered
  around them to give them scale.
- The GROUND between them does not undulate, and cannot within 26m of the road
  (`FLAT_TO`, Finding C). Beyond that it does, but at `freq 0.0040` — a ~250m
  wavelength, which reads as one broad swell rather than as rolling country.

So "rolling landscape" is not one change. It is: a second, shorter terrain
octave so the mid-distance actually undulates; breaking the big rock forms into
grouped masses with a size hierarchy (Finding E's 5/10/20m tiers); and probably
letting `RAMP_TO` come in closer so the undulation starts nearer the road
without touching the racing line's flat corridor. All three landed:

**A second and shorter terrain octave.** The octaves were already there; the
amplitude falloff was eating them. At the old `gain` of 0.48 the first octave
carried 58% of the height — on frost, 17.5m of a 30m budget in a single ~250m
wave, which is one swell with a texture on it, not country. `gain` is now a
per-theme knob (default 0.48, so every other world is bit-identical) and frost
runs 4 octaves at 0.66: the same 30m spread **12.6 / 8.3 / 5.5 / 3.6m across
~250 / 117 / 55 / 26m**. Note what this is NOT: raising `amp` again, which is
the mistake `f8cab68` already made — a taller single swell is still one shape.

**`RAMP_TO` 95 -> 72.** `FLAT_TO` does not move; it is the racing line's
protection. `RAMP_TO` is only how fast the world comes back afterwards, and at
95 the ramp spent most of the visible near field merely getting started. The
relief now arrives inside the band the chase camera actually frames.

**Companion forms.** Any non-tower mass above scale 30 now gets 2-3 smaller
forms at 0.14-0.38 of its size scattered round its skirt, each clearing the
road on its own footprint. This is Finding E applied for the first time: a big
form reads as big only when something small stands next to it, and a lone
smooth mass reads as a boulder however large you make it. They merge into the
parent's buffer — **zero extra draws**, roughly 20k triangles across a circuit,
which is the cheap axis the graphics budget points at.

Gates after: `audit-terrain` 0.000m on all twelve, `audit-laps` clear, console
clean.

**CONFIRMED ON HARDWARE (Martin, 2026-08-05): "böljande marken är klar".**
Closed. Worth keeping the reason it worked, because the obvious lever was the
wrong one twice running: `f8cab68` raised `amp` 17 -> 30 and changed nothing,
and raising it again would have changed nothing again. Terrain relief is not
one number. **Height is a budget and the octave gain is how it gets spent** —
at 0.48 the first octave took 58% of it and the world got one big swell with a
texture on it. The same 30m at gain 0.66 across four octaves is country. If a
landscape ever reads as a single shape again, look at the distribution before
the amplitude.
