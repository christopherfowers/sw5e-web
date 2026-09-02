/**
 * Proving a second factor without signing out first.
 *
 * The service refuses contributor and administrator work to a session that was
 * opened with an emailed code, which is right: a mailbox is what everything
 * else on the internet is recovered through, so it can never be the thing
 * standing between an attacker and the content of the site. What was wrong was
 * the only remedy on offer. Somebody who signed in by code and then enrolled a
 * passkey — a minute later, on the same screen, on the device in their hand —
 * was told to add a passkey. They had one. The session did not know about it,
 * because a session records how it was established and does not gain strength
 * from the account changing underneath it.
 *
 * So this asks them to prove it here, in place, and re-issues the session. It
 * is the same ceremony the sign-in page runs, against endpoints that require a
 * session and cannot create one.
 *
 * The important thing about this component is which of the three cases it is
 * in, and it decides that from the account rather than from the session:
 *
 * - a passkey enrolled → offer the prompt
 * - an authenticator app enrolled → offer the code field
 * - neither → do not pretend there is something to prove; send them to enrol
 *
 * Getting that wrong in the third direction is how the dead end happened in
 * the first place, so `nothingEnrolled` is the branch to read first.
 */

import { useRef, useState } from "react";
import { Link } from "react-router";

import {
  beginReauthentication,
  completeReauthentication,
  reauthenticateWithTotp,
} from "./api";
import { describeFailure } from "./failures";
import { useSession } from "./session";
import type { CurrentUser } from "./types";
import { getPasskeyAssertion, supportsWebAuthn } from "./webauthn";
import { Banner, SubmitButton, TextField } from "~/components/auth-ui";

import "~/styles/account.css";

/** How many digits an authenticator code has. */
const CODE_LENGTH = 6;

interface ReauthenticatePromptProps {
  /** The account behind the session being raised. */
  user: CurrentUser;
  /**
   * What the reader was trying to reach, in a form that finishes the sentence
   * "…before you can open". Used only in the explanation.
   */
  purpose: string;
}

export function ReauthenticatePrompt({ user, purpose }: ReauthenticatePromptProps) {
  const session = useSession();

  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<{ title: string; body?: string } | null>(null);

  // So that navigating away mid-ceremony does not leave a WebAuthn prompt
  // waiting on a component that no longer exists.
  const ceremony = useRef<AbortController | null>(null);

  const hasPasskey = user.passkeys.length > 0;
  const hasAuthenticator = user.twoFactorEnabled;
  const nothingEnrolled = !hasPasskey && !hasAuthenticator;

  // A passkey on the account is no use on a browser that cannot perform an
  // assertion — an old browser, or a locked-down one. Saying so is better than
  // offering a button that can only fail.
  const canPrompt = hasPasskey && supportsWebAuthn();

  function report(error: unknown, refusalTitle: string) {
    const described = describeFailure(error, {
      refusal: refusalTitle,
      byKind: {
        unavailable: { title: "The account service could not be reached." },
        "rate-limited": { title: "Too many attempts from here." },
      },
      unknown: {
        title: "That could not be completed.",
        body: "Try again in a moment.",
      },
    });

    if (described) setFailure(described);
  }

  /**
   * Adopting the response rather than re-fetching the profile. The endpoint
   * answers with the same body `/me` would, so a second round trip would only
   * add a window in which the page still believes the old thing.
   */
  function adopt(next: CurrentUser) {
    setFailure(null);
    session.adopt(next);
  }

  async function proveWithPasskey() {
    setFailure(null);
    setPending(true);

    ceremony.current?.abort();
    const controller = new AbortController();
    ceremony.current = controller;

    try {
      const options = await beginReauthentication();
      const credential = await getPasskeyAssertion(options, controller.signal);
      adopt(await completeReauthentication(credential));
    } catch (error) {
      report(error, "That passkey was not accepted.");
    } finally {
      if (ceremony.current === controller) ceremony.current = null;
      setPending(false);
    }
  }

  async function proveWithCode(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setPending(true);

    try {
      adopt(await reauthenticateWithTotp(code));
    } catch (error) {
      report(error, "That code was not accepted.");
      setCode("");
    } finally {
      setPending(false);
    }
  }

  if (nothingEnrolled) {
    return (
      <>
        <Banner tone="error" title="This area needs a passkey or an authenticator app.">
          You signed in with a code sent to your email address, which confirms
          the address but says nothing about this device, so {purpose} stays
          closed until there is a second factor on the account.{" "}
          <Link to="/account/passkeys">Add a passkey</Link> or{" "}
          <Link to="/account/security">set up an authenticator app</Link>. You
          will be asked to use it here straight away — there is no need to sign
          out.
        </Banner>
      </>
    );
  }

  return (
    <div className="reauthenticate">
      <Banner tone="info" title="Confirm it is you.">
        You signed in with a code sent to your email address, which confirms the
        address but says nothing about this device. Use the second factor
        already on your account and {purpose} opens straight away — you stay
        signed in either way.
      </Banner>

      {failure ? (
        <Banner tone="error" title={failure.title}>
          {failure.body}
        </Banner>
      ) : null}

      {canPrompt ? (
        <section className="reauthenticate-option">
          <h2>Use your passkey</h2>
          <p>
            Your browser will ask for the same fingerprint, face or device PIN
            it asked for when you enrolled.
          </p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void proveWithPasskey()}
            disabled={pending}
          >
            {pending ? "Waiting for your device…" : "Confirm with a passkey"}
          </button>
        </section>
      ) : null}

      {hasPasskey && !canPrompt ? (
        <p className="auth-note">
          There is a passkey on your account, but this browser cannot use one.
          {hasAuthenticator ? " Use your authenticator app instead." : " "}
          {hasAuthenticator ? null : (
            <>
              {" "}
              <Link to="/account/security">Set up an authenticator app</Link> to
              get in from here.
            </>
          )}
        </p>
      ) : null}

      {hasAuthenticator ? (
        <section className="reauthenticate-option">
          <h2>Use your authenticator app</h2>
          <form onSubmit={(event) => void proveWithCode(event)} noValidate>
            <TextField
              label="Six-digit code"
              name="code"
              value={code}
              onChange={setCode}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              required
            />
            <SubmitButton pending={pending} pendingLabel="Checking…">
              Confirm
            </SubmitButton>
          </form>
        </section>
      ) : null}

      {/*
        Deliberately last and deliberately present. Somebody who has lost the
        device is not served by any of the above, and a page whose only exits
        are two things they cannot do is the dead end this component replaced.
      */}
      <p className="auth-note">
        Lost the device?{" "}
        <Link to="/account/passkeys">Manage your passkeys</Link>, or{" "}
        <button type="button" className="link-button" onClick={() => void session.signOut()}>
          sign out
        </button>
        .
      </p>
    </div>
  );
}
