// Portal build packager — a self-contained copy of the game for game-portal
// uploads (CrazyGames et al), where the QA bar is "not one external request".
//
//   node tools/package-portal.mjs             # build dist/portal + zip
//   node tools/package-portal.mjs --verify    # ...then boot it headless with
//                                             # ALL non-local requests BLOCKED
//                                             # and drive a few seconds
//
// This is a COPY + REWRITE step, not a build step — the no-build principle
// stands, the live game keeps its CDN import map, and this tool exists only
// because portals host the files themselves:
//   - three.js + the addons trees are vendored from node_modules (version is
//     read from index.html's import map and must match — npm i three@<same>)
//   - the Google Fonts css + woff2 files are downloaded once and rewritten to
//     local paths (curl, because it honours the sandbox proxy; node fetch
//     does not)
//   - window.SV_PORTAL = true is injected before the game module — the seam
//     the portal SDK integration hangs off, so the Pages build never carries
//     portal code
//   - assets/shots (README art) stays out; everything the game fetches at
//     runtime goes in
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'portal');
const VERIFY = process.argv.includes('--verify');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const threeVer = (html.match(/three@([\d.]+)\//) || [])[1];
if (!threeVer) { console.error('cannot read three version from index.html import map'); process.exit(1); }
const threeSrc = path.join(ROOT, 'node_modules', 'three');
const havePkg = fs.existsSync(path.join(threeSrc, 'build', 'three.module.js'));
if (!havePkg) { console.error(`node_modules/three missing — run: npm i --no-save three@${threeVer}`); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---- game files -------------------------------------------------------------
const copyTree = (from, to, skip = () => false) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, e.name), t = path.join(to, e.name);
    if (skip(f)) continue;
    if (e.isDirectory()) { fs.mkdirSync(t, { recursive: true }); copyTree(f, t, skip); }
    else fs.copyFileSync(f, t);
  }
};
fs.mkdirSync(path.join(OUT, 'styles'), { recursive: true });
copyTree(path.join(ROOT, 'styles'), path.join(OUT, 'styles'));
fs.mkdirSync(path.join(OUT, 'src'), { recursive: true });
copyTree(path.join(ROOT, 'src'), path.join(OUT, 'src'));
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
copyTree(path.join(ROOT, 'assets'), path.join(OUT, 'assets'),
  (f) => f === path.join(ROOT, 'assets', 'shots') || f === path.join(ROOT, 'assets', 'covers'));

// ---- vendor three -----------------------------------------------------------
const vendor = path.join(OUT, 'vendor', 'three');
fs.mkdirSync(path.join(vendor, 'addons'), { recursive: true });
fs.copyFileSync(path.join(threeSrc, 'build', 'three.module.js'), path.join(vendor, 'three.module.js'));
// Since r167 the build is split: three.module.js re-exports from its sibling
// three.core.js — ship one without the other and every import 404s.
fs.copyFileSync(path.join(threeSrc, 'build', 'three.core.js'), path.join(vendor, 'three.core.js'));
for (const dir of ['postprocessing', 'shaders', 'utils']) {   // used trees + their transitive deps
  const from = path.join(threeSrc, 'examples', 'jsm', dir);
  const to = path.join(vendor, 'addons', dir);
  fs.mkdirSync(to, { recursive: true });
  copyTree(from, to);
}

// ---- vendor fonts -----------------------------------------------------------
const fontsDir = path.join(OUT, 'vendor', 'fonts');
fs.mkdirSync(fontsDir, { recursive: true });
const cssUrl = (html.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/) || [])[1];
if (!cssUrl) { console.error('cannot find the Google Fonts link in index.html'); process.exit(1); }
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
let css = execSync(`curl -sf -A "${UA}" "${cssUrl.replace(/&amp;/g, '&')}"`, { encoding: 'utf8' });
let fi = 0;
css = css.replace(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g, (_, u) => {
  const name = `f${fi++}-${path.basename(new URL(u).pathname)}`;
  execSync(`curl -sf -o "${path.join(fontsDir, name)}" "${u}"`);
  return `url(./${name})`;
});
fs.writeFileSync(path.join(fontsDir, 'fonts.css'), css);
console.log(`fonts: ${fi} woff2 vendored`);

// ---- rewrite index.html -----------------------------------------------------
let out = html
  .replace(/^\s*<link rel="preconnect"[^>]*>\n/gm, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^"]+"[^>]*>/, '<link href="./vendor/fonts/fonts.css" rel="stylesheet" />')
  .replace(/"three": "[^"]+"/, '"three": "./vendor/three/three.module.js"')
  .replace(/"three\/addons\/": "[^"]+"/, '"three/addons/": "./vendor/three/addons/"');
// The portal seam: the game can read this flag; the Pages build never has it.
out = out.replace(/<script type="importmap">/, '<script>window.SV_PORTAL = true;</script>\n  <script type="importmap">');
fs.writeFileSync(path.join(OUT, 'index.html'), out);

// ---- guard: no external references left in html/css -------------------------
const leaks = [];
const scan = (f) => {
  const txt = fs.readFileSync(f, 'utf8');
  const m = (txt.match(/https?:\/\/[^\s"')]+/g) || [])
    .filter((u) => !u.startsWith('http://www.w3.org/'));   // XML namespace ids are never fetched
  if (m.length) leaks.push(`${path.relative(OUT, f)}: ${[...new Set(m)].join(' ')}`);
};
scan(path.join(OUT, 'index.html'));
for (const e of fs.readdirSync(path.join(OUT, 'styles'))) scan(path.join(OUT, 'styles', e));
scan(path.join(OUT, 'vendor', 'fonts', 'fonts.css'));
if (leaks.length) { console.error('EXTERNAL REFERENCES REMAIN:\n' + leaks.join('\n')); process.exit(1); }

// ---- zip --------------------------------------------------------------------
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const zipName = `slipstream-vector-portal-${stamp}.zip`;
execSync(`cd "${OUT}" && zip -qr "../${zipName}" .`);
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
const size = (p) => { let s = 0; for (const e of fs.readdirSync(p, { withFileTypes: true })) s += e.isDirectory() ? size(path.join(p, e.name)) : fs.statSync(path.join(p, e.name)).size; return s; };
console.log(`build: ${mb(size(OUT))} unpacked -> dist/${zipName} ${mb(fs.statSync(path.join(DIST, zipName)).size)}`);

// ---- verify: boot it with the outside world switched off --------------------
if (VERIFY) {
  const { spawn } = await import('node:child_process');
  const { chromium } = await import('playwright');
  const server = spawn('python3', ['-m', 'http.server', '8742', '--bind', '127.0.0.1', '--directory', OUT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch(
    { executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.setDefaultTimeout(240000);
  const external = [];
  const errors = [];
  await page.route('**', (route) => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:8742')) return route.continue();
    // The CrazyGames SDK is the ONE legitimate external call a portal build
    // makes — on their domain it must load, everywhere else the adapter
    // degrades to no-ops. Abort it (that IS the degradation test) but do not
    // count it as a vendoring leak.
    if (!u.includes('sdk.crazygames.com')) external.push(u);
    route.abort();
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // the aborted SDK script logs a resource error — that is the test working
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  try {
    await page.goto('http://127.0.0.1:8742/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__game.spline, null, { timeout: 120000 })
      .catch((e) => {
        console.error('boot never completed. captured so far:');
        console.error('  errors:\n    ' + (errors.join('\n    ') || '(none)'));
        console.error('  blocked externals:\n    ' + (external.join('\n    ') || '(none)'));
        throw e;
      });
    await page.evaluate(() => { const g = window.__game; g.setTrack(0); g.start(); g.setQuality('low'); });
    await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__game.warp(0.25, { throttle: 1 }); });
    await page.screenshot({ path: path.join(DIST, 'portal-verify.png') });
    const s = await page.evaluate(() => Math.round(window.__game.ship.s));
    const portal = await page.evaluate(() => window.SV_PORTAL === true);
    console.log(`verify: booted offline, drove to s=${s}, SV_PORTAL=${portal}`);
    console.log(`verify: blocked external requests: ${external.length ? external.join(', ') : 'NONE - fully self-contained'}`);
    if (errors.length) console.log('verify: PAGE ERRORS:\n  ' + errors.join('\n  '));
    process.exitCode = (external.length || errors.length) ? 1 : 0;
  } finally {
    await browser.close();
    server.kill();
  }
}
