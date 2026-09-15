import { Link } from "react-router";

import { AssetImage, MonogramPlate } from "~/components/media";
import { ReportControl } from "~/components/report-control";
import { Breadcrumbs } from "~/components/site-chrome";
import { countsBySource } from "~/content/dataset.server";
import { readingStepsOf } from "~/content/book-contents";
import { sourceCover } from "~/content/imagery";
import { sourceBySlug } from "~/content/source-meta";
import { TYPE_META, TYPE_ORDER } from "~/content/type-meta";
import type { ContentTypeId } from "~/content/types";
import type { Route } from "./+types/source-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not found — Star Wars 5e" }];
  return [
    { title: `${loaderData.source.name} — Star Wars 5e` },
    {
      name: "description",
      content: `${loaderData.total} Star Wars 5e entries from ${loaderData.source.name}. ${loaderData.source.blurb}`,
    },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const source = sourceBySlug(params.slug);
  if (!source) throw new Response("Not Found", { status: 404 });

  const counts = countsBySource(source.code);
  return {
    source,
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    // The same table of contents the rail draws, from the same place, so the
    // two cannot disagree about what is in the book or what order it is in.
    steps: readingStepsOf(source.code),
  };
}

/**
 * Only pre-rendered paths have a data file beside them, so a client-side
 * navigation to a book that does not exist fails the fetch rather than
 * returning a 404. Converting it here makes a mistyped URL read as the
 * missing page it is.
 */
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch {
    throw new Response("Not Found", { status: 404 });
  }
}

export default function SourceDetail({ loaderData }: Route.ComponentProps) {
  const { source, counts, total, steps } = loaderData;
  const cover = sourceCover(source.code);
  const present = TYPE_ORDER.filter((type) => (counts[type] ?? 0) > 0);

  return (
    <div className="page" data-accent={source.accent}>
      <Breadcrumbs
        trail={[{ label: "Sources", to: "/sources" }, { label: source.name }]}
      />

      <div className="source-hero">
        {cover ? (
          <div>
            <AssetImage
              className="source-cover"
              image={cover}
              alt={`Cover of ${source.name}`}
              sizes="(min-width: 46rem) 192px, 60vw"
              loading="eager"
            />
            {/*
              Book covers are the pictures on this site most likely to attract a
              rights complaint, and the ones whose provenance is least
              documented. The attribution record is keyed on the same source
              code the image file is — `sources-phb` — so the report points at
              the record a reviewer edits.
            */}
            <ReportControl
              target={{
                kind: "image",
                type: "asset-credit",
                key: `sources-${source.code.toLowerCase()}`,
                name: source.name,
              }}
              label="Report a problem with this cover"
            />
          </div>
        ) : (
          /*
            Expanded Content is community material and has no cover art
            anywhere in the archive. Rather than an empty frame or a broken
            image, it gets a plate of its own initials in its own colour — the
            same treatment species without a portrait get.
          */
          <span className="source-plate">
            <MonogramPlate name={source.name} />
          </span>
        )}

        <div>
          <p className="page-eyebrow">Source book</p>
          <h1>{source.name}</h1>
          <p className="lede">{source.blurb}</p>
          <p className="home-hero-meta">
            {total.toLocaleString("en-US")} entries in this reference, marked{" "}
            <span className="badge" data-accent={source.accent}>
              {source.code}
            </span>{" "}
            wherever they appear.
          </p>

          {/*
            The book's chapters, which is what a book's page is.

            This was a grid of thirteen cards headed "What it contributes",
            one per content type, reading "Species 30, Classes 10, Features
            825". That is a contents list organised by database table, which is
            nobody's idea of a book, and each card linked to the whole-site
            index for its type rather than to this book's share of it — so
            "Species 30" opened a page of a hundred and forty-one.

            What a reader wants from a book is its chapters, in the order they
            are meant to be read. The rail already carries them for navigation;
            here they are the page, with the headings they are read under.
          */}
          {steps.length > 0 ? (
            <>
              <h2 className="section-heading">Chapters</h2>
              {steps.map((step, index) => (
                <section
                  key={step.group ?? `ungrouped-${index}`}
                  className="path-step"
                  aria-labelledby={`book-step-${index}`}
                >
                  {/*
                    A heading only where the corpus gives one. Two of the books
                    have an authored path; the rest get a plain list rather than
                    a grouping nobody decided on.
                  */}
                  <h3 className="path-step-heading" id={`book-step-${index}`}>
                    {step.group ?? "Chapters"}
                  </h3>
                  <ul className="chapter-list">
                    {step.chapters.map((chapter) => (
                      <li key={`${chapter.type}/${chapter.slug}`}>
                        <Link
                          className="chapter-link"
                          to={`/${chapter.type}/${chapter.slug}`}
                        >
                          <span className="chapter-name">{chapter.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          ) : null}

          {/*
            What else is in the book, as a sentence rather than a wall of
            cards. The counts are worth knowing — a book with 825 features is a
            different proposition from one with none — but they are context for
            the chapters above, not the point of the page.
          */}
          {present.length > 0 ? (
            <p className="source-contains">
              It also contributes{" "}
              {present
                .map(
                  (type: ContentTypeId) =>
                    `${counts[type].toLocaleString("en-US")} ${TYPE_META[type].plural.toLowerCase()}`,
                )
                .join(", ")}
              .
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
