// Island-planting audit — is every palm actually standing ON the island?
//
//   node tools/audit-planting.mjs [tracks]        # default 3,4,5 (the coast)
//
// Needs `npm i playwright three` and the dev server up (.claude/launch.json
// "game" on :8741).
//
// Method: raycast straight DOWN from above every palm onto the island meshes
// and compare the hit height to where the palm was planted. That is the check
// a screenshot only pretends to be, and the only one that has ever caught this
// class of bug here.
//
// Why it exists: three separate placement fixes all passed an x/z-only audit —
// "is this palm within an island's radius?" — while palms were standing in open
// water, then buried up to 54 metres inside a hillside. An audit that cannot
// see height cannot see the defect. Findings, in order:
//
//   * scatterers planted against groundAt() on a world whose ground IS the
//     lagoon, so trunks stood in the sea;
//   * the beach ring used the flat groundY while the lagoon disc is terrain-
//     displaced, so the sand was under water;
//   * a radial height profile left most bands EMPTY (a low-poly island has
//     vertices at a handful of radii), and empty bands fell back to the water
//     level — planting hillside palms fifty metres down.
//
// The fix that finally held was a rasterised height FIELD per island, sampled
// from the shipped geometry, with palms planted on the highest surface at their
// point. This audit is what proved each attempt wrong, and what proves the
// current one right: 4 misplaced palms out of 2280 across the three tracks.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const TRACKS = (process.argv[2] || '3,4,5').split(',').map(Number);
const FLOAT_BAR = 1.0;    // metres above the surface before it reads as hovering
const BURY_BAR = 2.5;     // metres below before the trunk is visibly swallowed

const launch = { args: ['--no-sandbox', '--no-proxy-server'] };
if (process.env.OD_CHROMIUM && existsSync(process.env.OD_CHROMIUM)) launch.executablePath = process.env.OD_CHROMIUM;
if (process.env.OD_SOFTWARE_GL) launch.args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
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
await page.addScriptTag({ type: 'module', content: "import * as T from 'three'; window.THREE = T;" });
await page.waitForFunction(() => !!window.THREE, null, { timeout: 30000 });

let worst = 0;
for (const ti of TRACKS) {
  const r = await page.evaluate(([ti, FLOAT_BAR, BURY_BAR]) => {
    const T = window.THREE, g = window.__game;
    g.setTrack(ti);
    const want = g.theme.floraCount;
    let flora = null, mesas = null;
    g.scenery.group.traverse((o) => {
      if (o.isInstancedMesh && o.count === want) flora = o;
      if (o.name === 'mesas') mesas = o;
    });
    if (!flora || !mesas) return { track: g.trackDef.name, skip: true };
    const islands = mesas.userData.islands || [];
    if (!islands.length) return { track: g.trackDef.name, skip: true };
    const bodies = [];
    mesas.traverse((o) => { if (o.isMesh) bodies.push(o); });

    const ray = new T.Raycaster(); ray.far = 500;
    const down = new T.Vector3(0, -1, 0), from = new T.Vector3();
    const m = new T.Matrix4(), p = new T.Vector3(), sc = new T.Vector3(), q = new T.Quaternion();
    let hidden = 0, slope = 0, sand = 0, floated = 0, buried = 0, noHit = 0, wf = 0, wb = 0;
    for (let i = 0; i < flora.count; i++) {
      flora.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      if (sc.x < 0.01) { hidden++; continue; }
      let u = Infinity;
      for (const is of islands) u = Math.min(u, Math.hypot(p.x - is.x, p.z - is.z) / is.r);
      if (u < 1.0) slope++; else sand++;
      from.set(p.x, p.y + 80, p.z);
      ray.set(from, down);
      const hits = ray.intersectObjects(bodies, false);
      if (!hits.length) { noHit++; continue; }
      const d = p.y - hits[0].point.y;          // + = hovering above the surface
      if (d > FLOAT_BAR) { floated++; wf = Math.max(wf, d); }
      if (d < -BURY_BAR) { buried++; wb = Math.min(wb, d); }
    }
    return { track: g.trackDef.name, palms: flora.count, hidden, slope, sand, floated, buried, noHit,
      wf: +wf.toFixed(1), wb: +wb.toFixed(1) };
  }, [ti, FLOAT_BAR, BURY_BAR]);
  if (r.skip) { console.log(`${r.track.padEnd(15)} no islands / no flora — skipped`); continue; }
  const bad = r.floated + r.buried + r.noHit;
  worst = Math.max(worst, bad);
  console.log(`${r.track.padEnd(15)} ${r.palms} palms — ${r.slope} on the hill, ${r.sand} on the sand, ${r.hidden} not placed`);
  console.log(`  hovering >${FLOAT_BAR}m: ${r.floated} (worst ${r.wf}m) | buried >${BURY_BAR}m: ${r.buried} (worst ${r.wb}m) | no ground under: ${r.noHit}`);
}
console.log(`\nworst track: ${worst} misplaced palms`);
await browser.close();
