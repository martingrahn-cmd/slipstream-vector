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
import { WeaponSystem } from './weapons/weaponSystem.js';
import { AiDriver } from './ship/aiDriver.js';
import { CameraRig } from './fx/cameraRig.js';
import { Juice } from './fx/juice.js';
import { Sparks, ExhaustTrails } from './fx/particles.js';
import { GhostShip } from './fx/ghost.js';
import { PostFX } from './fx/postfx.js';
import { Hud, fmt } from './ui/hud.js';
import { BanterFeed } from './ui/banter.js';
import { Minimap } from './ui/minimap.js';
import { Input, NULL_INPUT, REBINDABLE, PAD_MENU, keyLabel, padLabel } from './core/input.js';

// CONTROLS rows: the keyboard-rebindable actions, then the pad-only menu binds.
const CTL_ROWS = [...REBINDABLE, ...PAD_MENU];
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

// One livery per pilot: team.liveries[0/1] is the signature colour of the team's
// first / second driver, hard-tied to the pilot for player and AI alike.
function championUnlocked() { return localStorage.getItem('sv-champion') === '1'; }
function liveryOf(team, pilot) { return team.liveries[pilot & 1]; }
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
const sparks = new Sparks(scene);
const trails = new ExhaustTrails(scene);
const input = new Input();
const hud = new Hud(juice);
let banterOn = localStorage.getItem('sv-banter') !== 'off';
const banter = new BanterFeed(document.getElementById('comms-feed'), audio);
banter.setEnabled(banterOn);
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
let trackDef, theme, spline, track, scenery, ship, shipVisual, rig, minimap, race, ghost;
let weapons = null; // WeaponSystem — rebuilt with the field; inactive in Time Trial
let TOTAL_LAPS = 3;

// The player's seat: mode, team, livery and callsign. Persisted.
const MODES = ['CHAMPIONSHIP', 'SINGLE RACE', 'TIME TRIAL'];
const selection = {
  mode: clampInt(localStorage.getItem('sv-mode') ?? '1', MODES.length),
  classIdx: Math.min(clampInt(localStorage.getItem('sv-class'), CLASSES.length), unlockedClasses()),
  // Rival difficulty (default PRO ≈ the old per-track average). Always free to pick.
  difficulty: clampInt(localStorage.getItem('sv-difficulty') ?? '1', DIFFICULTIES.length),
  team: clampInt(localStorage.getItem('sv-team'), TEAMS.length),
  pilot: clampInt(localStorage.getItem('sv-pilot'), 2), // which of the team's 2 named drivers you are — also picks the livery
};

// Championship: points across the whole roster, awarded per finish position.
const CHAMP_PTS = [10, 8, 6, 5, 4, 3, 2, 1];
const champ = {
  active: false,
  round: 0,
  done: 0,           // rounds whose points are in — the round to RESUME at
  classIndex: 0,     // the speed class this cup is being run at
  entry: null,       // {team, pilot} the cup is run as (locks the grid ids)
  unlockMsg: null,   // set when winning a cup unlocks something
  points: new Map(), // id -> {name, accent, player, pts, wins}
};

// Persist the in-progress cup so a reload (or quitting to the menu) resumes it.
// Saved after each round completes; cleared when the cup finishes or a new one
// starts. `done` is the next round to race, with points = all prior rounds, so a
// reload always resumes cleanly. Only unlock flags persisted before this.
const CHAMP_KEY = 'sv-champ-progress';
function saveChamp() {
  if (!champ.active) { try { localStorage.removeItem(CHAMP_KEY); } catch (e) { /* ignore */ } return; }
  try {
    localStorage.setItem(CHAMP_KEY, JSON.stringify({
      v: 1, done: champ.done, classIndex: champ.classIndex,
      entry: champ.entry, unlockMsg: champ.unlockMsg,
      points: [...champ.points.entries()].map(([id, e]) => ({ id, ...e })),
    }));
  } catch (e) { /* quota — skip */ }
}
function clearChamp() {
  champ.active = false;
  try { localStorage.removeItem(CHAMP_KEY); } catch (e) { /* ignore */ }
}
// Side-effect-free read of the saved cup (the menu's source of truth for "is
// there a cup to resume?"). Returns the validated record, or null. A cup is
// resumable once at least one round is in the bag and it isn't already finished.
function readSavedChamp() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(CHAMP_KEY) || 'null'); } catch (e) { return null; }
  if (!s || !Array.isArray(s.points) || !(s.done > 0) || s.done >= TRACKS.length) return null;
  return s;
}
// Load the saved cup into the working `champ` so RESUME can continue it.
function loadChamp() {
  const s = readSavedChamp();
  if (!s) return false;
  champ.active = true;
  champ.done = s.done;
  champ.round = s.done;               // about to race this round
  champ.classIndex = clampInt(String(s.classIndex), CLASSES.length);
  champ.entry = s.entry && typeof s.entry.team === 'number' ? s.entry : null;
  champ.unlockMsg = s.unlockMsg ?? null;
  champ.points.clear();
  for (const e of s.points) { const { id, ...data } = e; if (id) champ.points.set(id, data); }
  return true;
}
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
    accentCss: `#${liveryOf(team, selection.pilot).accent.toString(16).padStart(6, '0')}`,
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
function ghostKey() { return `sv-ghostpath-${trackDef.id}-${selection.classIdx}`; }

// Player ship + AI field — rebuilt on team/livery change without touching
// the world geometry.
function buildField() {
  if (shipVisual) {
    // Pull the reflection out of the scene FIRST: its hull/glow geometry is
    // borrowed from the ship, so it must not sit in the scene once disposeTree
    // frees that geometry below. Only its OWN materials are disposed here.
    if (shipVisual.reflection) {
      scene.remove(shipVisual.reflection);
      shipVisual.reflMat.dispose(); shipVisual.reflGlowMat.dispose();
    }
    scene.remove(shipVisual.root, shipVisual.shadow);
    disposeTree(shipVisual.root); disposeTree(shipVisual.shadow);
  }
  if (ghost) { ghost.dispose(scene); ghost = null; }
  if (race) race.dispose(scene);
  const team = TEAMS[selection.team];
  const cls = CLASSES[selection.classIdx];
  const variant = { ...team.variant, ...liveryOf(team, selection.pilot) };
  ship = new ShipPhysics(spline, juice, team.stats, cls);
  shipVisual = new ShipVisual(spline, scene, variant, { reactive: true, groundStyle: theme.groundStyle });
  trails.setColor(shipVisual.engBase); // exhaust ribbon runs the ship's glow hue at the nozzle
  // Time-trial ghost: a translucent clone of the player's hull that replays the
  // best lap. Built every field rebuild; the saved path loads only in TT.
  ghost = new GhostShip(spline, scene, shipVisual.hullGeo, variant.scaleX ?? 1, variant.scaleZ ?? 1);
  if (selection.mode === 2) {
    try { ghost.loadPath(JSON.parse(localStorage.getItem(ghostKey()) || 'null')); } catch (e) { /* ignore */ }
  }
  race = new Race(spline, scene, DIFFICULTIES[selection.difficulty].level,
    TOTAL_LAPS, juice, selectionInfo(),
    selection.mode === 2 /* time trial: empty track */, cls);
  race.grid();
  // Weapons: combat only where there are rivals — Championship + Single, never TT.
  if (weapons) weapons.dispose();
  weapons = new WeaponSystem(spline, scene, race, ship, juice, {
    active: selection.mode !== 2,
    seed: 1009 + trackIndex * 97 + selection.classIdx * 7,
  });
  hud.setWeapon(null);
  banter.configure(race, ship);
  ship.reset(12);
  podium.setShip(variant);
  localStorage.setItem('sv-team', String(selection.team));
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
  + '<div class="lg-row"><span>FIRE</span><b>SPACE / Y</b></div>'
  + '<div class="lg-row"><span>RESPAWN</span><b>R / X</b></div>'
  + '<div class="lg-row"><span>PAUSE</span><b>P / START</b></div>';

// Input-sensitive button prompts: the same action renders as a keyboard key, an
// Xbox face button, or a PlayStation symbol depending on the last device used.
const GLYPHS = {
  confirm:  { kb: 'ENTER', xbox: 'A', ps: '&#10005;' },          // ✕
  back:     { kb: '&#9003;', xbox: 'B', ps: '&#9675;' },         // ⌫ · ○
  pause:    { kb: 'P', xbox: '&#9776;', ps: 'OPTIONS' },         // ☰
  respawn:  { kb: 'R', xbox: 'X', ps: '&#9633;' },               // □
  navigate: { kb: '&uarr;&darr;', xbox: 'D-PAD', ps: 'D-PAD' },
  change:   { kb: '&larr;&rarr;', xbox: 'D-PAD', ps: 'D-PAD' },
};
function glyph(action) {
  const set = GLYPHS[action]; if (!set) return '';
  const pad = input.lastDevice === 'pad';
  const dev = pad ? input.padKind : 'kb';
  const label = set[dev] || set.kb;
  const wide = !label.startsWith('&') && label.length > 1; // multi-char word (D-PAD) → pill, not a round button
  return `<span class="kbtn ${pad ? `pad ${input.padKind}` : 'kb'}${wide ? ' wide' : ''}">${label}</span>`;
}
// Repaint the prompts that aren't rebuilt every frame (menu hint + title gate).
function refreshPrompts() {
  const hint = document.querySelector('.keys-hint');
  if (hint) {
    hint.innerHTML = `${glyph('navigate')} navigate &nbsp;&nbsp; ${glyph('confirm')} open &nbsp;&nbsp; `
      + `${glyph('change')} change &nbsp;&nbsp; ${glyph('back')} back`
      + (input.lastDevice === 'kb' ? ` &nbsp;&nbsp; <span class="kbtn kb">F</span> fullscreen` : '');
  }
  const intro = document.getElementById('intro-prompt');
  if (intro) intro.innerHTML = `PRESS ${glyph('confirm')}`;
}
let _promptDev = '', _promptKind = ''; // last-rendered prompt state (repaint on change)

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
  const lv = liveryOf(team, selection.pilot);
  const acc = `#${hex(lv.accent)}`;
  return `<div class="entry-face" style="--pa:${acc}">${pilotFaceInner(name)}</div>`
    + `<div class="entry-meta">`
      + `<div class="entry-team">${team.fullName.toUpperCase()}</div>`
      + `<div class="entry-pilot" style="color:${acc}">${name}</div>`
      + `<div class="entry-tags"><span class="entry-livery"><i style="background:#${hex(lv.hull)}"></i><i style="background:#${hex(lv.accent)}"></i></span>`
        + `<span class="entry-ship">${team.name} SHIP</span></div>`
    + `</div>`
    + `<button class="entry-edit" data-row="tweak" onclick="document.querySelector('#nav-list .navitem[data-sec=garage]').click()">GARAGE &#9656;</button>`;
}
function volBar(n) { let c = ''; for (let i = 0; i < 10; i++) c += `<i class="${i < n ? 'on' : ''}"></i>`; return `<span class="bar vbar">${c}</span>`; }
// Records are kept per (track, mode, kind): best LAP and best TOTAL time for each
// game mode (championship / single / time trial). The legacy single-value keys
// (sv-best / sv-racebest) are still read as an "overall best" fallback so older
// records survive, and stay updated as the headline figure.
const MODE_KEY = ['champ', 'single', 'tt']; // index by selection.mode
function recKey(trackId, mode, kind) { return `sv-rec-${trackId}-${MODE_KEY[mode]}-${kind}`; }
function getRec(trackId, mode, kind) { return parseFloat(localStorage.getItem(recKey(trackId, mode, kind)) || 'NaN'); }
function saveRec(trackId, mode, kind, t) {
  const k = recKey(trackId, mode, kind);
  const prev = parseFloat(localStorage.getItem(k) || 'Infinity');
  if (t < prev) { localStorage.setItem(k, t.toFixed(3)); return true; }
  return false;
}
// Best across all modes (+ the legacy single-value key) — for headline displays.
function bestOf(trackId, kind, legacyKey) {
  const vals = [0, 1, 2].map((m) => getRec(trackId, m, kind));
  vals.push(parseFloat(localStorage.getItem(legacyKey) || 'NaN'));
  const fin = vals.filter(Number.isFinite);
  return fin.length ? Math.min(...fin) : NaN;
}
function bestLap(trackId) { return bestOf(trackId, 'lap', `sv-best-${trackId}`); }
function bestTotal(trackId) { return bestOf(trackId, 'total', `sv-racebest-${trackId}`); }

function recordsSet() { return TRACKS.filter((t) => Number.isFinite(bestLap(t.id))).length; }

function renderRecordsList() {
  const list = document.getElementById('rec-list'); if (!list) return;
  list.innerHTML = TRACKS.map((t, i) => {
    const lap = bestLap(t.id);
    return `<div class="rec-row" data-i="${i}"><span class="rt">${t.name}</span><span class="rv">${Number.isFinite(lap) ? fmt(lap) : '—'}</span></div>`;
  }).join('');
  menu.recCount = TRACKS.length;
  const sel = TRACKS[Math.min(menu.recSel, TRACKS.length - 1)];
  // Detail: best LAP and best TOTAL per game mode for the selected track.
  const cell = (v) => Number.isFinite(v) ? fmt(v) : '—';
  const modeRows = ['CHAMP', 'SINGLE', 'TIME'].map((label, m) =>
    `<div class="rm-row"><span class="rm-mode">${label}</span>`
    + `<span class="rm-v">${cell(getRec(sel.id, m, 'lap'))}</span>`
    + `<span class="rm-v">${cell(getRec(sel.id, m, 'total'))}</span></div>`).join('');
  setHTML('rec-detail',
    `<div class="rm-head">${sel.name.toUpperCase()}</div>`
    + `<div class="rm-row rm-cols"><span class="rm-mode"></span><span class="rm-v">LAP</span><span class="rm-v">TOTAL</span></div>`
    + modeRows);
  menu._applyRecSel();
}

function renderControlsList() {
  const list = document.getElementById('ctl-list'); if (!list) return;
  const rows = CTL_ROWS.map((a, i) => {
    // Keyboard cell: editable for driving/actions, fixed+dim for the menu binds.
    const kb = a.kbFixed
      ? `<span class="kb-key fixed">${keyLabel(a.kbFixed)}</span>`
      : `<span class="kb-key">${input.bindingCodes(a.id).map(keyLabel).join(' / ') || '—'}</span>`;
    const pad = input.padBindingDescs(a.id).map((d) => padLabel(d, input.padKind)).join(' / ') || '—';
    return `<div class="rec-row kb-row" data-i="${i}"><span class="rt">${a.label}</span><span class="leader"></span>${kb}<span class="pad-key">${pad}</span></div>`;
  });
  rows.push(`<div class="rec-row kb-reset" data-i="${CTL_ROWS.length}"><span class="rt">RESET TO DEFAULTS</span><span class="rv">&#8635;</span></div>`);
  list.innerHTML = rows.join('');
  menu.ctlCount = CTL_ROWS.length + 1;
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
  // The lock hint only applies to Championship now (Single/TT pick any class).
  const lockHint = selection.mode === 0 && selection.classIdx >= unlocked && unlocked < CLASSES.length - 1 ? `WIN ${CLASSES[unlocked].name} CUP` : '';
  if (lockEl) { lockEl.textContent = lockHint; lockEl.classList.toggle('hidden', !lockHint); }

  setTxt('menu-team', team.fullName.toUpperCase());
  setTxt('menu-blurb', team.blurb);
  setHTML('menu-stats', ['speed', 'thrust', 'handling'].map((k) => `<div class="stat"><label>${k.toUpperCase()}</label>${bar(team.bars[k])}</div>`).join(''));
  // LIVERY is read-only now: it just shows the chosen pilot's signature colours.
  const lvCur = liveryOf(team, selection.pilot);
  setHTML('menu-livery', `<span class="swatch-pair sel"><i style="background:#${hex(lvCur.hull)}"></i><i style="background:#${hex(lvCur.accent)}"></i></span>`);
  setTxt('menu-pilot', team.pilots[selection.pilot] || team.pilots[0]);
  // Driver dossier: the pilot comms-frame "at rest" — a big driver-ID card for
  // the pilot you ARE (portrait + name plate + team + bio + accent stat bars),
  // plus the SAME frame at chip scale for the teammate (click = switch seat,
  // reusing the PILOT row's arrow so keyboard/gamepad/click share one path).
  const me = selection.pilot, mate = me === 0 ? 1 : 0;
  const heroName = team.pilots[me], mateName = team.pilots[mate];
  const heroAcc = `#${hex(team.liveries[me].accent)}`, mateAcc = `#${hex(team.liveries[mate].accent)}`;
  const sn = `SV-${team.name.slice(0, 3).toUpperCase()}-0${me + 1}`;
  setHTML('pilot-roster',
    `<div class="cf cf--hero" style="--pa:${heroAcc}">`
      + `<div class="cf__win">`
        + `<div class="cf__ticks" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`
        + `<div class="cf__face">${pilotFaceInner(heroName)}</div>`
        + `<div class="cf__stamp">ACTIVE PILOT</div>`
        + `<div class="cf__serial"><span class="cf__led"></span><span>${sn}</span><span class="cf__sig">LIVE</span></div>`
      + `</div>`
      + `<div class="cf__spine">`
        + `<div class="cf__plate"><span class="cf__call">${heroName}</span><span class="cf__you">YOU</span></div>`
        + (championUnlocked() ? `<div class="cf__champ"><span>&#9670;</span> GRAND CHAMPION</div>` : '')
        + `<div class="cf__team">${team.fullName.toUpperCase()} &#9670; ${team.name}</div>`
        + `<p class="cf__bio">${PILOT_BIOS[heroName] || ''}</p>`
        + `<div class="cf__stats">`
          + `<div class="cf__stat"><label>SPD</label>${bar(team.bars.speed)}</div>`
          + `<div class="cf__stat"><label>THR</label>${bar(team.bars.thrust)}</div>`
          + `<div class="cf__stat"><label>HND</label>${bar(team.bars.handling)}</div>`
        + `</div>`
      + `</div>`
    + `</div>`
    + `<button class="cf cf--chip cf--mate" style="--pa:${mateAcc}" title="Switch to ${mateName}"`
      + ` onclick="document.querySelector('.section.garage [data-row=pilot] .arrow.r').click()">`
      + `<div class="cf__win"><div class="cf__face">${pilotFaceInner(mateName)}</div></div>`
      + `<div class="cf__spine"><span class="cf__tag">TEAMMATE</span><span class="cf__call">${mateName}</span></div>`
      + `<span class="cf__swap">SWITCH &#9656;</span>`
    + `</button>`);

  setHTML('opt-music', volBar(audio.musicVolume));
  setHTML('opt-sfx', volBar(audio.sfxVolume));
  let dzi = DEADZONES.indexOf(input.deadzone); if (dzi < 0) dzi = 1;
  setTxt('opt-dz', DZ_LABEL[dzi]);
  setTxt('opt-rumble', input.rumbleOn ? 'ON' : 'OFF');
  setTxt('opt-fs', document.fullscreenElement ? 'ON' : 'OFF');
  setTxt('opt-motion', document.body.classList.contains('reduced-motion') ? 'REDUCED' : 'FULL');
  setTxt('opt-pilotintro', INTRO_LABEL[introMode]);
  setTxt('opt-banter', banterOn ? 'ON' : 'OFF');
  setTxt('opt-gp-state', input.gamepadActive ? 'CONNECTED' : 'NONE');
  const legend = document.getElementById('opt-legend');
  if (legend && !legend.dataset.filled) { legend.dataset.filled = '1'; legend.innerHTML = CONTROLS_LEGEND; }

  setTxt('ns-single', trackDef.name);
  setTxt('ns-garage', team.name);
  setTxt('ns-options', `MUSIC ${audio.musicVolume}`);
  setTxt('ns-records', `${recordsSet()}/${TRACKS.length} SET`);
  setTxt('ns-trophies', `${achievements.count()}/${achievements.total()}`);
  setHTML('status-tele', `CLASS &#9656; <b>${cls.name}</b> &middot; RIVALS &#9656; <b>${diff.name}</b> &middot; &#9672; ${achievements.count()}/${achievements.total()}`);

  const best = bestLap(trackDef.id);
  setTxt('menu-best', Number.isFinite(best) ? `RECORD ${fmt(best)}` : 'NO RECORD SET');
  const ttLap = getRec(trackDef.id, 2, 'lap'); // the time-trial screen shows its own record (falls back to overall)
  const ttShow = Number.isFinite(ttLap) ? ttLap : best;
  setTxt('tt-best', Number.isFinite(ttShow) ? `BEST LAP ${fmt(ttShow)}` : 'NO RECORD — SET ONE');

  setTxt('ns-controls', 'REBIND');
  // Championship: a saved cup (≥1 round done) turns START CUP into RESUME and
  // reveals NEW CUP; the ladder lights completed rounds + the one you're on.
  const saved = readSavedChamp();
  const champRound = saved ? saved.done : 0; // 0-indexed round to resume / start at
  setHTML('cup-ladder', TRACKS.map((t, i) => {
    const cls = i < champRound ? ' done' : i === champRound ? ' lit' : '';
    return `<div class="cup-rd${cls}"><span class="rn">${i + 1}</span>${t.name}</div>`;
  }).join(''));
  const goBtn = document.getElementById('champ-go');
  if (goBtn) goBtn.textContent = saved ? `RESUME · ROUND ${champRound + 1}/${TRACKS.length}` : 'START CUP';
  const newCupBtn = document.getElementById('champ-newcup');
  if (newCupBtn) newCupBtn.classList.toggle('hidden', !saved);
  setTxt('ns-championship', saved ? `RESUME R${champRound + 1}/${TRACKS.length}` : `${TRACKS.length} ROUNDS`);
  menu.setChampResume(!!saved);
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
    const best = Number.isFinite(bestLap(trackDef.id)) ? bestLap(trackDef.id) : Infinity;
    return {
      tag: trackDef.name.toUpperCase(),
      title: 'TIME TRIAL',
      rows: [{
        ...you,
        right1: fmt(playerFinishTime),
        right2: ship.bestLap && ship.bestLap <= best ? 'NEW RECORD' : `BEST LAP ${fmt(ship.bestLap)}`,
      }],
      footer: `${glyph('confirm')} — AGAIN &nbsp;·&nbsp; ${glyph('back')} — MENU`,
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
  const advance = champ.active ? `${glyph('confirm')} — STANDINGS` : `${glyph('confirm')} — RACE AGAIN &nbsp;·&nbsp; ${glyph('back')} — MENU`;
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
  champ.done = champ.round + 1;        // this round's points are now in the bag
  if (champ.done < TRACKS.length) saveChamp(); // resume point: next session continues here
}                                      // final round: leave it to the complete branch to clear

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
      ? (champ.unlockMsg ? `${champ.unlockMsg} — ${glyph('confirm')} MENU` : `${glyph('confirm')} — MENU`)
      : `${glyph('confirm')} — ROUND ${champ.round + 2}/${TRACKS.length}`,
  };
}

// Winning a cup unlocks the next speed class; winning the top (Overdrive) cup
// crowns you GRAND CHAMPION (a title flag — sv-champion — reserved for a future
// prestige flourish). Returns a message for the finale board, or null if there
// was nothing left to unlock.
function processUnlock(classWon) {
  if (classWon < CLASSES.length - 1) {
    const have = unlockedClasses();
    if (classWon + 1 > have) {
      localStorage.setItem('sv-unlocked', String(classWon + 1));
      return `${CLASSES[classWon + 1].name} CLASS UNLOCKED`;
    }
  } else if (!championUnlocked()) {
    localStorage.setItem('sv-champion', '1');
    return 'GRAND CHAMPION';
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
// Every ship — player and rivals — wears its pilot's real hull archetype +
// signature livery, recovered from the display name ("TEAMNAME · PILOT"), so the
// podium reads exactly like the grid (otherwise rivals fall back to a generic
// pronghorn/silver and stop looking like their team).
function teamForEntry(e) {
  const nm = (e.name || '').toUpperCase();
  return TEAMS.find((t) => nm.startsWith(t.name.toUpperCase())) || TEAMS[0];
}
function liveryForEntry(e) {
  const team = teamForEntry(e);
  const nm = (e.name || '').toUpperCase();
  const pi = team.pilots.findIndex((p) => nm.includes(p.toUpperCase()));
  return liveryOf(team, pi >= 0 ? pi : 0);
}
function podiumEntries() {
  const sorted = [...champ.points.values()].sort((a, b) => b.pts - a.pts);
  const playerRank = sorted.findIndex((e) => e.player) + 1;
  const team = TEAMS[selection.team];
  const playerVariant = { ...team.variant, ...liveryOf(team, selection.pilot) };
  const top3 = sorted.slice(0, 3).map((e) => ({
    name: e.name,
    player: e.player,
    variant: e.player ? playerVariant : { ...teamForEntry(e).variant, ...liveryForEntry(e) },
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
  podiumTitleEl.querySelector('.pt-sub').innerHTML = `${glyph('confirm')} — STANDINGS`;
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

// Near-miss "whoosh": a wall/pylon or a rival flying close past at speed sends a
// doppler swish (panned, in audio) + a faint camera tug (via juice). Pure feel,
// detected read-only over sim state — no physics touched. Cooldowns debounce it
// so one pass reads as one rush, not a stutter.
const _nmF = makeFrame();
let _nmWallCd = 0;
const _nmRivalCd = new Map();
function updateNearMiss(realDt) {
  _nmWallCd = Math.max(0, _nmWallCd - realDt);
  for (const [r, cd] of _nmRivalCd) { const n = cd - realDt; if (n <= 0) _nmRivalCd.delete(r); else _nmRivalCd.set(r, n); }
  const sn = ship.speedNorm;
  if (sn < T.NEARMISS_MIN_SN) return;
  const spd = (sn - T.NEARMISS_MIN_SN) / (1 - T.NEARMISS_MIN_SN); // 0..1 above the floor
  // Trackside skim: tucked close to the edge (pylons/walls whipping past) but
  // NOT actually scraping — that's the "phew" as you thread a pinch at speed.
  spline.frameAt(ship.s, _nmF);
  const gap = (_nmF.width - T.WALL_MARGIN) - Math.abs(ship.d);
  if (!ship.scraping && gap >= 0 && gap < T.NEARMISS_WALL_GAP && _nmWallCd === 0) {
    juice.emit('nearMiss', { side: Math.sign(ship.d) || 1, intensity: 0.35 + 0.65 * spd });
    _nmWallCd = T.NEARMISS_WALL_CD;
  }
  // A rival flying past close but clear of contact (interact handles the touch).
  if (state !== 'race' || !race || !race.racers) return;
  const L = spline.length;
  for (const r of race.racers) {
    if (_nmRivalCd.has(r)) continue;
    const rp = r.phys;
    if (r.finishTime !== null || rp === ship) continue;
    let ds = (((rp.s - ship.s) % L) + L) % L; if (ds > L / 2) ds -= L;
    if (Math.abs(ds) > T.NEARMISS_RIVAL_DS) continue;
    const dd = Math.abs(rp.d - ship.d);
    if (dd < T.NEARMISS_RIVAL_IN || dd > T.NEARMISS_RIVAL_OUT) continue;
    const closeness = 1 - (dd - T.NEARMISS_RIVAL_IN) / (T.NEARMISS_RIVAL_OUT - T.NEARMISS_RIVAL_IN);
    const rel = Math.min(1, Math.abs(ship.v - rp.v) / 22);
    juice.emit('nearMiss', { side: Math.sign(rp.d - ship.d) || 1, intensity: 0.4 + 0.35 * closeness + 0.25 * rel });
    _nmRivalCd.set(r, T.NEARMISS_RIVAL_CD);
  }
}

// Desert sun-gate set-piece: the sun disc blooms as you drive into it through
// the Sun Gate, and a scripted meteor crowns the final lap. Both are pure sky-
// shader drivers computed here (read-only over camera/ship) and handed to
// scenery.update — no physics, no extra passes.
let _sunFlare = 0;
let _meteorT = -1;               // -1 idle, else 0..1 life of the last-lap fireball
let _meteorAz = 0;               // world heading the fireball drops into view along
const _sunFwd = new THREE.Vector3();
function fireMeteor() {
  if (!(theme && theme.sky && theme.sky.event === 'planet')) return;
  camera.getWorldDirection(_sunFwd);           // aim it ahead of where you're looking
  _meteorAz = Math.atan2(_sunFwd.x, _sunFwd.z); // matches the shader's atan(d.x, d.z)
  _meteorT = 0;
}
function updateSunGate(realDt) {
  if (_meteorT >= 0) { _meteorT += realDt / T.METEOR_DURATION; if (_meteorT > 1) _meteorT = -1; }
  let target = 0;
  if (state === 'race' && theme && theme.sky && theme.sky.event === 'planet') {
    const sa = theme.sky.sunAz || [-0.35, -0.94];
    const sl = Math.hypot(sa[0], sa[1]) || 1;
    camera.getWorldDirection(_sunFwd);
    const fl = Math.hypot(_sunFwd.x, _sunFwd.z) || 1;
    const align = (_sunFwd.x / fl) * (sa[0] / sl) + (_sunFwd.z / fl) * (sa[1] / sl);
    let a = (align - T.SUNGATE_ALIGN_LO) / (T.SUNGATE_ALIGN_HI - T.SUNGATE_ALIGN_LO);
    a = Math.max(0, Math.min(1, a)); a = a * a * (3 - 2 * a); // smoothstep
    target = a * Math.min(1, 0.2 + ship.speedNorm * 1.2);    // only sells at speed
  }
  _sunFlare += (target - _sunFlare) * Math.min(1, T.SUNGATE_FLARE_EASE * realDt);
}

// Impact FIREBALL + SMOKE — pooled billboards: a hot core that balloons and
// whites out, then 2-3 dark puffs that rise and fade. Plus the shockwave ring.
const _impactTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx2 = c.getContext('2d');
  const g = ctx2.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx2.fillStyle = g; ctx2.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const _fireball = (() => {
  const pool = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: _impactTex, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    m.visible = false; m.frustumCulled = false; scene.add(m);
    pool.push({ m, t: -1, scale: 1 });
  }
  const LIFE = 0.42;
  const hot = new THREE.Color(0xffffff), mid = new THREE.Color(0xffa63d), late = new THREE.Color(0xff4426);
  return {
    burst(pos, scale) {
      const f = pool.find((x) => x.t < 0) || pool[0];
      f.t = 0; f.scale = scale; f.m.visible = true; f.m.position.copy(pos);
    },
    update(dt, camera) {
      for (const f of pool) {
        if (f.t < 0) continue;
        f.t += dt;
        const u = f.t / LIFE;
        if (u >= 1) { f.t = -1; f.m.visible = false; continue; }
        f.m.quaternion.copy(camera.quaternion);
        const s = (1.8 + u * 7.5) * f.scale;
        f.m.scale.set(s, s, s);
        // White flash only for the first instant, then FIRE orange fast — the
        // orange phase is what reads as an explosion, so it owns most of the life.
        f.m.material.color.copy(hot).lerp(u < 0.25 ? mid : late, Math.min(1, u * 3.2));
        f.m.material.opacity = (1 - u * u) * 0.95;
      }
    },
  };
})();
const _smoke = (() => {
  const pool = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: _impactTex, color: 0x241a30, transparent: true, opacity: 0,
      depthWrite: false, fog: true, side: THREE.DoubleSide,
    }));
    m.visible = false; m.frustumCulled = false; scene.add(m);
    pool.push({ m, t: -1, scale: 1, vx: 0, vy: 2, vz: 0 });
  }
  const LIFE = 1.1;
  return {
    burst(pos, scale) {
      for (let k = 0; k < 3; k++) {
        const p = pool.find((x) => x.t < 0); if (!p) return;
        p.t = k * -0.06; p.scale = scale * (0.8 + Math.random() * 0.5);
        p.m.position.copy(pos);
        p.vx = (Math.random() - 0.5) * 4; p.vy = 2.5 + Math.random() * 2; p.vz = (Math.random() - 0.5) * 4;
        p.m.visible = true;
      }
    },
    update(dt, camera) {
      for (const p of pool) {
        if (p.t < -0.5 && p.t !== -1) { /* staggered start */ }
        if (p.t === -1) continue;
        p.t += dt;
        if (p.t < 0) continue;
        const u = p.t / LIFE;
        if (u >= 1) { p.t = -1; p.m.visible = false; continue; }
        p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
        p.m.quaternion.copy(camera.quaternion);
        const s = (2.2 + u * 5.5) * p.scale;
        p.m.scale.set(s, s, s);
        p.m.material.opacity = 0.4 * (1 - u);
      }
    },
  };
})();

// AAA impact shockwave — a small pool of camera-facing rings that snap out and
// fade on weapon hits. Cheap: 5 additive rings, only active during an impact.
const _shock = (() => {
  const rings = [];
  const geo = new THREE.RingGeometry(0.72, 1.0, 40);
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    m.visible = false; m.frustumCulled = false; scene.add(m);
    rings.push({ m, t: -1, scale: 1 });
  }
  const LIFE = 0.34;
  return {
    burst(pos, colHex, scale) {
      const r = rings.find((x) => x.t < 0) || rings[0];
      r.t = 0; r.scale = scale; r.m.visible = true;
      r.m.position.copy(pos); r.m.material.color.setHex(colHex);
    },
    update(dt, camera) {
      for (const r of rings) {
        if (r.t < 0) continue;
        r.t += dt;
        const u = r.t / LIFE;
        if (u >= 1) { r.t = -1; r.m.visible = false; continue; }
        r.m.quaternion.copy(camera.quaternion);
        const s = (0.5 + u * 6.0) * r.scale;
        r.m.scale.set(s, s, s);
        r.m.material.opacity = (1 - u) * (1 - u) * 0.9;
      }
    },
  };
})();
const _dots = [];
const _dustA = new THREE.Color(0x9a8a6a); // ground kick-up tint (per world)
const _dustB = new THREE.Color(0x33271a);
const _engPool = new THREE.Color();          // engine light-pool colour — the ship's glow hue, hint-hotter on boost
const _WHITE_C = new THREE.Color(0xffffff);
juice.on('wallHit', ({ side, severity }) => {
  spline.frameAt(ship.s, _f);
  _v.copy(_f.pos).addScaledVector(_f.R, side * (_f.width - T.WALL_MARGIN + 0.6)).addScaledVector(_f.U, 0.5);
  _vel.copy(_f.T).multiplyScalar(ship.v * 0.5);
  sparks.spawn(_v, _vel, 14 + severity * 10, T.SPARK_HIT_COUNT, undefined, undefined, undefined, _f.pos.y);
  if (state === 'race') { tally.wallHits++; input.rumble(Math.min(1, 0.45 + severity * 0.5), 220); }
});
let scrapeAcc = 0;
juice.on('scrape', () => { scrapeAcc += T.SPARK_SCRAPE_RATE * FIXED_DT; });
// Weapon armed (from the WeaponSystem pickup roll): HUD badge + chirp for the
// player; AI pickups are silent — you learn they are armed when they fire.
const _muzzleA = new THREE.Color(0xffc86a);
const _muzzleB = new THREE.Color(0xffffff);
const _explCore = new THREE.Color(0xffffff);
const _explHot = new THREE.Color(0xffb13d);
const _explTail = new THREE.Color(0xff477e);
// Weapon hit: an AAA two-stage explosion at the victim — a white-hot core burst
// + a slower gold/rose bloom — governed by distance to the camera (the
// fill-bound rule: far hits spawn smaller, cheaper bursts).
juice.on('weaponHit', ({ victim, victimIsPlayer }) => {
  spline.frameAt(victim.s, _f);
  _v.copy(_f.pos).addScaledVector(_f.R, victim.d).addScaledVector(_f.U, 1.0);
  const k = Math.max(0.25, Math.min(1, 70 / Math.max(camera.position.distanceTo(_v), 1)));
  _vel.copy(_f.T).multiplyScalar(victim.v * 0.35);
  // Real impact weight: fireball core + smoke + hot debris + shockwave ring.
  _fireball.burst(_v, 0.8 + k * 0.9);
  _smoke.burst(_v, 0.8 + k * 0.6);
  sparks.spawn(_v, _vel, 30, Math.round(60 * k), _explCore, _explHot, undefined, _f.pos.y);
  sparks.spawn(_v, _vel, 14, Math.round(36 * k), _explHot, _explTail, undefined, _f.pos.y);
  _shock.burst(_v, victimIsPlayer ? 0xffffff : 0xffdca0, 1.4 + k * 0.8);
  if (victimIsPlayer && state === 'race') {
    audio.playerHitBang();                                   // fat close BANG + paralysis hum
    juice.fovSpike = Math.max(juice.fovSpike, 0.55);         // a lens punch on top of the trauma spike
    input.rumble(1, 460);
  } else {
    audio.weaponImpact(0.4 + 0.6 * k);
  }
});
juice.on('shieldSave', ({ victim, victimIsPlayer }) => {
  spline.frameAt(victim.s, _f);
  _v.copy(_f.pos).addScaledVector(_f.R, victim.d).addScaledVector(_f.U, 1.2);
  _vel.copy(_f.T).multiplyScalar(victim.v * 0.3);
  sparks.spawn(_v, _vel, 14, 18, _muzzleB, _explHot, undefined, _f.pos.y);
  _shock.burst(_v, 0x9ff0ff, 0.8);                           // a cyan shield ripple ring
  const vis = victimIsPlayer ? shipVisual : (race.racers.find((r) => r.phys === victim) || {}).vis;
  if (vis) vis.flashShieldHit();
  audio.shieldBounce();
  if (victimIsPlayer && state === 'race') input.rumble(0.5, 180);
});
juice.on('weaponHit', (e) => { if (state === 'race' || state === 'finished') banter.weaponHit(e); });
juice.on('shieldSave', (e) => { if (state === 'race' || state === 'finished') banter.shieldSave(e); });
juice.on('weaponFire', ({ type, isPlayer, remaining }) => {
  if (!isPlayer) return;
  hud.setWeapon(remaining > 0 ? type : null, remaining);
  audio.weaponFire(type);
  input.rumble(type === 'missiles' || type === 'homing' ? 0.4 : 0.25, 140);
  // Muzzle punch: a burst of hot sparks so the launch/drop reads on screen.
  if (type === 'missiles' || type === 'homing' || type === 'mine') {
    spline.frameAt(ship.s, _f);
    const back = type === 'mine' ? -3 : 3;
    _v.copy(_f.pos).addScaledVector(_f.T, back).addScaledVector(_f.R, ship.d).addScaledVector(_f.U, 1.0);
    _vel.copy(_f.T).multiplyScalar(type === 'mine' ? -6 : ship.v + 20);
    sparks.spawn(_v, _vel, 10, 16, _muzzleA, _muzzleB, undefined, _f.pos.y);
  }
});
juice.on('weaponArmed', ({ type, isPlayer }) => {
  if (!isPlayer) return;
  hud.setWeapon(type);
  if (type && state === 'race') { audio.weaponPickup(); input.rumble(0.25, 120); }
});
// Held too long, never fired: it fizzles out (use-it-or-lose-it). Clear the HUD
// slot and give a soft power-down cue so the player reads the loss.
juice.on('weaponFizzle', ({ isPlayer }) => {
  if (!isPlayer) return;
  hud.setWeapon(null, 0);
  if (state === 'race') audio.weaponFizzle();
});
// A pad was grabbed (by anyone): a gold spark burst at the pad so the pickup
// reads, governed by distance to camera (fill-budget).
juice.on('padTaken', ({ pad }) => {
  const wp = spline.weaponPads[pad]; if (!wp) return;
  spline.frameAt(wp.s, _f);
  _v.copy(_f.pos).addScaledVector(_f.R, wp.d).addScaledVector(_f.U, 0.5);
  const k = Math.max(0.2, Math.min(1, 60 / Math.max(camera.position.distanceTo(_v), 1)));
  _vel.set(0, 2.4, 0);
  sparks.spawn(_v, _vel, 9, Math.round(18 * k), _muzzleA, _explHot, undefined, _f.pos.y);
});

// Overtake banter: compare each rival's progress to the player's with a small
// hysteresis margin, and fire a line when the ordering flips. Throttled to 4Hz.
// Position-independent — it only reports who passed whom, never rubber-bands.
const _otAhead = new Map(); // racer -> committed side: +1 ahead of player, -1 behind
let _otAccum = 0;
function updateBanter(dt) {
  if (state === 'race' && race && race.racers && race.racers.length) {
    _otAccum += dt;
    if (_otAccum >= 0.25) {
      _otAccum = 0;
      const pp = race.progressOf(ship);
      for (const r of race.racers) {
        const d = race.progressOf(r.phys) - pp;
        const prev = _otAhead.get(r) || 0;
        let now = prev;
        if (d > 2) now = 1; else if (d < -2) now = -1;
        if (prev !== 0 && now !== prev) banter.overtake(r.phys, now === 1);
        _otAhead.set(r, now);
      }
    }
  }
  banter.update(dt);
}
const _boostColA = new THREE.Color(T.COL.ENGINE);
const _boostColB = new THREE.Color(0xffffff);
juice.on('boost', ({ pad } = {}) => {
  _vel.set(0, 1.5, 0);
  sparks.spawn(shipVisual.root.position, _vel, 9, 26, _boostColA, _boostColB, undefined, shipVisual.shadow.position.y);
  if (state === 'race') input.rumble(0.5, 200);
  if (state === 'race' && pad >= 0) {
    achievements.unlock('first_boost');
    if (++tally.pads >= 3) achievements.unlock('pad_chain');
    // First-race tip: name the boost pad the moment the player first hits one.
    if (onbThisRace && !onbBoostShown) {
      onbBoostShown = true;
      hud.flashCenter('BOOST PAD — HOLD THROUGH IT', 1500);
    }
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
let showcaseFocus = null; // the ship the post-race broadcast cam is following (hysteresis)
let showcaseHoldT = 0;    // seconds on the current subject (paces the broadcast cuts)
// Post-race: an AI takes the player's wheel too, so its ship keeps racing the
// line (and boosting on pads) instead of standing still. Rebuilt per spline.
let postRaceDriver = null;
const POSTRACE_SKILL = { corner: 1.0, line: 0.92, boost: 0.6 };
let debugCam = false;
let paused = false;

// New-player onboarding: one-time prompts on the very first race teaching the
// two mechanics players missed at launch (airbrake + boost pads). Gated by
// sv-onboarded; reuses hud.flashCenter, so it respects reduced-motion already.
let onboarding = localStorage.getItem('sv-onboarded') !== '1';
let onbThisRace = false;   // true only during the genuine first race
let onbBoostShown = false; // the boost-pad tip fires once, on the first pad

// --- pre-race pilot intro card ------------------------------------------
// The chosen pilot "hails" you in the comms-frame before the countdown. Gated
// inside startCountdown() so every call site (start / resume / restart) is
// covered; dismissed by the video ending, any confirm/skip button, or a
// backstop timeout, then it re-enters startCountdown() for the real sweep.
const INTRO_MODES = ['first', 'always', 'off'];
const INTRO_LABEL = { first: 'FIRST RACE', always: 'ALWAYS', off: 'OFF' };
let introMode = INTRO_MODES.includes(localStorage.getItem('sv-intro')) ? localStorage.getItem('sv-intro') : 'first';
let introArmed = true;    // whether the NEXT startCountdown should hail (per introMode)
let introActive = false;  // the card is up (swallows input, gates the countdown)
let _introTO = 0;         // backstop auto-advance handle
let _introDuck = null;    // saved music-bus gain while ducked

function showIntro() {
  const team = TEAMS[selection.team];
  const name = team.pilots[selection.pilot] || team.pilots[0];
  const acc = `#${hex(liveryOf(team, selection.pilot).accent)}`;
  const slug = pilotSlug(name);
  const posterExt = slug === 'juno-vex' ? 'png' : 'jpg'; // Juno is the lone .png portrait
  const el = document.getElementById('pilot-intro');
  el.innerHTML =
    `<div class="pi__scan" aria-hidden="true"></div>`
    + `<div class="cf cf--intro" style="--pa:${acc}">`
      + `<div class="cf__win">`
        + `<div class="cf__ticks" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`
        + `<div class="cf__face">`
          + `<video class="cf__vid" playsinline preload="auto" poster="assets/pilots/${slug}.${posterExt}"`
            + ` onerror="this.classList.add('is-dead')">`
            + `<source src="assets/pilots/${slug}.mp4" type="video/mp4">`
            + `<source src="assets/pilots/${slug}.webm" type="video/webm">`
          + `</video>`
          + `<div class="cf__poster">${pilotFaceInner(name)}</div>`
        + `</div>`
        + `<div class="cf__stamp">INCOMING TRANSMISSION</div>`
        + `<div class="cf__serial"><span class="cf__led"></span><span>${team.name.slice(0, 3).toUpperCase()} UPLINK</span><span class="cf__sig">ON AIR</span></div>`
      + `</div>`
      + `<div class="cf__spine">`
        + `<div class="cf__plate"><span class="cf__call">${name}</span><span class="cf__you">YOU</span></div>`
        + `<div class="cf__team">${team.fullName.toUpperCase()}</div>`
      + `</div>`
    + `</div>`
    + `<div class="pi__skip">${glyph('confirm')} <span>SKIP</span></div>`;
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('show'));
  introActive = true;
  input.clearPressed();

  // Duck the (menu) music so the pilot's line carries. Non-persisting: we poke
  // the bus gain directly, NOT setMusicVolume (which would save the ducked value).
  if (audio.musicBus) { _introDuck = audio.musicBus.gain.value; audio.musicBus.gain.value = _introDuck * 0.4; }

  // Play WITH sound — GO was a user gesture, so autoplay-with-audio is allowed.
  const vid = el.querySelector('.cf__vid');
  clearTimeout(_introTO);
  _introTO = setTimeout(dismissIntro, 4200); // backstop if the file is missing/blocked
  if (vid) {
    vid.muted = false; vid.volume = 1;
    vid.addEventListener('ended', dismissIntro, { once: true });
    vid.addEventListener('loadedmetadata', () => {
      if (isFinite(vid.duration) && vid.duration > 0.4) { clearTimeout(_introTO); _introTO = setTimeout(dismissIntro, vid.duration * 1000 + 500); }
    });
    // Source failures fire on the LAST <source> child (not the <video>) — when it
    // fires, hide the video so the static-portrait underlay shows (Safari would
    // otherwise leave a black/empty box instead of painting the poster).
    const lastSrc = vid.querySelector('source:last-of-type');
    if (lastSrc) lastSrc.addEventListener('error', () => vid.classList.add('is-dead'), { once: true });
    const p = vid.play();
    // If autoplay-WITH-sound is blocked (rare after the GO gesture), retry muted
    // so the clip still plays visually rather than freezing on the poster.
    if (p && p.catch) p.catch(() => {
      vid.muted = true;
      vid.play().catch(() => { if (vid.networkState === 3) vid.classList.add('is-dead'); /* NO_SOURCE — underlay shows, backstop advances */ });
    });
  }
}

function dismissIntro() {
  if (!introActive) return;
  introActive = false;
  clearTimeout(_introTO);
  const el = document.getElementById('pilot-intro');
  const vid = el.querySelector('.cf__vid'); if (vid) { try { vid.pause(); } catch (e) { /* ignore */ } }
  el.classList.remove('show');
  setTimeout(() => { el.classList.add('hidden'); el.innerHTML = ''; }, 240);
  if (audio.musicBus && _introDuck != null) { audio.musicBus.gain.value = _introDuck; _introDuck = null; }
  input.clearPressed();
  startCountdown(); // introArmed already consumed → falls through to the real sweep
}

function startCountdown() {
  // Pilot intro card gates the countdown once (per introMode); dismissIntro()
  // re-enters here and falls through to the real sweep.
  if (introArmed && introMode !== 'off' && !document.body.classList.contains('reduced-motion')) {
    introArmed = false;
    showIntro();
    return;
  }
  introArmed = introMode === 'always'; // re-arm so ALWAYS hails before every race
  ship.reset(12); // a few meters past the gantry so it doesn't sit over the camera
  ship.lap = 1;
  _sunFlare = 0; _meteorT = -1; // clear the sun-gate set-piece for the new race
  rig.reset(ship);
  // Cinematic arc: front approach -> orbit around -> settle behind the ship.
  // Reduced-motion skips the sweep and starts at the chase pose.
  const introDur = document.body.classList.contains('reduced-motion') ? 0 : 2.8;
  rig.playIntro(ship, introDur);
  race.grid();
  if (weapons) weapons.reset();
  banter.reset();
  audio.disableHum(false); // never inherit a stuck paralysis buzz into a new race
  _otAhead.clear();
  juice.trauma = 0; juice.boostFactor = 0;
  state = 'countdown';
  countdownT = 3.2;
  countdownIntro = introDur ? introDur + 0.2 : 0.4; // hold the 3-2-1 until the sweep lands
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
  // First race: teach the airbrake during the calm countdown (ship held at the
  // line), not as a flash mid-corner where a new player can't read it.
  if (onboarding) {
    const ak = input.lastDevice === 'pad'
      ? (input.padKind === 'ps' ? 'L1 / R1' : 'LB / RB')   // gamepad airbrake = shoulder buttons
      : (input.bindingCodes('airbrake').map(keyLabel)[0] || 'SHIFT');
    hud.setSub(`NEW PILOT? HOLD ${ak} TO AIRBRAKE — DRIFT THE TIGHT CORNERS`);
  }
}
let lastCountN = -1;

juice.on('lap', ({ lap, time }) => {
  // Once the race is over, the ship keeps lapping for the post-race showcase —
  // those laps must NOT touch records/ghosts or re-stamp the finish time.
  if (state === 'finished' || state === 'podium') return;
  // Sanity floor so debug teleports/glitches can never write a record.
  const prev = parseFloat(localStorage.getItem(bestKey()) || 'Infinity');
  if (time > 20) saveRec(trackDef.id, selection.mode, 'lap', time); // per-mode lap record
  // Time-trial ghost: snapshot a FULL lap (lap>=3; lap 2 is the short rolling
  // opener) when it's the fastest yet, then start recording the next lap.
  if (ghost && selection.mode === 2) {
    if (lap >= 3) {
      const path = ghost.takeLap();
      if (path && (!ghost.path || path.dur < ghost.path.dur)) {
        try { localStorage.setItem(ghostKey(), JSON.stringify(path)); } catch (e) { /* quota — skip */ }
        ghost.loadPath(path);
      }
    }
    ghost.startLap();
  }
  if (time > 20 && time < prev) {
    localStorage.setItem(bestKey(), time.toFixed(3)); // overall headline (legacy key)
    if (lap > 1) { // not the rolling-start opening lap
      achievements.banner('NEW LAP RECORD', `${trackDef.name} · ${fmt(time)}`, '#7df9ff', '⏱️');
      achievements.unlock('record');
      const heldRecords = TRACKS.filter((t) => Number.isFinite(bestLap(t.id))).length;
      if (heldRecords >= 3) achievements.unlock('record_3');
      if (heldRecords >= TRACKS.length) achievements.unlock('all_records');
    }
  }
  // Clearing a loop track's lap counts as clearing a loop.
  if (lap > 1 && (trackDef.id === 'coral-keys' || trackDef.id === 'skyline-rush')) {
    achievements.unlock('loop');
    if (achievements.addToSet('loopsCleared', trackDef.id) >= 2) achievements.unlock('loop_master');
  }
  if (selection.mode === 2) {
    // Time Trial never ends — keep lapping the ghost until the player quits.
  } else if (lap === TOTAL_LAPS) {
    hud.flashCenter('FINAL LAP', 1300);
    fireMeteor(); // crown the last lap with a meteor arcing across the desert sky
  } else if (lap > TOTAL_LAPS) {
    state = 'finished';
    playerFinishTime = race.clock;
    finishedView = 'race';
    // Best full-race/total time, sanity-floored. Recorded per mode (incl. TT now);
    // the overall race-record banner still fires for the competitive modes only.
    if (playerFinishTime > 60) {
      saveRec(trackDef.id, selection.mode, 'total', playerFinishTime);
      if (selection.mode !== 2) {
        const rk = `sv-racebest-${trackDef.id}`;
        const rPrev = parseFloat(localStorage.getItem(rk) || 'Infinity');
        if (playerFinishTime < rPrev) {
          localStorage.setItem(rk, playerFinishTime.toFixed(3));
          achievements.banner('NEW RACE RECORD', `${trackDef.name} · ${fmt(playerFinishTime)}`, '#ff2ec8', '🏁');
        }
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
  // Repaint button prompts when the player switches device (keyboard ↔ pad, or
  // a different pad kind) — cheap, only fires on an actual change.
  if (input.lastDevice !== _promptDev || input.padKind !== _promptKind) {
    _promptDev = input.lastDevice; _promptKind = input.padKind;
    refreshPrompts();
    // Repaint the boards that bake glyphs in (results / standings / podium sub).
    if (state === 'finished') hud.showResults(finishedView === 'standings' ? buildStandingsView() : buildResultsView());
    else if (state === 'podium') { const sub = podiumTitleEl.querySelector('.pt-sub'); if (sub) sub.innerHTML = `${glyph('confirm')} — STANDINGS`; }
    // CONTROLS list bakes pad-family glyphs into the PAD column — repaint it too.
    if (menu.sec === 'controls' && menu.view === 'section' && !input.capturing()) renderControlsList();
  }
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
        // Arm the first-race tips (this race only); never onboard again after.
        onbThisRace = onboarding;
        if (onboarding) {
          onboarding = false;
          try { localStorage.setItem('sv-onboarded', '1'); } catch (e) { /* ignore */ }
          onbBoostShown = false; // the boost-pad tip can still fire once on this first race
        }
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
    // The player ship keeps racing too (auto-driven), so it joins the field and
    // boosts on pads instead of standing still. The lap guard keeps its finish
    // time frozen even though it keeps crossing the line.
    if (!postRaceDriver || postRaceDriver.sp !== spline) postRaceDriver = new AiDriver(spline, POSTRACE_SKILL, 7);
    simInput = postRaceDriver.update(realDt, ship);
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
    let firePending = state === 'race' && input.consumeAction('fire');
    while (accumulator >= FIXED_DT && guard-- > 0) {
      race.computeDraft(ship); // slipstream targets from current positions
      ship.step(FIXED_DT, simInput);
      race.stepFixed(FIXED_DT, state === 'race' || state === 'finished');
      race.interact(ship, FIXED_DT);
      if (weapons) { weapons.stepFixed(FIXED_DT, state === 'race' || state === 'finished', firePending); firePending = false; }
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
  if (state === 'race') updateNearMiss(realDt); // feeds camPunch (rig.update) + the whoosh
  // Lean the hull from the live input in race, and from the post-race AI's input
  // while the ship auto-races the finish, so it still banks into corners.
  const visInput = state === 'race' ? input : (state === 'finished' ? simInput : NULL_INPUT);
  shipVisual.update(dt, ship, visInput, juice.boostFactor);
  if (ghost) {
    const ghosting = state === 'race' && selection.mode === 2;
    if (ghosting) ghost.sample(ship.lapTime, ship.s, ship.d, ship.h); // record this lap
    ghost.update(ship.lapTime, ghosting);                              // replay the best behind/ahead
    hud.setGhostDelta(ghosting ? ghost.deltaAt(ship.s, ship.lapTime) : null);
  }
  race.updateVisuals(dt, camera);
  if (weapons) weapons.updateVisuals(dt, camera);
  updateBanter(dt);
  trails.push(0, shipVisual.getNozzleWorld(0, _v));
  trails.push(1, shipVisual.getNozzleWorld(1, _v));
  // (Ground dust removed — it read as ugly golden cube/squares behind the ship.)
  // Trackside broadcast cam during the live results reveal: follow the next car
  // still racing to the line; once the whole field is in, settle on the player.
  // (Not behind the championship standings board — finishedView gates it.)
  if (state === 'finished' && finishedView === 'race') {
    rig.startShowcase();
    showcaseHoldT += realDt;
    // The car still racing that's nearest the line.
    let best = null, bestProg = -Infinity;
    for (const r of race.racers) {
      if (r.finishTime !== null) continue;
      const p = race.progressOf(r.phys);
      if (p > bestProg) { bestProg = p; best = r.phys; }
    }
    const fr = race.racers.find((r) => r.phys === showcaseFocus);
    const focusFinished = !!fr && fr.finishTime !== null;
    // Pace the cuts so a field finishing in a stream doesn't strobe the camera:
    //  • no subject yet, or it left the grid  → cut now;
    //  • the subject just crossed the line     → linger ~1.6s on the finish, THEN cut;
    //  • someone's run away up front           → only cut after a minimum dwell.
    let switchTo = null;
    if (!showcaseFocus || !fr) switchTo = best || ship;
    else if (focusFinished && showcaseHoldT > 1.6) switchTo = best || ship;
    else if (best && !focusFinished && showcaseHoldT > 3.0
      && bestProg > race.progressOf(showcaseFocus) + 12) switchTo = best;
    if (switchTo && switchTo !== showcaseFocus) {
      showcaseFocus = switchTo; showcaseHoldT = 0;
      rig.cutShowcase(); // clean broadcast CUT, not a swing across the track
    }
    rig.showcaseTarget = showcaseFocus || ship;
  } else { rig.stopShowcase(); showcaseFocus = null; showcaseHoldT = 0; }
  rig.update(dt, ship, state === 'race' ? input : NULL_INPUT, juice,
    input.airbrake && state === 'race' && ship.v > 5);
  if (debugCam) applyDebugCam();
  sparks.update(dt);
  _shock.update(dt, camera);
  _fireball.update(dt, camera);
  _smoke.update(dt, camera);
  audio.disableHum(state === 'race' && ship.disabledT > 0); // paralysis buzz while you're hit
  trails.update(dt, camera, juice.boostFactor, sn);
  // Engine light-pool on the road behind the ship (throttle + boost, cyan->white).
  const poolGlow = (state === 'race' || state === 'countdown')
    ? Math.min(1.1, input.throttle * 0.55 + juice.boostFactor * 0.95) : 0;
  _engPool.setHex(shipVisual ? shipVisual.engBase : T.COL.ENGINE).lerp(_WHITE_C, juice.boostFactor * 0.15); // road wake runs the ship's glow hue (hint hotter on boost)
  const nozOff = shipVisual && shipVisual.nozzles[0] ? Math.abs(shipVisual.nozzles[0].x) : 1.05;
  track.update(now / 1000, sn, ship.s, ship.d, poolGlow, _engPool, nozOff,
    weapons ? weapons.padCd : null, state === 'race' && ship.heldWeapon != null);
  const raceProgress = state === 'race'
    ? Math.max(0, Math.min(1, ((ship.lap - 1) + ship.s / spline.length) / TOTAL_LAPS))
    : 0;
  updateSunGate(realDt); // sun-gate bloom + scripted last-lap meteor (desert)
  scenery.update(now / 1000, camera.position, raceProgress, _sunFlare, _meteorT, _meteorAz);

  // Fog breathes with speed; boost closes the world into a tunnel.
  if (!debugCam) {
    scene.fog.far = T.FOG_FAR - T.FOG_SPEED_PULL * sn - T.FOG_BOOST_PULL * juice.boostFactor;
  }

  // Keep the gameplay HUD off the title/menu screens (console front-end feel).
  document.body.classList.toggle('in-menu', state === 'intro' || state === 'attract');
  // Post-race: drop the driving instruments (speed + boost) so the trackside
  // broadcast reads clean behind the bottom results board.
  document.body.classList.toggle('spectating', state === 'finished');
  pauseBtn.classList.toggle('hidden', !((state === 'race' || state === 'countdown') && !paused));
  // Slipstream cue fades in with the draft (readable feedback for the tow).
  slipEl.style.opacity = state === 'race' ? Math.max(0, Math.min(1, (ship.draft - 0.25) / 0.4)) : 0;
  hud.update(realDt, ship, selection.mode === 2 ? 0 : TOTAL_LAPS); // TT: open-ended laps
  audio.updateEngine(realDt, sn, state === 'race' ? input.throttle : 0,
    juice.boostFactor, state !== 'attract');
  audio.updateShield(realDt, state === 'race' && ship.shielded); // brummande sköld-drönare medan bubblan är uppe
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
  if (row === 'tweak') return; // the garage-jump row has no value to edit
  const n = (mod, cur, d) => ((cur + d) % mod + mod) % mod;
  if (row === 'track') {
    if (selection.mode !== 0) { trackIndex = n(TRACKS.length, trackIndex, dir); buildWorld(trackIndex); }
  } else if (row === 'class') {
    // Championship gates class to what you've unlocked (progression); Single/TT
    // let you pick any class — free play. The unlock ladder still only advances
    // by winning cups, so Championship keeps its purpose.
    const maxCls = selection.mode === 0 ? unlockedClasses() : CLASSES.length - 1;
    selection.classIdx = Math.max(0, Math.min(maxCls, selection.classIdx + dir));
    buildField();
  } else if (row === 'difficulty') {
    selection.difficulty = n(DIFFICULTIES.length, selection.difficulty, dir);
    buildField();
  } else if (row === 'team') {
    selection.team = n(TEAMS.length, selection.team, dir); buildField();
  } else if (row === 'pilot') {
    selection.pilot = n(2, selection.pilot, dir);   // which of the team's 2 drivers you are —
    buildField();                                   // each driver wears their own signature livery
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
  } else if (row === 'pilotintro') {
    introMode = INTRO_MODES[n(INTRO_MODES.length, INTRO_MODES.indexOf(introMode), dir)];
    localStorage.setItem('sv-intro', introMode);
  } else if (row === 'banter') {
    banterOn = !banterOn; banter.setEnabled(banterOn);
    localStorage.setItem('sv-banter', banterOn ? 'on' : 'off');
  } else if (row === 'tier') {
    trophyTier = TROPHY_FILTERS[n(TROPHY_FILTERS.length, TROPHY_FILTERS.indexOf(trophyTier), dir)];
  }
  updateMenu();
}

// Start the race for the current selection (mode set on section entry).
function startRace() {
  if (selection.mode === 0) {
    champ.active = true; champ.round = 0; champ.done = 0;
    // Championship is gated by the unlock ladder — clamp here so a class picked
    // freely in Single/TT (shared selection.classIdx) can't leak into a cup.
    selection.classIdx = Math.min(selection.classIdx, unlockedClasses());
    champ.classIndex = selection.classIdx;
    champ.entry = { team: selection.team, pilot: selection.pilot };
    champ.unlockMsg = null; champ.points.clear();
    saveChamp();                       // overwrite any stale cup so a reload can't load the old one
    achievements.unlock('champ_play');
    if (trackIndex !== 0) { trackIndex = 0; buildWorld(0); }
  } else {
    champ.active = false;
  }
  hud.setCenter(null);
  startCountdown();
}

// Continue a saved cup at its current round, keeping standings. Snaps the entry/
// class back to what the cup was started with so the grid ids match the points.
function resumeChamp() {
  selection.classIdx = champ.classIndex;
  if (champ.entry) { selection.team = clampInt(String(champ.entry.team), TEAMS.length); selection.pilot = champ.entry.pilot & 1; }
  champ.round = champ.done;
  trackIndex = champ.round;
  buildWorld(trackIndex);
  hud.setCenter(null);
  startCountdown();
}

// Close any armed key-capture (called when leaving / re-entering CONTROLS).
function closeRebind() {
  input.cancelCapture();
  const cap = document.getElementById('rebind-capture'); if (cap) cap.classList.add('hidden');
  document.querySelectorAll('#ctl-list .kb-row.binding').forEach((r) => r.classList.remove('binding'));
}

// Arm a capture for the action at `idx` (or reset, on the last row). Driving/
// action rows take a key OR a pad input; the menu confirm/back rows are pad-only
// (their keyboard side is fixed), so they capture a button/axis exclusively.
function beginRebind(idx) {
  closeRebind();
  if (idx >= CTL_ROWS.length) {          // the RESET TO DEFAULTS row
    input.resetBindings(); renderControlsList(); audio.uiSelect();
    return;
  }
  const action = CTL_ROWS[idx];
  const padOnly = !!action.kbFixed;
  setTxt('rebind-action', `BIND: ${action.label}`);
  setTxt('rebind-prompt', padOnly ? 'PRESS A BUTTON' : 'PRESS A KEY OR BUTTON');
  document.getElementById('rebind-capture')?.classList.remove('hidden');
  const rows = document.querySelectorAll('#ctl-list .kb-row');
  rows.forEach((r, i) => r.classList.toggle('binding', i === idx));
  input.beginCapture((bind) => {
    closeRebind();
    if (typeof bind === 'string') {                          // a keyboard code
      if (bind === 'Backspace' || bind === 'Escape') { audio.uiMove(); return; } // silent cancel
      if (input.isReserved(bind)) { audio.uiMove(); renderControlsList(); return; }
      input.setBinding(action.id, bind);                     // clears it elsewhere
    } else {
      input.setPadBinding(action.id, bind);                  // a pad descriptor
    }
    audio.uiSelect();
    renderControlsList();
  }, padOnly ? 'pad' : 'any');
}

// Entering a section sets the mode (race sections) and resizes the garage stage.
function onSectionEnter(sec) {
  closeRebind();
  if (sec === 'championship') {
    selection.mode = 0;
    const saved = readSavedChamp();    // make the shown entry/class/track match what RESUME will run
    if (saved) {
      selection.classIdx = clampInt(String(saved.classIndex), CLASSES.length);
      if (saved.entry && typeof saved.entry.team === 'number') {
        selection.team = clampInt(String(saved.entry.team), TEAMS.length);
        selection.pilot = saved.entry.pilot & 1;
      }
    } else {
      // No cup in progress: gate the class to the unlock ladder, so a class
      // picked freely in Single/TT doesn't carry into a fresh championship.
      selection.classIdx = Math.min(selection.classIdx, unlockedClasses());
    }
    const previewIdx = saved ? saved.done : 0;
    if (trackIndex !== previewIdx) { trackIndex = previewIdx; buildWorld(previewIdx); } else buildField();
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
    if (sec === 'championship' && readSavedChamp()) { loadChamp(); resumeChamp(); return; } // continue the cup
    startRace();
    return;
  }
  if (row === 'newcup') { // discard the saved cup and start a fresh one
    selection.mode = 0; localStorage.setItem('sv-mode', '0');
    startRace();
    return;
  }
  if (row === 'reclist') return;  // the detail already reflects the selection
  if (row === 'ctllist') { beginRebind(menu.ctlSel); return; }
  if (row === 'tweak') { menu.enterSection('garage'); onSectionEnter('garage'); return; } // jump to the garage
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
  // leave fullscreen, so we never use it (gamepad B emits Backspace too).
  else if (input.consume('Backspace')) backPause();
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

  // Pre-race pilot intro card: any confirm/skip button dismisses it; swallow
  // everything else so the menu/pause behind it can't react while it's up.
  if (introActive) {
    if (input.consume('Enter') || input.consume('Space') || input.consume('Backspace')
      || input.consumeAction('confirm') || input.consumeAction('pause')) dismissIntro();
    return;
  }

  // The pause menu owns all input while open; otherwise P (or gamepad Start) opens
  // it mid-race. NOT Escape — the browser steals it to leave fullscreen.
  if (paused) { applyPauseKeys(); return; }
  if ((state === 'race' || state === 'countdown') && input.consumeAction('pause')) {
    openPause(); // also during the countdown, so you can abort before GO
    return;
  }

  if (state === 'attract') {
    // The console menu owns all attract input (nav up/down, enter, edit, back).
    for (const code of ['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'Enter', 'Backspace']) {
      if (input.consume(code)) applyMenuKey(code);
    }
    return;
  }
  if (input.consume('Enter')) onEnter();
  // Back out to the menu from results/finished — Backspace (keyboard) or gamepad B
  // (also Backspace). NOT in race (there you pause with Start), NOT attract (menu owns it).
  if (input.consume('Backspace') && state !== 'attract' && state !== 'race') onEscape();
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
    const lap = bestLap(t.id);
    const raceT = bestTotal(t.id);
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
      clearChamp(); // championship complete — wipe the saved cup, back to the menu
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
  introArmed = true; // a fresh race sequence hails again
  // Land on the console-menu nav rail (DEPTH 0), not deep in a section on the
  // GO row — otherwise the next ENTER re-activates GO and relaunches the race.
  menu.toNav();
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
    if (rowEl.classList.contains('go-btn')) rowEl.addEventListener('click', () => { focus(); activateRow(row); });
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
  pauseBtn.addEventListener('click', () => { if ((state === 'race' || state === 'countdown') && !paused) openPause(); });
}

// ------------------------------------------------------------------- boot
if (selection.mode === 0) trackIndex = 0; // championship always opens on round 1
buildWorld(trackIndex);
hud.showOverlay(true);
applyReducedMotion();
wireClicks();
refreshPrompts(); // paint the initial (keyboard) button prompts before the first frame
_promptDev = input.lastDevice; _promptKind = input.padKind; // seed so the first tick isn't a redundant repaint
requestAnimationFrame((t) => { last = t; tick(t); });

// Dev/debug hook: lets tooling (and tuning sessions) step the sim without
// relying on rAF, which browsers throttle in background tabs.
window.__game = {
  get ship() { return ship; },
  get shipVisual() { return shipVisual; },
  get rig() { return rig; },
  get spline() { return spline; },
  get trackDef() { return trackDef; },
  get race() { return race; },
  get ghost() { return ghost; },
  get podiumScene() { return podiumScene; },
  get menuPodium() { return podium; },
  get pauseMenu() { return pauseMenu; },
  get weapons() { return weapons; },
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
        return { name: 'YOU', player: true, variant: { ...pTeam.variant, ...liveryOf(pTeam, selection.pilot) } };
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
    podiumTitleEl.querySelector('.pt-sub').innerHTML = `${glyph('confirm')} — STANDINGS`;
    podiumTitleEl.classList.remove('hidden');
    audio.championFanfare();
    return 'podium demo, rank ' + rank;
  },
  champ,
  selection,
  start: () => { introArmed = false; hud.setCenter(null); startCountdown(); state = 'race'; },
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
