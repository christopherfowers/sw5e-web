/**
 * Renders text that came from the legacy archive.
 *
 * The 2022 scrape left U+FFFD replacement characters scattered through the
 * corpus. The dataset builder repairs the ones whose original character is
 * deducible and deliberately leaves the ambiguous ones alone rather than
 * inventing letters inside proper nouns. Those survivors must never reach the
 * screen as a bare glyph: a reader would read it as game content. Here they
 * become a marked, explained gap instead.
 */

import { Fragment } from "react";

const REPLACEMENT = "�";

export function SourceText({ value }: { value: string }) {
  if (!value.includes(REPLACEMENT)) return value;

  const parts = value.split(REPLACEMENT);
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <LostCharacter /> : null}
    </Fragment>
  ));
}

/** A single character the source data lost. */
function LostCharacter() {
  return (
    <span
      className="lost-character"
      title="One character here was lost when this text was scraped in 2022."
    >
      <span className="sr-only"> (one character lost from the source) </span>
      <span aria-hidden="true">&middot;</span>
    </span>
  );
}

/**
 * A whole field the source data lost. In the archive these are creature
 * `Languages` and `Senses` lines that hold nothing but a replacement
 * character, so the original content is gone entirely. Showing the label with
 * an explicit gap is honest; omitting the line would imply the creature has
 * no languages, which is a guess.
 */
export function LostValue() {
  return (
    <span
      className="lost-value"
      title="This line was destroyed when the source data was scraped in 2022."
    >
      not recorded
      <span className="sr-only"> — this line was lost from the source data</span>
    </span>
  );
}
