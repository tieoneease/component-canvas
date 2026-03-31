<svelte:options runes={true} />

<script>
  import FlowArrow from '../lib/FlowArrow.svelte';
  import ScreenFrame from '../lib/ScreenFrame.svelte';
  import VariantStrip from '../lib/VariantStrip.svelte';
  import {
    computeWorkflowLayout,
    getScreenTitle,
    resolveWorkflowComponent
  } from '../lib/canvas.js';

  let {
    workflow = null,
    components = {},
    viewport = { width: 1280, height: 720 }
  } = $props();

  let layout = $derived.by(() => {
    if (!workflow) {
      return computeWorkflowLayout(null, viewport);
    }

    const isMobileViewport = viewport.width <= 480;

    return computeWorkflowLayout(workflow, viewport, {
      screenScale: isMobileViewport ? 0.54 : 0.34,
      variantScale: isMobileViewport ? 0.3 : 0.2,
      includeVariants: true,
      nodeSep: isMobileViewport ? 52 : 72,
      rankSep: isMobileViewport ? 88 : 132,
      marginX: 52,
      marginY: 52
    });
  });
</script>

<section class="workflow-view">
  {#if workflow}
    {@const variantCount = workflow.variants?.length ?? 0}

    <header class="workflow-view__header">
      <div>
        <a class="workflow-view__back" href="#/">← All workflows</a>
        <h2>{workflow.title}</h2>
        <p>
          {workflow.screens.length} screen{workflow.screens.length === 1 ? '' : 's'} ·
          {workflow.transitions.length} transition{workflow.transitions.length === 1 ? '' : 's'} ·
          {variantCount} variant{variantCount === 1 ? '' : 's'}
        </p>
      </div>

      <div class="workflow-view__badge">{viewport.width}×{viewport.height}</div>
    </header>

    {#if layout.nodes.length === 0}
      <div class="workflow-view__empty">This workflow does not define any screens yet.</div>
    {:else}
      <div class="workflow-view__canvas-shell">
        <div
          class="workflow-view__canvas"
          style={`width:${layout.width}px;height:${layout.height}px;`}
          data-workflow-id={workflow.id}
        >
          <svg
            class="workflow-view__arrows"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="flow-arrow-head"
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

            {#each layout.edges as edge (edge.id)}
              <FlowArrow
                fromRect={edge.fromRect}
                toRect={edge.toRect}
                label={edge.label}
                fromId={edge.from}
                toId={edge.to}
              />
            {/each}
          </svg>

          {#each layout.nodes as node (node.id)}
            {@const component = resolveWorkflowComponent(workflow.id, node.screen.component, components)}

            <div
              class="workflow-view__node"
              style={`left:${node.left}px;top:${node.top}px;width:${node.width}px;`}
              data-screen-id={node.id}
            >
              <div class="workflow-view__main" style={`margin-left:${node.mainOffset}px;`}>
                <ScreenFrame
                  component={component}
                  props={node.screen.props ?? {}}
                  width={viewport.width}
                  height={viewport.height}
                  title={getScreenTitle(node.screen)}
                  scale={layout.screenScale}
                />
              </div>

              {#if node.variants.length > 0}
                <div class="workflow-view__variants" style={`margin-left:${node.variantOffset}px;`}>
                  <VariantStrip
                    variants={node.variants}
                    component={component}
                    baseProps={node.screen.props ?? {}}
                    width={viewport.width}
                    height={viewport.height}
                    scale={layout.variantScale}
                  />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    <div class="workflow-view__empty">Workflow not found.</div>
  {/if}
</section>

<style>
  .workflow-view {
    display: grid;
    gap: 1rem;
  }

  .workflow-view__header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    padding: 1.25rem 1.35rem;
    border-radius: 26px;
    border: 1px solid var(--canvas-border, rgba(148, 163, 184, 0.24));
    background: var(--canvas-surface, rgba(255, 255, 255, 0.76));
    backdrop-filter: blur(18px);
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
    overflow: auto;
    padding: 1rem;
    border-radius: 28px;
    border: 1px solid var(--canvas-border, rgba(148, 163, 184, 0.22));
    background:
      linear-gradient(180deg, rgba(248, 250, 252, 0.84), rgba(241, 245, 249, 0.96));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.48);
  }

  .workflow-view__canvas {
    position: relative;
    min-width: 100%;
    min-height: 24rem;
  }

  .workflow-view__arrows {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }

  .workflow-view__node {
    position: absolute;
    contain: layout paint;
  }

  .workflow-view__variants {
    margin-top: 1.1rem;
  }

  .workflow-view__empty {
    display: grid;
    place-items: center;
    min-height: 18rem;
    padding: 2rem;
    border-radius: 28px;
    border: 1px dashed var(--canvas-border, rgba(148, 163, 184, 0.32));
    background: var(--canvas-surface, rgba(255, 255, 255, 0.76));
    color: var(--canvas-muted, #64748b);
    text-align: center;
  }

  @media (max-width: 720px) {
    .workflow-view__header {
      padding: 1rem;
    }

    .workflow-view__canvas-shell {
      padding: 0.75rem;
    }
  }
</style>
