<svelte:options runes={true} />

<script>
  import workflows, { errors as manifestIssueData } from 'virtual:canvas-manifests';
  import componentRegistry from 'virtual:canvas-components';

  import Overview from './views/Overview.svelte';
  import Workflow from './views/Workflow.svelte';

  const workflowList = Array.isArray(workflows) ? workflows : [];
  const manifestErrors = Array.isArray(manifestIssueData) ? manifestIssueData : [];
  const registry = componentRegistry ?? {};

  const VIEWPORTS = {
    desktop: {
      id: 'desktop',
      label: 'Desktop',
      width: 1280,
      height: 720
    },
    mobile: {
      id: 'mobile',
      label: 'Mobile',
      width: 375,
      height: 812
    }
  };

  const viewportOptions = Object.values(VIEWPORTS);

  let route = $state(parseRoute(getHash()));
  let viewportId = $state('desktop');
  let theme = $state('light');

  let viewport = $derived(VIEWPORTS[viewportId] ?? VIEWPORTS.desktop);
  let selectedWorkflow = $derived(
    route.type === 'workflow'
      ? workflowList.find((workflow) => workflow.id === route.workflowId) ?? null
      : null
  );
  let totalScreens = $derived(
    workflowList.reduce((count, workflow) => count + workflow.screens.length, 0)
  );
  let totalTransitions = $derived(
    workflowList.reduce((count, workflow) => count + workflow.transitions.length, 0)
  );
  let componentCount = $derived(Object.keys(registry).length);

  $effect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncRoute = () => {
      route = parseRoute(getHash());
    };

    syncRoute();
    window.addEventListener('hashchange', syncRoute);

    return () => {
      window.removeEventListener('hashchange', syncRoute);
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

  function getHash() {
    if (typeof window === 'undefined') {
      return '#/';
    }

    return window.location.hash || '#/';
  }

  function parseRoute(hash) {
    const normalizedHash = hash.replace(/^#/, '') || '/';

    if (normalizedHash === '/' || normalizedHash === '') {
      return { type: 'overview' };
    }

    const workflowMatch = normalizedHash.match(/^\/workflow\/([^/]+)$/u);

    if (workflowMatch) {
      return {
        type: 'workflow',
        workflowId: decodeURIComponent(workflowMatch[1])
      };
    }

    return { type: 'not-found' };
  }
</script>

<svelte:head>
  <title>component-canvas</title>
</svelte:head>

<div class={`app-shell ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
  <header class="app-header panel">
    <div class="app-header__copy">
      <p class="app-header__eyebrow">component-canvas</p>
      <h1>Workflow canvas</h1>
      <p class="app-header__lede">Render real Svelte views as a spatial storyboard.</p>
    </div>

    <div class="app-header__meta">
      <div class="app-header__stats" aria-label="Canvas summary">
        <div>
          <strong>{workflowList.length}</strong>
          <span>workflows</span>
        </div>
        <div>
          <strong>{totalScreens}</strong>
          <span>screens</span>
        </div>
        <div>
          <strong>{totalTransitions}</strong>
          <span>transitions</span>
        </div>
        <div>
          <strong>{componentCount}</strong>
          <span>components</span>
        </div>
      </div>

      <div class="app-controls">
        <div class="app-control-group">
          <span class="app-control-group__label">Viewport</span>
          <div class="segmented-control" role="group" aria-label="Viewport">
            {#each viewportOptions as option (option.id)}
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

        <div class="app-control-group">
          <span class="app-control-group__label">Theme</span>
          <button
            type="button"
            class="theme-toggle"
            aria-pressed={theme === 'dark'}
            onclick={() => {
              theme = theme === 'dark' ? 'light' : 'dark';
            }}
          >
            {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
    </div>
  </header>

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

  <main class="app-main">
    {#if route.type === 'overview'}
      <Overview workflows={workflowList} components={registry} viewport={viewport} />
    {:else if route.type === 'workflow'}
      {#if selectedWorkflow}
        <Workflow workflow={selectedWorkflow} components={registry} viewport={viewport} />
      {:else}
        <section class="panel panel--empty">
          <h2>Workflow not found</h2>
          <p>The route <code>{route.workflowId}</code> does not match any loaded workflow.</p>
          <a href="#/">Return to overview</a>
        </section>
      {/if}
    {:else}
      <section class="panel panel--empty">
        <h2>Unknown route</h2>
        <p>This canvas route is not recognized.</p>
        <a href="#/">Return to overview</a>
      </section>
    {/if}
  </main>
</div>

<style>
  :global(html) {
    background: #eef2ff;
  }

  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: inherit;
    color: inherit;
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  :global(code) {
    font-family: 'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .app-shell {
    --canvas-page-bg: linear-gradient(180deg, #eef2ff 0%, #f8fafc 48%, #f1f5f9 100%);
    --canvas-surface: rgba(255, 255, 255, 0.76);
    --canvas-border: rgba(148, 163, 184, 0.24);
    --canvas-text: #0f172a;
    --canvas-muted: #64748b;
    --canvas-accent: #4f46e5;
    --canvas-frame-border: rgba(148, 163, 184, 0.42);
    --canvas-frame-surface: rgba(255, 255, 255, 0.96);
    --canvas-viewport-bg: #ffffff;
    --canvas-arrow: #6366f1;
    --canvas-arrow-text: #334155;
    --canvas-arrow-halo: rgba(255, 255, 255, 0.92);
    min-height: 100vh;
    box-sizing: border-box;
    padding: 1.5rem;
    background: var(--canvas-page-bg);
    color: var(--canvas-text);
  }

  .app-shell.theme-dark {
    --canvas-page-bg: radial-gradient(circle at top, rgba(79, 70, 229, 0.24), transparent 28%), linear-gradient(180deg, #020617 0%, #0f172a 52%, #111827 100%);
    --canvas-surface: rgba(15, 23, 42, 0.78);
    --canvas-border: rgba(148, 163, 184, 0.22);
    --canvas-text: #e2e8f0;
    --canvas-muted: #94a3b8;
    --canvas-accent: #a5b4fc;
    --canvas-frame-border: rgba(148, 163, 184, 0.24);
    --canvas-frame-surface: rgba(15, 23, 42, 0.96);
    --canvas-viewport-bg: #0f172a;
    --canvas-arrow: #a5b4fc;
    --canvas-arrow-text: #cbd5e1;
    --canvas-arrow-halo: rgba(15, 23, 42, 0.92);
  }

  .app-main {
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

  .app-header {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(20rem, 0.9fr);
    gap: 1.25rem;
    padding: 1.4rem;
    margin-bottom: 1rem;
  }

  .app-header__copy h1 {
    margin: 0;
    font-size: clamp(2rem, 3vw, 2.75rem);
    line-height: 1;
  }

  .app-header__eyebrow {
    margin: 0 0 0.55rem;
    font-size: 0.8rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--canvas-muted);
  }

  .app-header__lede {
    margin: 0.65rem 0 0;
    max-width: 34rem;
    color: var(--canvas-muted);
  }

  .app-header__meta {
    display: grid;
    gap: 1rem;
  }

  .app-header__stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .app-header__stats div {
    display: grid;
    gap: 0.2rem;
    padding: 0.9rem 1rem;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.14);
  }

  .app-header__stats strong {
    font-size: 1.2rem;
  }

  .app-header__stats span {
    font-size: 0.82rem;
    color: var(--canvas-muted);
  }

  .app-controls {
    display: grid;
    gap: 0.9rem;
  }

  .app-control-group {
    display: grid;
    gap: 0.45rem;
  }

  .app-control-group__label {
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
    .app-header {
      grid-template-columns: 1fr;
    }

    .app-header__stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .app-shell {
      padding: 1rem;
    }

    .app-header,
    .panel__header,
    .issue-list,
    .panel--empty {
      padding-inline: 1rem;
    }

    .app-header__stats {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
