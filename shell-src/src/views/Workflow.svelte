<svelte:options runes={true} />

<script>
  import { computeStoryboardLayout, getWorkflowStats } from '../lib/flow.js';
  import FlowArrow from '../lib/FlowArrow.svelte';
  import GroupFrame from '../lib/GroupFrame.svelte';
  import StoryboardNode from '../nodes/StoryboardNode.svelte';
  import { overviewHash } from '../lib/routing.js';

  const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
  const DESKTOP_SCREEN_SCALE = 0.34;
  const MOBILE_SCREEN_SCALE = 0.54;
  const DESKTOP_VARIANT_SCALE = 0.22;
  const MOBILE_VARIANT_SCALE = 0.3;
  const DESKTOP_NODE_SEP = 72;
  const MOBILE_NODE_SEP = 52;
  const DESKTOP_RANK_SEP = 132;
  const MOBILE_RANK_SEP = 88;
  const CANVAS_MARGIN_X = 52;
  const CANVAS_MARGIN_Y = 52;
  const ARROW_MARKER_ID = 'workflow-flow-arrow-head';

  let {
    workflow = null,
    viewport = DEFAULT_VIEWPORT,
    theme = 'light',
    onBack = () => {},
    onOpenScreen = () => {}
  } = $props();

  let stats = $derived(getWorkflowStats(workflow));
  let viewClass = $derived(`workflow-view${theme === 'dark' ? ' dark' : ''}`);
  let layout = $derived.by(() => {
    const viewportWidth = Number(viewport?.width) > 0 ? Number(viewport.width) : DEFAULT_VIEWPORT.width;
    const isMobileViewport = viewportWidth <= 480;

    return computeStoryboardLayout(workflow, viewport, {
      screenScale: isMobileViewport ? MOBILE_SCREEN_SCALE : DESKTOP_SCREEN_SCALE,
      variantScale: isMobileViewport ? MOBILE_VARIANT_SCALE : DESKTOP_VARIANT_SCALE,
      includeVariants: true,
      nodeSep: isMobileViewport ? MOBILE_NODE_SEP : DESKTOP_NODE_SEP,
      rankSep: isMobileViewport ? MOBILE_RANK_SEP : DESKTOP_RANK_SEP,
      marginX: CANVAS_MARGIN_X,
      marginY: CANVAS_MARGIN_Y
    });
  });
  let canvasStyle = $derived(
    `width:${Math.max(layout.width, 0)}px;height:${Math.max(layout.height, 0)}px;`
  );
</script>

<section class={viewClass}>
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

    {#if layout.nodes.length === 0}
      <div class="workflow-view__empty panel">This workflow does not define any screens yet.</div>
    {:else}
      <div class="workflow-view__canvas-shell panel" data-workflow-id={workflow.id}>
        <div
          class="workflow-view__canvas"
          style={canvasStyle}
        >
          {#each layout.groups as group (group.id)}
            <GroupFrame {group} />
          {/each}

          <svg
            class="workflow-view__arrows"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id={ARROW_MARKER_ID}
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

            {#each layout.treeEdges as edge (edge.id)}
              <FlowArrow
                fromRect={edge.fromRect}
                toRect={edge.toRect}
                label={edge.label}
                fromId={edge.from}
                toId={edge.to}
                markerId={ARROW_MARKER_ID}
              />
            {/each}
          </svg>

          {#each layout.nodes as node (node.id)}
            <div
              class="workflow-view__node"
              style={`left:${node.left}px;top:${node.top}px;width:${node.width}px;`}
            >
              <StoryboardNode
                {node}
                {viewport}
                screenScale={layout.screenScale}
                variantScale={layout.variantScale}
                workflowId={workflow.id}
                onOpen={onOpenScreen}
              />
            </div>
          {/each}
        </div>
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
    position: relative;
    overflow: auto;
    min-height: 42rem;
    padding: 1rem;
    background:
      linear-gradient(180deg, rgba(248, 250, 252, 0.84), rgba(241, 245, 249, 0.96));
  }

  .workflow-view__canvas {
    position: relative;
    min-width: 100%;
    min-height: 24rem;
  }

  .workflow-view__arrows {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: visible;
    pointer-events: none;
  }

  .workflow-view__node {
    position: absolute;
    z-index: 2;
    contain: layout paint;
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

    .workflow-view__canvas-shell {
      min-height: 34rem;
      padding: 0.75rem;
    }
  }
</style>
