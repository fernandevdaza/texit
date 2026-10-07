// TODO list — collects TODO / FIXME / XXX comments and \todo{...} notes from
// every .tex file into a sidebar panel; click an item to jump to it.

const { definePlugin } = window.TexIt;

const RE = /%\s*(TODO|FIXME|XXX|NOTE)\b[:\s]*(.*)$|\\(todo|missingfigure)(?:\[[^\]]*\])?\{([^}]*)\}/gi;

export function findTodos(path, text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(RE)) {
      out.push({ path, line: i + 1, kind: (m[1] || m[3]).toUpperCase(), text: (m[2] ?? m[4] ?? '').trim() || '(no description)' });
    }
  });
  return out;
}

const COLORS = { TODO: 'var(--tx-accent)', FIXME: 'var(--tx-danger)', XXX: 'var(--tx-warning)', NOTE: 'var(--tx-info)', MISSINGFIGURE: 'var(--tx-warning)' };

export default definePlugin({
  id: 'org.texit.examples.todos',
  name: 'TODO list',
  version: '1.0.0',
  author: 'TexIt examples',
  icon: 'list-todo',
  description: 'Lists % TODO / FIXME comments and \\todo{} notes across the project in a sidebar panel.',
  apiVersion: '1.1.0',
  permissions: ['project:read', 'ui'],
  tags: ['review', 'example'],

  activate(api) {
    let count = 0;
    const status = api.ui.registerStatusItem({
      id: 'count',
      align: 'left',
      render: () => (count ? { text: `☑ ${count} TODO${count === 1 ? '' : 's'}`, tooltip: 'Show the TODO list' } : null),
      onClick: () => api.ui.showPanel('panel'),
    });

    const scan = async () => {
      const files = api.project.listFiles().filter((f) => f.isText && /\.(tex|sty|cls|bib)$/i.test(f.path));
      const all = [];
      for (const f of files) {
        const text = await api.project.readFile(f.path);
        if (typeof text === 'string') all.push(...findTodos(f.path, text));
      }
      count = all.length;
      status.refresh();
      return all;
    };
    void scan();
    api.project.onDidChangeFiles(() => void scan());

    api.ui.registerPanel({
      id: 'panel',
      title: 'TODOs',
      icon: 'list-todo',
      location: 'sidebar',
      render(el) {
        el.style.cssText = 'padding:8px 10px;font-size:12.5px;color:var(--tx-fg)';
        const draw = async () => {
          const items = await scan();
          el.replaceChildren();
          const h = document.createElement('div');
          h.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx-fg-subtle);margin:4px 2px 8px';
          h.textContent = `TODOs (${items.length})`;
          el.append(h);
          if (!items.length) {
            const p = document.createElement('p');
            p.style.cssText = 'color:var(--tx-fg-subtle);padding:24px 0;text-align:center';
            p.textContent = 'Nothing left to do 🎉';
            el.append(p);
          }
          for (const t of items) {
            const b = document.createElement('button');
            b.style.cssText = 'all:unset;display:block;width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;cursor:pointer';
            b.onmouseenter = () => (b.style.background = 'var(--tx-hover)');
            b.onmouseleave = () => (b.style.background = '');
            b.onclick = () => api.editor.open(t.path, t.line);
            const tag = document.createElement('span');
            tag.textContent = t.kind;
            tag.style.cssText = `font-size:10px;font-weight:700;color:${COLORS[t.kind] ?? 'var(--tx-accent)'};margin-right:6px`;
            const txt = document.createElement('span');
            txt.textContent = t.text;
            const loc = document.createElement('div');
            loc.textContent = `${t.path}:${t.line}`;
            loc.style.cssText = 'font-family:var(--font-mono);font-size:10.5px;color:var(--tx-fg-subtle);margin-top:1px';
            b.append(tag, txt, loc);
            el.append(b);
          }
        };
        void draw();
        const sub = api.project.onDidChangeFiles(() => void draw());
        return () => sub.dispose();
      },
    });
  },
});
