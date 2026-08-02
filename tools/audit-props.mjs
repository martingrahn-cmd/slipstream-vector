// Where did the scenery actually land?
//
//   node tools/audit-props.mjs [track] [nameFilter]
//
// The question this answers is the one that cost a whole afternoon: "I added
// props along the track and I cannot see them — are they mispositioned, or are
// they there and invisible?" Shooting a press frame to find out is six minutes
// per guess. This is seconds, and it gives a NUMBER instead of an impression.
//
// For every child of the scenery group it reports vertex count, bounding box,
// and the distribution of each vertex's LATERAL distance from the track
// centreline and its HEIGHT above the local road surface. A prop meant to line
// the road reads as a tight lateral band a few metres out; one that has escaped
// reads as a wide spread, or as a median in the hundreds.
//
// Environment: OD_CHROMIUM, OD_SOFTWARE_GL, THREE_PKG — same as the other audits.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TRACK = +(process.argv[2] ?? 8);
const FILTER = process.argv[3] || '';
const URL_ = process.env.PROP_URL || 'http://127.0.0.1:8741/index.html';

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed.  npm i playwright');
  process.exit(1);
});

const launch = { args: ['--no-sandbox', '--no-proxy-server'] };
if (process.env.OD_CHROMIUM && existsSync(process.env.OD_CHROMIUM)) launch.executablePath = process.env.OD_CHROMIUM;
if (process.env.OD_SOFTWARE_GL) launch.args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
if (process.env.THREE_PKG) {
  await page.route('**cdn.jsdelivr.net/npm/three@0.172.0/**', async (r) => {
    const rel = new URL(r.request().url()).pathname.replace('/npm/three@0.172.0/', '');
    try { await r.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(path.join(process.env.THREE_PKG, rel), 'utf8') }); }
    catch { await r.fulfill({ status: 404, body: 'x' }); }
  });
}
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 });
page.setDefaultTimeout(180000);
await page.waitForFunction(() => window.__game && window.__game.spline, null, { timeout: 90000 });

const rows = await page.evaluate(([ti, filter]) => {
  const g = window.__game;
  g.setTrack(ti);
  const sp = g.spline;
  // Nearest centreline sample by brute force over a strided scan, then refine.
  const near = (x, z) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < sp.n; i += 3) {
      const dx = sp.pos[i * 3] - x, dz = sp.pos[i * 3 + 2] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    return { i: bi, d: Math.sqrt(bd), y: sp.pos[bi * 3 + 1], w: sp.width[bi] };
  };
  const out = [];
  g.scenery.group.children.forEach((child, ci) => {
    let verts = 0;
    const lat = [], hi = [];
    child.traverse((o) => {
      if (!o.geometry) return;
      const pa = o.geometry.getAttribute('position');
      if (!pa) return;
      verts += pa.count;
      // Sample rather than scan: 400 points describe a distribution fine.
      const step = Math.max(1, Math.floor(pa.count / 400));
      for (let i = 0; i < pa.count; i += step) {
        const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const n = near(x, z);
        lat.push(n.d - n.w);        // metres OUTSIDE the road edge
        hi.push(y - n.y);           // metres above the local road surface
      }
    });
    if (!verts || !lat.length) return;
    const q = (a, p) => { const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
    const name = child.name || `${child.type}#${ci}`;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
    out.push({
      ci, name, verts,
      latMin: q(lat, 0.02), latMed: q(lat, 0.5), latMax: q(lat, 0.98),
      hiMin: q(hi, 0.02), hiMed: q(hi, 0.5), hiMax: q(hi, 0.98),
      nearRoad: lat.filter((v) => v < 40).length / lat.length,
    });
  });
  return { track: g.trackDef.name, out };
}, [TRACK, FILTER]);

const f = (v) => (v >= 0 ? ' ' : '') + v.toFixed(1).padStart(6);
console.log(`\n${rows.track} — lateral metres OUTSIDE the road edge, height above the road surface`);
console.log('idx name              verts |   lat 2%   med    98% |    hi 2%   med    98% | within 40m');
for (const r of rows.out) {
  console.log(`${String(r.ci).padStart(3)} ${r.name.slice(0, 16).padEnd(16)} ${String(r.verts).padStart(6)} |${f(r.latMin)}${f(r.latMed)}${f(r.latMax)} |${f(r.hiMin)}${f(r.hiMed)}${f(r.hiMax)} | ${(r.nearRoad * 100).toFixed(0).padStart(3)}%`);
}
console.log('\nA prop meant to LINE the road: lateral median under ~10m and "within 40m" near 100%.');
await browser.close();
