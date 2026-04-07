<svelte:options runes={true} />

<script>
  import { previewVariantSrc } from './routing.js';

  const DEFAULT_SCALE = 0.22;

  let {
    variants = [],
    workflowId = '',
    screenId = '',
    viewport = { width: 1280, height: 720 },
    scale = DEFAULT_SCALE,
    lod = 'full'
  } = $props();

  let viewportWidth = $derived(Number(viewport?.width) > 0 ? Number(viewport.width) : 1280);
  let viewportHeight = $derived(Number(viewport?.height) > 0 ? Number(viewport.height) : 720);
  let safeScale = $derived(Number(scale) > 0 ? Number(scale) : DEFAULT_SCALE);
  let safeLod = $derived(lod === 'minimal' || lod === 'card' ? lod : 'full');
  let itemWidth = $derived(Math.max(viewportWidth * safeScale, 1));
  let itemHeight = $derived(Math.max(viewportHeight * safeScale, 1));
  let safeVariants = $derived(Array.isArray(variants) ? variants : []);
  let variantCountLabel = $derived(`${safeVariants.length} variant${safeVariants.length === 1 ? '' : 's'}`);
</script>

{#if safeVariants.length > 0 && safeLod !== 'minimal'}
  {#if safeLod === 'card'}
    <div class="flex items-center justify-center" data-variant-count={safeVariants.length} data-lod={safeLod}>
      <span class="inline-flex items-center rounded-md border border-border bg-card/90 px-3 py-1 text-[10px] font-medium text-foreground shadow-sm">
        {variantCountLabel}
      </span>
    </div>
  {:else}
    <div class="flex items-start gap-3" data-variant-count={safeVariants.length} data-lod={safeLod}>
      {#each safeVariants as variant, index (`${variant?.id ?? 'variant'}-${index}`)}
        {@const variantTitle = variant?.title ?? variant?.id ?? 'Variant'}

        <div
          class="relative flex-none overflow-hidden rounded-lg border border-border bg-card shadow-sm"
          data-variant-id={variant?.id ?? undefined}
          style="width:{itemWidth}px;height:{itemHeight}px;"
          title="{variantTitle} preview"
        >
          <iframe
            title="{variantTitle} preview for {screenId || 'screen'}"
            src={workflowId && variant?.id ? previewVariantSrc(workflowId, variant.id) : 'about:blank'}
            loading="lazy"
            tabindex="-1"
            class="pointer-events-none block border-0 bg-background"
            style="width:{viewportWidth}px;height:{viewportHeight}px;transform:scale({safeScale});transform-origin:top left;"
          ></iframe>

          <div class="absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-background via-background/80 to-transparent p-2">
            <span class="inline-flex max-w-full truncate rounded-md border border-border bg-card/90 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm">
              {variantTitle}
            </span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}
