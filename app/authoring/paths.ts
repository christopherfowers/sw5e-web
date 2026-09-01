/**
 * The addresses of the three authoring screens.
 *
 * Built here rather than written out at each link, because every one of them
 * puts its subject in the query string and a hand-assembled query string is how
 * a key containing an ampersand — or a type containing a plus — silently
 * addresses the wrong document. `URLSearchParams` escapes; string concatenation
 * does not.
 *
 * See `app/routes/authoring.tsx` for why the subject is in the query string at
 * all rather than in the path: there is no runtime server, so a path is either
 * a file the build wrote or a 404, and this feature has to address documents
 * that do not exist yet.
 */

export const AUTHORING_ROOT = "/authoring";

/**
 * The editor for one document. Omit `key` for something that does not exist
 * yet; pass `flagId` when the edit is answering a report, which is what ties
 * the two together so that publishing closes the report.
 */
export function editorPath(
  type: string,
  key?: string | null,
  flagId?: string | null,
): string {
  const query = new URLSearchParams({ type });
  if (key) query.set("key", key);
  if (flagId) query.set("flag", flagId);
  return `${AUTHORING_ROOT}/edit?${query.toString()}`;
}

/** The revision history of one document. */
export function historyPath(type: string, key: string): string {
  return `${AUTHORING_ROOT}/history?${new URLSearchParams({ type, key }).toString()}`;
}
