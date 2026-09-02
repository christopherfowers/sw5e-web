/**
 * The navigation has two guarantees and they are enforced in two different
 * ways, because they are two different failures.
 *
 * The first is that every content type says which subject it is part of. That
 * is the compiler's job, and the first `describe` below checks the compiler is
 * still doing it: it takes the real `app/content/nav-groups.ts`, deletes one arm
 * of `TYPE_NAV`, runs TypeScript over the result and asserts the build fails
 * with the deleted type's own name in the message. It is checking that the
 * guard still exists — that `TYPE_NAV` is a total `Record<ContentTypeId, …>` and
 * has not been softened to a `Partial`, widened to `Record<string, …>` or given
 * a fallback. `app/auth/prerender-safety.test.ts` exists for the same kind of
 * reason. The unmodified source is compiled first, in the same harness, because
 * without that control the test would pass just as happily against a harness
 * that reports an error whatever it is given.
 *
 * The second guarantee is newer and the compiler cannot help with it at all.
 * Since the menus became written-out lists of destinations rather than a
 * projection of `TYPE_NAV`, placing a type puts no link on screen: a type can
 * name its group, satisfy the compiler, and have nothing anywhere leading to it.
 * The published page would still build, still be prerendered, still be indexed —
 * and be reachable only by somebody who already knew the address. Nothing
 * observable from inside the app catches that, which is exactly the shape of
 * failure the original version of this file was written to prevent.
 *
 * So "every type is reachable" is asserted directly, and against the dataset
 * rather than against a declaration, because for three types the answer depends
 * on the rows. `/equipment` is not in any menu; Armor, Weapons and Other
 * equipment are, and they are only *equivalent* to it while every equipment row
 * lands on one of the three. Give ammunition a view of its own without adding
 * it to a menu and 50 rows leave the site: no page looks broken and nothing else
 * here goes red.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  CUSTOMIZATION_OPTION_TYPES,
  NAVIGATION,
  NAV_GROUP_ORDER,
  TYPE_NAV,
  buildNavigation,
  destinationCount,
  groupOfType,
  soleDestination,
  typesBehind,
  type NavDestination,
  type TypePlacement,
} from "./nav-groups";
import { SUBCATEGORY_VIEWS } from "./subcategory-views";
import { TYPE_META } from "./type-meta";
import { CONTENT_TYPE_IDS, type AnySummary, type ContentTypeId } from "./types";

const SOURCE = path.resolve("app/content/nav-groups.ts");

function compilerOptions(): ts.CompilerOptions {
  const configPath = path.resolve("tsconfig.json");
  const { config } = ts.readConfigFile(configPath, (file) =>
    readFileSync(file, "utf8"),
  );
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
  );
  return { ...parsed.options, noEmit: true };
}

/**
 * Type-checks `nav-groups.ts`, optionally with the source text replaced.
 *
 * Only that one file is substituted; everything it imports is read from disk,
 * so the `ContentTypeId` union under test is the real one.
 */
function typeCheck(sourceOverride?: string): string[] {
  const options = compilerOptions();
  const host = ts.createCompilerHost(options, true);

  if (sourceOverride !== undefined) {
    const readSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
      path.resolve(fileName) === SOURCE
        ? ts.createSourceFile(
            fileName,
            sourceOverride,
            languageVersion,
            true,
            ts.ScriptKind.TS,
          )
        : readSourceFile(fileName, languageVersion, onError, shouldCreate);
  }

  const program = ts.createProgram([SOURCE], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    );
}

/** Removes one type's arm from the `TYPE_NAV` literal in the real source. */
function withoutPlacementFor(type: string): string {
  const source = readFileSync(SOURCE, "utf8");
  const arm = new RegExp(
    `^ {2}"?${type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?: \\{[^}]*\\},\\r?\\n`,
    "m",
  );

  expect(
    source,
    `TYPE_NAV no longer declares ${type} as a one-line arm, so this test can ` +
      "no longer remove it. Update the pattern rather than deleting the test.",
  ).toMatch(arm);

  return source.replace(arm, "");
}

describe("a content type that declares no group fails the build", () => {
  it("type-checks clean as written", () => {
    // The control. An always-red harness would satisfy the test below without
    // proving anything about the source.
    expect(typeCheck()).toEqual([]);
  });

  // One small type and one large one, so the assertion is not accidentally
  // about the shape of a single arm.
  it.each(["monsters", "class-improvements"])(
    "fails to compile, naming %s, when its placement is deleted",
    (type) => {
      const messages = typeCheck(withoutPlacementFor(type));

      expect(
        messages.length,
        `deleting ${type} from TYPE_NAV compiled without error. The grouping ` +
          "is no longer enforced: a new content type can now be added without " +
          "being placed, and nothing will say so.",
      ).toBeGreaterThan(0);

      // A hyphenated id comes back quoted twice — Property '"class-improvements"'
      // — so the optional quotes are part of the pattern rather than a typo.
      expect(
        messages.join("\n"),
        "the compiler must name the type that is missing, or the error is a " +
          "wall of object literal and nobody can act on it",
      ).toMatch(new RegExp(`Property '"?${type}"?' is missing`));
    },
    // Each case runs the TypeScript compiler over the real source, which takes
    // seconds rather than milliseconds. The default 5s budget covered it on a
    // fast runner and not on a slower machine, so this was a flake waiting to
    // be blamed on whatever change happened to be in flight when it fired.
    120_000,
  );
});

/** Every destination the header offers, loud and quiet alike. */
function allDestinations(): NavDestination[] {
  return NAVIGATION.flatMap((group) => [...group.primary, ...group.supporting]);
}

/**
 * The dataset this build renders from, resolved exactly as
 * `react-router.config.ts` resolves it: the generated library when it is
 * present, the committed fixture otherwise. Reading the same directory the
 * prerender walks is what makes the coverage assertion below a statement about
 * the site that will be published rather than about a sample.
 */
function summariesFor(type: ContentTypeId): AnySummary[] {
  const generated = path.resolve("app/data/generated");
  const directory = existsSync(path.join(generated, "manifest.json"))
    ? generated
    : path.resolve("app/data/fixture");

  const file = path.join(directory, `${type}.summaries.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as AnySummary[];
}

describe("every content type is reachable from the navigation", () => {
  const destinations = allDestinations();

  const indexed = new Set(
    destinations.flatMap((destination) =>
      destination.kind === "type" ? [destination.type] : [],
    ),
  );
  const named = new Set(
    destinations.flatMap((destination) =>
      destination.kind === "page" ? destination.covers : [],
    ),
  );
  const viewsFor = (type: ContentTypeId) =>
    destinations.flatMap((destination) =>
      destination.kind === "view" && destination.view.type === type
        ? [destination.view]
        : [],
    );

  it.each(CONTENT_TYPE_IDS)("leads to %s", (type) => {
    const placement = TYPE_NAV[type];
    if (placement.group === "none") {
      /*
        The escape hatch, and the one case where being unreachable is correct:
        the credits types are site metadata, linked from the footer, and must
        not appear in content navigation at all. `reason` is required by the
        type, so this is a decision somebody wrote down rather than an omission.
      */
      expect(placement.reason).not.toBe("");
      return;
    }

    if (indexed.has(type) || named.has(type)) return;

    /*
      Covered by a set of slices rather than by an index — which is a real way
      to be reachable and a fragile one, so it is proved against the rows
      instead of taken on trust. Equipment is the case: `/equipment` is in no
      menu, and Armor plus Weapons plus Other equipment only add up to it while
      every row lands on one of the three.
    */
    const views = viewsFor(type);
    expect(
      views.length,
      `${TYPE_META[type].plural} is published and nothing in the header leads ` +
        "to it: no index, no hub that names it, and no filtered view over it. " +
        "A page nothing links to is a page for whoever already knows the URL.",
    ).toBeGreaterThan(0);

    const rows = summariesFor(type);
    expect(
      rows.length,
      `${TYPE_META[type].plural} is reachable only through filtered views, ` +
        "and the dataset has no rows to check them against, so this assertion " +
        "would pass whatever the views did.",
    ).toBeGreaterThan(0);

    const orphans = rows.filter(
      (row) => !views.some((view) => view.includes(row)),
    );
    expect(
      orphans.map((row) => row.name),
      `${orphans.length} ${TYPE_META[type].plural} rows match none of the ` +
        `views the header offers over that type (${views
          .map((view) => `/${view.slug}`)
          .join(", ")}). They are published and unreachable.`,
    ).toEqual([]);
  });

  /*
    The other half of the same guarantee. The check above asks whether the rows
    a menu offers cover the type; this asks whether every view the site has
    built is in a menu at all. A view that exists and is not offered is a
    prerendered page nothing links to — and it is also what would make the
    check above quietly weaker, since it only ever looks at the views the menus
    name.
  */
  it("offers every subcategory view it has built", () => {
    const offered = new Set(
      allDestinations().flatMap((destination) =>
        destination.kind === "view" ? [destination.view.slug] : [],
      ),
    );

    expect(
      SUBCATEGORY_VIEWS.map((view) => view.slug).filter(
        (slug) => !offered.has(slug),
      ),
    ).toEqual([]);
  });
});

describe("the menus", () => {
  it("are the five subjects, in the order they were asked for", () => {
    expect(NAVIGATION.map((group) => group.label)).toEqual([
      "Rules",
      "Characters",
      "Equipment",
      "Starships",
      "NPC statblocks",
    ]);
  });

  it("send a reader to a different place from every entry", () => {
    const seen = new Map<string, string>();

    for (const group of NAVIGATION) {
      for (const destination of [...group.primary, ...group.supporting]) {
        expect(
          seen.get(destination.to),
          `${destination.to} is offered by both ${seen.get(destination.to)} ` +
            `and ${group.id}. One address in two menus is a reader being told ` +
            "it lives in two places.",
        ).toBeUndefined();
        seen.set(destination.to, group.id);
      }
    }
  });

  it("file a type's index in the group that type belongs to", () => {
    for (const group of NAVIGATION) {
      for (const destination of [...group.primary, ...group.supporting]) {
        if (destination.kind !== "type") continue;
        expect(
          groupOfType(destination.type),
          `${destination.to} is offered under ${group.id}, but TYPE_NAV files ` +
            `${destination.type} under ${groupOfType(destination.type)}. The ` +
            "menu and the rail beside the page would disagree.",
        ).toBe(group.id);
      }
    }
  });

  it("give every entry a label rather than falling back to a type name", () => {
    for (const destination of allDestinations()) {
      expect(destination.label.trim().length).toBeGreaterThan(0);
    }
  });

  /*
    Two entries in the owner's table say something the dataset does not, and
    they are the two most easily lost to a well-meaning tidy-up: a deployment
    and a venture are things a person takes, not things a ship has, which is
    exactly what a reader assumes from a menu called Starships unless it says
    otherwise.
  */
  it("says whose the deployments and ventures are", () => {
    const labels = new Map(
      allDestinations().map((destination) => [destination.to, destination.label]),
    );

    expect(labels.get("/starship-deployments")).toBe("Character deployments");
    expect(labels.get("/starship-ventures")).toBe("Character ventures");
  });

  it("names the customization hub's contents once, where the page reads it", () => {
    const hub = allDestinations().find(
      (destination) => destination.to === "/customization-options",
    );

    expect(hub?.kind).toBe("page");
    expect(hub?.kind === "page" ? hub.covers : []).toEqual(
      CUSTOMIZATION_OPTION_TYPES,
    );
  });
});

describe("the placement table", () => {
  it("places every content type the site publishes", () => {
    for (const type of CONTENT_TYPE_IDS) {
      expect(TYPE_NAV[type], `${type} has no placement`).toBeDefined();
    }
  });

  it("keeps site metadata out of content navigation", () => {
    /*
      The credits types — the people who made this and the artwork they made —
      are not game content and belong in the footer, which already links them.
      There is no such type in the published set today, which is exactly why the
      rule is exercised against a menu built here: a rule only tested by data
      that does not exist yet is a rule that breaks on the change that
      introduces it.
    */
    const placements: Record<string, TypePlacement> = {
      monsters: { group: "statblocks" },
      credit: { group: "none", reason: "site metadata, linked from the footer" },
    };

    const groups = buildNavigation(
      {
        statblocks: [
          {
            kind: "type",
            type: "monsters",
            to: "/monsters",
            label: "Creatures",
            prominence: "primary",
          },
          {
            kind: "type",
            type: "credit" as ContentTypeId,
            to: "/credit",
            label: "Credits",
            prominence: "primary",
          },
        ],
      },
      ["statblocks"],
    );

    const exposed = groups
      .flatMap((group) => [...group.primary, ...group.supporting])
      .flatMap(typesBehind)
      .filter((type) => placements[type]?.group === "none");

    expect(
      exposed,
      "a destination leads to a type that was declared to be site metadata",
    ).toEqual(["credit"]);

    // And the real navigation does not do it.
    expect(
      allDestinations()
        .flatMap(typesBehind)
        .filter((type) => TYPE_NAV[type].group === "none"),
    ).toEqual([]);
  });

  it("agrees with itself about which group a type is in", () => {
    for (const type of CONTENT_TYPE_IDS) {
      const placement = TYPE_NAV[type];
      expect(groupOfType(type)).toBe(
        placement.group === "none" ? null : placement.group,
      );
    }
  });
});

describe("building the groups", () => {
  const creatures: NavDestination = {
    kind: "type",
    type: "monsters",
    to: "/monsters",
    label: "Creatures",
    prominence: "primary",
  };

  it("drops a group with nothing in it rather than advertising an empty menu", () => {
    const groups = buildNavigation({ statblocks: [creatures] }, NAV_GROUP_ORDER);

    expect(groups.map((group) => group.id)).toEqual(["statblocks"]);
    expect(groups.every((group) => destinationCount(group) > 0)).toBe(true);
  });

  it("keeps the declared order rather than the order menus were written in", () => {
    const groups = buildNavigation(
      { statblocks: [creatures], rules: [creatures] },
      ["rules", "statblocks"],
    );

    expect(groups.map((group) => group.id)).toEqual(["rules", "statblocks"]);
  });

  it("splits a menu into the half it is for and the half it merely keeps", () => {
    const [group] = buildNavigation(
      {
        statblocks: [
          creatures,
          { ...creatures, to: "/vehicles", prominence: "supporting" },
        ],
      },
      ["statblocks"],
    );

    expect(group!.primary.map((d) => d.to)).toEqual(["/monsters"]);
    expect(group!.supporting.map((d) => d.to)).toEqual(["/vehicles"]);
  });

  /*
    A group that leads to exactly one place *is* that place, and it wears the
    group's name rather than the destination's: the bar says "NPC statblocks"
    beside Rules and Equipment, not "Creatures". The moment a vehicle stat block
    exists this becomes a menu with nothing to change.
  */
  it("stands a one-destination group in for its destination", () => {
    const [group] = buildNavigation({ statblocks: [creatures] }, ["statblocks"]);

    expect(soleDestination(group!)).toEqual({
      to: "/monsters",
      label: "NPC statblocks",
    });
  });

  it("refuses to stand in for a group that leads to more than one place", () => {
    const [group] = buildNavigation(
      { statblocks: [creatures, { ...creatures, to: "/vehicles" }] },
      ["statblocks"],
    );

    expect(soleDestination(group!)).toBeNull();
  });
});
