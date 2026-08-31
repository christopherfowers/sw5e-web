/**
 * Editorial metadata about each content type: how it is introduced on the
 * home page, how it is named in navigation, and what colour it carries.
 * This is presentation, not data, so it lives with the UI rather than in the
 * generated dataset.
 *
 * The `accent` is a hue name, not a hex value. `app/app.css` defines a light
 * and a dark value for each one, which is what lets an equipment page read as
 * an equipment page in both themes without a component knowing either colour.
 *
 * There are more types than hues, so hues repeat. Where they repeat by
 * necessity that is all it is, but four of them share indigo deliberately:
 * classes, class improvements, archetypes and features are not four subjects
 * but one graph. A reader who opens a class, follows it to an archetype and
 * follows that to a feature has not changed subject, and a colour that changed
 * under them at each step would say they had. The types are still told apart
 * at a glance by their marks in `app/components/type-icon.tsx` and by their
 * names; here the hue carries the family.
 */

import type { ContentTypeId } from "./types";

/** The named hues the design system exposes. See `--hue-*` in app.css. */
export type Accent =
  | "amber"
  | "clay"
  | "cyan"
  | "green"
  | "indigo"
  | "red"
  | "rose"
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
  classes: {
    plural: "Classes",
    singular: "Class",
    blurb: "The ten classes, level by level: hit dice, proficiencies, casting.",
    accent: "indigo",
  },
  "class-improvements": {
    plural: "Class improvements",
    singular: "Class improvement",
    blurb: "What each class is worth to a character multiclassing in or out.",
    accent: "indigo",
  },
  archetypes: {
    plural: "Archetypes",
    singular: "Archetype",
    blurb: "Specialisations that branch off each class, with their features.",
    accent: "indigo",
  },
  features: {
    plural: "Features",
    singular: "Feature",
    blurb: "Every ability a class or archetype grants, by the level it arrives.",
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
  /*
    Enhanced items get a hue of their own rather than sharing equipment's
    steel. They are the largest type in the corpus and the one a reader is most
    often hunting through, and the distinction between "gear you buy" and "gear
    you find" is exactly the one a colour should be carrying here.
  */
  "enhanced-items": {
    plural: "Enhanced items",
    singular: "Enhanced item",
    blurb: "Found and crafted gear by rarity: artefacts, modifications, augmentations and consumables.",
    accent: "rose",
  },
  /*
    Both property glossaries take equipment's steel on purpose. They are not a
    catalogue of their own — they are the definitions an equipment row points
    into when it says "burst 2" or "strength 13" — so sharing the hue says
    where they belong.
  */
  "weapon-properties": {
    plural: "Weapon properties",
    singular: "Weapon property",
    blurb: "What burst, versatile and reload actually do to a weapon.",
    accent: "steel",
  },
  "armor-properties": {
    plural: "Armor properties",
    singular: "Armor property",
    blurb: "What absorptive, bulky and powered actually do to armor and shields.",
    accent: "steel",
  },
  monsters: {
    plural: "Creatures",
    singular: "Creature",
    blurb: "Stat blocks: armor class, hit points, senses and behaviors.",
    accent: "red",
  },
  // Starship play. The six share no single hue: a reader arriving from the
  // navigation is choosing between them, so they have to be told apart the
  // same way the character types are.
  "starship-base-sizes": {
    plural: "Starship hulls",
    singular: "Hull",
    blurb: "The six ship sizes, with hull dice, roles and the tier table each advances on.",
    accent: "steel",
  },
  "starship-deployments": {
    plural: "Deployments",
    singular: "Deployment",
    blurb: "The stations a character serves at aboard a ship, rank by rank.",
    accent: "indigo",
  },
  "starship-equipment": {
    plural: "Ship equipment",
    singular: "Ship part",
    blurb: "Weapons, ammunition, armor, shields, reactors, couplings and hyperdrives.",
    accent: "cyan",
  },
  "starship-modifications": {
    plural: "Modifications",
    singular: "Modification",
    blurb: "Upgrades bought with a hull's modification slots, and what each one needs first.",
    accent: "amber",
  },
  "starship-ventures": {
    plural: "Ventures",
    singular: "Venture",
    blurb: "Talents a crewmember earns at every rank, and the ranks they are gated behind.",
    accent: "violet",
  },
  "starship-rules": {
    plural: "Starship rules",
    singular: "Rules chapter",
    blurb: "The rulebook itself: flying, fighting, repairing and outfitting a ship.",
    accent: "green",
  },
  /*
    Rules and reference tables share clay for the same reason the properties
    share steel: they are one body of material, the books' prose and the tables
    that prose cites, and a reader moving between them is doing one job.
  */
  rules: {
    plural: "Rules",
    singular: "Rule",
    blurb: "The books themselves, chapter by chapter, plus the optional variant rules.",
    accent: "clay",
  },
  "reference-tables": {
    plural: "Reference tables",
    singular: "Reference table",
    blurb: "The standalone tables the rules send you to: costs, capacities, travel times.",
    accent: "clay",
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
 *
 * Gear runs equipment, then the enhanced items that are its found and crafted
 * counterpart, then the two glossaries both of them point into: a reader who
 * has just read "burst 2" on a weapon row is one link from what burst does.
 * The rules material goes last, because it is what a reader turns to when the
 * catalogue has not answered the question.
 */
export const TYPE_ORDER: ContentTypeId[] = [
  "species",
  "classes",
  "class-improvements",
  "archetypes",
  "features",
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
  "enhanced-items",
  "weapon-properties",
  "armor-properties",
  "monsters",
  "starship-base-sizes",
  "starship-deployments",
  "starship-equipment",
  "starship-modifications",
  "starship-ventures",
  "starship-rules",
  "rules",
  "reference-tables",
];
