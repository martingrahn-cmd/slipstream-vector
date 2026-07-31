// Trophy shapes — the things you actually win, as OBJECTS rather than emoji.
//
// Each achievement names a `form`; this module builds that form procedurally,
// tints it for its tier, and bakes it to an image the gallery can hang on a
// wall. Baking rather than keeping 31 live canvases matters: the gallery is a
// menu screen, it should cost one render each and then nothing.
//
// Why procedural and not art: the whole game is textureless flat-shaded neon
// (CLAUDE.md), and a wall of imported icons would look foreign next to it. A
// low-poly cup lit by two lamps reads as the same world as the ships.
import * as THREE from 'three';

const TIER_METAL = {
  bronze: { base: 0xc87a3a, hi: 0xf0b071 },
  silver: { base: 0xc3cad8, hi: 0xf2f6ff },
  gold: { base: 0xe8b830, hi: 0xffe27a },
  platinum: { base: 0x8fe8f5, hi: 0xdcfbff },
};
const LOCKED = { base: 0x2a2a3a, hi: 0x3b3b50 };

// ---------------------------------------------------------------- forms
// Every builder returns a Group centred on the origin, roughly 2.4 units tall,
// so one camera frames all of them without per-form tuning.
function bowl(mat) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(0.11 + Math.pow(t, 0.55) * 0.52, t * 0.88));
  }
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 18), mat);
}

// Build a part twice, once mirrored, WITHOUT scale.x = -1: a negative scale
// flips the winding, and a flat-shaded mirror image renders black. A pivot
// turned a half revolution is a real rotation, so both halves light the same.
function starShape(outer, inner) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? sh.lineTo(x, y) : sh.moveTo(x, y);
  }
  sh.closePath();
  return sh;
}

function pair(g, make) {
  g.add(make());
  const pivot = new THREE.Group();
  pivot.rotation.y = Math.PI;
  pivot.add(make());
  g.add(pivot);
}

function stemAndBase(mat, g) {
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.42, 12), mat);
  stem.position.y = -0.22;
  g.add(stem);
  const knop = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), mat);
  knop.position.y = -0.04;
  g.add(knop);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.13, 16), mat);
  base.position.y = -0.51;
  g.add(base);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.18, 0.86), mat);
  plinth.position.y = -0.70;
  g.add(plinth);
}

const FORMS = {
  cup(mat) {
    const g = new THREE.Group();
    const b = bowl(mat); b.position.y = 0.02; g.add(b);
    // Handles: an arc symmetric about +X, its ends buried in the bowl wall so
    // only the outer bulge shows. Centred on the bowl's waist, not its rim.
    pair(g, () => {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.055, 8, 18, Math.PI * 1.25), mat);
      h.rotation.z = -Math.PI * 0.625;
      h.position.set(0.52, 0.46, 0);
      return h;
    });
    stemAndBase(mat, g);
    return g;
  },
  star(mat) {
    const g = new THREE.Group();
    const sh = starShape(0.72, 0.30);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 }), mat);
    m.position.set(0, 0.42, -0.08);
    g.add(m);
    stemAndBase(mat, g);
    return g;
  },
  shield(mat) {
    const g = new THREE.Group();
    const crest = (w, h) => {
      const sh = new THREE.Shape();
      sh.moveTo(-w, h * 0.72);
      sh.quadraticCurveTo(0, h, w, h * 0.72);      // domed top, not a flat lid
      sh.quadraticCurveTo(w * 1.10, -h * 0.18, 0, -h);
      sh.quadraticCurveTo(-w * 1.10, -h * 0.18, -w, h * 0.72);
      return sh;
    };
    const back = new THREE.Mesh(new THREE.ExtrudeGeometry(crest(0.58, 0.70), { depth: 0.14, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 1 }), mat);
    back.position.set(0, 0.48, -0.09); g.add(back);
    // A raised inner panel: one flat slab reads as a paddle, a rim and a face
    // at different depths catch the key and the cyan rim differently.
    const face = new THREE.Mesh(new THREE.ExtrudeGeometry(crest(0.40, 0.49), { depth: 0.09, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.03, bevelSegments: 1 }), mat);
    face.position.set(0, 0.46, 0.06); g.add(face);
    stemAndBase(mat, g);
    return g;
  },
  gem(mat) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.55, 8), mat);
    top.position.y = 0.72; g.add(top);
    const bot = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.92, 8), mat);
    bot.position.y = 0.0; bot.rotation.z = Math.PI; g.add(bot);
    stemAndBase(mat, g);
    return g;
  },
  wing(mat) {
    const g = new THREE.Group();
    const boss = new THREE.Mesh(new THREE.OctahedronGeometry(0.23, 0), mat);
    boss.position.y = 0.52; boss.scale.set(0.8, 1.25, 0.8); g.add(boss);
    // Swept back, stepped trailing edge — the old wing was a symmetric leaf on
    // each side and read as a bow tie. Feather steps and a raked tip are what
    // say "wing" at 88 pixels.
    pair(g, () => {
      const sh = new THREE.Shape();
      sh.moveTo(0.02, 0.14);
      sh.lineTo(0.72, 0.44); sh.lineTo(1.06, 0.60);   // leading edge, raked up
      sh.lineTo(1.00, 0.34);
      sh.lineTo(0.70, 0.26); sh.lineTo(0.76, 0.06);   // three feather steps
      sh.lineTo(0.46, 0.02); sh.lineTo(0.52, -0.17);
      sh.lineTo(0.24, -0.19); sh.lineTo(0.28, -0.34);
      sh.lineTo(0.02, -0.16);
      sh.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.09, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }), mat);
      m.position.set(0.13, 0.44, -0.04);
      m.rotation.z = 0.16;
      return m;
    });
    stemAndBase(mat, g);
    return g;
  },
  // A medal, not a plate: rim, face, and a star in relief. A bare cylinder
  // read as a dinner plate on its edge.
  disc(mat) {
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.13, 26), mat);
    face.rotation.x = Math.PI / 2; face.position.y = 0.52; g.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.08, 8, 26), mat);
    rim.position.y = 0.52; g.add(rim);
    const relief = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.44, 0.18), { depth: 0.10, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }), mat);
    relief.position.set(0, 0.52, 0.04); g.add(relief);
    stemAndBase(mat, g);
    return g;
  },
  bolt(mat) {
    const g = new THREE.Group();
    const sh = new THREE.Shape();
    sh.moveTo(0.10, 0.80); sh.lineTo(-0.42, 0.10); sh.lineTo(-0.06, 0.06);
    sh.lineTo(-0.24, -0.72); sh.lineTo(0.40, 0.06); sh.lineTo(0.04, 0.10);
    sh.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }), mat);
    m.position.set(0, 0.42, -0.08); g.add(m);
    stemAndBase(mat, g);
    return g;
  },
  ring(mat) {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.13, 10, 24), mat);
    t.position.y = 0.46; g.add(t);
    stemAndBase(mat, g);
    return g;
  },
  chevron(mat) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const sh = new THREE.Shape();
      sh.moveTo(-0.55, 0); sh.lineTo(0, 0.34); sh.lineTo(0.55, 0);
      sh.lineTo(0.55, -0.16); sh.lineTo(0, 0.18); sh.lineTo(-0.55, -0.16);
      sh.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.10, bevelEnabled: false }), mat);
      m.position.set(0, 0.08 + i * 0.30, -0.05);
      g.add(m);
    }
    stemAndBase(mat, g);
    return g;
  },
};

export const TROPHY_FORMS = Object.keys(FORMS);

// ------------------------------------------------------------- the baker
// One renderer, one scene, reused for every trophy. Results are cached by
// form+tier+locked, so opening the gallery twice costs nothing the second time.
export class TrophyBaker {
  constructor(size = 176) {
    this.size = size;
    this.cache = new Map();
    this.renderer = null;
  }

  _init() {
    if (this.renderer) return;
    const s = this.size;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(s, s, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    // Two lamps and a rim: enough to read a metal form, and flatShading keeps
    // the facets so it belongs next to the ships.
    this.scene.add(new THREE.AmbientLight(0x46566e, 0.85));
    const key = new THREE.DirectionalLight(0xfff4dc, 2.4);
    key.position.set(2.2, 3.0, 2.4);
    this.scene.add(key);
    // A soft white light down the camera axis. Without it the faces we actually
    // look at are lit only by the coloured lamps, and every tier came out the
    // same salmon — gold stopped reading as gold.
    const front = new THREE.DirectionalLight(0xe6eeff, 0.6);
    front.position.set(0.4, 0.3, 1.0);
    this.scene.add(front);
    // The neon pair belongs BEHIND the object, where it draws edges instead of
    // tinting the face: cyan left, magenta right, the game's own two colours.
    const cyan = new THREE.DirectionalLight(0x00f0ff, 1.9);
    cyan.position.set(-2.6, 0.9, -1.8);
    this.scene.add(cyan);
    const mag = new THREE.DirectionalLight(0xff2ec8, 1.2);
    mag.position.set(2.2, -0.5, -2.0);
    this.scene.add(mag);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
  }

  // Returns a data URL for one trophy. `locked` renders the same form in dead
  // metal, so the gallery shows the SHAPE of what you have not won yet — a
  // silhouette is a goal, a padlock is just a padlock.
  bake(form, tier, locked = false) {
    const key = `${form}|${tier}|${locked ? 'L' : 'U'}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    this._init();
    const pal = locked ? LOCKED : (TIER_METAL[tier] || TIER_METAL.bronze);
    const mat = new THREE.MeshPhongMaterial({
      color: pal.base, specular: pal.hi, shininess: locked ? 8 : 60,
      flatShading: true,
    });
    const build = FORMS[form] || FORMS.cup;
    const g = build(mat);
    // A shallow turn: enough to show depth, not enough to hide the far handle
    // of a cup or the far wing behind the body.
    g.rotation.y = -0.26;
    this.holder.add(g);
    // FRAME THE OBJECT, don't guess a camera. The forms differ in height by
    // nearly 2x — a fixed pose cropped the cup's bowl and left the ring
    // swimming in space. Fit to the actual bounding sphere every time.
    this.holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (sph.radius * 1.16) / Math.sin(fov / 2);   // 16% air around it
    const dir = new THREE.Vector3(0.40, 0.30, 1).normalize();
    this.camera.position.copy(sph.center).addScaledVector(dir, dist);
    this.camera.lookAt(sph.center);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.holder.remove(g);
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    mat.dispose();
    this.cache.set(key, url);
    return url;
  }

  dispose() {
    if (this.renderer) this.renderer.dispose();
    this.renderer = null;
    this.cache.clear();
  }
}
