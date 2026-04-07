<svelte:options runes={true} />

<script>
  let {
    fromRect = null,
    toRect = null,
    label = '',
    fromId = '',
    toId = '',
    markerId = 'flow-arrow-head',
    strokeWidth = 2,
    fontSize = 12
  } = $props();

  let geometry = $derived.by(() => {
    if (!fromRect || !toRect) return null;

    const fromCenterX = fromRect.x + (fromRect.width / 2);
    const fromCenterY = fromRect.y + (fromRect.height / 2);
    const toCenterX = toRect.x + (toRect.width / 2);
    const toCenterY = toRect.y + (toRect.height / 2);
    const leftToRight = fromCenterX <= toCenterX;
    const direction = leftToRight ? 1 : -1;
    const startX = leftToRight ? fromRect.x + fromRect.width : fromRect.x;
    const endX = leftToRight ? toRect.x : toRect.x + toRect.width;
    const startY = fromCenterY;
    const endY = toCenterY;
    const bend = Math.max(32, Math.abs(endX - startX) * 0.42);
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;

    return {
      startX,
      startY,
      endX,
      endY,
      midX,
      midY,
      path: `M ${startX} ${startY} C ${startX + (bend * direction)} ${startY}, ${endX - (bend * direction)} ${endY}, ${endX} ${endY}`
    };
  });
</script>

{#if geometry}
  <g class="pointer-events-none" data-from={fromId} data-to={toId} data-label={label}>
    <path
      d={geometry.path}
      marker-end="url(#{markerId})"
      fill="none"
      stroke="var(--color-border)"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    {#if label}
      <text
        x={geometry.midX}
        y={geometry.midY - 8}
        text-anchor="middle"
        dominant-baseline="central"
        fill="var(--color-muted-foreground)"
        font-size={fontSize}
        font-weight="600"
        paint-order="stroke fill"
        stroke="var(--color-background)"
        stroke-width="6"
      >
        {label}
      </text>
    {/if}
  </g>
{/if}
