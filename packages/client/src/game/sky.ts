import * as THREE from 'three';
import { FOG_GLSL, HAZE, SUN_DIR, sceneFog } from './atmosphere';
import { noiseTexture } from './noisetex';

export { SUN_DIR } from './atmosphere';

/**
 * Sky dome (gradient, sun disc that blooms, warm halo, high streaky clouds), soft shaded
 * cumulus clouds, and the sun + sky lights that follow the player.
 */
export function buildSky(scene: THREE.Scene, shadows: boolean, shadowSize = 2048) {
  scene.fog = sceneFog();
  const time = { value: 0 };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(4500, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { time, cirrusTex: { value: noiseTexture(256, 8, 5, 7) } },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time; uniform sampler2D cirrusTex; varying vec3 vDir;
        ${FOG_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 zenith = vec3(0.018, 0.11, 0.52), mid = vec3(0.08, 0.30, 0.86);
          vec3 c = mix(DZ_HAZE, mid, smoothstep(0.0, 0.16, h));
          c = mix(c, zenith, smoothstep(0.18, 0.9, h));
          // below the horizon: the haze over the sea
          c = mix(c, DZ_HAZE * 0.92, smoothstep(0.0, -0.08, h));
          // high streaks of cloud, drifting
          vec2 p = d.xz / max(h + 0.12, 0.05) * 1.6 + vec2(time * 0.004, time * 0.0015);
          float n = texture2D(cirrusTex, p * vec2(1.0, 3.2) / 8.0).r;
          float cirrus = smoothstep(0.52, 0.85, n) * smoothstep(0.03, 0.25, h) * (1.0 - smoothstep(0.75, 1.0, h));
          c = mix(c, vec3(1.0, 0.99, 0.97), cirrus * 0.42);
          // warm glow around the sun, and the sun itself (bright enough to bloom)
          float s = max(dot(d, DZ_SUN), 0.0);
          c += DZ_SUN_HAZE * (pow(s, 6.0) * 0.28 + pow(s, 64.0) * 0.55 + pow(s, 900.0) * 2.5);
          c += vec3(1.0, 0.96, 0.86) * smoothstep(0.99955, 0.99975, s) * 26.0;
          // the sky meets the fog exactly at the horizon
          c = mix(c, dzFogColor(d), smoothstep(0.06, 0.0, abs(h)) * 0.85);
          gl_FragColor = vec4(c, 1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // clouds: clusters of puffs, lit from the sun with grey-blue undersides and bright silver edges
  const CLOUDS = 40, PUFFS = 9;
  const cloudMat = new THREE.ShaderMaterial({
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vWorld; varying float vBase;
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vWorld = wp.xyz;
        vBase = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vWorld; varying float vBase;
      ${FOG_GLSL}
      void main(){
        vec3 n = normalize(vN);
        float sun = dot(n, DZ_SUN) * 0.5 + 0.5;
        float up = n.y * 0.5 + 0.5;
        vec3 shade = mix(vec3(0.56, 0.64, 0.78), vec3(1.0, 0.99, 0.96), smoothstep(0.15, 0.85, sun * 0.6 + up * 0.5));
        vec3 view = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);
        float toward = pow(max(dot(-view, DZ_SUN), 0.0), 4.0);
        shade += vec3(1.0, 0.92, 0.78) * rim * (0.25 + toward * 1.4);
        gl_FragColor = vec4(dzFog(shade * 1.08, vWorld), 1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
      }`,
  });
  const puff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), cloudMat, CLOUDS * PUFFS);
  puff.frustumCulled = false;
  const centers: THREE.Vector3[] = [], offsets: THREE.Vector4[] = [];
  const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
  for (let c = 0; c < CLOUDS; c++) {
    centers.push(new THREE.Vector3((rnd() - 0.5) * 7000, 380 + rnd() * 260, (rnd() - 0.5) * 7000));
    // big, towering cumulus: a wide flat base and billowing heads stacked on top
    const size = 70 + rnd() * 100;
    for (let p = 0; p < PUFFS; p++) {
      const t = (p / (PUFFS - 1)) * 2 - 1;
      const head = p % 3 === 1;
      const r = size * (head ? 0.85 : 1.05 - Math.abs(t) * 0.5) * (0.75 + rnd() * 0.4);
      offsets.push(new THREE.Vector4(t * size * (head ? 0.6 : 1.3) + (rnd() - 0.5) * 18, r * (head ? 1.05 : 0.35) + rnd() * size * 0.25, (rnd() - 0.5) * size * 0.9, r));
    }
  }
  scene.add(puff);
  const m = new THREE.Matrix4();
  const placeClouds = () => {
    for (let c = 0; c < CLOUDS; c++) for (let p = 0; p < PUFFS; p++) {
      const o = offsets[c * PUFFS + p];
      m.makeScale(o.w, o.w * 0.58, o.w * 0.9).setPosition(centers[c].x + o.x, centers[c].y + o.y, centers[c].z + o.z);
      puff.setMatrixAt(c * PUFFS + p, m);
    }
    puff.instanceMatrix.needsUpdate = true;
  };
  placeClouds();

  // light: cool sky fill, warm sun. The hemisphere's ground colour is a green bounce, so shade reads
  // cool and fresh rather than brown.
  const hemi = new THREE.HemisphereLight('#cfe5ff', '#9fb59a', 1.28);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0cf', 2.85);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const c = sun.shadow.camera;
    c.left = -80; c.right = 80; c.top = 80; c.bottom = -80; c.near = 10; c.far = 560;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
    sun.shadow.radius = 2.5;
  }
  scene.add(sun, sun.target);

  let acc = 0, t = 0;
  return {
    hemi, sun,
    update(dt: number, cam: THREE.Vector3, focus: THREE.Vector3) {
      t += dt; time.value = t;
      dome.position.copy(cam);
      // snap the shadow frustum to whole texels so shadows do not shimmer while moving
      const step = 160 / shadowSize;
      const fx = Math.round(focus.x / step) * step, fy = Math.round(focus.y / step) * step, fz = Math.round(focus.z / step) * step;
      sun.target.position.set(fx, fy, fz);
      sun.position.set(fx + SUN_DIR.x * 280, fy + SUN_DIR.y * 280, fz + SUN_DIR.z * 280);
      acc += dt;
      if (acc > 0.05) {
        for (const c of centers) { c.x += acc * 5; if (c.x > 3500) c.x -= 7000; }
        acc = 0;
        placeClouds();
      }
    },
  };
}

/** Kept for code that still asks for the old fog numbers (custom shaders use FOG_GLSL now). */
export const FOG_COLOR = HAZE;
