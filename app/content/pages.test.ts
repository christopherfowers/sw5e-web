/**
 * The words a built page carries, and the one property that matters about them.
 *
 * Every slot is optional, and a missing slot has to come back missing rather
 * than as an empty string or a null. The page reads each one with a fallback to
 * the wording it was built with, so "absent" is the signal that keeps a
 * deployment with no page documents looking exactly as it did before this type
 * existed. A slot that came back as `""` would pass a truthiness check nobody
 * wrote and blank a heading.
 */

import { describe, expect, it } from "vitest";

import { pageCopy } from "./pages";

describe("a page's own words", () => {
  it("answers an empty set for a page nobody has described", () => {
    expect(pageCopy("a-page-that-does-not-exist")).toEqual({});
  });

  /**
   * Never null, so no call site has to check before reading a slot.
   *
   * There is no useful difference between "no document" and "a document with
   * nothing filled in": both mean every slot falls back. Collapsing them here
   * is what keeps that distinction out of seven call sites on the front page.
   */
  it("never answers null, so a slot can always be read", () => {
    const copy = pageCopy("nothing-here");

    expect(copy).not.toBeNull();
    expect(copy.heroLede).toBeUndefined();
    expect(copy.booksHeading).toBeUndefined();
  });
});
