// Time-trial ghost: records the player's lap as a sampled path and replays the
// best one as a translucent ship flying the same line, synced to the player's
// lap time. Spline-domain (s, d, h) like everything else — no physics, no
// collision. Persisted per (track, class) in localStorage by main.js.
import * as THREE from 'three';
import { makeFrame } from '../track/spline.js';

const SAMPLE_DT = 0.05; // record ~20 poses/sec

export class GhostShip {
  // hullGeo: the player ship's hull BufferGeometry (shared — NOT disposed here).
  constructor(spline, scene, hullGeo, scaleX = 1, scaleZ = 1) {
    this.spline = spline;
    this.frame = makeFrame();
    this.rec = [];        // current lap, flat [t, s, d, h, ...]
    this.lastT = -1;
    this.path = null;     // best lap to replay: { dur, p:[t,s,d,h,...] }

    this.mat = new THREE.MeshBasicMaterial({
      color: 0x86e8ff, transparent: true, opacity: 0,
      depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(hullGeo, this.mat);
    mesh.scale.set(scaleX, 1, scaleZ);
    mesh.frustumCulled = false;
    this.root = new THREE.Group();
    this.root.add(mesh);
    this.root.visible = false;
    this._m = new THREE.Matrix4();
    this._neg = new THREE.Vector3();
    scene.add(this.root);
  }

  // ---- recording ----
  startLap() { this.rec = []; this.lastT = -1; }
  sample(t, s, d, h) {
    if (t < this.lastT) return;                               // lap wrapped (startLap resets)
    if (this.lastT >= 0 && t - this.lastT < SAMPLE_DT) return; // ~20Hz
    this.rec.push(+t.toFixed(2), +s.toFixed(1), +d.toFixed(2), +h.toFixed(2));
    this.lastT = t;
  }
  // The lap just recorded as a compact path, or null if too short to be real.
  takeLap() {
    if (this.rec.length < 12) return null;
    return { dur: this.rec[this.rec.length - 4], p: this.rec.slice() };
  }

  loadPath(obj) { this.path = (obj && obj.p && obj.p.length >= 8) ? obj : null; }
  clear() { this.path = null; this.root.visible = false; }

  // ---- replay: place the ghost where the best lap was at the player's lapT ----
  update(lapT, active) {
    if (!active || !this.path || lapT > this.path.dur + 0.2) { this.root.visible = false; return; }
    const p = this.path.p;
    const n = p.length / 4;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p[mid * 4] <= lapT) lo = mid; else hi = mid - 1; }
    const i = lo * 4, j = Math.min(lo + 1, n - 1) * 4;
    const t0 = p[i], t1 = p[j];
    const f = t1 > t0 ? THREE.MathUtils.clamp((lapT - t0) / (t1 - t0), 0, 1) : 0;
    const s = p[i + 1] + (p[j + 1] - p[i + 1]) * f;
    const d = p[i + 2] + (p[j + 2] - p[i + 2]) * f;
    const h = p[i + 3] + (p[j + 3] - p[i + 3]) * f;
    const fr = this.spline.frameAt(s, this.frame);
    this.root.position.copy(fr.pos).addScaledVector(fr.R, d).addScaledVector(fr.U, h);
    this._m.makeBasis(fr.R, fr.U, this._neg.copy(fr.T).negate());
    this.root.quaternion.setFromRotationMatrix(this._m);
    this.root.visible = true;
    this.mat.opacity = 0.34;
  }

  dispose(scene) {
    scene.remove(this.root);
    this.mat.dispose(); // the hull geometry is shared with the player ship — leave it
  }
}
