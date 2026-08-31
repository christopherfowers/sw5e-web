/**
 * Where each content type sits in the site's navigation.
 *
 * The header used to be one flat strip of every content type. That worked at
 * eight and was already scrolling at nineteen; at twenty-two it is a horizontal
 * list nobody can hold in their head, and every type added makes it worse. The
 * fix is not a longer strip or a smaller font — it is that the types are not a
 * flat set. They fall into a handful of subjects a reader is actually in the
 * middle of: building a character, resolving a fight, buying gear, flying a
 * ship, running a creature, looking a rule up.
 *
 * So the header carries the subjects and each subject reveals its types.
 *
 * The number of groups is not a target. It falls out of the material, and it
 * will change: `gear` has one type today and will have four once enhanced items
 * and the two property glossaries land. What must not change is that every type
 * declares where it belongs, which is why `TYPE_NAV` below is a
 * `Record<ContentTypeId, TypePlacement>` rather than a partial map with a
 * fallback. A type that declares nothing is a compile error naming the type.
 * Without that, the strip goes flat again the first time someone is in a hurry:
 * a missing entry would simply not appear in navigation, and nothing would say
 * so. `SummaryByType` in `./types.ts` is exhaustive for the same reason.
 *
 * Two distinctions are encoded here beyond the group itself.
 *
 * `prominence` separates the types a reader browses from the types a reader
 * is *sent to*. Nobody opens `/class-improvements` to read it end to end; they
 * arrive from a class that grants one. A supporting type keeps its index page,
 * its prerendered routes and its place in search — it just does not compete for
 * room with the six things people actually browse.
 *
 * `group: "none"` is the escape hatch, and it is deliberately not the default.
 * The credits types — the people who made this and the artwork they made — are
 * site metadata rather than game content. They belong in the footer, which
 * already links them, and they must never appear in content navigation. Saying
 * so explicitly costs one line and means the exhaustiveness check above still
 * catches a type someone forgot to think about.
 *
 * Not modelled here, on purpose:
 *
 *   Tools — the character builder, the ship builder, PDF export — will be a
 *   peer of these groups in the header, not a group inside it. It is not a
 *   subject of the reference; it is a different thing to do with the reference.
 *   It gets its own entry in the header when it exists rather than a seventh
 *   empty section now.
 *
 *   Homebrew — a facet on the types that already exist, not a section. A
 *   homebrew power is a power. It belongs in the powers index behind a filter,
 *   which is why nothing here is shaped as "official" versus "community": that
 *   shape would force homebrew to become a group, and then every type would
 *   need a second home.
 */

import { TYPE_ORDER } from "./type-meta";
import type { ContentTypeId } from "./types";

export type NavGroupId =
  | "characters"
  | "combat"
  | "gear"
  | "starships"
  | "bestiary"
  | "reference";

/**
 * How a type is reached.
 *
 * A discriminated union rather than an optional group, so that "this type is
 * not game content" cannot be written as an accident of omission and a type
 * outside every group cannot also claim to be a primary destination.
 */
export type TypePlacement =
  | {
      group: NavGroupId;
      /**
       * `primary` types are what the group's menu is for. `supporting` types
       * are listed under them, quieter: reachable, indexed, crawlable, but not
       * competing for the reader's attention with a destination nobody browses.
       */
      prominence: "primary" | "supporting";
    }
  | {
      group: "none";
      /** Why this type is not in content navigation. Required, so it is a decision. */
      reason: string;
    };

/**
 * The group order in the header. It follows the order a table reaches the
 * material: you make a character, you fight with it, you equip it, you acquire
 * a ship, you meet something, and you look up the rule for what just happened.
 */
export const NAV_GROUP_ORDER: NavGroupId[] = [
  "characters",
  "combat",
  "gear",
  "starships",
  "bestiary",
  "reference",
];

export interface NavGroupMeta {
  /** The word in the header. */
  label: string;
  /** Read out with the menu, and shown at the top of the sidebar. */
  blurb: string;
}

export const NAV_GROUP_META: Record<NavGroupId, NavGroupMeta> = {
  characters: {
    label: "Characters",
    blurb: "What a character is and what it becomes.",
  },
  combat: {
    label: "Combat",
    blurb: "Everything a character chooses from to act in a fight.",
  },
  gear: {
    label: "Gear",
    blurb: "What a character carries, and what its properties mean.",
  },
  starships: {
    label: "Starships",
    blurb: "Hulls, stations, parts and the rules for flying them.",
  },
  bestiary: {
    label: "Bestiary",
    blurb: "Stat blocks for everything you might meet.",
  },
  reference: {
    label: "Reference",
    blurb: "The books themselves and the tables they send you to.",
  },
};

/**
 * Destinations in a group that are not content types.
 *
 * `/sources` is a real page over the whole dataset rather than a type index, so
 * it has no `ContentTypeId` and cannot be placed by `TYPE_NAV`. It is still one
 * of the things a reader is looking for when they open Reference.
 */
export interface NavDestination {
  to: string;
  label: string;
}

const GROUP_EXTRAS: Partial<Record<NavGroupId, NavDestination[]>> = {
  reference: [{ to: "/sources", label: "Source books" }],
};

/**
 * Every content type, placed.
 *
 * Indexed by `ContentTypeId`, so adding a type to `CONTENT_TYPE_IDS` without
 * adding it here fails `npm run typecheck` with the type's own name in the
 * message. That is the whole point of this file — see the header comment.
 */
export const TYPE_NAV: Record<ContentTypeId, TypePlacement> = {
  species: { group: "characters", prominence: "primary" },
  classes: { group: "characters", prominence: "primary" },
  archetypes: { group: "characters", prominence: "primary" },
  features: { group: "characters", prominence: "primary" },
  backgrounds: { group: "characters", prominence: "primary" },
  feats: { group: "characters", prominence: "primary" },
  /*
    Reached from the class that grants it, never browsed. Thirty rows that only
    mean anything next to a class table.
  */
  "class-improvements": { group: "characters", prominence: "supporting" },

  powers: { group: "combat", prominence: "primary" },
  maneuvers: { group: "combat", prominence: "primary" },
  "fighting-styles": { group: "combat", prominence: "primary" },
  "fighting-masteries": { group: "combat", prominence: "primary" },
  "lightsaber-forms": { group: "combat", prominence: "primary" },
  "weapon-focuses": { group: "combat", prominence: "primary" },
  "weapon-supremacies": { group: "combat", prominence: "primary" },

  equipment: { group: "gear", prominence: "primary" },

  monsters: { group: "bestiary", prominence: "primary" },

  "starship-base-sizes": { group: "starships", prominence: "primary" },
  "starship-deployments": { group: "starships", prominence: "primary" },
  "starship-equipment": { group: "starships", prominence: "primary" },
  "starship-modifications": { group: "starships", prominence: "primary" },
  "starship-ventures": { group: "starships", prominence: "primary" },
  "starship-rules": { group: "starships", prominence: "primary" },
};

/** One group, resolved into the destinations it offers. */
export interface NavGroup {
  id: NavGroupId;
  label: string;
  blurb: string;
  /** Content types a reader browses. */
  primary: ContentTypeId[];
  /** Content types reached from something else, listed quietly. */
  supporting: ContentTypeId[];
  /** Pages in this group that are not content types, such as `/sources`. */
  extras: NavDestination[];
}

/**
 * Resolves the placement table into the groups the header renders.
 *
 * Takes its inputs rather than reading the module constants so that the
 * exclusion rule can be tested against a type that is excluded — there is no
 * such type in the published set today, and a rule with no test is a rule that
 * stops working the moment one arrives.
 *
 * Empty groups are dropped. A group with nothing in it is not a shape to
 * preserve; `gear` and `reference` both grow as content lands, and until then
 * the header should not advertise a menu with nothing behind it.
 */
export function buildNavigation(
  order: readonly string[],
  placements: Readonly<Record<string, TypePlacement>>,
  extras: Readonly<Partial<Record<NavGroupId, NavDestination[]>>> = GROUP_EXTRAS,
): NavGroup[] {
  return NAV_GROUP_ORDER.map((id) => {
    const primary: ContentTypeId[] = [];
    const supporting: ContentTypeId[] = [];

    for (const type of order) {
      const placement = placements[type];
      if (!placement || placement.group !== id) continue;
      const bucket = placement.prominence === "primary" ? primary : supporting;
      bucket.push(type as ContentTypeId);
    }

    return {
      id,
      label: NAV_GROUP_META[id].label,
      blurb: NAV_GROUP_META[id].blurb,
      primary,
      supporting,
      extras: extras[id] ?? [],
    };
  }).filter(
    (group) =>
      group.primary.length + group.supporting.length + group.extras.length > 0,
  );
}

/**
 * How many places a group leads to. Used to decide whether it needs a menu at
 * all: a group with exactly one destination *is* that destination, and putting
 * it behind a disclosure would be a button whose only job is to reveal a single
 * link. `bestiary` is one type today and `gear` is one until enhanced items
 * land, so this is the difference between a sensible header now and a header
 * that has to be rewritten when they do.
 */
export function destinationCount(group: NavGroup): number {
  return group.primary.length + group.supporting.length + group.extras.length;
}

/** The single destination a one-destination group stands for. */
export function soleDestination(group: NavGroup): NavDestination | null {
  if (destinationCount(group) !== 1) return null;
  const type = group.primary[0] ?? group.supporting[0];
  if (type) return { to: `/${type}`, label: group.label };
  return { ...group.extras[0]!, label: group.label };
}

/** Which group a content type belongs to, or null if it is not in navigation. */
export function groupOfType(type: ContentTypeId): NavGroupId | null {
  const placement = TYPE_NAV[type];
  return placement.group === "none" ? null : placement.group;
}

export const NAVIGATION: NavGroup[] = buildNavigation(TYPE_ORDER, TYPE_NAV);
