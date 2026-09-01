/**
 * What the reader actually sees, on each of the deployments this can run on.
 *
 * `app/site/environment.test.ts` pins the decision; this pins the rendering,
 * and the two failures it has to rule out are different in kind. There, the
 * risk is a failure being read as "QA". Here, the risk is the banner reaching
 * the prerendered HTML — which would put a "TEST ENVIRONMENT" strip into all
 * ~2,200 static files, production included, and flash it on every first paint
 * before hydration removed it again.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EnvironmentBanner } from "./environment-banner";

function answer(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

function unreachable() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the environment banner", () => {
  /**
   * The assertion this component exists to be safe about.
   *
   * "Configuration absent" is not a special code path — it is the state of a
   * deployment where nobody set anything, and it reaches the browser as a
   * service that reports production or as no answer at all. Both are here.
   * Change the default in `app/site/environment.ts` so that an unknown or
   * failed answer means "test environment", and both of these go red.
   */
  it("draws nothing when nothing says this is a test environment", async () => {
    unreachable();

    render(<EnvironmentBanner />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    expect(screen.queryByText(/test environment/i)).toBeNull();
    expect(screen.queryByText(/not the live site/i)).toBeNull();
  });

  it("draws nothing when the service reports production", async () => {
    answer({ name: "Production", isProduction: true });

    render(<EnvironmentBanner />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    expect(screen.queryByText(/test environment/i)).toBeNull();
  });

  it("says plainly that this is a test environment and that data goes away", async () => {
    answer({ name: "QA", isProduction: false });

    render(<EnvironmentBanner />);

    const notice = await screen.findByText(/test environment/i);

    expect(notice).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/not the live site/i);
    expect(screen.getByRole("status")).toHaveTextContent(
      /temporary and will be deleted/i,
    );
  });

  /**
   * The prerender is the case that cannot be fixed after the fact: whatever is
   * in these bytes is in every static file the container serves, to everybody.
   * Rendering to static markup is exactly what the build does, so a banner that
   * appeared here would appear there.
   *
   * The service is told to say QA while this runs, which makes the assertion
   * meaningful rather than accidental: it holds because effects do not run
   * during a server render, not because nothing was configured.
   */
  it("is absent from the prerendered markup even on a test deployment", () => {
    answer({ name: "QA", isProduction: false });

    const html = renderToStaticMarkup(<EnvironmentBanner />);

    expect(html).not.toMatch(/test environment/i);
    expect(html).not.toMatch(/not the live site/i);
  });

  /**
   * Hydration safety, stated as the property that guarantees it: the first
   * client render has to produce the same tree the build did. An effect is the
   * only place the answer may be applied, and this is what fails if somebody
   * moves the fetch into render or seeds the state from anything but null.
   */
  it("first renders exactly what the build produced", () => {
    answer({ name: "QA", isProduction: false });

    const prerendered = renderToStaticMarkup(<EnvironmentBanner />);
    const { container } = render(<EnvironmentBanner />);

    expect(container.innerHTML).toBe(prerendered);
  });

  /**
   * The live region has to be in the document before it has anything to say.
   * A region inserted together with its text is often not announced at all,
   * because there was no region there for assistive technology to observe a
   * change in — and a banner nobody hears is the same as no banner for the
   * readers most likely to be confused by a test deployment.
   */
  it("has a polite live region from the first render, before any answer", () => {
    answer({ name: "Production", isProduction: true });

    const { container } = render(<EnvironmentBanner />);

    const region = container.querySelector('[role="status"]');

    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
  });

  /**
   * Nothing focusable, ever. This sits above the skip link, which has to stay
   * the first thing a keyboard user reaches on every page — a dismiss button
   * here would take that place — and a strip with no focusable descendants
   * cannot trap focus by construction.
   */
  it("puts nothing focusable in front of the skip link", async () => {
    answer({ name: "QA", isProduction: false });

    const { container } = render(<EnvironmentBanner />);

    await screen.findByText(/test environment/i);

    expect(
      container.querySelectorAll(
        'a, button, input, select, textarea, [tabindex], [contenteditable]',
      ),
    ).toHaveLength(0);
  });
});
