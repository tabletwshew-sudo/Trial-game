import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

/**
 * The frame pipeline. The scene renders in HDR, bright things (the sun, water glints, muzzle
 * flashes, loot glows, crystals) bloom, then a single finishing pass does tone mapping, sRGB
 * and the colour grade together, and FXAA smooths edges.
 *
 * Low graphics skips all of it and renders straight to the screen (the canvas's own
 * anti-aliasing, the renderer's tone mapping), which is much cheaper on weak GPUs.
 */
export interface PostOptions { bloom: boolean; fxaa: boolean; direct: boolean }

/** Tone mapping + sRGB + grade in one full-screen pass (it used to be two). */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null }, toneMappingExposure: { value: 1 },
    saturation: { value: 1.15 }, contrast: { value: 1.03 }, vignette: { value: 0.24 }, time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
    attribute vec3 position; attribute vec2 uv;
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse; uniform float saturation, contrast, vignette, time;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = NeutralToneMapping(c.rgb);
      col = sRGBTransferOETF(vec4(col, 1.0)).rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      // a bright cartoon grade: shadows lifted and cool (a touch of blue), highlights warm
      col += vec3(-0.004, 0.012, 0.045) * (1.0 - smoothstep(0.0, 0.45, l));
      col += vec3(0.03, 0.014, -0.022) * smoothstep(0.55, 1.0, l);
      vec2 q = vUv - 0.5;
      col *= 1.0 - vignette * dot(q, q) * 1.5;
      // a whisper of noise so gradients (sky, fog) never band
      col += (fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Post {
  readonly composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private fxaa: ShaderPass | null = null;
  private finish: ShaderPass | null = null;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera, o: PostOptions) {
    if (o.direct) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (o.bloom) {
      // threshold sits above anything lit by the sun, so only glowing things bloom
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 3.4);
      this.composer.addPass(this.bloom);
    }
    this.finish = new ShaderPass(new THREE.RawShaderMaterial({ uniforms: THREE.UniformsUtils.clone(FinishShader.uniforms), vertexShader: FinishShader.vertexShader, fragmentShader: FinishShader.fragmentShader, depthTest: false, depthWrite: false }));
    this.composer.addPass(this.finish);
    if (o.fxaa) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
  }

  setSize(w: number, h: number, pixelRatio: number) {
    if (!this.composer) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    // bloom is soft anyway: run its blur chain at half the size again
    this.bloom?.setSize(Math.round(w * pixelRatio * 0.5), Math.round(h * pixelRatio * 0.5));
    if (this.fxaa) (this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / (w * pixelRatio), 1 / (h * pixelRatio));
  }

  render(dt: number) {
    if (!this.composer) { this.renderer.render(this.scene, this.camera); return; }
    const u = this.finish!.uniforms.time;
    u.value = (u.value + dt) % 100;
    this.composer.render(dt);
  }

  dispose() { this.composer?.dispose(); }
}
