export type Side = 'a' | 'b';
export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StageKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva';
export type Status = 'none' | 'par' | 'slp' | 'brn' | 'psn' | 'tox' | 'frz';
export type Gender = 'male' | 'female' | 'genderless';

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
  helpingHand: boolean;
  flinched: boolean;
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
}

export type Action = { type: 'move'; moveIndex: number } | { type: 'switch'; slot: number };

export type BattleEvent =
  | { type: 'turn'; turn: number }
  | { type: 'switch'; side: Side; slot: number; name: string }
  | { type: 'move'; side: Side; name: string; move: string }
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
  | { type: 'end'; winner: Side };
