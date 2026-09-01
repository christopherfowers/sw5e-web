/**
 * The copy of somebody's work that survives everything else.
 *
 * Two properties matter more than the rest and both are here: that a store
 * which refuses to cooperate cannot stop the editor from opening, and that an
 * entry nobody is coming back for is eventually dropped rather than kept
 * forever in a browser somebody shares.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetRecovery, keepRecovery, readRecovery, recoveryKey } from "./recovery";

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("keeping and reading", () => {
  it("hands back what was put in", () => {
    keepRecovery("armor-property", "bulky", { name: "Bulky", description: "Long text." });

    const held = readRecovery("armor-property", "bulky");
    expect(held?.document).toEqual({ name: "Bulky", description: "Long text." });
    expect(Date.parse(held!.savedAt)).not.toBeNaN();
  });

  it("keeps one document apart from another", () => {
    keepRecovery("armor-property", "bulky", { name: "Bulky" });
    keepRecovery("armor-property", "powered", { name: "Powered" });

    expect(readRecovery("armor-property", "bulky")?.document).toEqual({ name: "Bulky" });
    expect(readRecovery("armor-property", "powered")?.document).toEqual({ name: "Powered" });
  });

  it("answers nothing for a document nobody has typed in", () => {
    expect(readRecovery("armor-property", "never-touched")).toBeNull();
  });

  it("forgets on request", () => {
    keepRecovery("armor-property", "bulky", { name: "Bulky" });
    forgetRecovery("armor-property", "bulky");
    expect(readRecovery("armor-property", "bulky")).toBeNull();
  });

  it("keys a document that has no key yet by its type alone", () => {
    // A limitation stated rather than hidden: two unfinished new species share
    // a slot. The alternative is an entry per tab that nothing ever clears.
    expect(recoveryKey("species", "")).toBe("sw5e.authoring.recovery.species/");
  });
});

describe("a store that will not cooperate", () => {
  it("does not throw when writing fails", () => {
    // Out of quota, or storage refused outright. An editor that could not open
    // because its safety net was unavailable would be a safety net that caused
    // the accident.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(() => keepRecovery("armor-property", "bulky", { name: "Bulky" })).not.toThrow();
  });

  it("answers nothing when reading fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(readRecovery("armor-property", "bulky")).toBeNull();
  });

  it("answers nothing for an entry that is not the shape this code wrote", () => {
    localStorage.setItem(recoveryKey("armor-property", "bulky"), "not json at all");
    expect(readRecovery("armor-property", "bulky")).toBeNull();

    localStorage.setItem(recoveryKey("armor-property", "bulky"), JSON.stringify({ a: 1 }));
    expect(readRecovery("armor-property", "bulky")).toBeNull();
  });
});

describe("not keeping things forever", () => {
  it("drops an entry older than a fortnight on the next write", () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      recoveryKey("armor-property", "abandoned"),
      JSON.stringify({ document: { name: "Abandoned" }, savedAt: old }),
    );

    keepRecovery("armor-property", "bulky", { name: "Bulky" });

    expect(readRecovery("armor-property", "abandoned")).toBeNull();
    expect(readRecovery("armor-property", "bulky")).not.toBeNull();
  });

  it("drops an entry with no readable timestamp", () => {
    // Either corrupt or written by a version of this code that no longer
    // exists. Either way it cannot be offered to anybody.
    localStorage.setItem(
      recoveryKey("armor-property", "broken"),
      JSON.stringify({ document: {}, savedAt: "not a date" }),
    );

    keepRecovery("armor-property", "bulky", { name: "Bulky" });
    expect(localStorage.getItem(recoveryKey("armor-property", "broken"))).toBeNull();
  });

  it("leaves anything that is not one of its own entries alone", () => {
    localStorage.setItem("somebody-elses-key", "please do not touch");
    keepRecovery("armor-property", "bulky", { name: "Bulky" });
    expect(localStorage.getItem("somebody-elses-key")).toBe("please do not touch");
  });
});
