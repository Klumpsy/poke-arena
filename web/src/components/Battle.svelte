<script lang="ts">
  import { describe, legalActions, move as moveData, other, pendingActors, type Action, type BattleEvent, type BattleState, type Side } from '@poke-arena/engine';
  import { onMount } from 'svelte';
  import { fetchActions, replayBattle, submitAction, watchBattle, type ReplayResult } from '../lib/battleClient';
  import { animatedSprite, staticSprite } from '../lib/sprites';
  import { store } from '../lib/store.svelte';
  import { sideOf, type BattleRow } from '../lib/types';
  import HpBar from './HpBar.svelte';

  let { battle }: { battle: BattleRow } = $props();

  const me = store.me!;
  // svelte-ignore state_referenced_locally
  const mySide: Side = sideOf(battle, me);
  const oppSide: Side = other(mySide);
  // svelte-ignore state_referenced_locally
  const oppId = mySide === 'a' ? battle.opponent_id : battle.challenger_id;

  let replay = $state<ReplayResult | null>(null);
  let view = $state<BattleState | null>(null);
  let log = $state<string[]>([]);
  let playedTurns = $state(0);
  let animating = $state(false);
  let fx = $state<Record<Side, string>>({ a: '', b: '' });
  let busy = $state(false);
  let finishedReported = false;
  let spriteFallback = $state<Record<Side, boolean>>({ a: false, b: false });

  const controlsOpen = $derived(Boolean(view && replay && !animating && view.phase !== 'finished' && pendingActors(view).includes(mySide) && !replay.submitted[mySide]));
  const waiting = $derived(Boolean(view && replay && !animating && view.phase !== 'finished' && !controlsOpen));
  const finished = $derived(Boolean(view && !animating && view.phase === 'finished'));
  const myLegal = $derived(view ? legalActions(view, mySide) : []);

  async function refresh() {
    try {
      const actions = await fetchActions(battle.id);
      replay = replayBattle(battle, actions);
      if (!view) {
        view = replay.turns.length ? replay.states[replay.turns.length - 1] : replay.state;
        playedTurns = replay.turns.length;
        if (playedTurns) log = replay.turns.flat().map(describe);
      }
      void animateNewTurns();
    } catch (e) {
      store.error = (e as Error).message;
    }
  }

  const DELAY: Partial<Record<BattleEvent['type'], number>> = { turn: 400, move: 900, damage: 900, faint: 1000, switch: 800, end: 600 };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function animateNewTurns() {
    if (animating || !replay) return;
    animating = true;
    while (replay && playedTurns < replay.turns.length) {
      const events = replay.turns[playedTurns];
      for (const e of events) {
        log = [...log, describe(e)];
        applyEventToView(e);
        await sleep(DELAY[e.type] ?? 650);
      }
      view = replay.states[playedTurns];
      playedTurns += 1;
    }
    animating = false;
    if (view?.phase === 'finished' && !finishedReported) {
      finishedReported = true;
      const winnerId = view.winner === mySide ? me : oppId;
      await store.finishBattle(battle.id, winnerId);
    }
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
        break;
      case 'damage':
        if (e.amount > 0) flash(e.side, 'hit');
        view.sides[e.side].team[view.sides[e.side].active].hp = e.hp;
        break;
      case 'heal':
        flash(e.side, 'heal');
        view.sides[e.side].team[view.sides[e.side].active].hp = e.hp;
        break;
      case 'status':
        view.sides[e.side].team[view.sides[e.side].active].status = e.status;
        break;
      case 'cure':
        view.sides[e.side].team[view.sides[e.side].active].status = 'none';
        break;
      case 'faint':
        flash(e.side, 'faint', 1000);
        break;
      case 'switch':
        view.sides[e.side].active = e.slot;
        spriteFallback = { ...spriteFallback, [e.side]: false };
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
    void refresh();
    const channel = watchBattle(battle.id, () => void refresh());
    const poll = setInterval(() => void refresh(), 4000);
    return () => {
      channel.unsubscribe();
      clearInterval(poll);
    };
  });

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
      <h1 class="pixel" style="font-size: 0.9rem; margin: 0">{store.nameOf(me)} vs {store.nameOf(oppId)}</h1>
      <span class="spacer"></span>
      <span class="muted">Beurt {view.turn}</span>
    </header>

    <div class="field">
      <div class="side opp">
        <div class="balls">{#each view.sides[oppSide].team as p}<span class="ball" class:ko={p.hp <= 0}></span>{/each}</div>
        <HpBar hp={active(oppSide).hp} maxHp={active(oppSide).maxHp} name={active(oppSide).name} level={active(oppSide).level} status={active(oppSide).status} />
        <img class="sprite {fx[oppSide]}" src={spriteFor(oppSide)} alt={active(oppSide).name} onerror={() => (spriteFallback = { ...spriteFallback, [oppSide]: true })} />
      </div>
      <div class="side mine">
        <img class="sprite {fx[mySide]}" src={spriteFor(mySide)} alt={active(mySide).name} onerror={() => (spriteFallback = { ...spriteFallback, [mySide]: true })} />
        <HpBar mine hp={active(mySide).hp} maxHp={active(mySide).maxHp} name={active(mySide).name} level={active(mySide).level} status={active(mySide).status} />
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
        {#if finished}
          <h2 class="pixel" style="font-size: 1rem">{view.winner === mySide ? 'Gewonnen!' : 'Verloren...'}</h2>
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
                  <button class="move type-{m.type}" disabled={busy} onclick={() => act(a)} title={m.effect}>
                    <strong>{m.name}</strong>
                    <span class="meta">{m.type} · {m.category === 'status' ? 'status' : `${m.power ?? '-'} pow`} · {m.accuracy ?? '-'}% · PP {slot.pp}/{slot.maxPp}</span>
                  </button>
                {/if}
              {/if}
            {/each}
          </div>
        {:else if waiting}
          <p class="muted" style="animation: pulse 1.5s infinite">Wacht op {store.nameOf(oppId)}...</p>
        {:else}
          <p class="muted">...</p>
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
</style>
