<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/supabase';

  let copied = $state(false);

  const command = $derived(
    store.syncToken
      ? `curl -fsSL ${window.location.origin}${import.meta.env.BASE_URL}install.sh | bash -s -- ${store.syncToken} ${SUPABASE_URL} ${SUPABASE_ANON_KEY}`
      : '',
  );

  async function copy() {
    await navigator.clipboard.writeText(command);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  onMount(() => {
    const t = setInterval(() => {
      void store.loadPokemon();
      void store.loadPlayer();
    }, 3000);
    return () => clearInterval(t);
  });

  const syncedEmpty = $derived(Boolean(store.player?.last_sync_at) && store.pokemon.length === 0);
</script>

<div class="panel" style="max-width: 760px">
  <h2>Stap 1: koppel je PokeTokenBar</h2>
  <p class="muted">Eén keer plakken in je terminal. Daarna synct je Pokédex automatisch bij elke wijziging, ook na een herstart.</p>
  {#if command}
    <pre class="cmd">{command}</pre>
    <div class="row" style="margin-top: 0.75rem">
      <button class="primary" onclick={copy}>{copied ? 'Gekopieerd' : 'Kopieer commando'}</button>
      <button onclick={() => store.regenerateToken()}>Nieuwe token</button>
      <span class="spacer"></span>
      {#if syncedEmpty}
        <span class="error">Sync gelukt, maar 0 Pokémon gevonden.</span>
      {:else}
        <span class="muted" style="animation: pulse 1.5s infinite">Wacht op je eerste sync...</span>
      {/if}
    </div>
    {#if syncedEmpty}
      <p class="error" style="margin: 0.75rem 0 0">
        Je PokeTokenBar heeft gesynct (laatst {new Date(store.player!.last_sync_at!).toLocaleTimeString('nl-NL')}), maar er zat geen Pokémon in die we herkennen.
        Heb je al een Pokémon (geen ei) in de app? Zo ja, dan is dit een formaat dat we nog niet kennen; het wordt automatisch opgepakt zodra dat is toegevoegd, je hoeft niets te doen.
      </p>
    {/if}
  {:else}
    <p class="muted">Token laden...</p>
  {/if}
  <details style="margin-top: 1.25rem">
    <summary class="muted">Wat doet dit?</summary>
    <ul class="muted">
      <li>Maakt <code>~/.poke-arena/</code> met je token en een sync-script.</li>
      <li>Installeert een launchd-agent die <code>companion-state.json</code> van PokeTokenBar in de gaten houdt.</li>
      <li>Stuurt alleen je Pokémon-data naar de arena, niets anders.</li>
      <li>Verwijderen: <code>curl -fsSL {window.location.origin}{import.meta.env.BASE_URL}uninstall.sh | bash</code></li>
    </ul>
  </details>
</div>
