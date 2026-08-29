import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Vitest transforms route modules through Vite's "serve"-mode pipeline, which
// makes the React Router plugin wrap components with a React Fast Refresh
// preamble check. That check only passes when a real browser dev server has
// injected the preamble script into index.html, so it throws under Vitest's
// jsdom environment regardless of the `server.hmr` setting (Vitest manages
// `import.meta.hot` itself for its own watch mode).
//
// The fix below excludes the ENTIRE `reactRouter()` plugin under Vitest, not
// just the Fast Refresh piece — there is no finer-grained way to disable only
// the preamble check. That's safe today only because our tests render route
// components directly (`render(<Home />)`), so plain esbuild JSX transforms
// are all they need. It stops being safe the moment a test starts depending
// on something the plugin itself provides — route-level code splitting,
// virtual route modules, `loader`/`action` wiring, or route-level CSS side
// effects. Such a test would render fine under Vitest (no plugin) yet behave
// differently under `dev`/`build` (plugin present), and nothing here would
// catch the divergence. If that need arises, prefer `createRoutesStub` (see
// React Router's testing docs) over trying to force the real plugin into
// Vitest. Re-check this exclusion whenever `@react-router/dev` is upgraded,
// in case a future release adds a supported way to disable just the preamble
// check instead of dropping the whole plugin.
const isVitest = process.env.VITEST === "true";

export default defineConfig({
  plugins: [tailwindcss(), !isVitest && reactRouter()].filter(Boolean),
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["app/**/*.test.{ts,tsx}"],
  },
});
