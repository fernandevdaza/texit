import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import 'katex/dist/katex.min.css';
import { App } from './App';
import { initThemeSync } from './state/settings';
import { initI18n } from './lib/i18n';
import './lib/i18n-common';
import { installGlobalKeybindings } from './services/commands';
import { activateFeatures } from './features/activate';

initThemeSync();
initI18n();
installGlobalKeybindings();
activateFeatures();

if (import.meta.env.DEV) {
  // Debug handle for the console / automated UI checks.
  void Promise.all([import('./services/projects'), import('./services/commands'), import('./state/workspace'), import('./state/settings')]).then(
    ([projects, commands, workspace, settings]) => {
      (window as any).__texit = { projects, commands, workspace, settings };
    },
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
