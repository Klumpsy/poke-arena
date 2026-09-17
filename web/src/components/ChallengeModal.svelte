<script lang="ts">
  import { store } from '../lib/store.svelte';
  import TypeBadge from './TypeBadge.svelte';

  let { opponentId, gymId = null, onclose }: { opponentId: string; gymId?: string | null; onclose: () => void } = $props();

  let stake = $state('');
  let busy = $state(false);
  // svelte-ignore state_referenced_locally
  let asGym = $state(Boolean(gymId));

  const opponentGym = $derived(store.gymOf(opponentId));
  const cooldown = $derived(opponentGym ? store.cooldownFor(opponentGym.id) : undefined);
  const hasBadge = $derived(Boolean(opponentGym && store.badgesOf(store.me!).some((b) => b.gym_id === opponentGym.id)));

  async function send() {
    busy = true;
    const ok = await store.challenge(opponentId, asGym && opponentGym ? opponentGym.id : null, stake.trim() || null);
    busy = false;
    if (ok) onclose();
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel modal">
    <h2 style="margin: 0 0 0.5rem">Uitdagen: {store.nameOf(opponentId)}</h2>
    {#if opponentGym}
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
  label.block input { margin-top: 0.3rem; }
</style>
