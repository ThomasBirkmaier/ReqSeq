// The output of `metamodel.get` on fixtures/SR-130/metamodel, as core gives it (the core test
// `packages/core/src/commands/metamodel/get.test.ts` checks the same values on the fixture), for the
// app's tests of the metamodel graph (SR-130).
import type { MetamodelGetOutput } from "@logreq/core";

export const FIXTURE_METAMODEL: MetamodelGetOutput = {
  types: [
    {
      key: "item",
      name: "Item",
      prefix: "ITM",
      abstract: true,
      ancestors: [],
      properties: ["title"],
      required: ["title"],
      statuses: ["draft", "approved", "retired"],
    },
    {
      key: "requirement",
      name: "System Requirement",
      prefix: "SR",
      extends: "item",
      meaning: "requirement",
      abstract: false,
      ancestors: ["item"],
      properties: ["title", "rationale", "packages"],
      required: ["title"],
      statuses: ["draft", "approved", "retired"],
    },
    {
      key: "software-requirement",
      name: "Software Requirement",
      prefix: "SWR",
      extends: "requirement",
      meaning: "requirement",
      abstract: false,
      ancestors: ["requirement", "item"],
      properties: ["title", "rationale", "packages", "component"],
      required: ["title", "component"],
      statuses: ["draft", "approved", "retired"],
    },
    {
      key: "decision",
      name: "Decision",
      prefix: "D",
      abstract: false,
      ancestors: [],
      properties: ["title"],
      required: [],
      statuses: ["open", "decided"],
    },
    {
      key: "package",
      name: "Package",
      prefix: "PKG",
      meaning: "package",
      abstract: false,
      ancestors: [],
      properties: ["title"],
      required: [],
      statuses: [],
    },
  ],
  properties: [
    {
      key: "title",
      name: "Title",
      kind: "text",
      meaning: "title",
    },
    {
      key: "rationale",
      name: "Rationale",
      kind: "text",
      markdown: true,
    },
    {
      key: "component",
      name: "Component",
      kind: "choice",
      many: true,
      content: true,
      choices: [
        {
          key: "display",
          name: "Display",
        },
        {
          key: "sensor",
          name: "Sensor",
        },
      ],
    },
    {
      key: "packages",
      name: "Package",
      kind: "relation",
      many: true,
      "target-types": ["package"],
      meaning: "packages",
    },
    {
      key: "severity",
      name: "Severity",
      kind: "number",
    },
  ],
  relations: [
    {
      key: "derives-from",
      name: "Derives from",
      "inverse-name": "Derived by",
      "source-types": ["software-requirement"],
      "target-types": ["requirement", "software-requirement"],
      meaning: "derivation",
    },
    {
      key: "replaces",
      name: "Replaces",
      "inverse-name": "Replaced by",
      "source-types": ["requirement"],
      "target-types": ["requirement"],
    },
    {
      key: "delegates-to",
      name: "Delegates to",
      "inverse-name": "Delegated by",
      "source-types": ["requirement"],
      "target-types": ["software-requirement"],
    },
    {
      key: "based-on",
      name: "Based on",
      "inverse-name": "Basis for",
      "target-types": ["decision"],
    },
    {
      key: "concerns",
      name: "Concerns",
      "inverse-name": "Concerned by",
      "target-types": ["requirement", "decision"],
    },
    {
      key: "refines",
      name: "Refines",
      "inverse-name": "Refined by",
      meaning: "derivation",
    },
    {
      key: "traces-to",
      name: "Traces to",
      "inverse-name": "Traced by",
      "source-types": ["decision"],
    },
    {
      key: "blocks",
      name: "Blocks",
      "inverse-name": "Blocked by",
      "source-types": [],
      "target-types": ["requirement"],
    },
  ],
  statuses: [
    {
      key: "draft",
      name: "Draft",
      initial: true,
    },
    {
      key: "approved",
      name: "Approved",
    },
    {
      key: "retired",
      name: "Retired",
      invalid: true,
    },
    {
      key: "open",
      name: "Open",
    },
    {
      key: "decided",
      name: "Decided",
    },
  ],
  meanings: {
    requirement: ["requirement"],
    need: [],
    variant: [],
    package: ["package"],
    title: ["title"],
    validity: [],
    packages: ["packages"],
    emergent: [],
    "verification-method": [],
    statement: [],
    source: [],
    "source-identifier": [],
    "import-date": [],
    delivery: [],
    identifier: [],
    derivation: ["derives-from", "refines"],
    replacement: [],
    exclusion: [],
  },
};

/** A metamodel of `types` and `relations` only, the rest empty. */
export const metamodelOutput = (
  parts: Partial<Pick<MetamodelGetOutput, "types" | "properties" | "relations">>,
): MetamodelGetOutput => ({
  types: [],
  properties: [],
  relations: [],
  statuses: [],
  meanings: {},
  ...parts,
});

/** A type as `metamodel.get` gives it, with the fields the graph reads. */
export const effectiveType = (
  key: string,
  properties: readonly string[] = [],
  extended?: string,
): MetamodelGetOutput["types"][number] => ({
  key,
  name: key.toUpperCase(),
  prefix: key.toUpperCase().replace(/[^A-Z]/g, ""),
  abstract: false,
  ancestors: extended === undefined ? [] : [extended],
  properties,
  required: [],
  statuses: [],
  ...(extended === undefined ? {} : { extends: extended }),
});
