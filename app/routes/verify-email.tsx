/**
 * The other end of the verification email, and the first passkey.
 *
 * ## What verifying actually does, and why enrolment happens here
 *
 * It does not sign anybody in. Registration issues no credential, so a new
 * account has nothing to authenticate with — and the natural conclusion, that
 * verification must therefore create the session, is wrong. What the server
 * does instead is set a short-lived HttpOnly enrolment ticket, good for about
 * ten minutes and good for exactly one thing: registering the account's first
 * passkey. `GET /api/auth/me` answers 401 throughout.
 *
 * That is why the ceremony runs on this page rather than behind a link to
 * `/account/passkeys`. The account area is guarded on having a session, and
 * this reader has none — sending them there would bounce them to `/sign-in`,
 * to sign in with the passkey they have not made yet, which is the dead end
 * the ticket exists to avoid. `passkey/register/begin` and
 * `passkey/register/complete` accept the ticket in a session's place, and they
 * are the only two endpoints that do, so this page can do the whole job and
 * nothing else can.
 *
 * The reader therefore goes: link → verified, with a clock running → passkey
 * created → sign in with it. The window is stated rather than left to be
 * discovered, because a ticket that expires quietly is one people walk away
 * from mid-flow.
 *
 * ## Why the URL is read in an effect rather than during render
 *
 * This page is prerendered. The HTML nginx serves was rendered at build time
 * from the bare path `/verify-email`, with no query string, because there is
 * no request to take one from. In the browser the very same component renders
 * against the real URL, which does have `?email=…&token=…`. If the first render
 * branched on those, the two renders would disagree, and React would be
 * hydrating a tree that does not match the markup it was handed — the class of
 * bug that shows up as a blank section or a duplicated one, only in
 * production, only on the first paint.
 *
 * So the first render is unconditional: everyone, build machine included, gets
 * "checking". The URL and the browser's passkey support are both read
 * afterwards, in effects, which by definition only run in a browser and only
 * after hydration.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import {
  ApiError,
  beginPasskeyRegistration,
  completePasskeyRegistration,
  verifyEmail,
} from "~/auth/api";
import {
  createPasskey,
  hasPlatformAuthenticator,
  supportsWebAuthn,
  WebAuthnError,
} from "~/auth/webauthn";
import {
  AuthCard,
  Banner,
  SessionPending,
  SubmitButton,
  TextField,
} from "~/components/auth-ui";

import "~/styles/account.css";

export function meta() {
  return [
    { title: "Verify your email — Star Wars 5e" },
    { name: "robots", content: "noindex" },
  ];
}

type Phase = "checking" | "verified" | "enrolling" | "enrolled" | "incomplete-link" | "failed";

/**
 * The address was missing `email`, `token`, or both.
 *
 * Both halves are required — the token is scoped to the address it was issued
 * for — so a link carrying only one of them is a truncated link rather than a
 * rejected token, and saying "expired" would send the reader off to request a
 * replacement that arrives in exactly the same shape.
 */
class IncompleteLink extends Error {
  constructor() {
    super("the address is missing part of the verification link");
    this.name = "IncompleteLink";
  }
}

/**
 * How long the reader has, in whole minutes.
 *
 * Rounded up, and never below one: "you have 0 minutes" is worse than saying
 * nothing, and the exact seconds are noise next to a ten minute window. An
 * unparseable or already-past instant answers `null`, and the copy below drops
 * the number rather than printing "NaN minutes".
 */
function minutesUntil(instant: string): number | null {
  const expiry = new Date(instant).getTime();
  if (Number.isNaN(expiry)) return null;
  const remaining = Math.ceil((expiry - Date.now()) / 60_000);
  return remaining > 0 ? remaining : null;
}

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("checking");
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<{ title: string; body?: string } | null>(
    null,
  );
  const [verifyFailure, setVerifyFailure] = useState<string | null>(null);

  // See sign-in.tsx: probing hardware during render would make the prerendered
  // markup and the hydrated markup disagree.
  const [capability, setCapability] = useState<{
    webauthn: boolean;
    platform: boolean;
  } | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);
  const ceremony = useRef<AbortController | null>(null);

  // Read outside the effect so the dependencies below are the values
  // themselves. The `URLSearchParams` object is a fresh instance on every
  // navigation, and an effect that depended on it would re-run — and re-submit
  // a single-use token — for reasons that have nothing to do with the link
  // changing.
  const email = searchParams.get("email");
  const token = searchParams.get("token");

  useEffect(() => {
    let cancelled = false;

    // An incomplete link is treated as a verification that failed for a
    // particular reason, rather than as a synchronous branch that sets state
    // straight out of the effect body. Every outcome then lands the same way —
    // in a promise callback, after the first paint — which is both simpler to
    // read and the only shape that does not cascade an extra render before the
    // browser has drawn anything.
    const attempt =
      email && token
        ? verifyEmail(email, token)
        : Promise.reject(new IncompleteLink());

    void attempt.then(
      (result) => {
        if (cancelled) return;
        setExpiresIn(minutesUntil(result.enrollmentExpiresAt));
        setPhase("verified");
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof IncompleteLink) {
          setPhase("incomplete-link");
          return;
        }
        setVerifyFailure(
          error instanceof ApiError
            ? error.message
            : "That link could not be checked.",
        );
        setPhase("failed");
      },
    );

    // A verification token is single-use, so the result of an abandoned
    // attempt must not be acted on: React's StrictMode double-invokes effects
    // in development, and a navigation away mid-request would otherwise write
    // into an unmounted tree.
    return () => {
      cancelled = true;
    };
  }, [email, token]);

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

  // Abandon any prompt still open when this page goes away, so a later attempt
  // is not refused for having one outstanding.
  useEffect(() => () => ceremony.current?.abort(), []);

  // Whatever the outcome, the reader's attention has to be moved to it: this
  // page was reached from an email client, so nothing on screen is where they
  // left it.
  useEffect(() => {
    if (phase === "verified" || phase === "incomplete-link" || phase === "failed") {
      headingRef.current?.focus();
    }
    if (phase === "enrolled") doneHeadingRef.current?.focus();
  }, [phase]);

  async function enrolPasskey() {
    setFailure(null);
    setPhase("enrolling");

    ceremony.current?.abort();
    const controller = new AbortController();
    ceremony.current = controller;

    try {
      // Authorised by the enrolment ticket rather than by a session. These two
      // calls are the only ones that accept it.
      const options = await beginPasskeyRegistration();
      const credential = await createPasskey(options, controller.signal);
      await completePasskeyRegistration(credential, name.trim() || null);
      setPhase("enrolled");
    } catch (error) {
      setPhase("verified");
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof WebAuthnError) {
        setFailure({ title: error.message, body: error.hint ?? undefined });
        return;
      }
      if (error instanceof ApiError) {
        setFailure({
          title:
            error.kind === "unauthenticated"
              ? "That setup window has closed."
              : "The passkey could not be saved.",
          body:
            error.kind === "unauthenticated"
              ? "Request a new verification link and you can try again straight away."
              : error.message,
        });
        return;
      }
      setFailure({
        title: "The passkey could not be created.",
        body: "Try again in a moment.",
      });
    } finally {
      if (ceremony.current === controller) ceremony.current = null;
    }
  }

  if (phase === "checking") {
    return (
      <AuthCard title="Verifying your email address">
        <SessionPending label="Checking your link…" />
      </AuthCard>
    );
  }

  if (phase === "enrolled") {
    return (
      <AuthCard title="Your passkey is ready">
        <h2 className="sr-only" tabIndex={-1} ref={doneHeadingRef}>
          Passkey created
        </h2>
        <Banner tone="success" title="That is your account set up.">
          Signing in from now on is your device&apos;s own unlock — a
          fingerprint, your face, or the PIN you already use. There is no
          password to remember and nothing to lose.
        </Banner>
        <div className="auth-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void navigate("/sign-in")}
          >
            Sign in with your passkey
          </button>
        </div>
      </AuthCard>
    );
  }

  if (phase === "verified" || phase === "enrolling") {
    const unsupported = capability?.webauthn === false;
    const pending = phase === "enrolling";

    return (
      <AuthCard title="Your email address is verified">
        <h2 className="sr-only" tabIndex={-1} ref={headingRef}>
          Email verified
        </h2>

        <Banner tone="success" title="That is your address confirmed.">
          One thing left, and it is worth doing now:{" "}
          <strong>
            set up a passkey
            {expiresIn === null
              ? " in the next few minutes"
              : ` in the next ${expiresIn} minute${expiresIn === 1 ? "" : "s"}`}
          </strong>
          . This link is what lets you create your first one — you are not
          signed in yet, and creating it here is what makes signing in possible.
        </Banner>

        {failure ? (
          <Banner tone="error" title={failure.title}>
            {failure.body}
          </Banner>
        ) : null}

        {unsupported ? (
          <Banner tone="error" title="This browser cannot create passkeys.">
            Passkeys need a current version of Chrome, Edge, Safari or Firefox.
            Open this same link on a device that has one — the address stays
            verified either way.
          </Banner>
        ) : null}

        {/* Only shown once the probe has answered. Rendering it on a `null`
            capability would flash a warning at everybody. */}
        {capability?.webauthn && !capability.platform ? (
          <Banner tone="info" title="This device has no built-in authenticator.">
            There is no fingerprint reader, face unlock or PIN available here,
            so you will be asked for a hardware security key or for a passkey on
            your phone. Both work.
          </Banner>
        ) : null}

        <div className="auth-form">
          <TextField
            label="Name this passkey"
            name="name"
            value={name}
            onChange={setName}
            maxLength={60}
            disabled={pending || unsupported}
            hint="For your own reference — “Work laptop”, “iPhone”. Optional."
          />
          <div className="auth-actions">
            <SubmitButton
              type="button"
              pending={pending}
              pendingLabel="Waiting for your device…"
              disabled={unsupported}
              onClick={() => void enrolPasskey()}
            >
              Set up a passkey
            </SubmitButton>
          </div>
        </div>

        <p className="auth-note">
          If the window closes before you finish,{" "}
          <Link to="/register">ask for a new link</Link> — nothing is lost, and
          your address stays verified.
        </p>
      </AuthCard>
    );
  }

  if (phase === "incomplete-link") {
    return (
      <AuthCard title="This link is incomplete">
        <h2 className="sr-only" tabIndex={-1} ref={headingRef}>
          Verification link incomplete
        </h2>
        <Banner tone="error" title="Part of the verification link is missing.">
          It needs both the address it was sent to and the code that came with
          it, and some email clients break long links across lines. Copy the
          whole link from the message and paste it into the address bar, or{" "}
          <Link to="/register">request a new one</Link>.
        </Banner>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="That link did not work">
      <h2 className="sr-only" tabIndex={-1} ref={headingRef}>
        Verification failed
      </h2>
      <Banner
        tone="error"
        title={verifyFailure ?? "The link could not be verified."}
      >
        Verification links can only be used once and expire after an hour.{" "}
        <Link to="/register">Request a new one</Link> and it will arrive within
        a minute or two.
      </Banner>
    </AuthCard>
  );
}
