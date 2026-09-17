<script lang="ts">
  import { store } from '../lib/store.svelte';
</script>

<section class="panel">
  <h2>Online</h2>
  {#if store.outgoing}
    <p class="muted" style="animation: pulse 1.5s infinite">
      Wacht op {store.nameOf(store.outgoing.opponent_id)}...
      <button style="margin-left: 0.5rem" onclick={() => store.cancelChallenge()}>Annuleer</button>
    </p>
  {/if}
  {#if !store.online.length}
    <p class="muted">Niemand anders online. Vraag een collega om de arena te openen.</p>
  {:else}
    <ul>
      {#each store.online as p (p.id)}
        <li class="row">
          <span class="dot" class:busy={p.inBattle}></span>
          <span>{p.name}</span>
          <span class="spacer"></span>
          {#if p.inBattle}
            <span class="badge">in gevecht</span>
          {:else}
            <button class="primary" disabled={!store.team.length || Boolean(store.outgoing)} onclick={() => store.challenge(p.id)}>Uitdagen</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
</style>
