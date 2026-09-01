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

/**
 * The document title for one section of the account area.
 *
 * Every account address used to answer "Your account — Star Wars 5e", because
 * only this module exported `meta` and the sections beneath it inherited it.
 * Three tabs, three entries in a window list and three history entries were
 * therefore indistinguishable — to a screen-reader user moving between
 * windows, and to anybody reading a tab strip. Each section names itself
 * first, then the area, then the site, which is the order the rest of the site
 * already uses.
 *
 * `robots` rides along rather than being left to the caller. React Router uses
 * the descriptors of the deepest matching route and discards the ancestors'
 * entirely, so a section that exported a title alone would silently drop the
 * `noindex` this area depends on.
 */
export function accountMeta(section?: string) {
  return [
    {
      title: section
        ? `${section} — Your account — Star Wars 5e`
        : "Your account — Star Wars 5e",
    },
    // An account page has nothing to offer a search engine, and every one of
    // them indexed is another target handed to credential-stuffing traffic.
    { name: "robots", content: "noindex" },
  ];
}

export function meta() {
  return accountMeta();
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
    <>
      {/*
        Who the reader is, rather than what the page is. The page says what it
        is in the heading above, which is drawn whether or not any of this has
        resolved; none of it may be, so the display name is a paragraph here
        rather than the heading it used to be.
      */}
      <div className="account-identity">
        <div>
          <p className="page-eyebrow">{ROLE_META[session.role].label} account</p>
          <p className="account-identity-name">{user.displayName}</p>
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
            {/*
              Reports is offered to every signed-in account, not only to
              contributors. What it shows differs — a community account sees
              what it filed, a contributor sees the queue underneath — and that
              is a decision the page makes from the session rather than one the
              navigation makes by hiding a link. Hiding it would mean the
              reader who filed a report has nowhere to find out what happened
              to it.
            */}
            <li>
              <NavLink to="/account/flags" className={navClass}>
                Reports
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
    </>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "account-nav-link is-current" : "account-nav-link";
}

export default function Account() {
  return (
    <div className="page account-page">
      {/*
        The heading is drawn above the guard, so it is in the markup in every
        state the area can be in — including the one the prerendered file is
        frozen in.

        This page is a static file, served byte for byte to everybody, and its
        session is always `loading` at the moment it is written: identity is
        resolved after hydration and must never be baked in. A heading that
        waited for that answer would be absent from the file nginx serves,
        leaving a `<main>` landmark with no heading structure at all for every
        reader before hydration and every reader without JavaScript — and it
        would differ between the prerendered markup and the first client
        render, which is a hydration mismatch.

        So the heading says the one thing that is true in all four states, and
        says it unconditionally. What the reader may *see* still depends
        entirely on the session; what the page *is* does not.
      */}
      <div className="page-head">
        <h1>Your account</h1>
      </div>
      <RequireSession>{(user) => <AccountFrame user={user} />}</RequireSession>
    </div>
  );
}
