import { applyActions, createBattle, pendingActors, type Action, type BattleEvent, type BattleState, type Side } from '@poke-arena/engine';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { sideOf, type BattleActionRow, type BattleRow } from './types';

export interface ReplayResult {
  state: BattleState;
  states: BattleState[];
  turns: BattleEvent[][];
  submitted: Partial<Record<Side, Action>>;
}

export function replayBattle(battle: BattleRow, actions: BattleActionRow[]): ReplayResult {
  if (!battle.challenger_team || !battle.opponent_team) throw new Error('Battle has no team snapshots');
  let state = createBattle(battle.challenger_team, battle.opponent_team, Number(battle.seed));
  const turns: BattleEvent[][] = [];
  const states: BattleState[] = [];
  const byTurn = new Map<number, Partial<Record<Side, Action>>>();
  for (const row of actions) {
    const group = byTurn.get(row.turn) ?? {};
    group[sideOf(battle, row.player_id)] = row.action;
    byTurn.set(row.turn, group);
  }
  for (let turn = 1; ; turn++) {
    const group = byTurn.get(turn);
    if (!group || state.phase === 'finished') return { state, states, turns, submitted: group ?? {} };
    const pending = pendingActors(state);
    if (!pending.every((side) => group[side])) return { state, states, turns, submitted: group };
    const r = applyActions(state, group);
    state = r.state;
    turns.push(r.events);
    states.push(state);
  }
}

export async function fetchActions(battleId: string): Promise<BattleActionRow[]> {
  const { data, error } = await supabase.from('battle_actions').select('*').eq('battle_id', battleId).order('turn').order('created_at');
  if (error) throw error;
  return (data as BattleActionRow[] | null) ?? [];
}

export async function submitAction(battleId: string, turn: number, playerId: string, action: Action): Promise<void> {
  const { error } = await supabase.from('battle_actions').insert({ battle_id: battleId, turn, player_id: playerId, action });
  if (error && !/duplicate key/.test(error.message)) throw error;
}

export function watchBattle(battleId: string, onChange: () => void): RealtimeChannel {
  return supabase
    .channel(`battle-${battleId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'battle_actions', filter: `battle_id=eq.${battleId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'battles', filter: `id=eq.${battleId}` }, onChange)
    .subscribe();
}
