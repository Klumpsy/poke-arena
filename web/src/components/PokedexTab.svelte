<script lang="ts">
  import { species } from '@poke-arena/engine';
  import { store } from '../lib/store.svelte';
  import PokemonCard from './PokemonCard.svelte';
  import TypeBadge from './TypeBadge.svelte';

  let query = $state('');

  const q = $derived(query.trim().toLowerCase());
  const byPlayer = $derived(
    store.players
      .map((p) => ({
        player: p,
        pokemon: store.allPokemon.filter((k) => k.player_id === p.id).filter((k) => {
          if (!q) return true;
          const sp = species(k.species_id);
          return sp.name.toLowerCase().includes(q) || sp.types.some((t) => t.includes(q)) || p.name.toLowerCase().includes(q);
        }),
      }))
      .filter((e) => e.pokemon.length || (!q && e.player.id === store.me)),
  );
</script>

<section class="panel">
  <div class="row" style="flex-wrap: wrap">
    <h2 style="margin: 0">Pokédex</h2>
    <span class="spacer"></span>
    <input type="search" placeholder="Zoek op Pokémon, type of collega" bind:value={query} style="max-width: 320px" />
  </div>
  <p class="muted" style="margin: 0.25rem 0 1rem">Van collega's zie je soort, level en types. Moves en stats ontdek je pas in het gevecht.</p>
  {#each byPlayer as entry (entry.player.id)}
    {@const gym = store.gymOf(entry.player.id)}
    {@const status = store.statusOf(entry.player.id)}
    <div class="trainer">
      <div class="row" style="flex-wrap: wrap; gap: 0.5rem">
        <span class="dot {status}" title={status === 'battle' ? 'in gevecht' : status}></span>
        <button class="namebtn" onclick={() => (store.profileId = entry.player.id)}><strong>{entry.player.name}</strong></button>
        {#if store.championId === entry.player.id}<span class="badge crown">👑 Champion</span>{/if}
        <span class="muted">{entry.player.rating} rating · {entry.player.wins}W/{entry.player.losses}V</span>
        {#if gym}<span class="badge">leader {gym.name}</span>{/if}
        {#each store.badgesOf(entry.player.id) as b (b.gym_id)}
          {@const g = store.gyms.find((x) => x.id === b.gym_id)}
          {#if g}<TypeBadge type={g.type} small />{/if}
        {/each}
        <span class="spacer"></span>
        <span class="muted">{entry.pokemon.length} Pokémon</span>
      </div>
      <div class="cards">
        {#each entry.pokemon as k (k.id)}
          <PokemonCard pokemon={k} compact={k.player_id !== store.me} />
        {/each}
      </div>
    </div>
  {/each}
</section>

<style>
  .namebtn { background: none; border: none; padding: 0; color: inherit; font: inherit; cursor: pointer; }
  .namebtn:hover { color: var(--accent); transform: none; }
  .crown { background: linear-gradient(90deg, #f59e0b, #fde047); color: #1a1a1a; border-color: transparent; }
  .dot.battle { background: var(--warning); box-shadow: 0 0 8px var(--warning); }
  .dot.offline { background: #4b5563; box-shadow: none; }
  .trainer { border-top: 1px solid var(--border); padding-top: 0.75rem; margin-top: 0.75rem; }
  .cards { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); margin-top: 0.5rem; }
</style>
