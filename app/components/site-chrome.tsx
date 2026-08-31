/**
 * The site frame: skip link, banner, primary navigation, footer.
 *
 * The landmark structure is deliberate. One `<header role="banner">` holding a
 * `<nav aria-label="Content">`, one `<main id="main">` per page, and one
 * `<footer role="contentinfo">`, with a skip link as the first focusable thing
 * on the page so a keyboard user is never forced through the whole nav.
 *
 * The navigation itself lives in `./site-nav.tsx`. It used to be a flat strip
 * of every content type built right here; it is now six grouped menus, which is
 * enough machinery to deserve its own file.
 */

import { Link } from "react-router";

import { brandImage } from "~/content/imagery";
import { AccountControl } from "./account-control";
import { AssetImage } from "./media";
import { GroupedNav } from "./site-nav";
import { SiteSearch } from "./site-search";

export function SkipLink() {
  return (
    <a className="skip-link" href="#main">
      Skip to main content
    </a>
  );
}

export function SiteHeader() {
  // The logo sits inside the link that already says "Star Wars 5e" in text, so
  // it is decorative here: giving it an alt would make a screen reader read
  // the site's name twice on every page.
  const logo = brandImage("logo");

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="site-wordmark">
          {logo ? (
            <AssetImage
              className="site-wordmark-logo"
              image={logo}
              alt=""
              sizes="44px"
              loading="eager"
            />
          ) : null}
          <span className="site-wordmark-text">
            <span className="site-wordmark-name">Star Wars 5e</span>
            {/*
              The tagline reads "Continuing sw5e.com" and not "Community
              reference" because it is the only self-description that appears on
              every page. A reader who deep-links into a single power from a
              search result never sees the home page, and the footer speaks
              about licensing rather than about lineage — so this line is the
              one chance the site gets to tell them, wherever they landed, that
              this is where the reference they knew went. "Continuing" is the
              strongest verb the facts support: this site carries that work
              forward, it is not operated by the people who ran it.
            */}
            <span className="site-wordmark-tag">Continuing sw5e.com</span>
          </span>
        </Link>
        <SiteSearch />
        <AccountControl />
      </div>
      <GroupedNav />
    </header>
  );
}

/**
 * The footer states three separate things, and the reason it is this long is
 * that the short version got all three of them wrong.
 *
 * It used to say that "game content and artwork belong to their authors",
 * which credited nobody by name and conflated three different positions into
 * one vague sentence. Star Wars belongs to Lucasfilm and always did. The
 * conversion of D&D into Star Wars 5e is the work of Galiphile and a named
 * community, made in accordance with Wizards of the Coast's Fan Content Policy
 * — that is what the original site's credits actually claim, and it is a
 * different claim from owning Star Wars. And this website's own source code is
 * MIT licensed, which is a third thing again: the code being freely reusable
 * says nothing about the game content or the artwork, and reading one as the
 * other is precisely the confusion the old wording invited.
 *
 * The credits link is not decoration. An assertion about who made something,
 * with no way to reach the list of who, is the failure this replaces.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-statement">
        <p>
          Star Wars 5e is a fan conversion of fifth-edition D&amp;D, made by
          Galiphile and a community of contributors in accordance with Wizards
          of the Coast&rsquo;s Fan Content Policy. Star Wars and all related
          properties belong to Lucasfilm. This site is unofficial, and is not
          affiliated with, endorsed by, or sponsored by Lucasfilm or Wizards of
          the Coast.
        </p>
        <p>
          This website&rsquo;s source code is MIT licensed. The game content and
          the artwork are not the site&rsquo;s to license and remain with their
          authors and rights holders.
        </p>
        </div>
        <ul className="site-footer-links">
          <li>
            <Link to="/credits">Credits</Link>
          </li>
          <li>
            <Link to="/sources">Source books</Link>
          </li>
          <li>
            <Link to="/search">Search everything</Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        <li>
          <Link to="/">Home</Link>
        </li>
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;
          return (
            <li key={`${crumb.label}-${index}`}>
              {crumb.to && !isLast ? (
                <Link to={crumb.to}>{crumb.label}</Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined}>{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PagerLink {
  slug: string;
  name: string;
}

/** Previous and next within a content type, so a reader can browse in place. */
export function Pager({
  type,
  typeLabel,
  previous,
  next,
}: {
  type: string;
  typeLabel: string;
  previous: PagerLink | null;
  next: PagerLink | null;
}) {
  if (!previous && !next) return null;

  return (
    <nav aria-label={`${typeLabel} navigation`} className="pager">
      {previous ? (
        <Link to={`/${type}/${previous.slug}`} rel="prev" className="pager-link">
          <span className="pager-direction">Previous</span>
          <span className="pager-name">{previous.name}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={`/${type}/${next.slug}`} rel="next" className="pager-link pager-next">
          <span className="pager-direction">Next</span>
          <span className="pager-name">{next.name}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
