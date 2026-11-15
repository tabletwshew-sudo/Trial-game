/**
 * All gameplay tuning lives here so the client (prediction) and the server
 * (authority) always agree. Units: metres, seconds, HP.
 * Values are tuned targets (see docs/RESEARCH.md), not copied numbers.
 */

export const TICK_RATE = 30;
export const INPUT_RATE = 60;
export const MAX_PLAYERS = 80;

export type Mode = 'solo' | 'duo' | 'trio' | 'squad';
export const TEAM_SIZE: Record<Mode, number> = { solo: 1, duo: 2, trio: 3, squad: 4 };
export const MAX_PARTY_SIZE = 4;
/** Players per match for a mode: 80, rounded down to full teams (trios = 78). */
export const matchCapacity = (mode: Mode) => Math.floor(MAX_PLAYERS / TEAM_SIZE[mode]) * TEAM_SIZE[mode];
/** Seconds a queue waits for humans before topping up with bots. */
export const QUEUE_TIMEOUT_S = 30;

export const MOVEMENT = {
  walkSpeed: 4.2,
  sprintSpeed: 6.4,
  crouchSpeed: 2.4,
  adsSpeedMul: 0.6,
  swimSpeed: 3.2,
  swimSprintSpeed: 4.8,
  slideMinEntrySpeed: 5.5,
  slideFriction: 2.2,
  slideSlopeAccel: 9.0,
  jumpVelocity: 6.2,
  gravity: 19.6,
  airControl: 0.35,
  mantleMaxHeight: 2.5,
  hurdleMaxHeight: 1.2,
  fallDamageMinHeight: 10,
  fallDamagePerMetre: 6,
} as const;

export const DROP = {
  busSpeed: 30,
  busAltitude: 320,
  doorsOpenDelayS: 5,
  freefallMaxSpeed: 80,
  freefallHorizontalSpeed: 25,
  gliderAutoDeployHeight: 100,
  gliderSpeed: 16,
  gliderSink: 7,
} as const;

export const HEALTH = { maxHealth: 100, maxShield: 100 } as const;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9d9d9d', uncommon: '#3fbf3f', rare: '#3b8cff', epic: '#b14cff', legendary: '#ffb020',
};
/** Damage multiplier per tier, applied to the weapon's base damage. */
export const RARITY_DAMAGE_MUL: Record<Rarity, number> = {
  common: 1.0, uncommon: 1.05, rare: 1.1, epic: 1.16, legendary: 1.22,
};
/** Chest weapon rarity weights (no commons, like genre convention). */
export const CHEST_RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 0, uncommon: 45, rare: 35, epic: 16, legendary: 4,
};

export interface StormPhase { waitS: number; shrinkS: number; radiusFrac: number; dps: number }
/** radiusFrac is the target radius as a fraction of the island's half-size. */
export const STORM_PHASES: StormPhase[] = [
  { waitS: 90, shrinkS: 60, radiusFrac: 0.62, dps: 1 },
  { waitS: 60, shrinkS: 50, radiusFrac: 0.42, dps: 1 },
  { waitS: 50, shrinkS: 45, radiusFrac: 0.28, dps: 2 },
  { waitS: 45, shrinkS: 40, radiusFrac: 0.18, dps: 4 },
  { waitS: 40, shrinkS: 35, radiusFrac: 0.11, dps: 6 },
  { waitS: 30, shrinkS: 30, radiusFrac: 0.06, dps: 8 },
  { waitS: 20, shrinkS: 30, radiusFrac: 0.03, dps: 10 },
  { waitS: 15, shrinkS: 25, radiusFrac: 0.012, dps: 10 },
  { waitS: 10, shrinkS: 25, radiusFrac: 0, dps: 10 },
];

export const MAP = { size: 2200, seed: 1337 } as const;
