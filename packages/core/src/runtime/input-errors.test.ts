import { describe, expect, it } from "vitest";
import type { Contracts } from "./contracts.js";
import { contractsBundle, loadContracts } from "./contracts.js";
import type { InputViolation } from "./input-errors.js";
import { describeInputViolations, inputViolations, knownNames } from "./input-errors.js";

const product = loadContracts();

const commonDefs = contractsBundle.schemas.find((schema) =>
  String(schema["$id"]).endsWith("/common.schema.json"),
)?.["$defs"] as Record<string, unknown>;

/** One test command whose input has a field for each keyword the messages know. */
const keywordCatalog = {
  "reqseq-catalog": 1,
  commands: [
    {
      name: "test.fields",
      title: "Test command",
      summary: "Fields of every kind (test only).",
      effect: "read",
      stage: 1,
      implements: ["SR-080"],
      arguments: [],
      input: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 5 },
          code: { type: "string", minLength: 3 },
          mode: { enum: ["fast", "slow"] },
          kind: { const: "core" },
          count: { type: "integer", minimum: 1, maximum: 9 },
          flag: { type: ["boolean", "null"] },
          tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2, uniqueItems: true },
          id: { $ref: "../common.schema.json#/$defs/uuid" },
          shortId: { $ref: "../common.schema.json#/$defs/shortId" },
          version: { $ref: "../common.schema.json#/$defs/version" },
          commit: { $ref: "../common.schema.json#/$defs/commit" },
          file: { $ref: "../common.schema.json#/$defs/relativePath" },
          day: { $ref: "../common.schema.json#/$defs/date" },
          at: { $ref: "../common.schema.json#/$defs/dateTime" },
          mail: { type: "string", format: "email" },
          plain: { type: "string", pattern: "^x+$" },
          described: { type: "string", pattern: "^y+$", description: "Only y." },
          // Same description as common elementRef, but another object: no def message (#317 review).
          lookalike: {
            type: "string",
            pattern: "^z$",
            description: (commonDefs["elementRef"] as { description: string }).description,
          },
          either: { anyOf: [{ type: "string", pattern: "^a$" }, { type: "number" }] },
          one: { oneOf: [{ type: "string" }, { type: "string", minLength: 2 }] },
          // Object branches told apart by their required keys (#150); `b` is open and lists no fields.
          shape: {
            oneOf: [
              {
                type: "object",
                required: ["a"],
                properties: { a: { type: "string" }, n: { type: "number" } },
                additionalProperties: false,
              },
              { type: "object", required: ["b"], minProperties: 3 },
            ],
          },
          foreign: {
            anyOf: [{ type: "object", required: ["a"] }, { $ref: "../common.schema.json#/$defs/uuid" }],
          },
          other: { type: "string", not: { const: "no" } },
          even: { type: "number", multipleOf: 2 },
          nested: {
            type: "object",
            required: ["inner"],
            properties: { inner: { type: "string" }, "a/b": { type: "number" } },
            additionalProperties: false,
          },
          map: { type: "object", propertyNames: { not: { enum: ["id"] } } },
        },
        additionalProperties: false,
      },
      output: { type: "object" },
    },
  ],
};

const keywords = loadContracts({ catalog: keywordCatalog });

const violations = (contracts: Contracts, name: string, input: unknown): InputViolation[] => {
  const validate = contracts.validator(name, "input");
  const copy = structuredClone(input);
  expect(validate(copy)).toBe(false);
  return inputViolations(validate.errors, { input: copy, schemas: contracts.schemas });
};

const messages = (contracts: Contracts, name: string, input: unknown): string[] =>
  violations(contracts, name, input).map((v) => v.message);

const field = (input: Record<string, unknown>): string[] => messages(keywords, "test.fields", input);

describe("readable messages of an input that fails its schema (#309)", () => {
  it("[SR-060/AK3] says what an element reference looks like, without a regular expression", () => {
    // An identifier may be any text (#305): only an empty reference, spaces at either end, control
    // characters and more than 256 characters fail.
    expect(product.validator("element.get", "input")({ ref: "SR-036" })).toBe(true);
    expect(messages(product, "element.get", { ref: " SR-036" })).toEqual([
      'ref " SR-036" is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)',
    ]);
    expect(messages(product, "hint.list", { package: "Stufe 2 " })).toEqual([
      'package "Stufe 2 " is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)',
    ]);
    expect(messages(product, "element.setStatus", { refs: ["", "SR-e88fb3"], status: "x" })).toEqual([
      'refs[0] "" is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)',
    ]);
    // No control characters, also inside, and at most 256 characters (#305).
    expect(product.validator("element.get", "input")({ ref: "Stufe 2 – Spec-ID ä" })).toBe(true);
    expect(product.validator("element.get", "input")({ ref: "x".repeat(256) })).toBe(true);
    for (const ref of ["SR-\u0007036", "SR-036\n", "a\tb", "x".repeat(257)]) {
      expect(messages(product, "element.get", { ref })).toEqual([
        `ref ${JSON.stringify(ref.length > 60 ? `${ref.slice(0, 60)}...` : ref)} is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)`,
      ]);
    }
    expect(messages(product, "element.get", { ref: 5 })).toEqual(["ref must be text, not 5"]);
  });

  it("names a missing field by its input name, never (root)", () => {
    const found = violations(product, "workspace.init", {});
    expect(found.map((v) => [v.field, v.message])).toEqual([
      ["path", "path is required"],
      ["name", "name is required"],
    ]);
    expect(describeInputViolations(found)).toBe("path is required; name is required");
  });

  it("names a field the command does not have", () => {
    expect(messages(product, "element.supersede", { ref: "SR-e88fb3", status: "obsolete", old: 1 })).toEqual([
      "old is not an input of this command (known: ref, status, successor, relation)",
    ]);
    expect(field({ nested: { inner: "x", extra: 1 } })).toEqual([
      "nested.extra is not a field of nested (known: inner, a/b)",
    ]);
    expect(field({ nested: {} })).toEqual(["nested.inner is required"]);
  });

  it("names the inputs an update takes when it gets those of a create (#641)", () => {
    const [message] = messages(product, "element.update", { ref: "SR-e88fb3", properties: { x: 1 } });
    expect(message).toMatch(/^properties is not an input of this command \(known: .*\bset\b.*\)$/);
  });

  it("lists at most twelve names, and none for an object without listed fields", () => {
    expect(
      knownNames({ properties: Object.fromEntries([...Array(13).keys()].map((i) => [`f${String(i)}`, {}])) }),
    ).toBe(" (known: f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, ...)");
    expect(knownNames(undefined)).toBe("");
  });

  it("collapses the branches of a variant view into one message", () => {
    expect(messages(product, "trace.chain", { ref: "SR-e88fb3", view: "bad " })).toEqual([
      'view "bad " is neither core nor a reference to a variant (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)',
    ]);
  });

  it("has one message per shared definition", () => {
    expect(messages(product, "element.create", { type: "Bad Type", title: "x" })).toEqual([
      'type "Bad Type" is not a key (lower case letters and digits, words joined by single dashes, for example system-requirement)',
    ]);
    expect(
      messages(product, "element.update", { ref: "SR-e88fb3", set: { a: { b: 1 } }, unset: ["status"] }),
    ).toEqual([
      "set.a (an object) is not a property value (text, a number, true or false, a list of these, a relation target { id } with an element reference, or a list of them)",
      'unset[0] "status" is not allowed here',
    ]);
    expect(messages(product, "element.update", { ref: "SR-e88fb3", set: { status: "x" } })).toEqual([
      "set cannot hold status",
    ]);
    expect(
      field({
        id: "SR-1",
        shortId: "sr-1",
        version: "v1",
        commit: "abc",
        file: "/etc",
        day: "2026-13-01",
        at: "today",
      }),
    ).toEqual([
      'id "SR-1" is not a UUID (for example 6adc6d27-b7a2-49dd-9b02-2b572655ebad)',
      'shortId "sr-1" is not a short ID (prefix, dash, at least 6 hex characters, for example SR-3c90b0)',
      'version "v1" is not a version (for example n1:9f86d081884c7d65)',
      'commit "abc" is not a full Git commit ID (40 or 64 hex characters)',
      'file "/etc" is not a relative path (forward slashes, no leading slash, no drive letter, no .. segment)',
      'day "2026-13-01" is not a date YYYY-MM-DD',
      'at "today" is not a date and time (for example 2026-10-26T09:30:00Z)',
    ]);
  });

  it("has a message for every keyword, none with a regular expression", () => {
    expect(
      field({
        name: "",
        code: "ab",
        mode: "loud",
        kind: "all",
        count: 0,
        flag: "yes",
        tags: [],
        mail: "nobody",
        plain: "y",
        described: "x",
        either: true,
        one: "abc",
        other: "no",
        even: 3,
      }),
    ).toEqual([
      "name must not be empty",
      "code must have at least 3 characters",
      'mode "loud" is not one of: fast, slow',
      'kind "all" is not core',
      "count must be >= 1, not 0",
      'flag must be true or false or empty, not "yes"',
      "tags must have at least 1 item",
      'mail "nobody" is not a valid email',
      'plain "y" does not have the expected form',
      'described "x" does not have the expected form: Only y.',
      "either true does not have the expected form",
      'one "abc" does not have the expected form',
      'other "no" is not allowed here',
      "even must be multiple of 2",
    ]);
    expect(field({ name: "abcdefgh", count: 10, tags: ["a", "a", "b"] })).toEqual([
      "name must have at most 5 characters",
      "count must be <= 9, not 10",
      "tags must have at most 2 items",
      "tags must not hold the same item twice",
    ]);
    expect(field({ tags: ["a", "a"] })).toEqual(["tags must not hold the same item twice"]);
    // Defs are found by object, not by their description text.
    expect(field({ lookalike: "x" })).toEqual([
      `lookalike "x" does not have the expected form: ${(commonDefs["elementRef"] as { description: string }).description}`,
    ]);
  });

  it("quotes values shortly and names a field below a list or with a slash", () => {
    expect(field({ plain: "y".repeat(70) })).toEqual([
      `plain "${"y".repeat(60)}..." does not have the expected form`,
    ]);
    expect(field({ tags: [1] })).toEqual(["tags[0] must be text, not 1"]);
    expect(field({ nested: { inner: "x", "a/b": "c" } })).toEqual(['nested.a/b must be a number, not "c"']);
    expect(field({ mode: null, plain: ["x"] })).toEqual([
      "mode (empty) is not one of: fast, slow",
      "plain must be text, not a list",
    ]);
    expect(field({ name: {} })).toEqual(["name must be text, not an object"]);
  });

  it("speaks of the input itself when it is no object", () => {
    expect(violations(keywords, "test.fields", 5)).toEqual([
      {
        path: "",
        field: "",
        keyword: "type",
        message: "The input must be an object, not 5",
        params: { type: "object" },
      },
    ]);
    expect(violations(keywords, "test.fields", undefined).map((v) => v.message)).toEqual([
      "The input must be an object, not missing",
    ]);
  });

  it("names the error of the condition branch the operator means (#150)", () => {
    const where = (condition: unknown): string[] =>
      messages(product, "element.list", { selection: { where: condition } });
    expect(where({ property: "topic", op: "nope", value: 1 })).toEqual([
      'selection.where.op "nope" is not one of: eq, ne, in, contains, lt, le, gt, ge, exists, missing, matches',
    ]);
    expect(where({ all: [{ type: ["need"] }, { status: "draft" }] })).toEqual([
      'selection.where.all[1].status must be a list, not "draft"',
    ]);
    expect(where({ not: { relation: { direction: "sideways" }, exists: true } })).toEqual([
      'selection.where.not.relation.direction "sideways" is not one of: up, down, evidence',
    ]);
    expect(where({ status: ["draft"], extra: 1 })).toEqual([
      "selection.where.extra is not a field of selection.where (known: status)",
    ]);
    const operators =
      " (exactly one of: all, any, not, type, status, invalid, package, validFor, verification, validation, emergent, source, text, property, relation)";
    for (const condition of [{ typ: ["need"] }, { status: ["draft"], type: ["need"] }]) {
      const [message, ...rest] = where(condition);
      expect(rest).toEqual([]);
      expect(message).toMatch(
        /^selection\.where \(an object\) does not have the expected form: Combinable condition/,
      );
      expect(message?.endsWith(operators)).toBe(true);
    }
  });

  it("tells object branches apart only when every branch names its keys (#150)", () => {
    expect(field({ shape: { a: 1, n: "x", z: true } })).toEqual([
      "shape.a must be text, not 1",
      'shape.n must be a number, not "x"',
      "shape.z is not a field of shape (known: a, n)",
    ]);
    expect(field({ shape: { b: 1, z: true } })).toEqual(["shape must NOT have fewer than 3 properties"]);
    expect(field({ shape: [] })).toEqual(["shape (a list) does not have the expected form"]);
    expect(field({ shape: {} })).toEqual([
      "shape (an object) does not have the expected form (exactly one of: a, b)",
    ]);
    expect(field({ foreign: {} })).toEqual(["foreign (an object) does not have the expected form"]);
    // A local reference without the file of its def cannot be resolved: the branches stay one message.
    const error = {
      instancePath: "",
      schemaPath: "#/oneOf",
      keyword: "oneOf",
      params: {},
      schema: [{ $ref: "#/$defs/elsewhere" }],
      parentSchema: {},
    };
    expect(
      describeInputViolations(inputViolations([error], { input: { a: 1 }, schemas: product.schemas })),
    ).toBe("The input (an object) does not have the expected form");
    // A validator without `verbose` gives no schema with its errors: nothing to tell the branches by.
    const plain = { instancePath: "", schemaPath: "#/oneOf", keyword: "oneOf", params: {} };
    expect(
      describeInputViolations(inputViolations([plain], { input: { a: 1 }, schemas: product.schemas })),
    ).toBe("The input (an object) does not have the expected form");
  });

  it("gives no violation for no errors", () => {
    expect(inputViolations(null, { input: {}, schemas: product.schemas })).toEqual([]);
    expect(inputViolations(undefined, { input: {}, schemas: product.schemas })).toEqual([]);
  });
});
