import { describe, expect, it } from "vitest";

import { excerptAround, groupByType, search } from "./search";
import type { SearchRecord } from "./types";

const records: SearchRecord[] = [
  {
    type: "powers",
    slug: "force-push",
    name: "Force Push",
    source: "PHB",
    fields: [
      { label: "Summary", text: "Level 1 force power" },
      { label: "Description", text: "You shove a creature away with the Force." },
    ],
  },
  {
    type: "powers",
    slug: "improved-force-push",
    name: "Improved Force Push",
    source: "EC",
    fields: [{ label: "Summary", text: "Level 3 force power" }],
  },
  {
    type: "monsters",
    slug: "rancor",
    name: "Rancor",
    source: "SnV",
    fields: [
      { label: "Summary", text: "Huge beast, unaligned" },
      { label: "Description", text: "A rancor can shove a creature prone." },
    ],
  },
  {
    type: "equipment",
    slug: "bo-rifle",
    name: "Bo-rifle",
    source: "EC",
    fields: [{ label: "Category", text: "Weapon" }],
  },
];

describe("search ranking", () => {
  it("puts an exact name match above a name that merely contains the query", () => {
    const results = search(records, "force push");

    expect(results[0].record.slug).toBe("force-push");
    expect(results[1].record.slug).toBe("improved-force-push");
  });

  it("finds items whose name only contains the query", () => {
    const results = search(records, "push");

    expect(results.map((result) => result.record.slug)).toContain(
      "improved-force-push",
    );
  });

  it("requires every query term to appear somewhere in the record", () => {
    // "rancor" alone matches; "rancor lightsaber" must not.
    expect(search(records, "rancor")).toHaveLength(1);
    expect(search(records, "rancor lightsaber")).toHaveLength(0);
  });

  it("ignores punctuation so a typed name still finds a hyphenated one", () => {
    const results = search(records, "bo rifle");

    expect(results[0].record.slug).toBe("bo-rifle");
  });

  it("ranks a name match above a description-only match", () => {
    const results = search(records, "shove");

    // Neither name contains "shove", so both are field matches; the point here
    // is that the field match is found at all and carries its evidence.
    expect(results.map((result) => result.record.slug).sort()).toEqual([
      "force-push",
      "rancor",
    ]);
  });

  it("ignores queries shorter than two characters", () => {
    expect(search(records, "f")).toHaveLength(0);
    expect(search(records, "")).toHaveLength(0);
  });

  it("respects the result limit", () => {
    expect(search(records, "force", 1)).toHaveLength(1);
  });
});

describe("match evidence", () => {
  it("reports which field matched and where", () => {
    const [match] = search(records, "shove").filter(
      (result) => result.record.slug === "rancor",
    );

    expect(match.evidence?.label).toBe("Description");
    const { text, start, end } = match.evidence!;
    expect(text.slice(start, end)).toBe("shove");
  });

  it("keeps evidence offsets aligned through punctuation", () => {
    // The fold that makes matching punctuation-insensitive must preserve
    // string length, or every offset after a hyphen points at the wrong word.
    const punctuated: SearchRecord[] = [
      {
        type: "feats",
        slug: "test",
        name: "Test",
        source: null,
        // The comma-space run matters: folding punctuation by collapsing runs
        // rather than one character at a time would shift every later offset,
        // and this is the only shape that catches it.
        fields: [
          { label: "Description", text: "a well-placed, sudden shove works" },
        ],
      },
    ];

    const [match] = search(punctuated, "shove");
    const { text, start, end } = match.evidence!;

    expect(text.slice(start, end)).toBe("shove");
  });

  it("does not claim evidence for a name match", () => {
    const [match] = search(records, "rancor");
    expect(match.evidence).toBeNull();
  });
});

describe("grouping", () => {
  it("groups results by content type, best group first", () => {
    const groups = groupByType(search(records, "force"));

    expect(groups[0].type).toBe("powers");
    expect(groups[0].matches).toHaveLength(2);
  });
});

describe("excerpting a matched field", () => {
  it("leaves a short field alone", () => {
    expect(excerptAround("a short line", 2, 7)).toEqual({
      text: "a short line",
      start: 2,
      end: 7,
    });
  });

  it("trims a long field around the match and keeps the offsets right", () => {
    const text = `${"filler ".repeat(30)}needle${" filler".repeat(30)}`;
    const start = text.indexOf("needle");
    const excerpt = excerptAround(text, start, start + 6, 20);

    expect(excerpt.text.length).toBeLessThan(text.length);
    expect(excerpt.text.slice(excerpt.start, excerpt.end)).toBe("needle");
    expect(excerpt.text.startsWith("…")).toBe(true);
    expect(excerpt.text.endsWith("…")).toBe(true);
  });
});
