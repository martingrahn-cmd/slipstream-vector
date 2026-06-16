// Spline-frame chase camera: inherits banking and hills, never clips crests.
// Asymmetric smoothing is the core trick — stiff laterally (planted), soft
// longitudinally (the ship lunges away under acceleration).
import * as THREE from 'three';
import { TUNING as T } from '../config.js';
import { makeFrame } from '../track/spline.js';

export class CameraRig {
  constructor(spline, camera) {
    this.spline = spline;
    this.camera = camera;
    this.frame = makeFrame();
    this.lookFrame = makeFrame();

    this.gap = T.CAM_BACK_REST;    // smoothed distance behind the ship
    this.camD = 0;
    this.camH = T.CAM_UP_REST;
    this.look = new THREE.Vector3();
    this.roll = 0;
    this.fov = T.FOV_BASE;
    this.noiseT = 0;
    this.upVec = new THREE.Vector3(0, 1, 0);
    this._upT = new THREE.Vector3();

    this._pos = new THREE.Vector3();
    this._lookT = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  reset(ship) {
    this.gap = T.CAM_BACK_REST;
    this.camD = ship.d;
    this.camH = T.CAM_UP_REST;
    const f = this.spline.frameAt(ship.s + T.CAM_LOOKAHEAD, this.lookFrame);
    this.look.copy(f.pos);
    this.fov = T.FOV_BASE;
  }

  update(dt, ship, input, juice, drifting) {
    const sn = ship.speedNorm;
    const k = (l) => 1 - Math.exp(-l * dt);

    // --- longitudinal: smooth the GAP, not the position. Zero steady-state
    // lag at cruise; acceleration (and boost) stretch the gap so the ship
    // visibly lunges away under throttle — the single biggest feel win.
    const lunge = THREE.MathUtils.clamp(ship.accel, -20, 30) * 0.12
      + juice.boostFactor * 1.6;
    const back = THREE.MathUtils.lerp(T.CAM_BACK_REST, T.CAM_BACK_FAST, sn) + lunge;
    const lLong = juice.boostFactor > 0.5 ? T.CAM_LAMBDA_LONG * 0.6 : T.CAM_LAMBDA_LONG;
    this.gap += (back - this.gap) * k(lLong);
    const camS = ship.sTotal - this.gap;

    // --- lateral: stiff, plus drift swing to the outside of the slide ---
    const beta = Math.atan2(ship.vd, Math.max(ship.v, 5));
    const driftSwing = drifting ? -beta * T.CAM_DRIFT_SWING * 2.2 : 0;
    this.camD += (ship.d + driftSwing + juice.camPunch - this.camD) * k(T.CAM_LAMBDA_LAT);

    // --- vertical: floaty (airtime reads in the camera) ---
    const up = THREE.MathUtils.lerp(T.CAM_UP_REST, T.CAM_UP_FAST, sn);
    this.camH += (up + (ship.h - T.HOVER_HEIGHT) * 0.4 - this.camH) * k(T.CAM_LAMBDA_VERT);

    // --- position from the spline frame at camS ---
    const f = this.spline.frameAt(camS, this.frame);
    this._pos.copy(f.pos)
      .addScaledVector(f.R, THREE.MathUtils.clamp(this.camD, -(f.width - 0.5), f.width - 0.5))
      .addScaledVector(f.U, this.camH);

    // --- look-at: through the corner ---
    const lf = this.spline.frameAt(ship.s + T.CAM_LOOKAHEAD, this.lookFrame);
    this._lookT.copy(lf.pos).multiplyScalar(T.CAM_LOOK_BLEND);
    this._lookT.addScaledVector(
      this._fwd.copy(f.pos).addScaledVector(f.R, ship.d).addScaledVector(f.U, ship.h),
      1 - T.CAM_LOOK_BLEND,
    );
    this._lookT.addScaledVector(lf.R, ship.vd * T.CAM_LOOK_LAT);
    this.look.lerp(this._lookT, k(T.CAM_LAMBDA_LOOK));

    // --- roll: steering lean only; banking (and loops) come via the up
    // vector below ---
    const rollT = input.steer * T.CAM_ROLL_STEER;
    this.roll += (rollT - this.roll) * k(T.CAM_LAMBDA_ROLL);

    // --- FOV: the loudest instrument ---
    const fovT = T.FOV_BASE + T.FOV_SPEED * Math.pow(sn, 1.5);
    this.fov += (fovT - this.fov) * k(T.CAM_LAMBDA_FOV);
    const fovNow = Math.min(this.fov + juice.fovSpike, T.FOV_MAX);
    if (Math.abs(this.camera.fov - fovNow) > 0.01) {
      this.camera.fov = fovNow;
      this.camera.updateProjectionMatrix();
    }

    // --- trauma shake: noise, never random ---
    this.noiseT += dt * T.SHAKE_FREQ;
    const shake = juice.effectiveTrauma(sn) ** 2;
    const nx = noise1(this.noiseT, 0) * T.SHAKE_POS_X * shake;
    const ny = noise1(this.noiseT, 17.7) * T.SHAKE_POS_Y * shake;
    const nr = noise1(this.noiseT, 39.2) * T.SHAKE_ROLL * shake;

    // --- compose ---
    // The camera up blends from world-up (CAM_ROLL_BANK of the bank reads
    // through) to fully following the track frame when the track leaves the
    // horizontal — walls, corkscrews and F-Zero loops keep the road "down".
    const uprightness = THREE.MathUtils.clamp(f.U.y, 0, 1);
    const followK = T.CAM_ROLL_BANK + (1 - T.CAM_ROLL_BANK) * (1 - uprightness);
    this._upT.set(0, 1, 0).lerp(f.U, followK);
    if (this._upT.lengthSq() < 1e-4) this._upT.copy(f.U); // fully inverted
    this._upT.normalize();
    this.upVec.lerp(this._upT, k(8)).normalize();
    this.camera.position.copy(this._pos)
      .addScaledVector(f.R, nx)
      .addScaledVector(f.U, ny);
    this.camera.up.copy(this.upVec);
    this.camera.lookAt(this.look);
    this.camera.rotateZ(this.roll + nr);
  }
}

// Smooth 1D value noise in [-1, 1], cheap and deterministic.
function noise1(t, seed) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i + seed), hash(i + 1 + seed), u) * 2 - 1;
}
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function lerp(a, b, t) { return a + (b - a) * t; }
