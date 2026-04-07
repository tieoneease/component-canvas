<script>
  import Settings from '../../../src/lib/components/Settings.svelte';
  let { username = 'Sam Chung', email = 'sam@example.com', notifications = true, marketing = false, twoFactor = true } = $props();
</script>
<Settings {username} {email} {notifications} {marketing} {twoFactor} />
