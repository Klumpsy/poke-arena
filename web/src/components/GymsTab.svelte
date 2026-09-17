<script lang="ts">
  import { store } from '../lib/store.svelte';
  import ChallengeModal from './ChallengeModal.svelte';
  import TypeBadge from './TypeBadge.svelte';

  let challenging = $state<{ opponentId: string; gymId: string } | null>(null);
  const myGym = $derived(store.gymOf(store.me!));
  const canClaim = $derived(!store.gymOf(store.me!) && store.team.length > 0);
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
    {:else if canClaim}
      <span class="badge active">Lege gym? Claim hem, wie het eerst komt...</span>
    {:else}
      <span class="muted">Sla eerst een team op om een gym te claimen</span>
    {/if}
  </div>
  <p class="muted" style="margin: 0.25rem 0 1rem">
    Lege gym? Wie het eerst komt, het eerst maalt (één gym per persoon, minstens één Pokémon van dat type in je team). Daarna: versla de leader in een gym-uitdaging en je neemt de gym over, plus de badge. Versla je een leader in een gewoon gevecht, dan verdien je ook de badge en krijg je na afloop de keuze om de gym over te nemen.
  </p>
  <div class="champion-box row">
    <span class="badge crown">👑 Champion</span>
    {#if store.championId}
      <strong>{store.nameOf(store.championId)}</strong>
      <span class="muted small">Alle 8 badges? Dan mag je de Champion uitdagen via de spelerslijst.</span>
    {:else}
      <span class="muted">Nog geen Champion. De eerste met alle 8 badges die de hoogst geplaatste speler ({store.players[0]?.name ?? '?'}) verslaat in een Champion-gevecht, pakt de titel.</span>
    {/if}
  </div>
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
          {#if !g.leader_id && canClaim}
            {#if store.teamHasType(g.type)}
              <button class="primary" onclick={() => store.claimGym(g.id)}>Claim deze gym</button>
            {:else}
              <span class="muted" style="font-size: 0.8rem">Je hebt geen {g.type}-type in je team</span>
            {/if}
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
  .champion-box { border: 1px solid #f59e0b; border-radius: var(--radius-sm); padding: 0.6rem 0.8rem; margin-bottom: 1rem; background: linear-gradient(90deg, rgba(245, 158, 11, 0.12), transparent); flex-wrap: wrap; }
  .crown { background: linear-gradient(90deg, #f59e0b, #fde047); color: #1a1a1a; border-color: transparent; }
  .small { font-size: 0.8rem; }
</style>
