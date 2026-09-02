/**
 * Naming a page's headings, and the property that had to be recovered:
 * running it twice answers the same thing.
 *
 * It used to be done while rendering, with a name-generator handed down from
 * the item to each block. That made rendering a mutation, and React renders a
 * component more than once for the same state whenever it likes. When it did,
 * every id on a page reached by a client-side navigation came out as `time-2`,
 * `difficult-terrain-2` — and every link the search index pointed at was dead.
 *
 * It only failed inside the site. The prerendered HTML was right and a hard
 * refresh was right, so the ordinary ways of checking all said it worked.
 */

import { describe, expect, it } from "vitest";

import { nameItemHeadings } from "./headings";
import type { ContentItem } from "./types";

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    type: "rules",
    slug: "chapter",
    name: "Chapter",
    source: null,
    sourceName: null,
    tagline: null,
    summary: {},
    stats: [],
    sections: [],
    entries: [],
    tables: [],
    ...overrides,
  };
}

describe("naming an item's headings", () => {
  it("answers the same thing every time it is asked", () => {
    // The regression, stated directly. Anything that accumulated across calls
    // would suffix the second answer.
    const subject = item({
      sections: [{ heading: "Movement", body: "## Speed\n\n## Travel Pace" }],
    });

    expect(nameItemHeadings(subject)).toEqual(nameItemHeadings(subject));
    expect(nameItemHeadings(subject).sections[0]).toEqual({
      heading: "movement",
      prose: ["speed", "travel-pace"],
    });
  });

  it("finds the headings inside a body, not only the section's own", () => {
    const named = nameItemHeadings(
      item({
        sections: [
          {
            heading: "Movement",
            body: "Text.\n\n### Difficult Terrain\n\nMore.\n\n### Jumping",
          },
        ],
      }),
    );

    expect(named.sections[0]!.prose).toEqual(["difficult-terrain", "jumping"]);
  });

  it("keeps one namespace across the whole page", () => {
    // A creature has an "Actions" entry group and a chapter has an "Actions"
    // heading. Two things on one page cannot share an address.
    const named = nameItemHeadings(
      item({
        sections: [
          { heading: "Actions", body: "## Resting" },
          { heading: null, body: "## Resting" },
        ],
      }),
    );

    expect(named.sections[0]!.prose).toEqual(["resting"]);
    expect(named.sections[1]!.prose).toEqual(["resting-2"]);
  });

  it("names entries after sections, grouped, in the order the page draws them", () => {
    const named = nameItemHeadings(
      item({
        sections: [{ heading: null, body: "## Overview" }],
        entries: [
          { group: "Traits", name: "One", body: "## Detail" },
          { group: "Actions", name: "Two", body: "## Detail" },
          { group: "Traits", name: "Three", body: "## Detail" },
        ],
      }),
    );

    // Groups in first-seen order and entries within them, which is what
    // `groupEntries` produces: Traits (One, Three), then Actions (Two).
    expect(named.sections[0]!.prose).toEqual(["overview"]);
    expect(named.entries).toEqual([["detail"], ["detail-2"], ["detail-3"]]);
  });

  it("gives no slot to an entry with nothing in it", () => {
    // The page draws no prose for one, so it consumes no ids. A slot here
    // would shift every entry after it onto the wrong list.
    const named = nameItemHeadings(
      item({
        entries: [
          { group: "Traits", name: "Empty", body: null },
          { group: "Traits", name: "Full", body: "## Detail" },
        ],
      }),
    );

    expect(named.entries).toEqual([["detail"]]);
  });

  it("skips a hash that is not a heading", () => {
    // The parser requires whitespace after the hashes and reads the line
    // trimmed. This has to agree with it, or an id is assigned to something
    // that never renders and every heading after it is misnamed.
    const named = nameItemHeadings(
      item({ sections: [{ heading: null, body: "#NotAHeading\n\n## Real" }] }),
    );

    expect(named.sections[0]!.prose).toEqual(["real"]);
  });
});
