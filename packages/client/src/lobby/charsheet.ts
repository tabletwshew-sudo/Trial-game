import { meleeDef } from '@dropzone/shared';
import * as THREE from 'three';
import { Character, SKINS, type PoseMode } from './character';

/**
 * Developer page (`/?charsheet=<pose>`): every outfit side by side in one pose, for checking the
 * character models and animations. Options: &yaw=<radians> &item=<id> &t=<seconds> &crouch=1.
 */
export function charSheet(host: HTMLElement) {
  const q = new URLSearchParams(location.search);
  const pose = (q.get('charsheet') || 'idle') as PoseMode;
  const yaw = Number(q.get('yaw') ?? 0), item = Number(q.get('item') ?? 0), at = Number(q.get('t') ?? 0.6);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fc7f2');
  scene.add(new THREE.HemisphereLight('#dcecff', '#b9b08f', 1.35));
  const sun = new THREE.DirectionalLight('#fff0d2', 2.6);
  sun.position.set(6, 10, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 6, bottom: -6 });
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 20).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: '#7cc35c' }));
  ground.receiveShadow = true;
  scene.add(ground);
  const from = Number(q.get('from') ?? 0), n = Number(q.get('n') ?? SKINS.length);
  const chars = SKINS.slice(from, from + n).map((_, j) => {
    const c = new Character(from + j);
    c.root.position.set((j - (n - 1) / 2) * 1.25, 0, 0);
    c.root.rotation.y = yaw;
    if (item) c.setHeld(item, 2);
    scene.add(c.root);
    return c;
  });
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
  const dist = Number(q.get('dist') ?? 15.5);
  camera.position.set(0, 1.5 + dist * 0.05, dist); camera.lookAt(0, 1.1, 0);
  // run the animation forward to time `at`, then hold that frame
  // &swing=<0..1>: show a pickaxe swing that far through
  const swing = q.has('swing') ? Number(q.get('swing')) : -1;
  const hold = !item ? 'none' : meleeDef(item) ? 'melee' : 'gun';
  for (let t = 0; t < at; t += 1 / 60) {
    if (swing >= 0 && Math.abs(t - (at - swing * 0.42)) < 0.5 / 60) for (const c of chars) c.swing();
    for (const c of chars) c.animate(1 / 60, t, { mode: pose, speed: pose === 'run' ? 7 : 0, dive: 0.5, pitch: 0.1, hold, crouch: q.get('crouch') === '1', phase: 0.4, vy: 2 });
  }
  renderer.render(scene, camera);
  (window as unknown as { __sheet: boolean; __chars: Character[] }).__chars = chars;
  (window as unknown as { __sheet: boolean }).__sheet = true;
}
