<script lang="ts">
  let { type, small = false }: { type: string; small?: boolean } = $props();
</script>

<span class="badge type type-{type}" class:small>{type}</span>

<style>
  .small { font-size: 0.6rem; padding: 0.05rem 0.4rem; }
</style>
