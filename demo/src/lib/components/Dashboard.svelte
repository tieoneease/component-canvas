<svelte:options runes={true} />

<script>
  import { Button, Separator } from 'bits-ui';

  let {
    username = 'Sam',
    plan = 'Pro',
    stats = { projects: 12, deployments: 48, uptime: '99.9%' }
  } = $props();

  const menuItems = [
    { label: 'Dashboard', active: true },
    { label: 'Projects', active: false },
    { label: 'Team', active: false },
    { label: 'Settings', active: false }
  ];

  const recentActivity = [
    { action: 'Deployed', target: 'api-service', time: '2 min ago', status: 'success' },
    { action: 'Merged', target: 'feature/auth', time: '1 hour ago', status: 'success' },
    { action: 'Failed', target: 'staging-build', time: '3 hours ago', status: 'error' },
    { action: 'Created', target: 'new-project', time: '1 day ago', status: 'info' }
  ];
</script>

<div class="min-h-screen bg-background">
  <!-- Top nav -->
  <header class="border-b border-border">
    <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
      <div class="flex items-center gap-6">
        <span class="text-sm font-bold">Canvas</span>
        <nav class="flex items-center gap-1">
          {#each menuItems as item}
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm transition {item.active
                ? 'bg-secondary text-secondary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'}"
            >
              {item.label}
            </button>
          {/each}
        </nav>
      </div>
      <div class="flex items-center gap-3">
        <span class="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">{plan}</span>
        <div class="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
          {username.charAt(0).toUpperCase()}
        </div>
      </div>
    </div>
  </header>

  <!-- Main content -->
  <main class="mx-auto max-w-5xl space-y-6 px-6 py-8">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Welcome back, {username}</h1>
      <p class="mt-1 text-sm text-muted-foreground">Here's an overview of your workspace.</p>
    </div>

    <!-- Stat cards -->
    <div class="grid grid-cols-3 gap-4">
      <div class="rounded-xl border border-border bg-card p-5">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Projects</p>
        <p class="mt-2 text-3xl font-semibold">{stats.projects}</p>
        <p class="mt-1 text-xs text-emerald-600">+3 this month</p>
      </div>
      <div class="rounded-xl border border-border bg-card p-5">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Deployments</p>
        <p class="mt-2 text-3xl font-semibold">{stats.deployments}</p>
        <p class="mt-1 text-xs text-emerald-600">+12 this week</p>
      </div>
      <div class="rounded-xl border border-border bg-card p-5">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Uptime</p>
        <p class="mt-2 text-3xl font-semibold">{stats.uptime}</p>
        <p class="mt-1 text-xs text-muted-foreground">Last 30 days</p>
      </div>
    </div>

    <!-- Activity -->
    <div class="rounded-xl border border-border bg-card">
      <div class="flex items-center justify-between p-5 pb-0">
        <h2 class="text-sm font-semibold">Recent activity</h2>
        <Button.Root class="text-xs text-muted-foreground underline-offset-4 hover:underline">View all</Button.Root>
      </div>
      <div class="p-5 pt-4">
        <div class="space-y-3">
          {#each recentActivity as entry, i}
            {#if i > 0}
              <Separator.Root class="h-px bg-border" />
            {/if}
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <div class="flex size-8 items-center justify-center rounded-lg {entry.status === 'success'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : entry.status === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted text-muted-foreground'}">
                  <span class="text-xs font-bold">{entry.action.charAt(0)}</span>
                </div>
                <div>
                  <p class="text-sm font-medium">{entry.action} <span class="font-mono text-muted-foreground">{entry.target}</span></p>
                </div>
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">{entry.time}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </main>
</div>
