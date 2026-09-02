import { expect } from "@playwright/test";

type Page = import("@playwright/test").Page;

/**
 * Waits until React has taken over the page.
 *
 * ## Why a test has to ask
 *
 * Every page here is static HTML that works before any JavaScript runs — that
 * is the point of the site — so `page.goto` resolving means the markup is
 * there, not that anything is wired up. A click that lands in the gap does
 * whatever the plain HTML would do: a button with no handler yet does nothing
 * at all, and the assertion after it waits five seconds for a state change
 * that was never going to happen.
 *
 * Against a production build the gap is small enough that tests usually win
 * the race. Against the development server, which compiles modules on demand,
 * they usually lose it. Fifteen specs failed that way — sorting a table,
 * submitting the registration form, stepping to the next species — none of
 * them because anything was broken.
 *
 * Waiting is not weakening those tests. A test that means "sorting works"
 * should assert that sorting works, not that sorting works *within 5ms of
 * navigation*; if that gap is worth asserting it deserves a test that says so.
 *
 * ## Why this signal
 *
 * `aria-expanded` on a navigation group's `<summary>` is added only once React
 * is running, deliberately and for its own reasons — see the note on
 * `useHydrated` in `app/components/site-nav.tsx`, which explains why serving it
 * in the static file would tell a screen reader the opposite of the truth.
 *
 * That makes it an honest hydration signal rather than a marker added for the
 * tests: it is a real attribute the application needs, it appears exactly when
 * React attaches, and it is in the header, so it is on every page.
 */
export async function hydrated(page: Page): Promise<void> {
  await expect(
    page.locator(".site-nav details > summary[aria-expanded]").first(),
    "the page never hydrated: React did not attach within the timeout",
  ).toBeAttached();
}

/**
 * Goes to a page and waits until it is interactive.
 *
 * For the screens that are nothing but JavaScript — the account area resolves
 * who you are after hydration and draws a placeholder until it has — where
 * `goto` alone means "the skeleton arrived".
 */
export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await hydrated(page);
}
