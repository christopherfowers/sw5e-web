/**
 * "Edit this page" — from the page it edits.
 *
 * ## Why it exists
 *
 * The authoring screens were reachable from exactly one place: a button inside
 * `/account/contributions`, two clicks below the header, on a page nobody
 * visits to fix a typo. So somebody with every permission the site grants
 * could read a page with a wrong number on it and have no way to act on it
 * except to remember a URL. The reporting control next to this one had the
 * shape right — put the affordance on the thing — and this is the same idea
 * for the people who can do something about it directly.
 *
 * ## Why it is quiet
 *
 * It sits at the foot of the article beside the report link, in the same
 * register: a line of text, not a toolbar. Contributors read this site the
 * same way everybody else does, and a page that announces its own editability
 * above the content is a page that has put the maintainers ahead of the
 * readers. The counterweight to being quiet is being *present*, on every
 * document, with the type and key already filled in.
 *
 * ## Prerender safety
 *
 * Every content page is a static file written at build time and served to
 * everybody, so this component renders nothing at all until the session has
 * resolved — which is the state the prerendered HTML is frozen in. The first
 * client render therefore matches the served markup exactly, and the link
 * appears afterwards, in an update, only for an account that can use it.
 *
 * That also means this is not a permission check. It is a signpost. The
 * editor behind it re-checks the account, and the API refuses the write on its
 * own; somebody who forges their way to the link finds a form that will not
 * save.
 */

import { Link } from "react-router";

import { editorPath, historyPath } from "~/authoring/paths";
import { canUploadContent } from "~/auth/roles";
import { useSession } from "~/auth/session";

interface EditControlProps {
  /**
   * The site's own route segment for this kind of thing — `species`,
   * `enhanced-items` — which is what the authoring screens address documents
   * by, so no mapping table has to be kept in step here.
   */
  type: string;
  /** The document's key within that type. */
  slug: string;
}

export function EditControl({ type, slug }: EditControlProps) {
  const session = useSession();

  if (session.status !== "authenticated" || !canUploadContent(session.user)) {
    return null;
  }

  return (
    <p className="edit-control">
      <Link className="edit-control-link" to={editorPath(type, slug)}>
        Edit this page
      </Link>
      <span aria-hidden="true"> · </span>
      <Link className="edit-control-link" to={historyPath(type, slug)}>
        History
      </Link>
    </p>
  );
}
