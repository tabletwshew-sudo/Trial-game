import * as THREE from 'three';

/** 3-step ramp gives the crisp cartoon light bands. */
const ramp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

const cache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: THREE.ColorRepresentation, emissive = 0): THREE.MeshToonMaterial {
  const key = `${new THREE.Color(color).getHexString()}:${emissive}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: ramp });
    if (emissive) { m.emissive = new THREE.Color(color); m.emissiveIntensity = emissive; }
    cache.set(key, m);
  }
  return m;
}

/** Inverted-hull outline: pushes vertices along normals, renders back faces. */
export const outlineMaterial = new THREE.ShaderMaterial({
  uniforms: { thickness: { value: 0.025 }, color: { value: new THREE.Color('#1a1030') } },
  vertexShader: /* glsl */ `
    uniform float thickness;
    #include <common>
    #include <skinning_pars_vertex>
    void main() {
      vec3 p = position + normal * thickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }`,
  side: THREE.BackSide,
});

/** Mesh with toon material + outline shell; casts and receives shadows. */
export function part(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, outline = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, toon(color));
  m.castShadow = true;
  m.receiveShadow = true;
  if (outline) {
    const o = new THREE.Mesh(geo, outlineMaterial);
    o.raycast = () => {};
    m.add(o);
  }
  return m;
}
