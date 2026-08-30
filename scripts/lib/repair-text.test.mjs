import { describe, expect, it } from "vitest";

import {
  countRepairs,
  isTotalLoss,
  repairText,
} from "./repair-text.mjs";

/**
 * These strings are taken verbatim from the legacy archive. Each one stands
 * for a repair rule, and the "left alone" block stands for the cases where
 * guessing would invent game content.
 */
describe("repairing the archive's encoding damage", () => {
  it("restores apostrophes in contractions", () => {
    expect(repairText("You can�t discern color")).toBe(
      "You can't discern color",
    );
    expect(repairText("I�m loyal to my friends")).toBe(
      "I'm loyal to my friends",
    );
    expect(repairText("the ammunition you�re using")).toBe(
      "the ammunition you're using",
    );
  });

  it("restores apostrophes in possessives", () => {
    expect(repairText("resist the tank�s effects")).toBe(
      "resist the tank's effects",
    );
  });

  it("restores em dashes welded between two words", () => {
    expect(repairText("a new generation�for example, when")).toBe(
      "a new generation—for example, when",
    );
  });

  it("restores em dashes after short words", () => {
    expect(repairText("may have been related to�or the same")).toBe(
      "may have been related to—or the same",
    );
  });

  it("restores em dashes standing between spaces", () => {
    expect(repairText("varying distances � sometimes by kilometers")).toBe(
      "varying distances — sometimes by kilometers",
    );
  });

  it("restores the em dash a stat block uses to mean none", () => {
    expect(repairText("**Languages** �")).toBe("**Languages** —");
  });

  it("restores balanced quotation marks", () => {
    expect(repairText("I have a �tell� that reveals")).toBe(
      'I have a "tell" that reveals',
    );
    expect(repairText("the proverb �unity is strength�.")).toBe(
      'the proverb "unity is strength".',
    );
  });

  it("does not mistake a closing quote for a dash", () => {
    // The quotation rule has to run before the dash rules; if it does not, the
    // closing mark in `strength<?>.` looks exactly like a welded dash.
    expect(repairText("saying, �no more!�, taking the")).toBe(
      'saying, "no more!", taking the',
    );
  });

  describe("what it deliberately leaves alone", () => {
    it("keeps accented letters inside proper nouns unrepaired", () => {
      // The letter is unrecoverable. Guessing would fabricate a species name.
      for (const name of [
        "Gliconn, Orcas, L�vern, Seelv�n",
        "Asha, Derriphan, H�sk, Jen",
        "Midwan, Siqsa, Ty�k",
        "Dhess, Gooti, J�nsone, Qylett",
      ]) {
        expect(repairText(name)).toContain("�");
      }
    });

    it("keeps a lost character before a space unrepaired", () => {
      // Ambiguous between an em dash and an ellipsis, and both read naturally.
      expect(repairText("I am a free spirit� no one tells me")).toContain(
        "�",
      );
    });
  });

  describe("fields whose content is entirely gone", () => {
    it("recognises a field holding nothing but a replacement character", () => {
      expect(isTotalLoss("�")).toBe(true);
      expect(isTotalLoss("  � ")).toBe(true);
      expect(isTotalLoss("Basic")).toBe(false);
      expect(isTotalLoss("can�t")).toBe(false);
    });

    it("returns null so the caller can mark the absence", () => {
      expect(repairText("�")).toBeNull();
    });
  });

  it("normalizes the archive's CRLF line endings", () => {
    expect(repairText("first\r\nsecond\r\n")).toBe("first\nsecond");
  });

  it("counts every replacement character exactly once", () => {
    const counts = countRepairs(
      "You can�t see it � a new generation�for example",
    );

    expect(counts.apostrophes).toBe(1);
    expect(counts.spacedDashes).toBe(1);
    expect(counts.weldedDashes).toBe(1);
    expect(counts.unrepaired).toBe(0);
  });
});
