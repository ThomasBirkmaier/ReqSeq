// The command catalog as the API gives it (`GET /v1/commands`) carries every output field with its title and marks
// (SR-224 AK3), the commands that show their output (SR-224 AK7) and those that stay an output page (SR-224 AK8).
// The test reads only the answer, never the schema files: the catalog resolves the definitions into `outputFields`
// (ADR-0002 rule 1).
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Workspace } from "@reqseq/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiServer } from "./server.js";
import { startApiServer } from "./server.js";

interface OutputField {
  readonly path: string;
  readonly title?: string;
  readonly technical?: true | "with-element";
  readonly normal?: unknown;
  readonly elements?: unknown;
  readonly elementValue?: true;
}

interface ListedEntry {
  readonly name: string;
  readonly effect: string;
  readonly showsOutput?: true;
  readonly staysOutputPage?: true;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputFields: readonly OutputField[];
}

/** The definitions SR-224 AK3 names: UUID, path, check value, commit, kind of a problem, duration. */
const TECHNICAL =
  /#\/\$defs\/(uuid|uuidRef|relativePath|localPath|outputPath|fileSha256|version|commit|problemCode|duration)$/;

let dir: string;
let server: ApiServer;
let commands: readonly ListedEntry[];

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-api-catalog-"));
  server = await startApiServer({ workspace: new Workspace(dir), cacheFolder: dir });
  const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
  const body = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      `${server.urls[0] ?? ""}/v1/commands`,
      { headers: { authorization: `Bearer ${token}`, host: `127.0.0.1:${String(server.port)}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
  commands = (JSON.parse(body) as { commands: ListedEntry[] }).commands;
});

afterAll(async () => {
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

/** The fields an output names itself, by path, with their schema: properties, items and branches, no `$ref`. */
const ownFields = (schema: unknown, prefix = ""): [string, Readonly<Record<string, unknown>>][] => {
  if (typeof schema !== "object" || schema === null) {
    return [];
  }
  const node = schema as Readonly<Record<string, unknown>>;
  const properties = (node["properties"] ?? {}) as Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  const branches = ["allOf", "anyOf", "oneOf"].flatMap((k) =>
    Array.isArray(node[k]) ? (node[k] as unknown[]) : [],
  );
  return [
    ...Object.entries(properties).flatMap(([name, field]): [string, Readonly<Record<string, unknown>>][] => {
      const at = `${prefix}${name}`;
      return [[at, field], ...ownFields(field, `${at}.`), ...ownFields(field["items"], `${at}[].`)];
    }),
    ...branches.flatMap((branch) => ownFields(branch, prefix)),
  ];
};

/** Whether a field refers to a technical definition, itself, through a branch or through its items. */
const refersToTechnical = (field: Readonly<Record<string, unknown>>): boolean => {
  const branches = ["anyOf", "oneOf"].flatMap((k): unknown[] => {
    const value = field[k];
    return Array.isArray(value) ? (value as unknown[]) : [];
  });
  const refs = [field, ...branches].map((part) => (part as Readonly<Record<string, unknown>>)["$ref"]);
  const items = field["items"];
  return (
    refs.some((ref) => typeof ref === "string" && TECHNICAL.test(ref)) ||
    (typeof items === "object" && items !== null && refersToTechnical(items as Record<string, unknown>))
  );
};

describe("the catalog the API gives", () => {
  it("[SR-224/AK-yxs1] gives every output field a title, marks every field of a technical kind, names normal values", () => {
    expect(commands.length).toBeGreaterThan(50);
    const untitled: string[] = [];
    const unmarked: string[] = [];
    const withoutNormal: string[] = [];
    for (const entry of commands) {
      const fields = new Map(entry.outputFields.map((field) => [field.path, field]));
      untitled.push(
        ...entry.outputFields
          .filter((f) => (f.title ?? "").trim() === "")
          .map((f) => `${entry.name} ${f.path}`),
      );
      for (const [at, field] of ownFields(entry.output)) {
        expect(fields.has(at), `${entry.name} ${at}`).toBe(true);
        if (refersToTechnical(field) && fields.get(at)?.technical === undefined) {
          unmarked.push(`${entry.name} ${at}`);
        }
      }
      // A UUID read from inside a shared definition is marked too: the element of every problem.
      for (const field of entry.outputFields.filter((f) =>
        /(^|\.)problems\[\]\.(elementId|targetId|code)$/.test(f.path),
      )) {
        if (field.technical !== true) {
          unmarked.push(`${entry.name} ${field.path}`);
        }
      }
      for (const name of ["problems", "incomplete"]) {
        const field = fields.get(name);
        if (field !== undefined && field.normal === undefined) {
          withoutNormal.push(`${entry.name} ${name}`);
        }
      }
    }
    expect(untitled).toEqual([]);
    expect(unmarked).toEqual([]);
    expect(withoutNormal).toEqual([]);
    const check = commands.find((entry) => entry.name === "workspace.check");
    expect(check?.outputFields.find((f) => f.path === "problems")).toMatchObject({
      title: "Problems",
      normal: [],
    });
    expect(check?.outputFields.find((f) => f.path === "durationMs")).toMatchObject({ technical: true });
    expect(check?.outputFields.find((f) => f.path === "problems[].file")).toMatchObject({
      technical: "with-element",
    });
  });

  it("[SR-224/AK-zk0v] marks exactly the write commands whose output has content of its own as showing it", () => {
    const writes = commands.filter((entry) => entry.effect === "write-files");
    expect(writes.length).toBeGreaterThan(20);
    expect(
      writes
        .filter((entry) => entry.showsOutput === true)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["element.bulkUpdate", "evidence.enrichJunit", "reqif.export", "reqif.import", "tool.guide"]);
    // A command that names only its files, problems and the element it wrote does not show its output, and
    // neither does workspace.init: the app shows the overview after it (SR-226 AK2).
    for (const name of [
      "workspace.init",
      "element.create",
      "element.update",
      "relation.add",
      "filter.save",
      "hint.confirm",
    ]) {
      expect(writes.find((entry) => entry.name === name)?.showsOutput, name).toBeUndefined();
    }
    expect(commands.filter((entry) => entry.effect === "read" && entry.showsOutput !== undefined)).toEqual(
      [],
    );
  });

  it("[SR-224/AK-nhzq] marks exactly baseline.get and evidence.status as staying an output page, not evidence.withoutPassedTest", () => {
    expect(
      commands
        .filter((entry) => entry.staysOutputPage === true)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["baseline.get", "evidence.status"]);
    // Their answer is the state of each entry; that of evidence.withoutPassedTest is the selection (SR-120 AK2).
    const without = commands.find((entry) => entry.name === "evidence.withoutPassedTest");
    expect(without?.outputFields.some((field) => field.elements === "answer")).toBe(true);
    expect(without?.staysOutputPage).toBeUndefined();
  });

  it("[SR-224/AK-cwyt] marks exactly type, version, repository, file, properties and relations of an evidence.status entry as the element's own values, and nothing else", () => {
    const marked = commands.flatMap((entry) =>
      entry.outputFields
        .filter((field) => field.elementValue === true)
        .map((field) => `${entry.name} ${field.path}`),
    );
    expect(marked.sort()).toEqual(
      ["type", "version", "repository", "file", "properties", "relations"]
        .map((name) => `evidence.status elements[].${name}`)
        .sort(),
    );
    // Not its UUID, emergent mark, verification status, validation status, its reason or its problems.
    const status = commands.find((entry) => entry.name === "evidence.status");
    for (const name of ["id", "emergent", "verification", "validation", "validationReason", "problems"]) {
      const field = status?.outputFields.find((f) => f.path === `elements[].${name}`);
      expect(field, name).toBeDefined();
      expect(field?.elementValue, name).toBeUndefined();
    }
    // No value of a baseline entry is one.
    const baseline = commands.find((entry) => entry.name === "baseline.get");
    expect(baseline?.outputFields.some((field) => field.elementValue !== undefined)).toBe(false);
  });
});
