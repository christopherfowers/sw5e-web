import { type RouteConfig, index, route } from "@react-router/dev/routes";

// The two dynamic content routes cover all eight content types. Each type
// still gets its own columns, filters and detail shaping — that lives in the
// per-type configuration, not in a duplicated route module.
//
// The static segments are declared before `:type` for readability; React
// Router ranks a static segment above a dynamic one regardless of order, so
// `/sources` reaches the source pages rather than being read as a ninth
// content type.
export default [
  index("routes/home.tsx"),
  route("search", "routes/search.tsx"),
  route("sources", "routes/sources.tsx"),
  route("sources/:slug", "routes/source-detail.tsx"),
  route(":type", "routes/type-index.tsx"),
  route(":type/:slug", "routes/item-detail.tsx"),
] satisfies RouteConfig;
