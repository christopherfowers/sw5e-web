import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import Home from "./home";
import type { Route } from "./+types/home";

const loaderData = {
  counts: { species: 141, monsters: 271, powers: 465 },
  total: 1820,
  curated: false,
  sourceTotals: { PHB: 900, EC: 700, WH: 120, SnV: 271 },
};

function renderHome(data: typeof loaderData = loaderData) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        Home({ loaderData: data } as unknown as Route.ComponentProps),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("Home route", () => {
  it("renders the site name as the primary heading", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { level: 1, name: /star wars 5e/i }),
    ).toBeInTheDocument();
  });

  it("describes the site purpose for search engines and screen readers", () => {
    renderHome();

    expect(screen.getByText(/community reference/i)).toBeInTheDocument();
  });

  it("shows the real count of entries for each content type", () => {
    renderHome();

    const speciesCard = screen.getByRole("link", { name: /^species/i });
    expect(within(speciesCard).getByText("141")).toBeInTheDocument();

    const creatureCard = screen.getByRole("link", { name: /^creatures/i });
    expect(within(creatureCard).getByText("271")).toBeInTheDocument();
  });

  it("links to every content type index", () => {
    renderHome();

    for (const path of [
      "/species",
      "/archetypes",
      "/backgrounds",
      "/feats",
      "/powers",
      "/maneuvers",
      "/fighting-styles",
      "/fighting-masteries",
      "/lightsaber-forms",
      "/weapon-focuses",
      "/weapon-supremacies",
      "/equipment",
      "/monsters",
    ]) {
      expect(
        document.querySelector(`a[href="${path}"]`),
        `the home page must offer a way into ${path}`,
      ).not.toBeNull();
    }
  });

  it("says so when the site is rendering the committed sample dataset", () => {
    renderHome({ ...loaderData, curated: true });

    expect(screen.getByText(/sample dataset/i)).toBeInTheDocument();
  });

  it("stays quiet about the dataset when the full library is present", () => {
    renderHome();

    expect(screen.queryByText(/sample dataset/i)).toBeNull();
  });
});
