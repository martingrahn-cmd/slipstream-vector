// Keyboard -> smoothed analog axes. The ramps are mandatory for keyboard feel:
// raw digital steering reads as twitchy and breaks every smoothing constant
// downstream.
import { TUNING as T } from '../config.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;     // -1 (left) .. 1 (right), smoothed
    this.throttle = 0;  // 0..1, smoothed
    this.brake = 0;     // 0..1, smoothed
    this.airbrake = false;
    this.pressed = new Set(); // edge-triggered, consumed by main

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
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
    const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const up = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    const down = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    this.airbrake = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    const steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    this.steer = ramp(this.steer, steerTarget, dt, T.STEER_RISE, T.STEER_RELEASE);
    this.throttle = ramp(this.throttle, up ? 1 : 0, dt, T.THROTTLE_RISE, T.THROTTLE_RELEASE);
    this.brake = ramp(this.brake, down ? 1 : 0, dt, T.THROTTLE_RISE * 1.5, T.THROTTLE_RELEASE * 1.5);
  }
}

function ramp(value, target, dt, rise, release) {
  const rate = Math.abs(target) > Math.abs(value) ? rise : release;
  const d = target - value;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return value + Math.sign(d) * step;
}

// A frozen zero-input used during countdown/attract.
export const NULL_INPUT = Object.freeze({ steer: 0, throttle: 0, brake: 0, airbrake: false });
