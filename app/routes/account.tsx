/**
 * The account area's frame: the guard, the section navigation, and sign-out.
 *
 * ## Why there is no `loader` in this file, or in any auth route
 *
 * This site sets `ssr: false` and prerenders every published path
 * (`react-router.config.ts`). A `loader` therefore does not run per request —
 * it runs **once, on the build machine, months before anybody visits**, and
 * whatever it returns is serialized into a static HTML file and into a `.data`
 * payload beside it. Those files are then served, byte for byte, to every
 * visitor, and cached by nginx and by every proxy in between.
 *
 * A `loader` that looked up the current user would therefore do one of two
 * things, both catastrophic: return nothing, because there is no session at
 * build time and the whole feature silently does nothing; or — if the build
 * ever had a session — bake one person's identity into a file handed to
 * everyone who asks for `/account`.
 *
 * So the rule for this area is: **no route module here exports `loader`.**
 * Identity is resolved after hydration, once, by `AuthProvider` calling
 * `GET /api/auth/me` (`app/auth/session.tsx`), and read from context by
 * whatever needs it. `app/auth/prerender-safety.test.ts` fails the build if a
 * `loader` reappears, because the failure it would cause is invisible: the
 * page still renders, the tests still pass, and the leak is in a cache.
 *
 * The pages here still prerender, and should: what they prerender is the
 * signed-out, identity-free skeleton, which is exactly what a static file
 * shared by every visitor is allowed to contain.
 */

import { NavLink, Outlet, useNavigate } from "react-router";

import { RequireSession } from "~/auth/guard";
import { canUploadContent, ROLE_META } from "~/auth/roles";
import { useSession } from "~/auth/session";
import type { CurrentUser } from "~/auth/types";

import "~/styles/account.css";

export function meta() {
  return [
    { title: "Your account — Star Wars 5e" },
    // An account page has nothing to offer a search engine, and every one of
    // them indexed is another target handed to credential-stuffing traffic.
    { name: "robots", content: "noindex" },
  ];
}

/** What the account pages receive through the outlet. */
export interface AccountContext {
  user: CurrentUser;
  /** Re-reads the account from the server after something changed it. */
  refresh: () => Promise<void>;
}

function AccountFrame({ user }: { user: CurrentUser }) {
  const session = useSession();
  const navigate = useNavigate();

  async function signOut() {
    // Leave the guarded area *first*, then end the session.
    //
    // The other order looks more natural and is wrong. Dropping the session
    // while this page is still mounted makes the route guard above notice an
    // anonymous reader on a protected route and send them to `/sign-in`,
    // remembering `/account` as where to return to — so someone who asked to
    // leave lands on a sign-in page pointed back at the page they just left.
    // Two navigations race, and the guard's usually wins.
    await navigate("/", { replace: true });
    await session.signOut();
  }

  const context: AccountContext = { user, refresh: session.refresh };

  return (
    <div className="page account-page">
      <div className="page-head account-head">
        <div>
          <p className="page-eyebrow">{ROLE_META[session.role].label} account</p>
          <h1>{user.displayName}</h1>
          <p className="lede">{user.email}</p>
        </div>
        <button type="button" className="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <div className="account-layout">
        <nav aria-label="Account sections" className="account-nav">
          <ul>
            <li>
              {/* `end` so that the profile link is not also marked current on
                  every section beneath it. */}
              <NavLink to="/account" end className={navClass}>
                Profile
              </NavLink>
            </li>
            <li>
              <NavLink to="/account/passkeys" className={navClass}>
                Passkeys
                <span className="account-nav-count">{user.passkeys.length}</span>
              </NavLink>
            </li>
            <li>
              <NavLink to="/account/security" className={navClass}>
                Two-factor
              </NavLink>
            </li>
            {canUploadContent(user) ? (
              <li>
                <NavLink to="/account/contributions" className={navClass}>
                  Contributions
                </NavLink>
              </li>
            ) : null}
          </ul>
        </nav>

        <div className="account-main">
          <Outlet context={context} />
        </div>
      </div>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "account-nav-link is-current" : "account-nav-link";
}

export default function Account() {
  return <RequireSession>{(user) => <AccountFrame user={user} />}</RequireSession>;
}
