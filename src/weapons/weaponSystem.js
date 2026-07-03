// Weapon system (Pass 3). Owns pickups, held-weapon state, and (stage 2+)
// projectiles, hits and AI fire policy. HARD RULES: everything is identical for
// player and AI — no position/gap term anywhere (weapons are combat, never
// catch-up); all simulation runs in the 120Hz fixed step (render path is
// read-only); all randomness is seeded (determinism).
import { TUNING as T } from '../config.js';

// Weighted pickup table — homing is the rare/strong one. The roll NEVER looks
// at race position: same odds for P1 and P8.
const WEIGHTS = [
  ['missiles', 0.26],
  ['boost', 0.22],
  ['mine', 0.20],
  ['shield', 0.18],
  ['homing', 0.14],
];

// Small seeded PRNG (mulberry32) — the sim path never touches Math.random().
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WeaponSystem {
  // race: the Race (for the AI roster). playerShip: the player's ShipPhysics.
  // juice: the event bus (HUD/FX/audio listen there).
  // opts.active: false in Time Trial — nothing ever arms.
  // opts.seed: per-race seed so pickup rolls are reproducible.
  constructor(spline, race, playerShip, juice, opts = {}) {
    this.spline = spline;
    this.race = race;
    this.player = playerShip;
    this.juice = juice;
    this.active = opts.active !== false;
    this.rng = mulberry32(opts.seed ?? 1);
    this._prevPad = new Map(); // phys -> activeWeaponPad last step (arm on transition)
  }

  _ships() {
    const list = [this.player];
    if (this.race && this.race.racers) for (const r of this.race.racers) list.push(r.phys);
    return list;
  }

  _roll() {
    let x = this.rng();
    for (const [type, w] of WEIGHTS) { x -= w; if (x <= 0) return type; }
    return WEIGHTS[0][0];
  }

  // Runs inside main.js's fixed while-loop, after race.stepFixed/interact.
  stepFixed(dt, racing, playerFire = false) {
    if (!this.active || !racing) return;

    // ---- pickups: arm on a fresh weapon-pad crossing (latch transition).
    // One code path for player and AI.
    for (const phys of this._ships()) {
      const prev = this._prevPad.get(phys) ?? -1;
      const cur = phys.activeWeaponPad;
      if (cur >= 0 && cur !== prev && phys.heldWeapon === null) {
        phys.heldWeapon = this._roll();
        this.juice.emit('weaponArmed', { type: phys.heldWeapon, isPlayer: phys === this.player });
      }
      this._prevPad.set(phys, cur);
    }

    // (stage 2: playerFire -> launch projectiles; AI fire policy; projectile sim)
  }

  // Render-path visuals only (projectile meshes/trails) — never simulation.
  updateVisuals(dt, camera) { /* stage 2 */ }

  // Fresh grid/retry: clear held weapons + timers on every ship.
  reset() {
    this._prevPad.clear();
    for (const phys of this._ships()) {
      phys.heldWeapon = null;
      phys.disabledT = 0;
      phys.shielded = false;
      phys.activeWeaponPad = -1;
    }
    if (this.active) this.juice.emit('weaponArmed', { type: null, isPlayer: true }); // clears the HUD slot
  }

  dispose() { /* stage 2: remove projectile meshes from the scene */ }
}
