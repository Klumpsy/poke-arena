<script lang="ts">
  import { store } from '../lib/store.svelte';
  const ranked = $derived(store.players.filter((p) => p.wins + p.losses > 0 || p.id === store.me));
</script>

<section class="panel">
  <h2>Ranglijst</h2>
  <table>
    <thead><tr><th>#</th><th>Trainer</th><th>W</th><th>V</th></tr></thead>
    <tbody>
      {#each ranked as p, i (p.id)}
        <tr class:me={p.id === store.me}>
          <td class="muted">{i + 1}</td>
          <td>{p.name}</td>
          <td>{p.wins}</td>
          <td>{p.losses}</td>
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
</style>
