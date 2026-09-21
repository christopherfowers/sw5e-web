/**
 * The downloadable sheets, as the front page reads them.
 *
 * These were four links to a Google Drive nobody here controlled. The site now
 * holds the files, which is what lets it say how many pages one has and draw
 * its first page, and it also means the site is making claims about files it
 * publishes, which is the part worth testing.
 */

import { describe, expect, it } from "vitest";

import { RESOURCES, resourceHref } from "./resources";

describe("the resources the corpus describes", () => {
  it("carries the four sheets", () => {
    expect(RESOURCES).toHaveLength(4);
  });

  /**
   * A run from one with nothing repeated, the same invariant the books and a
   * book's chapters hold. Two resources sharing a position render in whatever
   * order the tie break produces, so the row quietly reorders itself between
   * builds rather than failing.
   */
  it("is a run from one with nothing repeated", () => {
    const orders = RESOURCES.map((resource) => resource.order);

    expect([...orders].sort((a, b) => a - b)).toEqual(
      Array.from({ length: RESOURCES.length }, (_, index) => index + 1),
    );
  });

  it("puts the sheet you print before the ones you type into", () => {
    expect(RESOURCES[0]?.key).toBe("character-sheet");
    expect(RESOURCES[0]?.fillable).toBe(false);
  });

  /**
   * Every file is addressed by the name its document gives.
   *
   * The site's other assets are content-hashed by the build, which is right for
   * a stylesheet and wrong here: a resource document names its file, and a
   * hashed name would not resolve, so the address is the name, and this is the
   * assertion that notices if that ever stops being true.
   */
  it("addresses a file by the name its document gives", () => {
    for (const resource of RESOURCES) {
      expect(resourceHref(resource.file)).toBe(`/resources/${resource.file}`);
    }
  });

  it("only publishes PDFs", () => {
    for (const resource of RESOURCES) {
      expect(resource.file).toMatch(/\.pdf$/);
    }
  });
});

/**
 * What the site says about a file it altered.
 *
 * Every sheet here is a rebuild rather than the original. The fillable
 * character sheet carried an action that printed the document the moment it
 * was opened, and that does not survive publication. A reader is entitled to
 * know the file differs from what its author made, so the flag is carried all
 * the way to the page rather than being a note in a build log.
 */
describe("saying that a file was rebuilt", () => {
  it("marks every published sheet as rebuilt", () => {
    expect(RESOURCES.every((resource) => resource.sanitized)).toBe(true);
  });

  /**
   * And says what came out of the one that carried something.
   *
   * An empty `removed` list is meaningful rather than missing: it says the file
   * was rebuilt and carried nothing active. Only the fillable character sheet
   * had anything to remove, so a change that started quietly stripping content
   * from the others would show up here.
   */
  it("names what was removed, and only where something was", () => {
    const withRemovals = RESOURCES.filter(
      (resource) => resource.removed.length > 0,
    ).map((resource) => resource.key);

    expect(withRemovals).toEqual(["character-sheet-fillable"]);
    expect(
      RESOURCES.find((r) => r.key === "character-sheet-fillable")?.removed,
    ).toContain("an action that printed the document when it was opened");
  });
});
