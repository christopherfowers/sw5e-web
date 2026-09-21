import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    // The full canonical dataset pre-renders ~5,100 routes and takes about
    // half an hour. CI builds the small committed fixture instead and
    // finishes in seconds; a contributor with app/data/generated populated
    // should expect the long one.
    timeout: 600_000,
  },
});
