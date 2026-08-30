/**
 * What each content type's index page shows, filters on, and sorts by.
 *
 * A creature list needs challenge rating; a power list needs level and casting
 * time; an equipment list needs cost and damage. Rendering one generic table
 * eight times would bury exactly the columns a reader is scanning for at the
 * table mid-game, so every type declares its own.
 */

import type { ReactNode } from "react";

import type {
  AnySummary,
  ArchetypeSummary,
  BackgroundSummary,
  ContentTypeId,
  EquipmentSummary,
  FeatSummary,
  ManeuverSummary,
  MonsterSummary,
  PowerSummary,
  SpeciesSummary,
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

export interface ListConfig<Row> {
  columns: Column<Row>[];
  facets: Facet<Row>[];
  defaultSort: string;
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

const sourceFacet = <Row extends { source: string | null }>(): Facet<Row> => ({
  key: "source",
  label: "Source",
  valueOf: (row) => row.source,
});

const species: ListConfig<SpeciesSummary> = {
  defaultSort: "name",
  compactLine: (row) => joinParts([row.size, row.homeworld]),
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
  columns: [
    nameColumn(),
    {
      key: "className",
      header: "Class",
      className: FROM_SMALL,
      sortValue: (row) => row.className,
      render: (row) => textOr(row.className),
    },
    {
      key: "casterType",
      header: "Casting",
      className: FROM_MEDIUM,
      render: (row) => textOr(row.casterType),
    },
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
      render: (row) => textOr(row.skillProficiencies),
    },
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
      render: (row) => textOr(row.prerequisite),
    },
    {
      key: "abilityIncreases",
      header: "Ability increases",
      className: FROM_MEDIUM,
      render: (row) => textOr(row.abilityIncreases),
    },
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
      render: (row) => (row.level === 0 ? "At-will" : row.level),
    },
    {
      key: "powerType",
      header: "Type",
      className: FROM_SMALL,
      sortValue: (row) => row.powerType,
      render: (row) => textOr(row.powerType),
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
      render: (row) => textOr(row.range),
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
  compactLine: (row) => row.kind,
  columns: [
    nameColumn(),
    {
      key: "kind",
      header: "Type",
      className: FROM_SMALL,
      sortValue: (row) => row.kind,
      render: (row) => textOr(row.kind),
    },
    {
      key: "prerequisite",
      header: "Prerequisite",
      className: FROM_MEDIUM,
      render: (row) => textOr(row.prerequisite),
    },
  ],
  facets: [
    { key: "kind", label: "Type", valueOf: (row) => row.kind },
    sourceFacet(),
  ],
};

const equipment: ListConfig<EquipmentSummary> = {
  defaultSort: "name",
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
      render: (row) => textOr(row.category),
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
  ],
  facets: [
    { key: "category", label: "Category", valueOf: (row) => row.category },
    sourceFacet(),
  ],
};

const monsters: ListConfig<MonsterSummary> = {
  defaultSort: "name",
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
      render: (row) => textOr(row.challengeRating),
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
      render: (row) => textOr(row.size),
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
  equipment,
  monsters,
} as const;

export function getListConfig(type: ContentTypeId): ListConfig<AnySummary> {
  return CONFIGS[type] as unknown as ListConfig<AnySummary>;
}
