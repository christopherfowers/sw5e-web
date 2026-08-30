/**
 * Two-factor authentication: enrolling a TOTP authenticator app.
 *
 * The QR code is the fast path, not the only path, and treating it as the only
 * path is the usual mistake. A QR code cannot be read by a screen reader,
 * cannot be focused, and — the case nobody tests — cannot be scanned at all by
 * somebody browsing on the same phone their authenticator app is installed on,
 * which is a large share of readers. So the secret is always present as
 * selectable text, grouped in fours so it can be read aloud or copied by hand,
 * and the QR code is decorative on top of it.
 *
 * Recovery codes are shown once, at the end, and never again. Enrolling a
 * second factor without them is how people lose accounts: passkey on a phone
 * plus authenticator app on the same phone means one dropped phone and no way
 * back in. They are not part of the API contract as written; see the note in
 * `app/auth/types.ts`.
 */

import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";

import { ApiError, enrollTotp, verifyTotp } from "~/auth/api";
import { Banner, SubmitButton, TextField } from "~/components/auth-ui";
import { QrCode } from "~/components/qr-code";
import type { AccountContext } from "./account";

/** "JBSWY3DPEHPK3PXP" reads far better as "JBSW Y3DP EHPK 3PXP". */
function grouped(secret: string): string {
  return (
    secret
      .replace(/\s+/g, "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? secret
  );
}

type Phase = "idle" | "starting" | "enrolling" | "verifying" | "done";

export default function AccountSecurity() {
  const { user, refresh } = useOutletContext<AccountContext>();

  const [phase, setPhase] = useState<Phase>("idle");
  const [enrolment, setEnrolment] = useState<{
    secret: string;
    otpauthUri: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<{ title: string; body?: string } | null>(
    null,
  );

  const enrolHeadingRef = useRef<HTMLHeadingElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  // Each phase change replaces most of the panel, so focus is moved to the new
  // heading rather than left on a button that no longer exists.
  useEffect(() => {
    if (phase === "enrolling") enrolHeadingRef.current?.focus();
    if (phase === "done") doneHeadingRef.current?.focus();
  }, [phase]);

  function report(error: unknown, fallback: string) {
    if (error instanceof ApiError) {
      setFailure({ title: fallback, body: error.message });
      return;
    }
    setFailure({ title: fallback, body: "Try again in a moment." });
  }

  async function begin() {
    setFailure(null);
    setPhase("starting");
    try {
      const result = await enrollTotp();
      setEnrolment(result);
      setPhase("enrolling");
    } catch (error) {
      setPhase("idle");
      report(error, "Two-factor setup could not be started.");
    }
  }

  async function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = code.replace(/\s/g, "");
    if (digits.length !== 6) {
      setFailure({
        title: "Enter the six-digit code.",
        body: "It is the number your authenticator app is showing right now.",
      });
      return;
    }

    setFailure(null);
    setPhase("verifying");
    try {
      const result = await verifyTotp(digits);
      if (result.status !== "enrolled") {
        setFailure({
          title: "Setup did not complete.",
          body: "Start again from the beginning.",
        });
        setPhase("idle");
        setEnrolment(null);
        return;
      }
      setRecoveryCodes(result.recoveryCodes);
      setPhase("done");
      setCode("");
      await refresh();
    } catch (error) {
      setPhase("enrolling");
      setCode("");
      report(error, "That code was not accepted.");
    }
  }

  if (phase === "done" && recoveryCodes) {
    return (
      <section className="account-section" aria-labelledby="recovery-heading">
        <h2 id="recovery-heading" tabIndex={-1} ref={doneHeadingRef}>
          Two-factor authentication is on
        </h2>
        <Banner tone="success" title="Save these recovery codes now.">
          This is the only time they are shown. Each one signs you in once, if
          you ever lose both your passkey and your authenticator app. Keep them
          somewhere other than the device the app is on.
        </Banner>
        <ul className="recovery-codes">
          {recoveryCodes.map((recoveryCode) => (
            <li key={recoveryCode}>
              <code>{recoveryCode}</code>
            </li>
          ))}
        </ul>
        <p className="auth-note">
          From now on, signing in will ask for a code from your app after your
          passkey.
        </p>
      </section>
    );
  }

  if (user.mfa.totp && phase === "idle") {
    return (
      <section className="account-section" aria-labelledby="mfa-heading">
        <h2 id="mfa-heading">Two-factor authentication</h2>
        <Banner tone="success" title="An authenticator app is protecting this account.">
          Signing in asks for a six-digit code from your app as well as your
          passkey.
        </Banner>
        <p className="auth-note">
          Turning it off, or moving it to a new phone, is deliberately not
          something this page can do on its own — losing an authenticator app is
          the moment an account is most worth stealing. Sign in with a recovery
          code and it will walk you through re-enrolling.
        </p>
      </section>
    );
  }

  if (phase === "enrolling" || phase === "verifying") {
    const secret = enrolment?.secret ?? "";
    return (
      <section className="account-section" aria-labelledby="enrol-heading">
        <h2 id="enrol-heading" tabIndex={-1} ref={enrolHeadingRef}>
          Set up your authenticator app
        </h2>

        {failure ? (
          <Banner tone="error" title={failure.title}>
            {failure.body}
          </Banner>
        ) : null}

        <ol className="enrol-steps">
          <li>
            <h3>Add the account to your app</h3>
            <p>
              Scan this code with your authenticator app — or, if you are
              reading this on the same device the app is on, type the setup key
              in by hand.
            </p>
            <div className="enrol-pairing">
              {enrolment ? (
                <QrCode value={enrolment.otpauthUri} size={196} />
              ) : null}
              <div className="enrol-secret">
                <p className="enrol-secret-label" id="setup-key-label">
                  Setup key
                </p>
                {/* Selectable, copyable, readable aloud, and grouped so it can
                    be transcribed without losing your place. */}
                <p className="enrol-secret-value" aria-labelledby="setup-key-label">
                  <code>{grouped(secret)}</code>
                </p>
                <p className="auth-note">
                  Time-based, six digits, 30-second period — the defaults every
                  authenticator app uses.
                </p>
              </div>
            </div>
          </li>
          <li>
            <h3>Confirm it is working</h3>
            <form className="auth-form" onSubmit={submitCode} noValidate>
              <TextField
                label="Six-digit code"
                name="code"
                value={code}
                onChange={setCode}
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                required
                disabled={phase === "verifying"}
                hint="Whatever your app is showing for Star Wars 5e right now."
              />
              <div className="auth-actions">
                <SubmitButton
                  pending={phase === "verifying"}
                  pendingLabel="Checking…"
                >
                  Turn on two-factor authentication
                </SubmitButton>
                <button
                  type="button"
                  className="button"
                  disabled={phase === "verifying"}
                  onClick={() => {
                    setPhase("idle");
                    setEnrolment(null);
                    setCode("");
                    setFailure(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </li>
        </ol>
      </section>
    );
  }

  return (
    <section className="account-section" aria-labelledby="mfa-heading">
      <h2 id="mfa-heading">Two-factor authentication</h2>
      <p className="account-section-lede">
        A second factor means a stolen passkey is not enough on its own. It is
        optional, and it is worth turning on if your account can change content
        other people rely on.
      </p>

      {failure ? (
        <Banner tone="error" title={failure.title}>
          {failure.body}
        </Banner>
      ) : null}

      <p className="auth-note">
        You will need an authenticator app — 1Password, Bitwarden, Google
        Authenticator, Aegis and Ente Auth all work, among others.
      </p>

      <div className="auth-actions">
        <SubmitButton
          type="button"
          pending={phase === "starting"}
          pendingLabel="Preparing…"
          onClick={() => void begin()}
        >
          Set up an authenticator app
        </SubmitButton>
      </div>
    </section>
  );
}
