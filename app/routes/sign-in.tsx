/**
 * Signing in with a passkey, and answering a second factor when one is set.
 *
 * The happy path is one button. Almost all of the code below is the other
 * paths, which is the right proportion: a passkey button that only works when
 * the hardware cooperates is a demo, not a sign-in page. What can go wrong,
 * and what this does about each:
 *
 *   the browser has no WebAuthn      say so, and offer the way forward that
 *                                    still exists — another device
 *   the device has no platform
 *   authenticator (no Touch ID,
 *   Windows Hello, screen lock)      still offer the button, because a
 *                                    security key or a phone can answer it,
 *                                    but say what will happen first
 *   the reader dismisses the prompt  a plain, blameless message and the button
 *                                    still there, ready
 *   the prompt times out             indistinguishable from the above by
 *                                    design; the copy covers both rather than
 *                                    guessing
 *   the page is not on HTTPS         named as the cause it is, instead of the
 *                                    generic security error the browser throws
 *   the API is unreachable           distinguished from "wrong credential", so
 *                                    nobody is told their passkey is bad when
 *                                    the service is simply down
 *
 * Capability probes run in an effect, never during render: this page is
 * prerendered on a build machine that has no `navigator`, and a first render
 * that consulted one would produce markup the browser then disagrees with.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import {
  ApiError,
  beginPasskeyLogin,
  completePasskeyLogin,
  verifyTotp,
} from "~/auth/api";
import { safeNextPath } from "~/auth/redirect";
import { useSession } from "~/auth/session";
import {
  getPasskeyAssertion,
  hasPlatformAuthenticator,
  supportsWebAuthn,
  WebAuthnError,
} from "~/auth/webauthn";
import { AuthCard, Banner, SubmitButton, TextField } from "~/components/auth-ui";

import "~/styles/account.css";

export function meta() {
  return [
    { title: "Sign in — Star Wars 5e" },
    {
      name: "description",
      content:
        "Sign in to your Star Wars 5e community account with a passkey. The reference itself is readable without an account.",
    },
    { name: "robots", content: "noindex" },
  ];
}

interface Failure {
  title: string;
  body?: string;
}

type Step = "passkey" | "totp";

export default function SignIn() {
  const [searchParams] = useSearchParams();
  const session = useSession();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("passkey");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  /**
   * `null` means "not probed yet", which is the state both the prerender and
   * the first client render are in. Only after the effect below runs does this
   * become a real answer, so nothing about the initial markup depends on the
   * hardware the page happens to be opened on.
   */
  const [capability, setCapability] = useState<{
    webauthn: boolean;
    platform: boolean;
  } | null>(null);

  const ceremony = useRef<AbortController | null>(null);
  const codeHeadingRef = useRef<HTMLHeadingElement>(null);

  const { adopt, status } = session;
  const destination = safeNextPath(searchParams.get("next"));

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

  // Someone who is already signed in has no business on this page — most often
  // they got here from a stale tab or the browser's back button.
  useEffect(() => {
    if (status === "authenticated") void navigate(destination, { replace: true });
  }, [status, destination, navigate]);

  // Abandon any prompt still open when this page goes away, so a later attempt
  // is not refused for having one outstanding.
  useEffect(() => () => ceremony.current?.abort(), []);

  useEffect(() => {
    if (step === "totp") codeHeadingRef.current?.focus();
  }, [step]);

  function reportFailure(error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") return;

    if (error instanceof WebAuthnError) {
      setFailure({ title: error.message, body: error.hint ?? undefined });
      return;
    }
    if (error instanceof ApiError) {
      setFailure({
        title:
          error.kind === "unavailable"
            ? "The account service could not be reached."
            : error.kind === "rate-limited"
              ? "Too many attempts from here."
              : "That passkey was not accepted.",
        body: error.message,
      });
      return;
    }
    setFailure({
      title: "Sign-in could not be completed.",
      body: "Try again in a moment.",
    });
  }

  async function signInWithPasskey() {
    setFailure(null);
    setPending(true);

    ceremony.current?.abort();
    const controller = new AbortController();
    ceremony.current = controller;

    try {
      const trimmed = email.trim();
      const options = await beginPasskeyLogin(trimmed ? { email: trimmed } : {});
      const credential = await getPasskeyAssertion(
        options.publicKey,
        controller.signal,
      );
      const result = await completePasskeyLogin(credential);

      if (result.status === "mfa-required") {
        setStep("totp");
        return;
      }
      adopt(result.user);
      void navigate(destination, { replace: true });
    } catch (error) {
      reportFailure(error);
    } finally {
      if (ceremony.current === controller) ceremony.current = null;
      setPending(false);
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
    setPending(true);
    try {
      const result = await verifyTotp(digits);
      if (result.status !== "authenticated") {
        // Enrolment and challenge share an endpoint; an "enrolled" reply to a
        // sign-in means the session is not what either side thought it was.
        setFailure({
          title: "That code did not complete sign-in.",
          body: "Start again from the beginning.",
        });
        setStep("passkey");
        return;
      }
      adopt(result.user);
      void navigate(destination, { replace: true });
    } catch (error) {
      setCode("");
      reportFailure(error);
    } finally {
      setPending(false);
    }
  }

  if (step === "totp") {
    return (
      <AuthCard
        title="One more step"
        lede="Your account is protected by an authenticator app."
      >
        <h2 className="sr-only" tabIndex={-1} ref={codeHeadingRef}>
          Enter your authentication code
        </h2>
        {failure ? (
          <Banner tone="error" title={failure.title}>
            {failure.body}
          </Banner>
        ) : null}
        <form className="auth-form" onSubmit={submitCode} noValidate>
          <TextField
            label="Six-digit code"
            name="code"
            value={code}
            onChange={setCode}
            // The browser and password managers both know this one; without it
            // an iPhone will not offer the code it just read from the SMS or
            // the app.
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            required
            disabled={pending}
            hint="From your authenticator app. It changes every 30 seconds."
          />
          <div className="auth-actions">
            <SubmitButton pending={pending} pendingLabel="Checking…">
              Verify and sign in
            </SubmitButton>
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={() => {
                setStep("passkey");
                setCode("");
                setFailure(null);
              }}
            >
              Start over
            </button>
          </div>
        </form>
      </AuthCard>
    );
  }

  const unsupported = capability?.webauthn === false;

  return (
    <AuthCard
      title="Sign in"
      lede="The whole reference is readable without an account. Signing in is for managing your own profile and, for contributors, uploading content."
      footer={
        <>
          No account yet? <Link to="/register">Create one</Link>.
        </>
      }
    >
      {failure ? (
        <Banner tone="error" title={failure.title}>
          {failure.body}
        </Banner>
      ) : null}

      {unsupported ? (
        <Banner tone="error" title="This browser does not support passkeys.">
          Passkeys need a current version of Chrome, Edge, Safari or Firefox.
          Open this page on a device that has one — your account and everything
          in it is unaffected.
        </Banner>
      ) : null}

      {/* Only shown once the probe has actually answered. Rendering it on a
          `null` capability would flash a warning at everybody, including the
          overwhelming majority for whom it is untrue. */}
      {capability?.webauthn && !capability.platform ? (
        <Banner tone="info" title="This device has no built-in authenticator.">
          There is no fingerprint reader, face unlock or PIN available here, so
          you will be asked for a hardware security key or for a passkey on
          your phone.
        </Banner>
      ) : null}

      <div className="auth-form">
        <div className="auth-actions">
          <SubmitButton
            type="button"
            pending={pending}
            pendingLabel="Waiting for your passkey…"
            disabled={unsupported}
            onClick={() => void signInWithPasskey()}
          >
            Continue with a passkey
          </SubmitButton>
        </div>

        <details className="auth-disclosure">
          <summary>My passkey is not being offered</summary>
          <p className="auth-note">
            Some passkeys are tied to an address rather than discoverable on
            their own. Enter yours and try again — it changes which credentials
            your device is asked for, and nothing else.
          </p>
          <TextField
            label="Email address"
            name="email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username webauthn"
            inputMode="email"
            disabled={pending || unsupported}
          />
        </details>

        <p className="auth-note">
          A passkey is your device's own unlock — a fingerprint, your face, or
          the PIN you already use. It never leaves the device, cannot be reused
          on another site, and there is nothing to remember or to leak.
        </p>
      </div>
    </AuthCard>
  );
}
