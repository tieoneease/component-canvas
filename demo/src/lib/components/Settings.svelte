<svelte:options runes={true} />

<script>
  import { Label, Separator, Switch } from 'bits-ui';

  let {
    username = 'Sam Chung',
    email = 'sam@example.com',
    notifications = true,
    marketing = false,
    twoFactor = true
  } = $props();

  let notificationsEnabled = $state(notifications);
  let marketingEnabled = $state(marketing);
  let twoFactorEnabled = $state(twoFactor);
</script>

<div class="min-h-screen bg-background">
  <header class="border-b border-border">
    <div class="mx-auto flex h-14 max-w-2xl items-center px-6">
      <span class="text-sm font-bold">Settings</span>
    </div>
  </header>

  <main class="mx-auto max-w-2xl space-y-8 px-6 py-8">
    <!-- Profile section -->
    <section class="space-y-4">
      <div>
        <h2 class="text-lg font-semibold">Profile</h2>
        <p class="text-sm text-muted-foreground">Manage your account details.</p>
      </div>

      <div class="rounded-xl border border-border bg-card p-5 space-y-4">
        <div class="flex items-center gap-4">
          <div class="flex size-12 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
            {username.charAt(0).toUpperCase()}
          </div>
          <div>
            <p class="font-medium">{username}</p>
            <p class="text-sm text-muted-foreground">{email}</p>
          </div>
        </div>

        <Separator.Root class="h-px bg-border" />

        <div class="grid gap-4">
          <div class="space-y-2">
            <Label.Root class="text-sm font-medium">Display name</Label.Root>
            <input
              type="text"
              value={username}
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div class="space-y-2">
            <Label.Root class="text-sm font-medium">Email</Label.Root>
            <input
              type="email"
              value={email}
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- Notifications -->
    <section class="space-y-4">
      <div>
        <h2 class="text-lg font-semibold">Notifications</h2>
        <p class="text-sm text-muted-foreground">Choose what you want to be notified about.</p>
      </div>

      <div class="rounded-xl border border-border bg-card divide-y divide-border">
        <div class="flex items-center justify-between p-5">
          <div class="space-y-0.5">
            <Label.Root class="text-sm font-medium">Push notifications</Label.Root>
            <p class="text-xs text-muted-foreground">Receive push notifications for important updates.</p>
          </div>
          <Switch.Root
            checked={notificationsEnabled}
            onCheckedChange={(v) => { notificationsEnabled = v; }}
            class="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition {notificationsEnabled ? 'bg-primary' : 'bg-input'}"
          >
            <Switch.Thumb class="pointer-events-none block size-5 rounded-full bg-background shadow-sm ring-0 transition {notificationsEnabled ? 'translate-x-5' : 'translate-x-0'}" />
          </Switch.Root>
        </div>

        <div class="flex items-center justify-between p-5">
          <div class="space-y-0.5">
            <Label.Root class="text-sm font-medium">Marketing emails</Label.Root>
            <p class="text-xs text-muted-foreground">Receive emails about new features and updates.</p>
          </div>
          <Switch.Root
            checked={marketingEnabled}
            onCheckedChange={(v) => { marketingEnabled = v; }}
            class="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition {marketingEnabled ? 'bg-primary' : 'bg-input'}"
          >
            <Switch.Thumb class="pointer-events-none block size-5 rounded-full bg-background shadow-sm ring-0 transition {marketingEnabled ? 'translate-x-5' : 'translate-x-0'}" />
          </Switch.Root>
        </div>
      </div>
    </section>

    <!-- Security -->
    <section class="space-y-4">
      <div>
        <h2 class="text-lg font-semibold">Security</h2>
        <p class="text-sm text-muted-foreground">Keep your account safe.</p>
      </div>

      <div class="rounded-xl border border-border bg-card">
        <div class="flex items-center justify-between p-5">
          <div class="space-y-0.5">
            <Label.Root class="text-sm font-medium">Two-factor authentication</Label.Root>
            <p class="text-xs text-muted-foreground">Add an extra layer of security to your account.</p>
          </div>
          <Switch.Root
            checked={twoFactorEnabled}
            onCheckedChange={(v) => { twoFactorEnabled = v; }}
            class="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition {twoFactorEnabled ? 'bg-primary' : 'bg-input'}"
          >
            <Switch.Thumb class="pointer-events-none block size-5 rounded-full bg-background shadow-sm ring-0 transition {twoFactorEnabled ? 'translate-x-5' : 'translate-x-0'}" />
          </Switch.Root>
        </div>
      </div>
    </section>
  </main>
</div>
