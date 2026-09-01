/**
 * The account's own page: who you are, what you may do, and how well protected
 * the account is.
 *
 * The role section is the interesting part. It is written as an explanation
 * rather than as a badge, because "Community" on its own tells a reader
 * nothing about why the upload button they were told about is not there.
 * Naming the role, saying what it covers, and saying what the next one up
 * would add turns a dead end into an answer.
 *
 * Everything privileged is drawn from `~/auth/roles`. Nothing here compares a
 * role string in place; see that module for why.
 */

import { Link, useOutletContext } from "react-router";

import {
  canAdministerAccounts,
  canUploadContent,
  effectiveRole,
  ROLE_META,
} from "~/auth/roles";
import type { CurrentUser } from "~/auth/types";
import { Banner } from "~/components/auth-ui";
import type { AccountContext } from "./account";

/**
 * How the session reading this page was established, in plain words.
 *
 * Worth saying out loud, and not only for interest. The two things the page
 * goes on to offer — a warning about an unusable role, and an invitation to
 * enrol a passkey — both follow from this fact, and a page that acts on
 * something it never showed reads as arbitrary. Naming it first turns "why is
 * it asking me that?" into "because of how I got here".
 *
 * `null` is an older session established before the service recorded this.
 * There is nothing honest to say about it, so nothing is said.
 */
function describeAuthentication(
  method: CurrentUser["authenticationMethod"],
): string | null {
  switch (method) {
    case "passkey":
      return "You signed in on this device with a passkey.";
    case "totp":
      return "You signed in on this device with a code from your authenticator app.";
    case "email":
      return "You signed in on this device with a code emailed to you. That confirms the address, not the device.";
    default:
      return null;
  }
}

export default function AccountProfile() {
  const { user } = useOutletContext<AccountContext>();
  const role = effectiveRole(user);

  const passkeys = user.passkeys.length;
  const protectedByTotp = user.twoFactorEnabled;

  /**
   * The account holds an elevated role and has nothing to prove a device with,
   * so the role is currently decorative: every contributor and administrator
   * call the API offers will refuse it.
   *
   * This is the one thing on this page that is a warning rather than a
   * suggestion, because it is the one where something the reader already has
   * is not working. Everything else here is an offer.
   */
  const roleUnusable =
    user.secondFactorRequired && passkeys === 0 && !protectedByTotp;

  /**
   * Signed in with an emailed code and holding no passkey — the situation the
   * emailed-code path exists to create, and the moment enrolling one is most
   * obviously worth doing.
   *
   * Suppressed when the warning above is showing. Two messages about the same
   * missing thing, one alarmed and one calm, is how a page starts reading as a
   * nag; the warning already links to both pages, so the offer would add a
   * second voice and no new information.
   */
  const offerPasskey = !roleUnusable && !user.strongAuthentication && passkeys === 0;

  const signedInWith = describeAuthentication(user.authenticationMethod);

  return (
    <>
      <section className="account-section" aria-labelledby="account-details">
        <h2 id="account-details">Profile</h2>
        <dl className="account-facts">
          <div>
            <dt>Display name</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div>
            <dt>Email address</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{ROLE_META[role].label}</dd>
          </div>
        </dl>
      </section>

      <section className="account-section" aria-labelledby="account-security">
        <h2 id="account-security">How this account is protected</h2>

        {signedInWith ? (
          <p className="account-section-lede">{signedInWith}</p>
        ) : null}

        {roleUnusable ? (
          <Banner
            tone="error"
            title={`Your ${ROLE_META[role].label} role cannot be used yet.`}
          >
            Contributor and administrator work needs a session backed by a
            passkey or an authenticator app, and this account has neither — so
            those tools stay closed even though the role is granted.{" "}
            <Link to="/account/passkeys">Add a passkey</Link> or{" "}
            <Link to="/account/security">set up an authenticator app</Link>,
            then sign in again with it.
          </Banner>
        ) : null}

        {offerPasskey ? (
          <Banner tone="info" title="Add a passkey while you are here?">
            An emailed code works, but it means checking your inbox every time
            and it can be read by anyone who reaches that inbox. A passkey is
            your device&apos;s own unlock instead — one setup, and no code to
            wait for. <Link to="/account/passkeys">Add a passkey</Link>.
          </Banner>
        ) : null}

        <ul className="account-checklist">
          <li data-state={passkeys > 0 ? "done" : "todo"}>
            <span className="account-check-mark" aria-hidden="true" />
            <span>
              <strong>
                {passkeys === 0
                  ? "No passkey yet"
                  : `${passkeys} passkey${passkeys === 1 ? "" : "s"}`}
              </strong>
              <span className="account-check-detail">
                {passkeys === 0 ? (
                  <>
                    Without one you can only get back in through an emailed
                    link. <Link to="/account/passkeys">Add a passkey</Link>.
                  </>
                ) : (
                  <>
                    Signing in uses your device&apos;s own unlock.{" "}
                    <Link to="/account/passkeys">Manage passkeys</Link>.
                  </>
                )}
              </span>
            </span>
          </li>
          <li data-state={protectedByTotp ? "done" : "todo"}>
            <span className="account-check-mark" aria-hidden="true" />
            <span>
              <strong>
                {protectedByTotp
                  ? "Two-factor authentication is on"
                  : "Two-factor authentication is off"}
              </strong>
              <span className="account-check-detail">
                {protectedByTotp ? (
                  <>
                    A code from your authenticator app is required as well as
                    your passkey. <Link to="/account/security">Review</Link>.
                  </>
                ) : (
                  <>
                    Optional, and worth it if you contribute content.{" "}
                    <Link to="/account/security">Set it up</Link>.
                  </>
                )}
              </span>
            </span>
          </li>
        </ul>
      </section>

      <section className="account-section" aria-labelledby="account-role">
        <h2 id="account-role">What this account can do</h2>
        <p className="account-role-summary">{ROLE_META[role].summary}</p>

        {canUploadContent(user) ? (
          <p>
            <Link className="button" to="/account/contributions">
              Go to contributions
            </Link>
          </p>
        ) : (
          // The one thing a community account most wants to know at this
          // point, answered in place rather than left as a mystery.
          <p className="auth-note">
            Contributor access is granted by an admin rather than requested from
            this page. It is for people maintaining base game content; reading
            the reference never needs it.
          </p>
        )}

        {canAdministerAccounts(user) ? (
          <p className="auth-note">
            This account can also manage other accounts and the roles they
            hold. Those tools live outside the site.
          </p>
        ) : null}
      </section>
    </>
  );
}
