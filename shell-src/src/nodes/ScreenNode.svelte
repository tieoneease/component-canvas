<svelte:options runes={true} />

<script>
  import { Handle, Position } from '@xyflow/svelte';

  let {
    data = {},
    selected = false
  } = $props();

  let viewportWidth = $derived(Number(data?.viewport?.width) > 0 ? Number(data.viewport.width) : 1280);
  let viewportHeight = $derived(Number(data?.viewport?.height) > 0 ? Number(data.viewport.height) : 720);
  let scale = $derived(Number(data?.scale) > 0 ? Number(data.scale) : 1);
  let frameWidth = $derived(Math.max(Number(data?.frameWidth) || Math.round(viewportWidth * scale), 1));
  let frameHeight = $derived(Math.max(Number(data?.frameHeight) || Math.round(viewportHeight * scale), 1));
  let viewportStyle = $derived(`width:${frameWidth}px;height:${frameHeight}px;`);
  let iframeStyle = $derived(
    `width:${viewportWidth}px;height:${viewportHeight}px;transform:scale(${scale});transform-origin:top left;`
  );
</script>

<Handle type="target" position={Position.Left} class="screen-node__handle" />

<article class="screen-node" class:selected={selected} aria-label={data?.title ?? 'Screen preview'}>
  <header class="screen-node__header drag-handle">
    <div class="screen-node__copy">
      <strong>{data?.title ?? 'Screen'}</strong>
      <span>{data?.viewport?.label ?? `${viewportWidth}×${viewportHeight}`}</span>
    </div>

    {#if data?.isolatedHref}
      <a class="screen-node__link" href={data.isolatedHref}>Open</a>
    {/if}
  </header>

  <div class="screen-node__viewport" style={viewportStyle}>
    <iframe
      title={data?.title ?? 'Screen preview'}
      src={data?.previewSrc}
      loading="lazy"
      tabindex="-1"
      style={iframeStyle}
    ></iframe>
  </div>
</article>

<Handle type="source" position={Position.Right} class="screen-node__handle" />

<style>
  .screen-node {
    overflow: hidden;
    border-radius: 24px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.92);
    box-shadow:
      0 20px 44px rgba(15, 23, 42, 0.18),
      0 1px 0 rgba(255, 255, 255, 0.92) inset;
    transition:
      transform 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  .screen-node.selected {
    border-color: rgba(99, 102, 241, 0.48);
    box-shadow:
      0 24px 52px rgba(79, 70, 229, 0.22),
      0 0 0 1px rgba(99, 102, 241, 0.08);
  }

  .screen-node__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.9) 100%),
      rgba(255, 255, 255, 0.96);
    cursor: grab;
  }

  .screen-node__header:active {
    cursor: grabbing;
  }

  .screen-node__copy {
    min-width: 0;
    display: grid;
    gap: 0.18rem;
  }

  .screen-node__copy strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.94rem;
    color: #0f172a;
  }

  .screen-node__copy span {
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #64748b;
  }

  .screen-node__link {
    flex: none;
    padding: 0.45rem 0.75rem;
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.1);
    color: #4f46e5;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-decoration: none;
  }

  .screen-node__viewport {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at top, rgba(99, 102, 241, 0.08), transparent 36%),
      #ffffff;
  }

  .screen-node__viewport iframe {
    display: block;
    border: 0;
    background: #ffffff;
    pointer-events: none;
  }

  :global(.dark) .screen-node {
    border-color: rgba(148, 163, 184, 0.22);
    background: rgba(15, 23, 42, 0.94);
    box-shadow:
      0 24px 52px rgba(2, 6, 23, 0.48),
      0 1px 0 rgba(255, 255, 255, 0.04) inset;
  }

  :global(.dark) .screen-node__header {
    border-bottom-color: rgba(148, 163, 184, 0.14);
    background:
      linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%),
      rgba(15, 23, 42, 0.96);
  }

  :global(.dark) .screen-node__copy strong {
    color: #e2e8f0;
  }

  :global(.dark) .screen-node__copy span {
    color: #94a3b8;
  }

  :global(.dark) .screen-node__link {
    background: rgba(129, 140, 248, 0.18);
    color: #c7d2fe;
  }

  :global(.dark) .screen-node__viewport iframe {
    background: #020617;
  }

  :global(.screen-node__handle) {
    width: 0.75rem;
    height: 0.75rem;
    border-width: 2px;
    border-color: rgba(79, 70, 229, 0.68);
    background: #ffffff;
  }

  :global(.dark .screen-node__handle) {
    border-color: rgba(165, 180, 252, 0.88);
    background: #0f172a;
  }
</style>
