# sw5e-web

Frontend for the SW5e community platform.

## Requirements

- Node 22.16.0 (see `.nvmrc`)

## Getting started

```bash
npm ci
npm run dev
```

## How rendering works

Published content pages are **prerendered to static HTML at build time** — there
is no runtime Node server. This gives content pages optimal search-engine
visibility and near-instant loads. Authenticated routes such as editing and the
review queue fall through to the SPA fallback, where search-engine visibility is
irrelevant.

The prerender path list lives in `react-router.config.ts`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build with prerendering |
| `npm run typecheck` | Route typegen plus TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |

## Accessibility

Target is WCAG 2.1 AA, verified by automated checks and keyboard-navigation
end-to-end paths in CI.

## License

MIT — see [LICENSE](LICENSE).
