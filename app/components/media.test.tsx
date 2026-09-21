import { describe, expect, it } from "vitest";

import { safeExternalHref } from "./media";

/**
 * A credit's `link` is authored data. Today it comes from a reviewed content
 * file; the moment the authoring UI lands it comes from whatever a contributor
 * typed into a form, and the schema that validates it asks only for a URI.
 * `javascript:alert(1)` is a valid URI.
 *
 * So this is checked now rather than when the write path makes it reachable,
 * because that is the change that will be reviewed for its forms and its
 * permissions rather than for what the read side does with a string.
 */
describe("a link supplied by content", () => {
  it.each([
    "https://example.com/portfolio",
    "http://example.com/portfolio",
    "https://example.com/a?b=c#d",
  ])("is rendered when it is an ordinary web address (%s)", (link) => {
    expect(safeExternalHref(link)).not.toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ])("is dropped when its scheme could run or read something (%s)", (link) => {
    expect(safeExternalHref(link)).toBeNull();
  });

  it("is dropped when it is not an absolute address at all", () => {
    // Resolving a relative link against whatever page happens to be rendering
    // would point somebody's credit at an arbitrary route on this site.
    expect(safeExternalHref("/account/security")).toBeNull();
    expect(safeExternalHref("not a url")).toBeNull();
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
  });
});
