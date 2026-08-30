/**
 * The browser side of passkeys: capability probes, the two credential calls,
 * and — the part that actually decides whether this feature is usable — a
 * translation from the WebAuthn error vocabulary into something a person can
 * act on.
 *
 * WebAuthn reports almost every failure as `NotAllowedError`. Dismissing the
 * system prompt, letting it time out, and having no authenticator that can
 * answer are the same exception with the same empty message, because telling
 * the page which one happened would let a hostile site probe what hardware
 * someone owns. That is the right decision by the specification and a
 * genuinely hard one for a UI: "Something went wrong" is useless, and guessing
 * wrong ("You cancelled") accuses a reader of something they did not do.
 *
 * What this module does instead is narrow the ambiguity with the information
 * it legitimately has — whether the API exists at all, whether the origin is
 * secure, whether a platform authenticator is present — and, where ambiguity
 * genuinely remains, say both possibilities plainly rather than pick one.
 */

import type {
  PasskeyAuthenticationCredential,
  PasskeyLoginBeginResponse,
  PasskeyRegisterBeginResponse,
  PasskeyRegistrationCredential,
} from "./types";

/* ------------------------------------------------------------- base64url */

/**
 * JSON has no bytes, so every binary field crosses the wire base64url-encoded
 * and is decoded here. `atob`/`btoa` speak standard base64, so the two
 * alphabet substitutions and the padding are this code's job.
 */
/**
 * The `Uint8Array<ArrayBuffer>` return type is not decoration. As of
 * TypeScript 5.7 a plain `Uint8Array` is `Uint8Array<ArrayBufferLike>`, which
 * includes `SharedArrayBuffer` and therefore is not assignable to WebAuthn's
 * `BufferSource`. Allocating the backing buffer explicitly is what narrows it,
 * and it is why the array is built from a buffer rather than from a length.
 */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked rather than spread across `String.fromCharCode(...bytes)`: an
  // attestation object runs to a few kilobytes, and spreading an array that
  // size overflows the call stack in some engines.
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ------------------------------------------------------------ capabilities */

/** Whether this browser has the WebAuthn API at all. */
export function supportsWebAuthn(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function"
  );
}

/**
 * Whether the device has a built-in authenticator — Touch ID, Face ID, Windows
 * Hello, an Android screen lock.
 *
 * A `false` here is not a reason to hide the button. A security key or a
 * nearby phone can still answer the same prompt; it just means the reader
 * needs to be told that, because "Use a passkey" on a desktop with no
 * biometrics otherwise opens a dialogue that looks like an error.
 */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  if (!supportsWebAuthn()) return false;
  const check = window.PublicKeyCredential
    .isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof check !== "function") return false;
  try {
    return await check.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
}

/**
 * Whether a call can be made at all. WebAuthn requires a secure context;
 * `localhost` counts, a plain-HTTP host on the network does not, and the
 * failure it produces otherwise is an opaque `SecurityError` well after the
 * reader has committed to the flow.
 */
function isSecureContextForWebAuthn(): boolean {
  return typeof window === "undefined" || window.isSecureContext !== false;
}

/* ----------------------------------------------------------------- errors */

export type WebAuthnFailure =
  /** No WebAuthn in this browser. */
  | "unsupported"
  /** The page is not a secure context, or the RP id does not match it. */
  | "insecure-context"
  /** Prompt dismissed, timed out, or nothing could answer it. */
  | "not-completed"
  /** This authenticator already holds a passkey for this account. */
  | "already-registered"
  /** The authenticator refused: usually no user verification available. */
  | "unsupported-authenticator"
  /** Anything the cases above do not cover. */
  | "unknown";

export class WebAuthnError extends Error {
  readonly reason: WebAuthnFailure;
  /** Extra guidance shown under the message, when there is any worth giving. */
  readonly hint: string | null;

  constructor(reason: WebAuthnFailure, message: string, hint: string | null = null) {
    super(message);
    this.name = "WebAuthnError";
    this.reason = reason;
    this.hint = hint;
  }
}

type Ceremony = "register" | "authenticate";

/**
 * The translation table. Every branch names a real, distinguishable cause;
 * `not-completed` is the one that stays deliberately ambiguous, because the
 * browser refuses to say which of its three causes occurred and inventing an
 * answer would be worse than admitting the range.
 */
function translate(error: unknown, ceremony: Ceremony): WebAuthnError {
  // Read `name` off the value rather than narrowing with `instanceof Error`.
  // `DOMException` — which is what every one of these actually is — does not
  // inherit from `Error` in every environment this code runs in, and an
  // `instanceof` guard silently routes all of them to the default branch,
  // replacing every specific message below with the vague one.
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "AbortError":
      return new WebAuthnError(
        "not-completed",
        ceremony === "register"
          ? "Passkey setup was not completed."
          : "Sign-in was not completed.",
        "The prompt was dismissed, timed out, or no available authenticator could answer it. You can try again.",
      );

    case "InvalidStateError":
      return ceremony === "register"
        ? new WebAuthnError(
            "already-registered",
            "This device already has a passkey for your account.",
            "Nothing to do — you can sign in with it. To replace it, remove the existing passkey first.",
          )
        : new WebAuthnError(
            "unknown",
            "That passkey could not be used.",
            "Try again, or use a different passkey.",
          );

    case "NotSupportedError":
      return new WebAuthnError(
        "unsupported-authenticator",
        "This authenticator cannot create the kind of passkey this site requires.",
        "Try a different device, a hardware security key, or your phone.",
      );

    case "ConstraintError":
      return new WebAuthnError(
        "unsupported-authenticator",
        "This authenticator cannot verify who you are.",
        "A passkey here needs a screen lock, a fingerprint, a face, or a PIN. Set one up and try again.",
      );

    case "SecurityError":
      return new WebAuthnError(
        "insecure-context",
        "Passkeys cannot be used on this address.",
        "They require a secure (HTTPS) connection to this site's own domain.",
      );

    default:
      return new WebAuthnError(
        "unknown",
        ceremony === "register"
          ? "The passkey could not be created."
          : "The passkey could not be used to sign in.",
        "Try again. If it keeps happening, try a different device.",
      );
  }
}

/** The single guard both ceremonies run before touching `navigator.credentials`. */
function assertUsable(): void {
  if (!supportsWebAuthn()) {
    throw new WebAuthnError(
      "unsupported",
      "This browser does not support passkeys.",
      "Passkeys need a current version of Chrome, Edge, Safari or Firefox. You can still sign in on another device.",
    );
  }
  if (!isSecureContextForWebAuthn()) {
    throw new WebAuthnError(
      "insecure-context",
      "Passkeys need a secure connection.",
      "Open this site over HTTPS and try again.",
    );
  }
}

/* -------------------------------------------------------------- ceremonies */

function toDescriptors(
  list:
    | { type: "public-key"; id: string; transports?: string[] }[]
    | undefined,
): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((entry) => ({
    type: "public-key" as const,
    id: base64UrlToBytes(entry.id),
    transports: entry.transports as AuthenticatorTransport[] | undefined,
  }));
}

/**
 * Runs the creation ceremony against options the server produced, and returns
 * the assertion in the shape `passkey/register/complete` expects.
 *
 * The `signal` is what makes a second attempt safe: the specification lets
 * only one credential request be outstanding per page, so starting a new one
 * while an abandoned prompt is still open fails outright. Callers abort the
 * previous one first.
 */
export async function createPasskey(
  options: PasskeyRegisterBeginResponse,
  signal?: AbortSignal,
): Promise<PasskeyRegistrationCredential> {
  assertUsable();

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64UrlToBytes(options.challenge),
    rp: options.rp,
    user: {
      id: base64UrlToBytes(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation,
    excludeCredentials: toDescriptors(options.excludeCredentials),
    authenticatorSelection: options.authenticatorSelection,
  };

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({ publicKey, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && signal?.aborted) {
      throw error;
    }
    throw translate(error, "register");
  }

  // A null result is not documented as reachable for `create`, but it is
  // typed as possible and a crash here would read as a site bug rather than
  // as a ceremony that produced nothing.
  if (!credential) throw translate(new DOMException("", "NotAllowedError"), "register");

  const publicKeyCredential = credential as PublicKeyCredential;
  const response = publicKeyCredential.response as AuthenticatorAttestationResponse;

  return {
    id: publicKeyCredential.id,
    rawId: bytesToBase64Url(publicKeyCredential.rawId),
    type: "public-key",
    authenticatorAttachment: publicKeyCredential.authenticatorAttachment ?? null,
    clientExtensionResults: publicKeyCredential.getClientExtensionResults() as Record<
      string,
      unknown
    >,
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      attestationObject: bytesToBase64Url(response.attestationObject),
      // Older browsers have no getTransports(); the server treats an empty
      // list as "unknown" rather than as "none".
      transports:
        typeof response.getTransports === "function" ? response.getTransports() : [],
    },
  };
}

/**
 * Runs the authentication ceremony.
 *
 * `mediation: "conditional"` is deliberately not used here. Conditional
 * mediation surfaces passkeys inside the browser's autofill on a field the
 * reader may never touch, which is lovely when it works and invisible when it
 * does not; this flow is an explicit button, so the prompt is always a direct
 * response to something the reader just did.
 */
export async function getPasskeyAssertion(
  options: PasskeyLoginBeginResponse,
  signal?: AbortSignal,
): Promise<PasskeyAuthenticationCredential> {
  assertUsable();

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64UrlToBytes(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification,
    allowCredentials: toDescriptors(options.allowCredentials),
  };

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({ publicKey, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && signal?.aborted) {
      throw error;
    }
    throw translate(error, "authenticate");
  }

  if (!credential) {
    throw translate(new DOMException("", "NotAllowedError"), "authenticate");
  }

  const publicKeyCredential = credential as PublicKeyCredential;
  const response = publicKeyCredential.response as AuthenticatorAssertionResponse;

  return {
    id: publicKeyCredential.id,
    rawId: bytesToBase64Url(publicKeyCredential.rawId),
    type: "public-key",
    authenticatorAttachment: publicKeyCredential.authenticatorAttachment ?? null,
    clientExtensionResults: publicKeyCredential.getClientExtensionResults() as Record<
      string,
      unknown
    >,
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : null,
    },
  };
}
