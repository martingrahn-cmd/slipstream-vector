// AI driver: produces the SAME input shape the player's keyboard does
// ({steer, throttle, brake, airbrake}) and feeds an unmodified ShipPhysics.
// Identical physics for everyone — skill decides lines and brake points,
// never speed. No rubber-banding.
//
// ZERO three.js imports, like shipPhysics.
import { TUNING as T } from '../config.js';

// skill: { corner: 0..~1.05 multiplier on safe corner speed,
//          line:   0..1 how tightly the racing line is tracked,
//          boost:  0..1 probability of taking boost-pad lines }
export class AiDriver {
  constructor(spline, skill, seed) {
    this.sp = spline;
    this.skill = skill;
    this.rng = mulberry(seed);
    this.line = buildRacingLine(spline);
    // Personal lateral bias keeps the pack from stacking on one line; tight
    // drivers sit closer to the ideal line.
    this.bias = (this.rng() - 0.5) * 4.5 * (1 - skill.line * 0.7);
    this.scalars = { kappa: 0, bank: 0, width: 8, slope: 0 };
    this.input = { steer: 0, throttle: 1, brake: 0, airbrake: false };
    // Pad decisions are made once per approach, not re-rolled every step.
    this.padTargetId = -1;
    this.padRolledId = -1;
    this.wpadTargetId = -1;  // weapon-pad seek (only while the hands are empty)
    this.wpadRolledId = -1;
    this.wobbleT = this.rng() * 100;
    // Route-fork temperament: brave drivers take the fast (pad) inside lane.
    this.takesFastLane = this.rng() < 0.25 + skill.boost * 0.6;
  }

  lineAt(s) {
    const sp = this.sp;
    const i = Math.floor(sp.wrap(s) / sp.step) % sp.n;
    return this.line[i];
  }

  update(dt, ship) {
    const sp = this.sp;
    const sk = this.skill;
    const v = ship.v;
    this.wobbleT += dt;

    // ---- target lateral: racing line + bias + boost-pad seeking ----
    const ahead = 10 + v * 0.28;
    let dT = this.lineAt(ship.s + ahead) + this.bias;

    let chasing = false;
    for (const pad of sp.pads) {
      const ds = sdist(ship.s, pad.s, sp.length);
      if (ds > 8 && ds < 70 + v * 0.5) {
        if (this.padRolledId !== pad.id) {
          this.padRolledId = pad.id;
          this.padTargetId = (this.rng() < 0.45 + sk.boost * 0.55
            && Math.abs(pad.d - dT) < 5.5) ? pad.id : -1;
        }
        if (this.padTargetId === pad.id) { dT = pad.d; chasing = true; }
        break;
      }
    }

    // Weapon-pad seeking: same approach logic as boost pads, but only when
    // this driver holds nothing — and the boost line keeps priority.
    if (!chasing && ship.heldWeapon === null) {
      for (const pad of sp.weaponPads) {
        const ds = sdist(ship.s, pad.s, sp.length);
        if (ds > 8 && ds < 70 + v * 0.5) {
          if (this.wpadRolledId !== pad.id) {
            this.wpadRolledId = pad.id;
            this.wpadTargetId = (this.rng() < 0.5 + sk.boost * 0.45
              && Math.abs(pad.d - dT) < 5.5) ? pad.id : -1;
          }
          if (this.wpadTargetId === pad.id) dT = pad.d;
          break;
        }
      }
    }

    // Small human wobble, fading with skill.
    dT += Math.sin(this.wobbleT * 0.9) * (1 - sk.line) * 1.2;

    // Route fork: commit to a lane on approach and hold it through the island.
    // Brave drivers take the fast (pad) side; the rest take the safe outside.
    for (const split of sp.splits || []) {
      const toStart = sdist(ship.s, split.s0, sp.length);
      const toEnd = sdist(ship.s, split.s1, sp.length);
      if (toStart < 35 && toEnd > -2) {
        const side = this.takesFastLane ? split.fast : -split.fast;
        dT = side * (split.gap + 3.5);
        break;
      }
    }

    // Clamp inside the walls with margin.
    const sc = sp.scalarsAt(ship.s, this.scalars);
    const lim = sc.width - T.WALL_MARGIN - 1.0;
    dT = Math.max(-lim, Math.min(lim, dT));

    // ---- steering: PD on lateral position, mapped to the input axis ----
    const err = dT - ship.d;
    const steerScale = T.STEER_VD_BASE + T.STEER_VD_SPEED * ship.speedNorm;
    const desiredVd = err * (1.6 + sk.line * 0.6) - ship.vd * 0.22;
    this.input.steer = Math.max(-1, Math.min(1, desiredVd / steerScale));

    // ---- speed: brake for the tightest corner inside braking distance ----
    const horizon = 18 + (v * v) / (2 * T.BRAKE * 0.7);
    let kMax = 0;
    for (let q = 12; q < horizon; q += 14) {
      const k = Math.abs(sp.scalarsAt(ship.s + q, this.scalars).kappa);
      if (k > kMax) kMax = k;
    }
    const budget = T.SCRUB_THRESHOLD + 26;
    const vSafe = kMax > 1e-4
      ? Math.sqrt(budget / kMax) * sk.corner
      : Infinity;
    // Proportional throttle: off-throttle coast drag is brutal at speed, so
    // good drivers feather instead of lifting completely.
    if (v < vSafe * 1.02) {
      this.input.throttle = 1;
      this.input.brake = 0;
    } else {
      this.input.throttle = Math.max(0, 1 - (v - vSafe * 1.02) / 6);
      this.input.brake = v > vSafe * 1.18 ? 1 : 0;
    }
    // Airbrake-drift through genuinely tight corners.
    this.input.airbrake = kMax > 0.012 && v > vSafe * 1.05 && v > 30;

    return this.input;
  }
}

// Apex-cutting racing line: aim toward the inside of upcoming curvature,
// heavily smoothed so the line flows like a driver, not a function.
function buildRacingLine(sp) {
  const n = sp.n;
  const raw = new Float32Array(n);
  const aheadSamples = Math.round(30 / sp.step);
  for (let i = 0; i < n; i++) {
    // average curvature over the next ~30m
    let k = 0;
    for (let j = 0; j < aheadSamples; j += 8) k += sp.kappa[(i + j) % n];
    k /= Math.ceil(aheadSamples / 8);
    const margin = sp.width[i] - T.WALL_MARGIN - 1.2;
    raw[i] = Math.max(-margin, Math.min(margin, -k * 850));
  }
  // two box passes ≈ gaussian, ~40m wide
  const out = new Float32Array(n);
  boxSmooth(raw, out, Math.round(20 / sp.step));
  return out;
}

function boxSmooth(src, dst, radius) {
  const n = src.length;
  const tmp = new Float32Array(n);
  pass(src, tmp); pass(tmp, dst);
  function pass(a, b) {
    let sum = 0;
    const w = radius * 2 + 1;
    for (let i = -radius; i <= radius; i++) sum += a[(i + n) % n];
    for (let i = 0; i < n; i++) {
      b[i] = sum / w;
      sum -= a[(i - radius + n) % n];
      sum += a[(i + radius + 1) % n];
    }
  }
}

function sdist(a, b, len) {
  let d = (b - a) % len;
  if (d > len / 2) d -= len;
  if (d < -len / 2) d += len;
  return d;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
