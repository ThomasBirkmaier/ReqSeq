// The level-2 generator and the model's reading of the files (#1396): with the seed and run count of the level-2
// runs the generator produces every feature the comparison relies on, and `modelOfFiles` applies R4 and R5.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { UNREADABLE_DATE, renderDate } from "./generator.js";
import {
  type ModelFileRecord,
  type ModelFileWorkspace,
  TWIN_VERSION,
  filesOf,
  metamorphicTarget,
  modelOfFiles,
  refusalOf,
  statusModelFileWorkspace,
  withRecord,
} from "./file-workspace.js";
import { workspaceStatusOf } from "./workspace-model.js";
import { DEFAULT_FILE_RUNS, DEFAULT_SEED } from "./run.js";
import { type ModelRecord, instantOf } from "./model.js";
import type { ModelWorkspaceElement } from "./workspace-model.js";

function featuresOf(files: ModelFileWorkspace): string[] {
  const features: string[] = [];
  const add = (condition: boolean, feature: string) => {
    if (condition) {
      features.push(feature);
    }
  };
  files.base.elements.forEach((element, index) => {
    add(files.criteria[index] !== undefined, "twin with criteria of its own");
    add(files.crlf[index] === true, "CRLF element file");
    add(filesOf(files.base, element.id).length > 1, "UUID with two files");
  });
  for (const [id, records] of Object.entries(files.records)) {
    const count = filesOf(files.base, id).length;
    for (const file of records) {
      add(file.format === "junit", "JUnit record");
      add(file.format === "markdown" && file.record.kind === "verification", "Markdown verification record");
      add(file.form === "n1" && file.record.version === "current", "current record in form n1");
      add(file.form === "n2" && file.record.version === "current", "current record in form n2");
      add(file.location === 1, "record in the second location");
      add(file.crlf && file.format === "markdown", "CRLF Markdown record");
      add(file.crlf && file.format === "junit", "CRLF JUnit record");
      add(count > 1 && file.record.version === "current" && file.pin > 0, "record against a twin's version");
      add(file.record.version !== "current", "record of an older version");
      add(file.record.criteria !== undefined && file.format === "junit", "JUnit record with criteria");
      add(file.record.date.endsWith("+05:30"), "date with an offset");
      add(
        file.record.kind === "validation" &&
          file.record.result === "inconclusive" &&
          file.record.reason !== undefined,
        "inconclusive validation",
      );
      const refusal = refusalOf(file);
      if (refusal !== undefined) {
        features.push(`refused: ${refusal}`);
      }
    }
    const inconclusive = records.filter(
      (file) =>
        file.record.kind === "validation" &&
        file.record.result === "inconclusive" &&
        refusalOf(file) === undefined,
    );
    add(
      inconclusive.some((a) =>
        inconclusive.some(
          (b) =>
            a !== b &&
            instantOf(a.record.date) === instantOf(b.record.date) &&
            a.record.reason !== b.record.reason,
        ),
      ),
      "inconclusive tie with two reasons",
    );
  }
  return features;
}

describe("status model level-2 generator", () => {
  it("produces every feature with the default seed and runs", () => {
    const seen = new Set<string>();
    for (const files of fc.sample(statusModelFileWorkspace(), {
      seed: DEFAULT_SEED,
      numRuns: DEFAULT_FILE_RUNS,
    })) {
      for (const feature of featuresOf(files)) {
        seen.add(feature);
      }
    }
    expect([...seen].sort()).toEqual(
      [
        "CRLF JUnit record",
        "CRLF Markdown record",
        "CRLF element file",
        "JUnit record",
        "JUnit record with criteria",
        "Markdown verification record",
        "UUID with two files",
        "current record in form n1",
        "current record in form n2",
        "date with an offset",
        "inconclusive tie with two reasons",
        "inconclusive validation",
        "record against a twin's version",
        "record in the second location",
        "record of an older version",
        "refused: inconclusive-verification",
        "refused: inconclusive-without-reason",
        "refused: unreadable-date",
        "refused: validation-with-variant",
        "twin with criteria of its own",
      ].sort(),
    );
  });

  it("gives the metamorphic target every change an older-version record may cause, by the model", () => {
    const changes = new Set<string>();
    for (const files of fc.sample(statusModelFileWorkspace(), {
      seed: DEFAULT_SEED,
      numRuns: DEFAULT_FILE_RUNS,
    })) {
      const ws = modelOfFiles(files);
      const older: ModelRecord = {
        kind: "verification",
        version: "v1",
        date: renderDate(9, "Z"),
        result: "passed",
      };
      const before = workspaceStatusOf(ws);
      const after = workspaceStatusOf(modelOfFiles(withRecord(files, metamorphicTarget(ws), older)));
      for (const [key, entries] of after) {
        for (const entry of entries) {
          const was = before.get(key)?.find((candidate) => candidate.view === entry.view);
          if (was !== undefined && was.status !== entry.status) {
            changes.add(`${was.status}>${entry.status}`);
          }
        }
      }
    }
    expect([...changes].sort()).toEqual(["indirect>open", "indirect>outdated", "open>outdated"]);
  });

  it("writes validation records in the first location and refused ones as Markdown", () => {
    for (const files of fc.sample(statusModelFileWorkspace(), {
      seed: DEFAULT_SEED,
      numRuns: DEFAULT_FILE_RUNS,
    })) {
      for (const file of Object.values(files.records).flat()) {
        if (file.record.kind === "validation") {
          expect(file.location).toBe(0);
        }
        if (refusalOf(file) !== undefined) {
          expect(file.format).toBe("markdown");
        }
      }
    }
  });
});

const T1 = "2026-11-01T10:00:00Z";
const T2 = "2026-11-02T10:00:00Z";

function element(key: string, repository: string): ModelWorkspaceElement {
  return {
    key,
    id: "e1",
    repository,
    type: "requirement",
    invalid: false,
    emergent: false,
    validity: [],
    derivesFrom: [],
    replaces: [],
    own: {
      criteria: [{ key: "alpha" }],
      olderVersions: [{ id: "v1", criteria: [{ key: "alpha" }] }],
      records: [],
    },
  };
}

function written(record: ModelRecord, extra: Partial<ModelFileRecord> = {}): ModelFileRecord {
  return { record, pin: 0, form: "n2", format: "markdown", location: 0, crlf: false, ...extra };
}

describe("modelOfFiles (R4, R5)", () => {
  it("reads each file with its own criteria, the records against it as current and the refused ones not at all", () => {
    const first: ModelRecord = { kind: "verification", version: "current", date: T1, result: "passed" };
    const second: ModelRecord = { kind: "verification", version: "current", date: T2, result: "failed" };
    const refused: ModelRecord = {
      kind: "verification",
      version: "current",
      date: T2,
      result: "inconclusive",
    };
    const unreadable: ModelRecord = { ...first, date: UNREADABLE_DATE };
    const files: ModelFileWorkspace = {
      base: {
        repositories: [],
        variants: [],
        elements: [element("x0", "spec"), element("x1", "lib")],
        order: [],
      },
      criteria: [undefined, [{ key: "bravo" }]],
      crlf: [false, false],
      records: {
        e1: [
          written(first),
          written(second, { pin: 1 }),
          written({ ...first, result: "failed" }),
          written(refused, { refusal: "inconclusive-verification" }),
          written(unreadable),
        ],
      },
    };
    const [x0, x1] = modelOfFiles(files).elements;
    expect(x0?.own).toEqual({
      criteria: [{ key: "alpha" }],
      olderVersions: [{ id: "v1" }],
      records: [{ ...second, version: TWIN_VERSION }, first, { ...first, result: "failed" }],
    });
    expect(x1?.own).toEqual({
      criteria: [{ key: "bravo" }],
      olderVersions: [{ id: "v1" }],
      records: [
        second,
        { ...first, version: TWIN_VERSION },
        { ...first, result: "failed", version: TWIN_VERSION },
      ],
    });
    expect(modelOfFiles({ ...files, records: {} }).elements[0]?.own.records).toEqual([]);
  });
});

describe("withRecord and metamorphicTarget", () => {
  it("adds a record to a UUID without records and falls back to the generated order", () => {
    const record: ModelRecord = { kind: "verification", version: "current", date: T1, result: "passed" };
    const lone = element("x0", "spec");
    const files: ModelFileWorkspace = {
      base: { repositories: [], variants: [], elements: [lone], order: [] },
      criteria: [undefined],
      crlf: [false],
      records: {},
    };
    expect(withRecord(files, "e1", record).records["e1"]?.map((file) => file.record)).toEqual([record]);
    expect(metamorphicTarget(files.base)).toBe("e1");
    expect(metamorphicTarget({ ...files.base, elements: [] })).toBe("");
  });
});
