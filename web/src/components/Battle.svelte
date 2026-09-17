<script lang="ts">
  import { describe, legalActions, move as moveData, moveEffectiveness, other, pendingActors, type Action, type BattleEvent, type BattleState, type Side } from '@poke-arena/engine';
  import { onMount } from 'svelte';
  import { fetchActions, replayBattle, submitAction, watchBattle, type ReplayResult } from '../lib/battleClient';
  import { battleOptions, TERRAIN_LABEL, WEATHER_LABEL } from '../lib/gymField';
  import { play } from '../lib/sound';
  import { supabase } from '../lib/supabase';
  import { animatedSprite, preloadSprites, staticSprite } from '../lib/sprites';
  import { store } from '../lib/store.svelte';
  import { sideOf, type BattleRow } from '../lib/types';
  import HpBar from './HpBar.svelte';

  let { battle, mode = 'play' }: { battle: BattleRow; mode?: 'play' | 'spectate' | 'replay' } = $props();

  const me = store.me!;
  // svelte-ignore state_referenced_locally
  const playing = mode === 'play';
  // svelte-ignore state_referenced_locally
  const mySide: Side = playing ? sideOf(battle, me) : 'a';
  const oppSide: Side = other(mySide);
  // svelte-ignore state_referenced_locally
  const myId = mySide === 'a' ? battle.challenger_id : battle.opponent_id;
  // svelte-ignore state_referenced_locally
  const oppId = mySide === 'a' ? battle.opponent_id : battle.challenger_id;
  // svelte-ignore state_referenced_locally
  const options = battleOptions(battle, store.gyms);
  let replayQueue = $state<ReplayResult | null>(null);
  let autoplay = $state(true);

  let replay = $state<ReplayResult | null>(null);
  let view = $state<BattleState | null>(null);
  let log = $state<string[]>([]);
  let playedTurns = $state(0);
  let animating = $state(false);
  let fx = $state<Record<Side, string>>({ a: '', b: '' });
  let busy = $state(false);
  let finishedReported = false;
  let spriteFallback = $state<Record<Side, boolean>>({ a: false, b: false });
  let burst = $state<{ side: Side; type: string; key: number } | null>(null);
  let popup = $state<{ side: Side; text: string; cls: string; key: number } | null>(null);
  let fieldShake = $state(false);
  let confirmForfeit = $state(false);
  let abandon = $state<{ claimable: boolean; secondsLeft: number; opponentSeenAgo: number } | null>(null);
  let gymTaken = $state(false);

  const controlsOpen = $derived(playing && Boolean(view && replay && !animating && view.phase !== 'finished' && pendingActors(view).includes(mySide) && !replay.submitted[mySide]));
  const waiting = $derived(playing && Boolean(view && replay && !animating && view.phase !== 'finished' && !controlsOpen));
  const finished = $derived(Boolean(view && !animating && view.phase === 'finished'));
  const myLegal = $derived(view ? legalActions(view, mySide) : []);
  const gym = $derived(battle.gym_id ? store.gyms.find((g) => g.id === battle.gym_id) : null);
  const finishedRow = $derived(store.activeBattle?.id === battle.id ? store.activeBattle : battle);
  const rowFinished = $derived(finishedRow.status === 'finished' && Boolean(view) && view!.phase !== 'finished');
  const disputed = $derived(finishedRow.status === 'disputed');
  const awaitingConfirm = $derived(playing && finished && finishedRow.status === 'active' && view?.winner === mySide);
  const offeredGym = $derived(finishedRow.gym_offer ? store.gyms.find((g) => g.id === finishedRow.gym_offer) : null);
  const iWon = $derived(finishedRow.winner_id === me);
  const myGym = $derived(store.gymOf(me));

  async function checkAbandon() {
    if (!waiting && !awaitingConfirm) {
      abandon = null;
      return;
    }
    const { data } = await supabase.rpc('abandon_check', { p_battle: battle.id });
    abandon = (data as typeof abandon) ?? null;
  }

  function effectivenessLabel(slug: string): { text: string; cls: string } | null {
    if (!view) return null;
    const eff = moveEffectiveness(slug, active(oppSide).types);
    if (eff === null || eff === 1) return null;
    if (eff === 0) return { text: 'geen effect', cls: 'eff-none' };
    if (eff > 1) return { text: 'super effectief', cls: 'eff-super' };
    return { text: 'niet effectief', cls: 'eff-weak' };
  }

  async function refresh() {
    try {
      if (playing) {
        void store.loadBattles();
        void supabase.rpc('heartbeat');
      } else if (mode === 'spectate') {
        const { data } = await supabase.from('battles').select('*').eq('id', battle.id).maybeSingle();
        if (data) battle = data as BattleRow;
      }
      const actions = await fetchActions(battle.id);
      const full = replayBattle(battle, actions, options);
      if (mode === 'replay') {
        replayQueue = full;
        if (!view) {
          view = createViewStart(full);
          replay = { ...full, turns: [], states: [] };
        }
        if (autoplay) void stepReplay();
        return;
      }
      replay = full;
      if (!view) {
        const skipAnimation = playing || full.turns.length > 3;
        view = skipAnimation && full.turns.length ? full.states[full.turns.length - 1] : skipAnimation ? full.state : createViewStart(full);
        playedTurns = skipAnimation ? full.turns.length : 0;
        if (playedTurns) log = full.turns.flat().filter((e) => e.type !== 'end').map(describe);
      }
      void animateNewTurns();
    } catch (e) {
      store.error = (e as Error).message;
    }
  }

  const DELAY: Partial<Record<BattleEvent['type'], number>> = { turn: 400, move: 900, damage: 900, faint: 1000, switch: 800, end: 600, weather: 700, terrain: 700, ability: 800, protect: 700, charge: 800 };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function createViewStart(full: ReplayResult): BattleState {
    const base = replayBattle(battle, [], options).state;
    return structuredClone(base);
  }

  async function stepReplay() {
    if (!replayQueue || !replay || animating) return;
    if (playedTurns >= replayQueue.turns.length) return;
    replay = { ...replayQueue, turns: replayQueue.turns.slice(0, playedTurns + 1), states: replayQueue.states.slice(0, playedTurns + 1) };
    await animateNewTurns();
    if (autoplay && replayQueue && playedTurns < replayQueue.turns.length) void stepReplay();
  }

  async function animateNewTurns() {
    if (animating || !replay) return;
    animating = true;
    while (replay && playedTurns < replay.turns.length) {
      const events = replay.turns[playedTurns];
      for (const e of events) {
        if (e.type !== 'end') log = [...log, describe(e)];
        applyEventToView(e);
        await sleep(DELAY[e.type] ?? 650);
      }
      view = replay.states[playedTurns];
      playedTurns += 1;
    }
    animating = false;
    if (view?.phase === 'finished' && !finishedReported) {
      finishedReported = true;
      play(view.winner === mySide ? 'win' : 'lose');
      if (playing) {
        const winnerId = view.winner === mySide ? me : oppId;
        await store.finishBattle(battle.id, winnerId);
      }
    }
  }

  function showPopup(side: Side, text: string, cls: string) {
    popup = { side, text, cls, key: Date.now() };
    setTimeout(() => (popup = null), 900);
  }

  function flash(side: Side, cls: string, ms = 700) {
    fx = { ...fx, [side]: cls };
    setTimeout(() => (fx = { ...fx, [side]: '' }), ms);
  }

  function applyEventToView(e: BattleEvent) {
    if (!view) return;
    switch (e.type) {
      case 'move':
        flash(e.side, e.side === mySide ? 'lunge-mine' : 'lunge-opp');
        if (e.category !== 'status') {
          burst = { side: other(e.side), type: e.moveType, key: Date.now() };
          setTimeout(() => (burst = null), 800);
        } else {
          burst = { side: e.side, type: e.moveType, key: Date.now() };
          setTimeout(() => (burst = null), 800);
        }
        break;
      case 'damage':
        if (e.amount > 0) {
          flash(e.side, 'hit');
          play(e.crit ? 'crit' : e.effectiveness > 1 ? 'super' : 'hit');
        }
        if (e.crit) {
          fieldShake = true;
          setTimeout(() => (fieldShake = false), 600);
        }
        if (e.effectiveness > 1) showPopup(e.side, e.crit ? 'Critical! Super effectief!' : 'Super effectief!', 'pop-super');
        else if (e.effectiveness === 0) showPopup(e.side, 'Geen effect', 'pop-none');
        else if (e.effectiveness < 1) showPopup(e.side, 'Niet zo effectief', 'pop-weak');
        else if (e.crit) showPopup(e.side, 'Critical hit!', 'pop-super');
        view.sides[e.side].team[view.sides[e.side].active].hp = e.hp;
        break;
      case 'stat':
        showPopup(e.side, `${e.stat.toUpperCase()} ${e.change > 0 ? '↑' : e.change < 0 ? '↓' : '–'}`, e.change > 0 ? 'pop-super' : 'pop-weak');
        break;
      case 'miss':
        showPopup(e.side === mySide ? oppSide : mySide, 'Mis!', 'pop-none');
        break;
      case 'heal':
        flash(e.side, 'heal');
        play('heal');
        view.sides[e.side].team[view.sides[e.side].active].hp = e.hp;
        break;
      case 'status':
        view.sides[e.side].team[view.sides[e.side].active].status = e.status;
        flash(e.side, `status-${e.status}`, 900);
        play('status');
        break;
      case 'protect':
        showPopup(e.side, 'Beschermd', 'pop-none');
        play('protect');
        break;
      case 'charge':
        showPopup(e.side, 'Laadt op...', 'pop-none');
        break;
      case 'weather':
        if (e.text !== 'residual') view.field.weather = e.text === 'start' ? e.weather : 'none';
        break;
      case 'terrain':
        view.field.terrain = e.text === 'start' ? e.terrain : 'none';
        break;
      case 'ability':
        showPopup(e.side, describe(e).split(' van ')[0], 'pop-super');
        break;
      case 'cure':
        view.sides[e.side].team[view.sides[e.side].active].status = 'none';
        break;
      case 'faint':
        flash(e.side, 'faint', 1000);
        play('faint');
        break;
      case 'switch':
        view.sides[e.side].active = e.slot;
        spriteFallback = { ...spriteFallback, [e.side]: false };
        play('switch');
        break;
    }
  }

  async function act(action: Action) {
    if (!view || busy) return;
    busy = true;
    try {
      await submitAction(battle.id, view.turn + 1, me, action);
      await refresh();
    } catch (e) {
      store.error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    const teams = [...(battle.challenger_team?.pokemon ?? []).map((p) => ({ speciesId: p.speciesId, shiny: p.shiny, back: mySide === 'a' })), ...(battle.opponent_team?.pokemon ?? []).map((p) => ({ speciesId: p.speciesId, shiny: p.shiny, back: mySide === 'b' }))];
    preloadSprites(teams);
    void refresh();
    if (mode === 'replay') return;
    const channel = watchBattle(battle.id, () => void refresh());
    const poll = setInterval(() => void refresh(), 4000);
    const abandonPoll = playing ? setInterval(() => void checkAbandon(), 10000) : null;
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(poll);
      if (abandonPoll) clearInterval(abandonPoll);
    };
  });

  function leave() {
    if (mode === 'spectate') store.watching = null;
    else if (mode === 'replay') store.replaying = null;
    else store.leaveBattle();
  }

  function active(side: Side) {
    return view!.sides[side].team[view!.sides[side].active];
  }
  function spriteFor(side: Side) {
    const p = active(side);
    const back = side === mySide;
    return spriteFallback[side] ? staticSprite(p.speciesId, { back, shiny: p.shiny }) : animatedSprite(p.speciesId, { back, shiny: p.shiny });
  }
</script>

{#if !view}
  <p class="muted pixel" style="animation: pulse 1.2s infinite">Arena laden...</p>
{:else}
  <div class="battle">
    <header class="row" style="margin-bottom: 0.5rem">
      <h1 class="pixel" style="font-size: 0.9rem; margin: 0">{store.nameOf(myId)} vs {store.nameOf(oppId)}</h1>
      {#if mode === 'spectate'}<span class="badge">je kijkt mee</span>{/if}
      {#if mode === 'replay'}<span class="badge">replay</span>{/if}
      {#if gym}<span class="badge active">Gym-uitdaging · {gym.name}</span>{/if}
      {#if battle.champion_match}<span class="badge champion">👑 Champion-gevecht</span>{/if}
      {#if battle.tournament_match_id}<span class="badge">toernooi</span>{/if}
      {#if view.field.weather !== 'none'}<span class="badge weather-{view.field.weather}">{WEATHER_LABEL[view.field.weather]}</span>{/if}
      {#if view.field.terrain !== 'none'}<span class="badge terrain-{view.field.terrain}">{TERRAIN_LABEL[view.field.terrain]}</span>{/if}
      {#if mode !== 'play'}<button class="subtle" onclick={leave}>Sluiten</button>{/if}
      {#if battle.stake}<span class="badge" title="Inzet">inzet: {battle.stake}</span>{/if}
      <span class="spacer"></span>
      <span class="muted">Beurt {view.turn}</span>
    </header>

    <div class="field weather-{view.field.weather} terrain-{view.field.terrain}" class:shake={fieldShake}>
      {#if burst}
        {#key burst.key}<div class="burst {burst.side === mySide ? 'at-mine' : 'at-opp'} burst-{burst.type}"></div>{/key}
      {/if}
      {#if popup}
        {#key popup.key}<div class="popup {popup.side === mySide ? 'at-mine' : 'at-opp'} {popup.cls}">{popup.text}</div>{/key}
      {/if}
      <div class="side opp">
        <div class="balls">{#each view.sides[oppSide].team as p}<span class="ball" class:ko={p.hp <= 0}></span>{/each}</div>
        <HpBar hp={active(oppSide).hp} maxHp={active(oppSide).maxHp} name={active(oppSide).name} level={active(oppSide).level} status={active(oppSide).status} types={active(oppSide).types} shiny={active(oppSide).shiny} />
        <div class="sprite-wrap opp" class:shiny={active(oppSide).shiny}>
          {#if active(oppSide).shiny}<div class="sparkles">{#each Array(7) as _, i}<span style="--i: {i}"></span>{/each}</div>{/if}
          <img class="sprite {fx[oppSide]}" src={spriteFor(oppSide)} alt={active(oppSide).name} onerror={() => (spriteFallback = { ...spriteFallback, [oppSide]: true })} />
        </div>
      </div>
      <div class="side mine">
        <div class="sprite-wrap mine" class:shiny={active(mySide).shiny}>
          {#if active(mySide).shiny}<div class="sparkles">{#each Array(7) as _, i}<span style="--i: {i}"></span>{/each}</div>{/if}
          <img class="sprite {fx[mySide]}" src={spriteFor(mySide)} alt={active(mySide).name} onerror={() => (spriteFallback = { ...spriteFallback, [mySide]: true })} />
        </div>
        <HpBar mine={playing} hp={active(mySide).hp} maxHp={active(mySide).maxHp} name={active(mySide).name} level={active(mySide).level} status={active(mySide).status} types={active(mySide).types} shiny={active(mySide).shiny} ability={playing ? active(mySide).ability : undefined} />
        <div class="balls">{#each view.sides[mySide].team as p}<span class="ball" class:ko={p.hp <= 0}></span>{/each}</div>
      </div>
    </div>

    <div class="bottom">
      <div class="panel log">
        {#each log.slice(-8) as line, i (log.length - 8 + i)}
          <div class:muted={i < log.slice(-8).length - 1}>{line}</div>
        {/each}
        {#if !log.length}<div class="muted">Het gevecht begint! Kies je eerste move.</div>{/if}
      </div>

      <div class="panel controls">
        {#if mode === 'replay'}
          <p class="muted">Replay van {new Date(battle.finished_at ?? battle.created_at).toLocaleString('nl-NL')}. Winnaar: <strong>{store.nameOf(battle.winner_id!)}</strong>.</p>
          <div class="row" style="flex-wrap: wrap">
            <button class="primary" disabled={animating || !replayQueue || playedTurns >= (replayQueue?.turns.length ?? 0)} onclick={() => { autoplay = false; void stepReplay(); }}>Volgende beurt</button>
            <button onclick={() => { autoplay = !autoplay; if (autoplay) void stepReplay(); }}>{autoplay ? 'Pauze' : 'Automatisch afspelen'}</button>
            <span class="muted small">Beurt {playedTurns}/{replayQueue?.turns.length ?? 0}</span>
            <span class="spacer"></span>
            <button onclick={leave}>Sluiten</button>
          </div>
        {:else if mode === 'spectate'}
          {#if finished || finishedRow.status === 'finished'}
            <h2 class="pixel" style="font-size: 1rem">{store.nameOf(finishedRow.winner_id ?? (view.winner === 'a' ? battle.challenger_id : battle.opponent_id))} wint!</h2>
            <button class="primary" onclick={leave}>Terug</button>
          {:else}
            <p class="muted" style="animation: pulse 1.5s infinite">Live: wachten op de volgende beurt...</p>
          {/if}
        {:else if disputed}
          <h2 class="pixel" style="font-size: 1rem">Onbeslist</h2>
          <p class="muted">Jullie browsers waren het niet eens over de uitslag. Geen rating-verandering. Speel het gerust opnieuw.</p>
          <button class="primary" onclick={() => store.leaveBattle()}>Terug naar lobby</button>
        {:else if awaitingConfirm && !rowFinished}
          <h2 class="pixel" style="font-size: 1rem">Gewonnen!</h2>
          <p class="muted" style="animation: pulse 1.5s infinite">Wacht op bevestiging van {store.nameOf(oppId)}...</p>
          {#if abandon?.claimable}
            <button class="primary" onclick={() => store.claimAbandoned(battle.id)}>Tegenstander is weg, bevestig zelf</button>
          {/if}
        {:else if rowFinished || finished}
          {@const won = rowFinished ? iWon : view.winner === mySide}
          <h2 class="pixel" style="font-size: 1rem">{won ? 'Gewonnen!' : 'Verloren...'}</h2>
          {#if rowFinished && view.phase !== 'finished'}
            <p class="muted">{won ? `${store.nameOf(oppId)} heeft opgegeven of is weggegaan.` : 'Je hebt opgegeven.'}</p>
          {/if}
          {#if battle.champion_match}
            <p>{won && mySide === 'a' ? '👑 Jij bent de nieuwe Champion!' : won ? 'Je verdedigt je Champion-titel.' : mySide === 'a' ? 'De Champion houdt stand.' : `${store.nameOf(oppId)} is de nieuwe Champion.`}</p>
          {/if}
          {#if battle.tournament_match_id}
            <p>{won ? 'Je gaat door naar de volgende ronde van het toernooi.' : 'Je ligt uit het toernooi.'}</p>
          {/if}
          {#if finishedRow.rating_delta}
            <p class="muted">Rating {won ? '+' : '-'}{finishedRow.rating_delta}</p>
          {/if}
          {#if gym}
            {#if won && mySide === 'a'}
              <p>Badge van {gym.name} verdiend! {store.gymOf(me)?.id === gym.id ? 'Jij bent nu de leader.' : `Zonder ${gym.type}-type in je team blijft de gym leeg.`}</p>
            {:else if won}
              <p>Je verdedigt {gym.name} met succes.</p>
            {:else if mySide === 'a'}
              <p>Geen badge. Over 24 uur mag je {gym.name} opnieuw uitdagen.</p>
            {:else}
              <p>{store.nameOf(oppId)} verdient de badge en neemt {gym.name} over.</p>
            {/if}
          {:else if won && offeredGym}
            <p>Je hebt de leader van <strong>{offeredGym.name}</strong> verslagen: badge verdiend!</p>
            {#if gymTaken}
              <p class="muted">Jij bent nu leader van {offeredGym.name}.</p>
            {:else if store.teamHasType(offeredGym.type)}
              <button class="primary" style="margin-bottom: 0.5rem" onclick={async () => { gymTaken = await store.takeOfferedGym(battle.id); }}>
                {myGym ? `Wissel van ${myGym.name} naar ${offeredGym.name}` : `Neem ${offeredGym.name} over`}
              </button>
            {:else}
              <p class="muted">Om {offeredGym.name} over te nemen heb je een {offeredGym.type}-type in je team nodig. Pas je team aan en versla de leader nog eens.</p>
            {/if}
          {:else if !won && store.gymOf(me) && !gym}
            <p class="muted">{store.nameOf(oppId)} verdient een badge en mag je gym overnemen.</p>
          {/if}
          {#if battle.stake}
            <p>Inzet: "{battle.stake}". {won ? `${store.nameOf(oppId)} is je die verschuldigd.` : 'Die ben jij nu verschuldigd, zie Inzetten.'}</p>
          {/if}
          <button class="primary" onclick={() => store.leaveBattle()}>Terug naar lobby</button>
        {:else if controlsOpen && view.phase === 'replace'}
          <p>Kies je volgende Pokémon:</p>
          <div class="moves">
            {#each myLegal as a}
              {#if a.type === 'switch'}
                {@const p = view.sides[mySide].team[a.slot]}
                <button disabled={busy} onclick={() => act(a)}>{p.name} <span class="muted">Lv {p.level} · {p.hp}/{p.maxHp}</span></button>
              {/if}
            {/each}
          </div>
        {:else if controlsOpen}
          <div class="moves">
            {#each myLegal as a}
              {#if a.type === 'move'}
                {#if a.moveIndex < 0}
                  <button class="move type-normal" disabled={busy} onclick={() => act(a)}>Struggle</button>
                {:else}
                  {@const slot = active(mySide).moves[a.moveIndex]}
                  {@const m = moveData(slot.slug)}
                  {@const eff = effectivenessLabel(slot.slug)}
                  <button class="move type-{m.type}" disabled={busy} onclick={() => act(a)} title={m.effect}>
                    <strong>{m.name} {#if eff}<span class="eff {eff.cls}">{eff.text}</span>{/if}</strong>
                    <span class="meta">{m.type} · {m.category === 'status' ? 'status' : `${m.power ?? '-'} pow`} · {m.accuracy ?? '-'}% · PP {slot.pp}/{slot.maxPp}</span>
                  </button>
                {/if}
              {/if}
            {/each}
          </div>
          {#if myLegal.some((a) => a.type === 'switch')}
            <div class="switches">
              <span class="muted" style="font-size: 0.8rem">Wisselen (gaat vóór de aanval van de tegenstander):</span>
              {#each myLegal as a}
                {#if a.type === 'switch'}
                  {@const p = view.sides[mySide].team[a.slot]}
                  <button disabled={busy} onclick={() => act(a)}>{p.name} <span class="muted">Lv {p.level} · {p.hp}/{p.maxHp}</span> {#each p.types as t}<span class="badge type type-{t}" style="font-size: 0.6rem">{t}</span>{/each}</button>
                {/if}
              {/each}
            </div>
          {/if}
        {:else if waiting}
          <p class="muted" style="animation: pulse 1.5s infinite">Wacht op {store.nameOf(oppId)}...</p>
          {#if abandon?.claimable}
            <p class="error" style="font-size: 0.85rem">{store.nameOf(oppId)} is al meer dan 2 minuten weg.</p>
            <button class="primary" onclick={() => store.claimAbandoned(battle.id)}>Claim de overwinning</button>
          {:else if abandon && abandon.opponentSeenAgo >= 30}
            <p class="muted" style="font-size: 0.8rem">{store.nameOf(oppId)} lijkt weg ({abandon.opponentSeenAgo}s geen teken van leven). Na 2 minuten stilte mag je de winst claimen, nog {abandon.secondsLeft}s.</p>
          {/if}
        {:else}
          <p class="muted">...</p>
        {/if}
        {#if store.error}<p class="error" style="font-size: 0.85rem">{store.error} <button class="subtle" onclick={() => (store.error = null)}>ok</button></p>{/if}
        {#if playing && !finished && !rowFinished && !disputed}
          <div class="forfeit">
            {#if confirmForfeit}
              <span class="muted" style="font-size: 0.85rem">Zeker? Dit telt als verlies.</span>
              <button class="danger" onclick={() => store.forfeit(battle.id)}>Ja, opgeven</button>
              <button onclick={() => (confirmForfeit = false)}>Nee</button>
            {:else}
              <button class="subtle" onclick={() => (confirmForfeit = true)}>Opgeven</button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .battle { max-width: 900px; margin: 0 auto; }
  .field {
    position: relative; height: 380px; border-radius: var(--radius); overflow: hidden;
    background: linear-gradient(180deg, #4c7be0 0%, #8fd0ff 45%, #5fb85f 46%, #3f8f3f 100%);
    border: 1px solid var(--border); box-shadow: var(--shadow);
  }
  .side { position: absolute; display: grid; gap: 0.5rem; }
  .side.opp { top: 1rem; left: 1rem; right: 1rem; grid-template-columns: auto 1fr; align-items: start; }
  .sprite-wrap { position: absolute; }
  .sprite-wrap.opp { right: 8%; top: 20px; }
  .sprite-wrap.mine { left: 8%; bottom: 60px; }
  .sprite-wrap .sprite { position: static; }
  .sprite-wrap.shiny .sprite { filter: drop-shadow(0 12px 8px rgba(0, 0, 0, 0.35)) drop-shadow(0 0 14px rgba(255, 215, 0, 0.75)); animation: float 3s ease-in-out infinite, shiny-glow 2s ease-in-out infinite; }
  .sparkles { position: absolute; inset: -20px; pointer-events: none; z-index: 2; }
  .sparkles span { position: absolute; width: 10px; height: 10px; background: radial-gradient(circle, #fff 0 30%, #ffd700 60%, transparent 70%); clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%); animation: sparkle 1.8s ease-in-out infinite; animation-delay: calc(var(--i) * 0.26s); }
  .sparkles span:nth-child(1) { left: 5%; top: 10%; } .sparkles span:nth-child(2) { left: 80%; top: 5%; } .sparkles span:nth-child(3) { left: 95%; top: 45%; }
  .sparkles span:nth-child(4) { left: 15%; top: 60%; } .sparkles span:nth-child(5) { left: 60%; top: 85%; } .sparkles span:nth-child(6) { left: 40%; top: 0%; } .sparkles span:nth-child(7) { left: 0%; top: 90%; }
  .side.opp .sprite { position: absolute; right: 8%; top: 20px; }
  .side.opp .balls { grid-column: 1 / -1; }
  .side.mine { bottom: 1rem; left: 1rem; right: 1rem; justify-items: end; }
  .side.mine .sprite { position: absolute; left: 8%; bottom: 60px; }
  .sprite { image-rendering: pixelated; height: 150px; width: auto; max-width: 220px; object-fit: contain; filter: drop-shadow(0 12px 8px rgba(0, 0, 0, 0.35)); animation: float 3s ease-in-out infinite; }
  .sprite.hit { animation: shake 0.5s ease, flash 0.5s ease; }
  .sprite.lunge-mine { animation: lunge-right 0.6s ease; }
  .sprite.lunge-opp { animation: lunge-left 0.6s ease; }
  .sprite.faint { animation: faint 0.9s ease forwards; }
  .sprite.heal { filter: drop-shadow(0 0 18px var(--success)); }
  .balls { display: flex; gap: 0.3rem; }
  .ball { width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 30% 30%, #fff 0 25%, #e33 26% 60%, #222 61%); }
  .ball.ko { filter: grayscale(1) brightness(0.5); }
  .bottom { display: grid; gap: 1rem; margin-top: 1rem; }
  @media (min-width: 760px) { .bottom { grid-template-columns: 1fr 1fr; } }
  .log { min-height: 160px; font-size: 0.92rem; display: flex; flex-direction: column; justify-content: flex-end; }
  .moves { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .move { display: grid; text-align: left; color: #fff; border-color: transparent; padding: 0.6rem 0.8rem; }
  .move .meta { font-size: 0.72rem; opacity: 0.9; text-transform: capitalize; }
  .eff { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.1rem 0.4rem; border-radius: 999px; background: rgba(0, 0, 0, 0.35); margin-left: 0.3rem; }
  .eff-super { color: #86efac; } .eff-weak { color: #fca5a5; } .eff-none { color: #d4d4d8; }
  .field.shake { animation: shake 0.5s ease; }
  .field.weather-sun { background: linear-gradient(180deg, #f6b73c 0%, #ffe29a 45%, #7cc25a 46%, #3f8f3f 100%); }
  .field.weather-rain { background: linear-gradient(180deg, #2b3a67 0%, #4d6a9a 45%, #3f7a4a 46%, #2d5a33 100%); }
  .field.weather-sand { background: linear-gradient(180deg, #c9a15a 0%, #e7cf8a 45%, #b8944a 46%, #8a6b2f 100%); }
  .field.weather-hail { background: linear-gradient(180deg, #8fb3d9 0%, #dbe9f7 45%, #e9f2fb 46%, #b9cfe3 100%); }
  .field.terrain-electric { box-shadow: inset 0 -60px 80px rgba(247, 208, 44, 0.45), var(--shadow); }
  .field.terrain-grassy { box-shadow: inset 0 -60px 80px rgba(122, 199, 76, 0.55), var(--shadow); }
  .field.terrain-psychic { box-shadow: inset 0 -60px 80px rgba(249, 85, 135, 0.45), var(--shadow); }
  .field.terrain-misty { box-shadow: inset 0 -60px 80px rgba(214, 133, 173, 0.45), var(--shadow); }
  .badge.champion { background: linear-gradient(90deg, #f59e0b, #fde047); color: #1a1a1a; border-color: transparent; }
  .badge.weather-sun { background: #f6b73c; color: #1a1a1a; } .badge.weather-rain { background: #4d6a9a; color: #fff; } .badge.weather-sand { background: #c9a15a; color: #1a1a1a; } .badge.weather-hail { background: #dbe9f7; color: #1a1a1a; }
  .badge.terrain-electric { background: #f7d02c; color: #1a1a1a; } .badge.terrain-grassy { background: #7ac74c; color: #1a1a1a; } .badge.terrain-psychic { background: #f95587; color: #fff; } .badge.terrain-misty { background: #d685ad; color: #fff; }
  .small { font-size: 0.8rem; }
  .burst { position: absolute; width: 160px; height: 160px; border-radius: 50%; pointer-events: none; animation: burst 0.8s ease-out forwards; mix-blend-mode: screen; z-index: 3; }
  .burst.at-opp { right: 10%; top: 30px; }
  .burst.at-mine { left: 10%; bottom: 70px; }
  .burst-normal { background: radial-gradient(circle, #fff 0, #a8a77a 40%, transparent 70%); }
  .burst-fire { background: radial-gradient(circle, #fff3b0 0, #ee8130 40%, transparent 70%); }
  .burst-water { background: radial-gradient(circle, #dbeafe 0, #6390f0 40%, transparent 70%); }
  .burst-electric { background: radial-gradient(circle, #fff 0, #f7d02c 40%, transparent 70%); }
  .burst-grass { background: radial-gradient(circle, #ecfccb 0, #7ac74c 40%, transparent 70%); }
  .burst-ice { background: radial-gradient(circle, #fff 0, #96d9d6 40%, transparent 70%); }
  .burst-fighting { background: radial-gradient(circle, #fecaca 0, #c22e28 40%, transparent 70%); }
  .burst-poison { background: radial-gradient(circle, #f5d0fe 0, #a33ea1 40%, transparent 70%); }
  .burst-ground { background: radial-gradient(circle, #fef3c7 0, #e2bf65 40%, transparent 70%); }
  .burst-flying { background: radial-gradient(circle, #fff 0, #a98ff3 40%, transparent 70%); }
  .burst-psychic { background: radial-gradient(circle, #ffe4e6 0, #f95587 40%, transparent 70%); }
  .burst-bug { background: radial-gradient(circle, #f7fee7 0, #a6b91a 40%, transparent 70%); }
  .burst-rock { background: radial-gradient(circle, #fef9c3 0, #b6a136 40%, transparent 70%); }
  .burst-ghost { background: radial-gradient(circle, #ede9fe 0, #735797 40%, transparent 70%); }
  .burst-dragon { background: radial-gradient(circle, #ede9fe 0, #6f35fc 40%, transparent 70%); }
  .burst-dark { background: radial-gradient(circle, #d6d3d1 0, #705746 40%, transparent 70%); }
  .burst-steel { background: radial-gradient(circle, #fff 0, #b7b7ce 40%, transparent 70%); }
  .burst-fairy { background: radial-gradient(circle, #fff 0, #d685ad 40%, transparent 70%); }
  .popup { position: absolute; z-index: 4; font-family: var(--font-pixel); font-size: 0.75rem; padding: 0.35rem 0.6rem; border-radius: 6px; background: rgba(10, 12, 22, 0.85); animation: popup 0.9s ease-out forwards; pointer-events: none; white-space: nowrap; }
  .popup.at-opp { right: 12%; top: 150px; }
  .popup.at-mine { left: 12%; bottom: 200px; }
  .pop-super { color: #86efac; } .pop-weak { color: #fca5a5; } .pop-none { color: #d4d4d8; }
  .sprite.status-par { filter: drop-shadow(0 0 18px #f7d02c) brightness(1.3); }
  .sprite.status-brn { filter: drop-shadow(0 0 18px #ee8130) brightness(1.2); }
  .sprite.status-psn, .sprite.status-tox { filter: drop-shadow(0 0 18px #a33ea1); }
  .sprite.status-slp { filter: grayscale(0.6) brightness(0.8); }
  .sprite.status-frz { filter: drop-shadow(0 0 18px #96d9d6) brightness(1.4) saturate(0.3); }
  .forfeit { display: flex; gap: 0.5rem; align-items: center; justify-content: flex-end; margin-top: 0.75rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
  .subtle { font-size: 0.8rem; color: var(--text-muted); padding: 0.3rem 0.7rem; }
  .switches { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border); }
</style>
