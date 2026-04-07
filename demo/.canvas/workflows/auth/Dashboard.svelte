<script>
  import Dashboard from '../../../src/lib/components/Dashboard.svelte';
  let { username = 'Sam', plan = 'Pro' } = $props();
</script>
<Dashboard {username} {plan} />
