import pokemonJson from '../../data/pokemon.json';
import movesJson from '../../data/moves.json';
import typesJson from '../../data/types.json';
import type { StatKey } from './types';

export interface SpeciesData {
  id: number;
  name: string;
  slug: string;
  types: string[];
  base: Record<StatKey, number>;
}

export interface MoveData {
  id: number;
  slug: string;
  name: string;
  type: string;
  category: 'physical' | 'special' | 'status';
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  target: string;
  effectChance: number | null;
  minHits: number | null;
  maxHits: number | null;
  drain: number;
  healing: number;
  critRate: number;
  ailment: string;
  ailmentChance: number;
  flinchChance: number;
  statChance: number;
  metaCategory: string;
  statChanges: { stat: string; change: number }[];
  effect: string;
}

export const SPECIES = pokemonJson as unknown as Record<string, SpeciesData>;
export const MOVES = movesJson as unknown as Record<string, MoveData>;
export const TYPE_CHART = typesJson as Record<string, Record<string, number>>;

export function species(id: number): SpeciesData {
  const s = SPECIES[String(id)];
  if (!s) throw new Error(`Unknown species ${id}`);
  return s;
}

export function move(slug: string): MoveData {
  const m = MOVES[slug];
  if (!m) throw new Error(`Unknown move ${slug}`);
  return m;
}

export function typeEffectiveness(moveType: string, targetTypes: string[]): number {
  return targetTypes.reduce((acc, t) => acc * (TYPE_CHART[moveType]?.[t] ?? 1), 1);
}

type NatureMod = { up: StatKey | null; down: StatKey | null };
export const NATURES: Record<string, NatureMod> = {
  hardy: { up: null, down: null },
  lonely: { up: 'atk', down: 'def' },
  brave: { up: 'atk', down: 'spe' },
  adamant: { up: 'atk', down: 'spa' },
  naughty: { up: 'atk', down: 'spd' },
  bold: { up: 'def', down: 'atk' },
  docile: { up: null, down: null },
  relaxed: { up: 'def', down: 'spe' },
  impish: { up: 'def', down: 'spa' },
  lax: { up: 'def', down: 'spd' },
  timid: { up: 'spe', down: 'atk' },
  hasty: { up: 'spe', down: 'def' },
  serious: { up: null, down: null },
  jolly: { up: 'spe', down: 'spa' },
  naive: { up: 'spe', down: 'spd' },
  modest: { up: 'spa', down: 'atk' },
  mild: { up: 'spa', down: 'def' },
  quiet: { up: 'spa', down: 'spe' },
  bashful: { up: null, down: null },
  rash: { up: 'spa', down: 'spd' },
  calm: { up: 'spd', down: 'atk' },
  gentle: { up: 'spd', down: 'def' },
  sassy: { up: 'spd', down: 'spe' },
  careful: { up: 'spd', down: 'spa' },
  quirky: { up: null, down: null },
};

export function natureMultiplier(nature: string, stat: StatKey): number {
  const n = NATURES[nature] ?? NATURES.hardy;
  if (n.up === stat) return 1.1;
  if (n.down === stat) return 0.9;
  return 1;
}
