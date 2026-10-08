# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.0] — 2026-10-07

First public release.

### Compilation
- TeX Live 2026 compiled to WebAssembly (TeXlyre BusyTeX) running in a Web Worker: pdfLaTeX, XeLaTeX and LuaLaTeX with
  BibTeX, Biber and makeindex. Package sets (basic / recommended / extra) are chosen from the packages a project uses
  and cached by the browser for offline use.
- Native compilation on desktop with `latexmk` (TeX Live / MiKTeX / MacTeX), Tectonic or raw engine passes, with a
  persistent build directory per project; `shell-escape` off by default.
- Optional self-hostable remote compile server (`apps/compile-server`, protocol v1, Docker image, no dependencies).
- Auto-compile while typing, draft mode, log parsing into linked errors and warnings.

### Editor and PDF
- CodeMirror 6 editor with LaTeX completion (528 commands, 99 environments, 350 math symbols, labels, citations, files
  and packages), snippets, KaTeX math preview on hover, live lint, folding, outline, project-wide search and replace,
  Vim and Emacs keymaps, rich-text decorations and formatting shortcuts.
- pdf.js viewer with flicker-free recompiles, thumbnails, search, zoom presets and two-way SyncTeX.

### Collaboration
- Serverless real-time collaboration: Yjs CRDT over WebRTC with Trystero signaling (Nostr, BitTorrent, MQTT relays).
- End-to-end encryption (AES-256-GCM, key only in the invite link's URL fragment), live cursors and presence, chat,
  review comments, follow mode and view-only invites.

### AI and MCP
- AI chat agent with project tools (list, read, edit, write, search, compile, diagnostics) and diff review; ask mode,
  ⌘K inline edits, ghost-text completion, "fix compile errors" and "explain selection".
- Providers: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI and any OpenAI-compatible
  endpoint; local models through Ollama and LM Studio; ChatGPT / Claude / Gemini subscriptions through Codex CLI,
  Claude Code and Gemini CLI on desktop.
- MCP client (Streamable HTTP / SSE, stdio on desktop) and TexIt as an MCP server on desktop (127.0.0.1, bearer token)
  with ready-to-paste configuration for Claude Code, Codex and Cursor.

### Plugins
- Typed plugin API (`@texit/plugin-api`, MIT): commands, panels, status-bar items, snippets, completions, compile
  backends, AI tools, templates and settings; permission prompts, developer mode with hot reload, plugin registry.
- Seven built-in plugins: word count, symbol palette, table generator, BibTeX tools (DOI / arXiv / ISBN), snippets,
  lorem ipsum & date, zen mode.

### Projects
- Local-first projects in IndexedDB (web) or folders on disk (desktop), dashboard with thumbnails, tags, stars and
  trash.
- File manager with drag & drop and folder uploads, Overleaf-compatible `.zip` import/export, image and PDF preview.
- Version history with diffs, named versions and restore.
- 15 templates: article, report, thesis, beamer, poster, CV (pdfLaTeX and XeLaTeX), cover letter, book, homework, lab
  report, IEEE paper, math notes and a Spanish article.

### App
- English and Spanish interface, light and dark themes, eight accent colors, command palette, quick open and keyboard
  shortcuts.
- Desktop app (Electron) for macOS (dmg/zip, Apple Silicon + Intel), Windows (installer x64 + ARM64, portable) and
  Linux (AppImage, deb, rpm): folder sync, native TeX, OS-keychain secrets, `.tex` file associations, native menus and
  update checks through GitHub releases. Installers are not code-signed yet.

[Unreleased]: https://github.com/fernandevdaza/texit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fernandevdaza/texit/releases/tag/v0.1.0
