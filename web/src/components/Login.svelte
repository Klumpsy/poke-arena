<script lang="ts">
  import { store } from '../lib/store.svelte';

  let name = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    await store.signIn(name.trim());
    busy = false;
  }
</script>

<div class="panel login">
  <h1 class="pixel" style="font-size: 1.4rem">Poke Arena</h1>
  <p class="muted">Vecht met de Pokémon die je in PokeTokenBar hebt opgevoed. Vul je naam in en je staat in de arena.</p>
  <form onsubmit={submit} class="row" style="margin-top: 1rem">
    <input type="text" required minlength="2" maxlength="30" placeholder="Je naam" bind:value={name} autocomplete="nickname" />
    <button class="primary" type="submit" disabled={busy || name.trim().length < 2}>Arena in</button>
  </form>
  {#if store.error}<p class="error">{store.error}</p>{/if}
  <p class="muted" style="font-size: 0.8rem; margin-top: 1rem">Je account hangt aan deze browser. Andere browser of laptop? Dan even opnieuw je naam invullen en het sync-commando plakken.</p>
</div>

<style>
  .login { max-width: 480px; margin: 10vh auto 0; }
</style>
