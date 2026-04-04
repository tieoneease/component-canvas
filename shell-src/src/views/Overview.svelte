<svelte:options runes={true} />

<script>
  import { computeStoryboardLayout, getScreenTitle, getWorkflowStats } from '../lib/flow.js';
  import { workflowHash } from '../lib/routing.js';

  const OVERVIEW_VIEWPORT = { width: 1280, height: 720 };
  const PREVIEW_WIDTH = 280;
  const PREVIEW_HEIGHT = 220;
  const PREVIEW_LAYOUT_OPTIONS = {
    includeVariants: false,
    nodeSep: 28,
    rankSep: 38,
    marginX: 18,
    marginY: 18
  };

  let {
    workflows = [],
    theme = 'light',
    onOpenWorkflow = () => {}
  } = $props();

  let viewClass = $derived(`overview-view${theme === 'dark' ? ' dark' : ''}`);
  let cards = $derived.by(() =>
    workflows.map((workflow) => {
      const stats = getWorkflowStats(workflow);
      const layout = computeStoryboardLayout(workflow, OVERVIEW_VIEWPORT, PREVIEW_LAYOUT_OPTIONS);
      const fitScale = computeFitScale(layout, PREVIEW_WIDTH, PREVIEW_HEIGHT);

      return {
        workflow,
        stats,
        layout,
        fitScale,
        previewWidth: layout.width * fitScale,
        previewHeight: layout.height * fitScale
      };
    })
  );

  function computeFitScale(layout, maxWidth, maxHeight) {
    const width = Number(layout?.width) || 0;
    const height = Number(layout?.height) || 0;

    if (width <= 0 || height <= 0) {
      return 1;
    }

    return Math.min(maxWidth / width, maxHeight / height, 1);
  }
</script>

<section class={viewClass}>
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
            {#if card.layout.nodes.length > 0}
              <div
                class="workflow-card__preview-shell"
                style={`width:${card.previewWidth}px;height:${card.previewHeight}px;`}
                aria-hidden="true"
              >
                <div
                  class="workflow-card__preview-storyboard"
                  style={`width:${card.layout.width}px;height:${card.layout.height}px;transform:scale(${card.fitScale});transform-origin:top left;`}
                >
                  {#each card.layout.nodes as node (node.id)}
                    <div
                      class="workflow-card__preview-node"
                      data-screen-id={node.id}
                      style={`left:${node.mainRect.x}px;top:${node.mainRect.y}px;width:${node.mainRect.width}px;height:${node.mainRect.height}px;`}
                    >
                      <div class="workflow-card__preview-node-header">
                        <strong>{getScreenTitle(node.screen)}</strong>
                      </div>

                      <div class="workflow-card__preview-node-body"></div>
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
    overflow: hidden;
    max-width: 100%;
    max-height: 100%;
  }

  .workflow-card__preview-storyboard {
    position: relative;
    overflow: hidden;
    pointer-events: none;
  }

  .workflow-card__preview-node {
    position: absolute;
    overflow: hidden;
    border-radius: 24px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.96);
    box-shadow:
      0 18px 42px rgba(15, 23, 42, 0.14),
      0 1px 0 rgba(255, 255, 255, 0.92) inset;
    contain: layout paint;
  }

  .workflow-card__preview-node-header {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    height: 46px;
    padding: 0 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.9) 100%),
      rgba(255, 255, 255, 0.96);
  }

  .workflow-card__preview-node-header strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.94rem;
    color: #0f172a;
  }

  .workflow-card__preview-node-body {
    height: calc(100% - 46px);
    background:
      linear-gradient(180deg, rgba(224, 231, 255, 0.3), rgba(255, 255, 255, 0.85)),
      radial-gradient(circle at top, rgba(99, 102, 241, 0.12), transparent 42%),
      #ffffff;
  }

  .workflow-card__empty {
    margin: 0;
    padding: 2rem;
    color: var(--canvas-muted, #64748b);
    text-align: center;
  }

  :global(.dark) .workflow-card__preview {
    border-color: rgba(71, 85, 105, 0.34);
    background:
      linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.96));
  }

  :global(.dark) .workflow-card__preview-node {
    border-color: rgba(148, 163, 184, 0.18);
    background: rgba(15, 23, 42, 0.94);
    box-shadow:
      0 22px 44px rgba(2, 6, 23, 0.34),
      0 1px 0 rgba(255, 255, 255, 0.04) inset;
  }

  :global(.dark) .workflow-card__preview-node-header {
    border-bottom-color: rgba(148, 163, 184, 0.14);
    background:
      linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%),
      rgba(15, 23, 42, 0.96);
  }

  :global(.dark) .workflow-card__preview-node-header strong {
    color: #e2e8f0;
  }

  :global(.dark) .workflow-card__preview-node-body {
    background:
      linear-gradient(180deg, rgba(49, 46, 129, 0.22), rgba(15, 23, 42, 0.86)),
      radial-gradient(circle at top, rgba(129, 140, 248, 0.16), transparent 42%),
      #020617;
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
