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
  route("search", "routes/search.tsx"),
  route("sources", "routes/sources.tsx"),
  route("sources/:slug", "routes/source-detail.tsx"),

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
  ]),

  route(":type", "routes/type-index.tsx"),
  route(":type/:slug", "routes/item-detail.tsx"),
] satisfies RouteConfig;
