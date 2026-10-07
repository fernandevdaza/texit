# TexIt architecture

## Principles

1. **Local-first.** The device is the source of truth. A project is a single [Yjs](https://yjs.dev) document persisted in IndexedDB (`y-indexeddb`). No account, no server required.
2. **Collaboration is a transport, not a backend.** Because the project *is* a CRDT, sharing only means connecting peers: Yjs updates travel over WebRTC (Trystero signaling through public Nostr relays / BitTorrent trackers / MQTT), encrypted end-to-end with a key that only lives in the invite link.
3. **Same app everywhere.** The React SPA in `apps/web` is the web app *and* the desktop renderer. Desktop-only capabilities come from a typed bridge (`window.texit`, contract in `packages/core/src/host.ts`) implemented by the Electron preload.
4. **Everything is a contribution.** Commands, panels, status-bar items, editor extensions, compile backends, AI tools and templates are registered through small registries — the same ones plugins use.

## Project model (`packages/core/src/project.ts`)

```
Y.Doc
├── meta     Y.Map   name, mainFileId, engine, bibTool, compilerBackend, tags, language…
├── nodes    Y.Map<id, Y.Map>   { id, name, parentId ('' = root), kind: file|folder, createdAt, updatedAt }
├── texts    Y.Map<id, Y.Text>  content of text files (.tex, .bib, .sty, …)
├── blobs    Y.Map<id, Uint8Array>  content of binary files (images, PDFs, fonts)
├── comments Y.Map<id, Y.Map>   review threads anchored with Y.RelativePosition
└── chat     Y.Array            project chat messages
```

Nodes are addressed by id so concurrent renames/moves merge cleanly; paths are computed. `ProjectDoc` wraps the doc with a file-system-like API (`createFile`, `rename`, `move`, `delete`, `snapshot`, `importFiles`, `detectMainFile`, …). Whole-file writes go through `applyTextDiff` (common prefix/suffix) so they never clobber concurrent edits.

## Compilation (`packages/compiler`)

`CompileService` picks a `CompileBackend`:

| Backend | Where | Notes |
|---|---|---|
| `busytex` | browser (Web Worker) | TeX Live 2026 in WASM (pdfTeX, XeTeX, LuaHBTeX, bibtex8, biber, makeindex). Data packages (basic / recommended / extra) are chosen from the packages the project uses and cached by the browser. |
| `native` | desktop | `latexmk`, `tectonic` or raw engine passes through `window.texit.tex`, persistent build dir per project. |
| `remote` | anywhere | Self-hostable HTTP compile server (`apps/compile-server`). |
| plugins | anywhere | `api.compiler.registerBackend(...)`. |

Logs are parsed into `Diagnostic`s (`parseLatexLog`), SyncTeX output is parsed in pure TypeScript (`parseSyncTex`, forward/inverse search) so it works with every backend.

## Web app (`apps/web/src`)

```
ui/          design system (tokens in index.css, radix-ui primitives)
state/       settings (persisted), workspace (open project, tabs, compile output), layout (persisted)
services/    projects (IndexedDB), commands, panels/status items, bridges: editor, compile, ai, collab, templates
features/    workspace · dashboard · editor · files · outline · search · pdf · compile · ai · collab · history · plugins · settings · palette · desktop
plugins/     built-in plugins (written against the public plugin API)
```

Each feature exposes `activate()` (registers commands, panels, extensions) and is wired in `features/activate.ts`. Cross-feature communication goes through the bridges in `services/` rather than direct imports.

## AI (`packages/ai`)

- **Providers:** Vercel AI SDK models for OpenAI, Anthropic, Google and any OpenAI-compatible endpoint (OpenRouter, Groq, DeepSeek, Mistral, xAI, Ollama, LM Studio, llama.cpp, vLLM). Keys stay on the device (OS keychain on desktop).
- **Subscription CLIs (desktop):** Codex CLI, Claude Code and Gemini CLI run headless in a disk mirror of the project; file changes sync back into the Y.Doc.
- **Agent:** multi-step tool loop with project tools (`list_files`, `read_file`, `edit_file`, `write_file`, `search_project`, `compile`, `get_diagnostics`, …). Edits can be auto-applied or reviewed as diffs.
- **MCP:** external MCP servers (HTTP/SSE in the browser, stdio on desktop) become agent tools; on desktop TexIt also runs an MCP server (Streamable HTTP on localhost, bearer token) exposing the same project tools to external agents.

## Desktop (`apps/desktop`)

Electron main process serves the built SPA through a privileged `texit://app/` protocol, implements the `TexitHost` bridge over IPC (native TeX, file system & watching, CLI agents, MCP stdio + server, secrets via `safeStorage`, native menus), and is packaged with electron-builder for macOS, Windows and Linux.
