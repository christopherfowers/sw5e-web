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
  "maneuvers",
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

export type SummaryFor<T extends ContentTypeId> = T extends "species"
  ? SpeciesSummary
  : T extends "archetypes"
    ? ArchetypeSummary
    : T extends "backgrounds"
      ? BackgroundSummary
      : T extends "feats"
        ? FeatSummary
        : T extends "powers"
          ? PowerSummary
          : T extends "maneuvers"
            ? ManeuverSummary
            : T extends "equipment"
              ? EquipmentSummary
              : MonsterSummary;

export type AnySummary =
  | SpeciesSummary
  | ArchetypeSummary
  | BackgroundSummary
  | FeatSummary
  | PowerSummary
  | ManeuverSummary
  | EquipmentSummary
  | MonsterSummary;

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
