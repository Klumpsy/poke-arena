import type { PokemonSnapshot, Stats, TeamSnapshot } from '../src';

export const maxIvs: Stats = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

export function mon(speciesId: number, moves: string[], overrides: Partial<PokemonSnapshot> = {}): PokemonSnapshot {
  return {
    id: `${speciesId}-${moves.join('-')}`,
    speciesId,
    level: 50,
    nature: 'hardy',
    ivs: maxIvs,
    moves,
    shiny: false,
    gender: 'male',
    ...overrides,
  };
}

export function team(...pokemon: PokemonSnapshot[]): TeamSnapshot {
  return { pokemon };
}
