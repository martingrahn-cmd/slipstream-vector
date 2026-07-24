// "THE BAY" console menu controller: a left nav rail of sections, navigated
// up/down (DEPTH 0); ENTER drops focus into the section's middle-column rows
// (DEPTH 1); ←→ edit, ENTER activates, Backspace/Esc returns to the rail. Pure
// structure/navigation/focus — main.js owns the data fill and the actions.

const NAV = ['championship', 'single', 'time', 'garage', 'options', 'controls', 'records', 'trophies'];
// Ordered focusable rows per section (data-row values). 'go' = the action button.
const STAGE = {
  championship: ['cup', 'class', 'difficulty', 'tweak', 'go'],
  single: ['track', 'class', 'difficulty', 'tweak', 'go'],
  time: ['track', 'class', 'tweak', 'go'],
  garage: ['team', 'pilot'],
  options: ['music', 'sfx', 'voice', 'deadzone', 'rumble', 'fullscreen', 'motion', 'pilotintro', 'banter'],
  controls: ['ctllist'],
  records: ['reclist'],
  trophies: ['tier'],
};

export class Menu {
  constructor() {
    this.view = 'nav';          // 'nav' | 'section'
    this.navFocus = 3;          // default land on GARAGE
    this.rowFocus = 0;
    this._champResume = false;  // true when a saved cup adds the NEW CUP row
    this.recSel = 0;            // selected track row in RECORDS
    this.recCount = 6;
    this.ctlSel = 0;            // selected action row in CONTROLS
    this.ctlCount = 8;
    this.navEls = {};
    document.querySelectorAll('#nav-list .navitem').forEach((b) => { this.navEls[b.dataset.sec] = b; });
    this.sectionEls = {};
    document.querySelectorAll('#bay .section').forEach((s) => { this.sectionEls[s.dataset.sec] = s; });
    this.caret = document.getElementById('rail-caret');
    this.crumb = document.getElementById('crumb-sec');
    this.ghost = document.getElementById('ghostnum');
    this._show();
    this._applyNav();
    this._applyRows();
  }

  get sec() { return NAV[this.navFocus]; }
  // Championship grows a NEW CUP row once a cup is resumable (main toggles it).
  rowsFor(sec) {
    if (sec === 'championship' && this._champResume) return ['cup', 'class', 'difficulty', 'tweak', 'go', 'newcup'];
    return STAGE[sec] || [];
  }
  stageRows() { return this.rowsFor(this.sec); }
  currentRow() { return this.stageRows()[this.rowFocus]; }
  setChampResume(b) {
    if (this._champResume === b) return;
    this._champResume = b;
    if (this.sec === 'championship') {
      this.rowFocus = Math.min(this.rowFocus, this.rowsFor('championship').length - 1);
      this._applyRows();
    }
  }

  // Returns an intent for main: {type, ...}. Null if the key isn't ours.
  handleKey(code) {
    const up = code === 'ArrowUp' || code === 'KeyW';
    const down = code === 'ArrowDown' || code === 'KeyS';
    const left = code === 'ArrowLeft' || code === 'KeyA';
    const right = code === 'ArrowRight' || code === 'KeyD';

    if (this.view === 'nav') {
      if (up || down) { this._moveNav(up ? -1 : 1); return { type: 'navmove' }; }
      if (code === 'Enter') { this.view = 'section'; this.rowFocus = 0; this._applyNav(); this._applyRows(); return { type: 'enter', sec: this.sec }; }
      return null;
    }

    // DEPTH 1 — inside a section.
    if (code === 'Backspace') { this.toNav(); return { type: 'back' }; } // not Escape — it exits fullscreen

    if (this.sec === 'records') { // a 1D list, no go button
      if (up || down) { this.recSel = Math.max(0, Math.min(this.recCount - 1, this.recSel + (up ? -1 : 1))); return { type: 'recmove' }; }
      if (code === 'Enter') return { type: 'activate', row: 'reclist' };
      return null;
    }

    if (this.sec === 'controls') { // a 1D list of action rows; ENTER rebinds
      if (up || down) { this.ctlSel = Math.max(0, Math.min(this.ctlCount - 1, this.ctlSel + (up ? -1 : 1))); return { type: 'ctlmove' }; }
      if (code === 'Enter') return { type: 'activate', row: 'ctllist' };
      return null;
    }

    const rows = this.stageRows();
    if (up || down) { this.rowFocus = (this.rowFocus + rows.length + (up ? -1 : 1)) % rows.length; this._applyRows(); return { type: 'rowmove' }; }
    if (left || right) return { type: 'edit', row: this.currentRow(), dir: right ? 1 : -1 };
    if (code === 'Enter') return { type: 'activate', row: this.currentRow() };
    return null;
  }

  enterSection(sec) { // mouse: jump straight into a section
    const i = NAV.indexOf(sec); if (i < 0) return;
    this.navFocus = i; this.view = 'section'; this.rowFocus = 0;
    this._show(); this._applyNav(); this._applyRows();
  }
  focusRow(sec, row) { // mouse: focus a specific row in a section
    this.enterSection(sec);
    const i = this.rowsFor(sec).indexOf(row);
    if (i >= 0) { this.rowFocus = i; this._applyRows(); }
  }
  toNav() { this.view = 'nav'; this._applyNav(); this._applyRows(); }

  _moveNav(d) { this.navFocus = (this.navFocus + NAV.length + d) % NAV.length; this._show(); this._applyNav(); }

  _show() {
    const sec = this.sec;
    for (const k of NAV) this.sectionEls[k] && this.sectionEls[k].classList.toggle('active', k === sec);
    document.getElementById('console').classList.toggle('garage', sec === 'garage');
    if (this.crumb) this.crumb.textContent = sec.toUpperCase() === 'TIME' ? 'TIME TRIAL' : sec.toUpperCase();
    if (this.ghost) this.ghost.textContent = String(NAV.indexOf(sec) + 1).padStart(2, '0');
    this._reparent(sec);
  }

  // Move the shared canvases into the active section's viewport slot.
  _reparent(sec) {
    const pool = document.getElementById('canvas-pool');
    const env = document.getElementById('env-thumb');
    const thumb = document.getElementById('menu-thumb');
    const prof = document.getElementById('menu-profile');
    const pod = document.getElementById('podium');
    const slot = this.sectionEls[sec] && this.sectionEls[sec].querySelector('.vp-slot');
    const park = (el) => { if (el && el.parentElement !== pool) pool.appendChild(el); };
    if (sec === 'garage') { park(env); park(thumb); park(prof); if (slot && pod.parentElement !== slot) slot.appendChild(pod); return; }
    park(pod);
    if (sec === 'championship') { park(thumb); park(prof); if (slot) slot.appendChild(env); }
    else if (sec === 'single' || sec === 'time') { if (slot) { slot.appendChild(env); slot.appendChild(thumb); slot.appendChild(prof); } }
    else { park(env); park(thumb); park(prof); }
  }

  _applyNav() {
    for (const k of NAV) {
      const el = this.navEls[k]; if (!el) continue;
      el.classList.toggle('hi', k === this.sec);
      el.classList.toggle('active', k === this.sec && this.view === 'section');
    }
    const el = this.navEls[this.sec];
    if (this.caret && el) this.caret.style.transform = `translateY(${el.offsetTop + el.offsetHeight / 2 - 6}px)`;
  }

  _applyRows() {
    const inSec = this.view === 'section';
    for (const k of NAV) {
      const s = this.sectionEls[k]; if (!s) continue;
      s.querySelectorAll('[data-row]').forEach((r) => r.classList.remove('focus'));
    }
    const s = this.sectionEls[this.sec];
    if (inSec && s && this.sec !== 'records' && this.sec !== 'controls') {
      const row = this.currentRow();
      const el = s.querySelector(`[data-row="${row}"]`);
      if (el) el.classList.add('focus');
    }
    if (this.sec === 'records') this._applyRecSel();
    if (this.sec === 'controls') this._applyCtlSel();
  }

  _applyRecSel() {
    const list = document.getElementById('rec-list'); if (!list) return;
    [...list.children].forEach((c, i) => c.classList.toggle('focus', this.view === 'section' && i === this.recSel));
  }

  _applyCtlSel() {
    const list = document.getElementById('ctl-list'); if (!list) return;
    [...list.children].forEach((c, i) => c.classList.toggle('focus', this.view === 'section' && i === this.ctlSel));
  }
}

// ---- shared draw helpers (used by main's updateMenu) ----
export function bar(n) {
  let cells = '';
  for (let i = 0; i < 5; i++) cells += `<i class="${i < n ? 'on' : ''}"></i>`;
  return `<span class="bar">${cells}</span>`;
}
export function hex(c) { return c.toString(16).padStart(6, '0'); }

// The dossier canvases draw into a fixed high-res backing store and are scaled
// down by CSS — sharp on any display, and immune to window resizes.
// Feature colours match the .track-facts tags AND the in-game pad language:
// boost cyan, weapon gold, loop magenta, jump amber, split green.
const MAP_W = 560, MAP_H = 470;
const PROF_W = 1180, PROF_H = 250;
const C_BOOST = '#00f0ff', C_WEAPON = '#ffb13d', C_JUMP = '#ffd23f', C_SPLIT = '#51ffae';

// ROUTE MAP: the lap outline with the pads and hazards marked, a start gate and
// a direction chevron — the circuit at a glance instead of a bare loop of line.
export function drawThumb(canvas, spline) {
  const W = MAP_W, H = MAP_H;
  canvas.width = W; canvas.height = H;
  canvas.style.removeProperty('width'); canvas.style.removeProperty('height');
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < spline.n; i++) {
    const x = spline.pos[i * 3], z = spline.pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const pad = 24;
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2, oz = (H - (maxZ - minZ) * sc) / 2;
  const PX = (s) => {
    const i = Math.min(spline.n - 1, Math.max(0, Math.floor(s / spline.step)));
    return [ox + (spline.pos[i * 3] - minX) * sc, oz + (spline.pos[i * 3 + 2] - minZ) * sc];
  };
  // faint grid wash so the map reads as an instrument, not a floating squiggle
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.055)'; ctx.lineWidth = 1;
  for (let g = 0; g < W; g += 40) { ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke(); }
  for (let g = 0; g < H; g += 40) { ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke(); }

  const step = Math.max(1, Math.round(6 / spline.step));
  const trace = () => {
    ctx.beginPath();
    for (let i = 0; i <= spline.n; i += step) {
      const j = (i % spline.n) * 3;
      const x = ox + (spline.pos[j] - minX) * sc, y = oz + (spline.pos[j + 2] - minZ) * sc;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  trace(); ctx.strokeStyle = 'rgba(24, 10, 58, 0.95)'; ctx.lineWidth = 13; ctx.stroke();
  trace(); ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)'; ctx.lineWidth = 9; ctx.stroke();
  trace(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.4;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.9)'; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;

  // SPLIT stretches: overdraw the forked section in the split colour.
  for (const sp of spline.splits || []) {
    ctx.beginPath();
    for (let d = 0; d <= sp.span; d += 6) { const [x, y] = PX((sp.s0 + d) % spline.length); if (d === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.strokeStyle = C_SPLIT; ctx.lineWidth = 3.6;
    ctx.shadowColor = C_SPLIT; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  }
  // JUMP gaps: break the line and mark the void.
  for (const g of spline.gaps || []) {
    ctx.beginPath();
    for (let d = 0; d <= g.end - g.start; d += 3) { const [x, y] = PX(g.start + d); if (d === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.strokeStyle = 'rgba(24, 10, 58, 1)'; ctx.lineWidth = 7; ctx.stroke();
    const [jx, jy] = PX((g.start + g.end) / 2);
    ctx.fillStyle = C_JUMP; ctx.beginPath(); ctx.arc(jx, jy, 5, 0, Math.PI * 2); ctx.fill();
  }
  // Pads: boost cyan, weapon gold — the same language as the road decals.
  const dot = (list, col, r) => {
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
    for (const p of list || []) { const [x, y] = PX(p.s); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.shadowBlur = 0;
  };
  dot(spline.pads, C_BOOST, 3.6);
  dot(spline.weaponPads, C_WEAPON, 4.2);

  // START GATE: a bar across the road plus a chevron showing which way it runs.
  const i0 = 0, tx = spline.tan[0], tz = spline.tan[2];
  const tl = Math.hypot(tx, tz) || 1;
  const [sx, sy] = PX(0);
  const nx = -(tz / tl), ny = (tx / tl);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(sx - nx * 11, sy - ny * 11); ctx.lineTo(sx + nx * 11, sy + ny * 11); ctx.stroke();
  ctx.fillStyle = C_JUMP;
  const hx = tx / tl, hy = tz / tl;
  ctx.beginPath();
  ctx.moveTo(sx + hx * 22, sy + hy * 22);
  ctx.lineTo(sx + hx * 8 - nx * 7, sy + hy * 8 - ny * 7);
  ctx.lineTo(sx + hx * 8 + nx * 7, sy + hy * 8 + ny * 7);
  ctx.closePath(); ctx.fill();
  void i0;
}

// ELEVATION TRACE: the lap's climb profile with the hazards banded onto it.
export function drawProfile(canvas, spline) {
  const W = PROF_W, H = PROF_H;
  canvas.width = W; canvas.height = H;
  canvas.style.removeProperty('width'); canvas.style.removeProperty('height');
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < spline.n; i++) {
    const y = spline.pos[i * 3 + 1];
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = Math.max(maxY - minY, 10);
  const px = (i) => 10 + (i / spline.n) * (W - 20);
  const pxs = (s) => px((s / spline.length) * spline.n);
  const py = (y) => H - 18 - ((y - minY) / span) * (H - 40);
  // baseline rules — a sense of scale behind the trace
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)'; ctx.lineWidth = 1;
  for (let k = 0; k <= 3; k++) { const y = py(minY + (span * k) / 3); ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(W - 10, y); ctx.stroke(); }
  // JUMP gaps as amber bands behind the trace
  for (const g of spline.gaps || []) {
    ctx.fillStyle = 'rgba(255, 210, 63, 0.16)';
    ctx.fillRect(pxs(g.start), 8, Math.max(3, pxs(g.end) - pxs(g.start)), H - 26);
  }
  // SPLIT stretches as green bands
  for (const sp of spline.splits || []) {
    ctx.fillStyle = 'rgba(81, 255, 174, 0.12)';
    const x0 = pxs(sp.s0), w = Math.max(3, (sp.span / spline.length) * (W - 20));
    ctx.fillRect(x0, 8, w, H - 26);
  }
  const step = Math.max(1, Math.round(8 / spline.step));
  ctx.beginPath(); ctx.moveTo(px(0), H - 10);
  for (let i = 0; i <= spline.n; i += step) ctx.lineTo(px(Math.min(i, spline.n)), py(spline.pos[(i % spline.n) * 3 + 1]));
  ctx.lineTo(px(spline.n), H - 10); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(0, 240, 255, 0.30)');
  grad.addColorStop(1, 'rgba(0, 240, 255, 0.03)');
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  for (let i = 0; i <= spline.n; i += step) {
    const x = px(Math.min(i, spline.n)), y = py(spline.pos[(i % spline.n) * 3 + 1]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.8)'; ctx.shadowBlur = 9; ctx.stroke(); ctx.shadowBlur = 0;
  // Pad ticks along the foot, in the road's own colours.
  const tick = (list, col, h) => {
    ctx.strokeStyle = col; ctx.lineWidth = 2.4;
    for (const p of list || []) { const x = pxs(p.s); ctx.beginPath(); ctx.moveTo(x, H - 10); ctx.lineTo(x, H - 10 - h); ctx.stroke(); }
  };
  tick(spline.pads, C_BOOST, 9);
  tick(spline.weaponPads, C_WEAPON, 13);
  // START/FINISH tick, matching the map's gate.
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(px(0), 8); ctx.lineTo(px(0), H - 10); ctx.stroke();
}
