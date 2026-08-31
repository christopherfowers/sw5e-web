import { expect, test } from "@playwright/test";

/**
 * The credits, as the server actually sends them.
 *
 * This is checked over a raw HTTP GET rather than in a browser for the same
 * reason `prerender.spec.ts` is: hydration would paint the page whether or not
 * the server sent any of it, and a credits page that only exists once
 * JavaScript runs is a credits page that half the things which might read it
 * never see. Attribution that is invisible to a crawler is attribution nobody
 * can find.
 */
test.describe("the credits page", () => {
  test("is served as rendered HTML, not an empty shell", async ({ request }) => {
    const response = await request.get("/credits");

    expect(response.ok()).toBe(true);

    const html = await response.text();

    expect(html).toMatch(/<h1[^>]*>Credits<\/h1>/);
    // The creator, and a collaborator with the specific work they were
    // credited for. A page that lost the contribution text would still show
    // the name, so the sentence is what is asserted.
    expect(html).toContain("Galiphile");
    expect(html).toContain("Karbacca");
    expect(html).toContain("cover and SW5e logo");
  });

  test("keeps its categories apart rather than as one list of names", async ({
    page,
  }) => {
    await page.goto("/credits");

    for (const heading of [
      "The SW5e Jedi Council",
      "The Contributors",
      "The Patrons",
      "Art Assets",
    ]) {
      await expect(
        page.getByRole("heading", { name: heading, level: 2 }),
      ).toBeVisible();
    }
  });

  /**
   * A name the 2022 scrape damaged, served over the wire with its accents. An
   * encoding fault would most plausibly reappear here, at the boundary where
   * bytes become a document.
   */
  test("serves a repaired name with its accents intact", async ({ request }) => {
    const html = await (await request.get("/credits")).text();

    expect(html).toContain("César Díaz");
    expect(html).not.toContain("�");
  });

  test("is reachable from the footer of any page", async ({ page }) => {
    await page.goto("/species");

    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Credits" })
      .click();

    await expect(page).toHaveURL(/\/credits$/);
    await expect(page.getByRole("heading", { name: "Credits", level: 1 })).toBeVisible();
  });

  /**
   * The per-work half of this: a picture carries its own credit where it is
   * shown, rather than only appearing in the bulk list on /credits. Every
   * species portrait is inherited from the original site with no recorded
   * artist, and saying so beside the picture is what makes the gap visible to
   * the one person who could close it.
   */
  test("says beside a portrait that its artist is not recorded", async ({ page }) => {
    await page.goto("/species");
    await page.getByRole("link", { name: /Abyssin/ }).first().click();

    await expect(page.locator(".image-credit")).toContainText("Artist not recorded");
    await expect(
      page.locator(".image-credit").getByRole("link", { name: "See the artists" }),
    ).toBeVisible();
  });
});
