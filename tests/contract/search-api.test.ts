/**
 * The search client, run against the search API. The real one.
 *
 * This exists because the same thing went wrong twice in one day, in the same
 * way, for the same reason.
 *
 * The results page shipped showing "240 results for 'difficult' (showing 0)".
 * The service answered correctly — twenty groups with results in every one —
 * and the client discarded all of it, because it read `item.slug` where the
 * service sends `item.key`, and matched groups on `type` (`rule`) where this
 * application identifies a type by its plural route segment (`rules`). Both
 * mistakes were invisible to the suite: the route's test mock had been written
 * to match the client rather than the server, so it repeated both errors and
 * passed.
 *
 * A mock that agrees with the code that wrote it is not evidence. This suite
 * asks the running service instead, and the last block is the one that matters
 * most: it compares the committed fixture — the one the fast unit tests read —
 * against a live response, field by field, so that a fixture drifting from the
 * service it stands in for fails here rather than on the deployed site.
 *
 * Skipped when `SW5E_CONTRACT_API` is unset, so the ordinary suite stays fast
 * and offline. CI runs it as its own job.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { readSearchResponse, searchContent } from "../../app/content/search-api";
import { isContentTypeId } from "../../app/content/types";
import fixture from "../../app/content/__fixtures__/search-response.json";
import { readOnlyContractTarget } from "./target";

// Unguarded on purpose: this suite only reads, and running it against a
// deployed environment is how a client that disagrees with a live service
// gets caught. See tests/contract/target.ts.
const API = readOnlyContractTarget();
const ORIGIN = process.env.SW5E_CONTRACT_ORIGIN ?? "http://localhost:4173";

const platformFetch = globalThis.fetch;

/**
 * The client builds relative URLs on purpose, so the only thing stubbed is
 * resolving that path against the API's origin. Everything downstream is the
 * shipped code running over real bytes.
 */
function useRealApi(): void {
  const realFetch = platformFetch;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    const headers = new Headers(init?.headers);
    headers.set("Origin", ORIGIN);

    return realFetch(new URL(path, API), { ...init, headers, redirect: "manual" });
  }) as typeof fetch;
}

/** A phrase that matches a great many documents across several types. */
const BROAD = "difficult";

describe.skipIf(!API)("the search client against the real API", () => {
  beforeAll(() => {
    useRealApi();
  });

  it("returns results, not just a total", () => {
    // The exact failure as the reader saw it. A total with nothing under it is
    // the shape this whole file exists to prevent.
    return searchContent(BROAD).then((result) => {
      expect(result.totalMatches).toBeGreaterThan(0);

      const kept = result.groups.flatMap((group) => group.results);

      expect(result.groups.length).toBeGreaterThan(0);
      expect(kept.length).toBeGreaterThan(0);
    });
  });

  it("names every group with an identifier this application knows", () => {
    return searchContent(BROAD).then((result) => {
      // Groups the client cannot route are dropped by design, so an empty
      // result here would look like agreement. Requiring several proves the
      // vocabularies actually line up.
      expect(result.groups.length).toBeGreaterThan(3);

      for (const group of result.groups) {
        expect(isContentTypeId(group.type)).toBe(true);
      }
    });
  });

  it("gives every result a slug, a name and its match", () => {
    return searchContent(BROAD).then((result) => {
      for (const group of result.groups) {
        for (const entry of group.results) {
          expect(entry.slug).not.toBe("");
          expect(entry.name).not.toBe("");
          expect(entry.matchedIn).not.toBe("");
        }
      }
    });
  });

  it("still answers the way the committed fixture says it does", async () => {
    const response = await fetch(`/api/search?q=${encodeURIComponent(BROAD)}&limit=2`);

    expect(response.ok).toBe(true);

    const live = (await response.json()) as typeof fixture;

    // Shape, not content: the corpus moves and the totals with it. What must
    // not move is the spelling of the fields the client reads, because that is
    // what failed and what no other test can see.
    expect(Object.keys(live).sort()).toEqual(expect.arrayContaining(["groups", "totalMatches"]));

    const liveGroup = live.groups[0];
    const fixtureGroup = fixture.groups[0];

    expect(Object.keys(liveGroup).sort()).toEqual(Object.keys(fixtureGroup).sort());
    expect(Object.keys(liveGroup.results[0]).sort()).toEqual(
      Object.keys(fixtureGroup.results[0]).sort(),
    );
    expect(Object.keys(liveGroup.results[0].item).sort()).toEqual(
      Object.keys(fixtureGroup.results[0].item).sort(),
    );

    // And the fixture still parses to something, so a recapture that quietly
    // broke it cannot pass unnoticed.
    expect(readSearchResponse(fixture).groups.flatMap((g) => g.results).length).toBeGreaterThan(0);
  });
});
