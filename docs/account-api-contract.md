# Account API contract — reconciled

Authoritative wire contract for `/api/auth`, verified against the running QA
deployment and the API source rather than inferred from a written specification.
This client was originally built against the specification alone, and disagreed
with the service on most of what follows; where this document and the code
disagree, this document wins.

All bodies are JSON; property names are camelCase exactly as written here.
Errors are RFC 9457 problem documents with `application/problem+json` and a
`detail` string.

## Cross-site request protection

There is **no** CSRF token and no `sw5e_csrf` cookie. The API refuses any unsafe
method whose `Sec-Fetch-Site` is not `same-origin` and whose `Origin` is not in
the configured allow-list, with a bodiless **403**. Confirmed live:

- no `Origin` header -> 403
- `Origin: https://evil.example` -> 403
- `Origin: https://sw5e.cfowers.io` -> 200

The browser sets `Origin` itself on same-origin state-changing fetches, so a
same-origin client needs to do nothing. Clients MUST NOT send `X-CSRF-Token`
and MUST NOT expect a readable CSRF cookie.

## Session

The session is an HttpOnly `__Host-` cookie, `SameSite=Strict`, `Secure`.
Never readable from script. `GET /api/auth/me` is the only way to read it.

Short-lived server-written state also travels in HttpOnly cookies:
`__Host-sw5e.enrol` (enrolment ticket), `__Host-sw5e.pk-register`,
`__Host-sw5e.pk-login` (WebAuthn challenges).

---

## `POST /api/auth/register` — 202

Request: `{ "email": string, "displayName": string }`

Response (identical whether or not the address exists):
```json
{ "status": "pending", "message": "If that address can be registered, ..." }
```

## `POST /api/auth/email/verify` — 200

Request: `{ "email": string, "token": string }`  <- **both fields required**

Response:
```json
{ "status": "verified", "enrollmentExpiresAt": "2026-08-30T19:52:11.123+00:00" }
```

**Verification does not sign you in.** It sets the enrolment-ticket cookie,
which authorises `passkey/register/begin` and `passkey/register/complete` for
the next 10 minutes and nothing else. `GET /api/auth/me` still answers 401.
This is how a new account enrols its first passkey; there is no dead end.
Invalid/expired token -> 400.

## `POST /api/auth/passkey/register/begin` — 200

No request body. Authorised by a session **or** an enrolment ticket.

Response is the WebAuthn creation options document **unwrapped** — there is no
`publicKey` envelope. Top-level keys are `rp`, `user`, `challenge`,
`pubKeyCredParams`, `timeout`, `excludeCredentials`, `authenticatorSelection`,
`attestation`, `hints`, `extensions`. It is exactly what
`PublicKeyCredential.parseCreationOptionsFromJSON()` accepts.

401 when the caller has neither a session nor a ticket.

## `POST /api/auth/passkey/register/complete` — 201

Request: `{ "credential": <PublicKeyCredential.toJSON()>, "name": string|null }`
— the label field is **`name`**, not `label`.

Response:
```json
{ "credentialId": "base64url", "name": "Work laptop", "createdAt": "2026-...Z" }
```
`name` may be null. Completing enrolment does **not** sign you in; the client
follows it with an ordinary passkey sign-in.

## `POST /api/auth/passkey/login/begin` — 200

Request body is ignored entirely. The API never accepts an email address here
and always answers with an empty `allowCredentials`, so the response is
identical for every caller. **Clients must not offer an email field.**

Response is the request-options document **unwrapped**:
```json
{ "challenge": "...", "timeout": 120000, "rpId": "sw5e.cfowers.io",
  "allowCredentials": [], "userVerification": "required", "hints": [] }
```

## `POST /api/auth/passkey/login/complete` — 200

Request: `{ "credential": <PublicKeyCredential.toJSON()> }`

Response is one of:
```json
{ "status": "authenticated", "user": { ...CurrentUser } }
{ "status": "mfaRequired", "user": null }
```
Note the literal is **`mfaRequired`** (camelCase, no hyphen), and the
`mfaRequired` branch carries **no** `methods` array and no account detail at
all. Every failure is 401 with the same wording.

## `POST /api/auth/email/code` — 202

Anonymous. Request: `{ "email": string }`

Response, **always 202 and always this shape**:
```json
{ "status": "pending",
  "message": "If that address has an account, a sign-in code is on its way.",
  "resendAfterSeconds": 60, "expiresInSeconds": 600 }
```

**The answer is identical whether or not the address has an account, and
whether or not it has any budget left.** Same status, same body, same wording.
That is the whole point of the endpoint's design and it is the same rule
`register` follows: any observable difference — a different status, a different
sentence, a measurably different delay — turns this into a way to ask the
service which of a list of addresses are registered. **Clients must not branch
on this response**, and must not word the next screen differently for an
address they think they recognise. There is nothing in the body to recognise it
by.

The address decides exactly one thing, and it is invisible from the client:
whether a code is actually issued. An unregistered address, or a registered one
over its budget, gets this reply and no email.

`resendAfterSeconds` and `expiresInSeconds` are the server's own numbers.
Clients must use them rather than hard-coding 60 and 600, which are merely what
they are today.

Rate limits, all enforced server-side and none of them the client's to
reimplement:

- **5 requests per 15 minutes per caller** (per IP). Exceeding it is the one
  refusal this endpoint may show, because it is about the caller and not about
  any address: **429** problem document.
- **3 codes per address per 15 minutes.** Exceeding it is invisible — still a
  202, still the same body, no email sent.
- **60-second resend cooldown** per address, reported as `resendAfterSeconds`.
- **10-minute lifetime** per code, reported as `expiresInSeconds`.
- **5 attempts per code**, spent on `email/code/verify` below.

400 for a malformed address. Saying so leaks nothing: the caller already knows
what they typed.

## `POST /api/auth/email/code/verify` — 200

Anonymous. Request: `{ "email": string, "code": string }` — six digits, and
**both fields are required**. A code is issued *for* an address and the server
checks the pair, so submitting a valid code with a different address fails
exactly as a wrong code does.

Response is one of, with the same literals as the passkey path:
```json
{ "status": "authenticated", "user": { ...CurrentUser } }
{ "status": "mfaRequired", "user": null }
```

`mfaRequired` means the account has an authenticator app, and the client must
now post to **`POST /api/auth/mfa/totp/verify`** — the same second step the
passkey flow already uses, not a parallel one. The cookie set alongside this
reply carries what that call needs. The code is spent at this point whether or
not the second leg is completed.

**Every failure is 401, with no distinction drawn between any of them:** wrong
code, expired code, code already redeemed, code issued for a different address,
attempts exhausted, unknown address, locked-out account. The wording is the
same for all seven. A client must not invent the distinction back — "that code
has expired" told to somebody guessing is confirmation that the address they
guessed has an account.

429 on the existing sensitive per-IP budget.

## Strong authentication, and the second 403

Three fields on `CurrentUser` describe **the session**, not the account. The
distinction matters: `passkeys` and `twoFactorEnabled` are the same on every
device, while these describe the browser holding the cookie right now.

- **`authenticationMethod`**: `"passkey" | "totp" | "email" | null`. How this
  session was established. `null` is a session that predates the field — still
  valid, and a client must treat it as "no claim either way" rather than as the
  weakest answer.
- **`strongAuthentication`**: whether that method counts as a second factor.
  True for `passkey` and `totp`, false for `email`. An emailed code proves
  control of an inbox and nothing about a device, so the session it creates is
  deliberately weaker than the account it belongs to.
- **`secondFactorRequired`**: whether this account's roles oblige it to hold a
  passkey or an authenticator app. True for `Contributor` and `Administrator`.
  Answered by the server rather than computed from `roles`, so a policy change
  does not need a client deploy to be obeyed.

Contributor and administrator actions require `strongAuthentication`. A session
established with an emailed code alone is refused with **403** and
`code: "strong-authentication-required"`, plus a `detail` explaining that a
passkey or an authenticator app is needed.

That is **not** the same refusal as the plain 403 for an account that does not
hold the role. The first is final; this one is temporary and the reader is
about a minute from clearing it. Clients branch on `code` and say so — see
`app/routes/account-passkeys.tsx` for the same pattern applied to
`last-credential`.

## `GET /api/auth/me` — 200

No envelope — the account object is the whole body:
```json
{
  "id": "0198e0...",
  "email": "reader@example.com",
  "displayName": "Jen Ordo",
  "roles": ["Community"],
  "twoFactorEnabled": false,
  "passkeys": [
    { "id": "base64url", "name": "Work laptop", "createdAt": "2026-...Z" }
  ],
  "authenticationMethod": "passkey",
  "strongAuthentication": true,
  "secondFactorRequired": false
}
```
- The field is **`twoFactorEnabled`**, not `mfa.totp`.
- `passkeys` is a list, not a count. `name` may be null.
- There is **no `lastUsedAt`**: the framework's passkey record does not track
  one, and inventing a value would be worse than omitting it.
- `authenticationMethod`, `strongAuthentication` and `secondFactorRequired`
  describe **this session**, not the account — see "Strong authentication, and
  the second 403" above. `authenticationMethod` may be null for a session
  established before the service recorded it.
- `roles` is sorted ordinal. The values are **`Community`**, **`Contributor`**,
  **`Administrator`** — capitalised, and the highest one is spelled
  `Administrator`, not `admin`. These are the names seeded into the database
  and used by the authorization policies.

401 when there is no session. It carries a problem document, but a client must
not depend on that: the refusal is raised by the authentication handler rather
than by the endpoint, and a reverse proxy in front of the service can answer
with no body at all. Decide the outcome from the status code and use the body
only to improve the message.

## `DELETE /api/auth/passkey/{credentialId}` — 200

Requires a session. `credentialId` is the base64url id, percent-encoded into
the path.

Response: `{ "status": "removed" }`

- 401 no session
- 404 no such credential on this account
- 409 `{ "code": "last-credential" }` when it is the only credential left —
  removing it would strand the account.

## `POST /api/auth/mfa/totp/enroll` — 200

Requires a session. No request body.
```json
{ "sharedKey": "abcd efgh ijkl mnop", "authenticatorUri": "otpauth://totp/..." }
```
Fields are **`sharedKey`** and **`authenticatorUri`**. Two-factor is not on yet.

## `POST /api/auth/mfa/totp/verify` — 200

Request: `{ "code": "123456" }`

One endpoint, two jobs, selected by server-written cookie state and never by
the body:

- caller holds the pending two-factor cookie (mid sign-in):
  `{ "status": "authenticated", "user": { ...CurrentUser } }`
- caller has a session (finishing enrolment):
  `{ "status": "enabled", "recoveryCodes": ["...", ... 10 items] }`

The enrolment literal is **`enabled`**, not `enrolled`. Recovery codes **are**
returned, exactly once, and only here. Wrong code -> 400 on the enrolment
branch, 401 on the sign-in branch.

## `POST /api/auth/logout` — 204

Anonymous and idempotent. Clears the session plus every half-finished flow.

## `PUT /api/auth/admin/users/{userId}/roles` — 200

Administrators only. Declares the full desired role set; anything absent is
revoked.

Request: `{ "roles": ["Contributor"] }` — only `Contributor` and
`Administrator` may be assigned. `Community` is the floor every account stands
on and is rejected.
Response:
`{ "userId": "guid", "roles": ["Community", "Contributor"],
   "awaitingSecondFactor": false }`

`awaitingSecondFactor` is true when the grant landed on an account holding
neither a passkey nor an authenticator app — so it now has a role it cannot
use until it enrols one, because every contributor and administrator call will
answer 403 `strong-authentication-required` to it. Worth reporting rather than
swallowing: an administrator who grants `Contributor` and hears nothing has
every reason to believe the person can now upload, while the person meets a 403
and reads it as the grant having failed.

400 unknown role, 401, 403 not an administrator, 403
`strong-authentication-required` when the administrator's own session was
established with an emailed code, 404 no such account.

## `GET /api/auth/admin/users` — 200

Administrators only, and only from a session established with a passkey or an
authenticator app. This is the account directory, and it is **the only response
on the platform that carries somebody else's email address**.

Query: `q` (email or display name, case-insensitive, 2–254 characters),
`role` (`Community` | `Contributor` | `Administrator`), `status` (`active` |
`suspended` | `unverified` | `all`), `page`, `pageSize` (default 25, max 100).
An unrecognised `role` or `status`, or a `q` shorter than two characters, is a
**400** rather than an ignored filter.

```json
{
  "users": [
    {
      "id": "guid",
      "email": "reader@example.test",
      "displayName": "Jaina",
      "roles": ["Community"],
      "emailConfirmed": true,
      "twoFactorEnabled": false,
      "secondFactorEnrolled": true,
      "lockedOut": false,
      "suspension": null,
      "createdAt": "2026-09-01T12:00:00+00:00"
    }
  ],
  "page": 1,
  "pageSize": 25,
  "totalCount": 1,
  "totalPages": 1
}
```

`suspension` is `null` or
`{ "at": "...", "reason": "...", "byUserId": "guid" }`. Not suspended is the
*absence* of a suspension, so a client has one question to ask rather than two.

`secondFactorEnrolled` is whether the account holds a passkey or an
authenticator — that is, whether granting it `Contributor` will produce a role
it can actually use. It is not a credential list; no credential identifiers,
public keys or counters leave the store for a directory listing.

`lockedOut` is the framework counting failed attempts, expires by itself, and
can be caused by any stranger who knows an address. It is not a suspension and
a client must not render the two alike.

401, 403 not an administrator, 403 `strong-authentication-required`.

## `GET /api/auth/admin/users/{userId}` — 200

`{ "user": { ...AdminUser }, "outstandingDrafts": 0 }`

`outstandingDrafts` is `null` on a deployment that serves content from files and
has no authoring at all — not `0`, so an interface does not draw "0 drafts"
beside an account where the concept does not exist. It is the one thing that
will refuse a deletion, which is why it is readable before trying one.

401, 403, 404 no such account.

## `PUT /api/auth/admin/users/{userId}/suspension` — 200

Request: `{ "suspended": true, "reason": "..." }` or `{ "suspended": false }`.

Declarative, like the role grant. `reason` is **required** when suspending and
**refused** when reinstating — there is nowhere to store the second, and
accepting it would mean an administrator writing an explanation that goes
nowhere. The reason is never disclosed to the account it is about.

Response: `{ "userId": "guid", "suspension": { ... } | null }`

A suspended account cannot obtain a session by any route — the passkey
assertion, the emailed code and the authenticator step all answer the same
`401` every other sign-in failure gets — and any session it already had stops
working on its very next request. Its passkeys stay on the account and are
inert, so reinstating restores access rather than requiring re-credentialling.

400 missing flag, missing reason, reason on a reinstatement, own account,
already in that state. 401, 403, 404.

## `DELETE /api/auth/admin/users/{userId}` — 200

Optional body: `{ "reason": "..." }`. In the body rather than a query string,
because a sentence naming a person does not belong in a URL every access log
writes down. The body is optional; a bodiless `DELETE` is accepted.

Response: `{ "userId": "guid", "authorshipRetained": true }`

Removes the account and everything identifying it. Does **not** remove what it
wrote: content revisions keep `actorUserId` and moderation reports keep their
reporter identifier, and both render afterwards as a removed account — which on
the flag queue is `reporter.displayName === null`, the state that contract
already documented.

400 own account. 401, 403, 404 no such account. **409** with
`code: "drafts-outstanding"` and a `draftCount` extension while the account owns
unpublished drafts.

## `GET /api/auth/admin/audit` — 200

Every role change, suspension, reinstatement and deletion, newest first. Query:
`subjectId`, `actorId`, `action`, `page`, `pageSize`.

```json
{
  "actions": [
    {
      "id": "guid",
      "action": "roles-changed",
      "actorUserId": "guid",
      "actorDisplayName": "Jaina",
      "subjectUserId": "guid",
      "subjectDisplayName": "Zeb",
      "rolesBefore": null,
      "rolesAfter": ["Contributor"],
      "reason": null,
      "createdAt": "2026-09-01T12:00:00+00:00"
    }
  ],
  "page": 1,
  "pageSize": 25,
  "totalCount": 1,
  "totalPages": 1
}
```

`action` is one of `roles-changed`, `account-suspended`, `account-reinstated`,
`account-deleted` — hyphenated and lower case, which is also what is stored.

The display names are copies taken at the time, so an entry stays readable after
either account has gone; that is what makes the `account-deleted` entry worth
anything. Email addresses are never copied into the log.

`rolesBefore` and `rolesAfter` list only assignable roles, so `null` means "held
no assignable role" as well as "this action was not about roles". `action` is
what tells those apart.
