/**
 * The proof-of-work challenge the account API can demand.
 *
 * `docs/account-api-contract.md` is the contract; this is the client for it.
 * Two details from there are load-bearing enough to repeat, because both fail
 * silently and both cost an afternoon:
 *
 *   `difficulty` is leading zero **bits**, not hex characters. Counting
 *   characters asks for sixteen times the work at the difficulty the service
 *   issues, and the tab never finishes.
 *
 *   `expiresAt` and `signature` are echoed back **byte for byte**. Both are
 *   covered by the signature, so a client that parses the timestamp and
 *   formats it again produces a different string and every solution it sends
 *   is refused, with a message that says nothing about dates.
 *
 * ## Why the work is done only when it is asked for
 *
 * The gate ships switched off, and will stay off until somebody deliberately
 * turns it on with a secret. Solving unconditionally would spend a second of a
 * reader's CPU on every registration for as long as that is true, to satisfy a
 * check nobody is making.
 *
 * So the request is attempted plainly, and the challenge is solved only if the
 * service refuses it and says why. That is exactly what the `code` on the
 * refusal is for, and the contract says so: a `challenge-required` means solve
 * one and retry immediately, where a 429 means stop and come back later. The
 * cost is one wasted round trip on the first request after the gate is turned
 * on, against a second of everybody's CPU for every request before that.
 */

import { ApiError, apiRequest } from "~/api/http";

/** A challenge exactly as the service issued it. */
export interface Challenge {
  salt: string;
  difficulty: number;
  /** Opaque. Echoed back unparsed; see the note above. */
  expiresAt: string;
  /** Opaque. Echoed back unparsed; see the note above. */
  signature: string;
}

/** A solved challenge, ready to be turned into request headers. */
export interface SolvedChallenge extends Challenge {
  counter: number;
}

/**
 * The refusal that means "solve one of these and try again".
 *
 * Matched on the `code` rather than on the status, because 403 alone does not
 * distinguish this from any other refusal, and treating the wrong one as this
 * would put the client into a solve-and-retry loop against a service that will
 * never accept it.
 */
export const CHALLENGE_REQUIRED = "challenge-required";

export function isChallengeRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === CHALLENGE_REQUIRED
  );
}

/** Asks for a challenge. Never cached: one is good exactly once. */
export function requestChallenge(signal?: AbortSignal): Promise<Challenge> {
  return apiRequest<Challenge>("/api/auth/challenge", { signal });
}

/**
 * The five headers a solved challenge becomes.
 *
 * Split out so the solving and the sending can be tested apart, and because
 * every value here except the counter is passed through untouched — writing
 * that once is the whole defence against somebody helpfully normalising a
 * timestamp on its way into a header.
 */
export function challengeHeaders(solved: SolvedChallenge): Record<string, string> {
  return {
    "X-Sw5e-Challenge-Salt": solved.salt,
    "X-Sw5e-Challenge-Difficulty": String(solved.difficulty),
    "X-Sw5e-Challenge-Expires": solved.expiresAt,
    "X-Sw5e-Challenge-Signature": solved.signature,
    "X-Sw5e-Challenge-Counter": String(solved.counter),
  };
}
