/**
 * Proving a second factor on a session that already exists.
 *
 * The ceremony, with no markup attached, because there are now two quite
 * different reasons to run it and only one of them was here first.
 *
 * The original reason is a session that never proved a factor at all: somebody
 * signed in with an emailed code and holds a role that needs more than a
 * mailbox. The second is a session that proved one this morning and is being
 * asked again because it is about to change what another account may do. The
 * copy those two want is not the same copy, and writing the second one as a
 * copy of the first would leave two implementations of the WebAuthn call to
 * keep in step.
 *
 * So the call lives here and the two screens are the thin part. See
 * `ReauthenticatePrompt` for the first and `ConfirmIdentity` for the second.
 */

import { useRef, useState } from "react";

import {
  beginReauthentication,
  completeReauthentication,
  reauthenticateWithTotp,
} from "./api";
import { describeFailure } from "./failures";
import { useSession } from "./session";
import type { CurrentUser } from "./types";
import { getPasskeyAssertion, supportsWebAuthn } from "./webauthn";

/** How many digits an authenticator code has. */
export const CODE_LENGTH = 6;

export interface IdentityProof {
  /** True while a ceremony is in flight. Disables both controls. */
  pending: boolean;
  /** The last refusal, in a sentence, or null. */
  failure: { title: string; body?: string } | null;
  /** The authenticator code as typed. */
  code: string;
  setCode: (value: string) => void;
  /** Whether a passkey prompt can actually be offered on this browser. */
  canPrompt: boolean;
  /** Whether the account has an authenticator app enrolled. */
  hasAuthenticator: boolean;
  /** Whether the account holds a passkey this browser cannot use. */
  hasUnusablePasskey: boolean;
  /** Whether the account holds neither factor. */
  nothingEnrolled: boolean;
  proveWithPasskey: () => Promise<void>;
  proveWithCode: (event: React.FormEvent) => Promise<void>;
}

/**
 * Runs the ceremony against the session in the browser and adopts the result.
 *
 * @param user The account behind the session being proved.
 * @param onProved
 *   Called once, after the session has been re-issued and adopted. Where the
 *   caller resumes whatever the refusal interrupted. Deliberately fired after
 *   the adopt rather than instead of it, so that a caller which retries a
 *   request is retrying it with the session the server just issued.
 */
export function useIdentityProof(
  user: CurrentUser,
  onProved?: () => void,
): IdentityProof {
  const session = useSession();

  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<{ title: string; body?: string } | null>(null);

  // So that navigating away mid-ceremony does not leave a WebAuthn prompt
  // waiting on a component that no longer exists.
  const ceremony = useRef<AbortController | null>(null);

  const hasPasskey = user.passkeys.length > 0;
  const hasAuthenticator = user.twoFactorEnabled;

  // A passkey on the account is no use on a browser that cannot perform an
  // assertion. An old browser, or a locked-down one. Saying so is better than
  // offering a button that can only fail.
  const canPrompt = hasPasskey && supportsWebAuthn();

  function report(error: unknown, refusalTitle: string) {
    const described = describeFailure(error, {
      refusal: refusalTitle,
      byKind: {
        unavailable: { title: "The account service could not be reached." },
        "rate-limited": { title: "Too many attempts from here." },
      },
      unknown: {
        title: "That could not be completed.",
        body: "Try again in a moment.",
      },
    });

    if (described) setFailure(described);
  }

  /**
   * Adopting the response rather than re-fetching the profile. The endpoint
   * answers with the same body `/me` would, so a second round trip would only
   * add a window in which the page still believes the old thing.
   */
  function adopt(next: CurrentUser) {
    setFailure(null);
    session.adopt(next);
    onProved?.();
  }

  async function proveWithPasskey() {
    setFailure(null);
    setPending(true);

    ceremony.current?.abort();
    const controller = new AbortController();
    ceremony.current = controller;

    try {
      const options = await beginReauthentication();
      const credential = await getPasskeyAssertion(options, controller.signal);
      adopt(await completeReauthentication(credential));
    } catch (error) {
      report(error, "That passkey was not accepted.");
    } finally {
      if (ceremony.current === controller) ceremony.current = null;
      setPending(false);
    }
  }

  async function proveWithCode(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setPending(true);

    try {
      adopt(await reauthenticateWithTotp(code));
    } catch (error) {
      report(error, "That code was not accepted.");
      setCode("");
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    failure,
    code,
    setCode,
    canPrompt,
    hasAuthenticator,
    hasUnusablePasskey: hasPasskey && !canPrompt,
    nothingEnrolled: !hasPasskey && !hasAuthenticator,
    proveWithPasskey,
    proveWithCode,
  };
}
