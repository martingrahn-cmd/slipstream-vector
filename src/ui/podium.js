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

// Display-bay geometry constants — the hull rests against these.
const PED_TOP = -0.35;  // top surface of the pedestal cylinder
const HOVER = 0.14;     // anti-grav gap between hull and dais
const BOB = 0.05;       // idle bob amplitude
const ROLL = 0.045;     // idle roll amplitude (rad) — tips a wingtip down
// Fixed 3/4 view at ~22° elevation. The garage bay is a tall portrait frame, so
// a floor-level camera leaves the top 40% of it empty and the hull's length
// projects into the vertical as it turns — but go much above this and you are
// looking down at the deck, which hides the flank panelling the liveries carry.
const CAM_DIR = new THREE.Vector3(4.7, 3.0, 5.9).normalize();
const FIT = 1.03;       // breathing room outside the silhouette
const MIN_DIST = 7.0;   // never dolly closer than the old fixed framing

// Worst-case turntable silhouette radius: the hull spins about Y, so the frame
// has to contain the largest sqrt(x^2 + z^2) over its vertices. The static AABB
// is no good here — its corner overstates a long, narrow hull by ~50%.
const _v = new THREE.Vector3();
function spinRadius(root) {
  let r2 = 0;
  root.traverse((o) => {
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const d = _v.x * _v.x + _v.z * _v.z;
      if (d > r2) r2 = d;
    }
  });
  return Math.sqrt(r2);
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
    // The bay lights up in the livery — but in TWO of its colours, not one.
    // Tinting every emitter with `accent` washed the whole bay a single hue and
    // made monochrome-looking hulls look even more monochrome.
    this.accentMats = []; // dais rim -> livery accent
    this.secondMats = []; // back-glow + left beam -> livery rim colour

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
    this.secondMats.push(glowMat);

    for (const x of [-3.0, 3.0]) {
      const beamMat = new THREE.MeshBasicMaterial({
        map: tex, color: x < 0 ? 0x00f0ff : 0xff2ec8, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 6.5), beamMat);
      beam.position.set(x, 1.1, -2.6);
      this.scene.add(beam);
      if (x < 0) this.secondMats.push(beamMat); // left beam follows the livery
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

  // Resize to fill the current parent (the garage stage uses this to go hero-size).
  resize(w, h) {
    const c = this.renderer.domElement;
    const pw = Math.round(w || (c.parentElement ? c.parentElement.clientWidth : this.W));
    const ph = Math.round(h || (c.parentElement ? c.parentElement.clientHeight : this.H));
    if (pw < 20 || ph < 20) return;
    this.W = pw; this.H = ph;
    this.renderer.setSize(pw, ph, false);
    this.camera.aspect = pw / ph;
    this.camera.updateProjectionMatrix();
    c.style.width = `${pw}px`; c.style.height = `${ph}px`;
    this._frame(); // the bay goes hero-size in the garage — re-fit the hull
  }

  // Dolly the fixed 3/4 view out until the spinning hull clears the bay frame
  // on BOTH axes. The garage bay is portrait, so width is what bites: at the
  // old fixed distance a side-on hull ran off both edges and got sliced.
  _frame() {
    const f = this.fit;
    if (!f) return;
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) * 0.5;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const d = Math.max(
      f.r * FIT / Math.sin(hHalf),
      f.hy * FIT / Math.sin(vHalf),
      MIN_DIST,
    );
    this.camera.position.copy(CAM_DIR).multiplyScalar(d);
    this.camera.lookAt(0, f.aimY, 0);
    // Fog is camera-relative depth cue, not an absolute distance — hold the
    // same offsets it was authored with or a dollied-out hull sinks into it.
    this.scene.fog.near = d + 0.9;
    this.scene.fog.far = d + 11.9;
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
    // HOVER the hull over the dais instead of parking every archetype at one
    // fixed height: hulls are authored in ship space with keels and engine
    // bells BELOW y=0 (the twinboom's reach 0.52 down), so a shared height sank
    // the heavy teams into the pedestal. Measure this hull and float it a fixed
    // gap above the dais top — accounting for the deepest point of the idle
    // cycle, since the bob dips it and the roll tips a wingtip down. Every ship
    // now floats identically, which is what an anti-grav racer should do.
    this.ship.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.ship);
    const halfSpan = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    const dip = BOB + Math.sin(ROLL) * halfSpan;
    this.baseY = PED_TOP + HOVER + dip - box.min.y;
    // Frame the hull we actually have: aim at its middle, not a fixed point.
    this.fit = {
      r: spinRadius(this.ship),
      hy: (box.max.y - box.min.y) * 0.65 + BOB,
      aimY: this.baseY + (box.max.y - box.min.y) * 0.35,
    };
    this._frame();
    // Tint the bay to the livery accent, and kick off a scan sweep.
    const accent = variant && variant.accent != null ? variant.accent : 0x00f0ff;
    const second = variant && variant.rim != null ? variant.rim : accent;
    for (const m of this.accentMats) m.color.setHex(accent);
    for (const m of this.secondMats) m.color.setHex(second);
    this.scanT = 0;
  }

  update(dt) {
    if (!this.ship) return;
    this.spin += dt * 0.55;
    this.ship.rotation.y = this.spin;
    this.ship.rotation.z = Math.sin(this.spin * 0.6) * ROLL;
    this.ship.position.y = (this.baseY ?? 0) + Math.sin(this.spin * 1.2) * BOB;

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
