/**
 * The shared failure description, tested on the branch that was missing from
 * one of the five copies it replaced.
 *
 * `anAbandonedCeremonySaysNothing` is the load-bearing case. Everything else
 * here is a mapping table and would be caught by any of the screens that use
 * it; the abort guard is the one that fails silently in the other direction,
 * by painting an alarming banner for something the reader chose to stop.
 */

import { describe, expect, it } from "vitest";

import { ApiError, type ApiFailure } from "~/api/http";
import { WebAuthnError } from "./webauthn";
import { describeFailure } from "./failures";

const WORDING = {
  refusal: "That could not be completed.",
  unknown: { title: "Something went wrong.", body: "Try again in a moment." },
};

function apiError(kind: ApiFailure, message: string, code: string | null = null) {
  return new ApiError(kind, message, { status: 400, code });
}

describe("an abandoned ceremony", () => {
  it("says nothing at all", () => {
    // What a WebAuthn prompt rejects with when the page navigates away
    // mid-ceremony. One of the five screens this replaced had forgotten this
    // branch, so walking away from a prompt painted a failure banner for
    // something the reader had deliberately stopped.
    const aborted = new DOMException("The operation was aborted.", "AbortError");

    expect(describeFailure(aborted, WORDING)).toBeNull();
  });

  it("is not confused with any other DOMException", () => {
    // A cancelled prompt — the reader pressing Escape on the dialogue — is a
    // NotAllowedError, and that one does have something to say.
    const cancelled = new DOMException("Not allowed.", "NotAllowedError");

    expect(describeFailure(cancelled, WORDING)).toEqual(WORDING.unknown);
  });
});

describe("a WebAuthn failure", () => {
  it("is passed through, because it already carries a reader's sentence", () => {
    const error = new WebAuthnError("unsupported", "This browser cannot do that.", "Try another.");

    expect(describeFailure(error, WORDING)).toEqual({
      title: "This browser cannot do that.",
      body: "Try another.",
    });
  });

  it("carries no body when it has no hint, rather than an empty one", () => {
    const error = new WebAuthnError("unsupported", "This browser cannot do that.");

    expect(describeFailure(error, WORDING)).toEqual({
      title: "This browser cannot do that.",
      body: undefined,
    });
  });
});

describe("a refusal from the service", () => {
  it("uses the caller's title and the service's own explanation", () => {
    // The body is deliberately the server's message rather than anything this
    // side invents: it is written for a reader and knows what was wrong.
    const result = describeFailure(apiError("invalid", "That address is not valid."), WORDING);

    expect(result).toEqual({
      title: "That could not be completed.",
      body: "That address is not valid.",
    });
  });

  it("takes a per-kind title when the caller named that kind", () => {
    const result = describeFailure(apiError("rate-limited", "Wait a moment."), {
      ...WORDING,
      byKind: { "rate-limited": { title: "Too many attempts from here." } },
    });

    expect(result).toEqual({
      title: "Too many attempts from here.",
      body: "Wait a moment.",
    });
  });

  it("takes a per-kind body too, when one is given", () => {
    const result = describeFailure(apiError("unauthenticated", "Unauthorised."), {
      ...WORDING,
      byKind: {
        unauthenticated: { title: "That window has closed.", body: "Ask for another link." },
      },
    });

    expect(result).toEqual({
      title: "That window has closed.",
      body: "Ask for another link.",
    });
  });

  it("prefers a code over a kind, because a code is the more specific fact", () => {
    const result = describeFailure(apiError("conflict", "Refused.", "last-credential"), {
      ...WORDING,
      byKind: { conflict: { title: "Wrong answer." } },
      byCode: { "last-credential": { title: "That is your only passkey, so it was kept." } },
    });

    expect(result?.title).toBe("That is your only passkey, so it was kept.");
  });

  it("falls back to the plain refusal for a code nobody named", () => {
    const result = describeFailure(apiError("conflict", "Refused.", "something-else"), {
      ...WORDING,
      byCode: { "last-credential": { title: "Kept." } },
    });

    expect(result?.title).toBe("That could not be completed.");
  });
});

describe("anything else", () => {
  it("gets the caller's flat apology, with no detail invented for it", () => {
    expect(describeFailure(new TypeError("x is not a function"), WORDING)).toEqual(
      WORDING.unknown,
    );

    // Including things that are not errors at all. A thrown string is not
    // something a reader can be told anything useful about.
    expect(describeFailure("nope", WORDING)).toEqual(WORDING.unknown);
    expect(describeFailure(undefined, WORDING)).toEqual(WORDING.unknown);
  });
});
