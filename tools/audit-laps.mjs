#!/usr/bin/env node
// Lap-counting audit — the one invariant the standings are built on.
//
//   node tools/audit-laps.mjs
//
// No dependencies and no browser: src/ship/shipPhysics.js has zero three.js
// imports on purpose (the AI/replay seam), so the real physics runs here
// against a flat synthetic track in milliseconds.
//
// WHAT THIS GUARDS. race.progressOf is `lap * length + s`, and s is wrapped to
// [0, length). So the instant s wraps without lap incrementing, progress falls
// by a WHOLE LAP and never recovers: the ship shows up last in the standings
// and, for the player, `lap` can never reach totalLaps + 1, so the race cannot
// be finished. That is not hypothetical — the lap test used to be
//
//   if (this.v > 1 && prevS > length * 0.8 && this.s < length * 0.2)
//
// and the `v > 1` term meant that creeping over the line slower than 1 m/s
// (brake to walking pace, or a hard wall hit right at the line while a weapon
// disable holds the throttle shut) silently cost you the lap. Measured at the
// time: progress 5980 -> 3001 on a 3000m track.
//
// The invariant is therefore simply: PROGRESS NEVER DECREASES. Everything
// below is a way of trying to make it decrease.
import { ShipPhysics } from '../src/ship/shipPhysics.js';

const L = 3000;
const track = {
  length: L, pads: [], weaponPads: [], jumps: [],
  scalarsAt: (s, o) => { o.kappa = 0; o.bank = 0; o.width = 8; o.slope = 0; o.splitHalf = 0; return o; },
  verticalCurvAt: () => 0,
  gapAt: () => false,
};
const events = { emit: () => {} };
const DT = 1 / 120;

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

// Hold a target speed by feathering the throttle, and watch progress the whole
// way — a single end-to-end reading would miss a dip that recovers.
function drive(speed, seconds, startS = L - 20) {
  const p = new ShipPhysics(track, events);
  p.reset(startS);
  p.lap = 1;
  p.v = speed;
  const progress = () => p.lap * L + p.s;
  let last = progress(), worstDrop = 0, wraps = 0, prevS = p.s;
  for (let i = 0; i < seconds / DT; i++) {
    p.step(DT, { steer: 0, throttle: p.v < speed ? 1 : 0, brake: 0, airbrake: false });
    if (p.s < prevS) wraps++;
    prevS = p.s;
    const now = progress();
    worstDrop = Math.min(worstDrop, now - last);
    last = now;
  }
  return { p, worstDrop, wraps, lap: p.lap };
}

console.log(`lap audit — synthetic flat track, ${L}m\n`);

// 1. Progress is monotonic at every speed, especially the slow ones.
for (const v of [60, 20, 5, 2, 1, 0.8, 0.3]) {
  const secs = Math.min(600, (L * 1.2) / Math.max(v, 0.3));
  const r = drive(v, secs);
  check(r.worstDrop >= 0, `progress never falls at ${String(v).padStart(4)} m/s`,
    `wraps=${r.wraps} lap=${r.lap} worst step ${r.worstDrop.toFixed(1)}m`);
  check(r.lap === 1 + r.wraps, `lap count matches wraps at ${String(v).padStart(4)} m/s`,
    `lap=${r.lap} wraps=${r.wraps}`);
}

// 2. A stationary ship never gains a lap, however long it sits on the line.
{
  const p = new ShipPhysics(track, events);
  p.reset(0);
  p.lap = 1;
  for (let i = 0; i < 1200; i++) p.step(DT, { steer: 0, throttle: 0, brake: 1, airbrake: false });
  check(p.lap === 1, 'a parked ship on the line gains no lap', `lap=${p.lap} s=${p.s.toFixed(2)}`);
}

// 3. Several laps in a row, from a start that is not the line.
{
  const r = drive(50, 200, 400);
  check(r.worstDrop >= 0 && r.lap === 1 + r.wraps, 'multi-lap run stays consistent',
    `lap=${r.lap} wraps=${r.wraps}`);
  check(r.wraps >= 3, 'the run actually completed several laps', `wraps=${r.wraps}`);
}

// 4. Rolling over the line at walking pace and then stopping dead just past it
//    counts the lap once and only once — the exact case the old speed gate got
//    wrong. Full brake from a crawl halts the ship inside a few centimetres, so
//    the crossing has to be driven, not coasted, to reach the line at all.
{
  const p = new ShipPhysics(track, events);
  p.reset(L - 1);
  p.lap = 1;
  p.v = 0.5;
  for (let i = 0; i < 480; i++) {                       // 4s at ~0.5 m/s: 2m, over the line
    p.step(DT, { steer: 0, throttle: p.v < 0.5 ? 1 : 0, brake: 0, airbrake: false });
  }
  const lapAfterCrawl = p.lap;
  const sAfterCrawl = p.s;
  for (let i = 0; i < 1200; i++) p.step(DT, { steer: 0, throttle: 0, brake: 1, airbrake: false }); // stop dead
  check(lapAfterCrawl === 2, 'a lap crossed at 0.5 m/s is counted',
    `lap=${lapAfterCrawl} s=${sAfterCrawl.toFixed(2)}`);
  check(p.lap === 2, 'and sitting past the line does not count it again', `lap=${p.lap}`);
}

console.log(`\n${failures ? `${failures} FAILING` : 'all clear'}`);
process.exit(failures ? 1 : 0);
