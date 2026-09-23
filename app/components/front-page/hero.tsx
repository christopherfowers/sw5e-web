/**
 * The top of the front page: what the game is, how big this reference is, and
 * the two ways in.
 *
 * Only the lede is editable. The heading is the site's name, the count is
 * arithmetic over the corpus, and the two buttons go where the corpus says the
 * handbook starts. None of those is somebody's wording to own, and an editor
 * that offered a text box over a computed number would be offering to make it
 * wrong.
 */

import { Link } from "react-router";

import type { ImageSource } from "~/content/imagery";

import { EditableText } from "./editable";

export interface HeroProps {
  light: ImageSource | null;
  dark: ImageSource | null;
  lede: string | null;
  /** Where the handbook opens, when the corpus names a first chapter. */
  start: { slug: string } | null;
  total: number;
  categories: number;
  editing?: { onLedeChange(next: string): void };
}

export function Hero({
  light,
  dark,
  lede,
  start,
  total,
  categories,
  editing,
}: HeroProps) {
  return (
    <section className="home-hero">
      {/*
        Decorative, and marked so. It carries nothing a reader needs, and the
        heading beneath it already says the name.
      */}
      {light && dark ? (
        <picture>
          <source
            media="(prefers-color-scheme: dark)"
            srcSet={dark.srcSet}
            sizes="100vw"
          />
          <img
            className="home-hero-media"
            src={light.src}
            srcSet={light.srcSet}
            sizes="100vw"
            width={light.width}
            height={light.height}
            alt=""
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
      ) : null}

      <div className="home-hero-inner">
        <h1>Star Wars 5e</h1>

        {/*
          What the game is, before what this site does. Saying "every book of
          the Star Wars 5e conversion" tells somebody who does not already know
          absolutely nothing: it never says what the game is, and "conversion"
          carries the whole explanation without unpacking it.
        */}
        <EditableText
          value={lede}
          className="lede"
          fallback={
            <>
              A Star Wars roleplaying game, built on the mechanics of Dungeons
              &amp; Dragons 5th edition and expanded for the galaxy. Every book
              of it, searchable in one place.
            </>
          }
          editing={
            editing
              ? { label: "Opening paragraph", onChange: editing.onLedeChange }
              : undefined
          }
        />

        <p className="home-hero-meta">
          {total.toLocaleString("en-US")} entries across {categories} categories.
          Press <kbd>/</kbd> anywhere to search all of them.
        </p>

        {/*
          The first action is the book that teaches the game, not a list of
          options. Sending every arrival straight into a list is the complaint
          the page was rebuilt for: readers jump around and never learn the
          system. Browsing is still one click away.
        */}
        <div className="home-hero-actions">
          {start ? (
            <Link className="button button-primary" to={`/rules/${start.slug}`}>
              Start with the Player&rsquo;s Handbook
            </Link>
          ) : null}
          <Link className="button" to="/species">
            Browse species
          </Link>
        </div>

        {/*
          Below the buttons and phrased as the question the reader is holding.
          Somebody who followed a dead bookmark is not looking for an "About"
          link; they want to know whether this is the same site and whether
          their stuff is here. The old domain is named because that is the word
          in their head, and a redirect notice that will not say where you came
          from is no use to anybody.
        */}
        <p className="home-hero-note">
          <Link to="/about">
            Arrived from an sw5e.com link? Here is what moved, and what did not.
          </Link>
        </p>
      </div>
    </section>
  );
}
