/**
 * The site frame: skip link, banner, primary navigation, footer.
 *
 * The landmark structure is deliberate. One `<header role="banner">` holding a
 * `<nav aria-label="Content types">`, one `<main id="main">` per page, and one
 * `<footer role="contentinfo">`, with a skip link as the first focusable thing
 * on the page so a keyboard user is never forced through the whole nav.
 */

import { NavLink, Link } from "react-router";

import { brandImage } from "~/content/imagery";
import { TYPE_META, TYPE_ORDER } from "~/content/type-meta";
import { AccountControl } from "./account-control";
import { AssetImage } from "./media";
import { SiteSearch } from "./site-search";
import { TypeIcon } from "./type-icon";

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
            <span className="site-wordmark-tag">Community reference</span>
          </span>
        </Link>
        <SiteSearch />
        <AccountControl />
      </div>
      <nav aria-label="Content types" className="site-nav">
        <ul>
          {TYPE_ORDER.map((type) => (
            <li key={type}>
              <NavLink
                to={`/${type}`}
                className={({ isActive }) =>
                  isActive ? "site-nav-link is-current" : "site-nav-link"
                }
              >
                <TypeIcon type={type} />
                {TYPE_META[type].plural}
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink
              to="/sources"
              className={({ isActive }) =>
                isActive ? "site-nav-link is-current" : "site-nav-link"
              }
            >
              Sources
            </NavLink>
          </li>
        </ul>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>
          A community reference for the Star Wars 5e tabletop roleplaying game.
          Game content and artwork belong to their authors; this site is
          unofficial.
        </p>
        <ul className="site-footer-links">
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
