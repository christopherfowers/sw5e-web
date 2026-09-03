/**
 * Running a request that the service might demand a proof of work for.
 *
 * The shape is deliberately "try, and solve only if told to". See the reasoning
 * in `challenge.ts`: the gate ships off, and solving unconditionally would burn
 * a second of every reader's CPU to satisfy a check nobody is making. The cost
 * is one wasted round trip on the first request after somebody turns it on.
 *
 * Retried exactly once. A challenge is single use, so a second refusal means
 * something is wrong that another solve will not fix — the difficulty moved
 * between issue and use, the clock is out, the secret was rotated mid-flight —
 * and a client that kept trying would hammer the endpoint it is meant to be
 * protecting while burning the reader's battery.
 */

import {
  challengeHeaders,
  isChallengeRequired,
  requestChallenge,
  type Challenge,
  type SolvedChallenge,
} from "./challenge";
import { solve as solveInline, type SolveResponse } from "./challenge-worker";

/** What the caller is told while this is happening. */
export type SolveProgress =
  | { kind: "solving"; attempts: number }
  | { kind: "solved"; attempts: number };

export interface ChallengedRequestOptions {
  /** Reports that work is happening, so a control can say so. */
  onProgress?: (progress: SolveProgress) => void;
  signal?: AbortSignal;
}

/**
 * Solves a challenge, in a worker when one can be started.
 *
 * The inline fallback is not a nicety. A worker can fail to start for reasons
 * that have nothing to do with this code — a policy in a managed browser, an
 * extension, a browser old enough to lack module workers — and the alternative
 * to a frozen second is not a smooth second, it is a reader who cannot register
 * at all. So the tab is allowed to stall rather than the account be refused,
 * and the caller is told work is happening either way.
 */
export function solveChallenge(
  challenge: Challenge,
  onProgress?: (progress: SolveProgress) => void,
): Promise<SolvedChallenge> {
  const request = { salt: challenge.salt, difficulty: challenge.difficulty };

  const finish = (counter: number): SolvedChallenge => ({
    ...challenge,
    counter,
  });

  let worker: Worker;
  try {
    worker = new Worker(new URL("./challenge-worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return new Promise((resolve, reject) => {
      try {
        solveInline(request, (response) => {
          if (response.kind === "progress") {
            onProgress?.({ kind: "solving", attempts: response.attempts });
          } else if (response.kind === "solved") {
            onProgress?.({ kind: "solved", attempts: response.attempts });
            resolve(finish(response.counter));
          } else {
            reject(new Error(response.reason));
          }
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  return new Promise<SolvedChallenge>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<SolveResponse>) => {
      const response = event.data;
      if (response.kind === "progress") {
        onProgress?.({ kind: "solving", attempts: response.attempts });
        return;
      }

      worker.terminate();

      if (response.kind === "solved") {
        onProgress?.({ kind: "solved", attempts: response.attempts });
        resolve(finish(response.counter));
      } else {
        reject(new Error(response.reason));
      }
    };

    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The challenge could not be solved in this browser."));
    };

    worker.postMessage(request);
  });
}

/**
 * Runs `send`, and if the service demands a proof of work, solves one and runs
 * it again with the headers.
 *
 * `send` takes the headers rather than closing over them so that this knows
 * nothing about which request it is running — registration, a sign-in code, or
 * whatever else the service decides to charge for later.
 */
export async function withChallenge<T>(
  send: (headers: Record<string, string>) => Promise<T>,
  options: ChallengedRequestOptions = {},
): Promise<T> {
  try {
    return await send({});
  } catch (error) {
    if (!isChallengeRequired(error)) throw error;

    const challenge = await requestChallenge(options.signal);
    const solved = await solveChallenge(challenge, options.onProgress);

    // Once. A second refusal is not something another solve will fix.
    return await send(challengeHeaders(solved));
  }
}
