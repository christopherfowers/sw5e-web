/**
 * The account affordance in the site header.
 *
 * This is the one piece of authenticated UI that appears on every page of the
 * site, including the ~130 prerendered content pages, so it is where the
 * static-hosting problem is most visible: the HTML nginx serves is identical
 * for every visitor and was written at build time, when nobody was signed in.
 *
 * It therefore renders three things, and the first one matters most:
 *
 *   loading  a placeholder the same size as the control that will replace it
 *   signed out   a link to sign in
 *   signed in    a link to the account, named and initialled
 *
 * The placeholder is not a nicety. If this component drew "Sign in" while the
 * session was still resolving, then every signed-in reader would see "Sign
 * in" briefly on every page they opened — a flash of the wrong state that
 * looks exactly like having been logged out. Drawing something deliberately
 * neutral says nothing false, and because it reserves the same width, the real
 * control does not shove the search field sideways when it arrives.
 *
 * It is hidden from assistive technology rather than announced. "Loading" read
 * aloud on the header of every page is noise; a screen reader reaches the
 * header again, finds a link, and that is the whole story.
 */

import { Link } from "react-router";

import { useSession } from "~/auth/session";
import { MonogramPlate } from "./media";

export function AccountControl() {
  const session = useSession();

  if (session.status === "loading") {
    return <span className="account-chip is-pending" aria-hidden="true" />;
  }

  if (session.status === "authenticated" && session.user) {
    return (
      <Link className="account-chip" to="/account">
        <span className="account-avatar">
          <MonogramPlate name={session.user.displayName} />
        </span>
        <span className="account-chip-name">{session.user.displayName}</span>
        <span className="sr-only">— your account</span>
      </Link>
    );
  }

  // `unavailable` lands here too, on purpose. The account service being
  // unreachable is not a reason to remove the way in: a reader who wants to
  // sign in should reach a page that explains the outage, rather than find the
  // control has silently vanished from the header.
  return (
    <Link className="account-chip account-chip-signin" to="/sign-in">
      Sign in
    </Link>
  );
}
