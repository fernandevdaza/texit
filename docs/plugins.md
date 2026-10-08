# Writing TexIt plugins

TexIt plugins are plain **ES modules** that run inside the app and talk to it through the
[`PluginAPI`](../packages/plugin-api/src/index.ts) (package `@texit/plugin-api`, MIT-licensed so
plugins can use any license). A plugin can add commands, sidebar/bottom panels, status-bar items,
editor snippets and completions, compile backends and hooks, AI tools, project templates and its
own settings.

- **Built-in plugins** live in `apps/web/src/plugins/builtin/` (word count, symbol palette, table
  generator, BibTeX tools, snippets, lorem ipsum & date, zen mode). They only use the public API,
  so they double as reference examples.
- **Example third-party plugins** (plain JS, no build step) live in `apps/web/public/plugins/`
  and are listed in `apps/web/public/plugins/registry.json`.

## A minimal plugin

```js
// hello.js — no bundler needed: TexIt exposes window.TexIt = { definePlugin, apiVersion }
const { definePlugin } = window.TexIt;

export default definePlugin({
  id: 'com.example.hello',          // reverse-DNS, unique
  name: 'Hello',
  version: '1.0.0',
  apiVersion: '1.1.0',              // minimum plugin API version you need
  icon: 'hand',                     // lucide icon name, or an inline <svg> string
  description: 'Says hello.',
  permissions: ['editor'],          // shown to the user on install (see below)
  activate(api) {
    api.commands.register({
      id: 'say',                    // registered as "com.example.hello.say"
      title: 'Say hello',
      keybinding: 'Mod-Alt-h',
      run: () => api.editor.insertText('Hello, world!'),
    });
  },
});
```

With TypeScript and a bundler, `import { definePlugin } from '@texit/plugin-api'` instead and
bundle to a single ES module (keep `@texit/plugin-api` out of the bundle or inline it — it has no
runtime code besides `definePlugin`).

The module's default export (or a named export `plugin`) is the plugin object. **Do no work at
module top level** — the module is imported before the user approves its permissions; do
everything in `activate`.

## Lifecycle

| Event | What happens |
| --- | --- |
| Install (URL, file, registry) | Module is imported → manifest validated → permission prompt → stored in IndexedDB → `activate(api)` |
| App start | Enabled plugins are activated after the app's own features |
| Disable / uninstall / reload | `deactivate()` (if any) → **every registration made through `api` is disposed** automatically |
| Errors | Exceptions from your callbacks are caught, shown as a toast and as an “errored” badge on the plugin card; the app keeps running |

`activate` may return a `Disposable` (`{ dispose() }`) for cleanup of things the host does not
know about (DOM you injected into `document.head`, global listeners…). `activate` must finish
within 15 s.

Every contribution id is namespaced: `commands.register({ id: 'say' })` becomes
`com.example.hello.say`. `api.commands.execute('say')` resolves your own short ids; any other id
(e.g. built-in `view.toggleSidebar`, `history.saveVersion`) is executed as is.

## Permissions

| Permission | Grants | Enforced |
| --- | --- | --- |
| `project:read` | `project.listFiles/readFile/onDidChangeFiles` | yes |
| `project:write` | `project.writeFile/deleteFile` (implies read) | yes |
| `editor` | `editor.getSelection/insertText/replaceSelection/wrapSelection/onDidChangeSelection` | yes |
| `compiler` | everything under `api.compiler` | yes |
| `ai` | everything under `api.ai` | yes |
| `ui`, `network`, `storage` | declarative — shown to the user | no |

Calling an enforced API without the permission throws `PluginPermissionError`. Permissions are a
**consent mechanism, not a sandbox**: plugins run in the page and can do anything a script can.
Users are warned to only install plugins they trust. When an update asks for new permissions the
user is prompted again. Built-in plugins are trusted.

## Testing your plugin locally

1. Serve your plugin directory with any static server that sends CORS headers and a JavaScript
   MIME type, e.g.
   ```sh
   npx http-server ./my-plugin -p 8080 --cors -c-1
   ```
   (or drop the file into `apps/web/public/plugins/` while running `pnpm dev`: it is then served
   at `http://localhost:5173/plugins/<file>.js`).
2. In TexIt: **Plugins** sidebar → **+** → **Install from URL…** → `http://localhost:8080/hello.js`.
3. Turn on **Developer mode** (Plugins **+** menu, or Settings → Plugins). TexIt then re-fetches
   URL plugins whenever the window regains focus and **reloads the ones whose source changed** —
   edit, switch back to TexIt, done. You can also reload manually (card **⋯** → Reload, or the
   command “Reload a plugin…”).
4. Errors appear as toasts and on the plugin card; the full stack is in the browser console
   (`[plugin <id>] …`).

You can also install a single `.js` file with **Install from file…** (stored in IndexedDB and
imported through a Blob URL, so it cannot use relative imports — bundle it into one file).

During development `window.__texit.plugins` exposes the plugin manager (install, enable, reload…).

## Publishing

Host the module anywhere that serves ES modules with CORS: GitHub Pages, a CDN such as
`https://esm.sh` / `https://cdn.jsdelivr.net/gh/<user>/<repo>@<tag>/plugin.js`, or your own site.
Use versioned URLs so updates are explicit.

To be listed in the **Browse** tab, add an entry to a registry file (the default is
`/plugins/registry.json`; users can point TexIt at another registry in Settings → Plugins):

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "com.example.hello",
      "name": "Hello",
      "description": "Says hello.",
      "author": "Jane Doe",
      "version": "1.0.0",
      "url": "https://cdn.jsdelivr.net/gh/jane/texit-hello@1.0.0/hello.js",
      "icon": "hand",
      "tags": ["example"],
      "homepage": "https://github.com/jane/texit-hello",
      "permissions": ["editor"]
    }
  ]
}
```

`url` may be relative to the registry file. The id and version must match the module's manifest;
when the registry version is newer than the installed one the card offers **Update**.

## API reference

All registration methods return a `Disposable`; you rarely need it — everything is disposed when
the plugin is disabled.

### Manifest

```ts
interface PluginManifest {
  id: string; name: string; version: string;
  description?: string; author?: string; homepage?: string;
  icon?: string;                 // lucide name ('sigma', 'book-open') or '<svg …>'
  apiVersion?: string;           // e.g. '1.1.0' — major must match, minor ≤ host
  permissions?: PluginPermission[];
  tags?: string[];
  settings?: PluginSettingDef[]; // rendered as a form in the plugin's Settings dialog
  locales?: Record<string, PluginManifestLocalization>; // translations, see "Localization" (1.2.0)
}
interface PluginSettingDef {
  key: string; title: string; description?: string;
  type: 'boolean' | 'string' | 'text' | 'number' | 'select';
  default?: unknown; options?: { value: string; label: string }[];
  placeholder?: string; min?: number; max?: number; step?: number;
}
```

### `api.commands`

```js
api.commands.register({ id, title, category?, icon?, keybinding?, when?: 'always' | 'editor' | 'project', run(...args) });
await api.commands.execute('view.toggleSidebar');
```

Commands appear in the command palette; `keybinding` uses CodeMirror notation (`Mod-Shift-k`).

### `api.ui`

```js
// Panels render into a plain DOM element; return a cleanup function.
api.ui.registerPanel({
  id: 'panel', title: 'My panel', icon: 'list', location: 'sidebar', // or 'bottom' ('right' is shown in the sidebar for now)
  render(container, ctx) {
    container.textContent = `Theme: ${ctx.theme}`;
    const sub = ctx.onThemeChange((t) => (container.textContent = `Theme: ${t}`));
    return () => sub.dispose();
  },
});
api.ui.showPanel('panel');

// Status-bar items re-render on editor/project changes; call refresh() after async work.
const item = api.ui.registerStatusItem({ id: 'count', align: 'right', priority: 10,
  render: () => ({ text: `${n} things`, tooltip: 'Click me', icon: 'list' }), onClick() {} });
item.refresh();

api.ui.toast('Saved', { type: 'success', description: 'details' });
const value = await api.ui.quickPick([{ label: 'A', description: 'first', value: 1 }], { placeholder: 'Pick one' });
const text = await api.ui.prompt({ title: 'Name?', placeholder: 'Ada', value: '' });
const ok = await api.ui.confirm({ title: 'Delete?', message: 'Sure?', danger: true });
await api.ui.modal({ title: 'Report', width: 720, render(container, close) { /* DOM */ return () => {}; } });
api.ui.getTheme(); api.ui.onThemeChange((theme) => {});
api.ui.getLocale(); api.ui.onLocaleChange((locale) => {});   // 1.2.0, see "Localization"
```

Style DOM with the app's CSS variables so it follows light/dark themes: `var(--tx-fg)`,
`--tx-fg-muted`, `--tx-fg-subtle`, `--tx-bg`, `--tx-surface`, `--tx-surface-2`, `--tx-border`,
`--tx-hover`, `--tx-accent`, `--tx-accent-soft`, `--tx-danger(-soft)`, `--tx-success(-soft)`,
`--tx-warning(-soft)`, `--tx-info(-soft)`, `--font-sans`, `--font-mono`.

### `api.editor`

```js
api.editor.getActivePath();                 // 'chapters/intro.tex' | null
api.editor.getSelection();                  // { path, from, to, text, line } | null
api.editor.insertText('\\alpha');
api.editor.replaceSelection('new text');
api.editor.wrapSelection('\\textbf{', '}');
api.editor.focus();
api.editor.open('refs.bib', 12);            // open a file, optionally at a line
api.editor.onDidChangeActiveFile((path) => {});
api.editor.onDidChangeSelection((sel) => {});

// Snippets (CodeMirror syntax: ${1:placeholder}, ${} = final cursor). Write \\{ for a literal "\{".
api.editor.registerSnippets([{ label: 'fig', detail: 'figure', template: '\\begin{figure}\n\t${1}\n\\end{figure}', languages: ['tex'] }]);

// Completion sources: `trigger` is matched against the line text before the cursor
// (anchored at the cursor); the last capture group is the text being completed.
api.editor.registerCompletionSource({
  id: 'glossary',
  trigger: /\\gls\{([^}]*)$/,
  provide: ({ match }) => [{ label: 'api', detail: 'Application programming interface', type: 'reference' }],
});
```

Your completions are merged with TexIt's own (they are contributed through CodeMirror's
`EditorState.languageData`).

### `api.project`

Paths are project-relative POSIX paths (`chapters/intro.tex`).

```js
api.project.getName(); api.project.getMainPath();
api.project.listFiles();                         // [{ path, isText, size }]
await api.project.readFile('main.tex');          // string | Uint8Array | null
await api.project.writeFile('out/data.csv', 'a,b\n1,2\n'); // creates folders/files; minimal diff for text
await api.project.deleteFile('old.tex');
api.project.onDidChangeFiles(() => {});          // debounced; also fires when another project opens
```

Writes go through the project's Yjs document, so collaborators see them live.

### `api.compiler`

```js
const result = await api.compiler.compile();     // CompileResult | null
api.compiler.getLastResult();
api.compiler.onWillCompile((files) => [...files, { path: 'generated.tex', content: '…' }]); // may return a new file list
api.compiler.onDidCompile((result) => console.log(result.status, result.diagnostics));
api.compiler.registerBackend({ id: 'my-cloud', label: 'My cloud', kind: 'plugin', engines: ['pdflatex'],
  async status() { return { available: true }; }, async compile(req) { /* … */ } });
```

Class instances work as backends (methods are forwarded, including optional `prepareFor`,
`onStatusChange` and `dispose`).

### `api.ai`

```js
const answer = await api.ai.complete('Summarize: …', { system: 'Be brief.' }); // throws if no model is configured
api.ai.registerTool({ name: 'count_figures', description: 'Counts figures', inputSchema: { type: 'object', properties: {} },
  async execute() { return { figures: 3 }; } });
```

### `api.templates`

```js
api.templates.register({ id: 'lab-report', name: 'Lab report', description: '…', category: 'academic',
  engine: 'pdflatex', main: 'main.tex', files: [{ path: 'main.tex', content: '…' }] });
```

### `api.settings` and `api.storage`

```js
api.settings.get('wpm', 230);                    // falls back to the manifest default, then to the argument
api.settings.set('wpm', 250);
api.settings.onDidChange((key, value) => {});
await api.storage.set('recent', ['\\alpha']);    // per-plugin IndexedDB key/value
await api.storage.get('recent'); await api.storage.delete('recent');
```

Settings and storage are removed when the plugin is uninstalled.

### `api.latex`

Pure helpers shared with the app (no permission needed):

```js
api.latex.countWords(source);   // { words, characters, mathInline, mathDisplay }
api.latex.analyze(source);      // outline, labels, refs, citations, includes, packages…
api.latex.parseBibtex(source);  // [{ key, type, fields, line }]
api.latex.symbols();            // [{ command, glyph, category, package?, name? }]
```

## Localization

TexIt's UI is available in English and Spanish (Settings → language). English is always the
fallback. Plugins (API ≥ 1.2.0) localize in two complementary ways:

**1. Manifest strings — declarative.** Add a `locales` map keyed by BCP-47 tag (`es`, `pt-BR`…;
an exact tag wins, then the base language). The host uses it for the plugin list, the details
dialog, the install prompt, the settings form, the command palette and panel tabs — even while
the plugin is disabled, and it switches live when the user changes the language.

```ts
export default definePlugin({
  id: 'com.example.wordgoal',
  name: 'Word goal',
  description: 'Track a word-count goal.',
  settings: [{ key: 'goal', title: 'Goal', type: 'number', default: 1000 }],
  locales: {
    es: {
      name: 'Meta de palabras',
      description: 'Sigue una meta de número de palabras.',
      commands: { show: 'Mostrar meta de palabras' },   // by command id (without the plugin prefix)
      panels: { panel: 'Meta de palabras' },           // by panel id
      settings: { goal: { title: 'Meta', description: '…', placeholder: '…', options: { value: 'label' } } },
    },
  },
  activate(api) { /* … */ },
});
```

```ts
interface PluginManifestLocalization {
  name?: string; description?: string;
  commands?: Record<string, string>;
  panels?: Record<string, string>;
  settings?: Record<string, { title?: string; description?: string; placeholder?: string; options?: Record<string, string> }>;
}
```

**2. Strings your plugin renders — at runtime.** Read `api.ui.getLocale()` (e.g. `'en'`, `'es'`)
when rendering and re-render on `api.ui.onLocaleChange(cb)`: call `refresh()` on status items,
re-render panels, re-register snippets whose descriptions are translated. Keep the
`activate()`-time `title` of commands/panels in English — the host shows the `locales` version.

```js
const MESSAGES = { en: { words: '{n} words' }, es: { words: '{n} palabras' } };
const tr = (key, vars = {}) => {
  const l = api.ui.getLocale();
  const table = MESSAGES[l] ?? MESSAGES[l.split('-')[0]] ?? MESSAGES.en;
  return (table[key] ?? MESSAGES.en[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
};
const item = api.ui.registerStatusItem({ id: 'status', render: () => ({ text: tr('words', { n: 42 }) }) });
api.ui.onLocaleChange(() => item.refresh());
```

The built-in plugins (`apps/web/src/plugins/builtin/`) follow exactly this pattern: each has its own
`{ en, es }` message map plus a `locales` manifest entry, and share a tiny helper
(`plugins/builtin/i18n.ts`: `createTr(api, messages)` and the React hook `useTr(api, messages)`,
with `{name}` interpolation and `key_one`/`key_other` plurals via `Intl.PluralRules`). Don't
translate LaTeX, code or brand names. When targeting older hosts, guard with
`typeof api.ui.getLocale === 'function'`.

## Versioning

`PLUGIN_API_VERSION` follows semver. Additive changes bump the minor version (1.1.0 added
`api.latex`, `ui.showPanel/getTheme/onThemeChange`, `editor.wrapSelection/focus`,
`settings.onDidChange`, status-item `refresh()`, manifest `settings`/`tags`; 1.2.0 added
`ui.getLocale/onLocaleChange` and manifest `locales`). A plugin declaring
`apiVersion: '1.0.0'` keeps working on 1.x hosts.
