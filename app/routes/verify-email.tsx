/**
 * The other end of the verification email.
 *
 * The one thing worth reading closely here is why the token is pulled out of
 * the URL inside an effect rather than during render, when `useSearchParams`
 * would give it to us directly and with less code.
 *
 * This page is prerendered. The HTML nginx serves was rendered at build time
 * from the bare path `/verify-email`, with no query string, because there is
 * no request to take one from. In the browser the very same component renders
 * against the real URL, which does have `?token=…`. If the first render
 * branched on the token, those two renders would disagree, and React would be
 * hydrating a tree that does not match the markup it was handed — the class of
 * bug that shows up as a blank section or a duplicated one, only in
 * production, only on the first paint.
 *
 * So the first render is unconditional: everyone, build machine included,
 * gets "checking". The URL is read afterwards, in an effect, which by
 * definition only ever runs in a browser and only ever after hydration.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { ApiError, verifyEmail } from "~/auth/api";
import { useSession } from "~/auth/session";
import { AuthCard, Banner, SessionPending } from "~/components/auth-ui";

import "~/styles/account.css";

export function meta() {
  return [
    { title: "Verify your email — Star Wars 5e" },
    { name: "robots", content: "noindex" },
  ];
}

type Phase = "checking" | "verified" | "no-token" | "failed";

/** The address carried no `token` parameter at all. See the effect below. */
class MissingToken extends Error {
  constructor() {
    super("no verification token in the address");
    this.name = "MissingToken";
  }
}

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const session = useSession();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("checking");
  const [failure, setFailure] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // `adopt` is stable for the life of the provider — deliberately so, and this
  // effect is the reason. A rebuilt `adopt` re-runs the effect below, which
  // submits the verification token again; the token is single-use, so the
  // second attempt fails and turns a successful verification into an
  // unexplainable error. See `app/auth/session.tsx`.
  const { adopt } = session;

  // Read outside the effect so the dependency below is the token itself. The
  // `URLSearchParams` object is a fresh instance on every navigation, and an
  // effect that depended on it would re-run — and re-submit a single-use
  // token — for reasons that have nothing to do with the token changing.
  const token = searchParams.get("token");

  useEffect(() => {
    let cancelled = false;

    // A link with no token is treated as a verification that failed for a
    // particular reason, rather than as a synchronous branch that sets state
    // straight out of the effect body. Every outcome then lands the same way —
    // in a promise callback, after the first paint — which is both simpler to
    // read and the only shape that does not cascade an extra render before the
    // browser has drawn anything.
    const attempt = token
      ? verifyEmail(token)
      : Promise.reject(new MissingToken());

    void attempt.then(
      (result) => {
        if (cancelled) return;
        adopt(result.user);
        setPhase("verified");
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof MissingToken) {
          setPhase("no-token");
          return;
        }
        setFailure(
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
  }, [token, adopt]);

  // Whatever the outcome, the reader's attention has to be moved to it: this
  // page was reached from an email client, so nothing on screen is where they
  // left it.
  useEffect(() => {
    if (phase !== "checking") headingRef.current?.focus();
  }, [phase]);

  if (phase === "checking") {
    return (
      <AuthCard title="Verifying your email address">
        <SessionPending label="Checking your link…" />
      </AuthCard>
    );
  }

  if (phase === "verified") {
    return (
      <AuthCard title="Your email address is verified">
        <h2 className="sr-only" tabIndex={-1} ref={headingRef}>
          Email verified
        </h2>
        <Banner tone="success" title="That is your address confirmed.">
          One thing left: set up a passkey, so you can sign in again without a
          password or another email.
        </Banner>
        <div className="auth-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void navigate("/account/passkeys")}
          >
            Set up a passkey
          </button>
          <Link className="button" to="/account">
            Go to my account
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (phase === "no-token") {
    return (
      <AuthCard title="This link is incomplete">
        <h2 className="sr-only" tabIndex={-1} ref={headingRef}>
          Verification link incomplete
        </h2>
        <Banner tone="error" title="There is no verification code in this address.">
          Some email clients break long links across lines. Copy the whole link
          from the message and paste it into the address bar, or{" "}
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
      <Banner tone="error" title={failure ?? "The link could not be verified."}>
        Verification links can only be used once and expire after an hour.{" "}
        <Link to="/register">Request a new one</Link> and it will arrive within
        a minute or two.
      </Banner>
    </AuthCard>
  );
}
