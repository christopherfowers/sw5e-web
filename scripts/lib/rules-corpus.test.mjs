import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CANONICAL_DIRECTORIES,
  buildClassGraph,
  indexSources,
  normalizeAllCanonical,
} from "./canonical.mjs";
import { CONTENT_TYPES, normalizeAll, splitIntoSections } from "./normalize.mjs";
import { REPLACEMENT } from "./repair-text.mjs";

/**
 * The five content types imported wholesale from the legacy archive: the
 * enhanced items, the two property glossaries, the rules prose and the
 * reference tables.
 *
 * Two things are being pinned down here, and they are different.
 *
 * The first is the mapping itself, tested against records taken verbatim from
 * the archive. A trimmed inline record proves the code runs; a real one proves
 * it copes with what the corpus actually contains — a prerequisite with a
 * leading space, a chapter numbered -2, a body that opens by repeating its own
 * title.
 *
 * The second is that the two source paths agree. The site can be built from
 * the canonical content set or straight from the archive, and the whole point
 * of keeping both alive is that they publish the same site. For the rules that
 * is not automatic: chapter titles repeat across books, so the two paths have
 * to arrive at the same book-qualified slug by different routes — one reading
 * a document's key, the other deriving it from the file the record came from.
 */

const sources = indexSources([
  { key: "phb", abbreviation: "PHB", title: "Star Wars 5e Player's Handbook" },
  { key: "wh", abbreviation: "WH", title: "Wretched Hives" },
  { key: "ec", abbreviation: "EC", title: "Expanded Content" },
]);

function canonical(type, record) {
  return normalizeAllCanonical(type, [record], sources)[0];
}

function fromArchive(type, record, graph = {}) {
  return normalizeAll(type, [record], new Set(), graph)[0];
}

/* ------------------------------------------------------------ enhanced items */

describe("enhanced items", () => {
  // content/enhanced-item/ab-75-bo-rifle.json, verbatim.
  const boRifle = {
    key: "ab-75-bo-rifle",
    name: "AB-75 Bo-Rifle",
    sourceKey: "wh",
    contentSet: "core",
    itemType: "weapon",
    rarity: "prototype",
    requiresAttunement: false,
    subtype: "bo-rifle",
    description:
      "You have a +2 bonus to attack and damage rolls with this enhanced weapon.",
  };

  it("carries the two facets a 1,918-row list is unusable without", () => {
    const item = canonical("enhanced-items", boRifle);

    expect(item.summary.rarity).toBe("Prototype");
    expect(item.summary.itemType).toBe("Weapon");
    expect(item.summary.subtype).toBe("bo-rifle");
    expect(item.summary.requiresAttunement).toBe(false);
  });

  it("ranks rarity by the game's ladder rather than the alphabet", () => {
    const ranks = [
      "standard",
      "premium",
      "prototype",
      "advanced",
      "legendary",
      "artifact",
    ].map(
      (rarity) =>
        canonical("enhanced-items", { ...boRifle, rarity }).summary.rarityRank,
    );

    expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("labels the subtype by what it means for the item's own type", () => {
    const modification = canonical("enhanced-items", {
      ...boRifle,
      itemType: "itemModification",
      subtype: "wristpad",
    });

    // A modification's subtype is the equipment it goes into; a weapon's is
    // the base weapon it is built on. One field, two readings.
    expect(modification.stats).toContainEqual({
      label: "Installed in",
      value: "Wristpad",
    });
    expect(canonical("enhanced-items", boRifle).stats).toContainEqual({
      label: "Kind",
      value: "Bo-rifle",
    });
  });

  it("links to the equipment it is the enhanced form of, when there is one", () => {
    const graph = buildClassGraph({
      equipment: [{ name: "Bo-rifle" }, { name: "Wristpad" }],
    });

    const specific = normalizeAllCanonical(
      "enhanced-items",
      [boRifle],
      sources,
      graph,
    )[0];

    expect(specific.stats).toContainEqual({
      label: "Kind",
      value: "Bo-rifle",
      href: "/equipment/bo-rifle",
    });

    const modification = normalizeAllCanonical(
      "enhanced-items",
      [{ ...boRifle, itemType: "itemModification", subtype: "wristpad" }],
      sources,
      graph,
    )[0];

    expect(modification.stats).toContainEqual({
      label: "Installed in",
      value: "Wristpad",
      href: "/equipment/wristpad",
    });
  });

  it("links nowhere when the subtype names a family rather than an item", () => {
    // "Any blaster" is not a piece of equipment and never will be. A link that
    // resolved to something would be a wrong link, and a wrong link is the kind
    // nobody notices.
    const item = normalizeAllCanonical(
      "enhanced-items",
      [{ ...boRifle, subtype: "any blaster" }],
      sources,
      buildClassGraph({ equipment: [{ name: "Bo-rifle" }] }),
    )[0];

    expect(item.stats).toContainEqual({ label: "Kind", value: "Any blaster" });
    expect(item.stats.some((stat) => stat.href)).toBe(false);
  });

  it("tidies the archive's prerequisites on the way through", () => {
    // EnhancedItem.json, "Obscured Armoring" and "Berserker's Edge": every
    // archived prerequisite opens with a stray space, and a third of them
    // lower-case a first word the rest capitalise.
    expect(
      fromArchive("enhanced-items", {
        name: "Obscured Armoring",
        type: "ItemModification",
        rarityOptions: ["Premium"],
        requiresAttunement: false,
        prerequisite: " Armor",
        subtype: "armor",
        text: "This armor gains the obscured property.",
        contentSource: "WH",
      }).summary.prerequisite,
    ).toBe("Armor");

    expect(
      fromArchive("enhanced-items", {
        name: "Berserker's Edge",
        type: "ItemModification",
        rarityOptions: ["Advanced"],
        requiresAttunement: false,
        prerequisite: " at least 3 levels in berserker",
        subtype: "vibroweapon",
        text: "While attuned to this weapon you gain a bonus.",
        contentSource: "WH",
      }).summary.prerequisite,
    ).toBe("At least 3 levels in berserker");
  });
});

/* ---------------------------------------------------------------- properties */

describe("the weapon and armour property glossaries", () => {
  const powerCell = {
    key: "power-cell",
    name: "Power Cell",
    contentSet: "core",
    description:
      "Weapons with this property are fueled by power cells, which must be loaded in order to fire the weapon. A power cell fuels a number of attacks equal to the weapon's reload number.",
  };

  it("publishes no source badge, because the archive records no book", () => {
    const item = canonical("weapon-properties", powerCell);

    expect(item.source).toBeNull();
    expect(item.sourceName).toBeNull();
  });

  it("scans by the opening sentence of the rule", () => {
    expect(canonical("weapon-properties", powerCell).summary.summaryLine).toBe(
      "Weapons with this property are fueled by power cells, which must be loaded in order to fire the weapon.",
    );
  });

  it("drops the heading the archive repeats above every entry", () => {
    // WeaponProperty.json stores the rule with its own title on the first
    // line. The page prints the name as its heading already.
    const item = fromArchive("weapon-properties", {
      name: "Power Cell",
      contentType: "Core",
      contentSource: "None",
      content:
        "#### Power Cell\r\nWeapons with this property are fueled by power cells.",
    });

    expect(item.sections[0].body).toBe(
      "Weapons with this property are fueled by power cells.",
    );
    expect(item.source).toBeNull();
  });
});

/* --------------------------------------------------------------------- rules */

describe("splitting a rules passage into sections", () => {
  it("divides on the shallowest heading level the passage uses", () => {
    // The conditions appendix divides at h4 and has no h2 or h3 at all.
    const sections = splitIntoSections(
      "Conditions alter a creature's capabilities.\n\n" +
        "#### Blinded\n- A blinded creature can't see.\n\n" +
        "#### Charmed\n- A charmed creature can't attack the charmer.",
    );

    expect(sections.map((section) => section.heading)).toEqual([
      null,
      "Blinded",
      "Charmed",
    ]);
    expect(sections[0].body).toBe("Conditions alter a creature's capabilities.");
  });

  it("keeps deeper headings inside the section they belong to", () => {
    const sections = splitIntoSections(
      "## Movement\nintro\n\n### Climbing\ndetail\n\n## Resting\nmore",
    );

    expect(sections.map((section) => section.heading)).toEqual([
      "Movement",
      "Resting",
    ]);
    expect(sections[0].body).toContain("### Climbing");
  });

  it("ignores a stray level-one heading in the middle of a passage", () => {
    // Two chapters carry one. Splitting on it would give the whole chapter
    // back as a single section and lose every real division under it.
    const sections = splitIntoSections(
      "opening\n\n# The Player's Handbook\n\n## Rests\nbody\n\n## Travel\nbody",
    );

    expect(sections.map((section) => section.heading)).toEqual([
      null,
      "Rests",
      "Travel",
    ]);
  });

  it("gives a passage with no headings back whole", () => {
    const sections = splitIntoSections("One paragraph and nothing else.");

    expect(sections).toEqual([
      { heading: null, body: "One paragraph and nothing else." },
    ]);
  });
});

describe("rules", () => {
  const chapter = {
    key: "phb-appendix-a-conditions",
    name: "Appendix A: Conditions",
    sourceKey: "phb",
    contentSet: "core",
    ruleType: "chapter",
    chapterNumber: 13,
    body: "Conditions alter a creature's capabilities.\n\n#### Blinded\nbody\n\n#### Charmed\nbody",
  };

  it("takes its slug from the key, because chapter titles repeat across books", () => {
    // "Equipment" is a chapter in all three books. A name-derived slug would
    // hand them the same URL and let directory order decide which one wins.
    const equipment = { ...chapter, key: "wh-equipment", name: "Equipment", sourceKey: "wh" };

    expect(canonical("rules", chapter).slug).toBe("phb-appendix-a-conditions");
    expect(canonical("rules", equipment).slug).toBe("wh-equipment");
  });

  it("reports how many sections a chapter holds, so a reader can judge its size", () => {
    expect(canonical("rules", chapter).summary.sectionCount).toBe(2);
  });

  it("prints a chapter's position only when it is one a reader would recognise", () => {
    // The archive numbers the Player's Handbook preface -2 and both changelogs
    // 99. Both still sort correctly; neither is a chapter number.
    expect(canonical("rules", chapter).tagline).toBe(
      "Star Wars 5e Player's Handbook · Chapter 13",
    );
    expect(
      canonical("rules", { ...chapter, chapterNumber: 99 }).tagline,
    ).toBe("Star Wars 5e Player's Handbook");
    expect(
      canonical("rules", { ...chapter, chapterNumber: -2 }).tagline,
    ).toBe("Star Wars 5e Player's Handbook");
  });

  it("marks a variant rule as optional and gives it no position", () => {
    const variant = canonical("rules", {
      key: "flanking",
      name: "Flanking",
      sourceKey: "ec",
      contentSet: "expanded-content",
      ruleType: "variant",
      body: "When making a melee attack against a creature.",
    });

    expect(variant.tagline).toBe("Optional variant rule");
    expect(variant.summary.chapterNumber).toBeNull();
    expect(variant.slug).toBe("flanking");
  });

  it("attributes an archive record by the file it came from, since it says nothing itself", () => {
    // Every rules record in the archive has contentSource "None". The file is
    // the only evidence of which book printed the chapter.
    const record = {
      chapterName: "Equipment",
      chapterNumber: 5,
      contentType: "None",
      contentSource: "None",
      contentMarkdown: "# Chapter 5: Equipment\r\n\r\nA character's gear.",
    };

    const phb = fromArchive("rules", { ...record, ruleBook: "phb" });
    const wh = fromArchive("rules", { ...record, ruleBook: "wh" });

    expect(phb.source).toBe("PHB");
    expect(phb.slug).toBe("phb-equipment");
    expect(wh.source).toBe("WH");
    expect(wh.slug).toBe("wh-equipment");

    // And the chapter's own title, printed at the top of the body, is not
    // shown a second time under the heading the page already prints.
    expect(phb.sections[0].body).toBe("A character's gear.");
  });

  it("refuses a rules record from a file that is not one of the four books", () => {
    expect(() =>
      fromArchive("rules", { chapterName: "X", contentMarkdown: "body", ruleBook: "Species" }),
    ).toThrow(/not one of the four/);
  });
});

/* ---------------------------------------------------------- reference tables */

describe("reference tables", () => {
  it("groups by the subject read off the caption", () => {
    const cases = {
      "Starship Size Fuel Capacity": "Starships",
      "Modification Capacity by Ship Size": "Starships",
      "Base Hyperspace Travel Times (Hours)": "Starships",
      "XP and PB by Level": "Character creation",
      "Multiclassing Prerequisites": "Character creation",
      "Lifestyle Expenses": "Downtime",
      "Slowed Level": "Conditions",
    };

    for (const [name, subject] of Object.entries(cases)) {
      expect(
        fromArchive("reference-tables", {
          name,
          contentType: "Core",
          contentSource: "None",
          content: "|a|b|\n|:--|:--|\n|1|2|",
        }).summary.subject,
      ).toBe(subject);
    }
  });

  it("keeps the table as markdown rather than shredding it into a grid", () => {
    const item = canonical("reference-tables", {
      key: "ability-score-point-cost",
      name: "Ability Score Point Cost",
      contentSet: "core",
      subject: "Character creation",
      body: "|Score|Cost|\n|:--:|:--:|\n|8|0|\n|9|1|",
    });

    expect(item.tables).toEqual([]);
    expect(item.sections[0].body).toContain("|Score|Cost|");
    expect(item.source).toBeNull();
  });
});

/* ------------------------------------------- the two source paths must agree */

describe("the canonical set and the archive publish the same corpus", () => {
  /**
   * Both sources are checked out beside this repository on a development
   * machine and neither exists in CI. Which "beside" means depends on how the
   * four repositories were cloned, so the same candidates the sibling
   * repository's test helper tries are tried here.
   */
  function locate(variable, candidates) {
    const configured = process.env[variable];
    if (configured) return path.resolve(configured);
    return (
      candidates.map((each) => path.resolve(each)).find((each) => existsSync(each)) ??
      path.resolve(candidates[0])
    );
  }

  const archive = locate("SW5E_ARCHIVE", [
    "../../sw5e-legacy-archive/api",
    "../sw5e-legacy-archive/api",
  ]);
  const content = locate("SW5E_CONTENT", [
    "../sw5e-database/content",
    "../../sw5e-database/content",
  ]);

  async function readJson(file) {
    return JSON.parse(await readFile(file, "utf8"));
  }

  // Neither source is present in CI, so the two assertions that read them
  // announce themselves as skipped rather than passing vacuously.
  const hasArchive = existsSync(archive);
  const hasContent = existsSync(path.join(content, "rule"));

  it.runIf(hasArchive)(
    "derives the same slug for every rules record from either source",
    async () => {
      const archiveSlugs = new Set();

      for (const { file, ruleBook } of CONTENT_TYPES.find(
        (type) => type.id === "rules",
      ).files) {
        const records = await readJson(path.join(archive, `${file}.json`));
        const stamped = records.map((record) => ({ ...record, ruleBook }));
        for (const item of normalizeAll("rules", stamped)) {
          archiveSlugs.add(item.slug);
        }
      }

      // 76 archived records; the Player's Handbook preface is a title with an
      // empty body and is not published, but it still has a slug here because
      // the archive path does not exclude it.
      expect(archiveSlugs.size).toBe(76);

      if (!hasContent) return;

      const names = await readdir(path.join(content, "rule"));
      const canonicalSlugs = new Set();
      for (const name of names.filter((each) => each.endsWith(".json"))) {
        const record = await readJson(path.join(content, "rule", name));
        canonicalSlugs.add(canonical("rules", record).slug);
      }

      expect(canonicalSlugs.size).toBe(75);

      const missing = [...canonicalSlugs].filter(
        (slug) => !archiveSlugs.has(slug),
      );
      expect(missing).toEqual([]);
    },
  );

  it.runIf(hasContent)(
    "maps every imported document without losing a facet",
    async () => {
      const expected = {
        "enhanced-item": 1918,
        "weapon-property": 46,
        "armor-property": 30,
        rule: 75,
        "reference-table": 30,
      };

      for (const [directory, count] of Object.entries(expected)) {
        const typeId = Object.entries(CANONICAL_DIRECTORIES).find(
          ([, value]) => value === directory,
        )[0];

        const names = (await readdir(path.join(content, directory))).filter(
          (name) => name.endsWith(".json"),
        );
        expect(names.length, directory).toBe(count);

        const records = await Promise.all(
          names.map((name) => readJson(path.join(content, directory, name))),
        );
        const items = normalizeAllCanonical(typeId, records, sources);

        expect(items.length, directory).toBe(count);
        // Every document renders something. A mapping that produced a page
        // with a title and no body would still be the right length.
        expect(
          items.filter((item) => item.sections.length === 0).map((item) => item.slug),
          directory,
        ).toEqual([]);
        // And the only documents still carrying the scrape's replacement
        // character are the five recorded as unrecoverable: a lost character
        // before a space, ambiguous between an em dash and an ellipsis, and
        // the accented letters in the Expanded Content species name tables.
        expect(
          items
            .filter((item) => JSON.stringify(item).includes(REPLACEMENT))
            .map((item) => item.slug)
            .sort(),
          directory,
        ).toEqual(
          directory === "rule"
            ? [
                "ec-archetypes",
                "ec-backgrounds",
                "ec-species",
                "phb-equipment",
                "wh-step-by-step-factions",
              ]
            : [],
        );
      }
    },
  );

  it.runIf(hasContent)(
    "resolves every enhanced-item link against the real equipment catalogue",
    async () => {
      const equipment = await Promise.all(
        (await readdir(path.join(content, "equipment")))
          .filter((name) => name.endsWith(".json"))
          .map((name) => readJson(path.join(content, "equipment", name))),
      );

      const graph = buildClassGraph({ equipment });

      const names = (await readdir(path.join(content, "enhanced-item"))).filter(
        (name) => name.endsWith(".json"),
      );
      const records = await Promise.all(
        names.map((name) => readJson(path.join(content, "enhanced-item", name))),
      );
      const items = normalizeAllCanonical(
        "enhanced-items",
        records,
        sources,
        graph,
      );

      const linked = items.flatMap((item) =>
        item.stats.filter((stat) => stat.href),
      );

      // 321 of the 1,918 enhanced items name a base item the equipment
      // catalogue actually has, across 20 distinct targets. The exact numbers
      // are the point: a resolver that matched on a prefix instead of a whole
      // name would light up far more of the corpus and be wrong about most of
      // it, and one that silently stopped working would light up none.
      expect(linked.length).toBe(321);
      expect(new Set(linked.map((stat) => stat.href)).size).toBe(20);

      // Every target is a page the site publishes. A link that 404s is worse
      // than the absent link it replaced.
      const equipmentSlugs = new Set(
        normalizeAllCanonical("equipment", equipment, sources).map(
          (item) => item.slug,
        ),
      );
      const dangling = [...new Set(linked.map((stat) => stat.href))].filter(
        (href) => !equipmentSlugs.has(href.replace("/equipment/", "")),
      );
      expect(dangling).toEqual([]);

      // And the ones that are not linked are not linked for a reason: they
      // name a family, a body slot or a bare noun, none of which is one item.
      const unlinked = new Set(
        items
          .filter((item) => item.summary.subtype && !item.stats.some((s) => s.href))
          .map((item) => item.summary.subtype),
      );
      expect(unlinked).toContain("any blaster");
      expect(unlinked).toContain("clothing");
      expect(unlinked).toContain("hands");
    },
  );

  it("leaves no dangling cross-reference in the committed fixture", async () => {
    // The fixture is four items per type and is the only dataset a contributor
    // without either source can render, so a link in it that points at a
    // document it did not keep is a dead link on the one build least likely to
    // be recognised as incomplete.
    const directory = path.resolve("app/data/fixture");
    const manifest = await readJson(path.join(directory, "manifest.json"));

    const published = new Set();
    const linked = [];

    for (const { id } of manifest.types) {
      const items = await readJson(path.join(directory, `${id}.items.json`));
      for (const item of items) {
        published.add(`/${id}/${item.slug}`);
        for (const stat of item.stats) {
          if (stat.href) linked.push({ from: `/${id}/${item.slug}`, to: stat.href });
        }
      }
    }

    expect(linked.filter((link) => !published.has(link.to))).toEqual([]);
  });

  it("declares every new type on both sides of the pipeline", () => {
    for (const id of [
      "enhanced-items",
      "weapon-properties",
      "armor-properties",
      "rules",
      "reference-tables",
    ]) {
      expect(CANONICAL_DIRECTORIES[id], id).toBeTruthy();
      expect(
        CONTENT_TYPES.find((type) => type.id === id),
        id,
      ).toBeTruthy();
    }

    // The rules type is fed by four archive dumps, and each one stamps the
    // book onto its records, because nothing inside a record says which book
    // printed it.
    expect(
      CONTENT_TYPES.find((type) => type.id === "rules").files,
    ).toEqual([
      { file: "playerHandbookRule", ruleBook: "phb" },
      { file: "wretchedHivesRule", ruleBook: "wh" },
      { file: "ExpandedContent", ruleBook: "ec" },
      { file: "VariantRule", ruleBook: "variant" },
    ]);
  });
});
