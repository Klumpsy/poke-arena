export type Side = 'a' | 'b';
export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StageKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva';
export type Status = 'none' | 'par' | 'slp' | 'brn' | 'psn' | 'tox' | 'frz';
export type Gender = 'male' | 'female' | 'genderless';
export type Weather = 'none' | 'sun' | 'rain' | 'sand' | 'hail';
export type Terrain = 'none' | 'electric' | 'grassy' | 'psychic' | 'misty';

export interface FieldState {
  weather: Weather;
  weatherTurns: number;
  terrain: Terrain;
  terrainTurns: number;
}

export interface BattleOptions {
  weather?: Weather;
  terrain?: Terrain;
}

export type Stats = Record<StatKey, number>;
export type Stages = Record<StageKey, number>;

export interface PokemonSnapshot {
  id: string;
  speciesId: number;
  level: number;
  nature: string;
  ivs: Stats;
  moves: string[];
  shiny: boolean;
  gender: Gender;
  ability?: string | null;
}

export interface TeamSnapshot {
  pokemon: PokemonSnapshot[];
}

export interface MoveSlot {
  slug: string;
  pp: number;
  maxPp: number;
}

export interface BattlePokemon {
  id: string;
  speciesId: number;
  name: string;
  types: string[];
  level: number;
  nature: string;
  shiny: boolean;
  gender: Gender;
  stats: Stats;
  maxHp: number;
  hp: number;
  status: Status;
  sleepTurns: number;
  toxicCounter: number;
  stages: Stages;
  moves: MoveSlot[];
  ability: string;
  helpingHand: boolean;
  flinched: boolean;
  protectedNow: boolean;
  protectStreak: number;
  charging: { moveIndex: number; slug: string; invulnerable: boolean } | null;
  damageTakenThisTurn: { amount: number; category: 'physical' | 'special' } | null;
  movedThisTurn: boolean;
  leechSeeded: boolean;
  cursed: boolean;
  yawnTurns: number;
  turnsOnField: number;
  aquaRing: boolean;
  truantLoaf: boolean;
}

export interface SideState {
  team: BattlePokemon[];
  active: number;
}

export type Phase = 'choose' | 'replace' | 'finished';

export interface BattleState {
  seed: number;
  rng: number;
  turn: number;
  phase: Phase;
  sides: Record<Side, SideState>;
  winner: Side | null;
  field: FieldState;
}

export type Action = { type: 'move'; moveIndex: number } | { type: 'switch'; slot: number };

export type BattleEvent =
  | { type: 'turn'; turn: number }
  | { type: 'switch'; side: Side; slot: number; name: string }
  | { type: 'move'; side: Side; name: string; move: string; slug: string; moveType: string; category: 'physical' | 'special' | 'status' }
  | { type: 'miss'; side: Side; name: string }
  | { type: 'fail'; side: Side; name: string }
  | { type: 'damage'; side: Side; name: string; amount: number; hp: number; maxHp: number; effectiveness: number; crit: boolean }
  | { type: 'heal'; side: Side; name: string; amount: number; hp: number; maxHp: number }
  | { type: 'stat'; side: Side; name: string; stat: StageKey; change: number }
  | { type: 'status'; side: Side; name: string; status: Status }
  | { type: 'cure'; side: Side; name: string }
  | { type: 'statusEffect'; side: Side; name: string; status: Status; text: 'skip' | 'thaw' | 'wake' | 'residual' }
  | { type: 'flinch'; side: Side; name: string }
  | { type: 'faint'; side: Side; name: string }
  | { type: 'weather'; weather: Weather; text: 'start' | 'end' | 'residual' }
  | { type: 'terrain'; terrain: Terrain; text: 'start' | 'end' }
  | { type: 'ability'; side: Side; name: string; ability: string; text: string }
  | { type: 'protect'; side: Side; name: string }
  | { type: 'charge'; side: Side; name: string; move: string }
  | { type: 'end'; winner: Side };
