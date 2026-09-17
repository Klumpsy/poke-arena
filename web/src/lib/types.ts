import { defaultMoves, type Action, type Side, type Stats, type TeamSnapshot } from '@poke-arena/engine';

export interface PlayerRow {
  id: string;
  email: string;
  name: string;
  last_sync_at: string | null;
  last_seen_at: string;
  wins: number;
  losses: number;
  rating: number;
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
  ability: string | null;
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

export type BattleStatus = 'pending' | 'active' | 'finished' | 'declined' | 'cancelled' | 'disputed';

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
  gym_id: string | null;
  stake: string | null;
  rating_delta: number | null;
  gym_offer: string | null;
  champion_match: boolean;
  tournament_match_id: string | null;
}

export interface TournamentRow {
  id: string;
  name: string;
  status: 'open' | 'running' | 'finished' | 'cancelled';
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  winner_id: string | null;
}

export interface TournamentPlayerRow {
  tournament_id: string;
  player_id: string;
}

export interface TournamentMatchRow {
  id: string;
  tournament_id: string;
  round: number;
  position: number;
  p1: string | null;
  p2: string | null;
  winner_id: string | null;
  battle_id: string | null;
}

export interface TitleRow {
  player_id: string;
  code: string;
  label: string;
  earned_at: string;
}

export interface QuestRow {
  code: string;
  title: string;
  progress: number;
  target: number;
  points: number;
}

export interface GymRow {
  id: string;
  name: string;
  type: string;
  sort: number;
  leader_id: string | null;
  claimed_at: string | null;
}

export interface BadgeRow {
  player_id: string;
  gym_id: string;
  earned_at: string;
  beaten_leader_id: string | null;
}

export interface CooldownRow {
  player_id: string;
  gym_id: string;
  until: string;
}

export interface DebtRow {
  id: string;
  battle_id: string | null;
  debtor_id: string;
  creditor_id: string;
  stake: string;
  created_at: string;
  done_at: string | null;
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
