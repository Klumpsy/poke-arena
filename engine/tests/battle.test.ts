import { applyActions, createBattle, legalActions, pendingActors, replay, typeEffectiveness, describe as describeEvent } from '../src';
import type { BattleEvent, BattleState } from '../src';
import { mon, team } from './helpers';

const charizard = mon(6, ['flamethrower', 'growl', 'will-o-wisp', 'thunder-wave']);
const venusaur = mon(3, ['vine-whip', 'sleep-powder', 'synthesis', 'toxic']);
const gengar = mon(94, ['shadow-ball', 'hypnosis', 'lick', 'protect']);
const snorlax = mon(143, ['tackle', 'rest', 'yawn', 'refresh']);

function run(state: BattleState, a: number, b: number) {
  return applyActions(state, { a: { type: 'move', moveIndex: a }, b: { type: 'move', moveIndex: b } });
}

function types(events: BattleEvent[]) {
  return events.map((e) => e.type);
}

describe('createBattle', () => {
  it('sets up both sides with full HP and PP', () => {
    const s = createBattle(team(charizard), team(venusaur), 1);
    expect(s.phase).toBe('choose');
    expect(s.sides.a.team[0].hp).toBe(s.sides.a.team[0].maxHp);
    expect(s.sides.a.team[0].moves[0]).toEqual({ slug: 'flamethrower', pp: 15, maxPp: 15 });
    expect(pendingActors(s)).toEqual(['a', 'b']);
  });

  it('rejects empty teams', () => {
    expect(() => createBattle(team(), team(venusaur), 1)).toThrow();
  });
});

describe('type chart', () => {
  it('fire beats grass, normal cannot touch ghost', () => {
    expect(typeEffectiveness('fire', ['grass', 'poison'])).toBe(2);
    expect(typeEffectiveness('normal', ['ghost', 'poison'])).toBe(0);
    expect(typeEffectiveness('water', ['fire', 'flying'])).toBe(2);
    expect(typeEffectiveness('electric', ['ground'])).toBe(0);
  });
});

describe('damage', () => {
  it('flamethrower is super effective on venusaur and does big damage', () => {
    const s = createBattle(team(charizard), team(venusaur), 42);
    const { state, events } = run(s, 0, 2);
    const dmg = events.find((e) => e.type === 'damage' && e.side === 'b');
    expect(dmg).toBeDefined();
    if (dmg?.type !== 'damage') throw new Error();
    expect(dmg.effectiveness).toBe(2);
    expect(dmg.amount).toBeGreaterThan(60);
    expect(state.sides.b.team[0].hp).toBeGreaterThan(dmg.hp);
    expect(state.sides.b.team[0].moves[2].pp).toBe(4);
  });

  it('normal moves do nothing to ghosts', () => {
    const s = createBattle(team(snorlax), team(gengar), 7);
    const { events } = run(s, 0, 2);
    const dmg = events.find((e) => e.type === 'damage' && e.side === 'b');
    if (dmg?.type !== 'damage') throw new Error('expected damage event');
    expect(dmg.amount).toBe(0);
    expect(dmg.effectiveness).toBe(0);
  });

  it('is deterministic for the same seed and diverges for another', () => {
    const a = run(createBattle(team(charizard), team(venusaur), 99), 0, 0);
    const b = run(createBattle(team(charizard), team(venusaur), 99), 0, 0);
    expect(a).toEqual(b);
    const results = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const r = run(createBattle(team(charizard), team(venusaur), seed), 0, 0);
      const dmg = r.events.find((e) => e.type === 'damage' && e.side === 'b');
      if (dmg?.type === 'damage') results.add(dmg.amount);
    }
    expect(results.size).toBeGreaterThan(3);
  });
});

describe('turn order', () => {
  it('faster Pokémon moves first', () => {
    const s = createBattle(team(gengar), team(snorlax), 3);
    const { events } = run(s, 0, 0);
    const moves = events.filter((e) => e.type === 'move');
    expect(moves[0]).toMatchObject({ side: 'a' });
  });

  it('priority beats speed', () => {
    const quick = mon(143, ['quick-attack']);
    const s = createBattle(team(quick), team(gengar), 3);
    const { events } = run(s, 0, 0);
    const moves = events.filter((e) => e.type === 'move');
    expect(moves[0]).toMatchObject({ side: 'a', move: 'Quick Attack' });
  });
});

describe('status moves', () => {
  it('growl lowers target attack, and caps at -6', () => {
    let s = createBattle(team(charizard), team(snorlax), 5);
    for (let i = 0; i < 4; i++) s = run(s, 1, 3).state;
    expect(s.sides.b.team[0].stages.atk).toBe(-4);
    for (let i = 0; i < 3; i++) s = run(s, 1, 3).state;
    expect(s.sides.b.team[0].stages.atk).toBe(-6);
  });

  it('thunder wave paralyses, refresh cures', () => {
    let s = createBattle(team(charizard), team(snorlax), 5);
    let r = run(s, 3, 2);
    s = r.state;
    expect(s.sides.b.team[0].status).toBe('par');
    expect(types(r.events)).toContain('status');
    r = run(s, 1, 3);
    expect(r.state.sides.b.team[0].status).toBe('none');
    expect(types(r.events)).toContain('cure');
  });

  it('will-o-wisp cannot burn a fire type, Immunity blocks poison, toxic poisons progressively', () => {
    const fireVsFire = createBattle(team(charizard), team(charizard), 1);
    const r = run(fireVsFire, 2, 1);
    expect(r.state.sides.b.team[0].status).toBe('none');
    expect(types(r.events)).toContain('fail');

    const immune = run(createBattle(team(venusaur), team(snorlax), 11), 3, 2);
    expect(immune.state.sides.b.team[0].status).toBe('none');

    let s = createBattle(team(venusaur), team(charizard), 11);
    let hp = s.sides.b.team[0].maxHp;
    s = run(s, 3, 1).state;
    expect(s.sides.b.team[0].status).toBe('tox');
    expect(s.sides.b.team[0].hp).toBe(hp - Math.floor(hp / 16));
    hp = s.sides.b.team[0].hp;
    s = run(s, 2, 1).state;
    expect(s.sides.b.team[0].hp).toBe(hp - Math.floor((s.sides.b.team[0].maxHp * 2) / 16));
  });

  it('rest heals fully and sleeps two turns', () => {
    let s = createBattle(team(charizard), team(snorlax), 2);
    s = run(s, 0, 0).state;
    expect(s.sides.b.team[0].hp).toBeLessThan(s.sides.b.team[0].maxHp);
    let r = run(s, 1, 1);
    s = r.state;
    expect(s.sides.b.team[0].hp).toBe(s.sides.b.team[0].maxHp);
    expect(s.sides.b.team[0].status).toBe('slp');
    r = run(s, 1, 0);
    expect(r.events.some((e) => e.type === 'statusEffect' && e.text === 'skip')).toBe(true);
    r = run(r.state, 1, 0);
    expect(r.events.some((e) => e.type === 'statusEffect' && e.text === 'wake')).toBe(true);
    expect(r.state.sides.b.team[0].status).toBe('none');
  });

  it('helping hand boosts the next own attack by 1.5x', () => {
    const helper = mon(531, ['helping-hand', 'pound'], { nature: 'hardy' });
    const dummy = mon(143, ['yawn']);
    const seedBase = 123;
    const plain = run(createBattle(team(helper), team(dummy), seedBase), 1, 0);
    const boostedPrep = run(createBattle(team(helper), team(dummy), seedBase), 0, 0);
    expect(boostedPrep.state.sides.a.team[0].helpingHand).toBe(true);
    const boosted = run(boostedPrep.state, 1, 0);
    const d1 = plain.events.find((e) => e.type === 'damage' && e.side === 'b');
    const d2 = boosted.events.find((e) => e.type === 'damage' && e.side === 'b');
    if (d1?.type !== 'damage' || d2?.type !== 'damage') throw new Error();
    expect(d2.amount).toBeGreaterThan(d1.amount);
    expect(boosted.state.sides.a.team[0].helpingHand).toBe(false);
  });
});

describe('KO, replace and win', () => {
  const weak = mon(10, ['tackle'], { level: 5 });
  const strong = mon(6, ['flamethrower'], { level: 100 });

  it('moves to replace phase after a KO and only the KO side must act', () => {
    const s = createBattle(team(strong), team(weak, weak), 1);
    const r = run(s, 0, 0);
    expect(types(r.events)).toContain('faint');
    expect(r.state.phase).toBe('replace');
    expect(pendingActors(r.state)).toEqual(['b']);
    expect(legalActions(r.state, 'b')).toEqual([{ type: 'switch', slot: 1 }]);
    expect(legalActions(r.state, 'a')).toEqual([]);
    const r2 = applyActions(r.state, { b: { type: 'switch', slot: 1 } });
    expect(r2.state.phase).toBe('choose');
    expect(r2.state.sides.b.active).toBe(1);
    expect(types(r2.events)).toEqual(['switch']);
  });

  it('throws when a pending side has no action', () => {
    const s = createBattle(team(strong), team(weak), 1);
    expect(() => applyActions(s, { a: { type: 'move', moveIndex: 0 } })).toThrow(/Missing action/);
  });

  it('ends the battle when the last Pokémon faints', () => {
    const s = createBattle(team(strong), team(weak), 1);
    const r = run(s, 0, 0);
    expect(r.state.phase).toBe('finished');
    expect(r.state.winner).toBe('a');
    expect(types(r.events)).toContain('end');
    expect(pendingActors(r.state)).toEqual([]);
  });

  it('caps dealt damage at remaining HP so recoil is based on real damage', () => {
    const bird = mon(398, ['brave-bird'], { level: 100 });
    const s = createBattle(team(bird), team(weak), 4);
    const r = run(s, 0, 0);
    const hit = r.events.find((e) => e.type === 'damage' && e.side === 'b');
    const recoil = r.events.find((e) => e.type === 'damage' && e.side === 'a');
    if (hit?.type !== 'damage' || recoil?.type !== 'damage') throw new Error();
    expect(hit.amount).toBe(hit.amount + hit.hp);
    expect(recoil.amount).toBe(Math.max(1, Math.floor((hit.amount * 33) / 100)));
    expect(r.state.sides.a.team[0].hp).toBeGreaterThan(250);
  });

  it('falls back to struggle when out of PP', () => {
    const s = createBattle(team(mon(143, ['tackle'])), team(mon(143, ['tackle'])), 9);
    s.sides.a.team[0].moves[0].pp = 0;
    const r = run(s, 0, 0);
    expect(r.events.some((e) => e.type === 'move' && e.side === 'a' && e.move === 'Struggle')).toBe(true);
    expect(legalActions(s, 'a')).toEqual([{ type: 'move', moveIndex: -1 }]);
  });
});

describe('switching mid-battle', () => {
  it('lets a side switch before moves are executed and lists switches as legal actions', () => {
    const s = createBattle(team(charizard, gengar), team(snorlax), 21);
    expect(legalActions(s, 'a')).toContainEqual({ type: 'switch', slot: 1 });
    expect(legalActions(s, 'a')).not.toContainEqual({ type: 'switch', slot: 0 });
    const r = applyActions(s, { a: { type: 'switch', slot: 1 }, b: { type: 'move', moveIndex: 0 } });
    expect(r.state.sides.a.active).toBe(1);
    const kinds = r.events.map((e) => e.type);
    expect(kinds.indexOf('switch')).toBeLessThan(kinds.indexOf('move'));
    const dmg = r.events.find((e) => e.type === 'damage' && e.side === 'a');
    if (dmg?.type !== 'damage') throw new Error('expected tackle to hit the switched-in Gengar');
    expect(dmg.name).toBe('Gengar');
    expect(dmg.effectiveness).toBe(0);
  });

  it('rejects switching to a fainted or active slot', () => {
    const s = createBattle(team(charizard, gengar), team(snorlax), 21);
    expect(() => applyActions(s, { a: { type: 'switch', slot: 0 }, b: { type: 'move', moveIndex: 0 } })).toThrow(/Illegal switch/);
  });
});

describe('replay', () => {
  it('rebuilds identical state from the action log', () => {
    const turns = [
      { a: { type: 'move', moveIndex: 0 }, b: { type: 'move', moveIndex: 1 } },
      { a: { type: 'move', moveIndex: 3 }, b: { type: 'move', moveIndex: 0 } },
    ] as const;
    const one = replay(team(charizard, gengar), team(venusaur, snorlax), 777, turns as never);
    const two = replay(team(charizard, gengar), team(venusaur, snorlax), 777, turns as never);
    expect(one.state).toEqual(two.state);
    expect(one.events.flat().every((e) => typeof describeEvent(e) === 'string')).toBe(true);
  });
});
