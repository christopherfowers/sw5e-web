/**
 * Reading the service's schema refusal, including the ways it can go wrong.
 *
 * The format being parsed is not promised by anything: `schemaErrors` is
 * `string[]` on the wire, its shape comes from a validator in a third
 * repository, and the service's own tests assert only that the array is not
 * empty. So the tests that matter most here are the ones about *losing* the
 * bet — a line that does not parse must still reach the reader, in the
 * service's own words, or a refused save becomes a save that failed for no
 * stated reason.
 */

import { describe, expect, it } from "vitest";

import {
  allViolations,
  isEmpty,
  noViolations,
  parseSchemaErrors,
  readSchemaErrors,
} from "./violations";

describe("reading the extension off a refusal", () => {
  it("takes the strings", () => {
    expect(readSchemaErrors({ schemaErrors: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("answers nothing for a shape it does not recognise", () => {
    // A service that changed the shape gets the generic refusal message rather
    // than a page that throws while rendering an error.
    expect(readSchemaErrors({ schemaErrors: { pointer: "/name" } })).toEqual([]);
    expect(readSchemaErrors({})).toEqual([]);
    expect(readSchemaErrors({ schemaErrors: [1, "kept"] })).toEqual(["kept"]);
  });
});

describe("placing a violation against a field", () => {
  it("reads the pointer and the keyword out of the line", () => {
    const { byPointer, unplaced } = parseSchemaErrors([
      "/name: minLength — Value should have at least 1 character",
    ]);

    expect(unplaced).toEqual([]);
    expect(byPointer.get("/name")).toHaveLength(1);
    expect(byPointer.get("/name")![0]).toMatchObject({ keyword: "minLength" });
  });

  it("moves a missing property from its parent onto the property itself", () => {
    // The validator reports a missing property as a failure of the object that
    // should have contained it. Left there, every missing field on a document
    // stacks up at the root and none of them is next to the control somebody
    // has to fill in.
    const { byPointer } = parseSchemaErrors([
      ': required — Required properties ["description"] were not present',
    ]);

    expect([...byPointer.keys()]).toEqual(["/description"]);
    expect(byPointer.get("/description")![0]!.message).toMatch(/has to be filled in/i);
  });

  it("splits a required error naming more than one property", () => {
    const { byPointer } = parseSchemaErrors([
      '/speed: required — Required properties ["walk", "swim"] were not present',
    ]);

    expect([...byPointer.keys()].sort()).toEqual(["/speed/swim", "/speed/walk"]);
  });

  it("escapes a property name that would otherwise break the pointer", () => {
    const { byPointer } = parseSchemaErrors([
      ': required — Required properties ["hit/dice"] were not present',
    ]);

    expect([...byPointer.keys()]).toEqual(["/hit~1dice"]);
  });

  it("keeps the service's own words alongside the plainer sentence", () => {
    // A reader is never shown a paraphrase without the thing it paraphrases:
    // the summary carries the original line so an unexpected refusal can still
    // be reported accurately by whoever met it.
    const line = "/contentSet: enum — Value should match one of the values specified";
    const { byPointer } = parseSchemaErrors([line]);

    expect(byPointer.get("/contentSet")![0]).toMatchObject({
      message: expect.stringMatching(/not one of the values/i) as unknown as string,
      detail: line,
    });
  });
});

describe("a line this client cannot place", () => {
  it("keeps it whole rather than dropping or mangling it", () => {
    // These are real and there are several: a document that is not an object,
    // a key that disagrees with its address, a type with no schema published.
    const lines = [
      "the 'key' property must be present and equal to the item key.",
      "root value is not a JSON object.",
    ];

    const parsed = parseSchemaErrors(lines);

    expect(parsed.byPointer.size).toBe(0);
    expect(parsed.unplaced).toEqual(lines);
  });

  it("refuses to guess at a location that is not a pointer", () => {
    // Guessing would put an error on an unrelated field, which is worse than
    // showing it above the form.
    const line = "name: required — something the validator said differently";
    const parsed = parseSchemaErrors([line]);

    expect(parsed.byPointer.size).toBe(0);
    expect(parsed.unplaced).toEqual([line]);
  });
});

describe("the empty state", () => {
  it("is empty, and stays empty", () => {
    expect(isEmpty(noViolations())).toBe(true);
    expect(allViolations(noViolations())).toEqual([]);
    expect(isEmpty(parseSchemaErrors([]))).toBe(true);
  });

  it("is not empty when there is only something unplaceable", () => {
    // A refusal nobody can place is still a refusal. Treating this as empty
    // would show a save that silently did nothing.
    expect(isEmpty(parseSchemaErrors(["root value is not a JSON object."]))).toBe(false);
  });
});
