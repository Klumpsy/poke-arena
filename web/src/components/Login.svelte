<script lang="ts">
  import { store } from '../lib/store.svelte';

  let email = $state('');
  let sent = $state(false);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    await store.signIn(email.trim());
    busy = false;
    if (!store.error) sent = true;
  }
</script>

<div class="panel login">
  <h1 class="pixel" style="font-size: 1.4rem">Poke Arena</h1>
  <p class="muted">Vecht met de Pokémon die je in PokeTokenBar hebt opgevoed. Log in met je werkmail, je krijgt een link.</p>
  {#if sent}
    <p>Check je mail ({email}) en klik op de link. Dit tabblad mag dicht.</p>
  {:else}
    <form onsubmit={submit} class="row" style="margin-top: 1rem">
      <input type="email" required placeholder="naam@cube.nl" bind:value={email} />
      <button class="primary" type="submit" disabled={busy}>Stuur link</button>
    </form>
    {#if store.error}<p class="error">{store.error}</p>{/if}
  {/if}
</div>

<style>
  .login { max-width: 480px; margin: 10vh auto 0; }
</style>
