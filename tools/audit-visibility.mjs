// What does this scenery child CONTRIBUTE to the frame?
//
//   node tools/audit-visibility.mjs [track] [childName] [s]
//
// audit-props answers "where did it land"; this answers the other half of
// STATUS 2.6b: "it is in the right place — does it actually show?" It parks a
// fixed camera on a straight, screenshots the game canvas with the child
// visible and hidden, and pixel-diffs the two. Because signs pulse and
// blinkers blink, two consecutive frames differ even with nothing toggled —
// so it first measures that animation noise floor (A1 vs A2, both visible)
// and only counts contribution that clears it (A2 vs B, hidden).
//
// Two defences against animated worlds (the city RAINS — 20% of the frame
// changes every frame, which drowned the first version of this tool):
//   * ISOLATE: every scenery sibling is hidden during the measurement, so
//     pulsing signs and blinking masts never enter the diff;
//   * AVERAGE: each state is the mean of AVG frames, so anything that moves
//     (rain, motes) blurs to the same value in both states and cancels.
//
// The screenshot is of the CANVAS ELEMENT, not the page, so the DOM HUD (lap
// timer, speedo) never pollutes the diff.
//
// Output: changed-pixel count, share of frame, mean/max luma delta for both
// the noise floor and the contribution, plus A/B/heatmap PNGs in OUT (default
// /tmp/vis). A child that "does not read" shows a contribution barely above
// the noise floor; a healthy glow shows 1-5% of the frame at a mean delta
// well over the floor.
//
// Environment: OD_CHROMIUM, OD_SOFTWARE_GL, THREE_PKG, OUT — as the other audits.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TRACK = +(process.argv[2] ?? 8);
const CHILD = process.argv[3] || 'lamps';
const S_MARK = process.argv[4] !== undefined ? +process.argv[4] : null;
const AVG = +(process.env.VIS_AVG ?? 4);
const OUT = process.env.OUT || '/tmp/vis';
const URL_ = process.env.PROP_URL || 'http://127.0.0.1:8741/index.html';
mkdirSync(OUT, { recursive: true });

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed.  npm i playwright');
  process.exit(1);
});
const launch = { args: ['--no-sandbox', '--no-proxy-server'] };
if (process.env.OD_CHROMIUM && existsSync(process.env.OD_CHROMIUM)) launch.executablePath = process.env.OD_CHROMIUM;
if (process.env.OD_SOFTWARE_GL) launch.args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
if (process.env.THREE_PKG) {
  await page.route('**cdn.jsdelivr.net/npm/three@0.172.0/**', async (r) => {
    const rel = new URL(r.request().url()).pathname.replace('/npm/three@0.172.0/', '');
    try { await r.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(path.join(process.env.THREE_PKG, rel), 'utf8') }); }
    catch { await r.fulfill({ status: 404, body: 'x' }); }
  });
}
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 });
page.setDefaultTimeout(240000);
await page.waitForFunction(() => window.__game && window.__game.spline, null, { timeout: 90000 });
await page.addScriptTag({ type: 'module', content: "import * as T from 'three'; window.THREE = T;" });
await page.waitForFunction(() => !!window.THREE, null, { timeout: 30000 });

const setup = await page.evaluate(([ti, childName, sMark]) => {
  const T = window.THREE, g = window.__game;
  g.setTrack(ti); g.setQuality('full'); g.start();
  const sp = g.spline;
  // A straight: longest run of low curvature, so several lamps line the view.
  let s0 = sMark;
  if (s0 === null) {
    let best = { s: 420, run: -1 };
    const f = { pos: new T.Vector3(), T: new T.Vector3(), R: new T.Vector3(), U: new T.Vector3() };
    // Start the scan 400m past the grid: the field idles there with pulsing
    // engine glows, and a camera parked next to it measures ships, not props.
    for (let s = 400; s < sp.length - 200; s += 15) {
      let run = 0;
      while (run < 400) {
        sp.frameAt(s + run, f);
        if (Math.abs(f.kappa) > 0.004 || Math.abs(f.slope) > 0.2) break;
        run += 15;
      }
      if (run > best.run) best = { s, run };
    }
    s0 = best.s;
  }
  const f = { pos: new T.Vector3(), T: new T.Vector3(), R: new T.Vector3(), U: new T.Vector3() };
  sp.frameAt(s0, f);
  const eye = f.pos.clone().addScaledVector(f.U, 2.6).addScaledVector(f.T, -4);
  const look = sp.frameAt((s0 + 90) % sp.length, { pos: new T.Vector3(), T: new T.Vector3(), R: new T.Vector3(), U: new T.Vector3() }).pos;
  const cam = g.camera;
  g.rig.update = () => {
    cam.position.copy(eye);
    cam.lookAt(look.x, look.y + 3, look.z);
    cam.updateMatrixWorld(true);
  };
  let child = null;
  g.scenery.group.children.forEach((c, i) => { if ((c.name || `#${i}`) === childName || String(i) === childName) child = c; });
  // ISOLATE: nothing else may animate into the diff. Scenery siblings first —
  // and then EVERYTHING else in the scene except the sky: the race field laps
  // the circuit in real wall time while the frames are being captured, and one
  // pack of ships driving through the parked view once put the noise floor at
  // 45% of the frame. The background does not need to be complete for a
  // contribution diff, only static.
  const hidden = [];
  if (child) {
    for (const c of g.scenery.group.children) {
      if (c !== child && c.visible) { c.visible = false; hidden.push(c); }
    }
    // The sky is animated IN THE SHADER (cloud drift, rain flashes) and once
    // everything else is hidden it fills the frame — hiding the city put the
    // noise floor at 50%. Hide it too: the diff needs a static backdrop, and
    // the renderer's clear colour is the most static backdrop there is.
    const keep = new Set([g.scenery.group]);
    const scene = g.scenery.group.parent;
    for (const c of scene.children) {
      if (!keep.has(c) && c.visible) { c.visible = false; hidden.push(c); }
    }
  }
  window.__vis = { child, hidden };
  return { s0: Math.round(s0), found: !!child, kids: g.scenery.group.children.map((c, i) => c.name || `#${i}`) };
}, [TRACK, CHILD, S_MARK]);
if (!setup.found) {
  console.log(`child "${CHILD}" not found; children: ${setup.kids.join(', ')}`);
  await browser.close(); process.exit(1);
}
console.log(`camera parked at s=${setup.s0}, child "${CHILD}"`);

const canvas = page.locator('canvas:not(#minimap)').first();
const warm = path.join(OUT, '_warm.png');
for (let i = 0; i < 3; i++) await page.screenshot({ path: warm });

const shot = async (name) => {
  const frames = [];
  for (let k = 0; k < AVG; k++) {
    await page.screenshot({ path: warm });                  // pump one real frame
    const nm = AVG > 1 ? name.replace('.png', `-${k}.png`) : name;
    await canvas.screenshot({ path: path.join(OUT, nm) });  // then capture canvas only
    frames.push((await readFile(path.join(OUT, nm))).toString('base64'));
  }
  return frames;
};
const a1 = await shot('A1-visible.png');
const a2 = await shot('A2-visible.png');
await page.evaluate(() => { window.__vis.child.visible = false; });
const b = await shot('B-hidden.png');
await page.evaluate(() => { window.__vis.child.visible = true; for (const c of window.__vis.hidden) c.visible = true; });

const stats = await page.evaluate(async ([a1, a2, b]) => {
  const load = (d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${d}`; });
  const W0 = { w: 0, h: 0 };
  // Mean image over the burst: moving things (rain, motes) blur to the same
  // value in both states and cancel out of the diff.
  const meanPx = async (list) => {
    let acc = null;
    for (const d of list) {
      const img = await load(d);
      W0.w = img.naturalWidth; W0.h = img.naturalHeight;
      const c = document.createElement('canvas'); c.width = W0.w; c.height = W0.h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const data = x.getImageData(0, 0, W0.w, W0.h).data;
      if (!acc) acc = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) acc[i] += data[i] / list.length;
    }
    return acc;
  };
  const pa1 = await meanPx(a1), pa2 = await meanPx(a2), pb = await meanPx(b);
  const W = W0.w, H = W0.h;
  const heat = document.createElement('canvas'); heat.width = W; heat.height = H;
  const hx = heat.getContext('2d');
  const hd = hx.createImageData(W, H);
  const diff = (p, q, paint) => {
    let n = 0, sum = 0, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      const d = Math.abs(p[i] - q[i]) * 0.299 + Math.abs(p[i + 1] - q[i + 1]) * 0.587 + Math.abs(p[i + 2] - q[i + 2]) * 0.114;
      if (d > 6) { n++; sum += d; if (d > max) max = d; if (paint) { hd.data[i] = 255; hd.data[i + 1] = Math.min(255, d * 3); hd.data[i + 3] = 255; } }
    }
    return { n, share: n / (p.length / 4), mean: n ? sum / n : 0, max };
  };
  const noise = diff(pa1, pa2, false);
  const contrib = diff(pa2, pb, true);
  hx.putImageData(hd, 0, 0);
  return { W, H, noise, contrib, heat: heat.toDataURL('image/png').split(',')[1] };
}, [a1, a2, b]);

writeFileSync(path.join(OUT, 'heatmap.png'), Buffer.from(stats.heat, 'base64'));
const f = (r) => `${String(r.n).padStart(8)} px  ${(r.share * 100).toFixed(2).padStart(6)}%  mean ${r.mean.toFixed(1).padStart(5)}  max ${r.max.toFixed(0).padStart(3)}`;
console.log(`\nframe ${stats.W}x${stats.H} (canvas only, no HUD)`);
console.log(`animation noise floor (A1 vs A2): ${f(stats.noise)}`);
console.log(`"${CHILD}" contribution (A2 vs B): ${f(stats.contrib)}`);
// Verdict on ENERGY (pixels x mean delta), not pixel count alone: a glow can
// touch fewer pixels than the noise floor yet hit each of them three times as
// hard — that is a visible object, and the first version of this threshold
// called exactly that case invisible (the lamps: 2.5x the noise pixels at 3.3x
// its delta, plainly visible in the heatmap, verdict "does not read").
const energy = (r) => r.n * r.mean;
console.log(`\nverdict: ${energy(stats.contrib) > energy(stats.noise) * 2.5 && stats.contrib.share > 0.002
  ? 'the child VISIBLY contributes to this frame'
  : 'the child contributes little or nothing beyond animation noise — it does not read'}`);
console.log(`frames + heatmap in ${OUT}`);
await browser.close();
