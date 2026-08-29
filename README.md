# sw5e-web

Frontend for the SW5e community platform.

## Requirements

- Node 22.23.2 (see `.nvmrc`); minimum supported 22.22.0

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

WCAG 2.1 AA is the target this project is built against. It is **not** yet
enforced automatically: CI currently runs end-to-end smoke, prerendering, and
self-hosted-asset checks, with no automated accessibility scanning and no
keyboard-navigation coverage. Adding an axe-based audit and keyboard-path
end-to-end tests is outstanding work, and until it lands, conformance is a
goal rather than a verified property.

## Fonts

Inter is self-hosted from `app/fonts` and declared in `app/app.css`. It is not
loaded from Google Fonts: doing so leaks every visitor's IP address to a third
party and would permanently require `fonts.googleapis.com` and
`fonts.gstatic.com` in this app's Content-Security-Policy. The font files are
licensed under the [SIL Open Font License 1.1](app/fonts/LICENSE).

## License

MIT — see [LICENSE](LICENSE).
