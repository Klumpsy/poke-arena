<script lang="ts">
  import { ability as abilityData, computeStats, defaultAbility, hasDamagingMove, move as moveData, species } from '@poke-arena/engine';
  import { animatedSprite, staticSprite } from '../lib/sprites';
  import { battleMoves, type PokemonRow } from '../lib/types';

  let {
    pokemon,
    selected = false,
    order = 0,
    compact = false,
    onclick,
    onEditMoves,
  }: { pokemon: PokemonRow; selected?: boolean; order?: number; compact?: boolean; onclick?: () => void; onEditMoves?: () => void } = $props();

  const moves = $derived(battleMoves(pokemon));
  const toothless = $derived(!hasDamagingMove(moves));

  const sp = $derived(species(pokemon.species_id));
  const stats = $derived(computeStats({ id: pokemon.id, speciesId: pokemon.species_id, level: pokemon.level, nature: pokemon.nature, ivs: pokemon.ivs, moves: pokemon.moves, shiny: pokemon.shiny, gender: pokemon.gender }));
  let src = $state('');
  $effect(() => {
    src = animatedSprite(pokemon.species_id, { shiny: pokemon.shiny });
  });
</script>

<div class="card" class:selected class:compact class:static={!onclick} role="button" tabindex="0" onclick={onclick} onkeydown={(e) => e.key === 'Enter' && onclick?.()}>
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
      {#if !compact}<span class="muted" style="font-size: 0.8rem; text-transform: capitalize">{pokemon.nature}</span>
        <span class="muted" style="font-size: 0.8rem" title={abilityData(pokemon.ability ?? defaultAbility(pokemon.species_id)).effect}>· {abilityData(pokemon.ability ?? defaultAbility(pokemon.species_id)).name}</span>{/if}
    </div>
    {#if !compact}
      <div class="stats muted">
        HP {stats.hp} · Atk {stats.atk} · Def {stats.def} · SpA {stats.spa} · SpD {stats.spd} · Spe {stats.spe}
      </div>
      <div class="moves">
        {#each moves as m}<span class="badge type type-{moveData(m).type}">{moveData(m).name}</span>{/each}
        {#if onEditMoves}
          <button class="edit" type="button" onclick={(e) => { e.stopPropagation(); onEditMoves(); }}>Moves kiezen</button>
        {/if}
      </div>
      {#if toothless}<div class="warn">Geen aanvallende move, kies andere moves.</div>{/if}
    {/if}
  </div>
</div>

<style>
  .card {
    display: flex; gap: 1rem; text-align: left; width: 100%; padding: 0.75rem; align-items: center; cursor: pointer;
    border: 1px solid var(--border); background: var(--bg-panel); border-radius: var(--radius-sm);
    transition: transform 0.08s ease, border-color 0.15s ease;
  }
  .card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .card.static { cursor: default; }
  .card.static:hover { border-color: var(--border); transform: none; }
  .card.compact { padding: 0.5rem; gap: 0.6rem; }
  .card.compact .sprite { width: 64px; height: 64px; }
  .card.compact .sprite img { max-width: 64px; max-height: 64px; }
  .edit { font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 999px; }
  .warn { color: var(--warning); font-size: 0.78rem; margin-top: 0.3rem; }
  .card.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
  .sprite { position: relative; width: 96px; height: 96px; display: grid; place-items: center; flex-shrink: 0; }
  .sprite img { max-width: 96px; max-height: 96px; image-rendering: pixelated; }
  .order { position: absolute; top: 0; left: 0; background: var(--accent); color: var(--accent-text); font-size: 0.7rem; padding: 0.25rem 0.4rem; border-radius: 6px; }
  .stats { font-size: 0.78rem; }
  .moves { display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.35rem; }
  .info { min-width: 0; }
</style>
