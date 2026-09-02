import { defineConfig } from "@playwright/test";

/**
 * The interaction specs, run a second time against the development server.
 *
 * This exists because of a bug that got all the way to a deployed site while
 * every gate stayed green. The header's group menus would not open at all
 * under `react-router dev`, and the same code in a production build opened
 * them correctly — the fault was a race between an asynchronous `toggle`
 * event and React's own write of the `open` attribute, and which side won
 * depended on timing that development and production do not share.
 *
 * Nothing was in a position to see it. jsdom does not schedule `toggle` the
 * way a browser does, so the unit tests could not reach the race; the
 * end-to-end suite runs against `vite preview`, so it only ever exercised the
 * half that happened to work. The bug was found by opening the site and
 * clicking the menu, which is the one thing no gate did.
 *
 * So the gate is now the same specs against the other server. It costs no
 * build — the dev server compiles on demand — and it is deliberately narrow:
 * only the specs about behaviour a person drives with a pointer or a keyboard.
 * Prerendering, served markup and anything else that is a property of the
 * build belongs to the production run and would be meaningless here.
 */
export default defineConfig({
  testDir: "./e2e",

  /*
   * Everything about behaviour a person drives, which is now the whole of it.
   *
   * This ran one spec when it was introduced, because the other three did not
   * pass here and the reasons were not understood. They are now, and none of
   * them was the product: fifteen specs were interacting with the page before
   * React had attached to it, and one file had the preview server's port
   * written into it so every request from the development server carried an
   * origin the account fixture refused.
   *
   * Still excluded: `prerender`, `account-prerender`, `authoring-prerender`,
   * `self-hosted-fonts`, `imagery`, `credits`, `page-structure`, `contrast`
   * and `starships`, which assert properties of the files the build writes.
   * The development server does not produce those files, so running them here
   * would assert nothing.
   */
  testMatch: [
    "navigation.spec.ts",
    "keyboard.spec.ts",
    "content.spec.ts",
    "account.spec.ts",
  ],

  use: { baseURL: "http://localhost:5173" },

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
