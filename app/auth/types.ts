/**
 * The shape of the account API, written down.
 *
 * The service that serves these endpoints is built in the sibling repository
 * and did not exist when this client was written, so every type here is the
 * contract as specified rather than something observed from a live response.
 * Where the specification stopped short and this UI could not be built without
 * an answer, the gap is marked with a `CONTRACT GAP` note so the two sides can
 * be reconciled deliberately instead of by whoever ships first.
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
 */
export const ROLES = ["community", "contributor", "admin"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** One registered passkey, as listed on the credentials page. */
export interface PasskeyCredential {
  /** The credential id, base64url, as the authenticator reported it. */
  id: string;
  /**
   * What the reader called it, or what the server inferred from the
   * authenticator's AAGUID. Always present; never the raw id, which is
   * meaningless to a person deciding which credential to revoke.
   */
  label: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601, or null if it has never been used to sign in. */
  lastUsedAt: string | null;
}

/**
 * The body of `GET /api/auth/me`, and the single source of truth for
 * everything this UI knows about the reader.
 */
export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  /**
   * CONTRACT GAP. `/api/auth/me` is specified as "current user + roles". The
   * account area cannot be built without also knowing whether TOTP is already
   * enrolled and which passkeys exist — otherwise the credentials page has to
   * guess, or the client needs two more round trips before it can paint. Both
   * are read-only projections of state the server already has to hold.
   */
  mfa: { totp: boolean };
  passkeys: PasskeyCredential[];
}

/** `POST /api/auth/register` */
export interface RegisterRequest {
  email: string;
  displayName: string;
}

/**
 * Registration deliberately answers the same way whether or not the address
 * was already registered, so this endpoint cannot be used to enumerate
 * accounts. The UI therefore says "check your inbox" in both cases, which is
 * why there is nothing account-shaped in this response.
 */
export interface RegisterResponse {
  status: "verification-sent";
}

/** `POST /api/auth/email/verify` */
export interface VerifyEmailRequest {
  token: string;
}

/**
 * CONTRACT GAP. Registration takes no password and issues no credential, so
 * following the verification link is the only moment at which a brand-new
 * account can be authenticated at all. Verification must therefore establish
 * the session cookie itself; otherwise there is no way to reach
 * `passkey/register/begin`, which requires a session, and the account can
 * never enrol its first passkey. The `user` here is the same projection
 * `/api/auth/me` returns, so the client can seed its session state without a
 * second request.
 */
export interface VerifyEmailResponse {
  status: "verified";
  user: CurrentUser;
}

/**
 * `POST /api/auth/passkey/register/begin`
 *
 * The binary fields arrive base64url-encoded, because JSON has no bytes.
 * `webauthn.ts` is the only place that decodes them.
 */
export interface PasskeyRegisterBeginResponse {
  publicKey: {
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
  /** What the reader typed to name this passkey, if anything. */
  label?: string;
}

export interface PasskeyRegisterCompleteResponse {
  credential: PasskeyCredential;
}

/**
 * `POST /api/auth/passkey/login/begin`
 *
 * The email is optional: with a discoverable credential the authenticator
 * already knows which account it is speaking for, and asking for an address
 * first would both slow the common path down and confirm to an unauthenticated
 * caller whether an address is registered.
 */
export interface PasskeyLoginBeginRequest {
  email?: string;
}

export interface PasskeyLoginBeginResponse {
  publicKey: {
    challenge: string;
    rpId?: string;
    timeout?: number;
    userVerification?: UserVerificationRequirement;
    allowCredentials?: { type: "public-key"; id: string; transports?: string[] }[];
  };
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
 * not hand out a full session in that case; the reply says what it still
 * wants, and the cookie it set carries only enough to finish the challenge.
 */
export type PasskeyLoginCompleteResponse =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "mfa-required"; methods: "totp"[] };

/** `POST /api/auth/mfa/totp/enroll` */
export interface TotpEnrollResponse {
  /** Base32, grouped for reading. The manual-entry path, and the fallback
   * whenever a camera is not the right answer — which includes every reader
   * using the site on the same device as their authenticator app. */
  secret: string;
  /** `otpauth://totp/...`, the string the QR code encodes. */
  otpauthUri: string;
}

/**
 * `POST /api/auth/mfa/totp/verify`
 *
 * One endpoint, two jobs, distinguished by what the session already is:
 * finishing enrolment for a signed-in account, and answering the second-factor
 * challenge during sign-in.
 */
export interface TotpVerifyRequest {
  code: string;
}

export type TotpVerifyResponse =
  | {
      status: "enrolled";
      /**
       * CONTRACT GAP. Not in the specification, and enrolling a second factor
       * without one is how people lose their accounts: a passkey plus TOTP on
       * a single phone means one lost phone locks the account out forever.
       * Shown once, at enrolment, and never again.
       */
      recoveryCodes: string[];
    }
  | { status: "authenticated"; user: CurrentUser };

/**
 * CONTRACT GAP. The specification has no way to revoke a credential, and an
 * account area that can only ever add passkeys is a security problem rather
 * than a missing feature: a reader who loses a device has no way to cut it
 * off. `DELETE /api/auth/passkey/:id` is the shape this client assumes.
 *
 * The server has to refuse to remove the last remaining credential of an
 * account that has no other way in, since that would strand the account.
 */
export interface PasskeyRemoveResponse {
  status: "removed";
}
