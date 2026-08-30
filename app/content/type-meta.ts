/**
 * Editorial metadata about each content type: how it is introduced on the
 * home page and how it is named in navigation. This is presentation, not data,
 * so it lives with the UI rather than in the generated dataset.
 */

import type { ContentTypeId } from "./types";

export interface TypeMeta {
  /** Plural noun used in navigation and page titles. */
  plural: string;
  /** Singular noun used in breadcrumbs and result labels. */
  singular: string;
  /** One line explaining what a reader will find. */
  blurb: string;
}

export const TYPE_META: Record<ContentTypeId, TypeMeta> = {
  species: {
    plural: "Species",
    singular: "Species",
    blurb: "Playable species, their traits, homeworlds and physical range.",
  },
  archetypes: {
    plural: "Archetypes",
    singular: "Archetype",
    blurb: "Specialisations that branch off each class, with their features.",
  },
  backgrounds: {
    plural: "Backgrounds",
    singular: "Background",
    blurb: "Where a character came from: proficiencies, features, roll tables.",
  },
  feats: {
    plural: "Feats",
    singular: "Feat",
    blurb: "Optional talents and their prerequisites.",
  },
  powers: {
    plural: "Powers",
    singular: "Power",
    blurb: "Force and tech powers by level, casting time and range.",
  },
  maneuvers: {
    plural: "Maneuvers",
    singular: "Maneuver",
    blurb: "Superiority-die maneuvers for physical and mental combat.",
  },
  equipment: {
    plural: "Equipment",
    singular: "Item",
    blurb: "Weapons, armor and gear with cost, weight and damage.",
  },
  monsters: {
    plural: "Creatures",
    singular: "Creature",
    blurb: "Stat blocks: armor class, hit points, senses and behaviors.",
  },
};

/** Navigation order, shared by the header and the home page. */
export const TYPE_ORDER: ContentTypeId[] = [
  "species",
  "archetypes",
  "backgrounds",
  "feats",
  "powers",
  "maneuvers",
  "equipment",
  "monsters",
];
