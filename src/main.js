// Boot + the fixed-step loop (120Hz accumulator) + the attract/countdown/
// race/finish state machine + world (re)building for the track roster.
// Wiring only — all behavior lives in the modules.
import * as THREE from 'three';
import { TUNING as T } from './config.js';
import { TRACKS } from './track/tracks/index.js';
import { THEMES } from './worlds/themes.js';
import { TrackSpline, makeFrame } from './track/spline.js';
import { buildTrackMesh } from './track/trackMesh.js';
import { buildScenery } from './track/scenery.js';
import { ShipPhysics } from './ship/shipPhysics.js';
import { ShipVisual } from './ship/shipVisual.js';
import { CameraRig } from './fx/cameraRig.js';
import { Juice } from './fx/juice.js';
import { SpeedLines, Sparks, ExhaustTrails } from './fx/particles.js';
import { PostFX } from './fx/postfx.js';
import { Hud, fmt } from './ui/hud.js';
import { Minimap } from './ui/minimap.js';
import { Input, NULL_INPUT, REBINDABLE, keyLabel } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { Race } from './race.js';
import { Menu, drawThumb, drawProfile, bar, hex } from './ui/menu.js';
import { Podium } from './ui/podium.js';
import { PodiumScene } from './ui/podiumScene.js';
import { PauseMenu } from './ui/pauseMenu.js';
import { Achievements, TIERS } from './ui/achievements.js';
import { TEAMS, PILOT_BIOS, pilotSlug } from './worlds/teams.js';
import { CLASSES, classKmh } from './worlds/classes.js';
import { DIFFICULTIES } from './worlds/difficulty.js';

// Prestige livery (index 2 on every team) unlocked by winning the Phantom cup.
const CHAMPION_LIVERY = { hull: 0x1a1208, accent: 0xffd23f };
function championUnlocked() { return localStorage.getItem('sv-champion') === '1'; }
function liveryCount() { return 2 + (championUnlocked() ? 1 : 0); }
function liveryOf(team, idx) { return idx >= 2 ? CHAMPION_LIVERY : team.liveries[idx]; }
function unlockedClasses() {
  return Math.max(0, Math.min(CLASSES.length - 1,
    parseInt(localStorage.getItem('sv-unlocked') ?? '0', 10) || 0));
}

const FIXED_DT = 1 / 120;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  antialias: false, // MSAA comes from the composer's render target
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, T.PIXEL_RATIO_CAP));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping; // clipped saturated color is the look
renderer.info.autoReset = false;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, T.FOG_NEAR, T.FOG_FAR);

const camera = new THREE.PerspectiveCamera(T.FOV_BASE, innerWidth / innerHeight, 0.1, 2200);
scene.add(camera); // speed lines live in camera space

// ------------------------------------------------- persistent subsystems
const juice = new Juice();
const audio = new AudioEngine(juice);
const speedLines = new SpeedLines(camera);
const sparks = new Sparks(scene);
const trails = new ExhaustTrails(scene);
const input = new Input();
const hud = new Hud(juice);
const menu = new Menu();
const pauseMenu = new PauseMenu();
const achievements = new Achievements(audio);

// Per-race tally for achievements, reset at each countdown.
const tally = { wallHits: 0, contacts: 0, perfectStart: false, pads: 0 };
let lastPlace = 0; // for the overtake trophy
const podium = new Podium(document.getElementById('podium'));
const podiumScene = new PodiumScene(document.getElementById('podium-scene'));
const postfx = new PostFX(renderer, scene, camera);

// Environment snapshot for the track card: rendered from a showcase point in
// the real world, supersampled 2x into the menu canvas.
const ENV_W = 332, ENV_H = 152;
const envRT = new THREE.WebGLRenderTarget(ENV_W * 2, ENV_H * 2);
const envCam = new THREE.PerspectiveCamera(56, ENV_W / ENV_H, 0.5, 2200);
const envPixels = new Uint8Array(ENV_W * 2 * ENV_H * 2 * 4);
const _envF = makeFrame();

function captureEnvThumb() {
  // Showcase spot: the highest point that is still ordinary road (not a
  // loop face or a crest lip).
  let bestS = 60, bestY = -Infinity;
  for (let i = 0; i < spline.n; i += 8) {
    const ty = Math.abs(spline.tan[i * 3 + 1]);
    if (ty > 0.3) continue;
    if (Math.abs(spline.verticalCurvAt(i * spline.step)) > 0.004) continue;
    const y = spline.pos[i * 3 + 1];
    if (y > bestY) { bestY = y; bestS = i * spline.step; }
  }
  const f = spline.frameAt(bestS, _envF);
  envCam.position.copy(f.pos)
    .addScaledVector(f.T, -34)
    .addScaledVector(f.U, 13)
    .addScaledVector(f.R, 17);
  envCam.lookAt(f.pos.x + f.T.x * 30, f.pos.y + 2, f.pos.z + f.T.z * 30);
  renderer.setRenderTarget(envRT);
  renderer.render(scene, envCam);
  renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(envRT, 0, 0, ENV_W * 2, ENV_H * 2, envPixels);

  const canvas = document.getElementById('env-thumb');
  canvas.width = ENV_W; canvas.height = ENV_H;
  canvas.style.width = `${ENV_W}px`; canvas.style.height = `${ENV_H}px`;
  const ctx = canvas.getContext('2d');
  // Flip Y via a temp canvas at full res, then downscale (cheap 2x AA).
  const tmp = captureEnvThumb._tmp || (captureEnvThumb._tmp = document.createElement('canvas'));
  tmp.width = ENV_W * 2; tmp.height = ENV_H * 2;
  const tctx = tmp.getContext('2d');
  const img = tctx.createImageData(ENV_W * 2, ENV_H * 2);
  const rowBytes = ENV_W * 2 * 4;
  for (let y = 0; y < ENV_H * 2; y++) {
    img.data.set(
      envPixels.subarray((ENV_H * 2 - 1 - y) * rowBytes, (ENV_H * 2 - y) * rowBytes),
      y * rowBytes,
    );
  }
  tctx.putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0, ENV_W, ENV_H);
}

// --------------------------------------------------- world (per track)
let trackIndex = parseInt(localStorage.getItem('sv-track') || '0', 10) || 0;
const TROPHY_FILTERS = ['all', 'bronze', 'silver', 'gold', 'platinum'];
let trophyTier = 'all';
trackIndex = ((trackIndex % TRACKS.length) + TRACKS.length) % TRACKS.length;
let trackDef, theme, spline, track, scenery, ship, shipVisual, rig, minimap, race;
let TOTAL_LAPS = 3;

// The player's seat: mode, team, livery and callsign. Persisted.
const MODES = ['CHAMPIONSHIP', 'SINGLE RACE', 'TIME TRIAL'];
const selection = {
  mode: clampInt(localStorage.getItem('sv-mode') ?? '1', MODES.length),
  classIdx: Math.min(clampInt(localStorage.getItem('sv-class'), CLASSES.length), unlockedClasses()),
  // Rival difficulty (default PRO ≈ the old per-track average). Always free to pick.
  difficulty: clampInt(localStorage.getItem('sv-difficulty') ?? '1', DIFFICULTIES.length),
  team: clampInt(localStorage.getItem('sv-team'), TEAMS.length),
  livery: clampInt(localStorage.getItem('sv-livery'), liveryCount()),
  pilot: clampInt(localStorage.getItem('sv-pilot'), 2), // which of the team's 2 named drivers you are
};

// Championship: points across the whole roster, awarded per finish position.
const CHAMP_PTS = [10, 8, 6, 5, 4, 3, 2, 1];
const champ = {
  active: false,
  round: 0,
  classIndex: 0,     // the speed class this cup is being run at
  unlockMsg: null,   // set when winning a cup unlocks something
  points: new Map(), // id -> {name, accent, player, pts}
};
let finishedView = 'race'; // race | standings (championship intermission)
function clampInt(v, mod) {
  const n = parseInt(v || '0', 10) || 0;
  return ((n % mod) + mod) % mod;
}
function selectionInfo() {
  const team = TEAMS[selection.team];
  return {
    ...selection,
    pilotName: team.pilots[selection.pilot] || team.pilots[0],
    teamName: team.name,
    accentCss: `#${liveryOf(team, selection.livery).accent.toString(16).padStart(6, '0')}`,
  };
}
let debugView = { x: 0, z: 0, h: 760 };

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function buildWorld(idx) {
  if (track) { scene.remove(track.group); disposeTree(track.group); }
  if (scenery) {
    scene.remove(scenery.group, scenery.sky);
    disposeTree(scenery.group); disposeTree(scenery.sky);
  }
  trackDef = TRACKS[idx];
  theme = THEMES[trackDef.world];
  TOTAL_LAPS = trackDef.laps;
  audio.prewarmMusic(theme.music); // decode this world's track ahead of GO (no-op pre-unlock)
  _dustA.set(theme.ambient ? theme.ambient.color : 0x9a8a6a); // ground kick-up tint
  _dustB.copy(_dustA).multiplyScalar(0.32);

  spline = new TrackSpline(trackDef);
  track = buildTrackMesh(spline, theme);
  scene.add(track.group);
  scenery = buildScenery(spline, scene, theme);
  scene.add(scenery.group);
  buildField();
  rig = new CameraRig(spline, camera);
  minimap = new Minimap(spline, document.getElementById('minimap'));
  scene.fog.color.setHex(theme.fog);
  postfx.applyTheme(theme); // per-world grade + vignette tint
  trails.reset();

  // Debug top-down camera fitted to this track's bounds.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < spline.n; i++) {
    minX = Math.min(minX, spline.pos[i * 3]); maxX = Math.max(maxX, spline.pos[i * 3]);
    minZ = Math.min(minZ, spline.pos[i * 3 + 2]); maxZ = Math.max(maxZ, spline.pos[i * 3 + 2]);
  }
  debugView = {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    h: Math.max(maxX - minX, maxZ - minZ) * 1.15 + 150,
  };

  ship.reset(12);
  rig.reset(ship);
  localStorage.setItem('sv-track', String(idx));
  captureEnvThumb();
  updateMenu();
}

function bestKey() { return `sv-best-${trackDef.id}`; }

// Player ship + AI field — rebuilt on team/livery change without touching
// the world geometry.
function buildField() {
  if (shipVisual) {
    scene.remove(shipVisual.root, shipVisual.shadow);
    disposeTree(shipVisual.root); disposeTree(shipVisual.shadow);
    // Dispose only the reflection's OWN materials — its hull/glow geometry is
    // borrowed from the ship and is freed by disposeTree(shipVisual.root) above.
    if (shipVisual.reflection) {
      scene.remove(shipVisual.reflection);
      shipVisual.reflMat.dispose(); shipVisual.reflGlowMat.dispose();
    }
  }
  if (race) race.dispose(scene);
  const team = TEAMS[selection.team];
  const cls = CLASSES[selection.classIdx];
  const variant = { ...team.variant, ...liveryOf(team, selection.livery) };
  ship = new ShipPhysics(spline, juice, team.stats, cls);
  shipVisual = new ShipVisual(spline, scene, variant, { reactive: true, groundStyle: theme.groundStyle });
  race = new Race(spline, scene, DIFFICULTIES[selection.difficulty].level,
    TOTAL_LAPS, juice, selectionInfo(),
    selection.mode === 2 /* time trial: empty track */, cls);
  race.grid();
  ship.reset(12);
  podium.setShip(variant);
  localStorage.setItem('sv-team', String(selection.team));
  localStorage.setItem('sv-livery', String(selection.livery));
  localStorage.setItem('sv-pilot', String(selection.pilot));
  localStorage.setItem('sv-class', String(selection.classIdx));
  localStorage.setItem('sv-difficulty', String(selection.difficulty));
}

const DEADZONES = [0.08, 0.18, 0.30];
const DZ_LABEL = ['LOW', 'MEDIUM', 'HIGH'];
const CONTROLS_LEGEND = '<div class="lg-row"><span>STEER</span><b>&larr; &rarr; / A D / stick</b></div>'
  + '<div class="lg-row"><span>THROTTLE</span><b>&uarr; / W / RT</b></div>'
  + '<div class="lg-row"><span>BRAKE</span><b>&darr; / S / LT</b></div>'
  + '<div class="lg-row"><span>AIRBRAKE</span><b>SHIFT / LB RB</b></div>'
  + '<div class="lg-row"><span>RESPAWN</span><b>R / X</b></div>'
  + '<div class="lg-row"><span>PAUSE</span><b>P / ESC / START</b></div>';

function setTxt(id, t) { const e = document.getElementById(id); if (e) e.textContent = t; }
function setHTML(id, h) { const e = document.getElementById(id); if (e) e.innerHTML = h; }

// Pilot portrait: initials sit behind, the photo covers them. Drop-in art lives
// at assets/pilots/<slug>.png OR .jpg — we try png, fall back to jpg, and if both
// 404 the <img> removes itself so the neon initials show through.
function pilotInitials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2); }
function pilotFaceInner(name) {
  const slug = pilotSlug(name);
  return `<span class="face-init">${pilotInitials(name)}</span>`
    + `<img src="assets/pilots/${slug}.png" alt=""`
    + ` onerror="if(this.dataset.jpg){this.remove()}else{this.dataset.jpg=1;this.src='assets/pilots/${slug}.jpg'}">`;
}
// "Your entry" loadout card shown on the race-setup screens so the chosen team /
// pilot / livery is unmistakable before you commit. GARAGE ▸ jumps to the garage.
function entryCardHTML() {
  const team = TEAMS[selection.team];
  const name = team.pilots[selection.pilot] || team.pilots[0];
  const lv = liveryOf(team, selection.livery);
  const acc = `#${hex(lv.accent)}`;
  return `<div class="entry-face" style="--pa:${acc}">${pilotFaceInner(name)}</div>`
    + `<div class="entry-meta">`
      + `<div class="entry-team">${team.fullName.toUpperCase()}</div>`
      + `<div class="entry-pilot" style="color:${acc}">${name}</div>`
      + `<div class="entry-tags"><span class="entry-livery"><i style="background:#${hex(lv.hull)}"></i><i style="background:#${hex(lv.accent)}"></i></span>`
        + `<span class="entry-ship">${team.name} SHIP</span></div>`
    + `</div>`
    + `<button class="entry-edit" onclick="document.querySelector('#nav-list .navitem[data-sec=garage]').click()">GARAGE &#9656;</button>`;
}
function volBar(n) { let c = ''; for (let i = 0; i < 10; i++) c += `<i class="${i < n ? 'on' : ''}"></i>`; return `<span class="bar vbar">${c}</span>`; }
function recordsSet() { return TRACKS.filter((t) => localStorage.getItem(`sv-best-${t.id}`)).length; }

function renderRecordsList() {
  const list = document.getElementById('rec-list'); if (!list) return;
  list.innerHTML = TRACKS.map((t, i) => {
    const lap = parseFloat(localStorage.getItem(`sv-best-${t.id}`) || 'NaN');
    return `<div class="rec-row" data-i="${i}"><span class="rt">${t.name}</span><span class="rv">${Number.isFinite(lap) ? fmt(lap) : '—'}</span></div>`;
  }).join('');
  menu.recCount = TRACKS.length;
  const sel = TRACKS[Math.min(menu.recSel, TRACKS.length - 1)];
  const lap = parseFloat(localStorage.getItem(`sv-best-${sel.id}`) || 'NaN');
  const race = parseFloat(localStorage.getItem(`sv-racebest-${sel.id}`) || 'NaN');
  setTxt('rec-detail', `${sel.name.toUpperCase()} — LAP ${Number.isFinite(lap) ? fmt(lap) : '—'} · RACE ${Number.isFinite(race) ? fmt(race) : '—'}`);
  menu._applyRecSel();
}

function renderControlsList() {
  const list = document.getElementById('ctl-list'); if (!list) return;
  const rows = REBINDABLE.map((a, i) => {
    const keys = input.bindingCodes(a.id).map(keyLabel).join(' / ') || '—';
    return `<div class="rec-row kb-row" data-i="${i}"><span class="rt">${a.label}</span><span class="leader"></span><span class="kb-key">${keys}</span></div>`;
  });
  rows.push(`<div class="rec-row kb-reset" data-i="${REBINDABLE.length}"><span class="rt">RESET TO DEFAULTS</span><span class="rv">&#8635;</span></div>`);
  list.innerHTML = rows.join('');
  menu.ctlCount = REBINDABLE.length + 1;
  menu._applyCtlSel();
}

function updateMenu() {
  const unlocked = unlockedClasses();
  const cls = CLASSES[selection.classIdx];
  const clsHTML = `<span style="color:#${hex(cls.color)}">${cls.name}</span> <small>${classKmh(cls, T.VMAX)} KM/H</small>`;
  const diff = DIFFICULTIES[selection.difficulty];
  const diffHTML = `<span style="color:#${hex(diff.color)}">${diff.name}</span> <small>${diff.tag}</small>`;
  const team = TEAMS[selection.team];

  for (const id of ['menu-class', 's-class', 't-class']) setHTML(id, clsHTML);
  for (const id of ['menu-difficulty', 's-diff']) setHTML(id, diffHTML);
  for (const id of ['menu-track', 't-track']) setTxt(id, trackDef.name);
  const lockEl = document.getElementById('menu-class-lock');
  const lockHint = selection.classIdx >= unlocked && unlocked < CLASSES.length - 1 ? `WIN ${CLASSES[unlocked].name} CUP` : '';
  if (lockEl) { lockEl.textContent = lockHint; lockEl.classList.toggle('hidden', !lockHint); }

  setTxt('menu-team', team.fullName.toUpperCase());
  setTxt('menu-blurb', team.blurb);
  setHTML('menu-stats', ['speed', 'thrust', 'handling'].map((k) => `<div class="stat"><label>${k.toUpperCase()}</label>${bar(team.bars[k])}</div>`).join(''));
  const liveries = team.liveries.slice(); if (liveryCount() > 2) liveries.push(CHAMPION_LIVERY);
  setHTML('menu-livery', liveries.map((lv, i) => `<span class="swatch-pair${i === selection.livery ? ' sel' : ''}${i === 2 ? ' champ' : ''}"><i style="background:#${hex(lv.hull)}"></i><i style="background:#${hex(lv.accent)}"></i></span>`).join(''));
  setTxt('menu-pilot', team.pilots[selection.pilot] || team.pilots[0]);
  // Driver dossier: a big hero portrait of the driver you ARE, plus a compact
  // teammate card that switches you to the other seat when clicked (reusing the
  // PILOT row's arrow so keyboard/gamepad/click all share one code path).
  const me = selection.pilot, mate = me === 0 ? 1 : 0;
  const heroName = team.pilots[me], mateName = team.pilots[mate];
  const heroAcc = `#${hex(team.liveries[me].accent)}`, mateAcc = `#${hex(team.liveries[mate].accent)}`;
  setHTML('pilot-roster',
    `<div class="pilot-hero" style="--pa:${heroAcc}">`
      + `<div class="hero-face">${pilotFaceInner(heroName)}</div>`
      + `<div class="hero-name">${heroName} <b>YOU</b></div>`
      + `<div class="pilot-bio">${PILOT_BIOS[heroName] || ''}</div>`
    + `</div>`
    + `<button class="pilot-mate" style="--pa:${mateAcc}" title="Switch to ${mateName}"`
      + ` onclick="document.querySelector('.section.garage [data-row=pilot] .arrow.r').click()">`
      + `<div class="mate-face">${pilotFaceInner(mateName)}</div>`
      + `<div class="mate-meta"><span class="mate-tag">TEAMMATE</span><span class="mate-name">${mateName}</span></div>`
      + `<span class="mate-swap">SWITCH &#9656;</span>`
    + `</button>`);

  setHTML('opt-music', volBar(audio.musicVolume));
  setHTML('opt-sfx', volBar(audio.sfxVolume));
  let dzi = DEADZONES.indexOf(input.deadzone); if (dzi < 0) dzi = 1;
  setTxt('opt-dz', DZ_LABEL[dzi]);
  setTxt('opt-rumble', input.rumbleOn ? 'ON' : 'OFF');
  setTxt('opt-fs', document.fullscreenElement ? 'ON' : 'OFF');
  setTxt('opt-motion', document.body.classList.contains('reduced-motion') ? 'REDUCED' : 'FULL');
  setTxt('opt-gp-state', input.gamepadActive ? 'CONNECTED' : 'NONE');
  const legend = document.getElementById('opt-legend');
  if (legend && !legend.dataset.filled) { legend.dataset.filled = '1'; legend.innerHTML = CONTROLS_LEGEND; }

  setTxt('ns-single', trackDef.name);
  setTxt('ns-garage', team.name);
  setTxt('ns-options', `MUSIC ${audio.musicVolume}`);
  setTxt('ns-records', `${recordsSet()}/${TRACKS.length} SET`);
  setTxt('ns-trophies', `${achievements.count()}/${achievements.total()}`);
  setHTML('status-tele', `CLASS &#9656; <b>${cls.name}</b> &middot; RIVALS &#9656; <b>${diff.name}</b> &middot; &#9672; ${achievements.count()}/${achievements.total()}`);

  const best = parseFloat(localStorage.getItem(bestKey()) || 'NaN');
  setTxt('menu-best', Number.isFinite(best) ? `RECORD ${fmt(best)}` : 'NO RECORD SET');
  setTxt('tt-best', Number.isFinite(best) ? `BEST LAP ${fmt(best)}` : 'NO RECORD — SET ONE');

  setTxt('ns-controls', 'REBIND');
  setHTML('cup-ladder', TRACKS.map((t, i) => `<div class="cup-rd${i === 0 ? ' lit' : ''}"><span class="rn">${i + 1}</span>${t.name}</div>`).join(''));
  const entryHTML = entryCardHTML();
  for (const id of ['champ-entry', 'single-entry', 'time-entry']) setHTML(id, entryHTML);
  renderRecordsList();
  renderControlsList();
  setTxt('tro-count', `${achievements.count()}/${achievements.total()} UNLOCKED`);
  const tierLabel = trophyTier === 'all' ? 'ALL' : TIERS[trophyTier].label;
  const tierColor = trophyTier === 'all' ? '#9fd8ff' : TIERS[trophyTier].color;
  setHTML('tro-tier', `<span style="color:${tierColor}">${tierLabel}</span>`);
  const gal = document.getElementById('tro-gallery'); if (gal) achievements.renderGallery(gal, trophyTier);

  drawThumb(document.getElementById('menu-thumb'), spline);
  drawProfile(document.getElementById('menu-profile'), spline);
}

// ------------------------------------------------------ result/standing views
function buildResultsView() {
  const rows = race.results(ship, playerFinishTime);
  if (selection.mode === 2) {
    const you = rows.find((r) => r.player);
    const best = parseFloat(localStorage.getItem(bestKey()) || 'Infinity');
    return {
      tag: trackDef.name.toUpperCase(),
      title: 'TIME TRIAL',
      rows: [{
        ...you,
        right1: fmt(playerFinishTime),
        right2: ship.bestLap && ship.bestLap <= best ? 'NEW RECORD' : `BEST LAP ${fmt(ship.bestLap)}`,
      }],
      footer: 'ENTER — AGAIN &nbsp;·&nbsp; ESC — MENU',
    };
  }
  // Real-racing reveal: only show drivers who have ACTUALLY crossed the line
  // (you + whoever has finished). The rest tick in as they finish — no
  // projected positions for cars still out on track.
  const finished = rows.filter((r) => r.time !== null);
  const total = rows.length;
  const fPlace = finished.findIndex((r) => r.player) + 1;
  const display = finished.map((r, i) => ({
    name: r.name, accent: r.accent, player: r.player,
    right1: fmt(r.time),
    ...(champ.active ? { right2: `+${CHAMP_PTS[i] ?? 0}` } : {}),
  }));
  const allIn = finished.length >= total;
  const advance = champ.active ? 'ENTER — STANDINGS' : 'ENTER — RACE AGAIN &nbsp;·&nbsp; ESC — MENU';
  return {
    tag: champ.active
      ? `CHAMPIONSHIP · ROUND ${champ.round + 1}/${TRACKS.length} · ${trackDef.name.toUpperCase()}`
      : trackDef.name.toUpperCase(),
    title: fPlace === 1 ? 'YOU WIN' : `P${fPlace}`,
    rows: display,
    footer: allIn ? advance : `${finished.length}/${total} ACROSS THE LINE &nbsp;·&nbsp; ${advance}`,
  };
}

function awardChampPoints() {
  const rows = race.results(ship, playerFinishTime);
  rows.forEach((r, i) => {
    const e = champ.points.get(r.id)
      || { name: r.name, accent: r.accent, player: r.player, pts: 0, wins: 0 };
    e.pts += CHAMP_PTS[i] ?? 0;
    if (i === 0) e.wins += 1;
    champ.points.set(r.id, e);
  });
}

function buildStandingsView() {
  const entries = [...champ.points.values()].sort((a, b) => b.pts - a.pts);
  const playerRank = entries.findIndex((e) => e.player) + 1;
  const last = champ.round >= TRACKS.length - 1;
  return {
    tag: last
      ? `FINAL STANDINGS · ${TRACKS.length} ROUNDS`
      : `STANDINGS AFTER ROUND ${champ.round + 1}/${TRACKS.length}`,
    title: last
      ? (playerRank === 1 ? 'CHAMPION' : `P${playerRank} OVERALL`)
      : 'CHAMPIONSHIP',
    champ: last && playerRank === 1,
    medals: true,
    rows: entries.map((e) => ({
      name: e.name, accent: e.accent, player: e.player,
      right2: e.wins > 0 ? `${e.wins}× WIN` : '',
      right1: `${e.pts} PTS`,
    })),
    footer: last
      ? (champ.unlockMsg ? `${champ.unlockMsg} — ENTER: MENU` : 'ENTER — MENU')
      : `ENTER — ROUND ${champ.round + 2}/${TRACKS.length}`,
  };
}

// Winning a cup unlocks the next speed class; winning Phantom unlocks the
// prestige champion livery. Returns a message for the finale board, or null
// if there was nothing left to unlock.
function processUnlock(classWon) {
  if (classWon < CLASSES.length - 1) {
    const have = unlockedClasses();
    if (classWon + 1 > have) {
      localStorage.setItem('sv-unlocked', String(classWon + 1));
      return `${CLASSES[classWon + 1].name} CLASS UNLOCKED`;
    }
  } else if (!championUnlocked()) {
    localStorage.setItem('sv-champion', '1');
    return 'CHAMPION LIVERY UNLOCKED';
  }
  return null;
}

// Confetti + fanfare when the title is yours.
function celebrateChampion() {
  const colors = [0x00f0ff, 0xff2ec8, 0xffe066, 0x3fae6b, 0xffffff];
  for (let i = 0; i < 5; i++) {
    _v.copy(shipVisual.root.position);
    _v.x += (Math.random() - 0.5) * 10;
    _v.y += 2 + Math.random() * 4;
    _v.z += (Math.random() - 0.5) * 10;
    _vel.set(0, 9, 0);
    sparks.spawn(_v, _vel, 14, 24,
      new THREE.Color(colors[i]), new THREE.Color(colors[(i + 2) % 5]));
  }
  audio.championFanfare();
  juice.addTrauma(0.15);
}

// Top-three standings as podium entries, each with a ship variant to render.
// The player gets their real hull/livery; rivals get their accent on a clean
// hull so the three ships read as distinct teams.
function podiumEntries() {
  const sorted = [...champ.points.values()].sort((a, b) => b.pts - a.pts);
  const playerRank = sorted.findIndex((e) => e.player) + 1;
  const team = TEAMS[selection.team];
  const playerVariant = { ...team.variant, ...liveryOf(team, selection.livery) };
  const top3 = sorted.slice(0, 3).map((e) => ({
    name: e.name,
    player: e.player,
    variant: e.player
      ? playerVariant
      : { scaleX: 1, scaleZ: 1, finScale: 1, bellScale: 1, hull: 0xd8d4e8, accent: e.accent },
  }));
  return { top3, playerRank };
}

const podiumTitleEl = document.getElementById('podium-title');
const podiumSceneEl = document.getElementById('podium-scene');

function enterPodium() {
  const { top3, playerRank } = podiumEntries();
  state = 'podium';
  podiumScene.show(top3);
  podiumSceneEl.classList.remove('hidden');
  podiumTitleEl.className = playerRank === 1 ? 'champ' : '';
  podiumTitleEl.querySelector('.pt-tag').textContent =
    `CHAMPIONSHIP · ${CLASSES[champ.classIndex].name} CLASS`;
  podiumTitleEl.querySelector('.pt-title').textContent =
    playerRank === 1 ? 'CHAMPION' : `P${playerRank} OVERALL`;
  podiumTitleEl.querySelector('.pt-sub').textContent = 'ENTER — STANDINGS';
  podiumTitleEl.classList.remove('hidden');
  audio.championFanfare();
  if (playerRank <= 3) juice.addTrauma(0.12);
}

function exitPodium() {
  podiumScene.hide();
  podiumSceneEl.classList.add('hidden');
  podiumTitleEl.classList.add('hidden');
}

// Spark hookups need world positions — resolved here, not in physics.
const _f = makeFrame();
const _v = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _dots = [];
const _dustA = new THREE.Color(0x9a8a6a); // ground kick-up tint (per world)
const _dustB = new THREE.Color(0x33271a);
juice.on('wallHit', ({ side, severity }) => {
  spline.frameAt(ship.s, _f);
  _v.copy(_f.pos).addScaledVector(_f.R, side * (_f.width - T.WALL_MARGIN + 0.6)).addScaledVector(_f.U, 0.5);
  _vel.copy(_f.T).multiplyScalar(ship.v * 0.5);
  sparks.spawn(_v, _vel, 14 + severity * 10, T.SPARK_HIT_COUNT, undefined, undefined, undefined, _f.pos.y);
  if (state === 'race') { tally.wallHits++; input.rumble(Math.min(1, 0.45 + severity * 0.5), 220); }
});
let scrapeAcc = 0;
juice.on('scrape', () => { scrapeAcc += T.SPARK_SCRAPE_RATE * FIXED_DT; });
const _boostColA = new THREE.Color(T.COL.ENGINE);
const _boostColB = new THREE.Color(0xffffff);
juice.on('boost', ({ pad } = {}) => {
  _vel.set(0, 1.5, 0);
  sparks.spawn(shipVisual.root.position, _vel, 9, 26, _boostColA, _boostColB, undefined, shipVisual.shadow.position.y);
  if (state === 'race') input.rumble(0.5, 200);
  if (state === 'race' && pad >= 0) {
    achievements.unlock('first_boost');
    if (++tally.pads >= 3) achievements.unlock('pad_chain');
  }
});
juice.on('miniboost', () => {
  if (state === 'race') achievements.unlock('first_drift');
});
const _bumpColA = new THREE.Color(0xdfe8ff);
const _bumpColB = new THREE.Color(0x8fa0c0);
juice.on('bump', ({ severity = 0.5 } = {}) => {
  _vel.set(0, 2, 0);
  sparks.spawn(shipVisual.root.position, _vel, 7, 8 + Math.round(severity * 14), _bumpColA, _bumpColB, undefined, shipVisual.shadow.position.y);
  if (state === 'race') { tally.contacts++; input.rumble(0.3 + severity * 0.3, 140); }
});

// ------------------------------------------------------------------ state
let state = 'intro'; // intro | attract | countdown | race | finished
const overlayEl = document.getElementById('overlay');

// Replay the card/strip entrance animation (intro→menu, and returning to menu).
function revealMenu() {
  overlayEl.classList.remove('anim');
  void overlayEl.offsetWidth; // restart the CSS animations
  overlayEl.classList.add('anim');
}

// Cinematic attract camera: a slow orbit around the parked ship, behind the
// menu — the console "front-end is alive" feel. Overrides the chase rig.
const _attractLook = new THREE.Vector3();
function attractCamera(t) {
  const c = shipVisual.root.position;
  const a = t * 0.16;
  camera.position.set(
    c.x + Math.cos(a) * 9.5,
    c.y + 3.4 + Math.sin(t * 0.4) * 0.6,
    c.z + Math.sin(a) * 9.5,
  );
  camera.up.set(0, 1, 0);
  _attractLook.set(c.x, c.y + 0.8, c.z);
  camera.lookAt(_attractLook);
  if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
}
let countdownT = 0;
let countdownIntro = 0;   // cinematic camera-sweep lead-in before the 3-2-1
let raceTime = 0;
let launchHold = 0;       // throttle held during countdown — launch boost timing
let launchMsg = null;     // PERFECT START / BOOST START, shown after the START word
let launchMsgT = 0;
let recordsOpen = false;
let trophiesOpen = false;
const trophiesEl = document.getElementById('trophies');
let playerFinishTime = null; // frozen at the line; the live results reuse it
let resultsRefreshT = 0;
let lastFinCount = -1;
let debugCam = false;
let paused = false;

function startCountdown() {
  ship.reset(12); // a few meters past the gantry so it doesn't sit over the camera
  ship.lap = 1;
  rig.reset(ship);
  rig.playIntro(ship, 1.1); // cinematic sweep down to the ship before the lights
  race.grid();
  juice.trauma = 0; juice.boostFactor = 0;
  state = 'countdown';
  countdownT = 3.2;
  countdownIntro = 1.1;     // hold the 3-2-1 (and the launch window) until the sweep lands
  raceTime = 0;
  playerFinishTime = null;
  finishedView = 'race';
  lastCountN = -1;
  launchHold = 0;
  launchMsg = null;
  recordsOpen = false;
  trophiesOpen = false; trophiesEl.classList.add('hidden');
  tally.wallHits = 0; tally.contacts = 0; tally.perfectStart = false; tally.pads = 0;
  lastPlace = 0;
  audio.playMusic(theme.music); // world music starts now, crossfading from the menu
  input.clearPressed(); // stale edges from the previous state must not fire
  hud.showOverlay(false);
  hud.hideResults();
  hud.clearPosition();
  hud.countdown(null);
  const clsName = CLASSES[selection.classIdx].name;
  hud.setSub(champ.active
    ? `${clsName} CUP · ROUND ${champ.round + 1}/${TRACKS.length} · ${trackDef.name.toUpperCase()}`
    : selection.mode === 2
      ? `TIME TRIAL · ${clsName} · ${trackDef.name.toUpperCase()}`
      : `${clsName} · ${trackDef.name.toUpperCase()}`);
}
let lastCountN = -1;

juice.on('lap', ({ lap, time }) => {
  // Sanity floor so debug teleports/glitches can never write a record.
  const prev = parseFloat(localStorage.getItem(bestKey()) || 'Infinity');
  if (time > 20 && time < prev) {
    localStorage.setItem(bestKey(), time.toFixed(3));
    if (lap > 1) { // not the rolling-start opening lap
      achievements.banner('NEW LAP RECORD', `${trackDef.name} · ${fmt(time)}`, '#7df9ff', '⏱️');
      achievements.unlock('record');
      const heldRecords = TRACKS.filter(
        (t) => Number.isFinite(parseFloat(localStorage.getItem(`sv-best-${t.id}`)))).length;
      if (heldRecords >= 3) achievements.unlock('record_3');
      if (heldRecords >= TRACKS.length) achievements.unlock('all_records');
    }
  }
  // Clearing a loop track's lap counts as clearing a loop.
  if (lap > 1 && (trackDef.id === 'coral-keys' || trackDef.id === 'skyline-rush')) {
    achievements.unlock('loop');
    if (achievements.addToSet('loopsCleared', trackDef.id) >= 2) achievements.unlock('loop_master');
  }
  if (lap === TOTAL_LAPS) {
    hud.flashCenter('FINAL LAP', 1300);
  } else if (lap > TOTAL_LAPS) {
    state = 'finished';
    playerFinishTime = race.clock;
    finishedView = 'race';
    // Best full-race time (vs the field — not time trial), sanity-floored.
    if (selection.mode !== 2 && playerFinishTime > 60) {
      const rk = `sv-racebest-${trackDef.id}`;
      const rPrev = parseFloat(localStorage.getItem(rk) || 'Infinity');
      if (playerFinishTime < rPrev) {
        localStorage.setItem(rk, playerFinishTime.toFixed(3));
        achievements.banner('NEW RACE RECORD', `${trackDef.name} · ${fmt(playerFinishTime)}`, '#ff2ec8', '🏁');
      }
    }
    evaluateFinishTrophies();
    hud.setCenter(null); // the board tells the story — nothing may overlap it
    hud.setSub(null);
    const view = buildResultsView();
    hud.showResults(view);
    resultsRefreshT = 0;
    audio.finishFanfare(view.title === 'YOU WIN' || selection.mode === 2);
  }
});

// Trophies decided at the finish line — place, cleanliness, class, career.
function evaluateFinishTrophies() {
  const place = race.positionOf(ship);
  const won = place === 1 && selection.mode !== 2; // time trial has no field
  achievements.unlock('first_race');
  if (achievements.bump('races') >= 3) achievements.unlock('race_3');
  if (selection.mode === 2) achievements.unlock('tt_play');
  if (achievements.addToSet('trackSet', trackDef.id) >= TRACKS.length) achievements.unlock('all_tracks');
  if (achievements.addToSet('teamSet', selection.team) >= TEAMS.length) achievements.unlock('all_teams');
  if (tally.perfectStart) achievements.unlock('perfect_start');
  if (won) {
    achievements.unlock('first_win');
    const wins = achievements.bump('wins');
    if (wins >= 5) achievements.unlock('wins_5');
    if (wins >= 10) achievements.unlock('wins_10');
    if (tally.wallHits === 0) {
      achievements.unlock('clean_win');
      if (achievements.bump('cleanWins') >= 3) achievements.unlock('clean_3');
    }
    if (tally.wallHits === 0 && tally.contacts === 0) achievements.unlock('untouchable');
    if (tally.wallHits > 0) achievements.unlock('comeback');
    if (selection.classIdx === 1) achievements.unlock('surge_win');
    if (selection.classIdx === 2) achievements.unlock('overdrive_win');
  }
}

// ------------------------------------------------------------------- loop
let last = performance.now();
let accumulator = 0;
let statT = 0, frames = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const realDt = Math.min((now - last) / 1000, 0.05);
  last = now;

  input.update(realDt);
  handleKeys();
  if (paused) return;
  if (state === 'podium') { podiumScene.update(realDt); return; }

  // State machine.
  let simInput = NULL_INPUT;
  if (state === 'countdown') {
    if (countdownIntro > 0) {
      // The cinematic sweep plays (rig.playIntro); the lights and the launch
      // window wait until it lands, and the music is already fading up.
      countdownIntro -= realDt;
    } else {
      countdownT -= realDt;
      const n = Math.min(3, Math.ceil(countdownT));
      // Launch timing: press and hold the throttle late in the countdown.
      if (input.throttle > 0.5) launchHold += realDt; else launchHold = 0;
      if (countdownT <= 0) {
        state = 'race';
        ship.lapTime = 0; // the clock starts at GO, not at countdown
        hud.countdown(0); // START
        juice.addTrauma(0.2);
        audio.count(0);
        hud.setSub(null);
        // Launch boost: nail the window and you fly off the line.
        if (launchHold > 0.05 && launchHold <= 0.55) {
          ship.boostTimer = 1.5;
          juice.emit('boost', { pad: -1 });
          launchMsg = 'PERFECT START'; launchMsgT = 0.8; tally.perfectStart = true;
        } else if (launchHold > 0.55 && launchHold <= 1.3) {
          ship.boostTimer = 0.7;
          juice.emit('miniboost', {});
          launchMsg = 'BOOST START'; launchMsgT = 0.8;
        } // held the whole countdown = flooded engines: nothing.
        race.launchBoosts();
      } else if (n !== lastCountN) {
        lastCountN = n;
        hud.countdown(n);
        audio.count(n);
      }
    }
  } else if (state === 'race') {
    raceTime += realDt;
    simInput = input;
    // Guarantee: the round/track banner can never survive into racing, no
    // matter which path entered this state.
    if (hud.subOn) hud.setSub(null);
    // Live-sampled trophies.
    if (ship.speedNorm >= 0.99) achievements.unlock('top_speed');
    if (input.airbrake && ship.v > 8) achievements.unlock('airbrake');
    if (selection.mode !== 2) {
      const pos = race.positionOf(ship);
      if (lastPlace > 0 && pos < lastPlace) achievements.unlock('overtake');
      lastPlace = pos;
    }
    if (launchMsg) {
      launchMsgT -= realDt;
      if (launchMsgT <= 0) { hud.flashCenter(launchMsg, 1100); launchMsg = null; }
    }
  } else if (state === 'finished') {
    simInput = NULL_INPUT; // coast over the line
    // The rest of the field is still racing — refresh the board the moment
    // anyone crosses (and on a slow heartbeat for the progress ordering).
    resultsRefreshT += realDt;
    const finishedNow = race.racers.filter((r) => r.finishTime !== null).length;
    if (finishedView === 'race' && (finishedNow !== lastFinCount || resultsRefreshT >= 0.5)) {
      lastFinCount = finishedNow;
      resultsRefreshT = 0;
      hud.showResults(buildResultsView());
    }
  }

  juice.update(realDt, ship.boosting);
  const dt = realDt * juice.timescale; // hitstop slows sim AND visuals

  // Fixed-step physics — player and the AI field in lockstep.
  if (state !== 'attract') {
    accumulator += dt;
    let guard = 8;
    while (accumulator >= FIXED_DT && guard-- > 0) {
      race.computeDraft(ship); // slipstream targets from current positions
      ship.step(FIXED_DT, simInput);
      race.stepFixed(FIXED_DT, state === 'race' || state === 'finished');
      race.interact(ship, FIXED_DT);
      accumulator -= FIXED_DT;
    }
  }

  // Scrape sparks, rate-limited.
  if (scrapeAcc >= 1) {
    const n = Math.floor(scrapeAcc);
    scrapeAcc -= n;
    spline.frameAt(ship.s, _f);
    const side = Math.sign(ship.d) || 1;
    _v.copy(_f.pos).addScaledVector(_f.R, side * (_f.width - T.WALL_MARGIN + 0.55)).addScaledVector(_f.U, 0.35);
    _vel.copy(_f.T).multiplyScalar(ship.v * 0.7);
    sparks.spawn(_v, _vel, 6, n, undefined, undefined, undefined, _f.pos.y);
  }

  // Visuals.
  const sn = ship.speedNorm;
  shipVisual.update(dt, ship, state === 'race' ? input : NULL_INPUT, juice.boostFactor);
  race.updateVisuals(dt);
  trails.push(0, shipVisual.getNozzleWorld(0, _v));
  trails.push(1, shipVisual.getNozzleWorld(1, _v));
  // Ground dust/spray kicked up from the surface behind the ship at speed.
  if (state === 'race' && sn > 0.28) {
    _v.copy(shipVisual.shadow.position);          // sits on the track surface
    _vel.set(0, 0.5 + sn * 0.6, 0);               // a soft upward billow
    sparks.spawn(_v, _vel, 2.0 + sn * 1.8, 2, _dustA, _dustB);
  }
  rig.update(dt, ship, state === 'race' ? input : NULL_INPUT, juice,
    input.airbrake && state === 'race' && ship.v > 5);
  if (debugCam) applyDebugCam();
  speedLines.update(dt, ship.v, sn, juice.boostFactor, shipVisual.root.position);
  sparks.update(dt);
  trails.update(dt, camera, juice.boostFactor, sn);
  track.update(now / 1000, sn);
  const raceProgress = state === 'race'
    ? Math.max(0, Math.min(1, ((ship.lap - 1) + ship.s / spline.length) / TOTAL_LAPS))
    : 0;
  scenery.update(now / 1000, camera.position, raceProgress);

  // Fog breathes with speed; boost closes the world into a tunnel.
  if (!debugCam) {
    scene.fog.far = T.FOG_FAR - T.FOG_SPEED_PULL * sn - T.FOG_BOOST_PULL * juice.boostFactor;
  }

  // Keep the gameplay HUD off the title/menu screens (console front-end feel).
  document.body.classList.toggle('in-menu', state === 'intro' || state === 'attract');
  pauseBtn.classList.toggle('hidden', !(state === 'race' && !paused));
  // Slipstream cue fades in with the draft (readable feedback for the tow).
  slipEl.style.opacity = state === 'race' ? Math.max(0, Math.min(1, (ship.draft - 0.25) / 0.4)) : 0;
  hud.update(realDt, ship, TOTAL_LAPS);
  audio.updateEngine(realDt, sn, state === 'race' ? input.throttle : 0,
    juice.boostFactor, state !== 'attract');
  audio.updateOpponentEngines(realDt,
    state === 'race' ? race.racers.map((r) => r.phys) : null,
    ship.s, spline.length, state === 'race');
  if (state === 'attract' || state === 'intro') {
    if (state === 'attract' && menu.sec === 'garage' && podium.W < 120) podium.resize();
    podium.update(realDt);
    if (audio.ctx && audio._wantKey !== 'menu') audio.playMusic('menu');
    if (!debugCam) attractCamera(now / 1000);
  }
  if (state === 'race' && selection.mode !== 2) hud.setPosition(race.positionOf(ship), 8);
  minimap.update(shipVisual.root.position, ship.boosting, now / 1000, race.minimapDots(_dots));
  postfx.update(sn, juice, theme && theme.id === 'desert' ? 0.85 : 0, now / 1000);
  postfx.render();

  // Stats readout, 2x/s. autoReset is off so the composer's passes accumulate.
  frames++;
  statT += realDt;
  if (statT >= 0.5) {
    hud.setStats(`${Math.round(frames / statT)} fps · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`);
    statT = 0; frames = 0;
  }
  renderer.info.reset();
}

// Reduced-motion: gates the heavy menu effects. Defaults to the OS preference;
// the OPTIONS toggle flips it explicitly.
function applyReducedMotion(toggle) {
  const cur = localStorage.getItem('sv-reducedmotion');
  let on;
  if (toggle) { on = !(cur === '1'); localStorage.setItem('sv-reducedmotion', on ? '1' : '0'); }
  else on = cur === '1' || (cur === null && matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.body.classList.toggle('reduced-motion', on);
  return on;
}

// Change a menu row's value by dir (±1) — shared by keyboard, gamepad, clicks.
function editRow(row, dir) {
  const n = (mod, cur, d) => ((cur + d) % mod + mod) % mod;
  if (row === 'track') {
    if (selection.mode !== 0) { trackIndex = n(TRACKS.length, trackIndex, dir); buildWorld(trackIndex); }
  } else if (row === 'class') {
    selection.classIdx = Math.max(0, Math.min(unlockedClasses(), selection.classIdx + dir));
    buildField();
  } else if (row === 'difficulty') {
    selection.difficulty = n(DIFFICULTIES.length, selection.difficulty, dir);
    buildField();
  } else if (row === 'team') {
    selection.team = n(TEAMS.length, selection.team, dir); buildField();
  } else if (row === 'livery') {
    selection.livery = n(liveryCount(), selection.livery, dir); buildField();
  } else if (row === 'pilot') {
    selection.pilot = n(2, selection.pilot, dir);   // which of the team's 2 drivers you are
    selection.livery = selection.pilot;             // that driver's signature livery follows
    buildField();                                   // you now occupy that driver's seat
  } else if (row === 'music') {
    audio.setMusicVolume(audio.musicVolume + dir);
  } else if (row === 'sfx') {
    audio.setSfxVolume(audio.sfxVolume + dir);
  } else if (row === 'deadzone') {
    let i = DEADZONES.indexOf(input.deadzone); if (i < 0) i = 1;
    input.setDeadzone(DEADZONES[Math.max(0, Math.min(DEADZONES.length - 1, i + dir))]);
  } else if (row === 'rumble') {
    input.setRumble(!input.rumbleOn); if (input.rumbleOn) input.rumble(0.6, 200);
  } else if (row === 'fullscreen') {
    toggleFullscreen();
  } else if (row === 'motion') {
    applyReducedMotion(true);
  } else if (row === 'tier') {
    trophyTier = TROPHY_FILTERS[n(TROPHY_FILTERS.length, TROPHY_FILTERS.indexOf(trophyTier), dir)];
  }
  updateMenu();
}

// Start the race for the current selection (mode set on section entry).
function startRace() {
  if (selection.mode === 0) {
    champ.active = true; champ.round = 0; champ.classIndex = selection.classIdx;
    champ.unlockMsg = null; champ.points.clear();
    achievements.unlock('champ_play');
    if (trackIndex !== 0) { trackIndex = 0; buildWorld(0); }
  } else {
    champ.active = false;
  }
  hud.setCenter(null);
  startCountdown();
}

// Close any armed key-capture (called when leaving / re-entering CONTROLS).
function closeRebind() {
  input.cancelCapture();
  const cap = document.getElementById('rebind-capture'); if (cap) cap.classList.add('hidden');
  document.querySelectorAll('#ctl-list .kb-row.binding').forEach((r) => r.classList.remove('binding'));
}

// Arm a key capture for the action at `idx` (or reset, on the last row).
function beginRebind(idx) {
  closeRebind();
  if (idx >= REBINDABLE.length) {        // the RESET TO DEFAULTS row
    input.resetBindings(); renderControlsList(); audio.uiSelect();
    return;
  }
  const action = REBINDABLE[idx];
  setTxt('rebind-action', `BIND: ${action.label}`);
  document.getElementById('rebind-capture')?.classList.remove('hidden');
  const rows = document.querySelectorAll('#ctl-list .kb-row');
  rows.forEach((r, i) => r.classList.toggle('binding', i === idx));
  input.beginCapture((code) => {
    closeRebind();
    if (code === 'Escape') { audio.uiMove(); return; }       // silent cancel
    if (input.isReserved(code)) { audio.uiMove(); renderControlsList(); return; }
    input.setBinding(action.id, code);                       // clears it elsewhere
    audio.uiSelect();
    renderControlsList();
  });
}

// Entering a section sets the mode (race sections) and resizes the garage stage.
function onSectionEnter(sec) {
  closeRebind();
  if (sec === 'championship') {
    selection.mode = 0;
    if (trackIndex !== 0) { trackIndex = 0; buildWorld(0); } else buildField();
  } else if (sec === 'single') {
    selection.mode = 1; buildField();
  } else if (sec === 'time') {
    selection.mode = 2; buildField();
  } else if (sec === 'garage') {
    podium.resize();
  }
  if (sec === 'championship' || sec === 'single' || sec === 'time') {
    localStorage.setItem('sv-mode', String(selection.mode));
    audio.prewarmMusic(theme.music); // head-start the decode so GO crossfades cleanly
  }
  updateMenu();
}

function activateRow(row) {
  audio.uiSelect();
  if (row === 'go') {
    const sec = menu.sec;
    selection.mode = sec === 'championship' ? 0 : sec === 'single' ? 1 : 2;
    localStorage.setItem('sv-mode', String(selection.mode));
    startRace();
    return;
  }
  if (row === 'reclist') return;  // the detail already reflects the selection
  if (row === 'ctllist') { beginRebind(menu.ctlSel); return; }
  editRow(row, 1);                // toggles (rumble/fullscreen/motion) flip on ENTER too
}

// Route a key through the menu state machine to the matching action.
function applyMenuKey(code) {
  const act = menu.handleKey(code);
  if (!act) return;
  switch (act.type) {
    case 'navmove': case 'rowmove': audio.uiMove(); break;
    case 'recmove': audio.uiMove(); renderRecordsList(); break;
    case 'ctlmove': audio.uiMove(); renderControlsList(); break;
    case 'enter': audio.uiSelect(); onSectionEnter(act.sec); break;
    case 'edit': editRow(act.row, act.dir); audio.uiMove(); break;
    case 'activate': activateRow(act.row); break;
    case 'back': audio.uiMove(); break;
    default: break;
  }
}

// ---- pause menu -----------------------------------------------------------
function openPause() {
  paused = true;
  document.body.classList.add('paused');
  audio.setPaused(true);
  pauseMenu.open(audio.sfxVolume, !!document.fullscreenElement);
  input.clearPressed();
  audio.uiSelect();
}

function closePause() {
  paused = false;
  document.body.classList.remove('paused');
  pauseMenu.close();
  input.clearPressed();
}

function resumeRace() {
  closePause();
  audio.setPaused(false);
  audio.uiMove();
}

function confirmPause() {
  if (pauseMenu.inOptions) {
    if (pauseMenu.currentOptRow() === 'fullscreen') { toggleFullscreen(); audio.uiSelect(); }
    return;
  }
  const row = pauseMenu.currentRow();
  audio.uiSelect();
  if (row === 'resume') resumeRace();
  else if (row === 'restart') { closePause(); audio.setPaused(false); startCountdown(); }
  else if (row === 'options') pauseMenu.inOptions = true;
  else if (row === 'quit') { closePause(); audio.setPaused(false); onEscape(); }
}

// Esc steps back: out of Options to the list, then out of the list to the race.
function backPause() {
  if (pauseMenu.inOptions) { pauseMenu.inOptions = false; audio.uiMove(); }
  else resumeRace();
}

function applyPauseKeys() {
  for (const [code, dir] of [['ArrowUp', -1], ['KeyW', -1], ['ArrowDown', 1], ['KeyS', 1]]) {
    if (input.consume(code)) { pauseMenu.moveFocus(dir); audio.uiMove(); }
  }
  if (pauseMenu.inOptions) {
    for (const [code, dir] of [['ArrowLeft', -1], ['KeyA', -1], ['ArrowRight', 1], ['KeyD', 1]]) {
      if (input.consume(code) && pauseMenu.currentOptRow() === 'audio') {
        audio.setVolume(audio.sfxVolume + dir); audio.uiMove();
      }
    }
  }
  if (input.consumeAction('pause')) resumeRace();  // the pause key toggles off
  else if (input.consume('Enter')) confirmPause();
  // Backspace is the reliable "back" — Escape is hijacked by the browser to
  // leave fullscreen, so it can't be depended on (gamepad B maps to Escape too).
  else if (input.consume('Backspace') || input.consume('Escape')) backPause();
  if (paused) pauseMenu.render(audio.sfxVolume, !!document.fullscreenElement);
}

function handleKeys() {
  // Title gate: Enter/Space reveals the menu, console-style.
  if (state === 'intro') {
    if (input.consume('Enter') || input.consume('Space')) {
      state = 'attract';
      overlayEl.classList.remove('intro');
      revealMenu();
      onSectionEnter(menu.sec); // size the garage stage / sync the landed section
      updateMenu();
      audio.uiSelect();
    }
    return;
  }

  // The pause menu owns all input while open; otherwise Esc or P opens it mid-race.
  if (paused) { applyPauseKeys(); return; }
  if (state === 'race' && (input.consume('Escape') || input.consumeAction('pause'))) {
    openPause();
    return;
  }

  if (state === 'attract') {
    // The console menu owns all attract input (nav up/down, enter, edit, back).
    for (const code of ['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'Enter', 'Backspace', 'Escape']) {
      if (input.consume(code)) applyMenuKey(code);
    }
    return;
  }
  if (input.consume('Enter')) onEnter();
  if (input.consume('Escape') && state !== 'attract') onEscape();
  if (input.consumeAction('respawn') && state === 'race') {
    ship.d = 0; ship.vd = 0; ship.v = Math.min(ship.v, 15);
    ship.boostTimer = 0;
    juice.hitstopT = 0;
    juice.trauma = 0;
    rig.reset(ship);
  }
  if (input.consume('KeyM')) debugCam = !debugCam;
}

// Records / trophies open as menu actions (confirm button), not key shortcuts.
function closePanels() {
  if (recordsOpen) { recordsOpen = false; hud.hideResults(); }
  if (trophiesOpen) { trophiesOpen = false; trophiesEl.classList.add('hidden'); }
}
function toggleRecords() {
  if (trophiesOpen) { trophiesOpen = false; trophiesEl.classList.add('hidden'); }
  recordsOpen = !recordsOpen;
  if (recordsOpen) showRecordsBoard(); else hud.hideResults();
}
function toggleTrophies() {
  if (recordsOpen) { recordsOpen = false; hud.hideResults(); }
  trophiesOpen = !trophiesOpen;
  if (trophiesOpen) {
    achievements.renderGallery(trophiesEl);
    trophiesEl.classList.remove('hidden', 'panel-in');
    void trophiesEl.offsetWidth;
    trophiesEl.classList.add('panel-in');
  } else trophiesEl.classList.add('hidden');
}

function showRecordsBoard() {
  const rows = TRACKS.map((t) => {
    const lap = parseFloat(localStorage.getItem(`sv-best-${t.id}`) || 'NaN');
    const raceT = parseFloat(localStorage.getItem(`sv-racebest-${t.id}`) || 'NaN');
    const horizon = THEMES[t.world].fog;
    return {
      name: t.name,
      accent: `#${horizon.toString(16).padStart(6, '0')}`,
      player: false,
      right2: Number.isFinite(lap) ? `LAP ${fmt(lap)}` : 'LAP —',
      right1: Number.isFinite(raceT) ? `RACE ${fmt(raceT)}` : 'RACE —',
    };
  });
  hud.showResults({
    tag: 'BEST LAP · BEST FULL RACE',
    title: 'RECORDS',
    rows,
    footer: 'R — CLOSE',
  });
}

function onEnter() {
  if (state === 'podium') {
    audio.uiSelect();
    exitPodium();
    state = 'finished';
    finishedView = 'standings';
    hud.showResults(buildStandingsView());
    return;
  }
  if (state === 'attract') {
    audio.uiSelect();
    startRace();
  } else if (state === 'finished') {
    audio.uiSelect();
    if (champ.active && finishedView === 'race') {
      awardChampPoints();
      finishedView = 'standings';
      const last = champ.round >= TRACKS.length - 1;
      const won = last && [...champ.points.values()]
        .sort((a, b) => b.pts - a.pts).findIndex((e) => e.player) === 0;
      if (won) {
        champ.unlockMsg = processUnlock(champ.classIndex);
        achievements.unlock('cup');
        if (champ.classIndex === 2) achievements.unlock('overdrive_cup');
        const me = [...champ.points.values()].find((e) => e.player);
        if (me && me.wins >= TRACKS.length) achievements.unlock('sweep');
      }
      if (last) {
        enterPodium();           // 3D ceremony first; the board follows on confirm
      } else {
        hud.showResults(buildStandingsView());
      }
    } else if (champ.active && champ.round < TRACKS.length - 1) {
      champ.round += 1;
      trackIndex = champ.round;
      buildWorld(trackIndex);
      hud.setCenter(null);
      startCountdown();
    } else if (champ.active) {
      champ.active = false; // championship complete — back to the menu
      backToMenu();
    } else {
      hud.setCenter(null);
      startCountdown();
    }
  }
}

function onEscape() {
  champ.active = false;
  backToMenu();
}

function backToMenu() {
  exitPodium();
  pauseMenu.close();
  document.body.classList.remove('paused');
  state = 'attract';
  paused = false;
  hud.hideResults();
  hud.setCenter(null);
  hud.setSub(null);
  hud.countdown(null);
  hud.showOverlay(true);
  audio.stopMusic();
  audio.setPaused(false);
  // In championship the menu always previews round 1 — keep the world in
  // sync with the locked "ROUND 1/6" label.
  if (selection.mode === 0 && trackIndex !== 0) {
    trackIndex = 0;
    buildWorld(0); // rebuilds the field too
  } else {
    buildField(); // park a fresh grid behind the menu
  }
  rig.reset(ship);
  input.clearPressed();
  updateMenu();
  revealMenu();
}

function applyDebugCam() {
  camera.position.set(debugView.x, debugView.h, debugView.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(debugView.x, 0, debugView.z);
  if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  scene.fog.far = 6000; // see the whole layout, not the haze
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  postfx.setSize(innerWidth, innerHeight);
});

// Fullscreen: on-screen button + F key. Both are genuine user gestures, which
// requestFullscreen requires — a gamepad button can't grant activation, so it
// is intentionally NOT bound here. Entering/leaving fires a resize, so the
// renderer and composer rescale through the handler above.
const fsBtn = document.getElementById('fs-btn');
const pauseBtn = document.getElementById('pause-btn');
const slipEl = document.getElementById('slipstream');
function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }
}
fsBtn.addEventListener('click', () => { toggleFullscreen(); fsBtn.blur(); });
addEventListener('keydown', (e) => {
  if (input.capturing()) return;   // a rebind capture owns the next key
  if (e.code === 'KeyF' && !e.repeat) toggleFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  fsBtn.title = document.fullscreenElement ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
});

// Pointer support: every menu/pause action is also a click target, so nothing
// is keyboard-only. Clicks reuse the exact same actions as the keys/gamepad.
function wireClicks() {
  const fsOn = () => !!document.fullscreenElement;
  // Left-nav clicks: jump straight into a section.
  document.querySelectorAll('#nav-list .navitem').forEach((b) => {
    b.addEventListener('click', () => { audio.uiSelect(); menu.enterSection(b.dataset.sec); onSectionEnter(b.dataset.sec); });
  });
  // Control rows: arrows edit, the row body focuses, GO buttons launch.
  document.querySelectorAll('#bay [data-row]').forEach((rowEl) => {
    const sec = rowEl.closest('.section').dataset.sec;
    const row = rowEl.dataset.row;
    const focus = () => menu.focusRow(sec, row);
    const lEl = rowEl.querySelector('.arrow.l');
    const rEl = rowEl.querySelector('.arrow.r');
    if (lEl) lEl.addEventListener('click', (e) => { e.stopPropagation(); focus(); editRow(row, -1); audio.uiMove(); });
    if (rEl) rEl.addEventListener('click', (e) => { e.stopPropagation(); focus(); editRow(row, 1); audio.uiMove(); });
    if (rowEl.classList.contains('go-btn')) rowEl.addEventListener('click', () => { focus(); activateRow('go'); });
    else rowEl.addEventListener('click', focus);
  });
  // Records list rows (delegated — the list is rebuilt on update).
  const recList = document.getElementById('rec-list');
  if (recList) recList.addEventListener('click', (e) => {
    const r = e.target.closest('.rec-row'); if (!r) return;
    menu.enterSection('records'); menu.recSel = +r.dataset.i; renderRecordsList(); audio.uiMove();
  });
  // Controls list: click an action row to rebind it (delegated — rebuilt on update).
  const ctlList = document.getElementById('ctl-list');
  if (ctlList) ctlList.addEventListener('click', (e) => {
    const r = e.target.closest('.rec-row'); if (!r) return;
    menu.enterSection('controls'); onSectionEnter('controls');
    menu.ctlSel = +r.dataset.i; menu._applyCtlSel();
    beginRebind(menu.ctlSel);
  });
  // Clicking the capture scrim cancels the pending rebind.
  const cap = document.getElementById('rebind-capture');
  if (cap) cap.addEventListener('click', () => { closeRebind(); audio.uiMove(); });

  // Pause menu rows + Options are click targets too.
  const clickRow = (name) => {
    pauseMenu.focusRow(name);
    confirmPause();
    if (paused) pauseMenu.render(audio.sfxVolume, fsOn());
  };
  for (const name of ['resume', 'restart', 'options', 'quit']) {
    document.getElementById(`prow-${name}`).addEventListener('click', () => clickRow(name));
  }
  document.getElementById('popt-audio').querySelectorAll('.arrow').forEach((a, i) => {
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.setVolume(audio.sfxVolume + (i === 0 ? -1 : 1));
      pauseMenu.focusOptRow('audio');
      pauseMenu.render(audio.sfxVolume, fsOn());
    });
  });
  document.getElementById('popt-fullscreen').addEventListener('click', () => {
    toggleFullscreen();
    pauseMenu.focusOptRow('fullscreen');
    pauseMenu.render(audio.sfxVolume, fsOn());
  });

  // The in-race pause button opens the menu without the P key.
  pauseBtn.addEventListener('click', () => { if (state === 'race' && !paused) openPause(); });
}

// ------------------------------------------------------------------- boot
if (selection.mode === 0) trackIndex = 0; // championship always opens on round 1
buildWorld(trackIndex);
hud.showOverlay(true);
applyReducedMotion();
wireClicks();
requestAnimationFrame((t) => { last = t; tick(t); });

// Dev/debug hook: lets tooling (and tuning sessions) step the sim without
// relying on rAF, which browsers throttle in background tabs.
window.__game = {
  get ship() { return ship; },
  get rig() { return rig; },
  get spline() { return spline; },
  get trackDef() { return trackDef; },
  get race() { return race; },
  get podiumScene() { return podiumScene; },
  get menuPodium() { return podium; },
  get pauseMenu() { return pauseMenu; },
  openPause: () => openPause(),
  resumeRace: () => resumeRace(),
  juice, input, audio, hud, achievements,
  state: () => state,
  menu,
  menuKey: applyMenuKey,
  enter: onEnter,
  escape: onEscape,
  // Jump straight to the podium ceremony with the player at a given overall
  // rank (1-8), no championship required — for previewing the scene.
  podiumDemo: (rank = 1) => {
    rank = Math.max(1, Math.min(8, Math.round(rank)));
    const pTeam = TEAMS[selection.team];
    const rivals = TEAMS.map((_, i) => i).filter((i) => i !== selection.team);
    let ri = 0;
    const top3 = [0, 1, 2].map((i) => {
      const isPlayer = i + 1 === rank;
      if (isPlayer) {
        return { name: 'YOU', player: true, variant: { ...pTeam.variant, ...liveryOf(pTeam, selection.livery) } };
      }
      const team = TEAMS[rivals[ri++ % rivals.length]];
      return { name: team.fullName || team.name, player: false, variant: { ...team.variant, ...team.liveries[1] } };
    });
    state = 'podium';
    podiumScene.show(top3);
    podiumSceneEl.classList.remove('hidden');
    podiumTitleEl.className = rank === 1 ? 'champ' : '';
    podiumTitleEl.querySelector('.pt-tag').textContent = 'CHAMPIONSHIP · DEMO';
    podiumTitleEl.querySelector('.pt-title').textContent = rank === 1 ? 'CHAMPION' : `P${rank} OVERALL`;
    podiumTitleEl.querySelector('.pt-sub').textContent = 'ENTER — STANDINGS';
    podiumTitleEl.classList.remove('hidden');
    audio.championFanfare();
    return 'podium demo, rank ' + rank;
  },
  champ,
  selection,
  start: () => { hud.setCenter(null); startCountdown(); state = 'race'; },
  setTrack: (i) => {
    trackIndex = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    buildWorld(trackIndex);
    state = 'attract';
    input.clearPressed();
    hud.showOverlay(true);
  },
  warp(seconds, over = {}) {
    const simInput = { steer: 0, throttle: 1, brake: 0, airbrake: false, ...over };
    const ai = over.ai !== false;
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      if (ai) race.computeDraft(ship);
      ship.step(FIXED_DT, simInput);
      if (ai) {
        race.stepFixed(FIXED_DT, true);
        race.interact(ship, FIXED_DT);
      }
    }
    rig.reset(ship);
    return { s: ship.s, d: ship.d, v: ship.v, lap: ship.lap };
  },
};
