// Road-over-road pass-under detection: everywhere the circuit crosses OVER
// itself — flyover decks, a corkscrew's roll — the lower lane drives under
// the biggest overhead structure in the game. These spots fed no sound for as
// long as the pass-under layer existed: thumpS only knew about scenery
// (rings, ribs, gantries, bridges), so an 8.7m flyover deck was silent while
// a holo ring 200m away swished, and the ear paired the swish with the deck —
// "the sound is seconds off". Nearest sounding structure measured up to 264m
// (4.4s) away.
//
// MIN_DS earns its size the hard way: at 40m this paired the LOOP'S OWN
// RIBBON with itself 40m ahead (a default loop climbs ~37m in its steepest
// 40m of arc, and the twist drift left the pair 16cm inside the width test),
// which shipped as mid-loop murmur thumps with no crossing anywhere near.
// Every "crossing" above ~25m clearance on the roster was that artifact, so
// the height ceiling doubles as the artifact guard.
//
// Pure arithmetic over the spline's sample arrays — no three.js — so the
// same implementation runs in the game (scenery build) and in Node
// (tools/audit-passunders.mjs), the buildGround/groundAt lesson applied:
// one implementation, two consumers, nothing to drift.
import { TUNING } from '../config.js';

// Returns [{ s, sOver, clearance }] sorted by s: the arc length where the lane
// passes under another stretch of road, where that stretch is, and the
// vertical gap between the two centrelines. One entry per crossing (contiguous
// covered samples cluster to the point of minimum clearance; clusters may wrap
// the lap seam).
export function findPassUnders(spline) {
  const { n, step, pos, width } = spline;
  const L = spline.length;
  const MIN_DS = TUNING.PASSUNDER_MIN_DS;
  const MIN_H = TUNING.PASSUNDER_MIN_H, MAX_H = TUNING.PASSUNDER_MAX_H;
  const PAD = TUNING.PASSUNDER_PAD;

  // clr[i] > 0 means sample i sits under road, with that vertical gap.
  const clr = new Float32Array(n);
  const overAt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const yi = pos[i * 3 + 1];
    for (let j = i + 1; j < n; j++) {
      const dy = pos[j * 3 + 1] - yi;
      const ady = Math.abs(dy);
      if (ady < MIN_H || ady > MAX_H) continue;
      let ds = (j - i) * step;
      if (ds > L / 2) ds = L - ds;
      if (ds < MIN_DS) continue;                 // the same stretch, not a crossing
      const lo = dy > 0 ? i : j, hi = dy > 0 ? j : i;
      const dx = pos[hi * 3] - pos[lo * 3], dz = pos[hi * 3 + 2] - pos[lo * 3 + 2];
      const r = width[hi] + PAD;                 // the UPPER road must cover the lane
      if (dx * dx + dz * dz > r * r) continue;
      if (clr[lo] === 0 || ady < clr[lo]) { clr[lo] = ady; overAt[lo] = hi * step; }
    }
  }

  // Cluster covered samples into crossings; a small gap of uncovered samples
  // (the deck's edge quantised) does not split a crossing in two.
  const GAP = Math.ceil(12 / step);
  const runs = [];
  let start = -1, last = -1;
  for (let i = 0; i < n; i++) {
    if (clr[i] === 0) continue;
    if (start < 0) { start = i; last = i; }
    else if (i - last <= GAP) last = i;
    else { runs.push([start, last]); start = i; last = i; }
  }
  if (start >= 0) runs.push([start, last]);
  // The lap is a loop: a crossing straddling s=0 arrives as a run at each end.
  if (runs.length > 1) {
    const first = runs[0], tail = runs[runs.length - 1];
    if (first[0] <= GAP && n - 1 - tail[1] <= GAP) { tail[1] = first[1] + n; runs.shift(); }
  }

  const out = [];
  for (const [a, b] of runs) {
    let best = -1, bestClr = Infinity;
    for (let i = a; i <= b; i++) {
      const k = i % n;
      if (clr[k] > 0 && clr[k] < bestClr) { bestClr = clr[k]; best = k; }
    }
    if (best >= 0) out.push({ s: best * step, sOver: overAt[best], clearance: bestClr });
  }
  out.sort((p, q) => p.s - q.s);
  return out;
}
