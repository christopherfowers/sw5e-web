/**
 * Translating between the three names one content type has.
 *
 * The service's registry key is singular — `armor-property`, `class` — and is
 * what every authoring address is built from. The route segment is plural —
 * `armor-properties`, `classes` — and is what this site publishes under. The
 * display name is neither. All three come from `GET /api/content-types`, which
 * is why this module takes a fetched list rather than holding one: a fourth
 * copy of the registry, compiled here, would drift the first time a type is
 * added and the symptom would be a type nobody can edit with nothing saying so.
 *
 * The two sets are also not the same size. The service manages thirty-one
 * types; this site browses twenty-seven of them. The four extra are the credit
 * records — the people who made the artwork and the licences it is shown
 * under — which are site metadata rather than game content and have no page of
 * their own. They are editable, and they are the *most* editable: the single
 * most requested correction on this site is an artist's name, and a hundred and
 * fifty pictures are waiting for one. What they do not have is somewhere to
 * link to, which is exactly what {@link publishedPathFor} answers `null` for.
 */

import { isContentTypeId } from "~/content/types";
import type { ContentTypeDescriptor } from "./types";

/** Every type the service manages, indexed by its canonical key. */
export type ContentTypeIndex = ReadonlyMap<string, ContentTypeDescriptor>;

/**
 * Indexes the fetched list by canonical key *and* by route segment.
 *
 * Both, because an address this client is handed does not always come from the
 * authoring API. A content report names its target as `targetType`, and that is
 * documented as "a content type key or route segment" — so a flag filed from
 * `/species/wookiee` says `species` and one filed from a page under a plural
 * segment says the plural. Resolving either means the "correct the thing this
 * report is about" link works whichever the report happens to carry.
 */
export function indexContentTypes(
  types: readonly ContentTypeDescriptor[],
): ContentTypeIndex {
  const index = new Map<string, ContentTypeDescriptor>();

  // Segments first, then keys over the top. The canonical key therefore wins
  // wherever one type's plural segment collides with another type's key.
  // Nothing in the registry does that today; the ordering makes it harmless if
  // something ever does, and the alternative — resolving a name to the wrong
  // type — would edit the wrong document.
  for (const type of types) index.set(type.routeSegment.toLowerCase(), type);
  for (const type of types) index.set(type.key.toLowerCase(), type);

  return index;
}

/** The descriptor for a key or a route segment, or `null` if neither matches. */
export function findContentType(
  index: ContentTypeIndex,
  name: string,
): ContentTypeDescriptor | null {
  return index.get(name.toLowerCase()) ?? null;
}

/**
 * The canonical key to send to the authoring API, given whatever this client
 * was handed.
 *
 * Falls back to the name as given rather than to null. The service resolves
 * both spellings itself and answers 404 for a name it does not know, and a 404
 * naming the type the reader asked for is a better failure than this client
 * refusing to try.
 */
export function canonicalTypeKey(index: ContentTypeIndex, name: string): string {
  return findContentType(index, name)?.key ?? name;
}

/**
 * Where the published version of a document lives on this site, or `null` when
 * this site does not publish that type.
 *
 * Checked against this app's own list of browsable types rather than assuming
 * every registry type has a page. The four credit types do not, and a link to
 * `/asset-credits/species-wookiee` would be a link to the SPA fallback, which
 * answers 404.
 */
export function publishedPathFor(
  type: ContentTypeDescriptor | null,
  key: string,
): string | null {
  if (!type) return null;
  if (!isContentTypeId(type.routeSegment)) return null;
  return `/${type.routeSegment}/${key}`;
}

/** The singular display name, falling back to the raw key. */
export function typeLabel(index: ContentTypeIndex, name: string): string {
  return findContentType(index, name)?.name ?? name;
}
