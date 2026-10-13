/**
 * The published version of the document on screen.
 *
 * Gives back what the loader provided, then replaces it with what the API
 * holds once that arrives. A page therefore paints immediately from its
 * prerendered file and corrects itself, rather than showing a reader a spinner
 * while it asks whether anything changed.
 *
 * ## Why it never reports a failure
 *
 * There is already a complete, readable page on screen. If the request fails,
 * or the reader is offline, or something between them ate it, the honest
 * outcome is that they carry on reading a page that is at worst one build
 * old. Surfacing an error would be interrupting somebody to tell them about a
 * refresh they did not ask for and cannot act on.
 *
 * ## Why there is no flash
 *
 * The replacement happens only when the assembled document differs from what
 * was rendered. On the overwhelming majority of pages nothing has been
 * published since the last build, the comparison fails, and React is handed
 * the object it already has.
 */

import { useEffect, useState } from "react";

import { fetchLivePage } from "~/content/live";
import type { ContentItem } from "~/content/types";

export function useLiveItem(
  typeId: string,
  slug: string,
  rendered: ContentItem,
): ContentItem {
  /*
    Stamped with the document it belongs to, rather than cleared on
    navigation.

    Clearing meant a setState in the effect body on every navigation, which
    costs a second render of a page that had only just painted. Carrying the
    address makes a stale answer simply not match, which needs no render at
    all: the previous document's reply cannot be shown over the next
    document's markup because it is not addressed to it.
  */
  const [live, setLive] = useState<{ address: string; item: ContentItem } | null>(
    null,
  );

  const address = `${typeId}/${slug}`;

  useEffect(() => {
    const abort = new AbortController();

    fetchLivePage(typeId, slug, abort.signal).then((fresh) => {
      if (abort.signal.aborted || !fresh) return;
      setLive({ address: `${typeId}/${slug}`, item: fresh });
    });

    return () => abort.abort();
  }, [typeId, slug]);

  if (!live || live.address !== address) return rendered;

  return same(live.item, rendered) ? rendered : live.item;
}

/*
  Compared by serialising both.

  A field-by-field comparison would have to know the shape of twenty-seven
  content types and would quietly stop noticing whichever field was added last.
  These documents are a few kilobytes and this runs once per page view.
*/
function same(left: ContentItem, right: ContentItem): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
