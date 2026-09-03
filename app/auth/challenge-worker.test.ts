/**
 * What the worker accepts as a challenge.
 *
 * `solve` itself is covered by `challenge.test.ts`; this is about the message
 * handler wrapped around it, which is the part that touches data it did not
 * produce. The handler's parameter is typed `MessageEvent<SolveRequest>`, and a
 * declared type describes what the compiler believes about the call site rather
 * than what arrives at runtime — so every assertion here passes a value the
 * type says is impossible.
 *
 * The failure being guarded against is quiet rather than loud. A difficulty of
 * 0 satisfies `hasLeadingZeroBits` on the first attempt, so a malformed message
 * does not throw: it answers `{kind: "solved", counter: 0}` in about a
 * microsecond, the service rejects that answer, and the reader is told their
 * challenge failed with nothing anywhere saying why.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SolveResponse } from "./challenge-worker";

interface FakeScope {
  postMessage(message: SolveResponse): void;
  onmessage: ((event: MessageEvent) => void) | null;
  location: { origin: string };
}

const ORIGIN = "https://sw5e.test";

let posted: SolveResponse[];
let scope: FakeScope;

/**
 * Load the module against a fake worker global.
 *
 * The handler registers at import time, so the fake has to be in place before
 * the import and the module registry has to be reset between tests — otherwise
 * the second test observes the first test's handler, still holding the first
 * test's `posted` array, and passes for the wrong reason.
 */
async function startWorker(): Promise<void> {
  posted = [];
  scope = {
    postMessage: (message) => void posted.push(message),
    onmessage: null,
    location: { origin: ORIGIN },
  };

  vi.resetModules();
  vi.stubGlobal("self", scope);
  await import("./challenge-worker");
}

function send(data: unknown, origin = ""): void {
  scope.onmessage?.({ data, origin } as MessageEvent);
}

describe("the worker's message handler", () => {
  beforeEach(startWorker);

  it("solves a well-formed challenge", () => {
    send({ salt: "abc", difficulty: 8 });

    expect(posted.at(-1)?.kind).toBe("solved");
  });

  /**
   * The case that motivated the validation: zero bits is satisfied by the very
   * first digest, so without a check this reports a solve rather than a
   * failure — the shape a caller is least likely to look at twice.
   */
  it("refuses a difficulty of zero rather than reporting an instant solve", () => {
    send({ salt: "abc", difficulty: 0 });

    expect(posted).toEqual([
      { kind: "failed", reason: "The challenge could not be solved." },
    ]);
  });

  it.each([
    ["no salt", { difficulty: 8 }],
    ["an empty salt", { salt: "", difficulty: 8 }],
    ["a salt that is not a string", { salt: 42, difficulty: 8 }],
    ["a difficulty that is not a number", { salt: "abc", difficulty: "8" }],
    ["a fractional difficulty", { salt: "abc", difficulty: 8.5 }],
    ["a negative difficulty", { salt: "abc", difficulty: -1 }],
    // A digest is 256 bits, so this is unsatisfiable rather than merely slow.
    ["a difficulty wider than the digest", { salt: "abc", difficulty: 257 }],
    ["nothing at all", null],
    ["a string", "abc"],
  ])("refuses a message with %s", (_, data) => {
    send(data);

    expect(posted).toEqual([
      { kind: "failed", reason: "The challenge could not be solved." },
    ]);
  });

  /**
   * Origin. Very nearly a formality for a dedicated worker — the document that
   * constructed it holds the only port, and browsers leave `origin` empty on
   * these messages — but asserted so the rule is a decision rather than an
   * accident of what nothing currently sends.
   */
  it("accepts a message from the document that started it", () => {
    send({ salt: "abc", difficulty: 8 }, ORIGIN);

    expect(posted.at(-1)?.kind).toBe("solved");
  });

  it("ignores a message from anywhere else, silently", () => {
    send({ salt: "abc", difficulty: 8 }, "https://elsewhere.test");

    // Not a failure report: a message this worker has no relationship with is
    // not an answer to the request its own document is waiting on.
    expect(posted).toEqual([]);
  });
});
