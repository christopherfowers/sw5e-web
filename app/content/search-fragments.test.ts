/**
 * The built search index points at headings the site actually renders.
 *
 * There are two sluggers. `app/content/slug.ts` names the headings on the page
 * and `scripts/build-content-fixture.mjs` writes the fragments that point at
 * them, and they are separate because they run in different places — the
 * script is plain ESM run by node before a bundler exists, the module is
 * TypeScript compiled into the application.
 *
 * Two implementations of one rule is a thing worth being uneasy about. This is
 * what stops it being a matter of trust: the index is read as built and every
 * fragment in it is recomputed with the application's own slugger. If either
 * side changes, this goes red, rather than a search result quietly landing at
 * the top of a chapter instead of at the section somebody was sent to.
 *
 * It also has to run over the real built index rather than a fixture of one,
 * because what is being checked is the artefact the site ships.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { uniqueSlugger } from "./slug";
import type { SearchRecord } from "./types";

const INDEX = path.join(
  import.meta.dirname,
  "..",
  "data",
  "fixture",
  "search-index.json",
);

function builtIndex(): SearchRecord[] {
  return JSON.parse(readFileSync(INDEX, "utf8")) as SearchRecord[];
}

describe("the fragments in the built search index", () => {
  it("are what this application's slugger produces, in document order", () => {
    const records = builtIndex();
    const mismatches: string[] = [];

    for (const record of records) {
      // One slugger per document, fed the headings in the order they appear —
      // which is the order the page assigns ids in. A slug computed in any
      // other order collides differently and points somewhere else.
      const slug = uniqueSlugger();

      for (const field of record.fields) {
        if (field.label !== "Section") continue;

        const expected = slug(field.text);
        if (field.fragment !== expected) {
          mismatches.push(
            `${record.type}/${record.slug} "${field.text}": ` +
              `index says #${field.fragment}, the site renders #${expected}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("covers the headings inside a chapter, not only its outer sections", () => {
    /*
      The regression that started this. A rules chapter is one section with
      forty-odd headings inside it, and only the outer one was indexed — so the
      site held the rule for difficult terrain and could not find it. Searching
      "difficult terrain" returned nothing.
    */
    const chapter = builtIndex().find((record) => record.name === "Adventuring");

    expect(chapter, "the fixture must contain the Adventuring chapter").toBeDefined();

    const sections = chapter!.fields.filter((field) => field.label === "Section");

    expect(sections.length).toBeGreaterThan(20);
    expect(sections.map((field) => field.text)).toContain("Difficult Terrain");
  });

  it("gives every indexed heading somewhere to point", () => {
    // A heading with no fragment is a search result that lands at the top of
    // the page, which is the behaviour this replaced.
    const withoutFragment = builtIndex()
      .flatMap((record) =>
        record.fields
          .filter((field) => field.label === "Section" && !field.fragment)
          .map((field) => `${record.type}/${record.slug} "${field.text}"`),
      );

    expect(withoutFragment).toEqual([]);
  });

  it("gives no fragment to a field that is not a place", () => {
    // A summary, a statistic and the description excerpt are not locations on
    // the page. A fragment on one would send a reader to an id that does not
    // exist.
    const misplaced = builtIndex()
      .flatMap((record) =>
        record.fields
          .filter((field) => field.label !== "Section" && field.fragment)
          .map((field) => `${record.type}/${record.slug} ${field.label}`),
      );

    expect(misplaced).toEqual([]);
  });
});
