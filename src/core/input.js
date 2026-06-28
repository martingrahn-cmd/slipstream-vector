// Keyboard + gamepad -> smoothed analog axes and edge-triggered key codes.
// The ramps are mandatory for keyboard feel: raw digital steering reads as
// twitchy and breaks every smoothing constant downstream. The gamepad is just
// a SECOND source filling the same axes (steer/throttle/brake/airbrake) and
// the same `pressed` set (ArrowUp/Down/Left/Right, Enter, Escape, KeyR/KeyP),
// so nothing downstream ever needs to know which device drove it.
import { TUNING as T } from '../config.js';

// --- rebindable keyboard actions ------------------------------------------
// Driving axes + the two edge actions a player tends to want on their own key.
// Menu nav / confirm / back and fullscreen stay FIXED on purpose: rebinding
// them risks locking you out of the menu, and the gamepad synthesizes them.
export const REBINDABLE = [
  { id: 'steerLeft',  label: 'STEER LEFT',  group: 'DRIVING' },
  { id: 'steerRight', label: 'STEER RIGHT', group: 'DRIVING' },
  { id: 'thrust',     label: 'ACCELERATE',  group: 'DRIVING' },
  { id: 'brake',      label: 'BRAKE',       group: 'DRIVING' },
  { id: 'airbrake',   label: 'AIRBRAKE',    group: 'DRIVING' },
  { id: 'respawn',    label: 'RESPAWN',     group: 'ACTIONS' },
  { id: 'pause',      label: 'PAUSE',       group: 'ACTIONS' },
];
const DEFAULT_BINDINGS = {
  steerLeft: ['ArrowLeft', 'KeyA'], steerRight: ['ArrowRight', 'KeyD'],
  thrust: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'],
  airbrake: ['ShiftLeft', 'ShiftRight'], respawn: ['KeyR'], pause: ['KeyP'],
};
// Synthetic codes the gamepad emits for respawn/pause (never producible by a
// keyboard) so the pad keeps working even after those keys are remapped.
const PAD_CODE = { respawn: 'Pad:respawn', pause: 'Pad:pause' };
// Codes that run the menu/system itself — refused as a new binding.
const RESERVED_CODES = new Set(['Enter', 'Escape', 'Backspace', 'Tab']);

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
    // Last input device that was actually USED (not just connected) + which kind
    // of pad — drives the on-screen button prompts (keyboard vs Xbox vs PS).
    this.lastDevice = 'kb';   // 'kb' | 'pad'
    this.padKind = 'xbox';    // 'xbox' | 'ps' (generic falls back to xbox)
    this._gp = { steer: 0, throttle: 0, brake: 0, airbrake: false };
    this._navHeld = { up: 0, down: 0, left: 0, right: 0 };
    this._prevNav = { up: false, down: false, left: false, right: false };
    this._prevBtn = {};
    this._pad = null; // the live gamepad, for rumble
    this.deadzone = clamp01(parseFloat(localStorage.getItem('sv-deadzone') ?? '0.18'));
    this.rumbleOn = localStorage.getItem('sv-rumble') !== '0';
    this.bindings = loadBindings();
    this._capture = null; // (code) => void while listening for a rebind

    window.addEventListener('keydown', (e) => {
      // Rebind capture: the next key is recorded, not fed to the game.
      if (this._capture) {
        e.preventDefault();
        const cb = this._capture; this._capture = null; cb(e.code);
        return;
      }
      if (e.repeat) return;
      this.lastDevice = 'kb'; // a real keypress → show keyboard prompts
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

  setDeadzone(z) { this.deadzone = clamp01(z); localStorage.setItem('sv-deadzone', String(this.deadzone)); }
  setRumble(on) { this.rumbleOn = !!on; localStorage.setItem('sv-rumble', on ? '1' : '0'); }

  // Fire-and-forget gamepad rumble (no-op without a pad or when disabled).
  rumble(strength = 0.5, ms = 180) {
    if (!this.rumbleOn) return;
    const pad = this._pad;
    const act = pad && (pad.vibrationActuator || (pad.hapticActuators && pad.hapticActuators[0]));
    if (!act) return;
    try {
      if (act.playEffect) {
        act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 });
      } else if (act.pulse) {
        act.pulse(strength, ms);
      }
    } catch (e) { /* actuator can throw if busy */ }
  }

  // --- rebinding ----------------------------------------------------------
  capturing() { return !!this._capture; }
  beginCapture(cb) { this._capture = cb; }   // next keydown -> cb(code), one-shot
  cancelCapture() { this._capture = null; }
  isReserved(code) { return RESERVED_CODES.has(code); }
  bindingCodes(action) { return (this.bindings[action] || []).slice(); }

  // Is any code bound to `action` currently held? (the analog/held reader)
  _held(action) {
    const codes = this.bindings[action]; if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  // Edge read for a logical action: true once per press of any bound code (or
  // the action's gamepad token), consuming it. Replaces consume('KeyR') etc.
  consumeAction(action) {
    let had = false;
    for (const c of (this.bindings[action] || [])) if (this.pressed.delete(c)) had = true;
    const pad = PAD_CODE[action];
    if (pad && this.pressed.delete(pad)) had = true;
    return had;
  }

  // Bind `code` to `action`, clearing it from any other action so a key is
  // never bound twice. Returns the id it was taken from, or null.
  setBinding(action, code) {
    if (RESERVED_CODES.has(code)) return null;
    let stolenFrom = null;
    for (const k in this.bindings) {
      if (k === action) continue;
      const i = this.bindings[k].indexOf(code);
      if (i >= 0) { this.bindings[k].splice(i, 1); stolenFrom = k; }
    }
    this.bindings[action] = [code];
    this._saveBindings();
    return stolenFrom;
  }

  resetBindings() {
    this.bindings = {};
    for (const k in DEFAULT_BINDINGS) this.bindings[k] = DEFAULT_BINDINGS[k].slice();
    this._saveBindings();
  }

  _saveBindings() { try { localStorage.setItem('sv-binds', JSON.stringify(this.bindings)); } catch (e) { /* ignore */ } }

  update(dt) {
    this._pollGamepad(dt);
    const g = this._gp;
    const left = this._held('steerLeft');
    const right = this._held('steerRight');
    const up = this._held('thrust');
    const down = this._held('brake');
    const kbAir = this._held('airbrake');

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
    this._pad = gp;
    if (!gp) {
      this._prevNav.up = this._prevNav.down = this._prevNav.left = this._prevNav.right = false;
      this._prevBtn = {};
      return;
    }
    const bp = (i) => (gp.buttons[i] ? gp.buttons[i].pressed : false);
    const bv = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const lx = deadzone(gp.axes[0] ?? 0, this.deadzone);
    const ly = deadzone(gp.axes[1] ?? 0, this.deadzone);
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

    // Did the pad actually get USED this frame? If so, switch the prompts to it
    // and note which kind it is (so we show Xbox vs PlayStation glyphs).
    const used = g.airbrake || g.throttle > 0.15 || g.brake > 0.15 || Math.abs(g.steer) > 0.3 // 0.3 floor: a deliberate steer, never stick drift (even if deadzone is 0)
      || nav.up || nav.down || nav.left || nav.right
      || GP_ACTIONS.some(([i]) => bp(i));
    if (used) { this.lastDevice = 'pad'; this.padKind = detectPadKind(gp.id); }
  }
}

// Map a gamepad id to a glyph set. Sony pads (vendor 054c) show PlayStation
// symbols; everything else falls back to the Xbox A/B/X/Y convention.
function detectPadKind(id) {
  const s = (id || '').toLowerCase();
  if (s.includes('054c') || s.includes('dualsense') || s.includes('dualshock')
    || s.includes('playstation') || s.includes('sony')) return 'ps';
  return 'xbox';
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
// 0=A -> confirm, 9=Start/8=Select -> PAUSE, 1=B -> back (Backspace, NOT a
// pause-in-race), 2=X -> respawn. Console convention: Start pauses, B cancels.
// Respawn/pause emit Pad: tokens (not key codes) so they survive key rebinding.
const GP_ACTIONS = [[0, 'Enter'], [9, 'Pad:pause'], [1, 'Backspace'], [2, 'Pad:respawn'], [8, 'Pad:pause']];

function deadzone(v, z) {
  const a = Math.abs(v);
  return a < z ? 0 : Math.sign(v) * (a - z) / (1 - z);
}

// Load saved bindings over a fresh clone of the defaults (so a partial/corrupt
// store still yields a complete, valid map).
function loadBindings() {
  const b = {};
  for (const k in DEFAULT_BINDINGS) b[k] = DEFAULT_BINDINGS[k].slice();
  try {
    const saved = JSON.parse(localStorage.getItem('sv-binds') || 'null');
    if (saved) for (const k in b) if (Array.isArray(saved[k]) && saved[k].length) b[k] = saved[k].slice();
  } catch (e) { /* corrupt store -> defaults */ }
  return b;
}

// event.code -> a short human label for the menu.
const KEY_LABELS = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT', AltRight: 'R-ALT', Space: 'SPACE', Enter: 'ENTER', Escape: 'ESC',
  Backspace: 'BKSP', Tab: 'TAB', CapsLock: 'CAPS',
};
export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM' + code.slice(6);
  return code.toUpperCase();
}
function clampUnit(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }
function clamp01(v) { return Number.isFinite(v) ? (v < 0 ? 0 : v > 0.5 ? 0.5 : v) : 0.18; }

// A frozen zero-input used during countdown/attract.
export const NULL_INPUT = Object.freeze({ steer: 0, throttle: 0, brake: 0, airbrake: false });
