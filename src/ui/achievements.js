// Trophies — modelled on Asteroid Storm's achievement system: a flat list of
// {id,name,desc,icon,tier}, silent localStorage persistence, a FIFO toast
// queue with a procedural unlock jingle, and a tier-grouped gallery screen.
// Detection lives in main.js (it has the race state); this module owns
// storage, the toast, the career-stat counters and the gallery render.
import { TrophyBaker } from './trophyScene.js';

// 1x1 transparent GIF: the card reserves its space before its trophy is baked.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export const TIERS = {
  bronze: { color: '#cd7f32', label: 'BRONZE' },
  silver: { color: '#c0c0c0', label: 'SILVER' },
  gold: { color: '#ffd23f', label: 'GOLD' },
  platinum: { color: '#7df9ff', label: 'PLATINUM' },
};

// 31 trophies: 15 bronze, 10 silver, 5 gold, 1 platinum.
// `form` names the 3D shape the gallery renders for it (src/ui/trophyScene.js).
// `icon` is kept for the unlock TOAST. The toast fires MID-RACE: baking there
// would spin up the second WebGL context and render on the frame the player is
// least able to spare, to be read for two seconds at the edge of vision. An
// emoji costs nothing and reads faster. The objects live in the gallery.
// Order within a tier = display order.
export const ACHIEVEMENTS = [
  // --- bronze (15): you'll get most just by playing ---
  { id: 'first_race', name: 'Off the Line', desc: 'Finish your first race', icon: '🏁', form: 'chevron', tier: 'bronze' },
  { id: 'first_win', name: 'Top Step', desc: 'Win a race', icon: '🥇', form: 'cup', tier: 'bronze' },
  { id: 'first_boost', name: 'Pad Runner', desc: 'Hit a boost pad', icon: '⚡', form: 'bolt', tier: 'bronze' },
  { id: 'first_drift', name: 'Sideways', desc: 'Land a drift mini-boost', icon: '🌀', form: 'ring', tier: 'bronze' },
  { id: 'airbrake', name: 'Air Brake', desc: 'Use the airbrake', icon: '✋', form: 'wing', tier: 'bronze' },
  { id: 'perfect_start', name: 'Reflexes', desc: 'Nail a PERFECT START', icon: '🚦', form: 'bolt', tier: 'bronze' },
  { id: 'top_speed', name: 'Terminal Velocity', desc: 'Reach top speed', icon: '🚀', form: 'wing', tier: 'bronze' },
  { id: 'pad_chain', name: 'Pad Chain', desc: 'Hit 3 boost pads in one race', icon: '🔗', form: 'bolt', tier: 'bronze' },
  { id: 'overtake', name: 'Overtake', desc: 'Pass an opponent', icon: '↗️', form: 'chevron', tier: 'bronze' },
  { id: 'loop', name: 'Gravity Optional', desc: 'Clear a full loop', icon: '🔄', form: 'ring', tier: 'bronze' },
  { id: 'race_3', name: 'Regular', desc: 'Finish three races', icon: '🔂', form: 'chevron', tier: 'bronze' },
  { id: 'tt_play', name: 'Solo Run', desc: 'Finish a time trial', icon: '⏲️', form: 'disc', tier: 'bronze' },
  { id: 'champ_play', name: 'Contender', desc: 'Enter a championship', icon: '🎟️', form: 'shield', tier: 'bronze' },
  { id: 'all_tracks', name: 'Grand Tour', desc: 'Race on all six circuits', icon: '🗺️', form: 'disc', tier: 'bronze' },
  { id: 'all_teams', name: 'Free Agent', desc: 'Race for all four teams', icon: '🛠️', form: 'shield', tier: 'bronze' },

  // --- silver (10): takes some skill ---
  { id: 'record', name: 'Record Holder', desc: 'Set a track lap record', icon: '⏱️', form: 'disc', tier: 'silver' },
  { id: 'clean_win', name: 'Not a Scratch', desc: 'Win without touching a wall', icon: '✨', form: 'star', tier: 'silver' },
  { id: 'comeback', name: 'Through the Pack', desc: 'Win after a wall hit', icon: '💥', form: 'shield', tier: 'silver' },
  { id: 'surge_win', name: 'Up to Speed', desc: 'Win a race on SURGE', icon: '🔵', form: 'bolt', tier: 'silver' },
  { id: 'cup', name: 'Silverware', desc: 'Win a championship', icon: '🏆', form: 'cup', tier: 'silver' },
  { id: 'wins_5', name: 'On a Roll', desc: 'Win five races', icon: '🔥', form: 'star', tier: 'silver' },
  { id: 'wins_10', name: 'Veteran', desc: 'Win ten races', icon: '🎖️', form: 'star', tier: 'silver' },
  { id: 'record_3', name: 'Pace Setter', desc: 'Hold the lap record on three circuits', icon: '📊', form: 'disc', tier: 'silver' },
  { id: 'loop_master', name: 'Loop the Loop', desc: 'Clear both loop circuits', icon: '🌐', form: 'ring', tier: 'silver' },
  { id: 'clean_3', name: 'Spotless', desc: 'Win three races without a wall hit', icon: '🧼', form: 'star', tier: 'silver' },

  // --- gold (5): the real challenges ---
  { id: 'overdrive_win', name: 'Redline', desc: 'Win a race on OVERDRIVE', icon: '🟣', form: 'bolt', tier: 'gold' },
  { id: 'overdrive_cup', name: 'Untamed', desc: 'Win the OVERDRIVE championship', icon: '👑', form: 'cup', tier: 'gold' },
  { id: 'sweep', name: 'Clean Sweep', desc: 'Win every round of a championship', icon: '🧹', form: 'cup', tier: 'gold' },
  { id: 'untouchable', name: 'Untouchable', desc: 'Win with no wall or ship contact', icon: '🛡️', form: 'shield', tier: 'gold' },
  { id: 'all_records', name: 'Benchmark', desc: 'Hold the lap record on every circuit', icon: '📈', form: 'disc', tier: 'gold' },

  // --- platinum (1): everything ---
  { id: 'legend', name: 'Slipstream Legend', desc: 'Unlock every other trophy', icon: '💎', form: 'gem', tier: 'platinum' },
];

const KEY = 'sv-ach';
const STATKEY = 'sv-achstats';

export class Achievements {
  constructor(audio) {
    this.audio = audio;
    this.unlocked = JSON.parse(localStorage.getItem(KEY) || '{}');
    this.stats = JSON.parse(localStorage.getItem(STATKEY) || '{}');
    this.queue = [];
    this.showing = false;
    this.toast = document.getElementById('trophy-toast');
  }

  isUnlocked(id) { return !!this.unlocked[id]; }
  count() { return ACHIEVEMENTS.filter((a) => this.unlocked[a.id]).length; }
  total() { return ACHIEVEMENTS.length; }

  // Career counters that persist across sessions (for "win 5 races" etc.).
  bump(stat, by = 1) {
    this.stats[stat] = (this.stats[stat] || 0) + by;
    localStorage.setItem(STATKEY, JSON.stringify(this.stats));
    return this.stats[stat];
  }
  stat(s) { return this.stats[s] || 0; }

  // Add an id to a persisted set (for "all tracks", "all teams"). Returns size.
  addToSet(stat, value) {
    const set = this.stats[stat] || [];
    if (!set.includes(value)) { set.push(value); this.stats[stat] = set; }
    localStorage.setItem(STATKEY, JSON.stringify(this.stats));
    return set.length;
  }

  // Unlock by id. No-op (returns false) if already held, so toasts never repeat.
  unlock(id) {
    if (this.unlocked[id]) return false;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return false;
    this.unlocked[id] = Date.now();
    localStorage.setItem(KEY, JSON.stringify(this.unlocked));
    this.enqueue(def);
    // Platinum auto-checks after any other unlock.
    if (id !== 'legend' && ACHIEVEMENTS.every((a) => a.id === 'legend' || this.unlocked[a.id])) {
      this.unlock('legend');
    }
    return true;
  }

  // ---- toast queue ----
  enqueue(def) {
    this.queue.push(def);
    if (!this.showing) this.next();
  }
  next() {
    const def = this.queue.shift();
    if (!def) { this.showing = false; return; }
    this.showing = true;
    const t = this.toast;
    const tier = TIERS[def.tier];
    const label = def._label || `TROPHY UNLOCKED · ${tier.label}`;
    const color = def._color || tier.color;
    t.innerHTML = `
      <div class="trophy-icon">${def.icon}</div>
      <div class="trophy-text">
        <div class="trophy-label" style="color:${color}">${label}</div>
        <div class="trophy-name">${def.name}</div>
        ${def.desc ? `<div class="trophy-desc">${def.desc}</div>` : ''}
      </div>`;
    t.classList.remove('hidden');
    // restart the slide-in animation
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    if (this.audio) this.audio.trophy(def.tier);
    clearTimeout(this._hide);
    this._hide = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => {
        if (!this.queue.length) t.classList.add('hidden');
        this.next();
      }, 450);
    }, 2600);
  }

  // A generic banner toast (reused for NEW RECORD), styled like a trophy.
  banner(label, name, color = '#7df9ff', icon = '⏱️') {
    this.enqueue({ name, desc: '', icon, tier: 'silver', _label: label, _color: color });
  }

  // ---- gallery ----
  // `filter` is 'all' or a tier key (bronze/silver/gold/platinum).
  renderGallery(el, filter = 'all') {
    // The baker is built on first open and kept: 31 small renders once, then
    // cache hits. A menu screen should not pay for this twice.
    if (!this._baker) this._baker = new TrophyBaker(176);
    const order = ['bronze', 'silver', 'gold', 'platinum'];
    const shown = filter === 'all' ? order : order.filter((t) => t === filter);
    const groups = shown.map((tier) => {
      const items = ACHIEVEMENTS.filter((a) => a.tier === tier);
      const got = items.filter((a) => this.unlocked[a.id]).length;
      const cards = items.map((a) => {
        const on = this.unlocked[a.id];
        // Name + description always show (so locked trophies read as goals).
        // A locked trophy renders the SAME OBJECT in dead metal rather than a
        // padlock: the silhouette of the thing you have not won yet is a goal,
        // a padlock is just a padlock.
        return `<div class="trophy-card${on ? ' on' : ''}">
            <img class="tc-shot" src="${BLANK}" alt="" width="104" height="104"
                 data-form="${a.form || 'cup'}" data-tier="${a.tier}" data-locked="${on ? 0 : 1}">
            <div class="tc-name">${a.name}</div>
            <div class="tc-desc">${a.desc}</div>
          </div>`;
      }).join('');
      return `<div class="trophy-tier-head" style="color:${TIERS[tier].color}">
          ${TIERS[tier].label} · ${got}/${items.length}</div>
        <div class="trophy-grid">${cards}</div>`;
    }).join('');
    el.innerHTML = groups;
    this._fillShots(el);
  }

  // Bake the trophies across frames instead of all 31 in one go. Cold, that is
  // 31 renders plus 31 toDataURL calls — on a slow machine enough to stall the
  // menu on open. Warm (second open) the cache answers instantly and this
  // finishes inside the first slice.
  _fillShots(el) {
    if (this._fillRaf) cancelAnimationFrame(this._fillRaf);
    const imgs = [...el.querySelectorAll('img.tc-shot')];
    let i = 0;
    const step = () => {
      const t0 = performance.now();
      while (i < imgs.length && performance.now() - t0 < 8) {
        const im = imgs[i++];
        im.src = this._baker.bake(im.dataset.form, im.dataset.tier, im.dataset.locked === '1');
      }
      this._fillRaf = i < imgs.length ? requestAnimationFrame(step) : 0;
    };
    step();
  }
}
