// In-race pause menu: a centered panel with Resume / Restart / Options / Quit,
// plus an Options sub-panel (audio volume + fullscreen). It mirrors the attract
// menu's focus model so keyboard and gamepad navigation feel identical. Pure UI
// — main.js owns the actions and the paused flag.
export class PauseMenu {
  constructor() {
    this.rows = ['resume', 'restart', 'options', 'quit'];
    this.optRows = ['audio', 'fullscreen'];
    this.focus = 0;
    this.optFocus = 0;
    this.inOptions = false;

    this.el = document.getElementById('pause-menu');
    this.listEl = document.getElementById('pause-list');
    this.optEl = document.getElementById('pause-options');
    this.rowEls = {};
    for (const r of this.rows) this.rowEls[r] = document.getElementById(`prow-${r}`);
    this.optRowEls = {};
    for (const r of this.optRows) this.optRowEls[r] = document.getElementById(`popt-${r}`);
    this.volEl = document.getElementById('pause-volume');
    this.fsEl = document.getElementById('pause-fullscreen');
  }

  open(volume, fsOn) {
    this.focus = 0;
    this.optFocus = 0;
    this.inOptions = false;
    this.el.classList.remove('hidden');
    this.render(volume, fsOn);
  }

  close() { this.el.classList.add('hidden'); }

  moveFocus(dir) {
    if (this.inOptions) {
      this.optFocus = (this.optFocus + this.optRows.length + dir) % this.optRows.length;
    } else {
      this.focus = (this.focus + this.rows.length + dir) % this.rows.length;
    }
  }

  currentRow() { return this.rows[this.focus]; }
  currentOptRow() { return this.optRows[this.optFocus]; }

  focusRow(name) { const i = this.rows.indexOf(name); if (i >= 0) { this.focus = i; this.inOptions = false; } }
  focusOptRow(name) { const i = this.optRows.indexOf(name); if (i >= 0) { this.optFocus = i; this.inOptions = true; } }

  render(volume, fsOn) {
    const opts = this.inOptions;
    this.listEl.classList.toggle('dim', opts);
    this.optEl.classList.toggle('hidden', !opts);
    for (const r of this.rows) {
      this.rowEls[r].classList.toggle('focus', !opts && r === this.currentRow());
    }
    for (const r of this.optRows) {
      this.optRowEls[r].classList.toggle('focus', opts && r === this.currentOptRow());
    }
    let cells = '';
    for (let i = 0; i < 10; i++) cells += `<i class="${i < volume ? 'on' : ''}"></i>`;
    this.volEl.innerHTML = `<span class="bar">${cells}</span>`;
    this.fsEl.textContent = fsOn ? 'ON' : 'OFF';
  }
}
