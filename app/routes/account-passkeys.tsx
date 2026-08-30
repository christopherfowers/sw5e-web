/**
 * Credential management: add a passkey, see the ones you have, revoke one.
 *
 * Revocation is the half that is easy to leave out and the half that matters
 * most. A list that can only grow is not credential management — it is a
 * record of every device that has ever been able to sign in as you, including
 * the laptop you sold.
 *
 * Two details in here are deliberate:
 *
 * Removal asks for confirmation **in place**, on the row itself, rather than
 * in a modal dialogue. A dialogue would need focus trapping, an escape route,
 * a restore-focus-on-close path and an `aria-modal` container, and every one
 * of those is a thing to get subtly wrong; an inline confirmation needs none
 * of it and cannot strand a keyboard user behind a layer they cannot leave.
 *
 * The name field is offered before the ceremony, not after. Asking afterwards
 * means asking someone to name a thing while a system prompt is dismissing
 * itself, and it means a failed naming step leaves a credential registered
 * with no name at all. It is genuinely optional: the server stores `null`
 * rather than inventing a name, so the list below has to have an answer for a
 * credential that has none.
 */

import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";

import {
  ApiError,
  beginPasskeyRegistration,
  completePasskeyRegistration,
  removePasskey,
} from "~/auth/api";
import {
  createPasskey,
  hasPlatformAuthenticator,
  supportsWebAuthn,
  WebAuthnError,
} from "~/auth/webauthn";
import { Banner, SubmitButton, TextField } from "~/components/auth-ui";
import type { AccountContext } from "./account";

/** Reads as a date rather than as a timestamp, and never as "Invalid Date". */
function readableDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AccountPasskeys() {
  const { user, refresh } = useOutletContext<AccountContext>();

  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; body?: string } | null>(
    null,
  );
  const [success, setSuccess] = useState<string | null>(null);

  // See sign-in.tsx: probing hardware during render would make the prerendered
  // markup and the hydrated markup disagree.
  const [capability, setCapability] = useState<{
    webauthn: boolean;
    platform: boolean;
  } | null>(null);

  const ceremony = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const webauthn = supportsWebAuthn();
      const platform = webauthn ? await hasPlatformAuthenticator() : false;
      if (!cancelled) setCapability({ webauthn, platform });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => ceremony.current?.abort(), []);

  function report(error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (error instanceof WebAuthnError) {
      setFailure({ title: error.message, body: error.hint ?? undefined });
      return;
    }
    if (error instanceof ApiError) {
      // The server refuses to remove an account's last credential, because
      // doing so would strand it. That is a deliberate answer rather than a
      // failure, and it deserves the sentence that says what to do about it —
      // the warning shown before confirming says removal *will* happen, so
      // reporting this as "that could not be completed" would leave the reader
      // unsure whether it did.
      if (error.kind === "conflict" && error.code === "last-credential") {
        setFailure({
          title: "That is your only passkey, so it was kept.",
          body: "Removing it would leave you no way to sign in. Add another passkey first, then remove this one.",
        });
        return;
      }
      setFailure({ title: "That could not be completed.", body: error.message });
      return;
    }
    setFailure({
      title: "That could not be completed.",
      body: "Try again in a moment.",
    });
  }

  async function addPasskey() {
    setFailure(null);
    setSuccess(null);
    setAdding(true);

    ceremony.current?.abort();
    const controller = new AbortController();
    ceremony.current = controller;

    try {
      const options = await beginPasskeyRegistration();
      const credential = await createPasskey(options, controller.signal);
      const result = await completePasskeyRegistration(
        credential,
        name.trim() || null,
      );
      setName("");
      setSuccess(
        result.name
          ? `“${result.name}” can now sign you in.`
          : "Your new passkey can now sign you in.",
      );
      // The list lives on the session's user, so it comes back from the server
      // rather than being patched locally — otherwise this page and the header
      // would disagree about the same account.
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      if (ceremony.current === controller) ceremony.current = null;
      setAdding(false);
    }
  }

  async function confirmRemoval(id: string, shownAs: string | null) {
    setFailure(null);
    setSuccess(null);
    setRemoving(id);
    try {
      await removePasskey(id);
      setConfirming(null);
      setSuccess(
        shownAs
          ? `“${shownAs}” can no longer sign you in.`
          : "That passkey can no longer sign you in.",
      );
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      setRemoving(null);
    }
  }

  const unsupported = capability?.webauthn === false;
  const onlyCredential = user.passkeys.length === 1;

  return (
    <>
      <section className="account-section" aria-labelledby="passkeys-heading">
        <h2 id="passkeys-heading">Your passkeys</h2>
        <p className="account-section-lede">
          Each one is tied to a single device or password manager. Remove any
          you no longer control.
        </p>

        {failure ? (
          <Banner tone="error" title={failure.title}>
            {failure.body}
          </Banner>
        ) : null}
        {success ? <Banner tone="success" title={success} /> : null}

        {user.passkeys.length === 0 ? (
          <p className="empty-state">
            No passkeys yet. Add one below so you can sign in without waiting
            for an email.
          </p>
        ) : (
          <ul className="credential-list">
            {user.passkeys.map((passkey) => {
              // `name` is genuinely nullable: the server stores exactly what
              // the reader typed and invents nothing when they typed nothing.
              // Every place that shows it needs this fallback, or the row
              // renders an empty heading with a Remove button beside it and no
              // way to tell which credential it belongs to.
              const shownAs = passkey.name ?? "Unnamed passkey";
              return (
                <li key={passkey.id} className="credential">
                  <div className="credential-body">
                    <p className="credential-name">{shownAs}</p>
                    {/* Added, and nothing else. The API tracks no last-used
                        instant, and a "last used" line filled with a guess
                        would be worse than the fact being absent — it is
                        exactly the line somebody would revoke a credential
                        on. */}
                    <p className="credential-meta">
                      Added {readableDate(passkey.createdAt)}
                    </p>
                  </div>

                  {confirming === passkey.id ? (
                    <div className="credential-confirm" role="group"
                      aria-label={`Confirm removing ${shownAs}`}>
                      <p>
                        {onlyCredential
                          ? "This is your only passkey, and the server will refuse to remove it — that would leave you no way to sign in."
                          : "Remove this passkey?"}
                      </p>
                      <div className="auth-actions">
                        <SubmitButton
                          type="button"
                          variant="danger"
                          pending={removing === passkey.id}
                          pendingLabel="Removing…"
                          onClick={() =>
                            void confirmRemoval(passkey.id, passkey.name)
                          }
                        >
                          Yes, remove it
                        </SubmitButton>
                        <button
                          type="button"
                          className="button"
                          disabled={removing === passkey.id}
                          onClick={() => setConfirming(null)}
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="button button-danger"
                      // The row has to fit "Remove", but a screen reader user
                      // moving through a list of buttons would hear "Remove"
                      // three times with nothing to tell them apart. The
                      // accessible name still starts with the visible word, so
                      // "click Remove" remains a usable instruction for speech
                      // control (WCAG 2.5.3, Label in Name).
                      aria-label={`Remove the passkey “${shownAs}”`}
                      onClick={() => {
                        setConfirming(passkey.id);
                        setFailure(null);
                        setSuccess(null);
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="account-section" aria-labelledby="add-passkey-heading">
        <h2 id="add-passkey-heading">Add a passkey</h2>

        {unsupported ? (
          <Banner tone="error" title="This browser cannot create passkeys.">
            Passkeys need a current version of Chrome, Edge, Safari or Firefox.
            Open your account on a device that has one and add it there — it
            will then work for signing in everywhere.
          </Banner>
        ) : null}

        {capability?.webauthn && !capability.platform ? (
          <Banner tone="info" title="This device has no built-in authenticator.">
            There is no fingerprint reader, face unlock or PIN here, so you will
            be asked for a hardware security key or for a passkey on your phone.
            Both work.
          </Banner>
        ) : null}

        <div className="auth-form">
          <TextField
            label="Name this passkey"
            name="name"
            value={name}
            onChange={setName}
            maxLength={60}
            disabled={adding || unsupported}
            hint="For your own reference — “Work laptop”, “iPhone”. Left blank, it is listed as an unnamed passkey."
          />
          <div className="auth-actions">
            <SubmitButton
              type="button"
              pending={adding}
              pendingLabel="Waiting for your device…"
              disabled={unsupported}
              onClick={() => void addPasskey()}
            >
              Add a passkey
            </SubmitButton>
          </div>
        </div>
      </section>
    </>
  );
}
