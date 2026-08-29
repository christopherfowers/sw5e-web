import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Vitest transforms route modules through Vite's "serve"-mode pipeline, which
// makes the React Router plugin wrap components with a React Fast Refresh
// preamble check. That check only passes when a real browser dev server has
// injected the preamble script into index.html, so it throws under Vitest's
// jsdom environment regardless of the `server.hmr` setting (Vitest manages
// `import.meta.hot` itself for its own watch mode). The React Router plugin
// isn't needed to transform a plain component under test, so it's swapped
// out for Vitest only; `npm run dev` and `npm run build` are unaffected.
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
