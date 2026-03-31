<svelte:options runes={true} />

<script>
  import ScreenFrame from './ScreenFrame.svelte';

  let {
    variants = [],
    component = null,
    baseProps = {},
    width = 1280,
    height = 720,
    scale = 0.22
  } = $props();
</script>

{#if variants.length > 0}
  <div class="variant-strip" data-variant-count={variants.length}>
    <div class="variant-strip__label">Variants</div>

    <div class="variant-strip__list">
      {#each variants as variant (variant.id)}
        {@const variantProps = { ...(baseProps ?? {}), ...(variant.props ?? {}) }}

        <div class="variant-strip__item" data-variant-id={variant.id}>
          <ScreenFrame
            component={component}
            props={variantProps}
            width={width}
            height={height}
            title={variant.title}
            scale={scale}
          />
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .variant-strip {
    display: grid;
    gap: 0.75rem;
  }

  .variant-strip__label {
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--canvas-muted, #64748b);
  }

  .variant-strip__list {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  .variant-strip__item {
    flex: none;
  }
</style>
