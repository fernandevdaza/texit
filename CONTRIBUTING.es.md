<p align="right"><a href="CONTRIBUTING.md">English</a> · <b>Español</b></p>

# Cómo contribuir a TexIt

¡Gracias por querer ayudar! TexIt existe para que cualquiera pueda escribir LaTeX — solo o con otros — sin entregar su
trabajo a un servicio en la nube. Se aceptan issues y pull requests en **español o inglés**. Respeta el
[Código de conducta](CODE_OF_CONDUCT.md).

## Formas de ayudar

- **Reportar errores**: adjunta un proyecto mínimo (exportado como `.zip`) que reproduzca el problema, el motor
  (pdfLaTeX / XeLaTeX / LuaLaTeX), el backend de compilación (navegador, nativo, remoto) y el log si aplica.
- **Plantillas y plugins**: nuevas plantillas en `packages/core/src/templates.ts`, o plugins (ver
  [docs/plugins.md](docs/plugins.md)); los plugins de terceros pueden vivir en sus propios repositorios.
- **Traducciones**: cada texto de la interfaz existe en inglés y español; se agradecen correcciones e idiomas nuevos.
- **Documentación**: `docs/` y los README.
- **Funciones nuevas**: para cambios grandes, abre primero un issue y acordemos el enfoque.

Problemas de seguridad: sigue [SECURITY.md](SECURITY.md) en lugar de abrir un issue público.

## Preparar el entorno

Requisitos: Node.js 22 o superior y pnpm (`corepack enable`). Google Chrome solo para `pnpm screenshots`.

```bash
pnpm install
pnpm assets:busytex   # una vez: TeX Live WASM (~520 MB) en apps/web/public/busytex (ignorado por git)
pnpm dev              # app web en http://localhost:5173
pnpm desktop:dev      # servidor de desarrollo + Electron (el TeX nativo necesita latexmk o tectonic en el PATH)
```

Antes de enviar cambios:

```bash
pnpm typecheck
pnpm test
pnpm build
```

En los builds de desarrollo, `window.__texit` expone los stores de proyectos, comandos, espacio de trabajo y
configuración para la consola y las pruebas automáticas de la interfaz (`scripts/screenshots.mjs` lo usa).

## Estructura

| Carpeta | Responsabilidad |
|---|---|
| `packages/core` | Modelo de proyecto (`ProjectDoc` sobre Yjs), análisis de LaTeX y datos de autocompletado, parser de logs, SyncTeX, zip, plantillas, contrato del puente de escritorio `TexitHost` |
| `packages/compiler` | `CompileService` y backends: BusyTeX (WASM, Web Worker), nativo (escritorio), remoto (HTTP) |
| `packages/ai` | Proveedores (Vercel AI SDK), bucle del agente y herramientas de proyecto, ediciones en línea, agentes CLI, cliente MCP y herramientas del servidor |
| `packages/plugin-api` | API pública de plugins con licencia MIT — mantenla pequeña y compatible hacia atrás |
| `apps/web` | Interfaz en React. `src/features/<feature>/` contiene cada función (con su `i18n.ts`), `src/plugins/builtin/` los plugins incluidos |
| `apps/desktop` | Proceso principal y preload de Electron (`src/main/*`), empaquetado con electron-builder |
| `apps/compile-server` | Servidor de compilación remoto de referencia (sin dependencias) |

El diseño está descrito en [docs/architecture.md](docs/architecture.md) (en inglés).

## Pautas

- Código, identificadores, comentarios y mensajes de commit en **inglés**. Todo texto de la interfaz pasa por i18n
  (`useT()` / `t()` de `@/lib/i18n`, mensajes registrados en el `i18n.ts` de la función) con `en` **y** `es`.
- TypeScript está en modo `strict`; no silencies errores con `any` salvo que no haya alternativa razonable.
- Las funciones se comunican mediante los registros y puentes de `apps/web/src/services/`, no importando el interior de
  otras. Si algo podría ser un plugin, mejor construirlo sobre la API de plugins.
- Local-first es una función: nunca envíes el contenido de un proyecto a ningún lado salvo que el usuario lo pida
  (servidor de compilación, proveedor de IA, colaboradores), y nunca agregues telemetría.
- Agrega pruebas para la lógica de `packages/*` (Vitest): parsers, SyncTeX, operaciones de proyecto, herramientas del
  agente, etc.
- Discute nuevas dependencias de ejecución en un issue primero; cuida el tamaño del bundle de la app web.
- Se agradecen los [commits convencionales](https://www.conventionalcommits.org): `feat(editor): …`,
  `fix(compiler): …`, `docs: …`.

### Capturas e imágenes

`pnpm screenshots` regenera los banners del README (`scripts/brand/banner.html`) y las capturas de la app en
`docs/public/` (requiere Google Chrome o Chromium — define `CHROME_PATH` si no se encuentra). Maneja el servidor de
desarrollo (`BASE_URL`, por defecto `http://localhost:5173`, que se inicia solo si hace falta) en un perfil de navegador
desechable. Usa `ONLY=banner` u `ONLY=app` y `LANGS=es` para acotarlo.

## Versiones

1. Actualiza `CHANGELOG.md` y la versión en los `package.json`.
2. Crea la etiqueta `vX.Y.Z` y súbela: el flujo *Desktop apps* compila los instaladores y los adjunta a un release en
   **borrador**, que se publica a mano desde la pestaña Releases. Cada push a `main` ya publica la app web en GitHub
   Pages.

## Licencia

Al contribuir aceptas que tus contribuciones se publiquen bajo la licencia del proyecto,
[AGPL-3.0-or-later](LICENSE) (las contribuciones a `packages/plugin-api`, bajo la licencia MIT).
