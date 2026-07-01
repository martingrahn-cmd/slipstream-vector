// Procedural anti-grav craft "PRONGHORN GX-R" (~450 tris): split-nose
// catamaran — twin sponson prongs, center pod, wing bridges, tall fin,
// splayed airbrakes, flared octagonal exhaust bells, neon glow set.
// Visual-only animation node (roll/pitch/yaw lean, hover bob) — never feeds
// physics. Engine flames, glow sprites and a blob shadow live here too.
import * as THREE from 'three';
import { TUNING as T, deg } from '../config.js';
import { bakeFlatColors, mergeGeoms } from '../track/scenery.js';
import { makeFrame } from '../track/spline.js';

const C = T.COL;

const DEFAULT_VARIANT = {
  scaleX: 1, scaleZ: 1, finScale: 1, bellScale: 1,
  hull: 0xe8e4f0, accent: 0xff2e88, arch: 'pronghorn',
};

export class ShipVisual {
  constructor(spline, scene, variant = {}, opts = {}) {
    this.spline = spline;
    this.frame = makeFrame();
    const V = { ...DEFAULT_VARIANT, ...variant };

    this.root = new THREE.Group();    // placed by physics projection
    this.lean = new THREE.Group();    // visual-only animation
    this.root.add(this.lean);
    const shipGroup = buildShipMesh(V);
    this.lean.add(shipGroup);
    this.hullMat = shipGroup.userData.hullMat; // driven by boostFactor (rim-pulse)
    this.hullGeo = shipGroup.userData.hullGeo; // shared with the ghost ship + reflection

    // Engine flames: one cone per exhaust bell, additive, scaled by throttle/boost.
    // Nozzle positions are data-driven per archetype (group.userData.nozzles, in
    // unscaled hull-local space); X/Z scale by the team scale, Y stays (group y=1).
    this.flames = [];
    this.cores = [];
    const nozData = shipGroup.userData.nozzles || [{ x: -1.05, y: 0.06, z: 2.46 }, { x: 1.05, y: 0.06, z: 2.46 }];
    this.nozzles = nozData.map((n) => new THREE.Vector3(n.x * V.scaleX, n.y, n.z * V.scaleZ));
    // AI ships share ONE instanced flame/core batch (7 ships × 2 cones × 2 layers:
    // 28 draws -> 2). They skip the per-ship cone meshes and write their slots in
    // update() with identical transforms/colours. The player stays unbatched.
    this.fxBatch = opts.fxBatch || null;
    this.fxBase = this.fxBatch ? this.fxBatch.claim(this.nozzles.length) : -1;
    if (!this.fxBatch) {
      const flameGeom = new THREE.ConeGeometry(0.18, 1, 16); // round, not hexagonal — no hard cyan edges
      flameGeom.rotateX(-Math.PI / 2); // point +Z (backward)
      flameGeom.translate(0, 0, 0.5);
      for (const n of this.nozzles) {
        const flame = new THREE.Mesh(flameGeom, new THREE.MeshBasicMaterial({
          color: C.ENGINE, transparent: true, opacity: 0.55, // softer, less harsh cone
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }));
        flame.position.copy(n);
        this.lean.add(flame);
        this.flames.push(flame);
      }
      // Hot white-cone core inside each flame: white-hot at the throat with the
      // cyan envelope outside — the layered, AAA-looking afterburner.
      const coreGeom = new THREE.ConeGeometry(0.085, 1, 16); // round core too
      coreGeom.rotateX(-Math.PI / 2);
      coreGeom.translate(0, 0, 0.5);
      for (const n of this.nozzles) {
        const core = new THREE.Mesh(coreGeom, new THREE.MeshBasicMaterial({
          color: 0xcdf6ff, transparent: true, opacity: 0.95, // cyan-white core (stays in the cyan family on boost)
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }));
        core.position.copy(n);
        this.lean.add(core);
        this.cores.push(core);
      }
    }
    // Engine glow sprites (batched AI ships write instanced glows to fxBatch instead).
    this.glows = [];
    if (!this.fxBatch) {
      const glowTex = makeGlowTexture();
      for (const n of this.nozzles) {
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: C.ENGINE, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }));
        spr.position.copy(n).add(new THREE.Vector3(0, 0, 0.15));
        spr.scale.setScalar(1.05);
        this.lean.add(spr);
        this.glows.push(spr);
      }
    }

    // Blob shadow on the track surface.
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 20),
      new THREE.MeshBasicMaterial({
        map: makeShadowTexture(), transparent: true, opacity: 0.4,
        depthWrite: false, fog: false,
      }),
    );
    scene.add(this.root);
    scene.add(this.shadow);

    // Reactive FX — only the player ship gets these addressable meshes, so the
    // 8-ship field's draw budget stays flat. Brake glow + boost bloom react to
    // the brake/boost values already computed every frame in update().
    this.brakeMesh = null;
    this.boostMesh = null;
    if (opts.reactive) {
      // Tail-FX placement is per-archetype (group.userData.reactive); pronghorn defaults.
      const rx = shipGroup.userData.reactive || {};
      const brake = rx.brake || [
        [[-0.34, 0.30, 2.26], [0.34, 0.30, 2.26]],
        [[-0.34, 0.30, 2.42], [0.34, 0.30, 2.42]],
      ];
      const boostPos = rx.boost ? rx.boost.pos : [0, 0.12, 2.3];
      const boostScale = rx.boost ? rx.boost.scale : 1.4;
      this.brakeMesh = new THREE.Mesh(ribbon(brake), new THREE.MeshBasicMaterial({
        color: 0xff4a2e, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
      }));
      this.lean.add(this.brakeMesh);

      this.boostMesh = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(), color: C.ENGINE, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      this.boostMesh.position.set(boostPos[0], boostPos[1], boostPos[2]);
      this.boostMesh.scale.setScalar(boostScale);
      this.lean.add(this.boostMesh);
    }

    // Mirrored ghost reflection on glossy worlds (player only): a faint,
    // fog-coupled clone of the hull + glow flipped through the road surface plane
    // — reads as a wet reflection with no render target. +2 draws, player-only.
    this.reflection = null;
    if (opts.reactive && (opts.groundStyle === 'water' || opts.groundStyle === 'grid')) {
      const inner = new THREE.Group();
      inner.scale.set(...shipGroup.userData.shipScale); // match the ship's team scale
      // BackSide: a planar reflection flips winding (det -1), so the camera-facing
      // facets are the hull undersides — what a real floor reflection shows. Also
      // halves overdraw and avoids the unsorted-alpha X-ray of a DoubleSide ghost.
      const hullRef = new THREE.Mesh(shipGroup.userData.hullGeo, new THREE.MeshBasicMaterial({
        vertexColors: true, color: 0x8aa0c0, transparent: true, opacity: 0.26,
        depthWrite: false, fog: true, side: THREE.BackSide,
      }));
      const glowRef = new THREE.Mesh(shipGroup.userData.glowGeo, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: true, side: THREE.DoubleSide,
      }));
      inner.add(hullRef, glowRef);
      this.reflection = new THREE.Group();
      this.reflection.matrixAutoUpdate = false;   // matrix set directly each frame
      this.reflection.renderOrder = 0.5;          // deterministic: below edge-glow ribbons (2)
      this.reflection.add(inner);
      this.reflMat = hullRef.material;
      this.reflGlowMat = glowRef.material;
      this._reflM = new THREE.Matrix4();
      this._reflP = new THREE.Vector3();          // scratch: surface point under the ship
      scene.add(this.reflection);
    }

    // Smoothed visual state.
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.time = 0;

    this._m = new THREE.Matrix4();
    this._engineCol = new THREE.Color();
    // Engine exhaust hue: premium liveries (player ship only — AI use the shared
    // cyan batch) theme the flames/glow/boost-bloom to their own glow colour.
    this.engBase = (V.glow != null) ? V.glow : C.ENGINE;
  }

  // ship: ShipPhysics. input: smoothed axes. boostFactor: juice envelope 0..1.
  update(dt, ship, input, boostFactor) {
    this.time += dt;
    const f = this.spline.frameAt(ship.s, this.frame);
    const sn = ship.speedNorm;

    // Position: spline projection + hover height.
    this.root.position.copy(f.pos)
      .addScaledVector(f.R, ship.d)
      .addScaledVector(f.U, ship.h);
    // Orientation: track frame basis (+X right, +Y up, -Z forward).
    this._m.makeBasis(f.R, f.U, f.T.clone().negate());
    this.root.quaternion.setFromRotationMatrix(this._m);

    // Lean targets.
    const drifting = input.airbrake && ship.v > 5;
    const beta = Math.atan2(ship.vd, Math.max(ship.v, 5)); // slip angle
    // Negative roll.z = right wing down (clockwise from behind) = lean right.
    // Cornering g AMPLIFIES the lean into the turn (latG is negative in a
    // right turn), hence the minus inside the parens.
    // In corkscrews/loops the surface rolls past vertical; the g-driven roll and
    // slip-yaw would then skew the hull OFF the road plane ("crosswise"). Fade
    // those cosmetic terms as the surface leaves horizontal (f.U.y -> 0), keeping
    // the player's own steer lean. Normal banked corners (U.y ~0.85) are untouched.
    const upright = THREE.MathUtils.clamp((f.U.y - 0.1) / 0.5, 0, 1);
    let rollT = -(input.steer * T.SHIP_ROLL_STEER - ship.latG * T.SHIP_ROLL_LATG * upright);
    if (drifting) rollT = THREE.MathUtils.clamp(rollT * 1.7, -T.SHIP_ROLL_DRIFT, T.SHIP_ROLL_DRIFT);
    let yawT = -input.steer * T.SHIP_YAW_LEAD - (drifting ? beta : beta * 0.35) * upright;
    let pitchT = (-input.throttle * T.SHIP_PITCH_THROTTLE + input.brake * T.SHIP_PITCH_BRAKE
      - boostFactor * deg(2.5)) * upright; // fade the cosmetic accel-pitch in corkscrews/loops too
    const kR = 1 - Math.exp(-T.SHIP_ROLL_LAMBDA * dt);
    const kP = 1 - Math.exp(-T.SHIP_PITCH_LAMBDA * dt);
    this.roll += (rollT - this.roll) * kR;
    this.yaw += (yawT - this.yaw) * kR;
    this.pitch += (pitchT - this.pitch) * kP;

    // Hover bob dies at speed — the ship "locks in".
    const bobAmp = 1 - T.BOB_SPEED_KILL * sn;
    const bob = (T.BOB_A1 * Math.sin(T.BOB_F1 * this.time * Math.PI * 2 * 0.3)
      + T.BOB_A2 * Math.sin(T.BOB_F2 * this.time * Math.PI * 2 * 0.3)) * bobAmp;

    // Bank-lift: raise the hull as it rolls so the low wingtip pivots just above
    // the road instead of clipping through the asphalt in hard corners.
    this.lean.position.y = bob + Math.abs(Math.sin(this.roll)) * T.SHIP_LEAN_LIFT;
    this.lean.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

    // Engine: cyan -> white while boosting, flicker at ~30Hz.
    const throttleAmt = input.throttle;
    const flick = 1 + 0.15 * Math.sin(this.time * 30 * Math.PI * 2 + Math.sin(this.time * 17) * 3);
    const flameLen = (0.5 + 1.8 * throttleAmt + 1.5 * boostFactor) * flick;
    this._engineCol.setHex(this.engBase).lerp(new THREE.Color(C.ENGINE_BOOST), boostFactor * 0.3); // base hue (themed for premium liveries) whitening on boost
    for (const fl of this.flames) {
      fl.scale.set(1 + boostFactor * 0.6, 1 + boostFactor * 0.6, flameLen);
      fl.material.color.copy(this._engineCol);
    }
    // White-hot core: shorter, thinner, brighter — the inner tongue of the jet.
    for (const c of this.cores) {
      c.scale.set(1 + boostFactor * 0.5, 1 + boostFactor * 0.5, flameLen * 0.62);
      c.material.opacity = Math.min(0.85, (0.28 + 0.34 * throttleAmt + 0.4 * boostFactor) * flick);
    }
    for (const g of this.glows) {
      g.scale.setScalar((1.1 + throttleAmt * 0.5 + boostFactor * 1.2) * flick);
      g.material.color.copy(this._engineCol);
    }
    // Batched AI ship: write its flame + core instances — same transform, scale and
    // additive colour the per-ship meshes above would have (core opacity folded into
    // the instance colour, since additive). lean.matrixWorld must be current here.
    if (this.fxBatch) {
      this.lean.updateWorldMatrix(true, false);
      const coreOp = Math.min(0.85, (0.28 + 0.34 * throttleAmt + 0.4 * boostFactor) * flick);
      const glowSc = (1.1 + throttleAmt * 0.5 + boostFactor * 1.2) * flick;
      for (let i = 0; i < this.nozzles.length; i++) {
        this.fxBatch.write(this.fxBase + i, this.lean.matrixWorld, this.nozzles[i],
          1 + boostFactor * 0.6, flameLen, this._engineCol,
          1 + boostFactor * 0.5, flameLen * 0.62, coreOp);
        this.fxBatch.writeGlow(this.fxBase + i, this.lean.matrixWorld, this.nozzles[i], glowSc, this._engineCol);
      }
    }

    // Reactive FX (player only): brake strip warms on braking, boost bloom
    // surges cyan->white behind the ship under boost.
    if (this.brakeMesh) {
      this.brakeMesh.material.opacity = Math.min(0.85, input.brake * input.brake * 0.9);
    }
    if (this.boostMesh) {
      this.boostMesh.material.opacity = boostFactor * 0.9;
      this.boostMesh.scale.setScalar(1.4 + boostFactor * 3.3); // bigger, softer boost flare
      this.boostMesh.material.color.copy(this._engineCol);
    }

    // Boost rim-pulse: the whole hull silhouette ignites on boost.
    if (this.hullMat) this.hullMat.uniforms.uBoost.value = boostFactor;

    // Blob shadow: on the surface, fading with hover height.
    this.shadow.position.copy(f.pos).addScaledVector(f.R, ship.d).addScaledVector(f.U, 0.06);
    this.shadow.quaternion.setFromRotationMatrix(this._m);
    this.shadow.rotateX(-Math.PI / 2);
    const lift = (ship.h - T.HOVER_HEIGHT);
    this.shadow.material.opacity = THREE.MathUtils.clamp(0.42 - lift * 0.12, 0.08, 0.42);
    const sScale = 1 + lift * 0.15;
    this.shadow.scale.set(sScale, sScale, sScale);

    // Ghost reflection: mirror the ship's animated pose through the ground plane
    // (y -> 2*groundY - y). Faint, and fades as the ship lifts off the surface.
    if (this.reflection) {
      this.lean.updateWorldMatrix(true, false); // current world pose incl. lean/bob
      // Mirror through the actual road tangent plane, not a world-horizontal one:
      // plane point P is the surface directly under the ship (centerline + lateral
      // offset + a small lift along the normal), plane normal n = f.U. The
      // Householder reflection M = [ I - 2 n nᵀ | 2(n·P) n ] makes the ghost roll
      // and pitch WITH the banked/hilly road and lands its contact line on P. f.U
      // is unit (frameAt normalizes it), so M is a true reflection (det -1). On a
      // flat level straight (n=(0,1,0), f.R.y=0) this reduces bit-for-bit to the
      // old diag(1,-1,1)/2*groundY mirror, so straights don't regress.
      const P = this._reflP.copy(f.pos).addScaledVector(f.R, ship.d).addScaledVector(f.U, 0.02);
      const a = f.U.x, b = f.U.y, c = f.U.z;
      const dp = a * P.x + b * P.y + c * P.z;
      this._reflM.set(
        1 - 2 * a * a, -2 * a * b, -2 * a * c, 2 * dp * a,
        -2 * a * b, 1 - 2 * b * b, -2 * b * c, 2 * dp * b,
        -2 * a * c, -2 * b * c, 1 - 2 * c * c, 2 * dp * c,
        0, 0, 0, 1,
      );
      this.reflection.matrix.multiplyMatrices(this._reflM, this.lean.matrixWorld);
      // With the plane now correct on banks, the fade only suppresses the
      // near-vertical case and never paints a ghost above the horizon: full
      // strength through the whole banking range (BANK_MAX 32° -> f.U.y >= 0.85),
      // ramping to zero as the surface nears vertical and off entirely on
      // loops/corkscrews (f.U.y -> 0 or negative).
      const flat = THREE.MathUtils.smoothstep(f.U.y, 0.30, 0.55);
      const op = THREE.MathUtils.clamp(0.30 - lift * 0.10, 0, 0.30) * flat;
      this.reflection.visible = flat > 0 && op > 0.001;
      this.reflMat.opacity = op;
      this.reflGlowMat.opacity = op * 0.7;
    }
  }

  // World position of nozzle i — feeds the exhaust trails.
  getNozzleWorld(i, out) {
    return this.lean.localToWorld(out.copy(this.nozzles[i]));
  }
}

// Batches the AI field's engine flames + cores + glows into three InstancedMeshes
// instead of ~6 meshes/sprites per ship (7 ships: 28 cone draws + 14 glow sprites
// -> 3). Each batched ShipVisual claims a slot range and writes its per-nozzle
// transform + colour every frame, identical to the per-ship versions: same cone
// geometry + additive blend (flame colour via instanceColor, core opacity folded
// into the colour), and the glows are camera-billboarded quads (same glow texture,
// additive, opacity 0.85, colour via instanceColor) — like the old Sprites. The
// player ship is never batched.
const _IDQ = new THREE.Quaternion();
const _CORE_BASE = new THREE.Color(0xcdf6ff);
export class EngineFXBatch {
  constructor(scene, capacity) {
    this.used = 0;
    const mkCone = (r) => {
      const g = new THREE.ConeGeometry(r, 1, 16);
      g.rotateX(-Math.PI / 2); g.translate(0, 0, 0.5);
      return g;
    };
    const mkMat = (opacity) => new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.flames = new THREE.InstancedMesh(mkCone(0.18), mkMat(0.55), capacity);
    this.cores = new THREE.InstancedMesh(mkCone(0.085), mkMat(1.0), capacity);
    // Instanced glow quads (replace the per-ship Sprites); billboarded in flush().
    this.glowTex = makeGlowTexture();
    const glowMat = mkMat(0.85); glowMat.map = this.glowTex; glowMat.side = THREE.DoubleSide;
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat, capacity);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0); // unwritten slots are invisible
    for (const im of [this.flames, this.cores, this.glows]) {
      im.frustumCulled = false;                          // the field spans the track; no shared bound
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.renderOrder = 1;
      for (let i = 0; i < capacity; i++) im.setMatrixAt(i, zero);
      im.count = 0;                                      // grows as ships claim slots
      scene.add(im);
    }
    this.glowPos = []; this.glowScale = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.glowPos.push(new THREE.Vector3());
    this._m = new THREE.Matrix4();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._gv = new THREE.Vector3();
  }
  claim(n) { const base = this.used; this.used += n; this.flames.count = this.cores.count = this.glows.count = this.used; return base; }
  // Write one nozzle slot. leanWorld: the ship's lean matrixWorld this frame.
  write(slot, leanWorld, nozzle, flameXY, flameLen, flameCol, coreXY, coreLen, coreOpacity) {
    this._m.compose(nozzle, _IDQ, this._s.set(flameXY, flameXY, flameLen)).premultiply(leanWorld);
    this.flames.setMatrixAt(slot, this._m);
    this.flames.setColorAt(slot, flameCol);
    this._m.compose(nozzle, _IDQ, this._s.set(coreXY, coreXY, coreLen)).premultiply(leanWorld);
    this.cores.setMatrixAt(slot, this._m);
    this.cores.setColorAt(slot, this._c.copy(_CORE_BASE).multiplyScalar(coreOpacity));
  }
  // Glow billboard data for a nozzle (the matrix is composed in flush() with the
  // camera orientation so the quad faces the screen, exactly like a Sprite).
  writeGlow(slot, leanWorld, nozzle, scale, color) {
    this._gv.copy(nozzle); this._gv.z += 0.15; this._gv.applyMatrix4(leanWorld);
    this.glowPos[slot].copy(this._gv);
    this.glowScale[slot] = scale;
    this.glows.setColorAt(slot, color);
  }
  // camera: orient the glow quads to face it (view-plane billboard, like Sprites).
  flush(camera) {
    const q = camera ? camera.quaternion : _IDQ;
    for (let i = 0; i < this.used; i++) {
      this._m.compose(this.glowPos[i], q, this._s.setScalar(this.glowScale[i]));
      this.glows.setMatrixAt(i, this._m);
    }
    for (const im of [this.flames, this.cores, this.glows]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
  dispose(scene) {
    for (const im of [this.flames, this.cores, this.glows]) { scene.remove(im); im.geometry.dispose(); im.material.dispose(); im.dispose(); }
    this.glowTex.dispose();
  }
}

// --------------------------------------------------------------- ship kit
// Small authoring kit: lofts of closed polygon stations, thin slabs from 4
// midplane corners, flat ribbons. All hard-faceted, baked vertex colors.

function loft(stations, opts = {}) {
  const v = [];
  const tri = (a, b, c) => v.push(...a, ...b, ...c);
  for (let i = 0; i < stations.length - 1; i++) {
    const A = stations[i], B = stations[i + 1];
    const n = A.pts.length;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      const p0 = [A.pts[j][0], A.pts[j][1], A.z];
      const p1 = [A.pts[j1][0], A.pts[j1][1], A.z];
      const q0 = [B.pts[j][0], B.pts[j][1], B.z];
      const q1 = [B.pts[j1][0], B.pts[j1][1], B.z];
      tri(p0, q0, q1);
      tri(p0, q1, p1);
    }
  }
  const cap = (st, flip) => {
    const c = st.pts.reduce((a, p) => [a[0] + p[0] / st.pts.length, a[1] + p[1] / st.pts.length], [0, 0]);
    for (let j = 0; j < st.pts.length; j++) {
      const j1 = (j + 1) % st.pts.length;
      const a = [st.pts[j][0], st.pts[j][1], st.z];
      const b = [st.pts[j1][0], st.pts[j1][1], st.z];
      if (flip) tri([c[0], c[1], st.z], b, a);
      else tri([c[0], c[1], st.z], a, b);
    }
  };
  if (opts.capStart) cap(stations[0], true);
  if (opts.capEnd) cap(stations[stations.length - 1], false);
  return geomFrom(v);
}

// 4 midplane corners (arrays [x,y,z]) extruded +-thickness/2 along the face
// normal: two faces + four edge walls.
function slab(A, B, C2, D, thickness) {
  const a = new THREE.Vector3(...A), b = new THREE.Vector3(...B);
  const c = new THREE.Vector3(...C2), d = new THREE.Vector3(...D);
  const n = new THREE.Vector3().subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(d, a)).normalize().multiplyScalar(thickness / 2);
  const up = [a, b, c, d].map((p) => p.clone().add(n).toArray());
  const dn = [a, b, c, d].map((p) => p.clone().sub(n).toArray());
  const v = [];
  const tri = (x, y, z) => v.push(...x, ...y, ...z);
  tri(up[0], up[1], up[2]); tri(up[0], up[2], up[3]);
  tri(dn[2], dn[1], dn[0]); tri(dn[3], dn[2], dn[0]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(up[i], dn[i], dn[j]); tri(up[i], dn[j], up[j]);
  }
  return geomFrom(v);
}

// Flat strip from paired edge points [[in],[out]] per station, facing +Y-ish.
function ribbon(pairs) {
  const v = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    const [a0, b0] = pairs[i], [a1, b1] = pairs[i + 1];
    v.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
  }
  return geomFrom(v);
}

function geomFrom(verts) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  return g;
}

// Mirror across x=0, restoring outward winding.
function mirrorX(geom) {
  const g = geom.clone();
  const p = g.getAttribute('position');
  const arr = p.array;
  for (let i = 0; i < arr.length; i += 3) arr[i] = -arr[i];
  for (let i = 0; i < p.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = (i + 1) * 3 + k, b = (i + 2) * 3 + k;
      const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
    }
  }
  return g;
}

function colorize(geom, hex) {
  const col = new THREE.Color(hex);
  const n = geom.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geom;
}

// ------------------------------------------------------- PRONGHORN GX-R
// Sponson stations: [z, cx, w, yT, yM, yB]. Shared by the prong loft and by
// every detail that needs to sit ON the prong surface (seams, chevrons...).
const SPONSON = [
  [-2.60, 0.62, 0.05, 0.10, 0.05, 0.00],
  [-1.90, 0.72, 0.16, 0.18, 0.06, -0.06],
  [-1.00, 0.88, 0.26, 0.26, 0.05, -0.14],
  [0.00, 1.00, 0.30, 0.30, 0.06, -0.18],
  [1.20, 1.05, 0.30, 0.34, 0.07, -0.18],
  [2.10, 1.05, 0.24, 0.28, 0.06, -0.12],
];

// Linear interpolation of the sponson cross-section at any z.
function sponAt(z) {
  const S = SPONSON;
  let i = 0;
  while (i < S.length - 2 && S[i + 1][0] < z) i++;
  const a = S[i], b = S[i + 1];
  const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  return { cx: L(1), w: L(2), yT: L(3), yM: L(4), yB: L(5) };
}

// Scale a geometry around a pivot — used for per-team fin/bell variation.
function scaleAround(geom, sx, sy, sz, cx, cy, cz) {
  geom.translate(-cx, -cy, -cz);
  geom.scale(sx, sy, sz);
  geom.translate(cx, cy, cz);
  return geom;
}

// Smooth fin: a rounded-corner polygon (from 4 ship-space corners) extruded
// thin with beveled edges, in the corners' plane. Baked into the hull like
// everything else (no extra draws).
function roundedFinShape(pts, r) {
  const sh = new THREE.Shape(); const n = pts.length;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], L = (v) => Math.hypot(v[0], v[1]) || 1, nz = (v) => { const l = L(v); return [v[0] / l, v[1] / l]; };
  for (let i = 0; i < n; i++) {
    const cur = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    const v1 = nz(sub(prev, cur)), v2 = nz(sub(next, cur));
    const rr = Math.min(r, L(sub(prev, cur)) * 0.45, L(sub(next, cur)) * 0.45);
    const p1 = [cur[0] + v1[0] * rr, cur[1] + v1[1] * rr], p2 = [cur[0] + v2[0] * rr, cur[1] + v2[1] * rr];
    if (i === 0) sh.moveTo(p1[0], p1[1]); else sh.lineTo(p1[0], p1[1]);
    sh.quadraticCurveTo(cur[0], cur[1], p2[0], p2[1]);
  }
  sh.closePath(); return sh;
}
function quadFin(p0, p1, p2, p3, expand = 0.04, r = 0.13, thick = 0.06) {
  const corners = [p0, p1, p2, p3]; const cen = new THREE.Vector3(); corners.forEach((p) => cen.add(p)); cen.multiplyScalar(0.25);
  const E = corners.map((p) => p.clone().add(p.clone().sub(cen).normalize().multiplyScalar(expand)));
  const ex = new THREE.Vector3().subVectors(E[1], E[0]).normalize();
  const nrm = new THREE.Vector3().crossVectors(ex, new THREE.Vector3().subVectors(E[3], E[0])).normalize();
  const ey = new THREE.Vector3().crossVectors(nrm, ex).normalize();
  const to2 = (p) => { const d = new THREE.Vector3().subVectors(p, E[0]); return [d.dot(ex), d.dot(ey)]; };
  const geo = new THREE.ExtrudeGeometry(roundedFinShape(E.map(to2), r), { depth: thick, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.016, bevelSegments: 2, steps: 1, curveSegments: 12 });
  const m = new THREE.Matrix4().makeBasis(ex, ey, nrm); m.setPosition(E[0].clone().addScaledVector(nrm, -thick / 2));
  geo.applyMatrix4(m); return geo;
}

function buildPronghorn(V) {
  const group = new THREE.Group();
  const hexa = (cx, w, yT, yM, yB) => [
    [cx - w, yM], [cx - 0.55 * w, yT], [cx + 0.55 * w, yT],
    [cx + w, yM], [cx + 0.55 * w, yB], [cx - 0.55 * w, yB],
  ];
  const octa = (cx, cy, r) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };

  const opaque = []; // [geometry, colorHex]
  const glows = [];  // colorized geoms → additive glow mesh (declared up-front so addCanopy can add its spar)
  const t = V.tune || {}; // ship-editor knobs (canopy; fin via V.finScale)
  const both = (geom, color) => { opaque.push([geom, color], [mirrorX(geom), color]); };

  // 1. Sponson prongs (the split nose).
  both(loft(
    SPONSON.map(([z, cx, w, yT, yM, yB]) => ({ z, pts: hexa(cx, w, yT, yM, yB) })),
    { capStart: true, capEnd: true },
  ), V.hull);

  // 2. Center pod.
  opaque.push([loft([
    { z: -0.85, pts: hexa(0, 0.06, 0.20, 0.12, 0.06) },
    { z: -0.30, pts: hexa(0, 0.30, 0.36, 0.12, -0.02) },
    { z: 0.35, pts: hexa(0, 0.42, 0.46, 0.12, -0.06) },
    { z: 1.20, pts: hexa(0, 0.36, 0.40, 0.12, -0.04) },
    { z: 2.40, pts: hexa(0, 0.14, 0.24, 0.12, 0.04) },
  ], { capStart: true, capEnd: true }), V.hull]);

  // 3. Pilot canopy — a raised glass bubble on the centre pod.
  addCanopy(opaque, glows, 0, t.canY ?? 0.4, t.canZ ?? -0.02, t.canW ?? 0.2, t.canH ?? 0.29, t.canL ?? 0.62, V.accent);

  // 4. Wing bridges.
  both(slab([0.32, 0.12, -0.05], [0.95, 0.12, 0.55], [0.95, 0.10, 1.45], [0.32, 0.12, 0.80], 0.06), V.hull);

  // 5. Deck stripes on the sponson tops.
  both(ribbon([
    [[0.667, 0.192, -1.90], [0.773, 0.192, -1.90]],
    [[0.794, 0.272, -1.00], [0.966, 0.272, -1.00]],
    [[0.901, 0.312, 0.00], [1.099, 0.312, 0.00]],
    [[0.951, 0.352, 1.20], [1.149, 0.352, 1.20]],
  ]), V.accent);

  // 6 + 7. Tail fin + splayed airbrake fins: smooth rounded fins, baked into the
  // hull like everything else (zero extra draws).
  {
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const fz = t.finZ ?? 0; // fin fore-aft (height = V.finScale)
    opaque.push([scaleAround(quadFin(
      V3(0, 0.42, 0.95 + fz), V3(0, 0.92, 2.25 + fz), V3(0, 0.30, 2.40 + fz), V3(0, 0.32, 1.05 + fz), 0.04, 0.16, 0.06),
      1, V.finScale, 1, 0, 0.36, 0), V.accent]);
    for (const sx of [-1, 1]) {
      opaque.push([quadFin(
        V3(sx * 1.20, 0.30, 0.95), V3(sx * 1.66, 0.62, 1.75), V3(sx * 1.62, 0.58, 2.15), V3(sx * 1.18, 0.26, 2.05), 0.04, 0.10, 0.05), V.accent]);
    }
  }

  // 8. Belly keel.
  opaque.push([slab([0, -0.03, 0.00], [0, -0.16, 0.60], [0, -0.16, 1.60], [0, 0.02, 1.90], 0.05), C.SHIP_CANOPY]);

  // 9. Intake wall plates (darken the slot interior).
  both(slab([0.56, 0.14, -2.20], [0.64, 0.20, -1.10], [0.64, -0.08, -1.10], [0.57, -0.02, -2.20], 0.02), C.SHIP_CANOPY);

  // 10. Flared octagonal exhaust bells (radius scaled per team).
  const bs = V.bellScale;
  both(loft([
    { z: 2.00, pts: octa(1.05, 0.06, 0.17 * bs) },
    { z: 2.30, pts: octa(1.05, 0.06, 0.26 * bs) },
    { z: 2.45, pts: octa(1.05, 0.06, 0.20 * bs) },
  ]), C.SHIP_CANOPY);

  // ---- detail pass ------------------------------------------------------
  // 11. Pitot/antenna spike on the RIGHT prong only — asymmetry is character.
  opaque.push([loft([
    { z: -3.02, pts: octa(0.62, 0.06, 0.012) },
    { z: -2.55, pts: octa(0.62, 0.06, 0.04) },
  ], { capStart: true }), C.SHIP_CANOPY]);

  // 12. Canards off the prong flanks near the nose.
  both(slab([0.84, 0.03, -1.82], [1.18, 0.11, -1.50], [1.16, 0.09, -1.34], [0.84, 0.01, -1.60], 0.04), V.accent);

  // 13. Panel seams: thin dark transverse lines across the sponson decks.
  for (const z of [-0.55, 0.45, 1.45]) {
    const sp = sponAt(z);
    const x0 = sp.cx - 0.5 * sp.w, x1 = sp.cx + 0.5 * sp.w;
    const y = sp.yT + 0.012;
    both(ribbon([
      [[x0, y, z], [x1, y, z]],
      [[x0, y, z + 0.06], [x1, y, z + 0.06]],
    ]), 0x4a3f66);
  }

  // 14. Rear deck vents: three dark slats on the pod's aft slope.
  for (let i = 0; i < 3; i++) {
    const z = 1.62 + i * 0.2;
    both(slab([0.13, 0.32, z], [0.33, 0.30, z], [0.33, 0.30, z + 0.11], [0.13, 0.32, z + 0.11], 0.03), C.SHIP_CANOPY);
  }

  // 15. Airbrake actuator arms.
  both(slab([1.02, 0.18, 1.55], [1.38, 0.42, 1.75], [1.36, 0.40, 1.88], [1.00, 0.16, 1.68], 0.04), C.SHIP_CANOPY);

  // 17. Underside strakes below each sponson.
  both(slab([0.95, -0.18, 0.20], [0.95, -0.28, 0.70], [0.95, -0.28, 1.45], [0.95, -0.16, 1.70], 0.03), C.SHIP_CANOPY);

  // 18. Nose chevrons on each prong deck.
  {
    const sp = sponAt(-2.25);
    const y = sp.yT + 0.012;
    both(ribbon([
      [[sp.cx - 0.06, y, -2.34], [sp.cx + 0.06, y, -2.34]],
      [[sp.cx - 0.06, y, -2.16], [sp.cx + 0.06, y, -2.16]],
    ]), V.accent);
  }

  // 19. Intake grille: vertical vanes across each prong's air slot.
  {
    const sp = sponAt(-2.0);
    for (let t = 0; t < 4; t++) {
      const x = sp.cx - 0.075 + t * 0.05;
      both(slab([x, sp.yT - 0.01, -2.08], [x, sp.yB + 0.02, -2.08],
        [x, sp.yB + 0.02, -1.86], [x, sp.yT - 0.01, -1.86], 0.012), C.SHIP_CANOPY);
    }
  }

  // 20. Cooling louvres on the centre-pod flanks.
  for (let i = 0; i < 3; i++) {
    const z = 0.15 + i * 0.22;
    both(slab([0.30, 0.18, z], [0.40, 0.10, z], [0.40, 0.10, z + 0.13], [0.30, 0.18, z + 0.13], 0.02), C.SHIP_CANOPY);
  }

  // 21. Flank livery stripe down each sponson's outer face.
  both(ribbon([-1.9, -1.0, 0.0, 1.2, 2.0].map((z) => {
    const sp = sponAt(z);
    const x = sp.cx + sp.w * 0.92;
    return [[x, sp.yM + 0.03, z], [x, sp.yM - 0.05, z]];
  })), V.accent);

  // 22. Extra panel seams across the pod deck.
  for (const z of [0.0, 0.9]) {
    both(ribbon([
      [[0.06, 0.44, z], [0.34, 0.40, z]],
      [[0.06, 0.44, z + 0.05], [0.34, 0.40, z + 0.05]],
    ]), 0x4a3f66);
  }

  // 23. High-poly detail (opaque parts): round turbine nacelles + a canopy dome.
  // Baked into the hull like everything else → 0 extra draws, just more triangles
  // (cheap on a fill-bound budget). Glow rings added to the glow set below.
  {
    const MTL = 0x2e3440; // dark machined metal, reads on every livery
    const xf = (g, x, y, z, rx, ry, rz) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; };
    for (const sx of [-1, 1]) {
      const ex = sx * 1.05;
      opaque.push([xf(new THREE.CylinderGeometry(0.27, 0.32, 0.52, 28, 1, true), ex, 0.06, 2.16, Math.PI / 2), MTL]); // nacelle shell
      opaque.push([xf(new THREE.CylinderGeometry(0.20, 0.27, 0.16, 28, 1, true), ex, 0.06, 1.92, Math.PI / 2), MTL]); // flared intake
      opaque.push([xf(new THREE.TorusGeometry(0.30, 0.045, 14, 40), ex, 0.06, 2.44), V.accent]);                       // bevel lip
      opaque.push([xf(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 18), ex, 0.06, 2.30, Math.PI / 2), MTL]);            // turbine hub
      for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; opaque.push([xf(new THREE.BoxGeometry(0.022, 0.18, 0.05), ex + Math.cos(a) * 0.135, 0.06 + Math.sin(a) * 0.135, 2.32, 0, 0, a), MTL]); } // blades
      opaque.push([xf(new THREE.TorusGeometry(0.15, 0.012, 8, 32), ex, 0.06, 2.36), MTL]);                            // inner ring
    }
  }

  const baked = opaque.map(([g, col]) => bakeFlatColors(g, col, { rim: false }));
  const hullGeo = mergeGeoms(baked);
  hullGeo.computeVertexNormals(); // flat per-face normals (non-indexed) for the rim
  const hullMesh = new THREE.Mesh(hullGeo, makeHullMaterial(V));
  group.add(hullMesh);

  // ---- glow set: slot rails, leading-edge strips, fin edge, nozzle discs ----
  // (glows[] is declared up-front; the canopy spar is already in it)
  const railPts = [[-2.30, 0.556], [-1.90, 0.550], [-1.00, 0.610], [0.00, 0.690], [1.20, 0.740], [1.90, 0.787]];
  const rail = ribbon(railPts.map(([z, x]) => [[x, 0.00, z], [x, 0.08, z]]));
  glows.push(colorize(rail, C.ENGINE), colorize(mirrorX(rail), C.ENGINE));

  const ledge = slab([0.34, 0.158, -0.02], [0.93, 0.158, 0.53], [0.93, 0.158, 0.63], [0.34, 0.158, 0.10], 0.015);
  glows.push(colorize(ledge, V.accent), colorize(mirrorX(ledge), V.accent));

  glows.push(colorize(scaleAround(
    slab([0, 0.32, 2.42], [0, 0.92, 2.27], [0, 0.92, 2.21], [0, 0.32, 2.36], 0.03),
    1, V.finScale, 1, 0, 0.36, 0), V.accent));

  for (const sx of [-1, 1]) {
    const disc = [];
    const c = [sx * 1.05, 0.06, 2.42];
    const dr = 0.17 * V.bellScale;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
      disc.push(...c,
        c[0] + Math.cos(a0) * dr, c[1] + Math.sin(a0) * dr, c[2],
        c[0] + Math.cos(a1) * dr, c[1] + Math.sin(a1) * dr, c[2]);
    }
    glows.push(colorize(geomFrom(disc), C.ENGINE));
  }

  // G5. Engine pre-ring: a thin accent energy band around each sponson tail.
  const preRing = loft([
    { z: 1.88, pts: octa(1.05, 0.07, 0.33 * V.bellScale) },
    { z: 1.94, pts: octa(1.05, 0.07, 0.33 * V.bellScale) },
  ]);
  glows.push(colorize(preRing, V.accent), colorize(mirrorX(preRing), V.accent));

  // G6. Nav lights on the airbrake tips, mirroring the track's edge coding:
  // cyan left, magenta right.
  const navL = slab([-1.64, 0.64, 1.70], [-1.56, 0.58, 1.82], [-1.58, 0.56, 1.88], [-1.66, 0.62, 1.76], 0.03);
  glows.push(colorize(navL, C.EDGE_L));
  glows.push(colorize(mirrorX(navL), C.EDGE_R));

  // G7. Slot arrowhead: a cyan chevron on the pod's nose deck, pointing
  // forward — the planform signature.
  glows.push(colorize(geomFrom([
    0, 0.31, -0.62, 0.11, 0.33, -0.30, -0.11, 0.33, -0.30,
  ]), C.ENGINE));

  // High-poly detail (glow parts): the turbine's neon ring + core disc, folded
  // into the glow set (C.ENGINE → re-tinted to the livery glow below).
  {
    const xg = (g, x, y, z, rx, ry, rz) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; };
    for (const sx of [-1, 1]) {
      const ex = sx * 1.05;
      glows.push(colorize(xg(new THREE.TorusGeometry(0.235, 0.03, 12, 40), ex, 0.06, 2.40).toNonIndexed(), C.ENGINE));
      glows.push(colorize(xg(new THREE.CircleGeometry(0.18, 36), ex, 0.06, 2.45).toNonIndexed(), C.ENGINE));
    }
  }

  const glowMesh = new THREE.Mesh(mergeGeoms(glows), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  }));
  glowMesh.renderOrder = 1;
  group.add(glowMesh);
  // Premium liveries re-theme the baked cyan engine-glow to their own glow hue.
  if (V.glow != null) retintGlow(glowMesh.geometry, C.ENGINE, V.glow);

  // Team proportions. Applied on the static mesh group (below the lean node),
  // so roll/pitch animation never shears the scaled geometry.
  group.scale.set(V.scaleX, 1, V.scaleZ);
  // Exposed so ShipVisual can drive the boost rim-pulse and clone a reflection.
  group.userData.hullMat = hullMesh.material;
  group.userData.hullGeo = hullGeo;
  group.userData.glowGeo = glowMesh.geometry;
  group.userData.shipScale = [V.scaleX, 1, V.scaleZ];
  group.userData.nozzles = [{ x: -1.05, y: 0.06, z: 2.46 }, { x: 1.05, y: 0.06, z: 2.46 }];
  group.userData.reactive = { brake: [[[-0.34, 0.30, 2.26], [0.34, 0.30, 2.26]], [[-0.34, 0.30, 2.42], [0.34, 0.30, 2.42]]], boost: { pos: [0, 0.12, 2.3], scale: 1.4 } };
  return group;
}

// Dispatcher: each team's variant.arch selects a hull builder. Unknown → pronghorn.
// Merge DEFAULT_VARIANT so partial/{} variants (e.g. a podium entry) never NaN out.
const ARCH_BUILDERS = { pronghorn: buildPronghorn, manta: buildManta, delta: buildDelta, twinboom: buildTwinboom };
export function buildShipMesh(V = DEFAULT_VARIANT) {
  V = { ...DEFAULT_VARIANT, ...V };
  return (ARCH_BUILDERS[V.arch] || ARCH_BUILDERS.pronghorn)(V);
}

// ===================== shared archetype kit =====================
// 6-point hull cross-section (x,y): outer at yM, deck at yT, belly at yB.
function hex6(w, yT, yM, yB) { return [[-w, yM], [-w * 0.5, yT], [w * 0.5, yT], [w, yM], [w * 0.5, yB], [-w * 0.5, yB]]; }
// 8-point flat lens cross-section (wide, slightly domed top) for the manta.
function lens8(W, T) { return [[-W, 0], [-W * 0.55, T * 0.55], [0, T], [W * 0.55, T * 0.55], [W, 0], [W * 0.55, -T * 0.45], [0, -T * 0.62], [-W * 0.55, -T * 0.45]]; }
// thin triangular plate (wing / fin / canard), extruded `t` along an axis.
function tri3d(a, b, c, t, axis) {
  const o = (p, s) => axis === 'y' ? [p[0], p[1] + s, p[2]] : axis === 'x' ? [p[0] + s, p[1], p[2]] : [p[0], p[1], p[2] + s];
  const U = [o(a, t / 2), o(b, t / 2), o(c, t / 2)], D = [o(a, -t / 2), o(b, -t / 2), o(c, -t / 2)], v = [];
  v.push(...U[0], ...U[1], ...U[2]); v.push(...D[0], ...D[2], ...D[1]);
  for (let i = 0; i < 3; i++) { const j = (i + 1) % 3; v.push(...U[i], ...U[j], ...D[j], ...U[i], ...D[j], ...D[i]); }
  return geomFrom(v);
}
// additive glow disc (non-indexed fan).
function discGeo(cx, cy, cz, r, segs) {
  const v = [];
  for (let i = 0; i < segs; i++) { const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2; v.push(cx, cy, cz, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cz, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cz); }
  return geomFrom(v);
}
const gcol = (geo, hex) => colorize(geo.index ? geo.toNonIndexed() : geo, hex);
const xform = (g, x, y, z, rx, ry, rz) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; };

// Engine at each nozzle: dark bell + cyan glow disc + a detailed turbine
// (graphite nacelle + bevel lip + hub + blades + neon ring).
function addEngines(opaque, glows, nozzles, accentHex) {
  for (const n of nozzles) {
    const r = n.r || 0.2, z = n.z;
    opaque.push([xform(new THREE.CylinderGeometry(r * 0.95, r * 1.12, r * 1.7, 18, 1, true), n.x, n.y, z - r * 0.8, Math.PI / 2), C.SHIP_CANOPY]);
    glows.push(gcol(discGeo(n.x, n.y, z + 0.03, r * 0.82, 18), C.ENGINE));
    {
      opaque.push([xform(new THREE.CylinderGeometry(r, r * 1.18, r * 2.0, 28, 1, true), n.x, n.y, z - r, Math.PI / 2), 0x2e3440]);
      opaque.push([xform(new THREE.TorusGeometry(r * 1.12, r * 0.16, 12, 40), n.x, n.y, z + r * 0.05), accentHex]);
      opaque.push([xform(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.7, 14), n.x, n.y, z - r * 0.5, Math.PI / 2), 0x2e3440]);
      for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; opaque.push([xform(new THREE.BoxGeometry(r * 0.09, r * 0.72, r * 0.2), n.x + Math.cos(a) * r * 0.5, n.y + Math.sin(a) * r * 0.5, z - r * 0.35, 0, 0, a), 0x2e3440]); }
      glows.push(gcol(xform(new THREE.TorusGeometry(r * 0.9, r * 0.1, 12, 36), n.x, n.y, z + 0.02), C.ENGINE));
    }
  }
}
// Assemble an archetype: opaque [geo,colorHex] → baked hull; glows (already
// colorized) → additive glow mesh; same userData contract as the pronghorn.
function assembleShip(V, opaque, glows, nozzles, reactive) {
  const group = new THREE.Group();
  const hullGeo = mergeGeoms(opaque.map(([g, col]) => bakeFlatColors(g, col, { rim: false })));
  hullGeo.computeVertexNormals();
  const hullMesh = new THREE.Mesh(hullGeo, makeHullMaterial(V));
  group.add(hullMesh);
  const glowMesh = new THREE.Mesh(mergeGeoms(glows), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  }));
  glowMesh.renderOrder = 1;
  group.add(glowMesh);
  if (V.glow != null) retintGlow(glowMesh.geometry, C.ENGINE, V.glow);
  group.scale.set(V.scaleX, 1, V.scaleZ);
  group.userData = { hullMat: hullMesh.material, hullGeo, glowGeo: glowMesh.geometry, shipScale: [V.scaleX, 1, V.scaleZ], nozzles, reactive };
  return group;
}

// A believable pilot CANOPY — a raised dark-glass bubble (elongated dome, so a
// seated pilot plausibly fits) sunk into a machined coaming, with an accent
// crown spar. Every hull calls this so it clearly reads "the pilot sits HERE".
// Glass + coaming bake into the hull; the spar folds into the glow set.
// cx/cy/cz = base centre (cy sits on the deck); W/H/L = half-width / height /
// half-length of the dome.
function addCanopy(opaque, glows, cx, cy, cz, W, H, L, accentHex) {
  // recessed coaming ring the bubble sits IN (reads as a cockpit tub, not a blob)
  const rim = new THREE.CylinderGeometry(1, 1.05, 0.09, 22, 1, true);
  rim.scale(W * 1.08, 1, L * 1.08); rim.translate(cx, cy + 0.03, cz);
  opaque.push([rim, 0x2e3440]);
  // dark glass bubble — upper half-ellipsoid, longer fore-aft than wide
  const glass = new THREE.SphereGeometry(1, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
  glass.scale(W, H, L); glass.translate(cx, cy + 0.05, cz);
  opaque.push([glass, C.SHIP_CANOPY]);
  // crown spar: a thin accent rib running nose→tail over the canopy top
  glows.push(gcol(ribbon([
    [[cx - 0.02, cy + 0.08, cz - L * 0.84], [cx + 0.02, cy + 0.08, cz - L * 0.84]],
    [[cx - 0.025, cy + H * 0.92, cz - L * 0.08], [cx + 0.025, cy + H * 0.92, cz - L * 0.08]],
    [[cx - 0.02, cy + H * 0.58, cz + L * 0.82], [cx + 0.02, cy + H * 0.58, cz + L * 0.82]],
  ]), accentHex));
}

// HALCYON — low, wide, soft manta wing-body (handling).
function buildManta(V) {
  const opaque = [], glows = [];
  const t = V.tune || {}; const bw = t.bodyW ?? 1; // ship-editor knobs (fall back to defaults)
  // Broad swept manta wing-body: a long graceful leading-edge sweep out to wide
  // wingtips near the rear, then a swept trailing edge into a slim tail. Flat and
  // low — the whole body is the wing.
  opaque.push([loft([
    { z: -2.1, pts: lens8(0.14 * bw, 0.10) }, { z: -1.2, pts: lens8(0.52 * bw, 0.15) }, { z: -0.2, pts: lens8(0.98 * bw, 0.16) },
    { z: 0.6, pts: lens8(1.42 * bw, 0.14) }, { z: 1.25, pts: lens8(1.72 * bw, 0.12) }, { z: 1.75, pts: lens8(1.5 * bw, 0.10) },
    { z: 2.1, pts: lens8(0.8 * bw, 0.09) }, { z: 2.5, pts: lens8(0.2 * bw, 0.08) },
  ], { capStart: true, capEnd: true }), V.hull]);
  // soft upturned wingtips (gentle, not pointy) at the widest span
  const tip = quadFin(
    new THREE.Vector3(1.55 * bw, 0.02, 0.95), new THREE.Vector3(1.78 * bw, 0.16, 1.3),
    new THREE.Vector3(1.5 * bw, 0.06, 1.62), new THREE.Vector3(1.32 * bw, 0.0, 1.28), 0.03, 0.1, 0.05);
  opaque.push([tip, V.accent], [mirrorX(tip), V.accent]);
  // pilot canopy — a raised glass bubble forward of centre + dorsal accent line
  addCanopy(opaque, glows, 0, t.canY ?? 0.13, t.canZ ?? -0.4, t.canW ?? 0.26, t.canH ?? 0.3, t.canL ?? 0.66, V.accent);
  glows.push(gcol(ribbon([[[-0.02, 0.15, -1.6], [0.02, 0.15, -1.6]], [[-0.02, 0.1, 1.85], [0.02, 0.1, 1.85]]]), V.accent));
  // --- surface detail (tracks the wide swept wing) ---
  const mEdge = ribbon([[[0.5, 0.13, -0.85], [0.44, 0.11, -0.75]], [[1.2, 0.08, 0.2], [1.12, 0.06, 0.3]], [[1.66, 0.03, 1.1], [1.56, 0.01, 1.22]]]); // swept leading-edge glow → wingtip
  glows.push(gcol(mEdge, V.accent), gcol(mirrorX(mEdge), V.accent));
  for (const z of [-0.4, 0.5, 1.15]) { const w = z < 0 ? 0.7 : z < 0.9 ? 1.15 : 1.45; opaque.push([ribbon([[[-w, 0.125, z], [w, 0.125, z]], [[-w, 0.125, z + 0.06], [w, 0.125, z + 0.06]]]), 0x4a3f66]); } // deck seams
  const mStripe = ribbon([[[0.55, 0.09, -0.2], [0.55, 0.03, -0.2]], [[1.25, 0.05, 0.75], [1.25, -0.01, 0.75]]]); // accent flank stripe
  opaque.push([mStripe, V.accent], [mirrorX(mStripe), V.accent]);
  glows.push(gcol(discGeo(-1.62 * bw, 0.05, 1.2, 0.055, 8), C.EDGE_L), gcol(discGeo(1.62 * bw, 0.05, 1.2, 0.055, 8), C.EDGE_R)); // nav lights at the wingtips
  const ex = t.engX ?? 0.3, ey = t.engY ?? 0.07, ez = t.engZ ?? 2.02, er = t.engR ?? 0.16;
  const nozzles = [{ x: -ex, y: ey, z: ez, r: er }, { x: ex, y: ey, z: ez, r: er }];
  addEngines(opaque, glows, nozzles, V.accent);
  const reactive = { brake: [[[-0.45, 0.14, 1.7], [0.45, 0.14, 1.7]], [[-0.45, 0.14, 1.95], [0.45, 0.14, 1.95]]], boost: { pos: [0, 0.08, 2.05], scale: 1.2 } };
  return assembleShip(V, opaque, glows, nozzles, reactive);
}

// RAZORBACK — wide, low, forward-swept delta arrow (speed).
function buildDelta(V) {
  const opaque = [], glows = [];
  const t = V.tune || {}; const ws = t.wingSpan ?? 1, wl = t.wingLen ?? 1; // ship-editor knobs
  const fh = t.finH ?? 1, fz = t.finZ ?? 0, flen = t.finLen ?? 1; // fin: height / fore-aft / chord
  opaque.push([loft([
    { z: -3.0, pts: hex6(0.05, 0.05, 0.0, -0.05) }, { z: -1.4, pts: hex6(0.45, 0.1, 0.0, -0.12) },
    { z: 0.4, pts: hex6(1.05, 0.13, 0.0, -0.14) }, { z: 2.0, pts: hex6(1.5, 0.12, 0.0, -0.12) }, { z: 2.5, pts: hex6(1.36, 0.1, 0.0, -0.1) },
  ], { capStart: true, capEnd: true }), V.hull]);
  // big forward-swept delta wings with SOFT tips (not thin pointy blades), with
  // dihedral (tips raised) so a banked wingtip clears the road. wingSpan scales
  // the half-span (x), wingLen scales chord (z) about the wing centre.
  const wp = (x, y, z) => new THREE.Vector3(x * ws, y, 0.8 + (z - 0.8) * wl);
  const wing = quadFin(
    wp(0.5, 0.03, -0.65), wp(1.72, 0.2, 0.95), wp(1.5, 0.11, 2.25), wp(0.85, 0.05, 2.05), 0.04, 0.14, 0.06);
  opaque.push([wing, V.hull], [mirrorX(wing), V.hull]);
  // low swept-back tail fin (finH height / finZ fore-aft / finLen chord) + canopy
  const dfz = (z) => 1.65 + (z - 1.65) * flen + fz; // scale chord about the fin centre, then offset
  opaque.push([tri3d([0, 0.12, dfz(0.95)], [0, 0.12 + 0.46 * fh, dfz(2.05)], [0, 0.12, dfz(2.35)], 0.05, 'x'), V.accent]);
  addCanopy(opaque, glows, 0, t.canY ?? 0.12, t.canZ ?? -0.6, t.canW ?? 0.24, t.canH ?? 0.3, t.canL ?? 0.62, V.accent);
  glows.push(gcol(ribbon([[[-0.02, 0.16, -2.6], [0.02, 0.16, -2.6]], [[-0.02, 0.14, 2.0], [0.02, 0.14, 2.0]]]), V.accent));
  // --- surface detail ---
  const dEdge = ribbon([[[0.52, 0.04, -0.6], [0.46, 0.03, -0.5]], [[1.7, 0.2, 0.9], [1.62, 0.19, 1.0]]]); // forward-swept wing leading-edge glow
  glows.push(gcol(dEdge, V.accent), gcol(mirrorX(dEdge), V.accent));
  glows.push(gcol(geomFrom([0, 0.145, -2.2, 0.16, 0.135, -1.7, -0.16, 0.135, -1.7]), V.accent)); // nose chevron
  // twin dorsal air intakes on the fuselage shoulders, angled back to feed the rear engines
  for (const sx of [-1, 1]) {
    opaque.push([slab([sx * 0.22, 0.13, 0.35], [sx * 0.52, 0.12, 0.5], [sx * 0.52, 0.0, 1.25], [sx * 0.22, 0.02, 1.05], 0.03), C.SHIP_CANOPY]);
    glows.push(gcol(ribbon([[[sx * 0.22, 0.14, 0.34], [sx * 0.52, 0.13, 0.49]], [[sx * 0.26, 0.04, 1.1], [sx * 0.54, 0.03, 1.22]]]), V.accent)); // intake lip
  }
  for (const z of [-0.3, 0.7, 1.5]) { const w = z < 0 ? 0.55 : z < 1 ? 0.95 : 1.25; opaque.push([ribbon([[[-w, 0.135, z], [w, 0.135, z]], [[-w, 0.135, z + 0.06], [w, 0.135, z + 0.06]]]), 0x2a1626]); } // deck seams
  glows.push(gcol(discGeo(-1.68 * ws, 0.19, 1.0, 0.05, 8), C.EDGE_L), gcol(discGeo(1.68 * ws, 0.19, 1.0, 0.05, 8), C.EDGE_R)); // nav lights at the wingtips
  const ex = t.engX ?? 0.52, ey = t.engY ?? 0.06, ez = t.engZ ?? 2.28, er = t.engR ?? 0.22;
  const nozzles = [{ x: -ex, y: ey, z: ez, r: er }, { x: ex, y: ey, z: ez, r: er }];
  addEngines(opaque, glows, nozzles, V.accent);
  const reactive = { brake: [[[-1.0, 0.12, 2.0], [1.0, 0.12, 2.0]], [[-1.0, 0.12, 2.25], [1.0, 0.12, 2.25]]], boost: { pos: [0, 0.1, 2.3], scale: 1.7 } };
  return assembleShip(V, opaque, glows, nozzles, reactive);
}

// NOVASURGE — short, heavy, twin-boom with big rear engines (thrust).
function buildTwinboom(V) {
  const opaque = [], glows = [];
  const t = V.tune || {}; const bx = t.boomX ?? 0.78; // ship-editor knobs
  const fh = t.finH ?? 1, fz = t.finZ ?? 0, flen = t.finLen ?? 1; // fin: height / fore-aft / chord
  const tfz = (z) => 1.15 + (z - 1.15) * flen + fz; // fin chord about its centre + offset
  opaque.push([loft([
    { z: -1.9, pts: hex6(0.16, 0.18, 0.04, -0.1) }, { z: -0.8, pts: hex6(0.46, 0.42, 0.08, -0.2) },
    { z: 0.6, pts: hex6(0.52, 0.46, 0.08, -0.22) }, { z: 1.6, pts: hex6(0.4, 0.34, 0.06, -0.16) },
  ], { capStart: true, capEnd: true }), V.hull]);
  for (const sx of [-1, 1]) {
    const boom = loft([{ z: -0.3, pts: hex6(0.16, 0.16, 0.0, -0.16) }, { z: 1.7, pts: hex6(0.28, 0.24, 0.0, -0.24) }], { capEnd: true });
    boom.translate(sx * bx, 0.02, 0);
    opaque.push([boom, V.hull]);
  }
  // tall fin (finH height / finZ fore-aft / finLen chord) + canopy on the pod
  opaque.push([tri3d([0, 0.4, tfz(0.4)], [0, 0.4 + 0.75 * fh, tfz(1.5)], [0, 0.4, tfz(1.9)], 0.06, 'x'), V.accent]);
  addCanopy(opaque, glows, 0, t.canY ?? 0.42, t.canZ ?? -0.25, t.canW ?? 0.27, t.canH ?? 0.32, t.canL ?? 0.6, V.accent);
  glows.push(gcol(ribbon([[[-0.02, 0.48, -1.0], [0.02, 0.48, -1.0]], [[-0.02, 0.4, 1.4], [0.02, 0.4, 1.4]]]), V.accent));
  // --- surface detail ---
  for (const sx of [-1, 1]) { const bs = ribbon([[[sx * bx, 0.18, -0.2], [sx * bx, 0.08, -0.2]], [[sx * bx, 0.24, 1.5], [sx * bx, 0.12, 1.5]]]); opaque.push([bs, V.accent]); } // boom accent stripes
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { const z = -0.3 + i * 0.4; opaque.push([slab([sx * 0.5, 0.22, z], [sx * 0.54, 0.12, z], [sx * 0.54, 0.12, z + 0.18], [sx * 0.5, 0.22, z + 0.18], 0.02), C.SHIP_CANOPY]); } // pod louvres
  for (const z of [-0.8, 0.2, 1.0]) opaque.push([ribbon([[[-0.38, 0.47, z], [0.38, 0.47, z]], [[-0.38, 0.47, z + 0.06], [0.38, 0.47, z + 0.06]]]), 0x2a1a40]); // pod deck seams
  glows.push(gcol(ribbon([[[0, 0.42, tfz(0.52)], [0, 0.42, tfz(0.58)]], [[0, 0.35 + 0.75 * fh, tfz(1.48)], [0, 0.35 + 0.75 * fh, tfz(1.54)]]]), V.accent)); // fin edge glow
  glows.push(gcol(discGeo(-bx, 0.24, 1.62, 0.06, 8), C.EDGE_L), gcol(discGeo(bx, 0.24, 1.62, 0.06, 8), C.EDGE_R)); // nav lights
  const ex = t.engX ?? bx, ey = t.engY ?? 0.02, ez = t.engZ ?? 2.0, er = t.engR ?? 0.42;
  const nozzles = [{ x: -ex, y: ey, z: ez, r: er }, { x: ex, y: ey, z: ez, r: er }];
  addEngines(opaque, glows, nozzles, V.accent);
  const reactive = { brake: [[[-0.5, 0.46, 1.2], [0.5, 0.46, 1.2]], [[-0.5, 0.46, 1.45], [0.5, 0.46, 1.45]]], boost: { pos: [0, 0.1, 1.9], scale: 1.9 } };
  return assembleShip(V, opaque, glows, nozzles, reactive);
}

// Hull material: baked vertex colours + a 3-step cel form, AO, a two-tone
// underbelly, a soft gloss kiss and a dual/iridescent fresnel rim — still UNLIT,
// still flat-neon, one draw. The rim catches a light against busy backgrounds.
function makeHullMaterial(V) {
  const accentHex = (V && typeof V === 'object') ? (V.accent ?? 0xff2e88) : V; // tolerate accent-only callers
  return makePremiumHull(V && typeof V === 'object' ? V : { accent: accentHex });
}

function makePremiumHull(V) {
  const col = (h, d) => new THREE.Color(h != null ? h : d);
  const hull = col(V.hull, 0xe8e4f0), accent = col(V.accent, 0xff2e88);
  const belly = V.bellyTint != null ? col(V.bellyTint) : hull.clone().lerp(new THREE.Color(0x0a0c16), 0.72);
  const glow = col(V.glow, C.ENGINE), rim = col(V.rim, V.accent ?? 0xff2e88), a2 = col(V.accent2, V.accent ?? 0xff2e88);
  const irid = V.irid ? 1 : 0;
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        rimCol: { value: rim }, rim2Col: { value: glow }, uBelly: { value: belly },
        uRimA: { value: irid ? accent : rim }, uRimB: { value: irid ? a2 : rim }, uIrid: { value: irid },
        rimStrength: { value: 0.6 }, uBoost: { value: 0 },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vColor; varying vec3 vNobj; varying vec3 vN; varying vec3 vView; varying float vPosY;
      #include <fog_pars_vertex>
      void main() {
        vColor = color; vNobj = normalize(normal); vPosY = position.y;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 rimCol; uniform vec3 rim2Col; uniform vec3 uBelly;
      uniform vec3 uRimA; uniform vec3 uRimB; uniform float uIrid;
      uniform float rimStrength; uniform float uBoost;
      varying vec3 vColor; varying vec3 vNobj; varying vec3 vN; varying vec3 vView; varying float vPosY;
      #include <fog_pars_fragment>
      void main() {
        vec3 No = normalize(vNobj);
        float key = max(dot(No, normalize(vec3(0.34, 0.86, 0.38))), 0.0); // soft baked key, object space
        float kq = floor(key * 3.0 + 0.5) / 3.0;                          // 3-step cel form
        float shade = mix(0.82, 1.20, kq);
        float ao = mix(0.72, 1.0, clamp(No.y * 0.5 + 0.5, 0.0, 1.0));      // belly a touch darker
        vec3 base = vColor * shade * ao;
        float belly = smoothstep(0.05, -0.12, vPosY); base = mix(base, uBelly, belly * 0.72); // two-tone (band kept below the deck so flat manta/delta decks stay bright)
        float gloss = smoothstep(0.88, 0.99, key); base += gloss * 0.16;  // polished kiss on top panels
        float rim = pow(1.0 - max(dot(normalize(vN), normalize(vView)), 0.0), 2.4);
        vec3 irid = mix(uRimA, uRimB, clamp(vN.x * 0.6 + 0.5, 0.0, 1.0));  // banks across the silhouette
        vec3 baseRim = mix(rimCol, irid, uIrid);
        vec3 rc = mix(baseRim, vec3(1.0), uBoost * 0.4);
        float rs = rimStrength * mix(1.0, 1.6, uBoost);
        float coolMask = clamp(-No.y * 1.4, 0.0, 1.0);
        vec3 col = base + rc * rim * rs + rim2Col * rim * coolMask * 0.5;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
    fog: true,
    side: THREE.DoubleSide,
  });
}

// Re-tint baked glow vertices that match `fromCol` (the cyan engine glow) to a
// livery's own glow hue — used so a premium livery's neon is fully on-palette.
function retintGlow(geo, fromCol, toHex) {
  const c = geo.attributes.color; if (!c) return;
  const f = new THREE.Color(fromCol), to = new THREE.Color(toHex);
  for (let i = 0; i < c.count; i++) {
    if (Math.abs(c.getX(i) - f.r) < 0.14 && Math.abs(c.getY(i) - f.g) < 0.14 && Math.abs(c.getZ(i) - f.b) < 0.14) c.setXYZ(i, to.r, to.g, to.b);
  }
  c.needsUpdate = true;
}

function makeGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function makeShadowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(5,2,15,0.9)');
  grad.addColorStop(0.6, 'rgba(5,2,15,0.5)');
  grad.addColorStop(1, 'rgba(5,2,15,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
