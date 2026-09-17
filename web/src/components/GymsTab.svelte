<script lang="ts">
  import { store } from '../lib/store.svelte';
  import ChallengeModal from './ChallengeModal.svelte';
  import TypeBadge from './TypeBadge.svelte';

  let challenging = $state<{ opponentId: string; gymId: string } | null>(null);
  const myGym = $derived(store.gymOf(store.me!));
  const iAmNext = $derived(store.nextClaimant === store.me);
  const myBadges = $derived(store.badgesOf(store.me!));

  function online(id: string) {
    return store.statusOf(id) === 'online';
  }
</script>

<section class="panel">
  <div class="row" style="flex-wrap: wrap">
    <h2 style="margin: 0">Gyms</h2>
    <span class="spacer"></span>
    {#if myGym}
      <span class="muted">Jij leidt {myGym.name}</span>
      <button class="danger" onclick={() => store.releaseGym()}>Gym opgeven</button>
    {:else if iAmNext}
      <span class="badge active">Jij mag een lege gym claimen</span>
    {:else if store.nextClaimant}
      <span class="muted">Aan de beurt om te claimen: {store.nameOf(store.nextClaimant)}</span>
    {/if}
  </div>
  <p class="muted" style="margin: 0.25rem 0 1rem">
    King of the hill. Versla een gymleader (in welk gevecht dan ook) en je verdient de badge. Bij een gym-uitdaging neem je de gym meteen over; bij een gewoon gevecht krijg je na afloop de keuze. Lege gym? De hoogst geplaatste speler zonder gym mag hem claimen. Voor een gym heb je minstens één Pokémon van dat type in je team nodig.
  </p>
  <div class="gyms">
    {#each store.gyms as g (g.id)}
      {@const leader = g.leader_id ? store.nameOf(g.leader_id) : null}
      {@const cooldown = store.cooldownFor(g.id)}
      {@const mine = g.leader_id === store.me}
      {@const earned = myBadges.some((b) => b.gym_id === g.id)}
      <div class="gym type-{g.type}" class:empty={!g.leader_id}>
        <div class="row" style="gap: 0.4rem">
          <TypeBadge type={g.type} />
          <strong>{g.name}</strong>
          <span class="spacer"></span>
          {#if earned}<span class="badge earned" title="Badge verdiend">badge</span>{/if}
        </div>
        <div class="leader">
          {#if leader}
            Leader: <strong>{leader}</strong>{#if mine} (jij){/if}
            <span class="muted"> · {store.badgesOf(g.leader_id!).length} badges · {store.players.find((p) => p.id === g.leader_id)?.rating ?? '?'} rating</span>
          {:else}
            <span class="muted">Geen leader</span>
          {/if}
        </div>
        <div class="row" style="margin-top: 0.5rem">
          {#if !g.leader_id && iAmNext}
            <button class="primary" onclick={() => store.claimGym(g.id)}>Claim deze gym</button>
          {:else if g.leader_id && !mine}
            {#if cooldown}
              <span class="muted" style="font-size: 0.8rem">Opnieuw vanaf {new Date(cooldown.until).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            {:else if online(g.leader_id)}
              <button class="primary" disabled={!store.team.length || Boolean(store.outgoing)} onclick={() => (challenging = { opponentId: g.leader_id!, gymId: g.id })}>Gym uitdagen</button>
            {:else if store.statusOf(g.leader_id) === 'battle'}
              <span class="muted" style="font-size: 0.8rem">Leader is in gevecht</span>
            {:else}
              <span class="muted" style="font-size: 0.8rem">Leader is offline ({store.lastSeenText(g.leader_id)})</span>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
</section>

{#if challenging}
  <ChallengeModal opponentId={challenging.opponentId} gymId={challenging.gymId} onclose={() => (challenging = null)} />
{/if}

<style>
  .gyms { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .gym { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem; background: var(--bg-panel); position: relative; overflow: hidden; }
  .gym::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 5px; background: currentColor; opacity: 0.9; }
  .gym.type-normal { color: #a8a77a; } .gym.type-fire { color: #ee8130; } .gym.type-water { color: #6390f0; } .gym.type-electric { color: #f7d02c; }
  .gym.type-grass { color: #7ac74c; } .gym.type-psychic { color: #f95587; } .gym.type-fighting { color: #c22e28; } .gym.type-ghost { color: #735797; } .gym.type-dragon { color: #6f35fc; }
  .gym > * { color: var(--text); }
  .gym.empty { opacity: 0.85; }
  .leader { margin-top: 0.4rem; font-size: 0.9rem; }
  .earned { background: var(--accent); color: var(--accent-text); border-color: transparent; }
</style>
