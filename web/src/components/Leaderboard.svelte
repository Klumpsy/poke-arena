<script lang="ts">
  import { store } from '../lib/store.svelte';
  const ranked = $derived(store.players);
</script>

<section class="panel">
  <h2>Ranglijst</h2>
  <table>
    <thead><tr><th>#</th><th>Trainer</th><th>Rating</th><th>W</th><th>V</th><th title="Badges">B</th></tr></thead>
    <tbody>
      {#each ranked as p, i (p.id)}
        <tr class:me={p.id === store.me} class:champion={store.championId === p.id}>
          <td class="muted">{i + 1}</td>
          <td>
            <button class="namebtn" onclick={() => (store.profileId = p.id)}>{p.name}</button>
            {#if store.championId === p.id}<span class="badge crown">👑</span>{/if}
            {#if store.gymOf(p.id)}<span class="badge" style="margin-left: 0.3rem">leader</span>{/if}
            {#if store.mainTitle(p.id)}<span class="badge title" style="margin-left: 0.3rem">{store.mainTitle(p.id)}</span>{/if}
          </td>
          <td>{p.rating}</td>
          <td>{p.wins}</td>
          <td>{p.losses}</td>
          <td>{store.badgesOf(p.id).length}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 0.25rem 0.4rem; }
  td { padding: 0.35rem 0.4rem; border-top: 1px solid var(--border); }
  tr.me td { color: var(--accent); }
  tr.champion td { background: linear-gradient(90deg, rgba(245, 158, 11, 0.18), transparent); }
  tr.champion td:first-child { border-left: 3px solid #f59e0b; }
  .namebtn { background: none; border: none; padding: 0; color: inherit; font: inherit; cursor: pointer; text-decoration: underline dotted transparent; }
  .namebtn:hover { text-decoration-color: var(--accent); transform: none; }
  .crown { background: linear-gradient(90deg, #f59e0b, #fde047); border-color: transparent; margin-left: 0.3rem; }
  .title { border-color: var(--accent); color: var(--accent); }
</style>
