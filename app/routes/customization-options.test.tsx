/**
 * The hub exists to make one menu entry stand for seven content types, and the
 * only thing that makes that true is what this page renders.
 *
 * `app/content/nav-groups.ts` declares that `/customization-options` covers
 * `CUSTOMIZATION_OPTION_TYPES`, and the reachability check in
 * `nav-groups.test.ts` believes it: for those seven types it stops looking, on
 * the strength of that declaration. So the declaration has to be held to the
 * page. Delete three cards from the grid below and, without the first test
 * here, seven types would still be reported as reachable while three of them
 * had nothing anywhere leading to them.
 */

import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import CustomizationOptions, { meta } from "./customization-options";
import { CUSTOMIZATION_OPTION_TYPES } from "~/content/nav-groups";
import { TYPE_META } from "~/content/type-meta";
import type { Route } from "./+types/customization-options";

const COUNTS: Record<string, number> = {
  feats: 90,
  "fighting-styles": 32,
  "fighting-masteries": 32,
  "lightsaber-forms": 20,
  "weapon-focuses": 8,
  "weapon-supremacies": 8,
  "class-improvements": 29,
};

const loaderData = {
  options: CUSTOMIZATION_OPTION_TYPES.map((type) => ({
    type,
    count: COUNTS[type] ?? 0,
  })),
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
  it("leads to every type the header says it covers", () => {
    renderPage();

    for (const type of CUSTOMIZATION_OPTION_TYPES) {
      const card = screen.queryByRole("link", {
        name: new RegExp(`^${TYPE_META[type].plural}`, "i"),
      });

      expect(
        card,
        `the header offers this page in place of ${TYPE_META[type].plural}, ` +
          "so a reader who opens it and does not find them has been sent to a " +
          "dead end and the reachability check has been told a lie",
      ).not.toBeNull();
      expect(card).toHaveAttribute("href", `/${type}`);
    }
  });

  it("offers nothing beyond what it claims to cover", () => {
    const { container } = renderPage();

    const hrefs = [
      ...container.querySelectorAll<HTMLAnchorElement>(".type-grid a[href]"),
    ].map((anchor) => anchor.getAttribute("href"));

    expect(hrefs).toEqual(
      CUSTOMIZATION_OPTION_TYPES.map((type) => `/${type}`),
    );
  });

  it("says how many entries each list holds", () => {
    renderPage();

    const feats = screen.getByRole("link", { name: /^feats/i });

    expect(within(feats).getByText("90")).toBeInTheDocument();
  });

  /*
    The number in the lede is the whole point of gathering them: seven lists is
    a shape, 219 choices is a reason to open the page. It is summed from the
    manifest rather than written down, because it was wrong within one release
    every previous time a count on this site was written down.
  */
  it("adds the seven lists up in its own lede", () => {
    renderPage();

    expect(screen.getByText(/219 choices/)).toBeInTheDocument();
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

  it("names the seven lists, because the page's own title names none of them", () => {
    const description = descriptionFrom(loaderData);

    for (const subject of [
      "feats",
      "fighting styles",
      "lightsaber forms",
      "class improvements",
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
