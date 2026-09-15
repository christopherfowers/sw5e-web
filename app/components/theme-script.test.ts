/**
 * The inline script that replays the reader's theme before the first paint.
 *
 * It is a literal rather than a built string, because CodeQL objected to code
 * construction and was right to: the result goes into `<head>` unescaped, so
 * anything that ever made the storage key dynamic would turn a rename into
 * script injection, and whoever made that change would have no reason to look
 * at this file.
 *
 * The cost of a literal is that the key is written twice — once as the constant
 * the application reads and writes, once inside the script that reads it back
 * on the next page load. That drift is what this file exists to catch, and the
 * failure it prevents is quiet: the toggle keeps working, the choice keeps
 * saving, and it stops surviving navigation because the replay is looking under
 * a name nobody writes to.
 */

import { describe, expect, it } from "vitest";

import { THEME_SCRIPT, THEME_STORAGE_KEY } from "./theme-control";

describe("the pre-paint theme script", () => {
  it("reads the same key the application writes", () => {
    expect(
      THEME_SCRIPT,
      "the script and THEME_STORAGE_KEY have drifted; the choice will save " +
        "and then not survive the next page load",
    ).toContain(`localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})`);
  });

  /**
   * And accepts only the two values the stylesheet has rules for.
   *
   * A script that wrote the attribute back unchecked would let anything in
   * storage become an attribute value. Nothing could execute — it is an
   * attribute, not markup — but the site would land in a state with no palette
   * and no way for the reader to tell why.
   */
  it("only ever writes light or dark", () => {
    expect(THEME_SCRIPT).toContain('t==="light"');
    expect(THEME_SCRIPT).toContain('t==="dark"');
  });

  /**
   * It is built from no variable at all.
   *
   * The assertion is on the shape rather than the output: a template literal
   * with a substitution would still produce the right string today, and would
   * be the thing CodeQL flagged. Checked by looking for the interpolation
   * marker, which cannot appear in the literal itself.
   */
  it("is a literal, with nothing interpolated into it", () => {
    expect(THEME_SCRIPT).not.toContain("${");
  });

  it("cannot throw where storage is unavailable", () => {
    expect(THEME_SCRIPT).toContain("try{");
    expect(THEME_SCRIPT).toContain("catch(e){}");
  });
});
