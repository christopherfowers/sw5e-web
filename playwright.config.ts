import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    // The full archive-derived dataset pre-renders ~1,830 routes, which takes
    // minutes. CI builds the small committed fixture and finishes in seconds.
    timeout: 600_000,
  },
});
