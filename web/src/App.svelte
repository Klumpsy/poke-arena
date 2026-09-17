<script lang="ts">
  import { onMount } from 'svelte';
  import Battle from './components/Battle.svelte';
  import Lobby from './components/Lobby.svelte';
  import Login from './components/Login.svelte';
  import ProfileModal from './components/ProfileModal.svelte';
  import Setup from './components/Setup.svelte';
  import { setSoundEnabled, soundEnabled } from './lib/sound';
  import { configured } from './lib/supabase';
  import { store } from './lib/store.svelte';

  onMount(() => {
    if (configured) void store.init();
  });

  let sound = $state(soundEnabled());
  const screen = $derived.by(() => {
    if (!configured) return 'unconfigured';
    if (!store.ready) return 'loading';
    if (!store.session) return 'login';
    if (store.activeBattle) return 'battle';
    if (store.watching) return 'spectate';
    if (store.replaying) return 'replay';
    if (!store.pokemon.length) return 'setup';
    return 'lobby';
  });
</script>

<div class="shell">
  {#if screen === 'unconfigured'}
    <div class="panel">
      <h1 class="pixel">Poke Arena</h1>
      <p class="error">Supabase is nog niet geconfigureerd. Zet <code>VITE_SUPABASE_URL</code> en <code>VITE_SUPABASE_ANON_KEY</code> in <code>web/.env</code> (of als GitHub Actions secrets).</p>
    </div>
  {:else if screen === 'loading'}
    <p class="muted pixel" style="animation: pulse 1.2s infinite">Laden...</p>
  {:else if screen === 'login'}
    <Login />
  {:else if screen === 'battle'}
    {#key store.activeBattle!.id}
      <Battle battle={store.activeBattle!} />
    {/key}
  {:else if screen === 'spectate'}
    {#key store.watching!.id}
      <Battle battle={store.watching!} mode="spectate" />
    {/key}
  {:else if screen === 'replay'}
    {#key store.replaying!.id}
      <Battle battle={store.replaying!} mode="replay" />
    {/key}
  {:else}
    <header class="topbar">
      <h1 class="pixel" style="font-size: 1.1rem">Poke Arena</h1>
      <div class="row">
        <button class="name" title="Naam wijzigen" onclick={() => { const n = prompt('Nieuwe naam', store.player?.name ?? ''); if (n) void store.rename(n); }}>{store.player?.name ?? 'Speler'}</button>
        <button title={sound ? 'Geluid uit' : 'Geluid aan'} onclick={() => { sound = !sound; setSoundEnabled(sound); }}>{sound ? '🔊' : '🔇'}</button>
        <button onclick={() => store.signOut()}>Uitloggen</button>
      </div>
    </header>
    {#if store.error}
      <p class="error panel" style="padding: 0.75rem 1rem">{store.error} <button style="margin-left: 0.5rem" onclick={() => (store.error = null)}>ok</button></p>
    {/if}
    {#if screen === 'setup'}
      <Setup />
    {:else}
      <Lobby />
    {/if}
  {/if}
  {#if store.profileId}
    <ProfileModal playerId={store.profileId} onclose={() => (store.profileId = null)} />
  {/if}
</div>
