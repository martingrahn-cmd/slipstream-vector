// DOM HUD: speed, lap counter/times, boost meter with afterimage drain,
// countdown and event pops. All styling lives in index.html CSS.
import { TUNING as T } from '../config.js';
import { WEAPON_ICONS } from '../weapons/icons.js';

export class Hud {
  constructor(juice) {
    this.el = {
      speed: document.getElementById('speed'),
      speedUnit: document.getElementById('speed-unit'),
      position: document.getElementById('position'),
      results: document.getElementById('results'),
      lap: document.getElementById('lap'),
      lapTime: document.getElementById('lap-time'),
      lastLap: document.getElementById('last-lap'),
      bestLap: document.getElementById('best-lap'),
      ghostDelta: document.getElementById('ghost-delta'),
      boostFill: document.getElementById('boost-fill'),
      boostGhost: document.getElementById('boost-ghost'),
      center: document.getElementById('center-msg'),
      overlay: document.getElementById('overlay'),
      stats: document.getElementById('stats'),
      weaponSlot: document.getElementById('weapon-slot'),
    };
    this.ghost = 0;
    this.lastSpeed = 0;

    juice.on('boost', () => this.pop(this.el.speed, 'boost-pop'));
    juice.on('miniboost', () => this.pop(this.el.speed, 'boost-pop'));
    juice.on('lap', ({ time, best }) => {
      this.flashCenter(time === best ? `BEST LAP ${fmt(time)}` : `LAP ${fmt(time)}`, 1400);
    });
  }

  // Weapon slot: shows the held weapon icon (null hides it).
  setWeapon(type) {
    const el = this.el.weaponSlot; if (!el) return;
    if (!type) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.innerHTML = WEAPON_ICONS[type] || '';
    el.classList.remove('hidden');
    this.pop(el, 'weapon-pop');
  }

  pop(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  flashCenter(text, ms) {
    const c = this.el.center;
    c.textContent = text;
    c.classList.remove('hidden');
    this.pop(c, 'center-pop');
    clearTimeout(this._centerT);
    this._centerT = setTimeout(() => c.classList.add('hidden'), ms);
  }

  setCenter(text) {
    const c = this.el.center;
    if (text === null) { c.classList.add('hidden'); return; }
    c.textContent = text;
    c.classList.remove('hidden');
    this.pop(c, 'center-pop');
  }

  // The fat countdown: 3 / 2 / 1 slam in, START stretches away. null hides.
  countdown(n) {
    const el = document.getElementById('countdown');
    const digit = document.getElementById('cd-digit');
    clearTimeout(this._cdT);
    if (n === null) { el.classList.add('hidden'); return; }
    const go = n === 0;
    digit.textContent = go ? 'START' : String(n);
    el.className = `hud ${go ? 'go' : `n${n}`}`;
    void el.offsetWidth; // restart the slam animation
    el.classList.add('slam');
    if (go) this._cdT = setTimeout(() => el.classList.add('hidden'), 900);
  }

  // The line under the countdown: round / track name.
  setSub(text) {
    const el = document.getElementById('center-sub');
    this.subOn = text !== null;
    if (text === null) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  clearPosition() {
    this._pos = undefined;
    this.el.position.innerHTML = '';
  }

  showOverlay(show) {
    this.el.overlay.classList.toggle('hidden', !show);
  }

  setPosition(pos, total) {
    if (this._pos !== pos) {
      const prev = this._pos;
      this._pos = pos;
      this.el.position.innerHTML = `P<b>${pos}</b><span>/${total}</span>`;
      this.el.position.classList.toggle('p1', pos === 1); // persistent gold at the front
      // Directional momentum flash: gained a place (green) vs lost one (red).
      const cls = prev === undefined ? 'pos-pop' : pos < prev ? 'pos-gain' : pos > prev ? 'pos-lose' : 'pos-pop';
      this.el.position.classList.remove('pos-pop', 'pos-gain', 'pos-lose');
      void this.el.position.offsetWidth; // restart the animation
      this.el.position.classList.add(cls);
    }
  }

  // Live results board. rows: [{name, accent, player, live, right1, right2?}]
  // — right1 is the time column, right2 an optional points column. Racers
  // still on track show RACING… and get their time the moment they cross.
  showResults({ title, tag = null, rows, footer, medals = false, champ = false }) {
    this.el.results.classList.toggle('champ', champ);
    this.el.results.innerHTML = `
      ${tag ? `<div class="results-tag">${tag}</div>` : ''}
      <h2>${title}</h2>
      ${rows.map((r, i) => `
        <div class="row${r.player ? ' you' : ''}${medals && i < 3 ? ` m${i + 1}` : ''}">
          <span class="place">${i + 1}</span>
          <span class="swatch" style="background:${r.accent}"></span>
          <span class="name">${r.name}</span>
          ${r.right2 !== undefined ? `<span class="pts">${r.right2}</span>` : ''}
          <span class="time${r.live ? ' racing' : ''}">${r.right1}</span>
        </div>`).join('')}
      <div class="press">${footer}</div>`;
    this.el.results.classList.remove('hidden');
  }

  hideResults() {
    this.el.results.classList.add('hidden');
  }

  update(dt, ship, totalLaps) {
    const kmh = Math.round(ship.v * 3.6);
    this.el.speed.textContent = kmh;
    // Jitter above 90% vmax — the number itself vibrates with the machine.
    // Ramps in smoothly (no snap at 0.9) and respects reduced-motion.
    if (ship.speedNorm > 0.9 && !document.body.classList.contains('reduced-motion')) {
      const amp = 2.5 * Math.min((ship.speedNorm - 0.9) / 0.1, 1);
      const jx = (Math.random() - 0.5) * amp, jy = (Math.random() - 0.5) * amp;
      this.el.speed.style.translate = `${jx}px ${jy}px`;
    } else {
      this.el.speed.style.translate = '0px 0px';
    }
    const accelScale = 1 + 0.12 * Math.min(Math.max(ship.accel / T.ACCEL, 0), 1.4);
    this.el.speed.style.scale = `${accelScale}`;

    this.el.lap.textContent = `LAP ${Math.min(Math.max(ship.lap, 1), totalLaps || 99)}${totalLaps ? ' / ' + totalLaps : ''}`;
    this.el.lapTime.textContent = fmt(ship.lapTime);
    this.el.lastLap.textContent = ship.lastLap ? `LAST ${fmt(ship.lastLap)}` : '';
    this.el.bestLap.textContent = ship.bestLap ? `BEST ${fmt(ship.bestLap)}` : '';

    // Boost meter with delayed afterimage ghost.
    const frac = Math.max(ship.boostTimer / T.BOOST_TIME, 0);
    this.ghost = Math.max(frac, this.ghost - dt * 0.8);
    this.el.boostFill.style.width = `${frac * 100}%`;
    this.el.boostGhost.style.width = `${this.ghost * 100}%`;
    document.getElementById('boost-meter').classList.toggle('active', frac > 0);

  }

  setStats(text) {
    this.el.stats.textContent = text;
  }

  // Time-trial ghost delta. d < 0 = ahead of the best lap (green), > 0 = behind
  // (red). null hides it.
  setGhostDelta(d) {
    const el = this.el.ghostDelta;
    if (!el) return;
    if (d === null || d === undefined) { el.textContent = ''; el.className = ''; return; }
    const ahead = d <= 0;
    el.textContent = `${ahead ? '−' : '+'}${Math.abs(d).toFixed(2)} vs GHOST`;
    el.className = ahead ? 'ahead' : 'behind';
  }
}

export function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
