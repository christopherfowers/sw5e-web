/**
 * Signing in: with a passkey, or with a code sent to an email address, and
 * answering a second factor when one is set.
 *
 * ## Why there are two doors, and why they are not the same size
 *
 * A passkey is the better credential by every measure that matters here — it
 * cannot be phished, cannot be replayed on another site, never travels, and
 * there is nothing to remember. So it is the first thing on the page, it is
 * the primary button, and it is what the copy recommends.
 *
 * It is also unavailable to a real proportion of people, and pretending
 * otherwise is how a sign-in page quietly excludes them. A shared library
 * machine cannot enrol one. A desktop old enough to have no platform
 * authenticator can only use a security key somebody has to own. A managed
 * work laptop may forbid enrolment outright. None of those readers has done
 * anything wrong, and until this page grew a second door the only thing it
 * could tell them was to find a different computer.
 *
 * The emailed code is that second door: clearly labelled, one step down the
 * page, and framed as the alternative rather than as an equal. It proves
 * control of an inbox and nothing about the device typing it, which is exactly
 * why the API marks the session it creates as not strongly authenticated and
 * refuses contributor work to it. The account page then offers passkey
 * enrolment to whoever came through it — once, as an offer, not as a banner
 * that follows them around.
 *
 * ## What can go wrong, and what this does about each
 *
 *   the browser has no WebAuthn      say so, and offer the way forward that
 *                                    still exists — the emailed code, or
 *                                    another device
 *   the device has no platform
 *   authenticator (no Touch ID,
 *   Windows Hello, screen lock)      still offer the button, because a
 *                                    security key or a phone can answer it,
 *                                    but say what will happen first
 *   the reader dismisses the prompt  a plain, blameless message and the button
 *                                    still there, ready
 *   the prompt times out             indistinguishable from the above by
 *                                    design; the copy covers both rather than
 *                                    guessing
 *   the page is not on HTTPS         named as the cause it is, instead of the
 *                                    generic security error the browser throws
 *   the emailed code is wrong,
 *   expired, spent or was issued
 *   for another address              one message for all of them, because the
 *                                    API draws no distinction and a UI that
 *                                    invented one would leak which addresses
 *                                    have accounts
 *   too many codes asked for         reported as rate limiting, which is
 *                                    something to wait out, and never as the
 *                                    service being down
 *   the API is unreachable           distinguished from every refusal above,
 *                                    so nobody is told their credential is bad
 *                                    when the service is simply absent
 *   the mail relay is refusing
 *   everything                       the page stops saying a code is on its
 *                                    way, because it is not. See below
 *
 * ## The one that is not a refusal
 *
 * A code request answers 202 whether or not the address has an account, and
 * also whether or not the message it just tried to send got out. The second was
 * invisible here, so with the relay refusing everything this page said a code
 * was on its way and then offered the reader their own spam folder. It was
 * saying it while the API already knew otherwise.
 *
 * So the code request is followed by a read of `/api/site/environment`, which
 * publishes whether mail is getting out at all. That question carries no
 * address and its answer is the same for every caller — "email is not going
 * out" is true of the site, not of anybody's account — which is what makes it
 * safe to show on a page whose whole design is that it reveals nothing about
 * which addresses are registered. A per-address answer would be the oracle the
 * identical 202 exists to prevent.
 *
 * If that read fails, the page says exactly what it said before it existed.
 *
 * Capability probes run in an effect, never during render: this page is
 * prerendered on a build machine that has no `navigator`, and a first render
 * that consulted one would produce markup the browser then disagrees with.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import {
  ApiError,
  beginPasskeyLogin,
  completePasskeyLogin,
  requestSignInCode,
  verifySignInCode,
  verifyTotp,
} from "~/auth/api";
import { safeNextPath } from "~/auth/redirect";
import { useSession } from "~/auth/session";
import {
  getPasskeyAssertion,
  hasPlatformAuthenticator,
  supportsWebAuthn,
  WebAuthnError,
} from "~/auth/webauthn";
import { AuthCard, Banner, SubmitButton, TextField } from "~/components/auth-ui";
import { isAccountEmailDelivering } from "~/site/environment";

import "~/styles/account.css";

export function meta() {
  return [
    { title: "Sign in — Star Wars 5e" },
    {
      name: "description",
      content:
        "Sign in to your Star Wars 5e community account with a passkey, or with a one-time code sent to your email address. The reference itself is readable without an account.",
    },
    { name: "robots", content: "noindex" },
  ];
}

interface Failure {
  title: string;
  body?: string;
}

/**
 * The four screens this page can be showing.
 *
 * `passkey` is the landing step and the recommended path; `email` and `code`
 * are the two halves of the alternative; `totp` is the second factor, and it
 * is reached from either path — which is why the step machine records where
 * the reader came from rather than assuming.
 */
type Step = "passkey" | "email" | "code" | "totp";

/** The steps `totp` can be entered from, and therefore returned to. */
type CodeOrigin = Extract<Step, "passkey" | "code">;

/**
 * The heading each step announces itself with.
 *
 * These are `sr-only` and exist for one reason: changing step replaces the
 * whole card, and a reader who cannot see that happen is otherwise left with
 * focus on a button that no longer exists and no idea what the page now wants.
 * Focus moves here, the heading is read, and the next Tab starts inside the
 * new step rather than at the top of the document.
 */
const STEP_HEADING: Record<Step, string> = {
  passkey: "Choose how to sign in",
  email: "Enter your email address",
  code: "Enter the code we emailed you",
  totp: "Enter your authentication code",
};

/**
 * What the code step is called when nothing was emailed.
 *
 * The map above is the only place on this page that states, as a fact and to a
 * screen reader first, that a message was sent. Leaving it alone would mean the
 * one reader who cannot see the amber banner is the one reader still being told
 * to go and find an email.
 */
const NOTHING_SENT_HEADING = "No code was sent: email is not being delivered";

/**
 * Deliberately permissive, and deliberately the same shape `register.tsx`
 * uses. Whether an address can receive mail is settled by the mail that is
 * sent to it, not by a pattern; all this is for is catching the missing "@"
 * before it spends one of the five requests the caller's IP is allowed in a
 * quarter of an hour.
 */
function emailProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "That does not look like an email address.";
  }
  return null;
}

/** Whole minutes, floored at one, for a lifetime quoted in seconds. */
function minutesFor(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

export default function SignIn() {
  const [searchParams] = useSearchParams();
  const session = useSession();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("passkey");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Whether mail is getting out at all, as of the last code request.
   *
   * Global, and never about the address in the field above. The API answers a
   * code request identically whether or not that address has an account, and a
   * per-address delivery answer would hand back exactly the fact that identical
   * answer exists to withhold. "Email is not going out, for anyone" is one
   * sentence about the site that happens to be equally true for every reader.
   *
   * Starts true and is re-read on every request, so a relay that comes back
   * mid-session stops the warning without a reload. Unknown counts as true —
   * see `app/site/environment.ts` for why silence must change nothing.
   */
  const [mailDelivering, setMailDelivering] = useState(true);

  /**
   * Where `totp` was entered from, so "start over" returns the reader to the
   * door they actually used. Sending someone who has no passkey back to the
   * passkey step is a dead end dressed up as a fresh start.
   */
  const [codeOrigin, setCodeOrigin] = useState<CodeOrigin>("passkey");

  /**
   * The two numbers the server sent with the last accepted code request.
   *
   * Both are the service's, not this file's. The resend cooldown and the code
   * lifetime are budgets the API enforces, and a client that hard-coded either
   * would go out of step with the service the first time somebody tuned it —
   * showing a button as ready a quarter of a minute before the server will
   * accept it, or promising ten minutes on a code good for five.
   */
  const [resendIn, setResendIn] = useState(0);
  const [codeLifetimeSeconds, setCodeLifetimeSeconds] = useState(0);

  /**
   * `null` means "not probed yet", which is the state both the prerender and
   * the first client render are in. Only after the effect below runs does this
   * become a real answer, so nothing about the initial markup depends on the
   * hardware the page happens to be opened on.
   */
  const [capability, setCapability] = useState<{
    webauthn: boolean;
    platform: boolean;
  } | null>(null);

  const ceremony = useRef<AbortController | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<Step>(step);

  const { adopt, status } = session;
  const nextParam = searchParams.get("next");
  const destination = safeNextPath(nextParam);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const webauthn = supportsWebAuthn();
      const platform = webauthn ? await hasPlatformAuthenticator() : false;
      if (!cancelled) setCapability({ webauthn, platform });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Someone who is already signed in has no business on this page — most often
  // they got here from a stale tab or the browser's back button.
  useEffect(() => {
    if (status === "authenticated") void navigate(destination, { replace: true });
  }, [status, destination, navigate]);

  // Abandon any prompt still open when this page goes away, so a later attempt
  // is not refused for having one outstanding.
  useEffect(() => () => ceremony.current?.abort(), []);

  /*
   * Focus follows the step, but only once the reader has actually moved.
   * Comparing against the previous value rather than firing on mount is what
   * keeps the page from yanking focus out of the address bar the instant it
   * loads — a heading that grabs focus on arrival is its own accessibility
   * bug, and the landing step has a real `h1` for orientation anyway.
   */
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepHeadingRef.current?.focus();
  }, [step]);

  /*
   * The resend cooldown, counted down a second at a time so the button can say
   * how long is left rather than simply refusing.
   *
   * The interval is keyed on whether a countdown is running rather than on the
   * number itself, so it is created once per cooldown instead of being torn
   * down and rebuilt on every tick.
   */
  const countingDown = resendIn > 0;
  useEffect(() => {
    if (!countingDown) return;
    const timer = setInterval(() => {
      setResendIn((remaining) => (remaining <= 1 ? 0 : remaining - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countingDown]);

  /**
   * Turns a thrown thing into the two sentences a reader needs.
   *
   * `refusalTitle` is what to say when the service refused the credential
   * itself, and it differs per step — telling someone in the middle of the
   * emailed-code flow that "that passkey was not accepted" is worse than
   * saying nothing. The two failures that are *not* about the credential are
   * handled here for every step, because getting them wrong is the expensive
   * mistake: rate limiting is something to wait out, an outage is something to
   * retry, and a refusal is something to correct. A page that shows one of
   * those messages for another sends the reader off to fix the wrong thing.
   */
  function reportFailure(error: unknown, refusalTitle: string) {
    if (error instanceof DOMException && error.name === "AbortError") return;

    if (error instanceof WebAuthnError) {
      setFailure({ title: error.message, body: error.hint ?? undefined });
      return;
    }
    if (error instanceof ApiError) {
      setFailure({
        title:
          error.kind === "unavailable"
            ? "The account service could not be reached."
            : error.kind === "rate-limited"
              ? "Too many attempts from here."
              : refusalTitle,
        body: error.message,
      });
      return;
    }
    setFailure({
      title: "Sign-in could not be completed.",
      body: "Try again in a moment.",
    });
  }

  async function signInWithPasskey() {
    setFailure(null);
    setNotice(null);
    setPending(true);

    ceremony.current?.abort();
    const controller = new AbortController();
    ceremony.current = controller;

    try {
      // No argument: the API ignores any body here and never takes an address.
      const options = await beginPasskeyLogin();
      const credential = await getPasskeyAssertion(options, controller.signal);
      const result = await completePasskeyLogin(credential);

      if (result.status === "mfaRequired") {
        setCodeOrigin("passkey");
        setStep("totp");
        return;
      }
      adopt(result.user);
      void navigate(destination, { replace: true });
    } catch (error) {
      reportFailure(error, "That passkey was not accepted.");
    } finally {
      if (ceremony.current === controller) ceremony.current = null;
      setPending(false);
    }
  }

  /**
   * Asks for a code, for the first time or again.
   *
   * `resend` only changes what is said afterwards. The request is the same one
   * either way, and so is the answer: a 202 whose body is identical whether
   * the address has an account, has never been seen, or has already had its
   * three codes for the quarter hour. Nothing below reads that body for a
   * verdict, because there is none in it — see `EmailCodeResponse`.
   */
  async function sendCode({ resend = false } = {}) {
    const address = email.trim();
    const problem = emailProblem(address);
    if (problem) {
      setEmailError(problem);
      setFailure(null);
      return;
    }

    setEmailError(null);
    setFailure(null);
    setNotice(null);
    setPending(true);
    try {
      const result = await requestSignInCode(address);

      // Asked after the request, not before, and that ordering is the whole
      // value of it: the API attempts the send before it answers, so a relay
      // that has just refused this reader's code is already reflected here.
      // Every failure to find out resolves true, which leaves every sentence
      // below exactly as it was before this call existed.
      const delivering = await isAccountEmailDelivering();

      setMailDelivering(delivering);
      setResendIn(result.resendAfterSeconds);
      setCodeLifetimeSeconds(result.expiresInSeconds);
      setCode("");
      setStep("code");
      // On a resend the step does not change, so nothing moves focus and
      // nothing else would tell a screen reader the button had done anything.
      //
      // The previous code stops working either way: the service issued a new
      // one and superseded it, and whether the message carrying it got out is a
      // separate question. Somebody holding an old code needs telling that it
      // is dead even — especially — when the new one never arrived.
      if (resend) {
        setNotice(
          delivering
            ? "A new code is on its way. The previous one no longer works."
            : "No code was sent: email is not being delivered right now. The previous code no longer works either.",
        );
      }
    } catch (error) {
      reportFailure(error, "That address could not be used.");
    } finally {
      setPending(false);
    }
  }

  async function submitEmailCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = code.replace(/\s/g, "");
    if (digits.length !== 6) {
      setFailure({
        title: "Enter the six-digit code.",
        body: "It is the number in the email that was just sent.",
      });
      return;
    }

    setFailure(null);
    setNotice(null);
    setPending(true);
    try {
      const result = await verifySignInCode(email.trim(), digits);
      if (result.status === "mfaRequired") {
        setCode("");
        setCodeOrigin("code");
        setStep("totp");
        return;
      }
      adopt(result.user);
      void navigate(destination, { replace: true });
    } catch (error) {
      // Cleared before the message is set, so the field is empty and ready by
      // the time the reader has finished reading why. Leaving six wrong digits
      // in place means the next attempt starts with a selection and a delete.
      setCode("");
      /*
       * One sentence for every failure, and that is not laziness. The API
       * answers 401 without distinction for a wrong code, an expired one, one
       * already redeemed, one issued for a different address, a code whose
       * attempts are spent, an address with no account, and a locked-out
       * account. It could hardly do otherwise: "that code has expired" told to
       * somebody guessing is confirmation that the address they guessed has an
       * account. The client is in no position to say more, and must not
       * pretend it is.
       */
      reportFailure(error, "That code was not accepted.");
    } finally {
      setPending(false);
    }
  }

  async function submitTotpCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = code.replace(/\s/g, "");
    if (digits.length !== 6) {
      setFailure({
        title: "Enter the six-digit code.",
        body: "It is the number your authenticator app is showing right now.",
      });
      return;
    }

    setFailure(null);
    setPending(true);
    try {
      const result = await verifyTotp(digits);
      if (result.status !== "authenticated") {
        // Enrolment and challenge share an endpoint; an "enabled" reply to a
        // sign-in means the session is not what either side thought it was.
        setFailure({
          title: "That code did not complete sign-in.",
          body: "Start again from the beginning.",
        });
        setStep(codeOrigin);
        return;
      }
      adopt(result.user);
      void navigate(destination, { replace: true });
    } catch (error) {
      setCode("");
      reportFailure(error, "That code was not accepted.");
    } finally {
      setPending(false);
    }
  }

  /**
   * Returns to the landing step, discarding whatever the other path held.
   *
   * Everything the alternative accumulated goes with it — the code, the
   * banner, the field-level complaint about the address — so that coming back
   * to it later starts clean instead of opening on a criticism of something
   * that has since been retyped. The address itself is kept, because it is the
   * one thing worth not making somebody type twice.
   */
  function startWithPasskey() {
    setStep("passkey");
    setCode("");
    setFailure(null);
    setNotice(null);
    setEmailError(null);
  }

  /** Moves to the address step from either side of it, on the same terms. */
  function askForAddress() {
    setStep("email");
    setCode("");
    setFailure(null);
    setNotice(null);
    setEmailError(null);
  }

  const heading = (
    <h2 className="sr-only" tabIndex={-1} ref={stepHeadingRef}>
      {step === "code" && !mailDelivering
        ? NOTHING_SENT_HEADING
        : STEP_HEADING[step]}
    </h2>
  );

  const errorBanner = failure ? (
    <Banner tone="error" title={failure.title}>
      {failure.body}
    </Banner>
  ) : null;

  if (step === "totp") {
    return (
      <AuthCard
        title="One more step"
        lede="Your account is protected by an authenticator app."
      >
        {heading}
        {errorBanner}
        <form className="auth-form" onSubmit={submitTotpCode} noValidate>
          <TextField
            label="Six-digit code"
            name="code"
            value={code}
            onChange={setCode}
            // The browser and password managers both know this one; without it
            // an iPhone will not offer the code it just read from the SMS or
            // the app.
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            required
            disabled={pending}
            hint="From your authenticator app. It changes every 30 seconds."
          />
          <div className="auth-actions">
            <SubmitButton pending={pending} pendingLabel="Checking…">
              Verify and sign in
            </SubmitButton>
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={() => {
                // Back to whichever door this reader came through. The
                // alternative — always the passkey step — strands anybody who
                // reached here without one.
                setStep(codeOrigin);
                setCode("");
                setFailure(null);
              }}
            >
              Start over
            </button>
          </div>
        </form>
      </AuthCard>
    );
  }

  if (step === "code") {
    return (
      /*
       * Two headings and two ledes for one step, chosen by a fact about the
       * site rather than about the address in the field.
       *
       * The honest branch still renders the form. A code that was issued before
       * the relay broke is still live until it expires, and a reader holding
       * one has a way in that costs nothing to leave open — whereas a screen
       * that removed the field would strand them for a reason that has nothing
       * to do with them. What it does not do is claim anything arrived.
       */
      <AuthCard
        title={mailDelivering ? "Check your inbox" : "Email is not being delivered right now"}
        lede={
          mailDelivering ? (
            <>
              If <strong>{email.trim()}</strong> has an account, a six-digit code
              is on its way to it.
            </>
          ) : (
            <>No sign-in code was sent.</>
          )
        }
      >
        {heading}
        {errorBanner}
        {notice ? (
          <Banner tone={mailDelivering ? "success" : "warning"} title={notice} />
        ) : null}
        {mailDelivering ? null : (
          /*
           * Nothing in here mentions the address that was typed. It is a
           * statement about the site, identical for every reader, and so it
           * cannot be used to work out who has an account.
           */
          <Banner tone="warning" title="Email from this site is not going out at the moment.">
            This is happening for everyone, not just for you, and it is not a
            problem with your address. Checking your spam folder will not help,
            because nothing was sent to it.
          </Banner>
        )}

        <form className="auth-form" onSubmit={submitEmailCode} noValidate>
          <TextField
            label="Six-digit code"
            name="code"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            required
            disabled={pending}
            hint={
              mailDelivering
                ? codeLifetimeSeconds > 0
                  ? `From the email. It is good for one use and expires after ${minutesFor(codeLifetimeSeconds)} minutes.`
                  : "From the email. It is good for one use."
                : codeLifetimeSeconds > 0
                  ? `Only if you already have one from earlier. Codes are good for one use and expire after ${minutesFor(codeLifetimeSeconds)} minutes.`
                  : "Only if you already have one from earlier. Codes are good for one use."
            }
          />
          <div className="auth-actions">
            <SubmitButton pending={pending} pendingLabel="Checking…">
              Sign in
            </SubmitButton>
            {/* Not a `SubmitButton`: its label has to carry the countdown, so
                that a disabled control says how long it will be disabled for
                rather than simply refusing to be pressed. */}
            <button
              type="button"
              className="button"
              disabled={pending || countingDown}
              onClick={() => void sendCode({ resend: true })}
            >
              {countingDown ? `Send a new code (${resendIn}s)` : "Send a new code"}
            </button>
          </div>
        </form>

        {mailDelivering ? (
          <p className="auth-note">
            Nothing arrived? Check the spam folder, or{" "}
            <button
              type="button"
              className="link-button"
              disabled={pending}
              onClick={askForAddress}
            >
              use a different address
            </button>
            . You can also{" "}
            <button
              type="button"
              className="link-button"
              disabled={pending}
              onClick={startWithPasskey}
            >
              sign in with a passkey instead
            </button>
            .
          </p>
        ) : (
          /*
           * No spam folder, and no offer to try another address: neither is a
           * remedy for a relay that is refusing everything, and both would send
           * the reader looking for a fault of their own that does not exist.
           * What is left is the door that does not go through email at all, and
           * the truth about when this one will work again.
           */
          <p className="auth-note">
            A passkey does not go through email, so{" "}
            <button
              type="button"
              className="link-button"
              disabled={pending}
              onClick={startWithPasskey}
            >
              signing in with one
            </button>{" "}
            still works if you have set one up. Otherwise this will start working
            again on its own once email is going out; asking for a new code will
            tell you whether it has.
          </p>
        )}
      </AuthCard>
    );
  }

  if (step === "email") {
    return (
      <AuthCard
        title="Sign in with an emailed code"
        lede="For a device that cannot use a passkey — a shared machine, an older computer, or one whose policy forbids enrolling one."
      >
        {heading}
        {errorBanner}

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void sendCode();
          }}
          noValidate
        >
          <TextField
            label="Email address"
            name="email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            inputMode="email"
            required
            disabled={pending}
            error={emailError}
            hint="The address the account was registered with."
          />
          <div className="auth-actions">
            <SubmitButton pending={pending} pendingLabel="Sending…">
              Email me a code
            </SubmitButton>
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={startWithPasskey}
            >
              Use a passkey instead
            </button>
          </div>
        </form>

        {/* Said before the code is asked for rather than after, because it is
            the reason the next screen will not tell them whether the address
            was right — and a reader who learns that only once they are stuck
            reasonably concludes the page is broken. */}
        <p className="auth-note">
          A code is sent only if that address already has an account, and this
          page is told the same thing either way. That is deliberate: it is what
          stops the sign-in page from being usable as a way to find out who has
          an account here.
        </p>
      </AuthCard>
    );
  }

  const unsupported = capability?.webauthn === false;

  return (
    <AuthCard
      title="Sign in"
      lede="The whole reference is readable without an account. Signing in is for managing your own profile and, for contributors, uploading content."
      footer={
        <>
          No account yet? <Link to="/register">Create one</Link>.
        </>
      }
    >
      {heading}
      {errorBanner}

      {unsupported ? (
        <Banner tone="error" title="This browser does not support passkeys.">
          Passkeys need a current version of Chrome, Edge, Safari or Firefox.
          You can still sign in with a code sent to your email address, below —
          your account and everything in it is unaffected. Open this page on a
          device that has one to use a passkey.
        </Banner>
      ) : null}

      {/* Only shown once the probe has actually answered. Rendering it on a
          `null` capability would flash a warning at everybody, including the
          overwhelming majority for whom it is untrue. */}
      {capability?.webauthn && !capability.platform ? (
        <Banner tone="info" title="This device has no built-in authenticator.">
          There is no fingerprint reader, face unlock or PIN available here, so
          you will be asked for a hardware security key or for a passkey on
          your phone.
        </Banner>
      ) : null}

      <div className="auth-form">
        <div className="auth-actions">
          <SubmitButton
            type="button"
            pending={pending}
            pendingLabel="Waiting for your passkey…"
            disabled={unsupported}
            onClick={() => void signInWithPasskey()}
          >
            Continue with a passkey
          </SubmitButton>
        </div>

        {/* There is deliberately no email field on *this* step, and adding one
            back would be offering a control that cannot do anything. The API
            ignores the request body on `passkey/login/begin`, never accepts an
            address, and always answers with an empty `allowCredentials` — so
            the challenge is identical for every caller, and there is no input
            here whose answer could differ between a registered address and an
            unregistered one. Every passkey the site issues is discoverable, so
            the authenticator already knows which account it is speaking for.

            The emailed-code path does take an address, and it is not an oracle
            either: that endpoint answers 202 with the same body for every
            address it can parse. The property survives; it is now enforced on
            the server rather than by the absence of a field. */}
        <p className="auth-note">
          A passkey is your device&apos;s own unlock — a fingerprint, your face,
          or the PIN you already use. It never leaves the device, cannot be
          reused on another site, and there is nothing to remember or to leak.
        </p>
      </div>

      {/* The alternative, and it reads like one: below the recommendation,
          without a primary button, and named by the situation it is for rather
          than sold as an equal choice. */}
      <div className="auth-alternative">
        <h2>No passkey on this device?</h2>
        <p>
          A shared or managed computer often cannot enrol one. Sign in with a
          one-time code instead, then add a passkey later from your account.
        </p>
        <div className="auth-actions">
          <button
            type="button"
            className="button"
            disabled={pending}
            onClick={askForAddress}
          >
            Email me a sign-in code
          </button>
        </div>
      </div>
    </AuthCard>
  );
}
