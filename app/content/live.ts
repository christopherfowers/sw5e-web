/**
 * Reading a page from the API instead of from the build.
 *
 * ## The problem this exists for
 *
 * Every content route is rendered to HTML when the site is built. That was
 * right when content only arrived as a reviewed pull request, followed by a
 * deploy anyway. Then the site grew a CMS, and the two ideas contradict each
 * other: a static page is frozen, and a CMS changes content whenever an author
 * says so. Nobody reconciled them, so there were two copies of every rule, the
 * one an administrator edited and the one a reader was served, with nothing
 * connecting them.
 *
 * Somebody published a correction to a class and it sat unseen for a week. He
 * published it three times, reasonably concluding the tool was broken.
 *
 * ## How this closes it
 *
 * The prerendered file is still what appears first, so pages open instantly and
 * still work with JavaScript off. Then this asks the API for the page as it
 * stands now and swaps it in.
 *
 * The transform is not reimplemented here. `transform/canonical.mjs` is the
 * same file the build imports, so a page assembled in a browser goes through
 * the same two thousand lines as one assembled by CI. Two implementations of
 * one rendering would drift, and the drift would be invisible: a reader would
 * see a page subtly unlike the one the tests built.
 *
 * ## What is still read from the build, and why that is safe
 *
 * Anchor and equipment link targets come from the shipped dataset rather than
 * the API. They are name to slug lookups used to turn a mention in prose into a
 * link, and being a build behind means a power added yesterday is not yet
 * linkable from another page's prose. That is a much smaller problem than stale
 * rules text, and fixing it costs a second request on every page view to
 * resolve links that almost never change.
 */

import {
  buildClassGraph,
  CANONICAL_DIRECTORIES,
  indexSources,
  normalizeAllCanonical,
  type ContentGraph,
} from "~/content/transform/canonical.mjs";
import type { ContentItem } from "~/content/types";

/** One document as the content API returns it. */
interface ApiDocument {
  type: string;
  key: string;
  name: string;
  data: unknown;
}

interface ApiPage {
  item: ApiDocument;
  related: Record<string, ApiDocument[]>;
}

/** The content type key the API addresses a site type by. */
export function contentTypeKey(typeId: string): string | null {
  return CANONICAL_DIRECTORIES[typeId] ?? null;
}

/**
 * The page for one document, as it stands in the database right now.
 *
 * Returns null when the API cannot answer, which is not an error worth showing
 * anybody: the prerendered page is already on screen and is a build old at
 * worst. A reader who is offline, or behind something that ate the request,
 * keeps reading rather than being handed a failure for a refresh they never
 * asked for.
 */
export async function fetchLivePage(
  typeId: string,
  slug: string,
  signal?: AbortSignal,
): Promise<ContentItem | null> {
  const type = contentTypeKey(typeId);
  if (!type) return null;

  try {
    const response = await fetch(
      `/api/content/${encodeURIComponent(type)}/${encodeURIComponent(slug)}/page`,
      { signal, headers: { accept: "application/json" } },
    );

    if (!response.ok) return null;

    return assemble(typeId, (await response.json()) as ApiPage);
  } catch {
    // Including the abort, which is the ordinary case on a fast navigation.
    return null;
  }
}

/**
 * Turns an API bundle into the shape a page component renders.
 *
 * Exported for the test that renders the same document both ways and compares,
 * which is the guard that keeps one transform from quietly becoming two.
 */
export function assemble(typeId: string, page: ApiPage): ContentItem | null {
  /*
    A type the transform has no rules for returns null rather than throwing.

    This runs inside a render, over a response from the network, so a throw
    here replaces a perfectly good prerendered page with an error boundary. A
    reader would lose the page they were reading because the site asked
    whether it had changed. Nothing is worth that: the answer when we cannot
    assemble is to keep what is already on screen.
  */
  if (!CANONICAL_DIRECTORIES[typeId]) return null;

  const related = page.related ?? {};
  const records = (key: string) => (related[key] ?? []).map((one) => one.data);

  /*
    The graph is built from one hop rather than from the catalogue.

    At build time this is every class, archetype and feature there is. Here it
    is only what the page asks about, which is the same answer for the
    questions the page asks: a class page wants the features that class grants,
    and those are exactly the documents pointing at it.
  */
  const graph: ContentGraph = buildClassGraph({
    classes: [...records("class"), ...(typeId === "classes" ? [page.item.data] : [])],
    classImprovements: records("class-improvement"),
    archetypes: [...records("archetype"), ...(typeId === "archetypes" ? [page.item.data] : [])],
    features: records("feature"),
    equipment: records("equipment"),
    powers: records("power"),
    referenceTables: records("reference-table"),
  });

  const sources = indexSources(records("source"));

  const normalized = normalizeAllCanonical(typeId, [page.item.data], sources, graph);

  return (normalized[0] as ContentItem | undefined) ?? null;
}
