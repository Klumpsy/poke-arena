<script lang="ts">
  import { computeStats, move as moveData, species } from '@poke-arena/engine';
  import { animatedSprite, staticSprite } from '../lib/sprites';
  import type { PokemonRow } from '../lib/types';

  let { pokemon, selected = false, order = 0, onclick }: { pokemon: PokemonRow; selected?: boolean; order?: number; onclick?: () => void } = $props();

  const sp = $derived(species(pokemon.species_id));
  const stats = $derived(computeStats({ id: pokemon.id, speciesId: pokemon.species_id, level: pokemon.level, nature: pokemon.nature, ivs: pokemon.ivs, moves: pokemon.moves, shiny: pokemon.shiny, gender: pokemon.gender }));
  let src = $state('');
  $effect(() => {
    src = animatedSprite(pokemon.species_id, { shiny: pokemon.shiny });
  });
</script>

<button class="card" class:selected type="button" {onclick}>
  <div class="sprite">
    <img {src} alt={sp.name} onerror={() => (src = staticSprite(pokemon.species_id, { shiny: pokemon.shiny }))} />
    {#if selected}<span class="order pixel">{order}</span>{/if}
  </div>
  <div class="info">
    <div class="row" style="gap: 0.4rem; flex-wrap: wrap">
      <strong>{sp.name}</strong>
      <span class="muted">Lv {pokemon.level}</span>
      {#if pokemon.shiny}<span class="badge shiny">shiny</span>{/if}
      {#if pokemon.is_active}<span class="badge active">nu bezig</span>{/if}
    </div>
    <div class="row" style="gap: 0.3rem; margin: 0.25rem 0">
      {#each sp.types as t}<span class="badge type type-{t}">{t}</span>{/each}
      <span class="muted" style="font-size: 0.8rem; text-transform: capitalize">{pokemon.nature}</span>
    </div>
    <div class="stats muted">
      HP {stats.hp} · Atk {stats.atk} · Def {stats.def} · SpA {stats.spa} · SpD {stats.spd} · Spe {stats.spe}
    </div>
    <div class="moves">
      {#each pokemon.moves as m}<span class="badge type type-{moveData(m).type}">{moveData(m).name}</span>{/each}
    </div>
  </div>
</button>

<style>
  .card { display: flex; gap: 1rem; text-align: left; width: 100%; padding: 0.75rem; align-items: center; }
  .card.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
  .sprite { position: relative; width: 96px; height: 96px; display: grid; place-items: center; flex-shrink: 0; }
  .sprite img { max-width: 96px; max-height: 96px; image-rendering: pixelated; }
  .order { position: absolute; top: 0; left: 0; background: var(--accent); color: var(--accent-text); font-size: 0.7rem; padding: 0.25rem 0.4rem; border-radius: 6px; }
  .stats { font-size: 0.78rem; }
  .moves { display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.35rem; }
  .info { min-width: 0; }
</style>
