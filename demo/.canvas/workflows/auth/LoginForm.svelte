<script>
  import LoginForm from '../../../src/lib/components/LoginForm.svelte';
  let { error = '', submitLabel = 'Sign in', showForgotPassword = true } = $props();
</script>
<LoginForm {error} {submitLabel} {showForgotPassword} />
