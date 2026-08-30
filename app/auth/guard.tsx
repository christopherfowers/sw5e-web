/**
 * Route protection for a site with no runtime server.
 *
 * Be clear about what this is. There is no server rendering these pages and no
 * middleware in front of them: `/account` is a static HTML file that nginx
 * hands to anybody who asks. This component decides what that file *draws*
 * once JavaScript runs. It is a usability boundary — it keeps a signed-out
 * reader from staring at an account page that can never fill in, and it takes
 * them somewhere they can do something about it.
 *
 * It is not a security boundary, and nothing on the other side of it is
 * secret. Every page here is empty until the API answers, so what a determined
 * visitor gets by skipping this check is the same skeleton the crawler gets.
 * The API authorises every request on its own, and it has to: this code runs
 * on hardware the reader controls and can be edited from the console.
 *
 * The four states below are the reason this is a component and not a one-line
 * `if`. Collapsing `loading` into `anonymous` would bounce every signed-in
 * reader to the sign-in page for the length of one round trip, on every hard
 * navigation — the exact bug that makes an app feel like it forgets you.
 */

import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { Banner, SessionPending } from "~/components/auth-ui";
import { signInPathFor } from "./redirect";
import { hasAtLeast, ROLE_META } from "./roles";
import { useSession } from "./session";
import type { CurrentUser, Role } from "./types";

interface RequireSessionProps {
  /** The minimum role this area needs. Defaults to any signed-in account. */
  role?: Role;
  /** Rendered only once there is a signed-in account that clears `role`. */
  children: (user: CurrentUser) => React.ReactNode;
}

export function RequireSession({ role, children }: RequireSessionProps) {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const mustSignIn = session.status === "anonymous";
  const returnTo = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!mustSignIn) return;
    // `replace` so that pressing Back from the sign-in page does not land on
    // the protected page again and bounce straight back — the loop that makes
    // the Back button look broken.
    void navigate(signInPathFor(returnTo), { replace: true });
  }, [mustSignIn, navigate, returnTo]);

  if (session.status === "loading") {
    return <SessionPending label="Checking your account…" />;
  }

  if (session.status === "unavailable") {
    return (
      <div className="page">
        <Banner tone="error" title="Your account could not be loaded.">
          {session.error} Signing in and out are unavailable until this
          resolves. The reference itself is unaffected —{" "}
          <Link to="/">everything is still readable</Link>.
        </Banner>
        <p className="auth-actions">
          <button type="button" className="button" onClick={() => void session.refresh()}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  if (mustSignIn || !session.user) {
    // The navigation above is already queued; this is what the reader sees for
    // the frame before it lands, and what they see if JavaScript navigation
    // fails for any reason. It is a real page with a real link rather than a
    // blank screen, so the flow is never a dead end.
    return (
      <div className="page">
        <Banner tone="info" title="You need to be signed in to see this.">
          Taking you to the sign-in page.{" "}
          <Link to={signInPathFor(returnTo)}>Go there now</Link> if nothing
          happens.
        </Banner>
      </div>
    );
  }

  if (role && !hasAtLeast(session.user, role)) {
    // Deliberately not a redirect. Bouncing someone away from a link they
    // followed reads as a broken link; saying what the area needs, and what
    // they currently hold, reads as an answer.
    return (
      <div className="page">
        <Banner tone="error" title={`This area is for ${ROLE_META[role].label} accounts.`}>
          {ROLE_META[role].summary} Your account is{" "}
          <strong>{ROLE_META[session.role].label}</strong>, so it does not have
          access. <Link to="/account">Back to your account</Link>.
        </Banner>
      </div>
    );
  }

  return <>{children(session.user)}</>;
}
