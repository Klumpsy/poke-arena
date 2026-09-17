<script lang="ts">
  import { store } from '../lib/store.svelte';
  import TypeBadge from './TypeBadge.svelte';

  let { opponentId, gymId = null, tournamentMatch = null, onclose }: { opponentId: string; gymId?: string | null; tournamentMatch?: string | null; onclose: () => void } = $props();
  const TEMPLATES = ['Verliezer haalt koffie voor het team', 'Verliezer trakteert op lunch', 'Verliezer doet de standup', 'Verliezer haalt vrijdagmiddagborrel', 'Verliezer draagt een dag de Pikachu-muts'];

  let stake = $state('');
  let busy = $state(false);
  // svelte-ignore state_referenced_locally
  let asGym = $state(Boolean(gymId));

  const opponentGym = $derived(store.gymOf(opponentId));
  const cooldown = $derived(opponentGym ? store.cooldownFor(opponentGym.id) : undefined);
  const hasBadge = $derived(Boolean(opponentGym && store.badgesOf(store.me!).some((b) => b.gym_id === opponentGym.id)));
  const canChampion = $derived(!tournamentMatch && store.badgesOf(store.me!).length >= store.gyms.length && store.gyms.length > 0 && (store.championId ? store.championId === opponentId : store.players[0]?.id === opponentId));
  let asChampion = $state(false);

  async function send() {
    busy = true;
    const ok = await store.challenge(opponentId, asGym && opponentGym && !tournamentMatch ? opponentGym.id : null, stake.trim() || null, { tournamentMatch: tournamentMatch ?? undefined, champion: asChampion });
    busy = false;
    if (ok) onclose();
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel modal">
    <h2 style="margin: 0 0 0.5rem">Uitdagen: {store.nameOf(opponentId)}</h2>
    {#if tournamentMatch}<p><span class="badge active">Toernooiwedstrijd</span> De winnaar gaat door naar de volgende ronde.</p>{/if}
    {#if canChampion}
      <label class="opt">
        <input type="checkbox" bind:checked={asChampion} />
        <span><strong>👑 Champion-gevecht</strong> <span class="muted block">Jij hebt alle badges. Win en je bent de nieuwe Champion.</span></span>
      </label>
    {/if}
    {#if opponentGym && !tournamentMatch}
      <label class="opt" class:disabled={Boolean(cooldown)}>
        <input type="checkbox" bind:checked={asGym} disabled={Boolean(cooldown)} />
        <span>
          <strong>Gym-uitdaging</strong> voor {opponentGym.name} <TypeBadge type={opponentGym.type} small />
          <span class="muted block">Win je, dan krijg je de badge{hasBadge ? ' (heb je al)' : ''} en neem je de gym over. Verlies je, dan mag je deze gym 24 uur niet uitdagen.</span>
          {#if cooldown}<span class="error block">Nog wachten tot {new Date(cooldown.until).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}.</span>{/if}
        </span>
      </label>
    {/if}
    <label class="block" style="margin-top: 0.75rem">
      <span class="muted">Inzet (optioneel)</span>
      <input type="text" maxlength="140" placeholder="bijv. verliezer haalt koffie voor iedereen" bind:value={stake} />
    </label>
    <div class="chips">
      {#each TEMPLATES as t (t)}<button type="button" class="chip" class:on={stake === t} onclick={() => (stake = stake === t ? '' : t)}>{t.replace('Verliezer ', '')}</button>{/each}
    </div>
    <p class="muted" style="font-size: 0.8rem">Accepteert de ander, dan is de inzet afgesproken. Na afloop staat hij bij de verliezer in "Inzetten" tot hij is afgevinkt.</p>
    {#if store.error}<p class="error">{store.error}</p>{/if}
    <div class="row" style="margin-top: 0.75rem">
      <span class="spacer"></span>
      <button onclick={onclose}>Annuleren</button>
      <button class="primary" disabled={busy} onclick={send}>Verstuur uitdaging</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; z-index: 10; padding: 1rem; }
  .modal { max-width: 480px; width: 100%; }
  .opt { display: flex; gap: 0.6rem; align-items: flex-start; padding: 0.6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
  .opt.disabled { opacity: 0.6; }
  .opt input { margin-top: 0.3rem; }
  .block { display: block; }
  .chips { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.4rem; }
  .chip { font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px; }
  .chip.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  label.block input { margin-top: 0.3rem; }
</style>
