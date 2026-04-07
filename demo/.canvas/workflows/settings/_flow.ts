export default {
  id: 'settings',
  title: 'Settings',
  screens: [
    {
      id: 'settings-main',
      component: './Settings.svelte',
      title: 'Account Settings',
      props: {
        username: 'Sam Chung',
        email: 'sam@example.com',
        notifications: true,
        marketing: false,
        twoFactor: true
      }
    }
  ],
  transitions: [],
  variants: [
    {
      id: 'settings-all-off',
      screenId: 'settings-main',
      title: 'All notifications off',
      props: { notifications: false, marketing: false, twoFactor: false }
    }
  ]
};
