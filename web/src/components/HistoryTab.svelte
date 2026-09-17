<script lang="ts">
  import { store } from '../lib/store.svelte';
  import type { BattleRow } from '../lib/types';

  function label(b: BattleRow): string {
    if (b.champion_match) return 'Champion';
    if (b.tournament_match_id) return 'Toernooi';
    if (b.gym_id) return store.gyms.find((g) => g.id === b.gym_id)?.name ?? 'Gym';
    return '';
  }
  const mine = $derived(store.history.filter((b) => b.challenger_id === store.me || b.opponent_id === store.me));
  let filter = $state<'all' | 'mine'>('all');
  const list = $derived(filter === 'mine' ? mine : store.history);
</script>

<section class="panel">
  <div class="row" style="flex-wrap: wrap">
    <h2 style="margin: 0">Live</h2>
    <span class="spacer"></span>
  </div>
  {#if !store.liveBattles.length}
    <p class="muted">Nu geen gevechten bezig.</p>
  {:else}
    <ul>
      {#each store.liveBattles as b (b.id)}
        <li class="row">
          <span class="dot battle"></span>
          <span><strong>{store.nameOf(b.challenger_id)}</strong> vs <strong>{store.nameOf(b.opponent_id)}</strong>{#if label(b)} <span class="badge">{label(b)}</span>{/if}</span>
          <span class="spacer"></span>
          {#if b.challenger_id !== store.me && b.opponent_id !== store.me}
            <button class="primary" onclick={() => (store.watching = b)}>Kijk mee</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="panel" style="margin-top: 1rem">
  <div class="row" style="flex-wrap: wrap">
    <h2 style="margin: 0">Gevechten</h2>
    <span class="spacer"></span>
    <button class:on={filter === 'all'} onclick={() => (filter = 'all')}>Iedereen</button>
    <button class:on={filter === 'mine'} onclick={() => (filter = 'mine')}>Alleen ik</button>
  </div>
  {#if !list.length}<p class="muted">Nog geen afgeronde gevechten.</p>{/if}
  <ul>
    {#each list as b (b.id)}
      {@const loser = b.winner_id === b.challenger_id ? b.opponent_id : b.challenger_id}
      <li class="row" class:mine={b.challenger_id === store.me || b.opponent_id === store.me}>
        <span class="muted small">{new Date(b.finished_at ?? b.created_at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        <span><strong class="win">{store.nameOf(b.winner_id!)}</strong> verslaat <strong>{store.nameOf(loser)}</strong>
          {#if label(b)}<span class="badge">{label(b)}</span>{/if}
          {#if b.stake}<span class="muted small">inzet: {b.stake}</span>{/if}
        </span>
        <span class="muted small">+{b.rating_delta}</span>
        <span class="spacer"></span>
        <button onclick={() => (store.replaying = b)}>Replay</button>
      </li>
    {/each}
  </ul>
</section>

<style>
  ul { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.4rem; }
  li.row { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; flex-wrap: wrap; }
  li.mine { border-color: var(--accent); }
  .small { font-size: 0.78rem; }
  .win { color: var(--success); }
  .dot.battle { background: var(--warning); box-shadow: 0 0 8px var(--warning); }
  button.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
</style>
