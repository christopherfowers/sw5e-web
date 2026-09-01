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
              The tagline is the only self-description that appears on every
              page, so what it does with four words matters more than its size
              suggests: a reader who deep-links into a single power from a
              search result never sees the home page, and the footer speaks
              about licensing rather than about what the site is.

              It read "Continuing sw5e.com", and before that "Community
              reference". Both were wrong in the same direction. "Community
              reference" filed the site as one fan project among many;
              "Continuing sw5e.com" was worse, because it described the site as
              standing outside Star Wars 5e and carrying its work along behind
              it. This is Star Wars 5e. It is the same project it has always
              been, on new foundations, and a site that has changed where it is
              served from does not introduce itself by naming its old address —
              it says what it is.

              So the tag now states the plain fact and nothing else: this is
              the reference, and it is the current one. There is no verb of
              succession in it to be read as a claim about somebody else, and
              no article that makes it one option among several.
            */}
            <span className="site-wordmark-tag">The current reference</span>
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
 *
 * One sentence used to sit in the middle of this paragraph and has been taken
 * out: "This site continues that work and does not speak for sw5e.com or the
 * people who ran it." It was written in good faith and it was false. This site
 * is not a bystander continuing Star Wars 5e from a polite distance; it is
 * Star Wars 5e, and disclaiming a relationship that exists misled every reader
 * who got as far as the footer. What replaces it says the true thing in the
 * same breath as the attribution, because the two belong together: the
 * conversion is Galiphile's and the community's, and this site is where it is
 * published now.
 *
 * The two disclaimers on either side of it are a different matter entirely and
 * are untouched. Being Star Wars 5e is not being official with respect to
 * Lucasfilm or Wizards of the Coast — the first is a statement about which
 * project this is, the second is a statement about rights nobody here holds —
 * and collapsing the two is exactly the mistake the removed sentence invited
 * from the other direction. Star Wars belongs to Lucasfilm, the conversion is
 * fan content made under the Fan Content Policy, and neither of those stops
 * being true because the site stopped apologising for existing.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-statement">
          <p>
            Star Wars 5e is a fan conversion of fifth-edition D&amp;D, made by
            Galiphile and a community of contributors in accordance with Wizards
            of the Coast&rsquo;s Fan Content Policy. This site is that reference,
            in its newest form. Star Wars and all related properties belong to
            Lucasfilm. This site is unofficial, and is not affiliated with,
            endorsed by, or sponsored by Lucasfilm or Wizards of the Coast.
          </p>
          <p>
            This website&rsquo;s source code is MIT licensed. The game content
            and the artwork are not the site&rsquo;s to license and remain with
            their authors and rights holders.
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
