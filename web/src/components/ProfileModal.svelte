<script lang="ts">
  import { species } from '@poke-arena/engine';
  import { animatedSprite } from '../lib/sprites';
  import { store } from '../lib/store.svelte';
  import TypeBadge from './TypeBadge.svelte';

  let { playerId, onclose }: { playerId: string; onclose: () => void } = $props();

  const player = $derived(store.players.find((p) => p.id === playerId));
  const pokemon = $derived(store.allPokemon.filter((k) => k.player_id === playerId));
  const favorite = $derived([...pokemon].sort((a, b) => b.level - a.level)[0]);
  const battles = $derived(store.history.filter((b) => b.challenger_id === playerId || b.opponent_id === playerId));
  const ratingPath = $derived.by(() => {
    if (!player) return [] as number[];
    let r = player.rating;
    const path = [r];
    for (const b of battles) {
      r += b.winner_id === playerId ? -(b.rating_delta ?? 0) : b.rating_delta ?? 0;
      path.unshift(r);
    }
    return path;
  });
  const gym = $derived(store.gymOf(playerId));
  const badges = $derived(store.badgesOf(playerId));
  const titles = $derived(store.titlesOf(playerId));
  const owed = $derived(store.debts.filter((d) => !d.done_at && d.debtor_id === playerId).length);
  const owedTo = $derived(store.debts.filter((d) => !d.done_at && d.creditor_id === playerId).length);
  const streak = $derived.by(() => {
    let n = 0;
    for (const b of battles) {
      if (b.winner_id === playerId) n++;
      else break;
    }
    return n;
  });

  function sparkline(values: number[]): string {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = 240;
    const h = 48;
    return values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / Math.max(1, max - min)) * (h - 4) - 2}`).join(' ');
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel modal">
    {#if player}
      <div class="row" style="align-items: flex-start; gap: 1rem">
        {#if favorite}<img class="fav" src={animatedSprite(favorite.species_id, { shiny: favorite.shiny })} alt="" />{/if}
        <div style="flex: 1; min-width: 0">
          <h2 style="margin: 0">{player.name} {#if store.championId === playerId}<span class="badge champion">👑 Champion</span>{/if}</h2>
          <div class="muted">{player.rating} rating · {player.wins}W/{player.losses}V{#if streak >= 2} · {streak} op rij{/if}{#if gym} · leader {gym.name}{/if}</div>
          <div class="row" style="gap: 0.3rem; flex-wrap: wrap; margin-top: 0.4rem">
            {#each titles as t (t.code)}<span class="badge title">{t.label}</span>{/each}
          </div>
        </div>
        <button onclick={onclose}>Sluiten</button>
      </div>

      <div class="grid2">
        <div>
          <h3 class="small">Badges ({badges.length}/{store.gyms.length})</h3>
          <div class="pins">
            {#each store.gyms as g (g.id)}
              {@const has = badges.some((b) => b.gym_id === g.id)}
              <div class="pin type-{g.type}" class:has title={g.name}><TypeBadge type={g.type} small /></div>
            {/each}
          </div>
        </div>
        <div>
          <h3 class="small">Rating laatste {Math.min(battles.length, 60)} gevechten</h3>
          {#if ratingPath.length > 1}
            <svg viewBox="0 0 240 48" class="spark"><polyline points={sparkline(ratingPath)} fill="none" stroke="var(--accent)" stroke-width="2" /></svg>
          {:else}<p class="muted small">Nog geen gevechten.</p>{/if}
        </div>
      </div>

      <div class="grid2">
        <div>
          <h3 class="small">Inzetten</h3>
          <p class="muted small">Staat nog {owed} open, heeft er {owedTo} tegoed.</p>
        </div>
        <div>
          <h3 class="small">Pokémon ({pokemon.length})</h3>
          <div class="row" style="gap: 0.3rem; flex-wrap: wrap">
            {#each pokemon as k (k.id)}<span class="badge">{species(k.species_id).name} Lv {k.level}</span>{/each}
          </div>
        </div>
      </div>

      <h3 class="small">Laatste gevechten</h3>
      <ul>
        {#each battles.slice(0, 8) as b (b.id)}
          {@const won = b.winner_id === playerId}
          {@const opp = b.challenger_id === playerId ? b.opponent_id : b.challenger_id}
          <li class="row">
            <span class:win={won} class:loss={!won}>{won ? 'Winst' : 'Verlies'}</span>
            <span>tegen {store.nameOf(opp)}{#if b.gym_id} (gym){/if}</span>
            <span class="spacer"></span>
            <button onclick={() => { store.replaying = b; onclose(); }}>Replay</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; z-index: 10; padding: 1rem; }
  .modal { max-width: 640px; width: 100%; max-height: 90vh; overflow-y: auto; }
  .fav { width: 96px; height: 96px; object-fit: contain; image-rendering: pixelated; }
  .small { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 1rem 0 0.4rem; }
  .grid2 { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; }
  .pins { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .pin { border: 1px dashed var(--border); border-radius: 999px; padding: 0.25rem; opacity: 0.35; filter: grayscale(1); }
  .pin.has { opacity: 1; filter: none; border-style: solid; border-color: var(--accent); box-shadow: 0 0 10px rgba(255, 203, 5, 0.4); }
  .spark { width: 100%; height: 48px; }
  .champion { background: linear-gradient(90deg, #f59e0b, #fde047); color: #1a1a1a; border-color: transparent; }
  .title { border-color: var(--accent); color: var(--accent); }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.3rem; }
  .win { color: var(--success); font-weight: 700; } .loss { color: var(--danger); }
</style>
