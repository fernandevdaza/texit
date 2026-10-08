/**
 * Zen writing mode — hides the side panels and PDF (through the workspace's
 * `view.*` commands) and centers the editor column with a comfortable measure.
 * Pure DOM/CSS: a scoped <style> toggled with a class on <html>.
 */
import { definePlugin, type PluginAPI } from '@texit/plugin-api';

import { createTr, type Catalog } from './i18n';

const CLASS = 'texit-zen';

const MESSAGES: Catalog = {
  en: { status: 'Zen', tooltip: 'Zen mode is on — click to exit' },
  es: { status: 'Zen', tooltip: 'El modo zen está activado: haz clic para salir' },
};

function css(width: number) {
  return `
html.${CLASS} .cm-editor .cm-scroller { padding-top: 4vh; }
html.${CLASS} .cm-editor .cm-content { max-width: ${width}ch; margin-left: auto; margin-right: auto; padding-bottom: 40vh; }
html.${CLASS} .cm-editor .cm-gutters { opacity: 0; transition: opacity .2s; }
html.${CLASS} .cm-editor:hover .cm-gutters { opacity: .5; }
html.${CLASS} .cm-editor .cm-activeLine { background: transparent; }
`;
}

export default definePlugin({
  id: 'org.texit.zen',
  name: 'Zen writing mode',
  version: '1.0.0',
  author: 'TexIt',
  icon: 'focus',
  description: 'Distraction-free writing: hides panels and the PDF and centers the text column. Toggle with ⌘⌥Z / Ctrl+Alt+Z.',
  permissions: ['ui'],
  tags: ['writing', 'focus'],
  locales: {
    es: {
      name: 'Modo de escritura zen',
      description: 'Escritura sin distracciones: oculta los paneles y el PDF y centra la columna de texto. Actívalo con ⌘⌥Z / Ctrl+Alt+Z.',
      commands: { toggle: 'Activar/desactivar el modo de escritura zen' },
      settings: {
        width: { title: 'Ancho de la columna de texto', description: 'En caracteres.' },
        fullscreen: { title: 'Entrar en pantalla completa' },
      },
    },
  },
  settings: [
    { key: 'width', title: 'Text column width', description: 'In characters.', type: 'number', default: 76, min: 40, max: 140, step: 2 },
    { key: 'fullscreen', title: 'Enter full screen', type: 'boolean', default: false },
  ],
  activate(api: PluginAPI) {
    const tr = createTr(api, MESSAGES);
    let active = false;
    const style = document.createElement('style');
    style.dataset.plugin = 'org.texit.zen';
    style.textContent = css(api.settings.get('width', 76));
    document.head.append(style);

    const status = api.ui.registerStatusItem({
      id: 'status',
      align: 'left',
      priority: 100,
      render: () => (active ? { text: tr('status'), icon: 'focus', tooltip: tr('tooltip') } : null),
      onClick: () => void toggle(false),
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active && !document.querySelector('[role="dialog"]')) void toggle(false);
    };

    async function toggle(on = !active) {
      if (on === active) return;
      active = on;
      document.documentElement.classList.toggle(CLASS, on);
      if (on) {
        await api.commands.execute('view.layoutEditor');
        window.addEventListener('keydown', onKey);
        if (api.settings.get('fullscreen', false)) await document.documentElement.requestFullscreen?.().catch(() => {});
        api.editor.focus();
      } else {
        await api.commands.execute('view.layoutSplit');
        window.removeEventListener('keydown', onKey);
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      }
      status.refresh();
    }

    api.ui.onLocaleChange(() => status.refresh());

    api.settings.onDidChange((key, value) => {
      if (key === 'width') style.textContent = css(Number(value) || 76);
    });

    api.commands.register({ id: 'toggle', title: 'Toggle zen writing mode', category: 'View', icon: 'focus', keybinding: 'Mod-Alt-z', when: 'project', run: () => toggle() });

    return {
      dispose() {
        if (active) {
          document.documentElement.classList.remove(CLASS);
          window.removeEventListener('keydown', onKey);
          void api.commands.execute('view.layoutSplit');
        }
        style.remove();
      },
    };
  },
});
