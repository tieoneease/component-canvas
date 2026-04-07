import { describe, expect, it } from 'vitest'

import {
  VIEWPORTS,
  classifyEdges,
  computeMultiWorkflowLayout,
  computeStoryboardLayout,
  offsetLayout
} from '../shell-src/src/lib/flow.js'

function createWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'example',
    title: 'Example Workflow',
    screens: [
      { id: 'a', component: './A.svelte', title: 'A' },
      { id: 'b', component: './B.svelte', title: 'B' },
      { id: 'c', component: './C.svelte', title: 'C' }
    ],
    transitions: [],
    variants: [],
    groups: [],
    ...overrides
  }
}

describe('classifyEdges', () => {
  it('classifies a linear chain as tree edges only', () => {
    const screens = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' }
    ]
    const transitions = [
      { from: 'a', to: 'b', trigger: 'next' },
      { from: 'b', to: 'c', trigger: 'finish' }
    ]

    expect(classifyEdges(screens, transitions)).toEqual({
      tree: transitions,
      back: []
    })
  })

  it('classifies returns in a hub-and-spoke flow as back edges', () => {
    const screens = [
      { id: 'home' },
      { id: 'feed' },
      { id: 'settings' }
    ]
    const transitions = [
      { from: 'home', to: 'feed', trigger: 'Feed' },
      { from: 'feed', to: 'home', trigger: 'Back' },
      { from: 'home', to: 'settings', trigger: 'Settings' },
      { from: 'settings', to: 'home', trigger: 'Home' }
    ]

    expect(classifyEdges(screens, transitions)).toEqual({
      tree: [transitions[0], transitions[2]],
      back: [transitions[1], transitions[3]]
    })
  })

  it('classifies a full cycle with the closing edge as back', () => {
    const screens = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' }
    ]
    const transitions = [
      { from: 'a', to: 'b', trigger: 'next' },
      { from: 'b', to: 'c', trigger: 'next' },
      { from: 'c', to: 'a', trigger: 'reset' }
    ]

    expect(classifyEdges(screens, transitions)).toEqual({
      tree: [transitions[0], transitions[1]],
      back: [transitions[2]]
    })
  })

  it('treats self-loops as back edges', () => {
    const screens = [{ id: 'solo' }]
    const transitions = [{ from: 'solo', to: 'solo', trigger: 'refresh' }]

    expect(classifyEdges(screens, transitions)).toEqual({
      tree: [],
      back: transitions
    })
  })

  it('drops transitions that reference unknown screen ids', () => {
    const screens = [
      { id: 'a' },
      { id: 'b' }
    ]
    const transitions = [
      { from: 'a', to: 'missing', trigger: 'bad target' },
      { from: 'missing', to: 'b', trigger: 'bad source' },
      { from: 'a', to: 'b', trigger: 'valid' }
    ]

    expect(classifyEdges(screens, transitions)).toEqual({
      tree: [transitions[2]],
      back: []
    })
  })

  it('continues BFS across disconnected screen sets', () => {
    const screens = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' }
    ]
    const transitions = [
      { from: 'a', to: 'b', trigger: 'ab' },
      { from: 'c', to: 'd', trigger: 'cd' },
      { from: 'd', to: 'c', trigger: 'dc' }
    ]

    expect(classifyEdges(screens, transitions)).toEqual({
      tree: [transitions[0], transitions[1]],
      back: [transitions[2]]
    })
  })

  it('returns empty arrays for a single screen with no transitions', () => {
    expect(classifyEdges([{ id: 'solo' }], [])).toEqual({
      tree: [],
      back: []
    })
  })

  it('returns empty arrays for empty inputs', () => {
    expect(classifyEdges([], [])).toEqual({
      tree: [],
      back: []
    })
  })
})

describe('computeStoryboardLayout', () => {
  it('returns a non-zero layout for a single screen workflow', () => {
    const layout = computeStoryboardLayout(
      createWorkflow({
        screens: [{ id: 'a', component: './A.svelte', title: 'A' }]
      }),
      VIEWPORTS.desktop
    )

    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
    expect(layout.nodes).toHaveLength(1)
    expect(layout.treeEdges).toEqual([])
    expect(layout.backEdges).toEqual([])
    expect(layout.groups).toEqual([])
    expect(layout.nodes[0]).toMatchObject({
      id: 'a',
      width: expect.any(Number),
      height: expect.any(Number),
      mainRect: {
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number)
      },
      backAnnotations: []
    })
  })

  it('lays out tree edges left-to-right', () => {
    const layout = computeStoryboardLayout(
      createWorkflow({
        transitions: [
          { from: 'a', to: 'b', trigger: 'next' },
          { from: 'b', to: 'c', trigger: 'finish' }
        ]
      }),
      VIEWPORTS.desktop
    )
    const byId = new Map(layout.nodes.map((node) => [node.id, node]))

    expect(byId.get('a')!.left).toBeLessThan(byId.get('b')!.left)
    expect(byId.get('b')!.left).toBeLessThan(byId.get('c')!.left)
    expect(layout.treeEdges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['a->b', 'b->c'])
  })

  it('increases node height when variants are included', () => {
    const workflow = createWorkflow({
      variants: [
        { id: 'a-compact', screenId: 'a', title: 'Compact', props: { density: 'compact' } },
        { id: 'a-spacious', screenId: 'a', title: 'Spacious', props: { density: 'spacious' } }
      ]
    })
    const withVariants = computeStoryboardLayout(workflow, VIEWPORTS.desktop)
    const withoutVariants = computeStoryboardLayout(workflow, VIEWPORTS.desktop, {
      includeVariants: false
    })
    const withVariantsNode = withVariants.nodes.find((node) => node.id === 'a')
    const withoutVariantsNode = withoutVariants.nodes.find((node) => node.id === 'a')

    expect(withVariantsNode).toBeTruthy()
    expect(withoutVariantsNode).toBeTruthy()
    expect(withVariantsNode!.height).toBeGreaterThan(withoutVariantsNode!.height)
    expect(withVariantsNode!.variants).toHaveLength(2)
    expect(withoutVariantsNode!.variants).toEqual([])
  })

  it('applies manual position overrides exactly after dagre layout', () => {
    const layout = computeStoryboardLayout(
      createWorkflow({
        screens: [
          { id: 'a', component: './A.svelte', position: { x: 120, y: 36 } },
          { id: 'b', component: './B.svelte' }
        ],
        transitions: [{ from: 'a', to: 'b', trigger: 'next' }]
      }),
      VIEWPORTS.desktop
    )
    const overriddenNode = layout.nodes.find((node) => node.id === 'a')

    expect(overriddenNode).toBeTruthy()
    expect(overriddenNode!.left).toBe(120)
    expect(overriddenNode!.top).toBe(36)
    expect(overriddenNode!.mainRect.x).toBe(120)
    expect(overriddenNode!.mainRect.y).toBe(36)
  })

  it('records cyclic returns as back-edge annotations on the target node', () => {
    const layout = computeStoryboardLayout(
      createWorkflow({
        screens: [
          { id: 'a', component: './A.svelte' },
          { id: 'b', component: './B.svelte' }
        ],
        transitions: [
          { from: 'a', to: 'b', trigger: 'next' },
          { from: 'b', to: 'a', trigger: 'back' }
        ]
      }),
      VIEWPORTS.desktop
    )
    const nodeA = layout.nodes.find((node) => node.id === 'a')

    expect(layout.treeEdges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['a->b'])
    expect(layout.backEdges).toEqual([{ from: 'b', to: 'a', label: 'back' }])
    expect(nodeA?.backAnnotations).toEqual([{ from: 'b', to: 'a', label: 'back' }])
  })

  it('computes group bounds that enclose all member screens', () => {
    const layout = computeStoryboardLayout(
      createWorkflow({
        groups: [{ id: 'auth', title: 'Authentication' }],
        screens: [
          { id: 'a', component: './A.svelte', group: 'auth' },
          { id: 'b', component: './B.svelte', group: 'auth' },
          { id: 'c', component: './C.svelte' }
        ],
        transitions: [
          { from: 'a', to: 'b', trigger: 'next' },
          { from: 'b', to: 'c', trigger: 'finish' }
        ]
      }),
      VIEWPORTS.desktop
    )
    const group = layout.groups.find((entry) => entry.id === 'auth')
    const members = layout.nodes.filter((node) => node.screen.group === 'auth')

    expect(group).toBeTruthy()
    expect(members).toHaveLength(2)

    for (const member of members) {
      expect(group!.bounds.x).toBeLessThanOrEqual(member.left)
      expect(group!.bounds.y).toBeLessThanOrEqual(member.top)
      expect(group!.bounds.x + group!.bounds.width).toBeGreaterThanOrEqual(member.left + member.width)
      expect(group!.bounds.y + group!.bounds.height).toBeGreaterThanOrEqual(member.top + member.height)
    }
  })

  it('returns an empty layout for workflows without screens', () => {
    expect(
      computeStoryboardLayout(
        createWorkflow({
          screens: []
        }),
        VIEWPORTS.desktop
      )
    ).toEqual({
      width: 0,
      height: 0,
      nodes: [],
      treeEdges: [],
      backEdges: [],
      groups: [],
      screenScale: 0.34,
      variantScale: 0.22
    })
  })

  it('ignores unknown group references when computing layout groups', () => {
    const layout = computeStoryboardLayout(
      createWorkflow({
        groups: [{ id: 'known', title: 'Known Group' }],
        screens: [
          { id: 'a', component: './A.svelte', group: 'missing' },
          { id: 'b', component: './B.svelte' }
        ],
        transitions: [{ from: 'a', to: 'b', trigger: 'next' }]
      }),
      VIEWPORTS.desktop
    )

    expect(layout.nodes).toHaveLength(2)
    expect(layout.groups).toEqual([])
  })
})

describe('computeMultiWorkflowLayout', () => {
  it('arranges workflow clusters left-to-right while preserving per-workflow layouts', () => {
    const authWorkflow = createWorkflow({
      id: 'auth',
      title: 'Authentication',
      transitions: [
        { from: 'a', to: 'b', trigger: 'next' },
        { from: 'b', to: 'c', trigger: 'finish' }
      ]
    })
    const settingsWorkflow = createWorkflow({
      id: 'settings',
      title: 'Settings',
      screens: [
        { id: 'settings-main', component: './Settings.svelte', title: 'Settings' }
      ]
    })

    const authLayout = computeStoryboardLayout(authWorkflow, VIEWPORTS.desktop)
    const multiLayout = computeMultiWorkflowLayout(
      [authWorkflow, settingsWorkflow],
      VIEWPORTS.desktop,
      { clusterGap: 240 }
    )
    const [authCluster, settingsCluster] = multiLayout.clusters

    expect(multiLayout.clusters).toHaveLength(2)
    expect(authCluster.layout).toEqual(authLayout)
    expect(settingsCluster.frameBounds.x).toBe(
      authCluster.frameBounds.x + authCluster.frameBounds.width + 240
    )
    expect(multiLayout.width).toBe(
      settingsCluster.frameBounds.x + settingsCluster.frameBounds.width
    )
    expect(multiLayout.height).toBeGreaterThanOrEqual(authCluster.frameBounds.height)
    expect(authCluster.offsetX + authLayout.nodes[0].left).toBeGreaterThanOrEqual(authCluster.frameBounds.x)
    expect(authCluster.offsetY + authLayout.nodes[0].top).toBeGreaterThanOrEqual(authCluster.frameBounds.y)
  })

  it('returns empty clusters for empty workflow lists', () => {
    expect(computeMultiWorkflowLayout([], VIEWPORTS.desktop)).toEqual({
      width: 0,
      height: 0,
      clusters: []
    })
  })
})

describe('offsetLayout', () => {
  it('offsets nodes, groups, and tree edges without mutating the original layout', () => {
    const layout = computeStoryboardLayout(
      createWorkflow({
        groups: [{ id: 'auth', title: 'Authentication' }],
        screens: [
          { id: 'a', component: './A.svelte', title: 'A', group: 'auth' },
          { id: 'b', component: './B.svelte', title: 'B', group: 'auth' }
        ],
        transitions: [{ from: 'a', to: 'b', trigger: 'next' }]
      }),
      VIEWPORTS.desktop
    )
    const shifted = offsetLayout(layout, 120, 64)

    expect(shifted).not.toBe(layout)
    expect(shifted.nodes[0].left).toBe(layout.nodes[0].left + 120)
    expect(shifted.nodes[0].top).toBe(layout.nodes[0].top + 64)
    expect(shifted.nodes[0].mainRect.x).toBe(layout.nodes[0].mainRect.x + 120)
    expect(shifted.nodes[0].mainRect.y).toBe(layout.nodes[0].mainRect.y + 64)
    expect(shifted.groups[0].bounds.x).toBe(layout.groups[0].bounds.x + 120)
    expect(shifted.groups[0].bounds.y).toBe(layout.groups[0].bounds.y + 64)
    expect(shifted.treeEdges[0].fromRect.x).toBe(layout.treeEdges[0].fromRect.x + 120)
    expect(shifted.treeEdges[0].toRect.y).toBe(layout.treeEdges[0].toRect.y + 64)
    expect(layout.nodes[0].left).not.toBe(shifted.nodes[0].left)
  })
})

describe('property-based invariants', () => {
  it('preserves edge classification invariants across random graphs', () => {
    for (let run = 0; run < RANDOM_GRAPH_RUNS; run += 1) {
      const seed = run + 1
      const random = createSeededRandom(seed)
      const screenCount = randomInt(random, 1, 8)
      const ensureReachable = run % 2 === 0
      const minTransitions = ensureReachable ? Math.max(0, screenCount - 1) : 0
      const transitionCount = randomInt(
        random,
        minTransitions,
        Math.max(minTransitions, screenCount * 3)
      )
      const workflow = generateRandomGraph(screenCount, transitionCount, {
        seed: seed * 97,
        ensureReachable
      })
      const validTransitions = getValidTransitions(workflow.screens, workflow.transitions)
      const { tree, back } = classifyEdges(workflow.screens, workflow.transitions)
      const classifiedTransitions = [...tree, ...back]
      const backSet = new Set(back)

      expect(tree.length + back.length).toBe(validTransitions.length)
      expect(classifiedTransitions).toHaveLength(validTransitions.length)
      expect(new Set(classifiedTransitions).size).toBe(validTransitions.length)

      for (const edge of tree) {
        expect(backSet.has(edge)).toBe(false)
      }

      expect(hasDirectedCycle(workflow.screens, tree)).toBe(false)

      if (isReachableFromFirstScreen(workflow.screens, validTransitions)) {
        expect(tree).toHaveLength(Math.max(0, workflow.screens.length - 1))

        if (workflow.screens.length > 1) {
          const touchedScreenIds = new Set(tree.flatMap((edge) => [edge.from, edge.to]))

          expect(touchedScreenIds).toEqual(new Set(workflow.screens.map((screen) => screen.id)))
        }
      }
    }
  })

  it('preserves layout invariants across random graphs', () => {
    for (let run = 0; run < RANDOM_GRAPH_RUNS; run += 1) {
      const seed = run + 101
      const random = createSeededRandom(seed)
      const screenCount = randomInt(random, 1, 8)
      const ensureReachable = run % 2 === 1
      const minTransitions = ensureReachable ? Math.max(0, screenCount - 1) : 0
      const transitionCount = randomInt(
        random,
        minTransitions,
        Math.max(minTransitions, screenCount * 3)
      )
      const workflow = generateRandomGraph(screenCount, transitionCount, {
        seed: seed * 89,
        ensureReachable
      })
      const viewport = run % 3 === 0 ? VIEWPORTS.mobile : VIEWPORTS.desktop
      const layout = computeStoryboardLayout(workflow, viewport)
      const nodeIds = new Set(layout.nodes.map((node) => node.id))
      const screenIds = new Set(workflow.screens.map((screen) => screen.id))
      const nodesById = new Map(layout.nodes.map((node) => [node.id, node]))

      assertFiniteNumber(layout.width)
      assertFiniteNumber(layout.height)
      expect(layout.width).toBeGreaterThanOrEqual(0)
      expect(layout.height).toBeGreaterThanOrEqual(0)

      expect(layout.nodes).toHaveLength(workflow.screens.length)
      expect(nodeIds).toEqual(screenIds)

      for (const node of layout.nodes) {
        assertFiniteNumber(node.left)
        assertFiniteNumber(node.top)
        assertFiniteNumber(node.width)
        assertFiniteNumber(node.height)
        assertFiniteNumber(node.mainRect.x)
        assertFiniteNumber(node.mainRect.y)
        assertFiniteNumber(node.mainRect.width)
        assertFiniteNumber(node.mainRect.height)

        expect(node.left).toBeGreaterThanOrEqual(0)
        expect(node.top).toBeGreaterThanOrEqual(0)
      }

      for (const edge of layout.treeEdges) {
        assertFiniteNumber(edge.fromRect.x)
        assertFiniteNumber(edge.fromRect.y)
        assertFiniteNumber(edge.fromRect.width)
        assertFiniteNumber(edge.fromRect.height)
        assertFiniteNumber(edge.toRect.x)
        assertFiniteNumber(edge.toRect.y)
        assertFiniteNumber(edge.toRect.width)
        assertFiniteNumber(edge.toRect.height)
      }

      for (const group of layout.groups) {
        assertFiniteNumber(group.bounds.x)
        assertFiniteNumber(group.bounds.y)
        assertFiniteNumber(group.bounds.width)
        assertFiniteNumber(group.bounds.height)

        const members = layout.nodes.filter((node) => node.screen.group === group.id)

        expect(members.length).toBeGreaterThan(0)

        for (const member of members) {
          expect(group.bounds.x).toBeLessThanOrEqual(member.left + GROUP_BOUNDS_TOLERANCE)
          expect(group.bounds.y).toBeLessThanOrEqual(member.top + GROUP_BOUNDS_TOLERANCE)
          expect(group.bounds.x + group.bounds.width).toBeGreaterThanOrEqual(
            member.left + member.width - GROUP_BOUNDS_TOLERANCE
          )
          expect(group.bounds.y + group.bounds.height).toBeGreaterThanOrEqual(
            member.top + member.height - GROUP_BOUNDS_TOLERANCE
          )
        }
      }

      for (const screen of workflow.screens) {
        if (!screen.position) {
          continue
        }

        const node = nodesById.get(screen.id)

        expect(node).toBeTruthy()
        expect(node!.left).toBe(screen.position.x)
        expect(node!.top).toBe(screen.position.y)
      }
    }
  })
})

const RANDOM_GRAPH_RUNS = 50
const GROUP_BOUNDS_TOLERANCE = 1e-6

type RandomScreen = {
  id: string
  component: string
  title: string
  position?: { x: number; y: number }
  group?: string
}

type RandomTransition = {
  from: string
  to: string
  trigger: string
}

type RandomVariant = {
  id: string
  screenId: string
  title: string
  props: Record<string, unknown>
}

type RandomGroup = {
  id: string
  title: string
}

type RandomWorkflow = {
  id: string
  title: string
  screens: RandomScreen[]
  transitions: RandomTransition[]
  variants: RandomVariant[]
  groups: RandomGroup[]
}

function generateRandomGraph(
  screenCount: number,
  transitionCount: number,
  options: { seed?: number; ensureReachable?: boolean } = {}
): RandomWorkflow {
  const { seed = 1, ensureReachable = false } = options
  const random = createSeededRandom(seed)

  if (screenCount <= 0) {
    return {
      id: `random-${seed}`,
      title: `Random ${seed}`,
      screens: [],
      transitions: [],
      variants: [],
      groups: []
    }
  }

  const groups = Array.from({ length: randomInt(random, 0, Math.min(3, screenCount)) }, (_, index) => ({
    id: `group-${index}`,
    title: `Group ${index}`
  }))
  const screens = Array.from({ length: screenCount }, (_, index) => {
    const shouldOverridePosition = index === 0 ? seed % 2 === 0 : random() < 0.25
    const position = shouldOverridePosition
      ? {
          x: randomInt(random, 0, 900),
          y: randomInt(random, 0, 600)
        }
      : undefined
    const group = groups.length === 0
      ? undefined
      : index < groups.length
        ? groups[index].id
        : random() < 0.45
          ? groups[randomInt(random, 0, groups.length - 1)].id
          : undefined

    return {
      id: `screen-${index}`,
      component: `./Screen${index}.svelte`,
      title: `Screen ${index}`,
      ...(position ? { position } : {}),
      ...(group ? { group } : {})
    }
  })
  const variants = screens.flatMap((screen) => {
    const variantCount = randomInt(random, 0, 2)

    return Array.from({ length: variantCount }, (_, index) => ({
      id: `${screen.id}-variant-${index}`,
      screenId: screen.id,
      title: `${screen.title} Variant ${index}`,
      props: { mode: index }
    }))
  })
  const transitions: RandomTransition[] = []

  if (ensureReachable) {
    for (let index = 0; index < screenCount - 1 && transitions.length < transitionCount; index += 1) {
      transitions.push({
        from: screens[index].id,
        to: screens[index + 1].id,
        trigger: `connect-${index}`
      })
    }
  }

  while (transitions.length < transitionCount) {
    const from = screens[randomInt(random, 0, screens.length - 1)]
    const to = screens[randomInt(random, 0, screens.length - 1)]

    transitions.push({
      from: from.id,
      to: to.id,
      trigger: `transition-${transitions.length}`
    })
  }

  return {
    id: `random-${seed}`,
    title: `Random ${seed}`,
    screens,
    transitions,
    variants,
    groups
  }
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0

  if (state === 0) {
    state = 1
  }

  return () => {
    state = (state + 0x6d2b79f5) >>> 0

    let next = state

    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)

    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function randomInt(random: () => number, min: number, max: number) {
  return Math.floor(random() * (max - min + 1)) + min
}

function getValidTransitions(screens: RandomScreen[], transitions: RandomTransition[]) {
  const screenIds = new Set(screens.map((screen) => screen.id))

  return transitions.filter(
    (transition) => screenIds.has(transition.from) && screenIds.has(transition.to)
  )
}

function hasDirectedCycle(screens: RandomScreen[], transitions: RandomTransition[]) {
  const adjacency = new Map<string, string[]>()
  const states = new Map<string, number>()

  for (const screen of screens) {
    states.set(screen.id, 0)
  }

  for (const transition of transitions) {
    const outgoing = adjacency.get(transition.from) ?? []

    outgoing.push(transition.to)
    adjacency.set(transition.from, outgoing)
  }

  const visit = (screenId: string): boolean => {
    states.set(screenId, 1)

    for (const nextScreenId of adjacency.get(screenId) ?? []) {
      const state = states.get(nextScreenId) ?? 0

      if (state === 1) {
        return true
      }

      if (state === 0 && visit(nextScreenId)) {
        return true
      }
    }

    states.set(screenId, 2)

    return false
  }

  for (const screen of screens) {
    if ((states.get(screen.id) ?? 0) === 0 && visit(screen.id)) {
      return true
    }
  }

  return false
}

function isReachableFromFirstScreen(screens: RandomScreen[], transitions: RandomTransition[]) {
  if (screens.length === 0) {
    return true
  }

  const visited = new Set([screens[0].id])
  const queue = [screens[0].id]
  const adjacency = new Map<string, string[]>()

  for (const transition of transitions) {
    const outgoing = adjacency.get(transition.from) ?? []

    outgoing.push(transition.to)
    adjacency.set(transition.from, outgoing)
  }

  while (queue.length > 0) {
    const current = queue.shift()

    for (const next of adjacency.get(current!) ?? []) {
      if (visited.has(next)) {
        continue
      }

      visited.add(next)
      queue.push(next)
    }
  }

  return visited.size === screens.length
}

function assertFiniteNumber(value: number) {
  expect(Number.isFinite(value)).toBe(true)
}
