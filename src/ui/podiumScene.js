// Championship podium ceremony: a full-screen 3D stage with the top-three ships
// on tiers, spotlights, confetti and a camera move. It owns its own renderer
// and scene so it can take over the screen cleanly at the end of a championship.
// Edge-neon language (cyan/magenta) carries the stage; medal gold/silver/bronze
// is reserved for the tiers themselves so 1st/2nd/3rd read at a glance.
import * as THREE from 'three';
import { buildShipMesh } from '../ship/shipVisual.js';

const MEDAL = [0xffd24a, 0xd7dcea, 0xcd7f3a]; // gold / silver / bronze
const TIER_H = [3.0, 1.9, 1.3];               // pedestal heights: 1st / 2nd / 3rd
const TIER_X = [0, -5.4, 5.4];
const TIER_Z = [0, 0.8, 0.8];

export class PodiumScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070310);
    this.scene.fog = new THREE.Fog(0x070310, 26, 70);
    this.camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.1, 180);

    this.active = false;
    this.t = 0;
    this.ships = [];
    this._marker = null;
    this._buildStage();
    this._buildConfetti();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  _buildStage() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(44, 64),
      new THREE.MeshBasicMaterial({ color: 0x0b0820 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Concentric neon rings on the stage floor (cyan/magenta).
    for (let i = 0; i < 5; i++) {
      const r = 6 + i * 5.5;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.16, 84),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xff2ec8 : 0x00f0ff, transparent: true,
          opacity: 0.5 - i * 0.07, blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      this.scene.add(ring);
    }

    // Soft backdrop glow + a starfield void behind the stage.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 56),
      new THREE.MeshBasicMaterial({
        color: 0x2a1150, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }),
    );
    glow.position.set(0, 15, -30);
    this.scene.add(glow);

    const N = 320;
    const sp = new Float32Array(N * 3);
    let seed = 9; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < N; i++) {
      sp[i * 3] = (rnd() - 0.5) * 150;
      sp[i * 3 + 1] = rnd() * 46 + 3;
      sp[i * 3 + 2] = -18 - rnd() * 46;
    }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)),
      new THREE.PointsMaterial({ size: 0.5, color: 0x9fd8ff, transparent: true, opacity: 0.8, fog: false }),
    );
    this.scene.add(stars);

    // Three pedestals, medal-capped, each lit by an additive spotlight cone.
    this.spots = [];
    for (let i = 0; i < 3; i++) {
      const h = TIER_H[i];
      const ped = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, h, 3.4),
        new THREE.MeshBasicMaterial({ color: 0x1a1238 }),
      );
      ped.position.set(TIER_X[i], h / 2, TIER_Z[i]);
      this.scene.add(ped);

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 0.2, 3.6),
        new THREE.MeshBasicMaterial({ color: MEDAL[i] }),
      );
      cap.position.set(TIER_X[i], h + 0.1, TIER_Z[i]);
      this.scene.add(cap);

      const edge = new THREE.Mesh(
        new THREE.RingGeometry(2.45, 2.7, 44),
        new THREE.MeshBasicMaterial({
          color: MEDAL[i], transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(TIER_X[i], h + 0.22, TIER_Z[i]);
      this.scene.add(edge);

      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(2.8, 9.5, 26, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xbfe9ff, transparent: true, opacity: 0.05,
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide, fog: false,
        }),
      );
      cone.position.set(TIER_X[i], h + 5.4, TIER_Z[i]);
      this.scene.add(cone);
      this.spots.push(cone);
    }
  }

  _buildConfetti() {
    const N = 240;
    this.confN = N;
    this.confPos = new Float32Array(N * 3);
    this.confVel = new Float32Array(N * 3);
    let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    this._confRnd = rnd;
    const col = new Float32Array(N * 3);
    const palette = [[0, 0.94, 1], [1, 0.18, 0.78], [1, 0.83, 0.29], [1, 1, 1], [0.25, 0.68, 0.42]];
    for (let i = 0; i < N; i++) {
      this._resetConfetti(i, true);
      const c = palette[i % palette.length];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.confPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.confetti = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.42, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.confetti.visible = false;
    this.scene.add(this.confetti);
  }

  _resetConfetti(i, anyHeight) {
    const r = this._confRnd;
    this.confPos[i * 3] = (r() - 0.5) * 24;
    this.confPos[i * 3 + 1] = anyHeight ? r() * 24 : 22 + r() * 6;
    this.confPos[i * 3 + 2] = (r() - 0.5) * 15 - 1;
    this.confVel[i * 3] = (r() - 0.5) * 1.3;
    this.confVel[i * 3 + 1] = -(2.2 + r() * 2.6);
    this.confVel[i * 3 + 2] = (r() - 0.5) * 1.3;
  }

  // entries: rank-ordered (up to 3) of { variant, name, player }.
  show(entries) {
    this._clearShips();
    for (let i = 0; i < Math.min(3, entries.length); i++) {
      const e = entries[i];
      const ship = buildShipMesh(e.variant || {});
      ship.scale.setScalar(i === 0 ? 1.5 : 1.25);
      ship.position.set(TIER_X[i], TIER_H[i] + 0.95, TIER_Z[i]);
      ship.rotation.y = Math.PI; // nose toward the camera
      this.scene.add(ship);
      this.ships.push({ obj: ship, tier: i, baseY: TIER_H[i] + 0.95 });
      if (e.player) {
        const mk = new THREE.Mesh(
          new THREE.RingGeometry(1.25, 1.55, 40),
          new THREE.MeshBasicMaterial({
            color: 0x00f0ff, transparent: true, opacity: 0.95,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
          }),
        );
        mk.rotation.x = -Math.PI / 2;
        mk.position.set(TIER_X[i], TIER_H[i] + 3.0, TIER_Z[i]);
        this.scene.add(mk);
        this._marker = mk;
        this._markerTier = i;
      }
    }
    this.confetti.visible = true;
    this.active = true;
    this.t = 0;
  }

  _clearShips() {
    for (const s of this.ships) {
      this.scene.remove(s.obj);
      s.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.ships = [];
    if (this._marker) { this.scene.remove(this._marker); this._marker = null; }
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;

    // Camera: a wide establishing dolly easing into a hero shot, then slow orbit.
    // Distance is derived from the viewport aspect so the whole podium frames
    // cleanly on tall (portrait) screens as well as wide ones.
    const a = Math.min(1, t / 2.4);
    const ease = 1 - Math.pow(1 - a, 3);
    const orbit = Math.max(0, t - 2.4) * 0.1;
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const fitW = 9 / (tanV * Math.max(0.5, this.camera.aspect));
    const fitH = 4.4 / tanV;
    const settledR = Math.max(fitW, fitH) + 2.5;
    const camR = settledR * 1.6 - settledR * 0.6 * ease;
    const camAng = -0.16 + orbit;
    const camH = 3.0 + 2.2 * ease;
    this.camera.position.set(Math.sin(camAng) * camR, camH, Math.cos(camAng) * camR);
    this.camera.lookAt(0, 2.2 * ease + 0.5, 0);

    // Ships rise onto their tiers, then bob and sway gently.
    for (const s of this.ships) {
      const rise = Math.min(1, Math.max(0, (t - 0.3 - s.tier * 0.28) / 0.7));
      const r = 1 - Math.pow(1 - rise, 2);
      s.obj.visible = rise > 0;
      s.obj.position.y = s.baseY - (1 - r) * 4.5;
      s.obj.rotation.y = Math.PI + Math.sin(t * 0.5 + s.tier) * 0.22;
      s.obj.rotation.z = Math.sin(t * 0.8 + s.tier) * 0.04;
    }
    if (this._marker) {
      this._marker.position.y = TIER_H[this._markerTier] + 2.9 + Math.sin(t * 2.2) * 0.18;
      this._marker.rotation.z = t * 1.4;
    }
    for (let i = 0; i < this.spots.length; i++) {
      this.spots[i].material.opacity = 0.05 + Math.sin(t * 1.6 + i) * 0.013;
    }

    // Confetti rain.
    for (let i = 0; i < this.confN; i++) {
      this.confPos[i * 3] += this.confVel[i * 3] * dt;
      this.confPos[i * 3 + 1] += this.confVel[i * 3 + 1] * dt;
      this.confPos[i * 3 + 2] += this.confVel[i * 3 + 2] * dt;
      if (this.confPos[i * 3 + 1] < 0) this._resetConfetti(i, false);
    }
    this.confetti.geometry.attributes.position.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  hide() {
    this.active = false;
    this.confetti.visible = false;
    this._clearShips();
  }
}
