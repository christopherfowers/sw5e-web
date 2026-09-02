/**
 * Turning a thrown thing into the two sentences a reader needs.
 *
 * Five screens run a credential ceremony — register, verify-email, sign-in,
 * the passkey list, and the re-authentication prompt — and every one of them
 * had its own copy of the same three-branch cascade. The copies were not quite
 * identical, and the differences were not choices: one of them forgot the
 * abort guard, so cancelling a ceremony by navigating away painted a failure
 * for something the reader had deliberately stopped.
 *
 * That guard is the reason this module exists rather than a wish to see less
 * code. It has to be first, it has to be in every one of them, and it is the
 * easiest of the three to leave out because nothing goes wrong until somebody
 * navigates mid-prompt.
 *
 * ## What is shared and what is not
 *
 * The *structure* is shared: an abandoned ceremony says nothing, a WebAuthn
 * failure already carries a reader-facing sentence and a hint, an `ApiError`
 * carries the service's own explanation, and anything else gets a flat
 * apology. The *wording* is not, and deliberately is not — "that could not be
 * sent" is right on the registration form and wrong on the passkey list, and a
 * shared default would have quietly made one of them wrong. Every caller
 * states its own sentences, so this file contains no user-facing copy at all
 * beyond what the errors themselves carry.
 */

import { ApiError, type ApiFailure } from "~/api/http";
import { WebAuthnError } from "./webauthn";

/** A title, and optionally the sentence under it. */
export interface Failure {
  title: string;
  body?: string;
}

export interface FailureWording {
  /**
   * The title when the service refused the request itself — an ordinary 4xx
   * that is not covered by `byKind` or `byCode`. The body is the service's own
   * `message`, because it is written for a reader and is more specific than
   * anything this side could invent.
   */
  refusal: string;

  /**
   * What to say when the thrown thing is not one of ours at all: a bug, a
   * parse failure, something a browser extension did. There is nothing useful
   * to report, so the caller supplies both halves.
   */
  unknown: Failure;

  /**
   * Titles for particular kinds of API failure, when the caller distinguishes
   * them. A screen that does not name a kind treats it as an ordinary refusal,
   * which is what each of these screens did before this was extracted.
   */
  byKind?: Partial<Record<ApiFailure, Failure>>;

  /**
   * Whole answers for particular machine-readable codes. Checked before
   * `byKind`, because a code is more specific than the status that carried it.
   */
  byCode?: Record<string, Failure>;
}

/**
 * `null` means say nothing — the ceremony was abandoned, and an error message
 * for something the reader chose to stop is noise at best and alarming at
 * worst.
 */
export function describeFailure(
  error: unknown,
  wording: FailureWording,
): Failure | null {
  // First, always. A ceremony aborted by navigation rejects with this, and
  // every branch below would report it as a failure of the thing the reader
  // just walked away from.
  if (error instanceof DOMException && error.name === "AbortError") {
    return null;
  }

  // Already a sentence and a hint, both written for a reader, both specific to
  // what the authenticator actually did. Nothing here can improve on them.
  if (error instanceof WebAuthnError) {
    return { title: error.message, body: error.hint ?? undefined };
  }

  if (error instanceof ApiError) {
    const byCode = error.code ? wording.byCode?.[error.code] : undefined;
    if (byCode) return byCode;

    const byKind = wording.byKind?.[error.kind];
    if (byKind) return { title: byKind.title, body: byKind.body ?? error.message };

    return { title: wording.refusal, body: error.message };
  }

  return wording.unknown;
}
