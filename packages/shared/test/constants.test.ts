import { describe, expect, it } from 'vitest';
import { STORM_PHASES, CHEST_RARITY_WEIGHTS, MOVEMENT, TEAM_SIZE, MAX_PLAYERS, matchCapacity, type Mode } from '../src/constants';

describe('constants sanity', () => {
  it('storm shrinks monotonically and damage never decreases', () => {
    for (let i = 1; i < STORM_PHASES.length; i++) {
      expect(STORM_PHASES[i].radiusFrac).toBeLessThan(STORM_PHASES[i - 1].radiusFrac);
      expect(STORM_PHASES[i].dps).toBeGreaterThanOrEqual(STORM_PHASES[i - 1].dps);
    }
  });
  it('chests never roll commons and weights are positive', () => {
    expect(CHEST_RARITY_WEIGHTS.common).toBe(0);
    expect(Object.values(CHEST_RARITY_WEIGHTS).reduce((a, b) => a + b)).toBeGreaterThan(0);
  });
  it('movement speeds are ordered crouch < walk < sprint', () => {
    expect(MOVEMENT.crouchSpeed).toBeLessThan(MOVEMENT.walkSpeed);
    expect(MOVEMENT.walkSpeed).toBeLessThan(MOVEMENT.sprintSpeed);
    expect(MOVEMENT.hurdleMaxHeight).toBeLessThan(MOVEMENT.mantleMaxHeight);
  });
  it('match capacity is full teams and never exceeds 80', () => {
    for (const mode of Object.keys(TEAM_SIZE) as Mode[]) {
      expect(matchCapacity(mode) % TEAM_SIZE[mode]).toBe(0);
      expect(matchCapacity(mode)).toBeLessThanOrEqual(MAX_PLAYERS);
    }
    expect(matchCapacity('trio')).toBe(78);
    expect(matchCapacity('squad')).toBe(80);
  });
});
