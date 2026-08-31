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
  ContentTypeId,
  EquipmentSummary,
  FeatSummary,
  FightingOptionSummary,
  LightsaberFormSummary,
  ManeuverSummary,
  MonsterSummary,
  PowerSummary,
  SpeciesSummary,
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

function ratingValue(rating: string): number {
  if (rating.includes("/")) {
    const [numerator, denominator] = rating.split("/").map(Number);
    return denominator ? numerator / denominator : 0;
  }
  return Number(rating);
}

const CONFIGS = {
  species,
  archetypes,
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
} as const;

export function getListConfig(type: ContentTypeId): ListConfig<AnySummary> {
  return CONFIGS[type] as unknown as ListConfig<AnySummary>;
}
