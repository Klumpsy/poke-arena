<script lang="ts">
  import { store } from '../lib/store.svelte';
  const open = $derived(store.debts.filter((d) => !d.done_at));
  const done = $derived(store.debts.filter((d) => d.done_at).slice(0, 20));
</script>

<section class="panel">
  <h2>Inzetten</h2>
  <p class="muted" style="margin: 0 0 1rem">Afgesproken bij een uitdaging, verschuldigd door de verliezer. De verliezer of de winnaar vinkt af.</p>
  {#if !open.length}<p class="muted">Geen openstaande inzetten.</p>{/if}
  <ul>
    {#each open as d (d.id)}
      <li class="row">
        <span><strong>{store.nameOf(d.debtor_id)}</strong> is <strong>{store.nameOf(d.creditor_id)}</strong> nog verschuldigd: "{d.stake}"</span>
        <span class="muted" style="font-size: 0.8rem">{new Date(d.created_at).toLocaleDateString('nl-NL')}</span>
        <span class="spacer"></span>
        {#if store.me === d.debtor_id || store.me === d.creditor_id}
          <button class="primary" onclick={() => store.settleDebt(d.id)}>Gedaan</button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if done.length}
    <h3 class="muted" style="margin-top: 1.25rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em">Afgehandeld</h3>
    <ul class="muted">
      {#each done as d (d.id)}
        <li>{store.nameOf(d.debtor_id)} → {store.nameOf(d.creditor_id)}: "{d.stake}" ({new Date(d.done_at!).toLocaleDateString('nl-NL')})</li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  li.row { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.6rem 0.8rem; flex-wrap: wrap; }
</style>
