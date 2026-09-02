/**
 * Where the contract suites are allowed to point.
 *
 * The account contract suite registers accounts. That is not a side effect to
 * be tidied up afterwards — it is the only way to test a registration client
 * against a real server. It is safe because the target is meant to be a
 * container that is thrown away when the job ends.
 *
 * It was pointed at the deployed QA site instead, and it did exactly what it
 * says it does: six accounts named "Contract Probe" in a shared environment,
 * sitting in the administrators' People page alongside the real ones, needing
 * a human to delete them one at a time. Nothing failed and nothing warned,
 * because from the suite's point of view a real API is a real API.
 *
 * So a suite that writes has to say so, and is refused any target that is not
 * disposable. Read-only suites are not restricted: running them against a
 * deployed environment is a good idea, and is how a client that disagrees with
 * a live service gets caught.
 */

/** Hosts a suite may create data on: a container on this machine. */
const DISPOSABLE = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The override, spelled out rather than a bare truthy flag.
 *
 * Somebody who genuinely wants to register accounts on a shared environment
 * has to type the consequence, so it cannot be set once in a shell and
 * forgotten, and cannot be pasted from a command whose meaning is unclear.
 */
const OVERRIDE = "yes-create-real-accounts-there";

/**
 * The API a writing suite may use, or `undefined` when none is configured and
 * the suite should skip.
 *
 * @throws when a target is configured that this suite must not write to. It
 * throws rather than skipping on purpose: silently doing nothing is how a
 * suite stops meaning anything, and the reader would see a green run.
 */
export function writableContractTarget(): string | undefined {
  const api = process.env.SW5E_CONTRACT_API;

  if (!api) return undefined;

  let hostname: string;

  try {
    hostname = new URL(api).hostname;
  } catch {
    throw new Error(`SW5E_CONTRACT_API is not a URL: ${api}`);
  }

  if (DISPOSABLE.has(hostname)) return api;

  if (process.env.SW5E_CONTRACT_ALLOW_SHARED === OVERRIDE) return api;

  throw new Error(
    [
      `Refusing to run an account contract suite against ${hostname}.`,
      "",
      "This suite registers accounts. Against a container that is discarded",
      "when the run ends that costs nothing; against a shared environment it",
      "leaves real rows that an administrator has to delete by hand. It has",
      "happened: six accounts named \"Contract Probe\" reached the deployed QA",
      "site this way.",
      "",
      "Point SW5E_CONTRACT_API at a container on this machine, or, if you",
      "really do intend to create accounts there, set",
      `SW5E_CONTRACT_ALLOW_SHARED=${OVERRIDE}`,
    ].join("\n"),
  );
}

/**
 * The API a read-only suite may use, or `undefined` when none is configured.
 *
 * Unrestricted by design: asking a deployed service what it actually returns
 * is the entire value of a contract test, and reading cannot leave anything
 * behind.
 */
export function readOnlyContractTarget(): string | undefined {
  return process.env.SW5E_CONTRACT_API;
}
