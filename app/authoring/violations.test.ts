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
  placeSchemaViolations,
  readSchemaErrors,
  readSchemaViolations,
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

describe("violations the service sent with their parts intact", () => {
  /**
   * The point of the structured field: none of this is parsed. The pointer
   * arrives as a pointer and the keyword as a keyword, so a reworded message
   * cannot stop an error landing on the field it belongs to.
   */
  const wire = (
    instanceLocation: string,
    keyword: string,
    message: string,
  ) => ({ instanceLocation, keyword, message });

  it("is preferred to the lines, and needs no regular expression", () => {
    const placed = placeSchemaViolations([
      wire("/name", "minLength", "Value should have at least 1 character"),
    ]);

    expect([...placed.byPointer.keys()]).toEqual(["/name"]);
    expect(placed.unplaced).toEqual([]);
  });

  it("keeps the line the service would have sent, so nothing is hidden", () => {
    // A contributor is never shown a paraphrase without the thing it
    // paraphrases; the plain-English message replaces the validator's wording
    // in the summary, and `detail` is what it replaced.
    const placed = placeSchemaViolations([
      wire("/key", "pattern", "The string value was not a match for the indicated regular expression"),
    ]);

    const [violation] = placed.byPointer.get("/key")!;

    expect(violation!.message).toBe(
      "This is not written in the form this field accepts.",
    );
    expect(violation!.detail).toContain("regular expression");
  });

  it("moves a missing property onto the property, not the object", () => {
    // `required` is reported at the parent, because a missing property is a
    // failure of the object that should have contained it. Left there, every
    // missing field would stack up at the root.
    const placed = placeSchemaViolations([
      wire("", "required", 'Required properties ["name", "size"] were not present'),
    ]);

    expect([...placed.byPointer.keys()].sort()).toEqual(["/name", "/size"]);
  });

  it("does not try to place a location it cannot use", () => {
    const placed = placeSchemaViolations([
      wire("#/definitions/thing", "type", "Wrong kind of value"),
    ]);

    expect(placed.byPointer.size).toBe(0);
    expect(placed.unplaced).toHaveLength(1);
  });
});

describe("the case that made this worth doing", () => {
  /**
   * A property that does not belong to a content type.
   *
   * `additionalProperties: false` is implemented as a false schema, and a false
   * schema fails with no keyword at all — the line reads
   * `/quantumEntanglement:  — All values fail against the false schema`. The
   * line parser cannot place that, because its pattern requires a keyword of
   * at least one letter, so it went into the list of things shown above the
   * form with no field attached.
   *
   * This is not a contrived example. It is what the service answers for the
   * commonest authoring mistake there is: a stray property.
   */
  const line = "/quantumEntanglement:  — All values fail against the false schema";

  it("could not be placed from the line", () => {
    const parsed = parseSchemaErrors([line]);

    expect(parsed.byPointer.size).toBe(0);
    expect(parsed.unplaced).toEqual([line]);
  });

  it("lands on the property when the parts arrive apart", () => {
    const placed = placeSchemaViolations([
      {
        instanceLocation: "/quantumEntanglement",
        keyword: "",
        message: "All values fail against the false schema",
      },
    ]);

    expect([...placed.byPointer.keys()]).toEqual(["/quantumEntanglement"]);
    expect(placed.unplaced).toEqual([]);

    // No plain-English wording for a keyword that does not exist, so the
    // validator's own sentence is shown. Better a sentence written for the
    // wrong audience than a guess.
    const [violation] = placed.byPointer.get("/quantumEntanglement")!;
    expect(violation!.message).toBe("All values fail against the false schema");
  });
});

describe("reading the structured field off a refusal", () => {
  it("answers null when the service did not send it", () => {
    // Null and empty mean different things: null sends the caller to the line
    // parser, empty says there was nothing to place.
    expect(readSchemaViolations({})).toBeNull();
    expect(readSchemaViolations({ schemaErrors: ["a"] })).toBeNull();
    expect(readSchemaViolations({ schemaViolations: [] })).toEqual([]);
  });

  it("falls back rather than trusting a shape it half understands", () => {
    // A list that arrived but holds entries this client cannot read is a shape
    // change, not an empty result. Reading the lines instead is never worse.
    expect(
      readSchemaViolations({
        schemaViolations: [
          { instanceLocation: "/name", keyword: "minLength", message: "x" },
          { pointer: "/size" },
        ],
      }),
    ).toBeNull();

    expect(readSchemaViolations({ schemaViolations: "not a list" })).toBeNull();
  });

  it("accepts a list it fully understands", () => {
    const entries = [{ instanceLocation: "", keyword: "required", message: "x" }];

    expect(readSchemaViolations({ schemaViolations: entries })).toEqual(entries);
  });
});
