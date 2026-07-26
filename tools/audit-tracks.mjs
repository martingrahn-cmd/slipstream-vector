// Track self-intersection audit — the guard for "the road cuts through itself".
//
// A circuit is a closed loop, so it crosses over itself; that is fine and often
// good-looking. What is NOT fine is two stretches passing so close that their
// road slabs, walls and neon edges interpenetrate. This has shipped twice now,
// both times because the eyeball check was done from a camera that happened to
// look the other way.
//
// The naive version of this test compares CENTRELINES and is worthless: on a
// banked corner the outer edge sits several metres above the centreline (up to
// sin(BANK_MAX) * halfWidth, ~4m on a wide track), the walls stand
// WALL_HEIGHT proud of the surface, and a corkscrew rolls the whole section
// through a full road-width of vertical. So this samples the REAL banked
// section — five points across the road plus both wall tops — and reports the
// true minimum surface-to-surface distance.
//
//   npm i three          (one-off; this is a CDN import-map project otherwise)
//   node tools/audit-tracks.mjs [minClearance] [trackIndex,...]
//
// Exits non-zero if any track is under the clearance bar, so it can gate a
// commit. Measured reference points: the tracks that have always looked right
// sit at 3.7-4.5m, and anything under ~3m visibly clips.
import { TRACKS } from '../src/track/tracks/index.js';
import { TrackSpline } from '../src/track/spline.js';
import { TUNING } from '../src/config.js';
import * as THREE from 'three';

const CLEAR = Number(process.argv[2] || 3.5);
const ONLY = process.argv[3] ? process.argv[3].split(',').map(Number) : null;

const STEP = 2;      // metres between sampled sections
const APART = 80;    // metres along the ribbon before two samples count as a crossing
const CELL = 6;      // spatial-hash cell, metres

function audit(td) {
  const sp = new TrackSpline(td);
  const f = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
  const lean = Math.tan(TUNING.WALL_LEAN) * TUNING.WALL_HEIGHT;
  const N = Math.floor(sp.length / STEP);
  const P = [];
  for (let i = 0; i < N; i++) {
    sp.frameAt(i * STEP, f);
    const W = f.width, cr = TUNING.CROWN * W;
    const defs = [[-W, 0], [-W / 2, cr * 0.5], [0, cr], [W / 2, cr * 0.5], [W, 0],
      [-(W + lean), TUNING.WALL_HEIGHT], [W + lean, TUNING.WALL_HEIGHT]];
    for (const [lat, up] of defs) {
      P.push({
        x: f.pos.x + f.R.x * lat + f.U.x * up,
        y: f.pos.y + f.R.y * lat + f.U.y * up,
        z: f.pos.z + f.R.z * lat + f.U.z * up,
        i,
      });
    }
  }
  const grid = new Map();
  for (const p of P) {
    const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
    let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(p);
  }
  const sep = APART / STEP;
  const worst = new Map();
  for (const p of P) {
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = grid.get(`${cx + a},${cz + b}`); if (!arr) continue;
      for (const q of arr) {
        const di = Math.abs(q.i - p.i);
        if (Math.min(di, N - di) < sep) continue;
        const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        if (d > CLEAR) continue;
        const lo = Math.min(p.i, q.i), hi = Math.max(p.i, q.i);
        const k = `${Math.floor(lo / 15)}|${Math.floor(hi / 15)}`;
        const cur = worst.get(k);
        if (!cur || d < cur.d) worst.set(k, { d, s1: lo * STEP, s2: hi * STEP });
      }
    }
  }
  return { len: sp.length, hits: [...worst.values()].sort((a, b) => a.d - b.d) };
}

let bad = 0;
TRACKS.forEach((td, ti) => {
  if (ONLY && !ONLY.includes(ti)) return;
  const r = audit(td);
  const tag = `${String(ti).padStart(2)} ${td.name.padEnd(16)} len=${String(r.len | 0).padStart(4)}`;
  if (!r.hits.length) { console.log(`${tag}  clean (>= ${CLEAR}m)`); return; }
  bad++;
  console.log(`${tag}  ${r.hits.length} region(s) under ${CLEAR}m`);
  for (const h of r.hits.slice(0, 6)) {
    console.log(`      s=${h.s1} vs s=${h.s2}   gap=${h.d.toFixed(2)}m`);
  }
});
console.log(`\ntracks under ${CLEAR}m clearance: ${bad}`);
process.exit(bad ? 1 : 0);
