<svelte:options runes={true} />

<script>
  let {
    group = null
  } = $props()

  let bounds = $derived(group?.bounds ?? { x: 0, y: 0, width: 0, height: 0 })
  let frameStyle = $derived(
    `left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 0)}px;height:${Math.max(bounds.height, 0)}px;`
  )
</script>

<div
  class="group-frame"
  data-group-id={group?.id ?? undefined}
  style={frameStyle}
  aria-label={group?.title ?? group?.id ?? 'Group'}
>
  <div class="group-frame__label">{group?.title ?? group?.id ?? 'Group'}</div>
</div>

<style>
  .group-frame {
    position: absolute;
    border-radius: 32px;
    border: 1.5px dashed rgba(99, 102, 241, 0.32);
    background: rgba(99, 102, 241, 0.04);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.56);
    pointer-events: none;
  }

  .group-frame__label {
    position: absolute;
    inset-inline-start: 1.2rem;
    inset-block-start: 1rem;
    display: inline-flex;
    max-width: calc(100% - 2.4rem);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0.45rem 0.8rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.86);
    border: 1px solid rgba(99, 102, 241, 0.18);
    color: var(--canvas-accent, #4f46e5);
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    box-shadow: 0 10px 24px rgba(79, 70, 229, 0.08);
  }

  :global(.dark) .group-frame {
    border-color: rgba(165, 180, 252, 0.34);
    background: rgba(99, 102, 241, 0.08);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  :global(.dark) .group-frame__label {
    background: rgba(15, 23, 42, 0.88);
    border-color: rgba(165, 180, 252, 0.22);
    color: #c7d2fe;
    box-shadow: 0 12px 28px rgba(2, 6, 23, 0.26);
  }
</style>
