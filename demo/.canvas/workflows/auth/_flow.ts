export default {
  id: 'auth',
  title: 'Authentication',
  screens: [
    {
      id: 'login',
      component: './LoginForm.svelte',
      title: 'Login',
      props: { submitLabel: 'Sign in', showForgotPassword: true }
    },
    {
      id: 'dashboard',
      component: './Dashboard.svelte',
      title: 'Dashboard',
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
    },
    {
      id: 'login-sso',
      screenId: 'login',
      title: 'SSO only',
      props: { submitLabel: 'Continue with SSO', showForgotPassword: false }
    }
  ]
};
