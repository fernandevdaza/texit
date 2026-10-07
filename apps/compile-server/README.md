# TexIt compile server (reference implementation)

A tiny, dependency-free HTTP server that compiles LaTeX projects for TexIt's
`RemoteBackend` (`@texit/compiler`). It runs **latexmk** (TeX Live) or **tectonic**.

```bash
node server.mjs                       # needs latexmk + TeX Live, or tectonic, on PATH
docker build -t texit-compile-server . && docker run --rm -p 8787:8787 -e TEXIT_COMPILE_TOKEN=change-me texit-compile-server
```

In TexIt: Settings → Compiler → Remote server → URL `http://localhost:8787` (+ token).

## Protocol v1

| Endpoint | Description |
| --- | --- |
| `GET /v1/info` | `{ protocol: 1, name, version, engines, drivers, distribution?, auth: 'none'\|'bearer', limits: { maxRequestBytes, timeoutMs, maxFiles } }` |
| `POST /v1/compile` | JSON body below → `200 { status: 'success'\|'error', pdfBase64?, synctexBase64?, log, durationMs, buildDir, driver }` |
| `GET /healthz` | liveness probe |

Request body (`Content-Type: application/json`, optional `Authorization: Bearer <token>`):

```jsonc
{
  "protocol": 1,
  "projectId": "optional-opaque-id",
  "mainPath": "src/main.tex",              // POSIX, project-relative
  "engine": "pdflatex",                    // pdflatex | xelatex | lualatex
  "bibTool": "auto",                       // auto | bibtex | biber | none
  "makeindex": "auto",
  "synctex": true,
  "draft": false,                          // true → single pass
  "files": [
    { "path": "src/main.tex", "text": "\\documentclass{article}…" },
    { "path": "figures/logo.png", "base64": "iVBORw0KGgo…" }
  ]
}
```

- `200` means the compile ran; TeX errors and timeouts come back as `status: "error"` with the log.
- Rejections use `{ "error": { "code", "message" } }`: `bad-request` 400, `unauthorized` 401,
  `too-large` 413, `busy` 503 (+ `Retry-After`), `internal` 500.
- `synctexBase64` is the gzipped `.synctex.gz`; its paths are absolute below `buildDir`.
- CORS is sent on every response (incl. Chrome Private-Network-Access preflights), so
  browsers can call the server directly.

## Configuration (environment)

| Variable | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `TEXIT_COMPILE_TOKEN` | — | require `Authorization: Bearer <token>` |
| `TEXIT_CORS_ORIGIN` | `*` | comma-separated allowed origins |
| `TEXIT_MAX_BODY_MB` | `50` | request size limit |
| `TEXIT_MAX_FILES` | `2000` | |
| `TEXIT_TIMEOUT_S` | `90` | per compile; the whole process group is killed |
| `TEXIT_MAX_CONCURRENT` / `TEXIT_MAX_QUEUE` | `2` / `8` | further requests get 503 |
| `TEXIT_DRIVER` | `auto` | `latexmk` \| `tectonic` \| `auto` (latexmk if available) |
| `TEXIT_WORK_DIR` | `$TMPDIR/texit-compile` | job dirs (deleted after each job) + shared caches |
| `TEXIT_MAX_LOG_KB` | `512` | log truncation |
| `TECTONIC_CACHE_DIR` | `$TEXIT_WORK_DIR/home/…` | tectonic bundle cache |

## Sandboxing notes

Compiling untrusted LaTeX is running untrusted code in a Turing-complete language. The
server applies these measures:

- No shell escape (`-no-shell-escape`, `shell_escape=f`; tectonic `--untrusted`).
- latexmk runs with `-norc`, and project `latexmkrc` files are dropped (they are Perl).
- `openout_any=p` (TeX can only write in the job dir); `openin_any=p` for root-level main
  files, `r` when the main file is in a sub-directory (legitimate `../` inputs).
- A minimal child environment (the token is not passed to TeX), per-job temp dirs,
  time/size/concurrency limits, and process-group kill on timeout or client disconnect.

TeX can still **read any file the server user can read** (e.g. `/proc/<pid>/environ` of the
server), so treat the container as the security boundary:

- run the Docker image as is (non-root user), with `--read-only --tmpfs /tmp`,
  `--cap-drop ALL --security-opt no-new-privileges`, `--pids-limit`, `--memory`, `--cpus`;
- do not mount secrets or put other credentials in its environment (the token only grants
  access to this service);
- deny outbound network access (e.g. an `internal` Docker network behind a reverse proxy
  that terminates TLS);
- for multi-tenant deployments, add gVisor (`--runtime=runsc`) or a VM-level sandbox.
