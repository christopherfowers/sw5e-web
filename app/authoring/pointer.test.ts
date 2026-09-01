/**
 * Reading and writing through a JSON Pointer.
 *
 * Small, and worth testing carefully: every edit anybody makes in this
 * interface goes through `setAtPointer` or `removeAtPointer`, and a document
 * is saved whole rather than as a patch — so a helper that lost a branch would
 * publish a document missing a section nobody touched.
 */

import { describe, expect, it } from "vitest";

import {
  getAtPointer,
  joinPointer,
  moveArrayItem,
  parentPointer,
  removeAtPointer,
  setAtPointer,
  splitPointer,
} from "./pointer";

describe("the notation", () => {
  it("escapes and unescapes the two characters that need it", () => {
    expect(joinPointer("", "hit/dice")).toBe("/hit~1dice");
    expect(joinPointer("", "a~b")).toBe("/a~0b");
    expect(splitPointer("/hit~1dice")).toEqual(["hit/dice"]);
    expect(splitPointer("/a~0b")).toEqual(["a~b"]);
  });

  it("treats the empty pointer as the whole document", () => {
    expect(splitPointer("")).toEqual([]);
    expect(parentPointer("")).toBe("");
    expect(parentPointer("/a/b")).toBe("/a");
  });
});

describe("reading", () => {
  const document = { name: "Bulky", tags: ["armor", "heavy"], speed: { walk: 30 } };

  it("walks objects and arrays", () => {
    expect(getAtPointer(document, "/name")).toBe("Bulky");
    expect(getAtPointer(document, "/tags/1")).toBe("heavy");
    expect(getAtPointer(document, "/speed/walk")).toBe(30);
    expect(getAtPointer(document, "")).toBe(document);
  });

  it("answers undefined for anything that is not there", () => {
    expect(getAtPointer(document, "/missing")).toBeUndefined();
    expect(getAtPointer(document, "/tags/9")).toBeUndefined();
    expect(getAtPointer(document, "/name/deeper")).toBeUndefined();
  });
});

describe("writing", () => {
  it("does not touch the document it was given", () => {
    // React has to see a new object to re-render. Mutating in place produces an
    // editor where typing does nothing until something else happens to repaint.
    const before = { name: "Bulky" };
    const after = setAtPointer(before, "/name", "Powered");

    expect(before).toEqual({ name: "Bulky" });
    expect(after).toEqual({ name: "Powered" });
    expect(after).not.toBe(before);
  });

  it("shares everything off the path, so a keystroke does not copy the corpus", () => {
    const features = [{ key: "rage" }];
    const before = { features, name: "Berserker" };
    const after = setAtPointer(before, "/name", "Berserker!") as typeof before;

    expect(after.features).toBe(features);
  });

  it("creates the containers the path implies, choosing by the next segment", () => {
    // What lets the form add the first entry to a list the document does not
    // have yet, without the caller preparing the ground.
    expect(setAtPointer({}, "/progression/0/level", 1)).toEqual({
      progression: [{ level: 1 }],
    });
    expect(setAtPointer({}, "/speed/walk", 30)).toEqual({ speed: { walk: 30 } });
  });

  it("replaces the whole document for the empty pointer", () => {
    expect(setAtPointer({ a: 1 }, "", { b: 2 })).toEqual({ b: 2 });
  });
});

describe("removing", () => {
  it("takes a property out rather than setting it to null", () => {
    const after = removeAtPointer({ name: "Bulky", summary: "" }, "/summary");
    expect(after).toEqual({ name: "Bulky" });
    expect("summary" in (after as object)).toBe(false);
  });

  it("closes the gap when an array entry goes", () => {
    // A hole would serialize as null and be refused as the wrong type, which
    // would report deleting the third feature as a type error on the third
    // feature.
    expect(removeAtPointer({ tags: ["a", "b", "c"] }, "/tags/1")).toEqual({
      tags: ["a", "c"],
    });
  });

  it("is a no-op for something that was not there", () => {
    // What happens when a reader clears an optional field twice.
    const document = { name: "Bulky" };
    expect(removeAtPointer(document, "/summary")).toEqual(document);
    expect(removeAtPointer(document, "/tags/2")).toEqual(document);
  });

  it("leaves the rest of the branch alone", () => {
    expect(removeAtPointer({ speed: { walk: 30, swim: 15 } }, "/speed/swim")).toEqual({
      speed: { walk: 30 },
    });
  });
});

describe("reordering", () => {
  it("moves an entry without disturbing the others", () => {
    // Order is content in this corpus — a class progression is read top to
    // bottom — so a list editor without this would make somebody retype four
    // rows to put one in the right place.
    expect(moveArrayItem({ rows: ["a", "b", "c"] }, "/rows", 2, 0)).toEqual({
      rows: ["c", "a", "b"],
    });
  });

  it("does nothing for a move that goes nowhere or off the end", () => {
    const document = { rows: ["a", "b"] };
    expect(moveArrayItem(document, "/rows", 1, 1)).toBe(document);
    expect(moveArrayItem(document, "/rows", 0, 5)).toBe(document);
    expect(moveArrayItem(document, "/nope", 0, 1)).toBe(document);
  });
});
