#!/usr/bin/env bash
# One-time GitHub setup for fernandevdaza/texit — run by the repository owner, from the repo root,
# with the GitHub CLI logged in as fernandevdaza (`gh auth login`). Review before running; it is not
# run by CI or any package script.
#
#   bash scripts/github-setup.sh
#
# Commit everything you want published first: `gh repo create --push` pushes the current branch (main).
set -euo pipefail

REPO="fernandevdaza/texit"
HOMEPAGE="https://fernandevdaza.github.io/texit/"
DESCRIPTION="Open-source, local-first LaTeX studio — TeX Live in your browser (WASM), serverless E2E-encrypted collaboration, AI agents with your own models, MCP and plugins. Web, macOS, Windows & Linux. A free alternative to Overleaf and Texifier."

# 1. Create the public repository from this folder and push main.
gh repo create "$REPO" --public --source . --remote origin --description "$DESCRIPTION" --homepage "$HOMEPAGE" --push

# 2. Topics — GitHub allows at most 20 per repository. Left out of the wish list for that reason:
#    tex, wasm, codemirror, pdfjs, spanish (swap any of them in for one below if you prefer).
gh repo edit "$REPO" \
  --add-topic latex,overleaf-alternative,texifier,pdflatex,xelatex,lualatex,webassembly \
  --add-topic collaborative-editing,crdt,yjs,webrtc,p2p,local-first,electron,react,typescript \
  --add-topic ai,mcp,synctex,education

# 3. Discussions on, wiki off (docs live in the repo).
gh repo edit "$REPO" --enable-discussions --enable-wiki=false

# 4. GitHub Pages deployed by GitHub Actions (.github/workflows/pages.yml).
gh api -X POST "repos/$REPO/pages" -f build_type=workflow \
  || gh api -X PUT "repos/$REPO/pages" -f build_type=workflow

# 5. Private vulnerability reporting (SECURITY.md points to it) and Dependabot security updates.
gh api -X PUT "repos/$REPO/private-vulnerability-reporting"
gh api -X PUT "repos/$REPO/vulnerability-alerts"
gh api -X PUT "repos/$REPO/automated-security-fixes"

# 6. The first Pages deployment runs on the push above; re-run it if Pages was enabled afterwards.
gh workflow run pages.yml --repo "$REPO" || true

echo "Done: https://github.com/$REPO  ·  $HOMEPAGE (after the Pages workflow finishes)"
