<svelte:options runes={true} />

<script>
  import { Background, BackgroundVariant, SvelteFlow } from '@xyflow/svelte';

  import { buildOverviewGraph, getWorkflowStats } from '../lib/flow.js';
  import { workflowHash } from '../lib/routing.js';

  let {
    workflows = [],
    theme = 'light',
    onOpenWorkflow = () => {}
  } = $props();

  let cards = $derived(
    workflows.map((workflow) => ({
      workflow,
      stats: getWorkflowStats(workflow),
      graph: buildOverviewGraph(workflow)
    }))
  );
</script>

<section class="overview-view">
  {#if workflows.length === 0}
    <div class="overview-empty">
      <h2>No workflows yet</h2>
      <p>Add a workflow to <code>.canvas/workflows/</code> to see it in the shell.</p>
    </div>
  {:else}
    <div class="overview-grid">
      {#each cards as card (card.workflow.id)}
        <a
          class="workflow-card"
          href={workflowHash(card.workflow.id)}
          data-workflow-id={card.workflow.id}
          aria-label={`Open ${card.workflow.title} workflow`}
          onclick={(event) => {
            event.preventDefault();
            onOpenWorkflow(card.workflow.id);
          }}
        >
          <div class="workflow-card__header">
            <div>
              <p class="workflow-card__eyebrow">Workflow</p>
              <h2>{card.workflow.title}</h2>
            </div>

            <span class="workflow-card__action">Open →</span>
          </div>

          <div class="workflow-card__stats">
            <div>
              <strong>{card.stats.screenCount}</strong>
              <span>screens</span>
            </div>
            <div>
              <strong>{card.stats.transitionCount}</strong>
              <span>transitions</span>
            </div>
            <div>
              <strong>{card.stats.variantCount}</strong>
              <span>variants</span>
            </div>
          </div>

          <div class="workflow-card__preview">
            {#if card.graph.nodes.length > 0}
              <div class="workflow-card__preview-flow" aria-hidden="true">
                <SvelteFlow
                  id={`overview-${card.workflow.id}`}
                  nodes={card.graph.nodes}
                  edges={card.graph.edges}
                  fitView
                  fitViewOptions={{ padding: 0.16 }}
                  colorMode={theme}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  nodesFocusable={false}
                  edgesFocusable={false}
                  elementsSelectable={false}
                  panOnDrag={false}
                  panOnScroll={false}
                  zoomOnScroll={false}
                  zoomOnPinch={false}
                  zoomOnDoubleClick={false}
                  preventScrolling={false}
                >
                  <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
                </SvelteFlow>
              </div>
            {:else}
              <p class="workflow-card__empty">This workflow does not define any screens yet.</p>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</section>

<style>
  .overview-view {
    display: grid;
    gap: 1.5rem;
  }

  .overview-empty {
    display: grid;
    place-items: center;
    min-height: 18rem;
    padding: 2rem;
    border-radius: 28px;
    border: 1px dashed var(--canvas-border, rgba(148, 163, 184, 0.32));
    background: var(--canvas-surface, rgba(255, 255, 255, 0.78));
    color: var(--canvas-muted, #64748b);
    text-align: center;
  }

  .overview-empty h2 {
    margin: 0 0 0.5rem;
    color: var(--canvas-text, #0f172a);
  }

  .overview-empty p {
    margin: 0;
  }

  .overview-grid {
    display: grid;
    gap: 1.25rem;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  }

  .workflow-card {
    display: grid;
    gap: 1rem;
    padding: 1.25rem;
    border-radius: 28px;
    border: 1px solid var(--canvas-border, rgba(148, 163, 184, 0.24));
    background:
      radial-gradient(circle at top right, rgba(99, 102, 241, 0.12), transparent 36%),
      var(--canvas-surface, rgba(255, 255, 255, 0.8));
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
    color: inherit;
    text-decoration: none;
    transition:
      transform 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease;
    backdrop-filter: blur(18px);
  }

  .workflow-card:hover {
    transform: translateY(-2px);
    border-color: rgba(99, 102, 241, 0.34);
    box-shadow: 0 24px 48px rgba(79, 70, 229, 0.18);
  }

  .workflow-card__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .workflow-card__eyebrow {
    margin: 0 0 0.35rem;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--canvas-muted, #64748b);
  }

  .workflow-card__header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--canvas-text, #0f172a);
  }

  .workflow-card__action {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--canvas-accent, #4f46e5);
    white-space: nowrap;
  }

  .workflow-card__stats {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .workflow-card__stats div {
    display: grid;
    gap: 0.2rem;
    min-width: 5rem;
    padding: 0.75rem 0.9rem;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.68);
    border: 1px solid rgba(148, 163, 184, 0.16);
  }

  .workflow-card__stats strong {
    font-size: 1rem;
    color: var(--canvas-text, #0f172a);
  }

  .workflow-card__stats span {
    font-size: 0.8rem;
    color: var(--canvas-muted, #64748b);
  }

  .workflow-card__preview {
    min-height: 16rem;
    border-radius: 22px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    background:
      linear-gradient(180deg, rgba(248, 250, 252, 0.88), rgba(241, 245, 249, 0.96));
    overflow: hidden;
  }

  .workflow-card__preview-flow {
    width: 100%;
    height: 100%;
    min-height: 16rem;
    pointer-events: none;
  }

  .workflow-card__empty {
    margin: 0;
    padding: 2rem;
    color: var(--canvas-muted, #64748b);
    text-align: center;
  }

  @media (max-width: 720px) {
    .overview-grid {
      grid-template-columns: 1fr;
    }

    .workflow-card__header {
      flex-direction: column;
    }
  }
</style>
