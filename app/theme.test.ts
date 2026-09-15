/**
 * The two dark palettes, which must be one palette.
 *
 * The site is dark when the operating system says so, and dark when a reader
 * has chosen it. CSS has no way to share one declaration list between a media
 * query and an attribute selector, so the palette is written twice — once under
 * `@media (prefers-color-scheme: dark)` and once under `:root[data-theme="dark"]`.
 *
 * That duplication is safe only if something checks it. A palette that drifts
 * between "dark because the system said so" and "dark because I asked for it"
 * is the kind of fault nobody finds by looking, because nobody looks at both:
 * you are in one state or the other, and each looks fine on its own.
 *
 * So this parses the stylesheet and compares them. It reads the real file
 * rather than a fixture, because the thing being asserted is a property of the
 * shipped stylesheet and a fixture could only ever agree with itself.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.join(process.cwd(), "app", "app.css"),
  "utf8",
);

/** The declarations of the first rule whose selector matches. */
function tokensAfter(marker: string): Map<string, string> {
  const start = CSS.indexOf(marker);
  if (start === -1) {
    throw new Error(`app.css no longer contains \`${marker}\``);
  }

  const open = CSS.indexOf("{", start);
  const body = CSS.slice(open + 1, CSS.indexOf("}", open));

  const tokens = new Map<string, string>();
  for (const line of body.split("\n")) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(line);
    if (match) tokens.set(match[1], match[2].trim());
  }

  return tokens;
}

describe("the dark palette", () => {
  const system = tokensAfter(':root:not([data-theme="light"])');
  const chosen = tokensAfter(':root[data-theme="dark"]');

  it("is not empty, in either place", () => {
    // Guards the parser as much as the palette: a selector rename that made
    // both sides parse as nothing would otherwise pass every test below.
    expect(system.size).toBeGreaterThan(20);
    expect(chosen.size).toBe(system.size);
  });

  it("names the same tokens whether the system chose it or a reader did", () => {
    expect([...chosen.keys()].sort()).toEqual([...system.keys()].sort());
  });

  it("gives every token the same value in both", () => {
    const different = [...system.entries()]
      .filter(([name, value]) => chosen.get(name) !== value)
      .map(([name, value]) => `${name}: ${value} vs ${chosen.get(name)}`);

    expect(
      different,
      "the palette must not depend on how the reader arrived at dark",
    ).toEqual([]);
  });
});

describe("choosing light explicitly", () => {
  /**
   * The system block yields to an explicit light choice.
   *
   * Without the `:not([data-theme="light"])`, a reader on a dark desktop who
   * asked for light would get the dark palette anyway — the media query would
   * still match, and nothing in the light branch would override it. That is the
   * whole mechanism by which the toggle can turn the site *lighter* than the
   * operating system, and it is one selector wide.
   */
  it("is what stops the system's dark preference applying", () => {
    expect(CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(CSS).toContain(':root:not([data-theme="light"])');
  });
});
