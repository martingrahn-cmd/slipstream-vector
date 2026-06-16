// EffectComposer with MSAA preserved + ONE custom JuicePass:
// vignette, speed-scaled chromatic aberration, radial blur, full-screen flash.
// No UnrealBloom — the neon glow is faked geometrically and reads better.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TUNING as T } from '../config.js';

const JuiceShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: T.VIGNETTE_BASE },
    chroma: { value: 0 },
    radial: { value: 0 },
    flash: { value: 0 },
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
    uniform float vignette, chroma, radial, flash;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - 0.5;
      vec3 col = vec3(0.0);
      // 4 radial-blur taps; chromatic offset folded into each tap (12 reads).
      for (int i = 0; i < 4; i++) {
        vec2 o = vUv - dir * radial * (float(i) / 3.0);
        col.r += texture2D(tDiffuse, o + dir * chroma).r;
        col.g += texture2D(tDiffuse, o).g;
        col.b += texture2D(tDiffuse, o - dir * chroma).b;
      }
      col /= 4.0;
      col *= 1.0 - vignette * smoothstep(0.35, 1.45, length(dir) * 2.0);
      col = mix(col, vec3(1.0), flash);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: 4,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.juicePass = new ShaderPass(JuiceShader);
    this.composer.addPass(this.juicePass);
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  update(speedNorm, juice) {
    const u = this.juicePass.uniforms;
    const sn2 = speedNorm * speedNorm;
    u.vignette.value = T.VIGNETTE_BASE + T.VIGNETTE_SPEED * sn2;
    u.chroma.value = T.CHROMA_BASE * sn2 * (1 + (T.CHROMA_BOOST_MULT - 1) * juice.boostFactor);
    u.radial.value = Math.min(
      T.RADIAL_SPEED * sn2 + T.RADIAL_BOOST * juice.boostFactor * (1 + juice.fovSpike / T.FOV_BOOST_SPIKE),
      T.RADIAL_CAP,
    );
    u.flash.value = juice.flash;
  }

  render() {
    this.composer.render();
  }
}
