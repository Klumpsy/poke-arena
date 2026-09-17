import { move as moveData, species, typeEffectiveness, type MoveData } from './data';
import { Rng, seedRng } from './rng';
import { accuracyMultiplier, computeStats, isStageKey, stageMultiplier } from './stats';
import type {
  Action,
  BattleEvent,
  BattlePokemon,
  BattleState,
  PokemonSnapshot,
  Side,
  StageKey,
  Status,
  TeamSnapshot,
} from './types';

const STRUGGLE = 'struggle';
const CRIT_CHANCE = [1 / 24, 1 / 8, 1 / 2, 1, 1];
const AILMENT_TO_STATUS: Record<string, Status> = {
  paralysis: 'par',
  sleep: 'slp',
  freeze: 'frz',
  burn: 'brn',
  poison: 'psn',
};
const STATUS_IMMUNITY: Record<Status, string[]> = {
  none: [],
  par: ['electric'],
  slp: [],
  frz: ['ice'],
  brn: ['fire'],
  psn: ['poison', 'steel'],
  tox: ['poison', 'steel'],
};
const SELF_TARGETS = new Set(['user', 'users-field', 'ally', 'user-or-ally', 'user-and-allies', 'entire-field']);

export function other(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

function buildPokemon(p: PokemonSnapshot): BattlePokemon {
  const sp = species(p.speciesId);
  const stats = computeStats(p);
  const moves = (p.moves.length ? p.moves : [STRUGGLE]).slice(0, 4).map((slug) => {
    const pp = moveData(slug).pp ?? 10;
    return { slug, pp, maxPp: pp };
  });
  return {
    id: p.id,
    speciesId: p.speciesId,
    name: sp.name,
    types: sp.types,
    level: p.level,
    nature: p.nature,
    shiny: p.shiny,
    gender: p.gender,
    stats,
    maxHp: stats.hp,
    hp: stats.hp,
    status: 'none',
    sleepTurns: 0,
    toxicCounter: 0,
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    moves,
    helpingHand: false,
    flinched: false,
  };
}

export function createBattle(teamA: TeamSnapshot, teamB: TeamSnapshot, seed: number): BattleState {
  if (!teamA.pokemon.length || !teamB.pokemon.length) throw new Error('Both teams need at least one Pokémon');
  return {
    seed,
    rng: seedRng(seed),
    turn: 0,
    phase: 'choose',
    sides: {
      a: { team: teamA.pokemon.map(buildPokemon), active: 0 },
      b: { team: teamB.pokemon.map(buildPokemon), active: 0 },
    },
    winner: null,
  };
}

export function activePokemon(state: BattleState, side: Side): BattlePokemon {
  const s = state.sides[side];
  return s.team[s.active];
}

export function hasRemaining(state: BattleState, side: Side): boolean {
  return state.sides[side].team.some((p) => p.hp > 0);
}

export function pendingActors(state: BattleState): Side[] {
  if (state.phase === 'finished') return [];
  if (state.phase === 'replace') {
    return (['a', 'b'] as Side[]).filter((s) => activePokemon(state, s).hp <= 0 && hasRemaining(state, s));
  }
  return ['a', 'b'];
}

export function legalActions(state: BattleState, side: Side): Action[] {
  if (!pendingActors(state).includes(side)) return [];
  const s = state.sides[side];
  if (state.phase === 'replace') {
    return s.team.map((p, slot) => ({ p, slot })).filter(({ p, slot }) => p.hp > 0 && slot !== s.active).map(({ slot }) => ({ type: 'switch', slot }));
  }
  const active = activePokemon(state, side);
  const withPp = active.moves.map((m, i) => ({ m, i })).filter(({ m }) => m.pp > 0);
  if (!withPp.length) return [{ type: 'move', moveIndex: -1 }];
  return withPp.map(({ i }) => ({ type: 'move', moveIndex: i }));
}

function effectiveSpeed(p: BattlePokemon): number {
  let spe = Math.floor(p.stats.spe * stageMultiplier(p.stages.spe));
  if (p.status === 'par') spe = Math.floor(spe / 2);
  return spe;
}

function chosenMove(p: BattlePokemon, action: Action): MoveData {
  if (action.type !== 'move') return moveData(STRUGGLE);
  const slot = p.moves[action.moveIndex];
  if (!slot || slot.pp <= 0) return moveData(STRUGGLE);
  return moveData(slot.slug);
}

export function applyActions(
  state: BattleState,
  actions: Partial<Record<Side, Action>>,
): { state: BattleState; events: BattleEvent[] } {
  const next: BattleState = structuredClone(state);
  const events: BattleEvent[] = [];
  const rng = new Rng(next.rng);
  const pending = pendingActors(next);
  for (const side of pending) {
    if (!actions[side]) throw new Error(`Missing action for side ${side}`);
  }
  next.turn += 1;

  if (next.phase === 'replace') {
    for (const side of pending) {
      const action = actions[side]!;
      if (action.type !== 'switch') throw new Error(`Side ${side} must switch`);
      performSwitch(next, side, action.slot, events);
    }
    next.phase = 'choose';
    next.rng = rng.state;
    return { state: next, events };
  }

  events.push({ type: 'turn', turn: next.turn });
  const order = turnOrder(next, actions as Record<Side, Action>, rng);
  for (const side of order) {
    if (next.phase === 'finished') break;
    const user = activePokemon(next, side);
    const target = activePokemon(next, other(side));
    if (user.hp <= 0 || target.hp <= 0) continue;
    executeMove(next, side, chosenMove(user, actions[side]!), actions[side]!, rng, events);
    checkFaint(next, side, events);
    checkFaint(next, other(side), events);
    if (checkWinner(next, events)) break;
  }

  if (next.phase !== 'finished') {
    endOfTurn(next, rng, events);
    checkWinner(next, events);
  }
  if (next.phase !== 'finished') {
    const needsReplace = (['a', 'b'] as Side[]).some((s) => activePokemon(next, s).hp <= 0);
    next.phase = needsReplace ? 'replace' : 'choose';
  }
  next.rng = rng.state;
  return { state: next, events };
}

function turnOrder(state: BattleState, actions: Record<Side, Action>, rng: Rng): Side[] {
  const sides: Side[] = ['a', 'b'];
  const info = sides.map((side) => {
    const p = activePokemon(state, side);
    const m = chosenMove(p, actions[side]);
    return { side, priority: m.priority, speed: effectiveSpeed(p), tie: rng.next() };
  });
  info.sort((x, y) => y.priority - x.priority || y.speed - x.speed || y.tie - x.tie);
  return info.map((i) => i.side);
}

function performSwitch(state: BattleState, side: Side, slot: number, events: BattleEvent[]): void {
  const s = state.sides[side];
  const target = s.team[slot];
  if (!target || target.hp <= 0 || slot === s.active) throw new Error(`Illegal switch to slot ${slot}`);
  s.active = slot;
  target.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
  target.helpingHand = false;
  target.flinched = false;
  events.push({ type: 'switch', side, slot, name: target.name });
}

function canAct(state: BattleState, side: Side, rng: Rng, events: BattleEvent[]): boolean {
  const p = activePokemon(state, side);
  if (p.flinched) {
    p.flinched = false;
    events.push({ type: 'flinch', side, name: p.name });
    return false;
  }
  if (p.status === 'frz') {
    if (rng.chance(20)) {
      p.status = 'none';
      events.push({ type: 'statusEffect', side, name: p.name, status: 'frz', text: 'thaw' });
      return true;
    }
    events.push({ type: 'statusEffect', side, name: p.name, status: 'frz', text: 'skip' });
    return false;
  }
  if (p.status === 'slp') {
    p.sleepTurns -= 1;
    if (p.sleepTurns <= 0) {
      p.status = 'none';
      events.push({ type: 'statusEffect', side, name: p.name, status: 'slp', text: 'wake' });
      return true;
    }
    events.push({ type: 'statusEffect', side, name: p.name, status: 'slp', text: 'skip' });
    return false;
  }
  if (p.status === 'par' && rng.chance(25)) {
    events.push({ type: 'statusEffect', side, name: p.name, status: 'par', text: 'skip' });
    return false;
  }
  return true;
}

function executeMove(state: BattleState, side: Side, mv: MoveData, action: Action, rng: Rng, events: BattleEvent[]): void {
  const user = activePokemon(state, side);
  const targetSide = other(side);
  const target = activePokemon(state, targetSide);
  if (!canAct(state, side, rng, events)) return;

  if (action.type === 'move') {
    const slot = user.moves[action.moveIndex];
    if (slot && slot.pp > 0) slot.pp -= 1;
  }
  events.push({ type: 'move', side, name: user.name, move: mv.name });

  const selfTarget = SELF_TARGETS.has(mv.target);
  if (!selfTarget && mv.accuracy !== null) {
    const chance = mv.accuracy * accuracyMultiplier(user.stages.acc - target.stages.eva);
    if (!rng.chance(chance)) {
      events.push({ type: 'miss', side, name: user.name });
      return;
    }
  }

  if (mv.category === 'status') {
    executeStatusMove(state, side, mv, rng, events);
    return;
  }

  const effectiveness = typeEffectiveness(mv.type, target.types);
  if (effectiveness === 0) {
    events.push({ type: 'damage', side: targetSide, name: target.name, amount: 0, hp: target.hp, maxHp: target.maxHp, effectiveness: 0, crit: false });
    return;
  }

  const hits = mv.minHits && mv.maxHits ? multiHitCount(mv.minHits, mv.maxHits, rng) : 1;
  let totalDamage = 0;
  for (let i = 0; i < hits; i++) {
    if (target.hp <= 0) break;
    const { damage, crit } = computeDamage(user, target, mv, effectiveness, rng);
    target.hp = Math.max(0, target.hp - damage);
    totalDamage += damage;
    events.push({ type: 'damage', side: targetSide, name: target.name, amount: damage, hp: target.hp, maxHp: target.maxHp, effectiveness, crit });
  }
  user.helpingHand = false;

  if (mv.drain > 0 && totalDamage > 0) heal(user, side, Math.max(1, Math.floor((totalDamage * mv.drain) / 100)), events);
  if (mv.drain < 0 && totalDamage > 0) {
    const recoil = Math.max(1, Math.floor((totalDamage * -mv.drain) / 100));
    user.hp = Math.max(0, user.hp - recoil);
    events.push({ type: 'damage', side, name: user.name, amount: recoil, hp: user.hp, maxHp: user.maxHp, effectiveness: 1, crit: false });
  }
  if (mv.slug === STRUGGLE) {
    const recoil = Math.max(1, Math.floor(user.maxHp / 4));
    user.hp = Math.max(0, user.hp - recoil);
    events.push({ type: 'damage', side, name: user.name, amount: recoil, hp: user.hp, maxHp: user.maxHp, effectiveness: 1, crit: false });
  }
  if (target.hp <= 0) return;

  const secondaryChance = mv.effectChance ?? 100;
  const ailmentStatus = AILMENT_TO_STATUS[mv.ailment];
  if (ailmentStatus && rng.chance(mv.ailmentChance || secondaryChance)) applyStatus(target, targetSide, ailmentStatus, mv, rng, events);
  if (mv.statChanges.length && rng.chance(mv.statChance || secondaryChance)) {
    const statTarget = selfTarget || mv.statChanges.every((c) => c.change > 0) ? side : targetSide;
    applyStatChanges(state, statTarget, mv.statChanges, events);
  }
  if (mv.flinchChance && rng.chance(mv.flinchChance)) target.flinched = true;
}

function executeStatusMove(state: BattleState, side: Side, mv: MoveData, rng: Rng, events: BattleEvent[]): void {
  const user = activePokemon(state, side);
  const targetSide = other(side);
  const target = activePokemon(state, targetSide);
  const selfTarget = SELF_TARGETS.has(mv.target);

  switch (mv.slug) {
    case 'helping-hand':
      user.helpingHand = true;
      return;
    case 'refresh':
      if (['brn', 'par', 'psn', 'tox'].includes(user.status)) {
        user.status = 'none';
        events.push({ type: 'cure', side, name: user.name });
      } else events.push({ type: 'fail', side, name: user.name });
      return;
    case 'rest':
      if (user.hp === user.maxHp) {
        events.push({ type: 'fail', side, name: user.name });
        return;
      }
      heal(user, side, user.maxHp - user.hp, events);
      user.status = 'slp';
      user.sleepTurns = 2;
      events.push({ type: 'status', side, name: user.name, status: 'slp' });
      return;
    case 'aromatherapy':
    case 'heal-bell':
      for (const p of state.sides[side].team) if (p.hp > 0) p.status = 'none';
      events.push({ type: 'cure', side, name: user.name });
      return;
  }

  let didSomething = false;
  if (mv.healing > 0) {
    const amount = Math.max(1, Math.floor((user.maxHp * mv.healing) / 100));
    if (user.hp < user.maxHp) {
      heal(user, side, amount, events);
      didSomething = true;
    }
  }
  const ailmentStatus = AILMENT_TO_STATUS[mv.ailment];
  if (ailmentStatus) {
    didSomething = applyStatus(target, targetSide, mv.slug === 'toxic' ? 'tox' : ailmentStatus, mv, rng, events) || didSomething;
  }
  if (mv.statChanges.length) {
    const statTarget = selfTarget ? side : targetSide;
    didSomething = applyStatChanges(state, statTarget, mv.statChanges, events) || didSomething;
  }
  if (!didSomething) events.push({ type: 'fail', side, name: user.name });
}

function applyStatus(target: BattlePokemon, side: Side, status: Status, mv: MoveData, rng: Rng, events: BattleEvent[]): boolean {
  if (target.status !== 'none') return false;
  if (STATUS_IMMUNITY[status].some((t) => target.types.includes(t))) return false;
  if (status === 'frz' && mv.type === 'fire') return false;
  target.status = status;
  if (status === 'slp') target.sleepTurns = rng.int(1, 3);
  if (status === 'tox') target.toxicCounter = 0;
  events.push({ type: 'status', side, name: target.name, status });
  return true;
}

function applyStatChanges(state: BattleState, side: Side, changes: { stat: string; change: number }[], events: BattleEvent[]): boolean {
  const p = activePokemon(state, side);
  let changed = false;
  for (const c of changes) {
    if (!isStageKey(c.stat)) continue;
    const before = p.stages[c.stat];
    p.stages[c.stat] = Math.max(-6, Math.min(6, before + c.change));
    const delta = p.stages[c.stat] - before;
    events.push({ type: 'stat', side, name: p.name, stat: c.stat as StageKey, change: delta });
    if (delta !== 0) changed = true;
  }
  return changed;
}

function heal(p: BattlePokemon, side: Side, amount: number, events: BattleEvent[]): void {
  const actual = Math.min(amount, p.maxHp - p.hp);
  if (actual <= 0) return;
  p.hp += actual;
  events.push({ type: 'heal', side, name: p.name, amount: actual, hp: p.hp, maxHp: p.maxHp });
}

function multiHitCount(min: number, max: number, rng: Rng): number {
  if (min === max) return min;
  const roll = rng.next();
  if (roll < 0.35) return 2;
  if (roll < 0.7) return 3;
  if (roll < 0.85) return 4;
  return 5;
}

export function computeDamage(
  user: BattlePokemon,
  target: BattlePokemon,
  mv: MoveData,
  effectiveness: number,
  rng: Rng,
): { damage: number; crit: boolean } {
  const power = mv.power ?? (mv.slug === STRUGGLE ? 50 : 0);
  if (power <= 0) return { damage: 0, crit: false };
  const physical = mv.category === 'physical';
  const critStage = Math.min(mv.critRate, CRIT_CHANCE.length - 1);
  const crit = rng.next() < CRIT_CHANCE[critStage];
  const atkStage = crit ? Math.max(0, user.stages[physical ? 'atk' : 'spa']) : user.stages[physical ? 'atk' : 'spa'];
  const defStage = crit ? Math.min(0, target.stages[physical ? 'def' : 'spd']) : target.stages[physical ? 'def' : 'spd'];
  let attack = Math.floor(user.stats[physical ? 'atk' : 'spa'] * stageMultiplier(atkStage));
  const defense = Math.max(1, Math.floor(target.stats[physical ? 'def' : 'spd'] * stageMultiplier(defStage)));
  if (physical && user.status === 'brn') attack = Math.floor(attack / 2);

  let damage = Math.floor(Math.floor((Math.floor((2 * user.level) / 5 + 2) * power * attack) / defense) / 50) + 2;
  if (user.helpingHand) damage = Math.floor(damage * 1.5);
  if (crit) damage = Math.floor(damage * 1.5);
  damage = Math.floor((damage * rng.int(85, 100)) / 100);
  if (user.types.includes(mv.type)) damage = Math.floor(damage * 1.5);
  damage = Math.floor(damage * effectiveness);
  return { damage: Math.max(1, damage), crit };
}

function checkFaint(state: BattleState, side: Side, events: BattleEvent[]): void {
  const p = activePokemon(state, side);
  if (p.hp <= 0 && !events.some((e) => e.type === 'faint' && e.side === side && e.name === p.name)) {
    p.status = 'none';
    events.push({ type: 'faint', side, name: p.name });
  }
}

function checkWinner(state: BattleState, events: BattleEvent[]): boolean {
  const aAlive = hasRemaining(state, 'a');
  const bAlive = hasRemaining(state, 'b');
  if (aAlive && bAlive) return false;
  state.phase = 'finished';
  state.winner = aAlive ? 'a' : 'b';
  events.push({ type: 'end', winner: state.winner });
  return true;
}

function endOfTurn(state: BattleState, _rng: Rng, events: BattleEvent[]): void {
  for (const side of ['a', 'b'] as Side[]) {
    const p = activePokemon(state, side);
    if (p.hp <= 0) continue;
    let residual = 0;
    if (p.status === 'brn') residual = Math.max(1, Math.floor(p.maxHp / 16));
    if (p.status === 'psn') residual = Math.max(1, Math.floor(p.maxHp / 8));
    if (p.status === 'tox') {
      p.toxicCounter = Math.min(15, p.toxicCounter + 1);
      residual = Math.max(1, Math.floor((p.maxHp * p.toxicCounter) / 16));
    }
    if (residual > 0) {
      p.hp = Math.max(0, p.hp - residual);
      events.push({ type: 'statusEffect', side, name: p.name, status: p.status, text: 'residual' });
      events.push({ type: 'damage', side, name: p.name, amount: residual, hp: p.hp, maxHp: p.maxHp, effectiveness: 1, crit: false });
      checkFaint(state, side, events);
    }
  }
}

export function replay(teamA: TeamSnapshot, teamB: TeamSnapshot, seed: number, turns: Partial<Record<Side, Action>>[]): { state: BattleState; events: BattleEvent[][] } {
  let state = createBattle(teamA, teamB, seed);
  const events: BattleEvent[][] = [];
  for (const actions of turns) {
    const r = applyActions(state, actions);
    state = r.state;
    events.push(r.events);
  }
  return { state, events };
}
