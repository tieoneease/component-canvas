<svelte:options runes={true} />

<script>
  import FlowArrow from '../lib/FlowArrow.svelte';
  import ScreenFrame from '../lib/ScreenFrame.svelte';
  import {
    computeFitScale,
    computeWorkflowLayout,
    getScreenTitle,
    resolveWorkflowComponent
  } from '../lib/canvas.js';

  let {
    workflows = [],
    components = {},
    viewport = { width: 1280, height: 720 }
  } = $props();

  const PREVIEW_WIDTH = 360;
  const PREVIEW_HEIGHT = 220;

  let cards = $derived.by(() => {
    const screenScale = viewport.width > 500 ? 0.12 : 0.18;

    return workflows.map((workflow) => {
      const layout = computeWorkflowLayout(workflow, viewport, {
        screenScale,
        includeVariants: false,
        nodeSep: 28,
        rankSep: 42,
        marginX: 18,
        marginY: 18
      });

      return {
        workflow,
        layout,
        fitScale: computeFitScale(layout, PREVIEW_WIDTH, PREVIEW_HEIGHT)
      };
    });
  });
</script>

<section class="overview-view">
  {#if workflows.length === 0}
    <div class="overview-empty">
      <h2>No workflows yet</h2>
      <p>Add a workflow to <code>.canvas/workflows/</code> to see it on the canvas.</p>
    </div>
  {:else}
    <div class="overview-grid">
      {#each cards as card (card.workflow.id)}
        {@const variantCount = card.workflow.variants?.length ?? 0}
        {@const previewWidth = card.layout.width * card.fitScale}
        {@const previewHeight = card.layout.height * card.fitScale}

        <a
          class="workflow-card"
          href={`#/workflow/${encodeURIComponent(card.workflow.id)}`}
          data-workflow-id={card.workflow.id}
          aria-label={`Open ${card.workflow.title} workflow`}
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
              <strong>{card.workflow.screens.length}</strong>
              <span>screens</span>
            </div>
            <div>
              <strong>{card.workflow.transitions.length}</strong>
              <span>transitions</span>
            </div>
            <div>
              <strong>{variantCount}</strong>
              <span>variants</span>
            </div>
          </div>

          <div class="workflow-card__preview">
            {#if card.layout.nodes.length > 0}
              <div class="workflow-card__preview-shell" style={`width:${previewWidth}px;height:${previewHeight}px;`}>
                <div
                  class="workflow-card__preview-canvas"
                  style={`width:${card.layout.width}px;height:${card.layout.height}px;transform:scale(${card.fitScale});transform-origin:top left;`}
                >
                  <svg
                    class="workflow-card__arrows"
                    width={card.layout.width}
                    height={card.layout.height}
                    viewBox={`0 0 ${card.layout.width} ${card.layout.height}`}
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id={`overview-arrow-head-${card.workflow.id}`}
                        viewBox="0 0 12 12"
                        refX="10"
                        refY="6"
                        markerWidth="10"
                        markerHeight="10"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 0 L 12 6 L 0 12 z" fill="var(--canvas-arrow, #6366f1)" />
                      </marker>
                    </defs>

                    {#each card.layout.edges as edge (edge.id)}
                      <FlowArrow
                        fromRect={edge.fromRect}
                        toRect={edge.toRect}
                        fromId={edge.from}
                        toId={edge.to}
                        label=""
                        markerId={`overview-arrow-head-${card.workflow.id}`}
                        strokeWidth={2}
                      />
                    {/each}
                  </svg>

                  {#each card.layout.nodes as node (node.id)}
                    {@const component = resolveWorkflowComponent(card.workflow.id, node.screen.component, components)}

                    <div
                      class="workflow-card__screen"
                      style={`left:${node.left}px;top:${node.top}px;width:${node.width}px;`}
                      data-screen-id={node.id}
                    >
                      <div style={`margin-left:${node.mainOffset}px;`}>
                        <ScreenFrame
                          component={component}
                          props={node.screen.props ?? {}}
                          width={viewport.width}
                          height={viewport.height}
                          title={getScreenTitle(node.screen)}
                          scale={card.layout.screenScale}
                        />
                      </div>
                    </div>
                  {/each}
                </div>
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
    min-height: 16rem;
    padding: 2rem;
    border-radius: 28px;
    border: 1px dashed var(--canvas-border, rgba(148, 163, 184, 0.35));
    background: var(--canvas-surface, rgba(255, 255, 255, 0.76));
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
      var(--canvas-surface, rgba(255, 255, 255, 0.76));
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
    border-color: rgba(99, 102, 241, 0.36);
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
    background: rgba(255, 255, 255, 0.66);
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
    display: grid;
    place-items: center;
    min-height: 16rem;
    border-radius: 22px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    background:
      linear-gradient(180deg, rgba(248, 250, 252, 0.88), rgba(241, 245, 249, 0.96));
    overflow: hidden;
  }

  .workflow-card__preview-shell {
    position: relative;
  }

  .workflow-card__preview-canvas {
    position: relative;
  }

  .workflow-card__arrows {
    position: absolute;
    inset: 0;
    overflow: visible;
  }

  .workflow-card__screen {
    position: absolute;
    contain: layout paint;
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
