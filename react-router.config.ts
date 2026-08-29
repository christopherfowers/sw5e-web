import type { Config } from "@react-router/dev/config";

export default {
  // No runtime Node server. Content pages are prerendered to static HTML for
  // search-engine visibility and instant loads; everything else is served by
  // the SPA fallback.
  ssr: false,

  // Plan D extends this list with one path per published content item.
  async prerender() {
    return ["/"];
  },
} satisfies Config;
