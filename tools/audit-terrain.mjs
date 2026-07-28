// Terrain-vs-road audit — the guard for "a dune came up through the racing
// surface".
//
// `groundY` is ONE scalar for a whole circuit: the lowest banked track edge
// anywhere on the lap, minus clearance. That is fine for a flat plane and a
// trap for a heightfield, because raising the ground by so much as a metre near
// a stretch that happens to run low puts sand through the road. TERRAIN.md
// names this as the thing that has to be right before anything else is
// switched on; this is the check that says whether it is.
//
// The test: sample the real banked road section (five points across, same as
// the self-intersection audit), and for each one, take the WORST terrain height
// anywhere within a radius around it. Report the smallest surface-to-terrain
// gap on the circuit.
//
//   node tools/audit-terrain.mjs [minClearance] [trackIndex,...]
//
// Exits non-zero under the bar, so it can gate a commit.
import { TRACKS } from '../src/track/tracks/index.js';
import { TrackSpline } from '../src/track/spline.js';
import { THEMES } from '../src/worlds/themes.js';
import { buildTerrain } from '../src/track/terrain.js';
import { TUNING } from '../src/config.js';
import * as THREE from 'three';

const CLEAR = Number(process.argv[2] || 0.01);   // max terrain height allowed near the road
const ONLY = process.argv[3] ? process.argv[3].split(',').map(Number) : null;

const STEP = 4;     // metres along the ribbon
const PROBE = 3;    // terrain probes per axis around each road point
const REACH = 14;   // metres around a road point that terrain must stay clear of

function audit(td) {
  const sp = new TrackSpline(td);
  const theme = THEMES[td.theme] || THEMES[td.world] || null;
  if (!theme) return { name: td.name, skip: 'no theme' };

  // Same groundY the scenery builder derives.
  let minEdge = Infinity;
  for (let i = 0; i < sp.n; i++) {
    const y = sp.pos[i * 3 + 1];
    const ry = Math.abs(sp.right[i * 3 + 1]);
    minEdge = Math.min(minEdge, y - ry * sp.width[i] - 0.35);
  }
  const groundY = minEdge - 0.8;

  const terrain = buildTerrain(sp, groundY, theme);
  if (!terrain) return { name: td.name, skip: 'flat' };

  const f = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
  // The metric that matters is INTRUSION: how high the ground gets near the
  // road, not the absolute gap to it. The flat plane already sits a fixed
  // 1.15m under the circuit's lowest banked edge by construction (groundY =
  // minEdge - 0.8, and the edge is minEdge + 0.35), so an absolute-clearance
  // bar above that fails every track before terrain does anything at all —
  // which is exactly what the first version of this audit reported.
  let intrude = 0, worstS = 0, worst = Infinity, peak = 0;
  const N = Math.floor(sp.length / STEP);
  for (let i = 0; i < N; i++) {
    const s = i * STEP;
    sp.frameAt(s, f);
    const W = f.width, cr = TUNING.CROWN * W;
    for (const [lat, up] of [[-W, 0], [-W / 2, cr * 0.5], [0, cr], [W / 2, cr * 0.5], [W, 0]]) {
      const px = f.pos.x + f.R.x * lat + f.U.x * up;
      const py = f.pos.y + f.R.y * lat + f.U.y * up;
      const pz = f.pos.z + f.R.z * lat + f.U.z * up;
      for (let a = -PROBE; a <= PROBE; a++) {
        for (let b = -PROBE; b <= PROBE; b++) {
          const qx = px + (a / PROBE) * REACH, qz = pz + (b / PROBE) * REACH;
          const th = terrain.h(qx, qz);
          if (th > intrude) { intrude = th; worstS = s; }
          const gap = py - (groundY + th);
          if (gap < worst) worst = gap;
        }
      }
    }
  }
  // How much relief the world actually got, so a "clean" result cannot be a
  // terrain that quietly did nothing.
  let cx = 0, cz = 0;
  for (let i = 0; i < sp.n; i++) { cx += sp.pos[i * 3]; cz += sp.pos[i * 3 + 2]; }
  cx /= sp.n; cz /= sp.n;
  for (let r = 120; r < 1500; r += 60) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      peak = Math.max(peak, terrain.h(cx + Math.cos(ang) * r, cz + Math.sin(ang) * r));
    }
  }
  return { name: td.name, worst, intrude, worstS, peak };
}

let fails = 0;
TRACKS.forEach((td, i) => {
  if (ONLY && !ONLY.includes(i)) return;
  const r = audit(td);
  if (r.skip) {
    console.log(`${String(i).padStart(2)} ${(r.name || '').padEnd(16)} ${r.skip}`);
    return;
  }
  const bad = r.intrude > CLEAR;
  if (bad) fails++;
  console.log(
    `${String(i).padStart(2)} ${r.name.padEnd(16)} intrusion=${r.intrude.toFixed(3)}m` +
    ` @s=${Math.round(r.worstS)}  gap=${r.worst.toFixed(2)}m  relief=${r.peak.toFixed(1)}m` +
    `  ${bad ? `FAIL (> ${CLEAR}m)` : 'ok'}`,
  );
});
console.log(`\ntracks with terrain intruding above ${CLEAR}m near the road: ${fails}`);
process.exit(fails ? 1 : 0);
