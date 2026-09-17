import { natureMultiplier, species } from './data';
import type { PokemonSnapshot, StageKey, StatKey, Stats } from './types';

const NON_HP: StatKey[] = ['atk', 'def', 'spa', 'spd', 'spe'];

export function computeStats(p: PokemonSnapshot): Stats {
  const base = species(p.speciesId).base;
  const L = p.level;
  const hp = Math.floor(((2 * base.hp + p.ivs.hp) * L) / 100) + L + 10;
  const stats = { hp } as Stats;
  for (const key of NON_HP) {
    const raw = Math.floor(((2 * base[key] + p.ivs[key]) * L) / 100) + 5;
    stats[key] = Math.floor(raw * natureMultiplier(p.nature, key));
  }
  return stats;
}

export function stageMultiplier(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  return Math.max(2, 2 + s) / Math.max(2, 2 - s);
}

export function accuracyMultiplier(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  return Math.max(3, 3 + s) / Math.max(3, 3 - s);
}

export function isStageKey(key: string): key is StageKey {
  return ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'].includes(key);
}
