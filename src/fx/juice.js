// The feel event bus. Physics emits raw events; everything juicy (trauma,
// boost envelope, hitstop, flash, fog pulse) is owned and fanned out here, so
// tuning feel never touches sim code.
import { TUNING as T } from '../config.js';

export class Juice {
  constructor() {
    this.listeners = new Map();
    this.trauma = 0;
    this.boostFactor = 0;   // attack 12/s, release 3/s envelope
    this.boostTarget = 0;
    this.timescale = 1;
    this.flash = 0;
    this.flashHold = 0;
    this.hitstopT = 0;
    this.fovSpike = 0;
    this.camPunch = 0;      // lateral camera punch, signed, decays fast
    this.scrapeAccum = 0;
    this.landImpulse = 0;   // suspension-settle magnitude on the last landing
    this.landTime = 999;    // seconds since that landing (drives the damped dip)

    this.on('boost', () => {
      this.addTrauma(T.TRAUMA_BOOST);
      this.setFlash(T.FLASH_BOOST);
      this.fovSpike = T.FOV_BOOST_SPIKE;
    });
    this.on('miniboost', () => {
      this.addTrauma(0.12);
      this.fovSpike = Math.max(this.fovSpike, T.FOV_BOOST_SPIKE * 0.5);
    });
    this.on('wallHit', ({ side, severity }) => {
      this.addTrauma(T.TRAUMA_HIT * (0.6 + 0.4 * severity));
      this.setFlash(T.FLASH_HIT);
      this.hitstopT = T.HITSTOP_TIME;
      this.camPunch = -side * 0.3 * (0.5 + 0.5 * severity);
    });
    this.on('scrape', () => {
      this.scrapeAccum = Math.min(this.scrapeAccum + T.TRAUMA_SCRAPE, T.TRAUMA_SCRAPE_CAP);
      if (this.trauma < 0.2) this.trauma = 0.2;
    });
    this.on('land', ({ severity }) => {
      this.addTrauma(T.TRAUMA_LAND * severity);
      // Suspension absorb: a brief vertical camera dip-and-recover (NOT shake).
      this.landImpulse = Math.min(1, severity);
      this.landTime = 0;
    });
    // Ship-to-ship shunt: scaled by closing speed, gentler than a wall, and
    // routed through addTrauma so it stays clamped — no raw trauma pokes.
    this.on('bump', ({ severity = 0.5 } = {}) => {
      this.addTrauma(T.TRAUMA_BUMP * (0.5 + 0.5 * severity));
    });
    // Came up short on a jump: a hard thump, but deliberately NOT a wallHit —
    // it must not pollute the wall-hit tally that clean-win trophies read.
    this.on('shortfall', () => {
      this.addTrauma(T.TRAUMA_HIT);
      this.setFlash(T.FLASH_HIT);
      this.hitstopT = T.HITSTOP_TIME;
    });
    // Weapon hit: ONE hard spike exactly at impact + a hitstop tick — the decay
    // does the rest (no sustained shake through the disable, per the less-shake
    // rule). Watching someone else eat a missile is a faint thud.
    this.on('weaponHit', ({ victimIsPlayer }) => {
      if (victimIsPlayer) {
        this.addTrauma(T.WEAPON_TRAUMA);
        this.setFlash(T.WEAPON_FLASH);
        this.hitstopT = T.WEAPON_HITSTOP;
      } else {
        this.addTrauma(0.15);
      }
    });
    this.on('shieldSave', ({ victimIsPlayer }) => {
      if (victimIsPlayer) this.addTrauma(0.2); // a knock, not a punishment
    });
    // Near-miss: a wall/pylon or rival flew close past. Pure rush — NO trauma,
    // NO flash, NO hitstop (a near-miss is not a hit). Just a quick lateral tug
    // toward the thing that whipped by (wake suction), which camPunch decays out
    // in a few frames. The doppler swish lives in audio.
    this.on('nearMiss', ({ side = 1, intensity = 1 }) => {
      this.camPunch += side * T.NEARMISS_PUNCH * intensity;
    });
  }

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }

  emit(name, payload) {
    const fns = this.listeners.get(name);
    if (fns) for (const fn of fns) fn(payload);
  }

  addTrauma(x) {
    this.trauma = Math.min(this.trauma + x, 1);
  }

  setFlash(x) {
    this.flash = Math.max(this.flash, x);
    this.flashHold = 0.06;
  }

  // realDt: unscaled wall-clock dt. boosting: physics boostTimer > 0.
  update(realDt, boosting) {
    this.trauma = Math.max(0, this.trauma - T.TRAUMA_DECAY * realDt);
    this.trauma = Math.min(1, this.trauma + this.scrapeAccum);
    this.scrapeAccum = Math.max(0, this.scrapeAccum - realDt * 0.5);

    this.boostTarget = boosting ? 1 : 0;
    const rate = this.boostTarget > this.boostFactor ? T.BOOST_ATTACK : T.BOOST_RELEASE;
    this.boostFactor += (this.boostTarget - this.boostFactor)
      * Math.min(1, rate * realDt);

    if (this.flashHold > 0) this.flashHold -= realDt;
    else this.flash = Math.max(0, this.flash - 2.5 * realDt);

    this.hitstopT -= realDt;
    this.timescale = this.hitstopT > 0 ? T.HITSTOP_SCALE : 1;

    this.fovSpike = Math.max(0, this.fovSpike - (T.FOV_BOOST_SPIKE / T.FOV_SPIKE_DECAY) * realDt);
    this.camPunch *= Math.exp(-8 * realDt);
    this.landTime += realDt;
  }

  // Vertical-only damped settle the camera adds on touchdown after a jump — a
  // quick downward compression then a spring back to rest (~0.35s). Keeps the
  // road on screen (no shake, no lateral move).
  landDip() {
    if (this.landTime > 0.5) return 0;
    const a = this.landTime;
    return -this.landImpulse * T.CAM_LAND_DIP * Math.exp(-a * 7) * Math.sin(a * 22);
  }

  // Effective trauma includes the speed rumble floor — turn it off and the
  // game feels dead.
  effectiveTrauma(speedNorm) {
    return Math.max(this.trauma, T.TRAUMA_SPEED_FLOOR * speedNorm * speedNorm);
  }
}
