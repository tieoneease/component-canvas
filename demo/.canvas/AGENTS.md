# component-canvas

component-canvas renders Svelte component workflows as spatial storyboards: think Figma for your UI screens. You define real component states, connect them with transitions, and review them visually in the preview app.

## 3-step workflow

1. Define a workflow in `.canvas/workflows/<name>/_flow.ts`.
2. Start the server with `component-canvas dev` (or `npx tsx path/to/bin/cli.ts dev`).
3. Create a presentation with `POST /preview/api/presentations`, then open the returned `/preview/?presentation=ID` URL in the portal.

## Workflow manifest: `.canvas/workflows/<name>/_flow.ts`

```ts
export default {
  id: 'auth',
  title: 'Authentication',
  groups: [
    { id: 'entry', title: 'Entry' },
    { id: 'signed-in', title: 'Signed in' }
  ],
  screens: [
    {
      id: 'login',
      component: './LoginForm.svelte',
      title: 'Login',
      group: 'entry',
      position: { x: 0, y: 0 },
      props: { submitLabel: 'Sign in', showForgotPassword: true }
    },
    {
      id: 'dashboard',
      component: './Dashboard.svelte',
      title: 'Dashboard',
      group: 'signed-in',
      position: { x: 420, y: 0 },
      props: { username: 'Sam', plan: 'Pro' }
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
      props: { error: 'Invalid email or password. Please try again.' }
    }
  ]
};
```

Notes:
- `component` is relative to the workflow directory and must point to a real `.svelte` file.
- `screens[].props` are the base props for that screen.
- `variants[].props` override/extend the base screen props for alternate states.
- `groups` are optional labels for clustering screens; `screens[].group` references `groups[].id`.
- `position` is optional canvas placement metadata.

## Start the server

```bash
component-canvas dev
# or
npx tsx path/to/bin/cli.ts dev
```

The preview app lives under `/preview/`.

## Presentation API

Create a presentation with:

```http
POST /preview/api/presentations
Content-Type: application/json
```

Request body:

```json
{
  "title": "Auth flow review",
  "items": [
    { "workflow": "auth", "screen": "login", "label": "Login" },
    { "workflow": "auth", "screen": "login", "variant": "login-error", "label": "Error" },
    { "component": "./src/lib/components/LoginForm.svelte", "props": { "submitLabel": "Continue" }, "label": "Ad hoc render" }
  ]
}
```

Response:

```json
{ "id": "abc123", "url": "/preview/?presentation=abc123" }
```

To show it in the portal, prefix the returned `url` with the dev server origin:

```txt
http://127.0.0.1:PORT/preview/?presentation=abc123
portal(type='url', url='http://127.0.0.1:PORT/preview/?presentation=abc123')
```

Item shapes:
- Screen: `{ workflow, screen, label }`
- Variant: `{ workflow, screen, variant, label }`
- Ad hoc render: `{ component, props, label }`

## Component rules

- Files in `.canvas/workflows/` should be thin wrappers that import from `src/lib/components/` and pass props through.
- Real visual components should stay pure: props-in, callbacks-out.
- Do not subscribe to stores, call APIs, or import navigation/runtime helpers inside visual components.

## Key CLI commands

- `component-canvas dev`
- `component-canvas list`
- `component-canvas explore <path>`
- `component-canvas screenshot <workflow>` or `component-canvas screenshot --all`
- `component-canvas render-check [workflow]`
- `component-canvas render <path> --props '{}'`

## Gotchas

- Presentation URLs use query params (`/preview/?presentation=ID`), not hash fragments, because portal embedding strips/re-writes hashes.
- For Tailscale or reverse-proxy access, the preview Vite server must allow non-local hosts with `server.allowedHosts = true`; component-canvas sets this internally.
