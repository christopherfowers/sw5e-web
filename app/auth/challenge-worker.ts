/**
 * Solves a proof-of-work challenge off the main thread.
 *
 * At the difficulty the service issues this is up to 262,144 SHA-256 hashes.
 * On the main thread that is a frozen tab: no scrolling, no focus ring moving,
 * nothing repainting, on a page where somebody has just pressed a button and
 * is waiting to find out whether it worked. A worker is the difference between
 * a moment of "working…" and a browser offering to kill the page.
 *
 * The site's Content-Security-Policy allows `worker-src 'self'`, so this is
 * bundled and served from this origin like everything else. Nothing here is
 * fetched from anywhere.
 *
 * It reports progress as it goes, because the honest range of outcomes is wide:
 * the counter needed is geometric, so most solves land quickly and an unlucky
 * one takes several times the average. A control that says "working…" for four
 * seconds without moving is indistinguishable from one that has hung.
 */

import { hasLeadingZeroBits, sha256 } from "./sha256";

export interface SolveRequest {
  salt: string;
  difficulty: number;
}

export type SolveResponse =
  | { kind: "progress"; attempts: number }
  | { kind: "solved"; counter: number; attempts: number }
  | { kind: "failed"; reason: string };

/**
 * How often to report, in attempts.
 *
 * Chosen so the message rate stays in the low tens per second on the machines
 * this runs on rather than being a number somebody liked: posting per attempt
 * would spend more time in `postMessage` than in the hash it is reporting on.
 */
const REPORT_EVERY = 4096;

/**
 * The ceiling on attempts.
 *
 * Not a timeout, because a worker that has genuinely stalled will not run the
 * clock either. This is a guard against a difficulty nobody meant to issue —
 * a mistyped configuration asking for 40 bits would otherwise spin a reader's
 * fan until they closed the tab, and failing loudly is better than working
 * indefinitely towards something unreachable. At the difficulty the service
 * issues, exceeding this is roughly a one-in-ten-million accident.
 */
const MAX_ATTEMPTS = 50_000_000;

export function solve(
  request: SolveRequest,
  report: (response: SolveResponse) => void,
): void {
  const encoder = new TextEncoder();
  const { salt, difficulty } = request;

  for (let counter = 0; counter < MAX_ATTEMPTS; counter += 1) {
    // The service hashes `{salt}:{counter}` and so does this. The counter is
    // decimal with no padding and no separators, exactly as it is sent.
    if (hasLeadingZeroBits(sha256(encoder.encode(`${salt}:${counter}`)), difficulty)) {
      report({ kind: "solved", counter, attempts: counter + 1 });
      return;
    }

    if (counter > 0 && counter % REPORT_EVERY === 0) {
      report({ kind: "progress", attempts: counter });
    }
  }

  report({
    kind: "failed",
    reason: `No solution found in ${MAX_ATTEMPTS.toLocaleString("en-US")} attempts.`,
  });
}

/*
  The worker entry point.

  Guarded so this module can be imported by a test — and by the main thread, to
  reuse `solve` directly where a worker cannot be started — without registering
  a message handler in an environment that has no `self` to register it on.
*/
/*
  Typed structurally rather than as `DedicatedWorkerGlobalScope`. That type
  comes from the "webworker" lib, and adding it to tsconfig would put the
  worker's globals into scope for the whole application — including a `self`
  and a `postMessage` that a component could then call without the compiler
  objecting. Naming the two members this file uses keeps that surface at two
  members.
*/
declare const self:
  | {
      postMessage(message: SolveResponse): void;
      onmessage: ((event: MessageEvent<SolveRequest>) => void) | null;
      location: { origin: string };
    }
  | undefined;

/**
 * Whether a message arrived from the document that started this worker.
 *
 * For a dedicated worker this is very nearly a formality, and it is worth
 * being honest about why it is here rather than implying it closes a hole. A
 * dedicated worker has exactly one port and the document that constructed it
 * holds the only reference; there is no `postMessage` any other page can reach,
 * so there is no cross-origin sender to reject. Browsers signal that by leaving
 * `origin` empty on these messages.
 *
 * It is written down because "unreachable" is a property of how this file is
 * used today, and the cost of stating the assumption is three lines. If this
 * ever becomes a shared worker — which any page on the origin can connect to —
 * the check stops being a formality without anybody having to notice that it
 * needed adding.
 */
function isFromThisOrigin(origin: string): boolean {
  return origin === "" || origin === self?.location?.origin;
}

/**
 * Whether a message is a challenge this worker can attempt.
 *
 * The real reason this exists. Whatever the origin rule is worth, the handler
 * previously passed `event.data` into `solve` on the strength of its declared
 * type, and a declared type is a claim about the compiler's view of the call
 * site rather than about the bytes that arrive at runtime. A difficulty of 0
 * makes `hasLeadingZeroBits` true on the first attempt, so a malformed message
 * does not fail — it returns a counter of 0 as though it had solved something,
 * and the service rejects the answer with no indication of why.
 *
 * The bounds are the ones the protocol can actually mean: a digest is 256 bits,
 * so a difficulty outside 1..256 is unsatisfiable or vacuous rather than merely
 * unusual.
 */
function isSolveRequest(data: unknown): data is SolveRequest {
  if (typeof data !== "object" || data === null) return false;

  const { salt, difficulty } = data as Partial<SolveRequest>;

  return (
    typeof salt === "string" &&
    salt.length > 0 &&
    typeof difficulty === "number" &&
    Number.isInteger(difficulty) &&
    difficulty > 0 &&
    difficulty <= 256
  );
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (event: MessageEvent<SolveRequest>) => {
    if (!isFromThisOrigin(event.origin)) return;

    if (!isSolveRequest(event.data)) {
      self.postMessage({
        kind: "failed",
        reason: "The challenge could not be solved.",
      } satisfies SolveResponse);
      return;
    }

    try {
      solve(event.data, (response) => self.postMessage(response));
    } catch (error) {
      self.postMessage({
        kind: "failed",
        reason: error instanceof Error ? error.message : "The challenge could not be solved.",
      } satisfies SolveResponse);
    }
  };
}
