/**
 * The few facts about this deployment that the site cannot work out for itself.
 *
 * ## The problem
 *
 * There are two of them, and they arrived a release apart.
 *
 * QA has to say, visibly, that it is QA and that nothing typed into it is kept.
 * And when the mail relay is refusing everything, the account screens have to
 * stop telling people a link is on its way — see `isAccountEmailDelivering`
 * below for why that one is not merely a nicety.
 *
 * The site cannot work either out for itself. Every page here is prerendered to
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
 * The API already knows both. It is configured per environment, has its own
 * database and its own mail provider in each, and it answers
 * `GET /api/site/environment` with `{ name, isProduction, accountEmailDelivering }`.
 * The site asks it and works from the answer. The image stays identical across
 * environments and carries no configuration at all — the only thing that
 * differs between QA and production is a variable on the service that already
 * had to have one.
 *
 * The two answers are read at different moments and that is deliberate. Which
 * deployment this is settles once, at hydration, because it cannot change under
 * the reader. Whether mail is getting out is asked at the instant the interface
 * is about to promise a message, because it can change between page load and
 * form submission, and because the API attempts its send before it answers —
 * so a read taken after a 202 reflects the failure that very submission caused.
 *
 * The request is same-origin, which is what keeps the Content-Security-Policy
 * at `connect-src 'self'` with no host named in it: the deployment routes
 * `/api` to the service through the same reverse proxy that serves this site.
 *
 * ## Why not `apiRequest` from `app/api/http.ts`
 *
 * That transport exists and is the right one for everything the account and
 * flagging features do. It is the wrong one here, for three reasons, and the
 * first is not a preference.
 *
 * It sends `credentials: "same-origin"`, so every call carries the session
 * cookie. Which deployment this is has nothing to do with who is reading, and a
 * public endpoint that receives the session cookie has quietly joined the
 * authenticated surface. This one sends no credentials at all.
 *
 * It also throws an `ApiError` classified into a failure taxonomy the caller is
 * expected to branch on, and it has no deadline. Both are right for a form that
 * has to tell somebody why their submission failed. Here there is exactly one
 * answer for every failure, and a request still in flight after a few seconds
 * has already missed its purpose — so the classification would only be thrown
 * away and the deadline would still have to be added.
 *
 * If this file ever needs a second endpoint, that is the moment to revisit it.
 * One anonymous GET is not.
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

  /**
   * Whether account mail is currently reaching the provider.
   *
   * Optional because the wire is older than the field. A service that predates
   * it, or a proxy answering from a half-finished deploy, sends a body without
   * it, and that has to mean "carry on as before" rather than either a crash or
   * a mail-outage warning. `isAccountEmailDelivering` is where that is decided.
   */
  accountEmailDelivering?: boolean;
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
  //
  // `accountEmailDelivering` is deliberately *not* required here. Requiring it
  // would mean an API deployed a release behind produced no banner in QA, which
  // is a regression in a working feature caused by the absence of an unrelated
  // one. Each field is instead read with its own default at the point of use.
  return typeof candidate.isProduction === "boolean";
}

/**
 * Fetches the document, or returns null if anything at all went wrong.
 *
 * Never throws and never rejects. Callers that had to handle a failure would
 * each have to decide what a failure means, and the two callers here want
 * opposite defaults from the same silence — so the failure is flattened to one
 * value and each of them states its own default against it, in one line, where
 * it can be read and tested.
 *
 * @param signal Aborts the request when the component asking goes away.
 */
async function read(signal?: AbortSignal): Promise<SiteEnvironment | null> {
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

    if (!response.ok) return null;

    // During a partial deploy the static host answers `/api/*` with this app's
    // own HTML shell and a 200. Parsing that as JSON throws, which the catch
    // below turns into "production" — but checking the content type first keeps
    // the common case out of the exception path and says what is being guarded
    // against.
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;

    const body: unknown = await response.json();

    return isSiteEnvironment(body) ? body : null;
  } catch {
    // Timeout, abort, offline, DNS, a redirect off-origin, a body that is not
    // JSON. All of them are "no answer", and each caller below turns that into
    // whichever of its two outcomes changes nothing.
    return null;
  }
}

/**
 * Asks the service whether this is a test environment.
 *
 * Never throws and never rejects.
 *
 * @param signal Aborts the request when the component asking goes away.
 * @returns True only when the service explicitly reported a non-production
 * deployment.
 */
export async function isTestEnvironment(signal?: AbortSignal): Promise<boolean> {
  const environment = await read(signal);

  // Every failure is production. See the note at the top of this file: the
  // banner appearing where it should not is worse than it not appearing where
  // it should.
  return environment !== null && !environment.isProduction;
}

/**
 * Asks the service whether account mail is currently getting out.
 *
 * ## Why this is asked at all
 *
 * Because the site was lying without it. Registering on QA answered 202 and
 * produced "a verification link is on its way to your address", followed by an
 * offer to go and look in the spam folder. Nothing had been sent: the relay had
 * refused the message and the API knew it at the moment the page said otherwise.
 * A reader who is told to wait for something that will never arrive waits, and
 * then blames their own address.
 *
 * ## Why the answer is global and never about an address
 *
 * This is the constraint that shapes the whole feature. The account endpoints
 * answer 202 with an identical body whether or not an address has an account,
 * and that is what stops anyone using them to discover who is registered here.
 * "We could not send to *your* address" would hand that back: asking it about
 * an address is asking whether the address has an account.
 *
 * "Email is not being delivered, for anyone" reveals nothing about anybody. It
 * is one fact, the same fact for every reader, and the service has no
 * per-address version of it to leak even if something here asked.
 *
 * ## Why silence means "delivering"
 *
 * The opposite default to `isTestEnvironment`, and for the same underlying
 * rule: the safe answer is the one that changes nothing. A reachable service
 * saying mail is broken is a reason to stop promising mail. Not reaching the
 * service is not — it would mean every reader on a flaky connection, and every
 * reader during a partial deploy, is told the site's email is down on the
 * strength of a request that did not come back. That is the same failure as a
 * "test environment" banner on the live site: a warning shown without grounds
 * is a warning people stop reading.
 *
 * @param signal Aborts the request when the component asking goes away.
 * @returns False only when the service explicitly reported that mail is not
 * getting out.
 */
export async function isAccountEmailDelivering(
  signal?: AbortSignal,
): Promise<boolean> {
  const environment = await read(signal);

  // Checked for being exactly `false` rather than for being falsy, and read off
  // a possibly-absent field. An API a release behind sends no such field, and
  // `undefined` there has to leave the wording alone rather than announce an
  // outage nobody reported.
  return environment?.accountEmailDelivering !== false;
}
