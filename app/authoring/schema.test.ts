/**
 * Turning a real content schema into a form.
 *
 * The schemas these run against are the shapes that actually appear in
 * `sw5e-database/schemas`: enums without a `type`, `$ref` into `$defs`,
 * object-level `oneOf` used as a condition rather than as alternative shapes,
 * and prose fields marked by the word "Markdown" at the front of their
 * description.
 *
 * The most important test in the file is the last one in "nothing is ever
 * dropped". A generated form that skips what it does not understand deletes
 * that field on the next save — silently, permanently, and with no symptom
 * until somebody notices a section missing from a published page.
 */

import { describe, expect, it } from "vitest";

import {
  blankDocument,
  blankValue,
  describeControl,
  describeDocument,
  humanise,
  type ObjectControl,
  type SchemaNode,
} from "./schema";

const ARMOR_PROPERTY: SchemaNode = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Armor property",
  type: "object",
  additionalProperties: false,
  required: ["key", "name", "contentSet", "description"],
  properties: {
    key: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", description: "Stable slug." },
    name: { type: "string", minLength: 1, description: "Display name in title case." },
    contentSet: {
      enum: ["core", "expanded-content"],
      description: "Which body of rules this belongs to.",
    },
    description: {
      type: "string",
      minLength: 1,
      description: "Markdown giving the property's rules.",
    },
  },
};

function propertyNamed(control: ObjectControl, name: string) {
  const found = control.properties.find((property) => property.name === name);
  if (!found) throw new Error(`no property named ${name}`);
  return found;
}

describe("labels", () => {
  it("writes a property name as a person would say it", () => {
    expect(humanise("archetypeIntroduction")).toBe("Archetype introduction");
    expect(humanise("hitPoints")).toBe("Hit points");
    expect(humanise("expanded-content")).toBe("Expanded content");
    expect(humanise("key")).toBe("Key");
  });
});

describe("a whole content type", () => {
  const control = describeDocument({
    type: "armor-property",
    version: 1,
    schema: ARMOR_PROPERTY,
  })!;

  it("keeps the schema's own property order", () => {
    // Authored order is the order a reader meets the material on the page. An
    // editor that put the required fields first would stop matching the thing
    // being edited.
    expect(control.properties.map((property) => property.name)).toEqual([
      "key",
      "name",
      "contentSet",
      "description",
    ]);
  });

  it("marks what is required and what is not", () => {
    expect(propertyNamed(control, "name").required).toBe(true);
  });

  it("makes a menu out of an enum, even one with no declared type", () => {
    const contentSet = propertyNamed(control, "contentSet").control;
    expect(contentSet.kind).toBe("choice");
    expect(contentSet.kind === "choice" && contentSet.options).toEqual([
      { value: "core", label: "Core" },
      { value: "expanded-content", label: "Expanded content" },
    ]);
  });

  it("gives prose a control it fits in", () => {
    // Read from the schemas themselves: every long-form field in this corpus
    // opens its description with the word "Markdown".
    expect(propertyNamed(control, "description").control.kind).toBe("prose");
    expect(propertyNamed(control, "name").control.kind).toBe("line");
  });

  it("carries the schema's description through as the field's hint", () => {
    expect(propertyNamed(control, "key").control.description).toBe("Stable slug.");
  });

  it("records that the type refuses properties it does not name", () => {
    expect(control.closed).toBe(true);
  });
});

describe("shapes that appear in this corpus", () => {
  it("follows a local $ref into $defs", () => {
    const schema: SchemaNode = {
      type: "object",
      $defs: { ability: { enum: ["str", "dex"], description: "An ability." } },
      properties: { primaryAbility: { $ref: "#/$defs/ability" } },
    };

    const control = describeControl(schema, schema) as ObjectControl;
    expect(propertyNamed(control, "primaryAbility").control.kind).toBe("choice");
  });

  it("lets the referring node's own description win over the target's", () => {
    // The creature schema uses one `damageAffinity` shape three times and says
    // what each use means at the point of use.
    const schema: SchemaNode = {
      type: "object",
      $defs: { affinity: { type: "array", items: { type: "string" }, description: "Types." } },
      properties: {
        damageResistances: {
          $ref: "#/$defs/affinity",
          description: "Damage types the creature takes half from.",
        },
      },
    };

    const control = describeControl(schema, schema) as ObjectControl;
    expect(propertyNamed(control, "damageResistances").control.description).toBe(
      "Damage types the creature takes half from.",
    );
  });

  it("shows an object-level condition rather than inventing a control for it", () => {
    // `oneOf` here is a condition on one object, not two alternative shapes —
    // both branches draw from the same property list — so the properties are
    // drawn once and the branches become rules the author is told about.
    const schema: SchemaNode = {
      type: "object",
      required: ["amount"],
      oneOf: [{ required: ["abilities"] }, { required: ["anyAbilityCount"] }],
      properties: {
        amount: { type: "integer", minimum: 1, description: "How many points." },
        abilities: { type: "array", items: { type: "string" } },
        anyAbilityCount: { type: "integer" },
      },
    };

    const control = describeControl(schema, schema) as ObjectControl;

    expect(control.properties.map((property) => property.name)).toEqual([
      "amount",
      "abilities",
      "anyAbilityCount",
    ]);
    expect(control.conditions[0]).toMatch(/exactly one of these/i);
    expect(control.conditions.join(" ")).toMatch(/abilities/i);
  });

  it("uses the branch's own words when the schema wrote them", () => {
    const schema: SchemaNode = {
      type: "object",
      anyOf: [
        { description: "A cited work names its artist.", required: ["artist"] },
        { description: "An inherited record names nobody.", required: [] },
      ],
      properties: { artist: { type: "string" } },
    };

    const control = describeControl(schema, schema) as ObjectControl;
    expect(control.conditions).toContain("A cited work names its artist.");
  });

  it("reads a list of objects as a list of objects", () => {
    const schema: SchemaNode = {
      type: "object",
      properties: {
        progression: {
          type: "array",
          title: "Levels",
          items: {
            type: "object",
            required: ["level"],
            properties: { level: { type: "integer", minimum: 1 } },
          },
        },
      },
    };

    const control = describeControl(schema, schema) as ObjectControl;
    const list = propertyNamed(control, "progression").control;

    expect(list.kind).toBe("array");
    expect(list.kind === "array" && list.item.kind).toBe("object");
    // Singularised for the "Add another …" control.
    expect(list.kind === "array" && list.itemLabel).toBe("level");
  });

  it("turns a URI and a date into the controls a browser knows about", () => {
    const schema: SchemaNode = {
      type: "object",
      properties: {
        sourceUrl: { type: "string", format: "uri" },
        publishedAt: { type: "string", format: "date" },
      },
    };

    const control = describeControl(schema, schema) as ObjectControl;
    const url = propertyNamed(control, "sourceUrl").control;
    const date = propertyNamed(control, "publishedAt").control;

    expect(url.kind === "line" && url.inputType).toBe("url");
    expect(date.kind === "line" && date.inputType).toBe("date");
  });
});

describe("nothing is ever dropped", () => {
  it("gives a shape it does not understand a control anyway", () => {
    // The most important behaviour in this module. A draft carries the whole
    // document, so a field the form does not draw is a field the next save
    // deletes — silently, and with no symptom until somebody notices a section
    // missing from a published page.
    const schema: SchemaNode = {
      type: "object",
      properties: { weird: { patternProperties: { "^x-": { type: "string" } } } },
    };

    const control = describeControl(schema, schema) as ObjectControl;
    const weird = propertyNamed(control, "weird").control;

    expect(weird.kind).toBe("json");
    expect(weird.kind === "json" && weird.reason).toMatch(/nothing is lost/i);
  });

  it("gives a list with no item schema a control anyway", () => {
    const schema: SchemaNode = { type: "object", properties: { rows: { type: "array" } } };
    const control = describeControl(schema, schema) as ObjectControl;
    const rows = propertyNamed(control, "rows").control;

    expect(rows.kind).toBe("array");
    expect(rows.kind === "array" && rows.item.kind).toBe("json");
  });

  it("refuses to follow a reference off this origin", () => {
    // Following it would be a request to a URL, which this site's policy does
    // not permit and this module has no business initiating.
    const schema: SchemaNode = {
      type: "object",
      properties: { thing: { $ref: "https://example.com/other.json" } },
    };

    const control = describeControl(schema, schema) as ObjectControl;
    expect(propertyNamed(control, "thing").control.kind).toBe("json");
  });

  it("answers null for a schema whose root is not an object", () => {
    // Nothing sensible to draw; the editor treats it exactly as it treats a
    // service with no schemas, and says why.
    expect(describeDocument({ type: "x", version: 1, schema: { type: "string" } })).toBeNull();
    expect(describeDocument({ type: "x", version: 1, schema: "not a schema" })).toBeNull();
  });
});

describe("starting from nothing", () => {
  const control = describeDocument({
    type: "armor-property",
    version: 1,
    schema: ARMOR_PROPERTY,
  })!;

  it("fills in the key, because the address already decided it", () => {
    expect(blankDocument(control, "powered")).toEqual({ key: "powered" });
  });

  it("leaves scalars absent rather than empty", () => {
    // An empty `name` fails `minLength`, and "must be at least 1 character" is
    // a worse thing to say to somebody starting a new entry than "this is
    // required".
    const blank = blankDocument(control, "powered") as Record<string, unknown>;
    expect("name" in blank).toBe(false);
  });

  it("gives a new list entry a value of the right shape", () => {
    expect(blankValue({ kind: "array", title: null, description: null, item: { kind: "line", title: null, description: null, inputType: "text", minLength: null, maxLength: null, pattern: null }, minItems: null, maxItems: null, itemLabel: "row" })).toEqual([]);
    expect(
      blankValue({
        kind: "choice",
        title: null,
        description: null,
        options: [{ value: "core", label: "Core" }],
      }),
    ).toBe("core");
  });
});
