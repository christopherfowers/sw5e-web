/**
 * Turning a human label into something addressable.
 *
 * There were two of these, four hundred lines apart, and they disagreed: one
 * trimmed the dashes off the ends and one did not, so a heading called
 * "Actions!" became `actions-` in one place and `actions` in the other. Both
 * were only ever used for `aria-labelledby`, where a trailing dash is merely
 * ugly — but headings in the rules text are about to become addresses people
 * paste to each other, and an address with a stray dash on the end is one
 * somebody will eventually retype without it.
 */

/**
 * A label as a slug: lowercase, non-alphanumerics collapsed to single dashes,
 * no dash at either end.
 *
 * Deliberately ASCII-only. The corpus is English, the output goes in URLs and
 * `id` attributes, and a transliteration table for text that does not contain
 * any is a table that can only be wrong.
 */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A slugger that will not hand out the same slug twice.
 *
 * One per document. A rules chapter has forty-four headings and several of
 * them are called "Variant" or "Example"; without this they would all claim
 * the same `id`, every link to any of them would land on the first, and
 * `aria-labelledby` on the rest would point at the wrong section. Duplicates
 * are suffixed by their order of appearance, which is stable as long as the
 * document is — the same text produces the same ids on every build, which is
 * what makes the links worth pasting.
 *
 * A label with nothing addressable in it — punctuation only, or empty — gets
 * `section` rather than an empty id, because an empty `id` is not addressable
 * and duplicate empty ones are invalid.
 */
export function uniqueSlugger(): (label: string) => string {
  const used = new Map<string, number>();

  return (label: string) => {
    const base = slugify(label) || "section";
    const seen = used.get(base) ?? 0;

    used.set(base, seen + 1);

    return seen === 0 ? base : `${base}-${seen + 1}`;
  };
}
