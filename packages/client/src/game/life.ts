import * as THREE from 'three';
import { terrainAt, type World } from '@dropzone/shared';
import { wind } from './grass';

/**
 * Ambient life: flocks of birds wheeling overhead, butterflies around the grass and sunlit
 * pollen drifting past the camera. All cheap: a few instanced meshes and one point cloud,
 * animated mostly on the GPU.
 */
export class Life {
  private birds: THREE.InstancedMesh;
  private flies: THREE.InstancedMesh;
  private motes: THREE.Points;
  private flocks: { x: number; z: number; y: number; r: number; speed: number; phase: number }[] = [];
  private butterflies: { x: number; y: number; z: number; tx: number; tz: number; vx: number; vz: number; t: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private t = 0;
  static readonly BIRDS_PER = 7;

  constructor(private w: World, scene: THREE.Object3D) {
    // a bird: body + two wings whose tips flap in the vertex shader
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, -0.35, -1.1, 0.05, 0.05, 0, 0, 0.25,
      0, 0, -0.35, 0, 0, 0.25, 1.1, 0.05, 0.05,
      0, 0.05, -0.5, -0.12, 0, 0.35, 0.12, 0, 0.35,
    ], 3));
    wingGeo.computeVertexNormals();
    const flap = (m: THREE.Material, speed: number, amp: number) => {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uT = wind;
        sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
          transformed.y += sin(uT * ${speed.toFixed(1)} + ph) * abs(position.x) * ${amp.toFixed(2)};`);
      };
      m.customProgramCacheKey = () => `flap${speed}`;
      return m;
    };
    this.birds = new THREE.InstancedMesh(wingGeo, flap(new THREE.MeshLambertMaterial({ color: '#2b2d42', side: THREE.DoubleSide }), 9, 0.7), 4 * Life.BIRDS_PER);
    this.birds.frustumCulled = false;
    for (let i = 0; i < 4; i++) this.flocks.push({ x: 0, z: 0, y: 0, r: 30 + i * 9, speed: 0.12 + i * 0.03, phase: i * 1.7 });

    // butterflies: two little wings, bright colours
    const fly = new THREE.BufferGeometry();
    fly.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.06, -0.12, 0, 0, 0, 0, 0.07, 0, 0, -0.06, 0, 0, 0.07, 0.12, 0, 0], 3));
    fly.computeVertexNormals();
    this.flies = new THREE.InstancedMesh(fly, flap(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 26, 5), 14);
    this.flies.frustumCulled = false;
    const cols = ['#ffd23f', '#ff8fab', '#ffffff', '#7cc8ff', '#ff9f1c'];
    for (let i = 0; i < 14; i++) {
      this.flies.setColorAt(i, new THREE.Color(cols[i % cols.length]));
      this.butterflies.push({ x: 0, y: -100, z: 0, tx: 0, tz: 0, vx: 0, vz: 0, t: 0 });
    }

    // pollen and dust motes that catch the sun, wrapped around the camera on the GPU
    const N = 420, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random() * 60; pos[i * 3 + 1] = Math.random() * 18; pos[i * 3 + 2] = Math.random() * 60; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.motes = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: wind, uCam: { value: new THREE.Vector3() }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uT, uPx; uniform vec3 uCam; attribute float seed; varying float vA;
        void main(){
          vec3 p = position + vec3(uT * 0.9, sin(uT * 0.7 + seed * 40.0) * 0.6, uT * 0.4 + sin(uT * 0.5 + seed * 20.0));
          p.xz = mod(p.xz - uCam.xz + 30.0, 60.0) - 30.0 + uCam.xz;
          p.y = uCam.y - 4.0 + mod(p.y, 18.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = smoothstep(30.0, 12.0, length(p.xz - uCam.xz)) * smoothstep(2.0, 5.0, d) * (0.5 + 0.5 * sin(uT * 2.0 + seed * 60.0)) * 0.7;
          gl_PointSize = min(uPx * (1.0 + seed * 1.2) * 26.0 / d, 4.0 * uPx);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.6, 1.4, 0.9) * vA * smoothstep(0.5, 0.0, r), 1.0); }`,
    }));
    this.motes.frustumCulled = false;
    scene.add(this.birds, this.flies, this.motes);
  }

  update(dt: number, cam: THREE.Vector3, pixelRatio: number) {
    this.t += dt;
    const t = this.t, w = this.w;
    (this.motes.material as THREE.ShaderMaterial).uniforms.uCam.value.copy(cam);
    (this.motes.material as THREE.ShaderMaterial).uniforms.uPx.value = pixelRatio;
    // flocks circle a spot near you, high over the land; they drift off and re-form elsewhere
    this.flocks.forEach((f, fi) => {
      if (Math.hypot(f.x - cam.x, f.z - cam.z) > 260 || f.y === 0) {
        const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 140;
        f.x = cam.x + Math.cos(a) * d; f.z = cam.z + Math.sin(a) * d;
        f.y = Math.max(terrainAt(w, f.x, f.z), 0) + 45 + Math.random() * 50;
      }
      for (let b = 0; b < Life.BIRDS_PER; b++) {
        const a = t * f.speed + f.phase + b * 0.32, r = f.r + Math.sin(b * 2.1) * 6;
        const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r, y = f.y + Math.sin(t * 0.6 + b) * 3 + b * 0.8;
        // heading = tangent of the circle; bank into the turn
        this.e.set(0.0, Math.PI - a, 0.35, "YXZ");
        this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.setScalar(0.9 + (b % 3) * 0.15));
        this.birds.setMatrixAt(fi * Life.BIRDS_PER + b, this.m);
      }
    });
    this.birds.instanceMatrix.needsUpdate = true;
    // butterflies wander between nearby spots just above the grass
    this.butterflies.forEach((b, i) => {
      if (Math.hypot(b.x - cam.x, b.z - cam.z) > 35 || b.y < -50) {
        const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 22;
        b.x = cam.x + Math.cos(a) * d; b.z = cam.z + Math.sin(a) * d; b.tx = b.x; b.tz = b.z;
      }
      b.t -= dt;
      if (b.t <= 0) { b.t = 1 + Math.random() * 2.5; b.tx = b.x + (Math.random() - 0.5) * 6; b.tz = b.z + (Math.random() - 0.5) * 6; }
      b.vx += ((b.tx - b.x) * 0.8 - b.vx) * dt * 2; b.vz += ((b.tz - b.z) * 0.8 - b.vz) * dt * 2;
      b.x += b.vx * dt; b.z += b.vz * dt;
      const g = terrainAt(w, b.x, b.z);
      b.y = g + 0.6 + Math.sin(t * 3 + i) * 0.25;
      // never flutter right in front of the lens
      const dc = Math.hypot(b.x - cam.x, b.y - cam.y, b.z - cam.z);
      if (dc < 3) { b.tx = b.x + (b.x - cam.x) * 2; b.tz = b.z + (b.z - cam.z) * 2; }
      const hidden = g < 2.5 || g > 70 || dc < 2;
      this.e.set(0, Math.atan2(b.vx, b.vz), 0);
      this.m.compose(this.p.set(b.x, hidden ? -500 : b.y, b.z), this.q.setFromEuler(this.e), this.s.setScalar(1.3));
      this.flies.setMatrixAt(i, this.m);
    });
    this.flies.instanceMatrix.needsUpdate = true;
  }
}
