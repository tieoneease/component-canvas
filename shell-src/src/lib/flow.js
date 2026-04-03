import dagre from 'dagre';
import { MarkerType, Position } from '@xyflow/svelte';

import { previewScreenSrc, screenHash } from './routing.js';

export const VIEWPORTS = {
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

export const VIEWPORT_OPTIONS = Object.values(VIEWPORTS);

const DEFAULT_VIEWPORT = VIEWPORTS.desktop;
const SCREEN_NODE_HEADER_HEIGHT = 46;
const SCREEN_NODE_MAX_WIDTH = 320;
const SCREEN_NODE_MAX_HEIGHT = 320;
const OVERVIEW_NODE_WIDTH = 136;
const OVERVIEW_NODE_HEIGHT = 52;

export function getScreenTitle(screen) {
  return screen?.title ?? screen?.id ?? 'Screen';
}

export function getWorkflowStats(workflow) {
  return {
    screenCount: Array.isArray(workflow?.screens) ? workflow.screens.length : 0,
    transitionCount: Array.isArray(workflow?.transitions) ? workflow.transitions.length : 0,
    variantCount: Array.isArray(workflow?.variants) ? workflow.variants.length : 0
  };
}

export function summarizeWorkflows(workflows = []) {
  const safeWorkflows = Array.isArray(workflows) ? workflows : [];
  const components = new Set();

  let screenCount = 0;
  let transitionCount = 0;

  for (const workflow of safeWorkflows) {
    const screens = Array.isArray(workflow?.screens) ? workflow.screens : [];
    const transitions = Array.isArray(workflow?.transitions) ? workflow.transitions : [];

    screenCount += screens.length;
    transitionCount += transitions.length;

    for (const screen of screens) {
      if (typeof screen?.component === 'string' && screen.component.length > 0) {
        components.add(`${workflow?.id ?? 'workflow'}/${normalizeComponentPath(screen.component)}`);
      }
    }
  }

  return {
    workflowCount: safeWorkflows.length,
    screenCount,
    transitionCount,
    componentCount: components.size
  };
}

export function getScreenNodeMetrics(viewport) {
  const normalizedViewport = normalizeViewport(viewport);
  const scale = Math.min(
    SCREEN_NODE_MAX_WIDTH / normalizedViewport.width,
    SCREEN_NODE_MAX_HEIGHT / normalizedViewport.height,
    1
  );
  const frameWidth = Math.max(1, Math.round(normalizedViewport.width * scale));
  const frameHeight = Math.max(1, Math.round(normalizedViewport.height * scale));

  return {
    ...normalizedViewport,
    scale,
    frameWidth,
    frameHeight,
    nodeWidth: frameWidth,
    nodeHeight: frameHeight + SCREEN_NODE_HEADER_HEIGHT,
    headerHeight: SCREEN_NODE_HEADER_HEIGHT
  };
}

export function buildWorkflowGraph(workflow, viewport) {
  const metrics = getScreenNodeMetrics(viewport);
  const screens = Array.isArray(workflow?.screens) ? workflow.screens : [];

  if (screens.length === 0) {
    return {
      nodes: [],
      edges: [],
      metrics
    };
  }

  const graph = createGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 80,
    ranksep: 140,
    marginx: 48,
    marginy: 48
  });
  const screenIds = new Set(screens.map((screen) => screen.id));

  for (const screen of screens) {
    graph.setNode(screen.id, {
      width: metrics.nodeWidth,
      height: metrics.nodeHeight
    });
  }

  for (const [index, transition] of safeTransitions(workflow).entries()) {
    if (!screenIds.has(transition.from) || !screenIds.has(transition.to)) {
      continue;
    }

    graph.setEdge(
      transition.from,
      transition.to,
      { label: transition.trigger },
      `${transition.from}-${transition.to}-${index}`
    );
  }

  dagre.layout(graph);

  const nodes = screens.map((screen) => {
    const layoutNode = graph.node(screen.id);

    return {
      id: screen.id,
      type: 'screen',
      position: {
        x: Math.round(layoutNode.x - metrics.nodeWidth / 2),
        y: Math.round(layoutNode.y - metrics.nodeHeight / 2)
      },
      width: metrics.nodeWidth,
      height: metrics.nodeHeight,
      dragHandle: 'drag-handle',
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        title: getScreenTitle(screen),
        previewSrc: previewScreenSrc(workflow.id, screen.id),
        isolatedHref: screenHash(workflow.id, screen.id),
        workflowId: workflow.id,
        screenId: screen.id,
        viewport: {
          width: metrics.width,
          height: metrics.height,
          label: metrics.label
        },
        scale: metrics.scale,
        frameWidth: metrics.frameWidth,
        frameHeight: metrics.frameHeight,
        headerHeight: metrics.headerHeight
      }
    };
  });

  const edges = safeTransitions(workflow).flatMap((transition, index) => {
    if (!screenIds.has(transition.from) || !screenIds.has(transition.to)) {
      return [];
    }

    return [{
      id: `${workflow.id}-${transition.from}-${transition.to}-${index}`,
      source: transition.from,
      target: transition.to,
      label: transition.trigger,
      type: 'smoothstep',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18
      },
      style: 'stroke-width: 1.6px;',
      labelStyle: 'font-size: 12px; font-weight: 700;'
    }];
  });

  return {
    nodes,
    edges,
    metrics
  };
}

export function buildOverviewGraph(workflow) {
  const screens = Array.isArray(workflow?.screens) ? workflow.screens : [];

  if (screens.length === 0) {
    return {
      nodes: [],
      edges: []
    };
  }

  const graph = createGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 28,
    ranksep: 38,
    marginx: 18,
    marginy: 18
  });
  const screenIds = new Set(screens.map((screen) => screen.id));

  for (const screen of screens) {
    graph.setNode(screen.id, {
      width: OVERVIEW_NODE_WIDTH,
      height: OVERVIEW_NODE_HEIGHT
    });
  }

  for (const [index, transition] of safeTransitions(workflow).entries()) {
    if (!screenIds.has(transition.from) || !screenIds.has(transition.to)) {
      continue;
    }

    graph.setEdge(
      transition.from,
      transition.to,
      { label: transition.trigger },
      `${transition.from}-${transition.to}-${index}`
    );
  }

  dagre.layout(graph);

  const nodes = screens.map((screen) => {
    const layoutNode = graph.node(screen.id);

    return {
      id: screen.id,
      position: {
        x: Math.round(layoutNode.x - OVERVIEW_NODE_WIDTH / 2),
        y: Math.round(layoutNode.y - OVERVIEW_NODE_HEIGHT / 2)
      },
      width: OVERVIEW_NODE_WIDTH,
      height: OVERVIEW_NODE_HEIGHT,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: getScreenTitle(screen)
      },
      style: [
        `width: ${OVERVIEW_NODE_WIDTH}px`,
        'padding: 0.8rem 0.95rem',
        'border-radius: 18px',
        'border: 1px solid rgba(148, 163, 184, 0.22)',
        'background: rgba(255, 255, 255, 0.88)',
        'font-size: 0.82rem',
        'font-weight: 700',
        'box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08)'
      ].join(';')
    };
  });

  const edges = safeTransitions(workflow).flatMap((transition, index) => {
    if (!screenIds.has(transition.from) || !screenIds.has(transition.to)) {
      return [];
    }

    return [{
      id: `overview-${workflow.id}-${transition.from}-${transition.to}-${index}`,
      source: transition.from,
      target: transition.to,
      type: 'smoothstep',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16
      },
      style: 'stroke-width: 1.4px;'
    }];
  });

  return {
    nodes,
    edges
  };
}

function createGraph(config) {
  const graph = new dagre.graphlib.Graph({ multigraph: true });

  graph.setGraph(config);
  graph.setDefaultEdgeLabel(() => ({}));

  return graph;
}

function normalizeViewport(viewport) {
  const width = Number(viewport?.width) > 0 ? Number(viewport.width) : DEFAULT_VIEWPORT.width;
  const height = Number(viewport?.height) > 0 ? Number(viewport.height) : DEFAULT_VIEWPORT.height;
  const matchingViewport = VIEWPORT_OPTIONS.find(
    (option) => option.width === width && option.height === height
  );

  return {
    id: viewport?.id ?? matchingViewport?.id ?? DEFAULT_VIEWPORT.id,
    label: viewport?.label ?? matchingViewport?.label ?? `${width}×${height}`,
    width,
    height
  };
}

function normalizeComponentPath(componentPath) {
  return String(componentPath ?? '')
    .replace(/^\.\//u, '')
    .replace(/\\/gu, '/')
    .replace(/\.svelte$/iu, '');
}

function safeTransitions(workflow) {
  return Array.isArray(workflow?.transitions) ? workflow.transitions : [];
}
