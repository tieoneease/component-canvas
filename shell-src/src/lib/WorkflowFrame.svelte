<svelte:options runes={true} />

<script>
  let {
    workflow = null,
    bounds = null,
    screenCount = 0,
    active = false
  } = $props();

  let safeBounds = $derived(bounds ?? { x: 0, y: 0, width: 0, height: 0 });
  let frameStyle = $derived(
    `left:${safeBounds.x}px;top:${safeBounds.y}px;width:${Math.max(safeBounds.width, 0)}px;height:${Math.max(safeBounds.height, 0)}px;`
  );
  let screenLabel = $derived(screenCount === 1 ? 'screen' : 'screens');
</script>

<div
  class={`pointer-events-none absolute rounded-xl border border-dashed border-border ${active ? 'bg-accent/20 shadow-sm' : 'bg-muted/10'}`}
  data-workflow-id={workflow?.id ?? undefined}
  style={frameStyle}
  aria-label={workflow?.title ?? workflow?.id ?? 'Workflow'}
>
  <div class={`absolute left-4 top-3 inline-flex max-w-[calc(100%-7rem)] truncate rounded-md border border-border px-3 py-1 text-xs font-medium shadow-sm backdrop-blur-sm ${active ? 'bg-background text-foreground' : 'bg-background/95 text-muted-foreground'}`}>
    {workflow?.title ?? workflow?.id ?? 'Workflow'}
  </div>

  <div class={`absolute right-4 top-3 inline-flex rounded-md border border-border px-2.5 py-1 text-xs font-medium uppercase tracking-[0.14em] shadow-sm backdrop-blur-sm ${active ? 'bg-background text-foreground' : 'bg-background/95 text-muted-foreground'}`}>
    {screenCount} {screenLabel}
  </div>
</div>
