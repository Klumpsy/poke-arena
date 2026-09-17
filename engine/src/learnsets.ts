import learnsetsJson from '../../data/learnsets.json';
import { MOVES, TYPE_CHART } from './data';

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

export function defaultMoves(speciesId: number, level: number): string[] {
  const learnable = learnableMoves(speciesId, level);
  const damaging = learnable.filter((m) => MOVES[m.slug].category !== 'status' && (MOVES[m.slug].power ?? 0) > 0);
  const picked: string[] = [];
  for (const m of [...damaging].reverse()) if (picked.length < 3 && !picked.includes(m.slug)) picked.push(m.slug);
  for (const m of [...learnable].reverse()) if (picked.length < 4 && !picked.includes(m.slug)) picked.push(m.slug);
  return picked.length ? picked : ['tackle'];
}

export function moveEffectiveness(moveSlug: string, targetTypes: string[]): number | null {
  const m = MOVES[moveSlug];
  if (!m || m.category === 'status') return null;
  return targetTypes.reduce((acc, t) => acc * (TYPE_CHART[m.type]?.[t] ?? 1), 1);
}
