## What changes · Qué cambia

<!-- Short description and why. Link the issue if there is one (Closes #123). · Breve descripción y motivo. Enlaza el issue si existe. -->

## How it was tested · Cómo se probó

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Tried in the app (`pnpm dev`) · Probado en la app
- [ ] Desktop, if it touches `apps/desktop` (`pnpm desktop:dev`) · Escritorio, si toca `apps/desktop`
- [ ] Compiles with the affected engines/backends (WASM, native, remote) · Compila con los motores/backends afectados

## Checklist

- [ ] UI strings in English **and** Spanish (feature `i18n.ts`) · Textos de la interfaz en inglés **y** español
- [ ] Tests for new logic in `packages/*` · Pruebas para la lógica nueva en `packages/*`
- [ ] No project content sent anywhere without the user asking; no telemetry · Ningún contenido del proyecto se envía sin que el usuario lo pida; sin telemetría
- [ ] Plugin API changes are backwards compatible and documented in `docs/plugins.md` · Los cambios en la API de plugins son compatibles y están documentados
- [ ] Docs / CHANGELOG updated if behaviour changes · Documentación / CHANGELOG actualizados si cambia el comportamiento
- [ ] Screenshots for visual changes · Capturas para cambios visuales
