// Instanced pools: the speed-line tunnel (one draw call, the anime effect),
// wall sparks, boost bursts, and the two camera-facing exhaust ribbons.
import * as THREE from 'three';
import { TUNING as T } from '../config.js';
import { mulberry32 } from '../track/scenery.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

// ------------------------------------------------------------ speed lines
// ~150 thin instanced boxes in a ring around the camera's forward axis,
// camera-space, scrolling back and wrapping.
export class SpeedLines {
  constructor(camera) {
    const rng = mulberry32(42);
    const n = T.SPEEDLINE_COUNT;
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.04, 1), this.mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.lines = [];
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const r = T.SPEEDLINE_R_MIN + rng() * (T.SPEEDLINE_R_MAX - T.SPEEDLINE_R_MIN);
      this.lines.push({
        x: Math.cos(ang) * r,
        y: Math.sin(ang) * r,
        z: -5 - rng() * 45,
      });
    }
    this.camera = camera;
    this.center = new THREE.Vector3(); // ring center in camera space = the ship
    this._local = new THREE.Vector3();
    camera.add(this.mesh);
  }

  update(dt, v, speedNorm, boostFactor, shipWorldPos) {
    // The tunnel converges on the SHIP, not the screen center: track the
    // ship's camera-space position, smoothed so trauma shake doesn't rattle it.
    this.camera.updateMatrixWorld();
    this._local.copy(shipWorldPos);
    this.camera.worldToLocal(this._local);
    const k = 1 - Math.exp(-8 * dt);
    this.center.x += (THREE.MathUtils.clamp(this._local.x, -6, 6) - this.center.x) * k;
    this.center.y += (THREE.MathUtils.clamp(this._local.y + 0.4, -3.5, 3.5) - this.center.y) * k;
    // Keep the ring's inner radius clear of the camera, or near-axis lines
    // project as wide washed-out bands across the screen.
    const cLen = Math.hypot(this.center.x, this.center.y);
    const maxOff = T.SPEEDLINE_R_MIN - 2.6;
    if (cLen > maxOff) {
      this.center.x *= maxOff / cLen;
      this.center.y *= maxOff / cLen;
    }

    const len = T.SPEEDLINE_LEN_BASE + T.SPEEDLINE_LEN_SPEED * speedNorm * speedNorm;
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      l.z += v * dt;
      // Wrap BEFORE the camera plane — a line crossing z=0 projects as a
      // screen-filling streak.
      if (l.z > -1.5) l.z -= 48.5;
      _m.makeScale(1, 1, len);
      _m.setPosition(l.x + this.center.x, l.y + this.center.y, l.z);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    const a = THREE.MathUtils.clamp(
      (speedNorm - T.SPEEDLINE_THRESHOLD) / (1 - T.SPEEDLINE_THRESHOLD), 0, 1,
    ) * T.SPEEDLINE_ALPHA;
    this.mat.opacity = Math.min(1, a * (1 + (T.SPEEDLINE_BOOST_MULT - 1) * boostFactor));
  }
}

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

  spawn(pos, vel, spread, count, colA, colB) {
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
      p.maxLife = 0.3 + this.rng() * 0.3;
      p.life = p.maxLife;
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
      const t = 1 - p.life / p.maxLife;
      const sc = 1 - t * 0.6;
      _m.makeScale(sc, sc, sc + p.vel.length() * 0.04);
      _m.setPosition(p.pos.x, p.pos.y, p.pos.z);
      this.mesh.setMatrixAt(i, _m);
      this._c.copy(p.colA).lerp(p.colB, t);
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
    this.colCyan = new THREE.Color(T.COL.ENGINE);
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
    this._c.copy(this.colCyan).lerp(this.colBoost, boostFactor);
    const alphaBase = (0.08 + speedNorm * 0.35 + boostFactor * 0.35)
      * Math.min(speedNorm * 4, 1); // no ghost ribbon while parked
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
