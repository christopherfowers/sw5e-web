/**
 * Which deployment the reader is looking at, and why the site has to ask.
 *
 * ## The problem
 *
 * QA has to say, visibly, that it is QA and that nothing typed into it is kept.
 * The site cannot work that out for itself. Every page here is prerendered to
 * static HTML at build time and served by nginx, so there is no server-side
 * render at request time and no environment variable can be read per request.
 *
 * The obvious alternative is to bake the answer in during `npm run build` and
 * ship a QA image and a production image. That was rejected outright, and not
 * on grounds of convenience: it would mean the artifact that passed QA is not
 * the artifact that reaches production. The entire value of promoting a tested
 * image is that the bytes do not change on the way, and a build-time flag makes
 * "tested in QA" a statement about a different binary.
 *
 * A second alternative is a small runtime configuration file — `/config.json`,
 * or an `envsubst` over a template as nginx starts. That keeps one image, but it
 * moves the answer into the web container's own configuration, which means the
 * two deployments differ in something the web tier has to be given and can be
 * given wrongly. It also fails ambiguously: a missing file is indistinguishable
 * from a file that failed to render.
 *
 * ## What this does instead
 *
 * The API already knows. It is configured per environment, has its own database
 * and its own mail provider in each, and it answers `GET /api/site/environment`
 * with `{ name, isProduction }`. The site asks it once, after hydration, and
 * draws the banner from the answer. The image stays identical across
 * environments and carries no configuration at all — the only thing that
 * differs between QA and production is a variable on the service that already
 * had to have one.
 *
 * The request is same-origin, which is what keeps the Content-Security-Policy
 * at `connect-src 'self'` with no host named in it: the deployment routes
 * `/api` to the service through the same reverse proxy that serves this site.
 *
 * ## Fail closed, always
 *
 * `isTestEnvironment` returns true only when the service explicitly says it is
 * not production. Every other outcome — no network, a timeout, a 404 because
 * the API is not mounted yet during a partial deploy, an HTML error page from
 * the proxy, a body of the wrong shape — returns false and draws nothing.
 *
 * That asymmetry is the point and is worth stating plainly, because "show a
 * banner when something goes wrong" is the more usual instinct and is wrong
 * here. A missing banner in QA is an inconvenience for a handful of people who
 * already know they are in QA. A "test environment, nothing here is kept"
 * banner on the live site tells every reader that the reference they are
 * consulting is disposable, and it would be on every page of the site. So
 * silence is read as production, and only a clear answer to the contrary
 * produces a banner.
 */

/** The service's answer. Exported for the tests and for nothing else. */
export interface SiteEnvironment {
  name: string;
  isProduction: boolean;
}

const ENDPOINT = "/api/site/environment";

/**
 * How long the site is willing to wait before deciding it did not get an
 * answer.
 *
 * Bounded rather than left to the browser's own timeout, which can be tens of
 * seconds. Nothing depends on this request — the page is already rendered and
 * fully usable without it — so a request still in flight after a few seconds
 * has already failed at its actual job, which is to warn somebody before they
 * type into a database that gets dropped.
 */
const TIMEOUT_MS = 5_000;

function isSiteEnvironment(value: unknown): value is SiteEnvironment {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<SiteEnvironment>;

  // `isProduction` is checked for being a boolean rather than merely being
  // falsy. A body with the field missing would otherwise read as "not
  // production" and put the banner on the live site — which is exactly the
  // shape of thing a proxy or a future API version could serve.
  return typeof candidate.isProduction === "boolean";
}

/**
 * Asks the service whether this is a test environment.
 *
 * Never throws and never rejects: a caller that had to handle a failure would
 * have to decide what a failure means, and there is only one safe answer, so it
 * is made here.
 *
 * @param signal Aborts the request when the component asking goes away.
 * @returns True only when the service explicitly reported a non-production
 * deployment.
 */
export async function isTestEnvironment(signal?: AbortSignal): Promise<boolean> {
  try {
    // Inside the try, not above it. `AbortSignal.any` is recent enough that an
    // older browser may not have it, and a synchronous throw out here would
    // escape as an unhandled rejection rather than as the "assume production"
    // this function promises. Composing the caller's signal with the deadline
    // means unmounting still cancels and a slow answer still gives up.
    const deadline = AbortSignal.timeout(TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;

    const response = await fetch(ENDPOINT, {
      headers: { Accept: "application/json" },
      // No credentials, deliberately. Which deployment this is has nothing to
      // do with who is reading it, and sending the session cookie on a request
      // that does not need it is how a public endpoint quietly becomes part of
      // the authenticated surface.
      credentials: "omit",
      // A redirect off this origin would take the request somewhere the policy
      // never agreed to. Failing is better than following, and failing here
      // means no banner.
      redirect: "error",
      cache: "no-store",
      signal: combined,
    });

    if (!response.ok) return false;

    // During a partial deploy the static host answers `/api/*` with this app's
    // own HTML shell and a 200. Parsing that as JSON throws, which the catch
    // below turns into "production" — but checking the content type first keeps
    // the common case out of the exception path and says what is being guarded
    // against.
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return false;

    const body: unknown = await response.json();

    return isSiteEnvironment(body) && !body.isProduction;
  } catch {
    // Every failure is production. See the note at the top of this file: the
    // banner appearing where it should not is worse than it not appearing where
    // it should.
    return false;
  }
}
