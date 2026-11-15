import * as THREE from 'three';
import { stormAt, type StormPlan, type StormState } from '@dropzone/shared';

/**
 * The storm wall: a huge open cylinder with swirling purple bands, drawn from both sides,
 * so it reads as a wall from outside and a glowing curtain from inside.
 */
export class StormView {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  plan: StormPlan | null = null;
  state: StormState | null = null;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { time: { value: 0 }, radius: { value: 1000 } },
      vertexShader: /* glsl */ `
        varying vec3 vPos; varying vec3 vWorld;
        void main(){ vPos = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        uniform float time, radius; varying vec3 vPos; varying vec3 vWorld;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        void main(){
          float ang = atan(vPos.z, vPos.x);
          vec2 uv = vec2(ang * radius * 0.02, vWorld.y * 0.03);
          float n = noise(uv + vec2(time * 0.6, -time * 0.9)) * 0.6 + noise(uv * 2.3 - vec2(time * 1.1, time * 0.4)) * 0.4;
          float bands = smoothstep(0.45, 0.55, n);
          vec3 col = mix(vec3(0.38, 0.12, 0.72), vec3(0.78, 0.45, 1.0), bands);
          float edge = smoothstep(0.0, 40.0, vWorld.y + 40.0) * (1.0 - smoothstep(300.0, 480.0, vWorld.y));
          // the far side of the circle fades back so the sky stays blue until the storm is close
          float d = length(vWorld.xz - cameraPosition.xz);
          float far = mix(1.0, 0.18, smoothstep(120.0, 1100.0, d));
          gl_FragColor = vec4(col, (0.42 + bands * 0.25) * edge * far);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 600, 128, 1, true).translate(0, 250, 0), this.mat);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(t: number, serverNow: number) {
    this.mat.uniforms.time.value = t;
    if (!this.plan) { this.mesh.visible = false; this.state = null; return; }
    const st = stormAt(this.plan, serverNow);
    this.state = st;
    this.mesh.visible = st.r > 0.5;
    this.mesh.position.set(st.x, -60, st.z);
    this.mesh.scale.set(Math.max(st.r, 0.5), 1, Math.max(st.r, 0.5));
    this.mat.uniforms.radius.value = st.r;
  }
}
