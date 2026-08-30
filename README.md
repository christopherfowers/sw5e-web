# sw5e-web

Frontend for the SW5e community platform: a browsable, searchable reference for
the Star Wars 5e tabletop roleplaying game.

## Requirements

- Node 22.23.2 (see `.nvmrc`); minimum supported 22.22.0

## Getting started

```bash
npm ci
npm run dev
```

The repository ships a small committed sample of the content library, so the
site runs, builds and tests without any further setup. See
[Content data](#content-data) for the full library.

## Content data

The site renders from a normalized dataset under `app/data`:

| Directory | Committed? | Contents |
|---|---|---|
| `app/data/fixture` | yes | Four items per content type, enough to run every page and every test |
| `app/data/generated` | no, gitignored | The full library, roughly 1,800 items |

`app/data/generated` wins when it is present; otherwise the fixture is used.
Both directories hold the same file shapes, so the app, the tests and the
prerender list behave identically against either.

To build the full library you need a checkout of the legacy content archive —
JSON dumps of the retired API, one file per type. It is not vendored here: it
is several megabytes of unmaintained data with known encoding corruption, and
it belongs in its own repository.

```bash
# Full library into the gitignored app/data/generated
node scripts/build-content-fixture.mjs --archive ../sw5e-legacy-archive/api

# Regenerate the committed sample in app/data/fixture
node scripts/build-content-fixture.mjs --archive ../sw5e-legacy-archive/api --curated
```

The archive path also reads from `SW5E_ARCHIVE`, and defaults to
`../sw5e-legacy-archive/api`.

The script does more than copy. It drops the archive's storage plumbing
(`partitionKey`, `rowKey`, `timestamp`, `eTag`), its stringified `*Json`
duplicates and its `*Enum` integers; it repairs the encoding damage baked into
the 2022 scrape where the original character can be deduced from context, and
deliberately leaves it alone where it cannot; and it reshapes each type into
the props the UI consumes, so no legacy field name reaches a component. The
repair rules and the cases they refuse to guess at are documented in
`scripts/lib/repair-text.mjs`.

## How rendering works

Published content pages are **prerendered to static HTML at build time** —
there is no runtime Node server. This gives content pages optimal search-engine
visibility and near-instant loads. Anything not prerendered falls through to the
SPA fallback.

The prerender path list lives in `react-router.config.ts` and is derived from
the dataset: the home page, the search page, one index per content type, and one
page per item.

Because every content route is prerendered, its `loader` runs only at build time
(`app/content/dataset.server.ts`). A page therefore ships only its own data,
embedded in its own HTML, rather than the whole library. The one exception is
search, which needs the whole corpus in the browser and so fetches a compact
index on first use.

With the full library that is **1,830 prerendered routes in about 3m20s** on a
warm cache; with the committed fixture it is 43 routes in about 25 seconds.

Deployment note: the static host must resolve `/species/wookiee` to
`species/wookiee/index.html`, which Netlify, Cloudflare Pages, GitHub Pages and
S3 website hosting all do. `vite preview` does not, so this repository adds a
small preview middleware (`vite.config.ts`) to make local preview behave the
same way.

## Container image

The site ships as a container: a Node stage runs the prerender build, and the
runtime stage is `nginxinc/nginx-unprivileged` serving the resulting static
files. There is no Node process at runtime.

| | |
|---|---|
| Image | `ghcr.io/christopherfowers/sw5e-web` |
| Tags | `sha-<full 40-character commit SHA>` on every push to `main`, `latest` alongside it, and `X.Y.Z` / `X.Y` on a `v*.*.*` tag push |
| Port | `8080` |
| User | non-root, uid `101` |
| Volumes | none — the content is baked into the image, and nothing is written at runtime |
| Health | `GET /healthz` returns `200 ok`; the image also declares a `HEALTHCHECK` against it |

### Run it locally

```bash
docker build -t sw5e-web .
docker run --rm -p 8080:8080 sw5e-web
# http://localhost:8080
```

Or pull a published build:

```bash
docker run --rm -p 8080:8080 ghcr.io/christopherfowers/sw5e-web:latest
```

The image is built from a clean checkout, so — as described under
[Content data](#content-data) — it renders the committed fixture: four items
per content type, 47 prerendered routes. Building the full library into an
image needs the legacy archive mounted into the build context.

### Behind Traefik

TLS terminates at the proxy; the container serves plain HTTP on 8080 and never
redirects, so it needs no knowledge of its public hostname.

```yaml
services:
  sw5e-web:
    image: ghcr.io/christopherfowers/sw5e-web:latest
    restart: unless-stopped
    networks: [web]
    labels:
      traefik.enable: "true"
      traefik.http.routers.sw5e-web.rule: Host(`sw5e.example.com`)
      traefik.http.routers.sw5e-web.entrypoints: websecure
      traefik.http.routers.sw5e-web.tls.certresolver: letsencrypt
      traefik.http.services.sw5e-web.loadbalancer.server.port: "8080"

networks:
  web:
    external: true
```

A real deploy pins `ghcr.io/christopherfowers/sw5e-web:sha-<full commit SHA>`
rather than `latest`, so what is running is traceable to a commit and a
redeploy is deliberate.

The container sets its own `Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and cross-origin
isolation headers (`docker/default.conf`). It deliberately does **not** set
`Strict-Transport-Security`: that describes the origin the browser talks to,
which is the proxy, so it belongs on the proxy.

### Serving it somewhere else

The one rule a static host has to follow is the one `docker/default.conf`
documents at length: resolve `/species/wookiee` to
`species/wookiee/index.html` **before** falling back to
`__spa-fallback.html`. Netlify, Cloudflare Pages, GitHub Pages and S3 website
hosting all do this. A host that reaches for the SPA fallback first still
looks correct in a browser — hydration paints the page — while serving nothing
at all to a crawler that does not run JavaScript.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build with prerendering |
| `npm run preview` | Serve the production build locally on port 4173 |
| `npm run typecheck` | Route typegen plus TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |

## Accessibility

WCAG 2.1 AA is the target this project is built against, and it is now
**partly** enforced automatically.

What CI verifies today: keyboard-only end-to-end paths (`e2e/keyboard.spec.ts`)
covering the skip link, the search shortcut, arrowing through search results,
following a result with Enter, escaping the results panel without a trap,
sorting a table from the keyboard, and focus visibility while tabbing a content
page. Unit tests cover heading order on item pages and `aria-sort` on sortable
columns.

What it still does not verify: there is no automated axe scan, so contrast,
ARIA correctness and landmark structure across every page remain reviewed by
hand rather than enforced. Until that lands (see the open accessibility issue),
conformance is a target with partial coverage rather than a fully verified
property.

## Fonts

Inter is self-hosted from `app/fonts` and declared in `app/app.css`. It is not
loaded from Google Fonts: doing so leaks every visitor's IP address to a third
party and would permanently require `fonts.googleapis.com` and
`fonts.gstatic.com` in this app's Content-Security-Policy. The font files are
licensed under the [SIL Open Font License 1.1](app/fonts/LICENSE).

## License

MIT — see [LICENSE](LICENSE).

## QA deployment

Merging to `main` publishes the image and then deploys it to the internal QA
environment at <https://sw5e.cfowers.io>, which runs the database, API and site
as one Compose stack behind the reverse proxy.

The deploy step runs on a self-hosted runner on the QA host. That runner polls
GitHub outbound — no inbound port is opened — holds no secrets, and is
permitted to run exactly one script via a narrow sudoers rule. Only the
immutable `sha-<full commit SHA>` tag is ever deployed; `latest` is refused.
This repository deploys only the `web` service, so a merge here cannot move
the other two.

The step is gated on the `DEPLOY_ENABLED` repository variable. A job targeting
an unregistered runner label queues indefinitely rather than failing, so until
the runner is registered the gate keeps merges clean. Set `DEPLOY_ENABLED` to
`true` under Settings → Secrets and variables → Actions to turn it on.
