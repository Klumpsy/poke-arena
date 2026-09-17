<script lang="ts">
  import { store } from '../lib/store.svelte';
  import ChallengeModal from './ChallengeModal.svelte';
  import DebtsTab from './DebtsTab.svelte';
  import GymsTab from './GymsTab.svelte';
  import Leaderboard from './Leaderboard.svelte';
  import MovePicker from './MovePicker.svelte';
  import PokedexTab from './PokedexTab.svelte';
  import OnlineList from './OnlineList.svelte';
  import PokemonCard from './PokemonCard.svelte';

  let draft = $state<string[]>([]);
  $effect(() => {
    draft = [...store.team];
  });

  const dirty = $derived(draft.join() !== store.team.join());
  let editing = $state<string | null>(null);
  let challenging = $state<string | null>(null);
  let tab = $state<'arena' | 'gyms' | 'pokedex' | 'debts'>('arena');
  const openDebts = $derived(store.debts.filter((d) => !d.done_at && (d.debtor_id === store.me || d.creditor_id === store.me)).length);
  const editingPokemon = $derived(store.pokemon.find((p) => p.id === editing) ?? null);

  function toggle(id: string) {
    if (draft.includes(id)) draft = draft.filter((x) => x !== id);
    else if (draft.length < 3) draft = [...draft, id];
  }
</script>

<nav class="tabs">
  <button class:on={tab === 'arena'} onclick={() => (tab = 'arena')}>Arena</button>
  <button class:on={tab === 'gyms'} onclick={() => (tab = 'gyms')}>Gyms</button>
  <button class:on={tab === 'pokedex'} onclick={() => (tab = 'pokedex')}>Pokédex</button>
  <button class:on={tab === 'debts'} onclick={() => (tab = 'debts')}>Inzetten{#if openDebts} <span class="count">{openDebts}</span>{/if}</button>
</nav>

{#if tab === 'gyms'}
  <GymsTab />
{:else if tab === 'pokedex'}
  <PokedexTab />
{:else if tab === 'debts'}
  <DebtsTab />
{:else}
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
        <PokemonCard pokemon={p} selected={draft.includes(p.id)} order={draft.indexOf(p.id) + 1} onclick={() => toggle(p.id)} onEditMoves={() => (editing = p.id)} />
      {/each}
    </div>
    <p class="muted" style="font-size: 0.8rem; margin-top: 0.75rem">
      Laatste sync: {store.player?.last_sync_at ? new Date(store.player.last_sync_at).toLocaleString('nl-NL') : 'nog niet'}. Nieuwe Pokémon uit PokeTokenBar verschijnen automatisch.
    </p>
  </section>
  <aside class="grid">
    <OnlineList onChallenge={(id) => (challenging = id)} />
    <Leaderboard />
  </aside>
</div>
{/if}

{#if challenging}
  <ChallengeModal opponentId={challenging} onclose={() => (challenging = null)} />
{/if}

{#if editingPokemon}
  <MovePicker pokemon={editingPokemon} onclose={() => (editing = null)} />
{/if}

{#if store.incoming.length}
  {@const invite = store.incoming[0]}
  <div class="modal-backdrop">
    <div class="panel modal">
      <h2 class="pixel" style="font-size: 1rem">Uitdaging!</h2>
      <p><strong>{store.nameOf(invite.challenger_id)}</strong> wil tegen je vechten.</p>
      {#if invite.gym_id}<p><span class="badge active">Gym-uitdaging</span> voor {store.gyms.find((g) => g.id === invite.gym_id)?.name ?? invite.gym_id}. Win je, dan blijf je leader.</p>{/if}
      {#if invite.stake}<p>Inzet: <strong>"{invite.stake}"</strong>. Accepteren = akkoord.</p>{/if}
      {#if !store.team.length}<p class="error">Sla eerst een team op om te kunnen accepteren.</p>{/if}
      <div class="row">
        <button class="primary" disabled={!store.team.length} onclick={() => store.respond(invite.id, true)}>Accepteren</button>
        <button class="danger" onclick={() => store.respond(invite.id, false)}>Afwijzen</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tabs { display: flex; gap: 0.4rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .tabs button.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 700; }
  .count { background: var(--danger); color: #fff; border-radius: 999px; padding: 0 0.4rem; font-size: 0.7rem; }
  .cards { display: grid; gap: 0.75rem; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; z-index: 10; }
  .modal { max-width: 420px; width: calc(100% - 2rem); }
</style>
