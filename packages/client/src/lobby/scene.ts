import * as THREE from 'three';
import { Character } from './character';
import { part, toon } from './toon';

/** Slots: leader centre, others fanned out slightly behind. */
const SLOTS = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-1.5, 0, -0.6), new THREE.Vector3(1.5, 0, -0.6), new THREE.Vector3(-2.9, 0, -1.3)];

export interface LobbyMember { id: string; name: string; skin: number; ready: boolean; leader: boolean; you: boolean }

export class LobbyScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);
  private chars = new Map<string, Character>();
  private order: string[] = [];
  private clock = new THREE.Clock();
  private clouds: THREE.Group[] = [];
  private islands: THREE.Group[] = [];
  private sparkles!: THREE.Points;
  private mouse = new THREE.Vector2();
  private camFocus = new THREE.Vector3(0, 1.1, 0);
  private camYawTarget = 0;
  private spin = 0;
  focusYou = false;
  onFrame?: () => void;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.buildSky();
    this.buildLights();
    this.buildStage();
    this.buildBackdrop();
    this.buildSparkles();

    addEventListener('resize', () => this.resize());
    addEventListener('pointermove', (e) => this.mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5));
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ environment
  private buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { top: { value: new THREE.Color('#1f4fd1') }, mid: { value: new THREE.Color('#58b4ff') }, low: { value: new THREE.Color('#ffd6a5') }, sun: { value: new THREE.Vector3(0.4, 0.25, -1).normalize() } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 top, mid, low, sun; varying vec3 vDir;
          void main(){
            float h = vDir.y;
            vec3 c = mix(low, mid, smoothstep(-0.05, 0.25, h));
            c = mix(c, top, smoothstep(0.25, 0.9, h));
            float s = max(dot(vDir, sun), 0.0);
            c += vec3(1.0,0.85,0.6) * pow(s, 64.0) * 1.2 + vec3(1.0,0.7,0.4) * pow(s, 6.0) * 0.25;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog('#bfe3ff', 60, 420);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight('#cfe8ff', '#3d6b33', 0.8));
    const key = new THREE.DirectionalLight('#fff1d6', 2.6);
    key.position.set(6, 10, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    const rim = new THREE.DirectionalLight('#7fb7ff', 2.2);
    rim.position.set(-4, 5, -8);
    const fillL = new THREE.PointLight('#ff9de2', 6, 12); fillL.position.set(-4, 2, 3);
    const fillR = new THREE.PointLight('#7dfcff', 6, 12); fillR.position.set(4, 2, 3);
    this.scene.add(key, rim, fillL, fillR);
  }

  private buildStage() {
    // grassy floating platform with rock underside
    const top = part(new THREE.CylinderGeometry(5.2, 5.4, 0.5, 48), '#52c44a', false);
    top.position.y = -0.25;
    const lip = part(new THREE.CylinderGeometry(5.45, 5.45, 0.18, 48), '#4fb34d', false);
    lip.position.y = -0.42;
    const rock = part(new THREE.ConeGeometry(5.4, 5, 10, 3), '#8a6a52');
    rock.rotation.x = Math.PI; rock.position.y = -3.0;
    // a round stone stage: a raised dais with a darker kerb and a glowing gold inlay
    const dais = part(new THREE.CylinderGeometry(2.35, 2.5, 0.22, 48), '#d9d2c3');
    dais.position.y = 0.11;
    const kerb = part(new THREE.CylinderGeometry(2.62, 2.7, 0.12, 48), '#9a9284', false);
    kerb.position.y = 0.06;
    const inlay = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.9, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23f').multiplyScalar(1.4), transparent: true, opacity: 0.9 }));
    inlay.rotation.x = -Math.PI / 2; inlay.position.y = 0.225;
    const glow = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.15, 64), new THREE.MeshBasicMaterial({ color: '#fff36b', transparent: true, opacity: 0.0 }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.012;
    this.scene.add(top, lip, rock, dais, kerb, inlay, glow);
    // four short stone posts with little gold lamps round the dais
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
      const post = part(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), '#cfc7b6');
      post.position.set(Math.cos(a) * 2.9, 0.35, Math.sin(a) * 2.9);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe08a').multiplyScalar(1.3) }));
      lamp.position.set(post.position.x, 0.8, post.position.z);
      this.scene.add(post, lamp);
    }

    // grass round the stage: clumps of tapered blades (like the island's), and a few flowers
    const blades: number[] = [], bcol: number[] = [];
    const flowerColors = ['#ffffff', '#ffe066', '#ff8fab', '#a0c4ff'];
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, r = 2.85 + Math.random() * 2.3;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      for (let b = 0; b < 6; b++) {
        const ba = Math.random() * Math.PI * 2, h = 0.22 + Math.random() * 0.22, w = 0.03;
        const lean = 0.05 + Math.random() * 0.1, ox = cx + Math.cos(ba) * 0.05, oz = cz + Math.sin(ba) * 0.05;
        const px = -Math.sin(ba) * w, pz = Math.cos(ba) * w;
        blades.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + Math.cos(ba) * lean, h, oz + Math.sin(ba) * lean);
        const g = 0.75 + Math.random() * 0.25;
        bcol.push(0.04 * g, 0.2 * g, 0.03 * g, 0.04 * g, 0.2 * g, 0.03 * g, 0.22, 0.55, 0.1);
      }
      if (i % 9 === 0) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), toon(flowerColors[i % 4], 0.15));
        f.position.set(cx, 0.3, cz);
        this.scene.add(f);
      }
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(bcol, 3));
    bg.computeVertexNormals();
    for (let i = 0; i < bg.attributes.normal.count; i++) bg.attributes.normal.setXYZ(i, 0, 1, 0); // lit like the ground they grow from
    this.scene.add(new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    // a couple of props: supply crate and a tree
    const crate = part(new THREE.BoxGeometry(0.9, 0.9, 0.9), '#c98b4a');
    crate.position.set(3.4, 0.45, -2.2); crate.rotation.y = 0.5;
    const band = part(new THREE.BoxGeometry(0.94, 0.12, 0.94), '#4a90e2', false);
    band.position.copy(crate.position); band.rotation.y = 0.5;
    this.scene.add(crate, band);
    this.scene.add(this.makeTree(-4.6, -3.6, 1.15));
    this.scene.add(this.makeTree(4.4, -4.0, 1.0));
  }

  private makeTree(x: number, z: number, s: number) {
    const g = new THREE.Group();
    const trunk = part(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 8), '#7a4b2a');
    trunk.position.y = 0.8;
    g.add(trunk);
    const greens = ['#3fae49', '#56c45a', '#2f9a3d'];
    [[0, 2.1, 0, 1.0], [0.45, 1.8, 0.2, 0.7], [-0.4, 1.85, -0.1, 0.75], [0.05, 2.65, 0, 0.7]].forEach(([px, py, pz, r], i) => {
      const leaf = part(new THREE.IcosahedronGeometry(r, 1), greens[i % 3], false);
      leaf.position.set(px, py, pz);
      g.add(leaf);
    });
    g.position.set(x, 0, z); g.scale.setScalar(s);
    return g;
  }

  private makeCloud(scale: number) {
    const g = new THREE.Group();
    const mat = toon('#ffffff', 0.35);
    const n = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
      const r = 1.2 + Math.random() * 1.4;
      puff.scale.set(r, r * 0.8, r);
      puff.position.set((i - n / 2) * 1.6 + Math.random(), Math.random() * 0.8, Math.random() * 1.5);
      g.add(puff);
    }
    g.scale.setScalar(scale);
    return g;
  }

  private buildBackdrop() {
    for (let i = 0; i < 14; i++) {
      const c = this.makeCloud(2 + Math.random() * 3);
      c.position.set((Math.random() - 0.5) * 400, 10 + Math.random() * 60, -120 - Math.random() * 200);
      this.clouds.push(c); this.scene.add(c);
    }
    for (let i = 0; i < 6; i++) {
      const c = this.makeCloud(1.2);
      c.position.set((Math.random() - 0.5) * 40, -6 - Math.random() * 6, -10 - Math.random() * 30);
      this.clouds.push(c); this.scene.add(c);
    }
    // distant floating islands with tiny trees
    const spots = [[-38, 4, -70, 1.4], [42, -2, -90, 1.8], [-80, 14, -160, 2.6], [95, 22, -190, 3.0], [8, 30, -240, 2.2]];
    for (const [x, y, z, s] of spots) {
      const g = new THREE.Group();
      const top = part(new THREE.CylinderGeometry(4, 3.6, 0.8, 14), '#69c96a', false);
      const under = part(new THREE.ConeGeometry(3.7, 6, 8), '#9b7656', false);
      under.rotation.x = Math.PI; under.position.y = -3.4;
      g.add(top, under, this.makeTree(1, 0.4, 0.8), this.makeTree(-1.3, -0.8, 0.6));
      g.position.set(x, y, z); g.scale.setScalar(s); g.rotation.y = Math.random() * 6;
      this.islands.push(g); this.scene.add(g);
    }
  }

  private buildSparkles() {
    const n = 140, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 16, Math.random() * 6, (Math.random() - 0.5) * 10 - 1], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkles = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fff7b0', size: 0.05, transparent: true, opacity: 0.8, depthWrite: false }));
    this.scene.add(this.sparkles);
  }

  // ---------------------------------------------------------------- party
  setMembers(members: LobbyMember[]) {
    // you are always centre stage (like most BR lobbies); others fill the side slots
    const sorted = [...members].sort((a, b) => Number(b.you) - Number(a.you));
    const ids = new Set(sorted.map((m) => m.id));
    for (const [id, c] of this.chars) if (!ids.has(id)) { this.scene.remove(c.root); this.chars.delete(id); }
    sorted.forEach((m, i) => {
      let c = this.chars.get(m.id);
      if (!c) { c = new Character(m.skin); this.chars.set(m.id, c); this.scene.add(c.root); c.celebrate(); }
      c.setSkin(m.skin);
      c.root.position.copy(SLOTS[i]);
      c.root.rotation.y = i === 0 ? 0 : (i % 2 ? 0.25 : -0.25);
      c.lookTarget.set(0, 1.6, 10);
    });
    this.order = sorted.map((m) => m.id);
  }
  celebrate(id: string) { this.chars.get(id)?.celebrate(); }
  rotatePreview(delta: number) { this.spin += delta; }

  /** Screen position (px) above a character's head, for name tags. */
  tagPosition(id: string): { x: number; y: number; visible: boolean } | null {
    const c = this.chars.get(id);
    if (!c) return null;
    const p = c.root.position.clone().add(new THREE.Vector3(0, 2.55, 0)).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, visible: p.z < 1 };
  }

  private resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the whole party framed on narrow screens
    this.camera.fov = w / h < 1.2 ? 48 : 32;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    for (const id of this.order) this.chars.get(id)!.update(dt, t);
    this.order.forEach((id, i) => (this.chars.get(id)!.root.visible = i === 0 || !this.focusYou));
    const you = this.chars.get(this.order[0]);
    if (you) you.root.rotation.y = this.spin;
    this.spin *= 1 - Math.min(1, dt * 0.8); // spring back after locker spin

    this.clouds.forEach((c, i) => { c.position.x += dt * (0.6 + (i % 3) * 0.3); if (c.position.x > 220) c.position.x = -220; });
    this.islands.forEach((g, i) => { g.position.y += Math.sin(t * 0.5 + i) * dt * 0.3; g.rotation.y += dt * 0.02; });
    const pos = this.sparkles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) + dt * 0.25; if (y > 6) y = 0; pos.setY(i, y); }
    pos.needsUpdate = true;

    // camera: gentle parallax with the mouse; pushes in when focusing on you (locker)
    const focus = this.focusYou;
    const dist = focus ? 5.2 : 9.5;
    this.camFocus.lerp(new THREE.Vector3(focus ? 0.85 : 0, focus ? 1.15 : 1.25, 0), dt * 3);
    this.camYawTarget = this.mouse.x * 0.12;
    const camPos = new THREE.Vector3(Math.sin(this.camYawTarget) * dist, 1.9 + this.mouse.y * 0.3, Math.cos(this.camYawTarget) * dist).add(new THREE.Vector3(this.camFocus.x, 0, 0));
    this.camera.position.lerp(camPos, dt * 3);
    this.camera.lookAt(this.camFocus);

    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }

  dispose() { this.renderer.setAnimationLoop(null); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
