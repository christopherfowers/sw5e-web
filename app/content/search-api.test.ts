/**
 * The search client, read against a response the service actually sent.
 *
 * This module had no tests at all, and shipped a results page that showed
 * "240 results for 'difficult' (showing 0)". The service answered correctly —
 * twenty groups, results in every one of them — and every result was silently
 * discarded here, because the reader looked for `item.slug` and `item.source`
 * and the service sends `item.key` and `item.sourceKey`. The total rendered,
 * because the total is read from a field whose name happened to be right.
 *
 * `__fixtures__/search-response.json` is not written by hand. It was captured
 * verbatim from the deployed API and trimmed to two groups of two, because a
 * fixture invented on this side would encode the same assumption that caused
 * the bug — and two mocks agreeing with the code that wrote them is not
 * evidence of anything. If the service ever changes those names, the fixture
 * has to be recaptured, and that is the point: the change becomes visible
 * instead of silent.
 *
 * `tests/contract/live-api.test.ts` covers the other half — that the fixture
 * still matches the running service.
 */

import { describe, expect, it } from "vitest";

import { asMatches, readSearchResponse } from "./search-api";
import fixture from "./__fixtures__/search-response.json";

describe("reading a search response", () => {
  it("keeps the results the service returned", () => {
    const result = readSearchResponse(fixture);

    expect(result.totalMatches).toBe(240);
    expect(result.groups.length).toBeGreaterThan(0);

    // The assertion the bug would have failed: a response with results in it
    // must not parse to a page with none.
    const kept = result.groups.flatMap((group) => group.results);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("reads a document's slug from the field the service calls it", () => {
    const result = readSearchResponse(fixture);

    // "rules", not "rule". The service names a type in the singular and this
    // application in the plural, and the response carries `routeSegment` to
    // bridge them. Reading `type` instead dropped every group.
    const rules = result.groups.find((group) => group.type === "rules");

    expect(rules).toBeDefined();
    expect(rules!.totalMatches).toBe(21);

    const first = rules!.results[0];

    // `key` on the wire, `slug` in this application's own vocabulary. The
    // rename is the reason this needs asserting: it is exactly the kind of
    // mapping that looks right and silently yields nothing.
    expect(first.slug).toBe("phb-combat");
    expect(first.name).toBe("Combat");
    expect(first.source).toBe("phb");
    expect(first.matchedIn).toBe("heading");
    expect(first.snippet).not.toBe("");
  });

  it("drops a result with no slug rather than linking nowhere", () => {
    const broken = {
      ...fixture,
      groups: [
        {
          ...fixture.groups[0],
          results: [{ item: { name: "No key" }, matchedIn: "text", snippet: "x" }],
        },
      ],
    };

    const result = readSearchResponse(broken);

    // Still dropped — a result with no key cannot be linked to. What changed is
    // that a well-formed result is no longer dropped alongside it.
    expect(result.groups.flatMap((group) => group.results)).toHaveLength(0);
  });

  it("turns the service's results into matches the list can render", () => {
    const matches = asMatches(readSearchResponse(fixture), "difficult");

    expect(matches.length).toBeGreaterThan(0);

    const first = matches[0];

    expect(first.record.slug).toBe("phb-combat");
    expect(first.record.name).toBe("Combat");
    expect(first.evidence?.text).toContain("Difficult");
  });
});
