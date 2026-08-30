# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage
#
# Node is pinned to the exact version in .nvmrc so the image, CI and a
# developer's machine all run the same toolchain. `engines.node` floors the
# project at 22.22.0; this is the version it is actually developed against.
#
# Note on the dataset: app/data/generated is gitignored and is not present in a
# clean clone, so this build renders from the committed sample in
# app/data/fixture. See "Content data" in the README.
# ---------------------------------------------------------------------------
FROM node:22.23.2-alpine AS build

WORKDIR /app

# Keeps npm from treating a slow install as an interactive session and makes
# the build behave the same here as it does on a CI runner.
ENV CI=true

# The manifests change far less often than the source, so installing before
# copying the rest of the tree keeps the dependency layer cached across edits.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Prerenders every content route to static HTML plus the SPA fallback shell.
# Output lands in build/client; build/server is not used, there is no runtime
# Node server.
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime stage
#
# nginx-unprivileged already runs as uid 101 and listens on 8080, so nothing
# here needs root or a privileged port. It is the stock nginx build: no brotli
# module ships with it, which is why the config compresses with gzip only.
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.31.4-alpine AS runtime

# The stock welcome page and error page would otherwise stay reachable at / and
# /50x.html. Removing them needs root, so drop back to the image's own
# unprivileged user immediately afterwards.
USER root
RUN rm -f /usr/share/nginx/html/index.html /usr/share/nginx/html/50x.html
USER 101

COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build/client /usr/share/nginx/html

EXPOSE 8080

# BusyBox wget is part of the Alpine base, so no extra package is needed.
# /healthz is served by nginx itself and does not touch the site content, so a
# failing check means the server is genuinely down rather than that one page
# happens to be missing.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
