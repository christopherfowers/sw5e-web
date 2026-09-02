# Testing the QA site

A walkthrough for somebody who wants to check that a deployment actually works,
in the order the checks depend on each other. Each step says what you should
see, so a wrong result is obvious without knowing the internals.

It is written for QA at `https://sw5e.cfowers.io`. Nothing here needs a
terminal.

Everything saved on QA is temporary. The banner at the top of every page says
so, and it is the fastest way to tell at a glance which environment you are
looking at: if that banner is missing, you are not on QA.

---

## 1. Reading, signed out

Do this first. It is the largest part of the site and the part that has to work
for people who never make an account.

1. Open the site. The header shows a red mark on the left, a search field, and
   **Sign in** on the right.
2. Click **Characters** in the menu bar. A panel opens under it listing Species,
   Classes, Archetypes and the rest.
   - *It should stay open.* A panel that opens and closes again by itself is a
     fault — say so, and say which page you were on.
3. Click **Combat**. The Characters panel closes and Combat opens. Only one at a
   time.
4. Press `Escape`. The panel closes and the keyboard focus goes back to the
   word you opened it from.
5. Open **Characters** again and click **Species**. You land on the species
   index, the panel closes behind you, and a rail appears down the left listing
   the other Characters destinations.
6. Click any species. You get its page: name, badges, a table of statistics,
   prose below, and a picture on the right for types that have one.
7. Scroll to the bottom. There is one quiet line — **Something wrong with this
   page?** Click it; a short form opens in place. Do not send one yet.
8. Type a word into the search field at the top and press `Enter`.

Known limits, so they are not reported as faults:

- Search matches headings, statistics, entry names, and the **first 240
  characters** of prose. A word buried deep in a long rules chapter will not be
  found. Full-text search is not built yet.
- Some pictures say **Artist not recorded**. That is accurate — 149 images came
  across from the original site with no artist attached, and the caption says
  so rather than inventing a credit.

---

## 2. Making an account

1. Click **Sign in**, then the link to register.
2. Enter an address and a display name.

   Use an address you can read. Anything at `@sw5e.test` is thrown away by the
   mail service and you will never see the message.

3. You are told a message is on its way. **You get the same answer whether or
   not the address already has an account** — that is deliberate, so nobody can
   use this page to find out who is registered.
4. Check the inbox, including spam. The message comes from
   `noreply@cfowers.io`.
5. Follow the link. It opens a page that offers to enrol a passkey **in place**,
   without asking you to sign in first.
6. Enrol one. Your browser or password manager prompts for a fingerprint, face
   or device PIN.

If your device cannot do passkeys, skip step 6 and use section 3 instead.

---

## 3. Signing in

Three ways in. Try the ones your device supports.

**Passkey.** Click **Sign in**, then the passkey button. No email address is
asked for — the browser offers whichever passkeys it holds for this site.

**Emailed code.** Enter your address, ask for a code, and type the six digits
from the message. Codes expire, and a code can only be spent once — asking for a
second one kills the first.

**Authenticator app.** Only if you have switched one on (section 5). After the
passkey or the code, you are asked for the six digits from the app.

Once you are in, the header shows your display name instead of **Sign in**.

---

## 4. Being an administrator

Roles are granted by another administrator, or by the bootstrap setting on first
deployment. Once you hold one:

1. Open your account. The sidebar gains **People** and **Audit log**.
2. Click **People**.

**If you signed in with an emailed code**, you meet a prompt rather than the
directory: *Confirm it is you*, with a button to confirm with your passkey and
a field for an authenticator code if you have one.

   This is not a refusal. A code sent to your mailbox proves you can read that
   mailbox and nothing about the device in front of you, and administrator tools
   are not handed to a mailbox. Press the button, answer your device, and the
   directory appears — **you are not signed out and do not sign in again**.

   *If it tells you to go and add a passkey when you already have one, that is a
   fault.* Report it with a screenshot of your Passkeys page.

3. The directory lists accounts. Open one to see its roles, whether it has a
   second factor, and what has been done to it.
4. Change a role. If the account has neither a passkey nor an authenticator, you
   are told the role cannot be used yet — the grant still lands, and that person
   is emailed about what to enrol.
5. Open **Audit log**. Your change is there, with who made it and when. Nothing
   in this log can be edited or deleted.

Do not suspend or delete your own account. The service refuses it, but there is
no reason to test the refusal on the account you are using.

---

## 5. Protecting your own account

From your account page:

- **Passkeys** lists every credential with the date it was added, and removes
  any of them — except the last one, which is kept so the account cannot be
  stranded.
- **Two-factor** enrols an authenticator app. You get a QR code and the same
  secret as text, for a device with no camera. Once a code from it is accepted,
  ten single-use recovery codes are shown **once**. Save them then; they cannot
  be shown again.

Every one of these changes sends a message to the address on file, whether or
not you were the one who made it. That message is how a real owner notices
somebody else in their account, so getting one you did not expect is worth
reporting immediately.

---

## 6. Editing content

You need Contributor or Administrator, and a session that proved a passkey or an
authenticator — section 4 explains why, and how to clear it without signing out.

1. Open any content page and scroll to the bottom. Under the report line there
   is **Edit this page · History**.
2. Click **Edit this page**. The editor opens with the document loaded, and the
   form is built from that content type's schema — so the fields are the fields
   that type actually has.
3. Change something and **Save draft**. The draft is yours; the published page
   is untouched until somebody publishes it.
4. **Publishing is Administrator only.** A contributor sees the save button and
   an explanation instead of a publish button, rather than a button that would
   be refused.
5. Click **History**. Every revision is listed, with what changed between them,
   and any of them can be reverted to.
6. Go back to the content page and confirm the change is live.

Also reachable from **Your account → Contributions**, which is the worklist:
open drafts, and reports waiting to be answered.

---

## 7. Reports

1. Signed in or not, open a content page, click **Something wrong with this
   page?**, pick a reason and send it.
2. As a contributor, open **Your account → Reports**. The report is in the
   queue with the page it came from.
3. Accepting one opens the editor on the document it names, with the report
   attached — publishing the fix closes the report.

Reporters see the status of their own reports and never see a reviewer's note.

---

## What to include in a bug report

- The page address.
- What you clicked and what you expected.
- Whether you were signed in, and if so how — passkey, emailed code, or
  authenticator. This matters more than anything else on the list; several
  behaviours differ by sign-in method on purpose, and a report that leaves it
  out cannot be reproduced.
- Browser and whether it is a phone.
- A screenshot, if any of it is visual.
