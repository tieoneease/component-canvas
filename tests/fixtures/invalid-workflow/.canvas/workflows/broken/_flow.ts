export default {
  id: 'broken',
  title: 'Broken Workflow',
  screens: [
    {
      id: 'start',
      component: './MissingComponent.svelte',
      title: 'Start'
    }
  ],
  transitions: [
    {
      from: 'start',
      to: 'missing-screen',
      trigger: 'Break it'
    }
  ]
};
