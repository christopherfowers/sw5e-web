/**
 * Grouped navigation: a menu bar in the header, a rail beside the page.
 *
 * The two halves answer different questions and that is why there are two.
 * The header menus answer "take me somewhere else" — they are how a reader
 * leaves Combat for Starships. The rail answers "where am I and what is beside
 * me" — it keeps a reader's siblings on screen so moving from maneuvers to
 * fighting styles is one click rather than a round trip through a menu they
 * have to open, aim at and close again. A dropdown alone makes lateral movement
 * expensive; a sidebar alone cannot hold twenty-two destinations.
 *
 * Both are built on `<details>`/`<summary>` rather than a div with a click
 * handler, and that is a deliberate accessibility decision rather than a
 * shortcut:
 *
 *   - It works with JavaScript switched off. Every page of this site is static
 *     HTML and the whole point is that it is readable without a bundle; a menu
 *     that needs hydration to open would put twenty of the site's twenty-three
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
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, NavLink, useLocation } from "react-router";

import {
  NAVIGATION,
  destinationCount,
  groupOfType,
  soleDestination,
  type NavGroup,
} from "~/content/nav-groups";
import { TYPE_META } from "~/content/type-meta";
import { isContentTypeId, type ContentTypeId } from "~/content/types";
import { TypeIcon } from "./type-icon";

const SUBSCRIBE_NEVER = () => () => {};

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

/** The content type the current URL is showing, if it is showing one. */
function currentType(pathname: string): ContentTypeId | null {
  const segment = pathname.split("/")[1] ?? "";
  return isContentTypeId(segment) ? segment : null;
}

function typeLink(type: ContentTypeId, onNavigate?: () => void) {
  return (
    <NavLink
      to={`/${type}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        isActive ? "nav-type-link is-current" : "nav-type-link"
      }
    >
      <TypeIcon type={type} />
      {TYPE_META[type].plural}
    </NavLink>
  );
}

/**
 * The header's menu bar.
 *
 * A group with a single destination is rendered as a plain link rather than a
 * disclosure. `Bestiary` is one type today and `Gear` is one until enhanced
 * items land, and a button that reveals exactly one link is a button that
 * wastes a keystroke. The moment either group grows it becomes a menu on its
 * own, with nothing here to change.
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

  const active = currentType(location.pathname);
  const activeGroup = active ? groupOfType(active) : null;

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
  onNavigate,
}: {
  group: NavGroup;
  isOpen: boolean;
  isCurrent: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const panelId = useId();
  const supportingId = useId();
  const hydrated = useHydrated();

  return (
    <details
      className="nav-group"
      data-group={group.id}
      open={isOpen}
      /*
        The state lives in React so that only one menu is open at a time, so
        `preventDefault` here stops the browser toggling `open` underneath it.
        A click is what Enter and Space on a `<summary>` produce as well, so
        this one handler covers pointer and keyboard alike; without JavaScript
        nothing runs and the native toggle takes over.
      */
      onToggle={(event) => {
        if (event.currentTarget.open !== isOpen) onToggle();
      }}
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
          {group.primary.map((type) => (
            <li key={type}>{typeLink(type, onNavigate)}</li>
          ))}
          {group.extras.map((extra) => (
            <li key={extra.to}>
              <NavLink
                to={extra.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  isActive ? "nav-type-link is-current" : "nav-type-link"
                }
              >
                {extra.label}
              </NavLink>
            </li>
          ))}
        </ul>

        {group.supporting.length > 0 ? (
          <>
            <p className="nav-group-subhead" id={supportingId}>
              Referenced from these
            </p>
            <ul className="nav-group-supporting" aria-labelledby={supportingId}>
              {group.supporting.map((type) => (
                <li key={type}>
                  <Link to={`/${type}`} onClick={onNavigate}>
                    {TYPE_META[type].plural}
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
  const type = currentType(location.pathname);
  const groupId = type ? groupOfType(type) : null;
  const group = groupId
    ? NAVIGATION.find((candidate) => candidate.id === groupId)
    : undefined;

  if (!group || destinationCount(group) < 2) return null;

  return (
    <nav aria-label={`${group.label} sections`} className="group-rail">
      <p className="group-rail-heading">{group.label}</p>
      <ul className="group-rail-types">
        {group.primary.map((each) => (
          <li key={each}>{typeLink(each)}</li>
        ))}
        {group.extras.map((extra) => (
          <li key={extra.to}>
            <NavLink
              to={extra.to}
              className={({ isActive }) =>
                isActive ? "nav-type-link is-current" : "nav-type-link"
              }
            >
              {extra.label}
            </NavLink>
          </li>
        ))}
      </ul>

      {group.supporting.length > 0 ? (
        <>
          <p className="group-rail-subhead">Referenced from these</p>
          <ul className="group-rail-supporting">
            {group.supporting.map((each) => (
              <li key={each}>
                <NavLink
                  to={`/${each}`}
                  className={({ isActive }) =>
                    isActive ? "is-current" : undefined
                  }
                >
                  {TYPE_META[each].plural}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}
