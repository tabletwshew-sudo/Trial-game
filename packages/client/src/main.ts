import * as THREE from 'three';
import { PROTOCOL_VERSION, type ServerMsg } from '@dropzone/shared';

// --- Phase 1 render check: toon-shaded island placeholder ---------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#7fc8ff');
scene.fog = new THREE.Fog('#bfe6ff', 80, 400);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(0, 40, 90);

const gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;
const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });

scene.add(new THREE.HemisphereLight('#ffffff', '#4a6b3a', 1.2));
const sun = new THREE.DirectionalLight('#fff4d6', 2.2);
sun.position.set(60, 120, 40);
scene.add(sun);

const island = new THREE.Mesh(new THREE.CylinderGeometry(70, 80, 8, 48), toon('#5cc34a'));
const water = new THREE.Mesh(new THREE.CircleGeometry(600, 64), toon('#2a9df4'));
water.rotation.x = -Math.PI / 2; water.position.y = -3.5;
scene.add(island, water);
for (let i = 0; i < 40; i++) {
  const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 55;
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4), toon('#8a5a2b'));
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 0), toon('#2f9e44'));
  trunk.position.y = 2; crown.position.y = 5.5;
  tree.add(trunk, crown);
  tree.position.set(Math.cos(a) * r, 4, Math.sin(a) * r);
  scene.add(tree);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop((t) => {
  const a = t * 0.0001;
  camera.position.set(Math.sin(a) * 110, 45, Math.cos(a) * 110);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
});

// --- Server connectivity check ------------------------------------------
const status = document.getElementById('status')!;
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: 'guest' }));
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data) as ServerMsg;
  if (msg.t === 'welcome') status.textContent = `connected as ${msg.id} · protocol v${PROTOCOL_VERSION}`;
};
ws.onclose = () => (status.textContent = 'offline (start the server)');
