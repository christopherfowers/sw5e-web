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
import type { AccountContext } from "./account";

export default function AccountProfile() {
  const { user } = useOutletContext<AccountContext>();
  const role = effectiveRole(user);

  const passkeys = user.passkeys.length;
  const protectedByTotp = user.twoFactorEnabled;

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
