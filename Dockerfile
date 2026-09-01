# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Content stage
#
# The canonical game content is maintained in the sibling sw5e-database
# repository and published as an image whose only job is to carry it: content
# at /opt/sw5e/content, schemas at /opt/sw5e/schemas. Building from that image
# rather than from a vendored copy is what makes this site render the same
# corpus the API serves; a clean clone alone cannot, because the generated
# dataset is gitignored and the committed fixture is four items per type.
#
# This does mean the site's build depends on another repository's published
# image. SW5E_CONTENT_TAG is how a build pins a specific content revision:
# `latest` follows that repository's default branch, and a
# `sha-<40 characters>` tag freezes the content at one commit, which is what a
# build that has to be reproducible later should pass:
#
#   docker build --build-arg SW5E_CONTENT_TAG=sha-<commit> .
# ---------------------------------------------------------------------------
ARG SW5E_CONTENT_TAG=latest
FROM ghcr.io/christopherfowers/sw5e-database:${SW5E_CONTENT_TAG} AS content

# ---------------------------------------------------------------------------
# Build stage
#
# Node is pinned to the exact version in .nvmrc so the image, CI and a
# developer's machine all run the same toolchain. `engines.node` floors the
# project at 22.22.0; this is the version it is actually developed against.
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

# Read-only input to the generator below. Kept out of the runtime image: what
# ships is the normalized dataset baked into the prerendered pages, not the
# canonical documents themselves.
COPY --from=content /opt/sw5e/content /content

COPY . .

# Builds app/data/generated from the canonical content, which the app and the
# prerender list both prefer over the committed fixture when it exists.
#
# Every step here fails the build rather than continuing, because the failure
# this replaces was silent: a container that renders four items per type looks
# exactly like a working site until someone counts. An empty content stage, a
# content set with no source documents, and a dataset with no items are all
# indistinguishable from "the copy did not happen", so none of them may pass.
RUN set -eu; \
    if [ ! -d /content/species ]; then \
      echo "the content stage carries no /content/species directory" >&2; \
      exit 1; \
    fi; \
    documents=$(find /content -name '*.json' | wc -l); \
    if [ "$documents" -eq 0 ]; then \
      echo "the content stage is empty: no JSON documents under /content" >&2; \
      exit 1; \
    fi; \
    echo "canonical content: $documents documents"; \
    node scripts/build-content-fixture.mjs --content /content --out app/data/generated; \
    node scripts/build-credits.mjs --content /content --out app/data/credits.json; \
    node -e 'const m = require("/app/app/data/generated/manifest.json"); const total = m.types.reduce((sum, type) => sum + type.count, 0); if (total === 0) { console.error("the generated dataset holds no items"); process.exit(1); } console.log("generated dataset: " + total + " items");'

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
