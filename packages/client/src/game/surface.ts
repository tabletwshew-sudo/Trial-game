import * as THREE from 'three';
import { detailNoise } from './noisetex';

/**
 * Surface detail drawn in the shader from world position, so it costs no geometry or UVs:
 * lapped siding, brick, plaster panels, roof shingles, floor planks, tiles, corrugated metal,
 * gravel roofs and wallpaper on buildings, and grain, patches, rock layers and sand ripples on
 * the ground. Patterns fade out where they would be smaller than a pixel, so nothing shimmers.
 */
export const SURF = { plain: 0, siding: 1, brick: 2, plaster: 3, shingles: 4, planks: 5, metal: 6, gravel: 7, tiles: 8, wallpaper: 9, logs: 10 } as const;

const noiseUniform = { value: null as THREE.Texture | null };
const noise = () => { noiseUniform.value ??= detailNoise(); return noiseUniform; };

const VERT_HEAD = /* glsl */ `
attribute float surf;
varying float vDzSurf; varying vec3 vDzWP; varying vec3 vDzWN;
`;
const VERT_BODY = /* glsl */ `
#include <begin_vertex>
{
  vec4 dzw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    dzw = instanceMatrix * dzw;
  #endif
  vDzWP = (modelMatrix * dzw).xyz;
  vDzWN = normalize(mat3(modelMatrix) * objectNormal);
  vDzSurf = surf;
}
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D dzNoise;
varying float vDzSurf; varying vec3 vDzWP; varying vec3 vDzWN;
float dzHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
/** 1 where a pattern of this period (m) is comfortably bigger than a pixel, 0 where it would alias. */
float dzLod(float period, float fw){ return 1.0 - smoothstep(period * 0.18, period * 0.5, fw); }
`;

const BUILDING_FRAG = /* glsl */ `
#include <color_fragment>
{
  float s = floor(vDzSurf + 0.5);
  vec3 an = abs(vDzWN);
  bool wall = an.y < 0.6;
  // plane coordinates: (across, up) on walls, (x, z) on floors and roofs
  vec2 q = wall ? vec2(an.x > an.z ? vDzWP.z : vDzWP.x, vDzWP.y) : vDzWP.xz;
  float fw = length(fwidth(q));
  float big = texture2D(dzNoise, q * 0.045).r, fine = texture2D(dzNoise, q * 0.42).r;
  vec3 c = diffuseColor.rgb;
  if (s == 1.0 || s == 10.0) {
    // lapped boards (logs: wider and rounder), each a slightly different tone
    float h = s == 1.0 ? 0.3 : 0.42;
    float row = floor(q.y / h), f = fract(q.y / h);
    float board = s == 1.0 ? mix(1.04, 0.9, f) * mix(0.72, 1.0, smoothstep(0.0, 0.08, f)) : mix(0.8, 1.04, sin(f * 3.14159)) ;
    float tone = 0.95 + 0.1 * dzHash(vec2(row, floor(q.x / 3.7 + dzHash(vec2(row, 1.0)))));
    float grain = 0.95 + 0.1 * texture2D(dzNoise, vec2(q.x * 0.06, q.y * 1.4)).r;
    c *= mix(1.0, board * tone * grain, dzLod(h, fw));
  } else if (s == 2.0) {
    vec2 b = q / vec2(0.44, 0.16);
    b.x += 0.5 * mod(floor(b.y), 2.0);
    vec2 f = fract(b);
    float mortar = smoothstep(0.0, 0.09, f.y) * smoothstep(0.0, 0.035, f.x) * smoothstep(1.0, 0.965, f.x);
    vec3 brick = c * (0.86 + 0.24 * dzHash(floor(b))) * (0.93 + 0.12 * fine);
    c = mix(c, mix(vec3(0.78, 0.75, 0.7) * (0.85 + 0.2 * big), brick, mortar), dzLod(0.16, fw));
  } else if (s == 3.0) {
    // plaster or concrete: soft blotches, panel seams and a slight sheen variation
    vec2 f = fract(q / vec2(3.0, 3.4));
    float seam = min(smoothstep(0.0, 0.012, f.x) * smoothstep(1.0, 0.988, f.x), smoothstep(0.0, 0.014, f.y));
    c *= (0.9 + 0.16 * big) * (0.96 + 0.07 * fine) * mix(1.0, mix(0.8, 1.0, seam), dzLod(0.4, fw));
  } else if (s == 4.0) {
    // shingles: staggered tabs in rows; the lower edge of each row casts a thin shadow
    vec2 r = vec2(an.x > an.z ? vDzWP.z : vDzWP.x, vDzWP.y) / vec2(0.42, 0.17);
    r.x += 0.5 * mod(floor(r.y), 2.0);
    vec2 f = fract(r);
    float tab = mix(0.74, 1.04, smoothstep(0.0, 0.32, f.y)) * mix(0.82, 1.0, smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x));
    c *= mix(1.0, tab * (0.88 + 0.22 * dzHash(floor(r))), dzLod(0.17, fw)) * (0.93 + 0.12 * big);
  } else if (s == 5.0) {
    // floor planks running along x, ends staggered, with grain
    float row = floor(q.y / 0.2);
    float x = q.x / 1.8 + dzHash(vec2(row, 3.0));
    vec2 f = vec2(fract(x), fract(q.y / 0.2));
    float seam = smoothstep(0.0, 0.06, f.y) * smoothstep(0.0, 0.012, f.x);
    float grain = 0.93 + 0.12 * texture2D(dzNoise, vec2(q.x * 0.12, q.y * 2.6)).r;
    c *= mix(1.0, mix(0.7, 1.0, seam) * (0.9 + 0.18 * dzHash(vec2(row, floor(x)))) * grain, dzLod(0.2, fw));
  } else if (s == 6.0) {
    // corrugated metal: ribs, plus rust and grime gathering low down
    float rib = 0.5 + 0.5 * sin(q.x / 0.17 * 6.2832);
    c *= mix(1.0, 0.84 + 0.2 * rib, dzLod(0.17, fw));
    c = mix(c, c * vec3(0.78, 0.6, 0.48), smoothstep(0.62, 0.85, big) * 0.6);
  } else if (s == 7.0) {
    // flat roof: gravel and tar seams
    vec2 f = fract(q / 4.0);
    float seam = min(smoothstep(0.0, 0.01, f.x), smoothstep(0.0, 0.01, f.y));
    c *= (0.86 + 0.24 * fine) * (0.9 + 0.16 * big) * mix(1.0, mix(0.75, 1.0, seam), dzLod(0.5, fw));
  } else if (s == 8.0) {
    vec2 b = q / 0.6, f = fract(b);
    float grout = smoothstep(0.0, 0.04, f.x) * smoothstep(0.0, 0.04, f.y);
    c = mix(c, mix(c * 1.12 + 0.06, c * (0.94 + 0.1 * dzHash(floor(b))), grout), dzLod(0.6, fw));
  } else if (s == 9.0) {
    // wallpaper: soft stripes with a small repeating motif
    float st = smoothstep(0.45, 0.55, fract(q.x / 0.32));
    vec2 m = fract(q / vec2(0.32, 0.4)) - 0.5;
    float dot1 = 1.0 - smoothstep(0.05, 0.08, length(m));
    c *= mix(1.0, (0.97 + 0.04 * st) * (1.0 - dot1 * 0.06), dzLod(0.32, fw));
  }
  // outside surfaces weather a little: broad stains, darker toward the ground
  if (s > 0.5 && s != 5.0 && s != 8.0 && s != 9.0) c *= 0.95 + 0.08 * big;
  diffuseColor.rgb = c;
}
`;

const TERRAIN_FRAG = /* glsl */ `
#include <color_fragment>
{
  vec2 p = vDzWP.xz;
  float fw = length(fwidth(p));
  float n1 = texture2D(dzNoise, p * 0.0055).r, n2 = texture2D(dzNoise, p * 0.04).r, n3 = texture2D(dzNoise, p * 0.31).r;
  vec3 c = diffuseColor.rgb;
  float green = smoothstep(0.02, 0.12, c.g - max(c.r, c.b));
  float sandy = smoothstep(2.6, 1.8, vDzWP.y) * smoothstep(-0.6, 0.2, vDzWP.y) * (1.0 - green);
  float slope = 1.0 - vDzWN.y;
  float rock = smoothstep(0.22, 0.42, slope);
  // broad patches: sun-dried and lush grass
  c *= 0.9 + 0.2 * n1;
  c = mix(c, c * vec3(1.14, 1.06, 0.74), smoothstep(0.55, 0.78, n2) * 0.55 * green);
  c = mix(c, c * vec3(0.82, 0.95, 0.86), smoothstep(0.45, 0.25, n2) * 0.45 * green);
  // close-up grain (clumps, pebbles)
  c *= mix(1.0, 0.9 + 0.2 * n3, dzLod(0.5, fw));
  // rock: layered strata and cracks on steep ground
  float strata = fract(vDzWP.y / 1.3 + n2 * 0.9);
  float layer = mix(0.8, 1.05, smoothstep(0.0, 0.18, strata)) * (0.9 + 0.18 * dzHash(vec2(floor(vDzWP.y / 1.3 + n2 * 0.9), 7.0)));
  c *= mix(1.0, layer * (0.92 + 0.14 * n3), rock * dzLod(1.3, fw));
  // paved squares and yards (the terrain marks how paved each point is): slabs with joints
  float pave = clamp(vDzSurf, 0.0, 1.0);
  if (pave > 0.01) {
    vec2 b = p / 2.4, f = fract(b);
    float joint = smoothstep(0.0, 0.025, f.x) * smoothstep(1.0, 0.975, f.x) * smoothstep(0.0, 0.025, f.y) * smoothstep(1.0, 0.975, f.y);
    float slab = (0.93 + 0.12 * dzHash(floor(b))) * mix(0.78, 1.0, joint) * (0.95 + 0.1 * n3);
    c *= mix(1.0, slab, pave * dzLod(2.4, fw));
  }
  // snow: soft drifts with cool blue hollows and a few glints up close
  float snow = smoothstep(0.62, 0.8, min(c.r, min(c.g, c.b)));
  if (snow > 0.0) {
    vec3 sn = c * mix(vec3(0.74, 0.84, 1.0), vec3(0.94, 0.98, 1.06), smoothstep(0.3, 0.7, n2)) * (0.94 + 0.08 * n3);
    sn += vec3(0.6) * smoothstep(0.86, 0.9, texture2D(dzNoise, p * 1.7).r) * dzLod(0.3, fw);
    c = mix(c, sn, snow);
  }
  // wind ripples in the sand
  float rip = sin(dot(p, vec2(0.95, 0.42)) * 3.4 + n2 * 7.0);
  c *= 1.0 - sandy * 0.06 * rip * dzLod(1.8, fw);
  // wet sand darker right at the water line
  c *= 1.0 - 0.18 * smoothstep(0.9, 0.0, vDzWP.y) * smoothstep(-0.8, 0.0, vDzWP.y) * (1.0 - green);
  diffuseColor.rgb = c;
}
`;

function patch(m: THREE.Material, key: string, frag: string, prev?: (sh: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => void) {
  m.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.uniforms.dzNoise = noise();
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', frag);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + key;
  return m;
}

/** Building and prop materials: patterns chosen per face by the `surf` vertex attribute. */
export function withSurfaces<T extends THREE.Material>(m: T): T {
  return patch(m, '+surf', BUILDING_FRAG, m.onBeforeCompile) as T;
}
/** Ground: patches, grain, rock layers on slopes, sand ripples. */
export function withTerrainDetail<T extends THREE.Material>(m: T): T {
  return patch(m, '+ground', TERRAIN_FRAG, m.onBeforeCompile) as T;
}

const GLASS_VERT_HEAD = /* glsl */ `varying vec3 vDzWP; varying vec3 vDzWN;\n`;
const GLASS_VERT = /* glsl */ `
#include <begin_vertex>
vDzWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDzWN = normalize(mat3(modelMatrix) * normal);
`;
const GLASS_FRAG = /* glsl */ `
#include <color_fragment>
{
  vec3 c = diffuseColor.rgb;
  float glass = smoothstep(0.08, 0.2, c.b - c.r);
  if (glass > 0.0) {
    vec3 N = normalize(vDzWN), V = normalize(vDzWP - cameraPosition);
    if (dot(N, V) > 0.0) N = -N; // seen from inside
    vec3 R = reflect(V, N);
    // the sky (and the ground below the horizon) reflected, stronger at grazing angles
    vec3 sky = mix(vec3(0.66, 0.79, 0.9), vec3(0.16, 0.4, 0.82), clamp(R.y * 1.4 + 0.1, 0.0, 1.0));
    sky = mix(vec3(0.36, 0.42, 0.38), sky, smoothstep(-0.12, 0.02, R.y));
    float fres = pow(1.0 - abs(dot(V, N)), 3.0);
    vec3 g = mix(c * vec3(0.55, 0.68, 0.78), sky, 0.5 + fres * 0.4);
    // a diagonal glint across the pane
    float d = fract((vDzWP.x + vDzWP.z) * 0.33 + vDzWP.y * 0.5);
    g += vec3(0.32) * smoothstep(0.0, 0.04, d) * smoothstep(0.16, 0.1, d);
    diffuseColor.rgb = mix(c, g, glass);
  }
}
`;
/** Window glass: reflects the sky with a glint; lamps and other glowing parts are left as they are. */
export function withGlass<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = GLASS_VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', GLASS_VERT);
    sh.fragmentShader = GLASS_VERT_HEAD + sh.fragmentShader.replace('#include <color_fragment>', GLASS_FRAG);
  };
  m.customProgramCacheKey = () => 'dzglass';
  return m;
}
