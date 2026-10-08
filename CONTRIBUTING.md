<p align="right"><b>English</b> · <a href="CONTRIBUTING.es.md">Español</a></p>

# Contributing to TexIt

Thanks for helping! TexIt exists so anyone can write LaTeX — alone or with others — without handing their work to a
cloud service. Issues and pull requests are welcome in **English or Spanish**. Please follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report bugs** — attach a minimal project (`.zip` export) that reproduces the problem, the engine
  (pdfLaTeX / XeLaTeX / LuaLaTeX), the compile backend (browser, native, remote) and the compile log if relevant.
- **Templates and plugins** — new templates in `packages/core/src/templates.ts`, or plugins (see
  [docs/plugins.md](docs/plugins.md)); third-party plugins can live in their own repositories.
- **Translations** — every UI string exists in English and Spanish; corrections and new languages are welcome.
- **Docs** — `docs/` and the READMEs.
- **Features** — open an issue first for anything big so we can agree on the approach.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

Requirements: Node.js ≥ 22 and pnpm (`corepack enable`). Google Chrome only for `pnpm screenshots`.

```bash
pnpm install
pnpm assets:busytex   # once: TeX Live WASM bundle (~520 MB) into apps/web/public/busytex (git-ignored)
pnpm dev              # web app at http://localhost:5173
pnpm desktop:dev      # web dev server + Electron (native TeX needs latexmk or tectonic on PATH)
```

Before sending changes:

```bash
pnpm typecheck
pnpm test
pnpm build
```

In dev builds `window.__texit` exposes the project, command, workspace and settings stores for the console and for
automated UI checks (`scripts/screenshots.mjs` uses it).

## Project layout

| Folder | Responsibility |
|---|---|
| `packages/core` | Project model (Yjs `ProjectDoc`), LaTeX analysis and completion data, log parser, SyncTeX, zip, templates, the `TexitHost` desktop bridge contract |
| `packages/compiler` | `CompileService` and backends: BusyTeX (WASM, Web Worker), native (desktop), remote (HTTP) |
| `packages/ai` | Providers (Vercel AI SDK), agent loop and project tools, inline edits, CLI agents, MCP client and server tools |
| `packages/plugin-api` | Public, MIT-licensed plugin API — keep it small and backwards compatible |
| `apps/web` | React UI. `src/features/<feature>/` holds each feature (with its `i18n.ts`), `src/plugins/builtin/` the built-in plugins |
| `apps/desktop` | Electron main process and preload (`src/main/*`), packaged with electron-builder |
| `apps/compile-server` | Reference remote compile server (no dependencies) |

The design is described in [docs/architecture.md](docs/architecture.md).

## Guidelines

- Code, identifiers, comments and commit messages in **English**. Every UI string goes through i18n
  (`useT()` / `t()` from `@/lib/i18n`, messages registered in the feature's `i18n.ts`) with **both** `en` and `es`.
- TypeScript is `strict`; don't silence errors with `any` unless there is no reasonable alternative.
- Features talk to each other through the registries and bridges in `apps/web/src/services/`, not by importing each
  other's internals. If a capability could be a plugin, prefer building it on the plugin API.
- Local-first is a feature: never send project content anywhere unless the user asked for it (compile server, AI
  provider, collaborators), and never add telemetry.
- Add tests for logic in `packages/*` (Vitest) — parsers, SyncTeX, project operations, agent tools, etc.
- Discuss new runtime dependencies in an issue first; mind the bundle size of the web app.
- [Conventional commits](https://www.conventionalcommits.org) are appreciated: `feat(editor): …`, `fix(compiler): …`,
  `docs: …`.

### Screenshots and images

`pnpm screenshots` regenerates the README banners (`scripts/brand/banner.html`) and the app screenshots in
`docs/public/` (needs Google Chrome or Chromium — set `CHROME_PATH` if it is not found). It drives the dev server
(`BASE_URL`, default `http://localhost:5173`, started automatically if needed) in a throwaway browser profile.
Use `ONLY=banner` or `ONLY=app` and `LANGS=en` to narrow it down.

## Releases

1. Update `CHANGELOG.md` and the version in the `package.json` files.
2. Tag `vX.Y.Z` and push the tag: the *Desktop apps* workflow builds the installers and attaches them to a **draft**
   release, which is published by hand from the Releases tab. Every push to `main` already deploys the web app to
   GitHub Pages.

## License

By contributing you agree that your contributions are licensed under the project's
[AGPL-3.0-or-later](LICENSE) license (contributions to `packages/plugin-api` under the MIT license).
