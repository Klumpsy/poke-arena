<script lang="ts">
  import { store } from '../lib/store.svelte';
  const done = $derived(store.quests.filter((q) => q.progress >= q.target));
  const points = $derived(done.reduce((s, q) => s + q.points, 0));
</script>

<section class="panel">
  <div class="row">
    <h2 style="margin: 0">Weekquests</h2>
    <span class="spacer"></span>
    <span class="badge active">{points} punten</span>
  </div>
  <p class="muted" style="font-size: 0.8rem; margin: 0.25rem 0 0.75rem">Reset elke maandag. Punten tellen mee op je profiel.</p>
  <ul>
    {#each store.quests as q (q.code)}
      <li class:done={q.progress >= q.target}>
        <div class="row">
          <span>{q.title}</span>
          <span class="spacer"></span>
          <span class="muted small">{q.progress}/{q.target} · {q.points}p</span>
        </div>
        <div class="bar"><div style="width: {Math.min(100, (q.progress / q.target) * 100)}%"></div></div>
      </li>
    {/each}
  </ul>
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  li.done { opacity: 0.7; }
  li.done span:first-child { text-decoration: line-through; }
  .small { font-size: 0.78rem; }
  .bar { height: 6px; background: #0a0c16; border-radius: 999px; overflow: hidden; margin-top: 0.25rem; }
  .bar div { height: 100%; background: var(--accent); transition: width 0.4s ease; }
</style>
