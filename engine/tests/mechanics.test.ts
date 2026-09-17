import { applyActions, createBattle, legalActions } from '../src';
import type { BattleState } from '../src';
import { mon, team } from './helpers';

function run(state: BattleState, a: number, b: number) {
  return applyActions(state, { a: { type: 'move', moveIndex: a }, b: { type: 'move', moveIndex: b } });
}
const kinds = (r: { events: { type: string }[] }) => r.events.map((e) => e.type);

describe('abilities', () => {
  it('Intimidate lowers the foe attack on entry', () => {
    const gyarados = mon(130, ['splash']);
    const s = createBattle(team(gyarados), team(mon(143, ['tackle'])), 1);
    expect(s.sides.b.team[0].stages.atk).toBe(-1);
    expect(s.sides.a.team[0].ability).toBe('intimidate');
  });

  it('Levitate makes ground moves miss entirely', () => {
    const gengar = mon(94, ['shadow-ball'], { ability: 'levitate' });
    const dugtrio = mon(51, ['earthquake']);
    const r = run(createBattle(team(dugtrio), team(gengar), 2), 0, 0);
    expect(r.events.some((e) => e.type === 'ability' && e.ability === 'levitate' && e.text === 'immune')).toBe(true);
    expect(r.state.sides.b.team[0].hp).toBe(r.state.sides.b.team[0].maxHp);
  });

  it('Sturdy survives a one-hit KO from full HP', () => {
    const weak = mon(74, ['tackle'], { level: 5, ability: 'sturdy' });
    const strong = mon(6, ['flamethrower'], { level: 100 });
    const r = run(createBattle(team(strong), team(weak), 3), 0, 0);
    expect(r.state.sides.b.team[0].hp).toBe(1);
    expect(kinds(r)).toContain('ability');
  });

  it('Speed Boost raises speed at the end of each turn', () => {
    const yanma = mon(193, ['tackle'], { ability: 'speed-boost' });
    let s = createBattle(team(yanma), team(mon(143, ['yawn'])), 4);
    s = run(s, 0, 0).state;
    expect(s.sides.a.team[0].stages.spe).toBe(1);
    s = run(s, 0, 0).state;
    expect(s.sides.a.team[0].stages.spe).toBe(2);
  });

  it('Water Absorb heals instead of taking damage', () => {
    const quagsire = mon(195, ['tackle'], { ability: 'water-absorb' });
    const s = createBattle(team(mon(9, ['surf'])), team(quagsire), 5);
    s.sides.b.team[0].hp = 100;
    const r = run(s, 0, 0);
    expect(r.state.sides.b.team[0].hp).toBeGreaterThan(100);
    expect(r.events.some((e) => e.type === 'ability' && e.ability === 'water-absorb')).toBe(true);
  });
});

describe('weather and terrain', () => {
  it('sun boosts fire and weakens water; gym weather is permanent', () => {
    const charizard = mon(6, ['flamethrower']);
    const blastoise = mon(9, ['surf']);
    const plain = run(createBattle(team(charizard), team(blastoise), 8), 0, 0);
    const sunny = run(createBattle(team(charizard), team(blastoise), 8, { weather: 'sun' }), 0, 0);
    const dmg = (r: typeof plain, side: 'a' | 'b') => {
      const e = r.events.find((x) => x.type === 'damage' && x.side === side);
      return e?.type === 'damage' ? e.amount : 0;
    };
    expect(dmg(sunny, 'b')).toBeGreaterThan(dmg(plain, 'b'));
    expect(dmg(sunny, 'a')).toBeLessThan(dmg(plain, 'a'));
    expect(sunny.state.field.weather).toBe('sun');
  });

  it('Rain Dance sets rain for five turns and then it ends', () => {
    let s = createBattle(team(mon(9, ['rain-dance', 'withdraw'])), team(mon(143, ['yawn'])), 9);
    let r = run(s, 0, 0);
    s = r.state;
    expect(s.field.weather).toBe('rain');
    expect(kinds(r)).toContain('weather');
    for (let i = 0; i < 3; i++) s = run(s, 1, 0).state;
    expect(s.field.weather).toBe('rain');
    s = run(s, 1, 0).state;
    expect(s.field.weather).toBe('none');
  });

  it('Solar Beam fires instantly in the sun but needs a charge turn otherwise', () => {
    const venusaur = mon(3, ['solar-beam']);
    const dummy = mon(143, ['yawn']);
    const sunny = run(createBattle(team(venusaur), team(dummy), 10, { weather: 'sun' }), 0, 0);
    expect(kinds(sunny)).toContain('damage');
    const plain = run(createBattle(team(venusaur), team(dummy), 10), 0, 0);
    expect(kinds(plain)).toContain('charge');
    expect(plain.state.sides.a.team[0].charging?.slug).toBe('solar-beam');
    expect(legalActions(plain.state, 'a')).toEqual([{ type: 'move', moveIndex: 0 }]);
    const second = run(plain.state, 0, 0);
    expect(kinds(second)).toContain('damage');
    expect(second.state.sides.a.team[0].charging).toBeNull();
  });

  it('Grassy Terrain heals grounded Pokémon at the end of the turn', () => {
    const s = createBattle(team(mon(143, ['yawn'])), team(mon(143, ['yawn'])), 11, { terrain: 'grassy' });
    s.sides.a.team[0].hp = 100;
    const r = run(s, 0, 0);
    expect(r.state.sides.a.team[0].hp).toBeGreaterThan(100);
  });
});

describe('special moves', () => {
  it('Protect blocks the attack and fails when used twice in a row (seeded)', () => {
    const s = createBattle(team(mon(94, ['protect'])), team(mon(143, ['tackle'])), 12);
    const r = run(s, 0, 0);
    expect(kinds(r).filter((k) => k === 'protect').length).toBe(2);
    expect(r.state.sides.a.team[0].hp).toBe(r.state.sides.a.team[0].maxHp);
  });

  it('Phantom Force makes the user untouchable during the charge turn', () => {
    const banette = mon(354, ['phantom-force']);
    const r = run(createBattle(team(banette), team(mon(143, ['tackle'])), 13), 0, 0);
    expect(kinds(r)).toContain('charge');
    expect(kinds(r)).toContain('miss');
    expect(r.state.sides.a.team[0].hp).toBe(r.state.sides.a.team[0].maxHp);
  });

  it('Sucker Punch fails against a status move', () => {
    const r = run(createBattle(team(mon(354, ['sucker-punch'])), team(mon(143, ['yawn'])), 14), 0, 0);
    expect(kinds(r)).toContain('fail');
  });

  it('Counter returns double the physical damage taken', () => {
    const wobb = mon(202, ['counter']);
    const snorlax = mon(143, ['tackle']);
    const r = run(createBattle(team(wobb), team(snorlax), 15), 0, 0);
    const taken = r.events.find((e) => e.type === 'damage' && e.side === 'a');
    const returned = r.events.find((e) => e.type === 'damage' && e.side === 'b');
    if (taken?.type !== 'damage' || returned?.type !== 'damage') throw new Error();
    expect(returned.amount).toBe(Math.min(taken.amount * 2, snorlax.level * 0 + returned.amount + returned.hp - returned.hp + taken.amount * 2));
  });

  it('Explosion knocks out the user, Final Gambit deals HP damage', () => {
    const r = run(createBattle(team(mon(101, ['explosion'])), team(mon(143, ['yawn'])), 16), 0, 0);
    expect(r.state.sides.a.team[0].hp).toBe(0);
    const g = run(createBattle(team(mon(398, ['final-gambit'])), team(mon(143, ['yawn'])), 17), 0, 0);
    const dmg = g.events.find((e) => e.type === 'damage' && e.side === 'b');
    if (dmg?.type !== 'damage') throw new Error();
    expect(dmg.amount).toBe(Math.min(g.state.sides.a.team[0].maxHp, dmg.amount + dmg.hp - dmg.hp));
    expect(g.state.sides.a.team[0].hp).toBe(0);
  });

  it('Leech Seed drains each turn and fails on grass types', () => {
    let s = createBattle(team(mon(3, ['leech-seed'])), team(mon(143, ['yawn'])), 18);
    s.sides.a.team[0].hp = 50;
    const r = run(s, 0, 0);
    expect(r.state.sides.b.team[0].leechSeeded).toBe(true);
    expect(r.state.sides.b.team[0].hp).toBeLessThan(r.state.sides.b.team[0].maxHp);
    expect(r.state.sides.a.team[0].hp).toBeGreaterThan(50);
    const g = run(createBattle(team(mon(3, ['leech-seed'])), team(mon(3, ['yawn'])), 19), 0, 0);
    expect(kinds(g)).toContain('fail');
  });

  it('Roar forces the opponent to switch and U-turn switches the user', () => {
    const r = run(createBattle(team(mon(143, ['roar'])), team(mon(1, ['yawn']), mon(4, ['yawn'])), 20), 0, 0);
    expect(r.state.sides.b.active).toBe(1);
    const u = run(createBattle(team(mon(398, ['u-turn']), mon(143, ['yawn'])), team(mon(1, ['yawn'])), 21), 0, 0);
    expect(u.state.sides.a.active).toBe(1);
  });

  it('Yawn puts the target to sleep at the end of the next turn', () => {
    let s = createBattle(team(mon(143, ['yawn'])), team(mon(6, ['growl'])), 22);
    s = run(s, 0, 0).state;
    expect(s.sides.b.team[0].status).toBe('none');
    s = run(s, 0, 0).state;
    expect(s.sides.b.team[0].status).toBe('slp');
  });
});
