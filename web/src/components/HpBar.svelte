<script lang="ts">
  import { ability as abilityData } from '@poke-arena/engine';
  import TypeBadge from './TypeBadge.svelte';
  let { hp, maxHp, name, level, status, types = [], shiny = false, mine = false, ability }: { hp: number; maxHp: number; name: string; level: number; status: string; types?: string[]; shiny?: boolean; mine?: boolean; ability?: string } = $props();
  const pct = $derived(Math.max(0, Math.min(100, (hp / maxHp) * 100)));
  const color = $derived(pct > 50 ? 'var(--hp-high)' : pct > 20 ? 'var(--hp-mid)' : 'var(--hp-low)');
  const STATUS: Record<string, string> = { par: 'PAR', slp: 'SLP', brn: 'BRN', psn: 'PSN', tox: 'PSN', frz: 'FRZ' };
</script>

<div class="hpbox">
  <div class="row" style="gap: 0.5rem">
    <strong>{name}</strong>
    <span class="muted">Lv {level}</span>
    {#each types as t}<TypeBadge type={t} small />{/each}
    {#if shiny}<span class="badge shiny">✦ shiny</span>{/if}
    {#if status !== 'none'}<span class="badge status-{status}">{STATUS[status]}</span>{/if}
  </div>
  <div class="bar"><div class="fill" style="width: {pct}%; background: {color}"></div></div>
  {#if mine}<div class="muted" style="font-size: 0.8rem; text-align: right">{hp} / {maxHp}</div>{/if}
  {#if ability}<div class="muted" style="font-size: 0.72rem" title={abilityData(ability).effect}>Ability: {abilityData(ability).name}</div>{/if}
</div>

<style>
  .hpbox { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; min-width: 220px; }
  .bar { height: 10px; background: #0a0c16; border-radius: 999px; overflow: hidden; margin-top: 0.3rem; }
  .fill { height: 100%; transition: width 0.6s ease, background 0.6s ease; }
  .badge { color: #fff; border-color: transparent; }
  .status-par { background: #f7d02c; color: #222; } .status-slp { background: #8c888c; } .status-brn { background: #ee8130; }
  .status-psn, .status-tox { background: #a33ea1; } .status-frz { background: #96d9d6; color: #222; }
</style>
