/**
 * The shape the UI consumes. Nothing here carries a legacy field name: the
 * archive's storage keys, stringified duplicates and paired enums are all
 * resolved by `scripts/build-content-fixture.mjs` before anything reaches a
 * component. When the data-loading layer is replaced by an API client over a
 * real content graph, these types are the contract it has to satisfy.
 */

export const CONTENT_TYPE_IDS = [
  "species",
  "archetypes",
  "backgrounds",
  "feats",
  "powers",

  // The combat options. Six types rather than one "combat options" heading,
  // because a character chooses from six separate lists granted by six
  // different features, and an entry on one is never a substitute for an entry
  // on another. Collapsing them would need a "kind" column that did nothing but
  // undo the collapse, and would make the six counts — 119, 32, 32, 20, 8, 8 —
  // one number that says nothing.
  "maneuvers",
  "fighting-styles",
  "fighting-masteries",
  "lightsaber-forms",
  "weapon-focuses",
  "weapon-supremacies",

  "equipment",
  "monsters",
] as const;

export type ContentTypeId = (typeof CONTENT_TYPE_IDS)[number];

export function isContentTypeId(value: string): value is ContentTypeId {
  return (CONTENT_TYPE_IDS as readonly string[]).includes(value);
}

/** A labelled key/value line, as shown in a stat block. */
export interface Stat {
  label: string;
  /** `null` only when `lost` is true: the source text no longer exists. */
  value: string | null;
  /**
   * The archive stored nothing but a replacement character here, so the
   * original content is unrecoverable. The UI must show this as a marked
   * absence rather than omitting the line or printing a stray glyph.
   */
  lost?: boolean;
}

export interface AbilityScore {
  ability: string;
  score: number;
  modifier: number;
}

/** A block of prose. `body` is markdown; `heading` is optional. */
export interface Section {
  heading: string | null;
  body: string;
}

/** A named sub-block: a species trait, a creature action, a background feature. */
export interface Entry {
  group: string;
  name: string | null;
  body: string | null;
}

export interface DataTable {
  caption: string;
  columns: string[];
  rows: string[][];
}

/**
 * A full content item. Types vary enormously — a feat has six fields, a
 * creature has forty-seven — so the detail view is driven by these four
 * open-ended collections rather than by a fixed field list.
 */
export interface ContentItem {
  type: ContentTypeId;
  slug: string;
  name: string;
  source: string | null;
  sourceName: string | null;
  tagline: string | null;
  summary: Record<string, string | number | boolean | null>;
  stats: Stat[];
  abilityScores?: AbilityScore[];
  sections: Section[];
  entries: Entry[];
  tables: DataTable[];
}

/** The fields every list row carries, whatever its type. */
export interface BaseSummary {
  slug: string;
  name: string;
  source: string | null;
  tagline: string | null;
}

export interface SpeciesSummary extends BaseSummary {
  size: string | null;
  homeworld: string | null;
  language: string | null;
  abilityIncreases: string | null;
}

export interface ArchetypeSummary extends BaseSummary {
  className: string | null;
  casterType: string | null;
}

export interface BackgroundSummary extends BaseSummary {
  feature: string | null;
  skillProficiencies: string | null;
  languages: string | null;
}

export interface FeatSummary extends BaseSummary {
  prerequisite: string | null;
  abilityIncreases: string | null;
}

export interface PowerSummary extends BaseSummary {
  level: number | null;
  powerType: string | null;
  castingPeriod: string | null;
  range: string | null;
  duration: string | null;
  concentration: boolean;
  forceAlignment: string | null;
}

export interface ManeuverSummary extends BaseSummary {
  kind: string | null;
  prerequisite: string | null;
  /**
   * Dice spent by using the maneuver — almost always one. Zero is the case
   * worth showing: a tiered upgrade changes how a maneuver a character has
   * already paid for behaves, and costs nothing itself.
   */
  superiorityDice: number | null;
  /** For a tiered maneuver, the maneuver it upgrades. */
  improves: string | null;
}

/**
 * Fighting styles and fighting masteries are the same shape: the same
 * disciplines chosen from two lists at two points in a career. `benefits` is
 * the count, which is the honest one-number comparison between them — a style
 * grants two, a mastery three or four.
 */
export interface FightingOptionSummary extends BaseSummary {
  prerequisite: string | null;
  benefits: number | null;
}

/** Weapon focuses and weapon supremacies, keyed by the group they apply to. */
export interface WeaponTrainingSummary extends BaseSummary {
  weaponGroup: string | null;
  benefits: number | null;
}

export interface LightsaberFormSummary extends BaseSummary {
  prerequisite: string | null;
  /**
   * Whether the form does something as part of the bonus action that adopts
   * it, as opposed to only granting a benefit while it is held. It is the one
   * thing that changes how a form is played, so it belongs on the row.
   */
  onAdopt: boolean;
}

export interface EquipmentSummary extends BaseSummary {
  category: string | null;
  cost: number | null;
  weight: number | null;
  damage: string | null;
  armorClass: string | null;
  properties: string | null;
}

export interface MonsterSummary extends BaseSummary {
  size: string | null;
  kind: string | null;
  alignment: string | null;
  challengeRating: string | null;
  challengeRatingValue: number | null;
  armorClass: number | null;
  hitPoints: number | null;
}

/**
 * Which row shape each content type's list page renders.
 *
 * A lookup rather than a chain of conditional types: with thirteen types the
 * chain was thirteen levels of nesting for what is a table, every addition
 * moved every line below it, and the compiler's error for a missing arm was
 * "MonsterSummary" — the final fallback — rather than "you forgot a type".
 * Indexing `Record<ContentTypeId, …>` makes a missing entry a compile error
 * naming the type that is missing.
 */
interface SummaryByType extends Record<ContentTypeId, BaseSummary> {
  species: SpeciesSummary;
  archetypes: ArchetypeSummary;
  backgrounds: BackgroundSummary;
  feats: FeatSummary;
  powers: PowerSummary;
  maneuvers: ManeuverSummary;
  "fighting-styles": FightingOptionSummary;
  "fighting-masteries": FightingOptionSummary;
  "lightsaber-forms": LightsaberFormSummary;
  "weapon-focuses": WeaponTrainingSummary;
  "weapon-supremacies": WeaponTrainingSummary;
  equipment: EquipmentSummary;
  monsters: MonsterSummary;
}

export type SummaryFor<T extends ContentTypeId> = SummaryByType[T];

export type AnySummary = SummaryByType[ContentTypeId];

/** One labelled fragment of an item, used to explain why a result matched. */
export interface SearchField {
  label: string;
  text: string;
}

export interface SearchRecord {
  type: ContentTypeId;
  slug: string;
  name: string;
  source: string | null;
  fields: SearchField[];
}

export interface ManifestEntry {
  id: ContentTypeId;
  singular: string;
  plural: string;
  count: number;
}

export interface Manifest {
  generatedAt: string;
  /** True when the site is rendering the small committed fixture. */
  curated: boolean;
  types: ManifestEntry[];
}

/** Source book abbreviations, expanded for display. */
export const SOURCE_NAMES: Record<string, string> = {
  PHB: "Player's Handbook",
  EC: "Expanded Content",
  WH: "Wretched Hives",
  SnV: "Scum and Villainy",
};
