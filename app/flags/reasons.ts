/**
 * How each reason is put to a reader.
 *
 * The service owns the taxonomy; this owns the wording. They are separate for a
 * reason that shows up the first time somebody reads the list: the service's
 * names are routing keys — `image-artist-known` — and the question a reader is
 * actually answering is "what is wrong with this?". A menu of routing keys gets
 * the wrong answer picked, and a wrongly-routed report is worse than no report,
 * because it lands in a queue somebody has already decided not to work today.
 *
 * Each entry is written as the sentence the reader would say, with a second
 * line for the case where two of them look similar. The two that most need
 * telling apart are `image-artist-known` and `image-attribution-missing` — "I
 * know who made this" against "nobody knows who made this" — because the first
 * is the whole point of the feature and the second is what somebody picks by
 * accident when the first is worded vaguely.
 */

import {
  DOCUMENT_REASONS,
  IMAGE_REASONS,
  type FlagReason,
  type FlagStatus,
  type FlagTargetKind,
} from "./types";

export interface ReasonDescription {
  /** The option's own text. Written as what the reader is saying. */
  label: string;
  /** One line under it, for the pairs that would otherwise be confused. */
  hint: string;
  /**
   * What the reader is asked to write, when the reason makes something
   * specific useful. Empty for the ones where anything they add is a bonus.
   */
  detailsPrompt: string;
}

export const REASON_META: Record<FlagReason, ReasonDescription> = {
  "image-artist-known": {
    label: "I know who made this picture",
    hint: "You can name the artist, or point at where the work was published.",
    detailsPrompt:
      "Who made it, and how we can check — a portfolio, a post, a commission thread. This is the one report that lets a credit actually be written.",
  },
  "image-attribution-missing": {
    label: "This picture has no proper credit",
    hint: "The credit is missing or wrong, and you do not know what it should say.",
    detailsPrompt: "Anything you noticed. A hunch is fine here; a guess is not a credit.",
  },
  "image-replacement-wanted": {
    label: "This picture should be replaced with our own work",
    hint: "Nothing is factually wrong; the art should not be this art.",
    detailsPrompt: "Why, if it is not obvious.",
  },
  "image-rights-complaint": {
    label: "I hold the rights to this picture and did not agree to this",
    hint: "For the person who made the work, or who speaks for them.",
    detailsPrompt:
      "How we can verify that the work is yours, and what you would like done. Reports of this kind are looked at first.",
  },
  "image-wrong-subject": {
    label: "This picture does not show what the page is about",
    hint: "The right picture, on the wrong page.",
    detailsPrompt: "What it actually shows, if you know.",
  },
  "text-error": {
    label: "There is a typo or a formatting mistake",
    hint: "Spelling, punctuation, a broken link, text running into itself.",
    detailsPrompt: "Where on the page, and what it should say.",
  },
  "content-incorrect": {
    label: "This does not match the book",
    hint: "The rule is written down wrongly here.",
    detailsPrompt: "What the book says, and which book. Somebody has to check it against a copy.",
  },
  "content-missing": {
    label: "Something is missing from this page",
    hint: "A feature, a table, a level with nothing under it.",
    detailsPrompt: "What is missing, and where it should be.",
  },
  "source-attribution": {
    label: "This cites the wrong source, or none",
    hint: "The rule itself is right; the book it is credited to is not.",
    detailsPrompt: "Which book it actually comes from.",
  },
  other: {
    label: "Something else",
    hint: "Nothing above fits.",
    detailsPrompt: "What is wrong. This one needs writing out, or nobody can act on it.",
  },
};

/** The menu a reader gets, for the kind of thing they are reporting. */
export function reasonsFor(kind: FlagTargetKind): readonly FlagReason[] {
  return kind === "image" ? IMAGE_REASONS : DOCUMENT_REASONS;
}

/** Free text is only compulsory when the reason says nothing on its own. */
export function requiresDetails(reason: FlagReason): boolean {
  return reason === "other";
}

/**
 * The service's own cap, repeated here so the field can count down rather than
 * letting somebody write nine hundred words and meet a 400.
 *
 * A copy of a number the server owns, which is a thing worth being uneasy
 * about. It is safe in exactly one direction: if the two ever disagree, this
 * one is the smaller of the two by construction — a client that let more
 * through would meet the server's refusal, which is the failure mode that
 * already works.
 */
export const MAX_DETAILS_LENGTH = 1000;

export interface StatusDescription {
  label: string;
  /** What a reviewer is saying by moving a report here. */
  summary: string;
  /** Whether this is still work to do. */
  outstanding: boolean;
}

export const STATUS_META: Record<FlagStatus, StatusDescription> = {
  open: {
    label: "Open",
    summary: "Filed. Nobody has looked at it yet.",
    outstanding: true,
  },
  accepted: {
    label: "Accepted",
    summary: "A reviewer agrees there is something here. Not fixed yet.",
    outstanding: true,
  },
  declined: {
    label: "Declined",
    summary: "A reviewer judged there was nothing to do.",
    outstanding: false,
  },
  resolved: {
    label: "Resolved",
    summary: "The thing reported has been put right.",
    outstanding: false,
  },
};

/**
 * Which moves a reviewer is offered from a given state.
 *
 * A copy of the service's transition table, and it is a copy on purpose: the
 * server refuses anything it does not allow, so this is about not offering a
 * button that answers 409. The two can drift; if they do, the server wins and
 * the reader sees a refusal rather than a wrong outcome.
 *
 * `declined` to `resolved` is absent from both, because it would claim work was
 * done on something a reviewer had just said needed none.
 */
export const NEXT_STATUSES: Record<FlagStatus, readonly FlagStatus[]> = {
  open: ["accepted", "declined"],
  accepted: ["resolved", "declined", "open"],
  declined: ["open"],
  resolved: ["open"],
};

/**
 * What a reason is called, without needing this client to know it.
 *
 * A reason the service has and this build has not is rendered as its own wire
 * name rather than dropped. Dropping it would leave a row in the queue with no
 * explanation of what was reported, which is worse than an unfamiliar-looking
 * label — and a reviewer can still act on a row whose reason they can read.
 */
export function reasonLabel(reason: string): string {
  return REASON_META[reason as FlagReason]?.label ?? reason;
}

/** The same forgiveness for a status this build does not recognise. */
export function statusLabel(status: string): string {
  return STATUS_META[status as FlagStatus]?.label ?? status;
}
