import dagre from 'dagre'

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
}

export const VIEWPORT_OPTIONS = Object.values(VIEWPORTS)

const DEFAULT_VIEWPORT = VIEWPORTS.desktop
const SCREEN_NODE_HEADER_HEIGHT = 46
const SCREEN_NODE_MAX_WIDTH = 320
const SCREEN_NODE_MAX_HEIGHT = 320
const DEFAULT_SCREEN_SCALE = 0.34
const DEFAULT_VARIANT_SCALE = 0.22
const DEFAULT_NODE_SEP = 72
const DEFAULT_RANK_SEP = 132
const DEFAULT_MARGIN_X = 48
const DEFAULT_MARGIN_Y = 48
const VARIANT_GAP = 16
const VARIANT_PADDING_TOP = 18
const VARIANT_PADDING_BOTTOM = 8
const GROUP_PADDING_X = 28
const GROUP_PADDING_TOP = 40
const GROUP_PADDING_BOTTOM = 28

export function getScreenTitle(screen) {
  return screen?.title ?? screen?.id ?? 'Screen'
}

export function getWorkflowStats(workflow) {
  return {
    screenCount: Array.isArray(workflow?.screens) ? workflow.screens.length : 0,
    transitionCount: Array.isArray(workflow?.transitions) ? workflow.transitions.length : 0,
    variantCount: Array.isArray(workflow?.variants) ? workflow.variants.length : 0
  }
}

export function summarizeWorkflows(workflows = []) {
  const safeWorkflows = Array.isArray(workflows) ? workflows : []
  const components = new Set()

  let screenCount = 0
  let transitionCount = 0

  for (const workflow of safeWorkflows) {
    const screens = Array.isArray(workflow?.screens) ? workflow.screens : []
    const transitions = Array.isArray(workflow?.transitions) ? workflow.transitions : []

    screenCount += screens.length
    transitionCount += transitions.length

    for (const screen of screens) {
      if (typeof screen?.component === 'string' && screen.component.length > 0) {
        components.add(`${workflow?.id ?? 'workflow'}/${normalizeComponentPath(screen.component)}`)
      }
    }
  }

  return {
    workflowCount: safeWorkflows.length,
    screenCount,
    transitionCount,
    componentCount: components.size
  }
}

export function getScreenNodeMetrics(viewport) {
  const normalizedViewport = normalizeViewport(viewport)
  const scale = Math.min(
    SCREEN_NODE_MAX_WIDTH / normalizedViewport.width,
    SCREEN_NODE_MAX_HEIGHT / normalizedViewport.height,
    1
  )
  const frameWidth = Math.max(1, Math.round(normalizedViewport.width * scale))
  const frameHeight = Math.max(1, Math.round(normalizedViewport.height * scale))

  return {
    ...normalizedViewport,
    scale,
    frameWidth,
    frameHeight,
    nodeWidth: frameWidth,
    nodeHeight: frameHeight + SCREEN_NODE_HEADER_HEIGHT,
    headerHeight: SCREEN_NODE_HEADER_HEIGHT
  }
}

export function classifyEdges(screens, transitions) {
  const safeScreenList = Array.isArray(screens) ? screens : []
  const safeTransitionList = Array.isArray(transitions) ? transitions : []

  if (safeScreenList.length === 0 || safeTransitionList.length === 0) {
    return {
      tree: [],
      back: []
    }
  }

  const screenIds = new Set(
    safeScreenList
      .map((screen) => screen?.id)
      .filter((screenId) => typeof screenId === 'string' && screenId.length > 0)
  )
  const validTransitions = safeTransitionList.filter(
    (transition) => screenIds.has(transition?.from) && screenIds.has(transition?.to)
  )

  if (validTransitions.length === 0) {
    return {
      tree: [],
      back: []
    }
  }

  const outgoingTransitions = new Map()

  for (const transition of validTransitions) {
    const transitionsForScreen = outgoingTransitions.get(transition.from) ?? []
    transitionsForScreen.push(transition)
    outgoingTransitions.set(transition.from, transitionsForScreen)
  }

  const visited = new Set()
  const tree = []
  const back = []
  const queue = []
  const rootIds = safeScreenList
    .map((screen) => screen?.id)
    .filter((screenId) => typeof screenId === 'string' && screenIds.has(screenId))

  for (const rootId of rootIds) {
    if (visited.has(rootId)) {
      continue
    }

    visited.add(rootId)
    queue.push(rootId)

    while (queue.length > 0) {
      const currentScreenId = queue.shift()
      const transitionsForScreen = outgoingTransitions.get(currentScreenId) ?? []

      for (const transition of transitionsForScreen) {
        if (!visited.has(transition.to)) {
          visited.add(transition.to)
          queue.push(transition.to)
          tree.push(transition)
          continue
        }

        back.push(transition)
      }
    }
  }

  return {
    tree,
    back
  }
}

export function computeStoryboardLayout(workflow, viewport, options = {}) {
  const settings = {
    screenScale: DEFAULT_SCREEN_SCALE,
    variantScale: DEFAULT_VARIANT_SCALE,
    includeVariants: true,
    nodeSep: DEFAULT_NODE_SEP,
    rankSep: DEFAULT_RANK_SEP,
    marginX: DEFAULT_MARGIN_X,
    marginY: DEFAULT_MARGIN_Y,
    ...options
  }
  const normalizedViewport = normalizeViewport(viewport)
  const screens = safeScreens(workflow)

  if (screens.length === 0) {
    return {
      width: 0,
      height: 0,
      nodes: [],
      treeEdges: [],
      backEdges: [],
      groups: [],
      screenScale: settings.screenScale,
      variantScale: settings.variantScale
    }
  }

  const mainWidth = Math.max(1, normalizedViewport.width * settings.screenScale)
  const iframeHeight = Math.max(1, normalizedViewport.height * settings.screenScale)
  const mainHeight = SCREEN_NODE_HEADER_HEIGHT + iframeHeight
  const variantWidth = Math.max(1, normalizedViewport.width * settings.variantScale)
  const variantHeight = Math.max(1, normalizedViewport.height * settings.variantScale)
  const graph = createGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: settings.nodeSep,
    ranksep: settings.rankSep,
    marginx: settings.marginX,
    marginy: settings.marginY
  })
  const nodeMeta = new Map()
  const variantsByScreen = getVariantsByScreen(workflow)

  for (const screen of screens) {
    const variants = settings.includeVariants ? variantsByScreen.get(screen.id) ?? [] : []
    const variantStripWidth = variants.length > 0
      ? (variants.length * variantWidth) + ((variants.length - 1) * VARIANT_GAP)
      : 0
    const variantBlockHeight = variants.length > 0
      ? VARIANT_PADDING_TOP + variantHeight + VARIANT_PADDING_BOTTOM
      : 0
    const width = Math.max(mainWidth, variantStripWidth)
    const height = mainHeight + variantBlockHeight

    nodeMeta.set(screen.id, {
      screen,
      variants,
      width,
      height,
      variantStripWidth
    })
    graph.setNode(screen.id, { width, height })
  }

  const classifiedEdges = classifyEdges(screens, safeTransitions(workflow))

  for (const [index, transition] of classifiedEdges.tree.entries()) {
    graph.setEdge(transition.from, transition.to, {}, `${transition.from}-${transition.to}-${index}`)
  }

  dagre.layout(graph)

  const nodes = screens.map((screen) => {
    const meta = nodeMeta.get(screen.id)
    const layoutNode = graph.node(screen.id) ?? {
      x: (meta.width / 2) + settings.marginX,
      y: (meta.height / 2) + settings.marginY
    }

    let left = layoutNode.x - (meta.width / 2)
    let top = layoutNode.y - (meta.height / 2)

    if (isValidPosition(screen?.position)) {
      left = screen.position.x
      top = screen.position.y
    }

    const mainLeft = left + ((meta.width - mainWidth) / 2)

    return {
      id: screen.id,
      screen,
      variants: [...meta.variants],
      left,
      top,
      width: meta.width,
      height: meta.height,
      mainRect: {
        x: mainLeft,
        y: top,
        width: mainWidth,
        height: mainHeight
      },
      backAnnotations: []
    }
  })

  const nodeLookup = new Map(nodes.map((node) => [node.id, node]))
  const backEdges = classifiedEdges.back.flatMap((transition) => {
    const targetNode = nodeLookup.get(transition.to)

    if (!targetNode) {
      return []
    }

    const backEdge = {
      from: transition.from,
      to: transition.to,
      label: transition.trigger
    }

    targetNode.backAnnotations.push(backEdge)

    return [backEdge]
  })
  const treeEdges = classifiedEdges.tree.flatMap((transition, index) => {
    const fromNode = nodeLookup.get(transition.from)
    const toNode = nodeLookup.get(transition.to)

    if (!fromNode || !toNode) {
      return []
    }

    return [{
      id: `${transition.from}-${transition.to}-${index}`,
      from: transition.from,
      to: transition.to,
      label: transition.trigger,
      fromRect: fromNode.mainRect,
      toRect: toNode.mainRect
    }]
  })
  const groups = computeLayoutGroups(workflow, nodes)
  const layoutWidth = Math.max(
    settings.marginX * 2,
    maxRight(nodes, groups) + settings.marginX
  )
  const layoutHeight = Math.max(
    settings.marginY * 2,
    maxBottom(nodes, groups) + settings.marginY
  )

  return {
    width: layoutWidth,
    height: layoutHeight,
    nodes,
    treeEdges,
    backEdges,
    groups,
    screenScale: settings.screenScale,
    variantScale: settings.variantScale
  }
}

function computeLayoutGroups(workflow, nodes) {
  const groups = Array.isArray(workflow?.groups) ? workflow.groups : []

  if (groups.length === 0 || nodes.length === 0) {
    return []
  }

  const membersByGroup = new Map()

  for (const node of nodes) {
    const groupId = node?.screen?.group

    if (typeof groupId !== 'string' || groupId.length === 0) {
      continue
    }

    const members = membersByGroup.get(groupId) ?? []
    members.push(node)
    membersByGroup.set(groupId, members)
  }

  return groups.flatMap((group) => {
    const members = membersByGroup.get(group?.id) ?? []

    if (members.length === 0) {
      return []
    }

    const left = Math.min(...members.map((node) => node.left)) - GROUP_PADDING_X
    const top = Math.min(...members.map((node) => node.top)) - GROUP_PADDING_TOP
    const right = Math.max(...members.map((node) => node.left + node.width)) + GROUP_PADDING_X
    const bottom = Math.max(...members.map((node) => node.top + node.height)) + GROUP_PADDING_BOTTOM

    return [{
      id: group.id,
      title: group.title,
      bounds: {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      }
    }]
  })
}

function createGraph(config) {
  const graph = new dagre.graphlib.Graph({ multigraph: true })

  graph.setGraph(config)
  graph.setDefaultEdgeLabel(() => ({}))

  return graph
}

function getVariantsByScreen(workflow) {
  const variantsByScreen = new Map()
  const screenIds = new Set(safeScreens(workflow).map((screen) => screen.id))

  for (const variant of safeVariants(workflow)) {
    if (!screenIds.has(variant?.screenId)) {
      continue
    }

    const variants = variantsByScreen.get(variant.screenId) ?? []
    variants.push(variant)
    variantsByScreen.set(variant.screenId, variants)
  }

  return variantsByScreen
}

function isValidPosition(position) {
  return Number.isFinite(position?.x) && Number.isFinite(position?.y)
}

function maxBottom(nodes, groups) {
  const nodeBottom = nodes.reduce((maxValue, node) => Math.max(maxValue, node.top + node.height), 0)
  const groupBottom = groups.reduce(
    (maxValue, group) => Math.max(maxValue, group.bounds.y + group.bounds.height),
    0
  )

  return Math.max(nodeBottom, groupBottom)
}

function maxRight(nodes, groups) {
  const nodeRight = nodes.reduce((maxValue, node) => Math.max(maxValue, node.left + node.width), 0)
  const groupRight = groups.reduce(
    (maxValue, group) => Math.max(maxValue, group.bounds.x + group.bounds.width),
    0
  )

  return Math.max(nodeRight, groupRight)
}

function normalizeViewport(viewport) {
  const width = Number(viewport?.width) > 0 ? Number(viewport.width) : DEFAULT_VIEWPORT.width
  const height = Number(viewport?.height) > 0 ? Number(viewport.height) : DEFAULT_VIEWPORT.height
  const matchingViewport = VIEWPORT_OPTIONS.find(
    (option) => option.width === width && option.height === height
  )

  return {
    id: viewport?.id ?? matchingViewport?.id ?? DEFAULT_VIEWPORT.id,
    label: viewport?.label ?? matchingViewport?.label ?? `${width}×${height}`,
    width,
    height
  }
}

function normalizeComponentPath(componentPath) {
  return String(componentPath ?? '')
    .replace(/^\.\//u, '')
    .replace(/\\/gu, '/')
    .replace(/\.svelte$/iu, '')
}

function safeScreens(workflow) {
  return Array.isArray(workflow?.screens) ? workflow.screens : []
}

function safeTransitions(workflow) {
  return Array.isArray(workflow?.transitions) ? workflow.transitions : []
}

function safeVariants(workflow) {
  return Array.isArray(workflow?.variants) ? workflow.variants : []
}
