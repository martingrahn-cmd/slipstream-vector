// Procedural sound: every effect is synthesized in WebAudio — no asset files.
// The AudioContext unlocks on the first real keypress (browser gesture rule).
//
// Music is Martin's department: drop a looping track at assets/music/race.mp3
// and it plays during races through the music bus. No file — no music, no error.
export class AudioEngine {
  constructor(juice) {
    this.ctx = null;
    // Separate Music and SFX volumes (0-10). Migrate from the old single sv-volume.
    const old = localStorage.getItem('sv-volume');
    this.musicVolume = clampVol(parseInt(localStorage.getItem('sv-music') ?? old ?? '7', 10));
    this.sfxVolume = clampVol(parseInt(localStorage.getItem('sv-sfx') ?? old ?? '7', 10));
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
    this.master.gain.value = 0.9; // fixed headroom; Music/SFX are mixed below
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume / 10;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = (this.musicVolume / 10) * 0.6;
    this.musicBus.connect(this.master);

    // Shared noise source material.
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._buildEngine();
    this._buildOpponentVoices();
    this._tryMusic();
  }

  // A small pool of engine voices reassigned to the nearest opponents each
  // frame — purely cosmetic (no physics/AI coupling, no rubber-banding).
  _buildOpponentVoices() {
    const ctx = this.ctx;
    this.oppVoices = [];
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 60;
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 30;
      const subG = ctx.createGain(); subG.gain.value = 0.5;
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.connect(filt); sub.connect(subG); subG.connect(filt);
      filt.connect(gain);
      if (pan) { gain.connect(pan); pan.connect(this.sfx); } else { gain.connect(this.sfx); }
      osc.start(); sub.start();
      this.oppVoices.push({ osc, sub, filt, gain, pan });
    }
  }

  // racers: array of opponent physics {s, d, v, speedNorm, VMAX}. playerS = the
  // player's arc length; len = spline length. Voices fade in by proximity.
  updateOpponentEngines(dt, racers, playerS, len, racing) {
    if (!this.ctx || !this.oppVoices) return;
    const k = Math.min(1, 8 * dt);
    let scored = [];
    if (racing && racers && racers.length) {
      for (const r of racers) {
        let ds = (((r.s - playerS) % len) + len) % len;
        if (ds > len - ds) ds = len - ds;
        scored.push({ r, ds });
      }
      scored.sort((a, b) => a.ds - b.ds);
    }
    const REACH = 55; // metres along the track before a voice goes silent
    for (let i = 0; i < this.oppVoices.length; i++) {
      const v = this.oppVoices[i];
      const cand = scored[i];
      let targetGain = 0, freq = v.osc.frequency.value, pan = 0;
      if (cand && cand.ds < REACH) {
        const r = cand.r;
        const sn = r.speedNorm != null ? r.speedNorm : Math.min(1, r.v / (r.VMAX || 90));
        freq = 50 + sn * 150;
        const prox = 1 - cand.ds / REACH;
        targetGain = 0.06 * prox * prox * this.stateScale;
        pan = Math.max(-1, Math.min(1, (r.d || 0) / 6));
      }
      v.osc.frequency.value += (freq - v.osc.frequency.value) * k;
      v.sub.frequency.value = v.osc.frequency.value * 0.5;
      v.filt.frequency.value = 320 + (freq - 50) * 6;
      v.gain.gain.value += (targetGain - v.gain.gain.value) * k;
      if (v.pan) v.pan.pan.value += (pan - v.pan.pan.value) * k;
    }
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
    this.engGain.connect(this.sfx);

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';      // harmonic body (turbine, not two-stroke)
    this.osc1.frequency.value = 48;
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'triangle';      // was square — drop the hollow buzz
    this.osc2.frequency.value = 48.5;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.42;
    this.osc3 = ctx.createOscillator();
    this.osc3.type = 'sine';          // sub an octave down — the weight
    this.osc3.frequency.value = 24;
    const o3g = ctx.createGain();
    o3g.gain.value = 0.6;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g);
    o2g.connect(this.engFilter);
    this.osc3.connect(o3g);
    o3g.connect(this.engFilter);
    this.osc1.start();
    this.osc2.start();
    this.osc3.start();

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
    this.windGain.connect(this.sfx);
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
    this.scrapeGain.connect(this.sfx);
    this.scrape.start();
  }

  // Called every frame. All values lerped here — no AudioParam event spam.
  updateEngine(dt, sn, throttle, boostFactor, racing) {
    if (!this.ctx) return;
    this.stateScale += ((racing ? 1 : 0.25) - this.stateScale) * Math.min(1, 4 * dt);
    const k = Math.min(1, 10 * dt);

    const f = 46 + sn * 150 + boostFactor * 66;
    this.osc1.frequency.value += (f - this.osc1.frequency.value) * k;
    this.osc2.frequency.value = this.osc1.frequency.value * 1.011;
    this.osc3.frequency.value = this.osc1.frequency.value * 0.5; // sub follows an octave down
    const cutoff = 190 + throttle * 900 + sn * 1500 + boostFactor * 900;
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

  weaponImpact(amount = 1) {
    // heavy two-layer boom: low body + a bright crack on top
    this.burst(240, 0.5, 0.3 * amount, 'lowpass', 0.7);
    this.burst(2400, 0.2, 0.13 * amount, 'bandpass', 1.2);
    this.blip(110, 0.45, { type: 'sawtooth', gain: 0.15 * amount, slideTo: 38 });
  }

  shieldBounce() {
    this.blip(920, 0.16, { type: 'triangle', gain: 0.12, slideTo: 300 });
    this.burst(1500, 0.12, 0.08, 'bandpass', 1.4);
  }

  weaponFire(type) {
    if (type === 'missiles' || type === 'homing') {
      // sharp launch: falling saw + a hiss of exhaust
      this.blip(300, 0.28, { type: 'sawtooth', gain: 0.13, slideTo: 70 });
      this.burst(2200, 0.22, 0.12, 'bandpass', 0.9);
    } else if (type === 'mine') {
      this.blip(190, 0.1, { type: 'square', gain: 0.1 });
      this.blip(120, 0.12, { type: 'square', gain: 0.09, delay: 0.07 });
    } else if (type === 'shield') {
      this.blip(520, 0.3, { type: 'sine', gain: 0.09, slideTo: 1050 });
    } else if (type === 'boost') {
      this.boostWhoosh(0.9);
    }
  }

  commsBlip() {
    // short radio-chatter chirp — two quick square blips, quiet
    this.blip(1180, 0.05, { type: 'square', gain: 0.05 });
    this.blip(1480, 0.06, { type: 'square', gain: 0.045, delay: 0.045 });
  }

  weaponPickup() {
    // rising two-note arm chirp — distinct from the boost whoosh family
    this.blip(620, 0.09, { type: 'square', gain: 0.09 });
    this.blip(930, 0.15, { type: 'square', gain: 0.11, delay: 0.07 });
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
    this.musicEls = {};       // HTMLAudio fallbacks (used until a buffer decodes)
    this.musicBuffers = {};   // decoded AudioBuffers for gapless looping
    this._decoding = {};
    this._loop = null;        // active gapless loop {key, gain, timer, sources}
    this._wantKey = null;
    this.currentMusic = null; // HTMLAudio element currently playing, if any
    // Equal-power crossfade curves (reused for every loop boundary).
    const N = 33;
    this._fadeIn = new Float32Array(N);
    this._fadeOut = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * Math.PI / 2;
      this._fadeIn[i] = Math.sin(x);
      this._fadeOut[i] = Math.cos(x);
    }
    for (const key of ['menu', 'sunset', 'coast', 'sprawl', 'race']) {
      const el = document.createElement('audio');
      el.src = `./assets/music/${key}.mp3`;
      el.loop = true;
      el.addEventListener('canplaythrough', () => {
        if (this.musicEls[key]) return;
        const node = this.ctx.createMediaElementSource(el);
        node.connect(this.musicBus);
        this.musicEls[key] = el;
        // If this slot was requested before the file loaded, start it now.
        if (this._wantKey === key && !this._loop && !this.currentMusic) this.playMusic(key);
      }, { once: true });
      el.addEventListener('error', () => {}, { once: true });
      el.load();
    }
  }

  // Fetch + decode a track to an AudioBuffer, then upgrade to the gapless loop
  // if it's still the one we want. Never edits the file — playback only.
  _decodeMusic(key) {
    if (this.musicBuffers[key] || this._decoding[key]) return;
    this._decoding[key] = true;
    fetch(`./assets/music/${key}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => {
        this.musicBuffers[key] = buf;
        if (this._wantKey === key && !(this._loop && this._loop.key === key)) this.playMusic(key);
      })
      .catch(() => {})
      .finally(() => { this._decoding[key] = false; });
  }

  // Seamless loop: each pass overlaps the next by a short equal-power crossfade,
  // so the end melts into the start instead of clicking/gapping like <audio loop>.
  // Build a self-rescheduling gapless loop as a {key, gain, timer, sources}
  // object on its own gain node, so two loops can cross-fade on a track switch.
  _startGaplessLoop(reqKey, buffer) {
    const ctx = this.ctx;
    const XF = Math.min(0.5, buffer.duration * 0.25); // per-pass crossfade seconds
    const period = Math.max(0.3, buffer.duration - XF);
    const loop = { key: reqKey, gain: ctx.createGain(), timer: null, sources: [] };
    loop.gain.connect(this.musicBus);
    const scheduleAt = (t) => {
      if (this._loop !== loop) return;               // superseded by a track switch
      if (ctx.state !== 'running') {                 // paused — wait, don't stack
        loop.timer = setTimeout(() => scheduleAt(t), 250);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      src.connect(g); g.connect(loop.gain);
      g.gain.setValueCurveAtTime(this._fadeIn, t, XF);            // fade in
      g.gain.setValueCurveAtTime(this._fadeOut, t + period, XF);  // fade out
      src.start(t);
      src.stop(t + period + XF + 0.05);
      loop.sources.push(src);
      src.onended = () => {
        const i = loop.sources.indexOf(src);
        if (i >= 0) loop.sources.splice(i, 1);
      };
      const nextT = t + period;
      const delayMs = Math.max(0, (nextT - ctx.currentTime - 0.25) * 1000);
      loop.timer = setTimeout(() => scheduleAt(nextT), delayMs);
    };
    this._loop = loop;
    scheduleAt(ctx.currentTime + 0.06);
    return loop;
  }

  // Fade a loop's gain to silence over `dur`, then stop its sources and unwire.
  _retireLoop(loop, dur) {
    if (!loop) return;
    if (loop.timer) { clearTimeout(loop.timer); loop.timer = null; }
    const ctx = this.ctx, t = ctx.currentTime;
    try {
      loop.gain.gain.cancelScheduledValues(t);
      loop.gain.gain.setValueAtTime(Math.max(0.0001, loop.gain.gain.value), t);
      loop.gain.gain.linearRampToValueAtTime(0.0001, t + dur);
    } catch (e) { /* */ }
    setTimeout(() => {
      for (const s of loop.sources) { try { s.stop(); } catch (e) { /* */ } }
      loop.sources = [];
      try { loop.gain.disconnect(); } catch (e) { /* */ }
    }, (dur + 0.1) * 1000);
  }

  _stopAllMusic() {
    if (this._loop) { this._retireLoop(this._loop, 0.001); this._loop = null; }
    if (this.currentMusic) { this.currentMusic.pause(); this.currentMusic = null; }
  }

  // Switch tracks with an equal-power-ish crossfade (the outgoing loop keeps
  // playing while it fades, the incoming one fades up) instead of a hard cut.
  playMusic(key) {
    this._wantKey = key;
    if (!this.ctx) return;
    if (this._loop && this._loop.key === key) return; // already looping this track
    // Belt-and-suspenders: never let another track's <audio> element keep
    // playing under the new one (covers any missed pause across decode upgrades).
    if (this.musicEls) {
      for (const k in this.musicEls) {
        if (k !== key && this.musicEls[k] && !this.musicEls[k].paused) this.musicEls[k].pause();
      }
    }

    let buf = this.musicBuffers[key];
    if (!buf && key !== 'menu' && this.musicBuffers.race) buf = this.musicBuffers.race;
    if (buf) {
      const XFADE = 0.7;
      const old = this._loop;
      if (this.currentMusic) { this.currentMusic.pause(); this.currentMusic = null; }
      const loop = this._startGaplessLoop(key, buf); // sets this._loop = loop
      const t = this.ctx.currentTime;
      loop.gain.gain.setValueAtTime(old ? 0.0001 : 1, t);
      if (old) {
        loop.gain.gain.linearRampToValueAtTime(1, t + XFADE); // fade the new one up
        this._retireLoop(old, XFADE);                         // fade the old one out
      }
      return;
    }

    // No buffer yet: kick off a decode (for a gapless upgrade) and play the
    // HTMLAudio fallback meanwhile.
    this._decodeMusic(key);
    const el = this.musicEls[key] || (key !== 'menu' ? this.musicEls.race : null) || null;
    if (this.currentMusic === el) { if (el && el.paused) el.play(); return; }
    // Retire the outgoing gapless loop too — otherwise the previous track (e.g.
    // the menu) keeps looping under this fallback until its buffer decodes.
    if (this._loop) { this._retireLoop(this._loop, 0.4); this._loop = null; }
    if (this.currentMusic) this.currentMusic.pause();
    this.currentMusic = el;
    if (el) { el.currentTime = 0; el.play(); }
  }

  // Decode a track ahead of time (e.g. when entering a race section) so the
  // eventual playMusic() gets the clean gapless crossfade, not the HTMLAudio cut.
  prewarmMusic(key) { if (this.ctx && key) this._decodeMusic(key); }

  stopMusic() {
    this._wantKey = null;
    this._stopAllMusic();
  }

  // ---- controls -------------------------------------------------------------
  setMusicVolume(v) {
    this.musicVolume = clampVol(v);
    localStorage.setItem('sv-music', String(this.musicVolume));
    if (this.musicBus) this.musicBus.gain.value = (this.musicVolume / 10) * 0.6;
  }

  setSfxVolume(v) {
    this.sfxVolume = clampVol(v);
    localStorage.setItem('sv-sfx', String(this.sfxVolume));
    if (this.sfx) this.sfx.gain.value = this.sfxVolume / 10;
  }

  setVolume(v) { this.setMusicVolume(v); this.setSfxVolume(v); } // legacy alias

  setPaused(p) {
    if (!this.ctx) return;
    if (p) this.ctx.suspend(); else this.ctx.resume();
  }
}

function clampVol(v) {
  return Math.max(0, Math.min(10, Number.isFinite(v) ? v : 7));
}
