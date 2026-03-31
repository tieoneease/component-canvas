<svelte:options runes={true} />

<script>
  let {
    component = null,
    props = {},
    width = 1280,
    height = 720,
    title = 'Screen',
    scale = 1
  } = $props();

  const HEADER_HEIGHT = 42;

  let safeScale = $derived(Number.isFinite(scale) && scale > 0 ? scale : 1);
  let shellWidth = $derived(Math.max(width * safeScale, 1));
  let shellHeight = $derived(Math.max((height + HEADER_HEIGHT) * safeScale, 1));
  let shellStyle = $derived(`width:${shellWidth}px;height:${shellHeight}px;`);
  let frameStyle = $derived(`width:${width}px;transform:scale(${safeScale});transform-origin:top left;`);
  let viewportStyle = $derived(`width:${width}px;height:${height}px;`);
</script>

<div class="screen-frame-shell" style={shellStyle} data-screen-frame>
  <div class="screen-frame" style={frameStyle}>
    <div class="screen-frame__header">
      <div class="screen-frame__lights" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div class="screen-frame__title">{title}</div>
      <div class="screen-frame__size">{width}×{height}</div>
    </div>

    <div class="screen-frame__viewport" style={viewportStyle}>
      {#if component}
        {@const CanvasComponent = component}
        <CanvasComponent {...props} />
      {:else}
        <div class="screen-frame__missing">Component not found</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .screen-frame-shell {
    position: relative;
    flex: none;
  }

  .screen-frame {
    position: relative;
    border-radius: 24px;
    overflow: hidden;
    border: 1px solid var(--canvas-frame-border, rgba(148, 163, 184, 0.45));
    background: var(--canvas-frame-surface, rgba(255, 255, 255, 0.98));
    box-shadow:
      0 22px 48px rgba(15, 23, 42, 0.18),
      0 1px 0 rgba(255, 255, 255, 0.8) inset;
  }

  .screen-frame__header {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    height: 42px;
    padding: 0 1rem;
    border-bottom: 1px solid var(--canvas-frame-border, rgba(148, 163, 184, 0.32));
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(248, 250, 252, 0.9) 100%),
      var(--canvas-frame-surface, rgba(255, 255, 255, 0.96));
    color: var(--canvas-text, #0f172a);
  }

  .screen-frame__lights {
    display: flex;
    gap: 0.4rem;
    flex: none;
  }

  .screen-frame__lights span {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.6);
  }

  .screen-frame__lights span:nth-child(1) {
    background: rgba(248, 113, 113, 0.92);
  }

  .screen-frame__lights span:nth-child(2) {
    background: rgba(250, 204, 21, 0.92);
  }

  .screen-frame__lights span:nth-child(3) {
    background: rgba(74, 222, 128, 0.92);
  }

  .screen-frame__title {
    min-width: 0;
    flex: 1;
    font-size: 0.95rem;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .screen-frame__size {
    flex: none;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--canvas-muted, #64748b);
  }

  .screen-frame__viewport {
    box-sizing: border-box;
    overflow: auto;
    background:
      radial-gradient(circle at top, rgba(99, 102, 241, 0.08), transparent 36%),
      var(--canvas-viewport-bg, #ffffff);
    color: inherit;
    contain: layout paint style;
    content-visibility: auto;
  }

  .screen-frame__missing {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    padding: 2rem;
    box-sizing: border-box;
    text-align: center;
    font-size: 1.125rem;
    font-weight: 600;
    color: #b91c1c;
    background: rgba(254, 242, 242, 0.92);
  }

  :global(html.dark) .screen-frame {
    box-shadow:
      0 20px 48px rgba(2, 6, 23, 0.52),
      0 1px 0 rgba(255, 255, 255, 0.03) inset;
  }

  :global(html.dark) .screen-frame__header {
    background:
      linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%),
      rgba(15, 23, 42, 0.96);
  }
</style>
