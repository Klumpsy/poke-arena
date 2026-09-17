import { hasDamagingMove, learnableMoves } from '../src';

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
