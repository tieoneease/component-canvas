<svelte:options runes={true} />

<script>
  import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    SvelteFlow
  } from '@xyflow/svelte';

  import { buildWorkflowGraph, getWorkflowStats } from '../lib/flow.js';
  import ScreenNode from '../nodes/ScreenNode.svelte';
  import { overviewHash } from '../lib/routing.js';

  let {
    workflow = null,
    viewport = { width: 1280, height: 720 },
    theme = 'light',
    onBack = () => {},
    onOpenScreen = () => {}
  } = $props();

  const nodeTypes = {
    screen: ScreenNode
  };

  let graph = $derived(buildWorkflowGraph(workflow, viewport));
  let stats = $derived(getWorkflowStats(workflow));
</script>

<section class="workflow-view" data-workflow-id={workflow?.id ?? undefined}>
  {#if workflow}
    <header class="workflow-view__header panel">
      <div>
        <a
          class="workflow-view__back"
          href={overviewHash()}
          onclick={(event) => {
            event.preventDefault();
            onBack();
          }}
        >
          ← All workflows
        </a>
        <h2>{workflow.title}</h2>
        <p>
          {stats.screenCount} screen{stats.screenCount === 1 ? '' : 's'} ·
          {stats.transitionCount} transition{stats.transitionCount === 1 ? '' : 's'} ·
          {stats.variantCount} variant{stats.variantCount === 1 ? '' : 's'}
        </p>
      </div>

      <div class="workflow-view__badge">{viewport.width}×{viewport.height}</div>
    </header>

    {#if graph.nodes.length === 0}
      <div class="workflow-view__empty panel">This workflow does not define any screens yet.</div>
    {:else}
      <div class="workflow-view__canvas-shell panel">
        <SvelteFlow
          id={`workflow-${workflow.id}`}
          nodes={graph.nodes}
          edges={graph.edges}
          {nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.2}
          maxZoom={1.5}
          colorMode={theme}
          onlyRenderVisibleElements
          onnodeclick={({ node }) => {
            onOpenScreen(workflow.id, node.id);
          }}
        >
          <Controls showLock={false} />
          <MiniMap
            pannable
            zoomable
            nodeBorderRadius={18}
            width={180}
            height={120}
            maskColor="rgba(99, 102, 241, 0.12)"
          />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        </SvelteFlow>
      </div>
    {/if}
  {:else}
    <div class="workflow-view__empty panel">Workflow not found.</div>
  {/if}
</section>

<style>
  .workflow-view {
    display: grid;
    gap: 1rem;
  }

  .panel {
    border: 1px solid var(--canvas-border, rgba(148, 163, 184, 0.24));
    border-radius: 28px;
    background: var(--canvas-surface, rgba(255, 255, 255, 0.8));
    box-shadow: 0 22px 60px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(22px);
  }

  .workflow-view__header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    padding: 1.25rem 1.35rem;
  }

  .workflow-view__back {
    display: inline-flex;
    margin-bottom: 0.55rem;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--canvas-accent, #4f46e5);
    text-decoration: none;
  }

  .workflow-view__header h2 {
    margin: 0;
    font-size: 1.55rem;
    color: var(--canvas-text, #0f172a);
  }

  .workflow-view__header p {
    margin: 0.45rem 0 0;
    color: var(--canvas-muted, #64748b);
  }

  .workflow-view__badge {
    flex: none;
    padding: 0.7rem 0.95rem;
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.12);
    border: 1px solid rgba(99, 102, 241, 0.24);
    color: var(--canvas-accent, #4f46e5);
    font-size: 0.82rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .workflow-view__canvas-shell {
    overflow: hidden;
    min-height: 42rem;
    background:
      linear-gradient(180deg, rgba(248, 250, 252, 0.84), rgba(241, 245, 249, 0.96));
  }

  .workflow-view__canvas-shell :global(.svelte-flow) {
    width: 100%;
    min-height: 42rem;
  }

  .workflow-view__canvas-shell :global(.svelte-flow__controls) {
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
    border-radius: 18px;
    overflow: hidden;
  }

  .workflow-view__canvas-shell :global(.svelte-flow__controls-button) {
    border-color: rgba(148, 163, 184, 0.18);
  }

  .workflow-view__canvas-shell :global(.svelte-flow__minimap) {
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.2);
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.1);
    background: rgba(255, 255, 255, 0.92);
  }

  .workflow-view__empty {
    display: grid;
    place-items: center;
    min-height: 18rem;
    padding: 2rem;
    color: var(--canvas-muted, #64748b);
    text-align: center;
  }

  @media (max-width: 720px) {
    .workflow-view__header {
      padding: 1rem;
    }

    .workflow-view__canvas-shell,
    .workflow-view__canvas-shell :global(.svelte-flow) {
      min-height: 34rem;
    }
  }
</style>
