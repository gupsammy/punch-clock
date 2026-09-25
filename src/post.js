import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Render → bloom → one "grade" pass that does every screen effect at once
// (fewer full-screen passes matters on phones) → output (tone map + sRGB).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
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
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
uniform sampler2D tDiffuse; uniform float time, ca, hurt, flash, invert, sat, vig, lowHp, dark; uniform vec2 res;
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
  gl_FragColor = vec4(c, 1.0);
}`,
};

export function createPost(renderer, scene, camera, samples = 4) {
  // The composer's own target ignores the canvas antialias flag, so multisample it here.
  const size0 = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size0.x, size0.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const size = renderer.getSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.75, 0.5, 1.2);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  // the cheap fallback once a slow GPU has lost its multisampling (see setSamples)
  const fxaa = new ShaderPass(FXAAShader);
  fxaa.enabled = samples === 0;
  composer.addPass(fxaa);
  const u = grade.uniforms;

  const fx = { hurt: 0, flash: 0, invert: 0, ca: 0, lowHp: 0, dark: 0, sat: 1 };
  return {
    composer, bloom, u, fx,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      u.res.value.set(w * pr, h * pr);
      fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    },
    get samples() { return composer.renderTarget1.samples; },
    // MSAA on the half-float target is the priciest part of a frame after fill rate; 0 swaps in FXAA
    setSamples(n) {
      for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = n; t.dispose(); }
      fxaa.enabled = n === 0;
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
      composer.render(dt);
    },
  };
}
