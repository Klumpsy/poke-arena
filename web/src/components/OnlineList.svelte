<script lang="ts">
  import { store } from '../lib/store.svelte';
  let { onChallenge }: { onChallenge: (id: string) => void } = $props();
  const rank = { online: 0, battle: 1, offline: 2 };
  const others = $derived(
    store.players.filter((p) => p.id !== store.me).sort((a, b) => rank[store.statusOf(a.id)] - rank[store.statusOf(b.id)] || a.name.localeCompare(b.name)),
  );
</script>

<section class="panel">
  <h2>Spelers</h2>
  {#if store.outgoing}
    <p class="muted" style="animation: pulse 1.5s infinite">
      Wacht op {store.nameOf(store.outgoing.opponent_id)}... <span style="font-size: 0.8rem">(verloopt na 3 min)</span>
      <button style="margin-left: 0.5rem" onclick={() => store.cancelChallenge()}>Annuleer</button>
    </p>
  {/if}
  {#if !others.length}
    <p class="muted">Nog geen andere spelers.</p>
  {:else}
    <ul>
      {#each others as p (p.id)}
        {@const status = store.statusOf(p.id)}
        <li class="row" class:dim={status === 'offline'}>
          <span class="dot {status}"></span>
          <span>
            <button class="namebtn" onclick={() => (store.profileId = p.id)}>{p.name}</button>
            {#if store.championId === p.id}<span class="badge crown">👑</span>{/if}
            {#if store.mainTitle(p.id)}<span class="badge title">{store.mainTitle(p.id)}</span>{/if}
            <span class="muted small">
              {#if status === 'battle'}in gevecht{:else if status === 'online'}online{:else}{store.lastSeenText(p.id)}{/if}
            </span>
          </span>
          {#if store.gymOf(p.id)}<span class="badge" title="Gymleader">leader</span>{/if}
          <span class="spacer"></span>
          {#if status === 'online'}
            <button class="primary" disabled={!store.team.length || Boolean(store.outgoing)} onclick={() => onChallenge(p.id)}>Uitdagen</button>
          {:else if status === 'battle'}
            <span class="badge busy">in gevecht</span>
          {:else}
            <span class="badge">offline</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="muted small" style="margin: 0.75rem 0 0">Groen: online, uitdagen kan. Oranje: in gevecht. Grijs: offline.</p>
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  li.dim { opacity: 0.6; }
  .small { font-size: 0.78rem; display: block; }
  .dot.battle { background: var(--warning); box-shadow: 0 0 8px var(--warning); }
  .dot.offline { background: #4b5563; box-shadow: none; }
  .badge.busy { border-color: var(--warning); color: var(--warning); }
  .namebtn { background: none; border: none; padding: 0; color: inherit; font: inherit; cursor: pointer; }
  .namebtn:hover { color: var(--accent); transform: none; }
  .crown { background: linear-gradient(90deg, #f59e0b, #fde047); border-color: transparent; margin-left: 0.3rem; }
  .title { border-color: var(--accent); color: var(--accent); margin-left: 0.3rem; }
</style>
