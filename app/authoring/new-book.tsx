/**
 * Starting a new book.
 *
 * ## Why this exists rather than the worklist's generic form
 *
 * A source can already be created from the worklist: pick a type, type a key,
 * start drafting. That path stays, and this shares its ending, because two
 * places that both know what creating a book means will eventually disagree
 * about it.
 *
 * What the generic path cannot do is ask the one question that has to be
 * answered before anything else about a book: whether it is part of the Star
 * Wars 5e canon or something somebody wrote for their own table. That decides
 * where it can appear, whether it leaves the database, and who it belongs to.
 * Asked afterwards, on a form of forty fields, it gets missed.
 *
 * ## Canon and homebrew are not the same as official
 *
 * `isOfficial` is a separate field asking whether this is a licensed Star Wars
 * product. Nothing here is: Star Wars 5e is community work built on the D&D 5e
 * SRD, so the Player's Handbook carries `isOfficial: false` and always will.
 * This control never touches it, and says so, because the two were confused
 * once already.
 */

import { useState } from "react";
import { useNavigate } from "react-router";

import { editorPath } from "./paths";

/** Lower case, digits, single hyphens. The published page's address. */
const WELL_FORMED = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface NewBookProps {
  /** Closes the control without creating anything. */
  onCancel?: () => void;
}

export function NewBook({ onCancel }: NewBookProps) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [homebrew, setHomebrew] = useState(false);
  const [touchedKey, setTouchedKey] = useState(false);

  /*
    The key follows the name until somebody edits it, and then stops. Typing a
    title and having the address written for you is the common case; a book
    whose address should not match its title is rare and deliberate, and
    silently overwriting that person's key on the next keystroke would be
    maddening.
  */
  const slug = touchedKey ? key : suggestKey(name);
  const wellFormed = WELL_FORMED.test(slug);

  return (
    <div className="fp-new-book">
      <div className="auth-field">
        <label htmlFor="new-book-name">What is it called?</label>
        <input
          id="new-book-name"
          className="authoring-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="auth-field">
        <label htmlFor="new-book-key">Address</label>
        <input
          id="new-book-key"
          className="authoring-input"
          value={slug}
          spellCheck={false}
          aria-describedby="new-book-key-hint"
          aria-invalid={slug.length > 0 && !wellFormed ? true : undefined}
          onChange={(event) => {
            setTouchedKey(true);
            setKey(event.target.value);
          }}
        />
        <p className="auth-field-hint" id="new-book-key-hint">
          Lower case, digits and single hyphens. This becomes the address of the
          book&rsquo;s page and cannot be changed later without leaving the old
          one behind.
        </p>
      </div>

      <fieldset className="auth-field">
        <legend>What kind of book is it?</legend>
        <label className="fp-choice">
          <input
            type="radio"
            name="new-book-kind"
            checked={!homebrew}
            onChange={() => setHomebrew(false)}
          />
          <span>
            <strong>A Star Wars 5e book.</strong> Part of the reference. It can
            be shelved on the front page, and it is published through the
            content repository like the rest of the canon.
          </span>
        </label>
        <label className="fp-choice">
          <input
            type="radio"
            name="new-book-kind"
            checked={homebrew}
            onChange={() => setHomebrew(true)}
          />
          <span>
            <strong>Homebrew.</strong> Material for one table. It stays out of
            the front page shelf and out of the content repository, and
            everything published into it is homebrew too.
          </span>
        </label>
        <p className="auth-field-hint">
          Neither of these is the same as the book being an official Star Wars
          product. Nothing here is: Star Wars 5e is community work built on the
          5e SRD.
        </p>
      </fieldset>

      <p className="auth-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={!wellFormed || name.trim() === ""}
          onClick={() => navigate(newBookPath(slug, name, homebrew))}
        >
          Start drafting
        </button>
        {onCancel ? (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The editor's address for a book that does not exist yet.
 *
 * The name and the kind ride in the query string so the form opens with them
 * already answered. They are the two things this control asked for, and making
 * somebody retype them into the next screen would make this control pointless.
 */
export function newBookPath(key: string, name: string, homebrew: boolean): string {
  const path = editorPath("source", key);
  const query = new URLSearchParams({ title: name });
  if (homebrew) query.set("homebrew", "1");
  return `${path}&${query.toString()}`;
}

/** A title, as an address: lower case, letters and digits, single hyphens. */
export function suggestKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
