// Spline-frame chase camera: inherits banking and hills, never clips crests.
// Asymmetric smoothing is the core trick — stiff laterally (planted), soft
// longitudinally (the ship lunges away under acceleration).
import * as THREE from 'three';
import { TUNING as T } from '../config.js';
import { makeFrame } from '../track/spline.js';

// Post-race "broadcast": fixed trackside cameras spaced around the lap. The
// active one is the camera whose segment the focus ship (the next car to finish)
// is in; the camera stays planted at the trackside while its LOOK pans to follow
// the ship racing past, then it cuts to the next camera as the ship crosses into
// the next segment — like a race-finish TV feed.
// The post-race cam follows the focus ship from cinematic angles, cutting between
// them. Every preset is an offset in the ship's frame: t = along-track (always
// NEGATIVE = behind, where the road is clear), r = horizontal side (kept within
// the road so it never enters trackside buildings), u = world-up height.
const SC_HOLD = 3.6;        // seconds on one angle before cutting
const SC_FOV = 50;          // the cam rides close behind the ship
const SC_POS_LAMBDA = 5.0;  // smooth the follow between cuts
const SC_LOOK_LAMBDA = 6.0; // how fast the look settles after a cut
const SC_FRAME_BIAS = 0.13; // raise the ship into the upper-centre, above the bottom board
const SC_MIN_CLEAR = 2.6;   // keep the cam this far above the road (no clipping on climbs/crests/loops)
const SHOWCASE = [
  { t: -10.5, r: 0.0, u: 5.4 }, // high behind, looking down the road
  { t: -8.0, r: -4.2, u: 3.0 }, // low 3/4 rear-left
  { t: -8.0, r: 4.2, u: 3.0 },  // low 3/4 rear-right
];

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

    // Post-race cinematic cam (cuts between angles, all BEHIND/over the road the
    // ship just drove — guaranteed clear of trackside buildings/walls).
    this.showcase = false;
    this.showcaseTarget = null; // the ship to follow (set per-frame by main); null → the player
    this.scT = 0;               // time on the current angle
    this.scIdx = 0;             // which SHOWCASE preset
    this.scInit = false;        // first frame after start
    this.scSnap = false;        // snap pos+look on a cut
    this.scPos = new THREE.Vector3();
    this.scLook = new THREE.Vector3();
    this._scTmp = new THREE.Vector3();
    this._scR = new THREE.Vector3();
  }

  // Begin/stop the trackside broadcast cam (driven by the 'finished' state).
  startShowcase() { if (this.showcase) return; this.showcase = true; this.scIdx = -1; this.scInit = false; }
  stopShowcase() { this.showcase = false; this.showcaseTarget = null; }
  // Clean CUT to a fresh angle on a new subject (called when main switches the
  // followed ship) — snaps instead of swinging the cam across the track.
  cutShowcase() { if (!this.showcase) return; this.scSnap = true; this.scT = 0; this.scIdx = (Math.max(0, this.scIdx) + 1) % SHOWCASE.length; }

  reset(ship) {
    this.gap = T.CAM_BACK_REST;
    this.camD = ship.d;
    this.camH = T.CAM_UP_REST;
    const f = this.spline.frameAt(ship.s + T.CAM_LOOKAHEAD, this.lookFrame);
    this.look.copy(f.pos);
    this.fov = T.FOV_BASE;
    this.introT = 0; // any pending sweep is cancelled by a reset
    this.showcase = false; // and so is any post-race showcase
  }

  // Cinematic intro: the camera starts AHEAD of the grid facing the ship, swings
  // out to one side and settles into the chase pose behind it. The arc itself is
  // traced per-frame in update(); dur 0 skips it (reduced-motion).
  playIntro(ship, dur = 2.8) {
    this.introDur = dur;
    this.introT = dur;
    this.introFov = 60;
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
      .addScaledVector(f.U, this.camH + juice.landDip()); // + transient landing settle

    // --- look-at: through the corner. Look-ahead grows with speed (and a touch
    // on boost) so you see into the corner exactly when you're fastest, instead
    // of staring at your own nose. CAM_LAMBDA_LOOK smoothing prevents snapping.
    const lookAhead = THREE.MathUtils.lerp(T.CAM_LOOKAHEAD, T.CAM_LOOKAHEAD_FAST, sn)
      + juice.boostFactor * 4;
    const lf = this.spline.frameAt(ship.s + lookAhead, this.lookFrame);
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
      const e = a * a * (3 - 2 * a); // smoothstep 0..1
      const inv = 1 - e;
      // Trace an arc in the ship's frame: start AHEAD of the ship (+T) facing
      // back at it, swing out to one side, and settle behind it (-T, chase pose).
      const cf = this.spline.frameAt(ship.s, this.lookFrame);
      this._fwd.copy(cf.pos).addScaledVector(cf.R, ship.d).addScaledVector(cf.U, ship.h); // the ship point
      const theta = e * Math.PI;                          // 0 (front) .. PI (behind)
      const radius = THREE.MathUtils.lerp(9.0, this.gap, e);
      this.introPos.copy(this._fwd)
        .addScaledVector(cf.T, Math.cos(theta) * radius)  // +ahead .. -behind
        .addScaledVector(cf.R, Math.sin(theta) * 6.5)     // swing out to the side, 0 at both ends
        .addScaledVector(cf.U, THREE.MathUtils.lerp(2.6, this.camH, e) - ship.h);
      this.introLook.copy(this._fwd);                     // keep the ship in frame
      this.introUp.set(0, 1, 0);
      // inv -> 0 at the end, so we land EXACTLY on the real chase pose (no snap).
      this._appPos.lerp(this.introPos, inv);
      this._appLook.lerp(this.introLook, inv);
      this._appUp.lerp(this.introUp, inv).normalize();
      fov = fovNow + (this.introFov - fovNow) * inv;
      roll *= e; // roll + shake ease in as the sweep settles
    }
    // Post-race cinematic cam: follow the focus ship from a behind/over-the-road
    // angle (clear of trackside geometry), cutting between angles for variety.
    if (this.showcase) {
      const tgt = this.showcaseTarget || ship;
      this.scT += dt;
      if (!this.scInit || this.scT > SC_HOLD) { // CUT to the next angle
        this.scT = 0;
        this.scIdx = this.scInit ? (this.scIdx + 1) % SHOWCASE.length : 0;
        this.scSnap = true; this.scInit = true;
      }
      const p = SHOWCASE[this.scIdx];
      const cf = this.spline.frameAt(tgt.s, this.lookFrame);
      const shipPt = this._fwd.copy(cf.pos).addScaledVector(cf.R, tgt.d).addScaledVector(cf.U, tgt.h);
      // along-track (behind) + horizontal side + world-up — all over the clear road.
      const fwd = this._scR.set(cf.T.x, 0, cf.T.z);
      if (fwd.lengthSq() < 1e-3) fwd.set(0, 0, 1);
      fwd.normalize();
      this._scTmp.set(cf.R.x, 0, cf.R.z);
      if (this._scTmp.lengthSq() < 1e-3) this._scTmp.set(-cf.T.z, 0, cf.T.x);
      this._scTmp.normalize();
      this._lookT.copy(shipPt).addScaledVector(fwd, p.t).addScaledVector(this._scTmp, p.r);
      this._lookT.y += p.u;
      if (this.scSnap) { this.scPos.copy(this._lookT); this.scLook.copy(shipPt); this.scSnap = false; }
      else { this.scPos.lerp(this._lookT, k(SC_POS_LAMBDA)); this.scLook.lerp(shipPt, k(SC_LOOK_LAMBDA)); }
      // Never sink through the deck: clear the road BEHIND the ship (climbs,
      // crests and loops would otherwise punch the cam through the track).
      const L = this.spline.length;
      const behind = this.spline.frameAt((((tgt.s + p.t) % L) + L) % L, this.frame);
      const floor = Math.max(behind.pos.y, shipPt.y) + SC_MIN_CLEAR;
      if (this.scPos.y < floor) this.scPos.y = floor;
      this._appPos.copy(this.scPos);
      this._appUp.set(0, 1, 0); // a level horizon
      // Raise the ship into the upper-centre, above the bottom results board.
      const dist = this._scTmp.subVectors(this.scLook, this._appPos).length() || 1;
      this._appLook.copy(this.scLook);
      this._appLook.y -= dist * SC_FRAME_BIAS;
      fov = SC_FOV;
      roll = 0;
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
