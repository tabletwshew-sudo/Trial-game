import { RARITIES, RARITY_DAMAGE_MUL, type Rarity } from './constants.js';

/**
 * Every item in the game. Item ids are indexes into ITEMS (0 = empty), so they fit in one byte
 * on the wire. Names and stats are original; the numbers are tuned for fun 30-60 s fights,
 * with roughly 2-3 s to eliminate a full-health, full-shield player with an assault rifle.
 */

export const AMMO = { light: 0, medium: 1, heavy: 2, shells: 3, rockets: 4 } as const;
export type AmmoType = keyof typeof AMMO;
export const AMMO_NAMES = ['Light Ammo', 'Medium Ammo', 'Heavy Ammo', 'Shells', 'Rockets'];
export const AMMO_MAX = [999, 999, 999, 999, 12];
export const AMMO_COLORS = ['#9fd3ff', '#ffd23f', '#ff8a5c', '#ff5f6d', '#b388ff'];

export type WeaponClass = 'pistol' | 'smg' | 'ar' | 'burst' | 'shotgun' | 'autoshotgun' | 'dmr' | 'sniper' | 'rocket';

export interface WeaponDef {
  kind: 'weapon';
  name: string;
  cls: WeaponClass;
  ammo: number;
  /** Damage per bullet (per pellet for shotguns) at Common rarity. */
  damage: number;
  headMul: number;
  /** Sim ticks (60/s) between shots, or between bursts for burst weapons. */
  interval: number;
  auto: boolean;
  burst: number;
  burstGap: number;
  mag: number;
  /** Seconds to reload at Common. Shotgun reloads one shell at a time (`perShell`). */
  reload: number;
  perShell?: number;
  pellets: number;
  /** Spread in radians (cone half-angle) when hip-firing / aiming down sights. */
  spreadHip: number;
  spreadAds: number;
  /** Bloom added per shot, the cap, and how fast it recovers (per second). */
  bloomShot: number;
  bloomMax: number;
  bloomRecover: number;
  /** Full damage until `falloffStart` m, scaling down to `falloffMin` x at `range` m. */
  falloffStart: number;
  range: number;
  falloffMin: number;
  /** Camera field of view while aiming. */
  adsFov: number;
  scope?: boolean;
  /** Projectile weapons (rockets): speed in m/s and blast radius / damage. */
  projectile?: { speed: number; gravity: number; radius: number; blast: number };
  rarities: Rarity[];
}

export interface ConsumableDef {
  kind: 'consumable';
  name: string;
  /** Seconds to use. */
  use: number;
  heal: number;
  healCap: number;
  shield: number;
  shieldCap: number;
  stack: number;
  rarity: Rarity;
  walk: boolean;
}

export interface ThrowableDef {
  kind: 'throwable';
  name: string;
  stack: number;
  rarity: Rarity;
  fuse: number;
  radius: number;
  blast: number;
  speed: number;
}

export interface AmmoDef { kind: 'ammo'; name: string; ammo: number; rarity: Rarity }

export type ItemDef = WeaponDef | ConsumableDef | ThrowableDef | AmmoDef;

const ALL: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const W = (d: Omit<WeaponDef, 'kind'>): WeaponDef => ({ kind: 'weapon', ...d });

export const ITEMS: (ItemDef | null)[] = [
  null,
  W({ name: 'Ranger Pistol', cls: 'pistol', ammo: AMMO.light, damage: 24, headMul: 1.5, interval: 9, auto: false, burst: 1, burstGap: 0, mag: 16, reload: 1.4, pellets: 1, spreadHip: 0.012, spreadAds: 0.004, bloomShot: 0.012, bloomMax: 0.05, bloomRecover: 0.12, falloffStart: 28, range: 120, falloffMin: 0.6, adsFov: 58, rarities: ALL.slice(0, 4) }),
  W({ name: 'Hornet SMG', cls: 'smg', ammo: AMMO.light, damage: 16, headMul: 1.5, interval: 5, auto: true, burst: 1, burstGap: 0, mag: 30, reload: 2.1, pellets: 1, spreadHip: 0.022, spreadAds: 0.012, bloomShot: 0.004, bloomMax: 0.05, bloomRecover: 0.15, falloffStart: 20, range: 90, falloffMin: 0.55, adsFov: 60, rarities: ALL.slice(0, 4) }),
  W({ name: 'Vanguard AR', cls: 'ar', ammo: AMMO.medium, damage: 30, headMul: 1.5, interval: 11, auto: true, burst: 1, burstGap: 0, mag: 30, reload: 2.3, pellets: 1, spreadHip: 0.016, spreadAds: 0.003, bloomShot: 0.006, bloomMax: 0.04, bloomRecover: 0.1, falloffStart: 50, range: 220, falloffMin: 0.7, adsFov: 52, rarities: ALL }),
  W({ name: 'Trident Burst AR', cls: 'burst', ammo: AMMO.medium, damage: 27, headMul: 1.5, interval: 24, auto: true, burst: 3, burstGap: 4, mag: 30, reload: 2.5, pellets: 1, spreadHip: 0.014, spreadAds: 0.002, bloomShot: 0.004, bloomMax: 0.03, bloomRecover: 0.12, falloffStart: 55, range: 220, falloffMin: 0.7, adsFov: 50, rarities: ALL.slice(1, 5) }),
  W({ name: 'Thunder Pump', cls: 'shotgun', ammo: AMMO.shells, damage: 10, headMul: 1.75, interval: 62, auto: false, burst: 1, burstGap: 0, mag: 5, reload: 4.2, perShell: 0.6, pellets: 9, spreadHip: 0.075, spreadAds: 0.06, bloomShot: 0, bloomMax: 0, bloomRecover: 1, falloffStart: 7, range: 32, falloffMin: 0.25, adsFov: 64, rarities: ALL }),
  W({ name: 'Breacher Auto Shotgun', cls: 'autoshotgun', ammo: AMMO.shells, damage: 7, headMul: 1.6, interval: 32, auto: true, burst: 1, burstGap: 0, mag: 8, reload: 4.6, perShell: 0.5, pellets: 8, spreadHip: 0.085, spreadAds: 0.07, bloomShot: 0, bloomMax: 0, bloomRecover: 1, falloffStart: 6, range: 28, falloffMin: 0.25, adsFov: 64, rarities: ALL.slice(0, 4) }),
  W({ name: 'Keystone DMR', cls: 'dmr', ammo: AMMO.heavy, damage: 38, headMul: 1.75, interval: 20, auto: false, burst: 1, burstGap: 0, mag: 10, reload: 2.4, pellets: 1, spreadHip: 0.02, spreadAds: 0.0015, bloomShot: 0.01, bloomMax: 0.04, bloomRecover: 0.08, falloffStart: 90, range: 320, falloffMin: 0.75, adsFov: 34, scope: true, rarities: ALL.slice(1, 5) }),
  W({ name: 'Longshot Sniper', cls: 'sniper', ammo: AMMO.heavy, damage: 100, headMul: 2.5, interval: 110, auto: false, burst: 1, burstGap: 0, mag: 4, reload: 3.0, pellets: 1, spreadHip: 0.05, spreadAds: 0, bloomShot: 0, bloomMax: 0, bloomRecover: 1, falloffStart: 400, range: 600, falloffMin: 1, adsFov: 16, scope: true, rarities: ALL.slice(2, 5) }),
  W({ name: 'Boomtube Launcher', cls: 'rocket', ammo: AMMO.rockets, damage: 0, headMul: 1, interval: 50, auto: false, burst: 1, burstGap: 0, mag: 1, reload: 3.0, pellets: 1, spreadHip: 0.006, spreadAds: 0.002, bloomShot: 0, bloomMax: 0, bloomRecover: 1, falloffStart: 0, range: 400, falloffMin: 1, adsFov: 56, projectile: { speed: 70, gravity: 0, radius: 4.5, blast: 105 }, rarities: ALL.slice(2, 5) }),
  { kind: 'throwable', name: 'Frag Grenade', stack: 6, rarity: 'uncommon', fuse: 2.2, radius: 5, blast: 90, speed: 24 },
  { kind: 'consumable', name: 'Bandage Roll', use: 3.5, heal: 15, healCap: 75, shield: 0, shieldCap: 0, stack: 15, rarity: 'common', walk: true },
  { kind: 'consumable', name: 'Med Pack', use: 10, heal: 100, healCap: 100, shield: 0, shieldCap: 0, stack: 3, rarity: 'uncommon', walk: false },
  { kind: 'consumable', name: 'Shield Sip', use: 2, heal: 0, healCap: 0, shield: 25, shieldCap: 50, stack: 6, rarity: 'uncommon', walk: true },
  { kind: 'consumable', name: 'Shield Jug', use: 5, heal: 0, healCap: 0, shield: 50, shieldCap: 100, stack: 3, rarity: 'rare', walk: false },
  { kind: 'consumable', name: 'Fizz Can', use: 1.6, heal: 15, healCap: 100, shield: 15, shieldCap: 100, stack: 4, rarity: 'epic', walk: true },
  { kind: 'ammo', name: AMMO_NAMES[0], ammo: AMMO.light, rarity: 'common' },
  { kind: 'ammo', name: AMMO_NAMES[1], ammo: AMMO.medium, rarity: 'common' },
  { kind: 'ammo', name: AMMO_NAMES[2], ammo: AMMO.heavy, rarity: 'common' },
  { kind: 'ammo', name: AMMO_NAMES[3], ammo: AMMO.shells, rarity: 'common' },
  { kind: 'ammo', name: AMMO_NAMES[4], ammo: AMMO.rockets, rarity: 'common' },
];

export const ITEM = {
  pistol: 1, smg: 2, ar: 3, burst: 4, pump: 5, autoshotgun: 6, dmr: 7, sniper: 8, rocket: 9, grenade: 10,
  bandage: 11, medpack: 12, shieldSip: 13, shieldJug: 14, fizz: 15, ammoLight: 16, ammoMedium: 17, ammoHeavy: 18, ammoShells: 19, ammoRockets: 20,
} as const;
export const AMMO_ITEM = [ITEM.ammoLight, ITEM.ammoMedium, ITEM.ammoHeavy, ITEM.ammoShells, ITEM.ammoRockets];
/** How much ammo a pickup or a reload-fresh weapon carries. */
export const AMMO_PICKUP = [30, 24, 8, 8, 2];

export const weaponDef = (id: number) => { const d = ITEMS[id]; return d && d.kind === 'weapon' ? d : null; };
export const consumableDef = (id: number) => { const d = ITEMS[id]; return d && d.kind === 'consumable' ? d : null; };
export const throwableDef = (id: number) => { const d = ITEMS[id]; return d && d.kind === 'throwable' ? d : null; };

export const rarityIndex = (r: Rarity) => RARITIES.indexOf(r);
export const RARITY_RELOAD_MUL = [1, 0.95, 0.9, 0.85, 0.8];

/** Final per-bullet damage for a weapon at a rarity index. */
export function weaponDamage(def: WeaponDef, rarity: number) {
  return def.damage * RARITY_DAMAGE_MUL[RARITIES[Math.min(4, Math.max(0, rarity))]];
}

/** Damage multiplier for distance. */
export function falloff(def: WeaponDef, dist: number) {
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.range) return def.falloffMin;
  return 1 - (1 - def.falloffMin) * ((dist - def.falloffStart) / (def.range - def.falloffStart));
}

/** Display name like "Rare Vanguard AR". */
export function itemName(id: number, rarity: number) {
  const d = ITEMS[id];
  if (!d) return '';
  if (d.kind === 'weapon') return `${RARITIES[rarity][0].toUpperCase()}${RARITIES[rarity].slice(1)} ${d.name}`;
  return d.name;
}
export function itemRarity(id: number, rarity: number) {
  const d = ITEMS[id];
  if (!d) return 0;
  return d.kind === 'weapon' ? rarity : rarityIndex(d.rarity);
}
export const stackMax = (id: number) => {
  const d = ITEMS[id];
  return !d ? 0 : d.kind === 'consumable' || d.kind === 'throwable' ? d.stack : 1;
};
