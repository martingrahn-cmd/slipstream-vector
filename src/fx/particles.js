// Instanced pools: the speed-line tunnel (one draw call, the anime effect),
// wall sparks, boost bursts, and the two camera-facing exhaust ribbons.
import * as THREE from 'three';
import { TUNING as T } from '../config.js';
import { mulberry32 } from '../track/scenery.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _forward = new THREE.Vector3(0, 0, 1); // spark box long axis, oriented to velocity
const _white = new THREE.Color(0xffffff);    // spark birth-flash target

// ----------------------------------------------------------------- sparks
export class Sparks {
  constructor(scene) {
    const n = T.SPARK_POOL;
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.14),
      new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false,
      }),
      n,
    );
    this.mesh.frustumCulled = false;
    this.pool = [];
    for (let i = 0; i < n; i++) {
      this.pool.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1 });
    }
    this.cursor = 0;
    this.colA = new THREE.Color(T.COL.SPARK_A);
    this.colB = new THREE.Color(T.COL.SPARK_B);
    this._c = new THREE.Color();
    this.rng = mulberry32(7);
    scene.add(this.mesh);
  }

  // normal (optional): a contact normal; sparks fan AWAY from it (wall hits).
  // floorY (optional): the true surface height to bounce off; defaults to the
  // spawn height (correct for ground sources, wrong for elevated emitters).
  spawn(pos, vel, spread, count, colA, colB, normal, floorY) {
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.pool.length;
      p.alive = true;
      p.pos.copy(pos);
      p.vel.set(
        vel.x + (this.rng() - 0.5) * spread,
        vel.y + (this.rng() - 0.5) * spread * 0.7 + spread * 0.25,
        vel.z + (this.rng() - 0.5) * spread,
      );
      if (normal) p.vel.addScaledVector(normal, spread * 0.6);
      p.maxLife = 0.3 + this.rng() * 0.3;
      p.life = p.maxLife;
      p.floorY = (floorY !== undefined) ? floorY : pos.y; // bounce off the real surface
      p.bounced = false;
      p.colA = colA || this.colA;
      p.colB = colB || this.colB;
    }
  }

  update(dt) {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.alive) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.vel.y += T.SPARK_GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      // One damped bounce off the spawn surface (banked/climbing tracks).
      if (!p.bounced && p.vel.y < 0 && p.pos.y < p.floorY) {
        p.pos.y = p.floorY;
        p.vel.y *= -0.35;
        p.vel.x += (this.rng() - 0.5) * 1.2;
        p.vel.z += (this.rng() - 0.5) * 1.2;
        p.bounced = true;
      }
      const t = 1 - p.life / p.maxLife;
      const speed = p.vel.length();
      const sc = 1 - t * 0.6;
      // Orient the box along travel so the stretch reads as a real streak.
      if (speed > 0.4) { _v.copy(p.vel).multiplyScalar(1 / speed); _q.setFromUnitVectors(_forward, _v); }
      else { _q.identity(); }
      const birth = t < 0.12 ? (1 - t / 0.12) : 0;   // bright flash-frame at birth
      _s.set(sc, sc, sc + speed * 0.12).multiplyScalar(1 + birth * 0.3);
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this._c.copy(p.colA).lerp(p.colB, t).lerp(_white, birth * 0.8);
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// --------------------------------------------------------- exhaust trails
// Two camera-facing ribbons rebuilt every frame from a ring buffer of nozzle
// positions. Cyan fading to transparent; white-hot and wider while boosting.
export class ExhaustTrails {
  constructor(scene) {
    this.trails = [0, 1].map(() => ({
      points: [], // {pos: Vector3, t: age}
    }));
    // Short-lived: at vmax this is a ~12m ribbon. Longer and it reaches the
    // chase camera and reads as two giant light beams.
    this.maxAge = 0.15;
    this.maxPoints = 26;

    const segs = this.maxPoints - 1;
    this.geom = new THREE.BufferGeometry();
    const vertCount = 2 * this.maxPoints * 2; // 2 trails
    this.positions = new Float32Array(vertCount * 3);
    this.colors = new Float32Array(vertCount * 4);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    const idx = [];
    for (let tr = 0; tr < 2; tr++) {
      const base = tr * this.maxPoints * 2;
      for (let i = 0; i < segs; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geom.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geom, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    // The ribbon is the ship's glow hue (matches the direct engine glow),
    // set via setColor(); defaults to the base engine cyan. Whitens on boost.
    this.colHead = new THREE.Color(T.COL.ENGINE);
    this.colBoost = new THREE.Color(0xfff6e8);
    this._c = new THREE.Color();
    this._dir = new THREE.Vector3();
    this._side = new THREE.Vector3();
    scene.add(this.mesh);
  }

  // Clear the ring buffers (world rebuild — old positions are on another track).
  reset() {
    for (const tr of this.trails) tr.points.length = 0;
  }

  // Theme the whole trail to the ship's glow hue (matches the engine glow).
  setColor(hex) { this.colHead.set(hex); }

  push(trailIdx, worldPos) {
    const tr = this.trails[trailIdx];
    // Recycle the oldest point object instead of cloning a Vector3 per frame.
    const p = tr.points.length >= this.maxPoints
      ? tr.points.pop()
      : { pos: new THREE.Vector3(), t: 0 };
    p.pos.copy(worldPos);
    p.t = 0;
    tr.points.unshift(p);
  }

  update(dt, camera, boostFactor, speedNorm) {
    const width = 0.12 + 0.22 * boostFactor;
    const alphaBase = (0.08 + speedNorm * 0.24 + boostFactor * 0.35)
      * Math.min(speedNorm * 4, 1); // lower speed-alpha so the ship-hue holds (doesn't blow to white); no ghost ribbon while parked
    for (let trIdx = 0; trIdx < 2; trIdx++) {
      const tr = this.trails[trIdx];
      const base = trIdx * this.maxPoints * 2;
      for (const p of tr.points) p.t += dt;
      while (tr.points.length && tr.points[tr.points.length - 1].t > this.maxAge) tr.points.pop();
      for (let i = 0; i < this.maxPoints; i++) {
        const p = tr.points[Math.min(i, tr.points.length - 1)];
        const k = (base + i * 2) * 3;
        const k4 = (base + i * 2) * 4;
        if (!p) {
          this.positions.fill(0, k, k + 6);
          this.colors.fill(0, k4, k4 + 8);
          continue;
        }
        const next = tr.points[Math.min(i + 1, tr.points.length - 1)];
        this._dir.subVectors(next.pos, p.pos);
        if (this._dir.lengthSq() < 1e-6) this._dir.set(0, 0, 1);
        this._side.subVectors(p.pos, camera.position).cross(this._dir).normalize();
        const fade = 1 - p.t / this.maxAge;
        // the ribbon is the ship's glow hue the whole length (matches the direct
        // engine glow), fading out via alpha; only boost whitens it.
        this._c.copy(this.colHead).lerp(this.colBoost, boostFactor);
        const w = width * (0.4 + 0.6 * fade);
        this.positions[k] = p.pos.x + this._side.x * w;
        this.positions[k + 1] = p.pos.y + this._side.y * w;
        this.positions[k + 2] = p.pos.z + this._side.z * w;
        this.positions[k + 3] = p.pos.x - this._side.x * w;
        this.positions[k + 4] = p.pos.y - this._side.y * w;
        this.positions[k + 5] = p.pos.z - this._side.z * w;
        const a = fade * fade * alphaBase;
        for (let e = 0; e < 2; e++) {
          this.colors[k4 + e * 4] = this._c.r;
          this.colors[k4 + e * 4 + 1] = this._c.g;
          this.colors[k4 + e * 4 + 2] = this._c.b;
          this.colors[k4 + e * 4 + 3] = a;
        }
      }
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
  }
}
