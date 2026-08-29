import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./home";

describe("Home route", () => {
  it("renders the site name as the primary heading", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: /star wars 5e/i })
    ).toBeInTheDocument();
  });

  it("describes the site purpose for search engines and screen readers", () => {
    render(<Home />);

    expect(screen.getByText(/community reference/i)).toBeInTheDocument();
  });
});
