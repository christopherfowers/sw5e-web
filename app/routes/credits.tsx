/**
 * Who made Star Wars 5e, and who made the pictures on this site.
 *
 * The page renders the categories as the credits document orders them and
 * never flattens them together. That is the whole design constraint: a patron
 * who funded the hosting, an artist whose picture is on a species page, and a
 * collaborator who wrote a book of archetypes have each earned a different
 * acknowledgement, and one long list of names takes that away from all three.
 * So each category keeps its own heading, its own introduction, and its own
 * shape — the categories that recorded what somebody actually did are drawn as
 * a description list with that sentence attached, and the rosters, which
 * recorded only that somebody took part, are drawn as rosters.
 *
 * Everything here comes from content the CMS can edit. Nothing on this page is
 * a name typed into a component.
 */

import { Link } from "react-router";

import { safeExternalHref } from "~/components/media";
import { Breadcrumbs } from "~/components/site-chrome";
import {
  citedAssetCount,
  creditCategories,
  creditedPeopleCount,
} from "~/content/credits.server";
import type { CreditCategory } from "~/content/types";
import type { Route } from "./+types/credits";

export function meta() {
  return [
    { title: "Credits — Star Wars 5e" },
    {
      name: "description",
      content:
        "Star Wars 5e was made by Galiphile with a community of collaborators, " +
        "contributors, patrons and artists. This is who they are, and what " +
        "each of them did.",
    },
  ];
}

export async function loader() {
  const categories = creditCategories();
  return {
    categories,
    people: creditedPeopleCount(),
    // The site carries 150 pictures and knows the artist of one of them. That
    // gap is stated on the page rather than left for a reader to infer from
    // an absence, because it is the thing most likely to be fixed by somebody
    // reading this page and recognising their own work.
    images: 150,
    cited: citedAssetCount(),
  };
}

/**
 * True when this category recorded what its people actually did. Those are the
 * valuable credits and they get the layout that shows the sentence; the
 * rosters would be a page of empty second columns in the same treatment.
 */
function hasContributions(category: CreditCategory): boolean {
  return category.people.some((person) => person.contribution !== null);
}

function PersonName({
  name,
  link,
}: {
  name: string;
  link: string | null;
}) {
  const href = safeExternalHref(link);
  if (!href) return <>{name}</>;
  return (
    <a href={href} rel="noopener noreferrer">
      {name}
    </a>
  );
}

export default function Credits({ loaderData }: Route.ComponentProps) {
  const { categories, people, images, cited } = loaderData;

  return (
    <div className="page">
      <Breadcrumbs trail={[{ label: "Credits" }]} />
      <div className="page-head">
        <p className="page-eyebrow">Attribution</p>
        <h1>Credits</h1>
        <p className="lede">
          Star Wars 5e is a fan conversion of fifth-edition D&amp;D, made by
          Galiphile in accordance with Wizards of the Coast&rsquo;s Fan Content
          Policy, with a great deal of help. These {people.toLocaleString("en-US")}{" "}
          people are that help.
        </p>
        <p className="credits-provenance">
          This list is reproduced from the credits published on the original
          sw5e.com. That page is a JavaScript application and could not be read
          again to check for changes, so treat this as the credits as they stood
          when the site was archived rather than as a verified current list. If
          you are missing from it, or credited for the wrong thing, please say
          so — the original credits ended with that same invitation and it still
          stands.
        </p>
      </div>

      {categories.map((category) => (
        <section key={category.key} id={category.key} className="credits-section">
          <h2 className="section-heading">{category.title}</h2>
          {category.description ? (
            <p className="credits-blurb">{category.description}</p>
          ) : null}

          {hasContributions(category) ? (
            <dl className="credit-list">
              {category.people.map((person) => (
                <div key={person.key} className="credit-entry">
                  <dt>
                    <PersonName name={person.name} link={person.link} />
                  </dt>
                  <dd>
                    {person.contribution ?? (
                      <span className="credit-unrecorded">
                        Contribution not recorded
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <ul className="credit-roster">
              {category.people.map((person) => (
                <li key={person.key}>
                  <PersonName name={person.name} link={person.link} />
                </li>
              ))}
            </ul>
          )}

          {category.note ? <p className="credits-note">{category.note}</p> : null}

          {category.key === "art-asset" ? (
            <p className="credits-note">
              The site carries {images} pictures and the archive records the
              artist of {cited === 1 ? "one" : cited} of them. Every other
              picture is marked on its own page as having no recorded artist,
              rather than being attributed to a guess. If one of these is yours,
              tell us and it will be credited where it appears.
            </p>
          ) : null}
        </section>
      ))}

      <section className="credits-section">
        <h2 className="section-heading">This website</h2>
        <p className="credits-blurb">
          The source code of this site is open source and separate from
          everything above: the code is MIT licensed, while the game content and
          the artwork are not the site&rsquo;s to license and remain with their
          authors and rights holders.
        </p>
        <p className="credits-note">
          Star Wars and all related properties belong to Lucasfilm. This site is
          unofficial and is not endorsed by, affiliated with, or approved by
          Lucasfilm or Wizards of the Coast.{" "}
          <Link to="/sources">The books this reference draws from</Link>.
        </p>
      </section>
    </div>
  );
}
