<svelte:options runes={true} />

<script>
  import { previewVariantSrc } from './routing.js';

  const DEFAULT_SCALE = 0.22;
  const THUMBNAIL_CAPTURE_DELAY_MS = 300;

  let {
    variants = [],
    workflowId = '',
    screenId = '',
    viewport = { width: 1280, height: 720 },
    scale = DEFAULT_SCALE,
    lod = 'full',
    thumbnailSrcs = {},
    onThumbnailCapture = null
  } = $props();

  let viewportWidth = $derived(Number(viewport?.width) > 0 ? Number(viewport.width) : 1280);
  let viewportHeight = $derived(Number(viewport?.height) > 0 ? Number(viewport.height) : 720);
  let safeScale = $derived(Number(scale) > 0 ? Number(scale) : DEFAULT_SCALE);
  let safeLod = $derived(lod === 'minimal' || lod === 'card' ? lod : 'full');
  let itemWidth = $derived(Math.max(viewportWidth * safeScale, 1));
  let itemHeight = $derived(Math.max(viewportHeight * safeScale, 1));
  let safeVariants = $derived(Array.isArray(variants) ? variants : []);
  let safeThumbnailSrcs = $derived(
    thumbnailSrcs && typeof thumbnailSrcs === 'object' ? thumbnailSrcs : {}
  );
  let variantCountLabel = $derived(`${safeVariants.length} variant${safeVariants.length === 1 ? '' : 's'}`);
  let variantSignature = $derived(
    `${workflowId}:${safeVariants.map((variant) => variant?.id ?? '').join('|')}`
  );

  let loadedVariantIds = $state(new Set());
  let captureScheduledVariantIds = $state(new Set());

  $effect(() => {
    void variantSignature;
    loadedVariantIds = new Set();
    captureScheduledVariantIds = new Set();
  });

  $effect(() => {
    if (safeLod === 'full') return;
    loadedVariantIds = new Set();
    captureScheduledVariantIds = new Set();
  });

  function getVariantId(variant) {
    return String(variant?.id ?? '');
  }

  function getThumbnailSrc(variantId) {
    return safeThumbnailSrcs?.[variantId] ?? null;
  }

  function isVariantLoaded(variantId) {
    return loadedVariantIds.has(variantId);
  }

  function setVariantLoaded(variantId, loaded) {
    const next = new Set(loadedVariantIds);

    if (loaded) {
      next.add(variantId);
    } else {
      next.delete(variantId);
    }

    loadedVariantIds = next;
  }

  function isCaptureScheduled(variantId) {
    return captureScheduledVariantIds.has(variantId);
  }

  function setCaptureScheduled(variantId, scheduled) {
    const next = new Set(captureScheduledVariantIds);

    if (scheduled) {
      next.add(variantId);
    } else {
      next.delete(variantId);
    }

    captureScheduledVariantIds = next;
  }

  function handleVariantLoad(variantId, event) {
    try {
      if (event.currentTarget?.contentDocument?.URL === 'about:blank') return;
    } catch {
      return;
    }

    setVariantLoaded(variantId, true);
    void scheduleThumbnailCapture(variantId, event.currentTarget);
  }

  async function scheduleThumbnailCapture(variantId, iframeElement) {
    if (isCaptureScheduled(variantId) || typeof onThumbnailCapture !== 'function') return;
    if (!workflowId || !variantId || !iframeElement) return;

    setCaptureScheduled(variantId, true);

    try {
      await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_CAPTURE_DELAY_MS));

      const { captureIframeThumbnail } = await import('./thumbnail-capture.js');
      const blob = await captureIframeThumbnail(iframeElement);

      if (!blob || typeof onThumbnailCapture !== 'function') return;

      onThumbnailCapture(
        `${workflowId}/${variantId}`,
        blob,
        Math.round(itemWidth),
        Math.round(itemHeight)
      );
    } catch (error) {
      console.warn('[component-canvas] Variant thumbnail capture failed:', error?.message ?? error);
    } finally {
      setCaptureScheduled(variantId, false);
    }
  }
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
        {@const variantId = getVariantId(variant)}
        {@const variantTitle = variant?.title ?? variant?.id ?? 'Variant'}
        {@const thumbnailSrc = getThumbnailSrc(variantId)}
        {@const showThumbnail = Boolean(thumbnailSrc) && !isVariantLoaded(variantId)}

        <div
          class="relative flex-none overflow-hidden rounded-lg border border-border bg-card shadow-sm"
          data-variant-id={variant?.id ?? undefined}
          style="width:{itemWidth}px;height:{itemHeight}px;"
          title="{variantTitle} preview"
        >
          {#if showThumbnail}
            <img
              src={thumbnailSrc}
              alt="{variantTitle} preview"
              class="absolute inset-0 h-full w-full object-cover object-top"
              draggable="false"
            />
          {/if}

          <iframe
            title="{variantTitle} preview for {screenId || 'screen'}"
            src={workflowId && variantId ? previewVariantSrc(workflowId, variantId) : 'about:blank'}
            loading="lazy"
            tabindex="-1"
            class="pointer-events-none relative z-[1] block border-0 bg-background"
            class:opacity-0={showThumbnail}
            style="width:{viewportWidth}px;height:{viewportHeight}px;transform:scale({safeScale});transform-origin:top left;"
            onload={(event) => handleVariantLoad(variantId, event)}
          ></iframe>

          <div class="absolute inset-x-0 bottom-0 z-[2] flex items-end bg-gradient-to-t from-background via-background/80 to-transparent p-2">
            <span class="inline-flex max-w-full truncate rounded-md border border-border bg-card/90 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm">
              {variantTitle}
            </span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}
