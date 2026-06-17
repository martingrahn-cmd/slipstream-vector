// The race field: 7 AI opponents around the player. Owns AI physics+drivers+
// visuals, the start grid, ship-to-ship contact, live positions and the
// finish order. FAIRNESS: AI runs the same ShipPhysics with the same TUNING;
// difficulty only moves driver skill. No rubber-banding.
import * as THREE from 'three';
import { TUNING as T } from './config.js';
import { ShipPhysics } from './ship/shipPhysics.js';
import { ShipVisual } from './ship/shipVisual.js';
import { AiDriver } from './ship/aiDriver.js';
import { aiRoster } from './worlds/teams.js';

const NULL_BUS = { emit() {}, on() {} };

export class Race {
  // aiLevel: the chosen rival difficulty as a skill scalar (~0.6 easy .. 5 hard),
  // from worlds/difficulty.js — DECOUPLED from which track this is.
  // selection: the player's seat {team, livery, callsign}.
  // solo: time trial — no AI on track. cls: the active speed class (scales
  // AI physics AND skill, same as the player's ship).
  constructor(spline, scene, aiLevel, totalLaps, juice, selection, solo = false, cls = null) {
    this.spline = spline;
    this.scene = scene;
    this.totalLaps = totalLaps;
    this.juice = juice;
    this.selection = selection;
    this.clock = 0;

    // Corner-speed confidence ramps with the chosen difficulty AND the speed class.
    const base = 0.82 + aiLevel * 0.045 + (cls ? cls.aiSkill : 0);
    const seats = solo ? [] : aiRoster(selection.team, Math.min(selection.livery, 1));
    this.racers = seats.map((seat, i) => {
      const sk = seat.team.skill;
      const skill = {
        corner: Math.min(1.1, base + sk.corner + (i % 2) * 0.02),
        line: Math.max(0.1, Math.min(1, 0.45 + aiLevel * 0.09 + sk.line * 4)),
        boost: Math.max(0, Math.min(1, 0.3 + aiLevel * 0.12 + sk.boost * 3)),
      };
      const phys = new ShipPhysics(spline, NULL_BUS, seat.team.stats, cls);
      const vis = new ShipVisual(spline, scene, {
        ...seat.team.variant,
        ...seat.team.liveries[seat.livery],
      });
      return {
        seat, phys, vis,
        driver: new AiDriver(spline, skill, Math.floor(1000 + aiLevel * 97 + i * 31)),
        boostEnv: 0,
        finishTime: null,
        name: `${seat.team.name} · ${seat.pilot}`,
        accentCss: `#${seat.team.liveries[seat.livery].accent.toString(16).padStart(6, '0')}`,
      };
    });
  }

  // Stagger the grid ahead of the player: the field starts in front, the
  // player fights forward through it. Skill order — best at the front.
  grid() {
    const sorted = [...this.racers].sort(
      (a, b) => a.driver.skill.corner - b.driver.skill.corner);
    sorted.forEach((r, i) => {
      r.phys.reset(21 + i * 8);
      r.phys.lap = 1;
      r.phys.d = (i % 2 === 0 ? -1 : 1) * 3.1;
      r.finishTime = null;
      r.boostEnv = 0;
    });
    this.clock = 0;
  }

  // Fixed-step AI simulation; `racing` gates driving (false during countdown).
  // The race clock is THE clock for results — player and AI alike.
  stepFixed(dt, racing) {
    if (racing) this.clock += dt;
    for (const r of this.racers) {
      if (racing) {
        const input = r.driver.update(dt, r.phys);
        r.phys.step(dt, input);
        if (r.finishTime === null && r.phys.lap > this.totalLaps) {
          r.finishTime = this.clock;
        }
      }
    }
  }

  // Ship-to-ship contact: positional separation + velocity impulses, so
  // ships feel SOLID — you cannot drive through the one ahead. Momentum
  // stays honest: impulses trade speed, no one is teleported, and a hard
  // hit per pair has a cooldown so contact doesn't machine-gun.
  interact(player, dt) {
    if (!this._pairCool) this._pairCool = new Map();
    const all = [player, ...this.racers.map((r) => r.phys)];
    const L = this.spline.length;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        let ds = (b.s - a.s) % L;
        if (ds > L / 2) ds -= L;
        if (ds < -L / 2) ds += L;
        if (Math.abs(ds) > 4.8) continue;
        const dd = b.d - a.d;
        if (Math.abs(dd) > 2.5) continue;

        const dir = dd >= 0 ? 1 : -1;
        const overlapD = 2.5 - Math.abs(dd);
        // Hard positional separation + a lateral shove.
        const sep = Math.min(overlapD * 0.5, 10 * dt);
        a.d -= dir * sep;
        b.d += dir * sep;
        a.vd -= dir * 30 * dt;
        b.vd += dir * 30 * dt;

        // Longitudinal: the trailing ship cannot pass THROUGH the leader.
        const lead = ds > 0 ? b : a;
        const trail = ds > 0 ? a : b;
        const closing = trail.v - lead.v;
        if (Math.abs(dd) < 2.0 && closing > 0) {
          const key = i * 16 + j;
          const fresh = this.clock - (this._pairCool.get(key) ?? -9) > 0.45;
          if (fresh && closing > 5) {
            // A real shunt: trade momentum, shake whoever is involved.
            trail.v -= closing * 0.55;
            lead.v += closing * 0.3;
            this._pairCool.set(key, this.clock);
            if (trail === player || lead === player) {
              this.juice.emit('bump', { severity: Math.min(closing / 18, 1) });
            }
          } else {
            // Riding the bumper: held at the leader's pace.
            trail.v = Math.min(trail.v, lead.v + 1.2);
          }
        } else if ((a === player || b === player) && overlapD > 1.3) {
          this.juice.trauma = Math.max(this.juice.trauma, 0.1);
        }
      }
    }
  }

  // Launch boosts at GO: drivers who nail their start get one — the same
  // opportunity the player's throttle timing gives them, gated by skill.
  launchBoosts() {
    for (const r of this.racers) {
      if (r.driver.rng() < 0.2 + r.driver.skill.boost * 0.45) {
        r.phys.boostTimer = 0.7 + r.driver.skill.corner * 0.5;
      }
    }
  }

  // Per-render-frame visuals.
  updateVisuals(dt) {
    for (const r of this.racers) {
      const boosting = r.phys.boostTimer > 0 ? 1 : 0;
      r.boostEnv += (boosting - r.boostEnv) * Math.min(1, 8 * dt);
      r.vis.update(dt, r.phys, r.driver.input, r.boostEnv);
    }
  }

  // 1-based position of the player and the full standings.
  progressOf(p) {
    return p.lap * this.spline.length + p.s;
  }

  positionOf(player) {
    let pos = 1;
    const pp = this.progressOf(player);
    for (const r of this.racers) if (this.progressOf(r.phys) > pp) pos++;
    return pos;
  }

  // Final standings when the player crosses the line: finished racers by
  // time, the rest by distance. Player slotted by its own finish.
  results(player, playerTime) {
    const rows = this.racers.map((r) => ({
      id: `${r.seat.team.id}-${r.seat.livery}`,
      name: r.name,
      accent: r.accentCss,
      time: r.finishTime,
      progress: this.progressOf(r.phys),
      player: false,
    }));
    const sel = this.selection;
    rows.push({
      id: 'you',
      name: `${sel.teamName} · ${sel.callsign}`,
      accent: sel.accentCss,
      time: playerTime,
      progress: this.progressOf(player),
      player: true,
    });
    rows.sort((a, b) => {
      if (a.time !== null && b.time !== null) return a.time - b.time;
      if (a.time !== null) return -1;
      if (b.time !== null) return 1;
      return b.progress - a.progress;
    });
    return rows;
  }

  minimapDots(out = []) {
    out.length = 0;
    const f = this._f || (this._f = { x: 0, z: 0 });
    for (const r of this.racers) {
      const sp = this.spline;
      const i = Math.floor(sp.wrap(r.phys.s) / sp.step) % sp.n;
      out.push({
        x: sp.pos[i * 3] + sp.right[i * 3] * r.phys.d,
        z: sp.pos[i * 3 + 2] + sp.right[i * 3 + 2] * r.phys.d,
        color: r.accentCss,
      });
    }
    return out;
  }

  dispose(scene) {
    for (const r of this.racers) {
      scene.remove(r.vis.root, r.vis.shadow);
      r.vis.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
      r.vis.shadow.geometry.dispose();
      r.vis.shadow.material.dispose();
    }
  }
}
