// Weapon-pad pickup audit — is the pickup roll per DRIVER or per PAD?
//
// The question this exists to answer, because it will be asked again: when a
// pack crosses one weapon pad, does the whole field get the SAME weapon? It
// looks that way in play, and the reason is in the results below, not in the
// roll.
//
//   node tools/audit-pads.mjs [tracks]        # default 11,0,8
//
// Needs `npm i playwright three` and the dev server up (.claude/launch.json
// "game" on :8741).
//
// Method: rebuild the fixed step by hand — __game.warp() does NOT step the
// weapon system, it is only stepped in the render loop — and sample every
// ship's heldWeapon each step. A null -> weapon transition is a pickup; record
// which pad it came from. Group by (pad, within 2s) and ask whether the weapons
// inside one group agree.
//
// Measured 2026-07-29 over 3 tracks x 150s: 238 pickups, distribution on the
// WEIGHTS table within noise, 60 multi-ship crossings, 6 of them all-same — and
// every one of those was a pair or a triple, never a big crossing. Two ships
// matching by chance is a 21% event. The roll is per driver and honest.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const TRACKS = (process.argv[2] || '11,0,8').split(',').map(Number);
const SECONDS = +(process.env.PAD_SECONDS || 150);

const launch = { args: ['--no-sandbox', '--no-proxy-server'] };
if (process.env.OD_CHROMIUM && existsSync(process.env.OD_CHROMIUM)) launch.executablePath = process.env.OD_CHROMIUM;
if (process.env.OD_SOFTWARE_GL) launch.args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

if (process.env.THREE_PKG) {
  await page.route('**cdn.jsdelivr.net/npm/three@0.172.0/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/npm/three@0.172.0/', '');
    try { await route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(path.join(process.env.THREE_PKG, rel), 'utf8') }); }
    catch { await route.fulfill({ status: 404, body: `not mirrored: ${rel}` }); }
  });
}

await page.goto('http://127.0.0.1:8741/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.spline, null, { timeout: 90000 });

const group = (events) => {
  const gs = [];
  for (const e of events) {
    const g0 = gs.find((g) => g.pad === e.pad && Math.abs(g.t0 - e.t) < 2.0);
    if (g0) g0.items.push(e); else gs.push({ pad: e.pad, t0: e.t, items: [e] });
  }
  return gs;
};

const all = [];
for (const ti of TRACKS) {
  const res = await page.evaluate(async ([ti, SECONDS]) => {
    const g = window.__game;
    g.setTrack(ti); g.start();
    const DT = 1 / 120, input = { steer: 0, throttle: 1, brake: 0, airbrake: false };
    const ships = [g.ship, ...(g.race && g.race.racers ? g.race.racers.map((r) => r.phys) : [])];
    const names = ['PLAYER', ...(g.race && g.race.racers ? g.race.racers.map((r) => r.name) : [])];
    const prev = ships.map((s) => s.heldWeapon);
    const events = [];
    for (let i = 0, n = Math.round(SECONDS / DT); i < n; i++) {
      g.race.computeDraft(g.ship); g.ship.step(DT, input);
      g.race.stepFixed(DT, true); g.race.interact(g.ship, DT);
      g.weapons.stepFixed(DT, true, false);      // <- the part warp() skips
      for (let k = 0; k < ships.length; k++) {
        const h = ships[k].heldWeapon;
        if (h !== null && prev[k] === null) events.push({ t: +(i * DT).toFixed(2), ship: names[k], pad: ships[k].activeWeaponPad, weapon: h });
        prev[k] = h;
      }
    }
    return { track: g.trackDef.name, pads: g.spline.weaponPads.length, events };
  }, [ti, SECONDS]);
  all.push(res);

  console.log(`\n=== ${res.track} — ${res.pads} weapon pads, ${SECONDS}s, ${res.events.length} pickups ===`);
  const packs = group(res.events).filter((g) => g.items.length >= 2);
  console.log(`  crossings where 2+ ships armed off the same pad within 2s: ${packs.length}`);
  for (const g of packs) {
    const ws = g.items.map((i) => i.weapon);
    console.log(`   t=${g.t0.toFixed(1)}s pad#${g.pad} x${g.items.length}: ${ws.join(', ')}${new Set(ws).size === 1 ? '  <-- ALL THE SAME' : ''}`);
  }
}

console.log('\n================ SUMMARY ================');
const tally = {}; let n = 0, packCount = 0, sameCount = 0;
for (const r of all) {
  for (const e of r.events) { tally[e.weapon] = (tally[e.weapon] || 0) + 1; n++; }
  for (const g of group(r.events).filter((g) => g.items.length >= 2)) {
    packCount++;
    if (new Set(g.items.map((i) => i.weapon)).size === 1) sameCount++;
  }
}
console.log(`total pickups: ${n}`);
// Mirrors WEIGHTS in src/weapons/weaponSystem.js — update together.
const EXP = { missiles: 0.26, boost: 0.22, mine: 0.20, shield: 0.18, homing: 0.14 };
for (const k of Object.keys(EXP)) {
  const c = tally[k] || 0;
  console.log(`  ${k.padEnd(9)} ${String(c).padStart(3)}  ${(100 * c / n).toFixed(1).padStart(5)}%  (table says ${(EXP[k] * 100).toFixed(0)}%)`);
}
console.log(`\nmulti-ship pad crossings: ${packCount}`);
console.log(`  ...where every ship got the SAME weapon: ${sameCount}`);
console.log('  (two ships matching by chance is a 21% event on this table)');

await browser.close();
