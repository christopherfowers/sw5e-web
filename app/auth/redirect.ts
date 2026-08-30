/**
 * Where to send someone back to after they sign in.
 *
 * The destination travels through the URL, which means it is attacker-supplied
 * input: anyone can send a link to `/sign-in?next=https://evil.example/`, and
 * a client that navigates to whatever it finds there has built an open
 * redirect — a phishing primitive that borrows this site's domain for the
 * first hop.
 *
 * So this is an allow-list, not a block-list. A destination has to be a path
 * on this site and nothing else; anything the rules below do not positively
 * recognise becomes the account page.
 */

export const DEFAULT_SIGNED_IN_PATH = "/account";

/**
 * Every character a URL path, query or fragment is allowed to contain, per
 * RFC 3986, plus the delimiters that separate them.
 *
 * Spelled out as a set rather than tested with a "reject the bad ones" regex
 * because the dangerous characters here are the invisible ones. Browsers strip
 * tabs, newlines and carriage returns out of a URL *before* parsing it, so a
 * value of "/<tab>/evil.example" passes a `startsWith("/")` check, passes a
 * `startsWith("//")` rejection, and is then navigated to as
 * "//evil.example" — a host, not a path. A block-list has to remember that;
 * an allow-list cannot forget it.
 */
const PATH_CHARACTERS = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
    "abcdefghijklmnopqrstuvwxyz" +
    "0123456789" +
    "-._~" + // unreserved
    "!$&'()*+,;=" + // sub-delimiters
    ":@" + // permitted inside a path segment
    "/?#" + // the delimiters between path, query and fragment
    "[]" + // IPv6 literals and array-style query keys
    "%", // percent-encoding, already decoded once below
);

/**
 * The cases this rejects, and why each one is not covered by the one before:
 *
 *   `https://evil.example/`  absolute, obviously
 *   `//evil.example/`        protocol-relative; a browser reads this as a
 *                            host, and it starts with "/" so a naive
 *                            `startsWith("/")` check lets it straight through
 *   `/\evil.example`         the same trick with a backslash, which several
 *                            browsers normalise to "/" before parsing
 *   `javascript:alert(1)`    a scheme, not a path
 *   `%2F%2Fevil.example`     encoded, so it does not look like a host until
 *                            after it has been decoded
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_SIGNED_IN_PATH;

  // Decoding first is what makes the checks below meaningful: they have to run
  // against the string the browser will act on, not the one in the query.
  let candidate: string;
  try {
    candidate = decodeURIComponent(value);
  } catch {
    return DEFAULT_SIGNED_IN_PATH;
  }

  if (!candidate.startsWith("/")) return DEFAULT_SIGNED_IN_PATH;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return DEFAULT_SIGNED_IN_PATH;
  }

  for (const character of candidate) {
    if (!PATH_CHARACTERS.has(character)) return DEFAULT_SIGNED_IN_PATH;
  }

  return candidate;
}

/** Builds the sign-in URL that will return to `from` afterwards. */
export function signInPathFor(from: string): string {
  const next = safeNextPath(from);
  if (next === DEFAULT_SIGNED_IN_PATH) return "/sign-in";
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
