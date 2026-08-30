import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LostValue, SourceText } from "./source-text";

const REPLACEMENT = "�";

describe("text that came from the legacy archive", () => {
  it("renders clean text unchanged", () => {
    render(
      <p data-testid="line">
        <SourceText value="Wookiees are tall and covered in hair." />
      </p>,
    );

    expect(screen.getByTestId("line")).toHaveTextContent(
      "Wookiees are tall and covered in hair.",
    );
  });

  /**
   * The whole point of the component. A bare U+FFFD on screen reads as game
   * content — a rune, a symbol, part of a name — so it must always be replaced
   * by something that announces itself as a gap.
   */
  it("never puts a replacement character on the screen", () => {
    const { container } = render(
      <SourceText value={`Seelv${REPLACEMENT}n and L${REPLACEMENT}vern`} />,
    );

    expect(container.textContent).not.toContain(REPLACEMENT);
  });

  it("marks each lost character so a screen reader hears the gap", () => {
    const { container } = render(
      <SourceText value={`Ty${REPLACEMENT}k`} />,
    );

    const markers = container.querySelectorAll(".lost-character");
    expect(markers).toHaveLength(1);
    expect(markers[0].textContent).toContain("one character lost");
  });

  it("marks every lost character, not just the first", () => {
    const { container } = render(
      <SourceText value={`a${REPLACEMENT}b${REPLACEMENT}c`} />,
    );

    expect(container.querySelectorAll(".lost-character")).toHaveLength(2);
  });

  it("keeps the surviving text on either side of the gap", () => {
    const { container } = render(
      <SourceText value={`Seelv${REPLACEMENT}n`} />,
    );

    expect(container.textContent).toContain("Seelv");
    expect(container.textContent).toContain("n");
  });
});

describe("a field the archive lost entirely", () => {
  it("says the value is not recorded rather than implying there is none", () => {
    render(<LostValue />);

    expect(screen.getByText(/not recorded/)).toBeInTheDocument();
    expect(
      screen.getByText(/lost from the source data/),
    ).toBeInTheDocument();
  });
});
