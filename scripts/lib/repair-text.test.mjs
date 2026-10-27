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

  describe("the shapes only the source could settle", () => {
    it("spells accented names out of the species chapter's source", () => {
      // No pattern can tell you which vowel was lost, so these come from the
      // document the chapter is printed from rather than from the context.
      const expected = {
        "Gliconn, Orcas, L�vern, Seelv�n": "Gliconn, Orcas, Lávern, Seelván",
        "Asha, Derriphan, H�sk, Jen": "Asha, Derriphan, Hâsk, Jen",
        "Midwan, Siqsa, Ty�k": "Midwan, Siqsa, Tyûk",
        "Dhess, Gooti, J�nsone, Qylett": "Dhess, Gooti, Jánsone, Qylett",
        "Cybele, F�ress, Numarin": "Cybele, Fáress, Numarin",
        "F�niss, Diva, Prystill": "Fániss, Diva, Prystill",
        "Grai, Ian�, Kinnas": "Grai, Iané, Kinnas",
      };
      for (const [archived, repaired] of Object.entries(expected)) {
        expect(repairText(archived)).toBe(repaired);
      }
    });

    it("reads a lost character before a space as an em dash", () => {
      // Long left alone here as ambiguous between an em dash and an ellipsis.
      // It is an em dash, and the space after it is the source's own.
      expect(repairText("I am a free spirit� no one tells me")).toBe(
        "I am a free spirit— no one tells me",
      );
      expect(repairText("I can't help it� I'm a perfectionist.")).toBe(
        "I can't help it— I'm a perfectionist.",
      );
    });

    it("welds a dash to markdown emphasis and to a digit", () => {
      expect(repairText("**insignia**�the *Kyr'bes*�features")).toBe(
        "**insignia**—the *Kyr'bes*—features",
      );
      expect(repairText("the final three scores�12, 10, and 8�to Charisma")).toBe(
        "the final three scores—12, 10, and 8—to Charisma",
      );
    });
  });

  describe("what it still leaves alone", () => {
    it("keeps a lost letter in a name the source does not list", () => {
      // A single letter on the right of the dash is never a welded em dash,
      // which is what keeps the rule out of names the lookup cannot answer.
      expect(repairText("Alash, Byss�k, Estair")).toContain("�");
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

  describe("the rules corpus's markdown", () => {
    it("restores the em dash a table cell uses to mean none", () => {
      expect(repairText("|Level|Wealth|\r\n|1st|�|\r\n|2nd|1,000 cr|")).toBe(
        "|Level|Wealth|\n|1st|—|\n|2nd|1,000 cr|",
      );
    });

    it("keeps the padding a source table lined its columns up with", () => {
      expect(repairText("|\tWretched\t\t|\t�\t|")).toBe(
        "|\tWretched\t\t|\t—\t|",
      );
    });

    it("restores every cell in a run of empty ones", () => {
      expect(repairText("|1-4|6|3|�|�|�|�|9|")).toBe("|1-4|6|3|—|—|—|—|9|");
    });

    it("closes a quotation that ends a table cell", () => {
      expect(
        repairText("|3|always searching for that �special someone.�|"),
      ).toBe('|3|always searching for that "special someone."|');
    });

    it("collapses a drop cap the scrape read twice", () => {
      expect(repairText("DDestiny plays a large role")).toBe(
        "Destiny plays a large role",
      );
      expect(repairText("a paragraph\r\n\r\nWWhen you cast a power")).toBe(
        "a paragraph\n\nWhen you cast a power",
      );
    });

    it("leaves a doubled capital alone in the middle of a line", () => {
      expect(repairText("the droid designated RRuk, of the RRuk line")).toBe(
        "the droid designated RRuk, of the RRuk line",
      );
    });
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
