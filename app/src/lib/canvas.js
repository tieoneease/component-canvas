import dagre from 'dagre';

export const FRAME_HEADER_HEIGHT = 42;

export function componentKey(workflowId, componentPath) {
  const normalizedPath = String(componentPath ?? '')
    .replace(/^\.\//u, '')
    .replace(/\\/gu, '/')
    .replace(/\.svelte$/iu, '');

  return `${workflowId}/${normalizedPath}`;
}

export function resolveWorkflowComponent(workflowId, componentPath, registry = {}) {
  return registry[componentKey(workflowId, componentPath)] ?? null;
}

export function getScreenTitle(screen) {
  return screen?.title ?? screen?.id ?? 'Screen';
}

export function getVariantsForScreen(workflow, screenId) {
  return (workflow?.variants ?? []).filter((variant) => variant.screenId === screenId);
}

export function computeFitScale(layout, maxWidth, maxHeight) {
  if (!layout?.width || !layout?.height) {
    return 1;
  }

  const widthScale = maxWidth ? maxWidth / layout.width : 1;
  const heightScale = maxHeight ? maxHeight / layout.height : 1;

  return Math.min(1, widthScale, heightScale);
}

export function computeWorkflowLayout(workflow, viewport, options = {}) {
  const settings = {
    screenScale: 0.34,
    variantScale: 0.22,
    includeVariants: true,
    nodeSep: 56,
    rankSep: 104,
    marginX: 48,
    marginY: 48,
    variantGap: 16,
    variantPaddingTop: 18,
    variantPaddingBottom: 8,
    variantLabelHeight: 24,
    ...options
  };

  const normalizedViewport = {
    width: Number(viewport?.width) > 0 ? Number(viewport.width) : 1280,
    height: Number(viewport?.height) > 0 ? Number(viewport.height) : 720
  };

  if (!workflow || !Array.isArray(workflow.screens) || workflow.screens.length === 0) {
    return {
      width: 0,
      height: 0,
      nodes: [],
      edges: [],
      screenScale: settings.screenScale,
      variantScale: settings.variantScale
    };
  }

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: settings.nodeSep,
    ranksep: settings.rankSep,
    marginx: settings.marginX,
    marginy: settings.marginY
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const frameWidth = normalizedViewport.width * settings.screenScale;
  const frameHeight = (normalizedViewport.height + FRAME_HEADER_HEIGHT) * settings.screenScale;
  const variantFrameWidth = normalizedViewport.width * settings.variantScale;
  const variantFrameHeight = (normalizedViewport.height + FRAME_HEADER_HEIGHT) * settings.variantScale;

  const nodeMeta = new Map();

  for (const screen of workflow.screens) {
    const variants = settings.includeVariants ? getVariantsForScreen(workflow, screen.id) : [];
    const variantStripWidth = variants.length > 0
      ? (variants.length * variantFrameWidth) + ((variants.length - 1) * settings.variantGap)
      : 0;
    const variantBlockHeight = variants.length > 0
      ? settings.variantPaddingTop + settings.variantLabelHeight + variantFrameHeight + settings.variantPaddingBottom
      : 0;
    const width = Math.max(frameWidth, variantStripWidth);
    const height = frameHeight + variantBlockHeight;

    nodeMeta.set(screen.id, {
      screen,
      variants,
      width,
      height,
      variantStripWidth,
      variantBlockHeight
    });

    graph.setNode(screen.id, { width, height });
  }

  for (const transition of workflow.transitions ?? []) {
    graph.setEdge(transition.from, transition.to, {});
  }

  dagre.layout(graph);

  const nodes = workflow.screens.map((screen) => {
    const meta = nodeMeta.get(screen.id);
    const layoutNode = graph.node(screen.id);
    const left = layoutNode.x - (meta.width / 2);
    const top = layoutNode.y - (meta.height / 2);
    const mainOffset = (meta.width - frameWidth) / 2;
    const variantOffset = meta.variantStripWidth > 0 ? (meta.width - meta.variantStripWidth) / 2 : 0;
    const variantTop = top + frameHeight + settings.variantPaddingTop + settings.variantLabelHeight;

    return {
      id: screen.id,
      screen,
      variants: meta.variants,
      left,
      top,
      width: meta.width,
      height: meta.height,
      mainOffset,
      mainRect: {
        x: left + mainOffset,
        y: top,
        width: frameWidth,
        height: frameHeight
      },
      variantOffset,
      variantTop,
      variantStripWidth: meta.variantStripWidth,
      variantBlockHeight: meta.variantBlockHeight,
      centerX: layoutNode.x,
      centerY: layoutNode.y
    };
  });

  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));

  const edges = (workflow.transitions ?? []).flatMap((transition, index) => {
    const fromNode = nodeLookup.get(transition.from);
    const toNode = nodeLookup.get(transition.to);

    if (!fromNode || !toNode) {
      return [];
    }

    return [{
      id: `${transition.from}-${transition.to}-${index}`,
      from: transition.from,
      to: transition.to,
      label: transition.trigger,
      fromRect: fromNode.mainRect,
      toRect: toNode.mainRect
    }];
  });

  const width = nodes.reduce(
    (maxWidth, node) => Math.max(maxWidth, node.left + node.width + settings.marginX),
    settings.marginX * 2
  );
  const height = nodes.reduce(
    (maxHeight, node) => Math.max(maxHeight, node.top + node.height + settings.marginY),
    settings.marginY * 2
  );

  return {
    width,
    height,
    nodes,
    edges,
    frameWidth,
    frameHeight,
    variantFrameWidth,
    variantFrameHeight,
    screenScale: settings.screenScale,
    variantScale: settings.variantScale,
    settings
  };
}
