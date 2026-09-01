import { type RouteConfig, index, route } from "@react-router/dev/routes";

// The two dynamic content routes cover every content type. Each type
// still gets its own columns, filters and detail shaping — that lives in the
// per-type configuration, not in a duplicated route module.
//
// The static segments are declared before `:type` for readability; React
// Router ranks a static segment above a dynamic one regardless of order, so
// `/sources` reaches the source pages rather than being read as one more
// content type. The account routes are static segments too, and rank the same
// way — `/account` cannot be mistaken for a content type.
export default [
  index("routes/home.tsx"),
  route("about", "routes/about.tsx"),
  route("search", "routes/search.tsx"),
  route("sources", "routes/sources.tsx"),
  route("sources/:slug", "routes/source-detail.tsx"),
  route("credits", "routes/credits.tsx"),

  // Account routes. Every one of these prerenders to a signed-out skeleton and
  // resolves its identity in the browser; none of them exports a `loader`.
  // `app/routes/account.tsx` explains why that rule exists and what breaks
  // without it.
  route("register", "routes/register.tsx"),
  route("verify-email", "routes/verify-email.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  route("account", "routes/account.tsx", [
    index("routes/account-profile.tsx"),
    route("passkeys", "routes/account-passkeys.tsx"),
    route("security", "routes/account-security.tsx"),
    route("contributions", "routes/account-contributions.tsx"),
    route("flags", "routes/account-flags.tsx"),

    // The administration screens. Static segments beneath `/account`, and
    // deliberately no `:userId` among them: a dynamic administrative route
    // could not be prerendered — there is no bounded list of accounts, and an
    // account identifier is not something the build machine should be
    // enumerating — so it would fall through to nginx's SPA fallback, which is
    // wired to `error_page 404` and answers 404 to everything that reads the
    // status line. The open account is a query parameter on a static path
    // instead. See `app/routes/account-people.tsx`.
    route("people", "routes/account-people.tsx"),
    route("audit", "routes/account-audit.tsx"),
  ]),

  route(":type", "routes/type-index.tsx"),
  route(":type/:slug", "routes/item-detail.tsx"),
] satisfies RouteConfig;
