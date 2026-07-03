// Track ribbon, walls, neon edge strips + fake-bloom glow ribbons, boost pad decals.
// No lights: the surface pattern lives in a fragment shader, everything else is
// vertex-colored MeshBasicMaterial. Fog on matte surfaces only — neon pierces the haze.
import * as THREE from 'three';
import { TUNING } from '../config.js';
import { makeFrame } from './spline.js';

export function buildTrackMesh(spline, theme) {
  const group = new THREE.Group();
  const surface = buildSurface(spline, theme);
  group.add(surface.mesh);
  group.add(buildWalls(spline));
  if (spline.splits && spline.splits.length) group.add(buildSplitIslands(spline));
  group.add(buildEdgeStrips(spline));
  group.add(buildGlowRibbons(spline));
  const pads = buildBoostPads(spline);
  group.add(pads.mesh);
  const wpads = spline.weaponPads && spline.weaponPads.length ? buildWeaponPads(spline) : null;
  if (wpads) group.add(wpads.mesh);
  group.matrixAutoUpdate = false;
  // update(t, speedNorm): pads scroll on t; the surface energy spine flows with speed.
  return {
    group,
    update: (t, speed = 0, shipDist = 0, shipLat = 0, glow = 0, engColor = null, nozzleOff = null) => {
      surface.update(t, speed, shipDist, shipLat, glow, engColor, nozzleOff);
      pads.update(t);
      if (wpads) wpads.update(t);
    },
  };
}

function sliceCount(spline) {
  return Math.ceil(spline.length / TUNING.SLICE_STEP);
}

// Iterate cross-sections, handing each frame to cb(i, s, frame).
function eachSlice(spline, cb) {
  const n = sliceCount(spline);
  const f = makeFrame();
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * spline.length;
    spline.frameAt(s, f);
    cb(i, s, f);
  }
  return n;
}

// ---------------------------------------------------------------- surface
function buildSurface(spline, theme) {
  const n = sliceCount(spline);
  const across = 5; // -W, -W/2, 0 (crowned), +W/2, +W
  const pos = new Float32Array((n + 1) * across * 3);
  const lat = new Float32Array((n + 1) * across);   // lateral meters
  const dist = new Float32Array((n + 1) * across);  // s meters
  const wdt = new Float32Array((n + 1) * across);   // half width at slice
  const kap = new Float32Array((n + 1) * across);   // signed curvature at slice
  const v = new THREE.Vector3();

  eachSlice(spline, (i, s, f) => {
    const W = f.width;
    const xs = [-W, -W / 2, 0, W / 2, W];
    const crown = [0, 0.5, 1, 0.5, 0];
    for (let j = 0; j < across; j++) {
      v.copy(f.pos)
        .addScaledVector(f.R, xs[j])
        .addScaledVector(f.U, crown[j] * TUNING.CROWN * W);
      const k = (i * across + j) * 3;
      pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
      lat[i * across + j] = xs[j];
      dist[i * across + j] = s;
      wdt[i * across + j] = W;
      kap[i * across + j] = f.kappa || 0;
    }
  });

  const idx = [];
  for (let i = 0; i < n; i++) {
    if (spline.gapAt(((i + 0.5) / n) * spline.length)) continue; // jump gap
    for (let j = 0; j < across - 1; j++) {
      const a = i * across + j, b = a + across;
      idx.push(a, a + 1, b, a + 1, b + 1, b); // CCW from above (normal = +U)
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('aLat', new THREE.BufferAttribute(lat, 1));
  geom.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
  geom.setAttribute('aWidth', new THREE.BufferAttribute(wdt, 1));
  geom.setAttribute('aKappa', new THREE.BufferAttribute(kap, 1));
  geom.setIndex(idx);

  const C = TUNING.COL;
  // Wet sheen: glossier on water/grid worlds so the neon reflects harder.
  const gloss = (theme.groundStyle === 'water' || theme.groundStyle === 'grid') ? 0.55 : 0.30;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        baseCol: { value: new THREE.Color(theme.trackBase) },
        bandCol: { value: new THREE.Color(theme.trackBand) },
        lineCol: { value: new THREE.Color(C.CENTERLINE) },
        warnCol: { value: new THREE.Color(C.WARNING) },
        edgeL: { value: new THREE.Color(C.EDGE_L) },
        edgeR: { value: new THREE.Color(C.EDGE_R) },
        gloss: { value: gloss },
        trackLen: { value: spline.length },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uShipDist: { value: 0 },   // ship arc-length — engine light-pool centre
        uShipLat: { value: 0 },    // ship lateral offset
        uShipGlow: { value: 0 },   // pool intensity (throttle + boost)
        uNozzleOff: { value: 1.05 }, // lateral offset of each nozzle (matches the hull nozzle x) — two streaks
        engCol: { value: new THREE.Color(C.ENGINE) }, // engine colour (cyan -> white on boost)
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float aLat;
      attribute float aDist;
      attribute float aWidth;
      attribute float aKappa;
      varying float vLat;
      varying float vDist;
      varying float vWidth;
      varying float vKappa;
      #include <fog_pars_vertex>
      void main() {
        vLat = aLat; vDist = aDist; vWidth = aWidth; vKappa = aKappa;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 baseCol, bandCol, lineCol, warnCol, edgeL, edgeR, engCol;
      uniform float trackLen, uTime, uSpeed, gloss, uShipDist, uShipLat, uShipGlow, uNozzleOff;
      varying float vLat;
      varying float vDist;
      varying float vWidth;
      varying float vKappa;
      #include <fog_pars_fragment>
      void main() {
        vec3 col = baseCol;
        // Sector tint: a very subtle base drift across the three thirds of a lap.
        float sector = floor(vDist / max(trackLen / 3.0, 1.0));
        col *= 1.0 + 0.045 * sin(sector * 2.094395 + 1.2);
        // Rhythm bands: 2m band every 8m — the 10Hz strobe at vmax IS the speed.
        float band = step(fract(vDist / 8.0), 0.25);
        col = mix(col, bandCol, band);
        // Expansion joints: a thin dark transverse seam every 12m.
        col *= 1.0 - 0.22 * step(fract(vDist / 12.0), 0.035);
        // Tyre skid: a faint rubbered-in arc on the apex side, only in real corners.
        float corner = smoothstep(0.005, 0.018, abs(vKappa));
        float lane = vLat / max(vWidth, 1.0);
        float skid = corner * smoothstep(0.05, 0.7, lane * -sign(vKappa))
                   * (0.55 + 0.45 * step(fract(vDist / 0.7), 0.5));
        col *= 1.0 - 0.16 * skid;
        // Warning stripes 1m inside each edge.
        float aw = abs(vLat);
        float warn = step(vWidth - 1.2, aw) * step(aw, vWidth - 0.8)
                   * step(fract(vDist / 4.0), 0.55);
        col = mix(col, warnCol, warn * 0.9);
        // Centerline dashes: 3m on / 3m off.
        float dash = step(abs(vLat), 0.16) * step(fract(vDist / 6.0), 0.5);
        col = mix(col, lineCol, dash * 0.85);
        // Energy spine: a glowing core flowing forward along the centre, brighter
        // with speed — sells velocity without any screen shake.
        float core = smoothstep(0.30, 0.0, abs(vLat));
        float flow = 0.45 + 0.55 * sin(vDist * 0.7 - uTime * (5.0 + uSpeed * 22.0));
        // Scan-pulse: discrete light packets racing forward down the spine every
        // ~30m, faster with speed — the velocity read.
        float pp = fract(vDist / 30.0 - uTime * (0.30 + uSpeed * 1.5));
        float pulse = smoothstep(0.0, 0.05, pp) * smoothstep(0.16, 0.05, pp);
        // Fold the steady flow AND the moving pulse into ONE centre-glow term,
        // HARD-CAPPED so the centreline can never blow out to a solid white bar
        // at speed (readability beats spectacle — the road must stay legible).
        float centreGlow = min(0.5, core * (flow * (0.10 + 0.30 * uSpeed) + pulse * (0.10 + 0.28 * uSpeed)));
        col += lineCol * centreGlow;
        // Apex shimmer: a faint amber wash on the OUTSIDE shoulder through corners,
        // hinting the racing line (kept inboard of the edge neon). Reuses corner/lane.
        float outside = smoothstep(0.30, 0.85, lane * sign(vKappa));
        col += warnCol * corner * outside * 0.09;
        // Reflected edge neon on the road — wet sheen, cyan left / magenta right,
        // brightest right at the verge and fading inward.
        float edgeProx = smoothstep(vWidth - 4.5, vWidth - 0.4, abs(vLat));
        vec3 reflCol = vLat < 0.0 ? edgeL : edgeR;
        float shimmer = 0.72 + 0.28 * sin(vDist * 0.5 + uTime * 1.5);
        col += reflCol * edgeProx * edgeProx * gloss * shimmer * 0.5;
        // Engine wake: two streaks trailing the NOZZLES, laid down by the ship's
        // motion — the trail lengthens with speed and a pattern streams backward,
        // so it reads as a wake rather than a glow that toggles on with throttle.
        float ds = uShipDist - vDist;
        ds -= trackLen * floor(ds / trackLen + 0.5);     // wrap to [-len/2, len/2]
        float dN = ds - 2.5;                             // measured from the nozzles (~2.5m behind the origin)
        float wakeLen = 3.0 + uSpeed * 13.0;             // the trail grows with speed (built by motion)
        float poolAlong = smoothstep(wakeLen, 0.3, dN) * smoothstep(-1.4, 0.6, dN);
        float poolFlow = 0.78 + 0.22 * sin(dN * 0.9 - uTime * (5.0 + uSpeed * 20.0)); // streams backward, no full gaps
        // One streak per nozzle, dark gap between (not one blob across the tail).
        float lobeL = smoothstep(0.7, 0.0, abs(vLat - (uShipLat - uNozzleOff)));
        float lobeR = smoothstep(0.7, 0.0, abs(vLat - (uShipLat + uNozzleOff)));
        float pool = poolAlong * poolFlow * max(lobeL, lobeR) * uShipGlow;
        col += engCol * pool * (0.6 + 0.5 * gloss);
        // Start/finish checker band across the first 4 meters.
        if (vDist < 4.0 || vDist > trackLen - 0.5) {
          float checker = mod(floor(vLat / 1.0) + floor(vDist / 1.0), 2.0);
          col = mix(vec3(0.06, 0.04, 0.12), vec3(0.92), checker);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
    fog: true,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const update = (t, speed, shipDist = 0, shipLat = 0, glow = 0, engColor = null, nozzleOff = null) => {
    mat.uniforms.uTime.value = t;
    mat.uniforms.uSpeed.value = Math.max(0, Math.min(1, speed || 0));
    mat.uniforms.uShipDist.value = shipDist;
    mat.uniforms.uShipLat.value = shipLat;
    mat.uniforms.uShipGlow.value = glow;
    if (engColor) mat.uniforms.engCol.value.copy(engColor);
    if (nozzleOff != null) mat.uniforms.uNozzleOff.value = nozzleOff; // align road wake to the player hull's nozzle x
  };
  return { mesh, update };
}

// ---------------------------------------------------------------- walls
function buildWalls(spline) {
  const n = sliceCount(spline);
  const pos = new Float32Array((n + 1) * 4 * 3);
  const col = new Float32Array((n + 1) * 4 * 3);
  const v = new THREE.Vector3();
  const lean = Math.tan(TUNING.WALL_LEAN) * TUNING.WALL_HEIGHT;
  const cWall = new THREE.Color(TUNING.COL.WALL);
  const cWallLit = new THREE.Color(TUNING.COL.WALL).multiplyScalar(2.2);

  eachSlice(spline, (i, s, f) => {
    const W = f.width;
    // 4 verts: L bottom, L top, R bottom, R top.
    const defs = [
      [-W, -0.3, 0], [-(W + lean), TUNING.WALL_HEIGHT, 1],
      [W, -0.3, 0], [W + lean, TUNING.WALL_HEIGHT, 1],
    ];
    for (let j = 0; j < 4; j++) {
      v.copy(f.pos).addScaledVector(f.R, defs[j][0]).addScaledVector(f.U, defs[j][1]);
      const k = (i * 4 + j) * 3;
      pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
      const c = defs[j][2] ? cWallLit : cWall;
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  });

  const idx = [];
  for (let i = 0; i < n; i++) {
    if (spline.gapAt(((i + 0.5) / n) * spline.length)) continue; // jump gap
    const a = i * 4, b = a + 4;
    idx.push(a, a + 1, b, b, a + 1, b + 1);       // left wall (faces inward)
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // right wall
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geom.setIndex(idx);

  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    vertexColors: true, fog: true, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ----------------------------------------------------- split islands
// A raised central divider that follows the baked split band (wedge nose ->
// hold -> wedge tail), splitting the road into TWO bordered lanes. A low dark
// median caps in hot-yellow, and each lane gets its own neon lip — magenta on
// the left lane's right edge, cyan on the right lane's left edge — so it reads
// as two roads, not one obstacle. Matte body + additive-free neon, two meshes.
function buildSplitIslands(spline) {
  const group = new THREE.Group();
  group.add(buildIslandBody(spline));
  group.add(buildIslandNeon(spline));
  group.matrixAutoUpdate = false;
  return group;
}

function buildIslandBody(spline) {
  const positions = [], colors = [], idx = [];
  const v = new THREE.Vector3();
  const H = 0.8; // low median, not a wall — you read over it to the far lane
  const cSide = new THREE.Color(TUNING.COL.WALL).multiplyScalar(1.4);
  const cCap = new THREE.Color(TUNING.COL.WARNING);
  const f = makeFrame();
  for (const sp of spline.splits) {
    const segs = Math.max(2, Math.ceil(sp.span / TUNING.SLICE_STEP));
    const base = positions.length / 3;
    for (let i = 0; i <= segs; i++) {
      const s = sp.s0 + (i / segs) * sp.span;
      spline.frameAt(s, f);
      const h = Math.max(0.05, spline.splitHalfAt(s));
      // 4 verts: left base, left cap, right cap, right base.
      const defs = [[-h, 0, cSide], [-h, H, cCap], [h, H, cCap], [h, 0, cSide]];
      for (const [x, y, c] of defs) {
        v.copy(f.pos).addScaledVector(f.R, x).addScaledVector(f.U, y + 0.04);
        positions.push(v.x, v.y, v.z);
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 4, b = a + 4;
      idx.push(a, a + 1, b, b, a + 1, b + 1);             // left face
      idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2); // cap
      idx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3); // right face
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geom.setIndex(idx);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    vertexColors: true, fog: true, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// Glowing rails along the top lips of the median — colored to each lane's edge
// language so the player instantly reads "two roads". fog:false, like the
// track-edge neon, so it telegraphs the fork through the haze.
function buildIslandNeon(spline) {
  const positions = [], colors = [], idx = [];
  const v = new THREE.Vector3();
  const cL = new THREE.Color(TUNING.COL.EDGE_L); // cyan — left edge of the right lane
  const cR = new THREE.Color(TUNING.COL.EDGE_R); // magenta — right edge of the left lane
  const f = makeFrame();
  const Y = 0.86; // along the top lip, just above the cap
  for (const sp of spline.splits) {
    const segs = Math.max(2, Math.ceil(sp.span / TUNING.SLICE_STEP));
    const base = positions.length / 3;
    for (let i = 0; i <= segs; i++) {
      const s = sp.s0 + (i / segs) * sp.span;
      spline.frameAt(s, f);
      const h = Math.max(0.05, spline.splitHalfAt(s));
      const defs = [
        [-h - 0.18, -h + 0.06, cR], // left lip (magenta)
        [h - 0.06, h + 0.18, cL],   // right lip (cyan)
      ];
      for (const [x0, x1, c] of defs) {
        for (let e = 0; e < 2; e++) {
          v.copy(f.pos).addScaledVector(f.R, e ? x1 : x0).addScaledVector(f.U, Y);
          positions.push(v.x, v.y, v.z);
          colors.push(c.r, c.g, c.b);
        }
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < 2; j++) {
        const a = base + (i * 2 + j) * 2, b = a + 4;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geom.setIndex(idx);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    vertexColors: true, fog: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ------------------------------------------------------- neon edge strips
// Surface edge strips + wall-top strips, cyan left / magenta right.
// fog:false on purpose — WipEout neon pierces the sunset haze and telegraphs corners.
function buildEdgeStrips(spline) {
  const n = sliceCount(spline);
  const strips = 4; // surface L, surface R, wall-top L, wall-top R
  const pos = new Float32Array((n + 1) * strips * 2 * 3);
  const col = new Float32Array((n + 1) * strips * 2 * 3);
  const v = new THREE.Vector3();
  const lean = Math.tan(TUNING.WALL_LEAN) * TUNING.WALL_HEIGHT;
  const cl = new THREE.Color(TUNING.COL.EDGE_L);
  const cr = new THREE.Color(TUNING.COL.EDGE_R);

  eachSlice(spline, (i, s, f) => {
    const W = f.width;
    const defs = [
      // [x0, x1, y, color]
      [-(W - 0.05), -(W - 0.38), 0.02, cl],
      [W - 0.38, W - 0.05, 0.02, cr],
      [-(W + lean) - 0.06, -(W + lean) + 0.1, TUNING.WALL_HEIGHT + 0.02, cl],
      [(W + lean) - 0.1, (W + lean) + 0.06, TUNING.WALL_HEIGHT + 0.02, cr],
    ];
    for (let j = 0; j < strips; j++) {
      const [x0, x1, y, c] = defs[j];
      for (let e = 0; e < 2; e++) {
        v.copy(f.pos).addScaledVector(f.R, e ? x1 : x0).addScaledVector(f.U, y);
        const k = ((i * strips + j) * 2 + e) * 3;
        pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
  });

  const idx = [];
  for (let i = 0; i < n; i++) {
    if (spline.gapAt(((i + 0.5) / n) * spline.length)) continue; // jump gap
    for (let j = 0; j < strips; j++) {
      const a = (i * strips + j) * 2, b = a + strips * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geom.setIndex(idx);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    vertexColors: true, fog: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ------------------------------------------------------ fake-bloom ribbons
// A 3x wider additive ribbon under each neon strip, alpha falling off across
// the width. Two triangles per segment buy "WipEout glow" without a bloom pass.
function buildGlowRibbons(spline) {
  const n = sliceCount(spline);
  const ribbons = 2; // surface edges L/R (wall tops share the wash)
  const across = 3;  // alpha 0 / peak / 0
  const pos = new Float32Array((n + 1) * ribbons * across * 3);
  const col = new Float32Array((n + 1) * ribbons * across * 4);
  const v = new THREE.Vector3();
  const cl = new THREE.Color(TUNING.COL.EDGE_L);
  const cr = new THREE.Color(TUNING.COL.EDGE_R);
  const HALF = 0.65;

  eachSlice(spline, (i, s, f) => {
    const W = f.width;
    const defs = [
      [-(W - 0.22), cl],
      [W - 0.22, cr],
    ];
    for (let j = 0; j < ribbons; j++) {
      const [cx, c] = defs[j];
      for (let e = 0; e < across; e++) {
        const x = cx + (e - 1) * HALF;
        v.copy(f.pos).addScaledVector(f.R, x).addScaledVector(f.U, 0.015);
        const k = ((i * ribbons + j) * across + e) * 3;
        pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
        const k4 = ((i * ribbons + j) * across + e) * 4;
        col[k4] = c.r; col[k4 + 1] = c.g; col[k4 + 2] = c.b;
        col[k4 + 3] = e === 1 ? 0.35 : 0.0;
      }
    }
  });

  const idx = [];
  for (let i = 0; i < n; i++) {
    if (spline.gapAt(((i + 0.5) / n) * spline.length)) continue; // jump gap
    for (let j = 0; j < ribbons; j++) {
      for (let e = 0; e < across - 1; e++) {
        const a = (i * ribbons + j) * across + e, b = a + ribbons * across;
        idx.push(a, a + 1, b, a + 1, b + 1, b); // CCW from above
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geom.setIndex(idx);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 2;
  return mesh;
}

// ------------------------------------------------------------- boost pads
// 6x4m decals conformed to the surface. Chevrons scroll toward the player and
// a brightness pulse chases along the track. One merged geometry, one draw call.
function buildBoostPads(spline) {
  const C = TUNING.COL;
  const f = makeFrame();
  const v = new THREE.Vector3();
  const positions = [], locals = [], phases = [], idx = [];
  const LEN = 6, HW = 2, SLICES = 6;

  for (const pad of spline.pads) {
    const base = positions.length / 3;
    for (let i = 0; i <= SLICES; i++) {
      const s = pad.s - LEN / 2 + (i / SLICES) * LEN;
      spline.frameAt(s, f);
      for (let e = 0; e < 2; e++) {
        const x = pad.d + (e ? HW : -HW);
        // Follow the surface crown ((1 - |x|/W) * CROWN * W, same profile as
        // buildSurface) or the decal sinks under the road near the camera.
        const crownH = Math.max(0, 1 - Math.abs(x) / f.width) * TUNING.CROWN * f.width;
        v.copy(f.pos).addScaledVector(f.R, x).addScaledVector(f.U, crownH + 0.05);
        positions.push(v.x, v.y, v.z);
        locals.push(e ? 1 : 0, i / SLICES);
        phases.push(pad.s * 0.5);
      }
    }
    for (let i = 0; i < SLICES; i++) {
      const a = base + i * 2, b = a + 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b); // CCW from above
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('aLocal', new THREE.BufferAttribute(new Float32Array(locals), 2));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(phases), 1));
  geom.setIndex(idx);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseCol: { value: new THREE.Color(C.PAD_BASE) },
      chevCol: { value: new THREE.Color(C.PAD_CHEVRON) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aLocal;
      attribute float aPhase;
      varying vec2 vLocal;
      varying float vPhase;
      void main() {
        vLocal = aLocal; vPhase = aPhase;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 baseCol, chevCol;
      varying vec2 vLocal;
      varying float vPhase;
      void main() {
        float x = vLocal.x * 2.0 - 1.0;       // -1..1 across
        float y = vLocal.y * 6.0;             // meters along
        // Forward-pointing chevrons scrolling toward the player at 3 u/s.
        float c = fract((y + abs(x) * 1.4 + time * 3.0) / 1.5);
        float chev = smoothstep(0.62, 0.5, c) * smoothstep(0.2, 0.32, c);
        float pulse = 0.6 + 0.4 * sin(4.0 * time - vPhase);
        float edge = smoothstep(1.0, 0.85, abs(x));
        vec3 col = baseCol + chevCol * chev * pulse * 1.6;
        gl_FragColor = vec4(col * edge, 1.0);
      }
    `,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { mesh, update: (t) => { mat.uniforms.time.value = t; } };
}

// ----------------------------------------------------------- weapon pads
// Gold pickup decals — gameplay language, never theme-tinted, and visually a
// different VERB from boost: a pulsing diamond reticle you "collect", not
// chevrons you "ride". Same merged-geometry pattern: one draw call total.
function buildWeaponPads(spline) {
  const C = TUNING.COL;
  const f = makeFrame();
  const v = new THREE.Vector3();
  const positions = [], locals = [], phases = [], idx = [];
  const LEN = 6, HW = 2, SLICES = 6;

  for (const pad of spline.weaponPads) {
    const base = positions.length / 3;
    for (let i = 0; i <= SLICES; i++) {
      const s = pad.s - LEN / 2 + (i / SLICES) * LEN;
      spline.frameAt(s, f);
      for (let e = 0; e < 2; e++) {
        const x = pad.d + (e ? HW : -HW);
        const crownH = Math.max(0, 1 - Math.abs(x) / f.width) * TUNING.CROWN * f.width;
        v.copy(f.pos).addScaledVector(f.R, x).addScaledVector(f.U, crownH + 0.05);
        positions.push(v.x, v.y, v.z);
        locals.push(e ? 1 : 0, i / SLICES);
        phases.push(pad.s * 0.5);
      }
    }
    for (let i = 0; i < SLICES; i++) {
      const a = base + i * 2, b = a + 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b); // CCW from above
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('aLocal', new THREE.BufferAttribute(new Float32Array(locals), 2));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(phases), 1));
  geom.setIndex(idx);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseCol: { value: new THREE.Color(C.WEAPON_PAD_BASE) },
      glowCol: { value: new THREE.Color(C.WEAPON_PAD_GLOW) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aLocal;
      attribute float aPhase;
      varying vec2 vLocal;
      varying float vPhase;
      void main() {
        vLocal = aLocal; vPhase = aPhase;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 baseCol, glowCol;
      varying vec2 vLocal;
      varying float vPhase;
      void main() {
        // Centered coords: x -1..1 across, y -1..1 along the 6m decal.
        float x = vLocal.x * 2.0 - 1.0;
        float y = vLocal.y * 2.0 - 1.0;
        // Diamond reticle: a ring at |x|+|y| = r, breathing outward, over a
        // constant gold wash so the pad reads clearly at distance.
        float dia = abs(x) + abs(y) * 1.15;
        float breathe = 0.55 + 0.18 * sin(3.2 * time - vPhase);
        float ring = smoothstep(0.2, 0.06, abs(dia - breathe));
        float core = smoothstep(0.3, 0.0, dia) * (0.7 + 0.3 * sin(6.0 * time - vPhase));
        float frame = smoothstep(0.12, 0.02, abs(max(abs(x), abs(y)) - 0.92)); // thin outer border
        float edge = smoothstep(1.0, 0.85, abs(x));
        vec3 col = baseCol * 1.5 + glowCol * (0.22 + ring * 1.7 + core * 1.2 + frame * 0.8);
        gl_FragColor = vec4(col * edge, 1.0);
      }
    `,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { mesh, update: (t) => { mat.uniforms.time.value = t; } };
}
