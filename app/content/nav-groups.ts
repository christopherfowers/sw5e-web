/**
 * The site's navigation: five subjects, and the ordered list of places each one
 * leads.
 *
 * The header used to be one flat strip of every content type. That worked at
 * eight and was already scrolling at nineteen; at twenty-seven it is a
 * horizontal list nobody can hold in their head. The fix is not a longer strip
 * or a smaller font — it is that the types are not a flat set. They fall into a
 * handful of subjects a reader is actually in the middle of: looking a rule up,
 * building a character, buying gear, flying a ship, running a creature.
 *
 * What changed in this file, and why it is the interesting part:
 *
 * A group's menu used to be "the content types filed under it", computed from
 * `TYPE_NAV`. That is no longer expressible, because the menu the site wants
 * contains four kinds of thing and only one of them is a content type:
 *
 *   - Books. "Player's Handbook" is `/sources/phb`, a page over the whole
 *     dataset. There is no `ContentTypeId` for a book and there should not be.
 *   - Filtered slices of a type. "Weapons" is 215 of the 505 equipment
 *     documents; "Variant rules" is 40 of the 75 rule documents. See
 *     `./subcategory-views.ts` for why those are paths with files behind them
 *     rather than query strings.
 *   - A hub. "Customization options" is one entry standing for nine lists,
 *     because the Player's Handbook introduces them together in one chapter and
 *     nine boxes in a menu is nine answers to a question the reader has asked
 *     once.
 *   - A type index, which is the only case the old model could express.
 *
 * So a menu is now an ordered list of destinations, written out. It is an
 * editorial artifact — the order and the wording are decisions, not a
 * projection of the data — and writing it out is the honest way to hold it.
 *
 * The property that made the old file worth having must not be lost in that
 * move, so it has been split into the two questions it was answering at once:
 *
 *   1. "Which subject is this type part of?" stays a compile-time obligation.
 *      `TYPE_NAV` is a `Record<ContentTypeId, TypePlacement>` rather than a
 *      partial map with a fallback, so a type added to `CONTENT_TYPE_IDS`
 *      without being placed fails `npm run typecheck` with its own name in the
 *      message. That is what drives the rail beside the page, and it is what
 *      stops a new type being nobody's business.
 *   2. "And how does a reader get to it?" is now a separate question, because a
 *      type can belong to a subject and still have no way in — the menu is
 *      hand-written, so nothing about placing a type puts a link on screen.
 *      `nav-groups.test.ts` answers it against the dataset: every type must
 *      either have its own index in a menu, be named by a hub, or have every
 *      one of its rows claimed by the subcategory views the menus offer. That
 *      last clause is the one worth having — it is what fails when somebody
 *      gives ammunition its own view and quietly takes 50 rows out of
 *      `/other-equipment`.
 *
 * `group: "none"` is the escape hatch for question 1, and it is deliberately
 * not the default. The credits types — the people who made this and the artwork
 * they made — are site metadata rather than game content. They belong in the
 * footer, which already links them, and they must never appear in content
 * navigation. Saying so explicitly costs one line, keeps the exhaustiveness
 * check catching a type somebody forgot to think about, and exempts the type
 * from question 2 as well.
 *
 * Not modelled here, on purpose:
 *
 *   Resources — two character sheets, two starship sheets and an archive on
 *   Google Drive. A sixth menu was asked for and is not built, because nobody
 *   has supplied the five addresses and a menu of dead links is worse than no
 *   menu. It is five entries in `GROUP_MENUS` the day the URLs exist.
 *
 *   Vehicle and starship stat blocks. Asked for under NPC statblocks, and there
 *   is nothing to point at: all 271 creature documents carry `type: null` and
 *   the corpus has no vehicle stat block at all. An entry would be a link to a
 *   filter that matches nothing.
 *
 *   Tools — the character builder, the ship builder, PDF export — will be a
 *   peer of these groups in the header, not a group inside it. It is not a
 *   subject of the reference; it is a different thing to do with the reference.
 *
 *   Homebrew — a facet on the types that already exist, not a section. A
 *   homebrew power is a power. It belongs in the powers index behind a filter,
 *   which is why nothing here is shaped as "official" versus "community": that
 *   shape would force homebrew to become a group, and then every type would
 *   need a second home.
 */

import { SOURCE_META } from "./source-meta";
import { requireSubcategoryView, type SubcategoryView } from "./subcategory-views";
import { TYPE_META, type Accent } from "./type-meta";
import type { ContentTypeId } from "./types";

export type NavGroupId =
  | "rules"
  | "characters"
  | "equipment"
  | "starships"
  | "statblocks";

/**
 * Which subject a type is part of.
 *
 * A discriminated union rather than an optional group, so that "this type is
 * not game content" cannot be written as an accident of omission.
 *
 * There is no `prominence` here any more. It used to live on the type, which
 * was the only place it could live when the menu was computed from this table;
 * now that a menu is written out, how loudly a destination is offered is a
 * property of the entry in that menu rather than of the type. Keeping both
 * would be two places to say one thing, and the one that was not read would
 * quietly go wrong.
 */
export type TypePlacement =
  | { group: NavGroupId }
  | {
      group: "none";
      /** Why this type is not in content navigation. Required, so it is a decision. */
      reason: string;
    };

/**
 * The group order in the header, which is the owner's own.
 *
 * It opens with the books rather than with the catalogue, for the reason the
 * front page was reordered: a reader who does not yet know the game needs the
 * rules before they need a list of things to choose from. Everything after that
 * follows the order a table reaches the material — you make a character, you
 * equip it, you acquire a ship, and then you meet something.
 */
export const NAV_GROUP_ORDER: NavGroupId[] = [
  "rules",
  "characters",
  "equipment",
  "starships",
  "statblocks",
];

export interface NavGroupMeta {
  /** The word in the header. */
  label: string;
  /** Read out with the menu, and shown at the top of the rail. */
  blurb: string;
}

export const NAV_GROUP_META: Record<NavGroupId, NavGroupMeta> = {
  rules: {
    label: "Rules",
    blurb: "The books themselves, and the optional rules a table can turn on.",
  },
  characters: {
    label: "Characters",
    blurb: "What a character is, what it becomes, and what it can do.",
  },
  /*
    "Equipment", not "Gear". The heading a reader is looking for is the one the
    book uses — Equipment is chapter 5 of the Player's Handbook — and a menu
    named after a category the reader has never seen in print makes them open it
    to find out what is inside.
  */
  equipment: {
    label: "Equipment",
    blurb: "What a character carries, and what its properties mean.",
  },
  starships: {
    label: "Starships",
    blurb: "Hulls, stations, parts and the rules for flying them.",
  },
  /*
    "NPC statblocks" rather than "Bestiary", which is what this group was
    called. Bestiary is the word a publisher uses on a spine; statblock is the
    word a games master types into a search box at the table.
  */
  statblocks: {
    label: "NPC statblocks",
    blurb: "Stat blocks for everything you might meet.",
  },
};

/**
 * One place a menu entry leads.
 *
 * The four arms are the four kinds of thing the menus contain, and they are
 * kept apart rather than flattened to `{ to, label }` because two things other
 * than the anchor depend on knowing which is which. The front page draws a card
 * per destination and needs its blurb, its icon and its hue, all of which come
 * from somewhere different in each case. And the reachability check in
 * `nav-groups.test.ts` has to tell a type index — which covers its type on its
 * own — from a subcategory view, which only covers its type together with its
 * siblings.
 */
export type NavDestination = {
  /** The address. */
  to: string;
  /** The words in the menu. Always written out: see `GROUP_MENUS`. */
  label: string;
  /**
   * `primary` entries are what the menu is for. `supporting` entries are listed
   * under them, quieter: reachable, indexed, crawlable, but not competing for
   * the reader's attention with a destination nobody browses.
   */
  prominence: "primary" | "supporting";
} & (
  | { kind: "type"; type: ContentTypeId }
  | { kind: "view"; view: SubcategoryView }
  | { kind: "book"; code: string }
  | {
      kind: "page";
      /**
       * The types whose own index this page links. It is a claim about what
       * the page renders, and `customization-options.test.tsx` holds the page
       * to it — otherwise a hub could go on claiming to cover six types after
       * somebody deleted three cards from it.
       *
       * A type belongs here only if the page leads to the whole of it. That is
       * why the class improvements are not in the hub's `covers` even though
       * the hub is where a reader finds them: what the hub links is three cuts
       * of that type, and three cuts add up to the type only while every row
       * lands on one of them. That is a question about the dataset, so it is
       * asked of the dataset — see `offers` and `nav-groups.test.ts`.
       */
      covers: readonly ContentTypeId[];
      /**
       * The filtered views this page links, beside the indexes in `covers`.
       *
       * Kept apart from `covers` rather than folded into it because the two
       * claims are different strengths and the difference is the whole point:
       * an index covers its type on its own, a view covers its type only
       * together with its siblings. The reachability check treats them as such.
       * The front page also needs them told apart to put an honest number on
       * the card — a hub's count is the sum of what it holds, and half of what
       * this one holds has to be counted by running a predicate.
       */
      offers: readonly SubcategoryView[];
      blurb: string;
      /**
       * A hub has no type to borrow a hue from and needs one anyway: the card
       * on the front page draws a rule down its left edge from
       * `--type-accent`, and an unset custom property there is an invisible
       * card edge rather than a neutral one.
       */
      accent: Accent;
    }
);

type Prominence = NavDestination["prominence"];

/** A content type's own index, under a label the menu chooses. */
function typeIndex(
  type: ContentTypeId,
  label: string,
  prominence: Prominence = "primary",
): NavDestination {
  return { kind: "type", type, to: `/${type}`, label, prominence };
}

/**
 * One of the filtered views in `./subcategory-views.ts`.
 *
 * Resolved through `requireSubcategoryView` rather than by writing the path, so
 * a menu entry pointing at a view that does not exist throws when this module
 * is first imported — which is at the top of every page render and therefore at
 * the very start of the build — instead of shipping a link to an address nginx
 * answers 404 for.
 */
function subcategory(
  slug: string,
  prominence: Prominence = "primary",
): NavDestination {
  const view = requireSubcategoryView(slug);
  return {
    kind: "view",
    view,
    to: `/${view.slug}`,
    label: view.label,
    prominence,
  };
}

/** A book's own page, addressed through `SOURCE_META` so the slug is not typed twice. */
function book(code: string, prominence: Prominence = "primary"): NavDestination {
  const source = SOURCE_META[code];
  if (!source) throw new Error(`No source book is registered for "${code}"`);
  return {
    kind: "book",
    code,
    to: `/sources/${source.slug}`,
    label: source.name,
    prominence,
  };
}

function page(
  to: string,
  label: string,
  blurb: string,
  accent: Accent,
  contents: readonly NavDestination[],
  prominence: Prominence = "primary",
): NavDestination {
  return {
    kind: "page",
    to,
    label,
    blurb,
    accent,
    prominence,
    /*
      The two coverage claims, split out of the one list the page renders, so
      that the page and the claims cannot be written down separately and drift.
      A hub built from a list of destinations knows which of them are indexes
      and which are slices; asking the caller to restate that would be asking
      it to say the same thing twice.
    */
    covers: contents.flatMap((destination) =>
      destination.kind === "type" ? [destination.type] : [],
    ),
    offers: contents.flatMap((destination) =>
      destination.kind === "view" ? [destination.view] : [],
    ),
  };
}

/**
 * What the Customization Options hub holds: the chapter, as a list of places.
 *
 * Written once, here, because three things have to agree about it and
 * disagreeing silently is the failure mode. The menu entry derives its
 * coverage claims from it, `app/routes/customization-options.tsx` renders a
 * card per entry, and the front page puts a count on the hub's own card by
 * adding up what is behind each one. Reading the same array is what makes
 * those three the same statement rather than three statements that happen to
 * match today.
 *
 * The three class-improvement views go last and are the odd ones out — nobody
 * browses a class improvement, they are reached from the class table that
 * grants one — but they are customization options and the chapter says so, so
 * the hub is where they live rather than in a menu nobody would look in.
 *
 * Three entries rather than one, and that is the change this list exists to
 * record. `class-improvements` is a single content type holding three
 * unrelated answers — what advancing in a class gives you, what multiclassing
 * into it gives you, what one splashed level is worth — and the site this one
 * replaces published them as three pages. One merged page of thirty rows hands
 * a reader who asked about multiclassing twenty rows about something else.
 */
export const CUSTOMIZATION_OPTION_DESTINATIONS: readonly NavDestination[] = [
  typeIndex("feats", "Feats"),
  typeIndex("fighting-styles", "Fighting styles"),
  typeIndex("fighting-masteries", "Fighting masteries"),
  typeIndex("lightsaber-forms", "Lightsaber forms"),
  typeIndex("weapon-focuses", "Weapon focuses"),
  typeIndex("weapon-supremacies", "Weapon supremacies"),
  subcategory("class-improvements"),
  subcategory("multiclass-improvements"),
  subcategory("splashclass-improvements"),
];

/**
 * The six types the hub leads to in their entirety.
 *
 * Derived rather than written, and deliberately not the same thing as "the
 * types the hub mentions": the class improvements are on the page and are not
 * in here, because what the page links is three cuts of them. A hub that
 * claimed the type outright would satisfy the reachability check by assertion,
 * and the check would stop looking at the rows — which is precisely the check
 * that would catch a fourth kind of improvement appearing in the archive with
 * no page to land on.
 */
export const CUSTOMIZATION_OPTION_TYPES: readonly ContentTypeId[] =
  CUSTOMIZATION_OPTION_DESTINATIONS.flatMap((destination) =>
    destination.kind === "type" ? [destination.type] : [],
  );

/**
 * The menus, in the order they are offered.
 *
 * This is the owner's table, written down. Where an entry says something the
 * dataset does not — "Character deployments" for `/starship-deployments`,
 * whose type is called Deployments — the menu's word wins, because the menu is
 * read by somebody deciding where to go and the type name is read by somebody
 * already there.
 *
 * The supporting entries at the end of four of these groups are not in that
 * table. They are the types the table does not name and the corpus does have,
 * and they are here rather than nowhere because a published page that nothing
 * links to is a page that exists only for whoever already knows the address.
 * Every one of them is a real destination a reader may want and none of them is
 * a destination a reader browses: the property glossaries are read from the
 * weapon that cites them, features from the class that grants them, the hulls
 * and the starship rules from a ship that has one. If any of these belongs in
 * the loud half of a menu, moving it is one word on one line.
 */
const GROUP_MENUS: Record<NavGroupId, readonly NavDestination[]> = {
  /*
    Three books and two slices of the rule text, which between them are the
    whole of what "rules" means on this site.

    The two slices are the two axes a rule document has. `ruleType` says whether
    a passage is a chapter of a book or an optional rule a table switches on;
    `source` says which book it came from. Variant rules are cut on ruleType
    alone and deliberately not on source: all 40 of them happen to be Expanded
    Content today, but a variant rule printed in a future book is still a
    variant rule — the handbook's own Appendix B is a list of recommended ones —
    and cutting on the book would silently drop it.

    Expanded rules are cut on both: Expanded Content's ten chapters. They need
    an entry of their own because Expanded Content is the one book with no entry
    above — the owner's three are the three that teach something new, and EC's
    chapters extend chapters the other books already have. Its ten chapters
    would otherwise be reachable only through `/sources/ec`, which is a page
    about a book rather than a page about its rules.

    `/rules` itself is supporting rather than absent. Fifteen handbook chapters
    and ten from Wretched Hives are reachable through those books' pages, but
    only there; the index is the one address that holds all seventy-five in
    reading order.
  */
  rules: [
    book("PHB"),
    book("WH"),
    book("SotG"),
    subcategory("variant-rules"),
    subcategory("expanded-rules"),
    typeIndex("rules", "All rules", "supporting"),
    typeIndex("reference-tables", "Reference tables", "supporting"),
    page(
      "/sources",
      "Source books",
      "Every book this reference draws from, and what each one contributes.",
      // Clay is the rules hue. The index of the books belongs to the same body
      // of material as the prose in them.
      "clay",
      // Holds nothing, and therefore covers nothing — deliberately. A book
      // page is a view over every type at once, so letting it claim coverage
      // would make one link to `/sources` satisfy the reachability of the
      // entire corpus.
      [],
      "supporting",
    ),
  ],

  /*
    Twelve entries for fifteen types, which is the point of the hub in the
    middle of them. Force and tech powers are separated here and joined in the data,
    for the reason a reader would expect: nobody is ever choosing between a
    force power and a tech power, because no character casts both from the same
    list.
  */
  characters: [
    typeIndex("species", "Species"),
    typeIndex("classes", "Classes"),
    typeIndex("archetypes", "Archetypes"),
    typeIndex("backgrounds", "Backgrounds"),
    typeIndex("feats", "Feats"),
    page(
      "/customization-options",
      "Customization options",
      "Everything a character takes on top of its class: feats, fighting styles and masteries, lightsaber forms, the weapon tiers and the three kinds of class improvement.",
      // Amber is feats' hue, and feats are the largest of the nine and the one
      // a reader arrives looking for.
      "amber",
      CUSTOMIZATION_OPTION_DESTINATIONS,
    ),
    subcategory("force-powers"),
    subcategory("tech-powers"),
    typeIndex("maneuvers", "Maneuvers"),
    typeIndex("features", "Features", "supporting"),

    /*
      The three cuts of the class improvements, quiet like the features beside
      them and for the same reason: they are read from the class that grants
      one, not browsed. They are in the menu as well as on the hub because the
      hub is a page and this is the header — a reader on `/multiclass-
      improvements` needs the other two beside them without a trip through a
      third address — and because a menu entry is what the reachability check
      reads. Between them they are the whole of the type, which is a claim
      about the rows and is proved against the rows in `nav-groups.test.ts`
      exactly the way the three equipment shelves are.
    */
    subcategory("class-improvements", "supporting"),
    subcategory("multiclass-improvements", "supporting"),
    subcategory("splashclass-improvements", "supporting"),
  ],

  /*
    Three shelves and the enhanced items, and no `/equipment` entry: the three
    shelves are the whole of it, which the reachability test proves against the
    data rather than taking on trust. The index still exists and is still
    prerendered — it is the crumb above every shelf — it just is not a
    destination anybody needs to be offered.
  */
  equipment: [
    subcategory("armor"),
    subcategory("weapons"),
    subcategory("other-equipment"),
    typeIndex("enhanced-items", "Enhanced items"),
    typeIndex("weapon-properties", "Weapon properties", "supporting"),
    typeIndex("armor-properties", "Armor properties", "supporting"),
  ],

  /*
    "Character deployments" and "Character ventures" rather than the types'
    own names, because both are things a person takes and neither is a thing a
    ship has — which is exactly what a reader assumes from a menu called
    Starships unless it says otherwise.

    The hulls are not in the owner's table. They are six documents, they are
    what every modification and every piece of ship equipment is fitted to, and
    dropping them would leave the one page that explains what a ship is
    reachable only from an address somebody already knew.
  */
  starships: [
    typeIndex("starship-deployments", "Character deployments"),
    typeIndex("starship-ventures", "Character ventures"),
    typeIndex("starship-modifications", "Starship modifications"),
    typeIndex("starship-equipment", "Starship equipment"),
    subcategory("starship-weapons"),
    typeIndex("starship-base-sizes", "Starship hulls", "supporting"),
    typeIndex("starship-rules", "Starship rules", "supporting"),
  ],

  /*
    One destination, so the header renders it as a plain link rather than a
    disclosure — see `soleDestination`. Vehicle and starship stat blocks were
    asked for beside it and are not here: there are none in the corpus.
  */
  statblocks: [typeIndex("monsters", "Creatures")],
};

/**
 * Every content type, placed.
 *
 * Indexed by `ContentTypeId`, so adding a type to `CONTENT_TYPE_IDS` without
 * adding it here fails `npm run typecheck` with the type's own name in the
 * message. That is half the point of this file — see the header comment for the
 * other half, which is the test that makes sure the placed type also has a way
 * in.
 */
export const TYPE_NAV: Record<ContentTypeId, TypePlacement> = {
  species: { group: "characters" },
  classes: { group: "characters" },
  archetypes: { group: "characters" },
  features: { group: "characters" },
  backgrounds: { group: "characters" },
  feats: { group: "characters" },
  "fighting-styles": { group: "characters" },
  "fighting-masteries": { group: "characters" },
  "lightsaber-forms": { group: "characters" },
  "weapon-focuses": { group: "characters" },
  "weapon-supremacies": { group: "characters" },
  "class-improvements": { group: "characters" },

  /*
    Powers and maneuvers are character material rather than a subject of their
    own. They were their own group when the header had seven; at five they sit
    with the rest of what a character can do, which is also where the owner put
    them and where a reader assembling a character is already looking.
  */
  powers: { group: "characters" },
  maneuvers: { group: "characters" },

  equipment: { group: "equipment" },
  "enhanced-items": { group: "equipment" },
  "weapon-properties": { group: "equipment" },
  "armor-properties": { group: "equipment" },

  monsters: { group: "statblocks" },

  "starship-base-sizes": { group: "starships" },
  "starship-deployments": { group: "starships" },
  "starship-equipment": { group: "starships" },
  "starship-modifications": { group: "starships" },
  "starship-ventures": { group: "starships" },
  "starship-rules": { group: "starships" },

  rules: { group: "rules" },
  "reference-tables": { group: "rules" },
};

/** One group, resolved into the destinations it offers. */
export interface NavGroup {
  id: NavGroupId;
  label: string;
  blurb: string;
  /** What the menu is for. */
  primary: NavDestination[];
  /** Reached from something else, listed quietly. */
  supporting: NavDestination[];
}

/**
 * Resolves the menus into the groups the header renders.
 *
 * Takes its input rather than reading `GROUP_MENUS` directly so that the rules
 * below — dropping an empty group, keeping the declared order — can be tested
 * against menus the site does not have. A rule only exercised by data that does
 * not exist yet is a rule that breaks on the change that introduces it.
 *
 * Empty groups are dropped. A group with nothing in it is not a shape to
 * preserve, and the header must not advertise a menu with nothing behind it.
 */
export function buildNavigation(
  menus: Readonly<
    Partial<Record<NavGroupId, readonly NavDestination[]>>
  > = GROUP_MENUS,
  order: readonly NavGroupId[] = NAV_GROUP_ORDER,
): NavGroup[] {
  return order
    .map((id) => {
      const destinations = menus[id] ?? [];
      return {
        id,
        label: NAV_GROUP_META[id].label,
        blurb: NAV_GROUP_META[id].blurb,
        primary: destinations.filter((d) => d.prominence === "primary"),
        supporting: destinations.filter((d) => d.prominence === "supporting"),
      };
    })
    .filter((group) => group.primary.length + group.supporting.length > 0);
}

/**
 * How many places a group leads to. Used to decide whether it needs a menu at
 * all: a group with exactly one destination *is* that destination, and putting
 * it behind a disclosure would be a button whose only job is to reveal a single
 * link. NPC statblocks is one destination today, so this is the difference
 * between a sensible header now and a header that has to be rewritten when a
 * vehicle stat block finally exists.
 */
export function destinationCount(group: NavGroup): number {
  return group.primary.length + group.supporting.length;
}

/**
 * The single destination a one-destination group stands for, wearing the
 * group's name rather than its own: the header says "NPC statblocks", not
 * "Creatures", because that is the word in the bar beside Rules and Equipment.
 */
export function soleDestination(
  group: NavGroup,
): { to: string; label: string } | null {
  if (destinationCount(group) !== 1) return null;
  const destination = group.primary[0] ?? group.supporting[0]!;
  return { to: destination.to, label: group.label };
}

/** Which group a content type belongs to, or null if it is not in navigation. */
export function groupOfType(type: ContentTypeId): NavGroupId | null {
  const placement = TYPE_NAV[type];
  return placement.group === "none" ? null : placement.group;
}

/**
 * The content types a reader can reach through one destination.
 *
 * Note what this is not: it is not the reachability check. A subcategory view
 * reports its type here because a reader who lands on `/weapons` is in the
 * equipment corpus and can walk out of it — that is the question this answers,
 * and it is the right one for "is anything leading to a type that is supposed
 * to be site metadata". Whether the type is *fully* reachable is a question
 * about a set of views and about the rows in the dataset, and it lives in
 * `nav-groups.test.ts` where the rows are.
 */
export function typesBehind(
  destination: NavDestination,
): readonly ContentTypeId[] {
  switch (destination.kind) {
    case "type":
      return [destination.type];
    case "view":
      return [destination.view.type];
    case "page":
      /*
        Both halves of what a hub holds, which is right for this question and
        wrong for reachability. A reader who opens the customization hub and
        clicks through to `/multiclass-improvements` is in the class-improvement
        corpus, so a hub that led to a type declared to be site metadata would
        be caught here whether it linked the index or a slice of it. Whether the
        slices *add up* to the type is the other question, and it is asked of
        the dataset rather than of this list.
      */
      return [
        ...destination.covers,
        ...destination.offers.map((view) => view.type),
      ];
    case "book":
      // A book page is a view over every type at once and leads into none of
      // them in particular. Claiming otherwise would make any book entry
      // satisfy the reachability of anything.
      return [];
  }
}

/**
 * How a destination is drawn where it gets more room than a menu line: a card
 * on the front page, or the hub it stands for.
 *
 * The four arms take their face from four different places — a type from
 * `TYPE_META`, a view from its own registry entry, a book from `SOURCE_META`,
 * a page from the menu — which is precisely why this is one function rather
 * than a conditional in each renderer.
 */
export interface DestinationFace {
  to: string;
  label: string;
  blurb: string;
  /** The type whose mark this destination wears, if it wears one. */
  icon: ContentTypeId | null;
  accent: Accent | null;
}

export function faceOf(destination: NavDestination): DestinationFace {
  const base = { to: destination.to, label: destination.label };
  switch (destination.kind) {
    case "type":
      return {
        ...base,
        blurb: TYPE_META[destination.type].blurb,
        icon: destination.type,
        accent: TYPE_META[destination.type].accent,
      };
    /*
      A view wears its source type's mark and hue on purpose: a weapons page is
      drawn in equipment's steel because it is a shelf in an existing subject,
      not a new one. `app/routes/subcategory-index.tsx` does the same thing for
      the same reason.
    */
    case "view":
      return {
        ...base,
        blurb: destination.view.blurb,
        icon: destination.view.type,
        accent: TYPE_META[destination.view.type].accent,
      };
    case "book":
      return {
        ...base,
        blurb: SOURCE_META[destination.code]!.blurb,
        icon: null,
        accent: SOURCE_META[destination.code]!.accent,
      };
    case "page":
      return {
        ...base,
        blurb: destination.blurb,
        icon: null,
        accent: destination.accent,
      };
  }
}

export const NAVIGATION: NavGroup[] = buildNavigation();
