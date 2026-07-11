// Weapon system (Pass 3). Owns pickups, held-weapon state, firing, and the
// spline-domain projectiles (homing/missiles/mines) with their visuals.
// HARD RULES: everything is identical for player and AI — no position/gap term
// anywhere (weapons are combat, never catch-up); all simulation runs in the
// 120Hz fixed step (the render path is read-only); all randomness is seeded.
import * as THREE from 'three';
import { TUNING as T } from '../config.js';
import { makeFrame } from '../track/spline.js';

// Weighted pickup table — homing is the rare/strong one. The roll NEVER looks
// at race position: same odds for P1 and P8.
const WEIGHTS = [
  ['missiles', 0.26],
  ['boost', 0.22],
  ['mine', 0.20],
  ['shield', 0.18],
  ['homing', 0.14],
];

const MAX_PROJ = 12;          // hard cap on live projectiles (fill-budget)
const MISSILE_AMMO = 3;

// Per-type look: glow tint + trail tint + billboard size.
const PROJ_LOOK = {
  missiles: { col: 0xffc86a, trail: 0xffb13d, size: 1.6, h: 1.0 },
  homing: { col: 0xff6ade, trail: 0xff2ec8, size: 1.7, h: 1.0 },
  mine: { col: 0xff5a30, trail: null, size: 1.3, h: 0.55 },
};

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

function wrap(s, len) { s %= len; return s < 0 ? s + len : s; }
function sdist(a, b, len) {
  let d = (b - a) % len;
  if (d > len / 2) d -= len;
  if (d < -len / 2) d += len;
  return d;
}

// Soft radial glow sprite (same recipe as the engine glow texture).
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Pooled camera-facing ribbon trails, one slot per projectile (the ExhaustTrails
// pattern generalised to N slots with per-slot colour).
class ProjTrails {
  constructor(scene, slots) {
    this.slots = slots;
    this.maxAge = 0.35;
    this.maxPoints = 22;
    this.tracks = Array.from({ length: slots }, () => ({ points: [], col: new THREE.Color(0xffb13d) }));
    const vertCount = 2 * this.maxPoints * slots;
    this.positions = new Float32Array(vertCount * 3);
    this.colors = new Float32Array(vertCount * 4);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    const idx = [];
    for (let tr = 0; tr < slots; tr++) {
      const base = tr * this.maxPoints * 2;
      for (let i = 0; i < this.maxPoints - 1; i++) {
        const a = base + i * 2, b = a + 2;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    this.geom.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geom, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this._dir = new THREE.Vector3();
    this._side = new THREE.Vector3();
    scene.add(this.mesh);
  }

  start(slot, colHex) { const tr = this.tracks[slot]; tr.points.length = 0; tr.col.setHex(colHex); }
  clearSlot(slot) { this.tracks[slot].points.length = 0; }
  reset() { for (const tr of this.tracks) tr.points.length = 0; }

  push(slot, worldPos) {
    const tr = this.tracks[slot];
    const p = tr.points.length >= this.maxPoints ? tr.points.pop() : { pos: new THREE.Vector3(), t: 0 };
    p.pos.copy(worldPos);
    p.t = 0;
    tr.points.unshift(p);
  }

  update(dt, camera) {
    const width = 0.55;
    for (let trIdx = 0; trIdx < this.slots; trIdx++) {
      const tr = this.tracks[trIdx];
      const base = trIdx * this.maxPoints * 2;
      for (const p of tr.points) p.t += dt;
      while (tr.points.length && tr.points[tr.points.length - 1].t > this.maxAge) tr.points.pop();
      for (let i = 0; i < this.maxPoints; i++) {
        const p = tr.points[Math.min(i, tr.points.length - 1)];
        const k = (base + i * 2) * 3;
        const k4 = (base + i * 2) * 4;
        if (!p) { this.positions.fill(0, k, k + 6); this.colors.fill(0, k4, k4 + 8); continue; }
        const next = tr.points[Math.min(i + 1, tr.points.length - 1)];
        this._dir.subVectors(next.pos, p.pos);
        if (this._dir.lengthSq() < 1e-6) this._dir.set(0, 0, 1);
        this._side.subVectors(p.pos, camera.position).cross(this._dir).normalize();
        const fade = 1 - p.t / this.maxAge;
        const w = width * (0.4 + 0.6 * fade);
        this.positions[k] = p.pos.x + this._side.x * w;
        this.positions[k + 1] = p.pos.y + this._side.y * w;
        this.positions[k + 2] = p.pos.z + this._side.z * w;
        this.positions[k + 3] = p.pos.x - this._side.x * w;
        this.positions[k + 4] = p.pos.y - this._side.y * w;
        this.positions[k + 5] = p.pos.z - this._side.z * w;
        const a = fade * fade;
        // white-hot at the head, cooling to the weapon colour down the streak
        const heat = 1 - Math.min(1, p.t / 0.09);
        const r = tr.col.r + (1 - tr.col.r) * heat;
        const gc = tr.col.g + (1 - tr.col.g) * heat;
        const b = tr.col.b + (1 - tr.col.b) * heat;
        for (let e = 0; e < 2; e++) {
          this.colors[k4 + e * 4] = r;
          this.colors[k4 + e * 4 + 1] = gc;
          this.colors[k4 + e * 4 + 2] = b;
          this.colors[k4 + e * 4 + 3] = a;
        }
      }
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
  }

  dispose(scene) { scene.remove(this.mesh); this.geom.dispose(); this.mesh.material.dispose(); }
}

export class WeaponSystem {
  // race: the Race (for the AI roster). playerShip: the player's ShipPhysics.
  // juice: the event bus (HUD/FX/audio listen there).
  // opts.active: false in Time Trial — nothing ever arms or fires.
  // opts.seed: per-race seed so pickup rolls are reproducible.
  constructor(spline, scene, race, playerShip, juice, opts = {}) {
    this.spline = spline;
    this.scene = scene;
    this.race = race;
    this.player = playerShip;
    this.juice = juice;
    this.active = opts.active !== false;
    this.rng = mulberry32(opts.seed ?? 1);
    this._prevPad = new Map();   // phys -> activeWeaponPad last step (arm on transition)
    this._ammo = new Map();      // phys -> missiles left in the salvo
    this._cool = new Map();      // phys -> fire cooldown (s)
    this._holdT = new Map();     // phys -> s left on an unfired held weapon (use-it-or-lose-it)
    this._aiDelay = new Map();   // phys -> hold-fire countdown (reaction time)
    this._kap = { kappa: 0, bank: 0, width: 8, slope: 0, splitHalf: 0 }; // scalarsAt scratch
    // Vestigial per-pad state fed to the pad decal: pads no longer dim/lock
    // (every empty-handed racer that crosses gets armed), so this stays 0 and
    // the pad reads as always-live; the pickup flash is the gold spark burst.
    this.padCd = new Float32Array((spline.weaponPads && spline.weaponPads.length) || 0);
    this.projectiles = [];       // {slot, type, s, d, v, owner, life, armT, target}
    this._freeSlots = Array.from({ length: MAX_PROJ }, (_, i) => MAX_PROJ - 1 - i);

    // Visuals: one instanced billboard glow per slot + a pooled trail ribbon.
    this._f = makeFrame();
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._sc = new THREE.Vector3();
    this._c = new THREE.Color();
    if (this.active) {
      this.glows = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: glowTexture(), transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
        }),
        MAX_PROJ,
      );
      this.glows.frustumCulled = false;
      this.glows.renderOrder = 1;
      this.glows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < MAX_PROJ; i++) this.glows.setMatrixAt(i, zero);
      scene.add(this.glows);
      // Mines get a solid spinning body under the glow — a dropped OBJECT on the
      // road, not just a light. One instanced mesh, zero-scaled for non-mines.
      this.mineCores = new THREE.InstancedMesh(
        new THREE.OctahedronGeometry(0.42, 0),
        new THREE.MeshBasicMaterial({ color: 0xc2461f, fog: true }),
        MAX_PROJ,
      );
      this.mineCores.frustumCulled = false;
      this.mineCores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < MAX_PROJ; i++) this.mineCores.setMatrixAt(i, zero);
      scene.add(this.mineCores);
      this._q = new THREE.Quaternion();
      this._axis = new THREE.Vector3(0, 1, 0);
      this.trails = new ProjTrails(scene, MAX_PROJ);
    } else {
      this.glows = null;
      this.mineCores = null;
      this.trails = null;
    }
  }

  _ships() {
    // Roster is fixed for the life of a race — build once (the fixed step runs
    // at 120Hz; no per-step allocation).
    if (!this._shipList) {
      this._shipList = [this.player];
      if (this.race && this.race.racers) for (const r of this.race.racers) this._shipList.push(r.phys);
    }
    return this._shipList;
  }

  _roll() {
    let x = this.rng();
    for (const [type, w] of WEIGHTS) { x -= w; if (x <= 0) return type; }
    return WEIGHTS[0][0];
  }

  _spawn(type, s, d, v, owner, life, target = null) {
    if (!this._freeSlots.length) return null; // cap reached — refuse, don't grow
    const slot = this._freeSlots.pop();
    const p = { slot, type, s: wrap(s, this.spline.length), d, v, owner, life, armT: type === 'mine' ? T.MINE_ARM : 0, graceT: type === 'mine' ? 1.5 : 0, target };
    this.projectiles.push(p);
    if (this.trails && PROJ_LOOK[type].trail != null) this.trails.start(slot, PROJ_LOOK[type].trail);
    return p;
  }

  _despawn(p) {
    this.projectiles.splice(this.projectiles.indexOf(p), 1);
    this._freeSlots.push(p.slot);
    if (this.trails) this.trails.clearSlot(p.slot);
    if (this.glows) { this._m.makeScale(0, 0, 0); this.glows.setMatrixAt(p.slot, this._m); this.glows.instanceMatrix.needsUpdate = true; }
    if (this.mineCores) { this._m.makeScale(0, 0, 0); this.mineCores.setMatrixAt(p.slot, this._m); this.mineCores.instanceMatrix.needsUpdate = true; }
  }

  // Fire the held weapon. Identical rules for player and AI.
  _tryFire(phys, isPlayer) {
    if (!phys.heldWeapon || phys.disabledT > 0) return;
    if ((this._cool.get(phys) || 0) > 0) return;
    this._holdT.delete(phys); // you're using it — the fizzle fuse is off
    const type = phys.heldWeapon;
    const L = this.spline.length;

    if (type === 'boost') {
      phys.boostTimer = Math.max(phys.boostTimer, T.WEAPON_BOOST_TIME);
      phys.heldWeapon = null;
      this.juice.emit('weaponFire', { type, isPlayer, remaining: 0 });
      return;
    }
    if (type === 'shield') {
      phys.shielded = true;
      phys.shieldT = T.WEAPON_SHIELD_TIME; // drops on its own if no hit lands
      phys.heldWeapon = null;
      this.juice.emit('weaponFire', { type, isPlayer, remaining: 0 });
      return;
    }
    if (type === 'mine') {
      this._spawn('mine', phys.s - 4, phys.d, 0, phys, T.MINE_LIFE);
      phys.heldWeapon = null;
      this.juice.emit('weaponFire', { type, isPlayer, remaining: 0 });
      return;
    }
    if (type === 'missiles') {
      let ammo = this._ammo.get(phys);
      if (ammo == null) ammo = MISSILE_AMMO;
      this._spawn('missiles', phys.s + 4, phys.d, phys.v + T.MISSILE_SPEED_REL, phys, T.MISSILE_LIFE);
      ammo -= 1;
      this._cool.set(phys, T.MISSILE_COOLDOWN);
      if (ammo <= 0) { this._ammo.delete(phys); phys.heldWeapon = null; } else this._ammo.set(phys, ammo);
      this.juice.emit('weaponFire', { type, isPlayer, remaining: ammo });
      return;
    }
    if (type === 'homing') {
      // Lock the nearest ship AHEAD within range (any lateral) — no lock, it
      // still fires straight. Never position-aware, just geometry.
      let target = null, best = T.HOMING_RANGE + 1;
      for (const other of this._ships()) {
        if (other === phys) continue;
        const ds = sdist(phys.s, other.s, L);
        if (ds > 0.5 && ds < best) { best = ds; target = other; }
      }
      this._spawn('homing', phys.s + 4, phys.d, phys.v + T.MISSILE_SPEED_REL, phys, T.HOMING_LIFE, target);
      phys.heldWeapon = null;
      this.juice.emit('weaponFire', { type, isPlayer, remaining: 0 });
      return;
    }
  }

  // Runs inside main.js's fixed while-loop, after race.stepFixed/interact.
  stepFixed(dt, racing, playerFire = false) {
    if (!this.active || !racing) return;
    const L = this.spline.length;

    // ---- pickups: arm on a fresh weapon-pad crossing (latch transition). PER
    // DRIVER — every empty-handed racer that crosses gets one, so the leader
    // can't hoard the pad. Fairness by construction; no position term.
    for (const phys of this._ships()) {
      const prev = this._prevPad.get(phys) ?? -1;
      const cur = phys.activeWeaponPad;
      if (cur >= 0 && cur !== prev && phys.heldWeapon === null) {
        phys.heldWeapon = this._roll();
        this._holdT.set(phys, T.WEAPON_HOLD_TIME); // start the use-it-or-lose-it fuse
        this.juice.emit('weaponArmed', { type: phys.heldWeapon, isPlayer: phys === this.player });
        this.juice.emit('padTaken', { pad: cur, isPlayer: phys === this.player });
      }
      this._prevPad.set(phys, cur);
      // use-it-or-lose-it: an UNFIRED held weapon fizzles after WEAPON_HOLD_TIME
      // (the fuse is cleared the instant you fire — see _tryFire). An offensive
      // pickup with no target ahead just burns down and pops — no banking.
      if (phys.heldWeapon !== null && this._holdT.has(phys)) {
        const h = this._holdT.get(phys) - dt;
        if (h <= 0) {
          const lost = phys.heldWeapon;
          phys.heldWeapon = null;
          this._ammo.delete(phys);
          this._holdT.delete(phys);
          this.juice.emit('weaponFizzle', { type: lost, isPlayer: phys === this.player });
        } else this._holdT.set(phys, h);
      }
      const c = this._cool.get(phys);
      if (c > 0) this._cool.set(phys, c - dt);
    }

    // ---- player fire intent (edge, once per frame)
    if (playerFire) this._tryFire(this.player, true);

    // ---- AI fire policy: state-driven, seeded, gated by SKILL only — never
    // by race position or gap-to-anyone. Every tier fires; low skill just
    // reacts slower (gate accuracy, not existence).
    if (this.race && this.race.racers) {
      for (const r of this.race.racers) {
        const phys = r.phys;
        if (!phys.heldWeapon || phys.disabledT > 0) { this._aiDelay.delete(phys); continue; }
        if ((this._cool.get(phys) || 0) > 0) continue;
        const type = phys.heldWeapon;
        let want = false;
        if (type === 'shield') {
          want = true; // armor up as soon as you have it
        } else if (type === 'boost') {
          const sc = this.spline.scalarsAt(phys.s, this._kap);
          want = Math.abs(sc.kappa) < 0.006 && phys.v > 20; // spend it on a straight
        } else if (type === 'missiles' || type === 'homing') {
          const range = type === 'homing' ? T.HOMING_RANGE : 60;
          const dd = type === 'homing' ? 6 : 3;
          for (const other of this._ships()) {
            if (other === phys) continue;
            const ds = sdist(phys.s, other.s, L);
            if (ds > 4 && ds < range && Math.abs(other.d - phys.d) < dd) { want = true; break; }
          }
        } else if (type === 'mine') {
          for (const other of this._ships()) {
            if (other === phys) continue;
            const ds = sdist(phys.s, other.s, L);
            if (ds < -3 && ds > -18) { want = true; break; } // someone on my tail
          }
        }
        if (!want) { this._aiDelay.delete(phys); continue; }
        let hold = this._aiDelay.get(phys);
        if (hold == null) hold = 0.35 + (1 - Math.min(1, r.driver.skill.corner)) * 0.9 + r.driver.rng() * 0.3;
        hold -= dt;
        if (hold <= 0) { this._aiDelay.delete(phys); this._tryFire(phys, false); }
        else this._aiDelay.set(phys, hold);
      }
    }

    // ---- projectile sim (spline domain)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.armT > 0) p.armT -= dt;
      if (p.graceT > 0) p.graceT -= dt;
      if (p.type !== 'mine') {
        p.s = wrap(p.s + p.v * dt, L);
        if (p.type === 'homing' && p.target) {
          const dd = p.target.d - p.d;
          const step = T.HOMING_D_RATE * dt;
          p.d += Math.abs(dd) < step ? dd : Math.sign(dd) * step;
        }
      }
      if (p.life <= 0) { this._despawn(p); continue; }

      // ---- hit detection: pure Δs/Δd geometry, identical for every ship.
      // Mines arm after MINE_ARM and spare their OWNER only during a short
      // grace window — after that they hit whoever crosses them, dropper too.
      if (p.type === 'mine' && p.armT > 0) continue;
      const dsWin = p.type === 'mine' ? T.MINE_TRIGGER_DS : T.MISSILE_HIT_DS;
      const ddWin = p.type === 'mine' ? T.MINE_TRIGGER_DD : T.MISSILE_HIT_DD;
      for (const victim of this._ships()) {
        if (victim === p.owner && (p.type !== 'mine' || p.graceT > 0)) continue;
        if (Math.abs(sdist(p.s, victim.s, L)) >= dsWin || Math.abs(p.d - victim.d) >= ddWin) continue;
        this._hit(p, victim);
        break; // one victim per projectile
      }
    }

    // (stage 4: AI fire policy)
  }

  // A projectile connected. Shield eats the hit; otherwise the victim is
  // disabled for WEAPON_DISABLE_TIME (thrust cut in ShipPhysics.step).
  _hit(p, victim) {
    const isPlayer = victim === this.player;
    if (victim.shielded) {
      victim.shielded = false;
      victim.shieldT = 0;
      this.juice.emit('shieldSave', {
        type: p.type, victimIsPlayer: isPlayer,
        shooterIsPlayer: p.owner === this.player, victim, shooter: p.owner,
      });
    } else {
      victim.disabledT = T.WEAPON_DISABLE_TIME;
      this.juice.emit('weaponHit', {
        type: p.type, victimIsPlayer: isPlayer,
        shooterIsPlayer: p.owner === this.player, victim, shooter: p.owner,
      });
    }
    this._despawn(p);
  }

  // Render-path visuals only — never simulation.
  updateVisuals(dt, camera) {
    if (!this.active || !this.glows) return;
    for (const p of this.projectiles) {
      const look = PROJ_LOOK[p.type];
      this.spline.frameAt(p.s, this._f);
      this._v.copy(this._f.pos).addScaledVector(this._f.R, p.d).addScaledVector(this._f.U, look.h);
      const pulse = p.type === 'mine' ? (p.armT > 0 ? 0.55 : 0.75 + 0.25 * Math.sin(performance.now() / 90)) : 1;
      this._sc.setScalar(look.size * pulse);
      this._m.compose(this._v, camera.quaternion, this._sc);
      this.glows.setMatrixAt(p.slot, this._m);
      this.glows.setColorAt(p.slot, this._c.setHex(look.col));
      if (p.type === 'mine' && this.mineCores) {
        this._q.setFromAxisAngle(this._axis, performance.now() / 400);
        this._sc.setScalar(p.armT > 0 ? 0.7 : 1);
        this._m.compose(this._v, this._q, this._sc);
        this.mineCores.setMatrixAt(p.slot, this._m);
      }
      if (this.trails && look.trail != null) this.trails.push(p.slot, this._v);
    }
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    if (this.mineCores) this.mineCores.instanceMatrix.needsUpdate = true;
    if (this.trails) this.trails.update(dt, camera);
  }

  // Fresh grid/retry: clear held weapons, timers and projectiles on every ship.
  reset() {
    this._prevPad.clear();
    this._ammo.clear();
    this._cool.clear();
    this._holdT.clear();
    this._aiDelay.clear();
    this.padCd.fill(0);
    while (this.projectiles.length) this._despawn(this.projectiles[0]);
    for (const phys of this._ships()) {
      phys.heldWeapon = null;
      phys.disabledT = 0;
      phys.shielded = false;
      phys.shieldT = 0;
      phys.activeWeaponPad = -1;
    }
    if (this.active) this.juice.emit('weaponArmed', { type: null, isPlayer: true }); // clears the HUD slot
  }

  dispose() {
    if (this.glows) {
      this.scene.remove(this.glows);
      this.glows.geometry.dispose();
      this.glows.material.map && this.glows.material.map.dispose();
      this.glows.material.dispose();
      this.glows = null;
    }
    if (this.mineCores) {
      this.scene.remove(this.mineCores);
      this.mineCores.geometry.dispose();
      this.mineCores.material.dispose();
      this.mineCores = null;
    }
    if (this.trails) { this.trails.dispose(this.scene); this.trails = null; }
  }
}
