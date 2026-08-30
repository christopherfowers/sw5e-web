/**
 * Rendering an account screen the way the browser really assembles it.
 *
 * The tests could hand components a fake session object through context and
 * skip all of this. They deliberately do not: the whole architecture of this
 * feature is "the session is resolved after the first render, by a network
 * call", and a test that injects a resolved session has quietly deleted the
 * only interesting part. So these helpers mount the real `AuthProvider`, which
 * really calls `GET /api/auth/me`, against the contract fixture.
 *
 * The consequence is that every test starts in the loading state and has to
 * wait for the session — which is exactly the sequence a reader experiences,
 * and the reason `findBy*` rather than `getBy*` appears throughout.
 */

import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { vi } from "vitest";

import { AuthProvider } from "../app/auth/session";
import {
  AuthApiContract,
  contractFetch,
  type FetchAdapterOptions,
} from "./auth-api-contract";

/**
 * Points `fetch` at the contract fixture.
 *
 * There is nothing to plant beforehand. The API's cross-site protection is an
 * `Origin` allow-list, and `Origin` is written by the browser on every unsafe
 * method — so the adapter supplies it and the client sends nothing of its own.
 * A test that wants to prove the check is real passes a foreign `origin`, or
 * `null` for a request that carries none, and asserts the 403.
 */
export function serveApiContract(
  contract: AuthApiContract,
  options: FetchAdapterOptions = {},
): void {
  vi.stubGlobal("fetch", contractFetch(contract, options));
}

type StubRoutes = Parameters<typeof createRoutesStub>[0];

/**
 * Mounts routes inside the real session provider.
 *
 * The provider wraps the router rather than sitting inside a route, mirroring
 * `app/root.tsx`: the header needs the same answer the pages do, and a second
 * provider would let the two disagree.
 */
export function renderWithSession(
  routes: StubRoutes,
  initialEntries: string[] = ["/"],
) {
  const Stub = createRoutesStub(routes);
  return render(
    <AuthProvider>
      <Stub initialEntries={initialEntries} />
    </AuthProvider>,
  );
}

/** A placeholder page, so a test can assert that a redirect actually landed. */
export function marker(text: string) {
  return function Marker() {
    return <p>{text}</p>;
  };
}
