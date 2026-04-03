<svelte:options runes={true} />

<script>
  import { onMount } from 'svelte';

  import {
    VIEWPORTS,
    VIEWPORT_OPTIONS,
    getScreenTitle,
    summarizeWorkflows
  } from './lib/flow.js';
  import {
    getHash,
    overviewHash,
    parseRoute,
    previewScreenSrc,
    screenHash,
    workflowHash
  } from './lib/routing.js';
  import {
    emptyManifestState,
    formatManifestTransportError,
    normalizeManifestPayload
  } from './lib/manifests.js';
  import Overview from './views/Overview.svelte';
  import Workflow from './views/Workflow.svelte';

  const THEME_STORAGE_KEY = 'component-canvas:shell-theme';
  const VIEWPORT_STORAGE_KEY = 'component-canvas:shell-viewport';

  let manifestState = $state(emptyManifestState());
  let isLoading = $state(true);
  let streamStatus = $state('connecting');
  let transportIssue = $state('');
  let route = $state(parseRoute(getHash()));
  let viewportId = $state(resolveInitialViewportId());
  let theme = $state(resolveInitialTheme());

  let workflows = $derived(manifestState.workflows);
  let manifestErrors = $derived(manifestState.errors);
  let viewport = $derived(VIEWPORTS[viewportId] ?? VIEWPORTS.desktop);
  let summary = $derived(summarizeWorkflows(workflows));
  let selectedWorkflow = $derived.by(() => {
    if (route.type !== 'workflow' && route.type !== 'screen') {
      return null;
    }

    return workflows.find((workflow) => workflow.id === route.workflowId) ?? null;
  });
  let selectedScreen = $derived.by(() => {
    if (route.type !== 'screen' || !selectedWorkflow) {
      return null;
    }

    const screens = Array.isArray(selectedWorkflow.screens) ? selectedWorkflow.screens : [];

    return screens.find((screen) => screen.id === route.screenId) ?? null;
  });
  let isolatedPreviewSrc = $derived.by(() => {
    if (!selectedWorkflow || !selectedScreen) {
      return null;
    }

    return previewScreenSrc(selectedWorkflow.id, selectedScreen.id);
  });
  let statusLabel = $derived.by(() => {
    if (streamStatus === 'live') {
      return 'Live';
    }

    if (streamStatus === 'reconnecting') {
      return 'Reconnecting';
    }

    return 'Loading';
  });
  let pageCopy = $derived.by(() => {
    if (route.type === 'workflow' && selectedWorkflow) {
      return {
        title: selectedWorkflow.title,
        lede: 'Pan, zoom, and inspect the live workflow graph rendered with SvelteFlow.'
      };
    }

    if (route.type === 'screen' && selectedWorkflow && selectedScreen) {
      return {
        title: getScreenTitle(selectedScreen),
        lede: `Isolated preview for ${selectedWorkflow.title}.`
      };
    }

    if (route.type === 'not-found') {
      return {
        title: 'Unknown route',
        lede: 'This shell route is not recognized.'
      };
    }

    return {
      title: 'Workflow canvas',
      lede: 'Render real Svelte views as a spatial storyboard through the preview server.'
    };
  });

  onMount(() => {
    const syncRoute = () => {
      route = parseRoute(getHash());
    };

    const eventSource = new EventSource('/preview/api/manifests/stream');

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
        transportIssue = `Failed to parse live manifest update: ${formatManifestTransportError(error)}`;
      }
    };

    eventSource.onerror = () => {
      streamStatus = 'reconnecting';

      if (!transportIssue) {
        transportIssue = 'Live manifest stream disconnected. The shell will keep retrying.';
      }
    };

    void loadInitialManifests();

    return () => {
      window.removeEventListener('hashchange', syncRoute);
      eventSource.close();
    };
  });

  $effect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;

    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';

    return () => {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    };
  });

  $effect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  });

  $effect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(VIEWPORT_STORAGE_KEY, viewportId);
  });

  async function loadInitialManifests() {
    try {
      const response = await fetch('/preview/api/manifests', {
        headers: {
          accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      applyManifestPayload(await response.json());
      transportIssue = '';
    } catch (error) {
      transportIssue = `Failed to fetch manifests: ${formatManifestTransportError(error)}`;
    } finally {
      isLoading = false;
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

  function openOverview() {
    navigate(overviewHash());
  }

  function openWorkflow(workflowId) {
    navigate(workflowHash(workflowId));
  }

  function openScreen(workflowId, screenId) {
    navigate(screenHash(workflowId, screenId));
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
  }

  function resolveInitialTheme() {
    if (typeof window === 'undefined') {
      return 'light';
    }

    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    if (stored === 'light' || stored === 'dark') {
      return stored;
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  }

  function resolveInitialViewportId() {
    if (typeof window === 'undefined') {
      return 'desktop';
    }

    const stored = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);

    return stored && stored in VIEWPORTS ? stored : 'desktop';
  }
</script>

<svelte:head>
  <title>component-canvas</title>
</svelte:head>

<div class={`shell-app ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
  <header class="shell-header panel">
    <div class="shell-header__copy">
      <p class="shell-header__eyebrow">component-canvas</p>
      <h1>{pageCopy.title}</h1>
      <p class="shell-header__lede">{pageCopy.lede}</p>
    </div>

    <div class="shell-header__meta">
      <div class="shell-status" aria-live="polite">
        <span class={`shell-status__pill shell-status__pill--${streamStatus}`}>{statusLabel}</span>
        <small>{isLoading ? 'Loading manifest data…' : 'Streaming preview manifests from /preview/api/manifests/stream.'}</small>
      </div>

      <div class="shell-controls">
        <div class="shell-control-group">
          <span class="shell-control-group__label">Viewport</span>
          <div class="segmented-control" role="group" aria-label="Viewport">
            {#each VIEWPORT_OPTIONS as option (option.id)}
              <button
                type="button"
                class:active={viewportId === option.id}
                aria-pressed={viewportId === option.id}
                onclick={() => {
                  viewportId = option.id;
                }}
              >
                <span>{option.label}</span>
                <small>{option.width}×{option.height}</small>
              </button>
            {/each}
          </div>
        </div>

        <div class="shell-control-group">
          <span class="shell-control-group__label">Theme</span>
          <button
            type="button"
            class="theme-toggle"
            aria-pressed={theme === 'dark'}
            onclick={toggleTheme}
          >
            {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
    </div>
  </header>

  <section class="stats-bar panel" aria-label="Canvas summary">
    <div>
      <strong>{summary.workflowCount}</strong>
      <span>workflows</span>
    </div>
    <div>
      <strong>{summary.screenCount}</strong>
      <span>screens</span>
    </div>
    <div>
      <strong>{summary.transitionCount}</strong>
      <span>transitions</span>
    </div>
    <div>
      <strong>{summary.componentCount}</strong>
      <span>components</span>
    </div>
  </section>

  {#if transportIssue}
    <section class="panel panel--warning">
      <div class="panel__header">
        <h2>Live update status</h2>
      </div>
      <p>{transportIssue}</p>
    </section>
  {/if}

  {#if manifestErrors.length > 0}
    <section class="panel panel--error">
      <div class="panel__header">
        <h2>Manifest issues</h2>
        <span>{manifestErrors.length}</span>
      </div>

      <ul class="issue-list">
        {#each manifestErrors as error}
          <li>
            <strong>{error.file}</strong>
            <span>{error.message}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <main class="shell-main">
    {#if route.type === 'overview'}
      <Overview workflows={workflows} theme={theme} onOpenWorkflow={openWorkflow} />
    {:else if route.type === 'workflow'}
      {#if selectedWorkflow}
        <Workflow
          workflow={selectedWorkflow}
          {viewport}
          {theme}
          onBack={openOverview}
          onOpenScreen={openScreen}
        />
      {:else}
        <section class="panel panel--empty">
          <h2>Workflow not found</h2>
          <p>The route <code>{route.workflowId}</code> does not match any loaded workflow.</p>
          <a href={overviewHash()} onclick={(event) => {
            event.preventDefault();
            openOverview();
          }}>Return to overview</a>
        </section>
      {/if}
    {:else if route.type === 'screen'}
      {#if selectedWorkflow && selectedScreen && isolatedPreviewSrc}
        <section class="panel isolated-screen-panel">
          <div class="isolated-screen-panel__header">
            <div>
              <a
                class="isolated-screen-panel__back"
                href={workflowHash(selectedWorkflow.id)}
                onclick={(event) => {
                  event.preventDefault();
                  openWorkflow(selectedWorkflow.id);
                }}
              >
                ← Back to workflow
              </a>
              <h2>{getScreenTitle(selectedScreen)}</h2>
              <p>{selectedWorkflow.title}</p>
            </div>

            <a class="isolated-screen-panel__action" href={isolatedPreviewSrc} target="_blank" rel="noreferrer">
              Open preview tab
            </a>
          </div>

          <div class="isolated-screen-panel__body">
            <div
              class="isolated-screen-panel__frame"
              style={`width:${viewport.width}px;height:${viewport.height}px;`}
            >
              <iframe src={isolatedPreviewSrc} title={getScreenTitle(selectedScreen)}></iframe>
            </div>
          </div>
        </section>
      {:else}
        <section class="panel panel--empty">
          <h2>Screen not found</h2>
          <p>Could not resolve screen <code>{route.screenId}</code> in workflow <code>{route.workflowId}</code>.</p>
          <a href={overviewHash()} onclick={(event) => {
            event.preventDefault();
            openOverview();
          }}>Return to overview</a>
        </section>
      {/if}
    {:else}
      <section class="panel panel--empty">
        <h2>Unknown route</h2>
        <p>This shell route is not recognized.</p>
        <a href={overviewHash()} onclick={(event) => {
          event.preventDefault();
          openOverview();
        }}>Return to overview</a>
      </section>
    {/if}
  </main>
</div>

<style>
  :global(html) {
    background: #eef2ff;
  }

  :global(body) {
    background: inherit;
    color: inherit;
  }

  :global(code) {
    font-family: 'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .shell-app {
    --canvas-page-bg: linear-gradient(180deg, #eef2ff 0%, #f8fafc 48%, #f1f5f9 100%);
    --canvas-surface: rgba(255, 255, 255, 0.76);
    --canvas-border: rgba(148, 163, 184, 0.24);
    --canvas-text: #0f172a;
    --canvas-muted: #64748b;
    --canvas-accent: #4f46e5;
    min-height: 100vh;
    padding: 1.5rem;
    background: var(--canvas-page-bg);
    color: var(--canvas-text);
  }

  .shell-app.theme-dark {
    --canvas-page-bg:
      radial-gradient(circle at top, rgba(79, 70, 229, 0.24), transparent 28%),
      linear-gradient(180deg, #020617 0%, #0f172a 52%, #111827 100%);
    --canvas-surface: rgba(15, 23, 42, 0.78);
    --canvas-border: rgba(148, 163, 184, 0.22);
    --canvas-text: #e2e8f0;
    --canvas-muted: #94a3b8;
    --canvas-accent: #a5b4fc;
  }

  .shell-main {
    display: grid;
    gap: 1rem;
  }

  .panel {
    border: 1px solid var(--canvas-border);
    border-radius: 28px;
    background: var(--canvas-surface);
    box-shadow: 0 22px 60px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(22px);
  }

  .shell-header {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(20rem, 0.9fr);
    gap: 1.25rem;
    padding: 1.4rem;
    margin-bottom: 1rem;
  }

  .shell-header__copy h1 {
    margin: 0;
    font-size: clamp(2rem, 3vw, 2.75rem);
    line-height: 1;
  }

  .shell-header__eyebrow {
    margin: 0 0 0.55rem;
    font-size: 0.8rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--canvas-muted);
  }

  .shell-header__lede {
    margin: 0.65rem 0 0;
    max-width: 38rem;
    color: var(--canvas-muted);
  }

  .shell-header__meta {
    display: grid;
    gap: 1rem;
  }

  .shell-status {
    display: grid;
    gap: 0.35rem;
    justify-items: start;
    padding: 1rem 1.1rem;
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.56);
    border: 1px solid rgba(148, 163, 184, 0.14);
  }

  .shell-status small {
    color: var(--canvas-muted);
  }

  .shell-status__pill {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .shell-status__pill--live {
    background: rgba(34, 197, 94, 0.14);
    color: #15803d;
  }

  .shell-status__pill--connecting,
  .shell-status__pill--reconnecting {
    background: rgba(245, 158, 11, 0.16);
    color: #b45309;
  }

  .shell-controls {
    display: grid;
    gap: 0.9rem;
  }

  .shell-control-group {
    display: grid;
    gap: 0.45rem;
  }

  .shell-control-group__label {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--canvas-muted);
  }

  .segmented-control {
    display: inline-flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .segmented-control button,
  .theme-toggle {
    appearance: none;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.62);
    color: inherit;
    cursor: pointer;
    transition:
      transform 140ms ease,
      background 140ms ease,
      border-color 140ms ease;
  }

  .segmented-control button {
    display: grid;
    gap: 0.18rem;
    min-width: 7.5rem;
    padding: 0.7rem 0.9rem;
    text-align: left;
  }

  .segmented-control button small {
    color: var(--canvas-muted);
  }

  .segmented-control button.active,
  .theme-toggle {
    border-color: rgba(99, 102, 241, 0.3);
  }

  .segmented-control button.active {
    background: rgba(99, 102, 241, 0.14);
    color: var(--canvas-accent);
  }

  .theme-toggle {
    width: fit-content;
    padding: 0.7rem 1rem;
    font-weight: 700;
  }

  .segmented-control button:hover,
  .theme-toggle:hover {
    transform: translateY(-1px);
  }

  .stats-bar {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.85rem;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .stats-bar div {
    display: grid;
    gap: 0.2rem;
    padding: 0.95rem 1rem;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.56);
    border: 1px solid rgba(148, 163, 184, 0.12);
  }

  .stats-bar strong {
    font-size: 1.2rem;
  }

  .stats-bar span {
    color: var(--canvas-muted);
    font-size: 0.82rem;
  }

  .panel__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    padding: 1.1rem 1.25rem 0;
  }

  .panel__header h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .panel__header span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.5rem;
    border-radius: 999px;
    background: rgba(248, 113, 113, 0.16);
    color: #dc2626;
    font-weight: 800;
  }

  .panel--warning {
    margin-bottom: 1rem;
    padding: 0 1.25rem 1.2rem;
    border-color: rgba(245, 158, 11, 0.24);
  }

  .panel--warning p {
    margin: 0.75rem 0 0;
    color: var(--canvas-muted);
  }

  .panel--error {
    margin-bottom: 1rem;
    border-color: rgba(248, 113, 113, 0.28);
  }

  .issue-list {
    list-style: none;
    margin: 0;
    padding: 1rem 1.25rem 1.2rem;
    display: grid;
    gap: 0.75rem;
  }

  .issue-list li {
    display: grid;
    gap: 0.25rem;
    padding: 0.9rem 1rem;
    border-radius: 18px;
    background: rgba(254, 242, 242, 0.82);
    color: #991b1b;
  }

  .issue-list strong {
    font-size: 0.9rem;
    word-break: break-all;
  }

  .isolated-screen-panel {
    overflow: hidden;
  }

  .isolated-screen-panel__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    padding: 1.25rem 1.35rem 0;
  }

  .isolated-screen-panel__back {
    display: inline-flex;
    margin-bottom: 0.55rem;
    color: var(--canvas-accent);
    font-weight: 700;
    text-decoration: none;
  }

  .isolated-screen-panel__header h2,
  .isolated-screen-panel__header p {
    margin: 0;
  }

  .isolated-screen-panel__header p {
    margin-top: 0.45rem;
    color: var(--canvas-muted);
  }

  .isolated-screen-panel__action {
    flex: none;
    padding: 0.7rem 0.95rem;
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.12);
    border: 1px solid rgba(99, 102, 241, 0.24);
    color: var(--canvas-accent);
    font-size: 0.82rem;
    font-weight: 800;
    text-decoration: none;
  }

  .isolated-screen-panel__body {
    overflow: auto;
    padding: 1.25rem;
    display: grid;
    justify-items: center;
  }

  .isolated-screen-panel__frame {
    flex: none;
    border-radius: 28px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: #ffffff;
    box-shadow: 0 22px 52px rgba(15, 23, 42, 0.18);
  }

  .isolated-screen-panel__frame iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: #ffffff;
  }

  .panel--empty {
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    padding: 3rem 1.5rem;
    text-align: center;
  }

  .panel--empty h2,
  .panel--empty p {
    margin: 0;
  }

  .panel--empty p {
    color: var(--canvas-muted);
  }

  .panel--empty a {
    color: var(--canvas-accent);
    font-weight: 700;
    text-decoration: none;
  }

  @media (max-width: 960px) {
    .shell-header {
      grid-template-columns: 1fr;
    }

    .stats-bar {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 720px) {
    .isolated-screen-panel__header {
      flex-direction: column;
    }
  }

  @media (max-width: 640px) {
    .shell-app {
      padding: 1rem;
    }

    .shell-header,
    .stats-bar,
    .panel__header,
    .issue-list,
    .panel--warning,
    .panel--empty,
    .isolated-screen-panel__header,
    .isolated-screen-panel__body {
      padding-inline: 1rem;
    }

    .stats-bar {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
