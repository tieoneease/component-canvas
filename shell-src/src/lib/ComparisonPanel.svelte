<svelte:options runes={true} />

<script>
  import { slide } from 'svelte/transition';

  import { previewScreenSrc } from './routing.js';

  const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
  const PREVIEW_CELL_WIDTH = 400;
  const PREVIEW_MAX_HEIGHT = 220;

  let {
    screens = [],
    viewport = DEFAULT_VIEWPORT,
    onClear = () => {}
  } = $props();

  let safeScreens = $derived(Array.isArray(screens) ? screens : []);
  let viewportWidth = $derived(Number(viewport?.width) > 0 ? Number(viewport.width) : DEFAULT_VIEWPORT.width);
  let viewportHeight = $derived(Number(viewport?.height) > 0 ? Number(viewport.height) : DEFAULT_VIEWPORT.height);
  let previewScale = $derived(
    Math.min(PREVIEW_CELL_WIDTH / viewportWidth, PREVIEW_MAX_HEIGHT / viewportHeight, 1)
  );
  let previewFrameWidth = $derived(Math.max(viewportWidth * previewScale, 1));
  let previewFrameHeight = $derived(Math.max(viewportHeight * previewScale, 1));

  function clearSelection() {
    if (typeof onClear !== 'function') return;
    onClear();
  }

  function getPreviewSrc(screen) {
    if (!screen?.workflowId || !screen?.screenId) {
      return 'about:blank';
    }

    return previewScreenSrc(screen.workflowId, screen.screenId);
  }
</script>

<section
  class="border-t border-border/80 bg-card/95 backdrop-blur-sm"
  aria-label="Screen comparison panel"
  transition:slide={{ axis: 'y', duration: 180 }}
>
  <div class="flex h-[300px] flex-col gap-4 px-4 py-3">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-foreground">Comparing {safeScreens.length} screens</h2>
        <p class="text-xs text-muted-foreground">Live previews stay in sync with the selected storyboard nodes.</p>
      </div>

      <button
        type="button"
        class="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onclick={clearSelection}
      >
        Clear
      </button>
    </div>

    <div class="flex min-h-0 gap-4 overflow-x-auto pb-2 pr-2">
      {#each safeScreens as screen (`${screen.workflowId ?? 'workflow'}:${screen.screenId ?? 'screen'}`)}
        <article class="flex h-full w-[400px] shrink-0 flex-col rounded-xl border border-border bg-background/60 p-3 shadow-sm">
          <div class="min-w-0 pb-3">
            <p class="truncate text-sm font-semibold text-foreground">{screen.title ?? screen.screenId ?? 'Screen'}</p>
            <p class="truncate text-xs text-muted-foreground">{screen.workflowTitle ?? screen.workflowId ?? 'Workflow'}</p>
          </div>

          <div class="flex min-h-0 flex-1 items-start justify-center overflow-hidden rounded-lg border border-border bg-background/90 p-2">
            <iframe
              title="{screen.title ?? screen.screenId ?? 'Screen'} comparison preview"
              src={getPreviewSrc(screen)}
              loading="lazy"
              tabindex="-1"
              class="pointer-events-none block border-0 bg-background shadow-sm"
              style="width:{viewportWidth}px;height:{viewportHeight}px;transform:scale({previewScale});transform-origin:top left;"
            ></iframe>
          </div>

          <div class="pt-2 text-[11px] text-muted-foreground">
            {Math.round(previewFrameWidth)} × {Math.round(previewFrameHeight)} preview
          </div>
        </article>
      {/each}
    </div>
  </div>
</section>
