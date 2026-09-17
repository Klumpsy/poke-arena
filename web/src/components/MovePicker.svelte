<script lang="ts">
  import { hasDamagingMove, learnableMoves, move as moveData, species } from '@poke-arena/engine';
  import { store } from '../lib/store.svelte';
  import { battleMoves, type PokemonRow } from '../lib/types';

  let { pokemon, onclose }: { pokemon: PokemonRow; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let chosen = $state<string[]>([...battleMoves(pokemon)]);
  let busy = $state(false);

  const options = $derived(learnableMoves(pokemon.species_id, pokemon.level, pokemon.moves));
  const sp = $derived(species(pokemon.species_id));

  function toggle(slug: string) {
    if (chosen.includes(slug)) chosen = chosen.filter((s) => s !== slug);
    else if (chosen.length < 4) chosen = [...chosen, slug];
  }

  async function save() {
    busy = true;
    await store.setMoves(pokemon.id, chosen);
    busy = false;
    if (!store.error) onclose();
  }

  function resetToApp() {
    chosen = [...pokemon.moves];
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel modal">
    <div class="row">
      <h2 style="margin: 0">Moves voor {sp.name} <span class="muted">Lv {pokemon.level}</span></h2>
      <span class="spacer"></span>
      <span class="muted">{chosen.length}/4</span>
    </div>
    <p class="muted" style="margin: 0.25rem 0 0.75rem">Alles wat {sp.name} tot level {pokemon.level} leert. Klik om te kiezen, maximaal 4.</p>
    {#if !hasDamagingMove(chosen) && chosen.length}
      <p class="error" style="margin: 0 0 0.5rem">Nog geen aanvallende move gekozen.</p>
    {/if}
    <div class="list">
      {#each options as o (o.slug)}
        {@const m = moveData(o.slug)}
        <button class="opt" class:on={chosen.includes(o.slug)} type="button" onclick={() => toggle(o.slug)} title={m.effect}>
          <span class="badge type type-{m.type}">{m.type}</span>
          <strong>{m.name}</strong>
          <span class="muted meta">{m.category === 'status' ? 'status' : `${m.power ?? '-'} pow`} · {m.accuracy ?? '-'}% · PP {m.pp}{o.level ? ` · Lv ${o.level}` : ''}</span>
          <span class="muted effect">{m.effect}</span>
        </button>
      {/each}
    </div>
    <div class="row" style="margin-top: 1rem">
      <button onclick={resetToApp}>Terug naar app-moves</button>
      <span class="spacer"></span>
      <button onclick={onclose}>Annuleren</button>
      <button class="primary" disabled={busy || !chosen.length} onclick={save}>Opslaan</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; z-index: 10; padding: 1rem; }
  .modal { max-width: 720px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; }
  .list { overflow-y: auto; display: grid; gap: 0.4rem; }
  .opt { display: grid; grid-template-columns: auto 1fr auto; gap: 0.25rem 0.6rem; align-items: center; text-align: left; padding: 0.5rem 0.75rem; }
  .opt.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
  .opt .meta { font-size: 0.78rem; text-transform: capitalize; }
  .opt .effect { grid-column: 2 / -1; font-size: 0.75rem; }
</style>
