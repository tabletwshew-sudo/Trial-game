import * as THREE from 'three';

/**
 * Light ramps, sampled by how much a surface faces the sun (0 = away, 1 = straight at it).
 * Smooth, with a slightly quicker turn at the terminator than plain diffuse light, so shapes
 * read round and soft but still a little stylised. (They used to be 3 and 5 hard steps, which
 * banded across hills and faces.)
 */
function smoothRamp(lo: number, k0: number, k1: number, gamma: number) {
  const n = 64, d = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1), t = Math.min(1, Math.max(0, (x - k0) / (k1 - k0)));
    const s = Math.pow(t * t * (3 - 2 * t), gamma);
    d[i] = Math.round((lo + (1 - lo) * s) * 255);
  }
  const t = new THREE.DataTexture(d, n, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
/** Characters: a crisper turn so they keep a cartoon edge. */
const ramp = smoothRamp(0.34, 0.2, 0.78, 0.8);
/** Big surfaces (terrain, buildings, trees). */
export const softRamp = smoothRamp(0.4, 0.05, 0.95, 0.85);
/** A crisp, warm rim of light round the silhouette, so characters pop out of busy scenery. */
function addRim(m: THREE.MeshToonMaterial, strength = 0.38) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      {
        float facing = max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
        outgoingLight += vec3(1.0, 0.94, 0.84) * smoothstep(0.62, 0.86, 1.0 - facing) * ${strength.toFixed(2)};
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `rim${strength}`;
  return m;
}

/** Toon material that takes its colour from vertex colours (one draw call for many parts). */
export const toonVertex = addRim(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));

const cache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: THREE.ColorRepresentation, emissive = 0): THREE.MeshToonMaterial {
  const key = `${new THREE.Color(color).getHexString()}:${emissive}`;
  let m = cache.get(key);
  if (!m) {
    m = addRim(new THREE.MeshToonMaterial({ color, gradientMap: ramp }), 0.3);
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
  m.userData.color = color;
  m.userData.outline = outline;
  if (outline) {
    const o = new THREE.Mesh(geo, outlineMaterial);
    o.raycast = () => {};
    m.add(o);
  }
  return m;
}
