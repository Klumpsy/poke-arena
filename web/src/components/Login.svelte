<script lang="ts">
  import { store } from '../lib/store.svelte';

  let name = $state('');
  let password = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    await store.signIn(name.trim(), password);
    busy = false;
  }
</script>

<div class="panel login">
  <h1 class="pixel" style="font-size: 1.4rem">Poke Arena</h1>
  <p class="muted">Vecht met de Pokémon die je in PokeTokenBar hebt opgevoed. Kies een naam en wachtwoord; de eerste keer maakt dat je account, daarna log je er overal mee in.</p>
  <form onsubmit={submit} class="form">
    <input type="text" required minlength="2" maxlength="30" placeholder="Je naam" bind:value={name} autocomplete="username" />
    <input type="password" required minlength="6" placeholder="Wachtwoord (min. 6 tekens)" bind:value={password} autocomplete="current-password" />
    <button class="primary" type="submit" disabled={busy || name.trim().length < 2 || password.length < 6}>Arena in</button>
  </form>
  {#if store.error}<p class="error">{store.error}</p>{/if}
  <p class="muted" style="font-size: 0.8rem; margin-top: 1rem">Er wordt geen e-mail verstuurd. Wachtwoord vergeten? Vraag Bart, die kan het resetten.</p>
</div>

<style>
  .login { max-width: 480px; margin: 10vh auto 0; }
  .form { display: grid; gap: 0.6rem; margin-top: 1rem; }
</style>
