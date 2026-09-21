/**
 * The diff, tested on the edits people actually make.
 *
 * Every case below is a shape from this corpus rather than an invented one, and
 * most of them are here because the obvious implementation gets them wrong in a
 * way that looks fine on a two-field object: inserting a class feature, fixing a
 * typo inside a list entry, reordering a table.
 */

import { describe, expect, it } from "vitest";

import { diffDocuments, diffWords } from "./diff";
import { splitPointer } from "./pointer";

describe("scalars and objects", () => {
  it("reports nothing when two documents are the same content", () => {
    expect(diffDocuments({ name: "Wookiee" }, { name: "Wookiee" })).toEqual([]);
  });

  it("ignores the order object keys arrived in", () => {
    // Two responses for the same revision are not obliged to serialize their
    // properties in the same order, and a diff that reported a reordered key as
    // a change would light up every field of an untouched document.
    expect(
      diffDocuments({ name: "Wookiee", size: "Medium" }, { size: "Medium", name: "Wookiee" }),
    ).toEqual([]);
  });

  it("names the field that changed with a pointer the server would recognise", () => {
    const [change] = diffDocuments(
      { speed: { walk: 30 } },
      { speed: { walk: 35 } },
    );

    expect(change).toMatchObject({
      pointer: "/speed/walk",
      path: ["speed", "walk"],
      kind: "changed",
      before: 30,
      after: 35,
    });
  });

  it("tells an added field from a changed one", () => {
    const changes = diffDocuments({ name: "Ewok" }, { name: "Ewok", homeworld: "Endor" });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "added", pointer: "/homeworld" });
    expect(changes[0]!.before).toBeUndefined();
  });

  it("tells a removed field from a changed one", () => {
    const changes = diffDocuments({ name: "Ewok", homeworld: "Endor" }, { name: "Ewok" });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "removed", pointer: "/homeworld" });
    expect(changes[0]!.after).toBeUndefined();
  });

  it("escapes a key that would otherwise break the pointer", () => {
    const [change] = diffDocuments({ "hit/dice": 8 }, { "hit/dice": 10 });

    expect(change!.pointer).toBe("/hit~1dice");
    // And the pointer survives the round trip back into readable segments.
    expect(splitPointer(change!.pointer)).toEqual(["hit/dice"]);
  });
});

describe("lists, which is where a naive diff falls apart", () => {
  it("reports one insertion as one insertion rather than as the whole tail", () => {
    // The edit this whole module exists for. Index-wise comparison calls this
    // three changes and one addition; a reviewer then has to read four entries
    // to find out that nothing happened to three of them.
    const before = { features: ["Rage", "Reckless Attack", "Danger Sense"] };
    const after = {
      features: ["Rage", "Unarmored Defense", "Reckless Attack", "Danger Sense"],
    };

    const changes = diffDocuments(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "added", after: "Unarmored Defense" });
  });

  it("reports one deletion as one deletion", () => {
    const changes = diffDocuments(
      { tags: ["martial", "finesse", "light"] },
      { tags: ["martial", "light"] },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "removed", before: "finesse" });
  });

  it("matches list entries by their own key rather than by position", () => {
    // Feature lists get reordered by the migrator and by hand. Matching on the
    // key means a reordering alone reports nothing, which is the truth.
    const before = {
      features: [
        { key: "rage", level: 1 },
        { key: "danger-sense", level: 2 },
      ],
    };
    const after = {
      features: [
        { key: "danger-sense", level: 2 },
        { key: "rage", level: 1 },
      ],
    };

    expect(diffDocuments(before, after)).toEqual([]);
  });

  it("still finds the edit inside a keyed entry that moved", () => {
    const before = {
      features: [
        { key: "rage", level: 1 },
        { key: "danger-sense", level: 2 },
      ],
    };
    const after = {
      features: [
        { key: "danger-sense", level: 3 },
        { key: "rage", level: 1 },
      ],
    };

    const changes = diffDocuments(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "changed", before: 2, after: 3 });
    // Indexed by where it sits in the document the reviewer is reading.
    expect(changes[0]!.pointer).toBe("/features/0/level");
  });

  it("refuses to match by a name two entries share", () => {
    // "Extra Attack" appears under more than one archetype in this corpus.
    // Matching on a duplicated name pairs the wrong two rows and reports an
    // edit nobody made, so a duplicated candidate disqualifies that key.
    const before = {
      grants: [
        { name: "Extra Attack", level: 5 },
        { name: "Extra Attack", level: 11 },
      ],
    };
    const after = {
      grants: [
        { name: "Extra Attack", level: 5 },
        { name: "Extra Attack", level: 11 },
      ],
    };

    expect(diffDocuments(before, after)).toEqual([]);
  });

  it("reads a rewritten entry as an edit, not a deletion and an unrelated arrival", () => {
    const before = { lines: ["The blade ignites.", "It deals 1d8 damage."] };
    const after = { lines: ["The blade ignites.", "It deals 1d10 damage."] };

    const changes = diffDocuments(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "changed",
      pointer: "/lines/1",
      before: "It deals 1d8 damage.",
      after: "It deals 1d10 damage.",
    });
  });

  it("does not marry a deletion at the top to an arrival at the bottom", () => {
    // Pairing across the whole list would present two unrelated entries as one
    // edit. A diff that invents a change is worse than one that misses it.
    const before = { lines: ["gone", "kept", "kept too"] };
    const after = { lines: ["kept", "kept too", "brand new"] };

    const changes = diffDocuments(before, after);

    expect(changes.map((change) => change.kind).sort()).toEqual(["added", "removed"]);
  });
});

describe("prose", () => {
  it("keeps the unchanged text around the words that changed", () => {
    const spans = diffWords(
      "You gain a bonus to your attack rolls.",
      "You gain a bonus to your damage rolls.",
    );

    expect(spans.filter((span) => span.kind === "removed").map((s) => s.text.trim())).toEqual([
      "attack",
    ]);
    expect(spans.filter((span) => span.kind === "added").map((s) => s.text.trim())).toEqual([
      "damage",
    ]);
    expect(spans.some((span) => span.kind === "same")).toBe(true);
  });

  it("reassembles into exactly the two texts it was given", () => {
    // The spans carry the whitespace, so nothing is silently normalised on its
    // way through a diff a contributor is about to publish from.
    const before = "One.\n\nTwo three.";
    const after = "One.\n\nTwo, three.";
    const spans = diffWords(before, after);

    const rebuild = (kinds: string[]) =>
      spans.filter((span) => kinds.includes(span.kind)).map((span) => span.text).join("");

    expect(rebuild(["same", "removed"])).toBe(before);
    expect(rebuild(["same", "added"])).toBe(after);
  });

  it("merges neighbouring words into one span", () => {
    const spans = diffWords("alpha beta", "alpha gamma delta");
    // Not one element per token: a span per word would put hundreds of elements
    // in a paragraph and read as hundreds of fragments to a screen reader.
    expect(spans.filter((span) => span.kind === "added")).toHaveLength(1);
  });

  it("says nothing about text that did not change", () => {
    expect(diffWords("same", "same")).toEqual([{ text: "same", kind: "same" }]);
  });
});

describe("documents big enough to hang a browser", () => {
  it("still answers for a list far past the matching cap", () => {
    const before = { rows: Array.from({ length: 900 }, (_, n) => `row ${n}`) };
    const after = { rows: Array.from({ length: 900 }, (_, n) => `row ${n}`) };
    after.rows[500] = "row 500 corrected";

    const started = Date.now();
    const changes = diffDocuments(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.pointer).toBe("/rows/500");
    // The cap exists so this is fast rather than accurate-and-quadratic; if it
    // ever stops being fast, that is the thing worth knowing.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
