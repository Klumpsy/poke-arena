import { defaultMoves, type Action, type Side, type Stats, type TeamSnapshot } from '@poke-arena/engine';

export interface PlayerRow {
  id: string;
  email: string;
  name: string;
  last_sync_at: string | null;
  wins: number;
  losses: number;
}

export interface PokemonRow {
  id: string;
  player_id: string;
  species_id: number;
  level: number;
  nature: string;
  ivs: Stats;
  moves: string[];
  custom_moves: string[] | null;
  shiny: boolean;
  gender: 'male' | 'female' | 'genderless';
  is_active: boolean;
  updated_at: string;
}

export function battleMoves(p: PokemonRow): string[] {
  if (p.custom_moves?.length) return p.custom_moves;
  return p.moves.length ? p.moves : defaultMoves(p.species_id, p.level);
}

export interface TeamRow {
  player_id: string;
  pokemon_ids: string[];
}

export type BattleStatus = 'pending' | 'active' | 'finished' | 'declined' | 'cancelled';

export interface BattleRow {
  id: string;
  challenger_id: string;
  opponent_id: string;
  status: BattleStatus;
  seed: number;
  challenger_team: TeamSnapshot | null;
  opponent_team: TeamSnapshot | null;
  winner_id: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface BattleActionRow {
  battle_id: string;
  turn: number;
  player_id: string;
  action: Action;
  created_at: string;
}

export interface PresenceMeta {
  id: string;
  name: string;
  inBattle: boolean;
}

export function sideOf(battle: BattleRow, playerId: string): Side {
  return battle.challenger_id === playerId ? 'a' : 'b';
}
