/**
 * Grouped navigation: a menu bar in the header, a rail beside the page.
 *
 * The two halves answer different questions and that is why there are two.
 * The header menus answer "take me somewhere else" — they are how a reader
 * leaves Combat for Starships. The rail answers "where am I and what is beside
 * me" — it keeps a reader's siblings on screen so moving from maneuvers to
 * fighting styles is one click rather than a round trip through a menu they
 * have to open, aim at and close again. A dropdown alone makes lateral movement
 * expensive; a sidebar alone cannot hold thirty destinations.
 *
 * Both are built on `<details>`/`<summary>` rather than a div with a click
 * handler, and that is a deliberate accessibility decision rather than a
 * shortcut:
 *
 *   - It works with JavaScript switched off. Every page of this site is static
 *     HTML and the whole point is that it is readable without a bundle; a menu
 *     that needs hydration to open would put all but one of the site's
 *     destinations behind JavaScript.
 *   - Enter and Space operate it natively, and it is in the tab order once, as
 *     one stop, rather than as a widget with its own key handling to get wrong.
 *   - The open state is a real property of the element rather than a class
 *     name, so it cannot drift out of step with what is on screen.
 *
 * What JavaScript adds on top is only what native disclosure lacks: an explicit
 * `aria-expanded` (see `useHydrated` for why it is added rather than served),
 * one menu open at a time, Escape to close and hand focus back, a click outside
 * to dismiss, and closing on navigation. None of it is required to reach a
 * page.
 *
 * There is no hover trigger anywhere in here. A menu that opens on hover is
 * unreachable by keyboard and unusable by touch, and one that opens on hover
 * *as well* still fires under a pointer that was only passing through.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, NavLink, useLocation } from "react-router";

import {
  NAVIGATION,
  destinationCount,
  faceOf,
  groupOfType,
  soleDestination,
  type NavDestination,
  type NavGroup,
  type NavGroupId,
} from "~/content/nav-groups";
import { getSubcategoryView } from "~/content/subcategory-views";
import { isContentTypeId } from "~/content/types";
import { TypeIcon } from "./type-icon";

const SUBSCRIBE_NEVER = () => () => {};

/**
 * `useLayoutEffect`, except on the server, where it is `useEffect`.
 *
 * Effects do not run during prerendering at all, so the two are equivalent
 * there — but React warns about the layout variant on the server, and a build
 * that prints a warning for every one of ~7,900 pages is a build nobody reads
 * the output of. The distinction only matters in the browser, where it has to
 * be the layout one: what it does is settle the disclosure's open state, and
 * doing that after the browser has painted is a visible flicker.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * False while the server-rendered markup is being produced and during the
 * hydration render, true afterwards.
 *
 * It exists for one attribute. `aria-expanded` on the group's `<summary>` is
 * read from React state, and React state is only the truth about whether a menu
 * is open while React is the thing opening it. Without JavaScript the browser
 * toggles `<details open>` on its own, and an `aria-expanded="false"` baked
 * into a static file would then tell a screen reader the exact opposite of what
 * just happened — an ARIA attribute overrides the element's native state, so it
 * would be worse than saying nothing. Omitting it from the served markup leaves
 * the browser's own disclosure semantics in charge, which is the right answer
 * for a reader with no JavaScript, and adding it after hydration gives an
 * explicit, accurate one to everybody else.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    SUBSCRIBE_NEVER,
    () => true,
    () => false,
  );
}

/**
 * The group the current address belongs to, or null outside content entirely.
 *
 * Read off the first path segment, and answered from the menus before it is
 * answered from `TYPE_NAV`. That order matters now that most of what the header
 * offers is not a content type: `/weapons` is a slice of equipment and
 * `/customization-options` is a hub over seven types, and neither resolves
 * through `TYPE_NAV` at all. A reader standing on one of them is in a group,
 * and the rail beside them has to say which.
 *
 * The two fallbacks catch the addresses no menu names. `/equipment` is one — it
 * is the crumb above the three shelves rather than a destination in its own
 * right — and so is every item page under a type, `/features/deflect` as much
 * as `/weapons` itself.
 */
function groupOfPath(pathname: string): NavGroupId | null {
  const segment = pathname.split("/")[1] ?? "";
  if (!segment) return null;

  const to = `/${segment}`;
  for (const group of NAVIGATION) {
    for (const destination of [...group.primary, ...group.supporting]) {
      if (destination.to === to) return group.id;
    }
  }

  if (isContentTypeId(segment)) return groupOfType(segment);
  const view = getSubcategoryView(segment);
  return view ? groupOfType(view.type) : null;
}

/**
 * One menu line.
 *
 * The mark beside it is the destination's own — a type's, or for a slice of a
 * type the mark of the type it is a slice of, so that `/weapons` carries
 * equipment's. A book and a hub have no mark, which is why the icon is
 * conditional rather than assumed: the alternative would be inventing one for
 * the Player's Handbook.
 */
function destinationLink(destination: NavDestination, onNavigate?: () => void) {
  const face = faceOf(destination);

  /*
    An anchor rather than a NavLink, and not a stylistic choice: NavLink hands
    the address to the client router, which would match a Google Drive URL
    against no route and render the not-found page over the top of a working
    site. It also can never be the current page, so the active styling has
    nothing to say about it.

    The host is named in the link's accessible description rather than left for
    the reader to discover after the tab opens. This site's
    Content-Security-Policy names no external host anywhere, so a link that
    leaves is genuinely unusual here and worth announcing.
  */
  if (destination.kind === "external") {
    return (
      <a
        className="nav-type-link"
        href={destination.to}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
      >
        {face.label}
        <span className="nav-external-host"> ({destination.host})</span>
      </a>
    );
  }

  return (
    <NavLink
      to={face.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        isActive ? "nav-type-link is-current" : "nav-type-link"
      }
    >
      {face.icon ? <TypeIcon type={face.icon} /> : null}
      {face.label}
    </NavLink>
  );
}

/**
 * The header's menu bar.
 *
 * A group with a single destination is rendered as a plain link rather than a
 * disclosure. NPC statblocks is one destination today — creatures, with no
 * vehicle or starship stat block anywhere in the corpus to sit beside it — and
 * a button that reveals exactly one link is a button that wastes a keystroke.
 * The moment that group grows it becomes a menu on its own, with nothing here
 * to change.
 */
export function GroupedNav() {
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  /*
    The open menu is remembered together with the address it was opened at, and
    is treated as closed anywhere else. That is why there is no effect here
    resetting the state on navigation: a client-side navigation out of a panel
    would otherwise land on the new page with the panel still hanging over it,
    and closing it from an effect means rendering the new page once with the
    menu open and then again without it.
  */
  const [opened, setOpened] = useState<{ group: string; at: string } | null>(
    null,
  );
  const openGroup = opened?.at === location.pathname ? opened.group : null;

  const close = useCallback(() => setOpened(null), []);

  /*
    All three listeners are on the document rather than on the nav, and Escape
    is the reason. A reader who opened a menu with the pointer may have focus
    anywhere on the page, and a handler bound to the bar would only answer
    Escape while focus happened to be inside it — so the menu would stay open
    over the page with no obvious way to dismiss it.
  */
  useEffect(() => {
    if (!openGroup) return;

    const inside = (target: EventTarget | null) =>
      navRef.current?.contains(target as Node) ?? false;

    function onPointerDown(event: MouseEvent) {
      if (!inside(event.target)) close();
    }
    // Focus moving out of the bar entirely — by Tab, or by clicking something
    // else focusable — closes it too, so a menu is never left open behind a
    // reader who has moved on.
    function onFocusIn(event: FocusEvent) {
      if (!inside(event.target)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const summary = navRef.current?.querySelector<HTMLElement>(
        `[data-group="${openGroup}"] > summary`,
      );
      close();
      // Focus goes back to the control that opened the menu, but only if the
      // reader was inside it: dragging focus across the page from wherever
      // they actually were would be worse than leaving it alone.
      if (inside(document.activeElement)) summary?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openGroup, close]);

  const activeGroup = groupOfPath(location.pathname);

  return (
    <nav aria-label="Content" className="site-nav" ref={navRef}>
      <ul className="site-nav-groups">
        {NAVIGATION.map((group) => (
          <li key={group.id}>
            {destinationCount(group) === 1 ? (
              <SingleDestination group={group} />
            ) : (
              <GroupMenu
                group={group}
                isOpen={openGroup === group.id}
                isCurrent={activeGroup === group.id}
                onToggle={() =>
                  setOpened((current) =>
                    current?.group === group.id &&
                    current.at === location.pathname
                      ? null
                      : { group: group.id, at: location.pathname },
                  )
                }
                onAdopt={() =>
                  setOpened({ group: group.id, at: location.pathname })
                }
                onNavigate={close}
              />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SingleDestination({ group }: { group: NavGroup }) {
  const destination = soleDestination(group)!;
  return (
    <NavLink
      to={destination.to}
      className={({ isActive }) =>
        isActive ? "nav-group-trigger is-current" : "nav-group-trigger"
      }
    >
      {destination.label}
    </NavLink>
  );
}

function GroupMenu({
  group,
  isOpen,
  isCurrent,
  onToggle,
  onAdopt,
  onNavigate,
}: {
  group: NavGroup;
  isOpen: boolean;
  isCurrent: boolean;
  onToggle: () => void;
  /**
   * Called when the element is already open and React did not open it — see
   * the effect below. Setting rather than toggling, so that calling it on a
   * menu that is already open in state does nothing.
   */
  onAdopt: () => void;
  onNavigate: () => void;
}) {
  const panelId = useId();
  const supportingId = useId();
  const hydrated = useHydrated();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  /*
   * `open` is written here rather than passed as a prop, and the reason is the
   * seconds between a page being readable and being hydrated.
   *
   * Every page on this site is static HTML, which means the header works
   * before the bundle has loaded: the browser's own disclosure opens the menu
   * on a click, because none of this component's handlers exist yet. Passing
   * `open={isOpen}` made React overrule that the moment it arrived — a reader
   * who clicked during the gap watched the menu open and then shut itself,
   * which is indistinguishable from a navigation bar that does not work. The
   * bigger the page, the wider the gap; the heaviest indexes on this site are
   * exactly where somebody is most likely to reach for the menu.
   *
   * So the first pass adopts whatever the browser has already done, and only
   * after that does React drive the attribute. `adopted` is a ref rather than
   * state because it must not cause a render of its own: the whole point is
   * that this settles before the browser paints.
   */
  const adopted = useRef(false);

  useIsomorphicLayoutEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    if (!adopted.current) {
      adopted.current = true;

      // Open before React knew about it. The browser did that, or find-in-page
      // did; either way it is not this component's place to undo it.
      if (details.open && !isOpen) {
        onAdopt();
        return;
      }
    }

    if (details.open !== isOpen) details.open = isOpen;
  }, [isOpen, onAdopt]);

  return (
    <details
      ref={detailsRef}
      className="nav-group"
      data-group={group.id}
      /*
        No `onToggle` and no `open` prop. Both were here, and between them they
        were why the menus did not open.

        `toggle` is dispatched asynchronously, and the click handler below
        already prevents every native toggle — so once React is running, the
        only thing that can emit one is React's own write of the attribute. The
        handler mirrored the element's state back into React state whenever the
        two disagreed, which meant it fired on React's write, found them
        momentarily out of step, read that as the reader closing the menu, and
        put it back. Under the development server that was reliable enough to
        make the menus unopenable; in a production build the timing usually
        landed the other way, which is the worst version of a bug to have.

        The case it was there for is real, and the effect above handles it
        without the race: a menu the browser opened before React arrived is
        adopted once, on the first pass, rather than argued with on every
        toggle. Without JavaScript nothing here runs at all and the native
        disclosure works unassisted — `e2e/navigation.spec.ts` covers that with
        scripting switched off.

        So the click handler on the summary is the only thing that decides.
      */
    >
      <summary
        className={
          isCurrent ? "nav-group-trigger is-current" : "nav-group-trigger"
        }
        aria-expanded={hydrated ? isOpen : undefined}
        aria-controls={hydrated ? panelId : undefined}
        onClick={(event) => {
          event.preventDefault();
          onToggle();
        }}
      >
        {group.label}
        <span aria-hidden="true" className="nav-group-caret" />
      </summary>

      <div className="nav-group-panel" id={panelId}>
        <p className="nav-group-blurb">{group.blurb}</p>
        <ul className="nav-group-types">
          {group.primary.map((destination) => (
            <li key={destination.to}>
              {destinationLink(destination, onNavigate)}
            </li>
          ))}
        </ul>

        {/*
          "Also here", where this used to say "Referenced from these". That
          phrase was right while the quiet half of a menu was only the two
          property glossaries, which really are read from the weapon that cites
          them. It is now also where the starship hulls, the rules index and the
          source-book list sit — destinations a reader may well set out for,
          kept quiet because the owner's menu does not name them rather than
          because nobody arrives at them directly. A subhead claiming to say why
          they are here would be wrong about half of them; one that says where
          they are is right about all of them.
        */}
        {group.supporting.length > 0 ? (
          <>
            <p className="nav-group-subhead" id={supportingId}>
              Also here
            </p>
            <ul className="nav-group-supporting" aria-labelledby={supportingId}>
              {group.supporting.map((destination) => (
                <li key={destination.to}>
                  <Link to={destination.to} onClick={onNavigate}>
                    {destination.label}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The rail beside the page, pinned to the group the reader is currently in.
 *
 * It renders nothing at all on a page that is not part of a content group —
 * the home page, search, the account area — so those pages keep exactly the
 * layout they had, and nothing for a group with only one destination in it,
 * where there are no siblings to orient against.
 *
 * It is hidden below 64rem rather than reshaped into a second collapsible menu.
 * A phone has no room for a persistent rail, and the header's group menus
 * already answer both of the questions the rail answers there; a second
 * navigation with its own shape would be a second thing to keep accessible for
 * no gain.
 */
export function GroupRail() {
  const location = useLocation();
  const groupId = groupOfPath(location.pathname);
  const group = groupId
    ? NAVIGATION.find((candidate) => candidate.id === groupId)
    : undefined;

  if (!group || destinationCount(group) < 2) return null;

  return (
    <nav aria-label={`${group.label} sections`} className="group-rail">
      <p className="group-rail-heading">{group.label}</p>
      <ul className="group-rail-types">
        {group.primary.map((destination) => (
          <li key={destination.to}>{destinationLink(destination)}</li>
        ))}
      </ul>

      {group.supporting.length > 0 ? (
        <>
          <p className="group-rail-subhead">Also here</p>
          <ul className="group-rail-supporting">
            {group.supporting.map((destination) => (
              <li key={destination.to}>
                <NavLink
                  to={destination.to}
                  className={({ isActive }) =>
                    isActive ? "is-current" : undefined
                  }
                >
                  {destination.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}
