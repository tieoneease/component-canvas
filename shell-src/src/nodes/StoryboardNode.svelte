<svelte:options runes={true} />

<script>
  import { getScreenTitle } from '../lib/flow.js';
  import { previewScreenSrc } from '../lib/routing.js';
  import VariantStrip from '../lib/VariantStrip.svelte';

  const DEFAULT_SCREEN_SCALE = 0.34;
  const DEFAULT_VARIANT_SCALE = 0.22;
  const HEADER_HEIGHT = 46;

  let {
    node = null,
    viewport = { width: 1280, height: 720 },
    screenScale = DEFAULT_SCREEN_SCALE,
    variantScale = DEFAULT_VARIANT_SCALE,
    workflowId = '',
    lod = 'full',
    selected = false,
    onOpen = () => {},
    onSelect = () => {}
  } = $props();

  let viewportWidth = $derived(Number(viewport?.width) > 0 ? Number(viewport.width) : 1280);
  let viewportHeight = $derived(Number(viewport?.height) > 0 ? Number(viewport.height) : 720);
  let safeScreenScale = $derived(Number(screenScale) > 0 ? Number(screenScale) : DEFAULT_SCREEN_SCALE);
  let safeVariantScale = $derived(Number(variantScale) > 0 ? Number(variantScale) : DEFAULT_VARIANT_SCALE);
  let safeLod = $derived(lod === 'minimal' || lod === 'card' ? lod : 'full');
  let title = $derived(getScreenTitle(node?.screen));
  let previewSrc = $derived(
    workflowId && node?.id ? previewScreenSrc(workflowId, node.id) : 'about:blank'
  );
  let frameWidth = $derived(
    Math.max(Number(node?.mainRect?.width) || (viewportWidth * safeScreenScale), 1)
  );
  let cardHeight = $derived(
    Math.max(Number(node?.mainRect?.height) || (HEADER_HEIGHT + (viewportHeight * safeScreenScale)), HEADER_HEIGHT)
  );
  let frameHeight = $derived(Math.max(cardHeight - HEADER_HEIGHT, 1));
  let safeVariants = $derived(Array.isArray(node?.variants) ? node.variants : []);
  let backAnnotations = $derived(Array.isArray(node?.backAnnotations) ? node.backAnnotations : []);
  let componentName = $derived(getComponentName(node?.screen?.component));
  let selectedClass = $derived(selected ? 'ring-2 ring-primary' : '');

  function getComponentName(componentPath) {
    const normalizedPath = String(componentPath ?? '').replace(/\\/gu, '/');
    const fileName = normalizedPath.split('/').pop() ?? '';
    const componentName = fileName.replace(/\.svelte$/iu, '');

    return componentName || 'Component';
  }

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest('button, a, input, select, textarea, label'));
  }

  function handleNodeClick(event) {
    if (isInteractiveTarget(event.target)) return;
    if (!event.shiftKey || typeof onSelect !== 'function') return;
    event.stopPropagation();
    onSelect(node?.id);
  }

  function openScreen() {
    if (typeof onOpen !== 'function' || !workflowId || !node?.id) return;
    onOpen(workflowId, node.id);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
  class="grid w-full cursor-pointer justify-items-center select-none"
  data-canvas-node
  data-screen-id={node?.id ?? undefined}
  data-selected={selected ? 'true' : undefined}
  data-lod={safeLod}
  aria-label={title}
  onclick={handleNodeClick}
>
  {#if safeLod === 'minimal'}
    <div
      class={`flex items-center justify-center rounded-lg border border-border bg-muted px-3 text-center transition-[box-shadow] duration-200 ${selectedClass}`}
      style="width:{frameWidth}px;height:{cardHeight}px;"
    >
      <span class="text-xs font-medium text-muted-foreground">{title}</span>
    </div>
  {:else}
    <div
      class={`relative overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-[box-shadow] duration-200 ${selectedClass}`}
      style="width:{frameWidth}px;"
    >
      <header class="flex h-[46px] items-center gap-3 border-b border-border bg-muted/40 px-3">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-foreground">{title}</p>
          <p class="truncate text-[11px] text-muted-foreground">{componentName}</p>
        </div>
        <button
          type="button"
          class="inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onclick={openScreen}
        >
          Open
        </button>
      </header>

      {#if safeLod === 'card'}
        <div class="relative overflow-hidden bg-background" style="width:{frameWidth}px;height:{frameHeight}px;">
          <div class="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/50 px-4 text-center">
            <div class="flex size-8 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm">
              <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2.25" y="3.75" width="11.5" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.25" />
                <path d="M5 11h6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
              </svg>
            </div>
            <div class="space-y-1">
              <p class="text-xs font-semibold text-foreground">{componentName}</p>
              <p class="text-[10px] text-muted-foreground">Preview at higher zoom</p>
            </div>
          </div>
        </div>
      {:else}
        <div class="relative overflow-hidden bg-background" style="width:{frameWidth}px;height:{frameHeight}px;">
          <iframe
            title="{title} preview"
            src={previewSrc}
            loading="lazy"
            tabindex="-1"
            data-screen-frame={node?.id ?? undefined}
            class="pointer-events-none block border-0 bg-background"
            style="width:{viewportWidth}px;height:{viewportHeight}px;transform:scale({safeScreenScale});transform-origin:top left;"
          ></iframe>
        </div>

        {#if backAnnotations.length > 0}
          <div class="pointer-events-none absolute right-3 top-14 z-10 grid max-w-[14rem] gap-1.5">
            {#each backAnnotations as backEdge, index (`${backEdge?.from ?? 'back'}-${backEdge?.to ?? 'to'}-${backEdge?.label ?? index}`)}
              <div
                class="flex flex-wrap justify-end gap-1 rounded-md border border-border bg-background/95 px-2 py-1 text-xs font-medium shadow-sm backdrop-blur-sm"
                data-back-edge-from={backEdge?.from ?? undefined}
                title="{backEdge?.from ?? 'Unknown'} → {title}{backEdge?.label ? ` (${backEdge.label})` : ''}"
              >
                <span class="text-muted-foreground">{backEdge?.from ?? 'Unknown'}</span>
                <span class="text-foreground">{backEdge?.label ?? 'Back link'}</span>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    {#if safeVariants.length > 0}
      <div class="mt-4 flex w-full justify-center pb-2">
        <VariantStrip
          variants={safeVariants}
          {workflowId}
          screenId={node?.id ?? ''}
          {viewport}
          scale={safeVariantScale}
          lod={safeLod}
        />
      </div>
    {/if}
  {/if}
</article>
