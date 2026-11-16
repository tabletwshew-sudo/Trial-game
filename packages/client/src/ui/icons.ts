import { ITEM, ITEMS } from '@dropzone/shared';

/**
 * Item icons: side-on silhouettes drawn as small inline SVGs (64x32, muzzle to the right), so
 * every weapon type is recognisable at a glance in the hotbar, inventory, kill feed and pickup
 * prompts. All original drawings.
 *
 * Fill styles: 0 = the icon colour (currentColor), 1 = accent (the rarity colour, from the
 * `--rc` CSS variable), 2 = dark detail.
 */
type Style = 0 | 1 | 2;
type Shape =
  | ['p', number[], Style?]                          // polygon: x,y,x,y...
  | ['r', number, number, number, number, Style?, number?] // rect x,y,w,h,style,corner
  | ['c', number, number, number, Style?]            // circle
  | ['ring', number, number, number, number];        // circle outline: cx, cy, r, width

const FILL = ['currentColor', 'var(--rc, #ffd23f)', 'rgba(10,12,30,.55)'];

function svg(shapes: Shape[]): string {
  const parts = shapes.map((s) => {
    switch (s[0]) {
      case 'p': return `<polygon points="${s[1].join(',')}" fill="${FILL[s[2] ?? 0]}"/>`;
      case 'r': return `<rect x="${s[1]}" y="${s[2]}" width="${s[3]}" height="${s[4]}" rx="${s[6] ?? 0.8}" fill="${FILL[s[5] ?? 0]}"/>`;
      case 'c': return `<circle cx="${s[1]}" cy="${s[2]}" r="${s[3]}" fill="${FILL[s[4] ?? 0]}"/>`;
      case 'ring': return `<circle cx="${s[1]}" cy="${s[2]}" r="${s[3]}" fill="none" stroke="currentColor" stroke-width="${s[4]}"/>`;
    }
  });
  return `<svg class="ico" viewBox="0 0 64 32" aria-hidden="true">${parts.join('')}</svg>`;
}

const ICONS: Record<string, Shape[]> = {
  pistol: [
    ['p', [10, 7, 50, 7, 50, 14, 31, 14, 29, 17, 24, 17, 22, 28, 13, 28, 15, 15, 10, 15]],
    ['r', 50, 8.5, 3, 4],
    ['r', 30, 7, 18, 2.2, 1],
    ['p', [24, 17, 30, 17, 29, 21, 24, 21], 2],
    ['r', 14, 9, 4, 3, 2],
  ],
  smg: [
    ['p', [3, 10, 14, 10, 14, 14, 8, 14, 6, 18, 3, 18]],
    ['r', 14, 9, 31, 8],
    ['r', 45, 10.5, 9, 3.4],
    ['r', 53, 9.5, 3, 5.4],
    ['p', [19, 17, 25, 17, 23, 26, 17, 26]],
    ['p', [31, 17, 36, 17, 37.5, 30, 32.5, 30]],
    ['r', 17, 6.5, 22, 2.5, 1],
    ['r', 38, 11, 5, 2, 2],
  ],
  ar: [
    ['p', [1, 10, 16, 9, 16, 17, 6, 19, 1, 19]],
    ['r', 16, 9, 25, 8],
    ['r', 41, 10, 12, 5.5],
    ['r', 53, 11.5, 10, 2.2],
    ['r', 20, 5.5, 17, 3.5, 1],
    ['r', 48, 6.5, 2, 3.5],
    ['p', [20, 17, 26, 17, 24, 26, 18, 26]],
    ['p', [30, 17, 36, 17, 40, 28, 34, 29]],
    ['r', 42, 11.5, 9, 1.4, 2],
  ],
  burst: [
    ['p', [2, 11, 15, 10, 15, 17, 7, 18, 2, 18]],
    ['r', 15, 10, 27, 7],
    ['r', 42, 10.5, 11, 5.5],
    ['r', 53, 12, 7, 2.6],
    ['r', 19, 4, 16, 4.5, 0, 2],
    ['r', 17, 3.2, 3, 6, 0],
    ['r', 22, 4.8, 10, 1.6, 1],
    ['r', 25, 8.5, 4, 1.6],
    ['p', [19, 17, 25, 17, 23, 26, 17, 26]],
    ['p', [29, 17, 35, 17, 36, 26, 30, 26]],
    ['c', 45, 13.2, 1.1, 1], ['c', 48, 13.2, 1.1, 1], ['c', 51, 13.2, 1.1, 1],
  ],
  shotgun: [
    ['p', [1, 14, 18, 11, 18, 18, 8, 21, 1, 21]],
    ['r', 18, 10, 12, 8],
    ['r', 30, 10, 33, 3.2],
    ['r', 30, 14, 25, 2.6],
    ['r', 36, 12.6, 13, 5.6, 1, 1.5],
    ['p', [19, 18, 24, 18, 22, 26, 17, 26]],
    ['r', 4, 15.5, 10, 1.5, 2],
  ],
  autoshotgun: [
    ['p', [2, 11, 15, 10, 15, 18, 6, 19, 2, 19]],
    ['r', 15, 9, 25, 9.5],
    ['r', 40, 10, 17, 4.5],
    ['r', 56, 8.5, 5, 7.5],
    ['c', 31, 23, 6.5],
    ['c', 31, 23, 2.5, 2],
    ['p', [18, 18.5, 23, 18.5, 21, 28, 16, 28]],
    ['r', 17, 6.5, 19, 2.5, 1],
    ['r', 42, 11.5, 12, 1.4, 2],
  ],
  dmr: [
    ['p', [0, 10, 15, 10, 15, 16, 5, 19, 0, 19]],
    ['r', 15, 10, 24, 6.5],
    ['r', 39, 11.6, 23, 2.2],
    ['r', 39, 10.6, 8, 4.2, 1],
    ['r', 18, 4, 18, 4, 0, 2],
    ['r', 16, 3.3, 3, 5.5], ['r', 35, 3, 3.5, 6],
    ['r', 25, 8, 4, 2],
    ['p', [19, 16.5, 24, 16.5, 22, 25, 17, 25]],
    ['r', 28, 16.5, 6, 7.5],
  ],
  sniper: [
    ['p', [0, 10, 13, 10, 13, 15.5, 6, 20, 0, 20]],
    ['r', 13, 10, 20, 6],
    ['r', 33, 11.7, 27, 2],
    ['r', 59, 10.6, 4, 4.2],
    ['r', 15, 3, 18, 5.5, 0, 2.5],
    ['r', 12.5, 2.3, 3.5, 7], ['r', 31.5, 1.5, 4.5, 8.5],
    ['r', 17, 3.8, 10, 1.6, 1],
    ['c', 30, 17.5, 1.7],
    ['p', [16, 16, 21, 16, 19, 25, 14, 25]],
    ['p', [43, 13.5, 44.8, 13.5, 48.5, 26, 46.7, 26]],
    ['p', [45, 13.5, 46.8, 13.5, 42.8, 26, 41, 26]],
  ],
  rocket: [
    ['r', 8, 9, 45, 9.5, 0, 3],
    ['r', 51, 7, 9, 13.5, 0, 2],
    ['r', 3, 8, 7, 11.5, 0, 2],
    ['r', 27, 4, 7, 5.5],
    ['r', 14, 9, 4, 9.5, 1, 0],
    ['r', 44, 9, 4, 9.5, 1, 0],
    ['c', 56, 13.75, 3, 2],
    ['p', [22, 18.5, 27, 18.5, 25, 28, 20, 28]],
    ['r', 37, 18.5, 4, 6],
  ],
  pickaxe: [
    ['p', [11, 28.5, 14.5, 31.2, 42, 8.2, 38.5, 5.5]],
    ['p', [11, 28.5, 14.5, 31.2, 19.5, 27, 16, 24.3], 2],
    ['p', [23, 9.5, 29, 3.8, 39, 1.8, 49.5, 4, 58.5, 12.5, 51.5, 10.2, 44, 7.6, 37.5, 7.4, 30.5, 10.5]],
    ['p', [35.5, 3.6, 42.2, 3.4, 44.2, 9.6, 37.6, 10.6], 1],
    ['p', [23, 9.5, 18.5, 15.5, 16, 12.5, 21, 7.5]],
  ],
  grenade: [
    ['c', 31, 19.5, 9.5],
    ['r', 27.5, 6.5, 7.5, 5],
    ['p', [34, 7.5, 44, 9.5, 42.5, 13.5, 34, 11.5], 1],
    ['ring', 24, 7.5, 3.2, 1.6],
    ['r', 22, 18.5, 18, 2, 2],
  ],
  bandage: [
    ['p', [24, 26.5, 54, 26.5, 54, 19.5, 30, 19.5]],
    ['c', 24, 16, 10.5],
    ['c', 24, 16, 3.8, 2],
    ['r', 40, 21, 2, 4.5, 1, 0], ['r', 46, 21, 2, 4.5, 1, 0],
  ],
  medpack: [
    ['r', 10, 8.5, 44, 20, 0, 3],
    ['r', 25, 4, 14, 5, 0, 1.5],
    ['r', 28.5, 11.5, 7, 14, 1, 0.5],
    ['r', 25, 15, 14, 7, 1, 0.5],
  ],
  shieldSip: [
    ['c', 32, 20.5, 9.5],
    ['r', 29, 5.5, 6, 8.5],
    ['r', 27.5, 2.8, 9, 3.6, 1, 1],
    ['p', [27, 17, 30, 14, 33, 17, 30, 20], 2],
  ],
  shieldJug: [
    ['r', 15, 9.5, 34, 20, 0, 4],
    ['r', 26, 4.5, 12, 6, 0, 1.5],
    ['ring', 44, 11, 5, 2.2],
    ['r', 15, 15.5, 34, 5, 1, 0],
  ],
  fizz: [
    ['r', 22, 4, 20, 26, 0, 3.5],
    ['r', 22, 12, 20, 8, 1, 0],
    ['r', 24, 4.5, 16, 2, 2],
    ['r', 30, 2, 5, 2.5],
  ],
  card: [
    ['r', 13, 5.5, 38, 22, 0, 3],
    ['r', 18, 10.5, 8.5, 6.5, 1, 1.2],
    ['r', 13, 19.5, 38, 3.2, 2, 0],
    ['r', 30, 10.5, 16, 2, 2], ['r', 30, 14, 11, 2, 2],
  ],
};

const AMMO_ICONS: Shape[][] = [
  // light: a short round
  [['r', 18, 12, 18, 8, 0, 1], ['p', [36, 12, 42, 13.5, 44, 16, 42, 18.5, 36, 20], 1], ['r', 16, 12, 2.5, 8, 2, 0]],
  // medium: a longer rifle round
  [['r', 12, 12, 26, 8, 0, 1], ['p', [38, 12.5, 48, 14, 52, 16, 48, 18, 38, 19.5], 1], ['r', 10, 11.5, 3, 9, 2, 0], ['r', 30, 12, 2, 8, 2, 0]],
  // heavy: a fat, long round
  [['r', 8, 10, 30, 12, 0, 1.5], ['p', [38, 10.5, 50, 12.5, 56, 16, 50, 19.5, 38, 21.5], 1], ['r', 6, 9.5, 3.5, 13, 2, 0]],
  // shells
  [['r', 16, 9, 26, 14, 1, 2], ['r', 12, 8, 7, 16, 0, 1], ['r', 40, 9, 3, 14, 2, 0]],
  // rockets
  [['r', 12, 12, 34, 8, 0, 3], ['p', [46, 12, 54, 16, 46, 20], 1], ['p', [12, 12, 8, 8, 16, 12], 0], ['p', [12, 20, 8, 24, 16, 20], 0]],
];

const cache = new Map<number, string>();
/** SVG markup for an item's icon ('' for items without one). */
export function itemIconSvg(id: number): string {
  if (cache.has(id)) return cache.get(id)!;
  const d = ITEMS[id];
  let shapes: Shape[] | undefined;
  if (d?.kind === 'weapon') shapes = ICONS[d.cls];
  else if (id === ITEM.pickaxe) shapes = ICONS.pickaxe;
  else if (id === ITEM.grenade) shapes = ICONS.grenade;
  else if (id === ITEM.bandage) shapes = ICONS.bandage;
  else if (id === ITEM.medpack) shapes = ICONS.medpack;
  else if (id === ITEM.shieldSip) shapes = ICONS.shieldSip;
  else if (id === ITEM.shieldJug) shapes = ICONS.shieldJug;
  else if (id === ITEM.fizz) shapes = ICONS.fizz;
  else if (id === ITEM.card || id === ITEM.keycard) shapes = ICONS.card;
  else if (d?.kind === 'ammo') shapes = AMMO_ICONS[d.ammo];
  const out = shapes ? svg(shapes) : '';
  cache.set(id, out);
  return out;
}

/** SVG markup for an ammo type (0 light .. 4 rockets). */
export const ammoIconSvg = (type: number) => svg(AMMO_ICONS[type] ?? AMMO_ICONS[0]);
