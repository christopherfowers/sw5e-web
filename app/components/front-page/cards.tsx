/**
 * What one book and one download look like on their shelf.
 *
 * Separate from the shelf because the shelf is the same for both and these are
 * not. A book's title is a `Link` into the router; a download's is a plain
 * anchor carrying `download`, because a PDF this site serves leaves the router
 * entirely and is never handed to a viewer in a tab on this origin. That is
 * the hosting design's decision, not a styling one, and it belongs next to the
 * element that makes it.
 *
 * Both fall back to a monogram plate when there is no artwork. The plate is
 * the same shape as a cover, so a shelf with two of five books unillustrated
 * keeps its rhythm instead of collapsing into a ragged row.
 */

import { Link } from "react-router";

import { AssetImage, MonogramPlate } from "~/components/media";
import type { Book } from "~/content/books";
import { resourcePreview, sourceCover } from "~/content/imagery";
import { type Resource, resourceHref } from "~/content/resources";

export function BookCard({ book, entries }: { book: Book; entries: number }) {
  const cover = sourceCover(book.code);

  return (
    <div className="shelf-book" data-accent={book.accent ?? undefined}>
      {cover ? (
        <AssetImage
          className="shelf-cover"
          image={cover}
          alt={`Cover of ${book.name}`}
          sizes="(max-width: 40rem) 40vw, 12rem"
        />
      ) : (
        <span className="shelf-cover shelf-plate">
          <MonogramPlate name={book.name} />
        </span>
      )}
      <p className="shelf-title">
        <Link to={`/sources/${book.key}`}>{book.name}</Link>
      </p>
      {book.blurb ? <p className="shelf-blurb">{book.blurb}</p> : null}
      <p className="shelf-count">
        {entries.toLocaleString("en-US")} {entries === 1 ? "entry" : "entries"}
      </p>
    </div>
  );
}

export function ResourceCard({ resource }: { resource: Resource }) {
  const preview = resourcePreview(resource.key);

  return (
    <div className="shelf-book" data-accent={resource.accent ?? undefined}>
      {preview ? (
        <AssetImage
          className="shelf-cover"
          image={preview}
          alt={`First page of ${resource.name}`}
          sizes="(max-width: 40rem) 40vw, 12rem"
        />
      ) : (
        <span className="shelf-cover shelf-plate">
          <MonogramPlate name={resource.name} />
        </span>
      )}
      <p className="shelf-title">
        <a href={resourceHref(resource.file)} download>
          {resource.name}
        </a>
      </p>
      {resource.blurb ? <p className="shelf-blurb">{resource.blurb}</p> : null}
      <p className="shelf-count">
        {resource.pages
          ? `${resource.pages} ${resource.pages === 1 ? "page" : "pages"}`
          : "PDF"}
        {resource.fillable ? " · fillable" : null}
      </p>
    </div>
  );
}
