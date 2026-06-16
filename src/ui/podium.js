// The ship showcase: a small dedicated renderer spinning the player's
// current hull on the menu's ship card.
import * as THREE from 'three';
import { buildShipMesh } from '../ship/shipVisual.js';

export class Podium {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.W = 288; this.H = 170;
    this.renderer.setSize(this.W, this.H, false);
    canvas.style.width = `${this.W}px`;
    canvas.style.height = `${this.H}px`;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0719);
    this.camera = new THREE.PerspectiveCamera(34, this.W / this.H, 0.1, 60);
    this.camera.position.set(4.6, 2.6, 5.8);
    this.camera.lookAt(0, 0.05, 0.2);

    // A faint deck line under the ship so it isn't floating in a void.
    const deck = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 40),
      new THREE.MeshBasicMaterial({ color: 0x161030 }),
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -0.85;
    this.scene.add(deck);
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(3.05, 3.18, 48),
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.84;
    this.scene.add(rim);

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
  }

  update(dt) {
    if (!this.ship) return;
    this.spin += dt * 0.55;
    this.ship.rotation.y = this.spin;
    this.ship.rotation.z = Math.sin(this.spin * 0.6) * 0.045;
    this.ship.position.y = -0.1 + Math.sin(this.spin * 1.2) * 0.05;
    this.renderer.render(this.scene, this.camera);
  }
}
