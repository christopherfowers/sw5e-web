/**
 * The content-type registry, fetched once per page load.
 *
 * Every authoring screen needs the same three facts about a content type — its
 * canonical key, its display name, and the segment this site publishes it
 * under — and all three come from one anonymous endpoint whose answer does not
 * change between deploys. Fetching it per screen would make three requests for
 * the same list on a walk from the worklist to the editor to the history, and
 * passing it down through an outlet would make every child wait for a parent's
 * round trip before starting its own.
 *
 * So it is cached at module scope, as the promise rather than the value. That
 * detail is the point: two components mounting in the same tick both get the
 * *same* in-flight request instead of racing to start two.
 *
 * The cache is not invalidated, and does not need to be. A module lives as long
 * as the page, a deploy replaces the page, and a content type added while
 * somebody has a tab open is not a thing that needs to reach them mid-edit.
 */

import { useEffect, useState } from "react";

import { listContentTypes } from "./api";
import { indexContentTypes, type ContentTypeIndex } from "./content-types";

let inFlight: Promise<ContentTypeIndex> | null = null;

function load(): Promise<ContentTypeIndex> {
  inFlight ??= listContentTypes()
    .then((answer) => indexContentTypes(answer.types))
    .catch((error: unknown) => {
      // A failed load must not poison the cache: the next screen to ask should
      // try again rather than inherit an outage from a screen the reader has
      // already left.
      inFlight = null;
      throw error;
    });

  return inFlight;
}

/** Only for tests, which must not inherit one another's fetches. */
export function resetContentTypeCache(): void {
  inFlight = null;
}

export interface ContentTypesState {
  /** `null` until the list has arrived. */
  index: ContentTypeIndex | null;
  /**
   * Whether the list could not be fetched.
   *
   * Not fatal anywhere. Every screen that uses this degrades to showing the raw
   * type key instead of a display name, and the editor sends the key it was
   * given — which the service resolves itself. A registry this client could not
   * read is a worse-looking interface, not a broken one.
   */
  failed: boolean;
}

export function useContentTypes(): ContentTypesState {
  const [state, setState] = useState<ContentTypesState>({ index: null, failed: false });

  useEffect(() => {
    let live = true;

    load().then(
      (index) => {
        if (live) setState({ index, failed: false });
      },
      () => {
        if (live) setState({ index: null, failed: true });
      },
    );

    return () => {
      live = false;
    };
  }, []);

  return state;
}
