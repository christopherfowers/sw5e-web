/**
 * Repairs the encoding damage baked into the legacy SW5e archive.
 *
 * The archive was scraped from PDFs in 2022 with a broken decoder, so every
 * character outside the scraper's code page was written out as U+FFFD
 * REPLACEMENT CHARACTER. The original character is not recoverable from the
 * bytes, only from context, so each rule below has to earn its place: it must
 * describe a shape that only one plausible character could have produced.
 *
 * Where context cannot settle it, the answer is not a guess and it is not
 * U+FFFD either: it is a lookup, read out of the document the chapter is
 * printed from and recorded with that source named. `NAMES_FROM_SOURCE` is
 * the one such table, and it exists because no shape can tell you which vowel
 * stood in `H<?>sk`. Guessing a letter inside a proper noun would silently
 * invent game content; looking it up does not.
 *
 * `containsUnrepairedLoss` stays, so the UI can mark anything these rules do
 * not reach as a visible, labelled absence rather than a broken glyph.
 *
 * These rules also exist a second time, in C#, as `LegacyText` in the
 * sw5e-database repository. That is not accidental duplication and neither
 * copy is waiting to be extracted into a shared library: this one repairs the
 * archive as the site builds a dataset straight from it, and that one repairs
 * the archive once, at import time, so the canonical content set is already
 * clean and nothing reading it has to know the corruption existed. The two are
 * kept in step by hand, and both carry this note.
 */

export const REPLACEMENT = "�";

/**
 * Contraction and possessive suffixes. A replacement character wedged between
 * a letter and one of these, with a word boundary after it, can only have been
 * an apostrophe: `can<?>t`, `the tank<?>s effects`, `I<?>m`, `you<?>re`.
 * The trailing word boundary is what makes this safe: it stops the rule from
 * firing on a dash that happens to precede a word starting with the same
 * letter, as in `strength<?>something`.
 */
const CONTRACTION = /(?<=\p{L})�(?=(?:t|s|d|m|re|ve|ll)\b)/gu;

/**
 * A balanced pair of replacement characters, opening after whitespace and
 * closing before whitespace or punctuation, with non-space content between
 * them: `a <?>tell<?> that`, `the proverb <?>unity is strength<?>.` Only a
 * quotation mark pairs like that. The length cap keeps the pairing local, so
 * two unrelated dashes far apart cannot be mistaken for a quotation.
 *
 * The closing context includes `|` because the corpus quotes inside pipe
 * tables — a background's personality-trait table is one quoted line per row —
 * and a quotation that ends a cell closes against the cell boundary rather
 * than against a space.
 */
const QUOTE_PAIR =
  /(^|[\s([])�(?=\S)([^�\n]{0,80}?)(?<=\S)�(?=[\s.,;:!?)\]|]|$)/gmu;

/**
 * A replacement character that is the entire content of a markdown table cell.
 * Only an em dash sets a cell to "none" in these tables, and the rules corpus
 * is full of them: the starting-wealth table, the armour tables' stealth
 * column, the tool-proficiency table's uses column, and the enhanced-item
 * distribution tables where every zero is printed as a dash.
 *
 * The cell boundaries are lookaround rather than consumed, so a run of empty
 * cells — `|1-4|6|3|<?>|<?>|<?>|<?>|9|` — repairs every one of them rather
 * than every other one.
 */
const TABLE_CELL_DASH = /(?<=\|)([ \t]*)�([ \t]*)(?=\|)/g;

/**
 * A capital letter doubled at the start of a line and followed by lower case:
 * `DDestiny plays a large role`, `WWhen you cast a power`.
 *
 * These are drop caps. The source books open a section with a large decorative
 * initial, and the scraper read it both as the decoration and as the first
 * letter of the paragraph, so the letter came out twice. The shape is safe to
 * collapse because no English word begins with a doubled capital followed by
 * lower case, and the corpus bears that out: the rule matches eight places in
 * the whole archive and every one of them is a drop cap. Anchoring to the
 * start of a line keeps it away from the middle of a sentence, where a doubled
 * capital is more likely an abbreviation or an alien name.
 */
const DOUBLED_INITIAL = /(?<=^|\n)([A-Z])\1(?=[a-z])/g;

/**
 * A replacement character standing alone after a space: a spaced em dash.
 * Stat blocks write `Languages —` to mean "none", which is why the form that
 * ends a line matters as much as the one between two words.
 */
const SPACED_DASH = /(?<= )�(?=\s|$)/gu;

/**
 * A replacement character welded to the word before it, as in
 * `generation<?>for example` or `cost many lives<?> and I would`. Every one of
 * these is an em dash.
 *
 * What follows the dash is left exactly as the archive has it, because the
 * source books are not consistent and both forms are deliberate. The Player's
 * Handbook and the Expanded Content chapters set a space after the dash and
 * none before it — `I can't help it— I'm a perfectionist.`, `whatever
 * services you can afford— paying for food` — while Wretched Hives sets the
 * pair closed: `insignia—the Kyr'bes—features`. Normalising either way would
 * be an editorial change dressed up as a repair, so the rule inserts the
 * character and nothing else.
 *
 * The left-hand guard is what keeps this off proper nouns: two non-space
 * characters have to precede the dash, which excludes `L<?>vern`, `H<?>sk`,
 * `F<?>ress` and `J<?>nsone`, where the lost letter sits second in a name that
 * follows a space. Asterisks are in the class because the corpus welds dashes
 * to markdown emphasis — `**insignia**<?>the` — and a digit is allowed on the
 * right for `the final three scores<?>12, 10, and 8<?>to Charisma`. That same
 * sentence is why a digit needs no second character before it: in
 * `and 8<?>to Charisma` the dash follows a space and a single `8`, and a digit
 * after a space is never the second letter of a name. A lone
 * letter on the right is still excluded, which keeps the rule away from
 * `Seelv<?>n` and `Ty<?>k`; those two are repaired by `NAMES_FROM_SOURCE`
 * before this rule ever sees them.
 */
const WELDED_DASH = /(?:(?<=\d)|(?<=[\p{L}\d'’"*]{2}))�(?=(?:\p{L}{2}|\d|[aI]\b|[ ]\p{L}))/gu;

/**
 * Accented letters the scrape ate out of the Expanded Content species name
 * tables, read back out of the document those tables are printed from and
 * quoted here rather than inferred.
 *
 * No pattern can recover these. `H<?>sk` gives no clue which vowel stood
 * there, and the chapter's own prose says only that kallerans use "accents on
 * vowels". The source is gmbinder.com/share/-LM7Sz_VhFOf0IYKXHQG — "EC 02 -
 * Species", the document sw5e.com's Expanded Content species chapter is
 * printed from.
 *
 * Each entry carries enough of the name either side of the lost letter to be
 * unambiguous, so a name repairs wherever it appears rather than only inside a
 * table row.
 */
const NAMES_FROM_SOURCE = [
  ["L�vern", "Lávern"], // kalleran, male
  ["Seelv�n", "Seelván"], // kalleran, male
  ["F�ress", "Fáress"], // kalleran, female
  ["Ian�", "Iané"], // kiffar, female
  ["H�sk", "Hâsk"], // massassi, male
  ["Ty�k", "Tyûk"], // massassi, female
  ["J�nsone", "Jánsone"], // theelin, male
  ["F�niss", "Fániss"], // theelin, female
];

/** Applies the name lookup, returning the text and how many it repaired. */
function repairNames(text) {
  let count = 0;
  for (const [broken, repaired] of NAMES_FROM_SOURCE) {
    let at = text.indexOf(broken);
    while (at !== -1) {
      count += 1;
      text = text.slice(0, at) + repaired + text.slice(at + broken.length);
      at = text.indexOf(broken, at + repaired.length);
    }
  }
  return { text, count };
}

/** Normalizes the archive's CRLF line endings and trims trailing spaces. */
function normalizeWhitespace(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * True when a value carried content that is now entirely gone: the field
 * holds nothing but replacement characters and whitespace. Such a field must
 * be dropped rather than rendered, because there is no content left to show.
 */
export function isTotalLoss(text) {
  return (
    typeof text === "string" &&
    text.includes(REPLACEMENT) &&
    text.replace(/[�\s]/g, "") === ""
  );
}

/** True when repair left at least one unrecoverable character behind. */
export function containsUnrepairedLoss(text) {
  return typeof text === "string" && text.includes(REPLACEMENT);
}

/**
 * Applies every repair rule, in the order that keeps them from competing. The
 * name lookup runs first so that no dash rule can reach a lost letter that is
 * already accounted for.
 *
 * Expects line endings to already be normalized: two of the rules are anchored
 * to a line boundary, and a stray `\r` would sit between the anchor and the
 * character they are looking for.
 */
function applyRules(text) {
  return repairNames(text)
    .text.replace(QUOTE_PAIR, '$1"$2"')
    .replace(CONTRACTION, "'")
    .replace(TABLE_CELL_DASH, "$1—$2")
    .replace(SPACED_DASH, "—")
    .replace(WELDED_DASH, "—")
    .replace(DOUBLED_INITIAL, "$1");
}

/**
 * Repairs a value. Quotation pairs run first because a closing quote looks
 * exactly like a welded dash once its partner has been rewritten.
 *
 * Returns `null` for a value that is empty or whose content is entirely lost,
 * so callers can drop the field instead of rendering an empty shell.
 */
export function repairText(value) {
  if (typeof value !== "string") return value;
  if (isTotalLoss(value)) return null;

  const cleaned = normalizeWhitespace(applyRules(value.replace(/\r\n?/g, "\n")));
  return cleaned === "" ? null : cleaned;
}

/** Per-rule repair counts, for reporting what the normalizer actually fixed. */
export function countRepairs(value) {
  const zero = {
    quotes: 0,
    apostrophes: 0,
    spacedDashes: 0,
    weldedDashes: 0,
    names: 0,
    unrepaired: 0,
    totalLoss: 0,
  };
  if (typeof value !== "string" || !value.includes(REPLACEMENT)) return zero;
  if (isTotalLoss(value)) {
    return { ...zero, totalLoss: (value.match(/�/g) ?? []).length };
  }

  const named = repairNames(value);
  let text = named.text;
  const quotes = (text.match(QUOTE_PAIR) ?? []).length * 2;
  text = text.replace(QUOTE_PAIR, '$1"$2"');
  const apostrophes = (text.match(CONTRACTION) ?? []).length;
  text = text.replace(CONTRACTION, "'");
  const tableCellDashes = (text.match(TABLE_CELL_DASH) ?? []).length;
  text = text.replace(TABLE_CELL_DASH, "$1—$2");
  const spacedDashes = (text.match(SPACED_DASH) ?? []).length;
  text = text.replace(SPACED_DASH, "—");
  const weldedDashes = (text.match(WELDED_DASH) ?? []).length;
  text = text.replace(WELDED_DASH, "—");

  return {
    quotes,
    apostrophes,
    spacedDashes,
    // A table cell's dash is an em dash like any other, so it is counted with
    // them rather than given a line of its own in the build's summary.
    weldedDashes: weldedDashes + tableCellDashes,
    names: named.count,
    unrepaired: (text.match(/�/g) ?? []).length,
    totalLoss: 0,
  };
}

/**
 * Shapes that were once left unrepaired, and how each was settled. Both were
 * resolved by reading the published source rather than by a cleverer pattern,
 * so no shape in the archive is unrepaired any more.
 *
 * - `L<?>vern`, `Seelv<?>n`, `H<?>sk`, `Ty<?>k`, `J<?>nsone`, `F<?>ress`,
 *   `F<?>niss`, `Ian<?>`. Accented letters inside the Expanded Content species
 *   name tables. No pattern can tell you which vowel was lost, so these are a
 *   lookup quoted from the chapter's own source document — see
 *   `NAMES_FROM_SOURCE`.
 * - `spirit<?> no one tells me`, `I can't help it<?> I'm a perfectionist`.
 *   A lost character before a space was read here as ambiguous between an em
 *   dash and an ellipsis. It is an em dash: the Player's Handbook sets
 *   `I am a free spirit— no one tells me what to do.` and the Expanded Content
 *   backgrounds chapter sets `I can't help it— I'm a perfectionist.`, both
 *   with U+2014 and both with the space after the dash that made the shape
 *   look ambiguous in the first place. `WELDED_DASH` covers them.
 */
