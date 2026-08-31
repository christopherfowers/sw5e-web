/**
 * Editorial metadata about each content type: how it is introduced on the
 * home page, how it is named in navigation, and what colour it carries.
 * This is presentation, not data, so it lives with the UI rather than in the
 * generated dataset.
 *
 * The `accent` is a hue name, not a hex value. `app/app.css` defines a light
 * and a dark value for each one, which is what lets an equipment page read as
 * an equipment page in both themes without a component knowing either colour.
 */

import type { ContentTypeId } from "./types";

/** The named hues the design system exposes. See `--hue-*` in app.css. */
export type Accent =
  | "amber"
  | "cyan"
  | "green"
  | "indigo"
  | "red"
  | "steel"
  | "teal"
  | "violet";

export interface TypeMeta {
  /** Plural noun used in navigation and page titles. */
  plural: string;
  /** Singular noun used in breadcrumbs and result labels. */
  singular: string;
  /** One line explaining what a reader will find. */
  blurb: string;
  /** The hue this type is drawn in across cards, rules and badges. */
  accent: Accent;
}

export const TYPE_META: Record<ContentTypeId, TypeMeta> = {
  species: {
    plural: "Species",
    singular: "Species",
    blurb: "Playable species, their traits, homeworlds and physical range.",
    accent: "teal",
  },
  archetypes: {
    plural: "Archetypes",
    singular: "Archetype",
    blurb: "Specialisations that branch off each class, with their features.",
    accent: "indigo",
  },
  backgrounds: {
    plural: "Backgrounds",
    singular: "Background",
    blurb: "Where a character came from: proficiencies, features, roll tables.",
    accent: "green",
  },
  feats: {
    plural: "Feats",
    singular: "Feat",
    blurb: "Optional talents and their prerequisites.",
    accent: "amber",
  },
  powers: {
    plural: "Powers",
    singular: "Power",
    blurb: "Force and tech powers by level, casting time and range.",
    accent: "violet",
  },
  maneuvers: {
    plural: "Maneuvers",
    singular: "Maneuver",
    blurb: "Superiority-die maneuvers for physical and mental combat.",
    accent: "cyan",
  },
  "fighting-styles": {
    plural: "Fighting Styles",
    singular: "Fighting Style",
    blurb: "Early specialisations in one way of fighting, and what each grants.",
    accent: "amber",
  },
  "fighting-masteries": {
    plural: "Fighting Masteries",
    singular: "Fighting Mastery",
    blurb: "The late-career counterparts to the fighting styles.",
    accent: "red",
  },
  "lightsaber-forms": {
    plural: "Lightsaber Forms",
    singular: "Lightsaber Form",
    blurb: "Stances adopted as a bonus action, and what each does while held.",
    accent: "violet",
  },
  "weapon-focuses": {
    plural: "Weapon Focuses",
    singular: "Weapon Focus",
    blurb: "Training in one weapon group, from Wretched Hives.",
    accent: "steel",
  },
  "weapon-supremacies": {
    plural: "Weapon Supremacies",
    singular: "Weapon Supremacy",
    blurb: "The higher tier of weapon-group training, one per group.",
    accent: "indigo",
  },
  equipment: {
    plural: "Equipment",
    singular: "Item",
    blurb: "Weapons, armor and gear with cost, weight and damage.",
    accent: "steel",
  },
  monsters: {
    plural: "Creatures",
    singular: "Creature",
    blurb: "Stat blocks: armor class, hit points, senses and behaviors.",
    accent: "red",
  },
};

/**
 * Navigation order, shared by the header and the home page.
 *
 * The order follows how a character is put together — what you are, what you
 * become, what you can do, what you carry — and the six combat options sit
 * together in the middle of that because they are all answers to the same
 * question. Maneuvers lead the group: they are the largest of the six by an
 * order of magnitude and the one a reader arrives looking for.
 */
export const TYPE_ORDER: ContentTypeId[] = [
  "species",
  "archetypes",
  "backgrounds",
  "feats",
  "powers",
  "maneuvers",
  "fighting-styles",
  "fighting-masteries",
  "lightsaber-forms",
  "weapon-focuses",
  "weapon-supremacies",
  "equipment",
  "monsters",
];
