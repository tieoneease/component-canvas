<svelte:options runes={true} />

<script>
  let { group = null } = $props();

  let bounds = $derived(group?.bounds ?? { x: 0, y: 0, width: 0, height: 0 });
  let frameStyle = $derived(
    `left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 0)}px;height:${Math.max(bounds.height, 0)}px;`
  );
</script>

<div
  class="pointer-events-none absolute rounded-xl border border-dashed border-muted-foreground/15 bg-muted/20"
  data-group-id={group?.id ?? undefined}
  style={frameStyle}
  aria-label={group?.title ?? group?.id ?? 'Group'}
>
  <div class="absolute left-4 top-3 inline-flex max-w-[calc(100%-2rem)] truncate rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground shadow-sm backdrop-blur-sm">
    {group?.title ?? group?.id ?? 'Group'}
  </div>
</div>
