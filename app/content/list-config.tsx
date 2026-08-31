/**
 * What each content type's index page shows, filters on, sorts by — and what
 * shape it takes.
 *
 * A creature list needs challenge rating; a power list needs level and casting
 * time; an equipment list needs cost and damage. Rendering one generic table
 * once per type would bury exactly the columns a reader is scanning for at the
 * table mid-game, so every type declares its own.
 *
 * Two of the declarations here are about form rather than fields. `layout`
 * turns species into a gallery, because a portrait identifies a species faster
 * than its name does and the archive's art exists to be used. `rowMedia` puts
 * a class illustration beside every archetype, which sorts 137 rows into ten
 * recognisable families before a reader has read a word.
 */

import type { ReactNode } from "react";

import {
  Badge,
  SourceBadge,
  alignmentAccent,
  challengeAccent,
  maneuverAccent,
  powerTypeAccent,
} from "~/components/badges";
import { classArt, speciesThumbnail, type ImageSource } from "./imagery";
import type {
  AnySummary,
  ArchetypeSummary,
  BackgroundSummary,
  ClassImprovementSummary,
  ClassSummary,
  ContentTypeId,
  EquipmentSummary,
  FeatSummary,
  FeatureSummary,
  FightingOptionSummary,
  LightsaberFormSummary,
  ManeuverSummary,
  MonsterSummary,
  PowerSummary,
  SpeciesSummary,
  StarshipBaseSizeSummary,
  StarshipDeploymentSummary,
  StarshipEquipmentSummary,
  StarshipModificationSummary,
  StarshipRuleSummary,
  StarshipVentureSummary,
  WeaponTrainingSummary,
} from "./types";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Value used when sorting by this column. Omit to make it unsortable. */
  sortValue?: (row: Row) => string | number | null;
  /** Right-aligns the column and sorts it high-to-low first. */
  numeric?: boolean;
  /** Tailwind classes controlling when the column appears. */
  className?: string;
}

export interface Facet<Row> {
  key: string;
  label: string;
  valueOf: (row: Row) => string | null;
  /** Sorts the dropdown's options; defaults to alphabetical. */
  compare?: (left: string, right: string) => number;
}

/** The picture and meta line for one tile of a gallery layout. */
export interface Tile {
  image: ImageSource | null;
  /** Describes the picture. Omit only when the row's name already does. */
  alt?: string;
  meta?: ReactNode;
}

/** A small picture rendered beside a table row's name. */
export interface RowMedia {
  image: ImageSource | null;
  alt: string;
}

export interface ListConfig<Row> {
  columns: Column<Row>[];
  facets: Facet<Row>[];
  defaultSort: string;
  /** "table" unless a type is better read as pictures. */
  layout?: "table" | "gallery";
  /** Zebra stripes, for tables long and wide enough to lose your place in. */
  striped?: boolean;
  /** Required by the gallery layout, ignored by the table one. */
  tile?: (row: Row) => Tile;
  /** Optional picture beside the name in a table row. */
  rowMedia?: (row: Row) => RowMedia | null;
  /**
   * A one-line digest shown under the name on narrow screens, where most
   * columns are hidden. Without it a phone shows a list of bare names.
   */
  compactLine: (row: Row) => string | null;
}

/** Columns hidden until there is room, in the order they earn their space. */
const FROM_SMALL = "hidden sm:table-cell";
const FROM_MEDIUM = "hidden md:table-cell";
const FROM_LARGE = "hidden lg:table-cell";

const em = <span aria-hidden="true">—</span>;

function textOr(value: string | null | undefined): ReactNode {
  return value ? value : em;
}

function mutedOr(value: string | null | undefined): ReactNode {
  return value ? <span className="cell-muted">{value}</span> : em;
}

function joinParts(parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter(Boolean) as string[];
  return kept.length > 0 ? kept.join(" · ") : null;
}

function creditsColumn<Row extends { cost: number | null }>(): Column<Row> {
  return {
    key: "cost",
    header: "Cost",
    numeric: true,
    className: FROM_SMALL,
    sortValue: (row) => row.cost,
    render: (row) =>
      row.cost == null ? em : `${row.cost.toLocaleString("en-US")} cr`,
  };
}

const nameColumn = <Row extends { name: string }>(): Column<Row> => ({
  key: "name",
  header: "Name",
  sortValue: (row) => row.name,
  render: (row) => row.name,
});

const sourceColumn = <Row extends { source: string | null }>(): Column<Row> => ({
  key: "source",
  header: "Source",
  className: FROM_LARGE,
  sortValue: (row) => row.source,
  render: (row) => <SourceBadge code={row.source} />,
});

const sourceFacet = <Row extends { source: string | null }>(): Facet<Row> => ({
  key: "source",
  label: "Source",
  valueOf: (row) => row.source,
});

const species: ListConfig<SpeciesSummary> = {
  layout: "gallery",
  defaultSort: "name",
  compactLine: (row) => joinParts([row.size, row.homeworld]),
  tile: (row) => ({
    image: speciesThumbnail(row.slug),
    // A portrait's job on this page is to show what the species looks like, so
    // that is what the alt text says. "Abyssin" alone would be a caption, not
    // a description of the picture.
    alt: `Illustration of the ${row.name} species`,
    meta: (
      <>
        {row.size ? <Badge accent="teal">{row.size}</Badge> : null}
        {row.homeworld ? <span>{row.homeworld}</span> : null}
      </>
    ),
  }),
  columns: [
    nameColumn(),
    {
      key: "size",
      header: "Size",
      className: FROM_SMALL,
      sortValue: (row) => row.size,
      render: (row) => textOr(row.size),
    },
    {
      key: "homeworld",
      header: "Homeworld",
      className: FROM_MEDIUM,
      sortValue: (row) => row.homeworld,
      render: (row) => textOr(row.homeworld),
    },
    {
      key: "abilityIncreases",
      header: "Ability increases",
      className: FROM_LARGE,
      render: (row) => textOr(row.abilityIncreases),
    },
  ],
  facets: [
    { key: "size", label: "Size", valueOf: (row) => row.size },
    sourceFacet(),
  ],
};

/**
 * Ten rows, each with the class illustration beside it. A class is the one
 * choice in this corpus that a reader makes exactly once, so the index is short
 * enough to show every column that matters to that choice: what it plays like,
 * how much punishment it takes, and whether it casts.
 */
const classes: ListConfig<ClassSummary> = {
  defaultSort: "name",
  compactLine: (row) =>
    joinParts([
      row.hitDie == null ? null : `d${row.hitDie}`,
      row.primaryAbility,
      row.casterType,
    ]),
  rowMedia: (row) => ({
    image: classArt(row.name),
    alt: `Illustration of a ${row.name}`,
  }),
  columns: [
    nameColumn(),
    {
      key: "primaryAbility",
      header: "Primary ability",
      className: FROM_SMALL,
      sortValue: (row) => row.primaryAbility,
      render: (row) => textOr(row.primaryAbility),
    },
    {
      key: "hitDie",
      header: "Hit die",
      numeric: true,
      className: FROM_MEDIUM,
      sortValue: (row) => row.hitDie,
      render: (row) =>
        row.hitDie == null ? em : (
          <Badge className="badge-numeric" accent="indigo">{`d${row.hitDie}`}</Badge>
        ),
    },
    {
      key: "casterType",
      header: "Casting",
      className: FROM_MEDIUM,
      render: (row) =>
        row.casterType ? (
          <Badge accent={powerTypeAccent(row.casterType)}>{row.casterType}</Badge>
        ) : (
          em
        ),
    },
    {
      key: "archetypeCount",
      header: "Archetypes",
      numeric: true,
      className: FROM_LARGE,
      sortValue: (row) => row.archetypeCount,
      render: (row) =>
        row.archetypeCount == null ? em : String(row.archetypeCount),
    },
    sourceColumn(),
  ],
  facets: [
    {
      key: "primaryAbility",
      label: "Primary ability",
      valueOf: (row) => row.primaryAbility,
    },
    { key: "casterType", label: "Casting", valueOf: (row) => row.casterType },
  ],
};

const classImprovements: ListConfig<ClassImprovementSummary> = {
  defaultSort: "name",
  compactLine: (row) => joinParts([row.className, row.improvementType]),
  rowMedia: (row) =>
    row.className
      ? {
          image: classArt(row.className),
          alt: `Illustration of a ${row.className}`,
        }
      : null,
  columns: [
    nameColumn(),
    {
      key: "className",
      header: "Class",
      className: FROM_SMALL,
      sortValue: (row) => row.className,
      render: (row) =>
        row.className ? <Badge accent="indigo">{row.className}</Badge> : em,
    },
    {
      key: "improvementType",
      header: "Kind",
      className: FROM_MEDIUM,
      sortValue: (row) => row.improvementType,
      render: (row) => textOr(row.improvementType),
    },
    {
      key: "prerequisite",
      header: "Prerequisite",
      className: FROM_LARGE,
      render: (row) => mutedOr(row.prerequisite),
    },
  ],
  facets: [
    { key: "className", label: "Class", valueOf: (row) => row.className },
    { key: "improvementType", label: "Kind", valueOf: (row) => row.improvementType },
  ],
};

/**
 * The longest table on the site by some distance — over a thousand rows — so it
 * is striped, and the two facets that cut it down are the ones a reader
 * actually has in mind: the level they are about to reach, and the class or
 * archetype they are playing.
 */
const features: ListConfig<FeatureSummary> = {
  defaultSort: "name",
  striped: true,
  compactLine: (row) =>
    joinParts([
      row.grantedByName,
      row.level == null ? null : `${row.level}${ordinalSuffix(row.level)} level`,
    ]),
  columns: [
    nameColumn(),
    {
      key: "level",
      header: "Level",
      numeric: true,
      sortValue: (row) => row.level,
      render: (row) =>
        row.level == null ? (
          em
        ) : (
          <Badge className="badge-numeric" accent="indigo">
            {row.level}
          </Badge>
        ),
    },
    {
      key: "grantedByName",
      header: "Granted by",
      className: FROM_SMALL,
      sortValue: (row) => row.grantedByName,
      render: (row) => textOr(row.grantedByName),
    },
    {
      key: "grantedBy",
      header: "From",
      className: FROM_MEDIUM,
      sortValue: (row) => row.grantedBy,
      render: (row) => mutedOr(row.grantedBy),
    },
    sourceColumn(),
  ],
  facets: [
    {
      key: "grantedBy",
      label: "Granted by",
      valueOf: (row) => row.grantedBy,
    },
    {
      key: "level",
      label: "Level",
      valueOf: (row) => (row.level == null ? null : String(row.level)),
      compare: (left, right) => Number(left) - Number(right),
    },
    {
      key: "grantedByName",
      label: "Class or archetype",
      valueOf: (row) => row.grantedByName,
    },
    sourceFacet(),
  ],
};

/** `1` takes "st", `13` takes "th". Only used for the narrow-screen digest. */
function ordinalSuffix(level: number): string {
  const rest = level % 100;
  if (rest >= 11 && rest <= 13) return "th";
  return ["th", "st", "nd", "rd"][level % 10] ?? "th";
}

const archetypes: ListConfig<ArchetypeSummary> = {
  defaultSort: "name",
  compactLine: (row) => joinParts([row.className, row.casterType]),
  rowMedia: (row) =>
    row.className
      ? {
          image: classArt(row.className),
          alt: `Illustration of a ${row.className}`,
        }
      : null,
  columns: [
    nameColumn(),
    {
      key: "className",
      header: "Class",
      className: FROM_SMALL,
      sortValue: (row) => row.className,
      render: (row) =>
        row.className ? <Badge accent="indigo">{row.className}</Badge> : em,
    },
    {
      key: "casterType",
      header: "Casting",
      className: FROM_MEDIUM,
      render: (row) =>
        row.casterType ? (
          <Badge accent={powerTypeAccent(row.casterType)}>{row.casterType}</Badge>
        ) : (
          em
        ),
    },
    sourceColumn(),
  ],
  facets: [
    { key: "className", label: "Class", valueOf: (row) => row.className },
    { key: "casterType", label: "Casting", valueOf: (row) => row.casterType },
    sourceFacet(),
  ],
};

const backgrounds: ListConfig<BackgroundSummary> = {
  defaultSort: "name",
  compactLine: (row) => row.feature,
  columns: [
    nameColumn(),
    {
      key: "feature",
      header: "Feature",
      className: FROM_SMALL,
      sortValue: (row) => row.feature,
      render: (row) => textOr(row.feature),
    },
    {
      key: "skillProficiencies",
      header: "Skill proficiencies",
      className: FROM_LARGE,
      render: (row) => mutedOr(row.skillProficiencies),
    },
    sourceColumn(),
  ],
  facets: [sourceFacet()],
};

const feats: ListConfig<FeatSummary> = {
  defaultSort: "name",
  compactLine: (row) =>
    row.prerequisite ? `Requires ${row.prerequisite}` : null,
  columns: [
    nameColumn(),
    {
      key: "prerequisite",
      header: "Prerequisite",
      className: FROM_SMALL,
      sortValue: (row) => row.prerequisite,
      render: (row) => mutedOr(row.prerequisite),
    },
    {
      key: "abilityIncreases",
      header: "Ability increases",
      className: FROM_MEDIUM,
      render: (row) =>
        row.abilityIncreases ? (
          <Badge accent="amber">{row.abilityIncreases}</Badge>
        ) : (
          em
        ),
    },
    sourceColumn(),
  ],
  facets: [
    {
      key: "abilityIncreases",
      label: "Increases",
      valueOf: (row) => row.abilityIncreases,
    },
    sourceFacet(),
  ],
};

const CASTING_ORDER = ["Reaction", "Bonus action", "Action", "Minute", "Hour"];

const powers: ListConfig<PowerSummary> = {
  defaultSort: "name",
  striped: true,
  compactLine: (row) =>
    joinParts([
      row.level === 0 ? "At-will" : `Level ${row.level}`,
      row.powerType,
      row.castingPeriod,
    ]),
  columns: [
    nameColumn(),
    {
      key: "level",
      header: "Level",
      numeric: true,
      sortValue: (row) => row.level,
      render: (row) =>
        row.level == null ? (
          em
        ) : (
          <Badge className="badge-numeric" accent={powerTypeAccent(row.powerType)}>
            {row.level === 0 ? "At-will" : row.level}
          </Badge>
        ),
    },
    {
      key: "powerType",
      header: "Type",
      className: FROM_SMALL,
      sortValue: (row) => row.powerType,
      render: (row) =>
        row.powerType ? (
          <Badge accent={powerTypeAccent(row.powerType)}>{row.powerType}</Badge>
        ) : (
          em
        ),
    },
    {
      key: "castingPeriod",
      header: "Casting time",
      className: FROM_MEDIUM,
      sortValue: (row) => row.castingPeriod,
      render: (row) => textOr(row.castingPeriod),
    },
    {
      key: "range",
      header: "Range",
      className: FROM_LARGE,
      render: (row) => mutedOr(row.range),
    },
    {
      key: "forceAlignment",
      header: "Alignment",
      className: FROM_LARGE,
      render: (row) =>
        row.forceAlignment ? (
          <Badge accent={alignmentAccent(row.forceAlignment)}>
            {row.forceAlignment}
          </Badge>
        ) : (
          em
        ),
    },
    {
      key: "concentration",
      header: "Conc.",
      className: FROM_LARGE,
      render: (row) =>
        row.concentration ? "Yes" : <span aria-hidden="true">—</span>,
    },
  ],
  facets: [
    {
      key: "level",
      label: "Level",
      valueOf: (row) => (row.level == null ? null : String(row.level)),
      compare: (left, right) => Number(left) - Number(right),
    },
    { key: "powerType", label: "Type", valueOf: (row) => row.powerType },
    {
      key: "castingPeriod",
      label: "Casting time",
      valueOf: (row) => row.castingPeriod,
      compare: (left, right) =>
        CASTING_ORDER.indexOf(left) - CASTING_ORDER.indexOf(right),
    },
    {
      key: "forceAlignment",
      label: "Alignment",
      valueOf: (row) => row.forceAlignment,
    },
    sourceFacet(),
  ],
};

const maneuvers: ListConfig<ManeuverSummary> = {
  defaultSort: "name",
  striped: true,
  compactLine: (row) => joinParts([row.kind, diceLabel(row.superiorityDice)]),
  columns: [
    nameColumn(),
    {
      key: "kind",
      header: "Type",
      className: FROM_SMALL,
      sortValue: (row) => row.kind,
      render: (row) =>
        row.kind ? <Badge accent={maneuverAccent(row.kind)}>{row.kind}</Badge> : em,
    },
    {
      // What using the maneuver takes out of the pool. It is one die for all
      // but ten of the 119, and those ten are exactly the ones worth spotting
      // in a list: they upgrade a maneuver already paid for.
      key: "superiorityDice",
      header: "Dice",
      numeric: true,
      className: FROM_SMALL,
      sortValue: (row) => row.superiorityDice,
      render: (row) =>
        row.superiorityDice == null ? (
          em
        ) : (
          <span className={row.superiorityDice === 0 ? "cell-muted" : undefined}>
            {row.superiorityDice}
          </span>
        ),
    },
    {
      key: "prerequisite",
      header: "Prerequisite",
      className: FROM_MEDIUM,
      render: (row) => mutedOr(row.prerequisite),
    },
    {
      key: "improves",
      header: "Improves",
      className: FROM_LARGE,
      sortValue: (row) => row.improves,
      render: (row) => mutedOr(row.improves),
    },
    sourceColumn(),
  ],
  facets: [
    { key: "kind", label: "Type", valueOf: (row) => row.kind },
    {
      key: "superiorityDice",
      label: "Cost",
      valueOf: (row) => diceLabel(row.superiorityDice),
      compare: (left, right) => (left === "Free" ? -1 : right === "Free" ? 1 : 0),
    },
    sourceFacet(),
  ],
};

/**
 * A die cost as a reader would say it. "Free" rather than "0 dice" because
 * zero is not an absence here — it is the defining property of an upgrade.
 */
function diceLabel(dice: number | null): string | null {
  if (dice == null) return null;
  if (dice === 0) return "Free";
  return dice === 1 ? "1 die" : `${dice} dice`;
}

/**
 * Fighting styles and fighting masteries render identically, because they are
 * the same disciplines chosen from two lists at two points in a career, and a
 * reader comparing Duelist Style with Duelist Mastery should be comparing two
 * rows of the same shape.
 *
 * The benefit count earns its column for the same reason: it is the one number
 * that separates the two lists, and it only exists as a number because the
 * canonical documents keep the benefits as a list rather than as prose.
 */
const fightingOptions: ListConfig<FightingOptionSummary> = {
  defaultSort: "name",
  compactLine: (row) =>
    joinParts([
      benefitsLabel(row.benefits),
      row.prerequisite ? `Requires ${row.prerequisite}` : null,
    ]),
  columns: [
    nameColumn(),
    {
      key: "benefits",
      header: "Benefits",
      numeric: true,
      className: FROM_SMALL,
      sortValue: (row) => row.benefits,
      render: (row) => textOr(row.benefits == null ? null : String(row.benefits)),
    },
    {
      key: "prerequisite",
      header: "Prerequisite",
      className: FROM_MEDIUM,
      sortValue: (row) => row.prerequisite,
      render: (row) => mutedOr(row.prerequisite),
    },
    sourceColumn(),
  ],
  facets: [
    {
      key: "prerequisite",
      label: "Prerequisite",
      valueOf: (row) => row.prerequisite,
    },
    sourceFacet(),
  ],
};

function benefitsLabel(benefits: number | null): string | null {
  if (benefits == null) return null;
  return benefits === 1 ? "1 benefit" : `${benefits} benefits`;
}

/**
 * Weapon focuses and weapon supremacies. Eight rows each, one per weapon
 * group, so the group is the column a reader is actually scanning for — the
 * names differ from it only in whether the books wrote the word "Weapon".
 */
const weaponTraining: ListConfig<WeaponTrainingSummary> = {
  defaultSort: "name",
  compactLine: (row) => joinParts([row.weaponGroup, benefitsLabel(row.benefits)]),
  columns: [
    nameColumn(),
    {
      key: "weaponGroup",
      header: "Weapon group",
      className: FROM_SMALL,
      sortValue: (row) => row.weaponGroup,
      render: (row) =>
        row.weaponGroup ? <Badge accent="steel">{row.weaponGroup}</Badge> : em,
    },
    {
      key: "benefits",
      header: "Benefits",
      numeric: true,
      className: FROM_MEDIUM,
      sortValue: (row) => row.benefits,
      render: (row) => textOr(row.benefits == null ? null : String(row.benefits)),
    },
    sourceColumn(),
  ],
  facets: [
    {
      key: "weaponGroup",
      label: "Weapon group",
      valueOf: (row) => row.weaponGroup,
    },
    sourceFacet(),
  ],
};

const lightsaberForms: ListConfig<LightsaberFormSummary> = {
  defaultSort: "name",
  compactLine: (row) =>
    joinParts([
      row.onAdopt ? "Acts on adoption" : "Active while held",
      row.prerequisite ? `Requires ${row.prerequisite}` : null,
    ]),
  columns: [
    nameColumn(),
    {
      // The one thing that changes how a form is played: does adopting it do
      // something this turn, or does it only change what is true afterwards?
      key: "onAdopt",
      header: "On adoption",
      className: FROM_SMALL,
      sortValue: (row) => (row.onAdopt ? 0 : 1),
      render: (row) =>
        row.onAdopt ? <Badge accent="violet">Acts</Badge> : mutedOr("While held"),
    },
    {
      key: "prerequisite",
      header: "Prerequisite",
      className: FROM_MEDIUM,
      sortValue: (row) => row.prerequisite,
      render: (row) => mutedOr(row.prerequisite),
    },
    sourceColumn(),
  ],
  facets: [
    {
      key: "onAdopt",
      label: "On adoption",
      valueOf: (row) => (row.onAdopt ? "Acts" : "While held"),
    },
    sourceFacet(),
  ],
};

const equipment: ListConfig<EquipmentSummary> = {
  defaultSort: "name",
  striped: true,
  compactLine: (row) =>
    joinParts([
      row.category,
      row.cost == null ? null : `${row.cost.toLocaleString("en-US")} cr`,
      row.damage,
    ]),
  columns: [
    nameColumn(),
    {
      key: "category",
      header: "Category",
      className: FROM_SMALL,
      sortValue: (row) => row.category,
      render: (row) => (row.category ? <Badge>{row.category}</Badge> : em),
    },
    creditsColumn<EquipmentSummary>(),
    {
      key: "weight",
      header: "Weight",
      numeric: true,
      className: FROM_LARGE,
      sortValue: (row) => row.weight,
      render: (row) => (row.weight == null ? em : `${row.weight} lb.`),
    },
    {
      key: "damage",
      header: "Damage",
      className: FROM_MEDIUM,
      render: (row) => textOr(row.damage),
    },
    sourceColumn(),
  ],
  facets: [
    { key: "category", label: "Category", valueOf: (row) => row.category },
    sourceFacet(),
  ],
};

const monsters: ListConfig<MonsterSummary> = {
  defaultSort: "name",
  striped: true,
  compactLine: (row) =>
    joinParts([
      row.challengeRating ? `CR ${row.challengeRating}` : null,
      row.size,
      row.kind,
    ]),
  columns: [
    nameColumn(),
    {
      key: "challengeRating",
      header: "CR",
      numeric: true,
      sortValue: (row) => row.challengeRatingValue,
      render: (row) =>
        row.challengeRating ? (
          <Badge
            className="badge-numeric"
            accent={challengeAccent(row.challengeRatingValue)}
          >
            {row.challengeRating}
          </Badge>
        ) : (
          em
        ),
    },
    {
      key: "kind",
      header: "Type",
      className: FROM_SMALL,
      sortValue: (row) => row.kind,
      render: (row) => textOr(row.kind),
    },
    {
      key: "size",
      header: "Size",
      className: FROM_MEDIUM,
      sortValue: (row) => row.size,
      render: (row) => mutedOr(row.size),
    },
    {
      key: "armorClass",
      header: "AC",
      numeric: true,
      className: FROM_MEDIUM,
      sortValue: (row) => row.armorClass,
      render: (row) => textOr(row.armorClass == null ? null : String(row.armorClass)),
    },
    {
      key: "hitPoints",
      header: "HP",
      numeric: true,
      className: FROM_LARGE,
      sortValue: (row) => row.hitPoints,
      render: (row) => textOr(row.hitPoints == null ? null : String(row.hitPoints)),
    },
  ],
  facets: [
    {
      key: "challengeRating",
      label: "Challenge",
      valueOf: (row) => row.challengeRating,
      compare: (left, right) => ratingValue(left) - ratingValue(right),
    },
    { key: "kind", label: "Type", valueOf: (row) => row.kind },
    { key: "size", label: "Size", valueOf: (row) => row.size },
  ],
};

/* --------------------------------------------------------------- starships */

const starshipBaseSizes: ListConfig<StarshipBaseSizeSummary> = {
  defaultSort: "modificationSlots",
  compactLine: (row) => joinParts([row.hullDice, row.savingThrows]),
  columns: [
    nameColumn(),
    {
      key: "hullDice",
      header: "Hull dice",
      className: FROM_SMALL,
      sortValue: (row) => row.hullDice,
      render: (row) =>
        row.hullDice ? (
          <Badge className="badge-numeric" accent="steel">
            {row.hullDice}
          </Badge>
        ) : (
          em
        ),
    },
    {
      key: "modificationSlots",
      header: "Mod slots",
      numeric: true,
      sortValue: (row) => row.modificationSlots,
      render: (row) =>
        row.modificationSlots == null ? em : String(row.modificationSlots),
    },
    {
      key: "savingThrows",
      header: "Saving throws",
      className: FROM_MEDIUM,
      render: (row) => mutedOr(row.savingThrows),
    },
    {
      key: "roles",
      header: "Roles",
      className: FROM_LARGE,
      render: (row) => mutedOr(row.roles),
    },
  ],
  // Six rows, all from one book: a facet here would offer a single option.
  facets: [],
};

const starshipDeployments: ListConfig<StarshipDeploymentSummary> = {
  defaultSort: "name",
  compactLine: (row) => row.role,
  columns: [
    nameColumn(),
    {
      key: "role",
      header: "Station",
      render: (row) => textOr(row.role),
    },
  ],
  facets: [],
};

/**
 * The shipyard list. Category is the first thing a reader narrows by — nobody
 * shopping for a hyperdrive wants to scroll past sixty-two guns — and mounting
 * is the second, because a hardpoint only takes the weapons built for it.
 */
/** Mountings read in the order a ship fires them, not alphabetically. */
const MOUNTING_ORDER = ["Primary", "Secondary", "Tertiary", "Quaternary"];

const starshipEquipment: ListConfig<StarshipEquipmentSummary> = {
  defaultSort: "name",
  striped: true,
  compactLine: (row) =>
    joinParts([
      row.category,
      row.cost == null ? null : `${row.cost.toLocaleString("en-US")} cr`,
      row.damage,
    ]),
  columns: [
    nameColumn(),
    {
      key: "category",
      header: "Category",
      className: FROM_SMALL,
      sortValue: (row) => row.category,
      render: (row) => (row.category ? <Badge>{row.category}</Badge> : em),
    },
    {
      key: "mounting",
      header: "Mounting",
      className: FROM_MEDIUM,
      sortValue: (row) => row.mounting,
      render: (row) =>
        row.mounting ? <Badge accent="cyan">{row.mounting}</Badge> : em,
    },
    creditsColumn<StarshipEquipmentSummary>(),
    {
      key: "damage",
      header: "Damage",
      className: FROM_MEDIUM,
      render: (row) => textOr(row.damage),
    },
    {
      key: "properties",
      header: "Properties",
      className: FROM_LARGE,
      render: (row) => mutedOr(row.properties),
    },
  ],
  facets: [
    { key: "category", label: "Category", valueOf: (row) => row.category },
    {
      key: "mounting",
      label: "Mounting",
      valueOf: (row) => row.mounting,
      compare: (left, right) =>
        MOUNTING_ORDER.indexOf(left) - MOUNTING_ORDER.indexOf(right),
    },
  ],
};

/** Hull requirements read smallest-first, which is how a table thinks of them. */
const SHIP_SIZE_ORDER = [
  "Tiny",
  "Small or smaller",
  "Small",
  "Small or larger",
  "Medium or smaller",
  "Medium",
  "Medium or larger",
  "Large",
  "Large or larger",
  "Huge",
  "Gargantuan",
];

/**
 * The largest starship list by a wide margin, and the one a filter has to
 * carry: nobody reads 257 rows.
 *
 * Three facets, each answering a question a crew actually arrives with. Grade
 * is what a modification costs in slots, so a ship with six slots left is
 * reading one band and ignoring the rest. Type is what it competes with —
 * suites are capped separately from everything else. Ship size is the one that
 * would otherwise be invisible: 35 of these are gated on the hull, the clause
 * is buried in prose, and "what can my Small ship fit?" is unanswerable
 * without it.
 */
const starshipModifications: ListConfig<StarshipModificationSummary> = {
  defaultSort: "name",
  striped: true,
  compactLine: (row) =>
    joinParts([
      row.modificationType,
      row.grade == null ? null : `Grade ${row.grade}`,
      row.requiresShipSize ? `${row.requiresShipSize} hull` : null,
      row.prerequisite,
    ]),
  columns: [
    nameColumn(),
    {
      key: "modificationType",
      header: "Type",
      className: FROM_SMALL,
      sortValue: (row) => row.modificationType,
      render: (row) =>
        row.modificationType ? (
          <Badge accent="amber">{row.modificationType}</Badge>
        ) : (
          em
        ),
    },
    {
      key: "grade",
      header: "Grade",
      numeric: true,
      sortValue: (row) => row.grade,
      render: (row) =>
        row.grade == null ? (
          em
        ) : (
          <Badge className="badge-numeric" accent="amber">
            {row.grade}
          </Badge>
        ),
    },
    {
      key: "requiresShipSize",
      header: "Ship size",
      className: FROM_MEDIUM,
      sortValue: (row) => row.requiresShipSize,
      render: (row) =>
        row.requiresShipSize ? (
          <Badge accent="steel">{row.requiresShipSize}</Badge>
        ) : (
          // No hull requirement is a real answer, not a missing value: any
          // ship can fit it.
          <span className="cell-muted">Any</span>
        ),
    },
    {
      key: "prerequisite",
      header: "Prerequisite",
      className: FROM_LARGE,
      render: (row) => mutedOr(row.prerequisite),
    },
  ],
  facets: [
    {
      key: "modificationType",
      label: "Type",
      valueOf: (row) => row.modificationType,
    },
    {
      key: "grade",
      label: "Grade",
      valueOf: (row) => (row.grade == null ? null : String(row.grade)),
      compare: (left, right) => Number(left) - Number(right),
    },
    {
      key: "requiresShipSize",
      label: "Ship size",
      valueOf: (row) => row.requiresShipSize,
      compare: (left, right) =>
        SHIP_SIZE_ORDER.indexOf(left) - SHIP_SIZE_ORDER.indexOf(right),
    },
  ],
};

/**
 * Sixty-seven ventures, and a player is only ever eligible for a slice of
 * them. Both facets are gates rather than descriptions: the station whose rank
 * is required, and the character class whose levels are. Between them they
 * turn the list into "what can I take" instead of "what exists".
 */
const starshipVentures: ListConfig<StarshipVentureSummary> = {
  defaultSort: "name",
  striped: true,
  compactLine: (row) =>
    row.prerequisite ? `Requires ${row.prerequisite}` : "No prerequisite",
  columns: [
    nameColumn(),
    {
      key: "deployment",
      header: "Deployment",
      className: FROM_SMALL,
      sortValue: (row) => row.deployment,
      render: (row) =>
        row.deployment ? <Badge accent="indigo">{row.deployment}</Badge> : em,
    },
    {
      key: "characterClass",
      header: "Class",
      className: FROM_MEDIUM,
      sortValue: (row) => row.characterClass,
      render: (row) =>
        row.characterClass ? (
          <Badge accent="violet">{row.characterClass}</Badge>
        ) : (
          em
        ),
    },
    {
      key: "prerequisite",
      header: "Prerequisite",
      className: FROM_LARGE,
      render: (row) => mutedOr(row.prerequisite),
    },
  ],
  facets: [
    {
      key: "deployment",
      label: "Deployment",
      valueOf: (row) => row.deployment,
    },
    { key: "characterClass", label: "Class", valueOf: (row) => row.characterClass },
  ],
};

/**
 * Thirteen chapters, which are read in order rather than looked up by name, so
 * this is the one list on the site that does not sort alphabetically.
 */
const starshipRules: ListConfig<StarshipRuleSummary> = {
  defaultSort: "chapterNumber",
  compactLine: (row) =>
    row.chapterNumber == null ? null : `Chapter ${row.chapterNumber}`,
  // The name has to come first: a list's opening cell is the row header and
  // carries the link, whatever the column declares.
  columns: [
    nameColumn(),
    {
      key: "chapterNumber",
      header: "Chapter",
      numeric: true,
      sortValue: (row) => row.chapterNumber,
      render: (row) =>
        row.chapterNumber == null ? (
          em
        ) : (
          <Badge className="badge-numeric" accent="green">
            {row.chapterNumber}
          </Badge>
        ),
    },
  ],
  facets: [],
};

function ratingValue(rating: string): number {
  if (rating.includes("/")) {
    const [numerator, denominator] = rating.split("/").map(Number);
    return denominator ? numerator / denominator : 0;
  }
  return Number(rating);
}

const CONFIGS = {
  species,
  classes,
  "class-improvements": classImprovements,
  archetypes,
  features,
  backgrounds,
  feats,
  powers,
  maneuvers,

  // Styles and masteries share one declaration, and so do focuses and
  // supremacies. They are separate content types with separate routes and
  // separate counts, but the pair in each case is the same list of choices at
  // two career points, and giving them two copies of one table would only
  // create somewhere for the copies to drift apart.
  "fighting-styles": fightingOptions,
  "fighting-masteries": fightingOptions,
  "lightsaber-forms": lightsaberForms,
  "weapon-focuses": weaponTraining,
  "weapon-supremacies": weaponTraining,

  equipment,
  monsters,
  "starship-base-sizes": starshipBaseSizes,
  "starship-deployments": starshipDeployments,
  "starship-equipment": starshipEquipment,
  "starship-modifications": starshipModifications,
  "starship-ventures": starshipVentures,
  "starship-rules": starshipRules,
} as const;

export function getListConfig(type: ContentTypeId): ListConfig<AnySummary> {
  return CONFIGS[type] as unknown as ListConfig<AnySummary>;
}
