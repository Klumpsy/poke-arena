const BASE = 'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon';

export function animatedSprite(speciesId: number, opts: { back?: boolean; shiny?: boolean } = {}): string {
  const dir = [opts.back ? 'back' : '', opts.shiny ? 'shiny' : ''].filter(Boolean).join('/');
  return `${BASE}/other/showdown/${dir ? dir + '/' : ''}${speciesId}.gif`;
}

export function staticSprite(speciesId: number, opts: { back?: boolean; shiny?: boolean } = {}): string {
  const dir = [opts.back ? 'back' : '', opts.shiny ? 'shiny' : ''].filter(Boolean).join('/');
  return `${BASE}/${dir ? dir + '/' : ''}${speciesId}.png`;
}

export function artwork(speciesId: number, shiny = false): string {
  return `${BASE}/other/official-artwork/${shiny ? 'shiny/' : ''}${speciesId}.png`;
}

export function preloadSprites(entries: { speciesId: number; shiny: boolean; back: boolean }[]): void {
  for (const e of entries) {
    const img = new Image();
    img.src = animatedSprite(e.speciesId, { shiny: e.shiny, back: e.back });
  }
}
