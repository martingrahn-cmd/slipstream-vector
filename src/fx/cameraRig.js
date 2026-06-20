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

    // Cinematic intro sweep (a descent to the chase pose at the start line).
    this.introT = 0;
    this.introDur = 1;
    this.introPos = new THREE.Vector3();
    this.introLook = new THREE.Vector3();
    this.introUp = new THREE.Vector3(0, 1, 0);
    this.introFov = T.FOV_BASE;
    this._appPos = new THREE.Vector3();
    this._appLook = new THREE.Vector3();
    this._appUp = new THREE.Vector3();
  }

  reset(ship) {
    this.gap = T.CAM_BACK_REST;
    this.camD = ship.d;
    this.camH = T.CAM_UP_REST;
    const f = this.spline.frameAt(ship.s + T.CAM_LOOKAHEAD, this.lookFrame);
    this.look.copy(f.pos);
    this.fov = T.FOV_BASE;
    this.introT = 0; // any pending sweep is cancelled by a reset
  }

  // Kick off a ~1s sweep that eases from a high vantage behind the ship down
  // into the normal chase pose. update() blends it in while introT > 0.
  playIntro(ship, dur = 1.1) {
    this.introDur = dur;
    this.introT = dur;
    const f = this.spline.frameAt(ship.s, this.frame);
    this.introPos.copy(f.pos).addScaledVector(f.R, ship.d).addScaledVector(f.T, -6);
    this.introPos.y += 9;                                   // high above the ship
    this.introLook.copy(f.pos).addScaledVector(f.R, ship.d);
    this.introLook.y += 0.5;                                // looking down at it
    this.introFov = 54;
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
    const fovNow = Math.min(this.fov + juice.fovSpike, T.FOV_MAX); // applied below

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
    this._appPos.copy(this._pos).addScaledVector(f.R, nx).addScaledVector(f.U, ny);
    this._appLook.copy(this.look);
    this._appUp.copy(this.upVec);
    let fov = fovNow, roll = this.roll + nr;
    // Ease from the cinematic intro pose into the chase pose while the sweep runs.
    if (this.introT > 0) {
      this.introT = Math.max(0, this.introT - dt);
      const a = this.introDur > 0 ? 1 - this.introT / this.introDur : 1;
      const e = a * a * (3 - 2 * a); // smoothstep
      const inv = 1 - e;
      this._appPos.lerp(this.introPos, inv);
      this._appLook.lerp(this.introLook, inv);
      this._appUp.lerp(this.introUp, inv).normalize();
      fov = fovNow + (this.introFov - fovNow) * inv;
      roll *= e; // roll + shake ease in as the sweep settles
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this._appPos);
    this.camera.up.copy(this._appUp);
    this.camera.lookAt(this._appLook);
    this.camera.rotateZ(roll);
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
