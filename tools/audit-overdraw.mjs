// Additive-overdraw audit — what the transparent layer actually costs.
//
// Sparks, camera flashes, exhaust ribbons, motes, glow ribbons, projectile glow
// and ship reflections are all additive and all stack. The quality tiers used to
// govern them with density knobs (`motes`, `sparks`, `life`) that nobody had
// ever priced. This prices them.
//
//   node tools/audit-overdraw.mjs [tracks] [tiers] [samplesPerCombo]
//   node tools/audit-overdraw.mjs 0,5,8,11 low,medium,full 3
//
// Needs `npm i playwright three` and the dev server up (.claude/launch.json
// "game" on :8741).
//
// ---- Method -----------------------------------------------------------------
// An exact fragment count, not an estimate:
//
//   pass 1  render the scene with every additive object off layer 0, into a
//           float target. This lays down the real DEPTH buffer, so additive
//           geometry behind a mesa is correctly rejected rather than counted.
//   pass 2  clear COLOUR only (depth survives), draw ONLY the additive objects,
//           overriding their material with a flat white additive one that adds
//           exactly 1.0 per fragment. Read the target back and sum.
//
// sum / pixels = mean additive layers per screen pixel. 1.000 would mean one
// extra full-screen layer of blended fill per frame.
//
// Replacing soft falloff shaders with a flat quad is deliberate and correct for
// COST: the GPU shades every fragment of the quad whatever the result looks
// like. This measures work done, not brightness delivered.
//
// ---- Two traps this tool exists to not fall into ----------------------------
// 1. LAYERS, NOT `visible`. `object.visible = false` prunes the whole subtree in
//    three.js, so hiding a solid hull also hides the additive engine glow
//    parented under it. The first version did that and reported "ships: 0.000"
//    while the heatmap plainly showed engine glow on screen. Layers are
//    per-object and do not prune children.
// 2. THE GAME'S OWN LOOP HAS TO RUN. sparks/trails/shipVisual/shock/fireball are
//    all updated in the RENDER path (main.js), not in the fixed step. A
//    hand-rolled sim loop leaves every one of them frozen — the first version
//    measured that and produced three identical, entirely plausible columns.
//    Here the sim loop only places the field; the frames that get measured are
//    driven by the real loop, forced with screenshots because rAF is throttled
//    in a headless tab.
//
// Set OD_DUMP=<dir> to also write a beauty shot and an overdraw heatmap per
// combo. Look at them. A number from a camera pointed at the sky reads exactly
// as plausible as a real one.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Measurement resolution (our own renderer) — thin geometry like the neon edge
// strips holds a minimum PIXEL width, so its share of the screen is resolution
// dependent and this needs to be a real one.
const W = +(process.env.OD_W || 1280), H = +(process.env.OD_H || 720);
// Page viewport, deliberately decoupled: forcing a frame of the real game costs
// a full post chain, and on a software rasteriser at 1280x720 that blows a 30s
// screenshot timeout. Keep the same 16:9 so framing is identical.
const VW = +(process.env.OD_VW || 640), VH = +(process.env.OD_VH || 360);

const TRACKS = (process.argv[2] || '0').split(',').map(Number);
const TIERS = (process.argv[3] || 'low,medium,full').split(',');
const SAMPLES = +(process.argv[4] || 3);

// Sandboxed CI images ship their own Chromium and may route localhost through a
// proxy; on a normal machine none of this applies and playwright's own browser
// is used.
const launch = { args: ['--no-sandbox', '--no-proxy-server'] };
if (process.env.OD_CHROMIUM && existsSync(process.env.OD_CHROMIUM)) launch.executablePath = process.env.OD_CHROMIUM;
if (process.env.OD_SOFTWARE_GL) launch.args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

// THREE_PKG mirrors the CDN from a local three@0.172.0 install, for machines
// with no outbound network. Unset = fetch from jsdelivr as the game normally does.
if (process.env.THREE_PKG) {
  await page.route('**cdn.jsdelivr.net/npm/three@0.172.0/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/npm/three@0.172.0/', '');
    try { await route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(path.join(process.env.THREE_PKG, rel), 'utf8') }); }
    catch { await route.fulfill({ status: 404, body: `not mirrored: ${rel}` }); }
  });
}

// 'load' waits on the music and pilot videos, which never settle here — the
// game's own __game handle is the real readiness signal.
await page.goto('http://127.0.0.1:8741/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.spline, null, { timeout: 90000 });
// three isn't global; pull it in through the page's own import map, same as
// tools/press-shots.mjs does.
await page.addScriptTag({ type: 'module', content: "import * as T from 'three'; window.THREE = T;" });
await page.waitForFunction(() => !!window.THREE, null, { timeout: 30000 });

await page.evaluate(([W, H]) => {
  const T = window.THREE;
  const g = window.__game;
  const rt = new T.WebGLRenderTarget(W, H, { type: T.FloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: true });
  const r2 = new T.WebGLRenderer({ antialias: false });
  r2.setPixelRatio(1);
  r2.setSize(W, H, false);
  const counter = new T.MeshBasicMaterial({
    color: 0xffffff, blending: T.AdditiveBlending,
    depthTest: true, depthWrite: false, transparent: true, fog: false, toneMapped: false,
  });
  const buf = new Float32Array(W * H * 4);
  const MEASURE = 31;   // layer used to isolate the subset being counted

  window.__od = {
    // Advance the real fixed step INCLUDING weapons — __game.warp() does NOT
    // step the weapon system, it is only stepped in the render loop. This is
    // only used to PLACE the field; it does not animate any visual effect.
    sim(seconds) {
      const DT = 1 / 120, input = { steer: 0, throttle: 1, brake: 0, airbrake: false };
      for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
        g.race.computeDraft(g.ship); g.ship.step(DT, input);
        g.race.stepFixed(DT, true); g.race.interact(g.ship, DT);
        g.weapons.stepFixed(DT, true, false);
      }
      g.rig.reset(g.ship);
    },

    measure() {
      const scene = g.scenery.group.parent;
      const cam = g.camera;
      cam.aspect = W / H; cam.updateProjectionMatrix();

      // A child of a hidden parent is still `visible: true` itself but never
      // renders; counting it would inflate the result.
      const shown = (o) => { let p = o; while (p) { if (p.visible === false) return false; p = p.parent; } return true; };
      const additive = [], solid = [];
      scene.traverse((o) => {
        if (!o.material || !shown(o)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        (mats.some((m) => m && m.blending === T.AdditiveBlending) ? additive : solid).push(o);
      });

      const rootOf = (o) => { let p = o; while (p.parent && p.parent !== scene) p = p.parent; return p; };
      // Engine flames and cores live in race.fxBatch — ONE shared instanced
      // batch parented to the scene, not under any ship. Miss it and the ships
      // row reads zero while the heatmap shows engine glow.
      const shipRoots = new Set();
      const vis = [g.shipVisual, ...(g.race && g.race.racers ? g.race.racers.map((r) => r.vis) : []),
        g.race ? g.race.fxBatch : null];
      for (const v of vis) { if (!v) continue; for (const k of Object.keys(v)) { const x = v[k]; if (x && x.isObject3D) shipRoots.add(rootOf(x)); } }
      const sceneryRoot = rootOf(g.scenery.group);
      const label = (o) => { const r = rootOf(o); return r === sceneryRoot ? 'scenery' : shipRoots.has(r) ? 'ships' : 'other'; };

      const shot = (subset) => {
        for (const o of additive) o.layers.disable(0);
        cam.layers.set(0);
        r2.autoClear = true; r2.setRenderTarget(rt); r2.setClearColor(0x000000, 1);
        r2.clear(true, true, true);
        r2.render(scene, cam);                       // pass 1: solids -> depth
        for (const o of subset) o.layers.enable(MEASURE);
        cam.layers.set(MEASURE);
        r2.autoClear = false; r2.clearColor();       // colour only; depth survives
        scene.overrideMaterial = counter;
        r2.render(scene, cam);                       // pass 2: the subset, counted
        scene.overrideMaterial = null;
        r2.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        for (const o of subset) o.layers.disable(MEASURE);
        for (const o of additive) o.layers.enable(0);
        cam.layers.set(0); r2.autoClear = true; r2.setRenderTarget(null);

        let sum = 0, covered = 0, max = 0;
        for (let i = 0; i < W * H; i++) {
          const v = buf[i * 4];
          if (v > 0) { covered++; sum += v; if (v > max) max = v; }
        }
        return { mean: sum / (W * H), coverage: covered / (W * H), max };
      };

      window.__od.dump = () => {
        const toPNG = (map) => {
          const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          const ctx = cv.getContext('2d'); const img = ctx.createImageData(W, H);
          for (let i = 0; i < W * H; i++) {
            const di = ((H - 1 - Math.floor(i / W)) * W + (i % W)) * 4;   // GL reads bottom-up
            const [r, g2, b] = map(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);
            img.data[di] = r; img.data[di + 1] = g2; img.data[di + 2] = b; img.data[di + 3] = 255;
          }
          ctx.putImageData(img, 0, 0);
          return cv.toDataURL('image/png');
        };
        const tone = (v) => Math.round(255 * Math.pow(v / (1 + v), 1 / 2.2));
        for (const o of additive) o.layers.disable(0);
        cam.layers.set(0);
        r2.autoClear = true; r2.setRenderTarget(rt); r2.setClearColor(0x000000, 1);
        r2.clear(true, true, true); r2.render(scene, cam);
        r2.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        const beauty = toPNG((r, g2, b) => [tone(r), tone(g2), tone(b)]);
        for (const o of additive) o.layers.enable(MEASURE);
        cam.layers.set(MEASURE);
        r2.autoClear = false; r2.clearColor();
        scene.overrideMaterial = counter; r2.render(scene, cam); scene.overrideMaterial = null;
        r2.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        const heat = toPNG((v) => { const t = Math.min(1, v / 6); return [Math.round(255 * t), Math.round(90 * t), Math.round(255 * (1 - t) * (v > 0 ? 1 : 0))]; });
        for (const o of additive) { o.layers.disable(MEASURE); o.layers.enable(0); }
        cam.layers.set(0); r2.autoClear = true; r2.setRenderTarget(null);
        return { beauty, heat };
      };

      const byCat = {};
      for (const cat of ['scenery', 'ships', 'other']) {
        const sub = additive.filter((o) => label(o) === cat);
        byCat[cat] = sub.length ? shot(sub) : { mean: 0, coverage: 0, max: 0 };
        byCat[cat].n = sub.length;
      }
      const total = shot(additive);
      total.n = additive.length;
      return { total, byCat };
    },
  };
}, [W, H]);

const rows = [];
for (const ti of TRACKS) {
  for (const tier of TIERS) {
    await page.evaluate(([ti, tier]) => {
      const g = window.__game;
      g.setTrack(ti); g.start(); g.setQuality(tier);
      window.__od.sim(25);          // place the field; visuals are NOT animated by this
    }, [ti, tier]);

    // From here the GAME'S loop drives. A screenshot forces a frame; the tiny
    // clip keeps the encode cheap while the full frame still renders.
    const frame = () => page.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 }, timeout: 180000 });
    const MODES = ['cruise', 'scrape', 'combat'];   // steady racing under-reports:
    const samples = [];                             // sparks only exist while scraping
    for (let i = 0; i < SAMPLES; i++) {
      const mode = MODES[i % MODES.length];
      const keys = ['ArrowUp', ...(mode === 'scrape' ? ['ArrowRight', 'ShiftLeft'] : [])];
      for (const k of keys) await page.keyboard.down(k);
      if (mode === 'combat') await page.evaluate(() => { const g = window.__game; if (g.ship.heldWeapon === null) g.ship.heldWeapon = 'missiles'; });
      // realDt is clamped to 0.05s, so ~14 frames buys ~0.7s of settling —
      // enough for sparks to emit and live and for trails to fill.
      for (let f = 0; f < 14; f++) {
        await frame();
        if (mode === 'combat' && f % 6 === 0) await page.keyboard.press('Space').catch(() => {});
      }
      const m = await page.evaluate(() => window.__od.measure());
      m.mode = mode;
      samples.push(m);
      for (const k of keys) await page.keyboard.up(k);
    }

    const info = await page.evaluate(() => ({ track: window.__game.trackDef.name, tier: window.__game.qualityState().tier }));
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    // null, not 0, for a regime this run never sampled — a zero in that column
    // reads as "measured, costs nothing", which is the opposite of the truth.
    const byMode = (mo) => {
      const hit = samples.filter((s) => s.mode === mo).map((s) => s.total.mean);
      return hit.length ? avg(hit) : null;
    };
    rows.push({
      track: info.track, tier: info.tier,
      mean: avg(samples.map((s) => s.total.mean)), peak: Math.max(...samples.map((s) => s.total.mean)),
      cruise: byMode('cruise'), scrape: byMode('scrape'), combat: byMode('combat'),
      cov: avg(samples.map((s) => s.total.coverage)),
      depth: Math.max(...samples.map((s) => s.total.max)),
      scenery: avg(samples.map((s) => s.byCat.scenery.mean)),
      ships: avg(samples.map((s) => s.byCat.ships.mean)),
      other: avg(samples.map((s) => s.byCat.other.mean)),
    });
    console.log(`  measured ${info.track} @ ${info.tier}`);

    if (process.env.OD_DUMP) {
      const imgs = await page.evaluate(() => { window.__od.measure(); return window.__od.dump(); });
      for (const [k, url] of Object.entries(imgs)) {
        const f = path.join(process.env.OD_DUMP, `${info.track.replace(/\W+/g, '-')}-${info.tier}-${k}.png`);
        await writeFile(f, Buffer.from(url.split(',')[1], 'base64'));
        console.log(`    wrote ${f}`);
      }
    }
  }
}

console.log(`\n=============== ADDITIVE OVERDRAW (${W}x${H}) ===============`);
console.log('mean = additive layers per screen pixel, averaged over the whole frame');
console.log('cov  = share of the screen touched by any additive geometry\n');
const fmt = (v) => (v == null ? '     -' : v.toFixed(3).padStart(6));
console.log('track            tier    mean   peak | cruise scrape combat |   cov  depth | scenery  ships  other');
for (const r of rows) {
  console.log(
    `${r.track.padEnd(16)} ${r.tier.padEnd(7)} ${r.mean.toFixed(3).padStart(5)} ${r.peak.toFixed(3).padStart(6)} | ` +
    `${fmt(r.cruise)} ${fmt(r.scrape)} ${fmt(r.combat)} | ` +
    `${(r.cov * 100).toFixed(1).padStart(4)}% ${r.depth.toFixed(0).padStart(6)} | ` +
    `${r.scenery.toFixed(3).padStart(7)} ${r.ships.toFixed(3).padStart(6)} ${r.other.toFixed(3).padStart(6)}`);
}
console.log('\nReference: 1.000 = one extra full-screen layer of blended fill per frame.');

await browser.close();
