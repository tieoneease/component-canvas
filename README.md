# @chungsam95/component-canvas

Render real Svelte components in an interactive storyboard canvas. Define workflows as screens + transitions, and component-canvas gives you a pannable, zoomable canvas with live previews, variant states, and visual diffs.

## Install

```bash
npm install -D @chungsam95/component-canvas
# or
pnpm add -D @chungsam95/component-canvas
```

## Quick start

### 1. Initialize

```bash
npx component-canvas init
```

This creates a `.canvas/` directory with an example workflow.

### 2. Define a workflow

Each workflow lives in `.canvas/workflows/<name>/` and has a `_flow.ts` file describing the screens and transitions:

```ts
// .canvas/workflows/auth/_flow.ts
export default {
  id: 'auth',
  title: 'Authentication',
  screens: [
    {
      id: 'login',
      component: './LoginForm.svelte',
      title: 'Login',
      props: { submitLabel: 'Sign in' }
    },
    {
      id: 'dashboard',
      component: './Dashboard.svelte',
      title: 'Dashboard',
      props: { username: 'Sam' }
    }
  ],
  transitions: [
    { from: 'login', to: 'dashboard', trigger: 'Login success' }
  ],
  variants: [
    {
      id: 'login-error',
      screenId: 'login',
      title: 'Invalid credentials',
      props: { error: 'Invalid email or password.' }
    }
  ]
};
```

Screen components are standard Svelte files — the same components your app uses. Place them alongside `_flow.ts` or reference them from your project's `src/` directory.

### 3. Start the dev server

```bash
npx component-canvas dev
```

Opens an interactive canvas at `http://localhost:5173` with:
- Pan and zoom navigation
- Live component previews in iframes
- Workflow arrows showing screen transitions
- Variant states for each screen
- Thumbnail caching (persists across refreshes via IndexedDB)
- Viewport culling (only renders visible nodes)

### 4. Add a script (recommended)

```json
{
  "scripts": {
    "canvas": "component-canvas dev"
  }
}
```

Then `npm run canvas` or `pnpm canvas`.

## Configuration

Optional `canvas.config.ts` in your project root:

```ts
export default {
  mocks: {
    // Mock SvelteKit runtime modules for canvas isolation
    '$app/stores': './.canvas/mocks/$app/stores.js',
    '$app/navigation': './.canvas/mocks/$app/navigation.js',
  }
};
```

## CLI commands

| Command | Description |
|---------|-------------|
| `component-canvas dev` | Start the dev server with live preview canvas |
| `component-canvas init` | Scaffold `.canvas/` directory with example workflow |
| `component-canvas list` | List discovered workflows and screens |
| `component-canvas screenshot [workflow]` | Capture screens as PNG files |
| `component-canvas explore <path>` | Extract props/events from a Svelte component |

All commands support `--json` for machine-readable output and `--help` for usage details.

## How it works

The canvas renders each screen as a live iframe served by a Vite dev server that reuses your project's Vite config, Svelte plugins, and Tailwind setup. Components render with real props in isolation — no mocking of the component itself, just the external dependencies (stores, navigation, etc.) that don't exist outside your app's runtime.

## Releasing (maintainers)

Publishes to npm via GitHub Actions with [trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC — no tokens needed):

```bash
# 1. Bump version
npm version patch   # or minor, major

# 2. Push with tag
git push --follow-tags

# 3. GitHub Action builds and publishes automatically
```
