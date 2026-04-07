<svelte:options runes={true} />

<script>
  const PREVIEW_WIDTH = 400;
  const PREVIEW_VIEWPORT_WIDTH = 1280;
  const PREVIEW_SCALE = PREVIEW_WIDTH / PREVIEW_VIEWPORT_WIDTH;

  let {
    screens = [],
    onClear = () => {},
    basePath = '/'
  } = $props();

  let safeScreens = $derived(Array.isArray(screens) ? screens : []);
  let safeBasePath = $derived(String(basePath || '/').replace(/\/?$/u, '/'));

  function getPreviewSrc(screen) {
    if (!screen?.workflowId || !screen?.screenId) {
      return 'about:blank';
    }

    return `${safeBasePath}preview/#/screen/${encodeURIComponent(screen.workflowId)}/${encodeURIComponent(screen.screenId)}`;
  }
</script>

<div class="max-h-[320px] overflow-hidden border-t border-border bg-card">
  <div class="flex items-center justify-between border-b border-border px-4 py-2">
    <span class="text-sm font-medium">Comparing {safeScreens.length} screens</span>
    <button
      type="button"
      onclick={onClear}
      class="text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      Clear
    </button>
  </div>

  <div class="flex gap-4 overflow-x-auto overflow-y-auto p-4">
    {#each safeScreens as screen (`${screen.workflowId}/${screen.screenId}`)}
      <div class="flex-none w-[400px] space-y-2">
        <span class="block truncate text-xs font-medium text-muted-foreground">{screen.title}</span>
        <div class="relative overflow-hidden rounded-lg border border-border bg-background" style="aspect-ratio: 16/9;">
          <iframe
            src={getPreviewSrc(screen)}
            title={`${screen.title} comparison`}
            class="absolute inset-0 h-[720px] w-[1280px] border-0 origin-top-left"
            style={`transform: scale(${PREVIEW_SCALE});`}
            loading="eager"
          ></iframe>
        </div>
      </div>
    {/each}
  </div>
</div>
