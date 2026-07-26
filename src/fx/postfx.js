// EffectComposer with MSAA preserved, a quarter-res bloom, and ONE custom
// JuicePass: vignette, speed-scaled chromatic aberration, radial blur,
// full-screen flash.
//
// The geometric fake-glow (additive ribbons under the neon edges) STAYS — it is
// what gives the road its hard-edged WipEout look, and bloom on its own is
// mush. Bloom is the layer the fake glow never covered: engine bells, weapon
// rounds, pad decals, the aurora, the sun gate. It is FULL-tier only.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { TUNING as T } from '../config.js';

const JuiceShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: T.VIGNETTE_BASE },
    chroma: { value: 0 },
    radial: { value: 0 },
    flash: { value: 0 },
    heat: { value: 0 },     // desert heat-haze amount (0 elsewhere)
    uTime: { value: 0 },
    gradeContrast: { value: 1.07 },   // per-world filmic grade (set by applyTheme)
    gradeSat: { value: 1.13 },
    vigTint: { value: new THREE.Color(0x05030f) }, // corners melt toward sky zenith
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette, chroma, radial, flash, heat, uTime, gradeContrast, gradeSat;
    uniform vec3 vigTint;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - 0.5;
      vec3 col = vec3(0.0);
      // Readability guard: keep the central ~30% (player ship, road ahead, the
      // nearest rival) free of chroma + radial smear — the speed FX ramps in only
      // toward the screen edges. Lets us push edge drama without muddying play.
      float clarity = smoothstep(0.20, 0.58, length(dir));
      float ch = chroma * clarity;
      float rad = radial * clarity;
      // Heat-haze: a faint HORIZONTAL shimmer confined to a band near the
      // horizon — band-limited and tiny so it never reads as the radial blur.
      float hband = exp(-pow((vUv.y - 0.54) * 6.0, 2.0));
      vec2 heatOff = vec2(sin(vUv.y * 90.0 + uTime * 3.0) * 0.0016, 0.0) * heat * hband;
      // 4 radial-blur taps; chromatic offset folded into each tap (12 reads).
      for (int i = 0; i < 4; i++) {
        vec2 o = vUv - dir * rad * (float(i) / 3.0) + heatOff;
        col.r += texture2D(tDiffuse, o + dir * ch).r;
        col.g += texture2D(tDiffuse, o).g;
        col.b += texture2D(tDiffuse, o - dir * ch).b;
      }
      col /= 4.0;
      // Vignette: darken the corners (monotonic — never lightens), then lean
      // the darkened corner slightly toward the world's sky-zenith colour so the
      // frame edge melts into the backdrop without inverting on bright worlds.
      float vig = vignette * smoothstep(0.35, 1.45, length(dir) * 2.0);
      col *= 1.0 - vig;
      col = mix(col, vigTint, vig * 0.35);
      col = mix(col, vec3(1.0), flash);
      // Per-world filmic grade: contrast + saturation tuned per theme (applyTheme).
      // HDR-safe — no hard clamp before tonemap.
      col = (col - 0.5) * gradeContrast + 0.5;
      float gl = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(gl), col, gradeSat);
      // Ordered dither (~1/255) breaks HalfFloat banding in the smooth sky gradient.
      // STATIC (no uTime): banding is spatial, so a fixed pattern fixes it without
      // a per-frame flicker (respects reduced-motion) or long-session hash drift.
      float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      col += (d - 0.5) / 255.0;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// ------------------------------------------------------------------ bloom
// A compact threshold bloom: bright-pass to quarter resolution, separable
// 9-tap blur, add back. Four small draws, and every one of them at 1/16 the
// pixels — the whole point on a fill-bound budget. UnrealBloomPass would give
// a softer falloff off five mip levels; that is five times the bandwidth for a
// look this game does not want, because the neon here should stay hard-edged
// with a halo, not dissolve.
const BrightShader = {
  uniforms: { tDiffuse: { value: null }, threshold: { value: 0.85 }, knee: { value: 0.55 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float threshold; uniform float knee;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // Luminance-gated, but keep the SOURCE colour: a magenta engine must
      // bloom magenta, not white. Soft knee so the threshold has no visible
      // contour crawling across a gradient.
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float w = smoothstep(threshold, threshold + knee, l);
      gl_FragColor = vec4(c * w, 1.0);
    }
  `,
};

const BlurShader = {
  uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, texel: { value: new THREE.Vector2() } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 texel;
    varying vec2 vUv;
    void main() {
      // 9-tap gaussian folded into 5 bilinear fetches.
      vec2 o1 = dir * texel * 1.3846153846;
      vec2 o2 = dir * texel * 3.2307692308;
      vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
      c += texture2D(tDiffuse, vUv + o1).rgb * 0.3162162162;
      c += texture2D(tDiffuse, vUv - o1).rgb * 0.3162162162;
      c += texture2D(tDiffuse, vUv + o2).rgb * 0.0702702703;
      c += texture2D(tDiffuse, vUv - o2).rgb * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

// Light shafts. The mask is the bloom's own bright pass — everything already
// bright enough to glow is also what should occlude and cast — radially blurred
// away from the sun's screen position. That reuse is the whole trick: shafts
// cost ONE extra quarter-res pass rather than a mask render of their own.
const ShaftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uAmount: { value: 0 },
    uDensity: { value: 0.62 },
    uDecay: { value: 0.94 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uSun;
    uniform float uAmount; uniform float uDensity; uniform float uDecay;
    varying vec2 vUv;
    const int SAMPLES = 16;
    void main() {
      if (uAmount <= 0.001) { gl_FragColor = vec4(0.0); return; }
      // Named march, not step: step is a GLSL builtin.
      vec2 march = (vUv - uSun) * (uDensity / float(SAMPLES));
      vec2 uv = vUv;
      vec3 acc = vec3(0.0);
      float w = 1.0, total = 0.0;
      for (int i = 0; i < SAMPLES; i++) {
        acc += texture2D(tDiffuse, uv).rgb * w;
        total += w;
        uv -= march;
        w *= uDecay;
      }
      gl_FragColor = vec4(acc / max(total, 1e-4) * uAmount, 1.0);
    }
  `,
};

const CombineShader = {
  uniforms: {
    tDiffuse: { value: null }, tTight: { value: null }, tWide: { value: null },
    tShaft: { value: null }, strength: { value: 0.55 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tTight; uniform sampler2D tWide;
    uniform sampler2D tShaft; uniform float strength;
    varying vec2 vUv;
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      // Two radii, not one. The tight level (quarter res) keeps the halo close
      // to the source so neon still reads as a hard line; the wide level
      // (eighth res) is the broad atmospheric wash a single radius cannot give
      // without smearing the core. Weighted so the core dominates.
      vec3 glow = texture2D(tTight, vUv).rgb * 0.68 + texture2D(tWide, vUv).rgb * 0.55;
      // Shafts add on their own terms, NOT scaled by bloom strength: a world can
      // want a hard sun with a restrained halo, or the reverse.
      gl_FragColor = vec4(base + glow * strength + texture2D(tShaft, vUv).rgb, 1.0);
    }
  `,
};

class BloomPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);   // quarter res, tight halo
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);   // quarter res, blur ping-pong
    this.rtC = new THREE.WebGLRenderTarget(1, 1, opts);   // eighth res, wide wash
    this.rtD = new THREE.WebGLRenderTarget(1, 1, opts);   // eighth res, blur ping-pong
    this.rtS = new THREE.WebGLRenderTarget(1, 1, opts);   // quarter res, light shafts
    this.copy = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }',
    });
    this.bright = new THREE.ShaderMaterial({ ...BrightShader, uniforms: THREE.UniformsUtils.clone(BrightShader.uniforms) });
    this.blur = new THREE.ShaderMaterial({ ...BlurShader, uniforms: THREE.UniformsUtils.clone(BlurShader.uniforms) });
    this.combine = new THREE.ShaderMaterial({ ...CombineShader, uniforms: THREE.UniformsUtils.clone(CombineShader.uniforms) });
    this.shaft = new THREE.ShaderMaterial({ ...ShaftShader, uniforms: THREE.UniformsUtils.clone(ShaftShader.uniforms) });
    this.quad = new FullScreenQuad(this.bright);
  }

  setSize(w, h) {
    const qw = Math.max(1, Math.floor(w / 4)), qh = Math.max(1, Math.floor(h / 4));
    const ew = Math.max(1, Math.floor(w / 8)), eh = Math.max(1, Math.floor(h / 8));
    this.rtA.setSize(qw, qh); this.rtB.setSize(qw, qh); this.rtS.setSize(qw, qh);
    this.rtC.setSize(ew, eh); this.rtD.setSize(ew, eh);
    this._quarter = [1 / qw, 1 / qh];
    this._eighth = [1 / ew, 1 / eh];
  }

  // Separable blur helper: src -> dst via a ping-pong buffer, at the texel
  // scale of whichever level we are on.
  _blur(renderer, src, mid, dst, texel) {
    this.quad.material = this.blur;
    this.blur.uniforms.texel.value.set(texel[0], texel[1]);
    this.blur.uniforms.tDiffuse.value = src.texture;
    this.blur.uniforms.dir.value.set(1, 0);
    renderer.setRenderTarget(mid); this.quad.render(renderer);
    this.blur.uniforms.tDiffuse.value = mid.texture;
    this.blur.uniforms.dir.value.set(0, 1);
    renderer.setRenderTarget(dst); this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    const oldTarget = renderer.getRenderTarget();
    this.bright.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.bright;
    renderer.setRenderTarget(this.rtA); this.quad.render(renderer);

    // Shafts read the RAW mask (rtA before the blur) — a pre-blurred source
    // gives mush instead of beams.
    this.quad.material = this.shaft;
    this.shaft.uniforms.tDiffuse.value = this.rtA.texture;
    renderer.setRenderTarget(this.rtS); this.quad.render(renderer);

    this._blur(renderer, this.rtA, this.rtB, this.rtA, this._quarter);

    // Downsample the tight level and blur again: the wide halo comes almost
    // free because it is 1/64 of the frame's pixels.
    this.quad.material = this.copy;
    this.copy.uniforms.tDiffuse.value = this.rtA.texture;
    renderer.setRenderTarget(this.rtC); this.quad.render(renderer);
    this._blur(renderer, this.rtC, this.rtD, this.rtC, this._eighth);

    this.quad.material = this.combine;
    this.combine.uniforms.tDiffuse.value = readBuffer.texture;
    this.combine.uniforms.tTight.value = this.rtA.texture;
    this.combine.uniforms.tWide.value = this.rtC.texture;
    this.combine.uniforms.tShaft.value = this.rtS.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
    renderer.setRenderTarget(oldTarget);
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose(); this.rtC.dispose(); this.rtD.dispose(); this.rtS.dispose();
    this.bright.dispose(); this.blur.dispose(); this.combine.dispose(); this.copy.dispose(); this.shaft.dispose();
    this.quad.dispose();
  }
}

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.samples = 4;
    const size = renderer.getSize(new THREE.Vector2());
    this._build(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
    this.setSize(size.x, size.y);
  }

  _build(w, h) {
    const old = this.composer;
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      samples: this.samples,
      type: THREE.HalfFloatType,
    });
    const enabled = this.juicePass ? this.juicePass.enabled : true;
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom sits BEFORE the grade: bloom the raw additive scene, then let the
    // JuicePass grade and vignette the result. The other order haloes the
    // vignette itself, which reads as a smeared lens rather than bright neon.
    const bloomWasOn = this.bloomPass ? this.bloomPass.enabled : false;
    if (this.bloomPass) this.bloomPass.dispose();
    this.bloomPass = new BloomPass();
    this.bloomPass.enabled = bloomWasOn;
    this.composer.addPass(this.bloomPass);
    // Rebuilt targets get a FRESH ShaderPass but must keep the tuned uniforms:
    // theme grade and vignette tint are set once per world, not per frame, and
    // silently losing them on a quality change would flatten the world's look.
    const prev = this.juicePass;
    this.juicePass = new ShaderPass(JuiceShader);
    this.juicePass.enabled = enabled;
    if (prev) {
      for (const k of Object.keys(this.juicePass.uniforms)) {
        if (prev.uniforms[k] === undefined) continue;
        const a = this.juicePass.uniforms[k].value, b = prev.uniforms[k].value;
        if (a && a.copy && b && b.isColor === a.isColor) a.copy(b);
        else this.juicePass.uniforms[k].value = b;
      }
      prev.dispose && prev.dispose();
    }
    this.composer.addPass(this.juicePass);
    this.composer.addPass(new OutputPass());
    if (old) old.dispose();
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  // MSAA sample count on the composer's target. WebGL cannot change the sample
  // count of a live framebuffer, so this rebuilds the chain — call it on a
  // settings change, never per frame.
  setSamples(n) {
    if (n === this.samples) return;
    this.samples = n;
    const size = this.renderer.getSize(new THREE.Vector2());
    this._build(size.x * this.renderer.getPixelRatio(), size.y * this.renderer.getPixelRatio());
    this.setSize(size.x, size.y);
  }

  // Bypass the 12-tap JuicePass. The grade goes with it, so LOW looks flatter —
  // that is the honest trade, and it is a whole full-screen pass saved.
  setPostEnabled(on) {
    if (this.juicePass) this.juicePass.enabled = !!on;
  }

  setBloomEnabled(on) {
    if (this.bloomPass) this.bloomPass.enabled = !!on;
  }

  // Sun in screen UV plus how hard it should cast. main.js projects the world
  // sun direction each frame; amount is already faded for off-screen and
  // behind-camera there, so this just forwards it.
  setSunShafts(u, v, amount) {
    if (!this.bloomPass) return;
    const s = this.bloomPass.shaft.uniforms;
    s.uSun.value.set(u, v);
    s.uAmount.value = amount;
  }

  // Per-world bloom tuning. A night circuit under an aurora wants a lower
  // threshold than a desert at golden hour, where half the sky is already
  // above it and everything would haze over.
  setBloom(threshold, strength) {
    if (!this.bloomPass) return;
    this.bloomPass.bright.uniforms.threshold.value = threshold;
    this.bloomPass.combine.uniforms.strength.value = strength;
  }

  // Per-world grade: contrast/saturation from theme.grade, and a vignette tint
  // pulled from the world's deep sky-zenith colour (darkened so it still reads
  // as a vignette). Variety through grade + composition, not palette swaps.
  applyTheme(theme) {
    const u = this.juicePass.uniforms;
    const g = (theme && theme.grade) || {};
    u.gradeContrast.value = g.contrast ?? 1.07;
    u.gradeSat.value = g.saturation ?? 1.13;
    const zenith = theme && theme.sky ? theme.sky.zenith : 0x05030f;
    u.vigTint.value.set(zenith).multiplyScalar(0.6);
    // Per-world bloom. A night circuit under an aurora can take a low
    // threshold; a desert at golden hour has half the sky above it already and
    // would haze over, so it needs a high one. Themes may override both.
    const b = (theme && theme.bloom) || {};
    this.setBloom(b.threshold ?? 0.82, b.strength ?? 0.5);
    this.shaftStrength = b.shafts ?? 0.35;
  }

  update(speedNorm, juice, heat = 0, t = 0) {
    const u = this.juicePass.uniforms;
    const sn2 = speedNorm * speedNorm;
    u.vignette.value = T.VIGNETTE_BASE + T.VIGNETTE_SPEED * sn2;
    u.chroma.value = T.CHROMA_BASE * sn2 * (1 + (T.CHROMA_BOOST_MULT - 1) * juice.boostFactor);
    u.radial.value = Math.min(
      T.RADIAL_SPEED * sn2 + T.RADIAL_BOOST * juice.boostFactor * (1 + juice.fovSpike / T.FOV_BOOST_SPIKE),
      T.RADIAL_CAP,
    );
    u.flash.value = juice.flash;
    u.heat.value = heat;
    u.uTime.value = t;
  }

  render() {
    this.composer.render();
  }
}
