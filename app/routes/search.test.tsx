/**
 * The results page, and which of the two searches answered it.
 *
 * The service searches every word of every document; the downloaded index
 * searches names, statistics, headings and the first 240 characters of prose.
 * The page prefers the service and falls back — so the cases worth pinning are
 * the fallback happening at all, the reader being told when it does, and the
 * results looking the same either way.
 */

import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithSession } from "../../tests/harness";
import Search from "./search";

/** One group of one result, in the service's own shape. */
function serviceAnswer(name: string, snippet: string) {
  return {
    query: "difficult terrain",
    totalMatches: 1,
    groups: [
      {
        type: "rules",
        name: "Rule",
        pluralName: "Rules",
        routeSegment: "rules",
        totalMatches: 1,
        results: [
          {
            item: { slug: "phb-adventuring", name, source: "PHB" },
            matchedIn: "text",
            matchedField: null,
            snippet,
            score: 12,
          },
        ],
      },
    ],
  };
}

/**
 * Serves the search endpoint and the downloaded index.
 *
 * `service` null makes the endpoint fail, which is the fallback case; the
 * index is always served, because the page fetches it whatever happens rather
 * than waiting to discover it needs one.
 */
function serve({ service }: { service: unknown | null }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/search")) {
        if (service === null) return new Response("", { status: 503 });
        return new Response(JSON.stringify(service), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.includes("search-index")) {
        return new Response(
          JSON.stringify([
            {
              type: "rules",
              slug: "phb-adventuring",
              name: "Adventuring",
              source: "PHB",
              fields: [{ label: "Section", text: "Difficult Terrain", fragment: "difficult-terrain" }],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("", { status: 404 });
    }),
  );
}

function mount(at = "/search?q=difficult+terrain") {
  return renderWithSession([{ path: "/search", Component: Search }], [at]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when the service answers", () => {
  it("shows what it found, and says nothing about where from", async () => {
    // A reader should not be able to tell which search ran when both work.
    serve({ service: serviceAnswer("Adventuring", "…costs 2 feet of movement in difficult terrain…") });

    mount();

    expect(await screen.findByRole("link", { name: /Adventuring/ })).toBeInTheDocument();
    expect(screen.queryByText(/could not be reached/i)).toBeNull();
  });

  it("counts what the service found, not what fitted on the page", async () => {
    // The service caps each group, so the total and the number listed are
    // different questions and a reader is owed the first one.
    const answer = serviceAnswer("Adventuring", "difficult terrain");
    answer.totalMatches = 40;

    serve({ service: answer });
    mount();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/40 results/),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/showing 1/);
  });

  it("shows the phrase in context, from the service's own snippet", async () => {
    serve({
      service: serviceAnswer("Adventuring", "Moving through difficult terrain costs extra"),
    });

    mount();

    expect(
      await screen.findByText(/Moving through/),
    ).toBeInTheDocument();
  });
});

describe("when the service cannot be reached", () => {
  it("falls back to the downloaded index rather than showing nothing", async () => {
    serve({ service: null });

    mount();

    expect(await screen.findByRole("link", { name: /Adventuring/ })).toBeInTheDocument();
  });

  it("says so, rather than quietly returning less", async () => {
    /*
      The failure this exists to prevent is somebody searching for a rule they
      know is in the books, finding nothing, and concluding the site does not
      have it. A degraded search that does not admit it is worse than one that
      fails outright.
    */
    serve({ service: null });

    mount();

    expect(
      await screen.findByText(/search service could not be reached/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not the body of the rules text/i)).toBeInTheDocument();
  });
});

describe("before there is anything to search for", () => {
  it("asks for more characters rather than searching for one", async () => {
    // The service refuses a single character with a 400, so sending one would
    // spend a round trip to be told what this already knows.
    serve({ service: serviceAnswer("Adventuring", "x") });

    mount("/search?q=d");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/at least 2 characters/i),
    );
  });

  it("does not ask the service at all", async () => {
    serve({ service: serviceAnswer("Adventuring", "x") });

    mount("/search?q=d");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/at least 2 characters/i),
    );

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.map((call) => String(call[0])).filter((url) => url.includes("/api/search"))).toEqual([]);
  });
});
