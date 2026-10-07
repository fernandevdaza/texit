# TexIt reference compile server.
#   docker build -t texit-compile-server apps/compile-server
#   docker run --rm -p 8787:8787 -e TEXIT_COMPILE_TOKEN=change-me \
#     --read-only --tmpfs /tmp:rw,size=1g --cap-drop ALL --security-opt no-new-privileges \
#     --pids-limit 256 --memory 2g --cpus 2 texit-compile-server
#
# TEXLIVE_IMAGE: texlive/texlive:latest (full scheme, ~5 GB, everything incl. biber) or a
# slimmer scheme such as texlive/texlive:latest-medium (no latexextra / biber).
ARG TEXLIVE_IMAGE=texlive/texlive:latest
FROM node:22-bookworm-slim AS node

FROM ${TEXLIVE_IMAGE}
# Node.js runtime only (the server has zero npm dependencies).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin texit \
 && mkdir -p /app /tmp/texit-compile && chown texit:texit /tmp/texit-compile
WORKDIR /app
COPY server.mjs package.json ./
USER texit
ENV NODE_ENV=production \
    PORT=8787 \
    TEXIT_WORK_DIR=/tmp/texit-compile \
    TEXIT_DRIVER=latexmk
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["node", "server.mjs"]
