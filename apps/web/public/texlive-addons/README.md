# TeX Live add-ons for the in-browser compiler

Runtime files that are **not** part of the BusyTeX TeX Live 2026 data packages (basic / recommended /
extra) but that common documents need. The WebAssembly backend (`packages/compiler`) reads
`manifest.json` and injects a file into the compile directory only when the project needs it and
does not provide it itself (e.g. `\usepackage[spanish]{babel}` → `spanish.ldf`).

| Folder | Source (CTAN / TeX Live 2026) | License |
|---|---|---|
| `babel/babel-*` | `babel-<language>` packages from `tlnet/archive` (language definition files) | LPPL 1.3c |
| `ieee/` | `IEEEtran` class and `IEEEtran.bst` (V1.8b / 1.14) | LPPL 1.3 |

Files are redistributed unmodified. To refresh them, download `babel-<lang>.tar.xz` from
<https://mirrors.ctan.org/systems/texlive/tlnet/archive/> and copy `tex/generic/babel-<lang>/*`.
