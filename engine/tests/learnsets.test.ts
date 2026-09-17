import { createBattle, defaultMoves, hasDamagingMove, learnableMoves } from '../src';
import { mon, team } from './helpers';

describe('learnableMoves', () => {
  it('lists level-up moves at or below the level, plus current moves', () => {
    const moves = learnableMoves(354, 30, ['trick']);
    const slugs = moves.map((m) => m.slug);
    expect(slugs).toContain('shadow-ball');
    expect(slugs).toContain('will-o-wisp');
    expect(slugs).not.toContain('grudge');
    expect(slugs).toContain('trick');
    expect(moves[0].level).toBeLessThanOrEqual(moves[moves.length - 1].level);
  });

  it('detects teams without a damaging move', () => {
    expect(hasDamagingMove(['embargo', 'snatch', 'grudge', 'trick'])).toBe(false);
    expect(hasDamagingMove(['growl', 'pound'])).toBe(true);
  });
});

describe('defaultMoves', () => {
  it('prefers the strongest recent damaging moves and fills up to four', () => {
    const moves = defaultMoves(354, 100);
    expect(moves).toHaveLength(4);
    expect(hasDamagingMove(moves)).toBe(true);
    expect(defaultMoves(531, 9)).toContain('pound');
  });

  it('is used by the engine when a Pokémon has no moves', () => {
    const s = createBattle(team(mon(354, [], { level: 100 })), team(mon(531, [])), 1);
    expect(s.sides.a.team[0].moves.map((m) => m.slug)).toEqual(defaultMoves(354, 100));
    expect(s.sides.a.team[0].moves[0].slug).not.toBe('struggle');
  });
});
