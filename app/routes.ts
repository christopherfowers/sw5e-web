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
    // status line. The account being managed is a query parameter on a static
    // path instead, exactly as the authoring routes below carry the document
    // being edited. See `app/routes/account-people.tsx`.
    //
    // `people/manage` is a child of `people` rather than a sibling, and that is
    // load-bearing rather than tidy: React Router keeps a parent route's
    // component mounted while a child renders, so the directory's search term
    // and filters survive the trip into one account and back out. They have
    // nowhere else to survive — the term is somebody's email address, so it may
    // not go in the URL, in history state or in storage.
    route("people", "routes/account-people.tsx", [
      route("manage", "routes/account-people-manage.tsx"),
    ]),
    route("audit", "routes/account-audit.tsx"),
  ]),

  // The authoring workspace. A static segment like the account routes, and
  // ranked above `:type` for the same reason — `/authoring` cannot be mistaken
  // for a content type. Three addresses, and the subject of the edit travels in
  // the query string rather than the path: there is no runtime server here, so
  // a path segment would need a prerendered file per document and could not
  // address a document that does not exist yet. See `app/routes/authoring.tsx`.
  route("authoring", "routes/authoring.tsx", [
    index("routes/authoring-worklist.tsx"),
    route("edit", "routes/authoring-edit.tsx"),
    route("history", "routes/authoring-history.tsx"),
  ]),

  route(":type", "routes/type-index.tsx"),
  route(":type/:slug", "routes/item-detail.tsx"),
] satisfies RouteConfig;
