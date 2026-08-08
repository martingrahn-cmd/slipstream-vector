// Trailer capture — the portal-submission videos (16:9 and 9:16), rendered
// deterministically: warp(1/fps) + one screenshot per frame, then ffmpeg at
// the real frame rate. Software GL renders each frame in seconds; the OUTPUT
// is silky 30fps regardless, because sim time and wall time are decoupled —
// the same reason press-shots drives to its marks with warp instead of
// waiting for rAF. Martin's own soundtrack goes under the cut (sunset.mp3),
// faded out over the last second.
//
//   node tools/video-shots.mjs                # both orientations, ~40-80 min
//   node tools/video-shots.mjs --only wide    # or tall
//
// Needs the dev server on :8741, npm i playwright ffmpeg-static, and the
// usual PW_CHROMIUM/preinstalled chromium. Output: dist/trailer-*.mp4.
// The shot list is the game's best 20 seconds: the Sunset rock-cut arches
// into the LOOP (the arches that got their voice, the loop that lost its
// phantom murmur), then Aurora Pass flat out under the northern lights.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const URL_ = 'http://127.0.0.1:8741/';
const FPS = 30;

const argv = process.argv.slice(2);
const only = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();

const SEGMENTS = [
  { track: 0, from: 95, dur: 12 },    // Sunset: canyon arches -> the loop
  { track: 9, from: 2350, dur: 8 },   // Aurora: snowpack under the aurora
];
const ORIENTATIONS = [
  { name: 'wide', w: 1280, h: 720 },
  { name: 'tall', w: 720, h: 1280 },
];

const ffmpeg = (await import('ffmpeg-static')).default;
const { chromium } = await import('playwright');
const browser = await chromium.launch(
  { executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--no-proxy-server'] });

const localThree = path.join(ROOT, 'node_modules', 'three');
for (const o of ORIENTATIONS) {
  if (only && o.name !== only) continue;
  const frames = path.join(DIST, `frames-${o.name}`);
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });

  const page = await browser.newPage({ viewport: { width: o.w, height: o.h } });
  page.setDefaultTimeout(240000);
  if (fs.existsSync(localThree)) {
    await page.route('**://cdn.jsdelivr.net/**', (route) => {
      const rel = new URL(route.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '');
      try {
        route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(localThree, rel)) });
      } catch { route.fulfill({ status: 404, body: 'not found' }); }
    });
  }
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__game.spline, null, { timeout: 90000 });
  await page.addStyleTag({ content: '#stats, #comms-feed { display: none !important; }' }); // HUD stays: this is gameplay

  let n = 0;
  const t0 = Date.now();
  for (const seg of SEGMENTS) {
    await page.evaluate((ti) => {
      const g = window.__game;
      g.setTrack(ti); g.start(); g.setQuality('full');
    }, seg.track);
    // Roll to the segment start at racing speed (also clears the countdown).
    await page.evaluate((from) => {
      const g = window.__game;
      let guard = 0;
      const dist = () => (from - g.ship.s + g.spline.length) % g.spline.length;
      while (dist() > 12 && guard++ < 3000) g.warp(0.25, { throttle: 1 });
    }, seg.from);
    for (let f = 0; f < seg.dur * FPS; f++) {
      await page.evaluate((dt) => window.__game.warp(dt, { throttle: 1 }), 1 / FPS);
      await page.screenshot({ path: path.join(frames, `f${String(n++).padStart(5, '0')}.png`) });
    }
    console.log(`${o.name}: segment track ${seg.track} done — ${n} frames, ${Math.round((Date.now() - t0) / 1000)}s elapsed`);
  }
  await page.close();

  const total = n / FPS;
  const out = path.join(DIST, `trailer-${o.name === 'wide' ? '16x9' : '9x16'}.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.png'),
    '-i', path.join(ROOT, 'assets', 'music', 'sunset.mp3'),
    '-t', String(total), '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
    '-af', `afade=t=out:st=${total - 1}:d=1`, '-shortest', out,
  ], { stdio: 'pipe' });
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`${out}  ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
}
await browser.close();
