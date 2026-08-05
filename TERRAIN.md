# TERRAIN.md — real ground relief

**Status: BUILT.** `src/track/terrain.js` is the height function,
`tools/audit-terrain.mjs` is its guard. This file is now the design record
rather than a proposal; the section headed "What it collides with" is still the
live list of things that break if the height function changes.

## Why it existed — the ground used to be flat

`buildGround()` in `src/track/scenery.js` built a `CircleGeometry(1600, 48)`,
rotated flat, at a single Y. Every dune band, wind ripple, sand grain, scrub
blotch and sun-kissed crest was painted in the **fragment** shader. There was
zero relief anywhere in any world.

That had three consequences, and they are the ones a player feels without being
able to name:

- **No parallax.** Painted dunes are locked to the plane, so they slide past at
  exactly the rate the flat ground does. Real dunes at different distances move
  at different rates, and that difference is most of what "big landscape" means.
- **No silhouette and no occlusion.** Nothing in the middle distance can ever
  hide behind anything. Rocks, flora and stands all sit on one datum with
  nothing between them, which is why the worlds read as objects arranged ON a
  surface rather than objects IN a place.
- **No horizon shape.** The far mountains carry the entire skyline on their own.

This is the last large "cheap but visible everywhere" item in the environment,
and it sits on the **geometry** axis, which is the axis with headroom (see the
graphics budget in `CLAUDE.md`). It is not a fill-rate cost.

## On the offered implementation

A procedural Perlin desert generator was offered in a GitHub comment
(`sweriko/westwelt-v0`, `public/js/desertTerrain.js`). The idea is right. The
code should not be pasted in:

- **Licence.** "Maybe it's helpful" in a comment is not a licence grant. With no
  LICENSE file a repository is all-rights-reserved by default, and this project
  is public and may be commercial. Check the repository's licence before reusing
  anything from it.
- **We do not need it.** Perlin/simplex noise has public-domain reference
  implementations (Perlin's own improved-noise reference; Gustavson's simplex
  notes), and the rest of that file is town-clearing and cactus placement that
  would be deleted on arrival.

## What was built

One height function, sampled by everything — evaluated on the **CPU only**.

The design below said "both CPU and GPU evaluate the SAME formula". That was
the wrong call and it did not survive contact: `sin()` in float32 on the GPU and
float64 in JS do not agree, and the failure mode is every rock, cactus and
grandstand leg in the world floating a metre off the sand. Instead the ground
mesh is **displaced at build time** — it is static, so this costs nothing per
frame — and there is exactly one implementation of the noise, in JS, which the
scatterers call too. No agreement problem to have.

Measured after landing (`node tools/audit-terrain.mjs`): 0.000m of terrain
intrusion near the road on all twelve circuits, with 21m of relief on the
desert, 13m on frost, 8m on the coast and 3.5m in the city.

**Updated 2026-08-03 (`f8cab68`).** Frost was raised from amp 17 to 30 and freq
0.0048 to 0.0040 (~250m wavelength) because Martin said the snow tracks were
basically flat. He was right: frost was running well under the desert's 26, so
what relief existed sat far away, low, and camouflaged white-on-white. Relief
near the road on the three frost circuits went **12.8m -> 22.8m**, and
intrusion stayed 0.000m on all twelve. The figures in the paragraph above are
the ORIGINAL landing measurement; frost now reads 22.8m, not 13m.

**And a limit worth knowing before reaching for `amp` again** (`ART.md` §4):
`FLAT_TO = 26` means the first 26m either side of the road is dead flat by
construction, so `amp` cannot change anything in the band you actually look at
from the cockpit. Any ground effect that keys off the vertex height — the
snow's cold hollows do — is therefore a CONSTANT in that band, not a gradient.
That is why raising the amplitude did not change how the snow feels, and why
the next move there is a world-XZ-keyed term rather than more relief.

**Solved 2026-08-05, and `amp` was the wrong lever both times.** Martin from
the cockpit: the hills *"ser ut som en stor sten"*. The height was there; the
DISTRIBUTION was wrong. `fbm` loses amplitude by `gain` per octave, and at the
original 0.48 the first octave carries 58% of the budget — 17.5m of frost's 30
in one ~250m wave, which is a single swell with a texture on it however tall
you make it. `gain` is now a per-theme knob (default 0.48, so every world that
does not ask is bit-identical) and frost runs **4 octaves at 0.66**: the same
30m spread 12.6 / 8.3 / 5.5 / 3.6m across ~250 / 117 / 55 / 26m. `RAMP_TO`
also came in from 95 to 72 so the relief arrives inside the band the chase
camera actually frames; `FLAT_TO` did not move and must not.

Confirmed on hardware: *"böljande marken är klar"*. **The lesson to carry:
relief is a budget, and the octave gain is how it gets spent. If a landscape
reads as one shape, look at the distribution before the amplitude.**

## The design (as written before building)

One height function, sampled by everything.

    h(x, z) = carve(x, z) * fbm(x, z)

- **`fbm`** — 3–4 octaves of gradient noise, per-world amplitude and frequency
  (long lazy dunes for the desert, sharper drifts for frost, near-flat for the
  city). Deterministic from the track seed, like every other placement.
- **`carve`** — `smoothstep` on distance to the centreline: flat inside ~25m of
  the road, ramping to full amplitude outside ~60m. Baked once at build as a
  coarse distance field over the track bounds, because the loop crosses over
  itself and a nearest-sample search per vertex is the wrong shape.

Both CPU and GPU evaluate the SAME formula — the GPU for the ground mesh, the
CPU for placement. If those two ever drift, everything scattered on the ground
floats.

**Mesh.** A radially graded disc: dense rings near the track, coarse toward the
horizon, so the resolution follows where the relief is legible. Budget ~40–60k
triangles in **one draw**. Displacement happens in the vertex shader, so there
is no per-frame CPU cost at all. The existing dune fragment shader stays exactly
as it is and becomes fine detail ON TOP of real relief rather than a substitute
for it.

## What it collides with

Not a drop-in. These are the real ones:

1. **`groundY` is a single scalar** — `minEdge - 0.8`, the lowest banked track
   edge anywhere on the circuit minus clearance. Displace the disc and dunes
   punch up through the road wherever the track sits low. The carve mask is what
   fixes this, and it has to be right before anything else is switched on.
2. **Every scatterer plants at exactly `groundY`.** `buildRocks`, `buildScrub`,
   `buildRoadside`, `buildFlora`, `buildStands` (its legs), `buildHuts`,
   `buildIceSculptures`. All of them need to sample `h()` instead.
3. **Stand footprints must stay level.** A 42m-long raked deck across a dune
   reads as broken. Either the carve mask covers the stand footprint too, or
   the stand samples `h()` at its centre and levels its own legs.
4. **`clearOfTrack()` and the placement rejection tests** are 2D and stay 2D —
   they are unaffected, but every caller that then sets `y = groundY` is not.
5. **`tools/audit-tracks.mjs` is unaffected** — it audits road-against-road, not
   road-against-ground. A separate check may be wanted: no terrain vertex within
   N metres above the road surface.

## Order of work (all four done)

1. Height function + carve field, CPU only, proven by `tools/audit-terrain.mjs`.
   Note the audit's own first version was wrong: it measured absolute clearance
   to the road, which every track fails by construction, because the flat plane
   already sits exactly 1.15m under the circuit's lowest banked edge. The metric
   that means something is INTRUSION — how high the ground gets near the road.
2. Ground mesh displaced at build time. A radially graded disc, rings crowding
   toward the centre, ~28k triangles in one draw.
3. Every scatterer onto `groundAt()`. Steps 1 and 2 are worthless without this —
   a world with relief and floating rocks looks worse than a flat one.
4. Per-world tuning in `theme.terrain { amp, freq, octaves, ridge }`.

## Still flat on purpose

The lagoon surface, the city street grid and anything the fragment shaders draw
as a plane. `theme.terrain` is opt-in: a world without the block gets exactly
the old flat disc, and nothing else in the file changes behaviour.
