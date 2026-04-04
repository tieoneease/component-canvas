<svelte:options runes={true} />

<script>
  import { getScreenTitle } from '../lib/flow.js'
  import { previewScreenSrc } from '../lib/routing.js'
  import VariantStrip from '../lib/VariantStrip.svelte'

  const DEFAULT_SCREEN_SCALE = 0.34
  const DEFAULT_VARIANT_SCALE = 0.22
  const HEADER_HEIGHT = 46

  let {
    node = null,
    viewport = { width: 1280, height: 720 },
    screenScale = DEFAULT_SCREEN_SCALE,
    variantScale = DEFAULT_VARIANT_SCALE,
    workflowId = '',
    onOpen = () => {}
  } = $props()

  let viewportWidth = $derived(Number(viewport?.width) > 0 ? Number(viewport.width) : 1280)
  let viewportHeight = $derived(Number(viewport?.height) > 0 ? Number(viewport.height) : 720)
  let safeScreenScale = $derived(Number(screenScale) > 0 ? Number(screenScale) : DEFAULT_SCREEN_SCALE)
  let safeVariantScale = $derived(Number(variantScale) > 0 ? Number(variantScale) : DEFAULT_VARIANT_SCALE)
  let title = $derived(getScreenTitle(node?.screen))
  let viewportLabel = $derived(viewport?.label ?? `${viewportWidth}×${viewportHeight}`)
  let previewSrc = $derived(
    workflowId && node?.id ? previewScreenSrc(workflowId, node.id) : 'about:blank'
  )
  let frameWidth = $derived(
    Math.max(Number(node?.mainRect?.width) || (viewportWidth * safeScreenScale), 1)
  )
  let frameHeight = $derived(
    Math.max(
      (Number(node?.mainRect?.height) || (HEADER_HEIGHT + (viewportHeight * safeScreenScale))) - HEADER_HEIGHT,
      1
    )
  )
  let frameStyle = $derived(`width:${frameWidth}px;`)
  let viewportStyle = $derived(`width:${frameWidth}px;height:${frameHeight}px;`)
  let iframeStyle = $derived(
    `width:${viewportWidth}px;height:${viewportHeight}px;transform:scale(${safeScreenScale});transform-origin:top left;`
  )
  let safeVariants = $derived(Array.isArray(node?.variants) ? node.variants : [])
  let backAnnotations = $derived(Array.isArray(node?.backAnnotations) ? node.backAnnotations : [])

  function openScreen() {
    if (typeof onOpen !== 'function' || !workflowId || !node?.id) {
      return
    }

    onOpen(workflowId, node.id)
  }
</script>

<article class="storyboard-node" data-screen-id={node?.id ?? undefined} aria-label={title}>
  <div class="storyboard-node__main" style={frameStyle}>
    <header class="storyboard-node__header">
      <div class="storyboard-node__copy">
        <strong>{title}</strong>
        <span>{viewportLabel}</span>
      </div>

      <button type="button" class="storyboard-node__open" onclick={openScreen}>Open</button>
    </header>

    <div class="storyboard-node__viewport" style={viewportStyle}>
      <iframe
        title={`${title} preview`}
        src={previewSrc}
        loading="lazy"
        tabindex="-1"
        style={iframeStyle}
      ></iframe>
    </div>

    {#if backAnnotations.length > 0}
      <div class="storyboard-node__annotations" aria-label="Back link annotations">
        {#each backAnnotations as backEdge, index (`${backEdge?.from ?? 'back'}-${backEdge?.to ?? 'to'}-${backEdge?.label ?? index}`)}
          <div
            class="storyboard-node__annotation"
            data-back-edge-from={backEdge?.from ?? undefined}
            title={`${backEdge?.from ?? 'Unknown'} → ${title}${backEdge?.label ? ` (${backEdge.label})` : ''}`}
          >
            <span>{backEdge?.from ?? 'Unknown'}</span>
            {#if backEdge?.label}
              <strong>{backEdge.label}</strong>
            {:else}
              <strong>Back link</strong>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if safeVariants.length > 0}
    <div class="storyboard-node__variants">
      <VariantStrip
        variants={safeVariants}
        {workflowId}
        screenId={node?.id ?? ''}
        baseProps={node?.screen?.props ?? {}}
        {viewport}
        scale={safeVariantScale}
      />
    </div>
  {/if}
</article>

<style>
  .storyboard-node {
    position: relative;
    display: grid;
    justify-items: center;
    width: 100%;
  }

  .storyboard-node__main {
    position: relative;
    overflow: hidden;
    border-radius: 24px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.92);
    box-shadow:
      0 20px 44px rgba(15, 23, 42, 0.18),
      0 1px 0 rgba(255, 255, 255, 0.92) inset;
  }

  .storyboard-node__header {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    height: 46px;
    padding: 0 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.9) 100%),
      rgba(255, 255, 255, 0.96);
  }

  .storyboard-node__copy {
    min-width: 0;
    display: grid;
    gap: 0.18rem;
  }

  .storyboard-node__copy strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.94rem;
    color: #0f172a;
  }

  .storyboard-node__copy span {
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #64748b;
  }

  .storyboard-node__open {
    flex: none;
    appearance: none;
    border: 0;
    padding: 0.45rem 0.75rem;
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.1);
    color: #4f46e5;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition:
      transform 140ms ease,
      background 140ms ease;
  }

  .storyboard-node__open:hover {
    transform: translateY(-1px);
  }

  .storyboard-node__viewport {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at top, rgba(99, 102, 241, 0.08), transparent 36%),
      #ffffff;
  }

  .storyboard-node__viewport iframe {
    display: block;
    border: 0;
    background: #ffffff;
    pointer-events: none;
  }

  .storyboard-node__annotations {
    position: absolute;
    inset-block-start: calc(46px + 0.8rem);
    inset-inline-end: 0.8rem;
    z-index: 2;
    display: grid;
    gap: 0.45rem;
    max-width: min(14rem, calc(100% - 1.6rem));
    pointer-events: none;
  }

  .storyboard-node__annotation {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.3rem;
    padding: 0.4rem 0.55rem;
    border-radius: 14px;
    border: 1px solid rgba(99, 102, 241, 0.14);
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
    color: #475569;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.2;
  }

  .storyboard-node__annotation strong {
    color: #4f46e5;
  }

  .storyboard-node__variants {
    display: flex;
    justify-content: center;
    margin-top: 18px;
    padding-bottom: 8px;
    width: 100%;
  }

  :global(.dark) .storyboard-node__main {
    border-color: rgba(148, 163, 184, 0.22);
    background: rgba(15, 23, 42, 0.94);
    box-shadow:
      0 24px 52px rgba(2, 6, 23, 0.48),
      0 1px 0 rgba(255, 255, 255, 0.04) inset;
  }

  :global(.dark) .storyboard-node__header {
    border-bottom-color: rgba(148, 163, 184, 0.14);
    background:
      linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%),
      rgba(15, 23, 42, 0.96);
  }

  :global(.dark) .storyboard-node__copy strong {
    color: #e2e8f0;
  }

  :global(.dark) .storyboard-node__copy span {
    color: #94a3b8;
  }

  :global(.dark) .storyboard-node__open {
    background: rgba(129, 140, 248, 0.18);
    color: #c7d2fe;
  }

  :global(.dark) .storyboard-node__viewport iframe {
    background: #020617;
  }

  :global(.dark) .storyboard-node__annotation {
    border-color: rgba(165, 180, 252, 0.16);
    background: rgba(15, 23, 42, 0.88);
    box-shadow: 0 14px 28px rgba(2, 6, 23, 0.28);
    color: #cbd5e1;
  }

  :global(.dark) .storyboard-node__annotation strong {
    color: #c7d2fe;
  }
</style>
