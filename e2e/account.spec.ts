import { expect, test } from "@playwright/test";

import {
  attachVirtualAuthenticator,
  passkey,
  serveAccountApi,
  user,
  VALID_EMAIL_CODE,
  VALID_TOTP_CODE,
  VALID_VERIFICATION_EMAIL,
  VALID_VERIFICATION_TOKEN,
} from "./account-mock";

/**
 * The account flows in a real browser, against a real WebAuthn implementation.
 *
 * The passkey tests drive Chrome's virtual authenticator over the DevTools
 * protocol rather than replacing `navigator.credentials`. That distinction is
 * what makes them worth running: the ceremony genuinely executes, a credential
 * is genuinely created and signed, and the challenge genuinely travels back
 * inside `clientDataJSON`, where the API fixture verifies it the way a relying
 * party does. A stubbed `navigator` cannot tell a working client from one that
 * invents an assertion.
 */

test.describe("route protection", () => {
  test("a signed-out reader is sent from the account to sign-in", async ({
    page,
    context,
  }) => {
    await serveAccountApi(page, context, { session: null });

    await page.goto("/account");

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });

  test("the redirect remembers where they were going", async ({ page, context }) => {
    await serveAccountApi(page, context, { session: null });

    await page.goto("/account/security");

    await expect(page).toHaveURL(/next=%2Faccount%2Fsecurity/);
  });

  test("a signed-in reader is not bounced anywhere", async ({ page, context }) => {
    await serveAccountApi(page, context, { session: user({ displayName: "Jen Ordo" }) });

    await page.goto("/account");

    // Sign-out is drawn only once the session has resolved to an account, so
    // it separates "recognised" from the guard's states. The heading is not:
    // it reads "Your account" in every one of them, including the state the
    // static file is frozen in.
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
    await expect(page.locator(".account-identity-name")).toHaveText("Jen Ordo");
    await expect(page).toHaveURL(/\/account$/);
  });

  test("the reference stays open to everyone", async ({ page, context }) => {
    // The one thing route protection must never touch.
    await serveAccountApi(page, context, { session: null });

    await page.goto("/species/abyssin");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Abyssin");
  });
});

test.describe("the header control", () => {
  test("offers a way in to a signed-out reader", async ({ page, context }) => {
    await serveAccountApi(page, context, { session: null });

    await page.goto("/");

    await expect(page.getByRole("link", { name: /^sign in$/i })).toBeVisible();
  });

  test("names the account of a signed-in reader", async ({ page, context }) => {
    await serveAccountApi(page, context, { session: user({ displayName: "Jen Ordo" }) });

    await page.goto("/");

    await expect(
      page.getByRole("link", { name: /jen ordo/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);
  });
});

test.describe("passkeys, end to end", () => {
  test("a passkey can be enrolled and then used to sign in", async ({
    page,
    context,
  }) => {
    const contract = await serveAccountApi(page, context, {
      session: user({ displayName: "Jen Ordo", passkeys: [] }),
    });
    await attachVirtualAuthenticator(page);

    // --- enrol -----------------------------------------------------------
    await page.goto("/account/passkeys");
    await expect(page.getByText(/no passkeys yet/i)).toBeVisible();

    await page.getByLabel(/name this passkey/i).fill("Test device");
    await page.getByRole("button", { name: /add a passkey/i }).click();

    await expect(page.locator("main").getByRole("status")).toContainText(/can now sign you in/i);
    await expect(page.locator(".credential-name", { hasText: "Test device" })).toBeVisible();
    expect(contract.session?.passkeys).toHaveLength(1);

    // --- sign out --------------------------------------------------------
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: /^sign in$/i })).toBeVisible();

    // --- sign back in with the passkey just created ----------------------
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /continue with a passkey/i }).click();

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator(".account-identity-name")).toHaveText("Jen Ordo");
    // The assertion really was verified: the fixture rejects any challenge it
    // did not issue, and consumes the one it did.
    expect(
      contract.calls.filter((call) => call.path === "/passkey/login/complete"),
    ).toHaveLength(1);
  });

  test("an enrolled passkey can be revoked", async ({ page, context }) => {
    // Two credentials, because the server refuses to remove the last one —
    // see the test below. A single-credential fixture here would be asserting
    // the wrong rule.
    const contract = await serveAccountApi(page, context, {
      session: user({
        passkeys: [
          passkey({ id: "a", name: "Work laptop" }),
          passkey({ id: "b", name: "iPhone" }),
        ],
      }),
    });

    await page.goto("/account/passkeys");
    await expect(page.locator(".credential-name", { hasText: "iPhone" })).toBeVisible();

    await page.getByRole("button", { name: /remove the passkey “iPhone”/i }).click();
    await page.getByRole("button", { name: /yes, remove it/i }).click();

    await expect(page.locator(".credential-name", { hasText: "iPhone" })).toHaveCount(0);
    expect(contract.session?.passkeys.map((entry) => entry.id)).toEqual(["a"]);
  });

  test("the last passkey is kept, and the reader is told so", async ({
    page,
    context,
  }) => {
    // Removing it would strand the account, so the server answers 409. The
    // page has already said "yes, remove it", so the outcome it must never
    // produce is a list with the credential quietly missing.
    const contract = await serveAccountApi(page, context, {
      session: user({ passkeys: [passkey({ id: "a", name: "Work laptop" })] }),
    });

    await page.goto("/account/passkeys");
    await page.getByRole("button", { name: /remove the passkey/i }).click();
    await page.getByRole("button", { name: /yes, remove it/i }).click();

    await expect(page.getByRole("alert")).toContainText(/only passkey, so it was kept/i);
    await expect(
      page.locator(".credential-name", { hasText: "Work laptop" }),
    ).toBeVisible();
    expect(contract.session?.passkeys).toHaveLength(1);
  });
});

test.describe("when WebAuthn is unavailable", () => {
  test.beforeEach(async ({ page }) => {
    // Removed before any application script runs, which is how a browser
    // without WebAuthn genuinely looks to the page.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "PublicKeyCredential");
      Reflect.deleteProperty(navigator, "credentials");
    });
  });

  test("sign-in says so instead of opening a prompt that cannot work", async ({
    page,
    context,
  }) => {
    await serveAccountApi(page, context, { session: null });

    await page.goto("/sign-in");

    await expect(page.getByRole("alert")).toContainText(
      /this browser does not support passkeys/i,
    );
    await expect(
      page.getByRole("button", { name: /continue with a passkey/i }),
    ).toBeDisabled();
  });

  test("the reference is entirely unaffected", async ({ page, context }) => {
    await serveAccountApi(page, context, { session: null });

    await page.goto("/powers/absorb-energy");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Absorb Energy",
    );
  });
});

test.describe("two-factor authentication", () => {
  test("is asked for after the passkey, and completes the sign-in", async ({
    page,
    context,
  }) => {
    const contract = await serveAccountApi(page, context, {
      session: user({ displayName: "Jen Ordo", twoFactorEnabled: true }),
      mfaRequired: true,
    });
    await attachVirtualAuthenticator(page);

    // Enrol a credential first, so there is something to sign in with.
    await page.goto("/account/passkeys");
    await page.getByRole("button", { name: /add a passkey/i }).click();
    await expect(page.locator("main").getByRole("status")).toContainText(/can now sign you in/i);

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page.getByRole("link", { name: /^sign in$/i })).toBeVisible();

    await page.goto("/sign-in");
    await page.getByRole("button", { name: /continue with a passkey/i }).click();

    // The passkey alone is not enough.
    await expect(page.getByLabel(/six-digit code/i)).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.getByLabel(/six-digit code/i).fill("000000");
    await page.getByRole("button", { name: /verify and sign in/i }).click();
    await expect(page.getByRole("alert")).toContainText(/not correct/i);
    await expect(page).toHaveURL(/\/sign-in/);

    await page.getByLabel(/six-digit code/i).fill(VALID_TOTP_CODE);
    await page.getByRole("button", { name: /verify and sign in/i }).click();

    await expect(page).toHaveURL(/\/account$/);
    expect(
      contract.calls.filter((call) => call.path === "/mfa/totp/verify"),
    ).toHaveLength(2);
  });

  test("enrolment shows a scannable code and the same secret as text", async ({
    page,
    context,
  }) => {
    await serveAccountApi(page, context, { session: user({ twoFactorEnabled: false }) });

    await page.goto("/account/security");
    await page.getByRole("button", { name: /set up an authenticator app/i }).click();

    // Both paths, because a QR code alone excludes screen reader users and
    // anyone whose authenticator app is on the device they are reading this on.
    await expect(page.locator("svg.qr-code")).toBeVisible();
    await expect(page.getByText(/JBSW Y3DP EHPK 3PXP/)).toBeVisible();

    await page.getByLabel(/six-digit code/i).fill(VALID_TOTP_CODE);
    await page
      .getByRole("button", { name: /turn on two-factor authentication/i })
      .click();

    await expect(
      page.getByRole("heading", { name: /two-factor authentication is on/i }),
    ).toBeVisible();
    await expect(page.getByText("AAAA-1111")).toBeVisible();
  });
});

test.describe("roles", () => {
  test("a community account is not offered the contributor area", async ({
    page,
    context,
  }) => {
    await serveAccountApi(page, context, {
      session: user({ roles: ["Community"] }),
    });

    await page.goto("/account");

    const nav = page.getByRole("navigation", { name: /account sections/i });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: /contributions/i })).toHaveCount(0);
  });

  test("and cannot reach it by typing the address", async ({ page, context }) => {
    // Hiding a link is not protection. This is what someone actually meets.
    await serveAccountApi(page, context, {
      session: user({ roles: ["Community"] }),
    });

    await page.goto("/account/contributions");

    await expect(page.getByRole("alert")).toContainText(
      /this area is for contributor accounts/i,
    );
    await expect(
      page.getByRole("heading", { name: /^contributions$/i }),
    ).toHaveCount(0);
  });

  test("a contributor gets both the link and the page", async ({ page, context }) => {
    await serveAccountApi(page, context, {
      session: user({ roles: ["Contributor"] }),
    });

    await page.goto("/account");
    const nav = page.getByRole("navigation", { name: /account sections/i });
    await nav.getByRole("link", { name: /contributions/i }).click();

    await expect(
      page.getByRole("heading", { name: /^contributions$/i }),
    ).toBeVisible();
  });
});

test.describe("registration", () => {
  test("asks for an address and confirms without saying whether it is known", async ({
    page,
    context,
  }) => {
    const contract = await serveAccountApi(page, context, { session: null });

    await page.goto("/register");
    await page.getByLabel(/email address/i).fill("reader@example.com");
    await page.getByLabel(/display name/i).fill("Jen Ordo");
    await page.getByRole("button", { name: /send verification link/i }).click();

    await expect(page.locator("main").getByRole("status")).toContainText(/on its way/i);
    // The browser's own `Origin` really did travel and really was accepted:
    // the fixture answers a bodiless 403 to any unsafe method that arrives
    // without this page's origin, so a call that succeeded proves the real
    // cross-site mechanism end to end.
    expect(contract.calls.some((call) => call.path === "/register")).toBe(true);
  });

  test("the emailed link verifies, then enrols the first passkey in place", async ({
    page,
    context,
  }) => {
    // The whole point of the enrolment ticket, end to end. There is no session
    // at any point here: verifying does not create one, and the account area
    // is guarded — so if this page did not run the ceremony itself, a new
    // account could never get its first credential.
    const contract = await serveAccountApi(page, context, { session: null });
    await attachVirtualAuthenticator(page);

    await page.goto(
      `/verify-email?email=${encodeURIComponent(VALID_VERIFICATION_EMAIL)}` +
        `&token=${VALID_VERIFICATION_TOKEN}`,
    );

    await expect(
      page.getByRole("heading", { name: /your email address is verified/i }),
    ).toBeVisible();
    await expect(page.locator("main").getByRole("status")).toContainText(
      /next 10 minutes/i,
    );

    await page.getByLabel(/name this passkey/i).fill("Test device");
    await page.getByRole("button", { name: /set up a passkey/i }).click();

    await expect(
      page.getByRole("heading", { name: /your passkey is ready/i }),
    ).toBeVisible();
    // Still nobody: enrolling is not signing in.
    expect(contract.session).toBeNull();
    expect(
      contract.calls.filter((call) => call.path === "/passkey/register/complete"),
    ).toHaveLength(1);
  });

  test("keeps a mistyped address on the page instead of sending it", async ({
    page,
    context,
  }) => {
    const contract = await serveAccountApi(page, context, { session: null });

    await page.goto("/register");
    await page.getByLabel(/email address/i).fill("not-an-address");
    await page.getByLabel(/display name/i).fill("Jen Ordo");
    await page.getByRole("button", { name: /send verification link/i }).click();

    await expect(
      page.getByText(/does not look like an email address/i),
    ).toBeVisible();
    expect(contract.calls.some((call) => call.path === "/register")).toBe(false);
  });
});

test.describe("signing in with an emailed code", () => {
  /**
   * The path that exists for the machines a passkey cannot reach — a shared
   * library desktop, an older computer with no platform authenticator, a
   * managed laptop whose policy forbids enrolling one. Worth running in a real
   * browser rather than only in jsdom, because the whole flow is four screens
   * of state in one route with no navigation between them, and "the form
   * submits, the step changes, focus lands somewhere sensible" is exactly the
   * kind of thing that works in a test renderer and not in Chrome.
   */
  test("takes an address, then a code, and refuses a wrong one on the way", async ({
    page,
    context,
  }) => {
    const contract = await serveAccountApi(page, context, { session: null });

    await page.goto("/sign-in");

    // The recommendation is still the recommendation: the passkey button is
    // the primary action and the code is offered underneath it.
    await expect(
      page.getByRole("button", { name: /continue with a passkey/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /email me a sign-in code/i }).click();

    await page.getByLabel(/email address/i).fill(VALID_VERIFICATION_EMAIL);
    await page.getByRole("button", { name: /^email me a code$/i }).click();

    await expect(page.getByLabel(/six-digit code/i)).toBeVisible();
    // Held back for the cooldown the server named, and saying so rather than
    // simply refusing to be pressed.
    const resend = page.getByRole("button", { name: /send a new code/i });
    await expect(resend).toBeDisabled();
    await expect(resend).toContainText(/60s/);

    await page.getByLabel(/six-digit code/i).fill("000000");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByRole("alert")).toContainText(/not accepted/i);
    // Cleared, so the next attempt does not start with a selection and a
    // delete — and still on the same step, not thrown back to the beginning.
    await expect(page.getByLabel(/six-digit code/i)).toHaveValue("");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.getByLabel(/six-digit code/i).fill(VALID_EMAIL_CODE);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator(".account-identity-name")).toHaveText("Jen Ordo");
    // And the session the server ended up holding is the weaker kind, which is
    // what everything below depends on.
    expect(contract.session?.authenticationMethod).toBe("email");
    expect(contract.session?.strongAuthentication).toBe(false);
  });

  test("the same code cannot be spent twice", async ({ page, context }) => {
    // Single use is what makes a code safe to put in an inbox. The
    // second-factor branch is what makes it observable: the code is consumed,
    // the sign-in is not finished, and "start over" comes back to the same
    // field with the same digits still in the reader's hand.
    await serveAccountApi(page, context, { session: null, mfaRequired: true });

    await page.goto("/sign-in");
    await page.getByRole("button", { name: /email me a sign-in code/i }).click();
    await page.getByLabel(/email address/i).fill(VALID_VERIFICATION_EMAIL);
    await page.getByRole("button", { name: /^email me a code$/i }).click();
    await page.getByLabel(/six-digit code/i).fill(VALID_EMAIL_CODE);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: /one more step/i }),
    ).toBeVisible();

    // Back into the emailed-code path, not into the passkey path — which is a
    // dead end for exactly the readers who chose this door.
    await page.getByRole("button", { name: /start over/i }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: /check your inbox/i }),
    ).toBeVisible();

    await page.getByLabel(/six-digit code/i).fill(VALID_EMAIL_CODE);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByRole("alert")).toContainText(/not accepted/i);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("says the same thing about an address it has never seen", async ({
    page,
    context,
  }) => {
    // The property the old "there is no email field here" test used to
    // guarantee by construction, now guaranteed by the server answering
    // identically. Nothing on this screen may hint that the address is unknown.
    await serveAccountApi(page, context, { session: null });

    await page.goto("/sign-in");
    await page.getByRole("button", { name: /email me a sign-in code/i }).click();
    await page.getByLabel(/email address/i).fill("stranger@example.com");
    await page.getByRole("button", { name: /^email me a code$/i }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: /check your inbox/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/six-digit code/i)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("the account page then offers a passkey, calmly and once", async ({
    page,
    context,
  }) => {
    await serveAccountApi(page, context, {
      session: user({
        passkeys: [],
        authenticationMethod: "email",
        strongAuthentication: false,
      }),
    });

    await page.goto("/account");

    await expect(page.locator("main").getByRole("status")).toContainText(
      /add a passkey while you are here/i,
    );
    await expect(
      page.getByText(/signed in on this device with a code emailed to you/i),
    ).toBeVisible();
    // An offer, not an alarm.
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });

  test("a contributor on an emailed code is asked to prove the passkey it has", async ({
    page,
    context,
  }) => {
    // The client-side mirror of the API's 403
    // `strong-authentication-required`. The account holds the role and holds a
    // passkey, so the dead-end wording would be wrong twice over: it is not a
    // refusal, and the thing it used to tell the reader to go and enrol is
    // already on the account. What belongs here is the prompt to use it.
    await serveAccountApi(page, context, {
      session: user({
        roles: ["Contributor"],
        authenticationMethod: "email",
        strongAuthentication: false,
      }),
    });

    await page.goto("/account/contributions");

    await expect(
      page.getByRole("button", { name: /confirm with a passkey/i }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/does not have access/i);
    await expect(
      page.getByRole("heading", { name: /^contributions$/i }),
    ).toHaveCount(0);

    // And the way out is genuinely open: locking the account area behind the
    // credential the account area is where you enrol would be a catch-22.
    await page.goto("/account/passkeys");
    await expect(
      page.getByRole("heading", { name: /your passkeys/i }),
    ).toBeVisible();
  });
});

test.describe("keyboard operation", () => {
  test("the account area can be navigated without a mouse", async ({
    page,
    context,
  }) => {
    await serveAccountApi(page, context, { session: user({ roles: ["Community"] }) });

    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const passkeys = page.getByRole("link", { name: /^passkeys/i });
    await passkeys.focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("heading", { name: /your passkeys/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/account\/passkeys$/);
  });

  test("every control in the account area shows a focus ring", async ({
    page,
    context,
  }) => {
    await serveAccountApi(page, context, { session: user() });

    await page.goto("/account/passkeys");
    await expect(page.getByRole("heading", { name: /your passkeys/i })).toBeVisible();

    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return "body";
        return getComputedStyle(active).outlineStyle;
      });
      if (outline === "body") break;
      expect(outline).not.toBe("none");
    }
  });
});
