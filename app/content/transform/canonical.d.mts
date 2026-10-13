/**
 * Types for the transform the build and the browser both run.
 *
 * ## Why the module itself is still JavaScript
 *
 * `canonical.mjs` turns a schema document into the shape a page renders. It
 * used to run only at build time, in Node, which is why it is plain JavaScript
 * and why it lives behind a declaration file rather than having been rewritten
 * in TypeScript.
 *
 * Rewriting it was the obvious thing and would have been the wrong one. It is
 * two thousand lines of per-type rules with a hundred and twenty one tests
 * against them, and a rewrite that is ninety nine percent faithful produces a
 * site that renders almost correctly, in ways nobody finds for months. A
 * declaration file is honest about what is checked and what is not: the shape
 * of the boundary, here, and the behaviour by its own tests.
 *
 * ## What is actually declared
 *
 * Only what the app calls. The build imports more, and keeps getting it
 * unchecked, which is no worse than it was.
 */

/** A source book, as the transform wants to look one up. */
export interface SourceIndexEntry {
  abbreviation: string;
  title: string | null;
  shelfName: string | null;
  blurb: string | null;
}

/**
 * The cross-document questions a transform asks while rendering one page.
 *
 * Built by {@link buildClassGraph} over whatever records it is given. At build
 * time that is the whole catalogue; in a browser it is the documents one edge
 * away, which is what the answers below actually need.
 */
export interface ContentGraph {
  classSlugs: Map<string, string>;
  powerSlugs: Set<string>;
  anchorRoute: (slug: string) => string | null;
  grantedBy: (kind: string, name: string) => unknown[];
  branchesOf: (className: string) => { archetypes: unknown[]; improvements: unknown[] };
  equipmentRoute: (name: string | null) => string | null;
}

export interface ClassGraphInput {
  classes?: unknown[];
  classImprovements?: unknown[];
  archetypes?: unknown[];
  features?: unknown[];
  equipment?: unknown[];
  powers?: unknown[];
  referenceTables?: unknown[];
}

export function buildClassGraph(input: ClassGraphInput): ContentGraph;

/** Source documents, keyed for lookup by `sourceKey`. */
export function indexSources(records: unknown[]): Map<string, SourceIndexEntry>;

/**
 * Raw documents of one type, as the site renders them.
 *
 * `typeId` is the site's own id (`classes`), not the content type key
 * (`class`); {@link CANONICAL_DIRECTORIES} maps between them.
 *
 * Returns `unknown[]` rather than `ContentItem[]` on purpose. Claiming the
 * richer type here would be asserting a correspondence nothing checks, and the
 * one place that needs it casts at the boundary where that is visible.
 */
export function normalizeAllCanonical(
  typeId: string,
  records: unknown[],
  sources: Map<string, SourceIndexEntry>,
  graph?: ContentGraph,
): unknown[];

/** Site type id to the content type key the API addresses documents by. */
export const CANONICAL_DIRECTORIES: Record<string, string>;
