<script>
  import { onMount } from 'svelte';

  import workflows, { errors as manifestErrors } from 'virtual:canvas-manifests';
  import componentRegistry from 'virtual:canvas-components';

  const workflowList = Array.isArray(workflows) ? workflows : [];
  const registry = componentRegistry ?? {};

  let route = parseRoute(getHash());

  const componentCount = Object.keys(registry).length;

  function getHash() {
    if (typeof window === 'undefined') {
      return '#/';
    }

    return window.location.hash || '#/';
  }

  function parseRoute(hash) {
    const normalized = hash.replace(/^#/, '') || '/';

    if (normalized === '/' || normalized === '') {
      return { type: 'overview' };
    }

    const match = normalized.match(/^\/workflow\/([^/]+)$/);

    if (match) {
      return {
        type: 'workflow',
        workflowId: decodeURIComponent(match[1])
      };
    }

    return { type: 'not-found' };
  }

  function updateRoute() {
    route = parseRoute(getHash());
  }

  function componentKey(workflowId, componentPath) {
    const normalizedPath = String(componentPath)
      .replace(/^\.\//, '')
      .replace(/\\/g, '/')
      .replace(/\.svelte$/i, '');

    return `${workflowId}/${normalizedPath}`;
  }

  function hasComponent(workflowId, componentPath) {
    return Boolean(registry[componentKey(workflowId, componentPath)]);
  }

  onMount(() => {
    updateRoute();
    window.addEventListener('hashchange', updateRoute);

    return () => {
      window.removeEventListener('hashchange', updateRoute);
    };
  });

  $: selectedWorkflow = route.type === 'workflow'
    ? workflowList.find((workflow) => workflow.id === route.workflowId) ?? null
    : null;
</script>

<svelte:head>
  <title>component-canvas</title>
</svelte:head>

<div class="app-shell">
  <header class="app-header">
    <div>
      <p class="eyebrow">component-canvas</p>
      <h1>Workflow canvas</h1>
    </div>
    <div class="summary">
      <span>{workflowList.length} workflow{workflowList.length === 1 ? '' : 's'}</span>
      <span>{componentCount} component{componentCount === 1 ? '' : 's'}</span>
    </div>
  </header>

  {#if manifestErrors.length > 0}
    <section class="panel error-panel">
      <h2>Manifest issues</h2>
      <ul>
        {#each manifestErrors as error}
          <li>
            <strong>{error.file}</strong>
            <span>{error.message}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if route.type === 'overview'}
    <section class="panel">
      <h2>Overview</h2>

      {#if workflowList.length === 0}
        <p class="empty-state">No workflows yet. Add a workflow to <code>.canvas/workflows/</code> to see it here.</p>
      {:else}
        <ul class="workflow-list">
          {#each workflowList as workflow}
            <li>
              <a class="workflow-link" href={`#/workflow/${encodeURIComponent(workflow.id)}`}>
                <span class="workflow-title">{workflow.title}</span>
                <span class="workflow-meta">{workflow.screens.length} screen{workflow.screens.length === 1 ? '' : 's'}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else if route.type === 'workflow'}
    <section class="panel">
      <p><a class="back-link" href="#/">← Back to overview</a></p>

      {#if selectedWorkflow}
        <h2>{selectedWorkflow.title}</h2>
        <p class="workflow-description">
          {selectedWorkflow.screens.length} screen{selectedWorkflow.screens.length === 1 ? '' : 's'} ·
          {selectedWorkflow.transitions.length} transition{selectedWorkflow.transitions.length === 1 ? '' : 's'}
        </p>

        <ul class="screen-list">
          {#each selectedWorkflow.screens as screen}
            <li>
              <div>
                <h3>{screen.title ?? screen.id}</h3>
                <p class="screen-meta">id: <code>{screen.id}</code></p>
                <p class="screen-meta">component: <code>{screen.component}</code></p>
              </div>
              <span class:resolved={hasComponent(selectedWorkflow.id, screen.component)} class="component-status">
                {#if hasComponent(selectedWorkflow.id, screen.component)}
                  component registered
                {:else}
                  component missing
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-state">Workflow <code>{route.workflowId}</code> was not found.</p>
      {/if}
    </section>
  {:else}
    <section class="panel">
      <p class="empty-state">Unknown route. <a class="back-link" href="#/">Return to overview</a>.</p>
    </section>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: Inter, system-ui, sans-serif;
    background: #f3f4f6;
    color: #111827;
  }

  :global(code) {
    font-family: 'SFMono-Regular', ui-monospace, monospace;
  }

  .app-shell {
    box-sizing: border-box;
    min-height: 100vh;
    margin: 0 auto;
    padding: 2rem;
    max-width: 72rem;
  }

  .app-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .app-header h1 {
    margin: 0.25rem 0 0;
    font-size: 2rem;
  }

  .eyebrow {
    margin: 0;
    color: #6b7280;
    font-size: 0.875rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .summary {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    color: #4b5563;
    font-size: 0.95rem;
  }

  .panel {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 1rem;
    padding: 1.25rem;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
  }

  .panel + .panel {
    margin-top: 1rem;
  }

  .error-panel {
    border-color: #fca5a5;
    background: #fef2f2;
  }

  .error-panel ul,
  .workflow-list,
  .screen-list {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
  }

  .error-panel li,
  .screen-list li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    padding: 0.875rem 0;
    border-top: 1px solid #e5e7eb;
  }

  .error-panel li:first-child,
  .screen-list li:first-child {
    border-top: none;
    padding-top: 0;
  }

  .workflow-list li + li {
    margin-top: 0.75rem;
  }

  .workflow-link {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    padding: 1rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.875rem;
    background: #f9fafb;
    text-decoration: none;
    color: inherit;
  }

  .workflow-link:hover {
    border-color: #93c5fd;
    background: #eff6ff;
  }

  .workflow-title {
    font-weight: 600;
  }

  .workflow-meta,
  .workflow-description,
  .screen-meta,
  .empty-state,
  .back-link {
    color: #4b5563;
  }

  .screen-meta {
    margin: 0.25rem 0 0;
  }

  .component-status {
    white-space: nowrap;
    font-size: 0.875rem;
    color: #b91c1c;
    background: #fee2e2;
    padding: 0.4rem 0.65rem;
    border-radius: 999px;
  }

  .component-status.resolved {
    color: #166534;
    background: #dcfce7;
  }

  @media (max-width: 640px) {
    .app-shell {
      padding: 1rem;
    }

    .workflow-link,
    .error-panel li,
    .screen-list li {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
