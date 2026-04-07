<svelte:options runes={true} />

<script>
  import { onMount } from 'svelte';

  import {
    VIEWPORTS,
    VIEWPORT_OPTIONS,
    getScreenTitle,
    summarizeWorkflows,
    getWorkflowStats
  } from './lib/flow.js';
  import {
    getBasePath,
    getHash,
    overviewHash,
    parseRoute,
    presentationHash,
    previewPresentationSrc,
    screenHash,
    workflowHash
  } from './lib/routing.js';
  import {
    emptyManifestState,
    formatManifestTransportError,
    normalizeManifestPayload
  } from './lib/manifests.js';
  import ComparisonPanel from './components/ComparisonPanel.svelte';
  import Canvas from './views/Canvas.svelte';

  const VIEWPORT_STORAGE_KEY = 'component-canvas:shell-viewport';

  let manifestState = $state(emptyManifestState());
  let isLoading = $state(true);
  let streamStatus = $state('connecting');
  let transportIssue = $state('');
  let route = $state(parseRoute(getHash()));
  let viewportId = $state(resolveInitialViewportId());
  let sidebarOpen = $state(true);
  let presentations = $state([]);
  let workflowFocusRevision = $state(0);
  let workflowFocusRequest = $state(null);
  let comparisonScreens = $state([]);
  let comparisonClearRequest = $state(0);

  let workflows = $derived(manifestState.workflows);
  let manifestErrors = $derived(manifestState.errors);
  let viewport = $derived(VIEWPORTS[viewportId] ?? VIEWPORTS.desktop);
  let summary = $derived(summarizeWorkflows(workflows));
  let selectedWorkflow = $derived.by(() => {
    if (route.type === 'workflow' || route.type === 'screen' || route.type === 'variant') {
      return workflows.find((workflow) => workflow.id === route.workflowId) ?? null;
    }

    return null;
  });
  let selectedPresentation = $derived.by(() => {
    if (route.type !== 'presentation') return null;
    return presentations.find((presentation) => presentation.id === route.presentationId) ?? null;
  });
  let selectedWorkflowStats = $derived(selectedWorkflow ? getWorkflowStats(selectedWorkflow) : null);
  let selectedScreenTitle = $derived.by(() => {
    if (route.type !== 'screen' || !selectedWorkflow) return null;
    return getScreenTitle(selectedWorkflow.screens?.find((screen) => screen.id === route.screenId));
  });
  let currentContextTitle = $derived.by(() => {
    if (selectedPresentation) return selectedPresentation.title;
    if (selectedWorkflow) return selectedWorkflow.title;
    return 'Overview';
  });
  let currentContextMeta = $derived.by(() => {
    if (selectedWorkflowStats) {
      return `${selectedWorkflowStats.screenCount} screens · ${viewport.label} ${viewport.width}×${viewport.height}`;
    }

    if (selectedPresentation) {
      return `${selectedPresentation.items?.length ?? 0} items`;
    }

    return `${summary.workflowCount} workflows`;
  });
  let streamLabel = $derived.by(() => {
    if (streamStatus === 'live') return 'Live sync';
    if (streamStatus === 'reconnecting') return 'Reconnecting';
    return 'Connecting';
  });
  let presentationSrc = $derived.by(() => {
    if (!selectedPresentation) return null;
    return previewPresentationSrc(selectedPresentation.id);
  });

  onMount(() => {
    const syncRoute = () => {
      route = parseRoute(getHash());
    };

    const base = getBasePath();
    const eventSource = new EventSource(`${base}preview/api/manifests/stream`);

    window.addEventListener('hashchange', syncRoute);

    eventSource.onopen = () => {
      streamStatus = 'live';
      transportIssue = '';
    };

    eventSource.onmessage = (event) => {
      try {
        applyManifestPayload(JSON.parse(event.data));
        streamStatus = 'live';
        transportIssue = '';
      } catch (error) {
        streamStatus = 'reconnecting';
        transportIssue = `Failed to parse manifest update: ${formatManifestTransportError(error)}`;
      }
    };

    eventSource.onerror = () => {
      streamStatus = 'reconnecting';
      if (!transportIssue) {
        transportIssue = 'Manifest stream disconnected. Retrying…';
      }
    };

    void loadInitialManifests();
    void loadPresentations();

    return () => {
      window.removeEventListener('hashchange', syncRoute);
      eventSource.close();
    };
  });

  $effect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VIEWPORT_STORAGE_KEY, viewportId);
    }
  });

  async function loadInitialManifests() {
    try {
      const response = await fetch(`${getBasePath()}preview/api/manifests`, {
        headers: { accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applyManifestPayload(await response.json());
      transportIssue = '';
    } catch (error) {
      transportIssue = `Failed to fetch manifests: ${formatManifestTransportError(error)}`;
    } finally {
      isLoading = false;
    }
  }

  async function loadPresentations() {
    try {
      const response = await fetch(`${getBasePath()}preview/api/presentations`);
      if (response.ok) {
        presentations = await response.json();
      }
    } catch {
      // silent — presentations are optional
    }
  }

  function applyManifestPayload(payload) {
    manifestState = normalizeManifestPayload(payload);
    isLoading = false;
  }

  function navigate(hash) {
    if (typeof window === 'undefined') {
      route = parseRoute(hash);
      return;
    }
    if (window.location.hash === hash) {
      route = parseRoute(hash);
      return;
    }
    window.location.hash = hash;
  }

  function requestWorkflowFocus(workflowId) {
    workflowFocusRevision += 1;
    workflowFocusRequest = {
      type: 'workflow',
      workflowId,
      revision: workflowFocusRevision
    };
  }

  function focusWorkflow(workflowId) {
    requestWorkflowFocus(workflowId);
  }

  function requestOverviewFocus() {
    workflowFocusRevision += 1;
    workflowFocusRequest = {
      type: 'overview',
      revision: workflowFocusRevision
    };
  }

  function openOverview() {
    requestOverviewFocus();
    navigate(overviewHash());
  }

  function openWorkflow(workflowId) {
    focusWorkflow(workflowId);
    navigate(workflowHash(workflowId));
  }

  function openScreenRoute(workflowId, screenId) {
    focusWorkflow(workflowId);
    navigate(screenHash(workflowId, screenId));
  }

  function openPresentation(presentationId) {
    navigate(presentationHash(presentationId));
  }

  function handleCanvasSelectionChange(nextSelection) {
    comparisonScreens = Array.isArray(nextSelection) ? nextSelection : [];
  }

  function clearComparisonSelection() {
    comparisonScreens = [];
    comparisonClearRequest += 1;
  }

  function resolveInitialViewportId() {
    if (typeof window === 'undefined') return 'desktop';
    const stored = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
    return stored && stored in VIEWPORTS ? stored : 'desktop';
  }
</script>

<svelte:head>
  <title>component-canvas</title>
</svelte:head>

<div class="flex h-screen overflow-hidden bg-background text-foreground">
  <aside
    class={`relative shrink-0 overflow-hidden bg-card/95 transition-[width] duration-200 ease-out ${sidebarOpen ? 'w-56 border-r border-border' : 'w-0 border-r-0'}`}
  >
    <div
      class={`flex h-full min-w-56 flex-col transition-opacity duration-200 ease-out ${sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      aria-hidden={!sidebarOpen}
    >
      <div class="border-b border-border p-3">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left shadow-sm transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onclick={openOverview}
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-sm font-semibold text-foreground">
            CC
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-foreground">Component Canvas</p>
            <p class="truncate text-xs text-muted-foreground">
              {summary.workflowCount} workflows · {summary.screenCount} screens
            </p>
          </div>
        </button>
      </div>

      <div class="border-b border-border px-3 py-3">
        <div class="px-1 pb-2">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Viewport</span>
        </div>
        <div class="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/50 p-1">
          {#each VIEWPORT_OPTIONS as option (option.id)}
            <button
              type="button"
              class={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${viewportId === option.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground'}`}
              onclick={() => {
                viewportId = option.id;
              }}
            >
              {option.label}
            </button>
          {/each}
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto py-3">
        <div class="px-4 pb-2">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Workflows</span>
        </div>

        <div class="space-y-1 px-2">
          {#each workflows as workflow (workflow.id)}
            {@const stats = getWorkflowStats(workflow)}
            {@const isActive = selectedWorkflow?.id === workflow.id}
            <div class="space-y-1 pb-1">
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                class={`group flex w-full items-center gap-3 rounded-lg border border-transparent border-l-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isActive
                  ? 'border-border border-l-primary bg-accent text-accent-foreground shadow-sm'
                  : 'border-l-transparent text-muted-foreground'}`}
                onclick={() => openWorkflow(workflow.id)}
              >
                <span class="min-w-0 flex-1 truncate font-medium">{workflow.title}</span>
                <span class={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${isActive ? 'bg-card text-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {stats.screenCount}
                </span>
              </button>

              {#if isActive}
                <div class="space-y-1 pb-1 pl-3">
                  {#each workflow.screens as screen (screen.id)}
                    {@const isScreenActive = route.type === 'screen' && route.workflowId === workflow.id && route.screenId === screen.id}
                    <button
                      type="button"
                      aria-current={isScreenActive ? 'page' : undefined}
                      class={`group relative flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-1.5 pl-7 text-left text-xs transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isScreenActive
                        ? 'border-border bg-accent text-accent-foreground shadow-sm'
                        : 'text-muted-foreground'}`}
                      onclick={() => openScreenRoute(workflow.id, screen.id)}
                    >
                      <span class={`absolute left-3 size-1.5 rounded-full ${isScreenActive ? 'bg-primary' : 'bg-muted-foreground'}`}></span>
                      <span class="truncate">{getScreenTitle(screen)}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>

        {#if presentations.length > 0}
          <div class="mt-4 px-4 pb-2">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Presentations</span>
          </div>
          <div class="space-y-1 px-2">
            {#each presentations as presentation (presentation.id)}
              {@const isActivePresentation = selectedPresentation?.id === presentation.id}
              <button
                type="button"
                aria-current={isActivePresentation ? 'page' : undefined}
                class={`flex w-full items-center gap-3 rounded-lg border border-transparent border-l-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isActivePresentation
                  ? 'border-border border-l-primary bg-accent text-accent-foreground shadow-sm'
                  : 'border-l-transparent text-muted-foreground'}`}
                onclick={() => openPresentation(presentation.id)}
              >
                <span class="min-w-0 flex-1 truncate font-medium">{presentation.title}</span>
                <span class={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${isActivePresentation ? 'bg-card text-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {presentation.items?.length ?? 0}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </nav>

      <div class="border-t border-border p-3">
        <div class="rounded-xl border border-border bg-muted/40 p-3 shadow-sm">
          <div class="flex items-center gap-2">
            <span
              class={`size-2.5 shrink-0 rounded-full ${streamStatus === 'live'
                ? 'bg-emerald-500'
                : streamStatus === 'reconnecting'
                  ? 'animate-pulse bg-amber-400'
                  : 'bg-muted-foreground'}`}
            ></span>
            <p class="text-sm font-medium text-foreground">{streamLabel}</p>
            <span class="ml-auto text-xs text-muted-foreground">{summary.transitionCount} links</span>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            {summary.workflowCount} workflows · {summary.screenCount} screens
          </p>
          {#if manifestErrors.length > 0}
            <div class="mt-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive">
              {manifestErrors.length} manifest error{manifestErrors.length === 1 ? '' : 's'}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </aside>

  <main class="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <header class="flex h-14 flex-none items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur-sm">
      <button
        type="button"
        class="inline-flex size-9 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        onclick={() => {
          sidebarOpen = !sidebarOpen;
        }}
      >
        <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      <div class="h-5 w-px shrink-0 bg-border"></div>

      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            class="rounded-md px-1.5 py-1 transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onclick={openOverview}
          >
            Canvas
          </button>
          <svg class="size-3 shrink-0" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.5 2.25L7.75 6 4.5 9.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="truncate text-sm font-semibold text-foreground">{currentContextTitle}</span>
          {#if selectedScreenTitle}
            <span class="shrink-0 text-muted-foreground">/</span>
            <span class="truncate text-xs text-muted-foreground">{selectedScreenTitle}</span>
          {/if}
        </div>
        <div class="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span class="truncate">{currentContextMeta}</span>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div class="hidden items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground shadow-sm sm:flex">
          <span
            class={`size-2.5 shrink-0 rounded-full ${streamStatus === 'live'
              ? 'bg-emerald-500'
              : streamStatus === 'reconnecting'
                ? 'animate-pulse bg-amber-400'
                : 'bg-muted-foreground'}`}
          ></span>
          <span>{streamLabel}</span>
        </div>

        {#if transportIssue}
          <span class="max-w-[18rem] truncate text-xs text-amber-500" title={transportIssue}>
            {transportIssue}
          </span>
        {/if}
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col bg-muted/35">
      <div class="min-h-0 flex-1 overflow-hidden">
        {#if isLoading}
          <div class="flex h-full items-center justify-center px-6">
            <div class="rounded-xl border border-border bg-card px-6 py-5 text-center shadow-sm">
              <p class="text-sm font-medium text-foreground">Loading canvas…</p>
              <p class="mt-1 text-xs text-muted-foreground">Waiting for workflow manifests.</p>
            </div>
          </div>
        {:else if workflows.length === 0}
          <div class="flex h-full items-center justify-center px-6">
            <div class="max-w-sm rounded-xl border border-border bg-card px-6 py-6 text-center shadow-sm">
              <p class="text-sm font-semibold text-foreground">No workflows yet</p>
              <p class="mt-2 text-sm text-muted-foreground">
                Add a workflow to <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">.canvas/workflows/</code> to see it here.
              </p>
            </div>
          </div>
        {:else if selectedPresentation && presentationSrc}
          <iframe
            src={presentationSrc}
            title={selectedPresentation.title}
            class="h-full w-full border-0 bg-background"
            loading="eager"
          ></iframe>
        {:else}
          <Canvas
            {workflows}
            {viewport}
            focusRequest={workflowFocusRequest}
            activeWorkflowId={selectedWorkflow?.id ?? ''}
            selectedScreenId={route.type === 'screen' ? route.screenId : null}
            clearSelectionRequest={comparisonClearRequest}
            onSelectionChange={handleCanvasSelectionChange}
            onOpenScreen={(workflowId, screenId) => {
              navigate(screenHash(workflowId, screenId));
            }}
          />
        {/if}
      </div>

      {#if !isLoading && workflows.length > 0 && !(selectedPresentation && presentationSrc) && comparisonScreens.length >= 2}
        <ComparisonPanel
          screens={comparisonScreens}
          onClear={clearComparisonSelection}
          basePath={getBasePath()}
        />
      {/if}
    </div>
  </main>
</div>
