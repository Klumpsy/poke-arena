import learnsetsJson from '../../data/learnsets.json';
import { MOVES } from './data';

type Learnset = [slug: string, level: number][];
const LEARNSETS = learnsetsJson as unknown as Record<string, Learnset>;

export interface LearnableMove {
  slug: string;
  level: number;
}

export function learnableMoves(speciesId: number, level: number, current: string[] = []): LearnableMove[] {
  const own = (LEARNSETS[String(speciesId)] ?? []).filter(([slug, lvl]) => lvl <= level && MOVES[slug]);
  const seen = new Set(own.map(([slug]) => slug));
  const extra: Learnset = current.filter((slug) => MOVES[slug] && !seen.has(slug)).map((slug) => [slug, 0]);
  return [...extra, ...own].map(([slug, lvl]) => ({ slug, level: lvl })).sort((a, b) => a.level - b.level || a.slug.localeCompare(b.slug));
}

export function hasDamagingMove(moves: string[]): boolean {
  return moves.some((slug) => MOVES[slug] && MOVES[slug].category !== 'status' && (MOVES[slug].power ?? 0) > 0);
}
