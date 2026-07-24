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
    this.musicVolume = clampVol(parseInt(localStorage.getItem('sv-music') ?? old ?? '8', 10));
    this.sfxVolume = clampVol(parseInt(localStorage.getItem('sv-sfx') ?? old ?? '8', 10));
    this.voiceVolume = clampVol(parseInt(localStorage.getItem('sv-voice') ?? '8', 10));
    this.stateScale = 0.3; // menu idle vs racing
    this.scrapeLevel = 0;
    this.lastBump = 0;

    // Rival voice-over: load the manifest of generated clips (if present). No
    // manifest / no clip -> the feed just uses the comms chirp, as before.
    this.voiceManifest = null;
    this._voiceBuf = new Map();   // key -> decoded AudioBuffer (lazy)
    this._loadVoiceManifest();

    // Baked SFX one-shots (tools/generate-sfx.mjs -> assets/sfx/): layered on
    // top of the synth. No manifest / no clip -> full synth, as before.
    this._sfxManifest = null;
    this._sfxBuf = new Map();     // key -> { buf, norm } (decoded at unlock)
    this._loadSfxManifest();

    // The browser gesture rule: unlock on the FIRST real interaction of either
    // kind. The whole menu is clickable, so mouse-only players must unlock too
    // — keydown alone left them in silence until they happened to press a key.
    window.addEventListener('keydown', () => this.unlock());
    window.addEventListener('pointerdown', () => this.unlock());

    juice.on('boost', () => this.boostWhoosh(1));
    juice.on('miniboost', () => this.boostWhoosh(0.55));
    juice.on('wallHit', ({ severity }) => this.wallThud(severity));
    juice.on('scrape', () => { this.scrapeLevel = 1; });
    juice.on('land', ({ severity }) => this.wallThud(severity * 0.4));
    juice.on('bump', () => this.bumpThud());
    juice.on('lap', () => this.lapChime());
    juice.on('nearMiss', ({ side = 0, intensity = 1 }) => this.nearMissWhoosh(side, intensity));
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
    // SFX ride +10% hot (capped at 1.0 so the max-volume ceiling is unchanged).
    this.sfx.gain.value = Math.min(1, (this.sfxVolume / 10) * 1.1);
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = (this.musicVolume / 10) * 0.68;
    // A transparent duck node between the music sum and master (base 1.0), so a
    // pilot voice can dip the music without touching musicBus (the volume knob)
    // or fighting the crossfade logic.
    this.musicDuck = ctx.createGain();
    this.musicDuck.gain.value = 1;
    this.musicBus.connect(this.musicDuck);
    this.musicDuck.connect(this.master);
    // Voice bus: rival VO rides the SFX bus (so it follows the SFX volume) with
    // its own VOICE volume on top (0-10, its own Options row). The 0.98 scale
    // puts the default 8 at ~0.78 — banter sits under the action, not on top.
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = (this.voiceVolume / 10) * 0.98;
    this.voiceBus.connect(this.sfx);

    // Shared noise source material.
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._buildEngine();
    this._buildShieldHum();
    this._buildOpponentVoices();
    this._tryMusic();
    this._prefetchSfx();
    // Whatever was requested pre-unlock starts the moment the gesture lands
    // (the canplaythrough hook also retries, this covers already-cached files).
    if (this._wantKey) this.playMusic(this._wantKey);
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

  // Continuous SHIELD hum: a warm low drone with a slow beating throb (two
  // detuned saws ~0.8Hz apart = the "brumm") + a faint high shimmer for the
  // energy-bubble tell. Built like the engine/wind beds — persistent nodes,
  // gain lerped up while the shield is live and down when it drops.
  _buildShieldHum() {
    const ctx = this.ctx;
    this.shieldLevel = 0;
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 55;
    const bodyA = ctx.createOscillator(); bodyA.type = 'sawtooth'; bodyA.frequency.value = 110;
    const bodyB = ctx.createOscillator(); bodyB.type = 'sawtooth'; bodyB.frequency.value = 110.8; // beat -> throb
    const shimmer = ctx.createOscillator(); shimmer.type = 'triangle'; shimmer.frequency.value = 660;
    const subG = ctx.createGain(); subG.gain.value = 0.6;
    const bodyG = ctx.createGain(); bodyG.gain.value = 0.42;
    const shimG = ctx.createGain(); shimG.gain.value = 0.05;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 520; filt.Q.value = 0.7;
    this.shieldGain = ctx.createGain(); this.shieldGain.gain.value = 0;
    sub.connect(subG); subG.connect(filt);
    bodyA.connect(bodyG); bodyB.connect(bodyG); bodyG.connect(filt);
    filt.connect(this.shieldGain);
    shimmer.connect(shimG); shimG.connect(this.shieldGain); // shimmer skips the lowpass — a faint sparkle
    this.shieldGain.connect(this.sfx);
    sub.start(); bodyA.start(); bodyB.start(); shimmer.start();
  }

  // Ramp the shield drone up while the bubble is live, down when it drops.
  updateShield(dt, active) {
    if (!this.ctx || !this.shieldGain) return;
    const target = active ? 0.11 * this.stateScale : 0;
    this.shieldLevel += (target - this.shieldLevel) * Math.min(1, 5 * dt);
    // Baked hum texture looped on top of the synth drone (which keeps the sub
    // weight and yields a little headroom to the clip). Lazily started once the
    // clip is decoded; both gains ride the same ramp, so the mix stays honest.
    const c = this._sfxBuf.get('shield-hum');
    if (c && !this._shieldLoop) {
      const src = this.ctx.createBufferSource();
      src.buffer = c.buf; src.loop = true;
      src.loopStart = 0.06;                                   // trim the mp3
      src.loopEnd = Math.max(0.5, c.buf.duration - 0.08);     // encoder padding
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(g); g.connect(this.sfx);
      src.start();
      this._shieldLoop = { g, norm: c.norm };
    }
    this.shieldGain.gain.value = this.shieldLevel * (this._shieldLoop ? 0.6 : 1);
    if (this._shieldLoop) this._shieldLoop.g.gain.value = this.shieldLevel * 2.4 * this._shieldLoop.norm;
  }

  // ---- missile lock warning ------------------------------------------------
  // A homing missile is chasing YOU: a beep train whose rate rises as it
  // closes, hardening into a sustained two-tone alarm when impact is imminent
  // (main passes the T.LOCKWARN_TONE_ETA verdict — this file stays import-free).
  // Fed every frame from the render path (eta in seconds, null = safe). Built
  // like the beds: persistent nodes created lazily, gain-gated — and the beeps
  // ride this.blip, so everything follows the SFX volume.
  updateLockWarning(dt, eta, toneNow = false) {
    if (!this.ctx) return;
    const active = typeof eta === 'number' && eta >= 0;
    const imminent = active && toneNow;
    // Sustained tone: lazily build a persistent square pair behind a bandpass.
    if (imminent && !this._lockTone) {
      const o1 = this.ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = 1320;
      const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 1980;
      const o2g = this.ctx.createGain(); o2g.gain.value = 0.35;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1.1;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(o2g); o2g.connect(f); f.connect(g); g.connect(this.sfx);
      o1.start(); o2.start();
      this._lockTone = g;
    }
    if (this._lockTone && imminent !== !!this._lockToneOn) {
      this._lockToneOn = imminent;
      const t = this.ctx.currentTime, g = this._lockTone.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      if (imminent) g.linearRampToValueAtTime(0.06, t + 0.05);
      else g.exponentialRampToValueAtTime(0.0001, t + 0.09);
    }
    // Approach: the beep train (paused while the sustained tone has the floor).
    if (!active || imminent) { this._lockBeepT = 0; return; }
    this._lockBeepT = (this._lockBeepT || 0) - dt;
    if (this._lockBeepT <= 0) {
      this._lockBeepT = Math.min(0.5, Math.max(0.13, eta * 0.16)); // closes in -> beeps faster
      this.blip(1240, 0.055, { type: 'square', gain: 0.055 });
      this.blip(1860, 0.04, { type: 'square', gain: 0.022, delay: 0.006 });
    }
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

  burst(filterFreq, dur, gain, type = 'bandpass', q = 1, freqTo = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t0);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 20), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // The PLAYER takes a hit — a fat, close, three-layer BANG (sub thump + sharp
  // crack + debris tail), then the paralysis hum kicks in.
  playerHitBang() {
    if (!this.ctx) return;
    this.burst(90, 0.7, 0.42, 'lowpass', 0.6);     // deep sub body — always, the gut punch
    if (!this._playClip('player-hit', 0.6)) {
      this.burst(3200, 0.09, 0.24, 'highpass', 0.9); // sharp crack transient
      this.burst(700, 0.4, 0.2, 'bandpass', 0.7);    // mid debris
      this.blip(70, 0.6, { type: 'sawtooth', gain: 0.24, slideTo: 30 });
    }
    this.disableHum(true);
  }

  // Sustained buzzing/paralysis drone while disabled. Idempotent — call
  // disableHum(true) on the hit and disableHum(false) when the disable ends.
  disableHum(on) {
    if (!this.ctx) return;
    if (on) {
      if (this._humOn) return;
      this._humOn = true;
      const t0 = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.06, t0 + 0.04);
      const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 74;
      const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 78;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 3;
      const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 11;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 90;
      lfo.connect(lfoG); lfoG.connect(f.frequency);
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfx);
      o1.start(t0); o2.start(t0); lfo.start(t0);
      this._hum = { g, nodes: [o1, o2, lfo] };
    } else {
      if (!this._humOn) return;
      this._humOn = false;
      const h = this._hum; this._hum = null;
      if (!h) return;
      const t0 = this.ctx.currentTime;
      h.g.gain.cancelScheduledValues(t0);
      h.g.gain.setValueAtTime(h.g.gain.value, t0);
      h.g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      for (const n of h.nodes) n.stop(t0 + 0.15);
    }
  }

  // Self-boost pickup — a heavy nitrous kick: sub thump + rising pressurised
  // hiss + a low swelling saw. Beefier than the pad boostWhoosh.
  nitroKick() {
    if (!this.ctx) return;
    this.blip(48, 0.5, { type: 'sine', gain: 0.32, slideTo: 30 }); // sub thump — always
    if (this._playClip('nitro', 0.5)) return;
    this.blip(120, 0.55, { type: 'sawtooth', gain: 0.16, slideTo: 520 });
    this.burst(600, 0.6, 0.2, 'bandpass', 0.5);
    this.burst(3000, 0.35, 0.12, 'highpass', 0.8);
  }

  weaponImpact(amount = 1) {
    // heavy two-layer boom: low body (always — synced with the hitstop) + the
    // baked detonation on top, or the synth crack when no clip is decoded.
    this.burst(240, 0.5, 0.3 * amount, 'lowpass', 0.7);
    if (this._playClip('explosion', 0.55 * amount)) return;
    this.burst(2400, 0.2, 0.13 * amount, 'bandpass', 1.2);
    this.blip(110, 0.45, { type: 'sawtooth', gain: 0.15 * amount, slideTo: 38 });
  }

  shieldBounce() {
    this.blip(920, 0.16, { type: 'triangle', gain: 0.12, slideTo: 300 });
    this.burst(1500, 0.12, 0.08, 'bandpass', 1.4);
  }

  weaponFire(type) {
    if (type === 'missiles' || type === 'homing') {
      // ROCKET launch: the WEIGHT stays synth — a deep sub kick + chest boom as
      // it leaves the rail, synced with the fire punch. The baked clip carries
      // the motor/exhaust chaos; without it the full synth tail plays instead.
      this.blip(96, 0.30, { type: 'sine', gain: 0.5, slideTo: 30 });             // sub kick — the heft
      this.burst(150, 0.30, 0.36, 'lowpass', 0.7);                               // chest boom body
      if (this._playClip('missile-launch', 0.5)) return;
      this.blip(150, 0.10, { type: 'sine', gain: 0.22, slideTo: 55 });           // ignition thump
      this.blip(360, 0.5, { type: 'sawtooth', gain: 0.13, slideTo: 55 });        // motor drop
      this.burst(2600, 0.55, 0.2, 'bandpass', 1.1, 320);                          // exhaust tail, sweeping away
      this.burst(5200, 0.12, 0.1, 'highpass', 0.8);                              // launch crack
    } else if (type === 'mine') {
      if (this._playClip('mine-drop', 0.3)) return;
      this.blip(190, 0.1, { type: 'square', gain: 0.1 });
      this.blip(120, 0.12, { type: 'square', gain: 0.09, delay: 0.07 });
    } else if (type === 'shield') {
      if (this._playClip('shield-up', 0.35)) return;
      // power-up shimmer: rising sine + a soft filtered swell
      this.blip(360, 0.32, { type: 'sine', gain: 0.12, slideTo: 1200 });
      this.blip(540, 0.3, { type: 'triangle', gain: 0.07, slideTo: 1500, delay: 0.04 });
      this.burst(1800, 0.3, 0.06, 'bandpass', 1.5);
    } else if (type === 'boost') {
      this.nitroKick();
    }
  }

  commsBlip() {
    // short radio-chatter chirp — two quick square blips, quiet
    this.blip(1180, 0.05, { type: 'square', gain: 0.05 });
    this.blip(1480, 0.06, { type: 'square', gain: 0.045, delay: 0.045 });
  }

  // ---- rival voice-over ---------------------------------------------------
  // Fetch the manifest of generated clips once. Absent -> voices stay silent
  // (the comms chirp still fires); this is a pure enhancement layer.
  async _loadVoiceManifest() {
    try {
      const r = await fetch('assets/voice/manifest.json', { cache: 'no-cache' });
      if (r.ok) this.voiceManifest = await r.json();
    } catch { /* not generated yet — fine */ }
  }

  // Play the clip for a specific line (slug/bucket-i). Lazy-fetches + decodes on
  // first use, then caches. No-ops (returns false) when audio is locked, the
  // manifest/clip is missing, or the ctx can't decode. Ducks the music briefly.
  playVoice(slug, bucket, i) {
    if (!this.ctx || !this.voiceBus || !this.voiceManifest) return false;
    const key = `${slug}/${bucket}-${i}`;
    if (!(key in this.voiceManifest)) return false;
    const cached = this._voiceBuf.get(key);
    if (cached) { this._spawnVoice(cached); return true; }
    fetch(`assets/voice/${key}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => { this._voiceBuf.set(key, buf); this._spawnVoice(buf); })
      .catch(() => { /* missing/undecodable clip — the comms chirp already covered it */ });
    return true;
  }

  _spawnVoice(buf) {
    const ctx = this.ctx, now = ctx.currentTime;
    // SERIALISE: queue behind the previous line so rivals never talk over each
    // other — start after it ends (small gap). If the backlog is already deep,
    // drop this one (the chip + squelch still fired) rather than lag forever.
    const busy = (this._voiceEndsAt || 0) > now;
    const startAt = Math.max(now, this._voiceEndsAt || 0) + (busy ? 0.16 : 0);
    if (startAt - now > 2.2) return;
    const dur = buf.duration;
    this._voiceEndsAt = startAt + dur + 0.16;
    // RADIO EQ: band-limit to a comms band + a mid honk, so it reads as a
    // squawk-box transmission rather than a clean studio VO.
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.7;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1700; pk.gain.value = 4; pk.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = 1.2;
    src.connect(hp); hp.connect(lp); lp.connect(pk); pk.connect(g); g.connect(this.voiceBus);
    src.start(startAt); src.stop(startAt + dur + 0.05);
    this._squelch(startAt, dur);
    this._duckMusic();
  }

  // Radio texture around a transmission: a faint static bed for its whole
  // length + a short filtered-noise squelch "kss" as it keys open and closed.
  _squelch(t, dur) {
    const ctx = this.ctx;
    const bed = ctx.createBufferSource(); bed.buffer = this.noiseBuf; bed.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1800; bf.Q.value = 0.5;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(0.02, t + 0.05);
    bg.gain.setValueAtTime(0.02, t + dur);
    bg.gain.linearRampToValueAtTime(0.0001, t + dur + 0.07);
    bed.connect(bf); bf.connect(bg); bg.connect(this.voiceBus);
    bed.start(t); bed.stop(t + dur + 0.12);
    const kss = (bt, gain) => {
      if (bt < ctx.currentTime) bt = ctx.currentTime;
      const b = ctx.createBufferSource(); b.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2100;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(gain, bt);
      gg.gain.exponentialRampToValueAtTime(0.0004, bt + 0.09);
      b.connect(f); f.connect(gg); gg.connect(this.voiceBus);
      b.start(bt); b.stop(bt + 0.11);
    };
    kss(t, 0.05);            // key open
    kss(t + dur + 0.02, 0.04); // key close
  }

  // Dip the music while any voice is queued/playing, releasing after the last
  // scheduled line ends.
  _duckMusic() {
    if (!this.musicDuck) return;
    const now = this.ctx.currentTime;
    const end = Math.max(now + 0.1, this._voiceEndsAt || now);
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.42, now + 0.08);
    g.setValueAtTime(0.42, end);
    g.linearRampToValueAtTime(1.0, end + 0.28);
  }

  // ---- baked SFX layer ----------------------------------------------------
  // Generated one-shots (ElevenLabs, tools/generate-sfx.mjs) layered on top of
  // the synth: the synth keeps the tactile low-end attack (synced with hitstop
  // and rumble), the clip brings the organic chaos — debris, crackle, exhaust —
  // the oscillators can't fake. Absent manifest/clip -> full synth, no error.
  async _loadSfxManifest() {
    try {
      const r = await fetch('assets/sfx/manifest.json', { cache: 'no-cache' });
      if (r.ok) { this._sfxManifest = await r.json(); this._prefetchSfx(); }
    } catch { /* not generated yet — fine */ }
  }

  // Decode every clip up front (they're small): one-shots must fire with zero
  // latency, and decoding on first use would soften the first hit of a race.
  // Peak-normalise at decode so each clip lands in the mix at a known level.
  _prefetchSfx() {
    if (!this.ctx || !this._sfxManifest || this._sfxFetched) return;
    this._sfxFetched = true;
    for (const key of Object.keys(this._sfxManifest)) {
      fetch(`assets/sfx/${key}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
        .then((ab) => this.ctx.decodeAudioData(ab))
        .then((buf) => {
          let peak = 0;
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
          }
          this._sfxBuf.set(key, { buf, norm: peak > 0.001 ? 0.95 / peak : 1 });
        })
        .catch(() => { /* missing/undecodable — the synth fallback covers it */ });
    }
  }

  // Fire a baked clip through the SFX bus. gain is post-normalisation; pan/panTo
  // ride a StereoPanner ramp (the near-miss whip). Returns false when the clip
  // isn't available so callers can fall back to the synth voice.
  _playClip(key, gain = 1, { pan = null, panTo = null, panDur = 0.25 } = {}) {
    const c = this._sfxBuf.get(key);
    if (!this.ctx || !c) return false;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = c.buf;
    const g = this.ctx.createGain();
    g.gain.value = gain * c.norm;
    src.connect(g);
    if (pan !== null && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.setValueAtTime(pan, t0);
      if (panTo !== null) p.pan.linearRampToValueAtTime(panTo, t0 + panDur);
      g.connect(p); p.connect(this.sfx);
    } else {
      g.connect(this.sfx);
    }
    src.start(t0);
    return true;
  }

  weaponPickup() {
    if (this._playClip('pickup', 0.3)) return;
    // rising two-note arm chirp — distinct from the boost whoosh family
    this.blip(620, 0.09, { type: 'square', gain: 0.09 });
    this.blip(930, 0.15, { type: 'square', gain: 0.11, delay: 0.07 });
  }

  boostWhoosh(amount) {
    if (this._playClip('boost-pad', 0.4 * amount)) return;
    this.blip(170, 0.5 * amount + 0.15, { type: 'sawtooth', gain: 0.1 * amount, slideTo: 950 });
    this.burst(1100, 0.45 * amount + 0.1, 0.16 * amount, 'bandpass', 0.8);
  }

  // A held weapon fizzled out (never fired in time): a soft, deflating power-down.
  weaponFizzle() {
    if (this._playClip('fizzle', 0.28)) return;
    this.blip(430, 0.22, { type: 'triangle', gain: 0.09, slideTo: 120 });
    this.blip(210, 0.18, { type: 'sine', gain: 0.06, slideTo: 70, delay: 0.02 });
    this.burst(900, 0.14, 0.05, 'lowpass', 0.8, 300);
  }

  // A wall/pylon or a rival flying close past: a short doppler swish that drops
  // in pitch and sweeps across the stereo field (start on the side it's on, whip
  // to the far side as it passes). side: -1 left .. +1 right. Airy, quick, quiet.
  nearMissWhoosh(side = 0, intensity = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    if (t0 - (this._lastWhoosh ?? -1) < 0.1) return; // don't stack same-frame fires
    this._lastWhoosh = t0;
    const amt = Math.max(0.3, Math.min(1, intensity));
    // Baked flyby, panned with the same whip the synth does (start on the pass
    // side, snap across as it goes by). Falls through to the synth swish.
    const sd = Math.max(-1, Math.min(1, side));
    if (this._playClip('near-miss', 0.35 * (0.5 + 0.5 * amt), { pan: sd * 0.85, panTo: -sd * 0.55, panDur: 0.25 })) return;
    const dur = 0.18 + 0.07 * amt;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2600, t0);
    f.frequency.exponentialRampToValueAtTime(560, t0 + dur); // doppler drop past you
    f.Q.value = 0.9;
    const g = this.ctx.createGain();
    const peak = 0.1 * (0.5 + 0.5 * amt);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.28);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g);
    const s = Math.max(-1, Math.min(1, side));
    if (this.ctx.createStereoPanner) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.setValueAtTime(s * 0.85, t0);
      pan.pan.linearRampToValueAtTime(-s * 0.55, t0 + dur); // whips across as it goes by
      g.connect(pan); pan.connect(this.sfx);
    } else {
      g.connect(this.sfx);
    }
    src.start(t0); src.stop(t0 + dur + 0.03);
  }

  wallThud(severity) {
    this.blip(95, 0.22, { type: 'sine', gain: 0.3 * (0.4 + severity * 0.6), slideTo: 38 }); // low thud — always
    if (this._playClip('wall-hit', 0.5 * (0.4 + severity * 0.6))) return;
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
  // Six slots: assets/music/{menu,sunset,coast,sprawl,frost}.mp3, all
  // optional. race.mp3 acts as a fallback for any missing world track.
  // Missing file = silence for that slot, never an error.
  _tryMusic() {
    this.musicEls = {};       // HTMLAudio fallbacks (used until a buffer decodes)
    this.musicBuffers = {};   // decoded AudioBuffers for gapless looping
    this._decoding = {};
    this._loop = null;        // active gapless loop {key, gain, timer, sources}
    // PRESERVE any track requested before the unlock gesture (playMusic records
    // it even without a ctx) — wiping it here was how the menu music sometimes
    // never started: the pre-unlock request was lost and nothing replayed it.
    this._wantKey = this._wantKey ?? null;
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
    // NOTE: no 'race' probe — the optional race.mp3 fallback slot 404'd on
    // every load for every player once all five real slots were filled. To
    // bring the fallback back, add 'race' to this list again.
    for (const key of ['menu', 'sunset', 'coast', 'sprawl', 'frost']) {
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
    if (this.musicBus) this.musicBus.gain.value = (this.musicVolume / 10) * 0.68;
  }

  setSfxVolume(v) {
    this.sfxVolume = clampVol(v);
    localStorage.setItem('sv-sfx', String(this.sfxVolume));
    if (this.sfx) this.sfx.gain.value = Math.min(1, (this.sfxVolume / 10) * 1.1);
  }

  setVoiceVolume(v) {
    this.voiceVolume = clampVol(v);
    localStorage.setItem('sv-voice', String(this.voiceVolume));
    if (this.voiceBus) this.voiceBus.gain.value = (this.voiceVolume / 10) * 0.98;
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
