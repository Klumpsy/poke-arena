<script lang="ts">
  import { store } from '../lib/store.svelte';
  import Leaderboard from './Leaderboard.svelte';
  import OnlineList from './OnlineList.svelte';
  import PokemonCard from './PokemonCard.svelte';

  let draft = $state<string[]>([]);
  $effect(() => {
    draft = [...store.team];
  });

  const dirty = $derived(draft.join() !== store.team.join());

  function toggle(id: string) {
    if (draft.includes(id)) draft = draft.filter((x) => x !== id);
    else if (draft.length < 3) draft = [...draft, id];
  }
</script>

<div class="grid lobby">
  <section class="panel">
    <div class="row" style="margin-bottom: 0.75rem">
      <h2 style="margin: 0">Jouw team</h2>
      <span class="muted">{draft.length}/3 gekozen, klik om te kiezen</span>
      <span class="spacer"></span>
      <button class="primary" disabled={!dirty || !draft.length} onclick={() => store.saveTeam(draft)}>Team opslaan</button>
    </div>
    {#if !store.team.length}
      <p class="muted">Kies 1 tot 3 Pokémon en sla je team op. Daarna kun je collega's uitdagen.</p>
    {/if}
    <div class="cards">
      {#each store.pokemon as p (p.id)}
        <PokemonCard pokemon={p} selected={draft.includes(p.id)} order={draft.indexOf(p.id) + 1} onclick={() => toggle(p.id)} />
      {/each}
    </div>
    <p class="muted" style="font-size: 0.8rem; margin-top: 0.75rem">
      Laatste sync: {store.player?.last_sync_at ? new Date(store.player.last_sync_at).toLocaleString('nl-NL') : 'nog niet'}. Nieuwe Pokémon uit PokeTokenBar verschijnen automatisch.
    </p>
  </section>
  <aside class="grid">
    <OnlineList />
    <Leaderboard />
  </aside>
</div>

{#if store.incoming.length}
  {@const invite = store.incoming[0]}
  <div class="modal-backdrop">
    <div class="panel modal">
      <h2 class="pixel" style="font-size: 1rem">Uitdaging!</h2>
      <p><strong>{store.nameOf(invite.challenger_id)}</strong> wil tegen je vechten.</p>
      {#if !store.team.length}<p class="error">Sla eerst een team op om te kunnen accepteren.</p>{/if}
      <div class="row">
        <button class="primary" disabled={!store.team.length} onclick={() => store.respond(invite.id, true)}>Accepteren</button>
        <button class="danger" onclick={() => store.respond(invite.id, false)}>Afwijzen</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cards { display: grid; gap: 0.75rem; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; z-index: 10; }
  .modal { max-width: 420px; width: calc(100% - 2rem); }
</style>
