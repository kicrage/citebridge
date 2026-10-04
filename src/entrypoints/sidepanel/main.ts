import { createApp } from 'vue';
import '@/ui/base.css';
import { initSettings } from '@/ui/store';
import App from './App.vue';

initSettings().finally(() => createApp(App).mount('#app'));
