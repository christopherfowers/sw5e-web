/**
 * The strip that says "this is not the real site".
 *
 * Drawn only on a deployment the API reports as non-production. How it learns
 * that, and why every failure counts as production, is in `app/site/environment.ts`.
 * What follows is about the four constraints the *rendering* has to satisfy,
 * because each of them rules out the obvious implementation.
 *
 * **It must not be in the prerendered markup.** Every page of this site is a
 * static HTML file built once and served to everybody, production included. A
 * banner rendered during the build would be in all ~2,200 of those files, and
 * production would paint it on first byte and then remove it after hydration —
 * a flash of "TEST ENVIRONMENT" on the live site, which is worse than having no
 * banner at all. So the component renders `null` until it has an answer, and
 * the answer cannot exist during the build.
 *
 * **It must not break hydration.** Same requirement seen from the other side.
 * React compares the first client render against the served markup, so the
 * first client render has to be `null` too. That is why the answer starts as
 * `null` in state and is only ever set from an effect: effects do not run
 * during the prerender and do not run before hydration, so there is no render
 * in which the two trees can disagree.
 *
 * **It must be announced.** A notice that appears a moment after the page does
 * is a notice a screen reader has already read past. The live region therefore
 * exists from the very first render — an empty `<div role="status">` that is in
 * the prerendered markup, has no text, no border and no height, and is
 * announced by nobody. When the banner's text is inserted into it, assistive
 * technology announces the insertion, which is the whole reason for having a
 * region that outlives its contents rather than mounting one alongside them.
 * An empty container is not a flash: `:empty` gives it no box at all.
 *
 * **It must not cover content or trap focus.** It is in normal document flow at
 * the top of the body, above the skip link, so it displaces the page rather
 * than floating over it — nothing is hidden behind it at any width, and there
 * is no dismiss control, because a dismiss control is a focusable element in
 * front of the skip link and the first thing a keyboard user meets on every
 * page should be "skip to main content". There is nothing focusable in here at
 * all, so there is nothing to trap.
 */

import { useEffect, useState } from "react";

import { isTestEnvironment } from "~/site/environment";

export function EnvironmentBanner() {
  // Three states in one nullable, and the null is load-bearing: it is "not
  // known yet", which is the state the build and the first client render are
  // both in. `false` is a positive answer of production and looks the same on
  // screen, but arrives by a different route and must not be confused with it
  // — writing this as a boolean initialised to `false` would make the two
  // indistinguishable and invite somebody to "simplify" the effect away.
  const [isTest, setIsTest] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // `isTestEnvironment` never rejects, so there is no catch here and no
    // failure branch that could accidentally show the banner: it resolves false
    // for every problem it meets.
    void isTestEnvironment(controller.signal).then((answer) => {
      if (!controller.signal.aborted) setIsTest(answer);
    });

    return () => controller.abort();
  }, []);

  return (
    /*
     * `role="status"` rather than `role="alert"`. Both are live regions; alert
     * is assertive and interrupts whatever a screen reader is in the middle of
     * saying, which is right for "your session expired" and wrong for a
     * standing fact about the deployment. Status is polite: it waits for a
     * pause, which is what somebody who has just landed on a page wants.
     *
     * The region is rendered unconditionally and is empty until the answer
     * arrives. See the note above: a live region that is inserted along with
     * its text is frequently not announced at all, because there was no region
     * there to observe a change in.
     */
    <div className="environment-banner" role="status">
      {isTest ? (
        <p className="environment-banner-text">
          <strong>Test environment.</strong> This is not the live site. Accounts
          and anything else saved here are temporary and will be deleted without
          warning.
        </p>
      ) : null}
    </div>
  );
}
