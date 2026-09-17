import type { BattleOptions } from '@poke-arena/engine';
import type { BattleRow, GymRow } from './types';

const FIELD_BY_TYPE: Record<string, BattleOptions> = {
  fire: { weather: 'sun' },
  water: { weather: 'rain' },
  grass: { terrain: 'grassy' },
  electric: { terrain: 'electric' },
  psychic: { terrain: 'psychic' },
  fairy: { terrain: 'misty' },
  rock: { weather: 'sand' },
  ground: { weather: 'sand' },
  ice: { weather: 'hail' },
};

export function battleOptions(battle: BattleRow, gyms: GymRow[]): BattleOptions {
  if (!battle.gym_id) return {};
  const gym = gyms.find((g) => g.id === battle.gym_id);
  return gym ? (FIELD_BY_TYPE[gym.type] ?? {}) : {};
}

export const WEATHER_LABEL: Record<string, string> = { sun: 'Felle zon', rain: 'Regen', sand: 'Zandstorm', hail: 'Sneeuw' };
export const TERRAIN_LABEL: Record<string, string> = { electric: 'Elektrisch terrein', grassy: 'Grasterrein', psychic: 'Psychisch terrein', misty: 'Mistig terrein' };
