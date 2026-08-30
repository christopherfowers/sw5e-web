/**
 * Creating an account.
 *
 * There is no password field here and there never will be: the account model
 * is a verified email address plus a passkey. Registration collects the two
 * things a person has to type, and everything after it is a link in an inbox.
 *
 * This route exports no `loader`. That is load-bearing rather than incidental
 * — see the note in `app/routes/account.tsx`.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { ApiError, register } from "~/auth/api";
import { useSession } from "~/auth/session";
import { AuthCard, Banner, SubmitButton, TextField } from "~/components/auth-ui";

import "~/styles/account.css";

export function meta() {
  return [
    { title: "Create an account — Star Wars 5e" },
    {
      name: "description",
      content:
        "Create a Star Wars 5e community account. Accounts use a verified email address and a passkey; there is no password.",
    },
    // Nothing here is worth a search result, and an account page in an index
    // is an invitation to credential-stuffing traffic.
    { name: "robots", content: "noindex" },
  ];
}

/**
 * Deliberately permissive. The only address that matters is one the reader can
 * receive mail at, and that is settled by the verification link rather than by
 * a regular expression; a stricter pattern here would reject valid addresses
 * and teach nobody anything. This catches the typo — a missing "@", a trailing
 * comma — before it costs a round trip.
 */
function emailProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "That does not look like an email address.";
  }
  return null;
}

function displayNameProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Enter the name you want to be known by.";
  if (trimmed.length < 2) return "Use at least two characters.";
  if (trimmed.length > 60) return "Use 60 characters or fewer.";
  return null;
}

type Phase = "form" | "submitting" | "sent";

export default function Register() {
  const session = useSession();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ title: string; body?: string } | null>(
    null,
  );

  const confirmationRef = useRef<HTMLHeadingElement>(null);

  // The form is gone once it succeeds, so focus has to be put somewhere
  // deliberate. Without this it falls back to the document body and a keyboard
  // reader's next Tab starts again from the top of the page, with no idea that
  // anything happened.
  useEffect(() => {
    if (phase === "sent") confirmationRef.current?.focus();
  }, [phase]);

  if (session.status === "authenticated" && session.user) {
    return (
      <AuthCard title="You already have an account">
        <Banner tone="info" title={`Signed in as ${session.user.displayName}.`}>
          <Link to="/account">Go to your account</Link> to manage your passkeys
          and two-factor authentication.
        </Banner>
      </AuthCard>
    );
  }

  if (phase === "sent") {
    return (
      <AuthCard title="Check your inbox">
        <h2 className="sr-only" tabIndex={-1} ref={confirmationRef}>
          Verification email sent
        </h2>
        <Banner tone="success" title={`A verification link is on its way to ${email.trim()}.`}>
          Open it to finish setting up your account. The link is good for one
          use and expires after an hour.
        </Banner>
        <p className="auth-note">
          Nothing arrived? Check the spam folder, then{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setPhase("form");
              setFailure(null);
            }}
          >
            try a different address
          </button>
          .
        </p>
      </AuthCard>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const problems: Record<string, string> = {};
    const emailIssue = emailProblem(email);
    const nameIssue = displayNameProblem(displayName);
    if (emailIssue) problems.email = emailIssue;
    if (nameIssue) problems.displayName = nameIssue;

    setFieldErrors(problems);
    setFailure(null);
    if (Object.keys(problems).length > 0) return;

    setPhase("submitting");
    try {
      await register({ email: email.trim(), displayName: displayName.trim() });
      // The response is the same whether or not this address was already
      // registered — the API refuses to be an account-existence oracle — so
      // there is only one thing to show here.
      setPhase("sent");
    } catch (error) {
      setPhase("form");
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        setFailure({
          title:
            error.kind === "rate-limited"
              ? "Too many attempts from here."
              : "That could not be sent.",
          body: error.message,
        });
        return;
      }
      setFailure({ title: "That could not be sent.", body: "Try again shortly." });
    }
  }

  return (
    <AuthCard
      title="Create an account"
      lede="An account is only needed to contribute. The whole reference is readable without one."
      footer={
        <>
          Already have one? <Link to="/sign-in">Sign in with your passkey</Link>.
        </>
      }
    >
      {failure ? (
        <Banner tone="error" title={failure.title}>
          {failure.body}
        </Banner>
      ) : null}

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Email address"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          inputMode="email"
          required
          disabled={phase === "submitting"}
          error={fieldErrors.email ?? null}
          hint="Where the verification link goes. It is never shown publicly."
        />
        <TextField
          label="Display name"
          name="displayName"
          value={displayName}
          onChange={setDisplayName}
          autoComplete="nickname"
          maxLength={60}
          required
          disabled={phase === "submitting"}
          error={fieldErrors.displayName ?? null}
          hint="Shown next to anything you contribute."
        />

        <p className="auth-note">
          There is no password to choose. Once your address is verified you will
          set up a passkey — your device's fingerprint, face or PIN — which
          cannot be phished or reused anywhere else.
        </p>

        <div className="auth-actions">
          <SubmitButton pending={phase === "submitting"} pendingLabel="Sending…">
            Send verification link
          </SubmitButton>
        </div>
      </form>
    </AuthCard>
  );
}
