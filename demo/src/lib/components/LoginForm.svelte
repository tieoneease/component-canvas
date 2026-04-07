<svelte:options runes={true} />

<script>
  import { Button, Label, Separator } from 'bits-ui';

  let {
    title = 'Sign in to your account',
    submitLabel = 'Sign in',
    error = '',
    showForgotPassword = true
  } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-background p-4">
  <div class="w-full max-w-sm space-y-6">
    <div class="space-y-2 text-center">
      <div class="mx-auto flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">
        C
      </div>
      <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
      <p class="text-sm text-muted-foreground">Enter your email below to sign in</p>
    </div>

    {#if error}
      <div class="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    {/if}

    <form class="space-y-4" onsubmit={(e) => e.preventDefault()}>
      <div class="space-y-2">
        <Label.Root class="text-sm font-medium leading-none">Email</Label.Root>
        <input
          type="email"
          placeholder="name@example.com"
          class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label.Root class="text-sm font-medium leading-none">Password</Label.Root>
          {#if showForgotPassword}
            <button type="button" class="text-xs text-muted-foreground underline-offset-4 hover:underline">
              Forgot password?
            </button>
          {/if}
        </div>
        <input
          type="password"
          placeholder="••••••••"
          class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <Button.Root
        type="submit"
        class="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {submitLabel}
      </Button.Root>
    </form>

    <div class="relative">
      <div class="absolute inset-0 flex items-center">
        <Separator.Root class="h-px w-full bg-border" />
      </div>
      <div class="relative flex justify-center text-xs uppercase">
        <span class="bg-background px-2 text-muted-foreground">Or continue with</span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <Button.Root
        class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <svg class="size-4" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z"/></svg>
        GitHub
      </Button.Root>
      <Button.Root
        class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <svg class="size-4" viewBox="0 0 24 24"><path fill="currentColor" d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 1 1 0-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0 0 12.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"/></svg>
        Google
      </Button.Root>
    </div>

    <p class="text-center text-xs text-muted-foreground">
      Don't have an account? <button type="button" class="underline underline-offset-4 hover:text-foreground">Sign up</button>
    </p>
  </div>
</div>
