// "THE BAY" console menu controller: a left nav rail of sections, navigated
// up/down (DEPTH 0); ENTER drops focus into the section's middle-column rows
// (DEPTH 1); ←→ edit, ENTER activates, Backspace/Esc returns to the rail. Pure
// structure/navigation/focus — main.js owns the data fill and the actions.

const NAV = ['championship', 'single', 'time', 'garage', 'options', 'controls', 'records', 'trophies'];
// Ordered focusable rows per section (data-row values). 'go' = the action button.
const STAGE = {
  championship: ['class', 'difficulty', 'tweak', 'go'],
  single: ['track', 'class', 'difficulty', 'tweak', 'go'],
  time: ['track', 'class', 'tweak', 'go'],
  garage: ['team', 'livery', 'pilot'],
  options: ['music', 'sfx', 'deadzone', 'rumble', 'fullscreen', 'motion'],
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
    if (sec === 'championship' && this._champResume) return ['class', 'difficulty', 'tweak', 'go', 'newcup'];
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
    if (code === 'Backspace' || code === 'Escape') { this.toNav(); return { type: 'back' }; }

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

export function drawThumb(canvas, spline) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = 150, H = 120;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < spline.n; i++) {
    const x = spline.pos[i * 3], z = spline.pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const pad = 12;
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
  ctx.strokeStyle = 'rgba(30, 14, 70, 0.9)'; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.9)'; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
  const tx = ox + (spline.pos[0] - minX) * sc, ty = oz + (spline.pos[2] - minZ) * sc;
  ctx.fillStyle = '#ffd23f'; ctx.fillRect(tx - 2.5, ty - 2.5, 5, 5);
}

export function drawProfile(canvas, spline) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = 230, H = 54;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < spline.n; i++) {
    const y = spline.pos[i * 3 + 1];
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = Math.max(maxY - minY, 10);
  const px = (i) => 4 + (i / spline.n) * (W - 8);
  const py = (y) => H - 7 - ((y - minY) / span) * (H - 14);
  ctx.beginPath(); ctx.moveTo(px(0), H - 4);
  const step = Math.max(1, Math.round(8 / spline.step));
  for (let i = 0; i <= spline.n; i += step) ctx.lineTo(px(Math.min(i, spline.n)), py(spline.pos[(i % spline.n) * 3 + 1]));
  ctx.lineTo(px(spline.n), H - 4); ctx.closePath();
  ctx.fillStyle = 'rgba(0, 240, 255, 0.16)'; ctx.fill();
  ctx.beginPath();
  for (let i = 0; i <= spline.n; i += step) {
    const x = px(Math.min(i, spline.n)), y = py(spline.pos[(i % spline.n) * 3 + 1]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 1.6;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.8)'; ctx.shadowBlur = 4; ctx.stroke(); ctx.shadowBlur = 0;
}
