import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Scene → multisampled HDR target (the only target that needs MSAA) → bloom at half resolution →
// ONE full-screen "grade" pass that adds the bloom, runs every screen effect, tone maps and writes
// sRGB straight to the canvas. A composer chain spent three extra full-resolution passes here, two of
// them into 4x-MSAA targets, on work this single pass does in registers.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    toneMappingExposure: { value: 1 },
    time: { value: 0 },
    ca: { value: 0.0015 },       // chromatic aberration, radial
    hurt: { value: 0 },          // red vignette pulse
    flash: { value: 0 },         // white flash
    invert: { value: 0 },        // impact frame (1 = full negative)
    sat: { value: 1 },           // saturation
    vig: { value: 0.35 },
    lowHp: { value: 0 },         // desaturate + heartbeat edges
    dark: { value: 0 },          // blackout crush
    res: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `precision highp float;
uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
attribute vec3 position; attribute vec2 uv;
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `precision highp float;
uniform sampler2D tDiffuse, tBloom; uniform float time, ca, hurt, flash, invert, sat, vig, lowHp, dark; uniform vec2 res;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  // slight barrel for a CRT-ish bulge
  uv = 0.5 + d * (1.0 + r2 * 0.06);
  vec2 off = d * (ca + hurt * 0.012) * (0.6 + r2 * 3.0);
  vec3 c;
  c.r = texture2D(tDiffuse, uv + off).r;
  c.g = texture2D(tDiffuse, uv).g;
  c.b = texture2D(tDiffuse, uv - off).b;
  // bloom is soft enough that splitting it per channel changes nothing visible; one tap
  c += texture2D(tBloom, uv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, sat * (1.0 - lowHp * 0.55));
  // vignette, tinted red when hurt or low on health
  float edge = 1.0 - smoothstep(0.95, 0.25, length(d) * 1.25);
  vec3 vc = mix(vec3(0.0), vec3(0.6, 0.0, 0.06), clamp(hurt * 1.5 + lowHp * 0.7, 0.0, 1.0));
  c = mix(c, vc, edge * clamp(vig + hurt * 0.6 + lowHp * 0.3, 0.0, 1.0));
  c *= 1.0 - dark * 0.55;
  // scanlines + grain
  float scan = 0.96 + 0.04 * sin(vUv.y * res.y * 1.5);
  c *= scan;
  c += (hash(vUv * res + time * 60.0) - 0.5) * 0.06;
  // impact frame: posterised negative
  vec3 inv = vec3(1.0) - clamp(c, 0.0, 1.0);
  inv = step(0.5, dot(inv, vec3(0.333))) * vec3(1.0, 0.95, 0.9);
  c = mix(c, inv, invert);
  c = mix(c, vec3(1.0), flash);
  gl_FragColor = vec4(NeutralToneMapping(c), 1.0);
  gl_FragColor = sRGBTransferOETF(gl_FragColor);
}`,
};

// UnrealBloomPass minus its last step: it would blend the bloom back into the (multisampled) scene
// target at full resolution. The grade pass reads the bloom texture instead.
class Bloom extends UnrealBloomPass {
  get texture() { return this.renderTargetsHorizontal[0].texture; }
  render(renderer, src) {
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    this.highPassUniforms.tDiffuse.value = src.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this._fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this._fsQuad.render(renderer);
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this._fsQuad.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this._fsQuad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this._fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }
    this._fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this._fsQuad.render(renderer);
    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}

export function createPost(renderer, scene, camera, samples = 4) {
  const size0 = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size0.x, size0.y, { type: THREE.HalfFloatType, samples, resolveDepthBuffer: false });
  // only allocated once FXAA is on: the graded LDR frame it smooths
  let ldr = null;
  const size = renderer.getSize(new THREE.Vector2());
  const bloom = new Bloom(new THREE.Vector2(size.x / 2, size.y / 2), 0.75, 0.5, 1.2);
  const grade = new THREE.RawShaderMaterial({ ...GradeShader, uniforms: THREE.UniformsUtils.clone(GradeShader.uniforms), depthTest: false, depthWrite: false });
  const gradeQuad = new FullScreenQuad(grade);
  const fxaaMat = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false });
  const fxaaQuad = new FullScreenQuad(fxaaMat);
  let fxaa = samples === 0;
  const u = grade.uniforms;
  u.tBloom.value = bloom.texture;

  const fx = { hurt: 0, flash: 0, invert: 0, ca: 0, lowHp: 0, dark: 0, sat: 1 };
  const px = new THREE.Vector2();
  const ensureLdr = () => {
    if (!fxaa) return;
    if (!ldr) ldr = new THREE.WebGLRenderTarget(px.x, px.y);
    else ldr.setSize(px.x, px.y);
  };
  return {
    target, bloom, u, fx,
    setSize(w, h, pr) {
      px.set(Math.floor(w * pr), Math.floor(h * pr));
      target.setSize(px.x, px.y);
      bloom.setSize(px.x, px.y);
      ensureLdr();
      u.res.value.copy(px);
      fxaaMat.uniforms.resolution.value.set(1 / px.x, 1 / px.y);
    },
    get samples() { return target.samples; },
    // MSAA on the half-float target is the priciest part of a frame after fill rate; 0 swaps in FXAA
    setSamples(n) {
      target.samples = n;
      target.dispose();
      fxaa = n === 0;
      ensureLdr();
    },
    pulse(kind, amount = 1) {
      if (kind === 'hurt') fx.hurt = Math.min(1, fx.hurt + amount);
      if (kind === 'flash') fx.flash = Math.max(fx.flash, amount);
      if (kind === 'invert') fx.invert = amount;
      if (kind === 'ca') fx.ca = Math.max(fx.ca, amount);
    },
    render(dt, t) {
      fx.hurt = Math.max(0, fx.hurt - dt * 1.8);
      fx.flash = Math.max(0, fx.flash - dt * 3.5);
      fx.invert = Math.max(0, fx.invert - dt * 14);
      fx.ca = Math.max(0, fx.ca - dt * 0.05);
      u.time.value = t;
      u.hurt.value = fx.hurt;
      u.flash.value = fx.flash;
      u.invert.value = fx.invert > 0.5 ? 1 : 0;
      u.ca.value = 0.0012 + fx.ca;
      u.lowHp.value += (fx.lowHp - u.lowHp.value) * Math.min(1, dt * 4);
      u.dark.value += (fx.dark - u.dark.value) * Math.min(1, dt * 6);
      u.sat.value = fx.sat;
      u.toneMappingExposure.value = renderer.toneMappingExposure;

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      bloom.render(renderer, target);
      u.tDiffuse.value = target.texture;
      renderer.setRenderTarget(fxaa ? ldr : null);
      gradeQuad.render(renderer);
      if (fxaa) {
        fxaaMat.uniforms.tDiffuse.value = ldr.texture;
        renderer.setRenderTarget(null);
        fxaaQuad.render(renderer);
      }
    },
  };
}
