/**
 * Starting a book.
 *
 * The question this control exists to ask is whether a book is canon or
 * homebrew, so the tests that matter are the ones about that answer surviving
 * into the editor, and about it not being confused with whether the book is a
 * licensed Star Wars product. Those two were confused once already, in a field
 * that carried no description at all.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { NewBook, newBookPath, suggestKey } from "./new-book";

function mount() {
  const router = createMemoryRouter(
    [
      { path: "/", Component: () => <NewBook /> },
      { path: "/authoring/edit", Component: () => <p>editor</p> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("the address", () => {
  it("is written from the title", () => {
    expect(suggestKey("Wretched Hives")).toBe("wretched-hives");
    expect(suggestKey("Scum & Villainy")).toBe("scum-villainy");
    expect(suggestKey("A Smuggler's Guide")).toBe("a-smugglers-guide");
  });

  it("follows the title until somebody edits it, and then stops", async () => {
    mount();

    await userEvent.type(screen.getByLabelText("What is it called?"), "Wretched");
    expect(screen.getByLabelText("Address")).toHaveValue("wretched");

    // Once it is somebody's own, the next keystroke in the title must not
    // silently take it back.
    await userEvent.clear(screen.getByLabelText("Address"));
    await userEvent.type(screen.getByLabelText("Address"), "wh");
    await userEvent.type(screen.getByLabelText("What is it called?"), " Hives");

    expect(screen.getByLabelText("Address")).toHaveValue("wh");
  });

  it("refuses to start on an address the service would reject", async () => {
    mount();

    await userEvent.type(screen.getByLabelText("What is it called?"), "Hives");
    await userEvent.clear(screen.getByLabelText("Address"));
    await userEvent.type(screen.getByLabelText("Address"), "Not A Key");

    expect(screen.getByRole("button", { name: "Start drafting" })).toBeDisabled();
  });
});

describe("canon or homebrew", () => {
  it("defaults to canon", () => {
    mount();

    expect(screen.getByRole("radio", { name: /A Star Wars 5e book/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Homebrew/ })).not.toBeChecked();
  });

  it("says plainly that neither answer makes the book an official product", () => {
    mount();

    // `isOfficial` is a separate field meaning "licensed Star Wars product",
    // and it is false for everything here including the Player's Handbook.
    // This control must never look like the place that sets it.
    expect(
      screen.getByText(/Nothing here is: Star Wars 5e is community work/),
    ).toBeInTheDocument();
  });

  it("carries the answers into the editor", () => {
    expect(newBookPath("wretched-hives", "Wretched Hives", false)).toBe(
      "/authoring/edit?type=source&key=wretched-hives&title=Wretched+Hives",
    );
    expect(newBookPath("my-table", "My Table", true)).toBe(
      "/authoring/edit?type=source&key=my-table&title=My+Table&homebrew=1",
    );
  });

  it("opens the editor with what it was told", async () => {
    const router = mount();

    await userEvent.type(
      screen.getByLabelText("What is it called?"),
      "Wretched Hives",
    );
    await userEvent.click(screen.getByRole("radio", { name: /Homebrew/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start drafting" }));

    expect(await screen.findByText("editor")).toBeInTheDocument();

    const search = router.state.location.search;
    expect(search).toContain("type=source");
    expect(search).toContain("key=wretched-hives");
    expect(search).toContain("homebrew=1");
  });
});
