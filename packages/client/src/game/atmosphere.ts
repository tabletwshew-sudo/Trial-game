import * as THREE from 'three';

/**
 * Atmosphere: one set of numbers for the sun, the sky and the haze, so the far terrain, the
 * water, the clouds and the sky dome all fade into exactly the same colour at the horizon.
 *
 * The fog is exponential *height* fog (thick near sea level, thin up high) with warm light
 * scattered toward the sun. It replaces three.js's fog chunks, so every built-in material
 * gets it; custom shaders include `FOG_GLSL` and call `dzFog()`.
 */
export const SUN_DIR = new THREE.Vector3(0.5, 0.62, 0.35).normalize();
/** Haze colour at the horizon (linear). */
export const HAZE = new THREE.Color('#b3d4f2');
/** Haze lit by the sun, looking toward it. */
export const SUN_HAZE = new THREE.Color('#ffe2b0');
/** Sea-level density (per metre) and how fast it thins with height (per metre). */
export const FOG_DENSITY = 0.00016, FOG_FALLOFF = 0.003; // lighter haze: you can see further

const v3 = (v: THREE.Vector3 | THREE.Color) => (v instanceof THREE.Color ? `vec3(${v.r.toFixed(4)}, ${v.g.toFixed(4)}, ${v.b.toFixed(4)})` : `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`);

/** GLSL: `vec3 dzFog(vec3 colour, vec3 worldPos)` (needs `cameraPosition`, which three provides). */
export const FOG_GLSL = /* glsl */ `
  const vec3 DZ_SUN = ${v3(SUN_DIR)};
  const vec3 DZ_HAZE = ${v3(HAZE)};
  const vec3 DZ_SUN_HAZE = ${v3(SUN_HAZE)};
  vec3 dzFogColor(vec3 dir) {
    float s = max(dot(dir, DZ_SUN), 0.0);
    return mix(DZ_HAZE, DZ_SUN_HAZE, pow(s, 5.0) * 0.65);
  }
  float dzFogAmount(vec3 wp) {
    vec3 ray = wp - cameraPosition;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-3);
    float b = ${FOG_FALLOFF.toFixed(6)}, c = ${FOG_DENSITY.toFixed(6)};
    float camH = max(cameraPosition.y, 0.0);
    float ry = dir.y * b;
    // density integrated along the ray through air that thins with height
    float k = abs(ry) < 1e-6 ? dist : (1.0 - exp(clamp(-dist * ry, -60.0, 60.0))) / ry;
    float a = 1.0 - exp(-c * exp(-camH * b) * k);
    // and always fully hazed before the far edge of the world
    return clamp(max(a, smoothstep(2600.0, 4300.0, dist)), 0.0, 1.0);
  }
  vec3 dzFog(vec3 col, vec3 wp) {
    vec3 dir = normalize(wp - cameraPosition);
    return mix(col, dzFogColor(dir), dzFogAmount(wp));
  }
`;

let installed = false;
/** Swap three.js's distance fog for the height fog above (call once before building materials). */
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = `#ifdef USE_FOG\n varying vec3 vFogWorld;\n#endif`;
  // world position from view space: undo the view rotation and translation
  C.fog_vertex = `#ifdef USE_FOG\n vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG\n uniform vec3 fogColor;\n varying vec3 vFogWorld;\n ${FOG_GLSL}\n#endif`;
  C.fog_fragment = `#ifdef USE_FOG\n gl_FragColor.rgb = dzFog(gl_FragColor.rgb, vFogWorld);\n#endif`;
}

/** The scene's fog object: only switches fog on for materials (the numbers live in the shader). */
export function sceneFog() { return new THREE.Fog(HAZE, 1, 2); }
