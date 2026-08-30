import { expect, test } from "@playwright/test";

import {
  attachVirtualAuthenticator,
  serveAccountApi,
  user,
  VALID_TOTP_CODE,
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

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jen Ordo");
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jen Ordo");
    // The assertion really was verified: the fixture rejects any challenge it
    // did not issue, and consumes the one it did.
    expect(
      contract.calls.filter((call) => call.path === "/passkey/login/complete"),
    ).toHaveLength(1);
  });

  test("an enrolled passkey can be revoked", async ({ page, context }) => {
    const contract = await serveAccountApi(page, context, { session: user() });

    await page.goto("/account/passkeys");
    await expect(page.locator(".credential-name", { hasText: "Work laptop" })).toBeVisible();

    await page.getByRole("button", { name: /remove the passkey/i }).click();
    await page.getByRole("button", { name: /yes, remove it/i }).click();

    await expect(page.locator(".credential-name", { hasText: "Work laptop" })).toHaveCount(0);
    expect(contract.session?.passkeys).toHaveLength(0);
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
      session: user({ displayName: "Jen Ordo", mfa: { totp: true } }),
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
    await serveAccountApi(page, context, { session: user({ mfa: { totp: false } }) });

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
      session: user({ roles: ["community"] }),
    });

    await page.goto("/account");

    const nav = page.getByRole("navigation", { name: /account sections/i });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: /contributions/i })).toHaveCount(0);
  });

  test("and cannot reach it by typing the address", async ({ page, context }) => {
    // Hiding a link is not protection. This is what someone actually meets.
    await serveAccountApi(page, context, {
      session: user({ roles: ["community"] }),
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
      session: user({ roles: ["contributor"] }),
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
    // The CSRF token really was echoed: the fixture rejects a state-changing
    // request without it, and this call succeeded.
    expect(contract.calls.some((call) => call.path === "/register")).toBe(true);
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

test.describe("keyboard operation", () => {
  test("the account area can be navigated without a mouse", async ({
    page,
    context,
  }) => {
    await serveAccountApi(page, context, { session: user({ roles: ["community"] }) });

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
