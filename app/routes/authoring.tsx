/**
 * The authoring workspace: its frame, its guard and its navigation.
 *
 * ## Why this is a place of its own rather than a tab in the account area
 *
 * `/account` is where somebody looks after themselves — their passkeys, their
 * two-factor, the reports they have filed. Correcting the reference is not
 * that. It is the work, it needs the width of the page, and a reader is in the
 * middle of it for an hour rather than for the thirty seconds it takes to
 * revoke a credential. Putting an editor for a class document into a column
 * beside an account sidebar would be squeezing the main event into the margin.
 *
 * `/account/contributions` stays where it is and links here. That split reads
 * correctly out loud: "contributions" is what this account has done,
 * "authoring" is where the doing happens.
 *
 * ## Why there is no `loader` in this file, or in any authoring route
 *
 * The same rule, and the same reason, as the account area — see
 * `app/routes/account.tsx` for the long version. This site sets `ssr: false`
 * and prerenders every published path, so a `loader` runs once on a build
 * machine and its result is written into a static file served to every visitor.
 * Here that would mean baking a build machine's view of the draft queue,
 * carrying the names of everybody with work outstanding, into a file behind a
 * CDN. `app/auth/prerender-safety.test.ts` fails the build if one reappears.
 *
 * ## Why the addresses carry their subject in the query string
 *
 * `/authoring/edit?type=class&key=guardian` rather than
 * `/authoring/edit/class/guardian`. There is no runtime server: a path is
 * either a file the build wrote or a 404 from nginx's fallback, and this
 * feature has to open on documents that do not exist yet as well as on the five
 * thousand that do. A path segment would need a prerendered file per document
 * plus a way to address one that has no document — a route that cannot exist.
 * A query string is read after hydration by a page that is one file, which is
 * the same shape `/search?q=` already has on this site.
 *
 * The cost is stated plainly: these three addresses are not linkable to a
 * crawler and are `noindex` anyway, which is correct for a tool nobody outside
 * the contributor group may use.
 */

import { NavLink, Outlet } from "react-router";

import { RequireSession } from "~/auth/guard";
import { useSession } from "~/auth/session";
import { canPublishContent, ROLE_META } from "~/auth/roles";
import type { CurrentUser } from "~/auth/types";

import "~/styles/account.css";
import "~/styles/authoring.css";

/**
 * The document title for one screen of the workspace.
 *
 * Each screen names itself first, then the area, then the site — the order the
 * rest of this site already uses, and the reason three open tabs can be told
 * apart. `robots` rides along rather than being left to the caller, because
 * React Router keeps only the deepest matching route's descriptors: a screen
 * that exported a title alone would silently drop the `noindex`.
 */
export function authoringMeta(section?: string) {
  return [
    {
      title: section
        ? `${section} — Authoring — Star Wars 5e`
        : "Authoring — Star Wars 5e",
    },
    // Nothing here is for a search engine, and every address indexed is another
    // one handed to traffic looking for a write endpoint.
    { name: "robots", content: "noindex" },
  ];
}

export function meta() {
  return authoringMeta();
}

/** What the authoring screens receive through the outlet. */
export interface AuthoringContext {
  user: CurrentUser;
  /** Whether this account may publish and revert, as opposed to only draft. */
  canPublish: boolean;
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "account-nav-link is-current" : "account-nav-link";
}

function Frame({ user }: { user: CurrentUser }) {
  const session = useSession();
  const canPublish = canPublishContent(user);
  const context: AuthoringContext = { user, canPublish };

  return (
    <>
      <div className="account-identity">
        <div>
          <p className="page-eyebrow">{ROLE_META[session.role].label} account</p>
          <p className="lede">
            {canPublish
              ? "You can draft corrections and publish them."
              : "You can draft corrections. An administrator publishes them."}
          </p>
        </div>
      </div>

      <div className="account-layout">
        <nav aria-label="Authoring sections" className="account-nav">
          <ul>
            <li>
              {/* `end`, or the worklist link would also be marked current on
                  the editor and the history beneath it. */}
              <NavLink to="/authoring" end className={navClass}>
                Worklist
              </NavLink>
            </li>
            <li>
              <NavLink to="/authoring/edit" className={navClass}>
                Editor
              </NavLink>
            </li>
            <li>
              <NavLink to="/authoring/history" className={navClass}>
                History
              </NavLink>
            </li>
          </ul>
          <p className="auth-note">
            Everything published here is checked against the content type&apos;s
            schema before it is stored, and every change is kept as a revision
            that can be read and put back.
          </p>
        </nav>

        <div className="account-main">
          <Outlet context={context} />
        </div>
      </div>
    </>
  );
}

export default function Authoring() {
  return (
    <div className="page authoring-page">
      {/*
        The heading is drawn above the guard so it is in the markup in every
        state this area can be in, including the one the prerendered file is
        frozen in. See `app/routes/account.tsx` for why a heading that waited
        for the session would leave a `<main>` landmark with no heading at all
        for every reader before hydration.
      */}
      <div className="page-head">
        <h1>Authoring</h1>
      </div>
      <RequireSession role="Contributor">{(user) => <Frame user={user} />}</RequireSession>
    </div>
  );
}
