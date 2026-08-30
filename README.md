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

The site renders from a normalized dataset under `app/data`. Two directories
can hold one, and three different sources can produce one.

| Directory | Committed? | Contents |
|---|---|---|
| `app/data/generated` | no, gitignored | Whatever the generator last built: the canonical library, or the legacy one |
| `app/data/fixture` | yes | Four items per content type, enough to run every page and every test |

`app/data/generated` wins when it is present; otherwise the fixture is used.
Both directories hold the same file shapes, so the app, the tests and the
prerender list behave identically against either.

### Canonical content — what the container builds from

The canonical library is maintained in the sibling
[sw5e-database](https://github.com/christopherfowers/sw5e-database) repository:
one schema-validated JSON document per item, under a directory per type. This
is the source of truth, and it is what the released container image renders,
so the site publishes the same corpus the API serves.

```bash
node scripts/build-content-fixture.mjs \
  --content ../sw5e-database/content --out app/data/generated
```

The container does not need a checkout. It copies the content out of
`ghcr.io/christopherfowers/sw5e-database`, an image published by that
repository whose only job is to carry it — see [Container
image](#container-image).

The canonical set is still growing, and the mapping records where it does not
yet reach: it has no maneuvers, so that type renders an empty index rather
than disappearing from the navigation, and its `feature` and `source`
directories are deliberately not published as browsable types — features are
already written out in the prose of the archetype that grants them, and the
books are described in `app/content/source-meta.ts`, which carries a blurb,
a colour and a cover that a data file cannot. The mapping and its reasoning
live in `scripts/lib/canonical.mjs`.

### The committed fixture — what a clean clone falls back to

`app/data/fixture` is four items per type, committed so that `npm test`,
`npm run build` and CI all work for a contributor with neither of the other
two sources to hand. It is built from the legacy archive:

```bash
node scripts/build-content-fixture.mjs --archive ../sw5e-legacy-archive/api --curated
```

### The legacy archive — local only, historical

The archive is JSON dumps of the retired API, one file per type. It is not
vendored here and exists in no repository: it is several megabytes of
unmaintained data with known encoding corruption. It remains supported because
it is still the only source for the types the canonical set has not reached.

```bash
node scripts/build-content-fixture.mjs --archive ../sw5e-legacy-archive/api
```

The archive path also reads from `SW5E_ARCHIVE`, and defaults to
`../sw5e-legacy-archive/api`.

Reading it is not a copy. The script drops the archive's storage plumbing
(`partitionKey`, `rowKey`, `timestamp`, `eTag`), its stringified `*Json`
duplicates and its `*Enum` integers; it repairs the encoding damage baked into
the 2022 scrape where the original character can be deduced from context, and
deliberately leaves it alone where it cannot; and it reshapes each type into
the props the UI consumes, so no legacy field name reaches a component. The
repair rules and the cases they refuse to guess at are documented in
`scripts/lib/repair-text.mjs`. None of that applies to the canonical content,
which is clean and carries no legacy vocabulary — which is why the two sources
have separate mappings onto one shared output shape.

## How rendering works

Published content pages are **prerendered to static HTML at build time** —
there is no runtime Node server. This gives content pages optimal search-engine
visibility and near-instant loads. Anything not prerendered falls through to the
SPA fallback.

The prerender path list lives in `react-router.config.ts` and is derived from
the dataset: the home page, the search page, one index per content type, and one
page per item. Seven fixed paths join them for the account area — those carry no
data at all, only a signed-out skeleton, and the reasoning is in
[Accounts](#accounts).

Because every content route is prerendered, its `loader` runs only at build time
(`app/content/dataset.server.ts`). A page therefore ships only its own data,
embedded in its own HTML, rather than the whole library. The one exception is
search, which needs the whole corpus in the browser and so fetches a compact
index on first use.

With the canonical content that is **139 prerendered routes in about 10
seconds**; with the legacy archive's full library it is 1,842 routes in about
3m20s on a warm cache, and with the committed fixture 54 routes. Seven of each
of those totals are the account pages, which do not vary with the dataset.

Deployment note: the static host must resolve `/species/wookiee` to
`species/wookiee/index.html`, which Netlify, Cloudflare Pages, GitHub Pages and
S3 website hosting all do. `vite preview` does not, so this repository adds a
small preview middleware (`vite.config.ts`) to make local preview behave the
same way.

## Accounts

The reference is public and stays public. An account exists so that a person
can hold a profile and, for contributors, upload base game content; nothing
under `/species`, `/powers`, `/monsters` or any other content route is gated,
and no route protection touches them.

Accounts are **passwordless**. Registration takes an email address and a
display name, verification arrives as a link, and the credential is a
**passkey** — WebAuthn, backed by the device's own fingerprint, face or PIN.
There is nothing to remember, nothing to reuse across sites, and nothing to
phish. An account may add a **TOTP second factor** on top.

| Route | What it is |
|---|---|
| `/register` | Email address and display name; triggers verification |
| `/verify-email` | The other end of the emailed link |
| `/sign-in` | Passkey sign-in, plus the TOTP challenge when one is set |
| `/account` | Profile, role, and how well protected the account is |
| `/account/passkeys` | Add and revoke credentials |
| `/account/security` | Enrol an authenticator app |
| `/account/contributions` | Contributor-only |

### Roles

Three, each including everything below it — `app/auth/roles.ts` is the only
place that decides:

| Role | May |
|---|---|
| Community | Read everything, and manage their own account. The default. |
| Contributor | …and upload or correct base game content. |
| Admin | …and manage other accounts and their roles. |

### Authenticated state on a site with no server

This is the part worth reading before changing anything in `app/auth`.

Every page here is prerendered to static HTML at build time and served by
nginx. There is no runtime Node process, no per-request rendering, and no
session available to a `loader` — a `loader` runs **once, on a build machine,
months before anybody visits**, and whatever it returns is written into a file
that every visitor is then served and every cache in between is free to keep.

So identity is never part of the build. Three rules follow.

**No route in the account area exports a `loader` or an `action`.**
`app/auth/prerender-safety.test.ts` fails the build if one appears, because the
failure it would cause is invisible: the page still renders, the flows still
work in a browser, and the leak is in a cache.

**The session is resolved once per document load, in the browser, by
`GET /api/auth/me`.** `AuthProvider` (`app/auth/session.tsx`) sits in
`app/root.tsx` above both the header and the outlet, so the account control and
the page it frames can never disagree about who is signed in.

**Session state is a four-state machine, not a nullable user.**

```
loading ──► authenticated
        ├─► anonymous
        └─► unavailable
```

`loading` is the only state the prerendered HTML and the first client render
are allowed to be in — that is what makes the markup React hydrates onto the
markup the build produced. It is also what prevents a flash of the wrong state:
modelling this as `user | null` would make "not loaded yet" and "signed out"
the same value, so every signed-in reader would see **Sign in** in the header
for the length of a round trip, on every page they opened. The header instead
draws a neutral placeholder of the same width, which claims nothing and moves
nothing when the answer arrives.

`unavailable` is kept separate from `anonymous` for the same reason at a larger
scale: a failed request is not a sign-out, and treating it as one would throw a
signed-in reader out of their account over a dropped connection.

The account routes are still prerendered, and must be. What they prerender is
the signed-out skeleton — which is exactly what a static file shared by every
visitor is allowed to contain. Leaving them out of the prerender list would
send them through nginx's SPA fallback, which is wired to `error_page 404`: the
page would render correctly in a browser while answering **404** to a shared
link, a crawler or a monitor. `e2e/account-prerender.spec.ts` asserts both
halves — that the files exist, and that they hold nobody's identity.

Route protection is therefore a **usability** boundary, not a security one.
`/account` is a static file nginx hands to anyone who asks; `app/auth/guard.tsx`
decides what it draws. Everything behind it is empty until the API answers, so
what a determined visitor gets by bypassing the check is the same skeleton the
crawler gets. **The API authorises every request itself**, and has to: this code
runs on hardware the reader controls.

### Talking to the API

Cookie-based, and every part of that has a consequence:

- The session cookie is `HttpOnly`, so JavaScript cannot read it and this code
  never tries. `GET /api/auth/me` is the only way the client learns who it is.
- Every request is same-origin and relative. The API is served under `/api` by
  the same reverse proxy, which is what lets the Content-Security-Policy keep
  `connect-src 'self'` with no host named — CI fails the build if an external
  origin ever appears in it.
- `credentials: "same-origin"`, not `"include"`. The two behave alike here and
  fail differently: `"include"` would keep sending the session cookie if a path
  ever became absolute.
- CSRF is a double-submit pair: the server sets a readable `sw5e_csrf` cookie
  alongside the HttpOnly session, and every state-changing request echoes it in
  `X-CSRF-Token`. An attacker on another origin can make a browser *send*
  cookies; it cannot *read* them, so it cannot produce the header.

`docker/default.conf` allows `publickey-credentials-create=(self)` and
`publickey-credentials-get=(self)` in `Permissions-Policy`, and CI asserts it.
Everything else stays denied. This matters more than it looks: the policy
previously disabled `publickey-credentials-get` outright, which would have
broken every sign-in **in production only** — the browser refuses the ceremony
with the same opaque `NotAllowedError` a reader gets for dismissing the prompt,
so it reads as though everyone cancelled, and nothing served without that
header can reproduce it.

### The API does not exist yet

It is being built to a fixed contract in the sibling repository. Until it
lands, both test suites drive `tests/auth-api-contract.ts` — one object,
wrapped as a `fetch` implementation for Vitest and as a `page.route` handler
for Playwright, so the two cannot drift into testing different servers. It is
mocked at the **network** boundary rather than over `app/auth/api.ts`, because
a mock one layer higher would let the credentials mode, the CSRF echo and the
error decoding all go untested.

The fixture is strict on purpose: it rejects a state-changing request with no
CSRF header, answers 401 rather than an empty 200 for an unauthenticated
`/me`, and refuses any WebAuthn assertion whose challenge it did not issue.
Replacing it with the real service means deleting two adapters.

Where the contract as specified could not answer a question this UI had to ask,
the gap is marked `CONTRACT GAP` in `app/auth/types.ts` rather than quietly
invented. Four of them: verification has to establish the session (there is no
other way for a brand-new account to reach passkey enrolment), `/me` has to
return MFA state and the credential list, credentials need a revocation
endpoint, and TOTP enrolment needs to return recovery codes.

### Passkeys in the real world

`app/auth/webauthn.ts` exists mostly to translate failures. WebAuthn reports
almost everything as `NotAllowedError` — a dismissed prompt, a timeout, and no
authenticator able to answer are one indistinguishable exception with an empty
message, because saying which would let a hostile page probe what hardware
someone owns. The module narrows that with what it legitimately knows (is the
API present, is the origin secure, is there a platform authenticator) and, where
ambiguity genuinely remains, says both possibilities plainly rather than
accusing a reader of cancelling something they did not.

Handled explicitly, and covered by tests: no WebAuthn at all; no platform
authenticator (warned about, never disabled — a security key or a phone still
answers); dismissed or timed-out prompt; a device that already holds a passkey
for the account; an authenticator with no user verification; an insecure
origin; and the API being unreachable, which must never be reported as "your
passkey was rejected".

`e2e/account.spec.ts` drives Chrome's virtual authenticator over the DevTools
protocol rather than stubbing `navigator.credentials`, so a credential is
really created, really signed, and really verified against the challenge that
issued it.

## Container image

The site ships as a container: a content stage carries the canonical library,
a Node stage builds the dataset from it and runs the prerender build, and the
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

The image renders the canonical content, not the committed fixture. A build
stage pulls `ghcr.io/christopherfowers/sw5e-database`, which carries the
canonical documents at `/opt/sw5e/content`, and the generator runs over them
before the prerender — 139 routes: the 132 content pages the API serves, plus
the seven account pages, which are the same in every build. The build fails
rather than falling back if that content does not arrive.

That makes this image's build depend on another repository's published one.
`SW5E_CONTENT_TAG` is how a build pins the content revision: it defaults to
`latest`, which follows that repository's default branch.

```bash
# Freeze the content at one commit of sw5e-database
docker build --build-arg SW5E_CONTENT_TAG=sha-<40-character-commit> -t sw5e-web .
```

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

The account area adds its own coverage (`e2e/account.spec.ts`, and the unit
tests beside each route): navigating the account sections and following one
with Enter alone, a focus ring on every control while tabbing through
credential management, focus moving to the new step at each stage of sign-in
and enrolment rather than being dropped on the body, each field's error
reachable from the field through `aria-describedby`, error messages announced
as `role="alert"` and confirmations as `role="status"`, and the TOTP secret
available as selectable text — a QR code cannot be read aloud, focused, or
scanned by the phone that is displaying it.

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
