/**
 * Choosing light or dark, from anywhere on the site.
 *
 * Three states, not two. "Dark" and "light" are choices; **system** is the
 * absence of one, and it has to be reachable — a reader who turns the site
 * dark at night and then wants it to follow their desktop again has no way
 * back from a two-state switch, and their desktop is the thing that already
 * knows whether it is night.
 *
 * ## Why the choice is written to the document, not just to state
 *
 * The palette lives in CSS, keyed on `data-theme` on the root element. React
 * state alone would repaint the components and leave the tokens alone. So the
 * control writes the attribute, and `localStorage` remembers it; the inline
 * script in `root.tsx` replays it before first paint.
 *
 * ## The old site called it the dark side
 *
 * It did, and the button said "Join the dark side". That is kept as the
 * control's accessible name rather than as its visible label: the visible
 * affordance is a sun and a moon, which is what a reader scans for, and the
 * joke is there for anybody who meets it through a screen reader or a tooltip.
 * A control nobody recognises is a worse joke than none.
 */

import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

/** Where the choice is remembered. Read by the inline script too — keep in step. */
export const THEME_STORAGE_KEY = "sw5e-theme";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

const LABELS: Record<ThemeChoice, string> = {
  system: "Theme: following your system",
  light: "Theme: light",
  dark: "Theme: dark — join the dark side",
};

/*
  The choice is external state, so it is read as external state.

  The obvious shape — `useState` seeded in an effect — is wrong twice. It sets
  state during an effect purely to reach something the render could not see,
  and it leaves a second tab showing a stale switch forever. `useSyncExternalStore`
  is the primitive for exactly this: a value that lives outside React, with a
  server snapshot for the render that has no browser.

  The source of truth is the **document attribute**, not storage. The inline
  script in `root.tsx` has already applied it before React exists, so reading
  the attribute means the switch cannot disagree with the page it is sitting on
  — which is the bug a separate read of `localStorage` would eventually cause.
*/
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` fires in *other* tabs, so this is what keeps a second window's
  // switch honest when the choice is made in the first.
  window.addEventListener("storage", onChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): ThemeChoice {
  const attribute = document.documentElement.getAttribute("data-theme");
  return attribute === "light" || attribute === "dark" ? attribute : "system";
}

/**
 * What the server renders, and what the first client render must match.
 *
 * Always "system". The server cannot know the choice, and guessing would make
 * the first client render disagree with the markup it is hydrating — which
 * React resolves by throwing the markup away. The attribute is already correct
 * by then regardless, because the inline script set it before paint; only the
 * switch itself briefly shows "system", and only in the tick before hydration.
 */
function getServerSnapshot(): ThemeChoice {
  return "system";
}

/** Writes the choice to the document and to storage, and tells the switch. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;

  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);

  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private browsing, or storage disabled. The site still works; the choice
    // simply does not outlive the page, which is better than not rendering.
  }

  for (const listener of listeners) listener();
}

export function ThemeControl() {
  const choice = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return (
    <div className="theme-control">
      {/*
        A radio group rather than a cycling button. Three states cycled by one
        button means a reader who wants light has to guess how many presses it
        takes and watch the page flash through dark on the way — and there is
        no way to see which state you are in without changing it.
      */}
      <fieldset>
        <legend className="sr-only">Theme</legend>
        {ORDER.map((option) => (
          /*
            The label both wraps the input and names it with `htmlFor`.

            Wrapping alone is a valid accessible name, and the site's own
            structural check does not accept it — it looks for `label[for]`,
            `aria-label` or `aria-labelledby`. Rather than loosen a check that
            guards every form on the site so that one component can be
            different, the association is stated explicitly. It is the more
            robust form anyway: it survives the input being moved out of the
            label, which wrapping does not.

            The header renders once per document, so these ids are unique.
          */
          <label
            key={option}
            htmlFor={`theme-${option}`}
            title={LABELS[option]}
          >
            <input
              id={`theme-${option}`}
              type="radio"
              name="theme"
              value={option}
              checked={choice === option}
              onChange={() => applyTheme(option)}
            />
            <span aria-hidden="true" className={`theme-icon is-${option}`} />
            <span className="sr-only">{LABELS[option]}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * The script that runs before the first paint.
 *
 * Without it the page renders in the system's theme and then corrects itself
 * once React has hydrated — a white flash on every navigation for anybody who
 * chose dark, which is the single most annoying bug a theme toggle has.
 *
 * It is deliberately tiny, synchronous and inline. An external file would be a
 * second round trip before anything could paint; `defer` or `async` would run
 * it after the paint it exists to precede.
 *
 * Written as a string because it must be in the document before React exists.
 * It touches only `localStorage` and one attribute, and swallows its own
 * errors: a reader with storage disabled gets the system theme rather than a
 * blank page.
 *
 * ## Why the key is spelled out rather than interpolated
 *
 * This was built by interpolating `THEME_STORAGE_KEY` through `JSON.stringify`,
 * and CodeQL refused it: code construction from a value it cannot prove
 * constant. It was right to, even though the value *is* constant and
 * `JSON.stringify` escapes it correctly — what it flags is the shape, not this
 * instance. The result is written into `<head>` unescaped, so anything that
 * ever made the key dynamic would turn a storage rename into script injection,
 * and whoever made that change would have no reason to look at this file.
 *
 * So there is no construction left to get wrong. The cost is that the key is
 * written twice, which `theme-script.test.ts` holds. That drift fails quietly
 * otherwise: the toggle still works and the choice still saves, and it simply
 * stops surviving navigation, because the replay reads a name nothing writes.
 */
export const THEME_SCRIPT =
  '(function(){try{var t=localStorage.getItem("sw5e-theme");' +
  'if(t==="light"||t==="dark"){' +
  'document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();';
