import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, safeNextPath, signInPathFor } from "./redirect";

/**
 * These are the tests that would have caught an open redirect. Each case is a
 * string that a naive `startsWith("/")` check accepts and a browser then
 * treats as another origin.
 */
describe("safeNextPath", () => {
  it("keeps a path on this site", () => {
    expect(safeNextPath("/account/passkeys")).toBe("/account/passkeys");
    expect(safeNextPath("/search?q=wookiee")).toBe("/search?q=wookiee");
  });

  it("refuses an absolute URL to another origin", () => {
    expect(safeNextPath("https://evil.example/steal")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath("http://evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses a protocol-relative URL, which starts with a slash but names a host", () => {
    expect(safeNextPath("//evil.example/steal")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses the backslash form that browsers normalise into a protocol-relative URL", () => {
    expect(safeNextPath("/\\evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses a control character that a browser would strip out of the URL", () => {
    // The browser removes the tab before parsing, leaving "//evil.example".
    expect(safeNextPath("/\t/evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath("/\n/evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath("/\r/evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses a scheme that is not a path at all", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath("data:text/html,<script>")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("decodes before judging, so an encoded host is still rejected", () => {
    expect(safeNextPath("%2F%2Fevil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath("%2f%5cevil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("falls back rather than throwing on a malformed escape", () => {
    expect(safeNextPath("/%zz")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("falls back when there is no destination", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath("")).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

describe("signInPathFor", () => {
  it("carries a safe destination through the query", () => {
    expect(signInPathFor("/account/security")).toBe(
      "/sign-in?next=%2Faccount%2Fsecurity",
    );
  });

  it("drops a hostile destination instead of passing it on", () => {
    expect(signInPathFor("//evil.example")).toBe("/sign-in");
  });

  it("omits the query when the destination is already the default", () => {
    expect(signInPathFor("/account")).toBe("/sign-in");
  });
});
