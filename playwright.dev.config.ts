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
   * One spec, for now, and the narrowness is deliberate rather than settled.
   *
   * Most of the suite either asserts something about the files the build
   * writes — `prerender`, `account-prerender`, `authoring-prerender`,
   * `self-hosted-fonts` — which the development server does not produce, or
   * does not currently pass here for reasons that look like the tests racing a
   * slower server rather than the product being wrong. Adding those before
   * they are understood would buy a gate that goes red for reasons nobody
   * trusts, which is worse than no gate.
   *
   * So: the one spec that caught a real fault, kept green, with the rest to
   * follow as each is worked out.
   */
  testMatch: ["navigation.spec.ts"],

  use: { baseURL: "http://localhost:5173" },

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
