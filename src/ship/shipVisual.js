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
  hull: 0xe8e4f0, accent: 0xff2e88,
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
    this.flames = [];
    this.cores = [];
    this.nozzles = [
      new THREE.Vector3(-1.05 * V.scaleX, 0.06, 2.46 * V.scaleZ),
      new THREE.Vector3(1.05 * V.scaleX, 0.06, 2.46 * V.scaleZ),
    ];
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
    // Engine glow sprites.
    this.glows = [];
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
      const brakeGeom = ribbon([
        [[-0.34, 0.30, 2.26], [0.34, 0.30, 2.26]],
        [[-0.34, 0.30, 2.42], [0.34, 0.30, 2.42]],
      ]);
      this.brakeMesh = new THREE.Mesh(brakeGeom, new THREE.MeshBasicMaterial({
        color: 0xff4a2e, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
      }));
      this.lean.add(this.brakeMesh);

      this.boostMesh = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(), color: C.ENGINE, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      this.boostMesh.position.set(0, 0.12, 2.3);
      this.boostMesh.scale.setScalar(1.4);
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
    this._engineCol.setHex(C.ENGINE).lerp(new THREE.Color(C.ENGINE_BOOST), boostFactor * 0.3); // keep the cyan look on boost
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
      for (let i = 0; i < this.nozzles.length; i++) {
        this.fxBatch.write(this.fxBase + i, this.lean.matrixWorld, this.nozzles[i],
          1 + boostFactor * 0.6, flameLen, this._engineCol,
          1 + boostFactor * 0.5, flameLen * 0.62, coreOp);
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

// Batches the AI field's engine flames + cores into two InstancedMeshes instead
// of 4 cone meshes per ship (7 ships -> 28 draws -> 2). Each batched ShipVisual
// claims a slot range and writes its per-nozzle world transform + colour every
// frame, so the result is identical to the per-ship meshes: same cone geometry,
// same additive blend; flame colour via instanceColor, core opacity folded into
// the instance colour (additive: colour·opacity == per-ship opacity). Glows stay
// per-ship sprites; the player ship is never batched.
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
    const zero = new THREE.Matrix4().makeScale(0, 0, 0); // unwritten slots are invisible
    for (const im of [this.flames, this.cores]) {
      im.frustumCulled = false;                          // the field spans the track; no shared bound
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.renderOrder = 1;                                // match the per-ship glow mesh order
      for (let i = 0; i < capacity; i++) im.setMatrixAt(i, zero);
      im.count = 0;                                      // grows as ships claim slots
      scene.add(im);
    }
    this._m = new THREE.Matrix4();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }
  claim(n) { const base = this.used; this.used += n; this.flames.count = this.used; this.cores.count = this.used; return base; }
  // Write one nozzle slot. leanWorld: the ship's lean matrixWorld this frame.
  write(slot, leanWorld, nozzle, flameXY, flameLen, flameCol, coreXY, coreLen, coreOpacity) {
    this._m.compose(nozzle, _IDQ, this._s.set(flameXY, flameXY, flameLen)).premultiply(leanWorld);
    this.flames.setMatrixAt(slot, this._m);
    this.flames.setColorAt(slot, flameCol);
    this._m.compose(nozzle, _IDQ, this._s.set(coreXY, coreXY, coreLen)).premultiply(leanWorld);
    this.cores.setMatrixAt(slot, this._m);
    this.cores.setColorAt(slot, this._c.copy(_CORE_BASE).multiplyScalar(coreOpacity));
  }
  flush() {
    this.flames.instanceMatrix.needsUpdate = true; this.cores.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
    if (this.cores.instanceColor) this.cores.instanceColor.needsUpdate = true;
  }
  dispose(scene) {
    for (const im of [this.flames, this.cores]) { scene.remove(im); im.geometry.dispose(); im.material.dispose(); im.dispose(); }
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

export function buildShipMesh(V = DEFAULT_VARIANT) {
  const group = new THREE.Group();
  const hexa = (cx, w, yT, yM, yB) => [
    [cx - w, yM], [cx - 0.55 * w, yT], [cx + 0.55 * w, yT],
    [cx + w, yM], [cx + 0.55 * w, yB], [cx - 0.55 * w, yB],
  ];
  const diamond = (w, yT, yM, yB) => [[-w, yM], [0, yT], [w, yM], [0, yB]];
  const octa = (cx, cy, r) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };

  const opaque = []; // [geometry, colorHex]
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

  // 3. Canopy.
  opaque.push([loft([
    { z: -0.55, pts: diamond(0.02, 0.20, 0.18, 0.16) },
    { z: 0.05, pts: diamond(0.20, 0.58, 0.42, 0.30) },
    { z: 0.75, pts: diamond(0.16, 0.50, 0.40, 0.32) },
  ], { capEnd: true }), C.SHIP_CANOPY]);

  // 4. Wing bridges.
  both(slab([0.32, 0.12, -0.05], [0.95, 0.12, 0.55], [0.95, 0.10, 1.45], [0.32, 0.12, 0.80], 0.06), V.hull);

  // 5. Deck stripes on the sponson tops.
  both(ribbon([
    [[0.667, 0.192, -1.90], [0.773, 0.192, -1.90]],
    [[0.794, 0.272, -1.00], [0.966, 0.272, -1.00]],
    [[0.901, 0.312, 0.00], [1.099, 0.312, 0.00]],
    [[0.951, 0.352, 1.20], [1.149, 0.352, 1.20]],
  ]), V.accent);

  // 6. Tail fin (scaled per team).
  opaque.push([scaleAround(
    slab([0, 0.42, 0.95], [0, 0.92, 2.25], [0, 0.30, 2.40], [0, 0.32, 1.05], 0.05),
    1, V.finScale, 1, 0, 0.36, 0), V.accent]);

  // 7. Splayed airbrake fins.
  both(slab([1.20, 0.30, 0.95], [1.66, 0.62, 1.75], [1.62, 0.58, 2.15], [1.18, 0.26, 2.05], 0.05), V.accent);

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

  // 16. Fin livery: white panel + dark slash on both faces of the fin.
  for (const sx of [-1, 1]) {
    opaque.push([scaleAround(slab(
      [sx * 0.045, 0.55, 1.30], [sx * 0.045, 0.80, 1.95],
      [sx * 0.045, 0.62, 2.04], [sx * 0.045, 0.45, 1.44], 0.012),
      1, V.finScale, 1, 0, 0.36, 0), V.hull]);
    opaque.push([scaleAround(slab(
      [sx * 0.058, 0.60, 1.52], [sx * 0.058, 0.74, 1.86],
      [sx * 0.058, 0.68, 1.90], [sx * 0.058, 0.55, 1.58], 0.012),
      1, V.finScale, 1, 0, 0.36, 0), C.SHIP_CANOPY]);
  }

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

  const baked = opaque.map(([g, col]) => bakeFlatColors(g, col, { rim: false }));
  const hullGeo = mergeGeoms(baked);
  hullGeo.computeVertexNormals(); // flat per-face normals (non-indexed) for the rim
  const hullMesh = new THREE.Mesh(hullGeo, makeHullMaterial(V.accent));
  group.add(hullMesh);

  // ---- glow set: slot rails, leading-edge strips, fin edge, nozzle discs ----
  const glows = [];
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

  const glowMesh = new THREE.Mesh(mergeGeoms(glows), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  }));
  glowMesh.renderOrder = 1;
  group.add(glowMesh);

  // Team proportions. Applied on the static mesh group (below the lean node),
  // so roll/pitch animation never shears the scaled geometry.
  group.scale.set(V.scaleX, 1, V.scaleZ);
  // Exposed so ShipVisual can drive the boost rim-pulse and clone a reflection.
  group.userData.hullMat = hullMesh.material;
  group.userData.hullGeo = hullGeo;
  group.userData.glowGeo = glowMesh.geometry;
  group.userData.shipScale = [V.scaleX, 1, V.scaleZ];
  return group;
}

// Hull material: baked vertex colours + a view-angle fresnel rim in the team
// accent, so the silhouette catches a light against the busier backgrounds.
function makeHullMaterial(accentHex) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { rimCol: { value: new THREE.Color(accentHex) }, rimStrength: { value: 0.5 }, uBoost: { value: 0 } },
    ]),
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vColor;
      varying vec3 vN;
      varying vec3 vView;
      #include <fog_pars_vertex>
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 rimCol;
      uniform float rimStrength;
      uniform float uBoost;
      varying vec3 vColor;
      varying vec3 vN;
      varying vec3 vView;
      #include <fog_pars_fragment>
      void main() {
        float rim = pow(1.0 - max(dot(normalize(vN), normalize(vView)), 0.0), 2.6);
        // On boost the whole silhouette ignites: rim runs hotter and whitens.
        vec3 rc = mix(rimCol, vec3(1.0), uBoost * 0.4);
        float rs = rimStrength * mix(1.0, 1.5, uBoost);
        vec3 col = vColor + rc * rim * rs;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
    fog: true,
    side: THREE.DoubleSide,
  });
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
