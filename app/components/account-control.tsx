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
 * in" briefly on every page they opened. A flash of the wrong state that
 * looks exactly like having been logged out. Drawing something deliberately
 * neutral says nothing false, and because it reserves the same width, the real
 * control does not shove the search field sideways when it arrives.
 *
 * It is hidden from assistive technology rather than announced. "Loading" read
 * aloud on the header of every page is noise; a screen reader reaches the
 * header again, finds a link, and that is the whole story.
 */

import { Link, useLocation } from "react-router";

import { signInPathFor } from "~/auth/redirect";
import { useSession } from "~/auth/session";
import { MonogramPlate } from "./media";

export function AccountControl() {
  const session = useSession();
  /*
    The router's location, not `window.location`. Called before the early
    returns below because hooks must run unconditionally, and read from the
    router because this component renders during the prerender, where the
    global does not describe the page being built.
  */
  const location = useLocation();

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
        <span className="sr-only">, your account</span>
      </Link>
    );
  }

  // `unavailable` lands here too, on purpose. The account service being
  // unreachable is not a reason to remove the way in: a reader who wants to
  // sign in should reach a page that explains the outage, rather than find the
  // control has silently vanished from the header.
  return (
    <Link
      className="account-chip account-chip-signin"
      /*
        Carries where the reader is, so signing in puts them back there.

        The sign-in page has always honoured `?next=`, but only the route guard
        was setting it. Somebody bounced off a page they were not allowed to
        see went back to it afterwards, while somebody who simply pressed Sign
        in from the header landed on the account page. That is the more common
        path by far, and it is the one that dumped a reader somewhere they had
        not asked to go.

        The value is still validated on arrival by `safeNextPath`, which is an
        allow-list: this makes the common case work without widening what the
        sign-in page will accept. Building it here would be the wrong place for
        that check anyway, since the query string is attacker-supplied whatever
        writes it.
      */
      to={signInPathFor(`${location.pathname}${location.search}`)}
    >
      Sign in
    </Link>
  );
}
