import { expect, test } from "@playwright/test";

/**
 * Inter is self-hosted. Reintroducing the Google Fonts <link> elements would
 * leak every visitor's IP address to Google on first paint and would force
 * `style-src https://fonts.googleapis.com` and
 * `font-src https://fonts.gstatic.com` into this app's Content-Security-Policy
 * permanently. Neither failure is visible by looking at the page, so it is
 * asserted here instead.
 */
test("the page requests no third-party origins", async ({ page }) => {
  const externalRequests: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());

    if (url.origin !== "http://localhost:4173") {
      externalRequests.push(request.url());
    }
  });

  await page.goto("/", { waitUntil: "networkidle" });

  expect(
    externalRequests,
    "every asset must be served from this origin; a third-party request here " +
      "means an external dependency was reintroduced",
  ).toEqual([]);
});

test("the served document links no external font stylesheet", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();

  expect(html).not.toContain("fonts.googleapis.com");
  expect(html).not.toContain("fonts.gstatic.com");
});
