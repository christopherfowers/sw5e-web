/**
 * The grouping has to be enforced by the compiler, not by convention.
 *
 * A flat strip of every content type is what this replaced, and it is what it
 * will quietly become again if a type can be added without being placed: the
 * missing type would simply not appear in navigation, every test would stay
 * green, and the only symptom would be a page nobody can reach from the header.
 * Nothing observable from inside the app catches that.
 *
 * So the test below is not a test of behaviour. It takes the real
 * `app/content/nav-groups.ts`, deletes one arm of `TYPE_NAV`, runs the
 * TypeScript compiler over the result, and asserts that the build fails with
 * the deleted type's own name in the message. It is checking that the guard
 * still exists — that `TYPE_NAV` is still a total `Record<ContentTypeId, …>`
 * and has not been softened to a `Partial`, widened to `Record<string, …>` or
 * given a fallback. `app/auth/prerender-safety.test.ts` exists for the same
 * kind of reason.
 *
 * The unmodified source is compiled first, in the same harness. Without that
 * control the test would pass just as happily against a harness that reports an
 * error whatever it is given, which is the usual way a test like this rots.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  NAVIGATION,
  TYPE_NAV,
  buildNavigation,
  destinationCount,
  groupOfType,
  type TypePlacement,
} from "./nav-groups";
import { TYPE_META, TYPE_ORDER } from "./type-meta";
import { CONTENT_TYPE_IDS } from "./types";

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
          "being placed, and it will silently vanish from navigation.",
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

describe("the placement table", () => {
  it("places every content type the site publishes", () => {
    for (const type of CONTENT_TYPE_IDS) {
      expect(TYPE_NAV[type], `${type} has no placement`).toBeDefined();
    }
  });

  it("leads to every content type from the header", () => {
    const reachable = new Set(
      NAVIGATION.flatMap((group) => [...group.primary, ...group.supporting]),
    );

    for (const type of TYPE_ORDER) {
      expect(
        reachable.has(type),
        `${TYPE_META[type].plural} is published but cannot be reached from ` +
          "the navigation. Grouping must not lose a destination.",
      ).toBe(true);
    }
  });

  it("keeps site metadata out of content navigation", () => {
    /*
      The credits types — the people who made this and the artwork they made —
      are not game content and belong in the footer, which already links them.
      There is no such type in the published set today, which is exactly why
      this is asserted against `buildNavigation` directly: a rule that is only
      exercised by data that does not exist yet is a rule that will be broken
      by the change that introduces it.
    */
    const placements: Record<string, TypePlacement> = {
      monsters: { group: "bestiary", prominence: "primary" },
      credit: { group: "none", reason: "site metadata, linked from the footer" },
      "credit-category": { group: "none", reason: "site metadata" },
      "asset-credit": { group: "none", reason: "site metadata" },
    };

    const groups = buildNavigation(
      ["monsters", "credit", "credit-category", "asset-credit"],
      placements,
      {},
    );
    const destinations = groups.flatMap((group) => [
      ...group.primary,
      ...group.supporting,
    ]);

    expect(destinations).toEqual(["monsters"]);
  });

  it("puts a type in exactly one group", () => {
    const seen = new Map<string, string>();

    for (const group of NAVIGATION) {
      for (const type of [...group.primary, ...group.supporting]) {
        expect(
          seen.get(type),
          `${type} appears in both ${seen.get(type)} and ${group.id}`,
        ).toBeUndefined();
        seen.set(type, group.id);
      }
    }
  });

  it("agrees with itself about which group a type is in", () => {
    for (const group of NAVIGATION) {
      for (const type of [...group.primary, ...group.supporting]) {
        expect(groupOfType(type)).toBe(group.id);
      }
    }
  });

  it("drops a group with nothing in it rather than advertising an empty menu", () => {
    const groups = buildNavigation(
      ["monsters"],
      { monsters: { group: "bestiary", prominence: "primary" } },
      {},
    );

    expect(groups.map((group) => group.id)).toEqual(["bestiary"]);
    expect(groups.every((group) => destinationCount(group) > 0)).toBe(true);
  });
});
