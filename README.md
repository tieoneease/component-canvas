# @chungsam95/component-canvas

A visual storyboard for Svelte components. Define screens, transitions, and variant states — then explore them in a pannable, zoomable canvas with live previews.

```
┌─────────────────────────────────────────────────────────┐
│  Component Canvas                                       │
│                                                         │
│  ┌──────────┐    Login     ┌──────────┐                 │
│  │  Login   │───success───▶│Dashboard │                 │
│  │  Form    │              │          │                 │
│  └──────────┘              └──────────┘                 │
│    ┌────────┐ ┌────────┐                                │
│    │ Error  │ │  SSO   │  ← variant states              │
│    └────────┘ └────────┘                                │
└─────────────────────────────────────────────────────────┘
```

Each screen renders your real Svelte component in a live iframe — same Vite config, same Tailwind, same component code.

## Prerequisites

- A Svelte project with Vite (SvelteKit or standalone Svelte + Vite)
- Node 18+

## Getting started

### 1. Install

```bash
npm install -D @chungsam95/component-canvas
```

### 2. Initialize

```bash
npx component-canvas init
```

This creates `.canvas/workflows/example/` with a sample workflow and screen. Open `.canvas/workflows/example/_flow.ts` to see the structure.

### 3. Run

```bash
npx component-canvas dev
```

Open `http://localhost:5173` — you'll see the canvas with your example workflow. Pan with click-drag, zoom with scroll.

### 4. Add your own screens

Create a workflow directory and a `_flow.ts` file:

```ts
// .canvas/workflows/auth/_flow.ts
export default {
  id: 'auth',
  title: 'Authentication',
  screens: [
    { id: 'login', component: './LoginForm.svelte', title: 'Login',
      props: { submitLabel: 'Sign in' } },
    { id: 'dashboard', component: './Dashboard.svelte', title: 'Dashboard',
      props: { username: 'Sam' } }
  ],
  transitions: [
    { from: 'login', to: 'dashboard', trigger: 'Login success' }
  ]
};
```

Place your Svelte components alongside `_flow.ts`, or use relative paths to components in your project's `src/` directory.

**Variants** let you show the same screen with different props (error states, empty states, etc.):

```ts
variants: [
  { id: 'login-error', screenId: 'login', title: 'Invalid credentials',
    props: { error: 'Wrong password.' } }
]
```

### 5. Add a script

```json
{
  "scripts": {
    "canvas": "component-canvas dev"
  }
}
```

## CLI

| Command | Description |
|---------|-------------|
| `component-canvas init` | Scaffold `.canvas/` with an example workflow |
| `component-canvas dev` | Start the canvas dev server |
| `component-canvas list` | List workflows and screens |
| `component-canvas screenshot [workflow]` | Export screens as PNGs |
| `component-canvas explore <path>` | Extract a component's props and events |

All commands support `--json` and `--help`.

## Mocking external dependencies

Components that import SvelteKit modules (`$app/stores`, `$app/navigation`, etc.) won't work outside Kit's runtime. Create mock files and tell canvas about them in `canvas.config.ts`:

```ts
// canvas.config.ts (project root)
export default {
  mocks: {
    '$app/stores': './.canvas/mocks/$app/stores.js',
    '$app/navigation': './.canvas/mocks/$app/navigation.js',
  }
};
```

Only mock what breaks — the goal is to render real components, not to simulate your entire app.

---

## Releasing (maintainers)

```bash
npm version patch && git push --follow-tags
```

Publishes automatically via GitHub Actions with [trusted publishing](https://docs.npmjs.com/trusted-publishers/).
