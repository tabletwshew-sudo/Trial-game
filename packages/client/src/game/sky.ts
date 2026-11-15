import * as THREE from 'three';
import { toon } from '../lobby/toon';

export const SUN_DIR = new THREE.Vector3(0.5, 0.75, 0.35).normalize();
export const FOG_COLOR = new THREE.Color('#bfe4ff');
export const FOG_NEAR = 500, FOG_FAR = 3600;

/** Sky dome, sun, drifting clouds and the lights that follow the player. */
export function buildSky(scene: THREE.Scene, shadows: boolean) {
  scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(4500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#2f6fe0') }, mid: { value: new THREE.Color('#6fbfff') }, low: { value: FOG_COLOR }, sun: { value: SUN_DIR } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 top, mid, low, sun; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = mix(low, mid, smoothstep(0.0, 0.22, h));
          c = mix(c, top, smoothstep(0.2, 0.85, h));
          float s = max(dot(normalize(vDir), sun), 0.0);
          c += vec3(1.0, 0.95, 0.8) * (smoothstep(0.9992, 0.9996, s) + pow(s, 90.0) * 0.5 + pow(s, 8.0) * 0.12);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // clouds: instanced puffs in clusters, above the dropship's flight level
  const CLOUDS = 46, PUFFS = 6;
  const puff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), toon('#ffffff', 0.45), CLOUDS * PUFFS);
  puff.frustumCulled = false;
  const centers: THREE.Vector3[] = [], offsets: THREE.Vector4[] = [];
  const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
  for (let c = 0; c < CLOUDS; c++) {
    centers.push(new THREE.Vector3((rnd() - 0.5) * 6000, 430 + rnd() * 260, (rnd() - 0.5) * 6000));
    const size = 35 + rnd() * 55;
    for (let p = 0; p < PUFFS; p++) offsets.push(new THREE.Vector4((p - PUFFS / 2) * size * 0.55 + rnd() * 20, rnd() * size * 0.25, (rnd() - 0.5) * size * 0.8, size * (0.55 + rnd() * 0.5)));
  }
  scene.add(puff);
  const m = new THREE.Matrix4();
  const placeClouds = () => {
    for (let c = 0; c < CLOUDS; c++) for (let p = 0; p < PUFFS; p++) {
      const o = offsets[c * PUFFS + p];
      m.makeScale(o.w, o.w * 0.62, o.w).setPosition(centers[c].x + o.x, centers[c].y + o.y, centers[c].z + o.z);
      puff.setMatrixAt(c * PUFFS + p, m);
    }
    puff.instanceMatrix.needsUpdate = true;
  };
  placeClouds();

  scene.add(new THREE.HemisphereLight('#d6ecff', '#6f8f5a', 1.05));
  const sun = new THREE.DirectionalLight('#fff3da', 2.5);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -75; c.right = 75; c.top = 75; c.bottom = -75; c.near = 10; c.far = 520;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
  }
  scene.add(sun, sun.target);

  let acc = 0;
  return {
    update(dt: number, cam: THREE.Vector3, focus: THREE.Vector3) {
      dome.position.copy(cam);
      // snap the shadow frustum to whole metres so shadows do not shimmer while moving
      const fx = Math.round(focus.x), fy = Math.round(focus.y), fz = Math.round(focus.z);
      sun.target.position.set(fx, fy, fz);
      sun.position.set(fx + SUN_DIR.x * 260, fy + SUN_DIR.y * 260, fz + SUN_DIR.z * 260);
      acc += dt;
      if (acc > 0.05) {
        for (const c of centers) { c.x += acc * 5; if (c.x > 3000) c.x -= 6000; }
        acc = 0;
        placeClouds();
      }
    },
  };
}
