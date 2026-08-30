import { type RouteConfig, index, route } from "@react-router/dev/routes";

// The two dynamic routes cover all eight content types. Each type still gets
// its own columns, filters and detail shaping — that lives in the per-type
// configuration, not in a duplicated route module.
export default [
  index("routes/home.tsx"),
  route("search", "routes/search.tsx"),
  route(":type", "routes/type-index.tsx"),
  route(":type/:slug", "routes/item-detail.tsx"),
] satisfies RouteConfig;
