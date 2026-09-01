/**
 * The contributor area.
 *
 * Guarded twice on purpose. The account layout has already established that
 * there is a signed-in account; this adds the role requirement, so the check
 * lives on the route that needs it rather than in a list somewhere else that
 * has to be kept in step with the routing table.
 *
 * A community account that reaches this URL — by typing it, by following an
 * old link, or because their role changed in another tab — gets an explanation
 * of what the area needs and what they hold, not a redirect. See
 * `app/auth/guard.tsx` for why, and for the limits of what any of this
 * protects: the API authorises every upload itself, because this file runs on
 * the reader's own machine.
 */

import { Link, useOutletContext } from "react-router";

import { RequireSession } from "~/auth/guard";
import { ROLE_META } from "~/auth/roles";
import { accountMeta, type AccountContext } from "./account";

export function meta() {
  return accountMeta("Contributions");
}

export default function AccountContributions() {
  // Read here rather than inside the guard so this page fails to compile if it
  // is ever moved out from under the account layout that supplies it.
  const { user } = useOutletContext<AccountContext>();

  return (
    <RequireSession role="Contributor">
      {() => (
        <section className="account-section" aria-labelledby="contributions-heading">
          <h2 id="contributions-heading">Contributions</h2>
          <p className="account-section-lede">
            {ROLE_META.Contributor.summary}
          </p>

          <dl className="account-facts">
            <div>
              <dt>Contributing as</dt>
              <dd>{user.displayName}</dd>
            </div>
          </dl>

          <p className="auth-actions">
            <Link className="button button-primary" to="/authoring">
              Open the authoring workspace
            </Link>
          </p>

          <p className="auth-note">
            Base game content is edited as schema-validated documents. Every
            change is written as a draft first, checked against its content
            type&apos;s schema, and kept as a revision that can be read and put
            back afterwards. Publishing a draft is an administrator&apos;s job;
            saving one is how a correction is proposed.
          </p>

          <p className="auth-note">
            What readers report is in <Link to="/account/flags">the review
            queue</Link>, and a report a reviewer has accepted leads straight
            into the editor for the thing it is about. It is worth starting
            there: it is where the community can reach you, and it is the only
            place a picture&apos;s missing artist can be recorded by the person
            who recognised the work.
          </p>
        </section>
      )}
    </RequireSession>
  );
}
