/**
 * The challenge client: what it sends, and when it decides to do the work.
 *
 * The solving itself is tested in `sha256.test.ts` against the published
 * vectors. What is tested here is the judgement around it, which is where the
 * expensive mistakes are: doing the work when nobody asked, refusing to do it
 * when they did, retrying forever, or mangling a value on the way into a header.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/api/http";
import {
  CHALLENGE_REQUIRED,
  challengeHeaders,
  isChallengeRequired,
  type SolvedChallenge,
} from "./challenge";
import { solve } from "./challenge-worker";
import { withChallenge } from "./challenge-solver";

const solved: SolvedChallenge = {
  salt: "9f2c1e0b7a4d5386c1f0b29e4d7a6853",
  difficulty: 18,
  // Seven fractional digits, which is what the service sends and what a
  // helpful client would round off.
  expiresAt: "2026-08-30T19:52:11.1234567+00:00",
  signature: "3f7c".repeat(16),
  counter: 41234,
};

function refusal(status: number, code: string | null): ApiError {
  // The kind is whatever the transport would have derived from the status; it
  // is not what this client branches on. `isChallengeRequired` reads the status
  // and the code deliberately, because "forbidden" is the kind for every 403
  // and cannot tell a challenge apart from a genuine refusal.
  const kind = status === 429 ? "rate-limited" : "forbidden";
  return new ApiError(kind, "refused", { status, code });
}

describe("recognising the refusal that means solve one", () => {
  it("accepts a 403 that says so", () => {
    expect(isChallengeRequired(refusal(403, CHALLENGE_REQUIRED))).toBe(true);
  });

  /**
   * The two that would be catastrophic to confuse. A 429 means stop and come
   * back later; treating it as a challenge would make the client solve and
   * retry immediately against a service already telling it to slow down. A 403
   * for any other reason would put it into the same loop against a service that
   * will never accept it.
   */
  it("refuses a 429, however it is worded", () => {
    expect(isChallengeRequired(refusal(429, CHALLENGE_REQUIRED))).toBe(false);
  });

  it("refuses a 403 that means something else", () => {
    expect(isChallengeRequired(refusal(403, "forbidden"))).toBe(false);
    expect(isChallengeRequired(refusal(403, null))).toBe(false);
  });

  it("refuses something that is not an API failure at all", () => {
    expect(isChallengeRequired(new Error("network"))).toBe(false);
    expect(isChallengeRequired(null)).toBe(false);
  });
});

describe("the headers a solution becomes", () => {
  /**
   * The whole point of this test is that nothing is reformatted. `expiresAt`
   * and `signature` are covered by the server's signature, so a client that
   * parsed the timestamp and printed it again — dropping a trailing zero, say,
   * or normalising the offset to `Z` — would produce a different string and
   * every solution it sent would be refused, with a message that says nothing
   * about dates.
   */
  it("passes the opaque values through byte for byte", () => {
    const headers = challengeHeaders(solved);

    expect(headers["X-Sw5e-Challenge-Expires"]).toBe(solved.expiresAt);
    expect(headers["X-Sw5e-Challenge-Signature"]).toBe(solved.signature);
    expect(headers["X-Sw5e-Challenge-Salt"]).toBe(solved.salt);
  });

  it("sends the numbers as plain decimals", () => {
    const headers = challengeHeaders(solved);

    expect(headers["X-Sw5e-Challenge-Difficulty"]).toBe("18");
    expect(headers["X-Sw5e-Challenge-Counter"]).toBe("41234");
  });

  it("sends all five and nothing else", () => {
    expect(Object.keys(challengeHeaders(solved)).sort()).toEqual([
      "X-Sw5e-Challenge-Counter",
      "X-Sw5e-Challenge-Difficulty",
      "X-Sw5e-Challenge-Expires",
      "X-Sw5e-Challenge-Salt",
      "X-Sw5e-Challenge-Signature",
    ]);
  });
});

describe("solving", () => {
  /**
   * A real solve, at a difficulty low enough to run in a unit test. The point
   * is that the counter it returns genuinely satisfies the rule the server will
   * apply — recomputed here from the salt rather than taken on trust.
   */
  it("returns a counter whose hash actually has the zeros", async () => {
    const { hasLeadingZeroBits, sha256 } = await import("./sha256");
    const salt = "0123456789abcdef0123456789abcdef";
    const difficulty = 12;

    let counter = -1;
    solve({ salt, difficulty }, (response) => {
      if (response.kind === "solved") counter = response.counter;
    });

    expect(counter).toBeGreaterThanOrEqual(0);

    const digest = sha256(new TextEncoder().encode(`${salt}:${counter}`));
    expect(hasLeadingZeroBits(digest, difficulty)).toBe(true);
  });

  it("finds the smallest counter, not merely a counter", async () => {
    const { hasLeadingZeroBits, sha256 } = await import("./sha256");
    const salt = "0123456789abcdef0123456789abcdef";
    const difficulty = 10;

    let counter = -1;
    solve({ salt, difficulty }, (response) => {
      if (response.kind === "solved") counter = response.counter;
    });

    // Nothing below it may work, or the search skipped a candidate.
    for (let candidate = 0; candidate < counter; candidate += 1) {
      const digest = sha256(new TextEncoder().encode(`${salt}:${candidate}`));
      expect(hasLeadingZeroBits(digest, difficulty)).toBe(false);
    }
  });

  it("reports progress while it works", () => {
    const report = vi.fn();
    // High enough to take many thousands of attempts, low enough to finish.
    solve({ salt: "progress", difficulty: 16 }, report);

    const kinds = report.mock.calls.map(([response]) => response.kind);
    expect(kinds).toContain("progress");
    expect(kinds.at(-1)).toBe("solved");
  });
});

/* --------------------------------------------------- solving only when asked */

/**
 * `withChallenge` decides whether any of the above happens at all.
 *
 * The gate ships switched off, so the common case for the foreseeable future is
 * that no work is done and no challenge is fetched. Getting that wrong is not a
 * correctness bug — everything still works — which is exactly why it needs a
 * test: a client that solved unconditionally would pass every other test in
 * this file while spending a second of every reader's CPU on nothing.
 */
describe("running a request that might be challenged", () => {
  const headersSeen: Record<string, string>[] = [];

  function sender(failures: (ApiError | null)[]) {
    let call = 0;
    return async (headers: Record<string, string>) => {
      headersSeen.push(headers);
      const failure = failures[call];
      call += 1;
      if (failure) throw failure;
      return "sent";
    };
  }

  beforeEach(() => {
    headersSeen.length = 0;
    vi.restoreAllMocks();
  });

  it("sends nothing extra, and fetches nothing, when the gate is off", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    await expect(withChallenge(sender([null]))).resolves.toBe("sent");

    expect(headersSeen).toEqual([{}]);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("does not solve for a refusal that is not a challenge", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    await expect(
      withChallenge(sender([refusal(429, CHALLENGE_REQUIRED)])),
    ).rejects.toThrow();

    // One attempt, no challenge fetched. A 429 answered by solving and retrying
    // immediately is the worst possible response to being told to slow down.
    expect(headersSeen).toHaveLength(1);
    expect(fetched).not.toHaveBeenCalled();
  });
});
