import { expect, test } from "@playwright/test";

test("home page renders its heading", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Star Wars 5e");
});

test("home page ships a descriptive title for search engines", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Star Wars 5e/);
});
