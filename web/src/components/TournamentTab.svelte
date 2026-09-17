<script lang="ts">
  import { store } from '../lib/store.svelte';
  import ChallengeModal from './ChallengeModal.svelte';

  let name = $state('');
  let challenging = $state<{ opponentId: string; matchId: string } | null>(null);
  const t = $derived(store.tournament);
  const joined = $derived(store.tournamentPlayers.some((p) => p.player_id === store.me));
  const rounds = $derived([...new Set(store.tournamentMatches.map((m) => m.round))].sort((a, b) => a - b));
  const myMatch = $derived(store.tournamentMatches.find((m) => !m.winner_id && (m.p1 === store.me || m.p2 === store.me) && m.p1 && m.p2));

  function roundName(round: number): string {
    const total = rounds.length;
    if (round === total) return 'Finale';
    if (round === total - 1) return 'Halve finale';
    if (round === total - 2) return 'Kwartfinale';
    return `Ronde ${round}`;
  }
</script>

<section class="panel">
  {#if !t}
    <h2>Toernooi</h2>
    <p class="muted">Geen toernooi actief. Start er een: iedereen met een team kan zich inschrijven, jij start de bracket als de groep compleet is.</p>
    <form class="row" onsubmit={(e) => { e.preventDefault(); void store.rpc('create_tournament', { p_name: name }); name = ''; }}>
      <input placeholder="Naam, bijv. Vrijdagmiddag Cup" bind:value={name} minlength="3" required />
      <button class="primary" type="submit" disabled={!store.team.length}>Start toernooi</button>
    </form>
    {#if !store.team.length}<p class="muted small">Sla eerst een team op.</p>{/if}
  {:else}
    <div class="row" style="flex-wrap: wrap">
      <h2 style="margin: 0">{t.name}</h2>
      <span class="badge" class:active={t.status === 'running'}>{t.status === 'open' ? 'inschrijving open' : 'bezig'}</span>
      <span class="spacer"></span>
      {#if t.status === 'open'}
        {#if joined}
          <button onclick={() => store.rpc('leave_tournament', { p_tournament: t.id })}>Uitschrijven</button>
        {:else}
          <button class="primary" disabled={!store.team.length} onclick={() => store.rpc('join_tournament', { p_tournament: t.id })}>Inschrijven</button>
        {/if}
        {#if t.created_by === store.me}
          <button class="primary" disabled={store.tournamentPlayers.length < 2} onclick={() => store.rpc('start_tournament', { p_tournament: t.id })}>Bracket starten ({store.tournamentPlayers.length})</button>
        {/if}
      {/if}
      {#if t.created_by === store.me}
        <button class="danger" onclick={() => store.rpc('cancel_tournament', { p_tournament: t.id })}>Annuleren</button>
      {/if}
    </div>
    <p class="muted small" style="margin: 0.25rem 0 0.75rem">Organisator: {store.nameOf(t.created_by)}. Enkele eliminatie, seeding op rating. Wedstrijden speel je via een gewone uitdaging vanuit deze tab; de winnaar gaat door.</p>

    {#if t.status === 'open'}
      <h3 style="font-size: 0.9rem">Deelnemers ({store.tournamentPlayers.length})</h3>
      <div class="chips">
        {#each store.tournamentPlayers as p (p.player_id)}<span class="badge">{store.nameOf(p.player_id)}</span>{/each}
      </div>
    {:else}
      {#if myMatch}
        {@const opp = myMatch.p1 === store.me ? myMatch.p2! : myMatch.p1!}
        <div class="callout row">
          <span>Jouw wedstrijd: <strong>{store.nameOf(opp)}</strong> ({roundName(myMatch.round)})</span>
          <span class="spacer"></span>
          <button class="primary" disabled={store.statusOf(opp) !== 'online' || Boolean(store.outgoing)} onclick={() => (challenging = { opponentId: opp, matchId: myMatch.id })}>
            {store.statusOf(opp) === 'online' ? 'Speel nu' : store.statusOf(opp) === 'battle' ? 'Tegenstander in gevecht' : 'Tegenstander offline'}
          </button>
        </div>
      {/if}
      <div class="bracket">
        {#each rounds as r (r)}
          <div class="round">
            <h3 class="small muted" style="text-transform: uppercase; letter-spacing: 0.08em">{roundName(r)}</h3>
            {#each store.tournamentMatches.filter((m) => m.round === r) as m (m.id)}
              <div class="match" class:done={Boolean(m.winner_id)}>
                <div class:winner={m.winner_id && m.winner_id === m.p1} class:loser={m.winner_id && m.winner_id !== m.p1}>{m.p1 ? store.nameOf(m.p1) : '—'}</div>
                <div class:winner={m.winner_id && m.winner_id === m.p2} class:loser={m.winner_id && m.winner_id !== m.p2}>{m.p2 ? store.nameOf(m.p2) : m.winner_id ? 'bye' : '—'}</div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if store.pastTournaments.length}
    <h3 class="small muted" style="margin-top: 1.25rem; text-transform: uppercase; letter-spacing: 0.08em">Eerdere toernooien</h3>
    <ul class="muted small">
      {#each store.pastTournaments as p (p.id)}
        <li>{p.name}: winnaar <strong>{p.winner_id ? store.nameOf(p.winner_id) : '?'}</strong> ({new Date(p.finished_at!).toLocaleDateString('nl-NL')})</li>
      {/each}
    </ul>
  {/if}
</section>

{#if challenging}
  <ChallengeModal opponentId={challenging.opponentId} tournamentMatch={challenging.matchId} onclose={() => (challenging = null)} />
{/if}

<style>
  .small { font-size: 0.8rem; }
  .chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .callout { border: 1px solid var(--accent); border-radius: var(--radius-sm); padding: 0.6rem 0.8rem; margin-bottom: 1rem; }
  .bracket { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 0.5rem; }
  .round { display: flex; flex-direction: column; gap: 0.6rem; min-width: 180px; justify-content: space-around; }
  .match { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
  .match > div { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--border); }
  .match > div:last-child { border-bottom: none; }
  .match .winner { color: var(--success); font-weight: 700; }
  .match .loser { opacity: 0.5; text-decoration: line-through; }
  ul { padding-left: 1rem; margin: 0.25rem 0 0; }
</style>
