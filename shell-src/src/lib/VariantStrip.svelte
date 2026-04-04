<svelte:options runes={true} />

<script>
  import { previewVariantSrc } from './routing.js'

  let {
    variants = [],
    workflowId = '',
    screenId = '',
    baseProps = {},
    viewport = { width: 1280, height: 720 },
    scale = 0.22
  } = $props()

  const DEFAULT_SCALE = 0.22

  let viewportWidth = $derived(Number(viewport?.width) > 0 ? Number(viewport.width) : 1280)
  let viewportHeight = $derived(Number(viewport?.height) > 0 ? Number(viewport.height) : 720)
  let safeScale = $derived(Number(scale) > 0 ? Number(scale) : DEFAULT_SCALE)
  let itemWidth = $derived(Math.max(viewportWidth * safeScale, 1))
  let itemHeight = $derived(Math.max(viewportHeight * safeScale, 1))
  let itemStyle = $derived(`width:${itemWidth}px;height:${itemHeight}px;`)
  let iframeStyle = $derived(
    `width:${viewportWidth}px;height:${viewportHeight}px;transform:scale(${safeScale});transform-origin:top left;`
  )
  let safeVariants = $derived(Array.isArray(variants) ? variants : [])
</script>

{#if safeVariants.length > 0}
  <div class="variant-strip" data-variant-count={safeVariants.length}>
    {#each safeVariants as variant, index (`${variant?.id ?? 'variant'}-${index}`)}
      {@const variantTitle = variant?.title ?? variant?.id ?? 'Variant'}

      <div
        class="variant-strip__item"
        data-variant-id={variant?.id ?? undefined}
        style={itemStyle}
        title={`${variantTitle} preview`}
      >
        <iframe
          title={`${variantTitle} preview for ${screenId || 'screen'}`}
          src={workflowId && variant?.id ? previewVariantSrc(workflowId, variant.id) : 'about:blank'}
          loading="lazy"
          tabindex="-1"
          style={iframeStyle}
        ></iframe>

        <div class="variant-strip__badge">
          <span>{variantTitle}</span>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .variant-strip {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  .variant-strip__item {
    position: relative;
    flex: none;
    overflow: hidden;
    border-radius: 20px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background:
      radial-gradient(circle at top, rgba(99, 102, 241, 0.08), transparent 36%),
      #ffffff;
    box-shadow:
      0 14px 30px rgba(15, 23, 42, 0.14),
      0 1px 0 rgba(255, 255, 255, 0.8) inset;
  }

  .variant-strip__item iframe {
    display: block;
    border: 0;
    background: #ffffff;
    pointer-events: none;
  }

  .variant-strip__badge {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    display: flex;
    align-items: flex-end;
    padding: 1.25rem 0.55rem 0.5rem;
    background: linear-gradient(180deg, transparent 0%, rgba(15, 23, 42, 0.64) 100%);
  }

  .variant-strip__badge span {
    display: inline-flex;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0.28rem 0.5rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.9);
    color: #0f172a;
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  :global(.dark) .variant-strip__item {
    border-color: rgba(148, 163, 184, 0.22);
    background:
      radial-gradient(circle at top, rgba(129, 140, 248, 0.12), transparent 36%),
      #020617;
    box-shadow:
      0 18px 34px rgba(2, 6, 23, 0.34),
      0 1px 0 rgba(255, 255, 255, 0.04) inset;
  }

  :global(.dark) .variant-strip__item iframe {
    background: #020617;
  }

  :global(.dark) .variant-strip__badge span {
    background: rgba(15, 23, 42, 0.84);
    color: #e2e8f0;
  }
</style>
