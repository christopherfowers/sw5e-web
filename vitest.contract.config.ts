import { defineConfig } from "vitest/config";

/**
 * The contract suite, kept separate from the unit suite on purpose.
 *
 * `npm test` must stay fast, offline and hermetic — it is what runs on every
 * save. The tests under `tests/contract` are none of those things: they need
 * the account API image running somewhere, they talk to it over the network,
 * and they take as long as a container takes to start. Folding them into the
 * default `include` would make the ordinary suite fail on a laptop with no
 * Docker, which is the surest way to get a suite ignored.
 *
 * So they live behind `npm run test:contract`, they skip themselves entirely
 * when `SW5E_CONTRACT_API` is unset, and CI runs them as their own job.
 *
 * `environment: "node"` rather than jsdom, and no `setupFiles`: the point of
 * these tests is the client module talking to a real server over real HTTP, and
 * a DOM would only invite them to drift back into being component tests.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/contract/**/*.test.ts"],

    // A container start plus a handful of round trips. The default five seconds
    // is enough for the requests and not for a cold image.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
