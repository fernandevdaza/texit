<p align="right"><b>English</b> · <a href="#español">Español</a></p>

# Security policy

## Supported versions

Only the latest release and the version deployed at <https://fernandevdaza.github.io/texit/> receive security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on <https://github.com/fernandevdaza/texit/security>.

Include the affected version (web or desktop, and OS), the steps to reproduce and, if possible, a minimal project or
invite flow that triggers the problem. You should receive an answer within a week. Reports in English or Spanish are
welcome. Please give us a reasonable time to ship a fix before disclosing the issue publicly.

## Threat model

TexIt is local-first: there is no TexIt server and no account. It helps to know what is — and is not — protected:

- **Local data.** Projects live in the browser's IndexedDB (web) or in folders on disk (desktop) and are compiled on the
  device. Anyone with access to your browser profile or your files can read them; TexIt does not encrypt data at rest.
- **Collaboration invites carry the key.** Every shared room has a random 256-bit secret that travels only in the
  invite link's **URL fragment** (the part after `#`, which browsers never send to servers). It derives the AES-256-GCM
  key that encrypts every Yjs/awareness payload and the password that encrypts WebRTC signaling on the public relays
  (Nostr / BitTorrent trackers / MQTT). **Anyone who has the link can join and decrypt the project** — share it like a
  password. Relays and network observers see IP addresses and connection metadata, not content. **View-only invites
  are best-effort**: a modified client holding the key can still write, because peer-to-peer rooms have no authority
  to enforce permissions.
- **Plugins run with page privileges.** Plugin permissions are a consent mechanism, not a sandbox: an installed plugin
  can do anything a script in the app can (read projects, make network requests). Only install plugins you trust.
  Bugs in the permission enforcement itself are in scope.
- **AI keys.** On desktop, API keys and MCP credentials are stored encrypted with the OS keychain (Electron
  `safeStorage`). On the web they are kept in memory for the session and only written to `localStorage` if you opt in
  ("Remember keys in this browser"). Keys are never part of the project document, so they are never synced to
  collaborators. Requests go directly from your device to the provider you configured, which receives the content you
  send it.
- **AI agents and CLI agents.** Agents can edit and compile your project; edits can be reviewed as diffs. On desktop,
  Codex CLI / Claude Code / Gemini CLI run as local processes on a disk mirror of the project with the permissions of
  your user account and are governed by their own sandbox settings.
- **Desktop MCP server.** When enabled, TexIt's MCP server listens on **127.0.0.1 only**, requires a random **bearer
  token**, and checks the `Host` header (DNS-rebinding protection). Any local process that obtains the token can read
  and edit the open project.
- **Compilation.** The WASM TeX engine runs in a Web Worker inside the browser sandbox. Native compilation on desktop
  runs your TeX distribution with `shell-escape` **disabled** by default; enabling it lets documents run arbitrary
  commands, so only do so for projects you trust. The optional remote compile server should be run behind a token and
  in a container.

Out of scope: attacks that require an already-compromised device or browser profile, social engineering to obtain an
invite link, denial of service against the public signaling relays, and vulnerabilities in third-party plugins (report
those to their authors).

---

<a id="español"></a>

# Política de seguridad (español)

Solo la última versión y la publicada en <https://fernandevdaza.github.io/texit/> reciben correcciones de seguridad.

**No abras un issue público.** Usa el reporte privado de GitHub (**Security → Report a vulnerability** en
<https://github.com/fernandevdaza/texit/security>) e incluye la versión afectada (web o escritorio y sistema operativo),
los pasos para reproducir el problema y, si es posible, un proyecto mínimo o el flujo de invitación que lo provoca.
Recibirás respuesta en una semana como máximo.

Resumen del modelo de amenazas:

- **Datos locales:** los proyectos viven en IndexedDB (web) o en carpetas (escritorio) y no se cifran en reposo.
- **Las invitaciones llevan la clave** en el fragmento de la URL (después de `#`, que el navegador nunca envía a un
  servidor): cualquiera con el enlace puede unirse y descifrar el proyecto. Los relés solo ven metadatos de conexión.
  Las invitaciones de solo lectura son de mejor esfuerzo.
- **Los plugins se ejecutan con los privilegios de la página**; los permisos son consentimiento, no un sandbox.
- **Claves de IA:** en escritorio, cifradas con el llavero del sistema; en la web, en memoria salvo que elijas
  recordarlas en el navegador. Nunca se sincronizan con colaboradores.
- **Servidor MCP de escritorio:** solo en `127.0.0.1`, con token bearer y validación del encabezado `Host`.
- **Compilación nativa:** `shell-escape` está desactivado por defecto; actívalo solo en proyectos de confianza.
