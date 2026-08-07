// Pass-under audit — where the road crosses OVER itself, and what it sounds like.
//
// The standing answer to two reports that used to cost a session each:
// "I heard a thump at s=X and nothing was overhead" and "I drove under a
// flyover/loop arc and it was silent". It runs the SAME findPassUnders()
// the game uses at scenery build (one implementation, two consumers), so
// what it prints is exactly what thumpS gets.
//
//   npm i three          (one-off; the spline needs it — same as audit-tracks)
//   node tools/audit-passunders.mjs [trackIndex,...]
//
// A measuring stick, not a gate: crossings are a track-design fact. Clearance
// bars live in audit-tracks.mjs; this tool answers WHERE the crossings are,
// their clearance, and the whoomp level each one plays at.
import { TRACKS } from '../src/track/tracks/index.js';
import { TrackSpline } from '../src/track/spline.js';
import { TUNING } from '../src/config.js';
import { findPassUnders } from '../src/track/passUnders.js';

const ONLY = process.argv[2] ? process.argv[2].split(',').map(Number) : null;

let total = 0;
TRACKS.forEach((td, ti) => {
  if (ONLY && !ONLY.includes(ti)) return;
  const sp = new TrackSpline(td);
  const list = findPassUnders(sp);
  total += list.length;
  console.log(`\n${String(ti).padStart(2)} ${td.name}  (${Math.round(sp.length)}m)  ${list.length} crossing${list.length === 1 ? '' : 's'}`);
  for (const c of list) {
    const lvl = Math.max(TUNING.PASSUNDER_MIN_LVL, Math.min(1,
      (TUNING.PASSUNDER_MAX_H - c.clearance) / (TUNING.PASSUNDER_MAX_H - TUNING.PASSUNDER_FULL_H)));
    console.log(`   under s=${String(Math.round(c.s)).padStart(5)}  over s=${String(Math.round(c.sOver)).padStart(5)}`
      + `  clearance=${c.clearance.toFixed(1).padStart(5)}m  lvl=${lvl.toFixed(2)}`);
  }
});
console.log(`\n${total} crossings total — every one now carries a k=2 whoomp in thumpS.`);
