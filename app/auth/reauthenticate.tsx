/**
 * Proving a second factor without signing out first.
 *
 * The service refuses contributor and administrator work to a session that was
 * opened with an emailed code, which is right: a mailbox is what everything
 * else on the internet is recovered through, so it can never be the thing
 * standing between an attacker and the content of the site. What was wrong was
 * the only remedy on offer. Somebody who signed in by code and then enrolled a
 * passkey (a minute later, on the same screen, on the device in their hand)
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
 *
 * The ceremony itself lives in `useIdentityProof`, because a second screen now
 * runs it for a different reason. See `ConfirmIdentity`.
 */

import { Link } from "react-router";

import { CODE_LENGTH, useIdentityProof } from "./prove";
import { useSession } from "./session";
import type { CurrentUser } from "./types";
import { Banner, SubmitButton, TextField } from "~/components/auth-ui";

import "~/styles/account.css";

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
  const proof = useIdentityProof(user);

  if (proof.nothingEnrolled) {
    return (
      <Banner tone="error" title="This area needs a passkey or an authenticator app.">
        You signed in with a code sent to your email address, which confirms the
        address but says nothing about this device, so {purpose} stays closed
        until there is a second factor on the account.{" "}
        <Link to="/account/passkeys">Add a passkey</Link> or{" "}
        <Link to="/account/security">set up an authenticator app</Link>. You will
        be asked to use it here straight away. There is no need to sign out.
      </Banner>
    );
  }

  return (
    <div className="reauthenticate">
      <Banner tone="info" title="Confirm it is you.">
        You signed in with a code sent to your email address, which confirms the
        address but says nothing about this device. Use the second factor
        already on your account and {purpose} opens straight away. You stay
        signed in either way.
      </Banner>

      <IdentityProofControls proof={proof} />

      {proof.hasUnusablePasskey ? (
        <p className="auth-note">
          There is a passkey on your account, but this browser cannot use one.
          {proof.hasAuthenticator ? " Use your authenticator app instead." : " "}
          {proof.hasAuthenticator ? null : (
            <>
              {" "}
              <Link to="/account/security">Set up an authenticator app</Link> to
              get in from here.
            </>
          )}
        </p>
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

interface ConfirmIdentityProps {
  /** The account behind the session being confirmed. */
  user: CurrentUser;
  /**
   * The action that was refused, as a verb phrase finishing "before you can".
   * For example "grant this role" or "delete this account".
   */
  action: string;
  /** Run once the session has been re-issued. Where the caller retries. */
  onConfirmed: () => void;
  /** Abandon the action. */
  onCancel: () => void;
}

/**
 * Asking for a factor the session already proved, because the action is one
 * that changes what somebody else may do.
 *
 * Distinct from {@link ReauthenticatePrompt} in what it says rather than in
 * what it does. That one is speaking to somebody who has proved nothing yet and
 * may have nothing to prove with, so it explains the rule and offers a way to
 * enrol. This one is speaking to an administrator who signed in with a passkey
 * hours ago, holds every credential the action needs, and is being asked purely
 * because of when they last used it. Telling them the site "needs a passkey"
 * would be telling them something they already did.
 *
 * There is no `nothingEnrolled` branch here and there cannot be one. The server
 * only asks for confirmation on a session that already carries a second factor,
 * so an account with nothing enrolled meets the other refusal instead and never
 * reaches this.
 */
export function ConfirmIdentity({
  user,
  action,
  onConfirmed,
  onCancel,
}: ConfirmIdentityProps) {
  const proof = useIdentityProof(user, onConfirmed);

  return (
    <div className="reauthenticate" role="group" aria-labelledby="confirm-identity-heading">
      <Banner tone="info" title="Confirm it is you.">
        <span id="confirm-identity-heading">
          This changes what another account may do, so it asks for your second
          factor again before you {action}. Your session is not ending and
          nothing has been saved yet.
        </span>
      </Banner>

      <IdentityProofControls proof={proof} />

      {proof.hasUnusablePasskey && !proof.hasAuthenticator ? (
        <p className="auth-note">
          There is a passkey on your account, but this browser cannot use one.
          Use a browser that can, or{" "}
          <Link to="/account/security">set up an authenticator app</Link>.
        </p>
      ) : null}

      <p className="auth-actions">
        <button type="button" className="button" onClick={onCancel} disabled={proof.pending}>
          Never mind
        </button>
      </p>
    </div>
  );
}

/**
 * The two controls, shared by both screens.
 *
 * Only the controls. Every sentence of explanation stays with the screen that
 * owns it, because the explanation is the entire difference between the two and
 * a shared component that tried to parameterise the wording would end up as a
 * list of strings with no way to read what either screen actually says.
 */
function IdentityProofControls({ proof }: { proof: ReturnType<typeof useIdentityProof> }) {
  return (
    <>
      {proof.failure ? (
        <Banner tone="error" title={proof.failure.title}>
          {proof.failure.body}
        </Banner>
      ) : null}

      {proof.canPrompt ? (
        <section className="reauthenticate-option">
          <h2>Use your passkey</h2>
          <p>
            Your browser will ask for the same fingerprint, face or device PIN it
            asked for when you enrolled.
          </p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void proof.proveWithPasskey()}
            disabled={proof.pending}
          >
            {proof.pending ? "Waiting for your device…" : "Confirm with a passkey"}
          </button>
        </section>
      ) : null}

      {proof.hasAuthenticator ? (
        <section className="reauthenticate-option">
          <h2>Use your authenticator app</h2>
          <form onSubmit={(event) => void proof.proveWithCode(event)} noValidate>
            <TextField
              label="Six-digit code"
              name="code"
              value={proof.code}
              onChange={proof.setCode}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              required
            />
            <SubmitButton pending={proof.pending} pendingLabel="Checking…">
              Confirm
            </SubmitButton>
          </form>
        </section>
      ) : null}
    </>
  );
}
