import { defaultAbility, move as moveData, species, typeEffectiveness, type MoveData } from './data';
import { defaultMoves } from './learnsets';
import { Rng, seedRng } from './rng';
import { accuracyMultiplier, computeStats, isStageKey, stageMultiplier } from './stats';
import type {
  Action,
  BattleEvent,
  BattleOptions,
  BattlePokemon,
  BattleState,
  PokemonSnapshot,
  Side,
  StageKey,
  Status,
  TeamSnapshot,
  Terrain,
  Weather,
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
const ABILITY_STATUS_IMMUNITY: Record<string, Status[]> = {
  limber: ['par'],
  insomnia: ['slp'],
  'vital-spirit': ['slp'],
  immunity: ['psn', 'tox'],
  'water-veil': ['brn'],
  'magma-armor': ['frz'],
  comatose: ['par', 'slp', 'brn', 'psn', 'tox', 'frz'],
  'purifying-salt': ['par', 'slp', 'brn', 'psn', 'tox', 'frz'],
};
const SELF_TARGETS = new Set(['user', 'users-field', 'ally', 'user-or-ally', 'user-and-allies', 'entire-field']);
const PROTECT_MOVES = new Set(['protect', 'detect', 'spiky-shield', 'baneful-bunker', 'kings-shield', 'obstruct', 'silk-trap', 'burning-bulwark']);
const INVULNERABLE_MOVES = new Set(['fly', 'dig', 'dive', 'bounce', 'phantom-force', 'shadow-force']);
const CHARGE_MOVES = new Set(['solar-beam', 'solar-blade', 'sky-attack', 'razor-wind', 'skull-bash', 'freeze-shock', 'ice-burn', 'meteor-beam', 'electro-shot']);
const SELF_KO_MOVES = new Set(['explosion', 'self-destruct', 'misty-explosion']);
const FORCE_SWITCH_TARGET = new Set(['whirlwind', 'roar', 'dragon-tail', 'circle-throw']);
const SELF_SWITCH_MOVES = new Set(['u-turn', 'volt-switch', 'flip-turn', 'parting-shot', 'teleport']);
const WEATHER_MOVES: Record<string, Weather> = { 'sunny-day': 'sun', 'rain-dance': 'rain', sandstorm: 'sand', hail: 'hail', snowscape: 'hail' };
const TERRAIN_MOVES: Record<string, Terrain> = { 'electric-terrain': 'electric', 'grassy-terrain': 'grassy', 'psychic-terrain': 'psychic', 'misty-terrain': 'misty' };
const WEATHER_ABILITIES: Record<string, Weather> = { drought: 'sun', drizzle: 'rain', 'sand-stream': 'sand', 'snow-warning': 'hail', 'orichalcum-pulse': 'sun' };
const TERRAIN_ABILITIES: Record<string, Terrain> = { 'electric-surge': 'electric', 'grassy-surge': 'grassy', 'psychic-surge': 'psychic', 'misty-surge': 'misty', 'hadron-engine': 'electric' };
const PINCH_ABILITIES: Record<string, string> = { blaze: 'fire', torrent: 'water', overgrow: 'grass', swarm: 'bug' };
const CONTACT_PUNISH: Record<string, Status | 'damage'> = { static: 'par', 'flame-body': 'brn', 'poison-point': 'psn', 'effect-spore': 'psn', 'rough-skin': 'damage', 'iron-barbs': 'damage' };
const NO_STAT_DROP = new Set(['clear-body', 'white-smoke', 'full-metal-body']);
const TYPE_IMMUNITY_ABILITIES: Record<string, { type: string; heal?: boolean }> = {
  levitate: { type: 'ground' },
  'flash-fire': { type: 'fire' },
  'water-absorb': { type: 'water', heal: true },
  'volt-absorb': { type: 'electric', heal: true },
  'dry-skin': { type: 'water', heal: true },
  'sap-sipper': { type: 'grass' },
  'motor-drive': { type: 'electric' },
  'lightning-rod': { type: 'electric' },
  'storm-drain': { type: 'water' },
  'earth-eater': { type: 'ground', heal: true },
  'well-baked-body': { type: 'fire' },
};

export function other(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

function buildPokemon(p: PokemonSnapshot): BattlePokemon {
  const sp = species(p.speciesId);
  const stats = computeStats(p);
  const moves = (p.moves.length ? p.moves : defaultMoves(p.speciesId, p.level)).slice(0, 4).map((slug) => {
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
    ability: p.ability && p.ability !== 'none' ? p.ability : defaultAbility(p.speciesId),
    helpingHand: false,
    flinched: false,
    protectedNow: false,
    protectStreak: 0,
    charging: null,
    damageTakenThisTurn: null,
    movedThisTurn: false,
    leechSeeded: false,
    cursed: false,
    yawnTurns: 0,
    turnsOnField: 0,
    aquaRing: false,
    truantLoaf: false,
  };
}

export function createBattle(teamA: TeamSnapshot, teamB: TeamSnapshot, seed: number, options: BattleOptions = {}): BattleState {
  if (!teamA.pokemon.length || !teamB.pokemon.length) throw new Error('Both teams need at least one Pokémon');
  const state: BattleState = {
    seed,
    rng: seedRng(seed),
    turn: 0,
    phase: 'choose',
    sides: {
      a: { team: teamA.pokemon.map(buildPokemon), active: 0 },
      b: { team: teamB.pokemon.map(buildPokemon), active: 0 },
    },
    winner: null,
    field: { weather: options.weather ?? 'none', weatherTurns: 0, terrain: options.terrain ?? 'none', terrainTurns: 0 },
  };
  const rng = new Rng(state.rng);
  const events: BattleEvent[] = [];
  const order = effectiveSpeed(state, 'a') >= effectiveSpeed(state, 'b') ? (['a', 'b'] as Side[]) : (['b', 'a'] as Side[]);
  for (const side of order) onEntry(state, side, rng, events);
  state.rng = rng.state;
  return state;
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
  if (active.charging) return [{ type: 'move', moveIndex: active.charging.moveIndex }];
  const withPp = active.moves.map((m, i) => ({ m, i })).filter(({ m }) => m.pp > 0);
  const moves: Action[] = withPp.length ? withPp.map(({ i }) => ({ type: 'move', moveIndex: i })) : [{ type: 'move', moveIndex: -1 }];
  const switches: Action[] = s.team
    .map((p, slot) => ({ p, slot }))
    .filter(({ p, slot }) => p.hp > 0 && slot !== s.active)
    .map(({ slot }) => ({ type: 'switch', slot }));
  return [...moves, ...switches];
}

function isGrounded(p: BattlePokemon): boolean {
  return !p.types.includes('flying') && p.ability !== 'levitate' && !(p.charging?.invulnerable && (p.charging.slug === 'fly' || p.charging.slug === 'bounce'));
}

function effectiveSpeed(state: BattleState, side: Side): number {
  const p = activePokemon(state, side);
  let spe = Math.floor(p.stats.spe * stageMultiplier(p.stages.spe));
  const w = state.field.weather;
  if ((p.ability === 'chlorophyll' && w === 'sun') || (p.ability === 'swift-swim' && w === 'rain') || (p.ability === 'sand-rush' && w === 'sand') || (p.ability === 'slush-rush' && w === 'hail')) spe *= 2;
  if (p.ability === 'surge-surfer' && state.field.terrain === 'electric') spe *= 2;
  if (p.ability === 'slow-start' && p.turnsOnField < 5) spe = Math.floor(spe / 2);
  if (p.ability === 'quick-feet' && p.status !== 'none') spe = Math.floor(spe * 1.5);
  else if (p.status === 'par') spe = Math.floor(spe / 2);
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
      performSwitch(next, side, action.slot, rng, events);
    }
    next.phase = 'choose';
    next.rng = rng.state;
    return { state: next, events };
  }

  events.push({ type: 'turn', turn: next.turn });
  for (const side of ['a', 'b'] as Side[]) {
    const p = activePokemon(next, side);
    p.protectedNow = false;
    p.damageTakenThisTurn = null;
    p.movedThisTurn = false;
  }
  const order = turnOrder(next, actions as Record<Side, Action>, rng);
  for (const side of order) {
    const action = actions[side]!;
    if (action.type === 'switch') performSwitch(next, side, action.slot, rng, events);
  }
  for (const side of order) {
    if (next.phase === 'finished') break;
    const action = actions[side]!;
    if (action.type !== 'move') continue;
    const user = activePokemon(next, side);
    const target = activePokemon(next, other(side));
    if (user.hp <= 0 || target.hp <= 0) continue;
    executeMove(next, side, chosenMove(user, action), action, actions[other(side)]!, rng, events);
    user.movedThisTurn = true;
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

function movePriority(state: BattleState, side: Side, action: Action): number {
  if (action.type === 'switch') return 10;
  const p = activePokemon(state, side);
  const m = chosenMove(p, action);
  let priority = m.priority;
  if (p.ability === 'prankster' && m.category === 'status') priority += 1;
  if (p.ability === 'gale-wings' && m.type === 'flying' && p.hp === p.maxHp) priority += 1;
  if (p.ability === 'triage' && m.healing > 0) priority += 3;
  return priority;
}

function turnOrder(state: BattleState, actions: Record<Side, Action>, rng: Rng): Side[] {
  const sides: Side[] = ['a', 'b'];
  const info = sides.map((side) => ({ side, priority: movePriority(state, side, actions[side]), speed: effectiveSpeed(state, side), tie: rng.next() }));
  info.sort((x, y) => y.priority - x.priority || y.speed - x.speed || y.tie - x.tie);
  return info.map((i) => i.side);
}

function resetVolatile(p: BattlePokemon): void {
  p.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
  p.helpingHand = false;
  p.flinched = false;
  p.protectedNow = false;
  p.protectStreak = 0;
  p.charging = null;
  p.damageTakenThisTurn = null;
  p.leechSeeded = false;
  p.cursed = false;
  p.yawnTurns = 0;
  p.turnsOnField = 0;
  p.aquaRing = false;
  p.truantLoaf = false;
}

function performSwitch(state: BattleState, side: Side, slot: number, rng: Rng, events: BattleEvent[]): void {
  const s = state.sides[side];
  const leaving = s.team[s.active];
  const target = s.team[slot];
  if (!target || target.hp <= 0 || slot === s.active) throw new Error(`Illegal switch to slot ${slot}`);
  if (leaving.hp > 0) {
    if (leaving.ability === 'natural-cure' && leaving.status !== 'none') {
      leaving.status = 'none';
      events.push({ type: 'ability', side, name: leaving.name, ability: 'natural-cure', text: 'cure' });
    }
    if (leaving.ability === 'regenerator' && leaving.hp < leaving.maxHp) heal(leaving, side, Math.floor(leaving.maxHp / 3), events);
  }
  resetVolatile(leaving);
  s.active = slot;
  resetVolatile(target);
  events.push({ type: 'switch', side, slot, name: target.name });
  onEntry(state, side, rng, events);
}

function onEntry(state: BattleState, side: Side, rng: Rng, events: BattleEvent[]): void {
  const p = activePokemon(state, side);
  const foe = activePokemon(state, other(side));
  const weather = WEATHER_ABILITIES[p.ability];
  if (weather && state.field.weather !== weather) {
    state.field.weather = weather;
    state.field.weatherTurns = 5;
    events.push({ type: 'ability', side, name: p.name, ability: p.ability, text: 'weather' });
    events.push({ type: 'weather', weather, text: 'start' });
  }
  const terrain = TERRAIN_ABILITIES[p.ability];
  if (terrain && state.field.terrain !== terrain) {
    state.field.terrain = terrain;
    state.field.terrainTurns = 5;
    events.push({ type: 'ability', side, name: p.name, ability: p.ability, text: 'terrain' });
    events.push({ type: 'terrain', terrain, text: 'start' });
  }
  if (p.ability === 'intimidate' && foe.hp > 0) {
    events.push({ type: 'ability', side, name: p.name, ability: 'intimidate', text: 'intimidate' });
    applyStatChanges(state, other(side), [{ stat: 'atk', change: -1 }], events, true);
  }
  void rng;
}

function canAct(state: BattleState, side: Side, rng: Rng, events: BattleEvent[]): boolean {
  const p = activePokemon(state, side);
  if (p.ability === 'truant') {
    p.truantLoaf = !p.truantLoaf;
    if (!p.truantLoaf) {
      events.push({ type: 'ability', side, name: p.name, ability: 'truant', text: 'loaf' });
      return false;
    }
  }
  if (p.flinched) {
    p.flinched = false;
    if (p.ability === 'inner-focus') return true;
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

function effectiveAccuracy(state: BattleState, user: BattlePokemon, target: BattlePokemon, mv: MoveData): number | null {
  if (mv.accuracy === null || user.ability === 'no-guard' || target.ability === 'no-guard') return null;
  const w = state.field.weather;
  if ((mv.slug === 'thunder' || mv.slug === 'hurricane') && w === 'rain') return null;
  if (mv.slug === 'blizzard' && w === 'hail') return null;
  let acc = mv.accuracy;
  if ((mv.slug === 'thunder' || mv.slug === 'hurricane') && w === 'sun') acc = 50;
  if (user.ability === 'compound-eyes') acc *= 1.3;
  if (user.ability === 'hustle' && mv.category === 'physical') acc *= 0.8;
  const accStage = user.ability === 'keen-eye' ? Math.max(0, user.stages.acc) : user.stages.acc;
  const evaStage = user.ability === 'keen-eye' ? Math.min(0, target.stages.eva) : target.stages.eva;
  let chance = acc * accuracyMultiplier(accStage - evaStage);
  if ((target.ability === 'sand-veil' && w === 'sand') || (target.ability === 'snow-cloak' && w === 'hail')) chance *= 0.8;
  return chance;
}

function executeMove(state: BattleState, side: Side, mv: MoveData, action: Action, foeAction: Action, rng: Rng, events: BattleEvent[]): void {
  const user = activePokemon(state, side);
  const targetSide = other(side);
  const target = activePokemon(state, targetSide);
  if (!canAct(state, side, rng, events)) {
    user.charging = null;
    return;
  }

  const continuing = user.charging !== null && user.charging.slug === mv.slug;
  if (!continuing && action.type === 'move') {
    const slot = user.moves[action.moveIndex];
    if (slot && slot.pp > 0) slot.pp -= 1;
  }

  if (!continuing && (INVULNERABLE_MOVES.has(mv.slug) || CHARGE_MOVES.has(mv.slug))) {
    const instant = (mv.slug === 'solar-beam' || mv.slug === 'solar-blade') && state.field.weather === 'sun';
    if (!instant) {
      user.charging = { moveIndex: action.type === 'move' ? action.moveIndex : 0, slug: mv.slug, invulnerable: INVULNERABLE_MOVES.has(mv.slug) };
      events.push({ type: 'charge', side, name: user.name, move: mv.name });
      if (mv.slug === 'skull-bash') applyStatChanges(state, side, [{ stat: 'def', change: 1 }], events);
      if (mv.slug === 'meteor-beam' || mv.slug === 'electro-shot') applyStatChanges(state, side, [{ stat: 'spa', change: 1 }], events);
      return;
    }
  }
  user.charging = null;

  events.push({ type: 'move', side, name: user.name, move: mv.name, slug: mv.slug, moveType: mv.type, category: mv.category });

  if (PROTECT_MOVES.has(mv.slug)) {
    if (user.protectStreak > 0 && !rng.chance(100 / Math.pow(3, user.protectStreak))) {
      user.protectStreak = 0;
      events.push({ type: 'fail', side, name: user.name });
      return;
    }
    user.protectedNow = true;
    user.protectStreak += 1;
    events.push({ type: 'protect', side, name: user.name });
    return;
  }
  user.protectStreak = 0;

  const selfTarget = SELF_TARGETS.has(mv.target) || mv.target === 'entire-field';
  if (!selfTarget) {
    if (target.protectedNow) {
      events.push({ type: 'protect', side: targetSide, name: target.name });
      return;
    }
    if (target.charging?.invulnerable) {
      events.push({ type: 'miss', side, name: user.name });
      return;
    }
    if (mv.slug === 'sucker-punch' && (foeAction.type !== 'move' || chosenMove(target, foeAction).category === 'status' || target.movedThisTurn)) {
      events.push({ type: 'fail', side, name: user.name });
      return;
    }
    if (mv.slug === 'fake-out' && user.turnsOnField > 0) {
      events.push({ type: 'fail', side, name: user.name });
      return;
    }
    if (mv.slug === 'focus-punch' && user.damageTakenThisTurn) {
      events.push({ type: 'fail', side, name: user.name });
      return;
    }
    if (mv.priority > 0 && state.field.terrain === 'psychic' && isGrounded(target)) {
      events.push({ type: 'fail', side, name: user.name });
      return;
    }
    const chance = effectiveAccuracy(state, user, target, mv);
    if (chance !== null && !rng.chance(chance)) {
      events.push({ type: 'miss', side, name: user.name });
      return;
    }
  }

  if (mv.category === 'status') {
    executeStatusMove(state, side, mv, rng, events);
    return;
  }

  const immunity = TYPE_IMMUNITY_ABILITIES[target.ability];
  if (immunity && immunity.type === mv.type) {
    events.push({ type: 'ability', side: targetSide, name: target.name, ability: target.ability, text: 'immune' });
    if (immunity.heal) heal(target, targetSide, Math.floor(target.maxHp / 4), events);
    if (target.ability === 'motor-drive') applyStatChanges(state, targetSide, [{ stat: 'spe', change: 1 }], events);
    if (target.ability === 'lightning-rod' || target.ability === 'storm-drain') applyStatChanges(state, targetSide, [{ stat: 'spa', change: 1 }], events);
    if (target.ability === 'sap-sipper') applyStatChanges(state, targetSide, [{ stat: 'atk', change: 1 }], events);
    return;
  }
  let effectiveness = typeEffectiveness(mv.type, target.types);
  if (user.ability === 'scrappy' && target.types.includes('ghost') && (mv.type === 'normal' || mv.type === 'fighting')) effectiveness = typeEffectiveness(mv.type, target.types.filter((t) => t !== 'ghost'));
  if (mv.type === 'ground' && target.ability === 'levitate') effectiveness = 0;
  if (effectiveness === 0 || (target.ability === 'wonder-guard' && effectiveness <= 1)) {
    events.push({ type: 'damage', side: targetSide, name: target.name, amount: 0, hp: target.hp, maxHp: target.maxHp, effectiveness: 0, crit: false });
    return;
  }

  const fixed = fixedDamage(state, side, mv, user, target);
  if (fixed === -1) {
    events.push({ type: 'fail', side, name: user.name });
    return;
  }

  const hits = mv.minHits && mv.maxHits ? multiHitCount(mv.minHits, mv.maxHits, rng, user) : 1;
  let totalDamage = 0;
  let lastCrit = false;
  for (let i = 0; i < hits; i++) {
    if (target.hp <= 0) break;
    let damage: number;
    let crit = false;
    if (fixed !== null) damage = fixed;
    else {
      const r = computeDamage(state, user, target, mv, effectiveness, rng);
      damage = r.damage;
      crit = r.crit;
    }
    if (target.ability === 'sturdy' && target.hp === target.maxHp && damage >= target.hp) {
      damage = target.hp - 1;
      events.push({ type: 'ability', side: targetSide, name: target.name, ability: 'sturdy', text: 'endure' });
    }
    const dealt = Math.min(damage, target.hp);
    target.hp -= dealt;
    totalDamage += dealt;
    lastCrit = crit;
    target.damageTakenThisTurn = { amount: (target.damageTakenThisTurn?.amount ?? 0) + dealt, category: mv.category === 'special' ? 'special' : 'physical' };
    events.push({ type: 'damage', side: targetSide, name: target.name, amount: dealt, hp: target.hp, maxHp: target.maxHp, effectiveness, crit });
  }
  void lastCrit;
  user.helpingHand = false;

  if (mv.category === 'physical' && totalDamage > 0) {
    const punish = CONTACT_PUNISH[target.ability];
    if (punish === 'damage' && user.ability !== 'magic-guard') {
      const dmg = Math.max(1, Math.floor(user.maxHp / 8));
      user.hp = Math.max(0, user.hp - dmg);
      events.push({ type: 'ability', side: targetSide, name: target.name, ability: target.ability, text: 'contact' });
      events.push({ type: 'damage', side, name: user.name, amount: dmg, hp: user.hp, maxHp: user.maxHp, effectiveness: 1, crit: false });
    } else if (punish && punish !== 'damage' && rng.chance(30)) {
      events.push({ type: 'ability', side: targetSide, name: target.name, ability: target.ability, text: 'contact' });
      applyStatus(user, side, punish, mv, rng, events);
    }
  }

  if (mv.drain > 0 && totalDamage > 0) heal(user, side, Math.max(1, Math.floor((totalDamage * mv.drain) / 100)), events);
  if (mv.drain < 0 && totalDamage > 0 && user.ability !== 'rock-head' && user.ability !== 'magic-guard') {
    const recoil = Math.max(1, Math.floor((totalDamage * -mv.drain) / 100));
    user.hp = Math.max(0, user.hp - recoil);
    events.push({ type: 'damage', side, name: user.name, amount: recoil, hp: user.hp, maxHp: user.maxHp, effectiveness: 1, crit: false });
  }
  if (mv.slug === STRUGGLE) {
    const recoil = Math.max(1, Math.floor(user.maxHp / 4));
    user.hp = Math.max(0, user.hp - recoil);
    events.push({ type: 'damage', side, name: user.name, amount: recoil, hp: user.hp, maxHp: user.maxHp, effectiveness: 1, crit: false });
  }
  if (SELF_KO_MOVES.has(mv.slug) || mv.slug === 'final-gambit') {
    user.hp = 0;
    events.push({ type: 'damage', side, name: user.name, amount: user.maxHp, hp: 0, maxHp: user.maxHp, effectiveness: 1, crit: false });
  }
  if (mv.slug === 'wake-up-slap' && target.status === 'slp') {
    target.status = 'none';
    events.push({ type: 'cure', side: targetSide, name: target.name });
  }
  if (mv.slug === 'smelling-salts' && target.status === 'par') {
    target.status = 'none';
    events.push({ type: 'cure', side: targetSide, name: target.name });
  }
  if (target.hp <= 0) {
    if (user.ability === 'moxie' || user.ability === 'chilling-neigh' || user.ability === 'as-one-glastrier') applyStatChanges(state, side, [{ stat: 'atk', change: 1 }], events);
    if (user.ability === 'grim-neigh' || user.ability === 'soul-heart') applyStatChanges(state, side, [{ stat: 'spa', change: 1 }], events);
    if (user.ability === 'beast-boost') applyStatChanges(state, side, [{ stat: 'atk', change: 1 }], events);
    return;
  }

  if (user.ability !== 'sheer-force' && target.ability !== 'shield-dust') {
    let secondaryChance = mv.effectChance ?? 100;
    if (user.ability === 'serene-grace') secondaryChance *= 2;
    const ailmentStatus = AILMENT_TO_STATUS[mv.ailment];
    if (ailmentStatus && rng.chance(Math.min(100, (mv.ailmentChance || secondaryChance) * (user.ability === 'serene-grace' && mv.ailmentChance ? 2 : 1)))) applyStatus(target, targetSide, ailmentStatus, mv, rng, events);
    if (mv.statChanges.length && rng.chance(Math.min(100, (mv.statChance || secondaryChance) * (user.ability === 'serene-grace' && mv.statChance ? 2 : 1)))) {
      const statTarget = selfTarget || mv.statChanges.every((c) => c.change > 0) ? side : targetSide;
      applyStatChanges(state, statTarget, mv.statChanges, events);
    }
    if (mv.flinchChance && rng.chance(Math.min(100, mv.flinchChance * (user.ability === 'serene-grace' ? 2 : 1)))) target.flinched = true;
  }
  if (mv.slug === 'knock-off' || mv.slug === 'thief') void 0;

  if (FORCE_SWITCH_TARGET.has(mv.slug)) forceSwitch(state, targetSide, rng, events);
  if (SELF_SWITCH_MOVES.has(mv.slug)) forceSwitch(state, side, rng, events);
}

function fixedDamage(state: BattleState, side: Side, mv: MoveData, user: BattlePokemon, target: BattlePokemon): number | null {
  switch (mv.slug) {
    case 'night-shade':
    case 'seismic-toss':
      return user.level;
    case 'super-fang':
    case 'natures-madness':
    case 'ruination':
      return Math.max(1, Math.floor(target.hp / 2));
    case 'dragon-rage':
      return 40;
    case 'sonic-boom':
      return 20;
    case 'final-gambit':
      return user.hp;
    case 'endeavor':
      return target.hp > user.hp ? target.hp - user.hp : -1;
    case 'counter':
      return user.damageTakenThisTurn?.category === 'physical' ? user.damageTakenThisTurn.amount * 2 : -1;
    case 'mirror-coat':
      return user.damageTakenThisTurn?.category === 'special' ? user.damageTakenThisTurn.amount * 2 : -1;
    case 'metal-burst':
    case 'comeuppance':
      return user.damageTakenThisTurn ? Math.floor(user.damageTakenThisTurn.amount * 1.5) : -1;
    default:
      void state;
      void side;
      return null;
  }
}

function forceSwitch(state: BattleState, side: Side, rng: Rng, events: BattleEvent[]): void {
  const s = state.sides[side];
  if (s.team[s.active].hp <= 0) return;
  const options = s.team.map((p, slot) => ({ p, slot })).filter(({ p, slot }) => p.hp > 0 && slot !== s.active);
  if (!options.length) return;
  const pick = options[rng.int(0, options.length - 1)];
  performSwitch(state, side, pick.slot, rng, events);
}

function executeStatusMove(state: BattleState, side: Side, mv: MoveData, rng: Rng, events: BattleEvent[]): void {
  const user = activePokemon(state, side);
  const targetSide = other(side);
  const target = activePokemon(state, targetSide);
  const selfTarget = SELF_TARGETS.has(mv.target);

  const weather = WEATHER_MOVES[mv.slug];
  if (weather) {
    if (state.field.weather === weather) {
      events.push({ type: 'fail', side, name: user.name });
      return;
    }
    state.field.weather = weather;
    state.field.weatherTurns = 5;
    events.push({ type: 'weather', weather, text: 'start' });
    return;
  }
  const terrain = TERRAIN_MOVES[mv.slug];
  if (terrain) {
    if (state.field.terrain === terrain) {
      events.push({ type: 'fail', side, name: user.name });
      return;
    }
    state.field.terrain = terrain;
    state.field.terrainTurns = 5;
    events.push({ type: 'terrain', terrain, text: 'start' });
    return;
  }

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
      if (user.hp === user.maxHp || user.ability === 'insomnia' || user.ability === 'vital-spirit') {
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
    case 'leech-seed':
      if (target.leechSeeded || target.types.includes('grass')) {
        events.push({ type: 'fail', side, name: user.name });
        return;
      }
      target.leechSeeded = true;
      events.push({ type: 'status', side: targetSide, name: target.name, status: 'none' });
      return;
    case 'yawn':
      if (target.status !== 'none' || target.yawnTurns > 0 || !canBeStatused(state, target, 'slp')) {
        events.push({ type: 'fail', side, name: user.name });
        return;
      }
      target.yawnTurns = 2;
      events.push({ type: 'text' as never, side, name: user.name } as never);
      events.pop();
      events.push({ type: 'stat', side: targetSide, name: target.name, stat: 'acc', change: 0 });
      events.pop();
      return;
    case 'belly-drum':
      if (user.hp <= Math.floor(user.maxHp / 2) || user.stages.atk >= 6) {
        events.push({ type: 'fail', side, name: user.name });
        return;
      }
      user.hp -= Math.floor(user.maxHp / 2);
      events.push({ type: 'damage', side, name: user.name, amount: Math.floor(user.maxHp / 2), hp: user.hp, maxHp: user.maxHp, effectiveness: 1, crit: false });
      applyStatChanges(state, side, [{ stat: 'atk', change: 12 }], events);
      return;
    case 'curse':
      if (user.types.includes('ghost')) {
        if (target.cursed) {
          events.push({ type: 'fail', side, name: user.name });
          return;
        }
        const cost = Math.floor(user.maxHp / 2);
        user.hp = Math.max(0, user.hp - cost);
        events.push({ type: 'damage', side, name: user.name, amount: cost, hp: user.hp, maxHp: user.maxHp, effectiveness: 1, crit: false });
        target.cursed = true;
        events.push({ type: 'status', side: targetSide, name: target.name, status: 'none' });
        return;
      }
      applyStatChanges(state, side, [{ stat: 'atk', change: 1 }, { stat: 'def', change: 1 }, { stat: 'spe', change: -1 }], events);
      return;
    case 'haze':
      for (const s of ['a', 'b'] as Side[]) activePokemon(state, s).stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
      events.push({ type: 'cure', side, name: user.name });
      return;
    case 'aqua-ring':
    case 'ingrain':
      if (user.aquaRing) {
        events.push({ type: 'fail', side, name: user.name });
        return;
      }
      user.aquaRing = true;
      events.push({ type: 'heal', side, name: user.name, amount: 0, hp: user.hp, maxHp: user.maxHp });
      return;
    case 'pain-split': {
      const avg = Math.floor((user.hp + target.hp) / 2);
      const gain = avg - user.hp;
      user.hp = avg;
      target.hp = Math.max(1, avg);
      if (gain >= 0) events.push({ type: 'heal', side, name: user.name, amount: gain, hp: user.hp, maxHp: user.maxHp });
      else events.push({ type: 'damage', side, name: user.name, amount: -gain, hp: user.hp, maxHp: user.maxHp, effectiveness: 1, crit: false });
      events.push({ type: 'damage', side: targetSide, name: target.name, amount: 0, hp: target.hp, maxHp: target.maxHp, effectiveness: 1, crit: false });
      return;
    }
    case 'whirlwind':
    case 'roar':
      forceSwitch(state, targetSide, rng, events);
      return;
    case 'parting-shot':
      applyStatChanges(state, targetSide, [{ stat: 'atk', change: -1 }, { stat: 'spa', change: -1 }], events);
      forceSwitch(state, side, rng, events);
      return;
    case 'teleport':
      forceSwitch(state, side, rng, events);
      return;
  }

  let didSomething = false;
  if (mv.healing > 0) {
    let amount = Math.max(1, Math.floor((user.maxHp * mv.healing) / 100));
    if ((mv.slug === 'synthesis' || mv.slug === 'morning-sun' || mv.slug === 'moonlight') && state.field.weather === 'sun') amount = Math.floor((user.maxHp * 2) / 3);
    if (user.hp < user.maxHp) {
      heal(user, side, amount, events);
      didSomething = true;
    }
  }
  const ailmentStatus = AILMENT_TO_STATUS[mv.ailment];
  if (ailmentStatus) {
    didSomething = applyStatus(target, targetSide, mv.slug === 'toxic' ? 'tox' : ailmentStatus, mv, rng, events, state) || didSomething;
  }
  if (mv.statChanges.length) {
    const statTarget = selfTarget ? side : targetSide;
    didSomething = applyStatChanges(state, statTarget, mv.statChanges, events) || didSomething;
  }
  if (!didSomething) events.push({ type: 'fail', side, name: user.name });
}

function canBeStatused(state: BattleState, target: BattlePokemon, status: Status): boolean {
  if (target.status !== 'none') return false;
  if (STATUS_IMMUNITY[status].some((t) => target.types.includes(t))) return false;
  if ((ABILITY_STATUS_IMMUNITY[target.ability] ?? []).includes(status)) return false;
  if (target.ability === 'leaf-guard' && state.field.weather === 'sun') return false;
  if (status === 'slp' && state.field.terrain === 'electric' && isGrounded(target)) return false;
  if (state.field.terrain === 'misty' && isGrounded(target)) return false;
  return true;
}

function applyStatus(target: BattlePokemon, side: Side, status: Status, mv: MoveData, rng: Rng, events: BattleEvent[], state?: BattleState): boolean {
  if (target.status !== 'none') return false;
  if (STATUS_IMMUNITY[status].some((t) => target.types.includes(t))) return false;
  if ((ABILITY_STATUS_IMMUNITY[target.ability] ?? []).includes(status)) return false;
  if (state && !canBeStatused(state, target, status)) return false;
  if (status === 'frz' && mv.type === 'fire') return false;
  target.status = status;
  if (status === 'slp') target.sleepTurns = rng.int(1, 3);
  if (status === 'tox') target.toxicCounter = 0;
  events.push({ type: 'status', side, name: target.name, status });
  return true;
}

function applyStatChanges(state: BattleState, side: Side, changes: { stat: string; change: number }[], events: BattleEvent[], fromFoe = false): boolean {
  const p = activePokemon(state, side);
  let changed = false;
  for (const c of changes) {
    if (!isStageKey(c.stat)) continue;
    let delta = c.change;
    if (p.ability === 'contrary') delta = -delta;
    if (p.ability === 'simple') delta *= 2;
    if (delta < 0 && (NO_STAT_DROP.has(p.ability) || (p.ability === 'hyper-cutter' && c.stat === 'atk') || (p.ability === 'keen-eye' && c.stat === 'acc') || (p.ability === 'big-pecks' && c.stat === 'def'))) {
      events.push({ type: 'ability', side, name: p.name, ability: p.ability, text: 'no-drop' });
      continue;
    }
    if (delta < 0 && fromFoe && p.ability === 'defiant') applyStatChanges(state, side, [{ stat: 'atk', change: 2 }], events);
    if (delta < 0 && fromFoe && p.ability === 'competitive') applyStatChanges(state, side, [{ stat: 'spa', change: 2 }], events);
    const before = p.stages[c.stat];
    p.stages[c.stat] = Math.max(-6, Math.min(6, before + delta));
    const actual = p.stages[c.stat] - before;
    events.push({ type: 'stat', side, name: p.name, stat: c.stat as StageKey, change: actual });
    if (actual !== 0) changed = true;
  }
  return changed;
}

function heal(p: BattlePokemon, side: Side, amount: number, events: BattleEvent[]): void {
  const actual = Math.min(amount, p.maxHp - p.hp);
  if (actual <= 0) return;
  p.hp += actual;
  events.push({ type: 'heal', side, name: p.name, amount: actual, hp: p.hp, maxHp: p.maxHp });
}

function multiHitCount(min: number, max: number, rng: Rng, user: BattlePokemon): number {
  if (min === max) return min;
  if (user.ability === 'skill-link') return max;
  const roll = rng.next();
  if (roll < 0.35) return 2;
  if (roll < 0.7) return 3;
  if (roll < 0.85) return 4;
  return 5;
}

function movePower(state: BattleState, user: BattlePokemon, target: BattlePokemon, mv: MoveData): number {
  let power = mv.power ?? (mv.slug === STRUGGLE ? 50 : 0);
  if (power <= 0) return 0;
  switch (mv.slug) {
    case 'hex':
    case 'infernal-parade':
      if (target.status !== 'none') power *= 2;
      break;
    case 'venoshock':
    case 'barb-barrage':
      if (target.status === 'psn' || target.status === 'tox') power *= 2;
      break;
    case 'brine':
      if (target.hp <= target.maxHp / 2) power *= 2;
      break;
    case 'facade':
      if (user.status === 'brn' || user.status === 'psn' || user.status === 'tox' || user.status === 'par') power *= 2;
      break;
    case 'acrobatics':
      power *= 2;
      break;
    case 'wake-up-slap':
      if (target.status === 'slp') power *= 2;
      break;
    case 'smelling-salts':
      if (target.status === 'par') power *= 2;
      break;
    case 'solar-beam':
    case 'solar-blade':
      if (['rain', 'sand', 'hail'].includes(state.field.weather)) power = Math.floor(power / 2);
      break;
    case 'weather-ball':
      if (state.field.weather !== 'none') power *= 2;
      break;
    case 'rising-voltage':
      if (state.field.terrain === 'electric' && isGrounded(target)) power *= 2;
      break;
    case 'expanding-force':
      if (state.field.terrain === 'psychic' && isGrounded(user)) power = Math.floor(power * 1.5);
      break;
  }
  if (user.ability === 'technician' && power <= 60) power = Math.floor(power * 1.5);
  if (user.ability === 'reckless' && mv.drain < 0) power = Math.floor(power * 1.2);
  if (user.ability === 'iron-fist' && mv.slug.includes('punch')) power = Math.floor(power * 1.2);
  if (user.ability === 'strong-jaw' && ['bite', 'crunch', 'fire-fang', 'ice-fang', 'thunder-fang', 'poison-fang', 'psychic-fangs', 'hyper-fang', 'fishious-rend', 'jaw-lock'].includes(mv.slug)) power = Math.floor(power * 1.5);
  if (user.ability === 'sheer-force' && (mv.effectChance || mv.flinchChance || mv.statChance || mv.ailmentChance)) power = Math.floor(power * 1.3);
  const pinch = PINCH_ABILITIES[user.ability];
  if (pinch && mv.type === pinch && user.hp <= user.maxHp / 3) power = Math.floor(power * 1.5);
  if (user.ability === 'analytic' && target.movedThisTurn) power = Math.floor(power * 1.3);
  if (user.ability === 'tough-claws' && mv.category === 'physical') power = Math.floor(power * 1.3);
  if (user.ability === 'sand-force' && state.field.weather === 'sand' && ['rock', 'ground', 'steel'].includes(mv.type)) power = Math.floor(power * 1.3);
  return power;
}

export function computeDamage(
  state: BattleState,
  user: BattlePokemon,
  target: BattlePokemon,
  mv: MoveData,
  effectiveness: number,
  rng: Rng,
): { damage: number; crit: boolean } {
  const power = movePower(state, user, target, mv);
  if (power <= 0) return { damage: 0, crit: false };
  const physical = mv.category === 'physical';
  let critStage = Math.min(mv.critRate + (user.ability === 'super-luck' ? 1 : 0), CRIT_CHANCE.length - 1);
  if (target.ability === 'battle-armor' || target.ability === 'shell-armor') critStage = -1;
  const crit = critStage >= 0 && rng.next() < CRIT_CHANCE[critStage];
  const atkStage = crit ? Math.max(0, user.stages[physical ? 'atk' : 'spa']) : user.stages[physical ? 'atk' : 'spa'];
  const defStage = crit ? Math.min(0, target.stages[physical ? 'def' : 'spd']) : target.stages[physical ? 'def' : 'spd'];
  let attack = Math.floor(user.stats[physical ? 'atk' : 'spa'] * stageMultiplier(atkStage));
  let defense = Math.max(1, Math.floor(target.stats[physical ? 'def' : 'spd'] * stageMultiplier(defStage)));

  if (physical) {
    if (user.ability === 'huge-power' || user.ability === 'pure-power') attack *= 2;
    if (user.ability === 'hustle') attack = Math.floor(attack * 1.5);
    if (user.ability === 'guts' && user.status !== 'none') attack = Math.floor(attack * 1.5);
    else if (user.status === 'brn') attack = Math.floor(attack / 2);
    if (user.ability === 'slow-start' && user.turnsOnField < 5) attack = Math.floor(attack / 2);
    if (user.ability === 'defeatist' && user.hp <= user.maxHp / 2) attack = Math.floor(attack / 2);
    if (target.ability === 'marvel-scale' && target.status !== 'none') defense = Math.floor(defense * 1.5);
    if (target.ability === 'fur-coat') defense *= 2;
  } else {
    if (user.ability === 'solar-power' && state.field.weather === 'sun') attack = Math.floor(attack * 1.5);
    if (user.ability === 'defeatist' && user.hp <= user.maxHp / 2) attack = Math.floor(attack / 2);
    if (target.ability === 'ice-scales') defense *= 2;
    if (state.field.weather === 'sand' && target.types.includes('rock')) defense = Math.floor(defense * 1.5);
  }

  let damage = Math.floor(Math.floor((Math.floor((2 * user.level) / 5 + 2) * power * attack) / defense) / 50) + 2;
  if (user.helpingHand) damage = Math.floor(damage * 1.5);
  const w = state.field.weather;
  if (w === 'sun' && mv.type === 'fire') damage = Math.floor(damage * 1.5);
  if (w === 'sun' && mv.type === 'water') damage = Math.floor(damage * 0.5);
  if (w === 'rain' && mv.type === 'water') damage = Math.floor(damage * 1.5);
  if (w === 'rain' && mv.type === 'fire') damage = Math.floor(damage * 0.5);
  const t = state.field.terrain;
  if (isGrounded(user)) {
    if (t === 'electric' && mv.type === 'electric') damage = Math.floor(damage * 1.3);
    if (t === 'grassy' && mv.type === 'grass') damage = Math.floor(damage * 1.3);
    if (t === 'psychic' && mv.type === 'psychic') damage = Math.floor(damage * 1.3);
  }
  if (t === 'misty' && mv.type === 'dragon' && isGrounded(target)) damage = Math.floor(damage * 0.5);
  if (crit) damage = Math.floor(damage * (user.ability === 'sniper' ? 2.25 : 1.5));
  damage = Math.floor((damage * rng.int(85, 100)) / 100);
  if (user.types.includes(mv.type)) damage = Math.floor(damage * (user.ability === 'adaptability' ? 2 : 1.5));
  damage = Math.floor(damage * effectiveness);
  if (effectiveness > 1 && (target.ability === 'solid-rock' || target.ability === 'filter' || target.ability === 'prism-armor')) damage = Math.floor(damage * 0.75);
  if (effectiveness > 1 && user.ability === 'neuroforce') damage = Math.floor(damage * 1.25);
  if (effectiveness < 1 && user.ability === 'tinted-lens') damage *= 2;
  if (target.ability === 'thick-fat' && (mv.type === 'fire' || mv.type === 'ice')) damage = Math.floor(damage / 2);
  if (target.ability === 'heatproof' && mv.type === 'fire') damage = Math.floor(damage / 2);
  if (target.ability === 'water-bubble' && mv.type === 'fire') damage = Math.floor(damage / 2);
  if (target.ability === 'dry-skin' && mv.type === 'fire') damage = Math.floor(damage * 1.25);
  if (target.ability === 'fluffy' && mv.type === 'fire') damage *= 2;
  if (target.ability === 'multiscale' && target.hp === target.maxHp) damage = Math.floor(damage / 2);
  if (target.ability === 'punk-rock' && ['hyper-voice', 'boomburst', 'overdrive', 'snarl', 'uproar', 'bug-buzz', 'disarming-voice', 'round', 'echoed-voice'].includes(mv.slug)) damage = Math.floor(damage / 2);
  return { damage: Math.max(1, damage), crit };
}

function checkFaint(state: BattleState, side: Side, events: BattleEvent[]): void {
  const p = activePokemon(state, side);
  if (p.hp <= 0 && !events.some((e) => e.type === 'faint' && e.side === side && e.name === p.name)) {
    p.status = 'none';
    p.charging = null;
    events.push({ type: 'faint', side, name: p.name });
  }
}

function checkWinner(state: BattleState, events: BattleEvent[]): boolean {
  const aAlive = hasRemaining(state, 'a');
  const bAlive = hasRemaining(state, 'b');
  if (aAlive && bAlive) return false;
  state.phase = 'finished';
  state.winner = aAlive ? 'a' : bAlive ? 'b' : 'b';
  events.push({ type: 'end', winner: state.winner });
  return true;
}

function chip(state: BattleState, side: Side, p: BattlePokemon, amount: number, events: BattleEvent[], status: Status | null): void {
  if (p.hp <= 0 || p.ability === 'magic-guard') return;
  const dmg = Math.max(1, amount);
  p.hp = Math.max(0, p.hp - dmg);
  if (status) events.push({ type: 'statusEffect', side, name: p.name, status, text: 'residual' });
  events.push({ type: 'damage', side, name: p.name, amount: dmg, hp: p.hp, maxHp: p.maxHp, effectiveness: 1, crit: false });
  checkFaint(state, side, events);
}

function endOfTurn(state: BattleState, rng: Rng, events: BattleEvent[]): void {
  const f = state.field;
  if (f.weather !== 'none' && f.weatherTurns > 0) {
    f.weatherTurns -= 1;
    if (f.weatherTurns === 0) {
      events.push({ type: 'weather', weather: f.weather, text: 'end' });
      f.weather = 'none';
    }
  }
  if (f.terrain !== 'none' && f.terrainTurns > 0) {
    f.terrainTurns -= 1;
    if (f.terrainTurns === 0) {
      events.push({ type: 'terrain', terrain: f.terrain, text: 'end' });
      f.terrain = 'none';
    }
  }
  if (f.weather === 'sand' || f.weather === 'hail') {
    events.push({ type: 'weather', weather: f.weather, text: 'residual' });
  }
  for (const side of ['a', 'b'] as Side[]) {
    const p = activePokemon(state, side);
    if (p.hp <= 0) continue;
    p.turnsOnField += 1;
    const foe = activePokemon(state, other(side));

    if (f.weather === 'sand' && !['rock', 'ground', 'steel'].includes(p.types[0]) && !['rock', 'ground', 'steel'].includes(p.types[1] ?? '') && !['sand-veil', 'sand-rush', 'sand-force', 'overcoat'].includes(p.ability)) chip(state, side, p, Math.floor(p.maxHp / 16), events, null);
    if (f.weather === 'hail' && !p.types.includes('ice') && !['snow-cloak', 'slush-rush', 'ice-body', 'overcoat'].includes(p.ability)) chip(state, side, p, Math.floor(p.maxHp / 16), events, null);
    if (p.hp <= 0) continue;

    if ((p.ability === 'rain-dish' && f.weather === 'rain') || (p.ability === 'ice-body' && f.weather === 'hail') || (p.ability === 'dry-skin' && f.weather === 'rain')) heal(p, side, Math.floor(p.maxHp / 16), events);
    if ((p.ability === 'dry-skin' || p.ability === 'solar-power') && f.weather === 'sun') chip(state, side, p, Math.floor(p.maxHp / 8), events, null);
    if (f.terrain === 'grassy' && isGrounded(p)) heal(p, side, Math.floor(p.maxHp / 16), events);
    if (p.aquaRing) heal(p, side, Math.floor(p.maxHp / 16), events);
    if (p.hp <= 0) continue;

    if (p.leechSeeded && foe.hp > 0) {
      const drain = Math.max(1, Math.floor(p.maxHp / 8));
      chip(state, side, p, drain, events, null);
      heal(foe, other(side), drain, events);
    }
    if (p.cursed) chip(state, side, p, Math.floor(p.maxHp / 4), events, null);
    if (p.hp <= 0) continue;

    if (p.status === 'brn') chip(state, side, p, Math.floor(p.maxHp / (p.ability === 'heatproof' ? 32 : 16)), events, 'brn');
    if (p.status === 'psn') {
      if (p.ability === 'poison-heal') heal(p, side, Math.floor(p.maxHp / 8), events);
      else chip(state, side, p, Math.floor(p.maxHp / 8), events, 'psn');
    }
    if (p.status === 'tox') {
      p.toxicCounter = Math.min(15, p.toxicCounter + 1);
      if (p.ability === 'poison-heal') heal(p, side, Math.floor(p.maxHp / 8), events);
      else chip(state, side, p, Math.floor((p.maxHp * p.toxicCounter) / 16), events, 'tox');
    }
    if (p.hp <= 0) continue;

    if (p.ability === 'shed-skin' && p.status !== 'none' && rng.chance(30)) {
      p.status = 'none';
      events.push({ type: 'ability', side, name: p.name, ability: 'shed-skin', text: 'cure' });
    }
    if (p.ability === 'hydration' && f.weather === 'rain' && p.status !== 'none') {
      p.status = 'none';
      events.push({ type: 'ability', side, name: p.name, ability: 'hydration', text: 'cure' });
    }
    if (p.ability === 'speed-boost' && p.turnsOnField > 0) {
      events.push({ type: 'ability', side, name: p.name, ability: 'speed-boost', text: 'boost' });
      applyStatChanges(state, side, [{ stat: 'spe', change: 1 }], events);
    }
    if (p.ability === 'moody') {
      const keys: StageKey[] = ['atk', 'def', 'spa', 'spd', 'spe'];
      applyStatChanges(state, side, [{ stat: keys[rng.int(0, 4)], change: 2 }, { stat: keys[rng.int(0, 4)], change: -1 }], events);
    }
    if (p.yawnTurns > 0) {
      p.yawnTurns -= 1;
      if (p.yawnTurns === 0 && canBeStatused(state, p, 'slp')) {
        p.status = 'slp';
        p.sleepTurns = rng.int(1, 3);
        events.push({ type: 'status', side, name: p.name, status: 'slp' });
      }
    }
  }
}

export function replay(teamA: TeamSnapshot, teamB: TeamSnapshot, seed: number, turns: Partial<Record<Side, Action>>[], options: BattleOptions = {}): { state: BattleState; events: BattleEvent[][] } {
  let state = createBattle(teamA, teamB, seed, options);
  const events: BattleEvent[][] = [];
  for (const actions of turns) {
    const r = applyActions(state, actions);
    state = r.state;
    events.push(r.events);
  }
  return { state, events };
}
