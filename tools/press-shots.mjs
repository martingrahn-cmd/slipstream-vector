// Press kit generator — three screenshots per circuit, captured in-engine.
//
// Nothing here is staged. It drives the real chase camera at full throttle to a
// chosen point on the lap and takes the frame, at FULL quality, with the debug
// fps/draws/tris readout hidden and a caption plate burned in. What you get is
// the game as it is played, which is the only kind of screenshot worth shipping.
//
//   1. start the dev server:  .claude/launch.json -> "game"  (port 8741)
//   2. npm i playwright       (one-off; this is a CDN import-map project)
//   3. node tools/press-shots.mjs
//
// Options (all optional, any order):
//   --tracks 0,4,9      only these roster indices          (default: all twelve)
//   --out press         output directory                   (default: ./press)
//   --url http://...    where the game is served           (default: :8741)
//   --size 1920x1080    viewport                           (default: 1920x1080)
//   --jpeg              also write JPEGs (quality 92) + README.txt
//   --no-caption        skip the burned-in caption plate
//
// Environment:
//   PW_CHROMIUM=/path/to/chrome   use a specific browser binary
//
// HOW THE THREE SHOTS ARE CHOSEN. Not at random, and not by hand — both age
// badly as the tracks change. Each is scored straight off the spline:
//
//   vista   the point whose heading is most directly at the world's sun
//           azimuth, minus a penalty for curvature so the horizon is actually
//           open. This is what frames the sun gate, the skyline, the aurora.
//   stunt   the most inverted or steeply banked frame in the lap
//           (1 - |U.y|), falling back to the hardest corner. Loops,
//           corkscrews, big banking.
//   stand   a grandstand, chosen at least SEPARATION metres from the other
//           two so the three frames are not the same view three times.
//
// If vista and stunt land within SEPARATION of each other the stunt pick is
// re-run with that stretch excluded — two tracks needed this, and without it
// they shipped near-duplicate frames.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const TRACKS = flag('tracks', '0,1,2,3,4,5,6,7,8,9,10,11').split(',').map(Number);
const OUT = path.resolve(flag('out', path.join(ROOT, 'press')));
const URL_ = flag('url', 'http://127.0.0.1:8741/index.html');
const [W, H] = flag('size', '1920x1080').split('x').map(Number);
const WANT_JPEG = has('jpeg');
const CAPTION = !has('no-caption');
const SEPARATION = 700;   // metres between two picks before they count as the same view

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed.  npm i playwright');
  process.exit(1);
});

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: W, height: H } });

// Serve three.js from node_modules when it is there, so the shoot does not
// depend on the CDN (and does not silently shoot a DIFFERENT three version
// from the one the audits run against).
const localThree = path.join(ROOT, 'node_modules', 'three');
if (fs.existsSync(localThree)) {
  await page.route('**://cdn.jsdelivr.net/**', (route) => {
    const rel = new global.URL(route.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    try {
      route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(localThree, rel)) });
    } catch { route.fulfill({ status: 404, body: 'not found' }); }
  });
}

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => {
  // A blocked web font or any other failed subresource is not a broken shoot —
  // the game is deliberately dependency-light and falls back. Only real script
  // errors should make this exit non-zero.
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`CONSOLE ${m.text()}`);
});

await page.goto(URL_, { waitUntil: 'load' });
page.setDefaultTimeout(240000);
await page.waitForFunction(() => window.__game && window.__game.spline, null, { timeout: 90000 });
// The shot picker needs real Vector3s for spline.frameAt (it writes into them).
await page.addScriptTag({ type: 'module', content: "import * as T from 'three'; window.THREE = T;" });
await page.waitForFunction(() => !!window.THREE, null, { timeout: 30000 });

// ---- caption plate + hide the debug readout --------------------------------
await page.evaluate((caption) => {
  const stats = document.getElementById('stats');
  if (stats) stats.style.display = 'none';   // fps/draws/tris is a debug overlay
  if (!caption) return;
  const el = document.createElement('div');
  el.id = '__cap';
  el.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:99999',
    'padding:26px 40px 30px', 'pointer-events:none',
    'background:linear-gradient(to top, rgba(6,2,20,0.86) 0%, rgba(6,2,20,0.55) 55%, rgba(6,2,20,0) 100%)',
    'font-family:ui-monospace,Menlo,Consolas,monospace',
  ].join(';');
  el.innerHTML = `
    <div style="font-size:15px;letter-spacing:0.46em;color:#35e8ff;text-shadow:0 0 14px rgba(53,232,255,0.75)">SLIPSTREAM VECTOR</div>
    <div id="__capTrack" style="font-size:40px;font-weight:800;letter-spacing:0.06em;color:#fff;margin-top:6px;text-shadow:0 0 22px rgba(255,79,208,0.55)"></div>
    <div id="__capWorld" style="font-size:15px;letter-spacing:0.30em;color:#ff4fd0;margin-top:5px"></div>`;
  document.body.appendChild(el);
}, CAPTION);

// rAF is throttled in a headless tab, so a screenshot is what forces a frame.
// Three warm-up shots let the tier settle and the world finish its first
// update before the one that counts.
const shoot = async (file) => {
  for (let i = 0; i < 3; i++) await page.screenshot({ path: path.join(OUT, '_warm.png') });
  await page.screenshot({ path: file });
};

const rows = [];
for (const ti of TRACKS) {
  const info = await page.evaluate(([ti, SEP]) => {
    const g = window.__game;
    g.setTrack(ti); g.start(); g.setQuality('full');
    const sp = g.spline, th = g.theme;
    const V = window.THREE.Vector3;
    const f = { pos: new V(), T: new V(), R: new V(), U: new V(), kappa: 0, bank: 0, width: 8, slope: 0 };

    // Sun direction in XZ — same convention the ground shader uses.
    const az = (th.sky && th.sky.sunAz) || [-0.35, -0.94];
    const al = Math.hypot(az[0], az[1]) || 1;
    const sx = az[0] / al, sz = az[1] / al;

    const scan = (score, avoid) => {
      let best = { s: 120, v: -1e9 };
      for (let s = 60; s < sp.length - 60; s += 12) {
        if (avoid != null) {
          const d = Math.abs(s - avoid);
          if (Math.min(d, sp.length - d) < SEP) continue;
        }
        sp.frameAt(s, f);
        const v = score(f);
        if (v > best.v) best = { s, v };
      }
      return best.s;
    };
    const sunScore = (fr) => {
      const tl = Math.hypot(fr.T.x, fr.T.z) || 1;
      return (fr.T.x / tl) * sx + (fr.T.z / tl) * sz - Math.abs(fr.kappa) * 22;
    };
    const stuntScore = (fr) => (1 - Math.abs(fr.U.y)) * 3 + Math.abs(fr.kappa) * 40;

    const vista = scan(sunScore, null);
    let stunt = scan(stuntScore, null);
    // Two picks on top of each other is two copies of one photo.
    const d = Math.abs(stunt - vista);
    if (Math.min(d, sp.length - d) < SEP) stunt = scan(stuntScore, vista);

    const st = g.scenery.group.children.find((c) => c.name === 'stands');
    const standS = st ? st.userData.spots.map((p) => p.s) : [];
    let stand = standS.length ? standS[0] : null;
    for (const c of standS) {
      const dv = Math.abs(c - vista), ds = Math.abs(c - stunt);
      if (Math.min(dv, sp.length - dv) > 350 && Math.min(ds, sp.length - ds) > 350) { stand = c; break; }
    }

    const picks = [['vista', vista], ['stunt', stunt]];
    if (stand != null) picks.push(['stand', stand]);
    return {
      name: (g.trackDef && g.trackDef.name) || `TRACK ${ti}`,
      world: th.name || String(th.id).toUpperCase(),
      picks,
    };
  }, [ti, SEPARATION]);

  if (CAPTION) {
    await page.evaluate(([t, w]) => {
      document.getElementById('__capTrack').textContent = t;
      document.getElementById('__capWorld').textContent = w;
    }, [info.name.toUpperCase(), info.world.toUpperCase()]);
  }

  for (const [label, target] of info.picks) {
    // DRIVE to the spot, do not teleport: g.start() re-grids the field on the
    // next step and silently undoes an assignment to ship.s, which is how an
    // earlier version of this shot list ended up photographing the start line
    // twelve times.
    const got = await page.evaluate((t) => {
      const g = window.__game;
      if (g.ship.s > t - 20) g.start();
      let guard = 0;
      while (g.ship.s < t - 10 && guard++ < 1200) g.warp(0.3, { throttle: 1 });
      return { s: Math.round(g.ship.s), v: Math.round(g.ship.v * 3.6) };
    }, target);
    const slug = info.name.replace(/\W+/g, '');
    const file = path.join(OUT, `${String(ti).padStart(2, '0')}-${slug}-${label}.png`);
    await shoot(file);
    rows.push({ ti, name: info.name, world: info.world, label, file });
    console.log(`t${String(ti).padStart(2)} ${info.name.padEnd(16)} ${label.padEnd(6)} s=${got.s} ${got.v} km/h`);
  }
}

// ---- optional JPEG pass ----------------------------------------------------
// Done in the browser because this project has no image library and does not
// want one. 1920x1080 PNGs are ~1.5MB each and do not compress in a zip; the
// JPEGs are ~250KB and are what a store page or a press mail actually wants.
if (WANT_JPEG) {
  const jdir = path.join(OUT, 'jpg');
  fs.mkdirSync(jdir, { recursive: true });
  const conv = await browser.newPage();
  await conv.setContent('<canvas id="c"></canvas>');
  for (const r of rows) {
    const b64 = fs.readFileSync(r.file).toString('base64');
    const out = await conv.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.getElementById('c');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.92).split(',')[1];
    }, b64);
    fs.writeFileSync(path.join(jdir, path.basename(r.file).replace(/\.png$/, '.jpg')), Buffer.from(out, 'base64'));
  }
  await conv.close();

  const byWorld = new Map();
  for (const r of rows) {
    if (!byWorld.has(r.world)) byWorld.set(r.world, []);
    const list = byWorld.get(r.world);
    if (!list.some((e) => e.ti === r.ti)) list.push(r);
  }
  const roster = [...byWorld.entries()]
    .map(([world, list]) => `  ${world.padEnd(18)}${list.map((e) => `${String(e.ti).padStart(2, '0')} ${e.name}`).join('   ')}`)
    .join('\n');
  const readme = `SLIPSTREAM VECTOR — PRESS KIT
=============================

${rows.length} screenshots, ${W}x${H}, three per circuit, captured in-engine from the
chase camera at FULL graphics quality. No free-camera or staged angles: this
is the game as it is played. The fps/draws/triangles debug readout is hidden.

Caption is burned in at the bottom left: game title, circuit, world.

Naming: NN-CircuitName-type.jpg   (NN = position in the roster)

  vista   the circuit facing its world's sun or landmark
  stunt   a loop, corkscrew or the hardest corner of the lap
  stand   passing a grandstand

WORLDS AND CIRCUITS

${roster}

Slipstream Vector — a neon arcade racer. Built with three.js, no build step,
plays in the browser: https://martingrahn-cmd.github.io

Regenerate with:  node tools/press-shots.mjs --jpeg
`;
  fs.writeFileSync(path.join(jdir, 'README.txt'), readme);
  fs.writeFileSync(path.join(OUT, 'README.txt'), readme);
  console.log(`\njpeg + README written to ${jdir}`);
}

try { fs.unlinkSync(path.join(OUT, '_warm.png')); } catch { /* never existed */ }
console.log(`\n${rows.length} shots -> ${OUT}`);
console.log(`errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ', e);
await browser.close();
process.exit(errors.length ? 1 : 0);
