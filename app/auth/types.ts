/**
 * The shape of the account API, written down.
 *
 * These types are no longer a guess. The service is built in the sibling
 * repository, and every shape below has been checked against the running QA
 * deployment and against the API source; `docs/account-api-contract.md` is the
 * reconciled contract this file implements, endpoint by endpoint. Where the two
 * ever disagree, that document is the one that was verified.
 *
 * The reason to say so plainly is that an earlier version of this file was
 * written from a specification alone, and was wrong about most of it — the
 * envelope on `/me`, the name of the two-factor flag, the shape of the WebAuthn
 * options, the spelling of the MFA literal. All of it type-checked, and all of
 * it passed a test suite that had been written from the same wrong assumptions.
 *
 * Nothing in here is a session token. The session lives in an HttpOnly cookie
 * that this code cannot read and must never try to; `GET /api/auth/me` is the
 * only way the browser learns who it is.
 */

/**
 * What a signed-in account is allowed to do.
 *
 * Ordered from least to most privileged so that `roles.ts` can express "at
 * least a contributor" as a comparison rather than as a list of every role
 * that qualifies — a list is the thing that gets forgotten when a role is
 * added.
 *
 * These are wire strings, and they are spelled exactly as the service spells
 * them: capitalised, and the highest one is `Administrator` rather than
 * `admin`. That is not a style choice this repository gets to make. These
 * names are seeded into the identity database and named by the API's
 * authorization policies, and `/api/auth/me` returns them verbatim.
 *
 * Getting this wrong is silent, which is why it is worth the paragraph. When
 * this list held lowercase names, `isRole` rejected every role the server
 * actually sent, `effectiveRole` discarded the lot, and every signed-in reader
 * — contributor and administrator alike — was quietly treated as the base
 * role. Nothing errored. The upload affordance simply never appeared, and it
 * looked like a permissions decision rather than a typo.
 */
export const ROLES = ["Community", "Contributor", "Administrator"] as const;

export type Role = (typeof ROLES)[number];

/**
 * The roles an administrator may grant.
 *
 * `Community` is the floor every account already stands on rather than
 * something conferred, and the API rejects it outright in a role assignment —
 * so it is excluded here, where the compiler can say so, instead of being
 * discovered as a 400 at runtime.
 */
export type AssignableRole = Exclude<Role, "Community">;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** One registered passkey, as listed on the credentials page. */
export interface PasskeyCredential {
  /** The credential id, base64url, as the authenticator reported it. */
  id: string;
  /**
   * What the reader called it when they enrolled it, or `null` when they left
   * the field blank. It is genuinely nullable — the server does not invent a
   * name from the AAGUID — so every place that shows this has to have an answer
   * for the empty case rather than rendering "null" at somebody.
   */
  name: string | null;
  /** ISO-8601. */
  createdAt: string;
  /*
   * There is deliberately no `lastUsedAt`. The API does not track one: the
   * framework's passkey record has no such column, and the field this client
   * used to declare could only ever have been filled with a value somebody made
   * up. "Last used: never" printed against a credential that signs someone in
   * every morning is worse than not offering the fact at all.
   */
}

/**
 * The body of `GET /api/auth/me`, and the single source of truth for
 * everything this UI knows about the reader.
 *
 * There is no envelope: the account object is the whole response body.
 */
export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  /**
   * Whether an authenticator app is enrolled. A flat boolean, spelled exactly
   * this way — it is not nested under an `mfa` object, and TOTP is the only
   * second factor the service offers, so there is nothing for a nested shape
   * to hold.
   */
  twoFactorEnabled: boolean;
  /** Every credential on the account, not a count. May be empty. */
  passkeys: PasskeyCredential[];
  /**
   * How **this session** was established, not what the account is capable of.
   *
   * The distinction is the whole reason the field exists. `passkeys` and
   * `twoFactorEnabled` describe the account and are the same on every device;
   * this describes the browser holding the cookie right now, and it is the
   * only way the UI can say "you signed in with an emailed code" to the person
   * who did, without saying it to the same account on the phone that used a
   * passkey ten minutes ago.
   *
   * `null` is a session established before the server started recording this
   * — an older cookie that is still valid. Every reader of this field has to
   * treat that as "no claim either way" rather than as "email", because
   * guessing the weaker answer would nag people who did nothing wrong.
   */
  authenticationMethod: "passkey" | "totp" | "email" | null;
  /**
   * Whether the method above counts as a second factor: true for a passkey or
   * an authenticator code, false for an emailed one-time code.
   *
   * It is a separate field rather than something derived from
   * `authenticationMethod` because the server owns that judgement. An emailed
   * code proves control of an inbox and nothing about a device, so a session
   * built on one is deliberately weaker than the account it belongs to — and
   * the API refuses contributor and administrator work to it with a 403 whose
   * `code` is `strong-authentication-required`.
   */
  strongAuthentication: boolean;
  /**
   * Whether this account's roles oblige it to hold a passkey or an
   * authenticator app at all.
   *
   * True for Contributor and Administrator. It is answered by the server
   * rather than computed from `roles` here, so that a policy change on the
   * service does not need a deploy of this client to be obeyed — and so that
   * a role added later is covered without anybody remembering to add it to a
   * list.
   */
  secondFactorRequired: boolean;
}

/** `POST /api/auth/register` */
export interface RegisterRequest {
  email: string;
  displayName: string;
}

/**
 * Registration deliberately answers the same way whether or not the address
 * was already registered, so this endpoint cannot be used to enumerate
 * accounts. The UI therefore shows one screen in both cases, which is why
 * there is nothing account-shaped in this response.
 *
 * Which screen that is depends on one thing, and it is not the address: if the
 * deployment reports that mail is not getting out — a global fact, published on
 * `/api/site/environment` and identical for every caller — the confirmation
 * stops claiming a link was sent. Both addresses still get the same screen as
 * each other in both states.
 *
 * `message` is the server's own wording for that non-answer. It is carried
 * here so the client can show it rather than paraphrase it, but the client has
 * to work when it is empty.
 */
export interface RegisterResponse {
  status: "pending";
  message: string;
}

/**
 * `POST /api/auth/email/verify`
 *
 * Both fields are required. The token alone is not enough: the server pairs it
 * with the address it was issued for, so a link that lost its `email`
 * parameter cannot be completed and must be reported as a truncated link
 * rather than as a rejected token.
 */
export interface VerifyEmailRequest {
  email: string;
  token: string;
}

/**
 * Verification does **not** sign anybody in, and this is the part of the flow
 * most worth understanding before changing anything near it.
 *
 * Registration takes no password and issues no credential, so a brand-new
 * account has nothing it could authenticate with — which is exactly why an
 * earlier version of this file assumed verification had to establish a session.
 * It does not. It sets a short-lived HttpOnly enrolment ticket instead, and
 * that ticket authorises `passkey/register/begin` and
 * `passkey/register/complete` for roughly ten minutes and nothing else at all.
 * `GET /api/auth/me` still answers 401 throughout.
 *
 * So there is no dead end: the reader arrives from their inbox holding a ticket
 * that is good for precisely one thing, enrols their first passkey with it, and
 * then signs in with that passkey like anybody else. `enrollmentExpiresAt` is
 * when the ticket stops working, and the page after verification says so,
 * because a window that expires silently is a window people walk away from.
 */
export interface VerifyEmailResponse {
  status: "verified";
  /** ISO-8601, roughly ten minutes out. */
  enrollmentExpiresAt: string;
}

/**
 * `POST /api/auth/passkey/register/begin`
 *
 * The creation options arrive **unwrapped** — the response body *is* the
 * options document, with no `publicKey` envelope around it. It is what
 * `PublicKeyCredential.parseCreationOptionsFromJSON()` accepts, and the binary
 * fields are base64url because JSON has no bytes. `webauthn.ts` is the only
 * place that decodes them.
 */
export interface PasskeyRegisterBeginResponse {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  /**
   * Credentials this account already holds. Passing them through is what
   * makes an authenticator answer `InvalidStateError` instead of silently
   * enrolling a second passkey for the same account on the same device.
   */
  excludeCredentials?: { type: "public-key"; id: string; transports?: string[] }[];
  authenticatorSelection?: {
    authenticatorAttachment?: AuthenticatorAttachment;
    residentKey?: ResidentKeyRequirement;
    requireResidentKey?: boolean;
    userVerification?: UserVerificationRequirement;
  };
}

/** The wire form of a registration assertion. Bytes are base64url. */
export interface PasskeyRegistrationCredential {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment: string | null;
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports: string[];
  };
}

/** `POST /api/auth/passkey/register/complete` */
export interface PasskeyRegisterCompleteRequest {
  credential: PasskeyRegistrationCredential;
  /**
   * What the reader typed to name this passkey. The field is `name` — the
   * server ignores anything called `label`, which is what this client used to
   * send, so every credential enrolled through it arrived nameless.
   */
  name?: string | null;
}

/**
 * Note that this is not a `PasskeyCredential`: the id comes back as
 * `credentialId` rather than `id`, so the two shapes cannot be interchanged
 * even though they carry the same three facts.
 */
export interface PasskeyRegisterCompleteResponse {
  credentialId: string;
  name: string | null;
  createdAt: string;
}

/**
 * `POST /api/auth/passkey/login/begin`
 *
 * There is no request type, because there is no request body. The API ignores
 * anything sent, never accepts an email address, and always answers with an
 * empty `allowCredentials` — so the response is byte-identical for every
 * caller and cannot be used to probe whether an address is registered. A client
 * that offers an email field here is offering a field that does nothing.
 *
 * The options arrive unwrapped, like the creation options above.
 */
export interface PasskeyLoginBeginResponse {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { type: "public-key"; id: string; transports?: string[] }[];
}

/** The wire form of an authentication assertion. Bytes are base64url. */
export interface PasskeyAuthenticationCredential {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment: string | null;
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

export interface PasskeyLoginCompleteRequest {
  credential: PasskeyAuthenticationCredential;
}

/**
 * Sign-in is two-legged when the account has a second factor. The server does
 * not hand out a full session in that case; the reply says only that it wants
 * more, and the cookie it set carries enough to finish the challenge.
 *
 * Two details are load-bearing. The literal is `mfaRequired` — camelCase, no
 * hyphen — and the branch carries `user: null` and nothing else: no `methods`
 * array, no display name, no hint about the account. That silence is
 * deliberate, because a half-authenticated caller is still an unauthenticated
 * one and must not be told anything it did not already know.
 */
export type PasskeyLoginCompleteResponse =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "mfaRequired"; user: null };

/* ------------------------------------------------- signing in with a code */

/**
 * `POST /api/auth/email/code`
 *
 * The alternative to a passkey, for the machines a passkey cannot reach: a
 * borrowed laptop, a desktop old enough to have no platform authenticator, a
 * work device whose policy forbids enrolling one. It is deliberately the
 * second path and not the first — an emailed code proves control of an inbox
 * and nothing about the device typing it — but a sign-in page with only one
 * door is a sign-in page a real proportion of readers cannot open.
 */
export interface EmailCodeRequest {
  email: string;
}

/**
 * Always a 202, and always this shape.
 *
 * The answer is byte-identical whether the address has an account, has never
 * been seen, or has already spent its budget of codes for the quarter hour.
 * That is not vagueness for its own sake: any difference at all — a different
 * status, a different message, a measurably different delay — turns this
 * endpoint into a way to ask the service which of a list of addresses are
 * registered, which is exactly what `register` was built not to answer either.
 *
 * The consequence for this client is a rule with no exceptions: **nothing in
 * the UI may branch on this response.** There is no "we could not find that
 * address" to show, because the client was not told.
 *
 * That rule is about *this* response, and it is worth saying what it does not
 * cover, because the sign-in page now has a second screen and somebody will
 * eventually read that as a violation. The page branches on whether mail is
 * getting out **at all**, which is a fact about the deployment published
 * separately on `/api/site/environment`, carries no address, and is the same
 * answer for every caller. It has to branch on something, because the honest
 * screen when the relay is refusing everything is not "a code is on its way" —
 * that sentence was false on QA while the API already knew it was. What would
 * be a violation is a per-address version of that question, and there is none
 * to ask: the service holds no per-address delivery state, precisely so that
 * this endpoint's silence cannot be recovered from somewhere else.
 *
 * The two numbers are the server's own, carried rather than assumed. They are
 * currently 60 and 600, and hard-coding either here would put the countdown
 * this page shows out of step with the budget the service is actually keeping
 * the moment somebody tunes it.
 */
export interface EmailCodeResponse {
  status: "pending";
  /** The server's own wording for the non-answer. May be empty. */
  message: string;
  /** How long the resend control must stay disabled, in seconds. */
  resendAfterSeconds: number;
  /** How long the code remains redeemable, in seconds. */
  expiresInSeconds: number;
}

/**
 * `POST /api/auth/email/code/verify`
 *
 * Six digits, paired with the address they were sent to. The pairing is not
 * decoration: a code is issued *for* an address, so submitting it with a
 * different one fails exactly as if it were wrong.
 */
export interface EmailCodeVerifyRequest {
  email: string;
  code: string;
}

/**
 * The same two-legged shape as the passkey path, and the same literals — see
 * `PasskeyLoginCompleteResponse` for why `mfaRequired` is camelCase and why
 * the branch carries nothing but `user: null`.
 *
 * That sameness is the point. An account with an authenticator app is asked
 * for its code whichever door it came through, and the client's second step is
 * the same `POST /mfa/totp/verify` in both cases rather than a parallel one
 * that has to be kept in step.
 *
 * Every failure is a single 401 with no distinction drawn between a wrong
 * code, an expired one, one already redeemed, one issued for another address,
 * a code whose five attempts are spent, an address with no account, and a
 * locked-out account. The client must not invent that distinction back: a
 * message saying "that code has expired" tells whoever is guessing that the
 * previous five digits were at least aimed at a real account.
 */
export type EmailCodeVerifyResponse =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "mfaRequired"; user: null };

/** `POST /api/auth/mfa/totp/enroll` */
export interface TotpEnrollResponse {
  /**
   * Base32, grouped for reading. The manual-entry path, and the fallback
   * whenever a camera is not the right answer — which includes every reader
   * using the site on the same device as their authenticator app.
   */
  sharedKey: string;
  /** `otpauth://totp/...`, the string the QR code encodes. */
  authenticatorUri: string;
}

/**
 * `POST /api/auth/mfa/totp/verify`
 *
 * One endpoint, two jobs, chosen by the server from cookie state rather than
 * from anything in the body: finishing enrolment for a signed-in account, and
 * answering the second-factor challenge during sign-in.
 */
export interface TotpVerifyRequest {
  code: string;
}

export type TotpVerifyResponse =
  | {
      /** The literal is `enabled`, not `enrolled`. */
      status: "enabled";
      /**
       * Confirmed present: the API returns ten of these, exactly once, and
       * only here. They matter because enrolling a second factor without them
       * is how people lose accounts — a passkey plus TOTP on one phone means
       * one lost phone locks the account out forever. Shown once, at
       * enrolment, and never again.
       */
      recoveryCodes: string[];
    }
  | { status: "authenticated"; user: CurrentUser };

/**
 * `DELETE /api/auth/passkey/{credentialId}`
 *
 * The server refuses with 409 and `code: "last-credential"` when the
 * credential named is the only one the account has, since removing it would
 * strand the account. The client has to render that refusal rather than treat
 * it as a generic conflict.
 */
export interface PasskeyRemoveResponse {
  status: "removed";
}

/**
 * `PUT /api/auth/admin/users/{userId}/roles`
 *
 * Declarative rather than incremental: the request names the complete set the
 * account should end up with, and anything absent from it is revoked. There is
 * no "add one role" call, so a caller that means to grant `Contributor` has to
 * send the roles the account already holds alongside it.
 *
 * The response, unlike the request, is a full `Role[]`: it reports what the
 * account now holds, and that always includes the `Community` floor.
 */
export interface AssignRolesRequest {
  roles: AssignableRole[];
}

export interface AssignRolesResponse {
  userId: string;
  roles: Role[];
  /**
   * True when the grant landed on an account holding neither a passkey nor an
   * authenticator app — so it now has a role it cannot actually use until it
   * enrols one, because the API refuses contributor and administrator work to
   * a session that was established with an emailed code alone.
   *
   * Worth reporting rather than swallowing. An administrator who grants
   * `Contributor` and hears nothing has every reason to believe the person can
   * now upload; the person, meanwhile, meets a 403 and reads it as the grant
   * having failed. One flag on the reply is the difference between that and a
   * sentence telling the administrator what to say to them.
   */
  awaitingSecondFactor: boolean;
}
