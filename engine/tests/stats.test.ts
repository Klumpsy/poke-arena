import { computeStats, stageMultiplier, accuracyMultiplier } from '../src';
import { mon } from './helpers';

describe('computeStats', () => {
  it('matches the official formula for Garchomp lv 78 (Bulbapedia example, no EVs)', () => {
    const stats = computeStats(mon(445, [], { level: 78, nature: 'adamant', ivs: { hp: 24, atk: 12, def: 30, spa: 16, spd: 23, spe: 5 } }));
    expect(stats.hp).toBe(Math.floor(((2 * 108 + 24) * 78) / 100) + 78 + 10);
    expect(stats.atk).toBe(Math.floor((Math.floor(((2 * 130 + 12) * 78) / 100) + 5) * 1.1));
    expect(stats.spa).toBe(Math.floor((Math.floor(((2 * 80 + 16) * 78) / 100) + 5) * 0.9));
  });

  it('gives level 100 Pokémon full-size stats', () => {
    const stats = computeStats(mon(354, [], { level: 100 }));
    expect(stats.hp).toBe(2 * 64 + 31 + 110);
    expect(stats.atk).toBe(2 * 115 + 31 + 5);
  });

  it('falls back to neutral for unknown natures', () => {
    const a = computeStats(mon(531, [], { nature: 'bogus' }));
    const b = computeStats(mon(531, [], { nature: 'hardy' }));
    expect(a).toEqual(b);
  });
});

describe('stage multipliers', () => {
  it('follows the 2/2 table', () => {
    expect(stageMultiplier(0)).toBe(1);
    expect(stageMultiplier(1)).toBe(1.5);
    expect(stageMultiplier(-1)).toBeCloseTo(2 / 3);
    expect(stageMultiplier(6)).toBe(4);
    expect(stageMultiplier(-6)).toBe(0.25);
  });
  it('accuracy uses the 3/3 table', () => {
    expect(accuracyMultiplier(1)).toBeCloseTo(4 / 3);
    expect(accuracyMultiplier(-6)).toBeCloseTo(1 / 3);
  });
});
