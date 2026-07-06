// Catmull-Rom -> arc-length LUT -> parallel-transport frames -> frameAt(s).
// frameAt is THE contract: physics, mesh, camera, particles and (later) AI all consume it.
import * as THREE from 'three';
import { TUNING } from '../config.js';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class TrackSpline {
  constructor(trackData) {
    // Expand any {type:'loop'} features into real control points up front, so
    // the rest of the pipeline (frames, bank, width, pads, other stunts) just
    // sees a longer point list. All cp-indexed data is remapped in one place.
    const ex = this._expandLoops(trackData);
    const pts = ex.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();

    const step = TUNING.LUT_STEP;
    const n = Math.ceil(this.length / step);
    this.n = n;
    this.step = this.length / n;

    this.pos = new Float32Array(n * 3);
    this.tan = new Float32Array(n * 3);
    this.up = new Float32Array(n * 3);
    this.right = new Float32Array(n * 3);
    this.kappa = new Float32Array(n);
    this.bank = new Float32Array(n);
    this.width = new Float32Array(n);

    this._buildSamples();
    this._buildFrames();
    this._buildCurvature();
    this._buildBankAndWidth(ex);
    this._buildStunts(ex); // corkscrew bank overrides + jump gaps
    this._applyBank();

    this.pads = this._padList(ex.points.length, ex.boostPads);
    this.weaponPads = this._padList(ex.points.length, ex.weaponPads, true); // clamp to keep the decal on-track
    this.splits = this._buildSplits(ex);
  }

  // Resolve {from,to (cp), gap, fast} splits to arc length and bake a per-sample
  // central-island half-width (splitBand) with a wedge nose at each end so the
  // road separates smoothly — no lateral snap. Physics reads it via scalarsAt;
  // the mesh reads splitHalfAt for the island geometry.
  _buildSplits(td) {
    this.splitBand = new Float32Array(this.n);
    const RAMP = 18; // metres of wedge at each end — a long, easy nose to pick a lane
    const splits = (td.splits || []).map((sp) => {
      const s0 = this._sAt(sp.from);
      const s1 = this._sAt(sp.to);
      const span = (s1 - s0 + this.length) % this.length || this.length;
      const gap = sp.gap ?? 4.5;
      const ramp = Math.min(RAMP, span / 2);
      for (let i = 0; i < this.n; i++) {
        const ds = (i * this.step - s0 + this.length) % this.length;
        if (ds > span) continue;
        const wedge = Math.min(1, ds / ramp, (span - ds) / ramp);
        this.splitBand[i] = Math.max(this.splitBand[i], gap * wedge);
      }
      return { s0: this.wrap(s0), s1: this.wrap(s1), span, gap, fast: sp.fast ?? 1 };
    });
    return splits;
  }

  // Interpolated central-island half-width at arc length s (0 = no island).
  splitHalfAt(s) {
    s = this.wrap(s);
    const f = s / this.step;
    const i0 = Math.floor(f) % this.n;
    const i1 = (i0 + 1) % this.n;
    const t = f - Math.floor(f);
    return this.splitBand[i0] * (1 - t) + this.splitBand[i1] * t;
  }

  // Turn {type:'loop', cp, dir, radius, twist} features into 6 inserted control
  // points (a vertical circle in the direction of travel, drifted sideways so
  // the exit clears the entry — exactly the hand-authored loops on Coral Keys /
  // Skyline Rush, but generated). Returns a trackData-shaped object with the
  // points expanded and every other cp index (pads, corkscrews, jumps) shifted.
  _expandLoops(td) {
    const loops = (td.features || []).filter((f) => f.type === 'loop');
    const others = (td.features || []).filter((f) => f.type !== 'loop');
    if (!loops.length) {
      return { points: td.points, boostPads: td.boostPads || [], weaponPads: td.weaponPads || [], features: others, splits: td.splits || [] };
    }
    const anchors = loops.map((l) => Math.round(l.cp)).sort((a, b) => a - b);
    const points = [];
    for (let i = 0; i < td.points.length; i++) {
      points.push(td.points[i]);
      const loop = loops.find((l) => Math.round(l.cp) === i);
      if (loop) for (const p of this._loopPoints(td.points, i, loop)) points.push(p);
    }
    // Any cp reference past an anchor shifts by +6 per loop inserted before it.
    const remap = (r) => r + 6 * anchors.filter((k) => k < r).length;
    const boostPads = (td.boostPads || []).map((p) => ({ ...p, cp: remap(p.cp) }));
    const weaponPads = (td.weaponPads || []).map((p) => ({ ...p, cp: remap(p.cp) }));
    const features = others.map((f) =>
      f.from !== undefined
        ? { ...f, from: remap(f.from), to: remap(f.to) }
        : { ...f, cp: remap(f.cp) },
    );
    const splits = (td.splits || []).map((s) => ({ ...s, from: remap(s.from), to: remap(s.to) }));
    return { points, boostPads, weaponPads, features, splits };
  }

  // The 6 control points after the loop's anchor (the anchor itself is the
  // entry at the bottom). Matches the proven Coral/Skyline shape: ±0.875·R
  // forward bulge, 2·R total height, `twist` of sideways drift across the loop.
  _loopPoints(pts, k, loop) {
    const E = pts[k];
    const next = pts[(k + 1) % pts.length];
    let fx = next.x - E.x, fz = next.z - E.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    const sx = -fz, sz = fx;                 // right, in the ground plane
    const R = loop.radius ?? 40;
    const twist = (loop.twist ?? 30) * (loop.dir ?? 1);
    const W = loop.width ?? 13;
    const tpl = [
      { f: 0.875, u: 0.25, s: 1 / 6 },
      { f: 0.875, u: 0.75, s: 2 / 6 },
      { f: 0, u: 1.0, s: 3 / 6 },
      { f: -0.875, u: 0.75, s: 4 / 6 },
      { f: -0.875, u: 0.25, s: 5 / 6 },
      { f: 0, u: 0, s: 1 },
    ];
    return tpl.map((t) => ({
      x: E.x + t.f * R * fx + t.s * twist * sx,
      y: E.y + t.u * 2 * R,
      z: E.z + t.f * R * fz + t.s * twist * sz,
      width: W,
    }));
  }

  // Convert a fractional control-point index to arc length s.
  _sAt(cp) {
    const sa = this._sAtCP;
    const m = sa.length - 1;
    const j = Math.floor(cp) % m;
    const f = cp - Math.floor(cp);
    return sa[j] * (1 - f) + sa[j + 1] * f;
  }

  // Parse trackData.features: corkscrews overlay a full barrel-roll on bank;
  // jumps mark a mesh gap + a takeoff that the physics launches off.
  _buildStunts(trackData) {
    this.gaps = [];   // [{start, end}] — mesh omits slices here, physics is airborne
    this.jumps = [];  // [{takeoff, end, lift}]
    for (const f of trackData.features || []) {
      if (f.type === 'corkscrew') {
        // Add a 0 -> turns*2π sweep on top of the auto-bank over [from,to].
        // Start and end add 0 (mod 2π), so it blends cleanly with the corners.
        const s0 = this._sAt(f.from);
        const s1 = this._sAt(f.to);
        const span = (s1 - s0 + this.length) % this.length || this.length;
        const total = (f.turns ?? 1) * Math.PI * 2 * (f.dir ?? 1);
        for (let i = 0; i < this.n; i++) {
          const ds = (i * this.step - s0 + this.length) % this.length;
          if (ds <= span) this.bank[i] += total * (ds / span);
        }
      } else if (f.type === 'jump') {
        const takeoff = this._sAt(f.cp);
        const end = takeoff + (f.gap ?? 24);
        this.gaps.push({ start: takeoff, end });
        this.jumps.push({ takeoff, end, lift: f.lift ?? 12 });
      }
    }
  }

  // Returns the gap an arc-length sits inside, or null. (Gaps don't wrap the
  // start line, so a plain range test is safe.)
  gapAt(s) {
    s = this.wrap(s);
    for (const g of this.gaps) if (s >= g.start && s <= g.end) return g;
    return null;
  }

  _buildSamples() {
    const { n } = this;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).normalize();
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.tan.set([t.x, t.y, t.z], i * 3);
    }
  }

  _buildFrames() {
    const { n } = this;
    // Parallel transport an up vector along the loop.
    const ups = [];
    let up = new THREE.Vector3(0, 1, 0);
    const t0 = this._vec(this.tan, 0, new THREE.Vector3());
    up.addScaledVector(t0, -up.dot(t0)).normalize();
    ups.push(up.clone());
    const prevT = t0.clone();
    const curT = new THREE.Vector3();
    for (let i = 1; i < n; i++) {
      this._vec(this.tan, i, curT);
      _q.setFromUnitVectors(prevT, curT);
      up.applyQuaternion(_q);
      up.addScaledVector(curT, -up.dot(curT)).normalize();
      ups.push(up.clone());
      prevT.copy(curT);
    }
    // Closed-loop twist residual: transport once more back to sample 0 and
    // measure the angle error around the tangent, then unwind it gradually.
    const upEnd = ups[n - 1].clone();
    this._vec(this.tan, 0, curT);
    _q.setFromUnitVectors(prevT, curT);
    upEnd.applyQuaternion(_q);
    upEnd.addScaledVector(curT, -upEnd.dot(curT)).normalize();
    const ref = ups[0];
    const cross = _v.crossVectors(upEnd, ref);
    let err = Math.atan2(cross.dot(curT), upEnd.dot(ref));
    for (let i = 0; i < n; i++) {
      const t = this._vec(this.tan, i, curT);
      ups[i].applyAxisAngle(t, (err * i) / n).normalize();
      const r = new THREE.Vector3().crossVectors(t, ups[i]).normalize(); // T x U points right
      this.up.set([ups[i].x, ups[i].y, ups[i].z], i * 3);
      this.right.set([r.x, r.y, r.z], i * 3);
    }
  }

  _buildCurvature() {
    const { n } = this;
    // Signed horizontal curvature: kappa > 0 = left turn.
    const raw = new Float32Array(n);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this._vec(this.tan, i, a);
      this._vec(this.tan, (i + 1) % n, b);
      a.y = 0; b.y = 0;
      const la = a.length(), lb = b.length();
      if (la < 1e-4 || lb < 1e-4) { raw[i] = 0; continue; }
      a.divideScalar(la); b.divideScalar(lb);
      const crossY = a.z * b.x - a.x * b.z; // >0 = turning left
      // Weight by how horizontal the track is: inside a vertical loop the
      // horizontal tangent shrinks and flips direction, which would read as
      // an infinitely tight corner (and obliterate speed via scrub). A loop
      // is NOT a corner.
      const horiz = THREE.MathUtils.smoothstep(Math.min(la, lb), 0.45, 0.85);
      raw[i] = (Math.asin(THREE.MathUtils.clamp(crossY, -1, 1)) / this.step) * horiz;
    }
    boxSmooth(raw, this.kappa, Math.round(TUNING.KAPPA_SMOOTH / this.step));
  }

  _buildBankAndWidth(trackData) {
    const { n } = this;
    const g = TUNING.GRAVITY;
    const v2 = TUNING.BANK_V_DESIGN * TUNING.BANK_V_DESIGN;
    const rawBank = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const b = TUNING.BANK_FACTOR * Math.atan((v2 * this.kappa[i]) / g);
      rawBank[i] = THREE.MathUtils.clamp(b, -TUNING.BANK_MAX, TUNING.BANK_MAX);
    }
    boxSmooth(rawBank, this.bank, Math.round(TUNING.BANK_SMOOTH / this.step / 2));

    // Width: interpolate control-point widths via the curve's u->length mapping.
    const cps = trackData.points;
    const m = cps.length;
    const divisions = 400;
    const lengths = this.curve.getLengths(divisions); // cumulative length at uniform t
    const sAtCP = new Float32Array(m + 1);
    for (let j = 0; j <= m; j++) {
      const t = j / m;
      const ti = Math.min(Math.floor(t * divisions), divisions - 1);
      const f = t * divisions - ti;
      sAtCP[j] = lengths[ti] * (1 - f) + lengths[ti + 1] * f;
    }
    this._sAtCP = sAtCP;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.step;
      while (j < m - 0 && sAtCP[j + 1] < s) j++;
      const jj = Math.min(j, m - 1);
      const span = Math.max(1e-3, sAtCP[jj + 1] - sAtCP[jj]);
      const f = THREE.MathUtils.clamp((s - sAtCP[jj]) / span, 0, 1);
      const w0 = cps[jj].width ?? 16;
      const w1 = cps[(jj + 1) % m].width ?? 16;
      this.width[i] = (w0 * (1 - f) + w1 * f) / 2; // store HALF width
    }
  }

  _applyBank() {
    // Rotate up/right around the tangent by the bank angle.
    // bank > 0 lifts the right edge (correct for a left turn).
    const { n } = this;
    const t = new THREE.Vector3(), u = new THREE.Vector3(), r = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const phi = this.bank[i];
      if (Math.abs(phi) < 1e-5) continue;
      this._vec(this.up, i, u);
      this._vec(this.right, i, r);
      const c = Math.cos(phi), s = Math.sin(phi);
      const r2x = r.x * c + u.x * s, r2y = r.y * c + u.y * s, r2z = r.z * c + u.z * s;
      const u2x = u.x * c - r.x * s, u2y = u.y * c - r.y * s, u2z = u.z * c - r.z * s;
      this.right.set([r2x, r2y, r2z], i * 3);
      this.up.set([u2x, u2y, u2z], i * 3);
    }
  }

  // Convert {cp: float control-point index, d} pads to {s, d} (boost + weapon).
  _padList(m, list, clampToFit) {
    return (list || []).map((p, idx) => {
      const j = Math.floor(p.cp) % m;
      const f = p.cp - Math.floor(p.cp);
      const s = (this._sAtCP[j] * (1 - f) + this._sAtCP[j + 1] * f) % this.length;
      let d = p.d ?? 0;
      if (clampToFit) {
        // Keep the whole 4m-wide decal inside the road at this s (width is HALF
        // width; the decal reaches HW=2 either side of d, + a small margin).
        const i = Math.min(this.n - 1, Math.max(0, Math.floor(s / this.step)));
        const maxD = Math.max(0, this.width[i] - 2 - 0.4);
        d = Math.max(-maxD, Math.min(maxD, d));
      }
      return { id: idx, s, d };
    });
  }

  _vec(arr, i, out) {
    return out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
  }

  wrap(s) {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }

  // Writes the interpolated frame at arc length s into `out`:
  // { pos, T, R, U: Vector3, kappa, bank, width (half), slope }.
  frameAt(s, out) {
    s = this.wrap(s);
    const f = s / this.step;
    const i0 = Math.floor(f) % this.n;
    const i1 = (i0 + 1) % this.n;
    const t = f - Math.floor(f);
    lerp3(this.pos, i0, i1, t, out.pos);
    lerp3(this.tan, i0, i1, t, out.T); out.T.normalize();
    lerp3(this.up, i0, i1, t, out.U); out.U.normalize();
    lerp3(this.right, i0, i1, t, out.R); out.R.normalize();
    out.kappa = this.kappa[i0] * (1 - t) + this.kappa[i1] * t;
    out.bank = this.bank[i0] * (1 - t) + this.bank[i1] * t;
    out.width = this.width[i0] * (1 - t) + this.width[i1] * t;
    out.slope = out.T.y;
    return out;
  }

  // Scalar-only frame query for the (three.js-free) physics module.
  scalarsAt(s, out) {
    s = this.wrap(s);
    const f = s / this.step;
    const i0 = Math.floor(f) % this.n;
    const i1 = (i0 + 1) % this.n;
    const t = f - Math.floor(f);
    out.kappa = this.kappa[i0] * (1 - t) + this.kappa[i1] * t;
    out.bank = this.bank[i0] * (1 - t) + this.bank[i1] * t;
    out.width = this.width[i0] * (1 - t) + this.width[i1] * t;
    out.slope = this.tan[i0 * 3 + 1] * (1 - t) + this.tan[i1 * 3 + 1] * t;
    out.splitHalf = this.splitBand[i0] * (1 - t) + this.splitBand[i1] * t;
    return out;
  }

  // Curvature of the path toward the frame's up vector, per meter of s.
  // Positive = track curving toward +U (a dip, or anywhere inside a loop);
  // negative = curving away (a crest). This is what the hover spring follows —
  // measured in the track frame, NOT world Y, so vertical loops behave:
  // inside a loop the path always curves toward +U and the ship stays pinned.
  verticalCurvAt(s) {
    s = this.wrap(s);
    const i0 = Math.floor(s / this.step) % this.n;
    const i1 = (i0 + 1) % this.n;
    const dTx = this.tan[i1 * 3] - this.tan[i0 * 3];
    const dTy = this.tan[i1 * 3 + 1] - this.tan[i0 * 3 + 1];
    const dTz = this.tan[i1 * 3 + 2] - this.tan[i0 * 3 + 2];
    return (dTx * this.up[i0 * 3] + dTy * this.up[i0 * 3 + 1] + dTz * this.up[i0 * 3 + 2])
      / this.step;
  }
}

export function makeFrame() {
  return {
    pos: new THREE.Vector3(),
    T: new THREE.Vector3(),
    R: new THREE.Vector3(),
    U: new THREE.Vector3(),
    kappa: 0, bank: 0, width: 8, slope: 0,
  };
}

function lerp3(arr, i0, i1, t, out) {
  out.set(
    arr[i0 * 3] * (1 - t) + arr[i1 * 3] * t,
    arr[i0 * 3 + 1] * (1 - t) + arr[i1 * 3 + 1] * t,
    arr[i0 * 3 + 2] * (1 - t) + arr[i1 * 3 + 2] * t,
  );
}

// Circular box blur, run twice for a gaussian-ish kernel.
function boxSmooth(src, dst, radius) {
  const n = src.length;
  if (radius <= 0) { dst.set(src); return; }
  const tmp = new Float32Array(n);
  pass(src, tmp); pass(tmp, dst);
  function pass(a, b) {
    let sum = 0;
    const w = radius * 2 + 1;
    for (let i = -radius; i <= radius; i++) sum += a[(i + n) % n];
    for (let i = 0; i < n; i++) {
      b[i] = sum / w;
      sum -= a[(i - radius + n) % n];
      sum += a[(i + radius + 1) % n];
    }
  }
}
