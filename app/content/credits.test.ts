import { describe, expect, it } from "vitest";

import {
  assetCredit,
  assetCreditKeys,
  citedAssetCount,
  creditCategories,
  creditedPeopleCount,
} from "./credits.server";
import {
  brandImage,
  classArt,
  sourceCover,
  speciesPortrait,
  speciesThumbnail,
} from "./imagery";

/**
 * These run against the committed credits document, not a stub.
 *
 * A stub would be worse than useless here. The failures worth catching are a
 * name lost from a roster, a specific contribution flattened into a bare
 * listing, and a picture rendered with no citation behind it — and every one
 * of those is a fact about the real document. A test built on a fixture of
 * three invented people would pass through all three.
 */

const SPECIES_WITHOUT_ART = [
  "anx",
  "dowutin-young",
  "half-human",
  "nothoiin",
  "quermian",
  "ugor",
  "zygerrian",
];

describe("the credits document", () => {
  it("carries every person the original credits named", () => {
    // Hand-counted from the archived credits: 1 creator, 4 personal thanks,
    // 20 Jedi Council, 4 website team, 52 contributors, 384 patrons, 57 art
    // assets, 1 rights holder.
    expect(creditedPeopleCount()).toBe(523);
  });

  it("keeps the categories separate rather than as one roll of names", () => {
    const categories = creditCategories();

    expect(categories.map((category) => category.key)).toEqual([
      "creator",
      "personal-thanks",
      "jedi-council",
      "website-team",
      "contributor",
      "patron",
      "art-asset",
      "rights-holder",
    ]);

    // Every category has somebody in it, and the two largest are the two the
    // source recorded as rosters. A merge would show up here as one category
    // holding everybody.
    for (const category of categories) {
      expect(category.people.length, category.key).toBeGreaterThan(0);
    }
    expect(byKey("patron").people).toHaveLength(384);
    expect(byKey("jedi-council").people).toHaveLength(20);
  });

  /**
   * The Jedi Council credits are the only records in the archive that say what
   * a particular person actually did. They are the most valuable thing on the
   * page and the easiest to lose, because a bare name still renders.
   */
  it.each([
    ["Karbacca", "for the *epic* cover and SW5e logo"],
    ["Tomato-andrew", "for his immense help with the enhanced items"],
    ["Stormchaser6", "for his help with the Starships book"],
    ["Heresy", "for their excellent work with species"],
  ])("credits %s for the specific work they did", (name, contribution) => {
    const person = byKey("jedi-council").people.find(
      (candidate) => candidate.name === name,
    );

    expect(person, `${name} must be on the Jedi Council`).toBeDefined();
    expect(person!.contribution).toBe(contribution);
  });

  it("records a contribution for every one of the Jedi Council", () => {
    const bare = byKey("jedi-council")
      .people.filter((person) => person.contribution === null)
      .map((person) => person.name);

    expect(bare).toEqual([]);
  });

  /**
   * The same handle appears in two categories and is owed a different thing by
   * each. Deduplicating by name would silently drop one of them.
   */
  it("keeps a person credited in two categories in both of them", () => {
    expect(names("jedi-council")).toContain("DarkMesa");
    expect(names("contributor")).toContain("DarkMesa");
  });

  /**
   * Two patron names reached the archive with an accented letter destroyed by
   * the 2022 scrape. The assertion is on the repaired spelling rather than on
   * the absence of U+FFFD, so an import that silently dropped the accent —
   * which would pass a replacement-character check — still fails.
   */
  it.each(["César Díaz", "João Lira"])("renders %s with its accents", (name) => {
    expect(names("patron")).toContain(name);
  });

  it("carries no replacement characters anywhere", () => {
    const damaged = creditCategories()
      .flatMap((category) => category.people)
      .filter((person) => person.name.includes("�"))
      .map((person) => person.name);

    expect(damaged).toEqual([]);
  });

  it("names Galiphile as the creator", () => {
    expect(names("creator")).toEqual(["Galiphile"]);
  });

  it("credits Lucasfilm and Lucasarts for Star Wars itself", () => {
    expect(names("rights-holder")).toEqual(["Lucasfilm and Lucasarts"]);
  });
});

describe("per-image attribution", () => {
  /**
   * The contract this whole model exists to enforce: every picture the build
   * can render has a citation behind it. This is the test that fails when
   * somebody adds an image without one, which is the only moment the artist is
   * still known.
   */
  it("has a citation for every picture the build carries", () => {
    const uncited: string[] = [];

    for (const key of ["logo", "hero-light", "hero-dark"]) {
      if (brandImage(key) && !assetCredit("brand", key)) uncited.push(`brand/${key}`);
    }
    for (const code of ["PHB", "WH", "SnV"]) {
      if (sourceCover(code) && !assetCredit("sources", code.toLowerCase())) {
        uncited.push(`sources/${code}`);
      }
    }
    for (const name of [
      "berserker", "consular", "engineer", "fighter", "guardian",
      "monk", "operative", "scholar", "scout", "sentinel",
    ]) {
      if (classArt(name) && !assetCredit("classes", name)) uncited.push(`classes/${name}`);
    }

    expect(uncited).toEqual([]);
  });

  /**
   * The citation set and the asset set must not drift apart in either
   * direction. A citation for a picture that no longer exists is a record
   * nobody will ever see; a picture with no citation is the failure above.
   */
  it("cites exactly the pictures that exist, and no others", () => {
    const keys = assetCreditKeys();

    expect(keys).toHaveLength(150);

    const orphaned = keys.filter((key) => {
      const [group, assetKey] = key.split("/");
      if (group === "species") return speciesPortrait(assetKey) === null;
      if (group === "classes") return classArt(assetKey) === null;
      if (group === "sources") return sourceCover(assetKey) === null;
      if (group === "brand") return brandImage(assetKey) === null;
      return true;
    });

    expect(orphaned).toEqual([]);
  });

  it("cites every species that has a portrait, and no species that has none", () => {
    const cited = assetCreditKeys()
      .filter((key) => key.startsWith("species/"))
      .map((key) => key.slice("species/".length));

    expect(cited).toHaveLength(134);

    for (const slug of SPECIES_WITHOUT_ART) {
      expect(speciesPortrait(slug), slug).toBeNull();
      expect(cited, slug).not.toContain(slug);
    }
  });

  /**
   * The one picture whose artist the archive actually records. The original
   * credits name Karbacca "for the epic cover and SW5e logo", and the site's
   * logo is built from that file.
   */
  it("cites the site logo to Karbacca by name", () => {
    const credit = assetCredit("brand", "logo");

    expect(credit).not.toBeNull();
    expect(credit!.status).toBe("cited");
    expect(credit!.artist).toBe("Karbacca");
    expect(credit!.workTitle).toBe("SW5e logo");
    expect(credit!.basis).toBe("fan-content-policy");
  });

  /**
   * Everything else says the artist is unknown instead of guessing. The count
   * is frozen: a 150th unattributed picture means one was added without a
   * citation, and raising the number is not the fix.
   */
  it("marks every other picture unattributed rather than inventing an artist", () => {
    expect(citedAssetCount()).toBe(1);

    const inherited = assetCreditKeys()
      .map((key) => {
        const [group, assetKey] = key.split("/");
        return assetCredit(group as "species", assetKey)!;
      })
      .filter((credit) => credit.status === "inherited-unattributed");

    expect(inherited).toHaveLength(149);
    for (const credit of inherited) {
      expect(credit.artist).toBeNull();
      expect(credit.workTitle).toBeNull();
      expect(credit.basis).toBe("unrecorded");
      // The trail is often the only thing that would let somebody establish
      // authorship later, so it is required even when the artist is not known.
      expect(credit.provenance.length).toBeGreaterThan(0);
    }
  });

  /**
   * A gallery thumbnail is a crop of the portrait it came from, not a work of
   * its own, so it resolves to the portrait's citation rather than needing one.
   */
  it("resolves a thumbnail to the citation of the portrait it was cut from", () => {
    expect(speciesThumbnail("wookiee")).not.toBeNull();
    expect(assetCredit("species", "wookiee")).not.toBeNull();
    expect(assetCreditKeys().some((key) => key.startsWith("species-thumbs/"))).toBe(
      false,
    );
  });
});

function byKey(key: string) {
  const category = creditCategories().find((candidate) => candidate.key === key);
  if (!category) throw new Error(`No credit category '${key}'`);
  return category;
}

function names(key: string): string[] {
  return byKey(key).people.map((person) => person.name);
}
