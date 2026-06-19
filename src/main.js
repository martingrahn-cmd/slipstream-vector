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
import { Input, NULL_INPUT } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { Race } from './race.js';
import { Menu } from './ui/menu.js';
import { Podium } from './ui/podium.js';
import { PodiumScene } from './ui/podiumScene.js';
import { PauseMenu } from './ui/pauseMenu.js';
import { Achievements } from './ui/achievements.js';
import { TEAMS, CALLSIGNS } from './worlds/teams.js';
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
  pilot: clampInt(localStorage.getItem('sv-pilot'), CALLSIGNS.length),
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
    callsign: CALLSIGNS[selection.pilot],
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

  spline = new TrackSpline(trackDef);
  track = buildTrackMesh(spline, theme);
  scene.add(track.group);
  scenery = buildScenery(spline, scene, theme);
  scene.add(scenery.group);
  buildField();
  rig = new CameraRig(spline, camera);
  minimap = new Minimap(spline, document.getElementById('minimap'));
  scene.fog.color.setHex(theme.fog);
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
  }
  if (race) race.dispose(scene);
  const team = TEAMS[selection.team];
  const cls = CLASSES[selection.classIdx];
  const variant = { ...team.variant, ...liveryOf(team, selection.livery) };
  ship = new ShipPhysics(spline, juice, team.stats, cls);
  shipVisual = new ShipVisual(spline, scene, variant);
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

function updateMenu() {
  const unlocked = unlockedClasses();
  const cls = CLASSES[selection.classIdx];
  menu.render({
    trackDef, theme, spline,
    trackIndex, trackCount: TRACKS.length,
    best: parseFloat(localStorage.getItem(bestKey()) || 'NaN'),
    selection,
    volume: audio.volume,
    mode: selection.mode,
    cls,
    classKmh: classKmh(cls, T.VMAX),
    diff: DIFFICULTIES[selection.difficulty],
    // The next locked class and what unlocks it — shown as a hint.
    classLockHint: selection.classIdx >= unlocked && unlocked < CLASSES.length - 1
      ? `WIN ${CLASSES[unlocked].name} CUP` : null,
    liveryCount: liveryCount(),
    championLivery: CHAMPION_LIVERY,
  });
}

// ------------------------------------------------------ result/standing views
function buildResultsView() {
  const rows = race.results(ship, playerFinishTime);
  const place = rows.findIndex((r) => r.player) + 1;
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
  const display = rows.map((r, i) => ({
    name: r.name, accent: r.accent, player: r.player,
    live: r.time === null,
    right1: r.time !== null ? fmt(r.time) : 'RACING…',
    ...(champ.active ? { right2: `+${CHAMP_PTS[i] ?? 0}` } : {}),
  }));
  return {
    tag: champ.active
      ? `CHAMPIONSHIP · ROUND ${champ.round + 1}/${TRACKS.length} · ${trackDef.name.toUpperCase()}`
      : trackDef.name.toUpperCase(),
    title: place === 1 ? 'YOU WIN' : `P${place}`,
    rows: display,
    footer: champ.active
      ? 'ENTER — STANDINGS'
      : 'ENTER — RACE AGAIN &nbsp;·&nbsp; ESC — MENU',
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
juice.on('wallHit', ({ side, severity }) => {
  spline.frameAt(ship.s, _f);
  _v.copy(_f.pos).addScaledVector(_f.R, side * (_f.width - T.WALL_MARGIN + 0.6)).addScaledVector(_f.U, 0.5);
  _vel.copy(_f.T).multiplyScalar(ship.v * 0.5);
  sparks.spawn(_v, _vel, 14 + severity * 10, T.SPARK_HIT_COUNT);
  if (state === 'race') tally.wallHits++;
});
let scrapeAcc = 0;
juice.on('scrape', () => { scrapeAcc += T.SPARK_SCRAPE_RATE * FIXED_DT; });
const _boostColA = new THREE.Color(T.COL.ENGINE);
const _boostColB = new THREE.Color(0xffffff);
juice.on('boost', ({ pad } = {}) => {
  _vel.set(0, 1.5, 0);
  sparks.spawn(shipVisual.root.position, _vel, 9, 26, _boostColA, _boostColB);
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
  sparks.spawn(shipVisual.root.position, _vel, 7, 8 + Math.round(severity * 14), _bumpColA, _bumpColB);
  if (state === 'race') tally.contacts++;
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
  race.grid();
  juice.trauma = 0; juice.boostFactor = 0;
  state = 'countdown';
  countdownT = 3.2;
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
  audio.stopMusic();
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
      audio.playMusic(theme.music); // each world has its own music slot
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
    sparks.spawn(_v, _vel, 6, n);
  }

  // Visuals.
  const sn = ship.speedNorm;
  shipVisual.update(dt, ship, state === 'race' ? input : NULL_INPUT, juice.boostFactor);
  race.updateVisuals(dt);
  trails.push(0, shipVisual.getNozzleWorld(0, _v));
  trails.push(1, shipVisual.getNozzleWorld(1, _v));
  rig.update(dt, ship, state === 'race' ? input : NULL_INPUT, juice,
    input.airbrake && state === 'race' && ship.v > 5);
  if (debugCam) applyDebugCam();
  speedLines.update(dt, ship.v, sn, juice.boostFactor, shipVisual.root.position);
  sparks.update(dt);
  trails.update(dt, camera, juice.boostFactor, sn);
  track.update(now / 1000);
  scenery.update(now / 1000, camera.position);

  // Fog breathes with speed; boost closes the world into a tunnel.
  if (!debugCam) {
    scene.fog.far = T.FOG_FAR - T.FOG_SPEED_PULL * sn - T.FOG_BOOST_PULL * juice.boostFactor;
  }

  // Keep the gameplay HUD off the title/menu screens (console front-end feel).
  document.body.classList.toggle('in-menu', state === 'intro' || state === 'attract');
  hud.update(realDt, ship, TOTAL_LAPS);
  audio.updateEngine(realDt, sn, state === 'race' ? input.throttle : 0,
    juice.boostFactor, state !== 'attract');
  audio.updateOpponentEngines(realDt,
    state === 'race' ? race.racers.map((r) => r.phys) : null,
    ship.s, spline.length, state === 'race');
  if (state === 'attract' || state === 'intro') {
    podium.update(realDt);
    if (audio.ctx && audio._wantKey !== 'menu') audio.playMusic('menu');
    if (!debugCam) attractCamera(now / 1000);
  }
  if (state === 'race' && selection.mode !== 2) hud.setPosition(race.positionOf(ship), 8);
  minimap.update(shipVisual.root.position, ship.boosting, now / 1000, race.minimapDots(_dots));
  postfx.update(sn, juice);
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

function applyMenuKey(code) {
  const act = menu.handleKey(code);
  if (act && act.row) {
    const n = (mod, cur, dir) => ((cur + dir) % mod + mod) % mod;
    if (act.row === 'mode') {
      selection.mode = n(MODES.length, selection.mode, act.dir);
      localStorage.setItem('sv-mode', String(selection.mode));
      if (selection.mode === 0 && trackIndex !== 0) {
        trackIndex = 0;
        buildWorld(0);
      } else {
        buildField(); // the menu backdrop field follows the mode (solo in TT)
      }
    } else if (act.row === 'track') {
      if (selection.mode !== 0) { // locked to the roster in championship
        trackIndex = n(TRACKS.length, trackIndex, act.dir);
        buildWorld(trackIndex);
      }
    } else if (act.row === 'class') {
      // Clamp to what's been unlocked; nudging past it just bumps the lock hint.
      const next = selection.classIdx + act.dir;
      selection.classIdx = Math.max(0, Math.min(unlockedClasses(), next));
      buildField();
    } else if (act.row === 'difficulty') {
      selection.difficulty = n(DIFFICULTIES.length, selection.difficulty, act.dir);
      buildField(); // rebuilds the AI field with the new skill level
    } else if (act.row === 'team') {
      selection.team = n(TEAMS.length, selection.team, act.dir);
      buildField();
    } else if (act.row === 'livery') {
      selection.livery = n(liveryCount(), selection.livery, act.dir);
      buildField();
    } else if (act.row === 'pilot') {
      selection.pilot = n(CALLSIGNS.length, selection.pilot, act.dir);
      localStorage.setItem('sv-pilot', String(selection.pilot));
    } else if (act.row === 'audio') {
      audio.setVolume(audio.volume + act.dir);
    }
    updateMenu();
  }
  // The footer reflects what the confirm button will do on the focused row.
  const row = menu.currentRow();
  document.getElementById('menu-go').innerHTML = row === 'records'
    ? 'ENTER &mdash; VIEW RECORDS'
    : row === 'trophies' ? 'ENTER &mdash; VIEW TROPHIES' : 'ENTER &mdash; RACE';
  audio.uiMove();
}

// ---- pause menu -----------------------------------------------------------
function openPause() {
  paused = true;
  document.body.classList.add('paused');
  audio.setPaused(true);
  pauseMenu.open(audio.volume, !!document.fullscreenElement);
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
        audio.setVolume(audio.volume + dir); audio.uiMove();
      }
    }
  }
  if (input.consume('KeyP')) resumeRace();        // P toggles pause off
  else if (input.consume('Enter')) confirmPause();
  else if (input.consume('Escape')) backPause();
  if (paused) pauseMenu.render(audio.volume, !!document.fullscreenElement);
}

function handleKeys() {
  // Title gate: Enter/Space reveals the menu, console-style.
  if (state === 'intro') {
    if (input.consume('Enter') || input.consume('Space')) {
      state = 'attract';
      overlayEl.classList.remove('intro');
      revealMenu();
      audio.uiSelect();
    }
    return;
  }

  // The pause menu owns all input while open; otherwise Esc or P opens it mid-race.
  if (paused) { applyPauseKeys(); return; }
  if (state === 'race' && (input.consume('Escape') || input.consume('KeyP'))) {
    openPause();
    return;
  }

  if (state === 'attract') {
    // A panel open? Confirm/back closes it; nav is suspended underneath.
    if (recordsOpen || trophiesOpen) {
      if (input.consume('Enter') || input.consume('Escape')) { closePanels(); audio.uiMove(); }
      return;
    }
    if (input.consume('Escape')) closePanels();
    for (const code of ['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD']) {
      if (input.consume(code)) applyMenuKey(code);
    }
  }
  if (input.consume('Enter')) onEnter();
  if (input.consume('Escape') && state !== 'attract') onEscape();
  if (input.consume('KeyR') && state === 'race') {
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
    if (recordsOpen || trophiesOpen) { closePanels(); return; }
    // The confirm button activates the focused row: open a panel, or race.
    const row = menu.currentRow();
    if (row === 'records') { toggleRecords(); audio.uiSelect(); updateMenu(); return; }
    if (row === 'trophies') { toggleTrophies(); audio.uiSelect(); updateMenu(); return; }
    audio.uiSelect();
    if (selection.mode === 0) {
      champ.active = true;
      champ.round = 0;
      champ.classIndex = selection.classIdx;
      champ.unlockMsg = null;
      champ.points.clear();
      achievements.unlock('champ_play');
      if (trackIndex !== 0) { trackIndex = 0; buildWorld(0); }
    } else {
      champ.active = false;
    }
    hud.setCenter(null);
    startCountdown();
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
  if (e.code === 'KeyF' && !e.repeat) toggleFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  fsBtn.title = document.fullscreenElement ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
});

// ------------------------------------------------------------------- boot
if (selection.mode === 0) trackIndex = 0; // championship always opens on round 1
buildWorld(trackIndex);
hud.showOverlay(true);
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
