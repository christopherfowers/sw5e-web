/**
 * The same document, assembled both ways, compared.
 *
 * This is the test the whole arrangement rests on. The transform now runs in
 * two places: in CI, over the whole catalogue, to write the prerendered files;
 * and in a browser, over one API bundle, to replace them. If those two ever
 * disagree, a reader is served a page unlike the one the suite built, and
 * nothing else in the suite would notice, because every other test exercises
 * the build path only.
 *
 * It compares assembly, not fetching. The network is a thin wrapper around
 * this and has its own, duller, tests.
 */

import { describe, expect, it } from "vitest";

import { assemble, contentTypeKey } from "./live";
import {
  buildClassGraph,
  indexSources,
  normalizeAllCanonical,
} from "./transform/canonical.mjs";

const PHB = {
  key: "phb",
  abbreviation: "PHB",
  title: "Star Wars 5e Player's Handbook",
  shelfName: "Player's Handbook",
};

const SENTINEL = {
  key: "sentinel",
  name: "Sentinel",
  sourceKey: "phb",
  description: "A sentinel walks between.",
};

const IDEALS = {
  key: "class-sentinel-ideals-2",
  name: "Sentinel Ideals",
  sourceKey: "phb",
  grantedBy: "class",
  grantedByName: "Sentinel",
  level: 2,
  description: "You adopt ideals that exemplify your bond with the Force.",
};

const CALLING = {
  key: "class-sentinel-calling-3",
  name: "Sentinel Calling",
  sourceKey: "phb",
  grantedBy: "class",
  grantedByName: "Sentinel",
  level: 3,
  description: "You choose a sentinel calling.",
};

/** What the build does: the whole catalogue, one graph, every document. */
function buildTimeWay() {
  const graph = buildClassGraph({
    classes: [SENTINEL],
    features: [IDEALS, CALLING],
    archetypes: [],
    classImprovements: [],
  });

  return normalizeAllCanonical(
    "classes",
    [SENTINEL],
    indexSources([PHB]),
    graph,
  )[0];
}

/** What a browser does: one bundle, one hop. */
function runtimeWay() {
  return assemble("classes", {
    item: { type: "class", key: "sentinel", name: "Sentinel", data: SENTINEL },
    related: {
      source: [{ type: "source", key: "phb", name: "PHB", data: PHB }],
      feature: [
        { type: "feature", key: IDEALS.key, name: IDEALS.name, data: IDEALS },
        { type: "feature", key: CALLING.key, name: CALLING.name, data: CALLING },
      ],
    },
  });
}

describe("assembling a page", () => {
  it("produces the same document either way", () => {
    expect(runtimeWay()).toEqual(buildTimeWay());
  });

  it("carries the features the class grants", () => {
    // The guard on the guard. Both sides agreeing on an empty page would pass
    // the comparison above and prove nothing, and the features are exactly
    // what the one-hop bundle is for.
    const rendered = JSON.stringify(runtimeWay());

    expect(rendered).toContain("Sentinel Ideals");
    expect(rendered).toContain("Sentinel Calling");
  });

  it("returns nothing for a type the transform does not know", () => {
    expect(
      assemble("not-a-type", {
        item: { type: "x", key: "y", name: "Y", data: {} },
        related: {},
      }),
    ).toBeNull();
  });
});

describe("addressing the API", () => {
  it("maps the site's type id to the content type key", () => {
    // `/classes/sentinel` on the site is `class/sentinel` on the API, and
    // getting this wrong answers 404 for every page of that type.
    expect(contentTypeKey("classes")).toBe("class");
    expect(contentTypeKey("enhanced-items")).toBe("enhanced-item");
    expect(contentTypeKey("starship-equipment")).toBe("starship-equipment");
  });

  it("refuses a type it does not know rather than guessing a key", () => {
    expect(contentTypeKey("made-up")).toBeNull();
  });
});
