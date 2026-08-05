// Ground relief.
//
// The world used to be a flat CircleGeometry with every dune painted in the
// fragment shader: no parallax, no silhouette, nothing that occludes anything.
// See TERRAIN.md for why that was the last big cheap item and what the shape of
// the fix is. This is that fix.
//
// ONE height function, evaluated on the CPU, sampled by everything:
//
//   h(x, z) = carve(x, z) * fbm(x, z) * amp
//
// The ground mesh is displaced at BUILD time, not in a vertex shader, which is
// what makes this safe: there is no second implementation of the noise on the
// GPU that could drift from the CPU one and leave every rock and cactus in the
// world floating a metre above the sand. The mesh is static, so displacing it
// once costs nothing per frame either.
//
// `carve` is the part that must be right before anything else is switched on.
// `groundY` is a SINGLE scalar for the whole circuit — the lowest banked track
// edge anywhere, minus clearance — so raising the ground anywhere near the road
// punches dunes up through the racing surface wherever the track sits low. Two
// separate guards handle it: a distance ramp that keeps the verge flat, and a
// hard ceiling from the nearest road sample's own height.

const FLAT_TO = 26;    // metres from the road edge that stay dead flat
const RAMP_TO = 72;    // ...and where the terrain reaches full amplitude
// FLAT_TO is the racing line's protection and does not move. RAMP_TO is only
// how fast the world comes back after it, and at 95 the ramp used most of the
// visible near field just getting started — the terrain was there and you had
// to be looking a long way off to see any of it. 72 brings the relief into the
// band the chase camera actually frames. audit-terrain still reads 0.000m on
// all twelve, which is the only thing that constrains this number.
const ROAD_GAP = 3.5;  // terrain must stay this far below the road surface
const CELL = 64;       // spline-sample lookup grid

// Deterministic value noise. Small, cheap and — because nothing else ever has
// to reproduce it — free to be whatever shape looks best.
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function buildTerrain(spline, groundY, theme) {
  const cfg = theme.terrain;
  if (!cfg || !(cfg.amp > 0)) return null;
  const amp = cfg.amp;
  const freq = cfg.freq ?? 0.0042;      // ~240m base wavelength
  const octaves = cfg.octaves ?? 3;
  const ridge = cfg.ridge ?? 0;         // 0 = rolling dunes, 1 = sharp drifts
  const gain = cfg.gain ?? 0.48;        // octave amplitude falloff — see fbm()

  // ---- spline sample lookup grid -----------------------------------------
  // Every carve query needs the nearest piece of road. Scanning all ~1000
  // samples per query would be tens of millions of distance tests across the
  // ground mesh; a uniform bucket grid makes it a handful.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < spline.n; i++) {
    const x = spline.pos[i * 3], z = spline.pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const gx0 = minX - CELL, gz0 = minZ - CELL;
  const gw = Math.ceil((maxX - minX + CELL * 2) / CELL);
  const gh = Math.ceil((maxZ - minZ + CELL * 2) / CELL);
  const buckets = new Array(gw * gh);
  for (let i = 0; i < spline.n; i++) {
    const cx = Math.floor((spline.pos[i * 3] - gx0) / CELL);
    const cz = Math.floor((spline.pos[i * 3 + 2] - gz0) / CELL);
    if (cx < 0 || cz < 0 || cx >= gw || cz >= gh) continue;
    const k = cz * gw + cx;
    (buckets[k] || (buckets[k] = [])).push(i);
  }

  // Nearest road sample: horizontal gap to the road EDGE (not the centreline),
  // and that sample's surface height. Searches an expanding ring of cells so a
  // query out in the empty flats stops after one miss instead of scanning the
  // whole circuit.
  const _near = { gap: Infinity, y: Infinity };
  function nearestRoad(x, z) {
    const cx = Math.floor((x - gx0) / CELL), cz = Math.floor((z - gz0) / CELL);
    let bestD2 = Infinity, bestI = -1;
    const reach = Math.ceil(RAMP_TO / CELL) + 1;
    for (let r = 0; r <= reach; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // ring only
          const ix = cx + dx, iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= gw || iz >= gh) continue;
          const b = buckets[iz * gw + ix];
          if (!b) continue;
          for (const i of b) {
            const ddx = spline.pos[i * 3] - x, ddz = spline.pos[i * 3 + 2] - z;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < bestD2) { bestD2 = d2; bestI = i; }
          }
        }
      }
      // A hit inside this ring cannot be beaten by anything a full ring further
      // out, so stop as soon as the best distance is inside the ring's radius.
      if (bestI >= 0 && Math.sqrt(bestD2) <= r * CELL) break;
    }
    if (bestI < 0) { _near.gap = Infinity; _near.y = Infinity; return _near; }
    _near.gap = Math.sqrt(bestD2) - spline.width[bestI];
    _near.y = spline.pos[bestI * 3 + 1];
    return _near;
  }

  // ---- the height function ------------------------------------------------
  // `gain` is how fast the octaves lose amplitude, and it decides whether the
  // world reads as ROLLING or as one big swell with a texture on it. At the
  // original 0.48 the first octave carries 58% of the height: on frost that is
  // 17.5m of a 30m budget in a single ~250m wave, and Martin's word for the
  // result was that the hill "ser ut som en stor sten". At 0.66 the same budget
  // spreads 12.6 / 8.3 / 5.5 / 3.6m across ~250 / 117 / 55 / 26m wavelengths,
  // which is country rather than one shape. Per theme, defaulting to the old
  // value, so every world that does not ask for it is bit-identical.
  function fbm(x, z) {
    let sum = 0, a = 1, norm = 0, f = freq;
    for (let o = 0; o < octaves; o++) {
      let n = vnoise(x * f, z * f);
      if (ridge > 0) n = 1 - Math.abs(n * 2 - 1) * ridge - (1 - ridge) * (1 - n);
      sum += n * a;
      norm += a;
      a *= gain;
      f *= 2.13;   // not exactly 2 — avoids the octaves lining up into a grid
    }
    return sum / norm;
  }

  // Height ABOVE groundY at a world point. Never negative: the flat plane stays
  // the floor of the world, so nothing that was visible can sink out of sight.
  function h(x, z) {
    const nr = nearestRoad(x, z);
    if (nr.gap <= FLAT_TO) return 0;
    // Distance ramp, smoothstepped so the verge blends instead of stepping.
    let t = (Math.min(nr.gap, RAMP_TO) - FLAT_TO) / (RAMP_TO - FLAT_TO);
    t = t * t * (3 - 2 * t);
    let y = fbm(x, z) * amp * t;
    // Hard ceiling. Even with the ramp, an elevated flyover can pass over
    // terrain that the ramp thinks is far from "the road" — it is far from the
    // road BESIDE it, not from the one overhead. Clamp against the nearest
    // sample's own surface height and the problem cannot happen.
    if (nr.y < Infinity) {
      const ceil = nr.y - groundY - ROAD_GAP;
      if (y > ceil) y = Math.max(0, ceil);
    }
    return y;
  }

  return { h, nearestRoad, amp, FLAT_TO, RAMP_TO, ROAD_GAP };
}
