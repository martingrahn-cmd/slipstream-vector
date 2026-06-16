// Procedural sound: every effect is synthesized in WebAudio — no asset files.
// The AudioContext unlocks on the first real keypress (browser gesture rule).
//
// Music is Martin's department: drop a looping track at assets/music/race.mp3
// and it plays during races through the music bus. No file — no music, no error.
export class AudioEngine {
  constructor(juice) {
    this.ctx = null;
    this.volume = clampVol(parseInt(localStorage.getItem('sv-volume') ?? '7', 10));
    this.stateScale = 0.3; // menu idle vs racing
    this.scrapeLevel = 0;
    this.lastBump = 0;

    window.addEventListener('keydown', () => this.unlock());

    juice.on('boost', () => this.boostWhoosh(1));
    juice.on('miniboost', () => this.boostWhoosh(0.55));
    juice.on('wallHit', ({ severity }) => this.wallThud(severity));
    juice.on('scrape', () => { this.scrapeLevel = 1; });
    juice.on('land', ({ severity }) => this.wallThud(severity * 0.4));
    juice.on('bump', () => this.bumpThud());
    juice.on('lap', () => this.lapChime());
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = (this.volume / 10) * 0.9;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);

    // Shared noise source material.
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._buildEngine();
    this._tryMusic();
  }

  // ---- continuous engine + wind + scrape bed -----------------------------
  _buildEngine() {
    const ctx = this.ctx;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 400;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 55;
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.frequency.value = 55.6;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.5;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g);
    o2g.connect(this.engFilter);
    this.osc1.start();
    this.osc2.start();

    // Wind: looped noise through a bandpass that opens with speed.
    this.wind = ctx.createBufferSource();
    this.wind.buffer = this.noiseBuf;
    this.wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 900;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.wind.start();

    // Scrape: harsh filtered noise, gated by physics scrape events.
    this.scrape = ctx.createBufferSource();
    this.scrape.buffer = this.noiseBuf;
    this.scrape.loop = true;
    this.scrape.playbackRate.value = 0.7;
    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'highpass';
    this.scrapeFilter.frequency.value = 1400;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.scrape.connect(this.scrapeFilter);
    this.scrapeFilter.connect(this.scrapeGain);
    this.scrapeGain.connect(this.master);
    this.scrape.start();
  }

  // Called every frame. All values lerped here — no AudioParam event spam.
  updateEngine(dt, sn, throttle, boostFactor, racing) {
    if (!this.ctx) return;
    this.stateScale += ((racing ? 1 : 0.25) - this.stateScale) * Math.min(1, 4 * dt);
    const k = Math.min(1, 10 * dt);

    const f = 52 + sn * 165 + boostFactor * 70;
    this.osc1.frequency.value += (f - this.osc1.frequency.value) * k;
    this.osc2.frequency.value = this.osc1.frequency.value * 1.011;
    const cutoff = 280 + throttle * 900 + sn * 1400 + boostFactor * 900;
    this.engFilter.frequency.value += (cutoff - this.engFilter.frequency.value) * k;
    const eg = (0.018 + throttle * 0.038 + sn * 0.02 + boostFactor * 0.025) * this.stateScale;
    this.engGain.gain.value += (eg - this.engGain.gain.value) * k;

    const wg = sn * sn * 0.1 * this.stateScale;
    this.windGain.gain.value += (wg - this.windGain.gain.value) * k;
    this.windFilter.frequency.value = 700 + sn * 2600;

    this.scrapeLevel = Math.max(0, this.scrapeLevel - 6 * dt);
    const sg = this.scrapeLevel * 0.16 * this.stateScale;
    this.scrapeGain.gain.value += (sg - this.scrapeGain.gain.value) * Math.min(1, 20 * dt);
  }

  // ---- one-shots ----------------------------------------------------------
  blip(freq, dur, { type = 'square', gain = 0.12, slideTo = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  burst(filterFreq, dur, gain, type = 'bandpass', q = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  boostWhoosh(amount) {
    this.blip(170, 0.5 * amount + 0.15, { type: 'sawtooth', gain: 0.1 * amount, slideTo: 950 });
    this.burst(1100, 0.45 * amount + 0.1, 0.16 * amount, 'bandpass', 0.8);
  }

  wallThud(severity) {
    this.blip(95, 0.22, { type: 'sine', gain: 0.3 * (0.4 + severity * 0.6), slideTo: 38 });
    this.burst(2400, 0.16, 0.2 * (0.4 + severity * 0.6), 'highpass');
  }

  bumpThud() {
    if (!this.ctx || this.ctx.currentTime - this.lastBump < 0.25) return;
    this.lastBump = this.ctx.currentTime;
    this.blip(130, 0.12, { type: 'sine', gain: 0.16, slideTo: 60 });
  }

  lapChime() {
    this.blip(880, 0.1, { gain: 0.1 });
    this.blip(1318, 0.16, { gain: 0.1, delay: 0.09 });
  }

  count(n) {
    this.blip(n === 0 ? 880 : 440, n === 0 ? 0.4 : 0.13, { gain: 0.14 });
  }

  uiMove() { this.blip(680, 0.035, { gain: 0.06 }); }
  uiSelect() { this.blip(560, 0.07, { gain: 0.09 }); this.blip(840, 0.1, { gain: 0.09, delay: 0.06 }); }

  finishFanfare(won) {
    const seq = won ? [523, 659, 784, 1046] : [523, 494, 440];
    seq.forEach((f, i) => this.blip(f, 0.18, { gain: 0.11, delay: i * 0.13 }));
  }

  // Trophy unlock jingle — brighter and longer for higher tiers.
  trophy(tier) {
    const seqs = {
      bronze: [784, 1047],
      silver: [784, 1047, 1319],
      gold: [784, 988, 1319, 1568],
      platinum: [523, 784, 1047, 1319, 1568],
    };
    (seqs[tier] || seqs.bronze).forEach((f, i) =>
      this.blip(f, 0.22, { gain: 0.1, delay: i * 0.08 }));
  }

  // The big one — the title is yours.
  championFanfare() {
    const seq = [392, 523, 659, 784, 659, 784, 1046, 1318];
    seq.forEach((f, i) => this.blip(f, i >= 6 ? 0.5 : 0.16, { gain: 0.12, delay: i * 0.14 }));
    this.burst(900, 0.8, 0.1, 'bandpass', 0.7);
  }

  // ---- music hooks ---------------------------------------------------------
  // Five slots: assets/music/{menu,sunset,coast,sprawl}.mp3, all optional.
  // race.mp3 acts as a fallback for any missing world track. Missing file =
  // silence for that slot, never an error.
  _tryMusic() {
    this.musicEls = {};
    this._wantKey = null;
    this.currentMusic = null;
    for (const key of ['menu', 'sunset', 'coast', 'sprawl', 'race']) {
      const el = document.createElement('audio');
      el.src = `./assets/music/${key}.mp3`;
      el.loop = true;
      el.addEventListener('canplaythrough', () => {
        if (this.musicEls[key]) return;
        const node = this.ctx.createMediaElementSource(el);
        node.connect(this.musicBus);
        this.musicEls[key] = el;
        // If this slot was requested before the file finished loading, start it.
        if (this._wantKey === key && !this.currentMusic) this.playMusic(key);
      }, { once: true });
      el.addEventListener('error', () => {}, { once: true });
      el.load();
    }
  }

  playMusic(key) {
    this._wantKey = key;
    if (!this.musicEls) return;
    const el = this.musicEls[key] || (key !== 'menu' ? this.musicEls.race : null) || null;
    if (this.currentMusic === el) {
      if (el && el.paused) el.play();
      return;
    }
    if (this.currentMusic) this.currentMusic.pause();
    this.currentMusic = el;
    if (el) { el.currentTime = 0; el.play(); }
  }

  stopMusic() {
    this._wantKey = null;
    if (this.currentMusic) this.currentMusic.pause();
    this.currentMusic = null;
  }

  // ---- controls -------------------------------------------------------------
  setVolume(v) {
    this.volume = clampVol(v);
    localStorage.setItem('sv-volume', String(this.volume));
    if (this.master) this.master.gain.value = (this.volume / 10) * 0.9;
  }

  setPaused(p) {
    if (!this.ctx) return;
    if (p) this.ctx.suspend(); else this.ctx.resume();
  }
}

function clampVol(v) {
  return Math.max(0, Math.min(10, Number.isFinite(v) ? v : 7));
}
