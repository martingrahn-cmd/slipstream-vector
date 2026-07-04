// Keyboard + gamepad -> smoothed analog axes and edge-triggered key codes.
// The ramps are mandatory for keyboard feel: raw digital steering reads as
// twitchy and breaks every smoothing constant downstream. The gamepad is just
// a SECOND source filling the same axes (steer/throttle/brake/airbrake) and
// the same `pressed` set (ArrowUp/Down/Left/Right, Enter, Escape, KeyR/KeyP),
// so nothing downstream ever needs to know which device drove it.
import { TUNING as T } from '../config.js';

// --- rebindable keyboard actions ------------------------------------------
// Driving axes + the two edge actions a player tends to want on their own key.
// Menu nav / confirm / back stay FIXED on the KEYBOARD on purpose: rebinding
// them risks locking you out of the menu. The gamepad has its own bindings.
export const REBINDABLE = [
  { id: 'steerLeft',  label: 'STEER LEFT',  group: 'DRIVING' },
  { id: 'steerRight', label: 'STEER RIGHT', group: 'DRIVING' },
  { id: 'thrust',     label: 'ACCELERATE',  group: 'DRIVING' },
  { id: 'brake',      label: 'BRAKE',       group: 'DRIVING' },
  { id: 'airbrake',   label: 'AIRBRAKE',    group: 'DRIVING' },
  { id: 'fire',       label: 'FIRE WEAPON', group: 'ACTIONS' },
  { id: 'respawn',    label: 'RESPAWN',     group: 'ACTIONS' },
  { id: 'pause',      label: 'PAUSE',       group: 'ACTIONS' },
];
// Menu confirm/back: the keyboard side is fixed (Enter/Backspace), but the PAD
// side is rebindable so any controller — generic ones included — can select &
// cancel even when its button indices don't match the console convention.
export const PAD_MENU = [
  { id: 'confirm', label: 'MENU CONFIRM', kbFixed: 'Enter' },
  { id: 'back',    label: 'MENU BACK',    kbFixed: 'Backspace' },
];
const DEFAULT_BINDINGS = {
  steerLeft: ['ArrowLeft', 'KeyA'], steerRight: ['ArrowRight', 'KeyD'],
  thrust: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'],
  airbrake: ['ShiftLeft', 'ShiftRight'], fire: ['Space'], respawn: ['KeyR'], pause: ['KeyP'],
};
// Gamepad bindings mirror the keyboard model: each action holds an ARRAY of
// input descriptors, so the defaults replicate the W3C "standard" mapping
// exactly (a standard pad Just Works) while a rebind narrows it to one input.
// Descriptor shapes: {b:i} digital button · {t:i} analog trigger (.value) ·
// {a:i,d:±1} half-axis in a direction. A generic pad whose indices differ is
// made usable by rebinding each action to whatever its buttons/axes really are.
const DEFAULT_PAD = {
  steerLeft:  [{ a: 0, d: -1 }, { b: 14 }],
  steerRight: [{ a: 0, d: 1 }, { b: 15 }],
  thrust:     [{ t: 7 }, { b: 0 }, { a: 1, d: -1 }],
  brake:      [{ t: 6 }, { b: 13 }, { a: 1, d: 1 }],
  airbrake:   [{ b: 4 }, { b: 5 }],
  fire:       [{ b: 3 }],
  respawn:    [{ b: 2 }],
  pause:      [{ b: 9 }, { b: 8 }],
  confirm:    [{ b: 0 }],
  back:       [{ b: 1 }],
};
// Edge actions synthesized from the pad each frame -> the codes the keyboard
// emits. respawn/pause use Pad: tokens (no keyboard can make them) so they
// survive key rebinding; confirm/back reuse Enter/Backspace.
const PAD_EDGE = [['confirm', 'Enter'], ['back', 'Backspace'], ['pause', 'Pad:pause'], ['respawn', 'Pad:respawn'], ['fire', 'Pad:fire']];
// Synthetic codes the gamepad emits for respawn/pause (never producible by a
// keyboard) so the pad keeps working even after those keys are remapped.
const PAD_CODE = { respawn: 'Pad:respawn', pause: 'Pad:pause', fire: 'Pad:fire' };
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
    this._prevAct = {}; // pad edge state for confirm/back/pause/respawn
    this._pad = null; // the live gamepad, for rumble
    this.deadzone = clamp01(parseFloat(localStorage.getItem('sv-deadzone') ?? '0.18'));
    this.rumbleOn = localStorage.getItem('sv-rumble') !== '0';
    this.bindings = loadBindings();
    this.padBindings = loadPadBindings();
    this._capture = null; // (input) => void while listening for a rebind
    this._captureMode = 'any'; // 'any' (key or pad) | 'pad' (pad only)
    this._capSnap = null; // pad rest-state snapshot taken when a capture arms

    window.addEventListener('keydown', (e) => {
      // Rebind capture: the next key is recorded, not fed to the game. A
      // pad-only bind (menu confirm/back) ignores stray keys, but a cancel key
      // still cancels it.
      if (this._capture) {
        e.preventDefault();
        if (this._captureMode === 'pad' && e.code !== 'Backspace' && e.code !== 'Escape') return;
        const cb = this._capture; this._capture = null; this._capSnap = null; cb(e.code);
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
  // Arm a one-shot rebind capture. mode 'any' takes the next key OR pad input;
  // mode 'pad' takes only a pad button/axis (menu confirm/back, whose keyboard
  // side is fixed). The callback gets a key-code STRING or a pad descriptor
  // OBJECT — the UI tells them apart by typeof.
  beginCapture(cb, mode = 'any') { this._capture = cb; this._captureMode = mode; this._capSnap = null; }
  cancelCapture() { this._capture = null; this._capSnap = null; }
  isReserved(code) { return RESERVED_CODES.has(code); }
  bindingCodes(action) { return (this.bindings[action] || []).slice(); }
  padBindingDescs(action) { return (this.padBindings[action] || []).map((d) => ({ ...d })); }

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

  // Bind a pad descriptor to `action`, clearing the same physical input from
  // any other action so one button/axis is never bound twice.
  setPadBinding(action, desc) {
    let stolenFrom = null;
    for (const k in this.padBindings) {
      if (k === action) continue;
      const before = this.padBindings[k].length;
      this.padBindings[k] = this.padBindings[k].filter((d) => !sameDesc(d, desc));
      if (this.padBindings[k].length !== before) stolenFrom = k;
    }
    this.padBindings[action] = [desc];
    this._savePadBindings();
    return stolenFrom;
  }

  resetBindings() {
    this.bindings = {};
    for (const k in DEFAULT_BINDINGS) this.bindings[k] = DEFAULT_BINDINGS[k].slice();
    this.padBindings = {};
    for (const k in DEFAULT_PAD) this.padBindings[k] = DEFAULT_PAD[k].map((d) => ({ ...d }));
    this._saveBindings();
    this._savePadBindings();
  }

  _saveBindings() { try { localStorage.setItem('sv-binds', JSON.stringify(this.bindings)); } catch (e) { /* ignore */ } }
  _savePadBindings() { try { localStorage.setItem('sv-padbinds', JSON.stringify(this.padBindings)); } catch (e) { /* ignore */ } }

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
  // `pressed`, exactly as the keyboard does. Every read goes through the
  // rebindable padBindings, so a generic pad becomes usable once configured.
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
      this._prevAct = {}; this._capSnap = null;
      return;
    }

    // A rebind capture owns the pad: the next FRESH button/axis becomes the
    // bind, and nothing drives the menu meanwhile.
    if (this._capture) {
      if (this._captureMode === 'pad' || this._captureMode === 'any') {
        const desc = this._scanPadCapture(gp);
        if (desc) { const cb = this._capture; this._capture = null; this._capSnap = null; cb(desc); }
      }
      return;
    }

    const dz = this.deadzone;
    const pb = this.padBindings;
    const mag = (id) => { let m = 0; for (const d of pb[id] || []) { const v = padMag(d, gp, dz); if (v > m) m = v; } return m; };
    const dig = (id) => { for (const d of pb[id] || []) if (padDigital(d, gp)) return true; return false; };

    // Analog race axes, read entirely from the (rebindable) pad bindings.
    g.steer = clampUnit(mag('steerRight') - mag('steerLeft'));
    g.throttle = Math.min(1, mag('thrust'));
    g.brake = Math.min(1, mag('brake'));
    g.airbrake = dig('airbrake');

    // Menu navigation: d-pad + left stick, edge-triggered with auto-repeat. Kept
    // on the universal stick axes (0/1) so even a generic pad can navigate menus.
    const bp = (i) => (gp.buttons[i] ? gp.buttons[i].pressed : false);
    const lx = deadzone(gp.axes[0] ?? 0, dz);
    const ly = deadzone(gp.axes[1] ?? 0, dz);
    const nav = {
      up: bp(12) || -ly > 0.55,
      down: bp(13) || ly > 0.55,
      left: bp(14) || -lx > 0.55,
      right: bp(15) || lx > 0.55,
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

    // Edge-triggered actions (confirm/back/pause/respawn) -> the codes the
    // keyboard emits, via the bindings so they survive a remap.
    let actDown = false;
    for (const [id, c] of PAD_EDGE) {
      const now = dig(id);
      if (now) actDown = true;
      if (now && !this._prevAct[id]) this.pressed.add(c);
      this._prevAct[id] = now;
    }

    // Did the pad actually get USED this frame? If so, switch the prompts to it
    // and note which kind it is (so we show Xbox vs PlayStation glyphs).
    const used = g.airbrake || g.throttle > 0.15 || g.brake > 0.15 || Math.abs(g.steer) > 0.3 // 0.3 floor: a deliberate steer, never stick drift (even if deadzone is 0)
      || nav.up || nav.down || nav.left || nav.right || actDown;
    if (used) { this.lastDevice = 'pad'; this.padKind = detectPadKind(gp.id); }
  }

  // While a rebind is armed, return the first FRESH pad input (a button that
  // went down, or an axis pushed from rest), else null. The first poll only
  // snapshots the rest state so the button used to OPEN the bind isn't captured.
  _scanPadCapture(gp) {
    // The snapshot masks inputs that were ALREADY active when the bind armed
    // (e.g. the A/Enter still held from opening it). A masked input un-masks the
    // moment it's released, so you CAN bind the same button you confirmed with.
    if (!this._capSnap) {
      this._capSnap = { b: gp.buttons.map((x) => !!x.pressed), a: gp.axes.map((v) => Math.abs(v ?? 0) > 0.3) };
      return null;
    }
    const snap = this._capSnap;
    for (let i = 0; i < gp.buttons.length; i++) {
      const now = gp.buttons[i].pressed;
      if (snap.b[i]) { if (!now) snap.b[i] = false; continue; } // held since arm -> wait for release
      if (now) return (gp.mapping === 'standard' && (i === 6 || i === 7)) ? { t: i } : { b: i }; // triggers are analog
    }
    for (let i = 0; i < gp.axes.length; i++) {
      const v = gp.axes[i] ?? 0;
      if (snap.a[i]) { if (Math.abs(v) < 0.3) snap.a[i] = false; continue; } // deflected since arm -> wait for rest
      if (Math.abs(v) > 0.7) return { a: i, d: v > 0 ? 1 : -1 };
    }
    return null;
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

function deadzone(v, z) {
  const a = Math.abs(v);
  return a < z ? 0 : Math.sign(v) * (a - z) / (1 - z);
}

// Two pad descriptors point at the same physical input?
function sameDesc(a, b) { return a.b === b.b && a.t === b.t && a.a === b.a && a.d === b.d; }

// Read a descriptor as a 0..1 magnitude (analog) and as a boolean (digital).
function padMag(desc, gp, dz) {
  if (desc.b != null) { const btn = gp.buttons[desc.b]; return btn && btn.pressed ? 1 : 0; }
  if (desc.t != null) { const btn = gp.buttons[desc.t]; return btn ? btn.value : 0; }
  if (desc.a != null) { const v = deadzone(gp.axes[desc.a] ?? 0, dz); return Math.max(0, desc.d * v); }
  return 0;
}
function padDigital(desc, gp) {
  if (desc.b != null) { const btn = gp.buttons[desc.b]; return !!(btn && btn.pressed); }
  if (desc.t != null) { const btn = gp.buttons[desc.t]; return !!(btn && btn.value > 0.5); }
  if (desc.a != null) { const v = gp.axes[desc.a] ?? 0; return desc.d * v > 0.5; }
  return false;
}

// Standard-mapping button index -> a short glyph, per pad family.
const PAD_BTN_XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'XBOX'];
const PAD_BTN_PS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'PS'];
// A pad descriptor -> a human label for the CONTROLS screen.
export function padLabel(desc, kind = 'xbox') {
  if (!desc) return '—';
  const names = kind === 'ps' ? PAD_BTN_PS : PAD_BTN_XBOX;
  if (desc.b != null) return names[desc.b] || ('BTN ' + desc.b);
  if (desc.t != null) return names[desc.t] || ('BTN ' + desc.t);
  if (desc.a != null) {
    const stick = desc.a < 2 ? 'L-STICK' : 'R-STICK';
    const arrow = (desc.a % 2 === 0) ? (desc.d < 0 ? '←' : '→') : (desc.d < 0 ? '↑' : '↓');
    return desc.a < 4 ? `${stick} ${arrow}` : `AXIS ${desc.a}${desc.d < 0 ? '−' : '+'}`;
  }
  return '—';
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

// Same idea for the gamepad map: defaults (the standard mapping) overlaid with
// any saved per-action descriptor arrays.
function loadPadBindings() {
  const b = {};
  for (const k in DEFAULT_PAD) b[k] = DEFAULT_PAD[k].map((d) => ({ ...d }));
  try {
    const saved = JSON.parse(localStorage.getItem('sv-padbinds') || 'null');
    if (saved) for (const k in b) if (Array.isArray(saved[k]) && saved[k].length) b[k] = saved[k].map((d) => ({ ...d }));
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
