import { describe, expect, it } from 'vitest'

import {
  VIEWPORTS,
  classifyEdges,
  computeStoryboardLayout
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
