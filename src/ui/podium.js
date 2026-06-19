// The ship showcase: a small "display bay" that presents the player's current
// hull on the menu's ship card — a turntable pedestal with a livery-tinted neon
// rim, a floor grid that fades into the dark, soft back-lighting beams, and a
// scan sweep that runs up the hull each time you change ship. Cheap (MeshBasic +
// additive, no real lights), keeps the existing small canvas.
import * as THREE from 'three';
import { buildShipMesh } from '../ship/shipVisual.js';

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Podium {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.W = 288; this.H = 170;
    this.renderer.setSize(this.W, this.H, false);
    canvas.style.width = `${this.W}px`;
    canvas.style.height = `${this.H}px`;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07040f);
    this.scene.fog = new THREE.Fog(0x07040f, 9, 20);
    this.camera = new THREE.PerspectiveCamera(36, this.W / this.H, 0.1, 60);
    this.camera.position.set(4.8, 2.5, 6.0);
    this.camera.lookAt(0, -0.05, 0);

    const tex = radialTexture();
    this.accentMats = []; // re-tinted to the ship's accent on setShip

    // Floor: a dark disc + concentric neon rings fading outward (the bay floor).
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 48),
      new THREE.MeshBasicMaterial({ color: 0x0a0720 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.62;
    this.scene.add(floor);
    for (let i = 0; i < 4; i++) {
      const r = 3.6 + i * 2.1;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.05, 60),
        new THREE.MeshBasicMaterial({
          color: 0x2bd6ff, transparent: true, opacity: 0.26 - i * 0.05,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.61;
      this.scene.add(ring);
    }

    // Turntable pedestal + a livery-tinted neon rim around its top.
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(2.55, 2.85, 0.5, 44),
      new THREE.MeshBasicMaterial({ color: 0x161031 }),
    );
    ped.position.y = -0.6;
    this.scene.add(ped);
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const rim = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.62, 56), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.34;
    this.scene.add(rim);
    this.accentMats.push(rimMat);

    // Back-lighting: a soft accent glow + two tall light beams behind the ship.
    const glowMat = new THREE.SpriteMaterial({
      map: tex, color: 0x00f0ff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(9, 6, 1);
    glow.position.set(0, 0.8, -3.4);
    this.scene.add(glow);
    this.accentMats.push(glowMat);

    for (const x of [-3.0, 3.0]) {
      const beamMat = new THREE.MeshBasicMaterial({
        map: tex, color: x < 0 ? 0x00f0ff : 0xff2ec8, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 6.5), beamMat);
      beam.position.set(x, 1.1, -2.6);
      this.scene.add(beam);
      if (x < 0) this.accentMats.push(beamMat); // left beam follows the livery
    }

    // Scan sweep: a thin bright plane that runs up the hull on ship change.
    this.scanMat = new THREE.MeshBasicMaterial({
      color: 0xbff4ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.scan = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.12), this.scanMat);
    this.scan.rotation.x = -Math.PI / 2 + 0.0;
    this.scan.position.y = -0.3;
    this.scene.add(this.scan);
    this.scanT = 99; // idle until a ship is set

    this.ship = null;
    this.spin = 0.6;
  }

  setShip(variant) {
    if (this.ship) {
      this.scene.remove(this.ship);
      this.ship.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
        }
      });
    }
    this.ship = buildShipMesh(variant);
    this.scene.add(this.ship);
    // Tint the bay to the livery accent, and kick off a scan sweep.
    const accent = variant && variant.accent != null ? variant.accent : 0x00f0ff;
    for (const m of this.accentMats) m.color.setHex(accent);
    this.scanT = 0;
  }

  update(dt) {
    if (!this.ship) return;
    this.spin += dt * 0.55;
    this.ship.rotation.y = this.spin;
    this.ship.rotation.z = Math.sin(this.spin * 0.6) * 0.045;
    this.ship.position.y = -0.1 + Math.sin(this.spin * 1.2) * 0.05;

    // Scan sweep up the hull, then idle.
    if (this.scanT < 1.4) {
      this.scanT += dt;
      const u = Math.min(1, this.scanT / 1.1);
      this.scan.position.y = -0.55 + u * 1.25;
      this.scanMat.opacity = Math.sin(u * Math.PI) * 0.5;
    } else if (this.scanMat.opacity !== 0) {
      this.scanMat.opacity = 0;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
