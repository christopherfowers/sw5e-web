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

import { useOutletContext } from "react-router";

import { RequireSession } from "~/auth/guard";
import { ROLE_META } from "~/auth/roles";
import type { AccountContext } from "./account";

export default function AccountContributions() {
  // Read here rather than inside the guard so this page fails to compile if it
  // is ever moved out from under the account layout that supplies it.
  const { user } = useOutletContext<AccountContext>();

  return (
    <RequireSession role="contributor">
      {() => (
        <section className="account-section" aria-labelledby="contributions-heading">
          <h2 id="contributions-heading">Contributions</h2>
          <p className="account-section-lede">
            {ROLE_META.contributor.summary}
          </p>

          <dl className="account-facts">
            <div>
              <dt>Contributing as</dt>
              <dd>{user.displayName}</dd>
            </div>
          </dl>

          <p className="auth-note">
            Base game content is uploaded as schema-validated JSON documents and
            reviewed before it is published. The upload tool is not part of this
            release; until it lands, send corrections through the repository&apos;s
            issue tracker and they will be applied to the canonical content set.
          </p>
        </section>
      )}
    </RequireSession>
  );
}
