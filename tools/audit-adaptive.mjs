#!/usr/bin/env node
// ADAPTIVE quality-controller audit — does the tier track the MACHINE, or the
// weather?
//
//   node tools/audit-adaptive.mjs
//
// No dependencies and no browser: src/fx/quality.js is pure arithmetic over
// frame times, so the real controller runs here in milliseconds.
//
// WHAT THIS GUARDS. ADAPTIVE is the default mode, so for most players it is the
// only thing deciding what the game looks like — and it is deliberately
// asymmetric: a drop is instant and also lowers the CEILING, while a climb has
// to be earned over tens of seconds and is only cashed in at the next race
// start. That asymmetry is right (a tier that oscillates mid-corner is worse
// than one a notch too low), but it means a WRONG drop is expensive: it costs a
// whole race to undo, and the player just concludes the game got slower.
//
// So the invariant is not "the controller picks a good tier". It is:
//
//   A DROP MUST BE EVIDENCE ABOUT STEADY-STATE RENDERING SPEED.
//
// That failed, on the caller's side, for as long as ADAPTIVE existed. main.js
// fed it `realDt`, which is `Math.min((now - last) / 1000, 0.05)` — clamped so
// a hitch cannot fling the ship down the road. The controller's own hitch guard
// is `if (dtMs > 250) return null`, and against a 50ms clamp that line is
// unreachable. Every stall, of every length, arrived as a clean 50ms; a run of
// them is indistinguishable from a machine sitting at a rock-steady 20fps.
// Reported from an M4 Mac mini that had never dropped a frame: "NU KÄKADE DET
// PRESTANDA, GICK NER TILL LOW".
//
// Case 1 below is that report. It fails on the old code and passes on the new.
import { Adaptive, ADAPTIVE_MAX, TIERS } from '../src/fx/quality.js';

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${detail ? `   ${detail}` : ''}`);
};

// Drive the controller with a frame-time generator, the way main.js does:
// allowClimb=false, because climbs are parked and cashed at the next start.
// `clamp` reproduces the caller's bug when set.
function run(ctl, seconds, msFor, { clamp = 0, allowClimb = false, old = false } = {}) {
  let t = 0, guard = 0;
  while (t < seconds && guard++ < 2e6) {
    const raw = msFor(t);
    const seen = clamp ? Math.min(raw, clamp) : raw;
    const want = old ? oldSample(ctl, seen) : ctl.sample(seen, allowClimb);
    if (want !== null) ctl.idx = want;
    t += raw / 1000;              // wall clock always advances by the REAL frame
  }
  return ctl.idx;
}

// The shipped drop path, verbatim, so case 1 can show the regression rather
// than assert it. Only the drop side is reproduced — climbs are parked in play
// and cannot rescue a wrong drop inside the same race anyway.
function oldSample(ctl, dtMs) {
  if (!(dtMs > 0) || dtMs > 250) return null;
  ctl.ema += (dtMs - ctl.ema) * 0.06;          // ...above the hold check
  const dt = dtMs / 1000;
  if (ctl.hold > 0) { ctl.hold -= dt; return null; }
  if (1000 / ctl.ema < ctl.target - 12 && ctl.idx > 0) {
    ctl.idx--; ctl.ceiling = ctl.idx;          // ...on the first crossing
    ctl.goodT = 0; ctl.hold = 2.0; ctl.ema = 1000 / 60;
    return ctl.idx;
  }
  return null;
}

const name = (i) => TIERS[i].name;
const steady = (ms) => () => ms;
const FULL = ADAPTIVE_MAX;

console.log('ADAPTIVE controller\n');

// 1. THE REPORTED BUG. Twelve seconds at a locked 60fps, then a four-second
//    burst of real jank — 300-800ms frames, which is what a Metal shader cache
//    warming up or a browser background task actually looks like — then back to
//    a locked 60. Nothing about the renderer changed. The tier must not move.
{
  const jank = (t) => (t > 12 && t < 16 ? 300 + ((t * 997) % 500) : 16.7);
  const shipped = run(new Adaptive(), 30, jank, { clamp: 50, old: true });
  const fixed = run(new Adaptive(), 30, jank);
  check(fixed === FULL, 'a 4s jank burst on a 60fps machine does not move the tier',
    `landed on ${name(fixed)}`);
  check(shipped !== FULL, '...and the shipped code did move it (the reported bug)',
    `old code landed on ${name(shipped)}`);
}

// 1b. Six seconds of 60-120ms frames — another app waking up, a shader cache
//     warming mid-race. That IS 10fps and dropping is the right instant answer;
//     what must not happen is the drop becoming permanent. The tier may fall,
//     but one clean race has to be enough to earn all of it back. This is the
//     shape of the actual complaint: not "it dropped", but "it stayed down".
{
  const jank = (t) => (t > 10 && t < 16 ? 60 + ((t * 613) % 60) : 16.7);
  const ctl = new Adaptive();
  run(ctl, 40, jank);
  const sank = ctl.idx;
  run(ctl, 100, steady(16.7));                     // one clean race after it
  const up = ctl.takePending();
  if (up !== null) ctl.idx = up;
  check(ctl.idx === FULL, 'a jank burst is undone by ONE clean race',
    `sank to ${name(sank)}, back at ${name(ctl.idx)}`);

  // And the shipped code: same burst, same clean race, still down there.
  const old = new Adaptive();
  run(old, 40, jank, { clamp: 50, old: true });
  run(old, 100, steady(16.7), { clamp: 50, old: true });
  check(old.idx !== FULL, '...where the shipped code stayed down (the complaint)',
    `old code still on ${name(old.idx)}`);
}

// 2. But a machine that is ACTUALLY slow must still drop. 25fps sustained is
//    not a hitch, it is the steady state, and the whole point of the mode.
{
  const idx = run(new Adaptive(), 30, steady(40));
  check(idx < FULL, 'a sustained 25fps still drops the tier', `landed on ${name(idx)}`);
}

// 3. The hole the clamp used to paper over: with a bare `dtMs > 250` reject, a
//    machine rendering at 3fps has EVERY frame thrown away and can never drop.
//    The hitch STREAK has to convert into evidence.
{
  const idx = run(new Adaptive(), 60, steady(330));
  check(idx < FULL, 'a sustained 3fps drops too — a hitch streak is not a hitch',
    `landed on ${name(idx)}`);
}

// 4. A locked-60 machine is never touched, over a full race's worth of frames.
{
  const idx = run(new Adaptive(), 180, steady(16.7));
  check(idx === FULL, 'a locked 60fps machine is left alone for three minutes',
    `landed on ${name(idx)}`);
}

// 5. A 30Hz-capped panel: 33.3ms is 30fps, genuinely below target, so dropping
//    is correct — but it must SETTLE, not walk to the bottom and stay there by
//    accident. Check it stops somewhere and stays.
{
  const ctl = new Adaptive();
  run(ctl, 60, steady(33.3));
  const settled = ctl.idx;
  run(ctl, 60, steady(33.3));
  check(ctl.idx === settled, 'a 30fps machine settles instead of hunting',
    `settled on ${name(settled)}`);
}

// 6. RECOVERY. Dropped to LOW by a bad minute, then given a clean machine: the
//    player must get back to FULL inside a plausible session. main.js parks
//    climbs and cashes them at the next race start, so a rung costs one race.
//    Two races used to be the floor (45s ceiling probe + 12s climb per rung);
//    the probe is 20s now, which puts the whole round trip inside one race.
{
  const ctl = new Adaptive();
  ctl.idx = 0; ctl.ceiling = 0;         // pinned at LOW, ceiling pinned with it
  let races = 0;
  // startRace(): cash the parked climb FIRST, then re-arm — reset() clears
  // `pending`, so the other order silently throws every climb away.
  const start = () => {
    const up = ctl.takePending();
    if (up !== null) ctl.idx = up;
    ctl.reset(ctl.idx);
  };
  for (let r = 0; r < 6 && ctl.idx < FULL; r++) {
    start();
    run(ctl, 100, steady(16.7));        // ~100s race at a locked 60
    races++;
  }
  start();
  check(ctl.idx === FULL, 'LOW climbs back to FULL on a machine that can hold it',
    `took ${races} race${races === 1 ? '' : 's'}, landed on ${name(ctl.idx)}`);
}

// 6b. The other side of that coin. Not lowering the ceiling on a first failure
//     means a machine that genuinely cannot hold FULL will climb back into it —
//     and it must stop doing that, or every race starts with a visible drop.
//     Three attempts is the budget: one free, one cheap, one expensive.
{
  const ctl = new Adaptive();
  let attempts = 0;
  for (let r = 0; r < 8; r++) {
    const up = ctl.takePending();
    if (up !== null) ctl.idx = up;
    ctl.reset(ctl.idx);
    if (ctl.idx === FULL) attempts++;
    // 40fps at FULL — genuinely out of reach — and a comfortable 60 below it.
    run(ctl, 100, () => (ctl.idx === FULL ? 25 : 16.7));
  }
  check(attempts <= 3, 'a machine that cannot hold FULL stops trying to',
    `${attempts} attempt${attempts === 1 ? '' : 's'} over 8 races, settled on ${name(ctl.idx)}`);
}

// 7. A new circuit is a new workload. The ceiling is evidence about the track
//    it was measured on; carrying it to the next one is how one bad city night
//    in the rain pins a whole session of desert racing at LOW.
{
  const ctl = new Adaptive();
  ctl.idx = 0; ctl.ceiling = 0;
  ctl.newWorkload();
  check(ctl.ceiling === FULL && ctl.idx === 0,
    'a new circuit restores the ceiling but does NOT hand over the tier',
    `ceiling=${name(ctl.ceiling)} tier=${name(ctl.idx)}`);
}

// 8. The tier change itself is expensive — render targets reallocate, bloom
//    shaders recompile — and that jank is CAUSED by the decision, so it must
//    not feed the next one. Drive a machine that is fine at MEDIUM but pays
//    400ms for the switch: it must stop at MEDIUM, not fall through to LOW.
{
  const ctl = new Adaptive();
  let switched = -1;
  let t = 0, guard = 0;
  while (t < 40 && guard++ < 2e6) {
    // 45fps at FULL (drop-worthy), 60fps at anything below it.
    let ms = ctl.idx === FULL ? 22.2 : 16.7;
    if (switched >= 0 && t - switched < 0.4) ms = 400;   // the reallocation stall
    const want = ctl.sample(ms, false);
    if (want !== null) { switched = t; ctl.idx = want; }
    t += ms / 1000;
  }
  check(ctl.idx === FULL - 1, 'the stall a tier change causes does not cause the next one',
    `landed on ${name(ctl.idx)}`);
}

console.log(`\n${failures ? `${failures} FAILING` : 'all clear'}`);
process.exit(failures ? 1 : 0);
