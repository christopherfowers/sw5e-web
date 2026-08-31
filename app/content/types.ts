/**
 * The shape the UI consumes. Nothing here carries a legacy field name: the
 * archive's storage keys, stringified duplicates and paired enums are all
 * resolved by `scripts/build-content-fixture.mjs` before anything reaches a
 * component. When the data-loading layer is replaced by an API client over a
 * real content graph, these types are the contract it has to satisfy.
 */

export const CONTENT_TYPE_IDS = [
  "species",
  "classes",
  "class-improvements",
  "archetypes",
  "features",
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
  // Starship play. Its six types sit together and after the character types,
  // because that is the order a table reaches them: a group builds characters
  // first and acquires a ship later.
  "starship-base-sizes",
  "starship-deployments",
  "starship-equipment",
  "starship-modifications",
  "starship-ventures",
  "starship-rules",
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

export interface ClassSummary extends BaseSummary {
  primaryAbility: string | null;
  hitDie: number | null;
  casterType: string | null;
  /** How many archetypes branch off this class. Null on the archive dataset. */
  archetypeCount: number | null;
}

export interface ClassImprovementSummary extends BaseSummary {
  className: string | null;
  improvementType: string | null;
  prerequisite: string | null;
}

export interface ArchetypeSummary extends BaseSummary {
  className: string | null;
  casterType: string | null;
}

export interface FeatureSummary extends BaseSummary {
  /** "Class", "Archetype" or "Species" — what kind of thing grants it. */
  grantedBy: string | null;
  grantedByName: string | null;
  level: number | null;
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
 * A hull, which is the ship's equivalent of a class. The list is six rows
 * long, so the columns are the numbers a player compares when choosing one
 * rather than the ones that fit.
 */
export interface StarshipBaseSizeSummary extends BaseSummary {
  hullDice: string | null;
  modificationSlots: number | null;
  savingThrows: string | null;
  roles: string | null;
}

export interface StarshipDeploymentSummary extends BaseSummary {
  /** What the station does aboard the ship, in one line. */
  role: string | null;
}

export interface StarshipEquipmentSummary extends BaseSummary {
  category: string | null;
  cost: number | null;
  mounting: string | null;
  damage: string | null;
  properties: string | null;
}

export interface StarshipModificationSummary extends BaseSummary {
  modificationType: string | null;
  /** 0 to 5. What the modification costs in slots is read from it. */
  grade: number | null;
  /** The hull requirement, as printed minus its leading "Ship size". */
  requiresShipSize: string | null;
  /** Every other prerequisite clause; the hull one has a column of its own. */
  prerequisite: string | null;
}

export interface StarshipVentureSummary extends BaseSummary {
  prerequisite: string | null;
  /** The deployment a rank is required in, when the prerequisite names one. */
  deployment: string | null;
  /** The character class the prerequisite demands levels in, if it names one. */
  characterClass: string | null;
}

export interface StarshipRuleSummary extends BaseSummary {
  /** Reading order, and how the chapters cross-reference each other. */
  chapterNumber: number | null;
}

/**
 * Which row shape each content type's list page renders.
 *
 * A lookup rather than a chain of conditional types: with nineteen types the
 * chain was nineteen levels of nesting for what is a table, every addition
 * moved every line below it, and the compiler's error for a missing arm was
 * "MonsterSummary" — the final fallback — rather than "you forgot a type".
 * Indexing `Record<ContentTypeId, …>` makes a missing entry a compile error
 * naming the type that is missing.
 */
interface SummaryByType extends Record<ContentTypeId, BaseSummary> {
  species: SpeciesSummary;
  classes: ClassSummary;
  "class-improvements": ClassImprovementSummary;
  archetypes: ArchetypeSummary;
  features: FeatureSummary;
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
  "starship-base-sizes": StarshipBaseSizeSummary;
  "starship-deployments": StarshipDeploymentSummary;
  "starship-equipment": StarshipEquipmentSummary;
  "starship-modifications": StarshipModificationSummary;
  "starship-ventures": StarshipVentureSummary;
  "starship-rules": StarshipRuleSummary;
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
  SotG: "Starships of the Galaxy",
};
