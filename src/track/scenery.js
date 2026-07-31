// Sky dome (gradient + striped synthwave sun + stars + clouds, all in-shader),
// ground, far mountain silhouettes, instanced mesas, neon pylons, holo arches,
// start gantry. No lights anywhere: quantized vertex-color bake.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TUNING } from '../config.js';
import { makeFrame } from './spline.js';
import { buildTerrain } from './terrain.js';
import { buildBillboardAtlas } from '../ui/logos.js';

let _adAtlas = null; // built once, shared across tracks
function adAtlas() { return _adAtlas || (_adAtlas = buildBillboardAtlas()); }

// A soft round falloff for the lighthouse's lamp flare — a bare sprite is a
// square, and a square does not read as a light. Built fresh per world rather
// than cached in the module: tearing a world down disposes every material's
// map, so a shared texture would be freed out from under the next build.
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,246,214,0.72)');
  g.addColorStop(0.55, 'rgba(255,214,140,0.18)');
  g.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The direction every solid in the world is shaded from. It has to agree with
// where the SKY draws its sun, and for one world it did not: three themes leave
// `sky.sunAz` unset and inherit a default that happens to sit within a degree
// of TUNING.SUN_DIR, but the frost world sets its own — and was 60 degrees off.
// Every rock, spruce, mesa and grandstand on Aurora Pass, Avalanche Run and
// Moonlit Mile was lit from one side while the sky's light source sat well
// round to the other. Flat shading hides a lot, which is why it went unnoticed.
//
// The ELEVATION stays at the tuned value; only the azimuth follows the theme.
const SUN_DIR = new THREE.Vector3(...TUNING.SUN_DIR).normalize();
const SUN_ELEV = TUNING.SUN_DIR[1];
const SUN_XZ = Math.hypot(TUNING.SUN_DIR[0], TUNING.SUN_DIR[2]);
const SKY_AZ_DEFAULT = [-0.35, -0.94];   // what buildSky uses when a theme omits sunAz

// The bake tints are theme-dependent; buildScenery sets them before building.
let BAKE_RIM = TUNING.COL.MESA_RIM;
let BAKE_SHADOW_TINT = TUNING.COL.GROUND;
let BAKE_WARM = 0xffd9a0;
export function setBakeTheme(rimHex, shadowTintHex, warmHex, sunAz) {
  BAKE_RIM = rimHex;
  BAKE_SHADOW_TINT = shadowTintHex;
  BAKE_WARM = warmHex ?? 0xffd9a0;
  const az = sunAz || SKY_AZ_DEFAULT;
  const l = Math.hypot(az[0], az[1]) || 1;
  SUN_DIR.set((az[0] / l) * SUN_XZ, SUN_ELEV, (az[1] / l) * SUN_XZ).normalize();
}

// Deterministic hash from a world position — the same vertex always gets the
// same value, so nothing shimmers between frames or between rebuilds.
function vhash(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// Quantized 3-step flat-shade bake — the Horizon Chase tell — PLUS the two
// things that stop an untextured world reading as unfinished.
//
// The 3-step directional term alone paints every triangle ONE solid colour, and
// a big surface built from coplanar triangles collapses into a single dead
// fill. That flatness is what reads as "no textures", not the absence of image
// maps. Two fixes, both baked at build time, so they cost exactly nothing per
// frame and add no fill, no draws and no memory beyond the colours already
// being written:
//
//   GRADIENT — each VERTEX gets its own colour rather than each face, shaded by
//     height within the object. Dark at the base, lighter toward the top: fake
//     ambient occlusion plus skylight. This alone turns a flat mesa wall into a
//     surface with depth, because the colour now varies ACROSS a triangle.
//   GRAIN — a tiny deterministic per-vertex hash breaks the remaining large
//     even areas, the way a subtle noise texture would, at zero cost.
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
  const v = new THREE.Vector3();
  const tint = new THREE.Color();

  // Object-local height range, for the gradient. Flat objects (a decal, a
  // ribbon) get no gradient — dividing by a near-zero span would blow it up.
  let loY = Infinity, hiY = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    if (y < loY) loY = y;
    if (y > hiY) hiY = y;
  }
  const span = hiY - loY;
  const grad = (opts.gradient ?? 0.30) * (span > 0.35 ? 1 : 0);
  const grain = opts.grain ?? 0.045;

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
      v.fromBufferAttribute(pos, i + j);
      // Height gradient: -grad at the base, +grad*0.55 at the top. Weighted
      // toward darkening, because occlusion is the half the eye reads as form.
      const h = span > 0 ? (v.y - loY) / span : 0.5;
      let k = 1 + grad * (h * 1.55 - 1);
      // Grain: deterministic, symmetric around 1, small enough to read as
      // surface rather than as noise.
      k *= 1 + (vhash(v.x, v.y, v.z) - 0.5) * grain;
      tint.copy(col).multiplyScalar(k);
      colors[(i + j) * 3] = tint.r;
      colors[(i + j) * 3 + 1] = tint.g;
      colors[(i + j) * 3 + 2] = tint.b;
    }
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.deleteAttribute('normal');
  geom.deleteAttribute('uv');
  return geom;
}

// ------------------------------------------------------------------- wind
// Nothing in the world moved unless it was an animated prop with its own
// update(). Every plant, tuft and frond on twelve tracks stood in dead air,
// and a still landscape is the fastest way to make a detailed one read as a
// diorama — the eye notices the ABSENCE of motion long before it counts
// polygons.
//
// This is the cheapest possible fix: a vertex-shader displacement injected
// into the materials that should bend, weighted by the vertex's own height so
// bases stay planted and tips travel. No new draws, no new triangles, no CPU
// work beyond one uniform write a frame for the whole world.
const WIND = [];  // live uniform sets — reset per world build, see below

// The world's height function, set per build. Module-level for the same reason
// WIND is: every builder in this file already takes `groundY` as a scalar, and
// threading a function through a dozen signatures to say "the ground moved"
// would be a bigger change than the feature. Null on worlds with no relief, in
// which case groundAt() is exactly the old constant.
let TERRAIN = null;
function groundAt(groundY, x, z) {
  return TERRAIN ? groundY + TERRAIN.h(x, z) : groundY;
}

// On a water world the ONLY dry land is the islands. Every scatterer in this
// file plants against groundAt(), which there is the lagoon surface — so
// palms, rocks and scrub all stood in open water until this existed. The
// terrain block does displace the disc, but on a water world that just makes
// the WATER undulate; a raised bump is not a sandbar.
//
// Returns a picker: (bandLo, bandHi) -> [x, z] somewhere on the ring between
// bandLo*r and bandHi*r of a randomly chosen island, weighted by island area,
// re-rolled if it lands inside a neighbouring island's body (islands overlap).
// Every archetype's horizontal radius is exactly r and the beach cylinder runs
// 1.12-1.22 r, so band 1.0-1.2 is sand and 1.2-1.5 is shallows.
// Surface height on an island at a world (x, z), from the height field
// rasterised at build time. Returns null where the field has no coverage — the
// caller must treat that as "no ground here" rather than guessing, because
// guessing the water level is exactly what buried palms inside hillsides.
function islandHeightAt(is, x, z) {
  if (!is.grid) return null;
  const gi = Math.floor((x - is.ox) / is.cell);
  const gj = Math.floor((z - is.oz) / is.cell);
  if (gi < 0 || gj < 0 || gi >= is.gn || gj >= is.gn) return null;
  const y = is.grid[gj * is.gn + gi];
  return Number.isFinite(y) ? y : null;
}

// The highest island surface at (x, z), across every island — or null if none
// covers the point. Taking the MAX is what makes burial impossible: a spot
// picked from island A that happens to lie inside taller island B resolves to
// B's surface, so the palm stands on B instead of inside it. Every earlier
// attempt tried to detect and reject that case with x/z heuristics and every
// one of them missed.
function topSurfaceAt(islands, x, z) {
  let best = null;
  for (const is of islands) {
    const y = islandHeightAt(is, x, z);
    if (y !== null && (best === null || y > best)) best = y;
  }
  return best;
}

function makeIslandPicker(rng, islands, fraction = 1) {
  const planted = [...islands].sort((a, b) => b.r - a.r)
    .slice(0, Math.max(1, Math.round(islands.length * fraction)));
  const cdf = [];
  let acc = 0;
  for (const is of planted) { acc += is.r * is.r; cdf.push(acc); }
  // Returns {x, z, u, is, clear} — the island is handed back so a caller that
  // wants to plant ON the slope can ask islandTopAt() for the surface height
  // there, and `clear` says whether the spot ended up free of every OTHER
  // island's body. It matters: islands overlap heavily, so a point well inside
  // one island's footprint is often inside a taller neighbour too, and the
  // re-roll runs out of attempts often enough that silently keeping the last
  // try buried a third of the palms — up to 54 metres down.
  return (bandLo, bandHi) => {
    let x = 0, z = 0, u = 0, is = planted[0], clear = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const t = rng() * cdf[cdf.length - 1];
      let lo = 0, hi = cdf.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < t) lo = mid + 1; else hi = mid; }
      is = planted[lo];
      const a = rng() * Math.PI * 2;
      u = bandLo + rng() * (bandHi - bandLo);
      x = is.x + Math.cos(a) * is.r * u;
      z = is.z + Math.sin(a) * is.r * u;
      let buried = false;
      for (const other of islands) {
        if (other === is) continue;
        if (Math.hypot(x - other.x, z - other.z) < other.r * 1.24) { buried = true; break; }
      }
      if (!buried) { clear = true; break; }
    }
    return { x, z, u, is, clear };
  };
}

// Contact shading. Nothing in the world was GROUNDED: ships have a blob shadow
// and scenery had nothing, so every large form sat on the sand like a decal.
// Now that the ground has relief it was the most conspicuous absence left.
//
// Big forms register a footprint here; after every builder has run, the ground
// disc's own vertices are darkened around them. That is why this costs ZERO
// draws and zero triangles — it is a colour attribute on a mesh that was
// already being drawn, baked once, exactly like the terrain displacement.
//
// LARGE forms only, and deliberately so: the disc's vertex spacing out where
// the track runs is 15-20m, which can carry a 40m soft pool under a mesa and
// cannot carry a 2m one under a rock. Small scatterers read fine without it.
let OCCLUDERS = [];
function addOccluder(x, z, radius, strength = 1) {
  if (radius >= 12) OCCLUDERS.push({ x, z, r: radius, s: strength });
}

function windify(material, geom, amp) {
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const h = Math.max(0.4, bb.max.y - Math.min(0, bb.min.y));
  const u = { uWindT: { value: 0 }, uWindH: { value: h }, uWindAmp: { value: amp } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = 'uniform float uWindT;\nuniform float uWindH;\nuniform float uWindAmp;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '{',
        // Height weight, squared: a stem barely moves at the root and a lot at
        // the tip, which is what separates a plant bending from a plant sliding.
        '  float wh = clamp(transformed.y / uWindH, 0.0, 1.0);',
        '  #ifdef USE_INSTANCING',
        '    vec3 wp = (instanceMatrix * vec4(transformed, 1.0)).xyz;',
        '  #else',
        '    vec3 wp = transformed;',
        '  #endif',
        // Phase from WORLD position, so gusts sweep across a field instead of
        // every plant twitching on its own clock.
        '  float ph = uWindT + wp.x * 0.055 + wp.z * 0.041;',
        '  float gust = 0.62 + 0.38 * sin(uWindT * 0.21 + wp.x * 0.004 + wp.z * 0.003);',
        '  vec3 d = vec3(sin(ph) + 0.35 * sin(ph * 2.7), 0.0, 0.42 * cos(ph * 0.9));',
        '  d *= uWindAmp * uWindH * wh * wh * gust;',
        // d is a WORLD-space offset but `transformed` is pre-instance local, so
        // rotate it back through the instance basis. The matrix is compose(pos,
        // yaw, uniform scale), so the inverse of its 3x3 is the transpose over
        // the scale squared — written out by hand rather than via transpose(),
        // which needs GLSL ES 3.00.
        '  #ifdef USE_INSTANCING',
        '    mat3 im = mat3(instanceMatrix);',
        '    float s2 = max(1e-4, dot(im[0], im[0]));',
        '    transformed += vec3(dot(im[0], d), dot(im[1], d), dot(im[2], d)) / s2;',
        '  #else',
        '    transformed += d;',
        '  #endif',
        '}',
      ].join('\n'));
  };
  // Without a distinct cache key three reuses the program it already compiled
  // for an identical-looking material and the injection silently does nothing.
  material.customProgramCacheKey = () => `wind${amp}_${h.toFixed(2)}`;
  material.userData.wind = u;   // reachable from the scene graph, for tuning/QA
  WIND.push(u);
  return material;
}

// Push every vertex of a rock form along its own direction by a deterministic
// hash, so the faces stop being planes and the rim stops being a straight line.
// Y moves least — strata are horizontal and the flat-shade bake reads height.
//
// This is the whole answer to "that is supposed to be a rock?": a prism with
// six faces is a crate at any distance, and the fix costs nothing but vertices,
// which is the axis with headroom. Apply BEFORE the geometry is rotated or
// translated, so the displacement is around the form's own centre.
function weather(geom, amt) {
  const pos = geom.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = vhash(v.x * 3.1, v.y * 2.7, v.z * 3.3) - 0.5;
    const m = vhash(v.z * 4.7, v.x * 5.3, v.y * 4.1) - 0.5;
    const k = 1 + n * amt * 2;
    pos.setXYZ(i, v.x * k, v.y * (1 + m * amt * 0.5), v.z * k);
  }
  pos.needsUpdate = true;
  return geom;
}

export function buildScenery(spline, scene, theme) {
  const rng = mulberry32(1337);
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  setBakeTheme(theme.mesaRim, theme.ground, theme.warm, theme.sky && theme.sky.sunAz);
  // One world at a time: a rebuild replaces the wind list rather than growing it.
  WIND.length = 0;

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

  // Ground relief. One height function, evaluated on the CPU, sampled by the
  // ground mesh AND by everything that stands on it — see terrain.js. Worlds
  // without a `terrain` block stay exactly as flat as they were.
  const terrain = buildTerrain(spline, groundY, theme);
  TERRAIN = terrain;
  OCCLUDERS = [];   // one world at a time, same as WIND

  const sky = buildSky(theme.sky);
  scene.add(sky.mesh);
  const ground = buildGround(groundY, cx, cz, theme, terrain);
  group.add(ground.mesh);
  group.add(buildFarMountains(rng, groundY, cx, cz, spline, CITY_ANG, theme));
  const landmarks = buildLandmarks(rng, spline, groundY, cx, cz, theme);
  if (landmarks) group.add(landmarks.group);
  const mesas = buildMesas(rng, spline, groundY, theme);
  group.add(mesas);
  if (theme.rockCut) { const rc = buildRockCut(rng, spline, groundY, theme); if (rc) group.add(rc); }
  group.add(...buildPylons(spline));
  const rings = buildHoloRings(spline);
  group.add(rings.mesh);
  const arches = buildArches(spline, theme);
  if (arches) group.add(arches.group);
  group.add(buildGantry(spline, groundY));
  if (theme.rockCount) group.add(buildRocks(rng, spline, groundY, theme, mesas.userData.islands));
  if (theme.scrubCount) group.add(buildScrub(rng, spline, groundY, theme, mesas.userData.islands));
  if (theme.roadside) group.add(buildRoadside(rng, spline, groundY, theme, mesas.userData.islands));
  if (theme.flora && theme.floraCount) group.add(buildFlora(rng, spline, groundY, theme, mesas.userData.islands));
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
  const devils = theme.dustDevils ? buildDustDevils(rng, spline, groundY, cx, cz, theme.dustDevils, theme.devilCol) : null;
  if (devils) group.add(devils.group);
  const sails = theme.sails ? buildSails(rng, spline, groundY, cx, cz, rich(theme.sails)) : null;
  if (sails) group.add(sails.mesh);
  const blimp = theme.blimp ? buildBlimp(rng, groundY, cx, cz) : null;
  if (blimp) group.add(blimp.group);
  if (theme.sculptures) group.add(buildIceSculptures(rng, spline, groundY, theme));
  const skiers = theme.skiers ? buildSkiers(rng, spline, groundY, theme) : null;
  if (skiers) group.add(skiers.mesh);
  const stands = buildStands(rng, spline, groundY, theme);
  if (stands) group.add(stands.group);
  if (theme.huts) group.add(buildHuts(rng, spline, groundY, theme));

  // Every builder has registered its footprint by now, so the ground can be
  // darkened where the big forms meet it. Has to run LAST — the ground mesh is
  // built first (everything else needs groundY), but nothing knows what stands
  // on it until the scatterers have run.
  shadeGround(ground.mesh.geometry, cx, cz);

  // Base counts captured AFTER the builders ran — that is the FULL density.
  const lifeMeshes = [birds, drones, skiers, traffic, skyCars, sails]
    .filter((o) => o && o.mesh && o.mesh.isInstancedMesh)
    .map((o) => ({ m: o.mesh, base: o.mesh.count }));

  let flash = 0;
  const stormy = theme.ambient && theme.ambient.mode === 'rain';
  return {
    group,
    sky: sky.mesh,
    // Quality tier hooks. Motes are the additive mass; the life families are
    // the "busier world" the FULL tier pays for. Both thin live via
    // InstancedMesh.count, so neither needs the field rebuilt.
    setMoteDensity(f) { if (motes && motes.setDensity) motes.setDensity(f); },
    setLifeDensity(f) {
      for (const e of lifeMeshes) e.m.count = Math.max(1, Math.round(e.base * f));
      if (stands) stands.setDensity(f);
    },
    update(t, cameraPos, raceProgress = 0, sunFlare = 0, meteor = -1, meteorAz = 0, auroraFlare = 0, camQuat = null) {
      sky.mesh.position.copy(cameraPos);
      // One clock for every plant in the world.
      for (let i = 0; i < WIND.length; i++) WIND[i].uWindT.value = t * 0.85;
      sky.mat.uniforms.time.value = t;
      sky.mat.uniforms.progress.value = raceProgress;
      sky.mat.uniforms.sunFlare.value = sunFlare;
      sky.mat.uniforms.meteor.value = meteor;
      sky.mat.uniforms.meteorAz.value = meteorAz;
      sky.mat.uniforms.auroraFlare.value = auroraFlare;
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
      if (landmarks && landmarks.update) landmarks.update(t, cameraPos);
      if (canyon) canyon.update(t);
      if (traffic) traffic.update(t);
      if (drones) drones.update(t);
      if (motes) motes.update(t, cameraPos);
      if (skyCars) skyCars.update(t);
      if (bridges) bridges.update(t);
      if (birds) birds.update(t);
      if (devils) devils.update(t);
      if (sails) sails.update(t);
      if (blimp) blimp.update(t);
      if (skiers) skiers.update(t);
      if (stands) stands.update(t, camQuat, cameraPos);
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
      aurora: { value: S.event === 'aurora' ? 1.0 : 0.0 }, // flowing northern lights (frost)
      auroraFlare: { value: 0 }, // 0..1 final-lap SURGE — the sky show floods
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
      uniform float time, sunSize, sunStripes, starLevel, cloudAmp, cloudPuff, progress, flash, planet, aurora, auroraFlare, sunFlare, meteor, meteorAz;
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
        // Sky event (frost): the AURORA.
        //
        // The old version was two horizontal bands whose HEIGHT rippled along
        // the azimuth. That reads as banding, not as an aurora, because a real
        // aurora is a CURTAIN: a thin hot hem at the bottom with light hanging
        // upward from it in rays, folded so it is bright where it turns face-on
        // and nearly invisible where it turns edge-on. Three things carry that
        // and none of them were there — the hem, the fold gate, and rays that
        // thin out with height.
        if (aurora > 0.5 && y > 0.02) {
          float aAz = atan(d.x, d.z);
          float amp = (0.4 + 0.5 * progress) * (1.0 + 1.4 * auroraFlare);
          vec3 aGreen  = vec3(0.16, 0.99, 0.52);
          vec3 aTeal   = vec3(0.22, 0.88, 0.84);
          vec3 aViolet = vec3(0.64, 0.28, 1.00);
          vec3 acc = vec3(0.0);
          // Three curtains at different heights and drift rates. The far ones
          // are dimmer and slower, so the sky has depth instead of a stripe.
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            // A meandering hem: three harmonics, not one wave.
            float fold = sin(aAz * (2.1 + fi * 0.9) + time * (0.10 + fi * 0.030) + fi * 2.3)
                       + 0.55 * sin(aAz * (4.6 + fi * 1.3) - time * (0.07 + fi * 0.020))
                       + 0.30 * sin(aAz * (9.1 + fi * 2.0) + time * 0.05 + fi);
            float base = (0.12 + fi * 0.17) + 0.055 * fold;
            float hgt = 0.26 + fi * 0.10;
            float t = (y - base) / hgt;              // 0 at the hem, 1 at the top
            if (t < -0.09 || t > 1.5) continue;   // let the hem feather below its own base
            // The hem is the signature: a thin, much brighter line at the base
            // with a long exponential fade hanging above it.
            float hem = exp(-t * t * 90.0);
            float body = exp(-t * 2.6) * smoothstep(-0.02, 0.05, t);
            // Rays: two frequencies drifting at different speeds, combed by the
            // fold, and thinning toward the top the way real rays do.
            float r1 = 0.5 + 0.5 * sin(aAz * 46.0 + time * (0.30 + 0.60 * auroraFlare)
                                       + 2.2 * sin(aAz * 3.0 + time * 0.05));
            float r2 = 0.5 + 0.5 * sin(aAz * 97.0 - time * (0.17 + 0.40 * auroraFlare) + fi * 1.7);
            float rays = mix(1.0, r1 * (0.50 + 0.50 * r2), 0.92 - 0.52 * clamp(t, 0.0, 1.0));
            // Fold gate: bright where the sheet turns toward you, thin where it
            // turns edge-on. This is what stops it reading as a painted band.
            float gate = 0.22 + 0.78 * smoothstep(-0.5, 1.3, fold);
            // Oxygen green low, nitrogen violet high — and it is the real
            // colour ramp, which is a nice coincidence.
            vec3 c = mix(aGreen, aViolet, clamp(t * 1.2, 0.0, 1.0));
            c = mix(c, aTeal, 0.28 * (1.0 - clamp(t, 0.0, 1.0)) * (1.0 - abs(fi - 1.0)));
            acc += c * (hem * 1.9 + body * 0.72) * rays * gate * (1.0 - fi * 0.22);
          }
          col += acc * amp * 0.46;
          // The whole sky picks up a faint green cast under a strong display —
          // aurora light is real light and the air scatters it.
          col += aGreen * amp * 0.035 * smoothstep(0.55, 0.0, y);
        }
        // Stars above the horizon band.
        if (y > 0.18) {
          vec2 cell = vec2(atan(d.x, d.z) * 28.0, y * 60.0);
          vec2 id = floor(cell);
          float h = hash(id);
          if (h > starLevel) {
            vec2 f = fract(cell) - 0.5;
            // Magnitude: mostly faint pinpricks with a few bright ones, and a
            // blue-to-warm spread. A field of identical dots reads as a texture;
            // a field with a few standouts reads as a sky.
            float mag = hash(id + vec2(11.3, 4.7));
            mag *= mag;
            float star = 1.0 - smoothstep(0.02, 0.055 + 0.070 * mag, length(f));
            float tw = 0.7 + 0.3 * sin(time * 2.0 + h * 40.0);
            vec3 sc = mix(vec3(0.74, 0.83, 1.0), vec3(1.0, 0.92, 0.80), hash(id + vec2(5.1, 9.4)));
            col += sc * star * tw * (0.55 + 1.1 * mag) * smoothstep(0.18, 0.3, y);
          }
        }
        // Drifting bands: thin dusk streaks (puff=1) up to fat cumulus banks
        // or smog (puff>2) — width and lobe frequency scale together.
        float az = atan(d.x, d.z);
        // EVERY frequency multiplying az must be a WHOLE NUMBER. atan is
        // discontinuous across the -x meridian (+pi flips to -pi), and sin(k*az)
        // is only 2*pi-periodic when k is an integer — so a fractional
        // coefficient makes the term jump by a finite amount along one vertical
        // line of the sky, from zenith to horizon. That was the "two images that
        // fit badly together" seam: dividing these frequencies by the per-world
        // cloudPuff turned 9.0 into 5.625 and cut the sky in half.
        //
        // Rounding costs nothing artistically — the band count changes by less
        // than one across the whole sky — and it is the only way to keep the
        // horizon closed.
        float f1 = max(2.0, floor(9.0 / cloudPuff + 0.5));
        float f2 = max(2.0, floor(13.0 / cloudPuff + 0.5));
        float f3 = max(2.0, floor(17.0 / cloudPuff + 0.5));
        float g1 = max(1.0, floor(3.0 / cloudPuff + 0.5));
        float g2 = max(1.0, floor(5.0 / cloudPuff + 0.5));
        float g3 = max(1.0, floor(7.0 / cloudPuff + 0.5));
        // Ragged edges. A single sine per band gives an airbrushed stripe; a
        // second, faster harmonic multiplied in gives it lumps and gaps, and
        // nudging each band's CENTRE height by the same term stops the three
        // from reading as parallel rules across the sky.
        float rag1 = 0.60 + 0.40 * sin(az * f1 + time * 0.045 + 1.3) * sin(az * 4.0 - time * 0.020);
        float rag2 = 0.60 + 0.40 * sin(az * f2 - time * 0.035) * sin(az * 5.0 + time * 0.030 + 2.4);
        float rag3 = 0.60 + 0.40 * sin(az * f3 + time * 0.026 + 3.1) * sin(az * 7.0 - time * 0.015);
        float c1 = exp(-pow((y - 0.085 - 0.014 * (rag1 - 0.6)) * 60.0 / cloudPuff, 2.0)) * (0.4 + 0.6 * sin(az * g1 + time * 0.05)) * rag1;
        float c2 = exp(-pow((y - 0.16 - 0.020 * (rag2 - 0.6)) * 40.0 / cloudPuff, 2.0)) * (0.4 + 0.6 * sin(az * g2 - time * 0.04 + 2.0)) * rag2;
        float c3 = exp(-pow((y - 0.30 - 0.026 * (rag3 - 0.6)) * 30.0 / cloudPuff, 2.0)) * (0.3 + 0.7 * sin(az * g3 + time * 0.07 + 4.0)) * rag3;
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
// A radially graded disc, displaced by the terrain height function at BUILD
// time. Rings crowd toward the centre (r = R * t^2.1) because that is where the
// track is and where relief is legible; out by the horizon a ring every 60m is
// more than the fog will ever show. ~28k triangles in ONE draw — the geometry
// axis, which is the one with headroom.
//
// The old mesh was CircleGeometry(1600, 48): a single ring, dead flat, with
// every dune painted in the fragment shader. That shader is untouched and still
// does the fine work; it just has real ground under it now.
function groundDisc(R, rings, segs, terrain) {
  const pos = new Float32Array((rings + 1) * (segs + 1) * 3);
  const idx = [];
  for (let i = 0; i <= rings; i++) {
    const r = R * Math.pow(i / rings, 2.1);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const k = (i * (segs + 1) + j) * 3;
      pos[k] = x; pos[k + 2] = z;
      // The rim is pinned to the base plane so the disc always meets the fog
      // flat, whatever the noise happens to be doing out there.
      const edge = Math.min(1, (1 - i / rings) * 16);
      pos[k + 1] = terrain ? terrain.h(x, z) * edge : 0;
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + segs + 1;
      if (i === 0) { idx.push(a, b + 1, b); continue; }   // centre fan
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // 1 = open ground. Filled in by shadeGround() once the world is built.
  const occ = new Float32Array((rings + 1) * (segs + 1));
  occ.fill(1);
  g.setAttribute('aOcc', new THREE.BufferAttribute(occ, 1));
  g.setIndex(idx);
  return g;
}

// Darken the ground disc around everything that registered a footprint. Called
// after all the builders, because they are what fill OCCLUDERS.
function shadeGround(geom, cx, cz) {
  if (!OCCLUDERS.length) return;
  const pos = geom.getAttribute('position');
  const occ = geom.getAttribute('aOcc');
  for (let i = 0; i < occ.count; i++) {
    const wx = pos.getX(i) + cx, wz = pos.getZ(i) + cz;
    let dark = 0;
    for (const o of OCCLUDERS) {
      const d = Math.hypot(wx - o.x, wz - o.z);
      if (d > o.r) continue;
      // Soft pool: full under the form, feathering to nothing at its radius.
      const t = 1 - d / o.r;
      dark = Math.max(dark, t * t * o.s);
    }
    occ.setX(i, 1 - dark * 0.42);
  }
  occ.needsUpdate = true;
}

function buildGround(groundY, cx, cz, theme, terrain) {
  // The disc is centred on the circuit, so the terrain function has to be
  // queried in WORLD space — the mesh is translated to (cx, groundY, cz) below.
  const local = terrain
    ? { h: (x, z) => terrain.h(x + cx, z + cz) }
    : null;
  const geom = groundDisc(1600, terrain ? 108 : 24, terrain ? 128 : 64, local);
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
        attribute float aOcc;
        varying vec2 vXZ;
        varying float vOcc;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vXZ = wp.xz;
          vOcc = aOcc;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 colA, colB, uWarm;
        uniform vec2 uSunDir, uCenter;
        varying vec2 vXZ;
        varying float vOcc;
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
          // Contact shading: baked into the disc's own vertices, so a mesa or a
          // grandstand sits IN the ground instead of on top of it.
          col *= vOcc;
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
        attribute float aOcc;
        varying vec2 vXZ;
        varying float vOcc;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vXZ = wp.xz;
          vOcc = aOcc;
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
        varying float vOcc;
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
          col *= vOcc;   // baked contact shading, see shadeGround()
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }
      ` : /* glsl */ `
        uniform float time;
        uniform vec3 colA, colB;
        varying vec2 vXZ;
        varying float vOcc;
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
          col *= vOcc;   // baked contact shading, see shadeGround()
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
      // 4-5 radial segments and ONE height segment is a pyramid, and it read as
      // one. A mountain needs an irregular ridgeline, which needs vertices to be
      // irregular WITH — so segments up and weather() over the top. Silhouette
      // is the cheap axis: these are one merged draw whatever they cost in
      // triangles, and they sit on the horizon where the eye has time to judge.
      const g = weather(new THREE.ConeGeometry(wk, hk, 9 + Math.floor(rng() * 4), 5), 0.16);
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
      : (() => {
        // A single cone is a single peak, and a horizon of single peaks reads
        // as a row of tents. Modulate the height by angle so each mountain
        // carries a main summit plus a lower shoulder or two, the way a massif
        // actually sits.
        const mg = weather(new THREE.ConeGeometry(w, h, 12 + Math.floor(rng() * 6), 7), 0.15);
        const pa = mg.getAttribute('position');
        const v = new THREE.Vector3();
        const ph = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2;
        for (let i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i);
          const up = Math.max(0, Math.min(1, v.y / h + 0.5));
          const a = Math.atan2(v.z, v.x);
          const lobe = 0.22 * Math.cos(a * 2.0 + ph) + 0.13 * Math.cos(a * 3.0 + ph2);
          pa.setXYZ(i, v.x, v.y + lobe * up * h * 0.5, v.z * (1 - 0.08 * up));
        }
        pa.needsUpdate = true;
        return mg;
      })();
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
    // Taller and thicker: it is the world's icon and it was reading as a stripey
    // post on the horizon. Height is free here — one merged draw, and it sits
    // where the eye rests between corners.
    const H = 148, R = 12.5;
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const h = H / segs;
      const r0 = R - (i / segs) * 4.6, r1 = R - ((i + 1) / segs) * 4.6;
      const g = new THREE.CylinderGeometry(r1, r0, h, 10);
      g.translate(px, groundY + h / 2 + i * h, pz);
      opa.push(bakeFlatColors(g, i % 2 ? 0xd94848 : 0xf2ede2, { rim: false }));
    }
    // Gallery + lamp room + roof.
    const gal = new THREE.CylinderGeometry(9.6, 9.6, 4.4, 12);
    gal.translate(px, groundY + H + 1.6, pz);
    opa.push(bakeFlatColors(gal, 0x2a3138, { rim: false }));
    const roof = new THREE.ConeGeometry(7.8, 10, 12);
    roof.translate(px, groundY + H + 8.5, pz);
    opa.push(bakeFlatColors(roof, 0xd94848, { rim: false }));
    const lampY = groundY + H + 3.8;
    const lamp = new THREE.BoxGeometry(6.6, 4.8, 6.6);
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
    // The beam has to read as LIGHT, not as a panel. A uniform-opacity cone with
    // eight segments and fog off is a flat wedge with a hard straight edge, and
    // swept across the sky it looked like two mismatched images butted together
    // — confirmed by hiding it and watching the seam vanish. Three things fix
    // it: fade along the length so it dies away from the lamp, fade toward the
    // silhouette so the edge is soft instead of a cut, and let the fog take it
    // like everything else in the world.
    const beamGeo = new THREE.CylinderGeometry(13, 0.9, 380, 22, 8, true);
    beamGeo.translate(0, 190, 0);
    beamGeo.rotateZ(Math.PI / 2 + 0.04); // near-horizontal
    const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uHead: { value: 0 } }]),
      vertexShader: /* glsl */ `
        varying float vT;      // 0 at the lamp, 1 at the far end
        varying vec3 vN;
        varying vec3 vV;
        #include <fog_pars_vertex>
        void main() {
          // The geometry was rotated a quarter turn at build time, so the shaft
          // runs along NEGATIVE x. Dividing by +380 clamped vT to 0 everywhere:
          // both falloffs below evaluated to 1 and the beam was a slab of even
          // brightness end to end, which is exactly what a light is not.
          vT = clamp(-position.x / 380.0, 0.0, 1.0);
          vN = normalize(normalMatrix * normal);
          // Named mvPosition because the fog_vertex chunk reads exactly that
          // name. It was called mv here, so this shader FAILED TO COMPILE the
          // moment fog was switched on — the beam has drawn nothing at all
          // since, which is why the lighthouse looked like it did nothing.
          // NB: no backticks in these comments. The whole shader is a JS
          // template literal and one backtick ends it; node --check passes and
          // the page throws.
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vT;
        varying vec3 vN;
        varying vec3 vV;
        uniform float uHead;   // 1 when the shaft is swinging straight at you
        #include <fog_pars_fragment>
        void main() {
          // brightest where the wall faces the camera (looking along the shaft),
          // vanishing at the silhouette so there is no hard rim
          float face = pow(abs(dot(normalize(vN), normalize(vV))), 0.7);
          // Bright enough to SEE sweeping. The first pass at this was 0.085 and
          // read as nothing at all — "does the lighthouse do anything now?" The
          // falloffs are what stop it being a flat panel, not the dimness, so
          // the brightness can come back up as long as they stay.
          float a = 0.19 * pow(1.0 - vT, 1.5) * (0.10 + 0.90 * face);
          a += 0.10 * pow(1.0 - vT, 6.0) * face;   // a hot root at the lamp
          // The sweep has to ANNOUNCE itself. face is smallest exactly when
          // the shaft points at the camera — seen down the barrel the walls are
          // edge-on — so the beam was dimmest at the one moment a lighthouse is
          // supposed to flash. uHead puts that moment back, and because the
          // cone is seen end-on then, it costs almost no screen area.
          a += 0.42 * uHead * pow(1.0 - vT, 0.8);
          gl_FragColor = vec4(1.0, 0.95, 0.78, a);
          #include <fog_fragment>
        }
      `,
    }));
    beam.frustumCulled = false;
    const pivot = new THREE.Group();
    pivot.position.set(px, lampY, pz);
    pivot.add(beam);
    group.add(pivot);
    // The lamp flare. This world is BRIGHT — golden-hour daylight, warm fog — and
    // an additive shaft 385m out adds almost nothing over a lit sky. What reads
    // at that distance in daylight is the lamp flashing, the same as a real
    // lighthouse: you see the light, not the beam. One sprite, one draw.
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot(), color: 0xfff0c8, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    flare.position.set(px, lampY, pz);
    flare.scale.setScalar(18);
    group.add(flare);

    const toCam = new THREE.Vector3();
    return {
      group,
      update: (t, camPos) => {
        const th = t * 0.55;                       // ~11s a revolution
        pivot.rotation.y = th;
        // Where the shaft points, in world XZ. The geometry runs down -x, so a
        // pivot turn of th aims it at (-cos th, sin th).
        let head = 0;
        if (camPos) {
          toCam.set(camPos.x - px, 0, camPos.z - pz);
          const L = toCam.length();
          if (L > 1e-3) head = Math.max(0, (-Math.cos(th) * toCam.x + Math.sin(th) * toCam.z) / L);
        }
        const f = Math.pow(head, 7);               // a flash, not a slow glow
        beam.material.uniforms.uHead.value = f;
        flare.material.opacity = 0.25 + 0.75 * f;
        flare.scale.setScalar(18 + 40 * f);
      },
    };
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
      let y = groundAt(groundY, px, pz);
      const total = roadH + 20 + rng() * 16;
      const layers = 2 + Math.floor(rng() * 2);
      let w = 17 + rng() * 8, dep = 9 + rng() * 6;
      for (let k = 0; k < layers; k++) {
        const h = total * (k === layers - 1 ? 0.3 : 0.7 / (layers - 1)) * (0.85 + rng() * 0.3);
        const g = weather(new THREE.BoxGeometry(dep, h, w, 2, 3, 3), 0.13);
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
      const g = weather(new THREE.CylinderGeometry(2.6 + rng(), 4.2 + rng() * 1.4, h, 8, 4), 0.12);
      g.rotateY(rng() * Math.PI);
      g.translate(px, groundAt(groundY, px, pz) + h / 2, pz);
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
    // Islands are the one form here the camera looks straight AT for seconds at
    // a time, across a flat lagoon with nothing to hide behind. At detail 1 and
    // 6-7 radial segments they were faceted lumps. Subdivision and `weather()`
    // are the cheap axis (CLAUDE.md graphics budget): a rounder, irregular
    // silhouette at zero extra draws and zero extra screen coverage.
    //
    // NOTE for anything that plants on these: `weather(g, amt)` scales vertices
    // radially by up to 1 + amt, so the horizontal radius is no longer exactly
    // 1 — it can reach ~1.05. The scatterer bands below start at 1.08 for that
    // reason. The beach cylinder (1.12-1.22 r) is unchanged and still covers it.
    // detail 2, not 3: 320 tris against 1280, and across 50 islands that is
    // +16k on the frame instead of +64k for a silhouette difference you cannot
    // see at lagoon distance.
    // Height matters as much as smoothness. At y-scale 0.42 the "jungle dome"
    // was a green pancake lying on the sand — it did not read as a hill, it
    // read as a stain, and the first question anyone asks looking at it is what
    // it is supposed to be. Islands get real vertical relief now: the dome is
    // half again as tall, the hill cone is a proper cone rather than a bump,
    // and only the atoll stays deliberately flat so the chain has variety.
    // A dome is a BUN however you shear it — the giveaway is that its profile
    // is the same in every direction. A hill has RIDGES and saddles: high along
    // one axis, cut away between. So modulate the height by angle with two
    // lobes at different frequencies, lean the summit off-centre, and pull the
    // waist in as it rises. detail 3 rather than 2 because a lobed surface
    // needs vertices to bend with; ~1280 tris x 50 islands is 48k, on the axis
    // with headroom, for the thing that has been complained about twice.
    [() => {
      const g = weather(new THREE.IcosahedronGeometry(1, 3), 0.09);
      g.scale(1, 0.72, 0.86);
      const pa = g.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i);
        const up = Math.max(0, v.y / 0.72);          // 0 at the waterline, 1 at the top
        const a = Math.atan2(v.z, v.x);
        const ridge = 0.34 * Math.cos(a * 2.0) + 0.18 * Math.cos(a * 3.0 + 1.1);
        const waist = 1 - 0.13 * up;                 // taper as it climbs
        pa.setXYZ(
          i,
          v.x * waist + up * up * 0.30,              // summit leans
          v.y * (1 + ridge * up),                    // ridges and saddles
          v.z * waist - up * up * 0.10,
        );
      }
      pa.needsUpdate = true;
      return g;
    }, 1.32, 0],  // jungle hill
    [() => weather(new THREE.ConeGeometry(1, 0.86, 18, 5), 0.05), 0.86, 0],           // headland
    [() => weather(new THREE.CylinderGeometry(0.55, 1, 0.4, 20, 4), 0.04), 0.4, 0],   // flat atoll
  ] : [
    // Height segments matter: strata bands are vertex colours, so the side
    // walls need vertex rows to band across (1 segment = one giant flat quad).
    //
    // Radial segment counts are up across the board, and every one of these
    // gets `weather()` on it. The reason: placement puts a scale-48 form as
    // close as ~70m to the road, and at that range a 4-to-6-sided prism is not
    // a rock, it is a crate — three enormous perfectly flat faces meeting at
    // perfectly straight edges. This is the cheap axis (see the graphics budget
    // in CLAUDE.md): more sections and displaced vertices buy silhouette and
    // surface at ZERO extra draws and zero extra screen coverage.
    [() => weather(new THREE.ConeGeometry(1, 2.2, 7, 7), 0.10), 2.2, 0],          // pyramid spire
    [() => weather(new THREE.CylinderGeometry(0.55, 1, 1.4, 9, 6), 0.11), 1.4, 0],// frustum mesa
    [() => weather(new THREE.CylinderGeometry(0.18, 0.42, 3.2, 7, 8), 0.07), 3.2, 0], // needle
    // Was a naked BoxGeometry — six faces, no silhouette, and the single worst
    // offender when one lands near the road. A squashed subdivided icosahedron
    // reads as a weathered boulder from any angle for 80 triangles.
    [() => weather(new THREE.IcosahedronGeometry(1, 1).scale(1.25, 0.85, 1.0), 0.16), 1.7, 0], // boulder
    [() => weather(new THREE.CylinderGeometry(0.9, 1.05, 0.7, 10, 4), 0.09), 0.7, 0],  // flat-top
  ];
  const geoms = [];
  const glows = [];
  const census = [];   // QA seam: which archetype landed where
  const islandSpots = [];  // {x,z,r} per island — the only dry land on a water world
  const foamGeoms = [];    // surf rings, merged into their own animated mesh
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
        addOccluder(px, pz, scale * 1.45, 1);
        g.translate(px, groundAt(groundY, px, pz) - bb.min.y - 0.5, pz);
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
    // Distance scales with the FOOTPRINT, and 0.9 was not enough: a scale-48
    // form could land 71m from the road, where it fills the frame and every
    // flaw in its silhouette is on show. 1.7 puts the biggest ones back where
    // they read as landscape instead of as props.
    // Islands stay in the lagoon's near and middle ground. At up to 200m of
    // spread they drifted out to where the distant peaks live and read as a
    // palm island parked among the mountains.
    const dist = 28 + scale * 1.7 + rng() * (islands ? 105 : 200);
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
    const archIdx = Math.floor(rng() * archetypes.length);
    const [make, unitH, faceZ] = archetypes[archIdx];
    census.push({ s: Math.round(s), x: px, z: pz, scale: Math.round(scale), arch: archIdx, dist: Math.round(dist) });
    const ys = towers ? 0.9 + rng() * 1.3 : islands ? 0.7 + rng() * 0.45 : 0.7 + rng() * 0.6;
    const ry = rng() * Math.PI * 2;
    const g = make();
    const ub = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position')); // unit bbox for the window grid
    g.scale(scale, scale * ys, scale);
    g.rotateY(ry);
    const box = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position'));
    // Islands sit half-sunk in the lagoon; everything else stands on the ground.
    const gy = groundAt(groundY, px, pz);
    addOccluder(px, pz, scale * 1.5, islands ? 0.5 : 0.9);
    const ty = islands
      ? gy - box.min.y - scale * ys * 0.3
      : gy - box.min.y - 0.5;
    g.translate(px, ty, pz);
    const colorPick = rng();
    const base = colorPick < 0.6 ? theme.mesaLit : theme.mesaShadow;
    const bakedMesa = bakeFlatColors(g, base, { shadow: theme.mesaShadow });
    // Strata are sedimentary bands — they belong on a desert mesa and nowhere
    // else. Baked onto a smooth green island cone they came out as a starburst
    // of sand-coloured triangles running up the slope, which is what made the
    // islands read as "what is that green thing supposed to be".
    if (!towers && !islands) bakeStrata(bakedMesa, rng, groundY, Math.max(3, scale * ys * 0.16), theme.mesaRim, theme.ground);
    geoms.push(bakedMesa);
    if (islands) {
      // Remember the island so the flora scatterer can plant ON it. Palms used
      // to be scattered off the racing line like desert cacti, which on a world
      // whose ground IS the lagoon meant trunks standing in open water.
      //
      // `grid` is a HEIGHT FIELD over the island's footprint, rasterised from
      // the geometry that actually shipped: for every triangle, every grid cell
      // whose centre falls inside its XZ projection takes the barycentric height
      // there. Archetype-agnostic, weather-aware, and exact to the cell — which
      // a radial band profile was not. Bands assumed the island is a surface of
      // revolution and that every band contains a vertex; neither is true of a
      // weathered low-poly form, and the palms it planted were off by up to ten
      // metres, buried in the hillside.
      // 64, not 40: the cell is the residual error. At 40 a cell spans ~3.4m of
      // a big island, and on a steep face that is several metres of height — the
      // last handful of hovering palms. 64 halves it for 16KB an island.
      const GN = 64;                       // cells across the footprint
      const span = scale * 2.9;            // out to 1.45 r, so the sand shelf fits
      const ox = px - span / 2, oz = pz - span / 2;
      const cell = span / GN;
      const grid = new Float32Array(GN * GN).fill(-Infinity);
      // Rasterise any geometry into the field. Called for the island BODY and
      // for the beach shelf, so one lookup answers "what is the ground here"
      // whether the answer is hillside or sand.
      const rasterise = (geom) => {
      const pa = geom.getAttribute('position');
      const idx = geom.getIndex();
      const triCount = idx ? idx.count / 3 : pa.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const ax = pa.getX(i0), ay = pa.getY(i0), az = pa.getZ(i0);
        const bx = pa.getX(i1), by = pa.getY(i1), bz = pa.getZ(i1);
        const cx = pa.getX(i2), cy = pa.getY(i2), cz = pa.getZ(i2);
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(den) < 1e-9) continue;            // edge-on in plan: no area to fill
        const gi0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - ox) / cell));
        const gi1 = Math.min(GN - 1, Math.ceil((Math.max(ax, bx, cx) - ox) / cell));
        const gj0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - oz) / cell));
        const gj1 = Math.min(GN - 1, Math.ceil((Math.max(az, bz, cz) - oz) / cell));
        for (let gj = gj0; gj <= gj1; gj++) {
          const wz = oz + (gj + 0.5) * cell;
          for (let gi = gi0; gi <= gi1; gi++) {
            const wx = ox + (gi + 0.5) * cell;
            const l1 = ((bz - cz) * (wx - cx) + (cx - bx) * (wz - cz)) / den;
            if (l1 < -1e-4) continue;
            const l2 = ((cz - az) * (wx - cx) + (ax - cx) * (wz - cz)) / den;
            if (l2 < -1e-4) continue;
            const l3 = 1 - l1 - l2;
            if (l3 < -1e-4) continue;
            const y = l1 * ay + l2 * by + l3 * cy;
            const k = gj * GN + gi;
            if (y > grid[k]) grid[k] = y;               // top surface, not the underside
          }
        }
      }
      };
      rasterise(bakedMesa);
      // NOTE the height is `gy` (= groundAt), not the flat `groundY`. The
      // lagoon disc is TERRAIN-DISPLACED on this world, so the water surface is
      // several metres higher in places; the island body already used gy but
      // the beach used the constant, which submerged the sand — and then
      // everything planted on the sand grew straight out of open water.
      //
      // A beach SHELF at the waterline, not a lip. At 0.6m tall and starting at
      // 1.12 r it left a gap between the island body and the sand, and stood
      // barely half a metre proud of the lagoon — so a palm planted on it read
      // as growing straight out of open water. Taller, wider, and it now starts
      // inside the island's own (weathered, up to ~1.05 r) footprint so there is
      // no seam. Its top face at groundY + 1.0 is what everything plants on.
      const beach = new THREE.CylinderGeometry(scale * 1.20, scale * 1.34, 1.3, 14);
      beach.rotateY(rng() * Math.PI);
      beach.translate(px, gy + 0.35, pz);   // gy, NOT groundY — see below
      rasterise(beach);                     // sand is ground too
      geoms.push(bakeFlatColors(beach, theme.sand, { rim: false }));
      islandSpots.push({ x: px, z: pz, r: scale, gy, grid, gn: GN, span, ox, oz, cell });
      // Stage-3: a surf line where the beach meets the lagoon — a thin pale
      // ring floating just above the water so the land/water edge never reads
      // as a knife cut. Squashed + rotated per island so no two match.
      const ring = new THREE.RingGeometry(scale * 1.30, scale * 1.52, 20, 1);
      ring.rotateX(-Math.PI / 2);
      ring.scale(1, 1, 0.86 + rng() * 0.22);
      ring.rotateY(rng() * Math.PI);
      ring.translate(px, gy + 0.06, pz);
      // Non-indexed: the surf merge below concatenates raw arrays, and the
      // shared mergeGeoms() cannot be used here — it keeps position and colour
      // only, so it would silently drop the wave attributes.
      const foam = ring.toNonIndexed();
      // Attributes the surf shader needs: which way is OUT from this island, how
      // far out this vertex already sits (0 at the inner lip, 1 at the outer),
      // and a per-island phase so no two shorelines breathe in step.
      {
        const fp = foam.getAttribute('position');
        const dir = new Float32Array(fp.count * 2);
        const edge = new Float32Array(fp.count);
        const ph = new Float32Array(fp.count);
        const phase = rng() * Math.PI * 2;
        for (let vi = 0; vi < fp.count; vi++) {
          const dx = fp.getX(vi) - px, dz = fp.getZ(vi) - pz;
          const d = Math.hypot(dx, dz) || 1;
          dir[vi * 2] = dx / d; dir[vi * 2 + 1] = dz / d;
          edge[vi] = Math.min(1, Math.max(0, (d / scale - 1.30) / 0.22));
          ph[vi] = phase;
        }
        foam.setAttribute('aDir', new THREE.BufferAttribute(dir, 2));
        foam.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
        foam.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
        foam.userData.reach = scale * 0.10;   // how far the wash runs up the sand
        foamGeoms.push(foam);
      }
    }
    if (towers) {
      // Dense lit window GRID over the facades, transformed exactly like the
      // tower. Opaque (in the building mesh) so it reads over the magenta.
      const wg = mesaWindows(ub, scale, ys);
      if (wg) { wg.scale(scale, scale * ys, scale); wg.rotateY(ry); wg.translate(px, ty, pz); geoms.push(wg); }
    }
  }
  const out = new THREE.Group();
  out.name = 'mesas';
  out.userData.census = census;
  out.userData.islands = islandSpots;
  out.add(new THREE.Mesh(mergeGeoms(geoms), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide })));
  if (glows.length) {
    const glowMesh = new THREE.Mesh(mergeGeoms(glows), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glowMesh.renderOrder = 1;
    out.add(glowMesh);
  }
  if (foamGeoms.length) {
    // SURF. One merged mesh, one draw, zero CPU a frame: the vertex shader runs
    // each shoreline's wash in and out along its own outward normal, phased per
    // island so the archipelago never pulses in unison. Two sine rates beat
    // against each other so the rhythm does not read as a loop.
    const reach = foamGeoms[0].userData.reach || 4;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uReach: { value: reach } }]),
      vertexShader: /* glsl */ `
        attribute vec2 aDir;
        attribute float aEdge;
        attribute float aPhase;
        uniform float uT;
        uniform float uReach;
        varying float vA;
        #include <fog_pars_vertex>
        void main() {
          // two beating rates -> a rhythm that never quite repeats
          float w = sin(uT * 0.9 + aPhase) * 0.65 + sin(uT * 0.53 + aPhase * 1.7) * 0.35;
          vec3 pos = position;
          pos.xz += aDir * (w * uReach * (0.35 + aEdge));
          // brightest at the leading edge of the wash, thin as it retreats
          vA = (0.30 + 0.55 * (1.0 - aEdge)) * (0.55 + 0.45 * w);
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        #include <fog_pars_fragment>
        void main() {
          gl_FragColor = vec4(0.86, 0.97, 0.93, clamp(vA, 0.0, 1.0));
          #include <fog_fragment>
        }
      `,
    });
    let vc = 0;
    for (const gg of foamGeoms) vc += gg.getAttribute('position').count;
    const fPos = new Float32Array(vc * 3), fDir = new Float32Array(vc * 2);
    const fEdge = new Float32Array(vc), fPh = new Float32Array(vc);
    let fo = 0;
    for (const gg of foamGeoms) {
      const n = gg.getAttribute('position').count;
      fPos.set(gg.getAttribute('position').array, fo * 3);
      fDir.set(gg.getAttribute('aDir').array, fo * 2);
      fEdge.set(gg.getAttribute('aEdge').array, fo);
      fPh.set(gg.getAttribute('aPhase').array, fo);
      fo += n;
    }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    fGeo.setAttribute('aDir', new THREE.BufferAttribute(fDir, 2));
    fGeo.setAttribute('aEdge', new THREE.BufferAttribute(fEdge, 1));
    fGeo.setAttribute('aPhase', new THREE.BufferAttribute(fPh, 1));
    const surf = new THREE.Mesh(fGeo, mat);
    surf.name = 'surf';
    surf.renderOrder = 1;
    out.add(surf);
    WIND.push({ uWindT: mat.uniforms.uT });   // gets the world clock each frame
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
  // Keep the LAUNCH clear. Arches want long straights, and the start/finish is
  // on one by definition, so the run that begins at s=0 always won — every race
  // in the game opened with the grid under a rib tunnel and the first thing a
  // player saw of a new circuit was its ceiling. Hold them off until the field
  // is properly moving, and leave the grid itself under open sky. Approaching
  // the line THROUGH a tunnel at the end of a lap is fine and stays.
  const GRID_CLEAR = 48, LAUNCH_CLEAR = 205;
  const nearStart = (s) => {
    const d = s > spline.length - GRID_CLEAR ? s - spline.length : s;  // signed, wrapped
    return d > -GRID_CLEAR && d < LAUNCH_CLEAR;
  };
  const positions = [];
  for (const [a, b] of runs) {
    for (let s = a + EDGE; s <= b - EDGE && positions.length < theme.archMax; s += SPACING) {
      if (!nearStart(s)) positions.push(s);
    }
    if (positions.length >= theme.archMax) break;
  }
  if (!positions.length) return null;

  const LIFT = 0.5, cut = Math.asin(LIFT);
  // Exposed for QA: where the ribs actually landed, so the launch-clear rule
  // above can be checked rather than eyeballed from one camera angle.
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
  group.userData.archS = positions.slice();
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
  // groundAt, not groundY: on a displaced world the surface under the gate is
  // not the flat constant, and the -7 cap meant that anywhere the road ran more
  // than seven metres up the legs simply stopped in mid-air. Over the lagoon
  // that is most of the lap, which is why the start gate looked like it stood
  // on nothing. Deeper cap + the footing block below reads as a pier.
  const legBottom = Math.max(groundAt(groundY, f.pos.x, f.pos.z) - f.pos.y, -17) - 0.4;
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
function buildRocks(rng, spline, groundY, theme, islands = null) {
  const count = theme.rockCount ?? 260;
  // Water world: rocks belong in the shallows AROUND an island, not floating
  // out on the open lagoon where the roadside scatter used to leave them.
  const onIslands = islands && islands.length && theme.groundStyle === 'water';
  const pickSpot = onIslands ? makeIslandPicker(rng, islands, 1) : null;
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
    let rpx = f.pos.x + (rx / rl) * side * dist, rpz = f.pos.z + (rz / rl) * side * dist;
    if (onIslands) {
      // Straddle the waterline: some sitting on the sand, most half-sunk in the
      // shallows just off the beach. A rock breaking the surface reads as reef;
      // a rock sitting ON the water reads as a bug, which is what it was.
      ({ x: rpx, z: rpz } = pickSpot(1.34, 1.70));
      p.set(rpx, groundAt(groundY, rpx, rpz) - size * 0.25 + rng() * size * 0.45, rpz);
      e.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
      q.setFromEuler(e);
      sc.set(size, size * (0.5 + rng() * 0.4), size);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      continue;
    }
    p.set(rpx, groundAt(groundY, rpx, rpz) + size * 0.22, rpz);
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
function buildScrub(rng, spline, groundY, theme, islands = null) {
  // Water world: the theme calls this "low coastal scrub on the sandbars", but
  // a water world has no sandbars — only islands. Put it on them.
  const onIslands = islands && islands.length && theme.groundStyle === 'water';
  const pickSpot = onIslands ? makeIslandPicker(rng, islands, 0.7) : null;
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
    windify(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), geom, 0.06 * (theme.wind ?? 1)),
    count);
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
    let spx = f.pos.x + (rx / rl) * side * dist, spz = f.pos.z + (rz / rl) * side * dist;
    if (onIslands) {
      ({ x: spx, z: spz } = pickSpot(1.03, 1.13));   // on the sand, just inside the palms
      p.set(spx, groundAt(groundY, spx, spz) + 1.0, spz);
    } else {
      p.set(spx, groundAt(groundY, spx, spz) + 0.1, spz);
    }
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
function buildRoadside(rng, spline, groundY, theme, islands = null) {
  const style = theme.roadside;
  // Water world: the "near band beside the road" is open lagoon, so the kit that
  // is meant to keep that strip from reading bare instead left mooring posts
  // standing in the middle of nowhere. Move them to the islands, where a
  // mooring post is a jetty and not debris; the road's own neon edges and
  // pylons already carry the near band out here.
  const onIslands = islands && islands.length && theme.groundStyle === 'water';
  const pickSpot = onIslands ? makeIslandPicker(rng, islands, 0.8) : null;
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
  } else if (style === 'poles') {
    // Snow-marker poles — the classic orange roadside stakes — with a low
    // wind-carved drift hump at the base.
    const pole = new THREE.CylinderGeometry(0.05, 0.06, 1.5, 5);
    pole.translate(0, 0.72, 0);
    parts.push(bakeFlatColors(pole, 0xe8763a, { rim: false }));
    const bandTop = new THREE.CylinderGeometry(0.062, 0.062, 0.2, 5);
    bandTop.translate(0, 1.32, 0);
    parts.push(bakeFlatColors(bandTop, 0xf5f5f0, { rim: false }));
    const drift = new THREE.IcosahedronGeometry(0.38, 0);
    drift.scale(1.6, 0.45, 1);
    drift.translate(0.1, 0.12, 0.05);
    parts.push(bakeFlatColors(drift, 0xdde8f6, { rim: false }));
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
  // Grass is the loosest thing on the track and should read that way; a snow
  // stake only flexes; mooring posts are driven into the seabed; barrier blocks
  // and vent boxes are concrete and stay put.
  const AMP = { tufts: 0.13, poles: 0.05, marina: 0.03, street: 0 };
  const amp = (AMP[style] ?? 0.06) * (theme.wind ?? 1);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  const mesh = new THREE.InstancedMesh(geom, amp > 0 ? windify(mat, geom, amp) : mat, count);
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
      let x = f.pos.x + (rx / rl) * side * dist;
      let z = f.pos.z + (rz / rl) * side * dist;
      if (onIslands) {
        ({ x, z } = pickSpot(1.30, 1.52));  // jetty line: shelf edge into the shallows
        p.set(x, groundAt(groundY, x, z) - 0.12, z);
      } else {
        if (!clearOfTrack(spline, x, z, 2.5)) continue; // never on another pass of the road
        p.set(x, groundAt(groundY, x, z) + 0.02, z);
      }
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

function buildFlora(rng, spline, groundY, theme, islands = null) {
  const style = theme.flora;
  const parts = [];
  if (style === 'palms') {
    // A palm was a straight cylinder plus seven cones, and it read as a bottle
    // brush. This is the cheap axis (CLAUDE.md graphics budget): a palm is
    // ~30 instanced draws' worth of silhouette in ONE instanced draw, and the
    // coast worlds put a few hundred of them on screen at the horizon, so
    // silhouette is the whole game. Shape, not detail.
    //
    // Segment counts are deliberately mean. At 760 instances a palm is the
    // single biggest triangle owner in the frame, and the SHAPE — the bend, the
    // droop, the midrib fold — is what reads; subdividing the same shape harder
    // buys nothing at lagoon distance. Trunk 6x5 and fronds 2x5 put a palm at
    // ~310 triangles instead of ~500, which is ~140k off the frame.
    const H = 2.45;
    const LEAN = 0.42;      // metres the crown sits downwind of the base
    // ---- trunk: bent, not tilted. A tilted cylinder is a stick leaning on
    // nothing; a real palm curves, thick at the root and thin under the crown.
    const trunk = new THREE.CylinderGeometry(0.075, 0.17, H, 6, 5);
    trunk.translate(0, H / 2, 0);
    {
      const pos = trunk.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const t = Math.max(0, Math.min(1, v.y / H));
        // quadratic sweep + a slight ring-to-ring waver so the trunk has the
        // stepped scar texture a palm has instead of reading machined
        const waver = Math.sin(t * 11.0) * 0.012;
        pos.setXYZ(i, v.x + LEAN * t * t + waver, v.y, v.z);
      }
      pos.needsUpdate = true;
    }
    parts.push(bakeFlatColors(trunk, 0x6e4a2f, { rim: false }));
    // ---- crown: a drooping, tapered blade, folded along its midrib so it has
    // body from any angle. A cone has none: edge-on it vanishes to a line.
    const frond = (len, wid) => {
      const g = new THREE.PlaneGeometry(wid, len, 2, 5);
      g.rotateX(-Math.PI / 2);                     // width in X, length in Z
      const pos = g.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const t = Math.max(0, Math.min(1, (v.z + len / 2) / len));   // 0 base .. 1 tip
        const taper = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.5);
        const x = v.x * taper;
        // gravity wins further out; the fold gives the blade a V cross-section
        const droop = -Math.pow(t, 2.2) * len * 0.62;
        pos.setXYZ(i, x, droop - Math.abs(x) * 0.42, t * len);
      }
      pos.needsUpdate = true;
      return g;
    };
    const N = 9;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.35;
      const len = 1.35 + ((i * 7) % 5) * 0.075;    // deterministic spread, no rng here
      const g = frond(len, 0.34);
      g.rotateX(-0.32 + ((i * 3) % 4) * 0.09);     // some blades lift, some fall
      g.rotateY(a);
      g.translate(LEAN, H - 0.06, 0);
      // Alternate two greens so the crown is not one flat silhouette.
      parts.push(bakeFlatColors(g, i % 2 ? 0x2fa05a : 0x27864b, { rim: false }));
    }
    // ---- coconuts: three small nuts tucked under the crown. Tiny, but they are
    // what makes the crown read as a head rather than a splat of leaves.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.8;
      const nut = new THREE.IcosahedronGeometry(0.085, 0);
      nut.translate(LEAN + Math.cos(a) * 0.13, H - 0.17, Math.sin(a) * 0.13);
      parts.push(bakeFlatColors(nut, 0x8a6a3a, { rim: false }));
    }
  } else if (style === 'pines') {
    // Frosted spruce: dark tiered cones with snow-dusted brims + a white cap.
    const trunk = new THREE.CylinderGeometry(0.09, 0.14, 0.7, 5);
    trunk.translate(0, 0.35, 0);
    parts.push(bakeFlatColors(trunk, 0x3a2c28, { rim: false }));
    const tiers = [[1.15, 1.5, 0.75], [0.9, 1.3, 1.55], [0.62, 1.1, 2.3]];
    for (const [r, h, y] of tiers) {
      const cone = new THREE.ConeGeometry(r, h, 6);
      cone.translate(0, y + h * 0.3, 0);
      parts.push(bakeFlatColors(cone, theme.floraCol ?? 0x2a4a44, { rim: false }));
      const brim = new THREE.ConeGeometry(r * 0.98, 0.16, 6); // snow on the tier's shoulder
      brim.translate(0, y + h * 0.06, 0);
      parts.push(bakeFlatColors(brim, 0xe8f0fa, { rim: false }));
    }
    const cap = new THREE.ConeGeometry(0.2, 0.4, 6);
    cap.translate(0, 3.35, 0);
    parts.push(bakeFlatColors(cap, 0xf2f7ff, { rim: false }));
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
  // A palm whips, a spruce shrugs, a cactus is basically a post — the same
  // sway on all three would look like the whole world was made of rubber.
  const amp = (style === 'palms' ? 0.085 : style === 'pines' ? 0.032 : 0.012) * (theme.wind ?? 1);
  const mesh = new THREE.InstancedMesh(geom,
    windify(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), geom, amp), count);
  const f = makeFrame();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  // Monument worlds: cacti gather into OASES on the same lap zones as the
  // buttes (same seed), leaving the empty flats truly empty.
  const zones = theme.monumentZones ? lapZones(ZONE_SEED, spline.length) : null;
  // ISLAND PLANTING — see makeIslandPicker. Concentrated on the bigger 45% of
  // islands: 340 palms over 50 atolls reads as litter, over 22 it reads as
  // stands of palms, and the bare atolls are the better silhouette anyway.
  const onIslands = islands && islands.length && theme.groundStyle === 'water';
  const pickSpot = onIslands ? makeIslandPicker(rng, islands, 0.45) : null;
  for (let i = 0; i < count; i++) {
    // Pick a spot, but reject any that lands over the track — palms are tall
    // and otherwise poke up through the surface on the inside of curves.
    let x = 0, z = 0;
    if (onIslands) {
      // ONE rule: pick a spot anywhere on the island, ask for the highest
      // surface there, stand on it. No steepness gate, no ownership test, no
      // "is this spot clear of a neighbour" — the height field already answers
      // all of it, because the highest surface at a point IS the ground there.
      // The heuristics those questions used to need are what buried a third of
      // the palms while every x/z audit reported success.
      const spot = rng() < 0.5 ? pickSpot(0.25, 0.95) : pickSpot(1.02, 1.20);
      x = spot.x; z = spot.z;
      const surf = topSurfaceAt(islands, x, z);
      if (surf === null) { sc.setScalar(0); m.compose(p, q, sc); mesh.setMatrixAt(i, m); continue; }
      const slope = spot.u < 1.0;
      // Smaller the higher it grows — exposure, and it keeps the crown off the
      // summit.
      const size = slope ? (1.3 + rng() * 1.5) * (0.74 + spot.u * 0.36) : 1.6 + rng() * 2.0;
      p.set(x, surf - 0.35, z);            // just enough to bed the trunk in
      q.setFromAxisAngle(Y, rng() * Math.PI * 2);
      sc.setScalar(size);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      continue;
    }
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
    p.set(x, groundAt(groundY, x, z), z);
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
    // Mount height off the LOCAL ground, and skip the spot entirely when there
    // is no ground within reach. The old maths took the flat groundY, so beside
    // an elevated road the legs grew to whatever the road's height happened to
    // be — 20m stilts under a hoarding on the lagoon crossings. A billboard
    // with no ground under it is not a billboard on longer legs; it is a
    // billboard that should not be there.
    const gAt = groundAt(groundY, px, pz);
    const py = Math.max(gAt + 8.5, f.pos.y + 4.5);
    if (py - gAt > 15) return;   // nothing to stand on here
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
      const legH = py - gAt;
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
  const PER = rich(6);
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
// ---------------------------------------------------------------- stands
// Grandstands, and the reason they exist: the world had props but no PEOPLE.
// Birds, drones, skiers and traffic are all motion in the distance, and none of
// them is anybody watching you — which is the single strongest "this place is
// alive" cue a racing game has. A circuit without spectators reads as a test
// track no matter how much scenery is bolted to it.
//
// Three meshes, whatever the track: the raked structure (baked, static), an
// instanced CROWD that breathes, and an instanced set of camera FLASHES. The
// flashes are the cheap trick that does most of the work — a dark stand with
// stray pinpricks popping in it reads as thousands of people instantly, at a
// couple of hundred additive pixels a frame.
function buildStands(rng, spline, groundY, theme) {
  const f = makeFrame();
  const LEN = 42, ROWS = 7, PER_ROW = 36, DEPTH = 14;

  // A coarse sample of the whole centreline, kept for the footprint test below.
  // The track is a loop that crosses OVER itself on several circuits, so "9m to
  // the right of the road here" can be "on top of the road there" — the same
  // trap the surface audit exists to catch, one storey up.
  const path = [];
  for (let s = 0; s < spline.length; s += 10) {
    spline.frameAt(s, f);
    path.push({ s, x: f.pos.x, y: f.pos.y, z: f.pos.z, w: f.width });
  }
  const CLEAR = Math.hypot(LEN / 2, DEPTH / 2) + 4;   // stand footprint radius + margin
  const footprintFree = (px, py, pz, ownS) => {
    for (const p of path) {
      const ds = Math.abs(p.s - ownS);
      if (Math.min(ds, spline.length - ds) < 70) continue;   // our own stretch
      if (Math.abs(p.y - py) > 16) continue;                 // a flyover well clear above/below
      if (Math.hypot(p.x - px, p.z - pz) < CLEAR + p.w) return false;
    }
    return true;
  };

  // Where a real circuit puts them: the start/finish, then the outside of the
  // biggest corners, well spaced. Never on a jump gap, a split or a bank.
  const cand = [{ s: 42, side: -1 }];
  let lastS = 42;
  for (let s = 120; s < spline.length - 120; s += 8) {
    spline.frameAt(s, f);
    if (Math.abs(f.kappa) < 0.007 || s - lastS < 420) continue;
    if (spline.gapAt(s) || spline.gapAt(s + 40)) continue;
    if (Math.abs(f.U.y) < 0.86) continue;            // banked hard, a loop, a corkscrew
    cand.push({ s, side: Math.sign(f.kappa) });      // outside of the turn
    lastS = s;
  }

  const opa = [], glo = [];
  const seat = [];   // world position of every spectator, filled below
  const spotPos = [];   // where each stand actually landed (debug / QA seam)
  const deck = new THREE.Color(theme.trackBase ?? 0x241448);
  const neonL = new THREE.Color(0x35e8ff), neonR = new THREE.Color(0xff4fd0);

  const X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let placed = 0;
  for (const spot of cand) {
    spline.frameAt(spot.s, f);
    const rl = Math.hypot(f.R.x, f.R.z) || 1;
    const nx = (f.R.x / rl) * spot.side, nz = (f.R.z / rl) * spot.side;
    const dist = f.width + 7;   // close enough to the barrier to loom at speed
    const px = f.pos.x + nx * dist, pz = f.pos.z + nz * dist;
    // groundAt, not the flat groundY — the fourth thing in this file to have
    // made that mistake. On a displaced world the surface beside the road is
    // metres off the constant, so a grandstand stood in a dip or half-sunk in a
    // rise, which is what "that looks risky to sit on" means.
    const py = Math.max(groundAt(groundY, px, pz), f.pos.y - 1.2);
    if (!footprintFree(px, py, pz, spot.s)) continue;
    placed++;
    spotPos.push({ s: spot.s, side: spot.side, x: px, y: py, z: pz, rx: f.pos.x, ry: f.pos.y, rz: f.pos.z });
    addOccluder(px, pz, 32, 0.85);
    Z.set(-nx, 0, -nz);                 // facing the track
    X.crossVectors(Y, Z).normalize();
    m.makeBasis(X, Y, Z);
    const place = (geom, ox, oy, oz) => {
      m.setPosition(px + X.x * ox + Z.x * oz, py + oy, pz + X.z * ox + Z.z * oz);
      return geom.applyMatrix4(m);
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const backZ = -(ROWS * 1.5);
    // The deck sits at road height, and beside an ELEVATED road that leaves it
    // hanging in the air. Same answer as the start gantry: drop legs to the
    // ground plane, capped so a crest does not grow absurd stilts.
    const legBottom = Math.min(0, Math.max(groundAt(groundY, px, pz) - py, -11));
    if (legBottom < -0.5) {
      const h = -legBottom + 0.6;
      for (const sx of [-1, -0.34, 0.34, 1]) {
        opa.push(bakeFlatColors(place(box(1.5, h, 1.5), sx * (LEN / 2 - 1.2), legBottom + h / 2 - 0.3, backZ / 2), 0x161028, { rim: false }));
      }
      opa.push(bakeFlatColors(place(box(LEN + 1.0, 0.7, DEPTH), 0, legBottom + 0.35, backZ / 2), 0x1c1434, { rim: false }));
    }
    // Raked deck: each row a step further back and higher — the shape reads as
    // a stand from any angle without a single custom vertex.
    for (let r = 0; r < ROWS; r++) {
      const h = 1.1 + r * 1.15, back = -(r * 1.5);
      opa.push(bakeFlatColors(place(box(LEN, 0.55, 1.5), 0, h, back), deck.getHex(), { rim: false }));
      for (let i = 0; i < PER_ROW; i++) {
        const ox = (i / (PER_ROW - 1) - 0.5) * (LEN - 2.2) + (rng() - 0.5) * 0.4;
        seat.push({
          si: placed - 1,
          x: px + X.x * ox + Z.x * back, y: py + h + 0.75, z: pz + X.z * ox + Z.z * back,
          ph: rng() * 100, sp: 0.7 + rng() * 0.8, hue: rng(),
          // Height, build and which way they are turned all vary. A row of
          // identical boxes at identical spacing reads as freight, not people.
          yaw: (rng() - 0.5) * 1.3, sx: 0.8 + rng() * 0.45, sy: 0.82 + rng() * 0.5,
          // Only about one seat in six owns a camera. Everyone flashing at once
          // is a sparkler, not a crowd — the gaps are what sell the scale.
          fl: rng() < 0.17 ? 4 + rng() * 9 : 0,
          // ...until the pack actually arrives, and then EVERY seat fires on a
          // short cycle. This is the whole point of the system: a diorama does
          // not notice you, and a place does.
          flN: 0.9 + rng() * 2.4,
        });
      }
    }
    // Back wall + a roof lip, so the stand has a silhouette against the sky.
    opa.push(bakeFlatColors(place(box(LEN + 1.4, 9.5, 0.7), 0, 4.6, backZ), 0x1a1230, { rim: false }));
    opa.push(bakeFlatColors(place(box(LEN + 2.4, 0.5, 8.0), 0, 9.6, backZ + 4.0), 0x2c2050, { rim: false }));
    for (const sx of [-1, 1]) {
      opa.push(bakeFlatColors(place(box(0.8, 9.6, 0.8), sx * (LEN / 2 + 0.9), 4.8, backZ + 7.6), 0x1a1230, { rim: false }));
    }
    // Neon: a strip under the front row and one along the roof edge, in the
    // circuit's own two colours. This is what makes a stand read as part of
    // THIS game rather than a grey lump borrowed from a sim — and at night it
    // is the only thing that separates the structure from the sky.
    const c = placed % 2 ? neonL : neonR;
    glo.push(colorTint(place(box(LEN, 0.3, 0.22), 0, 0.55, 1.0), c));
    glo.push(colorTint(place(box(LEN + 2.4, 0.28, 0.22), 0, 9.9, backZ + 8.1), c));
  }

  if (!opa.length) return null;

  // Thin the crowd EVENLY. Density lowers InstancedMesh.count, which keeps a
  // prefix of the array — and the array is built stand by stand, so without a
  // shuffle LOW would render the first stands packed and the last ones as empty
  // shells. Seeded shuffle, so a prefix is a fair sample of every stand.
  for (let i = seat.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = seat[i]; seat[i] = seat[j]; seat[j] = tmp;
  }
  const N = seat.length;

  const group = new THREE.Group();
  group.name = 'stands';
  group.userData.spots = spotPos;
  group.matrixAutoUpdate = false;
  const body = new THREE.Mesh(mergeGeoms(opa), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  body.frustumCulled = false;
  body.matrixAutoUpdate = false;
  group.add(body);
  if (glo.length) {
    const glowMesh = new THREE.Mesh(mergeGeoms(glo), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glowMesh.frustumCulled = false; glowMesh.matrixAutoUpdate = false;
    group.add(glowMesh);
  }

  // The crowd: one small box each, bobbing on its own phase. Individually
  // invisible at speed; collectively a surface that MOVES, which is the point.
  //
  // The base geometry is baked WHITE rather than left bare. `vertexColors` with
  // no `color` attribute reads the missing attribute as (0,0,0) and the whole
  // crowd renders black — which is exactly what it did the first time. Baking
  // white gives the shader something to multiply the per-instance tint into,
  // and throws in the three-step shading every other solid in the world has.
  const crowd = new THREE.InstancedMesh(
    bakeFlatColors(new THREE.BoxGeometry(0.4, 0.9, 0.4), 0xffffff, { rim: false, gradient: 0.16, grain: 0 }),
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
    N,
  );
  crowd.frustumCulled = false;
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cc = new THREE.Color();
  const warm = new THREE.Color(theme.warm ?? 0xffedc4);
  seat.forEach((p, i) => {
    // A crowd is not a colour, it is a spread. Three bands of muted clothing
    // plus the world's own warm light keeps it from reading as confetti.
    const base = p.hue < 0.34 ? 0x9a5a7a : p.hue < 0.68 ? 0x4a5f9a : 0x8a6f4a;
    cc.setHex(base).lerp(warm, 0.15 + p.hue * 0.2).multiplyScalar(0.75 + p.hue * 0.4);
    crowd.setColorAt(i, cc);
  });
  group.add(crowd);

  // Camera flashes: tiny additive quads that pop for a moment. Deterministic
  // per seat, so they do not all fire at once and never repeat a pattern the
  // eye can latch on to.
  const flash = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.85, 0.85),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    }),
    N,
  );
  flash.frustumCulled = false;
  flash.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(flash);

  const mm = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) flash.setMatrixAt(i, zero);
  const near = new Float32Array(spotPos.length);

  // The crowd's matrices are built ONCE, yaw and build and all, and the bob
  // afterwards only rewrites element 13 — the Y translation. One float per
  // spectator per frame instead of a sixteen-float compose, which is what
  // makes it affordable to have every seat in the world animating at once.
  const cm = crowd.instanceMatrix.array;
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const p = seat[i];
    _q.setFromAxisAngle(_up, p.yaw);
    _p.set(p.x, p.y, p.z);
    _s.set(p.sx, p.sy, p.sx);
    mm.compose(_p, _q, _s);
    mm.toArray(cm, i * 16);
  }
  crowd.instanceMatrix.needsUpdate = true;
  return {
    group,
    setDensity(d) {
      const k = Math.max(1, Math.round(N * Math.max(0.15, d)));
      crowd.count = k; flash.count = k;
    },
    update(t, cameraQuat, cameraPos) {
      const q = cameraQuat || _flashQuat;   // menu/podium call without a camera
      // How close the race is to each stand, 0..1. Computed ONCE per stand, not
      // per seat — a handful of distance checks a frame buys the reaction.
      for (let i = 0; i < spotPos.length; i++) {
        const sp = spotPos[i];
        const d = cameraPos
          ? Math.hypot(cameraPos.x - sp.x, cameraPos.z - sp.z)
          : 9999;
        near[i] = d > 190 ? 0 : d < 70 ? 1 : (190 - d) / 120;
      }
      const k = crowd.count;
      let touched = false;
      for (let i = 0; i < k; i++) {
        const p = seat[i];
        const nr = near[p.si] || 0;
        // A stand the far side of the circuit still DRAWS — it is one instanced
        // call either way — but there is no point spending CPU animating a bob
        // and a flash cycle nobody can resolve. Skipping the far ones is most
        // of the per-frame cost of this system on a weak machine, and it is
        // invisible: `near` is already 0 beyond 190m.
        if (nr <= 0 && !p.wasNear) continue;
        p.wasNear = nr > 0;
        touched = true;
        // Bob: a crowd never stands still. Amplitude is small — this should
        // read as a shimmer across the stand, not as a wave of pogo sticks —
        // until you are on top of them, and then they get to their feet.
        const bob = Math.sin(t * p.sp * (2.2 + nr * 3.4) + p.ph) * (0.11 + nr * 0.26);
        cm[i * 16 + 13] = p.y + bob;
        // Flash: a short pop on the seat's own cycle. Far away only the seats
        // that own a camera fire at all (fl === 0 for the rest); near, every
        // seat switches to its short cycle and the stand lights up.
        const per = nr > 0.45 ? p.flN : p.fl;
        if (!per) { flash.setMatrixAt(i, zero); continue; }
        const u = (t / per + p.ph) % 1;
        if (u < 0.05) {
          const a = Math.sin((u / 0.05) * Math.PI);
          mm.compose(_flashPos.set(p.x, p.y + 0.55, p.z), q, _flashScale.setScalar(a * (0.8 + nr * 0.5)));
          flash.setMatrixAt(i, mm);
        } else {
          flash.setMatrixAt(i, zero);
        }
      }
      if (touched) {
        crowd.instanceMatrix.needsUpdate = true;
        flash.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
const _flashPos = new THREE.Vector3();
const _flashScale = new THREE.Vector3();
const _flashQuat = new THREE.Quaternion();

function buildDustDevils(rng, spline, groundY, cx, cz, count, color = 0xd8b06a) {
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
      color, transparent: true, opacity: 0.34,
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

// ---------------------------------------------------------- frost events
// Ice sculptures of race ships on pedestals — the frost world honours the
// sport. Spaced around the lap like billboards, close enough to read.
function buildIceSculptures(rng, spline, groundY, theme) {
  const parts = [];
  const ped = new THREE.BoxGeometry(2.4, 1.1, 2.4);
  ped.translate(0, 0.55, 0);
  parts.push(bakeFlatColors(ped, 0x7e96ba, { rim: false }));
  const slab = new THREE.BoxGeometry(2.8, 0.18, 2.8);
  slab.translate(0, 1.19, 0);
  parts.push(bakeFlatColors(slab, 0xa8c0dc, { rim: false }));
  // The ship: a crystalline silhouette — diamond fuselage, swept wings, fin.
  const body = new THREE.CylinderGeometry(0.16, 0.62, 3.6, 4);
  body.rotateX(Math.PI / 2);                    // nose forward
  body.translate(0, 1.95, 0.2);
  parts.push(bakeFlatColors(body, 0xcfe6f8, { rim: false }));
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(1.7, 0.09, 0.8);
    wing.rotateY(side * 0.55);
    wing.translate(side * 0.95, 1.8, -0.5);
    parts.push(bakeFlatColors(wing, 0xbcd8f0, { rim: false }));
  }
  const fin = new THREE.BoxGeometry(0.08, 0.7, 0.9);
  fin.translate(0, 2.35, -1.1);
  parts.push(bakeFlatColors(fin, 0xbcd8f0, { rim: false }));
  const geom = mergeGeoms(parts);
  const count = theme.sculptures;
  const mesh = new THREE.InstancedMesh(geom,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), count);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const f = makeFrame();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let a = 0; a < 6 && !placed; a++) {
      const s = ((i + rng() * 0.5) / count) * spline.length;
      spline.frameAt(s, f);
      const side = rng() < 0.5 ? -1 : 1;
      const dist = f.width + 9 + rng() * 10;
      const rl = Math.hypot(f.R.x, f.R.z) || 1;
      const x = f.pos.x + (f.R.x / rl) * side * dist;
      const z = f.pos.z + (f.R.z / rl) * side * dist;
      if (!clearOfTrack(spline, x, z, 3)) continue;
      p.set(x, groundAt(groundY, x, z) + 0.02, z);
      q.setFromAxisAngle(Y, rng() * Math.PI * 2);
      sc.setScalar(1.1 + rng() * 0.5);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      placed = true;
    }
    if (!placed) { sc.setScalar(0); m.compose(p, q, sc); mesh.setMatrixAt(i, m); }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// Skiers carving slalom lines across the far snowfields — tiny figures on a
// long run, weaving as they go, looping back to the top when they run out.
function buildSkiers(rng, spline, groundY, theme) {
  const bodyG = new THREE.CylinderGeometry(0.13, 0.17, 0.6, 5);
  bodyG.translate(0, 0.55, 0);
  const headG = new THREE.IcosahedronGeometry(0.13, 0);
  headG.translate(0, 0.97, 0);
  const parts = [
    bakeFlatColors(bodyG, 0xd84a4a, { rim: false }),   // red parka — pops on snow
    bakeFlatColors(headG, 0x30364a, { rim: false }),
  ];
  for (const side of [-1, 1]) {
    const ski = new THREE.BoxGeometry(0.09, 0.05, 1.15);
    ski.translate(side * 0.12, 0.03, 0.1);
    parts.push(bakeFlatColors(ski, 0x2a3050, { rim: false }));
  }
  const geom = mergeGeoms(parts);
  const N = rich(theme.skiers);
  const mesh = new THREE.InstancedMesh(geom,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), N);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const runs = [];
  for (let i = 0; i < N; i++) {
    let ox = 0, oz = 0, ok = false;
    for (let a = 0; a < 14 && !ok; a++) {
      const s = rng() * spline.length;
      const f2 = makeFrame();
      spline.frameAt(s, f2);
      const side = rng() < 0.5 ? -1 : 1;
      const dist = f2.width + 30 + rng() * 60;
      const rl = Math.hypot(f2.R.x, f2.R.z) || 1;
      ox = f2.pos.x + (f2.R.x / rl) * side * dist;
      oz = f2.pos.z + (f2.R.z / rl) * side * dist;
      ok = clearOfTrack(spline, ox, oz, 22);
    }
    const dir = rng() * Math.PI * 2;
    runs.push({
      ox, oz, ok,
      dx: Math.sin(dir), dz: Math.cos(dir),      // run direction
      len: 130 + rng() * 80,
      sp: 9 + rng() * 5,                          // m/s downhill
      ph: rng() * 1000,
      carve: 5 + rng() * 4,                       // weave amplitude
    });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  const e = new THREE.Euler();
  return {
    mesh,
    update(t) {
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if (!r.ok) { sc.setScalar(0); m.compose(p, q, sc); mesh.setMatrixAt(i, m); continue; }
        sc.setScalar(1);
        const d = (t * r.sp + r.ph) % r.len;      // distance down the run
        const weave = Math.sin(d * 0.22) * r.carve;
        const px = r.ox + r.dx * d - r.dz * weave;
        const pz = r.oz + r.dz * d + r.dx * weave;
        p.set(px, groundAt(groundY, px, pz) + 0.02, pz);
        const heading = Math.atan2(r.dx - r.dz * Math.cos(d * 0.22) * 0.22 * r.carve,
          r.dz + r.dx * Math.cos(d * 0.22) * 0.22 * r.carve);
        e.set(0, heading, Math.cos(d * 0.22) * 0.3); // lean into the carve
        q.setFromEuler(e);
        m.compose(p, q, sc);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// Ice-fishing huts on the frozen lake near the start — dark timber, snowy
// roofs, one warm amber window apiece: cosy dots of life in the cold.
function buildHuts(rng, spline, groundY, theme) {
  const parts = [];
  const box = new THREE.BoxGeometry(2.2, 1.8, 2.6);
  box.translate(0, 0.9, 0);
  parts.push(bakeFlatColors(box, 0x4a3c38, { rim: false }));
  const roof = new THREE.ConeGeometry(2.0, 1.1, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 2.35, 0);
  parts.push(bakeFlatColors(roof, 0xe6eef8, { rim: false }));
  const win = new THREE.BoxGeometry(0.55, 0.5, 0.06);
  win.translate(0.4, 1.0, 1.31);
  parts.push(bakeFlatColors(win, 0xffb45c, { rim: false }));   // the warm glow
  const pipe = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5);
  pipe.translate(-0.6, 2.6, -0.4);
  parts.push(bakeFlatColors(pipe, 0x30302e, { rim: false }));
  const geom = mergeGeoms(parts);
  const count = theme.huts;
  const mesh = new THREE.InstancedMesh(geom,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), count);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const f = makeFrame();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let a = 0; a < 8 && !placed; a++) {
      // Cluster on the lake: the first stretch of the lap, spread outward.
      const s = rng() * spline.length * 0.14;
      spline.frameAt(s, f);
      const side = rng() < 0.5 ? -1 : 1;
      const dist = f.width + 16 + rng() * 30;
      const rl = Math.hypot(f.R.x, f.R.z) || 1;
      const x = f.pos.x + (f.R.x / rl) * side * dist;
      const z = f.pos.z + (f.R.z / rl) * side * dist;
      if (!clearOfTrack(spline, x, z, 5)) continue;
      p.set(x, groundAt(groundY, x, z) + 0.02, z);
      q.setFromAxisAngle(Y, rng() * Math.PI * 2);
      sc.setScalar(0.9 + rng() * 0.35);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      placed = true;
    }
    if (!placed) { sc.setScalar(0); m.compose(p, q, sc); mesh.setMatrixAt(i, m); }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
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
  const N = rich(Math.min(theme.drones, Math.max(spots.length * 3, 12)));
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

// ---------------------------------------------------------- world density
// FULL tier buys a busier world. Ambient life (birds, drones, skiers, city
// traffic, sky cars, sailboats) is now AUTHORED at this richer density, and the
// quality tier thins it back with InstancedMesh.count — live, no rebuild, so
// ADAPTIVE can trim it mid-race. MEDIUM lands roughly where the game shipped.
const RICH = 1.6;
const rich = (n) => Math.max(1, Math.round(n * RICH));

// ------------------------------------------------------------------ motes
// Ambient atmosphere along the whole lap: sand motes, sea spray or neon
// rain depending on the world. Motion in the air sells "alive" more than
// any static prop.
// Wrap a world coordinate into a ±R window centred on c — the flake keeps a
// world position (so it parallaxes correctly), and only teleports at the far
// edge of the box where a 14cm speck is invisible anyway.
function wrapTo(v, c, R) {
  const d = v - c;
  return c + d - Math.floor((d + R) / (2 * R)) * 2 * R;
}

function buildMotes(rng, spline, theme) {
  const rain = theme.ambient.mode === 'rain';
  const snow = theme.ambient.mode === 'snow';
  // SNOW is camera-local: the old build scattered 200 flakes along the WHOLE
  // lap, so on a 4km circuit you drove through roughly six of them and the
  // weather may as well not have existed. These live in a box that follows the
  // camera and wrap around it, so the same one draw call buys real snowfall.
  const N = rain ? 170 : snow ? 850 : 140;
  const BOX = 44, VR = 11, V_MID = 5; // half-extents of the snow box, and its centre above the camera
  const geom = rain
    ? new THREE.BoxGeometry(0.045, 1.6, 0.045)
    : snow ? new THREE.BoxGeometry(0.13, 0.13, 0.13)
      : new THREE.BoxGeometry(0.17, 0.17, 0.17);
  const mesh = new THREE.InstancedMesh(geom, new THREE.MeshBasicMaterial({
    color: theme.ambient.color, transparent: true,
    opacity: rain ? 0.3 : snow ? 0.55 : 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  }), N);
  mesh.frustumCulled = false;
  const f = makeFrame();
  const bases = [];
  spline.frameAt(0, f);
  for (let i = 0; i < N; i++) {
    if (snow) {
      // Seeded anywhere in the box; the wrap makes the start position moot.
      bases.push({
        x: f.pos.x + (rng() * 2 - 1) * BOX,
        y: f.pos.y + (rng() * 2 - 1) * VR,
        z: f.pos.z + (rng() * 2 - 1) * BOX,
        ph: rng() * 100,
        sp: 0.5 + rng(),
        sz: 0.6 + rng() * 1.1,      // thick flakes and fine ones in the same fall
      });
      continue;
    }
    spline.frameAt(rng() * spline.length, f);
    bases.push({
      x: f.pos.x + f.R.x * (rng() - 0.5) * 56,
      y: f.pos.y + rng() * 13,
      z: f.pos.z + f.R.z * (rng() - 0.5) * 56,
      ph: rng() * 100,
      sp: 0.5 + rng(),
      sz: 1,
    });
  }
  const m = new THREE.Matrix4();
  return {
    mesh,
    // Quality tier: InstancedMesh.count is a live draw ceiling, so thinning the
    // weather costs nothing and needs no rebuild — the flakes that remain keep
    // their motion. Never below a handful, or "snowing" turns into "not".
    setDensity(f) { mesh.count = Math.max(12, Math.round(N * f)); },
    update(t, cam) {
      for (let i = 0; i < N; i++) {
        const b = bases[i];
        let x = b.x, y = b.y, z = b.z;
        if (rain) {
          y = b.y + 9 - ((t * 26 * b.sp + b.ph) % 18);
        } else if (snow) {
          // Slow tumbling fall with a lateral waft — unhurried, thick flakes.
          x = b.x + Math.sin(t * 0.7 * b.sp + b.ph) * 1.6;
          z = b.z + Math.cos(t * 0.5 * b.sp + b.ph * 1.3) * 1.3;
          y = b.y - t * 3.6 * b.sp;
          if (cam) {
            x = wrapTo(x, cam.x, BOX);
            z = wrapTo(z, cam.z, BOX);
            y = wrapTo(y, cam.y + V_MID, VR);
          }
        } else {
          x += Math.sin(t * 0.35 * b.sp + b.ph) * 3.2;
          y += Math.sin(t * 0.6 * b.sp + b.ph * 2) * 1.4;
          z += Math.cos(t * 0.3 * b.sp + b.ph) * 3.2;
        }
        m.makeScale(b.sz, b.sz, b.sz);
        m.setPosition(x, y, z);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------- sky traffic
// Aircars crossing high over the city on straight lanes.
function buildSkyTraffic(rng, cx, cz, groundY) {
  const N = rich(12);
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
  const FLOCKS = 3, PER = 9, N = FLOCKS * PER;   // was 2x7 — FULL flies a fuller sky
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
