# Content authoring API contract — as this client believes it

`docs/account-api-contract.md` exists because two repositories were fully green
while disagreeing on nearly every endpoint. There was no equivalent document for
`/api/authoring` when this client was written — the service's source *was* the
contract — so this is one, written from that source and from
`tests/authoring-api-stub.ts`, which enforces everything below.

Read it as a statement of what this client depends on. Anywhere it is wrong, the
client is wrong.

---

## Everything in this group

- Behind `CrossSiteRequestFilter`, so every unsafe method needs
  `Sec-Fetch-Site: same-origin` or an allow-listed `Origin`. The browser writes
  both and script cannot forge either, so this client sends nothing of its own.
  A refusal here is a **bodiless 403** — no problem document, no `code`. See
  `app/api/http.ts` for why that had to be readable from the status alone.
- Rate limited to **120 requests a minute**, fixed window, rejected with 429 and
  a `Retry-After`.
- Answered with **503 `authoring-unavailable`** on a deployment configured with
  a file-backed content store. That is a deployment being read-only by choice
  rather than a fault, and the interface says so in those terms.

## Who may do what

| Route | Policy | Roles |
|---|---|---|
| `GET /api/authoring/drafts` | `sw5e:contribute` | Contributor, Administrator |
| `GET /api/authoring/drafts/{type}/{key}` | `sw5e:contribute` | Contributor, Administrator |
| `PUT /api/authoring/drafts/{type}/{key}` | `sw5e:contribute` | Contributor, Administrator |
| `DELETE /api/authoring/drafts/{type}/{key}` | `sw5e:contribute` | Contributor, Administrator |
| `POST /api/authoring/drafts/{type}/{key}/publish` | **`sw5e:administer`** | **Administrator** |
| `GET /api/authoring/content/{type}/{key}/revisions` | `sw5e:contribute` | Contributor, Administrator |
| `GET /api/authoring/content/{type}/{key}/revisions/{id}` | `sw5e:contribute` | Contributor, Administrator |
| `POST /api/authoring/content/{type}/{key}/revert` | **`sw5e:administer`** | **Administrator** |

**Publishing and reverting need an administrator; drafting needs a
contributor.** That asymmetry is the reason the interface is two acts rather
than one save button, and it is not incidental — a contributor proposes a
correction and somebody with the books to hand agrees to it. See
`app/auth/roles.ts` and `app/routes/authoring-edit.tsx`.

Both policies also carry `StrongAuthenticationRequirement`: the account has to
hold the role *and* the session has to have used a passkey or an authenticator
code. An account that signed in with an emailed code is refused with **403 and
`code: "strong-authentication-required"`**, which is a different sentence from
a plain role refusal because it is a different situation — it clears in about a
minute. Branch on `code`, never on wording.

## Content types

`{type}` is the service's **canonical key**, which is singular:
`armor-property`, `class`, `species`. The service also accepts the plural route
segment and matches case-insensitively, and always answers with the canonical
key — so a client that asks with one spelling and compares with another decides
every draft belongs to a different document. This client sends canonical keys
everywhere.

`GET /api/content-types` is anonymous and answers the registry:

```jsonc
{ "types": [ { "key": "armor-property", "name": "Armor property",
               "pluralName": "Armor properties",
               "routeSegment": "armor-properties", "itemCount": 12 } ] }
```

Thirty-one types. This site browses twenty-seven of them; the four extra are the
credit records, which are site metadata and have no page of their own. They are
still editable, and are the most edited thing here.

`{key}` is a slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 128 characters.

## Drafts

`GET /api/authoring/drafts` takes **no query parameters at all** and is
**unpaged**. Every outstanding draft, `updatedAt` descending.

```jsonc
{ "drafts": [ { "type": "armor-property", "key": "bulky", "name": "Bulky",
                "targetExists": true, "baseRevisionIsCurrent": true,
                "createdByUserId": "…", "updatedByUserId": "…",
                "resolvesFlagId": null,
                "createdAt": "…", "updatedAt": "…" } ] }
```

`GET /api/authoring/drafts/{type}/{key}` answers a **different shape** — the
document, and `baseRevisionId` rather than `baseRevisionIsCurrent`:

```jsonc
{ "type": "armor-property", "key": "bulky", "document": { … },
  "createdByUserId": "…", "updatedByUserId": "…",
  "baseRevisionId": 41, "resolvesFlagId": null,
  "createdAt": "…", "updatedAt": "…" }
```

Neither shape carries both. 404 means there is no draft, which is an ordinary
answer rather than an error.

`PUT /api/authoring/drafts/{type}/{key}` answers **204**.

```jsonc
{ "document": { … }, "resolvesFlagId": "018f…" }
```

Three things about it that the interface is built around:

- `document` is the **whole document, not a patch**, and its `key` has to equal
  the key in the address.
- `resolvesFlagId` is **set-only**. Sending `null` later does not detach a link
  already stored, so this client never offers a control that would clear it.
- the base revision is **recaptured on every save**. Saving a draft that was
  started against an older revision silently replaces whatever was published in
  between, and the service does not refuse it. Noticing that is entirely the
  client's job.

`DELETE` answers 204, or 404 when there is no draft.

## Publishing

`POST /api/authoring/drafts/{type}/{key}/publish` answers **200** with a
revision summary. A body is **always** sent — `{ "reason": null }` if there is
nothing to say — because the handler answers 415 to a request with no
`Content-Type`.

```jsonc
{ "id": 42, "type": "armor-property", "key": "bulky", "number": 3,
  "action": "updated", "actorUserId": "…", "reason": null,
  "revertedFromId": null, "createdAt": "…" }
```

If the draft carried `resolvesFlagId` **and** that report is in `accepted`, the
report becomes `resolved` and records the revision. It is best-effort and not
transactional with the publish: a 200 does not guarantee the report closed.

### The 409

```jsonc
{ "title": "That document has moved on", "status": 409,
  "detail": "Somebody published a change to this document after this draft was started. …",
  "code": "draft-stale" }
```

**It carries nothing else.** No current revision id, no current document, no
base revision id — and there is no endpoint that re-bases a draft. Recovering
from it is a second round trip the client makes for itself, and re-saving the
draft is the only way to move its base. That is exactly why publishing in this
interface never quietly saves first: a save-then-publish would recapture the
base and erase the check.

## Revisions

`GET …/revisions?limit=` — `limit` defaults to 25, minimum 1, **maximum 100**.
There is no cursor and no offset, so a document with a longer history cannot be
read past its hundredth most recent change; the history page says so rather than
presenting a truncated list as a complete one. Newest first, bodies excluded.

A valid type with a key nobody has published answers **200 with an empty list**,
not 404. That is how this client tells "new document" from "unknown type".

`GET …/revisions/{id}` answers the summary plus `schemaVersion` and `document`.

**Diffs are deliberately not computed server-side.** Fetch two and compare them
— see `app/authoring/diff.ts` for what "changed" is taken to mean for a list.

`POST …/revert` requires a body, answers 200 with a **new** revision whose
`action` is `reverted` and whose `revertedFromId` names what was restored.
Nothing is deleted. The restored body is **re-validated against the schema as it
stands now**, so a revert can be refused with `schema-violation` like any other
write.

## Schema refusals

A refused write answers **400**, `application/problem+json`, with:

```jsonc
{ "title": "That change could not be saved", "status": 400,
  "code": "schema-violation",
  "schemaErrors": [
    ": required — Required properties [\"description\"] were not present",
    "/name: minLength — Value should have at least 1 character"
  ],
  "schemaViolations": [
    { "instanceLocation": "",
      "keyword": "required",
      "message": "Required properties [\"description\"] were not present" },
    { "instanceLocation": "/name",
      "keyword": "minLength",
      "message": "Value should have at least 1 character" }
  ] }
```

Two shapes of the same failures, in the same order, and both are sent.

**`schemaViolations`** is the one to read. `instanceLocation` is a JSON Pointer
— empty for the document root — and it is what lets an error be put beside the
control that caused it. `keyword` is a JSON Schema vocabulary term, so a client
can key its own wording off it rather than off prose; **it may be the empty
string**, because `additionalProperties: false` is implemented as a false
schema and a false schema fails with no keyword at all. `message` is the
validator's own sentence, written for somebody debugging a schema rather than
somebody correcting a rules page, so a client is expected to prefer its own
wording where it has one and show this where it does not.

**`schemaErrors`** is `string[]`, one line per violation, formatted
`{instance location}: {keyword} — {message}`. It predates the structured field
and is still sent: the browser application and the service are separate images,
either can be ahead of the other, and a client that only knows the lines has to
keep working. The array also carries lines with no location behind them at all —
a document that is not an object, a `key` that disagrees with its address, a
type with no schema published — and for those `schemaViolations` is empty.

`app/authoring/violations.ts` prefers the structured field and keeps a parser
for the lines. That parser treats itself as a bet it might lose: a line it
cannot read is shown in full, in the service's own words, above the form, so a
wrong guess puts a message in the wrong *place* and never loses one. It had
already lost that bet once — the false-schema line above has no keyword, the
pattern required one, and so a property that does not belong to a content type
could not be placed on a field.

A `required` failure is reported at the **parent's** location, with the missing
property names quoted in the message. Left there, every missing field on a
document stacks up at the root; the client moves each onto the property it
names. That is the one thing still read out of a message, and it is a fact
about the JSON Schema vocabulary rather than about this validator's prose.

## Schemas

`GET /api/authoring/schemas/{type}` answers the draft 2020-12 JSON Schema the
service validates that content type against:

```jsonc
{ "type": "armor-property", "version": 1, "schema": { "$schema": "…", … } }
```

This is the endpoint the companion change to `sw5e-api` added, and the reason it
was needed: thirty-one content types have thirty-one different shapes, and a
hand-built form per type does not scale and rots the first time a schema
changes. Generating the form from the same document the refusal is derived from
is what keeps the two from disagreeing.

**A 404 here is an answer, not an error.** A deployment that publishes no
schemas is one this client still has to open against, so the editor falls back
to editing the document as JSON — still validated by the service on save. A 403
is *not* converted: "this deployment has no schemas" and "your session may not
read them" are different facts.
