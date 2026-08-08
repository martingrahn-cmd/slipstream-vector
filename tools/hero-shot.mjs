// Hero/cover-art export — backdrops from the engine, composition from
// hero-lab.html, at the exact sizes portals ask for.
//
//   node tools/hero-shot.mjs                 # capture 6 candidate backdrops (Sunset)
//   node tools/hero-shot.mjs --track 9       # ...from another track
//   node tools/hero-shot.mjs --bg 3          # compose bg-3.png at wide/square/tall
//
// Needs the dev server on :8741 and `npm i playwright` (chromium via
// PW_CHROMIUM or the playwright install). Output: press/hero/ (gitignored —
// pick a winner, then commit a copy under assets/ if the README wants it).
//
// Backdrops are CLEAN frames: every HUD element carries class="hud", so one
// injected rule empties the frame — no timers, no minimap, no speedo. The
// drive-to-mark is warp+throttle (the press-shots lesson: a teleport gets
// re-gridded and photographs the start line without appearing to fail).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'press', 'hero');
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TRACK = +flag('track', 0);
const BG = flag('bg', null);
const URL_ = 'http://127.0.0.1:8741/';

const { chromium } = await import('playwright');
const browser = await chromium.launch(
  process.env.PW_CHROMIUM
    ? { executablePath: process.env.PW_CHROMIUM, args: ['--no-sandbox', '--no-proxy-server'] }
    : { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--no-proxy-server'] },
);

if (!BG) {
  // ---- phase A: clean candidate backdrops, spread over the lap ----
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(240000);
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__game.spline, null, { timeout: 90000 });
  await page.addStyleTag({ content: '.hud, #comms-feed { display: none !important; }' });
  await page.evaluate((ti) => {
    const g = window.__game;
    g.setTrack(ti); g.start(); g.setQuality('full');
  }, TRACK);
  const L = await page.evaluate(() => window.__game.spline.length);
  const marks = [0.02, 0.18, 0.35, 0.5, 0.68, 0.85].map((f) => Math.round(L * f));
  let n = 0;
  for (const target of marks) {
    n++;
    await page.evaluate((t) => {
      const g = window.__game;
      let guard = 0;
      const dist = () => (t - g.ship.s + g.spline.length) % g.spline.length;
      while (dist() > 12 && guard++ < 3000) g.warp(0.25, { throttle: 1 });
    }, target);
    await page.keyboard.down('ArrowUp');
    try {
      for (let i = 0; i < 3; i++) await page.screenshot({ path: path.join(OUT, '_warm.png') });
      await page.screenshot({ path: path.join(OUT, `bg-${n}.png`) });
    } finally { await page.keyboard.up('ArrowUp'); }
    console.log(`bg-${n}.png  s~${target}`);
  }
  await browser.close();
  console.log(`\ncandidates in press/hero/ — pick one, then: node tools/hero-shot.mjs --bg <n>`);
  process.exit(0);
}

// ---- phase B: compose the chosen backdrop at portal sizes ----
const SIZES = [
  ['wide', 1920, 1080],
  ['square', 1080, 1080],
  ['tall', 800, 1200],
];
for (const [layout, w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${URL_}hero-lab.html?bg=press/hero/bg-${BG}.png&layout=${layout}`,
    { waitUntil: 'domcontentloaded' });
  const ready = await page.waitForFunction(() => window.__heroReady, null, { timeout: 30000 });
  if (await ready.jsonValue() === 'bg-missing') { console.error(`bg-${BG}.png missing`); process.exit(1); }
  await page.screenshot({ path: path.join(OUT, `hero-${layout}.png`) });
  console.log(`hero-${layout}.png  ${w}x${h}`);
  await page.close();
}
await browser.close();
