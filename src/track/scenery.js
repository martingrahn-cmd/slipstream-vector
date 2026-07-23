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
  const landmarks = buildLandmarks(rng, spline, groundY, cx, cz, theme);
  if (landmarks) group.add(landmarks.group);
  group.add(buildMesas(rng, spline, groundY, theme));
  if (theme.rockCut) { const rc = buildRockCut(rng, spline, groundY, theme); if (rc) group.add(rc); }
  group.add(...buildPylons(spline));
  const rings = buildHoloRings(spline);
  group.add(rings.mesh);
  const arches = buildArches(spline, theme);
  if (arches) group.add(arches.group);
  group.add(buildGantry(spline, groundY));
  if (theme.rockCount) group.add(buildRocks(rng, spline, groundY, theme));
  if (theme.scrubCount) group.add(buildScrub(rng, spline, groundY, theme));
  if (theme.roadside) group.add(buildRoadside(rng, spline, groundY, theme));
  if (theme.flora && theme.floraCount) group.add(buildFlora(rng, spline, groundY, theme));
  group.add(buildBillboards(rng, spline, groundY, theme.billboardEvery ?? 220, theme.adGlow ?? 0));
  const canyon = theme.canyon ? buildCanyon(rng, spline, groundY, theme) : null;
  if (canyon) group.add(canyon.group);
  if (theme.sprawl) group.add(buildSprawl(rng, spline, groundY, theme));
  if (theme.overheads) group.add(buildOverheads(spline));
  const traffic = theme.traffic ? buildTraffic(rng, spline, groundY, cx, cz) : null;
  if (traffic) group.add(traffic.mesh);
  if (theme.city) group.add(buildCity(rng, groundY, cx, cz, CITY_ANG, theme, spline));
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
  const birds = theme.birds
    ? buildBirds(rng, spline, groundY, { color: theme.birdCol, anchor: landmarks && landmarks.anchor })
    : null;
  if (birds) group.add(birds.mesh);
  const devils = theme.dustDevils ? buildDustDevils(rng, spline, groundY, cx, cz, theme.dustDevils) : null;
  if (devils) group.add(devils.group);
  const sails = theme.sails ? buildSails(rng, spline, groundY, cx, cz, theme.sails) : null;
  if (sails) group.add(sails.mesh);
  const blimp = theme.blimp ? buildBlimp(rng, groundY, cx, cz) : null;
  if (blimp) group.add(blimp.group);

  let flash = 0;
  const stormy = theme.ambient && theme.ambient.mode === 'rain';
  return {
    group,
    sky: sky.mesh,
    update(t, cameraPos, raceProgress = 0, sunFlare = 0, meteor = -1, meteorAz = 0) {
      sky.mesh.position.copy(cameraPos);
      sky.mat.uniforms.time.value = t;
      sky.mat.uniforms.progress.value = raceProgress;
      sky.mat.uniforms.sunFlare.value = sunFlare;
      sky.mat.uniforms.meteor.value = meteor;
      sky.mat.uniforms.meteorAz.value = meteorAz;
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
      if (landmarks && landmarks.update) landmarks.update(t);
      if (canyon) canyon.update(t);
      if (traffic) traffic.update(t);
      if (drones) drones.update(t);
      if (motes) motes.update(t);
      if (skyCars) skyCars.update(t);
      if (bridges) bridges.update(t);
      if (birds) birds.update(t);
      if (devils) devils.update(t);
      if (sails) sails.update(t);
      if (blimp) blimp.update(t);
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
      sunAzimuth: { value: new THREE.Vector3(S.sunAz ? S.sunAz[0] : -0.35, 0, S.sunAz ? S.sunAz[1] : -0.94).normalize() },
      sunSize: { value: S.sunSize },
      sunStripes: { value: S.sunStripes },
      starLevel: { value: S.starLevel },
      cloudAmp: { value: S.cloudAmp },
      cloudPuff: { value: S.cloudPuff ?? 1.0 },
      progress: { value: 0 },   // 0..1 race progress — mood drifts over the laps
      flash: { value: 0 },      // lightning flash (city storms)
      planet: { value: S.event === 'planet' ? 1.0 : 0.0 }, // sister planet + meteors (desert)
      sunFlare: { value: 0 },   // 0..1 sun-gate bloom — swells as you drive into the sun
      meteor: { value: -1 },    // -1 idle, else 0..1 life of the scripted last-lap fireball
      meteorAz: { value: 0 },   // world azimuth the fireball is centred on (player's heading at trigger)
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
      uniform float time, sunSize, sunStripes, starLevel, cloudAmp, cloudPuff, progress, flash, planet, sunFlare, meteor, meteorAz;
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
        // Soft glow around the sun — swells when you drive INTO it (sun-gate run).
        col += sunCore * (0.18 + 0.55 * sunFlare) * (1.0 - smoothstep(0.0, 0.55 + 0.4 * sunFlare, ang));
        // God-rays: faint shafts fanning out from the sun (sunny worlds only),
        // fanning wider and brighter as the gate lines up on the sun.
        float rayAz = atan(d.y - sunDir.y, d.x - sunDir.x);
        float shafts = pow(0.5 + 0.5 * sin(rayAz * 22.0 + time * 0.08), 2.0);
        col += sunCore * shafts * (1.0 - smoothstep(0.0, 0.5 + 0.4 * sunFlare, ang)) * (0.12 + 0.6 * sunFlare) * sunStripes;
        // Sun-gate bloom: a broad warm halo washing out from the disc as you
        // aim through the arch — the "driving into the sun" flood.
        col += hot * sunFlare * (1.0 - smoothstep(0.0, 0.95, ang)) * 0.6;
        col += sunCore * sunFlare * (1.0 - smoothstep(0.0, 0.42, ang)) * 0.7;
        // Sky event (desert): a huge dim SISTER PLANET low on the horizon
        // opposite the sun, plus a rare meteor streak. Silent scale-teller.
        if (planet > 0.5) {
          vec3 pDir = normalize(vec3(-sunAzimuth.x, 0.14, -sunAzimuth.z));
          float pAng = acos(clamp(dot(d, pDir), -1.0, 1.0));
          float pDisc = 1.0 - smoothstep(0.20, 0.215, pAng);
          if (pDisc > 0.0) {
            // dusty violet body, slightly darker limb, faint horizontal bands
            vec3 pCol = mix(upper, band, 0.45) * 1.25 + vec3(0.05, 0.03, 0.07);
            pCol *= 0.82 + 0.18 * (1.0 - pAng / 0.215);
            pCol *= 0.92 + 0.08 * sin(d.y * 90.0);
            col = mix(col, pCol, pDisc * 0.55);
          }
          col += (mix(upper, band, 0.5) + vec3(0.05)) * 0.10 * (1.0 - smoothstep(0.0, 0.5, pAng));
          // meteor: every ~9s window, sometimes, a brief bright streak
          float mseed = floor(time / 9.0);
          float mfrac = fract(time / 9.0);
          float mgate = step(0.55, hash(vec2(mseed, 3.7))) * step(mfrac, 0.1);
          if (mgate > 0.0) {
            vec2 sc2 = vec2(atan(d.x, d.z) * 0.318, d.y);
            vec2 mo = vec2((hash(vec2(mseed, 1.0)) - 0.5) * 1.2, 0.5 + hash(vec2(mseed, 2.0)) * 0.22);
            vec2 mdir = normalize(vec2(0.4, -0.18));
            vec2 rel = sc2 - mo;
            float along = dot(rel, mdir);
            float acrossM = abs(dot(rel, vec2(-mdir.y, mdir.x)));
            float head = mfrac / 0.1;
            float streak = smoothstep(0.010, 0.0, acrossM)
              * smoothstep(-0.01, 0.01, along) * smoothstep(0.14, 0.02, along)
              * step(along, head * 0.14) * (1.0 - head * 0.7);
            col += vec3(0.95, 0.9, 1.0) * streak * 0.7;
          }
        }
        // Scripted CLIMAX meteor (final lap): a bright fireball arcing across
        // the sky with a long glowing trail, brightest mid-flight. meteor: -1
        // idle, else 0..1 life. Bigger and brighter than the ambient streak.
        if (meteor >= 0.0) {
          // Centred on the player's heading at trigger (meteorAz) so it always
          // falls into view — a diagonal fireball dropping ahead of you.
          float azRel = atan(d.x, d.z) - meteorAz;
          azRel = mod(azRel + 3.14159265, 6.28318530) - 3.14159265; // wrap [-pi,pi]
          vec2 mc = vec2(azRel, d.y);
          vec2 mStart = vec2(-0.34, 0.44), mEnd = vec2(0.24, 0.045);
          vec2 mDir = normalize(mEnd - mStart);
          vec2 headP = mix(mStart, mEnd, meteor);
          vec2 rel = mc - headP;
          float along = dot(rel, mDir);                       // >0 ahead, <0 trail
          float across = abs(dot(rel, vec2(-mDir.y, mDir.x)));
          float tail = clamp(-along / 0.6, 0.0, 1.0);         // 0 at head .. 1 at tail end
          float w = mix(0.012, 0.05, tail);                   // thin at head, feathers back
          float body = smoothstep(w, 0.0, across) * (1.0 - tail) * step(along, 0.012);
          float head = smoothstep(0.075, 0.0, length(rel));   // hot core blob
          float life = smoothstep(0.0, 0.12, meteor) * smoothstep(1.0, 0.8, meteor);
          vec3 mCol = mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.97, 0.92), head);
          col += mCol * (body * 1.0 + head * 1.9) * life;
          col += hot * life * head * 0.2;                     // faint warm wash at the head
        }
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
          uWarm: { value: new THREE.Color(theme.warm ?? 0xffd9a0) },
          uSunDir: { value: new THREE.Vector2(
            theme.sky.sunAz ? theme.sky.sunAz[0] : -0.35,
            theme.sky.sunAz ? theme.sky.sunAz[1] : -0.94).normalize() },
          uCenter: { value: new THREE.Vector2(cx, cz) },
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
        uniform vec3 colA, colB, uWarm;
        uniform vec2 uSunDir, uCenter;
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
          // Stage-3: mid-scale wind ripples (~14m wavelength) — the big bands
          // are horizon language; THIS is what the sand reads as at track
          // distance, so the near ground never flattens to one fill.
          float rip = sin(dot(vXZ, vec2(0.42, 0.16)) + sin(dot(vXZ, vec2(-0.11, 0.31)) * 1.7) * 2.2);
          col = mix(col, colB, smoothstep(0.2, 0.95, rip) * 0.10);
          // Coarse grain so the surface never reads as a flat fill.
          float g = hash(floor(vXZ * 0.9));
          col += (g - 0.5) * 0.035;
          // Sparse darker scrub blotches.
          float blotch = hash(floor(vXZ * 0.045));
          col = mix(col, colA * 0.72, step(0.82, blotch) * 0.5);
          // Sun-kiss: dune band crests brighten toward the sun side of the
          // world — a warm gold brush that dies into the fog.
          float crest = smoothstep(0.72, 0.98, band);
          float sunSide = clamp(0.5 + 0.5 * dot(normalize(vXZ - uCenter), uSunDir), 0.0, 1.0);
          col = mix(col, uWarm, crest * sunSide * sunSide * 0.30);
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
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        void main() {
          vec3 col = colA;
          // Stage-3: each 64m block gets its own lot tint, so the ground
          // between the towers reads as a CITY plan, not a dark fill.
          col *= 0.93 + hash(floor(vXZ / 64.0)) * 0.14;
          // Street grid shining through the asphalt, gently pulsing.
          float dx = abs(fract(vXZ.x / 64.0 + 0.5) - 0.5) * 64.0;
          float dz = abs(fract(vXZ.y / 64.0 + 0.5) - 0.5) * 64.0;
          float line = max(smoothstep(1.1, 0.0, dx), smoothstep(1.1, 0.0, dz));
          float pulse = 0.65 + 0.35 * sin(time * 0.8 + (vXZ.x + vXZ.y) * 0.01);
          col += colB * line * 0.22 * pulse;
          // Every 4th line is an AVENUE — wider, brighter, the arterial glow.
          vec2 a4 = fract(vXZ / 256.0 + 0.5) - 0.5;
          float ave = max(smoothstep(0.011, 0.0, abs(a4.x)), smoothstep(0.011, 0.0, abs(a4.y)));
          col += colB * ave * 0.34 * pulse;
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
  // Directed horizon: per-theme angular windows thin out or boost the rings
  // (a mountain WALL on one side, open sky on another) instead of an even
  // circle. Falls back to the old single skyline window.
  const mask = theme.horizonMask
    || (cityAng !== null ? [{ ang: cityAng, span: 0.42, density: 0 }] : []);
  const maskAt = (ang) => {
    for (const m of mask) {
      const d = Math.abs(Math.atan2(Math.sin(ang - m.ang), Math.cos(ang - m.ang)));
      if (d < m.span) return { density: m.density ?? 1, hScale: m.hScale ?? 1 };
    }
    return { density: 1, hScale: 1 };
  };
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
  const ridges = theme.mountainStyle === 'ridges';
  // A ridge = 3 overlapping WIDE squashed cones with sawtooth heights, laid
  // along the tangent so neighbours read as one connected crest line.
  const pushRidge = (px, pz, ang, w, h, colHex) => {
    const tx = -Math.sin(ang), tz = Math.cos(ang);
    for (let k = -1; k <= 1; k++) {
      const hk = h * (0.62 + rng() * 0.5);
      const wk = w * (2.1 + rng() * 0.9);
      const cx2 = px + tx * wk * k * 0.9, cz2 = pz + tz * wk * k * 0.9;
      // A tooth is up to ~3x wider than the base cone the ring clearance was
      // sized for — every tooth must clear the track on its own footprint.
      if (!clearOfTrack(cx2, cz2, wk)) continue;
      const g = new THREE.ConeGeometry(wk, hk, 4 + Math.floor(rng() * 2), 1);
      g.scale(1, 1, 0.38); // thin slab-like ridge tooth
      g.rotateY(ang + (rng() - 0.5) * 0.2);
      g.translate(cx2, groundY + hk / 2 - 2, cz2);
      geoms.push(bakeFlatColors(g, colHex, { rim: false }));
    }
  };
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rng() * 0.15;
    const mk = maskAt(ang);
    if (mk.density <= 0 || rng() >= mk.density) continue;
    let r = 560 + rng() * 90;
    const h = (towers ? 90 + rng() * 160 : lowWide ? 35 + rng() * 60 : 70 + rng() * 130) * mk.hScale;
    const w = towers ? 35 + rng() * 55 : lowWide ? 90 + rng() * 130 : 60 + rng() * 90;
    let px = cx + Math.cos(ang) * r, pz = cz + Math.sin(ang) * r;
    const footR = ridges ? w * 3.2 + 30 : w; // a ridge sweeps ~3x wider than its base cone
    for (let push = 0; push < 10 && !clearOfTrack(px, pz, footR); push++) {
      r += 45;
      px = cx + Math.cos(ang) * r;
      pz = cz + Math.sin(ang) * r;
    }
    if (ridges) { pushRidge(px, pz, ang, w, h, theme.mountainFar); continue; }
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
    const mk = maskAt(ang);
    if (mk.density <= 0 || rng() >= mk.density) continue;
    let r = 920 + rng() * 170;
    const h = (towers ? 80 + rng() * 140 : lowWide ? 30 + rng() * 50 : 60 + rng() * 110) * 0.7 * mk.hScale;
    const w = (towers ? 40 + rng() * 60 : lowWide ? 100 + rng() * 140 : 70 + rng() * 100) * 1.1;
    let px = cx + Math.cos(ang) * r, pz = cz + Math.sin(ang) * r;
    const footR2 = ridges ? w * 3.2 + 30 : w;
    for (let push = 0; push < 10 && !clearOfTrack(px, pz, footR2); push++) {
      r += 45;
      px = cx + Math.cos(ang) * r;
      pz = cz + Math.sin(ang) * r;
    }
    if (ridges) { pushRidge(px, pz, ang, w, h, farCol); continue; }
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

// -------------------------------------------------------------- landmarks
// One ICON per world (stage 1 of the world uplift): a single, unmistakable
// object on a chosen azimuth from the track centroid — the thing your eye
// travels to, and the answer to "which world am I in?". The city's icon (the
// Spire) is built inside buildCity; this handles the wilderness worlds.
function buildLandmarks(rng, spline, groundY, cx, cz, theme) {
  const lm = theme.landmark;
  if (!lm || lm.type === 'spire') return null;

  // Angle: explicit, or the sky's sun azimuth (the desert gate FRAMES the sun).
  const sunAz = theme.sky.sunAz || [-0.35, -0.94];
  const ang = lm.ang ?? Math.atan2(sunAz[1], sunAz[0]);
  // Push outward until the footprint clears the track (buildFarMountains rule).
  const clear = (px, pz, radius) => {
    const need = (radius + 40) ** 2;
    for (let i = 0; i < spline.n; i += 16) {
      const dx = spline.pos[i * 3] - px, dz = spline.pos[i * 3 + 2] - pz;
      if (dx * dx + dz * dz < need) return false;
    }
    return true;
  };
  let dist = lm.dist ?? 450;
  let px = cx + Math.cos(ang) * dist, pz = cz + Math.sin(ang) * dist;
  while (dist < 900 && !clear(px, pz, 120)) {
    dist += 60;
    px = cx + Math.cos(ang) * dist; pz = cz + Math.sin(ang) * dist;
  }
  // Face the track: the span axis is perpendicular to the sight line.
  const perpX = -Math.sin(ang), perpZ = Math.cos(ang);
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;

  if (lm.type === 'sunGate') {
    // The Sun Gate: two colossal tapering rock pillars + a hanging lintel —
    // the striped sun disc sits inside the opening for most of the lap.
    const S = (lm.scale ?? 1) * (dist / 430); // keep apparent size if pushed out
    const halfW = 52 * S, H = 165 * S;
    const geoms = [];
    const pillar = (side, h, lean) => {
      const g = new THREE.CylinderGeometry(11 * S, 19 * S, h, 5, 1);
      g.rotateY(rng() * Math.PI);
      g.rotateZ(lean);
      g.translate(px + perpX * halfW * side, groundY + h / 2 - 2, pz + perpZ * halfW * side);
      return bakeFlatColors(g, theme.mesaShadow);
    };
    geoms.push(pillar(-1, H, 0.05), pillar(1, H * 0.94, -0.04));
    // The lintel: a massive horizontal slab bridging the pillars, slightly tilted.
    const lg = new THREE.BoxGeometry(halfW * 2 + 34 * S, 17 * S, 24 * S);
    lg.rotateZ(0.02);
    lg.rotateY(Math.atan2(perpZ, perpX));
    lg.translate(px, groundY + H * 0.94, pz);
    geoms.push(bakeFlatColors(lg, theme.mesaShadow));
    // Rubble at the feet — it has stood here a long time.
    for (let i = 0; i < 7; i++) {
      const side = i % 2 ? 1 : -1;
      const r = (4 + rng() * 9) * S;
      const g = new THREE.DodecahedronGeometry(r, 0);
      g.translate(px + perpX * (halfW * side + (rng() - 0.5) * 30 * S),
        groundY + r * 0.4, pz + perpZ * (halfW * side + (rng() - 0.5) * 30 * S));
      geoms.push(bakeFlatColors(g, theme.rock));
    }
    const mesh = new THREE.Mesh(mergeGeoms(geoms),
      new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return { group, update: null, anchor: { x: px, z: pz } };
  }

  if (lm.type === 'lighthouse') {
    // The lighthouse: red/white banded tower at the edge of the open sea, a
    // slow sweeping beam, and a strip of cream resort towers down the shore.
    const opa = [], glo = [];
    const H = 96, R = 8.5;
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const h = H / segs;
      const r0 = R - (i / segs) * 2.6, r1 = R - ((i + 1) / segs) * 2.6;
      const g = new THREE.CylinderGeometry(r1, r0, h, 10);
      g.translate(px, groundY + h / 2 + i * h, pz);
      opa.push(bakeFlatColors(g, i % 2 ? 0xd94848 : 0xf2ede2, { rim: false }));
    }
    // Gallery + lamp room + roof.
    const gal = new THREE.CylinderGeometry(6.4, 6.4, 3.2, 10);
    gal.translate(px, groundY + H + 1.6, pz);
    opa.push(bakeFlatColors(gal, 0x2a3138, { rim: false }));
    const roof = new THREE.ConeGeometry(5.2, 7, 10);
    roof.translate(px, groundY + H + 8.5, pz);
    opa.push(bakeFlatColors(roof, 0xd94848, { rim: false }));
    const lampY = groundY + H + 3.8;
    const lamp = new THREE.BoxGeometry(4.6, 3.4, 4.6);
    lamp.translate(px, lampY, pz);
    glo.push(colorTint(lamp, new THREE.Color(0xfff2c8)));
    // Resort strip: cream towers along the shore arc past the lighthouse.
    for (let i = 0; i < 9; i++) {
      const a2 = ang + 0.09 + i * 0.028 + rng() * 0.012;
      const rr = dist + 40 + rng() * 60;
      const w = 13 + rng() * 9, h = 22 + rng() * 26, d = 10 + rng() * 8;
      const g = new THREE.BoxGeometry(w, h, d);
      g.rotateY(-a2);
      g.translate(cx + Math.cos(a2) * rr, groundY + h / 2, cz + Math.sin(a2) * rr);
      opa.push(bakeFlatColors(g, i % 3 === 2 ? 0xd9ccb4 : 0xe9e2d2, { rim: false }));
    }
    const mesh = new THREE.Mesh(mergeGeoms(opa),
      new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    group.add(mesh);
    const glowMesh = new THREE.Mesh(mergeGeoms(glo), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glowMesh.frustumCulled = false; glowMesh.matrixAutoUpdate = false;
    group.add(glowMesh);
    // The beam: one long horizontal cone on a pivot at the lamp, sweeping the
    // sea — same recipe as the city searchlights (cheap, low opacity).
    const beamGeo = new THREE.CylinderGeometry(8, 0.6, 240, 6, 1, true);
    beamGeo.translate(0, 120, 0);
    beamGeo.rotateZ(Math.PI / 2 + 0.04); // near-horizontal
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0xfff2c8, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      side: THREE.DoubleSide,
    }));
    beam.frustumCulled = false;
    const pivot = new THREE.Group();
    pivot.position.set(px, lampY, pz);
    pivot.add(beam);
    group.add(pivot);
    return { group, update: (t) => { pivot.rotation.y = t * 0.35; } };
  }

  return null;
}

// ----------------------------------------------------------------- rock cut
// The desert's pass-through moment: ~230m of the lap walled in by tall
// stratified rock 13-22m off the road edge, with natural stone arches OVER
// the road — compression and shadow, then release back out toward the sun.
// Site is picked deterministically: the straightest, flattest stretch that
// avoids jumps, forks and the start gantry. Opaque merged geometry that
// OCCLUDES sky = fill-neutral or better.
function buildRockCut(rng, spline, groundY, theme) {
  const L = spline.length;
  const WIN = 230;
  const inSpan = (s, a, b) => {
    const rel = ((s - a) % L + L) % L;
    const span = ((b - a) % L + L) % L;
    return rel < span;
  };
  const badAt = (s) => {
    for (const j of spline.jumps || []) if (inSpan(s, j.takeoff - 50, j.end + 50)) return true;
    for (const sp of spline.splits || []) if (inSpan(s, sp.s0 - 40, sp.s1 + 40)) return true;
    return false;
  };
  let bestS = -1, bestScore = Infinity;
  for (let s0 = 140; s0 < L - WIN - 60; s0 += 15) {
    let score = 0, ok = true;
    for (let d = 0; d <= WIN; d += 12) {
      const s = s0 + d;
      if (badAt(s)) { ok = false; break; }
      const i = Math.floor(s / spline.step) % spline.n;
      score += Math.abs(spline.kappa[i]) * 60 + Math.abs(spline.bank[i]);
    }
    if (ok && score < bestScore) { bestScore = score; bestS = s0; }
  }
  if (bestS < 0) return null;

  const f = makeFrame();
  const geoms = [];
  const strataCol = [theme.mesaShadow, theme.mesaLit, theme.rock];
  // A wall/pillar hugs THIS stretch by design, but other parts of the lap may
  // sweep right past it — reject anything close to track samples OUTSIDE the
  // cut window (with margin for the object footprint).
  const clearOfRest = (px, pz, radius) => {
    const need = (radius + spline.width[0] + 6) ** 2;
    for (let i = 0; i < spline.n; i += 6) {
      const ss = i * spline.step;
      if (inSpan(ss, bestS - 40, bestS + WIN + 40)) continue;
      const dx = spline.pos[i * 3] - px, dz = spline.pos[i * 3 + 2] - pz;
      if (dx * dx + dz * dz < need) return false;
    }
    return true;
  };

  // Canyon walls: stacked strata slabs marching down both sides, taller than
  // the road so the sky narrows to a ribbon.
  for (const side of [-1, 1]) {
    for (let d = 0; d <= WIN; d += 15 + rng() * 5) {
      const s = bestS + d;
      spline.frameAt(s, f);
      const lat = f.width + 13 + rng() * 9;
      const px = f.pos.x + f.R.x * side * lat;
      const pz = f.pos.z + f.R.z * side * lat;
      if (!clearOfRest(px, pz, 16)) continue; // another lap segment sweeps through here
      const yaw = Math.atan2(f.T.x, f.T.z) + (rng() - 0.5) * 0.16;
      const roadH = Math.max(0, f.pos.y - groundY);
      let y = groundY;
      const total = roadH + 20 + rng() * 16;
      const layers = 2 + Math.floor(rng() * 2);
      let w = 17 + rng() * 8, dep = 9 + rng() * 6;
      for (let k = 0; k < layers; k++) {
        const h = total * (k === layers - 1 ? 0.3 : 0.7 / (layers - 1)) * (0.85 + rng() * 0.3);
        const g = new THREE.BoxGeometry(dep, h, w);
        g.rotateY(yaw);
        g.translate(px + (rng() - 0.5) * 2.5, y + h / 2, pz + (rng() - 0.5) * 2.5);
        geoms.push(bakeFlatColors(g, strataCol[k % strataCol.length], { rim: k === layers - 1 }));
        y += h * (0.92 + rng() * 0.06);
        w *= 0.78 + rng() * 0.12;
        dep *= 0.8 + rng() * 0.1;
      }
    }
  }

  // Natural stone arches OVER the road — raw rock, no neon (gameplay language
  // stays on the track itself). Pillars on both verges + a fat irregular
  // lintel with hanging chunks. Clearance: lintel underside ~13m over the deck.
  const archAt = [bestS + 46, bestS + 122, bestS + 196];
  for (const s of archAt) {
    spline.frameAt(s, f);
    // The whole arch (pillars + lintel) must clear every other lap segment.
    if (!clearOfRest(f.pos.x, f.pos.z, f.width + 12)) continue;
    const yaw = Math.atan2(f.R.x, f.R.z);
    const roadY = f.pos.y;
    const half = f.width + 5.5;
    for (const side of [-1, 1]) {
      const px = f.pos.x + f.R.x * side * half;
      const pz = f.pos.z + f.R.z * side * half;
      const h = (roadY - groundY) + 15 + rng() * 3;
      const g = new THREE.CylinderGeometry(2.6 + rng(), 4.2 + rng() * 1.4, h, 5);
      g.rotateY(rng() * Math.PI);
      g.translate(px, groundY + h / 2, pz);
      geoms.push(bakeFlatColors(g, theme.mesaShadow, { rim: false }));
    }
    // two stacked lintel slabs, slightly offset — reads as weathered rock
    for (let k = 0; k < 2; k++) {
      const lh = 4.5 + rng() * 2.5;
      const g = new THREE.BoxGeometry(9 + rng() * 4, lh, half * 2 + 7);
      g.rotateY(yaw + (rng() - 0.5) * 0.06);
      g.translate(
        f.pos.x + (rng() - 0.5) * 2, roadY + 13.5 + k * (lh * 0.9) + lh / 2,
        f.pos.z + (rng() - 0.5) * 2);
      geoms.push(bakeFlatColors(g, k ? theme.mesaLit : theme.mesaShadow, { rim: k === 1 }));
    }
    // hanging chunks under the lintel near the pillars
    for (const side of [-1, 1]) {
      if (rng() < 0.4) continue;
      const r = 1.6 + rng() * 1.6;
      const g = new THREE.DodecahedronGeometry(r, 0);
      g.translate(
        f.pos.x + f.R.x * side * (half - 3.5), roadY + 12.2 - r * 0.4,
        f.pos.z + f.R.z * side * (half - 3.5));
      geoms.push(bakeFlatColors(g, theme.rock, { rim: false }));
    }
  }

  const mesh = new THREE.Mesh(mergeGeoms(geoms),
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ------------------------------------------------------------ rock strata
// "Texture" for big rock masses, for free: after the flat bake, modulate the
// vertex colours in horizontal sediment bands (random per-band brightness +
// occasional rim/sand accent band). Kills the untextured-block look up close.
function bakeStrata(geom, rng2, baseY, bandH, accentA, accentB) {
  const pos = geom.getAttribute('position');
  const col = geom.getAttribute('color');
  if (!col) return geom;
  const ca = new THREE.Color(accentA), cb = new THREE.Color(accentB), c = new THREE.Color();
  const bands = [];
  for (let i = 0; i < 28; i++) {
    bands.push({ m: 0.8 + rng2() * 0.32, acc: rng2() < 0.3 ? (rng2() < 0.5 ? 1 : 2) : 0 });
  }
  // Per-FACE banding (centroid Y): per-vertex bands interpolate into a muddy
  // gradient across the big low-poly faces — flat faces read as crisp strata.
  const step = geom.index ? 1 : 3;
  for (let i = 0; i + step - 1 < pos.count; i += step) {
    let yc = 0;
    for (let k = 0; k < step; k++) yc += pos.getY(i + k);
    yc /= step;
    const bi = Math.max(0, Math.min(27, Math.floor((yc - baseY) / bandH)));
    const b = bands[bi];
    for (let k = i; k < i + step; k++) {
      c.setRGB(col.getX(k), col.getY(k), col.getZ(k)).multiplyScalar(b.m);
      if (b.acc === 1) c.lerp(ca, 0.38); else if (b.acc === 2) c.lerp(cb, 0.26);
      col.setXYZ(k, c.r, c.g, c.b);
    }
  }
  return geom;
}

// -------------------------------------------------------------- lap zones
// Monument-valley rhythm: a few dense CLUSTERS around the lap with genuinely
// empty flats between them. Deterministic (own seed) so mesas, cacti and
// anchor buttes all agree on where the zones are.
function lapZones(seed, length, n = 5) {
  const zr = mulberry32(seed);
  const zones = [];
  for (let i = 0; i < n; i++) {
    zones.push({ s: ((i + 0.15 + zr() * 0.7) / n) * length, span: 90 + zr() * 130, w: 0.65 + zr() * 0.35 });
  }
  return zones;
}
function zoneDensity(zones, s, length, base = 0.1) {
  let d = base;
  for (const z of zones) {
    let ds = Math.abs(s - z.s) % length;
    if (ds > length / 2) ds = length - ds;
    d = Math.max(d, z.w * Math.exp(-(ds * ds) / (2 * z.span * z.span)));
  }
  return d;
}
const ZONE_SEED = 9001;

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
    // Height segments matter: strata bands are vertex colours, so the side
    // walls need vertex rows to band across (1 segment = one giant flat quad).
    [() => new THREE.ConeGeometry(1, 2.2, 4, 6), 2.2, 0],          // pyramid spire
    [() => new THREE.CylinderGeometry(0.55, 1, 1.4, 6, 5), 1.4, 0],// frustum mesa
    [() => new THREE.CylinderGeometry(0.18, 0.42, 3.2, 5, 7), 3.2, 0], // needle
    [() => new THREE.BoxGeometry(1.4, 1.1, 1, 1, 4, 1), 1.1, 0],   // block
    [() => new THREE.CylinderGeometry(0.9, 1.05, 0.7, 7, 3), 0.7, 0],  // flat-top
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
  // Monument rhythm: cluster the field into zones, and seed each of the two
  // strongest zones with a pair of ANCHOR buttes — the nameable giants.
  const zones = theme.monumentZones ? lapZones(ZONE_SEED, spline.length) : null;
  if (zones) {
    const top = [...zones].sort((a, b) => b.w - a.w).slice(0, 2);
    for (const z of top) {
      for (let k = 0; k < 2; k++) {
        spline.frameAt(z.s + (k - 0.5) * 90, f);
        const side = k % 2 ? -1 : 1;
        const dist = 150 + rng() * 80;
        const px = f.pos.x + f.R.x * side * dist;
        const pz = f.pos.z + f.R.z * side * dist;
        const scale = 78 + rng() * 30; // monumental flat-top butte
        // Clearance must include the butte's own footprint (radius ≈ scale) —
        // checked against the WHOLE spline, not just this zone.
        const need = (scale + 34) ** 2;
        let ok = true;
        for (let i = 0; i < spline.n; i += 8) {
          const dx = spline.pos[i * 3] - px, dz = spline.pos[i * 3 + 2] - pz;
          if (dx * dx + dz * dz < need) { ok = false; break; }
        }
        if (!ok) continue;
        const g = new THREE.CylinderGeometry(0.62, 1, 1.1, 7, 8);
        g.scale(scale, scale * (0.55 + rng() * 0.2), scale);
        g.rotateY(rng() * Math.PI * 2);
        const bb = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position'));
        g.translate(px, groundY - bb.min.y - 0.5, pz);
        const baked = bakeFlatColors(g, theme.mesaLit, { shadow: theme.mesaShadow });
        bakeStrata(baked, rng, groundY, Math.max(4, scale * 0.14), theme.mesaRim, theme.ground);
        geoms.push(baked);
        placed.push([px, pz, scale]);
      }
    }
  }
  for (let t = 0; t < tries && geoms.length < MAX; t++) {
    const s = rng() * spline.length;
    // Rhythm gate: most spawns land inside a zone; the flats stay EMPTY.
    if (zones && rng() > zoneDensity(zones, s, spline.length)) continue;
    spline.frameAt(s, f);
    const side = rng() < 0.5 ? -1 : 1;
    // Big forms keep their distance: min distance grows with footprint so a
    // scale-50 monolith never looms right over the verge.
    const scale = towers ? 8 + rng() * 26 : 10 + rng() * 42;
    const dist = 28 + scale * 0.9 + rng() * 200;
    const px = f.pos.x + f.R.x * side * dist + (rng() - 0.5) * 30;
    const pz = f.pos.z + f.R.z * side * dist + (rng() - 0.5) * 30;
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
    const bakedMesa = bakeFlatColors(g, base, { shadow: theme.mesaShadow });
    if (!towers) bakeStrata(bakedMesa, rng, groundY, Math.max(3, scale * ys * 0.16), theme.mesaRim, theme.ground);
    geoms.push(bakedMesa);
    if (islands) {
      // A beach ring at the waterline.
      const beach = new THREE.CylinderGeometry(scale * 1.12, scale * 1.22, 0.6, 8);
      beach.rotateY(rng() * Math.PI);
      beach.translate(px, groundY + 0.25, pz);
      geoms.push(bakeFlatColors(beach, theme.sand, { rim: false }));
      // Stage-3: a surf line where the beach meets the lagoon — a thin pale
      // ring floating just above the water so the land/water edge never reads
      // as a knife cut. Squashed + rotated per island so no two match.
      const foam = new THREE.RingGeometry(scale * 1.2, scale * 1.36, 8, 1);
      foam.rotateX(-Math.PI / 2);
      foam.scale(1, 1, 0.86 + rng() * 0.22);
      foam.rotateY(rng() * Math.PI);
      foam.translate(px, groundY + 0.05, pz);
      geoms.push(bakeFlatColors(foam, 0xdcf7ee, { rim: false }));
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
      // Bolted to the shoulder: follow the road frame (bank and all), base
      // sunk slightly into the verge instead of hovering world-vertical.
      v.copy(f.pos).addScaledVector(f.R, side * off).addScaledVector(f.U, -0.25);
      m.makeBasis(f.R, f.U, f.T);
      m.setPosition(v.x + f.U.x * 1.0, v.y + f.U.y * 1.0, v.z + f.U.z * 1.0);
      body.setMatrixAt(i, m);
      m.setPosition(v.x + f.U.x * 2.35, v.y + f.U.y * 2.35, v.z + f.U.z * 2.35);
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

// --------------------------------------------------------------- roadside
// Stage-2 world uplift: the NEAR band (3-27m off the wall) gets a fine-grain
// per-world ground kit, so the strip you actually read at speed isn't bare.
// One merged archetype per world -> one InstancedMesh -> one draw call, all
// opaque (zero overdraw cost). Styles: 'tufts' (dry grass + pebbles),
// 'marina' (weathered mooring posts on the lagoon), 'street' (barrier blocks
// + vent boxes, aligned with the road). Knobs: theme.roadside/roadsideCount.
function buildRoadside(rng, spline, groundY, theme) {
  const style = theme.roadside;
  const parts = [];
  if (style === 'tufts') {
    for (let i = 0; i < 3; i++) { // a dry-grass tuft: three lean blades
      const g = new THREE.ConeGeometry(0.06, 0.55 + i * 0.14, 4);
      g.rotateZ((i - 1) * 0.38 + 0.08);
      g.translate((i - 1) * 0.14, 0.28, (i % 2) * 0.1 - 0.05);
      parts.push(bakeFlatColors(g, 0xc09a52, { rim: false })); // deep straw — must read against the sand
    }
    for (const [ox, oz, r] of [[0.42, 0.18, 0.11], [-0.35, -0.2, 0.08]]) {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.translate(ox, r * 0.5, oz);
      parts.push(bakeFlatColors(g, theme.rock ?? 0xb87a58, { rim: false }));
    }
  } else if (style === 'marina') {
    const post = new THREE.CylinderGeometry(0.09, 0.11, 1.35, 5);
    post.translate(0, 0.62, 0);
    parts.push(bakeFlatColors(post, 0xf2ead8, { rim: false }));
    const cap = new THREE.CylinderGeometry(0.11, 0.11, 0.16, 5); // red tide band
    cap.translate(0, 1.28, 0);
    parts.push(bakeFlatColors(cap, 0xe8604a, { rim: false }));
    const stone = new THREE.IcosahedronGeometry(0.16, 0);        // base cleat
    stone.translate(0.24, 0.06, 0.1);
    parts.push(bakeFlatColors(stone, theme.sand ?? 0xe8d8a8, { rim: false }));
  } else { // 'street'
    const block = new THREE.BoxGeometry(1.7, 0.5, 0.42);         // jersey barrier
    block.translate(0, 0.25, 0);
    parts.push(bakeFlatColors(block, 0x3a3a56, { rim: false }));
    const stripe = new THREE.BoxGeometry(1.7, 0.09, 0.44);       // hazard lip
    stripe.translate(0, 0.52, 0);
    parts.push(bakeFlatColors(stripe, 0xffb13d, { rim: false }));
    const vent = new THREE.BoxGeometry(0.6, 0.62, 0.6);          // vent box
    vent.translate(1.6, 0.31, 0.25);
    parts.push(bakeFlatColors(vent, 0x2c2c44, { rim: false }));
    const slit = new THREE.BoxGeometry(0.62, 0.07, 0.5);         // its lit grille
    slit.translate(1.6, 0.5, 0.25);
    parts.push(bakeFlatColors(slit, 0x37e0ff, { rim: false }));
  }
  const geom = mergeGeoms(parts);
  const count = theme.roadsideCount ?? 300;
  const mesh = new THREE.InstancedMesh(geom,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), count);
  const f = makeFrame();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 4 && !placed; attempt++) {
      const s = rng() * spline.length;
      spline.frameAt(s, f);
      const side = rng() < 0.5 ? -1 : 1;
      const dist = f.width + 3 + rng() * 24;
      const rx = f.R.x, rz = f.R.z;
      const rl = Math.hypot(rx, rz) || 1;
      const x = f.pos.x + (rx / rl) * side * dist;
      const z = f.pos.z + (rz / rl) * side * dist;
      if (!clearOfTrack(spline, x, z, 2.5)) continue;   // never on another pass of the road
      p.set(x, groundY + 0.02, z);
      // Street kit runs parallel with the road it guards; nature just grows.
      const yaw = style === 'street'
        ? Math.atan2(f.T.x, f.T.z) + (rng() - 0.5) * 0.22
        : rng() * Math.PI * 2;
      q.setFromAxisAngle(Y, yaw);
      const size = style === 'street' ? 0.9 + rng() * 0.4 : 0.8 + rng() * 1.2;
      sc.setScalar(size);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      placed = true;
    }
    if (!placed) { sc.setScalar(0); m.compose(p, q, sc); mesh.setMatrixAt(i, m); }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
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
      parts.push(bakeFlatColors(g, theme.floraCol ?? 0x3a2a75, { rim: false }));
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
  // Monument worlds: cacti gather into OASES on the same lap zones as the
  // buttes (same seed), leaving the empty flats truly empty.
  const zones = theme.monumentZones ? lapZones(ZONE_SEED, spline.length) : null;
  for (let i = 0; i < count; i++) {
    // Pick a spot, but reject any that lands over the track — palms are tall
    // and otherwise poke up through the surface on the inside of curves.
    let x = 0, z = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      let s = rng() * spline.length;
      if (zones) {
        let guard = 12;
        while (guard-- > 0 && rng() > zoneDensity(zones, s, spline.length, 0.06)) s = rng() * spline.length;
      }
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
// haze — the destination on the horizon. Two roles from one builder:
//   • city world  → the near/mid skyline you race under (dark towers, lit
//     windows against the blue hour);
//   • desert world → a distant megacity glittering in the sunset haze on the
//     horizon (theme.cityFar) — pushed out, tinted into the warm haze, warm
//     sun-caught crowns, so it reads as a shimmering skyline, not a grey wall.
// Either way every tower is kept CLEAR of the racing line (spline clearance):
// a distant cluster can spare the odd tower, but never one on the road.
function buildCity(rng, groundY, cx, cz, cityAng, theme = {}, spline = null) {
  const far = !!theme.cityFar;                    // desert borrows the skyline
  const dist = theme.cityDist ?? (far ? 780 : 600);
  const haze = theme.cityHaze ?? (far ? 0.44 : 0); // lerp toward the horizon haze
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
  // Fraction of window cells left DARK. Distant daytime city: mostly dark, so
  // the lit ones read as sparkle not a wall of light; the blue-hour city keeps
  // its dense grid (~60% lit, as before).
  const skipWin = far ? 0.8 : 0.4;

  // Atmospheric perspective: pull a colour toward the sky-horizon haze. p lets
  // the far backdrop ring melt in harder than the near ring. No-op when haze=0.
  const hazeCol = new THREE.Color(theme.sky.horizon);
  const tint = (hex, p = 1) => haze > 0
    ? new THREE.Color(hex).lerp(hazeCol, Math.min(0.85, haze * p)).getHex() : hex;
  // Sun-caught crown: warm the top vertices so the skyline glitters along its
  // upper edge instead of dying into a flat slab.
  const crownWarm = new THREE.Color(theme.mesaRim ?? 0xffc27a);
  const crownGrad = (geom, baseY, topY, amt) => {
    const pos = geom.getAttribute('position'), col = geom.getAttribute('color');
    if (!col) return geom;
    const span = Math.max(1, topY - baseY), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, Math.min(1, (pos.getY(i) - baseY) / span));
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(crownWarm, amt * t * t);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    return geom;
  };
  const bakeTower = (geom, baseHex, baseY, topY, near) =>
    crownGrad(bakeFlatColors(geom, tint(baseHex, near ? 0.72 : 1), { rim: !far }),
      baseY, topY, far ? 0.5 : 0.3);

  // Keep a footprint clear of the racing line: shove it straight away from the
  // nearest track sample until it clears, or return null so the caller drops
  // it. Cheap (samples the spline every 6th point) and only runs when spline
  // is supplied.
  const clearPush = (px, pz, foot) => {
    if (!spline) return [px, pz];
    for (let it = 0; it < 16; it++) {
      let hi = -1, hdx = 0, hdz = 0, hd2 = Infinity, hw = 0;
      for (let i = 0; i < spline.n; i += 6) {
        const dx = px - spline.pos[i * 3], dz = pz - spline.pos[i * 3 + 2];
        const need = foot + spline.width[i] + 10;
        const d2 = dx * dx + dz * dz;
        if (d2 < need * need && d2 < hd2) { hd2 = d2; hi = i; hdx = dx; hdz = dz; hw = spline.width[i]; }
      }
      if (hi < 0) return [px, pz];
      const d = Math.sqrt(hd2) || 0.001;
      const move = (foot + hw + 12) - d;
      px += (hdx / d) * move; pz += (hdz / d) * move;
    }
    return null; // hemmed in on both sides — better gone than on the road
  };

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
          if (rng() < skipWin) continue; // most cells dark
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

  // A blinking comms mast + beacon tip on top of a tower/tier at (px, topY, pz).
  const addMast = (px, topY, pz) => {
    const sh = 12 + rng() * 26;
    const mast = new THREE.BoxGeometry(0.9, sh, 0.9);
    mast.translate(px, topY + sh / 2, pz);
    opa.push(bakeFlatColors(mast, 0x120a2c, { rim: false }));
    const tip = new THREE.BoxGeometry(2.4, 2.4, 2.4);
    tip.translate(px, topY + sh, pz);
    glo.push(colorTint(tip, beacon[Math.floor(rng() * beacon.length)]));
  };

  // THE SPIRE — the world icon: one supertall anchoring the skyline hierarchy
  // (1 icon / a few supertalls / a mass of mid-rise, instead of uniform noise).
  // ONLY in the city world — the desert borrows this skyline for its horizon
  // and must not inherit the icon.
  if ((theme.landmark && theme.landmark.type) === 'spire') {
    const s = clearPush(ccx, ccz, 60) || [ccx, ccz];
    const sx = s[0], sz = s[1];
    const shafts = [[36, 0.52], [26, 0.30], [16, 0.18]]; // [width, height share]
    const H = 335;
    let y = groundY;
    for (const [w, share] of shafts) {
      const h = H * share;
      const box = new THREE.BoxGeometry(w, h, w * 0.9);
      box.translate(sx, y + h / 2, sz);
      opa.push(bakeTower(box, 0x1d0f44, groundY, groundY + H, true));
      glo.push(windowGeo(w, h, w * 0.9, 0, sx, y + h / 2, sz));
      y += h;
    }
    // Vertical neon seams up two faces + crown mast + beacon.
    for (const side of [-1, 1]) {
      const seam = new THREE.BoxGeometry(1.4, H * 0.86, 0.8);
      seam.translate(sx + side * (36 / 2 + 0.6), groundY + H * 0.45, sz);
      glo.push(colorTint(seam, side < 0 ? cl : cr));
    }
    const mast = new THREE.BoxGeometry(1.4, 42, 1.4);
    mast.translate(sx, y + 21, sz);
    opa.push(bakeFlatColors(mast, 0x120a2c, { rim: false }));
    const tip = new THREE.BoxGeometry(3.2, 3.2, 3.2);
    tip.translate(sx, y + 42, sz);
    glo.push(colorTint(tip, new THREE.Color(0xffffff)));
  }

  const n = 44;
  const nearProb = far ? 0.24 : 0.42; // the far city is mostly a distant band
  for (let i = 0; i < n; i++) {
    // Two depth rings: a nearer ring of bigger towers + a far backdrop ring.
    const near = rng() < nearProb;
    const rr = near ? 60 + rng() * 110 : 170 + rng() * 150; // keep clear of the Spire base
    const a = rng() * Math.PI * 2;
    let px = ccx + Math.cos(a) * rr;
    let pz = ccz + Math.sin(a) * rr * 0.7;
    const w = (near ? (far ? 18 : 24) : 14) + rng() * (near ? (far ? 20 : 26) : 20);
    const d = (near ? (far ? 18 : 24) : 14) + rng() * (near ? (far ? 20 : 26) : 20);
    // Skyline hierarchy: the first few are supertalls, the rest cap at mid-rise
    // so the Spire and its lieutenants OWN the silhouette.
    let h = (near ? (far ? 62 : 80) : 50) + rng() * (near ? (far ? 92 : 115) : 90);
    if (i < 4) h = (far ? 150 : 195) + rng() * 60;
    const rot = rng() * 0.6;
    const foot = Math.max(w, d) * 0.62 + 6;
    const pushed = clearPush(px, pz, foot);
    if (!pushed) continue;              // couldn't clear the racing line → drop it
    px = pushed[0]; pz = pushed[1];
    const topY = groundY + h;
    const arch = rng();
    if (arch < 0.32) {
      // SETBACK ZIGGURAT — tiers narrowing upward: the classic skyline profile.
      const tiers = 2 + (rng() < 0.5 ? 1 : 0);
      let y = groundY, tw = w, td = d;
      for (let k = 0; k < tiers; k++) {
        const th = h * (k === 0 ? 0.52 : 0.48 / (tiers - 1)) * (0.85 + rng() * 0.2);
        const box = new THREE.BoxGeometry(tw, th, td);
        box.rotateY(rot); box.translate(px, y + th / 2, pz);
        opa.push(bakeTower(box, 0x190d3c, groundY, topY, near));
        if (k === 0) glo.push(windowGeo(tw, th, td, rot, px, y + th / 2, pz));
        y += th; tw *= 0.66 + rng() * 0.1; td *= 0.66 + rng() * 0.1;
      }
      if (rng() < (far ? 0.7 : 0.5)) addMast(px, y, pz);
    } else if (arch < 0.58) {
      // TAPERED CROWN — box body under a 4-sided pyramid cap (a pointed spire).
      const bodyH = h * 0.8;
      const body = new THREE.BoxGeometry(w, bodyH, d);
      body.rotateY(rot); body.translate(px, groundY + bodyH / 2, pz);
      opa.push(bakeTower(body, 0x190d3c, groundY, topY, near));
      glo.push(windowGeo(w, bodyH, d, rot, px, groundY + bodyH / 2, pz));
      const cap = new THREE.ConeGeometry(Math.max(w, d) * 0.6, h - bodyH, 4, 1);
      cap.rotateY(rot + Math.PI / 4); cap.translate(px, groundY + bodyH + (h - bodyH) / 2, pz);
      opa.push(bakeTower(cap, 0x190d3c, groundY, topY, near));
      if (far && rng() < 0.5) addMast(px, topY, pz); // a beacon crowning the spire
    } else {
      // PLAIN SLAB — the mass of mid-rise, with the odd comms mast on the talls.
      const tower = new THREE.BoxGeometry(w, h, d);
      tower.rotateY(rot); tower.translate(px, groundY + h / 2, pz);
      opa.push(bakeTower(tower, 0x190d3c, groundY, topY, near));
      glo.push(windowGeo(w, h, d, rot, px, groundY + h / 2, pz));
      if (h > (far ? 90 : 150) && rng() < (far ? 0.7 : 0.6)) addMast(px, topY, pz);
    }
    // Vertical neon seam up a near tower's edge — a little life in the near
    // field (city world only; the far desert city stays a clean silhouette).
    if (near && !far && rng() < 0.3) {
      const seam = new THREE.BoxGeometry(1.0, h * 0.8, 0.7);
      seam.rotateY(rot); seam.translate(px + Math.cos(rot) * (w / 2 + 0.4), groundY + h * 0.44, pz - Math.sin(rot) * (w / 2 + 0.4));
      glo.push(colorTint(seam, rng() < 0.5 ? cl : cr));
    }
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeoms(opa), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })));
  const glowMesh = new THREE.Mesh(mergeGeoms(glo), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: far ? 0.5 : 0.62,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glowMesh.renderOrder = 1;
  g.add(glowMesh);
  g.traverse((o) => { o.frustumCulled = false; o.matrixAutoUpdate = false; });
  return g;
}

// ----------------------------------------------------------- ambient life
// Stage-4 world uplift: one moving far-field system per world, so the ground
// plane is never static. All parametric on absolute time (render path,
// deterministic), tiny screen coverage, 1-3 draws per world.

// Desert: slow-wandering dust devils — tall sand columns spinning far off the
// racing line, drifting a lazy figure around their anchor.
function buildDustDevils(rng, spline, groundY, cx, cz, count) {
  const group = new THREE.Group();
  const devils = [];
  for (let i = 0; i < count; i++) {
    let x = cx, z = cz;
    for (let a = 0; a < 12; a++) {
      const ang = rng() * Math.PI * 2, r = 260 + rng() * 380;
      x = cx + Math.cos(ang) * r; z = cz + Math.sin(ang) * r;
      if (clearOfTrack(spline, x, z, 60)) break;
    }
    const geom = new THREE.CylinderGeometry(3.0, 0.7, 30, 6, 3, true);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color: 0xd8b06a, transparent: true, opacity: 0.34,
      depthWrite: false, fog: true, side: THREE.DoubleSide,
    }));
    mesh.position.set(x, groundY + 15, z);
    mesh.frustumCulled = false;
    group.add(mesh);
    devils.push({ mesh, x, z, ph: rng() * Math.PI * 2, spin: 2.2 + rng() * 1.4 });
  }
  return {
    group,
    update(t) {
      for (const d of devils) {
        d.mesh.rotation.y = t * d.spin;
        d.mesh.rotation.z = 0.06 * Math.sin(t * 0.31 + d.ph);            // a lazy lean
        d.mesh.position.x = d.x + 46 * Math.sin(t * 0.043 + d.ph);       // slow wander
        d.mesh.position.z = d.z + 46 * Math.sin(t * 0.061 + d.ph * 1.7);
      }
    },
  };
}

// Coast: small sailboats gliding wide circles on the far lagoon.
function buildSails(rng, spline, groundY, cx, cz, count) {
  const hull = new THREE.BoxGeometry(0.9, 0.5, 3.4);
  hull.translate(0, 0.25, 0);
  const sail = new THREE.CylinderGeometry(0.02, 1.35, 4.4, 3);
  sail.translate(0, 2.6, 0.2);
  const geom = mergeGeoms([
    bakeFlatColors(hull, 0x2b3a55, { rim: false }),
    bakeFlatColors(sail, 0xf6f0e2, { rim: false }),
  ]);
  const mesh = new THREE.InstancedMesh(geom,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), count);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const boats = [];
  for (let i = 0; i < count; i++) {
    let ox = cx, oz = cz;
    for (let a = 0; a < 12; a++) {
      const ang = rng() * Math.PI * 2, r = 420 + rng() * 420;
      ox = cx + Math.cos(ang) * r; oz = cz + Math.sin(ang) * r;
      if (clearOfTrack(spline, ox, oz, 90)) break;
    }
    boats.push({ ox, oz, r: 40 + rng() * 60, w: (0.008 + rng() * 0.01) * (rng() < 0.5 ? -1 : 1), ph: rng() * Math.PI * 2 });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  const e = new THREE.Euler();
  return {
    mesh,
    update(t) {
      for (let i = 0; i < boats.length; i++) {
        const b = boats[i];
        const a = b.ph + t * b.w;
        p.set(b.ox + Math.cos(a) * b.r, groundY + 0.15, b.oz + Math.sin(a) * b.r);
        e.set(0, -a - Math.sign(b.w) * Math.PI / 2, 0.05 * Math.sin(t * 0.9 + b.ph)); // heel sway
        q.setFromEuler(e);
        m.compose(p, q, sc);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// City: one ad blimp circling the skyline, lit banner on its flank.
function buildBlimp(rng, groundY, cx, cz) {
  const body = new THREE.IcosahedronGeometry(9, 1);
  body.scale(2.4, 1, 1);
  const gondola = new THREE.BoxGeometry(6, 2, 3);
  gondola.translate(0, -9.6, 0);
  const opaque = mergeGeoms([
    bakeFlatColors(body, 0x3a3654, { rim: false }),
    bakeFlatColors(gondola, 0x262238, { rim: false }),
  ]);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(opaque, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })));
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(16, 4.5, 19.4),
    new THREE.MeshBasicMaterial({
      color: 0xff2ec8, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
  group.add(banner);
  group.traverse((o) => { o.frustumCulled = false; });
  const ph = rng() * Math.PI * 2;
  return {
    group,
    update(t) {
      const a = ph + t * 0.011;
      group.position.set(cx + Math.cos(a) * 520, groundY + 165, cz + Math.sin(a) * 520);
      group.rotation.y = -a - Math.PI / 2;
      banner.material.opacity = 0.4 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.7)); // slow ad flicker
    },
  };
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
function buildBirds(rng, spline, groundY, opts = {}) {
  const FLOCKS = 2, PER = 7, N = FLOCKS * PER;
  // A simple chevron silhouette.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1.1, 0, 0.45, 0, 0, 0, 0, 0.1, 0.22,
    0, 0, 0, 1.1, 0, 0.45, 0, 0.1, 0.22,
  ]), 3));
  const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({
    color: opts.color ?? 0x14333d, side: THREE.DoubleSide, fog: true,
  }), N);
  mesh.frustumCulled = false;
  const f = makeFrame();
  const flocks = [];
  for (let k = 0; k < FLOCKS; k++) {
    // Raptors: the first flock circles the world icon (the Sun Gate) high up —
    // scale-tellers that make the monument read as COLOSSAL.
    if (k === 0 && opts.anchor) {
      flocks.push({
        cx: opts.anchor.x, cz: opts.anchor.z,
        y: groundY + 105 + rng() * 25,
        r: 55 + rng() * 30,
        sp: (0.035 + rng() * 0.02) * (rng() < 0.5 ? 1 : -1),
        ph: rng() * Math.PI * 2,
      });
      continue;
    }
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
