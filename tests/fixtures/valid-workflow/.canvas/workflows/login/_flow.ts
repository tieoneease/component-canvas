export default {
  id: 'login',
  title: 'Login Flow',
  screens: [
    {
      id: 'login-form',
      component: './LoginForm.svelte',
      title: 'Login Form',
      props: {
        submitLabel: 'Sign in'
      }
    },
    {
      id: 'loading',
      component: './Loading.svelte',
      title: 'Loading'
    },
    {
      id: 'dashboard',
      component: './Dashboard.svelte',
      title: 'Dashboard',
      props: {
        username: 'Ada'
      }
    }
  ],
  transitions: [
    {
      from: 'login-form',
      to: 'loading',
      trigger: 'Submit'
    },
    {
      from: 'loading',
      to: 'dashboard',
      trigger: 'Success'
    }
  ],
  variants: [
    {
      id: 'login-error',
      screenId: 'login-form',
      title: 'Error State',
      props: {
        error: 'Invalid credentials'
      }
    }
  ]
};
