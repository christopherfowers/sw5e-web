/**
 * The front page, edited as the front page.
 *
 * ## Why this is not a form
 *
 * It used to be one, and a form was the wrong shape for the job. The page
 * document holds eight slots called things like `booksLede`, and a stack of
 * labelled text boxes tells an author nothing about where any of them lands or
 * what sits under it. Worse, the arrangement was not editable here at all: the
 * order of the books lives on each book's own document, so rearranging the
 * shelf meant opening five documents and renumbering them by hand, with
 * nothing anywhere showing the shelf as a shelf.
 *
 * So this draws the page. The same components, the same classes, the same
 * layout, with the text swapped for editors and the lists made sortable. It is
 * not a preview and not a copy: `app/components/front-page/` is imported by
 * both this and `app/routes/home.tsx`, so the editor cannot drift from the
 * thing it edits.
 *
 * ## What it writes, and what it cannot promise
 *
 * Four kinds of document: the page's own words, and the `order` and
 * `showOnHomePage` of every book, download and link that moved. There is no
 * transaction across documents and the service offers none, so this writes
 * only what changed, one at a time, and says plainly which ones landed when
 * any of them fail. A screen that looks like direct manipulation owes the
 * author that much.
 *
 * ## The delay is real, so the page says so
 *
 * Every content route is rendered to HTML at build time. A saved draft has to
 * be published and the site rebuilt before a reader sees any of it, which is a
 * longer wait than dragging a book across a shelf implies.
 */

import { useCallback, useEffect, useState } from "react";

import { RequireSession } from "~/auth/guard";
import { getDraft, getPublishedDocument, saveDraft } from "~/authoring/api";
import { BookCard, ResourceCard } from "~/components/front-page/cards";
import type { Arrangeable, ListEditing } from "~/components/front-page/editable";
import { Hero } from "~/components/front-page/hero";
import { Shelf } from "~/components/front-page/shelf";
import { Touch, type TouchChannel, type TouchGroup } from "~/components/front-page/touch";
import { BOOKS, bookBySlug } from "~/content/books";
import {
  CHANNEL_GROUPS,
  CHANNELS,
  channelLabel,
  groupHeading,
  type ChannelGroup,
} from "~/content/channels";
import { brandImage } from "~/content/imagery";
import { RESOURCES } from "~/content/resources";
import { TYPE_ORDER } from "~/content/type-meta";

/* -------------------------------------------------------------------- state */

/** A row of one of the three lists, with the two fields this screen may change. */
interface Placed extends Arrangeable {
  order: number | null;
  showOnHomePage: boolean;
}

type Copy = Record<string, string>;

interface Arrangement {
  copy: Copy;
  books: Placed[];
  resources: Placed[];
  channels: Placed[];
}

/** What has been touched, so saving writes nothing it did not have to. */
interface Dirty {
  page: boolean;
  documents: ReadonlySet<string>;
}

const NOTHING_DIRTY: Dirty = { page: false, documents: new Set<string>() };

export default function AuthoringFrontPage() {
  return <RequireSession role="Contributor">{() => <Editor />}</RequireSession>;
}

function Editor() {
  const [state, setState] = useState<Arrangement | null>(null);
  const [dirty, setDirty] = useState<Dirty>(NOTHING_DIRTY);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<SaveReport | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    read(abort.signal).then(
      (arrangement) => setState(arrangement),
      (error: unknown) => {
        if (abort.signal.aborted) return;
        setLoadFailure(
          error instanceof Error ? error.message : "Could not read the front page.",
        );
      },
    );
    return () => abort.abort();
  }, []);

  const touchDocument = useCallback((id: string) => {
    setDirty((was) => ({ ...was, documents: new Set(was.documents).add(id) }));
  }, []);

  if (loadFailure) {
    return (
      <p className="auth-error" role="alert">
        {loadFailure}
      </p>
    );
  }

  if (!state) {
    return <p className="auth-note">Reading the front page&hellip;</p>;
  }

  function editCopy(field: string) {
    return (next: string) => {
      setDirty((was) => ({ ...was, page: true }));
      setState((was) => (was ? { ...was, copy: { ...was.copy, [field]: next } } : was));
    };
  }

  /*
    Reorder, remove and add are the same three writes on all three lists, so
    they are built once and handed to each section.

    Reordering renumbers the shown rows from one rather than shuffling whatever
    numbers happen to be there. A shelf whose orders read 1, 4, 5 is one
    somebody will later have to reason about, and there is nothing to be gained
    by keeping the gaps.
  */
  function listEditing(
    noun: string,
    type: string,
    rows: Placed[],
    replace: (next: Placed[]) => void,
  ): ListEditing<Placed> {
    const shown = rows.filter((row) => row.showOnHomePage);

    return {
      noun,
      available: rows.filter((row) => !row.showOnHomePage).slice().sort(byName),
      onReorder(keys) {
        const position = new Map(keys.map((key, index) => [key, index + 1]));
        for (const row of shown) {
          const next = position.get(row.key);
          if (next !== undefined && next !== row.order) {
            touchDocument(`${type}/${row.key}`);
          }
        }
        replace(
          rows.map((row) => {
            const next = position.get(row.key);
            return next === undefined ? row : { ...row, order: next };
          }),
        );
      },
      onRemove(key) {
        touchDocument(`${type}/${key}`);
        replace(
          rows.map((row) =>
            row.key === key ? { ...row, showOnHomePage: false } : row,
          ),
        );
      },
      onAdd(key) {
        touchDocument(`${type}/${key}`);
        replace(
          rows.map((row) =>
            row.key === key
              ? { ...row, showOnHomePage: true, order: shown.length + 1 }
              : row,
          ),
        );
      },
    };
  }

  const books = state.books.filter((row) => row.showOnHomePage).sort(byOrder);
  const resources = state.resources.filter((row) => row.showOnHomePage).sort(byOrder);

  const groups: TouchGroup[] = CHANNEL_GROUPS.map((id) => ({
    heading: groupHeading(id),
    blurb: null,
    channels: state.channels
      .filter((row) => row.showOnHomePage && groupOf(row.key) === id)
      .sort(byOrder)
      .map((row) => asTouchChannel(row)),
  })).filter((group) => group.channels.length > 0);

  const changes = dirty.documents.size + (dirty.page ? 1 : 0);

  async function onSave() {
    setSaving(true);
    setReport(null);
    const outcome = await write(state!, dirty);
    setReport(outcome);
    if (outcome.failed.length === 0) setDirty(NOTHING_DIRTY);
    setSaving(false);
  }

  return (
    <div className="fp-editor">
      <div className="fp-editor-bar">
        <div>
          <h1 className="fp-editor-title">The front page</h1>
          <p className="fp-editor-note">
            This is the page itself rather than a preview of it. What you change
            here is saved as drafts, and reaches readers once those are
            published and the site is rebuilt.
          </p>
        </div>
        <button
          type="button"
          className="button button-primary"
          disabled={saving || changes === 0}
          onClick={onSave}
        >
          {saving
            ? "Saving…"
            : changes === 0
              ? "Nothing changed"
              : `Save ${changes} ${changes === 1 ? "change" : "changes"}`}
        </button>
      </div>

      {report ? <SaveNotice report={report} /> : null}

      <div className="page-home fp-editor-canvas">
        {/*
          `start` and `total` are null and zero here on purpose. One is the
          chapter the handbook opens on and the other counts the whole corpus,
          and both come from a loader this screen does not have. Neither is
          editable, so the editor draws the furniture around them rather than
          fetching several megabytes to put a number in a sentence nobody can
          change.
        */}
        <Hero
          light={brandImage("hero-light")}
          dark={brandImage("hero-dark")}
          lede={state.copy.heroLede ?? null}
          start={null}
          total={0}
          categories={TYPE_ORDER.length}
          editing={{ onLedeChange: editCopy("heroLede") }}
        />

        <div className="home-section">
          <Shelf
            id="the-books"
            heading={state.copy.booksHeading ?? null}
            headingFallback="The rulebooks"
            lede={state.copy.booksLede ?? null}
            ledeFallback={`Everything in this reference comes from one of these ${books.length} books.`}
            items={books}
            editing={{
              ...listEditing("a book", "source", state.books, (next) =>
                setState((was) => (was ? { ...was, books: next } : was)),
              ),
              onHeadingChange: editCopy("booksHeading"),
              onLedeChange: editCopy("booksLede"),
            }}
          >
            {(row) => <BookCardFor slug={row.key} name={row.name} />}
          </Shelf>

          <Shelf
            id="the-resources"
            heading={state.copy.resourcesHeading ?? null}
            headingFallback="Sheets and downloads"
            lede={state.copy.resourcesLede ?? null}
            ledeFallback="Print them, or fill them in on screen. Hosted here rather than on somebody's drive."
            items={resources}
            editing={{
              ...listEditing("a download", "resource", state.resources, (next) =>
                setState((was) => (was ? { ...was, resources: next } : was)),
              ),
              onHeadingChange: editCopy("resourcesHeading"),
              onLedeChange: editCopy("resourcesLede"),
            }}
          >
            {(row) => <ResourceCardFor key_={row.key} />}
          </Shelf>

          <Touch
            heading={state.copy.touchHeading ?? null}
            lede={state.copy.touchLede ?? null}
            ledeFallback="Star Wars 5e is made and maintained in the open. These are the places it happens."
            groups={groups}
            editing={{
              onHeadingChange: editCopy("touchHeading"),
              onLedeChange: editCopy("touchLede"),
              /*
                Links are arranged within their column and never across
                columns. A column is not a setting: it is where its links say
                they are, which is why a group nothing is filed under draws
                nothing rather than drawing empty.
              */
              forGroup: (heading) =>
                listEditing(
                  "a link",
                  "channel",
                  state.channels.filter(
                    (row) => groupHeading(groupOf(row.key)) === heading,
                  ),
                  (next) =>
                    setState((was) =>
                      was
                        ? {
                            ...was,
                            channels: was.channels.map(
                              (row) =>
                                next.find((other) => other.key === row.key) ?? row,
                            ),
                          }
                        : was,
                    ),
                ) as unknown as ListEditing<TouchChannel>,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- cards */

/*
  The cards want a whole `Book` and a whole `Resource`, which the corpus
  already holds. This screen's rows carry only what it may change, so the rest
  is looked up rather than threaded through state nobody is editing.
*/
function BookCardFor({ slug, name }: { slug: string; name: string }) {
  const book = bookBySlug(slug);
  return book ? <BookCard book={book} entries={0} /> : <p className="shelf-title">{name}</p>;
}

function ResourceCardFor({ key_ }: { key_: string }) {
  const resource = RESOURCES.find((one) => one.key === key_);
  return resource ? <ResourceCard resource={resource} /> : null;
}

/* ------------------------------------------------------------------ saving */

interface SaveReport {
  saved: string[];
  failed: { id: string; reason: string }[];
}

/**
 * Writes every touched document, one at a time, reporting each outcome.
 *
 * Sequential rather than concurrent on purpose. These are a handful of very
 * small writes, so there is nothing to win from parallelism, and a failure
 * partway through a concurrent batch leaves a set of outcomes nobody can
 * describe afterwards. One at a time means the report is a list in the order
 * they were tried.
 *
 * Each document is re-read before it is written because `saveDraft` takes the
 * whole document rather than a patch. Sending only the two fields this screen
 * owns would delete every other field the document has.
 */
async function write(state: Arrangement, dirty: Dirty): Promise<SaveReport> {
  const report: SaveReport = { saved: [], failed: [] };

  if (dirty.page) {
    await attempt(report, "pages/home", () =>
      saveDraft("pages", "home", {
        document: { key: "home", ...withoutBlanks(state.copy) },
      }),
    );
  }

  for (const id of dirty.documents) {
    const slash = id.indexOf("/");
    const type = id.slice(0, slash);
    const key = id.slice(slash + 1);
    const row = rowFor(state, type, key);
    if (!row) continue;

    await attempt(report, id, async () => {
      const current = await currentDocument(type, key);
      await saveDraft(type, key, {
        document: { ...current, order: row.order, showOnHomePage: row.showOnHomePage },
      });
    });
  }

  return report;
}

async function attempt(
  report: SaveReport,
  id: string,
  writeOne: () => Promise<void>,
): Promise<void> {
  try {
    await writeOne();
    report.saved.push(id);
  } catch (error) {
    report.failed.push({
      id,
      reason: error instanceof Error ? error.message : "The service refused it.",
    });
  }
}

function SaveNotice({ report }: { report: SaveReport }) {
  if (report.failed.length === 0) {
    return (
      <p className="auth-notice" role="status">
        Saved {report.saved.length} {report.saved.length === 1 ? "draft" : "drafts"}.
        Publish them to put this in front of readers.
      </p>
    );
  }

  return (
    <div className="auth-error" role="alert">
      <p>
        {report.saved.length} saved, {report.failed.length} refused. The front
        page is arranged out of separate documents and there is no way to write
        them together, so what saved is saved and the rest is unchanged.
      </p>
      <ul>
        {report.failed.map((failure) => (
          <li key={failure.id}>
            <code>{failure.id}</code>: {failure.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- reading */

async function read(signal: AbortSignal): Promise<Arrangement> {
  const [copy, books, resources, channels] = await Promise.all([
    currentDocument("pages", "home", signal),
    placements(
      "source",
      BOOKS.map((book) => ({ key: book.key, name: book.name })),
      signal,
    ),
    placements(
      "resource",
      RESOURCES.map((resource) => ({ key: resource.key, name: resource.name })),
      signal,
    ),
    placements(
      "channel",
      CHANNELS.map((channel) => ({
        key: channel.key,
        name: channelLabel(channel.platform),
      })),
      signal,
    ),
  ]);

  return { copy: (copy ?? {}) as Copy, books, resources, channels };
}

function placements(
  type: string,
  rows: Arrangeable[],
  signal: AbortSignal,
): Promise<Placed[]> {
  return Promise.all(
    rows.map(async (row) => {
      const document = await currentDocument(type, row.key, signal);
      return {
        ...row,
        order: typeof document?.order === "number" ? document.order : null,
        showOnHomePage: document?.showOnHomePage !== false,
      };
    }),
  );
}

/**
 * A document as it currently stands, reading a draft ahead of what is
 * published.
 *
 * The draft first, because an author who arranged the shelf yesterday and
 * comes back today has to see yesterday's arrangement rather than the deployed
 * one. Their own unpublished work missing from the screen is indistinguishable
 * from it having been lost.
 */
async function currentDocument(
  type: string,
  key: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const draft = (await getDraft(type, key, signal))?.document;
  if (draft) return draft as Record<string, unknown>;
  return (await getPublishedDocument(type, key, signal)) as Record<
    string,
    unknown
  > | null;
}

/* ----------------------------------------------------------------- helpers */

function byOrder(left: Placed, right: Placed): number {
  if (left.order != null && right.order != null) return left.order - right.order;
  if (left.order != null) return -1;
  if (right.order != null) return 1;
  return byName(left, right);
}

function byName(left: Arrangeable, right: Arrangeable): number {
  return left.name.localeCompare(right.name);
}

function groupOf(key: string): ChannelGroup {
  return CHANNELS.find((channel) => channel.key === key)?.group ?? "connect";
}

function asTouchChannel(row: Placed): TouchChannel {
  const channel = CHANNELS.find((one) => one.key === row.key);
  return {
    key: row.key,
    name: row.name,
    platform: channel?.platform ?? "discord",
    label: row.name,
    url: channel?.url ?? "#",
  };
}

function withoutBlanks(copy: Copy): Copy {
  return Object.fromEntries(
    Object.entries(copy).filter(([, value]) => value.trim() !== ""),
  );
}

function rowFor(state: Arrangement, type: string, key: string): Placed | undefined {
  const rows =
    type === "source"
      ? state.books
      : type === "resource"
        ? state.resources
        : state.channels;
  return rows.find((row) => row.key === key);
}
