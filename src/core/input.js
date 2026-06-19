// Keyboard + gamepad -> smoothed analog axes and edge-triggered key codes.
// The ramps are mandatory for keyboard feel: raw digital steering reads as
// twitchy and breaks every smoothing constant downstream. The gamepad is just
// a SECOND source filling the same axes (steer/throttle/brake/airbrake) and
// the same `pressed` set (ArrowUp/Down/Left/Right, Enter, Escape, KeyR/KeyP),
// so nothing downstream ever needs to know which device drove it.
import { TUNING as T } from '../config.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;     // -1 (left) .. 1 (right), smoothed
    this.throttle = 0;  // 0..1, smoothed
    this.brake = 0;     // 0..1, smoothed
    this.airbrake = false;
    this.pressed = new Set(); // edge-triggered, consumed by main

    // Gamepad mirror state — polled each update(), never event-driven.
    this.gamepadActive = false;
    this._gp = { steer: 0, throttle: 0, brake: 0, airbrake: false };
    this._navHeld = { up: 0, down: 0, left: 0, right: 0 };
    this._prevNav = { up: false, down: false, left: false, right: false };
    this._prevBtn = {};

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  consume(code) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  clearPressed() {
    this.pressed.clear();
  }

  update(dt) {
    this._pollGamepad(dt);
    const g = this._gp;
    const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const up = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    const down = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    const kbAir = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    const steerTarget = clampUnit((right ? 1 : 0) - (left ? 1 : 0) + g.steer);
    this.steer = ramp(this.steer, steerTarget, dt, T.STEER_RISE, T.STEER_RELEASE);
    this.throttle = ramp(this.throttle, Math.max(up ? 1 : 0, g.throttle), dt, T.THROTTLE_RISE, T.THROTTLE_RELEASE);
    this.brake = ramp(this.brake, Math.max(down ? 1 : 0, g.brake), dt, T.THROTTLE_RISE * 1.5, T.THROTTLE_RELEASE * 1.5);
    this.airbrake = kbAir || g.airbrake;
  }

  // Fold the first connected gamepad into this._gp (analog) and synthesize
  // edge-triggered key codes — nav with auto-repeat, actions one-shot — into
  // `pressed`, exactly as the keyboard does.
  _pollGamepad(dt) {
    const g = this._gp;
    g.steer = 0; g.throttle = 0; g.brake = 0; g.airbrake = false;
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads)
      ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) { if (p && p.connected) { gp = p; break; } }
    this.gamepadActive = !!gp;
    if (!gp) {
      this._prevNav.up = this._prevNav.down = this._prevNav.left = this._prevNav.right = false;
      this._prevBtn = {};
      return;
    }
    const bp = (i) => (gp.buttons[i] ? gp.buttons[i].pressed : false);
    const bv = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const lx = deadzone(gp.axes[0] ?? 0, 0.30);
    const ly = deadzone(gp.axes[1] ?? 0, 0.30);
    const sUp = Math.max(0, -ly), sDown = Math.max(0, ly);
    const sLeft = Math.max(0, -lx), sRight = Math.max(0, lx);

    // Analog race axes (W3C "standard" mapping): left stick + d-pad steer,
    // RT / A / stick-up throttle, LT / d-pad-down / stick-down brake,
    // LB or RB airbrake. Triggers are analog (their .value), so feathering works.
    g.steer = clampUnit(lx + (bp(15) ? 1 : 0) - (bp(14) ? 1 : 0));
    g.throttle = Math.max(bv(7), bp(0) ? 1 : 0, sUp);
    g.brake = Math.max(bv(6), bp(13) ? 1 : 0, sDown);
    g.airbrake = bp(4) || bp(5);

    // Menu navigation: d-pad or left stick, edge-triggered with auto-repeat so
    // a held direction steps the way a console front-end does.
    const nav = {
      up: bp(12) || sUp > 0.55,
      down: bp(13) || sDown > 0.55,
      left: bp(14) || sLeft > 0.55,
      right: bp(15) || sRight > 0.55,
    };
    const code = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
    for (const d of ['up', 'down', 'left', 'right']) {
      if (nav[d]) {
        if (!this._prevNav[d]) { this.pressed.add(code[d]); this._navHeld[d] = 0; }
        else {
          this._navHeld[d] += dt;
          if (this._navHeld[d] >= NAV_DELAY) { this.pressed.add(code[d]); this._navHeld[d] -= NAV_REPEAT; }
        }
      }
      this._prevNav[d] = nav[d];
    }

    // One-shot action buttons -> the same codes the keyboard emits.
    for (const [i, c] of GP_ACTIONS) {
      const now = bp(i);
      if (now && !this._prevBtn[i]) this.pressed.add(c);
      this._prevBtn[i] = now;
    }
  }
}

function ramp(value, target, dt, rise, release) {
  const rate = Math.abs(target) > Math.abs(value) ? rise : release;
  const d = target - value;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return value + Math.sign(d) * step;
}

// ---- gamepad helpers ----
const NAV_DELAY = 0.40;   // s a direction is held before it starts repeating
const NAV_REPEAT = 0.12;  // s between repeats
// Standard-mapping button index -> the keyboard code it stands in for.
// 0=A 9=Start -> confirm, 1=B -> back, 2=X -> respawn, 8=Select -> pause.
const GP_ACTIONS = [[0, 'Enter'], [9, 'Enter'], [1, 'Escape'], [2, 'KeyR'], [8, 'KeyP']];

function deadzone(v, z) {
  const a = Math.abs(v);
  return a < z ? 0 : Math.sign(v) * (a - z) / (1 - z);
}
function clampUnit(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

// A frozen zero-input used during countdown/attract.
export const NULL_INPUT = Object.freeze({ steer: 0, throttle: 0, brake: 0, airbrake: false });
