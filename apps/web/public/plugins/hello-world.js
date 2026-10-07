// Hello world — the smallest useful TexIt plugin.
// Plain ES module, no bundler: uses the global `window.TexIt.definePlugin`.
// Install it from TexIt: Plugins → + → Install from URL… → http://localhost:5173/plugins/hello-world.js

const { definePlugin } = window.TexIt;

export default definePlugin({
  id: 'org.texit.examples.hello',
  name: 'Hello world',
  version: '1.0.0',
  author: 'TexIt examples',
  icon: 'hand',
  description: 'Example plugin: a command, a status-bar item, a sidebar panel and a setting.',
  apiVersion: '1.1.0',
  permissions: ['project:read', 'editor', 'ui'],
  tags: ['example'],
  settings: [{ key: 'greeting', title: 'Greeting', type: 'string', default: 'Hello' }],

  activate(api) {
    // 1. A command (appears in the command palette as "Hello world: Say hello").
    api.commands.register({
      id: 'sayHello',
      title: 'Say hello',
      run: async () => {
        const name = await api.ui.prompt({ title: 'What is your name?', placeholder: 'Ada' });
        if (!name) return;
        api.ui.toast(`${api.settings.get('greeting', 'Hello')}, ${name}!`, { type: 'success' });
        if (api.editor.getActivePath()) api.editor.insertText(`% ${api.settings.get('greeting', 'Hello')}, ${name}!\n`);
      },
    });

    // 2. A status-bar item that re-renders on editor/project changes.
    api.ui.registerStatusItem({
      id: 'files',
      align: 'left',
      render: () => {
        const n = api.project.listFiles().length;
        return n ? { text: `👋 ${n} files`, tooltip: `${api.project.getName()} — click to say hello` } : null;
      },
      onClick: () => api.commands.execute('sayHello'),
    });

    // 3. A sidebar panel rendered with plain DOM. Use the --tx-* CSS variables to match the theme.
    api.ui.registerPanel({
      id: 'panel',
      title: 'Hello',
      icon: 'hand',
      location: 'sidebar',
      render(container) {
        container.style.cssText = 'padding:12px;font-size:12.5px;color:var(--tx-fg);line-height:1.6';
        const update = () => {
          const files = api.project.listFiles();
          container.innerHTML = '';
          const h = document.createElement('div');
          h.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px';
          h.textContent = api.project.getName() || 'No project open';
          const p = document.createElement('div');
          p.style.color = 'var(--tx-fg-muted)';
          p.textContent = `${files.length} files · main: ${api.project.getMainPath() ?? '—'}`;
          const list = document.createElement('ul');
          list.style.cssText = 'margin:10px 0 0;padding:0;list-style:none';
          for (const f of files.slice(0, 50)) {
            const li = document.createElement('li');
            const a = document.createElement('button');
            a.textContent = f.path;
            a.style.cssText = 'all:unset;cursor:pointer;color:var(--tx-accent);font-family:var(--font-mono);font-size:11.5px';
            a.onclick = () => api.editor.open(f.path);
            li.append(a);
            list.append(li);
          }
          container.append(h, p, list);
        };
        update();
        const sub = api.project.onDidChangeFiles(update);
        return () => sub.dispose(); // cleanup when the panel is hidden or the plugin disabled
      },
    });
  },
});
