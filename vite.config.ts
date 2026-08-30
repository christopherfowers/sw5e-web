import { existsSync } from "node:fs";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import type { PluginOption } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Makes `vite preview` resolve `/species/wookiee` to the pre-rendered
 * `species/wookiee/index.html`, the way a static host does.
 *
 * Vite's preview server reaches for the SPA fallback as soon as a URL has no
 * trailing slash, so every content page would answer with the shell instead of
 * its own pre-rendered markup — invisible to a crawler and impossible to test
 * honestly. Netlify, Cloudflare Pages, GitHub Pages and S3 website hosting all
 * do this directory-index lookup before falling back; this makes preview agree
 * with them, and leaves the SPA fallback in place for paths that really were
 * not pre-rendered.
 */
function serveDirectoryIndexBeforeSpaFallback(): PluginOption {
  const buildDirectory = path.resolve("build/client");

  return {
    name: "sw5e-preview-directory-index",
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        const [pathname = "/", query] = (request.url ?? "/").split("?");
        if (!pathname.endsWith("/") && !path.extname(pathname)) {
          const candidate = path.join(buildDirectory, pathname, "index.html");
          if (existsSync(candidate)) {
            request.url = `${pathname}/index.html${query ? `?${query}` : ""}`;
          }
        }
        next();
      });
    },
  };
}

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
  plugins: [
    tailwindcss(),
    !isVitest && reactRouter(),
    serveDirectoryIndexBeforeSpaFallback(),
  ].filter(Boolean),
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["app/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
