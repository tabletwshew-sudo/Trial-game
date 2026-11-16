import { QUALITY, type Quality } from './terrain';
import { settings } from '../settings';

/**
 * Picks a graphics level. "Auto" (the default) reads the GPU's name and the CPU's core count:
 * software renderers, phones, Chromebooks and older Intel laptops get Low; recent integrated
 * graphics (Intel Iris/UHD, base Apple M-series) get Medium; dedicated cards and the bigger
 * Apple chips get High. Dynamic resolution and the slow-frame fallback in the game loop still
 * trim further if a level turns out too heavy.
 */
export type QualityName = 'low' | 'medium' | 'high';

export function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

export function detectQuality(gpu = gpuName(), cores = navigator.hardwareConcurrency || 4): QualityName {
  const g = gpu.toLowerCase();
  if (!g || /swiftshader|llvmpipe|software|basic render|mali|adreno|powervr|videocore|apple gpu/.test(g)) return 'low';
  let level: QualityName = 'medium';
  if (/intel.*\bhd graphics\b|hd graphics [2-6]\d{2,3}\b|gma|intel\(r\) hd\b/.test(g)) level = 'low';
  else if (/rtx|gtx 1[06-9]|gtx [2-9]\d{2}0|radeon rx|radeon pro|apple m\d+ (pro|max|ultra)|apple m[3-9]|arc a\d/.test(g)) level = 'high';
  // few cores usually means a low-power laptop or tablet
  if (cores <= 2) level = 'low';
  else if (cores <= 4 && level === 'high') level = 'medium';
  return level;
}

export function pickQuality(): Quality & { name: QualityName } {
  const asked = new URLSearchParams(location.search).get('q') ?? settings.graphics;
  const name: QualityName = asked === 'low' || asked === 'medium' || asked === 'high' ? asked : detectQuality();
  return { ...QUALITY[name], name };
}
