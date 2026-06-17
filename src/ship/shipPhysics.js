// Arcade physics in the spline domain. State is (s, d, v, vd) plus a cosmetic
// hover spring (h, hv). World position is a projection — no raycasts, no
// colliders, no tunneling, ever.
//
// ZERO three.js imports: this module runs headless (the AI/replay seam).
// `track` must provide: length, scalarsAt(s, out), verticalCurvAt(s), pads.
// `events.emit(name, payload)` receives: boost, miniboost, wallHit, scrape,
// land, shortfall, lap.
import { TUNING as T } from '../config.js';

export class ShipPhysics {
  // stats: WipEout-style ship character — {vmax, accel, steer} multipliers.
  // Applied identically whether a player or an AI drives this hull.
  // cls: speed-class multiplier {vmax, accel} applied IDENTICALLY to player
  // and AI — it scales the whole race's pace, never one side. Handling
  // (STEER) is class-independent so faster classes feel more demanding.
  constructor(track, events, stats = null, cls = null) {
    this.track = track;
    this.events = events;
    const st = stats || {};
    const c = cls || { vmax: 1, accel: 1 };
    this.ACCEL = T.ACCEL * (st.accel ?? 1) * c.accel;
    this.VMAX = T.VMAX * (st.vmax ?? 1) * c.vmax;
    this.DRAG = this.ACCEL / this.VMAX; // keeps vmax = ACCEL/DRAG by construction
    this.STEER = st.steer ?? 1;
    this.scalars = { kappa: 0, bank: 0, width: 8, slope: 0 };
    this.reset(0);
  }

  reset(s = 0) {
    this.s = s;            // arc length along the track (wrapped)
    this.sTotal = s;       // unwrapped, for the camera
    this.d = 0;            // lateral offset, + = right
    this.v = 0;            // forward speed m/s
    this.vd = 0;           // lateral speed m/s
    this.h = T.HOVER_HEIGHT;
    this.hv = 0;
    this.airborne = false;
    this.jumping = null;   // the jump zone we're flying, or null
    this.boostTimer = 0;
    this.driftHeld = 0;
    this.scraping = false;
    this.activePad = -1;
    this.lap = 0;
    this.lapTime = 0;
    this.lastLap = 0;
    this.bestLap = 0;
    this.accel = 0;        // last frame's dv/dt, for camera/HUD juice
    this.latG = 0;         // lateral acceleration in g, for ship roll
  }

  get speedNorm() {
    return Math.min(this.v / this.VMAX, 1);
  }

  get boosting() {
    return this.boostTimer > 0;
  }

  // One fixed step. input: {steer (-1..1, smoothed), throttle, brake, airbrake}.
  step(dt, input) {
    const tr = this.track;
    const sc = tr.scalarsAt(this.s, this.scalars);
    const drifting = input.airbrake && this.v > 5;

    // ---- longitudinal ----
    const vPrev = this.v;
    const dragK = T.COAST_K + (this.DRAG - T.COAST_K) * input.throttle;
    let a = this.ACCEL * input.throttle - dragK * this.v - T.BRAKE * input.brake;
    if (this.boostTimer > 0) {
      a += T.BOOST_ACCEL;
      this.boostTimer -= dt;
    }
    if (drifting) a -= T.DRIFT_BLEED;
    // Corner scrub: pay for exceeding the track's lateral grip budget.
    const demand = Math.abs(sc.kappa) * this.v * this.v;
    if (demand > T.SCRUB_THRESHOLD) {
      a -= T.SCRUB_RATE * (demand - T.SCRUB_THRESHOLD) * (drifting ? 0.4 : 1);
    }
    this.v = Math.max(0, this.v + a * dt);
    // Hard cap at boost top speed; off boost, drag walks v back down naturally.
    if (this.v > this.VMAX * T.BOOST_VCAP) this.v = this.VMAX * T.BOOST_VCAP;
    this.accel = (this.v - vPrev) / dt;

    // ---- lateral ----
    const steerMult = drifting ? T.DRIFT_STEER_MULT : 1;
    let lambda = drifting ? T.DRIFT_LAMBDA : T.STEER_LAMBDA;
    const targetVd = input.steer * steerMult * this.STEER
      * (T.STEER_VD_BASE + T.STEER_VD_SPEED * this.speedNorm);
    // Centering and counter-steering bite harder than initiating a turn —
    // without this, keyboard steering reads as driving on ice.
    if (!drifting && (Math.abs(input.steer) < 0.05 || targetVd * this.vd < 0)) {
      lambda *= T.STEER_GRIP_MULT;
    }
    this.vd += (targetVd - this.vd) * (1 - Math.exp(-lambda * dt));
    // Centrifugal push outward, partially countered by banking. The bank pull
    // scales in with speed so a slow ship doesn't slide off banked sections.
    // Skip it past BANK_MAX: a corkscrew rolls the frame a full turn, and the
    // sin(bank) term would otherwise shove the ship sideways through the roll.
    const centrifugal = sc.kappa * this.v * this.v * T.CENTRIFUGAL;
    const bankPull = Math.abs(sc.bank) <= T.BANK_MAX * 1.1
      ? -T.GRAVITY * Math.sin(sc.bank) * 1.6 * Math.min(this.v / 25, 1) : 0;
    this.vd += (centrifugal + bankPull) * dt;
    this.latG = (centrifugal + bankPull) / T.GRAVITY;

    // ---- advancement (curvature correction: the inside line is shorter) ----
    const corr = clamp(1 + sc.kappa * this.d, 0.8, 1.25);
    const dsdt = this.v / corr;
    const prevS = this.s; // pre-advance arc length (jump takeoff + lap crossing)
    this.s = wrap(this.s + dsdt * dt, tr.length);
    this.sTotal += dsdt * dt;
    this.d += this.vd * dt;

    // ---- drift mini-boost ----
    if (drifting && Math.abs(input.steer) > 0.3) {
      this.driftHeld += dt;
    } else {
      if (this.driftHeld > T.DRIFT_MIN_TIME) {
        this.v += T.DRIFT_MINI_BOOST;
        this.events.emit('miniboost');
      }
      this.driftHeld = 0;
    }

    // ---- walls ----
    const limit = sc.width - T.WALL_MARGIN;
    this.scraping = false;
    if (Math.abs(this.d) > limit) {
      const side = Math.sign(this.d);
      this.d = side * limit;
      const impact = this.vd * side; // velocity INTO the wall
      if (impact > T.WALL_HARD_VD) {
        this.v *= T.WALL_HIT_KEEP;
        this.vd = -T.WALL_BOUNCE * this.vd;
        this.events.emit('wallHit', { side, severity: Math.min(impact / 20, 1) });
      } else if (impact >= 0) {
        this.v = Math.max(0, this.v - T.WALL_SCRAPE_DECEL * dt);
        this.vd = 0;
        this.scraping = true;
        this.events.emit('scrape', { side });
      }
    }

    // ---- jumps: launch off a ramp, fly a ballistic arc over the gap ----
    // Crossing a takeoff kicks h upward; while airborne the hover spring is
    // off and only gravity acts, so the ship sails (same for player and AI).
    if (tr.jumps) {
      for (const j of tr.jumps) {
        const wasBefore = sdist(prevS, j.takeoff, tr.length) >= 0;
        const nowAfter = sdist(this.s, j.takeoff, tr.length) <= 0;
        if (!this.jumping && wasBefore && nowAfter
          && Math.abs(sdist(this.s, j.takeoff, tr.length)) < 6) {
          this.jumping = j;
          this.hv = Math.max(this.hv, j.lift);
        }
      }
    }

    if (this.jumping) {
      // Pure ballistics over the gap.
      this.hv -= T.JUMP_GRAVITY * dt;
      this.h += this.hv * dt;
      this.airborne = true;
      if (this.hv < 0 && this.h <= T.HOVER_HEIGHT) {
        if (tr.gapAt(this.s)) {
          // Came up short — drop back onto the track just past the gap.
          const target = this.jumping.end + 5;
          this.sTotal += sdist(this.s, target, tr.length);
          this.s = wrap(target, tr.length);
          this.d = 0; this.vd = 0;
          this.v *= 0.5;
          // A hard thump, but NOT a wall hit — see juice 'shortfall'.
          this.events.emit('shortfall', {});
        } else {
          this.events.emit('land', { severity: Math.min(-this.hv / 8, 1) });
        }
        this.h = T.HOVER_HEIGHT; this.hv = 0; this.jumping = null; this.airborne = false;
      }
    } else {
      // ---- hover spring + airtime over crests ----
      // Track curving down faster than the spring can follow throws the ship up
      // (relative to the surface). Cosmetic: s, d, v keep simulating.
      const vertCurv = tr.verticalCurvAt(this.s);
      const terrainKick = -vertCurv * this.v * this.v * T.HOVER_TERRAIN_FOLLOW;
      this.hv += (-T.HOVER_K * (this.h - T.HOVER_HEIGHT) - T.HOVER_C * this.hv + terrainKick) * dt;
      this.h += this.hv * dt;
      const wasAirborne = this.airborne;
      this.airborne = this.h > T.HOVER_HEIGHT + 0.35;
      if (this.h < T.HOVER_HEIGHT - 0.25) {
        this.h = T.HOVER_HEIGHT - 0.25;
        if (this.hv < 0) this.hv = -this.hv * 0.3;
      }
      if (this.h > T.HOVER_HEIGHT + 3) { this.h = T.HOVER_HEIGHT + 3; this.hv = Math.min(this.hv, 0); }
      if (wasAirborne && !this.airborne && this.hv < -1.5) {
        this.events.emit('land', { severity: Math.min(-this.hv / 6, 1) });
      }
    }

    // ---- boost pads ----
    let onPad = -1;
    for (const pad of tr.pads) {
      const ds = sdist(this.s, pad.s, tr.length);
      if (Math.abs(ds) < 3.5 && Math.abs(this.d - pad.d) < 2.4) { onPad = pad.id; break; }
    }
    if (onPad >= 0 && onPad !== this.activePad) {
      this.boostTimer = T.BOOST_TIME; // refresh, don't stack
      this.events.emit('boost', { pad: onPad });
    }
    this.activePad = onPad;

    // ---- lap timing ----
    this.lapTime += dt;
    if (this.v > 1 && prevS > tr.length * 0.8 && this.s < tr.length * 0.2) {
      this.lap += 1;
      if (this.lap > 1) {
        this.lastLap = this.lapTime;
        if (!this.bestLap || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
        this.events.emit('lap', { lap: this.lap, time: this.lapTime, best: this.bestLap });
      }
      this.lapTime = 0;
    }
  }
}

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function wrap(s, len) { s %= len; return s < 0 ? s + len : s; }
// Signed shortest distance from a to b around the loop.
function sdist(a, b, len) {
  let d = (b - a) % len;
  if (d > len / 2) d -= len;
  if (d < -len / 2) d += len;
  return d;
}
