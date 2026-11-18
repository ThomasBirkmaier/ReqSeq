// The source model of a mapping (src/reqif/source-model.ts, SR-158): what a delivery gives, how it
// merges with the stored one, and the unchanged-since-read check before the import writes.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../catalog.js";
import { readYamlFile } from "../files/index.js";
import type { YamlFile } from "../files/index.js";
import type { RepositoryLocation } from "../workspace/index.js";
import type { AnyMapping } from "./mapping.js";
import type { ReqifFile, ReqifSpecType } from "./model.js";
import type { SourceModel } from "./source-model.js";
import { checkSourceModel, deliveredModel, mergedModel } from "./source-model.js";

const MAPPING: AnyMapping = {
  "reqseq-reqif-mapping": 1,
  source: { name: "Kunde A" },
  types: [
    { source: "Requirement", type: "system-requirement" },
    { source: "Heading", omit: true },
    { source: "ot-other", type: "need" },
  ],
};

const fileOf = (specTypes: readonly ReqifSpecType[], datatypes: ReqifFile["datatypes"]): ReqifFile => ({
  header: { identifier: "h" },
  datatypes,
  specTypes,
  specObjects: [],
  specRelations: [],
  specifications: [],
  relationGroups: [],
  unread: [],
});

const attribute = (
  identifier: string,
  datatype: string,
  multiValued = false,
): ReqifSpecType["attributes"][number] => ({
  identifier,
  kind: "string",
  datatype,
  multiValued,
  line: 1,
});

describe("deliveredModel", () => {
  it("takes the SPEC-OBJECT-TYPEs a types entry maps with every attribute, and each datatype they use with its facets as written", () => {
    const file = fileOf(
      [
        {
          identifier: "ot-req",
          longName: "Requirement",
          category: "spec-object",
          line: 1,
          attributes: [
            attribute("a-real", "dt-real"),
            attribute("a-choice", "dt-enum", true),
            attribute("a-lost", "dt-none"),
          ],
        },
        {
          identifier: "ot-head",
          longName: "Heading",
          category: "spec-object",
          line: 1,
          attributes: [attribute("a-h", "dt-real")],
        },
        // A relation type of the same name is no SPEC-OBJECT-TYPE.
        { identifier: "rt", longName: "Requirement", category: "spec-relation", line: 1, attributes: [] },
        { identifier: "ot-new", category: "spec-object", line: 1, attributes: [] },
      ],
      [
        {
          identifier: "dt-real",
          longName: "Real",
          kind: "real",
          min: "-1.5",
          max: "1e3",
          accuracy: "2",
          values: [],
          line: 1,
        },
        {
          identifier: "dt-enum",
          kind: "enumeration",
          line: 1,
          values: [
            { identifier: "v1", longName: "One", key: "1", otherContent: "x", line: 1 },
            { identifier: "v2", line: 1 },
          ],
        },
        { identifier: "dt-unused", kind: "string", maxLength: "10", values: [], line: 1 },
      ],
    );
    expect(deliveredModel(file, MAPPING)).toEqual({
      datatypes: [
        { identifier: "dt-real", "long-name": "Real", kind: "real", min: "-1.5", max: "1e3", accuracy: "2" },
        {
          identifier: "dt-enum",
          kind: "enumeration",
          values: [
            { identifier: "v1", "long-name": "One", key: "1", "other-content": "x" },
            { identifier: "v2" },
          ],
        },
      ],
      types: [
        {
          identifier: "ot-req",
          "long-name": "Requirement",
          // An attribute whose datatype the file does not define cannot be written back.
          attributes: [
            { identifier: "a-real", datatype: "dt-real" },
            { identifier: "a-choice", datatype: "dt-enum", "multi-valued": true },
          ],
        },
      ],
    });
  });
});

const type = (identifier: string, datatype: string, longName?: string): SourceModel["types"][number] => ({
  identifier,
  ...(longName === undefined ? {} : { "long-name": longName }),
  attributes: [{ identifier: `a-${identifier}`, datatype }],
});

describe("a mapping without types entries", () => {
  it("delivers no type and keeps every stored one", () => {
    const bare: AnyMapping = { "reqseq-reqif-mapping": 1, source: { name: "Kunde A" } };
    const file = fileOf([{ identifier: "ot", category: "spec-object", line: 1, attributes: [] }], []);
    const delivered = deliveredModel(file, bare);
    expect(delivered).toEqual({ datatypes: [], types: [] });
    const stored: SourceModel = { datatypes: [{ identifier: "d", kind: "date" }], types: [type("ot", "d")] };
    expect(mergedModel(stored, delivered, bare)).toEqual(stored);
  });
});

describe("mergedModel", () => {
  it("takes the delivery as it is when nothing is stored", () => {
    const delivered: SourceModel = {
      datatypes: [{ identifier: "d", kind: "date" }],
      types: [type("t", "d", "Requirement")],
    };
    expect(mergedModel(undefined, delivered, MAPPING)).toEqual(delivered);
  });

  it("replaces the stored types of a delivered entry in place, also one matched by IDENTIFIER only, and keeps the others", () => {
    const stored: SourceModel = {
      datatypes: [
        { identifier: "d-old", kind: "string" },
        { identifier: "d-keep", kind: "boolean" },
        { identifier: "d", kind: "string", "max-length": "5" },
      ],
      types: [
        type("t-kept", "d-keep"),
        type("t-before", "d-old", "Requirement"),
        type("t-again", "d-old", "Requirement"),
        // Its entry is gone from the mapping, but the delivery has its IDENTIFIER.
        type("t-same", "d-old", "Renamed"),
        // A datatype the stored model lacks is left out.
        { identifier: "t-broken", attributes: [{ identifier: "a", datatype: "d-missing" }] },
      ],
    };
    const delivered: SourceModel = {
      datatypes: [{ identifier: "d", kind: "string" }],
      types: [type("t-new", "d", "Requirement"), type("t-same", "d", "Requirement"), type("ot-other", "d")],
    };
    expect(mergedModel(stored, delivered, MAPPING)).toEqual({
      datatypes: [
        { identifier: "d-keep", kind: "boolean" },
        { identifier: "d", kind: "string" },
      ],
      types: [
        type("t-kept", "d-keep"),
        type("t-new", "d", "Requirement"),
        type("t-same", "d", "Requirement"),
        { identifier: "t-broken", attributes: [{ identifier: "a", datatype: "d-missing" }] },
        type("ot-other", "d"),
      ],
    });
  });
});

describe("checkSourceModel", () => {
  const saveOf = async (): Promise<{ folder: string; yaml: YamlFile }> => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-source-model-"));
    onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
    await fs.writeFile(path.join(folder, "kunde-a.yaml"), "reqseq-reqif-mapping: 1\n");
    const read = await readYamlFile(folder, "kunde-a.yaml");
    if (read.kind === "problem") {
      throw new Error("not read");
    }
    return { folder, yaml: read.file };
  };
  const target = (folder: string): { repository: RepositoryLocation; file: string } => ({
    repository: { folder } as RepositoryLocation,
    file: "kunde-a.yaml",
  });

  it("passes while the mapping is as read, and refuses it once it changed or is gone", async () => {
    const { folder, yaml } = await saveOf();
    const save = { target: target(folder), yaml, model: { datatypes: [], types: [] } };
    await expect(checkSourceModel(undefined, "reqif.import")).resolves.toBeUndefined();
    await expect(checkSourceModel(save, "reqif.import")).resolves.toBeUndefined();
    await fs.writeFile(path.join(folder, "kunde-a.yaml"), "reqseq-reqif-mapping: 1\n# edited\n");
    const changed = await checkSourceModel(save, "reqif.import").catch((e: unknown) => e);
    expect(changed).toBeInstanceOf(CommandError);
    expect([(changed as CommandError).code, (changed as CommandError).details?.["fields"]]).toEqual([
      "file.changed-on-disk",
      ["mapping"],
    ]);
    await fs.rm(path.join(folder, "kunde-a.yaml"));
    await expect(checkSourceModel(save, "reqif.import")).rejects.toThrow("changed since it was read");
  });
});
