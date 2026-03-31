import { mount } from 'svelte';

import 'virtual:canvas-global-css';
import App from './App.svelte';

mount(App, {
  target: document.getElementById('app')
});
