// The output of `metamodel.get` on fixtures/SR-130/metamodel, as core gives it (the core test
// `packages/core/src/commands/metamodel/get.test.ts` checks the same values on the fixture), for the
// app's tests of the metamodel graph (SR-130).
import type { MetamodelGetOutput } from "@reqseq/core";

/** The entries of a list of `uses`, one per key with its number, in the order given. */
const counts = (by: Record<string, number>): { key: string; count: number }[] =>
  Object.entries(by).map(([key, count]) => ({ key, count }));

export const FIXTURE_METAMODEL: MetamodelGetOutput = {
  answer: "The metamodel.",
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
      content: false,
      meaning: "title",
    },
    {
      key: "rationale",
      name: "Rationale",
      kind: "text",
      markdown: true,
      content: false,
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
      content: false,
    },
    {
      key: "severity",
      name: "Severity",
      kind: "number",
      content: false,
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
    "import-version": [],
    identifier: [],
    "acceptance-criteria": [],
    synonyms: [],
    translation: [],
    derivation: ["derives-from", "refines"],
    replacement: [],
    succession: [],
    exclusion: [],
  },
  relationKinds: {
    item: [
      { kind: "based-on", targetTypes: ["decision"] },
      { kind: "concerns", targetTypes: ["requirement", "software-requirement", "decision"] },
      {
        kind: "refines",
        targetTypes: ["item", "requirement", "software-requirement", "decision", "package"],
      },
    ],
    requirement: [
      { kind: "replaces", targetTypes: ["requirement", "software-requirement"] },
      { kind: "delegates-to", targetTypes: ["software-requirement"] },
      { kind: "based-on", targetTypes: ["decision"] },
      { kind: "concerns", targetTypes: ["requirement", "software-requirement", "decision"] },
      {
        kind: "refines",
        targetTypes: ["item", "requirement", "software-requirement", "decision", "package"],
      },
    ],
    "software-requirement": [
      { kind: "derives-from", targetTypes: ["requirement", "software-requirement"] },
      { kind: "replaces", targetTypes: ["requirement", "software-requirement"] },
      { kind: "delegates-to", targetTypes: ["software-requirement"] },
      { kind: "based-on", targetTypes: ["decision"] },
      { kind: "concerns", targetTypes: ["requirement", "software-requirement", "decision"] },
      {
        kind: "refines",
        targetTypes: ["item", "requirement", "software-requirement", "decision", "package"],
      },
    ],
    decision: [
      { kind: "based-on", targetTypes: ["decision"] },
      { kind: "concerns", targetTypes: ["requirement", "software-requirement", "decision"] },
      {
        kind: "refines",
        targetTypes: ["item", "requirement", "software-requirement", "decision", "package"],
      },
      {
        kind: "traces-to",
        targetTypes: ["item", "requirement", "software-requirement", "decision", "package"],
      },
    ],
    package: [
      { kind: "based-on", targetTypes: ["decision"] },
      { kind: "concerns", targetTypes: ["requirement", "software-requirement", "decision"] },
      {
        kind: "refines",
        targetTypes: ["item", "requirement", "software-requirement", "decision", "package"],
      },
    ],
  },
  files: [{ repository: "system", path: "metamodel/standard-model.yaml" }],
  uses: {
    types: counts({ item: 0, requirement: 1, "software-requirement": 0, decision: 1, package: 0 }),
    properties: counts({ title: 2, rationale: 0, component: 0, packages: 0, severity: 0 }),
    values: [
      { property: "component", value: "display", count: 0 },
      { property: "component", value: "sensor", count: 0 },
    ],
    relations: counts({
      "derives-from": 0,
      replaces: 0,
      "delegates-to": 0,
      "based-on": 0,
      concerns: 0,
      refines: 0,
      "traces-to": 0,
      blocks: 0,
    }),
    statuses: counts({ draft: 1, approved: 0, retired: 0, open: 1, decided: 0 }),
  },
};

/** A metamodel of `types` and `relations` only, the rest empty. */
export const metamodelOutput = (
  parts: Partial<Pick<MetamodelGetOutput, "types" | "properties" | "relations">>,
): MetamodelGetOutput => ({
  answer: "The metamodel.",
  types: [],
  properties: [],
  relations: [],
  statuses: [],
  meanings: {},
  relationKinds: {},
  files: [],
  uses: { types: [], properties: [], values: [], relations: [], statuses: [] },
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
