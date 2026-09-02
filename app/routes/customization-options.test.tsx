/**
 * The hub exists to make one menu entry stand for nine lists, and the only
 * thing that makes that true is what this page renders.
 *
 * `app/content/nav-groups.ts` derives the hub's coverage claims from
 * `CUSTOMIZATION_OPTION_DESTINATIONS`, and the reachability check in
 * `nav-groups.test.ts` believes them: for the six types the hub indexes it
 * stops looking, on the strength of the declaration. So the declaration has to
 * be held to the page. Delete three cards from the grid below and, without the
 * first test here, six types would still be reported as reachable while three
 * of them had nothing anywhere leading to them.
 *
 * Three of the nine cards are not type indexes. `class-improvements` is one
 * content type holding three unrelated answers, told apart by
 * `improvementType`, and the previous site published them as three pages — so
 * the hub links `/class-improvements`, `/multiclass-improvements` and
 * `/splashclass-improvements`, which are filtered views. That is the reason
 * this file asserts on addresses rather than on type ids: for three of the nine
 * there is no type id to assert on.
 */

import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import CustomizationOptions, { meta } from "./customization-options";
import {
  CUSTOMIZATION_OPTION_DESTINATIONS,
  CUSTOMIZATION_OPTION_TYPES,
  faceOf,
} from "~/content/nav-groups";
import type { Route } from "./+types/customization-options";

const COUNTS: Record<string, number> = {
  "/feats": 90,
  "/fighting-styles": 32,
  "/fighting-masteries": 32,
  "/lightsaber-forms": 20,
  "/weapon-focuses": 8,
  "/weapon-supremacies": 8,
  "/class-improvements": 10,
  "/multiclass-improvements": 10,
  "/splashclass-improvements": 10,
};

const loaderData = {
  counts: COUNTS,
  total: Object.values(COUNTS).reduce((sum, count) => sum + count, 0),
};

function renderPage(data: typeof loaderData = loaderData) {
  const Stub = createRoutesStub([
    {
      path: "/customization-options",
      Component: () =>
        CustomizationOptions({
          loaderData: data,
        } as unknown as Route.ComponentProps),
    },
  ]);
  return render(<Stub initialEntries={["/customization-options"]} />);
}

describe("the customization options hub", () => {
  it("leads to every list the header says it holds", () => {
    renderPage();

    for (const destination of CUSTOMIZATION_OPTION_DESTINATIONS) {
      const face = faceOf(destination);
      const card = screen.queryByRole("link", {
        name: new RegExp(`^${face.label}`, "i"),
      });

      expect(
        card,
        `the header offers this page in place of ${face.label}, so a reader ` +
          "who opens it and does not find them has been sent to a dead end " +
          "and the reachability check has been told a lie",
      ).not.toBeNull();
      expect(card).toHaveAttribute("href", face.to);
    }
  });

  it("offers nothing beyond what it claims to hold", () => {
    const { container } = renderPage();

    const hrefs = [
      ...container.querySelectorAll<HTMLAnchorElement>(".type-grid a[href]"),
    ].map((anchor) => anchor.getAttribute("href"));

    expect(hrefs).toEqual(
      CUSTOMIZATION_OPTION_DESTINATIONS.map((destination) => destination.to),
    );
  });

  /*
    The three that are cuts of one type rather than types of their own, named
    outright.

    Deriving the expectation from the same array the page walks proves the page
    and the menu agree and proves nothing about which lists a reader is offered
    — put the merged thirty-row index back and every other assertion here goes
    on passing. This is the one that would not.
  */
  it("offers the class improvements as the three things they are", () => {
    renderPage();

    for (const [label, href] of [
      ["Class improvements", "/class-improvements"],
      ["Multiclass improvements", "/multiclass-improvements"],
      ["Splashclass improvements", "/splashclass-improvements"],
    ]) {
      expect(
        screen.getByRole("link", { name: new RegExp(`^${label}`, "i") }),
        `a reader who came here about ${label!.toLowerCase()} must not be ` +
          "handed a list of all thirty improvements",
      ).toHaveAttribute("href", href!);
    }
  });

  /*
    And the claim the reachability check reads, which is deliberately the
    smaller one: the six types whose whole index is on this page. The class
    improvements are not among them even though they are on the page, because
    what the page links is three cuts of that type — and three cuts cover a
    type only while every row lands on one of them, which is a question about
    the dataset and is asked of the dataset in `nav-groups.test.ts`.
  */
  it("claims to cover only the types it leads to whole", () => {
    expect(CUSTOMIZATION_OPTION_TYPES).not.toContain("class-improvements");
    expect(CUSTOMIZATION_OPTION_TYPES).toEqual([
      "feats",
      "fighting-styles",
      "fighting-masteries",
      "lightsaber-forms",
      "weapon-focuses",
      "weapon-supremacies",
    ]);
  });

  it("says how many entries each list holds", () => {
    renderPage();

    const feats = screen.getByRole("link", { name: /^feats/i });
    expect(within(feats).getByText("90")).toBeInTheDocument();

    // A slice has no entry in the manifest, so its number can only come from
    // running its own predicate. A card that could not be counted would read 0
    // beside eight that could.
    const multiclass = screen.getByRole("link", {
      name: /^multiclass improvements/i,
    });
    expect(within(multiclass).getByText("10")).toBeInTheDocument();
  });

  /*
    The number in the lede is the whole point of gathering them: nine lists is
    a shape, 219 choices is a reason to open the page. It is summed from the
    manifest and the predicates rather than written down, because it was wrong
    within one release every previous time a count on this site was written
    down.
  */
  it("adds the nine lists up in its own lede", () => {
    renderPage();

    expect(
      screen.getByText(new RegExp(`${loaderData.total} choices`)),
    ).toBeInTheDocument();
  });

  it("is a hub rather than a merged list of the options themselves", () => {
    const { container } = renderPage();

    expect(
      container.querySelector("table"),
      "an entry on one of these lists is never a substitute for an entry on " +
        "another, so a merged table would need a column whose only job is to " +
        "undo the merge",
    ).toBeNull();
  });
});

describe("the hub's metadata", () => {
  function descriptionFrom(data?: typeof loaderData) {
    const tags = meta({ loaderData: data } as unknown as Route.MetaArgs) as unknown as Array<
      Record<string, string>
    >;
    return tags.find((tag) => tag.name === "description")?.content ?? "";
  }

  it("names the lists, because the page's own title names none of them", () => {
    const description = descriptionFrom(loaderData);

    for (const subject of [
      "feats",
      "fighting styles",
      "lightsaber forms",
      // Named separately rather than as "class improvements", which is the
      // whole point of the split: a search result for multiclassing should
      // reach this page saying so.
      "class, multiclass and splashclass improvements",
    ]) {
      expect(description, `the description must mention ${subject}`).toContain(
        subject,
      );
    }
  });

  it("still reads as a sentence when the loader has thrown", () => {
    const description = descriptionFrom(undefined);

    expect(description).not.toMatch(/undefined|NaN/);
    expect(description).toMatch(/^Everything/);
  });
});
