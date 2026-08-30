/**
 * Who the reader is, resolved in the browser and nowhere else.
 *
 * This is the piece that makes authentication work on a site with no runtime
 * server. Every page of this app is prerendered to static HTML at build time
 * and served from nginx, so there is exactly one copy of each page and every
 * visitor gets the same bytes. Session state cannot be in those bytes: it
 * would be baked in at build time, when nobody is signed in, and it would be
 * cached and served to the next person if it were not.
 *
 * So the session is resolved after hydration, by asking the API. That leaves
 * one hazard, and it is the whole reason this is a three-state machine rather
 * than a nullable user:
 *
 *   loading → authenticated
 *           → anonymous
 *           → unavailable
 *
 * `loading` is not a nicety. It is the *only* state the prerendered HTML and
 * the first client render are allowed to be in, and because both are in it,
 * the markup React hydrates onto is the markup the build produced — no
 * mismatch, no re-render of the whole tree on first paint.
 *
 * It is also what stops a flash of the wrong state. Modelling this as
 * `user: CurrentUser | null` would make "not loaded yet" and "signed out"
 * the same value, so every signed-in reader would see "Sign in" in the header
 * for as long as the round trip took, on every single page load. The header
 * instead draws a neutral placeholder of the same size until the answer is
 * known: it never claims the reader is signed out, and nothing moves when the
 * answer arrives.
 *
 * `unavailable` is separated from `anonymous` for the same reason at a
 * different scale: a failed request is not a sign-out, and treating it as one
 * would throw a signed-in reader out of their account over a dropped
 * connection.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApiError, getCurrentUser, logout } from "./api";
import { effectiveRole } from "./roles";
import type { CurrentUser, Role } from "./types";

export type SessionStatus =
  | "loading"
  | "authenticated"
  | "anonymous"
  | "unavailable";

export interface Session {
  status: SessionStatus;
  /** Non-null exactly when `status` is `"authenticated"`. */
  user: CurrentUser | null;
  /** The account's most privileged role; `community` when signed out. */
  role: Role;
  /** Why the session could not be resolved, when `status` is `unavailable`. */
  error: string | null;
  /** Re-ask the server. Used after anything that changes the account. */
  refresh: () => Promise<void>;
  /**
   * Take a user the server just returned from sign-in or verification, so the
   * UI does not need a second round trip to `/me` before it can paint.
   */
  adopt: (user: CurrentUser) => void;
  signOut: () => Promise<void>;
}

const LOADING: Session = {
  status: "loading",
  user: null,
  role: "community",
  error: null,
  refresh: async () => {},
  adopt: () => {},
  signOut: async () => {},
};

export const SessionContext = createContext<Session>(LOADING);

interface ResolvedState {
  status: SessionStatus;
  user: CurrentUser | null;
  error: string | null;
}

/** What `GET /api/auth/me` answering successfully means for the session. */
function resolved(user: CurrentUser | null): ResolvedState {
  return user
    ? { status: "authenticated", user, error: null }
    : { status: "anonymous", user: null, error: null };
}

/**
 * What it means when it does not answer. Kept separate from `anonymous`: an
 * outage is not a sign-out, and conflating them logs people out over a dropped
 * connection.
 */
function unreachable(error: unknown): ResolvedState {
  return {
    status: "unavailable",
    user: null,
    error:
      error instanceof ApiError
        ? error.message
        : "The account service could not be reached.",
  };
}

/** The mutable slot holding whichever request is currently outstanding. */
type ControllerSlot = { current: AbortController | null };

/**
 * Cancels whatever is in flight *now*, which is deliberately not the same as
 * cancelling whatever was in flight when a caller was created: a `refresh()`
 * started after mount has to be cancelled by unmount too.
 */
function abortInFlight(slot: ControllerSlot): void {
  slot.current?.abort();
  slot.current = null;
}

/**
 * Starts a request for the current user and applies whatever comes back.
 *
 * Written as a module-level function taking an `apply` callback rather than as
 * a closure over `setState`, so that every state change happens in a promise
 * callback. Setting state straight from an effect body cascades an extra
 * render before the browser has painted, which is precisely what this feature
 * must not do: the first paint of every page on this site goes through here.
 */
function beginLoad(
  slot: ControllerSlot,
  apply: (next: ResolvedState) => void,
): Promise<void> {
  slot.current?.abort();
  const controller = new AbortController();
  slot.current = controller;

  return getCurrentUser(controller.signal).then(
    (user) => {
      if (!controller.signal.aborted) apply(resolved(user));
    },
    (error) => {
      if (!controller.signal.aborted) apply(unreachable(error));
    },
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Always `loading` on the first render, on the build machine and in the
  // browser alike. See the note at the top of this file: this is what keeps
  // hydration honest.
  const [state, setState] = useState<ResolvedState>({
    status: "loading",
    user: null,
    error: null,
  });

  // Held so a refresh triggered by a page can cancel one still in flight, and
  // so unmounting does not leave a `setState` waiting on a resolved promise.
  const inFlight = useRef<AbortController | null>(null);

  /**
   * The three actions are stable for the whole life of the provider, and that
   * is a correctness requirement rather than an optimisation.
   *
   * They are handed out through context, so any effect elsewhere that lists
   * one of them as a dependency re-runs whenever the session changes — and one
   * of them does: the page that follows a verification link. Rebuilding these
   * on every state change made that page submit its single-use token a second
   * time, the moment the first attempt succeeded and changed the state.
   */
  const load = useCallback(() => beginLoad(inFlight, setState), []);

  const adopt = useCallback((next: CurrentUser) => {
    abortInFlight(inFlight);
    setState({ status: "authenticated", user: next, error: null });
  }, []);

  const signOut = useCallback(async () => {
    abortInFlight(inFlight);
    try {
      await logout();
    } catch {
      // Deliberately swallowed, and this is the one place in the file where
      // that is the right answer. Clearing the cookie is the server's job and
      // this client cannot see whether it happened; what it can do is stop
      // presenting the reader as signed in. Re-throwing would leave them
      // looking signed in on a page that has just said "signing out", which is
      // the worse of the two failures. A cookie that outlived this request is
      // caught by the next request that needs it.
    }
    setState({ status: "anonymous", user: null, error: null });
  }, []);

  useEffect(() => {
    void beginLoad(inFlight, setState);
    return () => abortInFlight(inFlight);
  }, []);

  const value = useMemo<Session>(
    () => ({
      status: state.status,
      user: state.user,
      role: effectiveRole(state.user),
      error: state.error,
      refresh: load,
      adopt,
      signOut,
    }),
    [state, load, adopt, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}
