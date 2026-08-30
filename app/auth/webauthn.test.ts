/**
 * The passkey ceremonies, and — mostly — their failures.
 *
 * WebAuthn reports nearly everything as `NotAllowedError`, so the value of
 * this module is entirely in the translation. These tests pin each branch of
 * it, because a regression there is invisible: the ceremony still fails, the
 * page still shows a message, and the message is just wrong.
 */

import { afterEach, describe, expect, it } from "vitest";

import { installAuthenticator, removeWebAuthn } from "../../tests/webauthn-stub";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  createPasskey,
  getPasskeyAssertion,
  hasPlatformAuthenticator,
  supportsWebAuthn,
  WebAuthnError,
} from "./webauthn";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const CHALLENGE = "Y2hhbGxlbmdlLW9uZQ";

const CREATE_OPTIONS = {
  challenge: CHALLENGE,
  rp: { name: "Star Wars 5e" },
  user: { id: "dXNlci0x", name: "reader@example.com", displayName: "Jen Ordo" },
  pubKeyCredParams: [{ type: "public-key" as const, alg: -7 }],
  excludeCredentials: [{ type: "public-key" as const, id: "Y3JlZC1vbmU" }],
};

const REQUEST_OPTIONS = { challenge: CHALLENGE };

describe("base64url", () => {
  it("round-trips bytes that standard base64 would mangle", () => {
    const bytes = new Uint8Array(new ArrayBuffer(4));
    bytes.set([251, 255, 190, 0]);

    const encoded = bytesToBase64Url(bytes.buffer);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlToBytes(encoded))).toEqual([251, 255, 190, 0]);
  });

  it("decodes a value with the padding stripped, which is how they arrive", () => {
    expect(new TextDecoder().decode(base64UrlToBytes("dXNlci0x"))).toBe("user-1");
  });
});

describe("capability probes", () => {
  it("reports no support when the browser has no WebAuthn", () => {
    cleanup = removeWebAuthn();

    expect(supportsWebAuthn()).toBe(false);
  });

  it("reports no platform authenticator when the device has none", async () => {
    const authenticator = installAuthenticator({ platformAuthenticator: false });
    cleanup = authenticator.uninstall;

    expect(supportsWebAuthn()).toBe(true);
    await expect(hasPlatformAuthenticator()).resolves.toBe(false);
  });

  it("reports a platform authenticator when one is present", async () => {
    const authenticator = installAuthenticator();
    cleanup = authenticator.uninstall;

    await expect(hasPlatformAuthenticator()).resolves.toBe(true);
  });
});

describe("createPasskey", () => {
  it("decodes the challenge and the user id into bytes for the browser", async () => {
    const authenticator = installAuthenticator();
    cleanup = authenticator.uninstall;

    await createPasskey(CREATE_OPTIONS);

    const passed = authenticator.create.mock.calls[0]?.[0] as CredentialCreationOptions;
    const publicKey = passed.publicKey as PublicKeyCredentialCreationOptions;

    expect(publicKey.challenge).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(publicKey.user.id as Uint8Array)).toBe("user-1");
    // Without this the authenticator cannot recognise a duplicate, and a
    // second passkey is silently created for the same account on the same
    // device instead of raising InvalidStateError.
    expect(publicKey.excludeCredentials).toHaveLength(1);
  });

  it("returns an assertion whose clientDataJSON carries the challenge back", async () => {
    const authenticator = installAuthenticator();
    cleanup = authenticator.uninstall;

    const credential = await createPasskey(CREATE_OPTIONS);
    const clientData = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(credential.response.clientDataJSON)),
    ) as { challenge: string; type: string };

    expect(clientData.type).toBe("webauthn.create");
    expect(clientData.challenge).toBe(CHALLENGE);
    expect(credential.response.transports).toContain("internal");
  });

  it("surfaces a dismissed prompt as an error the reader can act on", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "NotAllowedError"),
    });
    cleanup = authenticator.uninstall;

    const error = await createPasskey(CREATE_OPTIONS).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(WebAuthnError);
    expect((error as WebAuthnError).reason).toBe("not-completed");
    // The three causes are indistinguishable to the page, so the copy has to
    // cover all of them rather than accuse the reader of cancelling.
    expect((error as WebAuthnError).hint).toMatch(/dismissed, timed out/i);
  });

  it("recognises a device that already holds a passkey for this account", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "InvalidStateError"),
    });
    cleanup = authenticator.uninstall;

    const error = await createPasskey(CREATE_OPTIONS).catch((thrown: unknown) => thrown);

    expect((error as WebAuthnError).reason).toBe("already-registered");
    expect((error as WebAuthnError).message).toMatch(/already has a passkey/i);
  });

  it("explains an authenticator that cannot verify the user", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "ConstraintError"),
    });
    cleanup = authenticator.uninstall;

    const error = await createPasskey(CREATE_OPTIONS).catch((thrown: unknown) => thrown);

    expect((error as WebAuthnError).reason).toBe("unsupported-authenticator");
    expect((error as WebAuthnError).hint).toMatch(/screen lock|fingerprint|PIN/i);
  });

  it("names an insecure origin instead of passing on a bare SecurityError", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "SecurityError"),
    });
    cleanup = authenticator.uninstall;

    const error = await createPasskey(CREATE_OPTIONS).catch((thrown: unknown) => thrown);

    expect((error as WebAuthnError).reason).toBe("insecure-context");
    expect((error as WebAuthnError).hint).toMatch(/HTTPS/i);
  });

  it("refuses before touching the API when the browser has no WebAuthn", async () => {
    cleanup = removeWebAuthn();

    const error = await createPasskey(CREATE_OPTIONS).catch((thrown: unknown) => thrown);

    expect((error as WebAuthnError).reason).toBe("unsupported");
  });

  it("lets a deliberate abort through untranslated, so a retry is not an error", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "AbortError"),
    });
    cleanup = authenticator.uninstall;

    const controller = new AbortController();
    controller.abort();

    const error = await createPasskey(CREATE_OPTIONS, controller.signal).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DOMException);
    expect(error).not.toBeInstanceOf(WebAuthnError);
  });
});

describe("getPasskeyAssertion", () => {
  it("returns an assertion carrying the challenge and the user handle", async () => {
    const authenticator = installAuthenticator();
    cleanup = authenticator.uninstall;

    const credential = await getPasskeyAssertion(REQUEST_OPTIONS);
    const clientData = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(credential.response.clientDataJSON)),
    ) as { challenge: string; type: string };

    expect(clientData.type).toBe("webauthn.get");
    expect(clientData.challenge).toBe(CHALLENGE);
    expect(credential.response.userHandle).not.toBeNull();
  });

  it("reports a cancelled sign-in prompt in the sign-in vocabulary", async () => {
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "NotAllowedError"),
    });
    cleanup = authenticator.uninstall;

    const error = await getPasskeyAssertion(REQUEST_OPTIONS).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as WebAuthnError).reason).toBe("not-completed");
    expect((error as WebAuthnError).message).toMatch(/sign-in was not completed/i);
  });

  it("does not claim a credential is already registered during sign-in", async () => {
    // InvalidStateError means something entirely different on this side of the
    // ceremony; reusing the registration copy would tell a reader to remove a
    // passkey they are trying to use.
    const authenticator = installAuthenticator({
      failWith: new DOMException("", "InvalidStateError"),
    });
    cleanup = authenticator.uninstall;

    const error = await getPasskeyAssertion(REQUEST_OPTIONS).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as WebAuthnError).reason).toBe("unknown");
    expect((error as WebAuthnError).message).not.toMatch(/already/i);
  });
});
