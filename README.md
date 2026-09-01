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
yet reach. Every type the site publishes has content behind it today — the
gap this mechanism was built for was maneuvers, and it is closed — but a type
mapped to nothing still gets an empty dataset and an index that says so,
rather than disappearing from the navigation or answering 404 on a link the
header offers. The site's type ids are plural because they are URL segments
and the canonical directories are singular, so the two are pinned to each
other rather than derived: `/maneuvers` is a published address and reads
`content/maneuver`. The `source` directory is
deliberately not published as a browsable type: the books are described in
`app/content/source-meta.ts`, which carries a blurb, a colour and a cover that
a data file cannot. The mapping and its reasoning
live in `scripts/lib/canonical.mjs`.

The traffic also runs the other way. The six starship types are canonical-only:
the archive holds their files, but three of them lost their structured columns
to the 2022 scrape — every numeric field on all six base sizes is zero, and
every piece of ammunition carries a name and a price and nothing else — and the
canonical documents have hull dice, tier tables, roles and ammunition damage
only because the import read them back out of the rules chapters. Mapping the
flat records here instead would publish a starship section that cannot say how
much hull a Small ship has, so `scripts/lib/normalize.mjs` records them with no
archive file rather than producing a poorer copy.

## The class graph

Four of the twenty-two types are not a catalogue but a graph, and they are mapped
together for that reason: a class, the three improvement rules that say what it
is worth to a character multiclassing in or out of it, the archetypes that
branch off it, and every feature any of those grants. Species join the same
graph from the side: 1,593 of the 2,682 features are species traits, and their
pages link back to the species that grants them.

`buildClassGraph` in `scripts/lib/canonical.mjs` walks all four sets of
documents once, before anything is normalized, and the pages are then built with
links rather than with their neighbours' text copied into them. A class page
carries its level table, a linked index of what it grants at each level, and
links to its archetypes and improvements; an archetype page carries the same
index and a link back to its class; a feature page links back to whatever grants
it.

**Features are browsable, and this changed.** They used to be a canonical
directory with no site type, on the grounds that every one of them is already
written out in the prose of the class, archetype or species that grants it, so
publishing them would show the same text twice. The duplication was real; the
conclusion was wrong. A feature is the unit a person actually looks up — nobody
asks what Soresu Form says, they ask what Deflection does, mid-turn, and expect
to search for it by name and send someone the link. Unpublished, all 2,682 of
them were reachable only by opening one of 288 long pages and reading, and
search could only ever answer with the parent whose prose happened to contain
the words. They are also the far end of every level grant in the corpus: a class
table that names what arrives at 7th level has nothing to point at unless the
thing it names has a page.

At 2,682 documents this is the largest content type on the site by some
distance, and it is what the build-time figures below are mostly about.

The duplication is handled rather than avoided. A class or archetype still
prints its own page in full — 38 features carry a sentence their parent's prose
lost, and a parent's own tables and introductions belong to no feature at all,
so dropping either side would lose content. What the parent gains is a table of
contents, not a second copy.

A feature's URL is its canonical key — `/features/class-berserker-rage-1` —
rather than its name. Forty features are called "Ability Score Improvement",
a dozen classes grant an "Extra Attack", and hundreds of species traits share
names across species; a slug built from the name would put them all on one
page, or resolve the collision with a numeric suffix that moves whenever the
corpus grows.

### The credits — one document, always complete

`app/data/credits.json` is generated from the same canonical set and committed:

```bash
node scripts/build-credits.mjs --content ../sw5e-database/content
```

It is deliberately outside the fixture/generated split that the game content
uses. That split exists because a contributor without the archive still needs
the UI to render, and four species is enough to prove a species page works.
Credits do not work that way: four patrons out of three hundred and eighty-four
is not a smaller credits list, it is a wrong one, and wrong in the way that
matters — it leaves people out. So there is one document, it is complete, and
it is reviewed like the content it came from.

It also carries a citation for every one of the site's 150 pictures, which is
what lets a species page print the credit for its own portrait rather than
pointing at a bulk list. `app/content/credits.test.ts` fails the build if a
picture exists with no citation behind it, which is the contract any future
image upload has to satisfy: attribution is captured when the artist is still
known, or it is never captured at all.

### The committed fixture — what a clean clone falls back to

`app/data/fixture` is four items per type, committed so that `npm test`,
`npm run build` and CI all work for a contributor with neither of the other
two sources to hand. It is built from the legacy archive, so the six starship
types are empty in it: they are canonical-only, for the reason given above.
Their indexes render as empty as `maneuvers` does.

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

### What that costs

Prerendering is nearly the whole build, and it does not scale linearly.
Measured on one machine, warm cache, same hardware both ways:

| Dataset | Documents | Routes | Build | Output |
|---|---|---|---|---|
| Canonical, before the class graph | 2,239 | 2,273 | 3m18s | 53 MB |
| Canonical, with it | 5,092 | 5,129 | 26m46s | 113 MB |
| Committed fixture | 84 | 126 | seconds | — |

Forty-two routes in each total are fixed — the home page, search, the sources
index and its five book pages, one index per content type, and the seven account
pages — and do not vary with the dataset.

Adding the enhanced items, the property glossaries, the rules and the reference
tables puts another 2,099 documents on top of that, for roughly 7,230 routes.

**The table above is a Windows developer-machine measurement, and it is the
pessimistic one.** The same full-corpus prerender runs inside the `Container
image` CI job, and on a Linux runner the whole image build — dependency install,
client bundle and all 5,129 routes — takes **369 seconds**. That is 72ms per
route against the 313ms above: a 4.3x difference in the platform, not in the
work. Whatever is making the curve bend, most of it does not survive the trip to
CI, and CI is where the number that matters is measured.

The developer machine is worth recording anyway, because it is now failing
rather than merely being slow. Two runs at this corpus size ended before
finishing: one stopped at 2,117 of the expected routes with no error written,
and one stopped at 3,005 with `Prerender: Request failed` on a route belonging
to `features`. Neither is caused by the content added most recently — the first
of those two was the corpus *without* it — and both ran on a box that also had a
dev server resident, so treat them as a warning about local builds rather than a
property of the pipeline. Build locally from the committed fixture; let CI build
the corpus.

**2.3 times the routes cost 8.1 times the time**: 87ms per route became 313ms.
That is the number to argue about, not the total. Whatever the cause — one
long-lived Node process rendering five thousand pages in sequence is the obvious
suspect — the shape of the curve says the next content type of this size will
not simply add its own share, and "prerender everything, serially" is close to
the end of its useful life. Two levers are already visible and neither has been
pulled here:

- React Router's prerender `concurrency`, which defaults to 1. It was tried and
  put back, because on Windows the prerender client gives every request its own
  socket with `Connection: close` and four at once made the very first request
  fail outright. CI is Linux and it may well be free there.
- Not prerendering every item of every type. The reader-facing argument for
  static HTML is search-engine visibility and instant loads, and both are worth
  most on the pages people actually land on.

### Long indexes are windowed

`/features` used to publish all 2,682 of its rows: 2.1 MB of HTML and 40,342
elements. That is not a download problem — nginx gzips it and it is one document
rather than a request per row — it is a main-thread problem. The browser parses
and lays out every one of those elements and then hands them to React to
hydrate, in a single block, before the page can respond to anything. It did not
load slowly; it arrived and then froze, with the header's line art briefly drawn
at full size behind it.

A type index now draws the first hundred rows and reveals the rest on request
(`WINDOW` in `app/components/content-list.tsx`), and publishes every remaining
entry underneath as a plain list of links. That list is rendered as one
`dangerouslySetInnerHTML` string, which React does not walk during hydration, so
2,682 anchors cost one node of hydration work instead of eight thousand.

| Index | before | after | after, gzipped |
| --- | ---: | ---: | ---: |
| `/features` | 2,128,468 | 772,736 | 103,299 |
| `/equipment` | 445,386 | 217,608 | 30,798 |
| `/powers` | 407,795 | 203,643 | 25,445 |
| `/monsters` | 213,745 | 144,071 | 20,685 |
| `/starship-modifications` | 208,569 | 145,279 | 16,972 |

`/features` goes from 40,342 elements to 7,490, of which only 2,126 are
hydrated. What is left of its weight is the loader payload — the summaries the
browser filters and sorts against — which is the part that cannot be windowed
without breaking the filter.

Pagination and virtualisation were both considered and neither fits a
prerendered site. Real pagination needs a server to read `?page=`, or one
prerendered route per page, and routes are the build's entire cost.
Virtualisation needs measured scroll geometry, which does not exist at build
time, so the static HTML would contain no rows at all — the opposite of why this
site prerenders. Windowing keeps real markup in the static file and hydrates
cleanly, because the server and the browser start from the same constant.

The container job asserts both halves against the real content image: the page
must be under a megabyte, and it must still link every entry the image was built
from. A budget on its own would pass on an index that had quietly dropped its
catalogue.

Deployment note: the static host must resolve `/species/wookiee` to
`species/wookiee/index.html`, which Netlify, Cloudflare Pages, GitHub Pages and
S3 website hosting all do. `vite preview` does not, so this repository adds a
small preview middleware (`vite.config.ts`) to make local preview behave the
same way.

## Navigation

Twenty-two content types will not fit in a flat strip. The header carried one
link per type until it did not: it scrolled sideways at every width, needed a
fade at its edge to admit that it did, and asked a reader to scan twenty-three
items to find one. Adding a type made it worse, and enhanced items, the property
glossaries and the rules are all still to come.

The types are grouped by the subject a reader is in the middle of — building a
character, resolving a fight, buying gear, flying a ship, running a creature,
looking a rule up — and the header carries the subjects:

| Group | Types |
| --- | --- |
| Characters | species, classes, archetypes, features, backgrounds, feats · *class improvements* |
| Combat | powers, maneuvers, fighting styles, fighting masteries, lightsaber forms, weapon focuses, weapon supremacies |
| Gear | equipment |
| Starships | hulls, deployments, ship equipment, modifications, ventures, starship rules |
| Bestiary | creatures |
| Reference | source books |

The count is not a target; it fell out of the material, and it will change. Gear
is one type today and four once enhanced items and the two property glossaries
land. A group with a single destination renders as a plain link rather than a
disclosure, so Gear and Bestiary are one click today and become menus on their
own the moment they grow.

The italicised types are **supporting**: reached from the thing that references
them rather than browsed. Nobody opens `/class-improvements` to read it end to
end; they arrive from a class that grants one. A supporting type keeps its index
page, its prerendered routes and its place in search — it is listed under the
primary destinations in the menu rather than competing with them.

Interaction is a disclosure menu in the header plus a rail beside the page, and
the two answer different questions. The menu answers "take me elsewhere". The
rail is pinned to the group the reader is already in and answers "where am I,
and what is beside me", so moving from maneuvers to fighting styles costs no
round trip through a menu. The rail is hidden below 64rem, where there is no
room for it and the menus already do both jobs.

Both are built on `<details>`/`<summary>`, so they open without JavaScript —
every page here is static HTML, and a menu that needed hydration would put most
of the site's destinations behind a bundle. JavaScript adds only what native
disclosure lacks: an explicit `aria-expanded`, one menu open at a time, Escape
to close and hand focus back, and dismissal on click-away or navigation. Nothing
opens on hover.

### The grouping is a compile error, not a convention

`TYPE_NAV` in `app/content/nav-groups.ts` is a `Record<ContentTypeId,
TypePlacement>`, so a content type added to `CONTENT_TYPE_IDS` without being
placed fails `npm run typecheck` with its own name in the message. This is the
same trick `SummaryByType` uses in `app/content/types.ts`, and for the same
reason: without it the missing type simply would not appear in navigation, every
test would stay green, and the only symptom would be a page nobody can reach
from the header. `app/content/nav-groups.test.ts` compiles the real source with
one arm deleted and asserts that the build breaks, so the guard cannot be
softened to a `Partial` without something going red.

`{ group: "none", reason: ... }` is the escape hatch, and it has to be written
out. The credits types are site metadata rather than game content and belong in
the footer, which already links them; saying so explicitly costs a line and
keeps the exhaustiveness check catching the types nobody thought about.

Two things are deliberately not modelled. **Tools** — the character builder, the
ship builder, PDF export — will be a peer of these groups in the header rather
than a group inside it: it is not a subject of the reference, it is a different
thing to do with one. **Homebrew** is a facet on the types that already exist, a
filter on the powers index rather than a section of its own, which is why
nothing here is shaped as "official" versus "community".

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
| `/verify-email` | The other end of the emailed link, and the first passkey |
| `/sign-in` | Passkey sign-in, plus the TOTP challenge when one is set |
| `/account` | Profile, role, and how well protected the account is |
| `/account/passkeys` | Add and revoke credentials |
| `/account/security` | Enrol an authenticator app |
| `/account/contributions` | Contributor-only |

### Roles

Three, each including everything below it — `app/auth/roles.ts` is the only
place that decides:

The names below are the wire strings, spelled as the service spells them —
capitalised, and the highest one is `Administrator`. They are case-sensitive,
and getting one wrong is silent: an unrecognised role falls back to `Community`,
so a misspelled list quietly demotes everybody rather than failing.

| Role | May |
|---|---|
| `Community` | Read everything, and manage their own account. The default. |
| `Contributor` | …and upload or correct base game content. |
| `Administrator` | …and manage other accounts and their roles. |

Only `Contributor` and `Administrator` can be granted through
`PUT /api/auth/admin/users/{userId}/roles`; `Community` is the floor every
account already stands on, and the API rejects it as an assignable role.

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
- Cross-site requests are refused by provenance, not by a token. The API
  requires every unsafe method to arrive with `Sec-Fetch-Site: same-origin` or
  an allow-listed `Origin`, and answers a bodiless **403** to anything else.
  The browser writes both headers itself and script cannot forge either, so
  this client sends nothing extra — no `X-CSRF-Token`, and no readable CSRF
  cookie to look after. The same-site-subdomain case double-submit is usually
  defended for is covered too: a subdomain is a different origin, and a
  different origin is not on the allow-list.
- Errors are RFC 9457 problem documents (`application/problem+json`, message in
  `detail`), and several refusals carry no body at all — the anonymous 401 and
  the cross-site 403 among them. `app/auth/api.ts` therefore decides *what* a
  failure is from the status and only *how to word it* from the body.

`docker/default.conf` allows `publickey-credentials-create=(self)` and
`publickey-credentials-get=(self)` in `Permissions-Policy`, and CI asserts it.
Everything else stays denied. This matters more than it looks: the policy
previously disabled `publickey-credentials-get` outright, which would have
broken every sign-in **in production only** — the browser refuses the ceremony
with the same opaque `NotAllowedError` a reader gets for dismissing the prompt,
so it reads as though everyone cancelled, and nothing served without that
header can reproduce it.

### The contract, and the fixture that models it

`docs/account-api-contract.md` is the reconciled wire contract, verified
against the running QA deployment and the API source. It is the authority; if
this client and that document disagree, the client is wrong.

It is worth saying why it exists. This client was first written from a written
specification while the service was built separately, and it turned out to
disagree with the service on nearly everything that mattered — an envelope on
`/me` that was not there, `mfa.totp` for what the API calls `twoFactorEnabled`,
a `publicKey` wrapper around WebAuthn options that arrive unwrapped, `label`
where the field is `name`, `mfa-required` where the literal is `mfaRequired`,
lowercase role names where the service sends `Community`, `Contributor` and
`Administrator`, and a CSRF scheme the API does not implement. All of it
type-checked. All of it passed a full test suite — because the fixture had been
written from the same assumptions as the client, so the two agreed with each
other and neither was ever compared with the server.

That is the failure mode a shared fixture has to be built against. Both test
suites drive `tests/auth-api-contract.ts` — one object, wrapped as a `fetch`
implementation for Vitest and as a `page.route` handler for Playwright, so the
two cannot drift into testing different servers. It is mocked at the **network**
boundary rather than over `app/auth/api.ts`, because a mock one layer higher
would let the credentials mode, the header set and the error decoding all go
untested. And it is a model of the *server*: the moment it starts being written
to match the client, it loses the ability to fail.

It is strict on purpose. It answers a bodiless 403 to any unsafe method whose
`Origin` is not the page's, answers 401 rather than an empty 200 for an
unauthenticated `/me`, refuses any WebAuthn assertion whose challenge it did not
issue, and refuses to remove an account's last credential. Replacing it with the
real service means deleting two adapters.

One consequence worth knowing before reading the flow: **verifying an email
address does not sign anybody in.** It sets a ten-minute HttpOnly enrolment
ticket that authorises passkey registration and nothing else, so
`app/routes/verify-email.tsx` runs the enrolment ceremony itself rather than
linking into the account area — which is guarded on having a session the reader
does not yet have.

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

## Reporting a problem

The first thing on this site that sends anything a reader wrote to a server.

A **report** is raised from the page or the picture it is about. It never
changes what it points at: the API stores it in a schema of its own and the
reference is served from somewhere else entirely. What it produces is a queue,
and the queue is the point — around a hundred and fifty of the pictures this
site publishes were inherited from the original sw5e.com with no record of who
drew them, the credit under each one says so, and the only people who can close
that gap are readers who recognise the work.

### Where the control lives

At the foot of a content page, and under the caption of every picture the build
carries. It is one quiet line of text, collapsed, and it stays that way until
somebody asks for it — this is a reference people read at the table, not a
moderation tool with a reference attached.

Under an uncredited picture it changes its wording to **“Do you know who made
this?”**, because the caption directly above has just said the artist was never
recorded, and the next line a reader who recognises the work should meet is the
question rather than a generic offer to complain.

A picture is reported through its attribution record — API content type
`asset-credit`, key `{group}-{key}`, the same `species-wookiee` naming
`app/content/imagery.ts` resolves the files by — so the report lands on exactly
the document a reviewer edits to write the credit.

### What a reader can say

Ten reasons, five about pictures, four about writing, and `other`. The menu is
chosen by what is being reported, so nobody is offered “this does not match the
book” about a portrait. `app/flags/reasons.ts` holds the wording; the service
owns the taxonomy. The two are separate because the service's names are routing
keys and the question a reader is answering is “what is wrong with this?” — a
menu of routing keys gets the wrong answer picked, and a wrongly-routed report
lands in a queue somebody has already decided not to work today.

### `/account/flags`

One route, two audiences. Every signed-in account sees what it reported and
what became of it; a contributor sees the review queue underneath. That is one
address rather than two on purpose: reporting is intended to open wider over
time, and a site where “your reports” and “the queue” are separate pages is one
where widening the first means inventing the second's navigation again.

Like every other page in the account area it exports **no `loader`**. A loader
here would run once on a build machine and write its result into a file served
to everybody — which for a moderation queue means the display name of everyone
who had reported anything, behind a CDN.
`app/auth/prerender-safety.test.ts` fails the build if one appears.

Adding the route raised the prerendered page count by one, from 44 to 45
content-free pages. `react-router.config.ts` lists it and the container job in
`.github/workflows/ci.yml` does the arithmetic.

### Untrusted text

Report details, reviewer notes and display names are all written by people, and
all three are rendered to contributors and administrators. Every one of them is
a text node. There is no raw-HTML escape hatch anywhere on the reports page or
in the reporting control, none of it goes near `app/content/markdown.ts`, and
`app/routes/account-flags.test.tsx` searches both files by name to keep it that
way — including in comments, which is where the prop lands first when somebody
is about to reach for it.

The escaping tests assert that no element was created, not that the payload
“looks escaped”. A test for the absence of the literal text would pass on a page
that had just executed it.

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
page. The header's group menus add their own (`e2e/navigation.spec.ts`): opened
with Enter from the keyboard, reporting `aria-expanded` against their real
state, closing on Escape without stranding focus on something now hidden, and
opening at all with JavaScript switched off. Unit tests cover heading order on
item pages, `aria-sort` on sortable columns, and focus landing on the first
newly revealed row when a long index is expanded.

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
