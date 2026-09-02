/**
 * Slugs, and the property that matters most about them: the same document
 * produces the same ones every time it is built.
 *
 * These became addresses the moment headings in the rules text got anchors, so
 * a slug that shifts between builds is a link somebody pasted into a
 * conversation that now lands somewhere else — or nowhere. Everything below is
 * about that, and about the two ways it can go wrong: a slug that varies with
 * something it should not, and two headings claiming the same one.
 */

import { describe, expect, it } from "vitest";

import { slugify, uniqueSlugger } from "./slug";

describe("slugify", () => {
  it("lowercases and joins words with single dashes", () => {
    expect(slugify("Travel Pace")).toBe("travel-pace");
    expect(slugify("Climbing, Swimming, and Crawling")).toBe(
      "climbing-swimming-and-crawling",
    );
  });

  it("collapses a run of punctuation rather than emitting a run of dashes", () => {
    expect(slugify("Vision  &  Light")).toBe("vision-light");
    expect(slugify("Hit Points --- and Healing")).toBe("hit-points-and-healing");
  });

  it("leaves no dash at either end", () => {
    // The bug that made this one function instead of two. One of the copies it
    // replaced did not trim, so "Actions!" became `actions-` — invisible while
    // these were only used for aria-labelledby, and a link somebody retypes
    // without the trailing dash once they are addresses.
    expect(slugify("Actions!")).toBe("actions");
    expect(slugify("...Resting...")).toBe("resting");
    expect(slugify("— Aside —")).toBe("aside");
  });

  it("keeps digits, which several headings are mostly made of", () => {
    expect(slugify("Level 3 Powers")).toBe("level-3-powers");
    expect(slugify("2d10")).toBe("2d10");
  });

  it("is empty only when there was nothing addressable to begin with", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("a document's slugger", () => {
  it("hands out the plain slug the first time", () => {
    const slug = uniqueSlugger();

    expect(slug("Resting")).toBe("resting");
  });

  it("suffixes a repeat rather than handing out the same id twice", () => {
    // A rules chapter has several sections called "Variant" and several called
    // "Example". Without this they would all be `#variant`, every link to any
    // of them would land on the first, and the duplicate ids would break
    // aria-labelledby on the rest.
    const slug = uniqueSlugger();

    expect(slug("Variant")).toBe("variant");
    expect(slug("Variant")).toBe("variant-2");
    expect(slug("Variant")).toBe("variant-3");
  });

  it("counts by the slug rather than by the label it came from", () => {
    // "Hit Points" and "Hit points" are one address, so the second has to be
    // suffixed even though the labels differ.
    const slug = uniqueSlugger();

    expect(slug("Hit Points")).toBe("hit-points");
    expect(slug("Hit points")).toBe("hit-points-2");
  });

  it("gives an unaddressable heading a name rather than an empty id", () => {
    // An empty `id` cannot be linked to, and two of them are invalid markup.
    const slug = uniqueSlugger();

    expect(slug("***")).toBe("section");
    expect(slug("")).toBe("section-2");
  });

  it("produces the same ids for the same document every time", () => {
    // The property the anchors depend on. Two runs over identical headings
    // must agree, or a link that worked yesterday points somewhere else today.
    const headings = ["Time", "Movement", "Variant", "Variant", "Speed"];

    const first = headings.map(uniqueSlugger());
    const second = headings.map(uniqueSlugger());

    expect(first).toEqual(second);
    expect(first).toEqual(["time", "movement", "variant", "variant-2", "speed"]);
  });

  it("keeps separate documents separate", () => {
    // One slugger per page. Two pages both containing "Actions" must both get
    // `#actions`, because they are different pages.
    expect(uniqueSlugger()("Actions")).toBe("actions");
    expect(uniqueSlugger()("Actions")).toBe("actions");
  });
});
