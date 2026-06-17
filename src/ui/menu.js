// The attract-screen menu: track picker (with top-down thumbnail + elevation
// profile), team picker (stat bars + blurb), livery and callsign pickers.
// Navigation: up/down moves focus, left/right edits, Enter races.
import { TEAMS, CALLSIGNS } from '../worlds/teams.js';
import { fmt } from './hud.js';

const ROWS = ['mode', 'track', 'class', 'difficulty', 'team', 'livery', 'pilot', 'audio', 'records', 'trophies'];

export class Menu {
  constructor() {
    this.focus = 0;
    this.el = {
      world: document.getElementById('menu-world'),
      track: document.getElementById('menu-track'),
      best: document.getElementById('menu-best'),
      team: document.getElementById('menu-team'),
      blurb: document.getElementById('menu-blurb'),
      stats: document.getElementById('menu-stats'),
      livery: document.getElementById('menu-livery'),
      pilot: document.getElementById('menu-pilot'),
      class: document.getElementById('menu-class'),
      classLock: document.getElementById('menu-class-lock'),
      difficulty: document.getElementById('menu-difficulty'),
      volume: document.getElementById('menu-volume'),
      thumb: document.getElementById('menu-thumb'),
      profile: document.getElementById('menu-profile'),
      rows: ROWS.map((r) => document.getElementById(`row-${r}`)),
    };
    this._applyFocus();
  }

  // Returns {row, dir} when the key edits a value, true when consumed, null otherwise.
  handleKey(code) {
    if (code === 'ArrowUp' || code === 'KeyW') {
      this.focus = (this.focus + ROWS.length - 1) % ROWS.length;
      this._applyFocus();
      return true;
    }
    if (code === 'ArrowDown' || code === 'KeyS') {
      this.focus = (this.focus + 1) % ROWS.length;
      this._applyFocus();
      return true;
    }
    const dir = (code === 'ArrowRight' || code === 'KeyD') ? 1
      : (code === 'ArrowLeft' || code === 'KeyA') ? -1 : 0;
    if (dir !== 0) return { row: ROWS[this.focus], dir };
    return null;
  }

  _applyFocus() {
    this.el.rows.forEach((el, i) => el.classList.toggle('focus', i === this.focus));
  }

  // The id of the currently focused row — lets main route the confirm button.
  currentRow() { return ROWS[this.focus]; }

  // data: { trackDef, theme, spline, trackIndex, trackCount, best, selection,
  //         volume, mode, championship }
  render(data) {
    const { trackDef, theme, spline, trackIndex, trackCount, best, selection } = data;
    for (let i = 0; i < 3; i++) {
      document.getElementById(`mode-${i}`).classList.toggle('sel', data.mode === i);
    }
    const champ = data.mode === 0;
    document.getElementById('row-track').classList.toggle('locked', champ);
    this.el.world.textContent = theme.name;
    this.el.track.textContent = champ
      ? `ROUND 1/${trackCount}  ·  ${trackDef.name}`
      : `${trackDef.name}  ·  ${trackIndex + 1}/${trackCount}`;
    this.el.best.textContent = Number.isFinite(best) ? `RECORD ${fmt(best)}` : 'NO RECORD SET';

    // Speed class row: name + headline top speed, with a lock hint if the
    // next class isn't earned yet.
    const cls = data.cls;
    this.el.class.innerHTML = `<span style="color:#${hex(cls.color)}">${cls.name}</span>`
      + `<small>${data.classKmh} KM/H</small>`;
    this.el.classLock.textContent = data.classLockHint || '';
    this.el.classLock.classList.toggle('hidden', !data.classLockHint);

    // Rival difficulty: name in its tier color + a one-word feel tag. Always
    // available — no lock hint (unlike speed class).
    const diff = data.diff;
    this.el.difficulty.innerHTML = `<span style="color:#${hex(diff.color)}">${diff.name}</span>`
      + `<small>${diff.tag}</small>`;

    const team = TEAMS[selection.team];
    this.el.team.textContent = team.fullName.toUpperCase();
    this.el.blurb.textContent = team.blurb;
    this.el.stats.innerHTML = ['speed', 'thrust', 'handling'].map((k) => `
      <div class="stat"><label>${k.toUpperCase()}</label>${bar(team.bars[k])}</div>`).join('');

    // Liveries: the team's two, plus the prestige champion livery if unlocked.
    const liveries = team.liveries.slice();
    if (data.liveryCount > 2) liveries.push(data.championLivery);
    this.el.livery.innerHTML = liveries.map((lv, i) => `
      <span class="swatch-pair${i === selection.livery ? ' sel' : ''}${i === 2 ? ' champ' : ''}">
        <i style="background:#${hex(lv.hull)}"></i><i style="background:#${hex(lv.accent)}"></i>
      </span>`).join('');

    this.el.pilot.textContent = CALLSIGNS[selection.pilot];

    let volCells = '';
    for (let i = 0; i < 10; i++) volCells += `<i class="${i < data.volume ? 'on' : ''}"></i>`;
    this.el.volume.innerHTML = `<span class="bar">${volCells}</span>`;

    drawThumb(this.el.thumb, spline, theme);
    drawProfile(this.el.profile, spline, theme);
  }
}

function bar(n) {
  let cells = '';
  for (let i = 0; i < 5; i++) cells += `<i class="${i < n ? 'on' : ''}"></i>`;
  return `<span class="bar">${cells}</span>`;
}

function hex(c) {
  return c.toString(16).padStart(6, '0');
}

// Top-down outline of the track, fitted to the canvas.
function drawThumb(canvas, spline, theme) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = 104, H = 92;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < spline.n; i++) {
    const x = spline.pos[i * 3], z = spline.pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const pad = 10;
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2, oz = (H - (maxZ - minZ) * sc) / 2;

  ctx.beginPath();
  const step = Math.max(1, Math.round(6 / spline.step));
  for (let i = 0; i <= spline.n; i += step) {
    const j = (i % spline.n) * 3;
    const x = ox + (spline.pos[j] - minX) * sc;
    const y = oz + (spline.pos[j + 2] - minZ) * sc;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(30, 14, 70, 0.9)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.8;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.9)';
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // start tick
  const tx = ox + (spline.pos[0] - minX) * sc, ty = oz + (spline.pos[2] - minZ) * sc;
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(tx - 2.5, ty - 2.5, 5, 5);
}

// Elevation profile: height along the lap — hills, dives and loop spikes.
function drawProfile(canvas, spline, theme) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = 196, H = 46;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < spline.n; i++) {
    const y = spline.pos[i * 3 + 1];
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = Math.max(maxY - minY, 10);
  const px = (i) => 4 + (i / spline.n) * (W - 8);
  const py = (y) => H - 7 - ((y - minY) / span) * (H - 14);

  ctx.beginPath();
  ctx.moveTo(px(0), H - 4);
  const step = Math.max(1, Math.round(8 / spline.step));
  for (let i = 0; i <= spline.n; i += step) {
    ctx.lineTo(px(Math.min(i, spline.n)), py(spline.pos[(i % spline.n) * 3 + 1]));
  }
  ctx.lineTo(px(spline.n), H - 4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 240, 255, 0.16)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i <= spline.n; i += step) {
    const x = px(Math.min(i, spline.n));
    const y = py(spline.pos[(i % spline.n) * 3 + 1]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#7df9ff';
  ctx.lineWidth = 1.6;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.8)';
  ctx.shadowBlur = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;
}
