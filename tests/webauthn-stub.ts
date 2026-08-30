/**
 * A WebAuthn authenticator for jsdom, which has none.
 *
 * It is deliberately more than a `vi.fn()` returning a fixed object. The
 * assertions it produces echo the challenge back inside `clientDataJSON`,
 * exactly as a real authenticator does, so that `tests/auth-api-contract.ts`
 * can verify them the way a real relying party does. Without that, a client
 * that never decoded the challenge, or sent a stale one, would pass every
 * test.
 *
 * The failure modes are first-class rather than an afterthought, because they
 * are the cases this feature has to get right: `NotAllowedError` (dismissed or
 * timed out), `InvalidStateError` (this device already has a passkey for the
 * account), `NotSupportedError`, and the absence of the API altogether.
 */

import { vi } from "vitest";

function encode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64Url(source: BufferSource): string {
  const bytes =
    source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(
      (source as ArrayBufferView).buffer,
      (source as ArrayBufferView).byteOffset,
      (source as ArrayBufferView).byteLength,
    );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return encode(binary);
}

function bytes(text: string): ArrayBuffer {
  const buffer = new ArrayBuffer(text.length);
  const view = new Uint8Array(buffer);
  for (let index = 0; index < text.length; index += 1) {
    view[index] = text.charCodeAt(index) & 0xff;
  }
  return buffer;
}

function clientData(type: string, challenge: BufferSource): ArrayBuffer {
  return bytes(
    JSON.stringify({
      type,
      challenge: bytesToBase64Url(challenge),
      origin: "https://sw5e.example",
      crossOrigin: false,
    }),
  );
}

export interface AuthenticatorOptions {
  /**
   * Thrown instead of producing a credential. Pass a `DOMException` with the
   * name the browser would really use — that name is the only thing the client
   * has to work from.
   */
  failWith?: DOMException;
  /** Whether `isUserVerifyingPlatformAuthenticatorAvailable()` answers true. */
  platformAuthenticator?: boolean;
}

export interface FakeAuthenticator {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  /** Restores whatever `window` had before. */
  uninstall: () => void;
}

/** Installs a working (or deliberately broken) authenticator on `window`. */
export function installAuthenticator(
  options: AuthenticatorOptions = {},
): FakeAuthenticator {
  const { failWith, platformAuthenticator = true } = options;

  const create = vi.fn(async (init: CredentialCreationOptions) => {
    if (failWith) throw failWith;
    const publicKey = init.publicKey as PublicKeyCredentialCreationOptions;
    return {
      id: "new-credential",
      rawId: bytes("new-credential"),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: clientData("webauthn.create", publicKey.challenge),
        attestationObject: bytes("attestation"),
        getTransports: () => ["internal", "hybrid"],
      },
    };
  });

  const get = vi.fn(async (init: CredentialRequestOptions) => {
    if (failWith) throw failWith;
    const publicKey = init.publicKey as PublicKeyCredentialRequestOptions;
    return {
      id: "credential-one",
      rawId: bytes("credential-one"),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: clientData("webauthn.get", publicKey.challenge),
        authenticatorData: bytes("authenticator-data"),
        signature: bytes("signature"),
        userHandle: bytes("user-1"),
      },
    };
  });

  const previousCredentials = Object.getOwnPropertyDescriptor(
    navigator,
    "credentials",
  );
  const previousPublicKeyCredential = (
    window as unknown as Record<string, unknown>
  ).PublicKeyCredential;

  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { create, get },
  });

  const publicKeyCredential = function PublicKeyCredential() {};
  publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () =>
    platformAuthenticator;
  publicKeyCredential.isConditionalMediationAvailable = async () => false;
  (window as unknown as Record<string, unknown>).PublicKeyCredential =
    publicKeyCredential;

  return {
    create,
    get,
    uninstall() {
      if (previousCredentials) {
        Object.defineProperty(navigator, "credentials", previousCredentials);
      } else {
        Reflect.deleteProperty(navigator, "credentials");
      }
      (window as unknown as Record<string, unknown>).PublicKeyCredential =
        previousPublicKeyCredential;
    },
  };
}

/** Removes WebAuthn entirely, the way a browser that has never had it looks. */
export function removeWebAuthn(): () => void {
  const previousCredentials = Object.getOwnPropertyDescriptor(
    navigator,
    "credentials",
  );
  const previousPublicKeyCredential = (
    window as unknown as Record<string, unknown>
  ).PublicKeyCredential;

  Reflect.deleteProperty(navigator, "credentials");
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "PublicKeyCredential");

  return () => {
    if (previousCredentials) {
      Object.defineProperty(navigator, "credentials", previousCredentials);
    }
    if (previousPublicKeyCredential !== undefined) {
      (window as unknown as Record<string, unknown>).PublicKeyCredential =
        previousPublicKeyCredential;
    }
  };
}
