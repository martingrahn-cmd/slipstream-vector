// Sky dome (gradient + striped synthwave sun + stars + clouds, all in-shader),
// ground, far mountain silhouettes, instanced mesas, neon pylons, holo arches,
// start gantry. No lights anywhere: quantized vertex-color bake.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TUNING } from '../config.js';
import { makeFrame } from './spline.js';
import { buildBillboardAtlas } from '../ui/logos.js';

let _adAtlas = null; // built once, shared across tracks
function adAtlas() { return _adAtlas || (_adAtlas = buildBillboardAtlas()); }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUN_DIR = new THREE.Vector3(...TUNING.SUN_DIR).normalize();

// The bake tints are theme-dependent; buildScenery sets them before building.
let BAKE_RIM = TUNING.COL.MESA_RIM;
let BAKE_SHADOW_TINT = TUNING.COL.GROUND;
let BAKE_WARM = 0xffd9a0;
export function setBakeTheme(rimHex, shadowTintHex, warmHex) {
  BAKE_RIM = rimHex;
  BAKE_SHADOW_TINT = shadowTintHex;
  BAKE_WARM = warmHex ?? 0xffd9a0;
}

// Quantized 3-step flat-shade bake — the Horizon Chase tell.
// Returns a non-indexed geometry with baked vertex colors.
export function bakeFlatColors(geometry, baseColorHex, opts = {}) {
  const geom = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geom.getAttribute('position');
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const base = new THREE.Color(baseColorHex);
  const lit = (opts.lit ? new THREE.Color(opts.lit) : base.clone().lerp(new THREE.Color(BAKE_WARM), 0.22));
  const mid = base.clone();
  const shadow = (opts.shadow ? new THREE.Color(opts.shadow) : base.clone().multiplyScalar(0.5).lerp(new THREE.Color(BAKE_SHADOW_TINT), 0.25));
  const rim = new THREE.Color(BAKE_RIM);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const l = n.dot(SUN_DIR);
    let col = l > 0.45 ? lit : l > 0.0 ? mid : shadow;
    // Warm rim on steep sun-facing faces.
    if (l > 0.6 && Math.abs(n.y) < 0.45 && opts.rim !== false) {
      col = col.clone().lerp(rim, 0.35);
    }
    for (let j = 0; j < 3; j++) {
      colors[(i + j) * 3] = col.r;
      colors[(i + j) * 3 + 1] = col.g;
      colors[(i + j) * 3 + 2] = col.b;
    }
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.deleteAttribute('normal');
  geom.deleteAttribute('uv');
  return geom;
}

export function buildScenery(spline, scene, theme) {
  const rng = mulberry32(1337);
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  setBakeTheme(theme.mesaRim, theme.ground, theme.warm);

  // Track bounds for placement. The ground must clear the LOWEST point of the
  // banked track edge (a 32-degree bank drops the low edge ~5m below the
  // centerline), plus the wall skirt that extends 0.3m below the surface.
  let minEdge = Infinity, cx = 0, cz = 0;
  for (let i = 0; i < spline.n; i++) {
    const y = spline.pos[i * 3 + 1];
    const ry = Math.abs(spline.right[i * 3 + 1]);
    minEdge = Math.min(minEdge, y - ry * spline.width[i] - 0.35);
    cx += spline.pos[i * 3]; cz += spline.pos[i * 3 + 2];
  }
  cx /= spline.n; cz /= spline.n;
  const groundY = minEdge - 0.8;

  const CITY_ANG = theme.city ? 0.12 : null; // mountains keep clear of the skyline

  const sky = buildSky(theme.sky);
  scene.add(sky.mesh);
  const ground = buildGround(groundY, cx, cz, theme);
  group.add(ground.mesh);
  group.add(buildFarMountains(rng, groundY, cx, cz, spline, CITY_ANG, theme));
  group.add(buildMesas(rng, spline, groundY, theme));
  group.add(...buildPylons(spline));
  const rings = buildHoloRings(spline);
  group.add(rings.mesh);
  const arches = buildArches(spline, theme);
  if (arches) group.add(arches.group);
  group.add(buildGantry(spline, groundY));
  if (theme.rockCount) group.add(buildRocks(rng, spline, groundY, theme));
  if (theme.scrubCount) group.add(buildScrub(rng, spline, groundY, theme));
  if (theme.flora && theme.floraCount) group.add(buildFlora(rng, spline, groundY, theme));
  group.add(buildBillboards(rng, spline, groundY, theme.billboardEvery ?? 220, theme.adGlow ?? 0));
  const canyon = theme.canyon ? buildCanyon(rng, spline, groundY, theme) : null;
  if (canyon) group.add(canyon.group);
  if (theme.sprawl) group.add(buildSprawl(rng, spline, groundY, theme));
  if (theme.overheads) group.add(buildOverheads(spline));
  const traffic = theme.traffic ? buildTraffic(rng, spline, groundY, cx, cz) : null;
  if (traffic) group.add(traffic.mesh);
  if (theme.city) group.add(buildCity(rng, groundY, cx, cz, CITY_ANG));
  const lights = theme.searchlights ? buildSearchlights(rng, spline, groundY) : null;
  if (lights) group.add(lights.group);
  const drones = theme.drones ? buildDrones(rng, spline, theme) : null;
  if (drones) group.add(drones.mesh);
  const motes = theme.ambient ? buildMotes(rng, spline, theme) : null;
  if (motes) group.add(motes.mesh);
  const skyCars = theme.skyTraffic ? buildSkyTraffic(rng, cx, cz, groundY) : null;
  if (skyCars) group.add(skyCars.mesh);
  const bridges = theme.bridges ? buildBridges(rng, spline, groundY, theme) : null;
  if (bridges) group.add(bridges.group);
  const birds = theme.birds ? buildBirds(rng, spline, groundY) : null;
  if (birds) group.add(birds.mesh);

  let flash = 0;
  const stormy = theme.ambient && theme.ambient.mode === 'rain';
  return {
    group,
    sky: sky.mesh,
    update(t, cameraPos, raceProgress = 0) {
      sky.mesh.position.copy(cameraPos);
      sky.mat.uniforms.time.value = t;
      sky.mat.uniforms.progress.value = raceProgress;
      if (stormy) {
        flash *= 0.86;                                 // decay the last strike
        if (Math.random() < 0.004) flash = 1;          // ~occasional lightning
        sky.mat.uniforms.flash.value = flash;
      }
      rings.update(t);
      if (arches) arches.update(t);
      if (ground.mat) {
        ground.mat.uniforms.time.value = t;
        if (ground.mat.uniforms.uCam) ground.mat.uniforms.uCam.value.copy(cameraPos);
      }
      if (lights) lights.update(t);
      if (canyon) canyon.update(t);
      if (traffic) traffic.update(t);
      if (drones) drones.update(t);
      if (motes) motes.update(t);
      if (skyCars) skyCars.update(t);
      if (bridges) bridges.update(t);
      if (birds) birds.update(t);
    },
  };
}

// -------------------------------------------------------------------- sky
function buildSky(S) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      zenith: { value: new THREE.Color(S.zenith) },
      upper: { value: new THREE.Color(S.upper) },
      band: { value: new THREE.Color(S.band) },
      horizon: { value: new THREE.Color(S.horizon) },
      hot: { value: new THREE.Color(S.hot) },
      sunCore: { value: new THREE.Color(S.sunCore) },
      sunStripe: { value: new THREE.Color(S.sunStripe) },
      cloud: { value: new THREE.Color(S.cloud) },
      sunAzimuth: { value: new THREE.Vector3(-0.35, 0, -0.94).normalize() },
      sunSize: { value: S.sunSize },
      sunStripes: { value: S.sunStripes },
      starLevel: { value: S.starLevel },
      cloudAmp: { value: S.cloudAmp },
      cloudPuff: { value: S.cloudPuff ?? 1.0 },
      progress: { value: 0 },   // 0..1 race progress — mood drifts over the laps
      flash: { value: 0 },      // lightning flash (city storms)
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time, sunSize, sunStripes, starLevel, cloudAmp, cloudPuff, progress, flash;
      uniform vec3 zenith, upper, band, horizon, hot, sunCore, sunStripe, cloud;
      uniform vec3 sunAzimuth;
      varying vec3 vDir;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        // 4-stop vertical gradient.
        vec3 col = horizon;
        col = mix(col, hot, smoothstep(-0.02, 0.015, y) * (1.0 - smoothstep(0.015, 0.06, y)));
        col = mix(col, band, smoothstep(0.03, 0.16, y));
        col = mix(col, upper, smoothstep(0.14, 0.38, y));
        col = mix(col, zenith, smoothstep(0.35, 0.7, y));
        // Below the horizon: fade down to deep ground haze.
        col = mix(col, zenith * 0.7 + horizon * 0.15, smoothstep(-0.02, -0.25, y));
        // The sun/moon disc — sinks toward the horizon as the race goes on.
        float sunY = mix(0.07, -0.03, progress);
        vec3 sunDir = normalize(vec3(sunAzimuth.x, sunY, sunAzimuth.z));
        float ang = acos(clamp(dot(d, sunDir), -1.0, 1.0));
        float disc = 1.0 - smoothstep(sunSize - 0.015, sunSize, ang);
        if (disc > 0.0) {
          // Horizontal cut lines on the lower half, widening downward.
          float stripe = step(mix(0.55, 0.2, smoothstep(0.08, -0.04, y)), fract(y * 55.0));
          float stripeZone = smoothstep(0.085, 0.045, y) * sunStripes;
          vec3 sun = mix(sunCore, sunStripe, smoothstep(0.10, -0.02, y) * max(sunStripes, 0.35));
          float mask = mix(1.0, stripe, stripeZone);
          col = mix(col, sun, disc * mask);
          col += sun * disc * 0.12;
        }
        // Soft glow around the sun.
        col += sunCore * 0.18 * (1.0 - smoothstep(0.0, 0.55, ang));
        // God-rays: faint shafts fanning out from the sun (sunny worlds only).
        float rayAz = atan(d.y - sunDir.y, d.x - sunDir.x);
        float shafts = pow(0.5 + 0.5 * sin(rayAz * 22.0 + time * 0.08), 2.0);
        col += sunCore * shafts * (1.0 - smoothstep(0.0, 0.5, ang)) * 0.12 * sunStripes;
        // Stars above the horizon band.
        if (y > 0.18) {
          vec2 cell = vec2(atan(d.x, d.z) * 28.0, y * 60.0);
          vec2 id = floor(cell);
          float h = hash(id);
          if (h > starLevel) {
            vec2 f = fract(cell) - 0.5;
            float star = 1.0 - smoothstep(0.02, 0.09, length(f));
            float tw = 0.7 + 0.3 * sin(time * 2.0 + h * 40.0);
            col += vec3(0.9, 0.9, 1.0) * star * tw * smoothstep(0.18, 0.3, y);
          }
        }
        // Drifting bands: thin dusk streaks (puff=1) up to fat cumulus banks
        // or smog (puff>2) — width and lobe frequency scale together.
        float az = atan(d.x, d.z);
        float c1 = exp(-pow((y - 0.085) * 60.0 / cloudPuff, 2.0)) * (0.4 + 0.6 * sin(az * 3.0 / cloudPuff + time * 0.05));
        float c2 = exp(-pow((y - 0.16) * 40.0 / cloudPuff, 2.0)) * (0.4 + 0.6 * sin(az * 5.0 / cloudPuff - time * 0.04 + 2.0));
        float c3 = exp(-pow((y - 0.30) * 30.0 / cloudPuff, 2.0)) * (0.3 + 0.7 * sin(az * 7.0 / cloudPuff + time * 0.07 + 4.0));
        col = mix(col, cloud, clamp(c1 + c2 + c3 * step(0.4, cloudAmp), 0.0, 1.0) * cloudAmp);
        // Time-of-day mood drift: the world deepens as the race progresses.
        col *= mix(1.0, 0.78, progress);
        // Lightning flash (city storms): a brief cool brightening of the sky.
        col += vec3(0.55, 0.62, 0.85) * flash * smoothstep(-0.15, 0.5, y);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(900, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, mat };
}

// ----------------------------------------------------------------- ground
// 'dunes' = banded desert sand with grain; 'water' = animated lagoon with
// wave bands and sun glints; 'grid' = night asphalt with a glowing street
// grid; 'flat' = plain color.
function buildGround(groundY, cx, cz, theme) {
  const geom = new THREE.CircleGeometry(1600, 48);
  geom.rotateX(-Math.PI / 2);
  let mat = null;
  let mesh;
  if (theme.groundStyle === 'dunes') {
    mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          colA: { value: new THREE.Color(theme.ground) },
          colB: { value: new THREE.Color(theme.groundB ?? theme.ground) },
        },
      ]),
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vXZ = wp.xz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 colA, colB;
        varying vec2 vXZ;
        #include <fog_pars_fragment>
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        void main() {
          // Long wind-combed dune bands, two interfering directions.
          float d1 = sin(vXZ.x * 0.011 + sin(vXZ.y * 0.007) * 2.4);
          float d2 = sin((vXZ.x * 0.55 + vXZ.y) * 0.016 + 1.7);
          float band = smoothstep(-0.6, 1.0, d1 * 0.6 + d2 * 0.4);
          vec3 col = mix(colA, colB, band * 0.55);
          // Coarse grain so the surface never reads as a flat fill.
          float g = hash(floor(vXZ * 0.9));
          col += (g - 0.5) * 0.035;
          // Sparse darker scrub blotches.
          float blotch = hash(floor(vXZ * 0.045));
          col = mix(col, colA * 0.72, step(0.82, blotch) * 0.5);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }
      `,
      fog: true,
    });
    mesh = new THREE.Mesh(geom, mat);
    mat = null; // static — nothing to animate per frame
  } else if (theme.groundStyle === 'water' || theme.groundStyle === 'grid') {
    const water = theme.groundStyle === 'water';
    mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          time: { value: 0 },
          colA: { value: new THREE.Color(theme.ground) },
          colB: { value: new THREE.Color(water ? theme.waterB : theme.gridGlow) },
          uCam: { value: new THREE.Vector3() },
          uSunAz: { value: new THREE.Vector2(-0.35, -0.94).normalize() }, // matches the sky sun
        },
      ]),
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vXZ = wp.xz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: water ? /* glsl */ `
        uniform float time;
        uniform vec3 colA, colB;
        uniform vec3 uCam;
        uniform vec2 uSunAz;
        varying vec2 vXZ;
        #include <fog_pars_fragment>
        void main() {
          // Two drifting wave systems make banded low-poly water.
          float w1 = sin(vXZ.x * 0.045 + time * 0.6 + sin(vXZ.y * 0.03) * 2.0);
          float w2 = sin(vXZ.y * 0.055 - time * 0.45 + sin(vXZ.x * 0.02) * 1.5);
          float band = step(0.45, fract((w1 + w2) * 0.22 + time * 0.04));
          vec3 col = mix(colA, colB, band * 0.55);
          // Sun-road: a shimmering specular band from the camera toward the
          // horizon sun, so sea and sky belong to the same world.
          vec2 toP = vXZ - uCam.xz;
          float along = dot(toP, uSunAz);                          // + = toward the sun
          float perp = abs(toP.x * uSunAz.y - toP.y * uSunAz.x);   // distance from the sun line
          float roadW = 4.0 + max(along, 0.0) * 0.06;              // widens toward the horizon
          float road = smoothstep(roadW, 0.0, perp) * smoothstep(0.0, 50.0, along);
          float shimmer = 0.55 + 0.45 * sin(along * 0.5 - time * 3.0) * sin(perp * 0.8 + time * 2.0);
          col += vec3(1.0, 0.95, 0.78) * road * shimmer * 0.6;
          // Faint scattered glitter elsewhere.
          float g = sin(vXZ.x * 0.9 + time * 1.9) * sin(vXZ.y * 1.1 - time * 1.4);
          col += vec3(1.0, 0.96, 0.8) * smoothstep(0.985, 1.0, g) * 0.18;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }
      ` : /* glsl */ `
        uniform float time;
        uniform vec3 colA, colB;
        varying vec2 vXZ;
        #include <fog_pars_fragment>
        void main() {
          vec3 col = colA;
          // Street grid shining through the asphalt, gently pulsing.
          float dx = abs(fract(vXZ.x / 64.0 + 0.5) - 0.5) * 64.0;
          float dz = abs(fract(vXZ.y / 64.0 + 0.5) - 0.5) * 64.0;
          float line = max(smoothstep(1.1, 0.0, dx), smoothstep(1.1, 0.0, dz));
          float pulse = 0.65 + 0.35 * sin(time * 0.8 + (vXZ.x + vXZ.y) * 0.01);
          col += colB * line * 0.22 * pulse;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }
      `,
      fog: true,
    });
    mesh = new THREE.Mesh(geom, mat);
  } else {
    mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color: theme.ground, fog: true,
    }));
  }
  mesh.position.set(cx, groundY, cz);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, mat };
}

// ---------------------------------------------------------- far mountains
function buildFarMountains(rng, groundY, cx, cz, spline, cityAng = null, theme) {
  const geoms = [];
  const count = theme.farCount ?? 30;
  const lowWide = theme.id === 'tropic'; // distant isles, not a mountain wall
  // A mountain footprint may not reach the track: push it outward until the
  // base circle clears every track sample by a margin.
  const clearOfTrack = (px, pz, radius) => {
    const need = (radius + 30) ** 2;
    for (let i = 0; i < spline.n; i += 16) {
      const dx = spline.pos[i * 3] - px, dz = spline.pos[i * 3 + 2] - pz;
      if (dx * dx + dz * dz < need) return false;
    }
    return true;
  };
  const towers = theme.mountainStyle === 'towers';
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rng() * 0.15;
    // Leave a window for the city skyline.
    if (cityAng !== null
      && Math.abs(Math.atan2(Math.sin(ang - cityAng), Math.cos(ang - cityAng))) < 0.42) continue;
    let r = 560 + rng() * 90;
    const h = towers ? 90 + rng() * 160 : lowWide ? 35 + rng() * 60 : 70 + rng() * 130;
    const w = towers ? 35 + rng() * 55 : lowWide ? 90 + rng() * 130 : 60 + rng() * 90;
    let px = cx + Math.cos(ang) * r, pz = cz + Math.sin(ang) * r;
    for (let push = 0; push < 8 && !clearOfTrack(px, pz, w); push++) {
      r += 45;
      px = cx + Math.cos(ang) * r;
      pz = cz + Math.sin(ang) * r;
    }
    const g = towers
      ? new THREE.BoxGeometry(w, h, w * (0.6 + rng() * 0.7))
      : new THREE.ConeGeometry(w, h, 4 + Math.floor(rng() * 3), 1);
    g.rotateY(rng() * Math.PI); // rotate around its own axis BEFORE placing
    g.translate(px, groundY + h / 2 - 2, pz);
    geoms.push(bakeFlatColors(g, theme.mountainFar, { rim: false }));
  }
  // A second, paler ridge ring further out: atmospheric perspective (colour
  // lerped toward the sky horizon) gives the horizon two depth-separated
  // silhouettes instead of one cardboard wall. Merged into the SAME mesh.
  const farCol = new THREE.Color(theme.mountainFar)
    .lerp(new THREE.Color(theme.sky.horizon), 0.55).getHex();
  const ringN = Math.round(count * 0.7);
  for (let i = 0; i < ringN; i++) {
    const ang = (i / ringN) * Math.PI * 2 + rng() * 0.3 + 0.2; // offset so it peeks between the near ridge
    if (cityAng !== null
      && Math.abs(Math.atan2(Math.sin(ang - cityAng), Math.cos(ang - cityAng))) < 0.5) continue;
    const r = 920 + rng() * 170;
    const h = (towers ? 80 + rng() * 140 : lowWide ? 30 + rng() * 50 : 60 + rng() * 110) * 0.7;
    const w = (towers ? 40 + rng() * 60 : lowWide ? 100 + rng() * 140 : 70 + rng() * 100) * 1.1;
    const px = cx + Math.cos(ang) * r, pz = cz + Math.sin(ang) * r;
    const g = towers
      ? new THREE.BoxGeometry(w, h, w * (0.6 + rng() * 0.7))
      : new THREE.ConeGeometry(w, h, 4 + Math.floor(rng() * 3), 1);
    g.rotateY(rng() * Math.PI);
    g.translate(px, groundY + h / 2 - 2, pz);
    geoms.push(bakeFlatColors(g, farCol, { rim: false }));
  }
  const merged = mergeGeoms(geoms);
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ------------------------------------------------------------------ mesas
// Rock spires in the wilderness worlds; tower blocks (with glowing window
// columns) in the city. Same scatterer, different archetypes.
function buildMesas(rng, spline, groundY, theme) {
  const towers = theme.mesaStyle === 'towers';
  const islands = theme.mesaStyle === 'islands';
  // [factory, unit height, half-depth of the +z face]
  const archetypes = towers ? [
    [() => new THREE.BoxGeometry(1, 2.4, 1), 2.4, 0.5],
    [() => new THREE.BoxGeometry(1.3, 1.6, 0.9), 1.6, 0.45],
    [() => new THREE.BoxGeometry(0.7, 3.2, 0.7), 3.2, 0.35],
    [() => new THREE.BoxGeometry(1.1, 1.0, 1.1), 1.0, 0.55],
    [() => new THREE.CylinderGeometry(0.5, 0.5, 2.8, 6), 2.8, 0.5],
  ] : islands ? [
    [() => { const g = new THREE.IcosahedronGeometry(1, 1); g.scale(1, 0.42, 1); return g; }, 0.84, 0], // jungle dome
    [() => new THREE.ConeGeometry(1, 0.55, 6), 0.55, 0],        // low hill
    [() => new THREE.CylinderGeometry(0.55, 1, 0.4, 7), 0.4, 0],// flat atoll
  ] : [
    [() => new THREE.ConeGeometry(1, 2.2, 4), 2.2, 0],          // pyramid spire
    [() => new THREE.CylinderGeometry(0.55, 1, 1.4, 6), 1.4, 0],// frustum mesa
    [() => new THREE.CylinderGeometry(0.18, 0.42, 3.2, 5), 3.2, 0], // needle
    [() => new THREE.BoxGeometry(1.4, 1.1, 1), 1.1, 0],         // block
    [() => new THREE.CylinderGeometry(0.9, 1.05, 0.7, 7), 0.7, 0],  // flat-top
  ];
  const geoms = [];
  const glows = [];
  const winA = new THREE.Color(TUNING.COL.EDGE_L);   // cyan
  const winB = new THREE.Color(TUNING.COL.EDGE_R);   // magenta
  const winC = new THREE.Color(0xffd9a0);            // warm
  const winW = [new THREE.Color(0xffb15a), new THREE.Color(0xff7e3c), new THREE.Color(0xfff0d0)]; // warm spread
  // Warm-dominant office-window picker (a little cyan/magenta neon mixed in).
  const winPick = () => { const r = rng(); return r < 0.40 ? winC : r < 0.58 ? winW[0] : r < 0.70 ? winW[1] : r < 0.80 ? winW[2] : r < 0.90 ? winA : winB; };
  // A dense grid of OPAQUE lit window cells over a tower's four faces, built in
  // the archetype's UNIT space (from its bbox) so it can be scaled/rotated/
  // translated exactly like the tower. Opaque so the windows read crisply over
  // the bright magenta facade instead of washing out the way additive would.
  const mesaWindows = (ub, sc, ysc) => {
    const hx = (ub.max.x - ub.min.x) / 2, hz = (ub.max.z - ub.min.z) / 2, y0 = ub.min.y, y1 = ub.max.y, uh = y1 - y0;
    if (hx < 0.05 || hz < 0.05 || uh < 0.05) return null;
    const P = [], C = [];
    const quad = (ax, ay, az, ux, uy, uz, vx, vy, vz, col) => {
      P.push(ax, ay, az, ax + ux, ay + uy, az + uz, ax + ux + vx, ay + uy + vy, az + uz + vz,
        ax, ay, az, ax + ux + vx, ay + uy + vy, az + uz + vz, ax + vx, ay + vy, az + vz);
      for (let k = 0; k < 6; k++) C.push(col.r, col.g, col.b);
    };
    const rows = Math.max(4, Math.round(uh * sc * ysc / 8));
    const cuh = uh / rows, winUh = cuh * 0.62, eps = 0.02;
    for (const face of [0, 1, 2, 3]) {
      const onX = face < 2, sign = face % 2 ? 1 : -1;
      const halfOut = onX ? hx : hz, halfSpan = onX ? hz : hx;
      const nc = Math.max(2, Math.round(halfSpan * 2 * sc / 7));
      const cuw = (halfSpan * 2) / nc, winUw = cuw * 0.6;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < nc; c++) {
          if (rng() > 0.6) continue;
          const cyU = y0 + (r + 0.5) * cuh - winUh / 2, ctU = -halfSpan + (c + 0.5) * cuw - winUw / 2;
          const col = winPick();
          if (onX) quad(sign * (halfOut + eps), cyU, ctU, 0, winUh, 0, 0, 0, winUw, col);
          else quad(ctU, cyU, sign * (halfOut + eps), winUw, 0, 0, 0, winUh, 0, col);
        }
      }
    }
    if (!P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    return g;
  };
  const f = makeFrame();
  const tries = 600, placed = [];
  const MAX = theme.mesaMax ?? 150;
  for (let t = 0; t < tries && geoms.length < MAX; t++) {
    const s = rng() * spline.length;
    spline.frameAt(s, f);
    const side = rng() < 0.5 ? -1 : 1;
    const dist = 35 + rng() * 215;
    const px = f.pos.x + f.R.x * side * dist + (rng() - 0.5) * 30;
    const pz = f.pos.z + f.R.z * side * dist + (rng() - 0.5) * 30;
    // The clearance must include the mesa's own footprint: archetype base
    // radii are ~1 unit, so the world-space radius is ~scale meters.
    const scale = towers ? 8 + rng() * 26 : 10 + rng() * 42;
    const clearance = scale + 24;
    let ok = true;
    for (let i = 0; i < spline.n; i += 12) {
      const dx = spline.pos[i * 3] - px, dz = spline.pos[i * 3 + 2] - pz;
      if (dx * dx + dz * dz < clearance * clearance) { ok = false; break; }
    }
    if (!ok) continue;
    // Poisson-ish: keep mesas apart (footprint-aware).
    for (const p of placed) {
      const dx = p[0] - px, dz = p[1] - pz;
      const minGap = 26 + (scale + p[2]) * 0.45;
      if (dx * dx + dz * dz < minGap * minGap) { ok = false; break; }
    }
    if (!ok) continue;
    placed.push([px, pz, scale]);
    const [make, unitH, faceZ] = archetypes[Math.floor(rng() * archetypes.length)];
    const ys = towers ? 0.9 + rng() * 1.3 : islands ? 0.7 + rng() * 0.45 : 0.7 + rng() * 0.6;
    const ry = rng() * Math.PI * 2;
    const g = make();
    const ub = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position')); // unit bbox for the window grid
    g.scale(scale, scale * ys, scale);
    g.rotateY(ry);
    const box = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position'));
    // Islands sit half-sunk in the lagoon; everything else stands on the ground.
    const ty = islands
      ? groundY - box.min.y - scale * ys * 0.3
      : groundY - box.min.y - 0.5;
    g.translate(px, ty, pz);
    const colorPick = rng();
    const base = colorPick < 0.6 ? theme.mesaLit : theme.mesaShadow;
    geoms.push(bakeFlatColors(g, base, { shadow: theme.mesaShadow }));
    if (islands) {
      // A beach ring at the waterline.
      const beach = new THREE.CylinderGeometry(scale * 1.12, scale * 1.22, 0.6, 8);
      beach.rotateY(rng() * Math.PI);
      beach.translate(px, groundY + 0.25, pz);
      geoms.push(bakeFlatColors(beach, theme.sand, { rim: false }));
    }
    if (towers) {
      // Dense lit window GRID over the facades, transformed exactly like the
      // tower. Opaque (in the building mesh) so it reads over the magenta.
      const wg = mesaWindows(ub, scale, ys);
      if (wg) { wg.scale(scale, scale * ys, scale); wg.rotateY(ry); wg.translate(px, ty, pz); geoms.push(wg); }
    }
  }
  const out = new THREE.Group();
  out.add(new THREE.Mesh(mergeGeoms(geoms), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide })));
  if (glows.length) {
    const glowMesh = new THREE.Mesh(mergeGeoms(glows), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glowMesh.renderOrder = 1;
    out.add(glowMesh);
  }
  out.traverse((o) => { o.frustumCulled = false; o.matrixAutoUpdate = false; });
  return out;
}

// ----------------------------------------------------------------- pylons
// Pairs every 25m, 1.5m outside each wall, neon-tipped. The cheapest geometry
// in the game and the strongest peripheral speed cue that exists.
function buildPylons(spline) {
  const count = Math.floor(spline.length / TUNING.PYLON_SPACING);
  const f = makeFrame();
  const body = new THREE.InstancedMesh(
    bakeFlatColors(new THREE.ConeGeometry(0.35, 2.2, 4), 0x1a0d33),
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
    count * 2,
  );
  const tip = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.22),
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.95, fog: false,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    count * 2,
  );
  const m = new THREE.Matrix4();
  const cl = new THREE.Color(TUNING.COL.EDGE_L);
  const cr = new THREE.Color(TUNING.COL.EDGE_R);
  const v = new THREE.Vector3();
  let i = 0;
  for (let k = 0; k < count; k++) {
    const s = k * TUNING.PYLON_SPACING;
    spline.frameAt(s, f);
    for (const side of [-1, 1]) {
      const off = f.width + TUNING.PYLON_OFFSET;
      v.copy(f.pos).addScaledVector(f.R, side * off);
      m.makeTranslation(v.x, v.y + 1.0, v.z);
      body.setMatrixAt(i, m);
      m.makeTranslation(v.x, v.y + 2.35, v.z);
      tip.setMatrixAt(i, m);
      tip.setColorAt(i, side < 0 ? cl : cr);
      i++;
    }
  }
  body.instanceMatrix.needsUpdate = true;
  tip.instanceMatrix.needsUpdate = true;
  if (tip.instanceColor) tip.instanceColor.needsUpdate = true;
  body.frustumCulled = false; tip.frustumCulled = false;
  body.matrixAutoUpdate = false; tip.matrixAutoUpdate = false;
  return [body, tip];
}

// ------------------------------------------------------------- holo rings
// Additive cyan gate arches over straights — a forward target rushing at you.
// Each is a torus ARC whose legs land just outside the walls; radius scales
// with the local track width so the gate always frames the road.
function buildHoloRings(spline) {
  const f = makeFrame();
  const positions = [];
  let lastS = -TUNING.RING_SPACING;
  for (let s = 0; s < spline.length; s += 10) {
    spline.frameAt(s, f);
    const flatEnough = Math.abs(spline.verticalCurvAt(s)) < 0.0012;
    if (Math.abs(f.kappa) < TUNING.RING_KAPPA_MAX && flatEnough
      && s - lastS >= TUNING.RING_SPACING) {
      positions.push(s);
      lastS = s;
    }
  }
  const mat = new THREE.MeshBasicMaterial({
    color: TUNING.COL.EDGE_L, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  });
  // Unit torus arc with the below-deck segment cut away. Center height is
  // 0.45r, so the legs hit y=0 at x = +-0.893r — just outside the walls when
  // r = halfwidth + 2.5.
  const LIFT = 0.45;
  const cut = Math.asin(LIFT);
  const geom = new THREE.TorusGeometry(1, 0.032, 6, 40, Math.PI + 2 * cut);
  geom.rotateZ(-cut);
  const mesh = new THREE.InstancedMesh(geom, mat, positions.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  positions.forEach((s, i) => {
    spline.frameAt(s, f);
    const r = f.width + 2.5;
    v.copy(f.pos).addScaledVector(f.U, LIFT * r);
    m.makeBasis(f.R, f.U, f.T.clone().negate());
    q.setFromRotationMatrix(m);
    sc.setScalar(r);
    m.compose(v, q, sc);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { mesh, update: (t) => { mat.opacity = 0.4 + 0.12 * Math.sin(t * 3); } };
}

// Ribbed arches over LONG flat straights — vertical enclosure plus a light/dark
// strobe as you pass under. Matte ribs (baked) + a neon lip, both instanced
// (+2 draws). Gated on theme.archMax; placed only on sustained straights.
function buildArches(spline, theme) {
  if (!theme.archMax) return null;
  const f = makeFrame();
  const MIN_RUN = 46, SPACING = 5.5, EDGE = 8;
  const runs = [];
  let start = null;
  for (let s = 0; s <= spline.length; s += 4) {
    spline.frameAt(s, f);
    const ok = Math.abs(f.kappa) < 0.004 && Math.abs(spline.verticalCurvAt(s)) < 0.0010;
    if (ok && start === null) start = s;
    else if (!ok && start !== null) { if (s - start >= MIN_RUN) runs.push([start, s]); start = null; }
  }
  if (start !== null && spline.length - start >= MIN_RUN) runs.push([start, spline.length]);
  const positions = [];
  for (const [a, b] of runs) {
    for (let s = a + EDGE; s <= b - EDGE && positions.length < theme.archMax; s += SPACING) positions.push(s);
    if (positions.length >= theme.archMax) break;
  }
  if (!positions.length) return null;

  const LIFT = 0.5, cut = Math.asin(LIFT);
  const ribGeo = new THREE.TorusGeometry(1, 0.14, 6, 26, Math.PI + 2 * cut);
  ribGeo.rotateZ(-cut);
  const ribMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide });
  const ribMesh = new THREE.InstancedMesh(bakeFlatColors(ribGeo, theme.mesaShadow ?? 0x201838, { rim: false }), ribMat, positions.length);
  const lipGeo = new THREE.TorusGeometry(1.045, 0.035, 5, 28, Math.PI + 2 * cut);
  lipGeo.rotateZ(-cut);
  const lipMat = new THREE.MeshBasicMaterial({
    color: theme.mesaRim ?? TUNING.COL.EDGE_L, transparent: true, opacity: 0.62,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const lipMesh = new THREE.InstancedMesh(lipGeo, lipMat, positions.length);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  positions.forEach((s, i) => {
    spline.frameAt(s, f);
    const r = f.width + 2.2;
    v.copy(f.pos).addScaledVector(f.U, LIFT * r);
    m.makeBasis(f.R, f.U, f.T.clone().negate());
    q.setFromRotationMatrix(m);
    sc.setScalar(r);
    m.compose(v, q, sc);
    ribMesh.setMatrixAt(i, m); lipMesh.setMatrixAt(i, m);
  });
  ribMesh.instanceMatrix.needsUpdate = true; lipMesh.instanceMatrix.needsUpdate = true;
  ribMesh.frustumCulled = false; lipMesh.frustumCulled = false;
  ribMesh.matrixAutoUpdate = false; lipMesh.matrixAutoUpdate = false;
  const group = new THREE.Group();
  group.add(ribMesh, lipMesh);
  group.matrixAutoUpdate = false;
  return { group, update: (t) => { lipMat.opacity = 0.5 + 0.18 * Math.sin(t * 2.2); } };
}

// ----------------------------------------------------------- start gantry
// Paint every vertex of a geometry one flat colour (for merged emissive parts).
function tintGeo(geometry, hex) {
  const geom = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = geom.getAttribute('position').count;
  const c = new THREE.Color(hex);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.deleteAttribute('normal');
  geom.deleteAttribute('uv');
  return geom;
}

// Concatenate non-indexed position+color geometries into one (no new imports).
function mergeColored(geoms) {
  let total = 0;
  for (const g of geoms) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geoms) {
    const p = g.getAttribute('position'), c = g.getAttribute('color');
    pos.set(p.array, o * 3); col.set(c.array, o * 3);
    o += p.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return m;
}

// Start/finish gantry: stepped towers + gusset braces, a deep beam with a top
// rail, neon strips up the inner faces (cyan left / magenta right, echoing the
// track edges) and a checkered start/finish band facing the oncoming cars.
// Built in a local frame (x = right, y = up, z = travel) and oriented once.
function buildGantry(spline, groundY) {
  const f = makeFrame();
  spline.frameAt(0, f);
  const g = new THREE.Group();
  const W = f.width;                 // half road width
  const PX = W + 2.4;                // tower centre, just outside the edge
  const SPAN = 2 * PX + 4;           // beam length across the road
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // --- dark structure: legs/footings, columns, caps, braces, beam, top rail ---
  const dark = [];
  // The gate stands vertically (world up) at the centreline height, but the
  // ground beside the road sits lower — and lower still when the start line is
  // sloped/banked or elevated. Drop the legs to the ground plane (capped so a
  // crest start doesn't grow absurd stilts) so the feet are always planted.
  const legBottom = Math.max(groundY - f.pos.y, -7) - 0.4;
  for (const s of [-1, 1]) {
    const px = s * PX;
    const legTop = 2.6;
    dark.push(box(2.2, legTop - legBottom, 2.4).translate(px, (legTop + legBottom) / 2, 0)); // leg to ground
    dark.push(box(4.4, 1.4, 4.4).translate(px, legBottom + 0.7, 0));                          // footing
    dark.push(box(2.0, 9.8, 2.4).translate(px, 7.2, 0));         // column
    dark.push(box(3.2, 1.0, 3.4).translate(px, 12.4, 0));        // cap
    dark.push(box(4.4, 0.8, 1.2).rotateZ(s * 0.6).translate(px - s * 2.1, 11.2, 0)); // gusset brace
  }
  dark.push(box(SPAN, 2.0, 2.6).translate(0, 13.4, 0));          // beam
  dark.push(box(SPAN + 0.6, 0.6, 3.1).translate(0, 14.6, 0));    // top rail
  // A lighter banner panel on the approach face gives the checker a surface.
  const panel = bakeFlatColors(box(SPAN - 1.0, 1.7, 0.16).translate(0, 13.4, -1.42), 0x2c1f58);
  const structure = new THREE.Mesh(
    mergeColored([...dark.map((b) => bakeFlatColors(b, 0x180d34)), panel]),
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
  );

  // --- neon (all additive, so it reads against the dark sky): column strips,
  // cap beacons, a lit cyan/magenta frame, and a checkered start/finish band of
  // bright squares over the dark banner panel (the gaps show the panel). ---
  const CY = TUNING.COL.EDGE_L, MG = TUNING.COL.EDGE_R;
  const neon = [];
  for (const s of [-1, 1]) {
    const col = s < 0 ? CY : MG;
    neon.push(tintGeo(box(0.45, 9.6, 0.5).translate(s * (PX - 1.1), 7.2, -1.25), col)); // strip up inner face
    neon.push(tintGeo(box(1.0, 0.5, 1.0).translate(s * PX, 13.0, 0), col));             // beacon on the cap
  }
  // Cyan/magenta split, meeting over the centreline — top and underside edges,
  // front and back, so the gate reads as a lit frame from either approach.
  for (const [y, z] of [[12.35, -1.32], [12.35, 1.32], [14.45, -1.32], [14.45, 1.32]]) {
    neon.push(tintGeo(box(SPAN / 2, 0.34, 0.4).translate(-SPAN / 4, y, z), CY));
    neon.push(tintGeo(box(SPAN / 2, 0.34, 0.4).translate(SPAN / 4, y, z), MG));
  }
  const N = 12, segW = (SPAN - 1.4) / N;
  for (let i = 0; i < N; i++) {
    const x = -(SPAN - 1.4) / 2 + (i + 0.5) * segW;
    for (let r = 0; r < 2; r++) {
      if ((i + r) % 2) continue; // gaps show the dark banner panel behind
      neon.push(tintGeo(box(segW * 0.9, 0.82, 0.2).translate(x, 13.4 + (r ? -0.46 : 0.46), -1.55), 0xffffff));
    }
  }
  const glow = new THREE.Mesh(
    mergeColored(neon),
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.96, blending: THREE.AdditiveBlending, depthWrite: false }),
  );

  g.add(structure, glow);
  // Orient: gate stands vertically, spans the road, faces along travel.
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = f.T.clone().setY(0).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
  g.position.copy(f.pos);
  g.matrixAutoUpdate = false;
  g.updateMatrix();
  return g;
}

// ------------------------------------------------------------------ rocks
// Small instanced boulders close to the track — the near-field parallax that
// pylons alone can't provide.
function buildRocks(rng, spline, groundY, theme) {
  const count = theme.rockCount ?? 260;
  const geom = bakeFlatColors(new THREE.IcosahedronGeometry(1, 0), theme.rock, { rim: false });
  const mesh = new THREE.InstancedMesh(geom,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), count);
  const f = makeFrame();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const s = rng() * spline.length;
    spline.frameAt(s, f);
    const side = rng() < 0.5 ? -1 : 1;
    const dist = f.width + 5 + rng() * 24;
    const rx = f.R.x, rz = f.R.z;
    const rl = Math.hypot(rx, rz) || 1;
    const size = 0.5 + rng() * 1.9;
    p.set(f.pos.x + (rx / rl) * side * dist, groundY + size * 0.22, f.pos.z + (rz / rl) * side * dist);
    e.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
    q.setFromEuler(e);
    sc.set(size, size * (0.5 + rng() * 0.4), size);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ------------------------------------------------------------------ scrub
// Low desert bushes: clumped, irregular, scattered near the racing line —
// the mid-ground texture between the rocks and the mesas.
function buildScrub(rng, spline, groundY, theme) {
  const parts = [];
  for (const [ox, oz, s] of [[0, 0, 1], [0.7, 0.3, 0.62], [-0.5, 0.45, 0.72]]) {
    const g = new THREE.IcosahedronGeometry(0.5 * s, 0);
    g.scale(1, 0.55, 1);
    g.rotateY(s * 5);
    g.translate(ox, 0.22 * s, oz);
    parts.push(bakeFlatColors(g, 0x35205e, { rim: false }));
  }
  const geom = mergeGeoms(parts);
  const count = theme.scrubCount;
  const mesh = new THREE.InstancedMesh(geom,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), count);
  mesh.frustumCulled = false;
  const f = makeFrame();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const s = rng() * spline.length;
    spline.frameAt(s, f);
    const side = rng() < 0.5 ? -1 : 1;
    const dist = f.width + 4 + rng() * 28;
    const rx = f.R.x, rz = f.R.z;
    const rl = Math.hypot(rx, rz) || 1;
    const size = 1 + rng() * 1.5;
    p.set(f.pos.x + (rx / rl) * side * dist, groundY + 0.1, f.pos.z + (rz / rl) * side * dist);
    q.setFromAxisAngle(Y, rng() * Math.PI * 2);
    sc.setScalar(size);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ------------------------------------------------------------------ flora
// 'cacti' for the desert, 'palms' for the coast — same scatterer.
// True if (x,z) clears the track surface laterally by at least `margin` metres
// (scans the arc-length samples; spline.width is the half-width there).
function clearOfTrack(spline, x, z, margin) {
  for (let i = 0; i < spline.n; i++) {
    const dx = x - spline.pos[i * 3], dz = z - spline.pos[i * 3 + 2];
    if (Math.hypot(dx, dz) - spline.width[i] < margin) return false;
  }
  return true;
}

function buildFlora(rng, spline, groundY, theme) {
  const style = theme.flora;
  const parts = [];
  if (style === 'palms') {
    // Leaning trunk + a crown of drooping fronds.
    const trunk = new THREE.CylinderGeometry(0.08, 0.15, 2.3, 5);
    trunk.translate(0, 1.15, 0);
    trunk.rotateZ(0.13);
    parts.push(bakeFlatColors(trunk, 0x6e4a2f, { rim: false }));
    for (let i = 0; i < 7; i++) {
      const frond = new THREE.ConeGeometry(0.11, 1.5, 3);
      frond.translate(0, 0.75, 0);
      frond.rotateX(Math.PI / 2 + 0.5); // point outward, droop down
      frond.scale(1, 0.4, 1);
      frond.rotateY((i / 7) * Math.PI * 2 + 0.2);
      frond.translate(0.29, 2.3, 0);
      parts.push(bakeFlatColors(frond, 0x2fa05a, { rim: false }));
    }
  } else {
    const seg = (r0, r1, h, x, y, rotZ = 0) => {
      const g = new THREE.CylinderGeometry(r0, r1, h, 5);
      if (rotZ) g.rotateZ(rotZ);
      g.translate(x, y, 0);
      parts.push(bakeFlatColors(g, 0x3a2a75, { rim: false }));
    };
    seg(0.13, 0.18, 1.8, 0, 0.9);
    seg(0.09, 0.11, 0.55, -0.34, 0.95, Math.PI / 2);
    seg(0.08, 0.1, 0.6, -0.56, 1.3);
    seg(0.08, 0.1, 0.4, 0.3, 0.7, Math.PI / 2);
    seg(0.07, 0.09, 0.5, 0.46, 1.0);
  }
  const geom = mergeGeoms(parts);

  const count = theme.floraCount ?? 80;
  const mesh = new THREE.InstancedMesh(geom,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), count);
  const f = makeFrame();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    // Pick a spot, but reject any that lands over the track — palms are tall
    // and otherwise poke up through the surface on the inside of curves.
    let x = 0, z = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const s = rng() * spline.length;
      spline.frameAt(s, f);
      const side = rng() < 0.5 ? -1 : 1;
      const dist = f.width + 8 + rng() * 60;
      const rx = f.R.x, rz = f.R.z;
      const rl = Math.hypot(rx, rz) || 1;
      x = f.pos.x + (rx / rl) * side * dist;
      z = f.pos.z + (rz / rl) * side * dist;
      if (attempt === 7 || clearOfTrack(spline, x, z, 3)) break;
    }
    const size = 1.6 + rng() * 2.2;
    p.set(x, groundY, z);
    q.setFromAxisAngle(Y, rng() * Math.PI * 2);
    sc.setScalar(size);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// -------------------------------------------------------------- billboards
// Neon-framed hoardings on the outside of corners, facing the approach.
function buildBillboards(rng, spline, groundY, every = 220, adGlow = 0) {
  const f = makeFrame();
  const spots = [];
  let lastS = -every;
  for (let s = 0; s < spline.length; s += 8) {
    spline.frameAt(s, f);
    if (Math.abs(f.kappa) > 0.0055 && s - lastS >= every) {
      spots.push({ s, side: Math.sign(f.kappa) }); // outside of the turn
      lastS = s;
    }
  }
  const opa = [], glo = [], faces = [];
  const atlas = adAtlas();
  const W = 11, H = 5.5;
  const m = new THREE.Matrix4();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();
  const cl = new THREE.Color(TUNING.COL.EDGE_L), cr = new THREE.Color(TUNING.COL.EDGE_R);
  spots.forEach((spot, idx) => {
    spline.frameAt(spot.s, f);
    const rx = f.R.x, rz = f.R.z;
    const rl = Math.hypot(rx, rz) || 1;
    const dist = f.width + 16 + rng() * 8;
    const px = f.pos.x + (rx / rl) * spot.side * dist;
    const pz = f.pos.z + (rz / rl) * spot.side * dist;
    const py = Math.max(groundY + 8.5, f.pos.y + 4.5);
    // Face back along the track, tilted toward it.
    Z.set(-f.T.x - (rx / rl) * spot.side * 0.45, 0, -f.T.z - (rz / rl) * spot.side * 0.45).normalize();
    X.crossVectors(Y, Z).normalize();
    const place = (geom, ox, oy, oz, rotZ = 0) => {
      if (rotZ) geom.rotateZ(rotZ);
      m.makeBasis(X, Y, Z);
      m.setPosition(
        px + X.x * ox + Z.x * oz, py + oy, pz + X.z * ox + Z.z * oz);
      geom.applyMatrix4(m);
      return geom;
    };
    opa.push(bakeFlatColors(place(new THREE.BoxGeometry(W, H, 0.5), 0, 0, 0), 0x140a2e, { rim: false }));
    // Textured ad face from the shared atlas — UVs remapped into one cell.
    const cell = atlas.cells[Math.floor(rng() * atlas.cells.length)];
    const face = new THREE.PlaneGeometry(W * 0.84, H * 0.66);
    const uv = face.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, cell.u + uv.getX(k) * cell.w, cell.v + uv.getY(k) * cell.h);
    }
    faces.push(place(face, 0, 0, 0.28));
    for (const lx of [-W / 2 + 1, W / 2 - 1]) {
      const legH = py - groundY;
      opa.push(bakeFlatColors(
        place(new THREE.BoxGeometry(0.55, legH, 0.55), lx, -legH / 2, -0.1), 0x140a2e, { rim: false }));
    }
    const neon = idx % 2 ? cr : cl;
    glo.push(colorTint(place(new THREE.BoxGeometry(W + 0.4, 0.16, 0.1), 0, H / 2 + 0.1, 0.31), neon));
    glo.push(colorTint(place(new THREE.BoxGeometry(W + 0.4, 0.16, 0.1), 0, -H / 2 - 0.1, 0.31), neon));
    glo.push(colorTint(place(new THREE.BoxGeometry(0.16, H + 0.4, 0.1), -W / 2 - 0.1, 0, 0.31), neon));
    glo.push(colorTint(place(new THREE.BoxGeometry(0.16, H + 0.4, 0.1), W / 2 + 0.1, 0, 0.31), neon));
    glo.push(colorTint(place(new THREE.BoxGeometry(W * 0.85, 0.22, 0.08), 0, 0, 0.32, 0.32), neon));
  });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeoms(opa), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })));
  const glowMesh = new THREE.Mesh(mergeGeoms(glo), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glowMesh.renderOrder = 1;
  g.add(glowMesh);
  if (faces.length) {
    const faceGeo = mergeGeometries(faces, false);
    const faceMesh = new THREE.Mesh(faceGeo,
      new THREE.MeshBasicMaterial({ map: atlas.texture, fog: true }));
    faceMesh.renderOrder = 1;
    g.add(faceMesh);
    // Night self-illumination: a second additive pass over the SAME geometry so
    // the neon-on-dark ad art actually lights up (dark pixels add ~nothing).
    // Theme-gated (adGlow 0 in daylight) — one extra shared-geometry draw.
    if (adGlow > 0) {
      const litMesh = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({
        map: atlas.texture, transparent: true, opacity: adGlow,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      litMesh.renderOrder = 2;
      g.add(litMesh);
    }
  }
  g.traverse((o) => { o.frustumCulled = false; o.matrixAutoUpdate = false; });
  return g;
}

// ----------------------------------------------------------- street canyon
// Tower rows lining the track — the city's signature composition: you race
// through a canyon of buildings, not past scattered spires.
function buildCanyon(rng, spline, groundY, theme) {
  const f = makeFrame();
  const geoms = [], glows = [], blinkers = [], signsA = [], signsB = [];
  const winA = new THREE.Color(TUNING.COL.EDGE_L);
  const winB = new THREE.Color(TUNING.COL.EDGE_R);
  const winC = new THREE.Color(0xffd9a0);
  const signCols = [
    new THREE.Color(0x00f0ff), new THREE.Color(0xff2ec8),
    new THREE.Color(0xffe066), new THREE.Color(0x7df9ff),
  ];
  for (let s = 0; s < spline.length; s += 26) {
    spline.frameAt(s, f);
    const iSelf = Math.round(s / spline.step);
    // Density breathes along the lap: tight canyon, then open plaza, then
    // canyon again — rhythm instead of an even corridor.
    const dens = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(s * 0.005 + 2.1));
    for (const side of [-1, 1]) {
      if (rng() > dens) continue;
      const foot = 7 + rng() * 12;
      const dist = f.width + 13 + rng() * 16 + foot / 2;
      const rx = f.R.x, rz = f.R.z;
      const rl = Math.hypot(rx, rz) || 1;
      const px = f.pos.x + (rx / rl) * side * dist;
      const pz = f.pos.z + (rz / rl) * side * dist;
      // Close to OUR section by design — but must clear every OTHER section
      // (flyovers, loops, crossings).
      let ok = true;
      for (let i = 0; i < spline.n; i += 8) {
        const arcSteps = Math.abs(i - iSelf);
        const arc = Math.min(arcSteps, spline.n - arcSteps) * spline.step;
        if (arc < 70) continue;
        const dx = spline.pos[i * 3] - px, dz = spline.pos[i * 3 + 2] - pz;
        if (dx * dx + dz * dz < (foot + 16) ** 2) { ok = false; break; }
      }
      if (!ok) continue;
      const h = 24 + rng() * 72;
      const ry = (rng() - 0.5) * 0.5;
      const depth = foot * (0.7 + rng() * 0.6);
      const g = new THREE.BoxGeometry(foot, h, depth);
      g.rotateY(ry);
      g.translate(px, groundY + h / 2, pz);
      geoms.push(bakeFlatColors(g, rng() < 0.5 ? theme.mesaLit : theme.mesaShadow,
        { shadow: theme.mesaShadow }));
      // Tall blocks get a rooftop antenna with a blinking aircraft light.
      if (h > 62) {
        const ah = 5 + rng() * 8;
        const mast = new THREE.BoxGeometry(0.5, ah, 0.5);
        mast.translate(px, groundY + h + ah / 2, pz);
        geoms.push(bakeFlatColors(mast, theme.mesaShadow, { rim: false }));
        const tip = new THREE.BoxGeometry(0.9, 0.9, 0.9);
        tip.translate(px, groundY + h + ah + 0.4, pz);
        blinkers.push(tip);
      }
      // Window columns: thin glowing pillars sunk into the facade so they
      // read no matter how the block is rotated.
      const nW = 1 + (rng() < 0.5 ? 1 : 0);
      for (let k = 0; k < nW; k++) {
        const wh = h * (0.4 + rng() * 0.35);
        const strip = new THREE.BoxGeometry(1.1, wh, 1.1);
        strip.translate(
          px + (rng() - 0.5) * foot * 0.7 - (rx / rl) * side * (foot * 0.48),
          groundY + wh / 2 + h * 0.08,
          pz + (rng() - 0.5) * depth * 0.4 - (rz / rl) * side * (foot * 0.48),
        );
        const c = rng() < 0.55 ? winA : rng() < 0.6 ? winB : winC;
        glows.push(colorTint(strip, c));
      }
      // Big pulsing neon signs on some street-facing facades — two banks
      // breathing in counter-phase so the canyon flickers like a strip.
      if (h > 38 && rng() < 0.45) {
        const sh = h * (0.32 + rng() * 0.25);
        const sign = new THREE.BoxGeometry(2.0, sh, 2.0);
        sign.translate(
          px - (rx / rl) * side * (foot * 0.5),
          groundY + h * 0.35 + rng() * h * 0.2,
          pz - (rz / rl) * side * (foot * 0.5),
        );
        const tinted = colorTint(sign, signCols[Math.floor(rng() * signCols.length)]);
        (rng() < 0.5 ? signsA : signsB).push(tinted);
      }
    }
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeoms(geoms), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })));
  const glowMesh = new THREE.Mesh(mergeGeoms(glows), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glowMesh.renderOrder = 1;
  g.add(glowMesh);
  // Blinking aircraft-warning lights, one shared pulsing material.
  let blinkMat = null;
  if (blinkers.length) {
    const red = new THREE.Color(0xff4664);
    blinkMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const blinkMesh = new THREE.Mesh(
      mergeGeoms(blinkers.map((b) => colorTint(b, red))), blinkMat);
    blinkMesh.renderOrder = 1;
    g.add(blinkMesh);
  }
  // Neon sign banks with counter-phase pulse.
  let signMatA = null, signMatB = null;
  const addSigns = (geomList) => {
    if (!geomList.length) return null;
    const matS = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(mergeGeoms(geomList), matS);
    m.renderOrder = 1;
    g.add(m);
    return matS;
  };
  signMatA = addSigns(signsA);
  signMatB = addSigns(signsB);

  g.traverse((o) => { o.frustumCulled = false; o.matrixAutoUpdate = false; });
  return {
    group: g,
    update(t) {
      if (blinkMat) blinkMat.opacity = 0.25 + 0.75 * Math.max(0, Math.sin(t * 2.2));
      if (signMatA) signMatA.opacity = 0.45 + 0.3 * Math.sin(t * 1.9);
      if (signMatB) signMatB.opacity = 0.45 + 0.3 * Math.sin(t * 1.9 + Math.PI);
    },
  };
}

// ----------------------------------------------------------------- sprawl
// Low blocks filling the middle distance — the city floor is never empty.
function buildSprawl(rng, spline, groundY, theme) {
  const count = 170;
  const geoms = [];
  const fr = makeFrame();
  for (let i = 0; i < count; i++) {
    const s = rng() * spline.length;
    spline.frameAt(s, fr);
    const side = rng() < 0.5 ? -1 : 1;
    const dist = 55 + rng() * 380;
    const rx = fr.R.x, rz = fr.R.z;
    const rl = Math.hypot(rx, rz) || 1;
    const px = fr.pos.x + (rx / rl) * side * dist + (rng() - 0.5) * 60;
    const pz = fr.pos.z + (rz / rl) * side * dist + (rng() - 0.5) * 60;
    const foot = 9 + rng() * 22;
    // keep clear of the track corridor
    let ok = true;
    for (let q = 0; q < spline.n; q += 12) {
      const dx = spline.pos[q * 3] - px, dz = spline.pos[q * 3 + 2] - pz;
      if (dx * dx + dz * dz < (foot + 22) ** 2) { ok = false; break; }
    }
    if (!ok) continue;
    const h = 4 + rng() * 13;
    const g = new THREE.BoxGeometry(foot, h, foot * (0.6 + rng() * 0.8));
    g.rotateY(rng() * 0.6 - 0.3);
    g.translate(px, groundY + h / 2, pz);
    geoms.push(bakeFlatColors(g, rng() < 0.7 ? 0x150f2e : 0x1c1440, { rim: false }));
  }
  const mesh = new THREE.Mesh(mergeGeoms(geoms),
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------------------------------------------------------------- traffic
// Light streams flowing along grid avenues: white headlights one way, red
// taillights the other. One InstancedMesh, positions animated per frame.
function buildTraffic(rng, spline, groundY, cx, cz) {
  const avenues = [];
  const STEP = 6;
  for (let i = 0; i < 3; i++) {
    const alongX = i % 2 === 0;
    const offset = (rng() - 0.5) * 520;
    const start = alongX
      ? { x: cx - 760, z: cz + offset }
      : { x: cx + offset, z: cz - 760 };
    const dir = alongX ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const len = 1520;
    // Mask out stretches that pass under/next to the track corridor.
    const blocked = new Uint8Array(Math.ceil(len / STEP));
    for (let k = 0; k < blocked.length; k++) {
      const px = start.x + dir.x * k * STEP, pz = start.z + dir.z * k * STEP;
      for (let q = 0; q < spline.n; q += 10) {
        const dx = spline.pos[q * 3] - px, dz = spline.pos[q * 3 + 2] - pz;
        if (dx * dx + dz * dz < 26 * 26) { blocked[k] = 1; break; }
      }
    }
    const quat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), alongX ? Math.PI / 2 : 0);
    avenues.push({ start, dir, len, blocked, quat });
  }
  const N = 126;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.8, 0.5, 3.4),
    new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }), N);
  mesh.frustumCulled = false;
  const head = new THREE.Color(0xcfe8ff), tail = new THREE.Color(0xff5060);
  const cars = [];
  for (let i = 0; i < N; i++) {
    const av = avenues[i % avenues.length];
    const lane = rng() < 0.5 ? 1 : -1;
    cars.push({
      av, lane,
      speed: 16 + rng() * 18,
      off: rng() * av.len,
      lat: lane * (3 + rng() * 2.5),
    });
    mesh.setColorAt(i, lane > 0 ? head : tail);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  return {
    mesh,
    update(t) {
      for (let i = 0; i < N; i++) {
        const c = cars[i];
        let along = (c.off + t * c.speed) % c.av.len;
        if (c.lane < 0) along = c.av.len - along;
        const bi = Math.min(c.av.blocked.length - 1, Math.floor(along / STEP));
        const hidden = c.av.blocked[bi];
        p.set(
          c.av.start.x + c.av.dir.x * along - c.av.dir.z * c.lat,
          groundY + 0.7,
          c.av.start.z + c.av.dir.z * along + c.av.dir.x * c.lat,
        );
        sc.setScalar(hidden ? 0 : 1);
        m.compose(p, c.av.quat, sc);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// -------------------------------------------------------------- overheads
// Sign gantries spanning the road — the "racing under city furniture" layer.
function buildOverheads(spline) {
  const f = makeFrame();
  const opa = [], glo = [];
  const cl = new THREE.Color(TUNING.COL.EDGE_L), cr = new THREE.Color(TUNING.COL.EDGE_R);
  let lastS = -300, idx = 0;
  for (let s = 60; s < spline.length; s += 10) {
    spline.frameAt(s, f);
    if (Math.abs(f.kappa) > 0.004 || Math.abs(f.slope) > 0.25 || s - lastS < 300) continue;
    lastS = s;
    const W = f.width;
    const basis = new THREE.Matrix4().makeBasis(f.R, new THREE.Vector3(0, 1, 0),
      f.T.clone().negate().setY(0).normalize());
    const place = (geom, ox, oy, oz) => {
      basis.setPosition(
        f.pos.x + f.R.x * ox + 0, f.pos.y + oy, f.pos.z + f.R.z * ox + 0);
      geom.applyMatrix4(basis);
      return geom;
    };
    opa.push(bakeFlatColors(place(new THREE.BoxGeometry(W * 2 + 4, 1.0, 1.4), 0, 6.4, 0), 0x140a2e, { rim: false }));
    opa.push(bakeFlatColors(place(new THREE.BoxGeometry(0.7, 6.4, 0.7), W + 1.6, 3.2, 0), 0x140a2e, { rim: false }));
    opa.push(bakeFlatColors(place(new THREE.BoxGeometry(0.7, 6.4, 0.7), -(W + 1.6), 3.2, 0), 0x140a2e, { rim: false }));
    glo.push(colorTint(place(new THREE.BoxGeometry(W * 1.5, 0.3, 1.5), 0, 5.75, 0), idx % 2 ? cr : cl));
    idx++;
  }
  const g = new THREE.Group();
  if (opa.length) {
    g.add(new THREE.Mesh(mergeGeoms(opa), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })));
    const glowMesh = new THREE.Mesh(mergeGeoms(glo), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glowMesh.renderOrder = 1;
    g.add(glowMesh);
  }
  g.traverse((o) => { o.frustumCulled = false; o.matrixAutoUpdate = false; });
  return g;
}

// ---------------------------------------------------------------- bridges
// Elevated highways crossing OVER the track with their own light traffic —
// driving under living infrastructure is what makes a city circuit fun.
function buildBridges(rng, spline, groundY, theme) {
  const f = makeFrame();
  const clearOfTrack = (px, pz, r) => {
    const need = (r + 13) ** 2;
    for (let i = 0; i < spline.n; i += 8) {
      const dx = spline.pos[i * 3] - px, dz = spline.pos[i * 3 + 2] - pz;
      if (dx * dx + dz * dz < need) return false;
    }
    return true;
  };
  // The deck must clear EVERY track section it passes over (flyovers, the
  // loop tower) — not just the one it crosses by design.
  const deckClear = (cxp, czp, dirX, dirZ, y, len) => {
    for (let a = -len / 2; a <= len / 2; a += 12) {
      const px = cxp + dirX * a, pz = czp + dirZ * a;
      for (let i = 0; i < spline.n; i += 6) {
        const dx = spline.pos[i * 3] - px, dz = spline.pos[i * 3 + 2] - pz;
        if (dx * dx + dz * dz > 16 * 16) continue;
        if (y - spline.pos[i * 3 + 1] < 7.5) return false; // too close above a deck
      }
    }
    return true;
  };

  const candidates = [];
  let last = -650;
  for (let s = 60; s < spline.length; s += 30) {
    spline.frameAt(s, f);
    if (Math.abs(f.kappa) < 0.004 && Math.abs(f.slope) < 0.2 && s - last >= 650) {
      candidates.push(s); last = s;
    }
  }

  const opa = [], glo = [];
  const lanes = [];
  const cl = new THREE.Color(TUNING.COL.EDGE_L), cr = new THREE.Color(TUNING.COL.EDGE_R);
  const LEN = 270;
  let bi = 0;
  for (const s of candidates) {
    if (bi >= 3) break;
    spline.frameAt(s, f);
    const ang = Math.atan2(f.R.z, f.R.x) + (rng() - 0.5) * 0.5;
    const dirX = Math.cos(ang), dirZ = Math.sin(ang);
    const y = f.pos.y + 14 + rng() * 4;
    const cxp = f.pos.x, czp = f.pos.z;
    if (!deckClear(cxp, czp, dirX, dirZ, y, LEN)) continue;
    bi++;
    const place = (geom, alongOff, yOff, sideOff) => {
      geom.rotateY(-ang);
      geom.translate(
        cxp + dirX * alongOff - dirZ * sideOff,
        y + yOff,
        czp + dirZ * alongOff + dirX * sideOff,
      );
      return geom;
    };
    opa.push(bakeFlatColors(place(new THREE.BoxGeometry(LEN, 1.5, 11), 0, 0, 0), 0x140a2e, { rim: false }));
    glo.push(colorTint(place(new THREE.BoxGeometry(LEN, 0.22, 0.35), 0, 0.85, 5.2), bi % 2 ? cr : cl));
    glo.push(colorTint(place(new THREE.BoxGeometry(LEN, 0.22, 0.35), 0, 0.85, -5.2), bi % 2 ? cl : cr));
    // Support pillars, nudged outward until clear of every track section.
    for (const side of [-1, 1]) {
      for (let off = 55; off <= 125; off += 10) {
        const px = cxp + dirX * side * off, pz = czp + dirZ * side * off;
        if (!clearOfTrack(px, pz, 4)) continue;
        const ph = y - groundY;
        const pil = new THREE.BoxGeometry(3, ph, 3);
        pil.translate(px, groundY + ph / 2, pz);
        opa.push(bakeFlatColors(pil, 0x140a2e, { rim: false }));
        break;
      }
    }
    lanes.push({ cxp, czp, y: y + 1.3, dirX, dirZ });
  }

  const g = new THREE.Group();
  if (opa.length) {
    g.add(new THREE.Mesh(mergeGeoms(opa), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })));
    const glowMesh = new THREE.Mesh(mergeGeoms(glo), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glowMesh.renderOrder = 1;
    g.add(glowMesh);
  }

  // Bridge traffic: a few dashes per deck, both directions.
  const PER = 6;
  const N = lanes.length * PER;
  let mesh = null;
  const cars = [];
  if (N) {
    mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.8, 0.45, 3.2),
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }), N);
    mesh.frustumCulled = false;
    const head = new THREE.Color(0xcfe8ff), tail = new THREE.Color(0xff5060);
    for (let i = 0; i < N; i++) {
      const lane = lanes[Math.floor(i / PER)];
      const fwd = i % 2 === 0;
      cars.push({
        lane, fwd,
        lat: fwd ? 2.4 : -2.4,
        sp: 16 + rng() * 14,
        off: rng() * LEN,
        quat: new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          Math.PI / 2 - Math.atan2(lane.dirZ, lane.dirX)),
      });
      mesh.setColorAt(i, fwd ? head : tail);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    g.add(mesh);
  }
  g.traverse((o) => { o.frustumCulled = false; o.matrixAutoUpdate = false; });
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  return {
    group: g,
    update(t) {
      for (let i = 0; i < N; i++) {
        const c = cars[i];
        let along = ((t * c.sp + c.off) % LEN) - LEN / 2;
        if (!c.fwd) along = -along;
        p.set(
          c.lane.cxp + c.lane.dirX * along - c.lane.dirZ * c.lat,
          c.lane.y,
          c.lane.czp + c.lane.dirZ * along + c.lane.dirX * c.lat,
        );
        m.compose(p, c.quat, one);
        mesh.setMatrixAt(i, m);
      }
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------ searchlights
// Slow-sweeping beams over downtown — pure night-city theater.
function buildSearchlights(rng, spline, groundY) {
  const group = new THREE.Group();
  const beams = [];
  const f = makeFrame();
  const geo = new THREE.CylinderGeometry(11, 0.9, 230, 6, 1, true);
  geo.translate(0, 115, 0);
  for (let i = 0; i < 4; i++) {
    spline.frameAt(rng() * spline.length, f);
    const pivot = new THREE.Group();
    pivot.position.set(
      f.pos.x + (rng() - 0.5) * 260,
      groundY,
      f.pos.z + (rng() - 0.5) * 260,
    );
    const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xbfd8ff, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      side: THREE.DoubleSide,
    }));
    beam.rotation.z = 0.32 + rng() * 0.1; // tilt; the pivot spins it around Y
    beam.frustumCulled = false;
    pivot.add(beam);
    group.add(pivot);
    beams.push({ pivot, speed: 0.1 + i * 0.06, phase: i * 1.7 });
  }
  return {
    group,
    update(t) {
      for (const b of beams) b.pivot.rotation.y = t * b.speed + b.phase;
    },
  };
}

// ------------------------------------------------------------ distant city
// A skyline cluster beyond the mesas with glowing window strips piercing the
// haze — the destination on the horizon.
function buildCity(rng, groundY, cx, cz, cityAng) {
  const dist = 600;
  const ccx = cx + Math.cos(cityAng) * dist;
  const ccz = cz + Math.sin(cityAng) * dist;
  const opa = [], glo = [];
  const cl = new THREE.Color(TUNING.COL.EDGE_L), cr = new THREE.Color(TUNING.COL.EDGE_R);
  // Window palette: mostly warm (lived-in offices) + a little neon. Weighted.
  const WIN = [
    [new THREE.Color(0xffb15a), 0.30], [new THREE.Color(0xff7e3c), 0.18], [new THREE.Color(0xffe6c0), 0.12],
    [new THREE.Color(0xfff2d6), 0.08], [cl, 0.18], [cr, 0.14],
  ];
  const pickWin = () => { let r = rng(); for (const [c, w] of WIN) { r -= w; if (r <= 0) return c; } return WIN[0][0]; };
  const beacon = [cr, cl, new THREE.Color(0xff3a3a)];

  // A grid of lit window cells over the four faces of one tower; baked straight
  // into a position+colour BufferGeometry (one per tower) so the glow merge
  // stays cheap. The opaque tower depth-tests out the windows on its far side.
  const windowGeo = (w, h, d, rot, px, py, pz) => {
    const P = [], C = [];
    const quad = (ax, ay, az, ux, uy, uz, vx, vy, vz, col) => {
      const x2 = ax + ux, y2 = ay + uy, z2 = az + uz;        // a + u
      const x3 = ax + ux + vx, y3 = ay + uy + vy, z3 = az + uz + vz; // a + u + v
      const x4 = ax + vx, y4 = ay + vy, z4 = az + vz;        // a + v
      P.push(ax, ay, az, x2, y2, z2, x3, y3, z3, ax, ay, az, x3, y3, z3, x4, y4, z4);
      for (let k = 0; k < 6; k++) C.push(col.r, col.g, col.b);
    };
    const cols = Math.max(3, Math.round(w / 3.4)), rows = Math.max(5, Math.round(h / 6.5));
    const cw = w / cols, ch = h / rows, gx = cw * 0.62, gy = ch * 0.58;
    for (const face of [0, 1, 2, 3]) {
      const onX = face < 2, sign = face % 2 ? 1 : -1;
      const span = onX ? d : w, off = (onX ? w : d) / 2 + 0.4;
      const nc = onX ? Math.max(3, Math.round(span / 3.4)) : cols;
      const sw = span / nc, sgx = sw * 0.62;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < nc; c++) {
          if (rng() > 0.6) continue; // ~60% of cells are lit
          const cy = -h / 2 + (r + 0.5) * ch;
          const ct = -span / 2 + (c + 0.5) * sw;
          const col = pickWin();
          if (onX) quad(sign * off, cy - gy / 2, ct - sgx / 2, 0, gy, 0, 0, 0, sgx, col);
          else quad(ct - sgx / 2, cy - gy / 2, sign * off, sgx, 0, 0, 0, gy, 0, col);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.rotateY(rot); g.translate(px, py, pz);
    return g;
  };

  const n = 44;
  for (let i = 0; i < n; i++) {
    // Two depth rings: a nearer ring of bigger towers + a far backdrop ring.
    const near = rng() < 0.42;
    const rr = near ? 40 + rng() * 110 : 160 + rng() * 150;
    const a = rng() * Math.PI * 2;
    const px = ccx + Math.cos(a) * rr;
    const pz = ccz + Math.sin(a) * rr * 0.7;
    const w = (near ? 24 : 14) + rng() * (near ? 26 : 20);
    const d = (near ? 24 : 14) + rng() * (near ? 26 : 20);
    const h = (near ? 90 : 50) + rng() * (near ? 190 : 120);
    const rot = rng() * 0.6;
    const py = groundY + h / 2;
    const tower = new THREE.BoxGeometry(w, h, d);
    tower.rotateY(rot); tower.translate(px, py, pz);
    opa.push(bakeFlatColors(tower, 0x190d3c, { rim: false }));
    glo.push(windowGeo(w, h, d, rot, px, py, pz));
    // Antenna spire + blinking beacon tip on the taller towers (comms-mast look).
    if (h > 150 && rng() < 0.6) {
      const sh = 12 + rng() * 26;
      const mast = new THREE.BoxGeometry(0.9, sh, 0.9);
      mast.translate(px, groundY + h + sh / 2, pz);
      opa.push(bakeFlatColors(mast, 0x120a2c, { rim: false }));
      const tip = new THREE.BoxGeometry(2.4, 2.4, 2.4);
      tip.translate(px, groundY + h + sh, pz);
      glo.push(colorTint(tip, beacon[Math.floor(rng() * beacon.length)]));
    }
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeoms(opa), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })));
  const glowMesh = new THREE.Mesh(mergeGeoms(glo), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.62,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glowMesh.renderOrder = 1;
  g.add(glowMesh);
  g.traverse((o) => { o.frustumCulled = false; o.matrixAutoUpdate = false; });
  return g;
}

// ----------------------------------------------------------------- drones
// Hovering spectator drones clustered at the corners — bobbing, drifting
// lights that make the trackside feel inhabited.
function buildDrones(rng, spline, theme) {
  const f = makeFrame();
  const spots = [];
  let lastS = -110;
  for (let s = 0; s < spline.length; s += 8) {
    spline.frameAt(s, f);
    if (Math.abs(f.kappa) > 0.005 && s - lastS >= 110) { spots.push(s); lastS = s; }
  }
  const N = Math.min(theme.drones, Math.max(spots.length * 3, 12));
  const mesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.34),
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }), N);
  mesh.frustumCulled = false;
  const cols = [
    new THREE.Color(TUNING.COL.EDGE_L),
    new THREE.Color(TUNING.COL.EDGE_R),
    new THREE.Color(TUNING.COL.WARNING),
  ];
  const bases = [];
  for (let i = 0; i < N; i++) {
    const s = spots.length ? spots[i % spots.length] + (rng() - 0.5) * 40 : rng() * spline.length;
    spline.frameAt(s, f);
    const side = rng() < 0.5 ? -1 : 1;
    const off = f.width + 4 + rng() * 9;
    bases.push({
      x: f.pos.x + f.R.x * side * off,
      y: f.pos.y + 3.5 + rng() * 5,
      z: f.pos.z + f.R.z * side * off,
      ph: rng() * Math.PI * 2,
      orbit: 0.6 + rng() * 1.6,
    });
    mesh.setColorAt(i, cols[i % 3]);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const m = new THREE.Matrix4();
  return {
    mesh,
    update(t) {
      for (let i = 0; i < N; i++) {
        const b = bases[i];
        m.makeTranslation(
          b.x + Math.sin(t * 0.6 + b.ph) * b.orbit,
          b.y + Math.sin(t * 1.4 + b.ph * 2) * 0.7,
          b.z + Math.cos(t * 0.6 + b.ph) * b.orbit,
        );
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ motes
// Ambient atmosphere along the whole lap: sand motes, sea spray or neon
// rain depending on the world. Motion in the air sells "alive" more than
// any static prop.
function buildMotes(rng, spline, theme) {
  const rain = theme.ambient.mode === 'rain';
  const N = rain ? 170 : 140;
  const geom = rain
    ? new THREE.BoxGeometry(0.045, 1.6, 0.045)
    : new THREE.BoxGeometry(0.17, 0.17, 0.17);
  const mesh = new THREE.InstancedMesh(geom, new THREE.MeshBasicMaterial({
    color: theme.ambient.color, transparent: true,
    opacity: rain ? 0.3 : 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  }), N);
  mesh.frustumCulled = false;
  const f = makeFrame();
  const bases = [];
  for (let i = 0; i < N; i++) {
    spline.frameAt(rng() * spline.length, f);
    bases.push({
      x: f.pos.x + f.R.x * (rng() - 0.5) * 56,
      y: f.pos.y + rng() * 13,
      z: f.pos.z + f.R.z * (rng() - 0.5) * 56,
      ph: rng() * 100,
      sp: 0.5 + rng(),
    });
  }
  const m = new THREE.Matrix4();
  return {
    mesh,
    update(t) {
      for (let i = 0; i < N; i++) {
        const b = bases[i];
        let x = b.x, y = b.y, z = b.z;
        if (rain) {
          y = b.y + 9 - ((t * 26 * b.sp + b.ph) % 18);
        } else {
          x += Math.sin(t * 0.35 * b.sp + b.ph) * 3.2;
          y += Math.sin(t * 0.6 * b.sp + b.ph * 2) * 1.4;
          z += Math.cos(t * 0.3 * b.sp + b.ph) * 3.2;
        }
        m.makeTranslation(x, y, z);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------- sky traffic
// Aircars crossing high over the city on straight lanes.
function buildSkyTraffic(rng, cx, cz, groundY) {
  const N = 12;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.1, 0.45, 3.4),
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }), N);
  mesh.frustumCulled = false;
  const head = new THREE.Color(0xcfe8ff), tail = new THREE.Color(0xff5060);
  const cars = [];
  for (let i = 0; i < N; i++) {
    const ang = rng() * Math.PI;
    const lane = {
      dirX: Math.cos(ang), dirZ: Math.sin(ang),
      ox: cx + (rng() - 0.5) * 500,
      oz: cz + (rng() - 0.5) * 500,
      y: groundY + 55 + rng() * 80,
      sp: (22 + rng() * 26) * (rng() < 0.5 ? 1 : -1),
      off: rng() * 1400,
      quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - ang),
    };
    cars.push(lane);
    mesh.setColorAt(i, lane.sp > 0 ? head : tail);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  return {
    mesh,
    update(t) {
      for (let i = 0; i < N; i++) {
        const c = cars[i];
        const along = ((t * c.sp + c.off) % 1400 + 1400) % 1400 - 700;
        p.set(c.ox + c.dirX * along, c.y, c.oz + c.dirZ * along);
        m.compose(p, c.quat, sc);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ birds
// Two small flocks wheeling over the lagoon.
function buildBirds(rng, spline, groundY) {
  const FLOCKS = 2, PER = 7, N = FLOCKS * PER;
  // A simple chevron silhouette.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1.1, 0, 0.45, 0, 0, 0, 0, 0.1, 0.22,
    0, 0, 0, 1.1, 0, 0.45, 0, 0.1, 0.22,
  ]), 3));
  const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({
    color: 0x14333d, side: THREE.DoubleSide, fog: true,
  }), N);
  mesh.frustumCulled = false;
  const f = makeFrame();
  const flocks = [];
  for (let k = 0; k < FLOCKS; k++) {
    spline.frameAt(rng() * spline.length, f);
    const side = rng() < 0.5 ? -1 : 1;
    flocks.push({
      cx: f.pos.x + f.R.x * side * (70 + rng() * 80),
      cz: f.pos.z + f.R.z * side * (70 + rng() * 80),
      y: groundY + 20 + rng() * 12,
      r: 36 + rng() * 28,
      sp: (0.05 + rng() * 0.04) * (rng() < 0.5 ? 1 : -1),
      ph: rng() * Math.PI * 2,
    });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  return {
    mesh,
    update(t) {
      for (let k = 0; k < FLOCKS; k++) {
        const fl = flocks[k];
        const a = t * fl.sp * Math.PI * 2 + fl.ph;
        for (let i = 0; i < PER; i++) {
          const idx = k * PER + i;
          const trail = i * 0.07;
          const aa = a - trail;
          p.set(
            fl.cx + Math.cos(aa) * fl.r + Math.sin(i * 3.1) * 3,
            fl.y + Math.sin(t * 1.1 + i) * 1.6,
            fl.cz + Math.sin(aa) * fl.r + Math.cos(i * 2.3) * 3,
          );
          q.setFromAxisAngle(Y, -aa + (fl.sp > 0 ? 0 : Math.PI));
          // flap: squash the chevron vertically
          sc.set(1, 1, 1 + Math.sin(t * 7 + i * 1.7) * 0.35);
          m.compose(p, q, sc);
          mesh.setMatrixAt(idx, m);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// Constant-color attribute for glow geometry going into mergeGeoms.
function colorTint(geom, color) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const count = g.getAttribute('position').count;
  const c = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

// Minimal geometry merge (positions + colors only, all non-indexed).
export function mergeGeoms(geoms) {
  let vertCount = 0;
  for (const g of geoms) vertCount += g.getAttribute('position').count;
  const pos = new Float32Array(vertCount * 3);
  const col = new Float32Array(vertCount * 3);
  let o = 0;
  for (const g of geoms) {
    pos.set(g.getAttribute('position').array, o * 3);
    col.set(g.getAttribute('color').array, o * 3);
    o += g.getAttribute('position').count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}
