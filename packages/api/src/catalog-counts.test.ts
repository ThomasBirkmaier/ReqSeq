// The numbers of elements in the outputs, as the API gives the catalog and the commands (SR-224 AK4, #1915):
// `outputFields` marks each number that counts elements (`elements` with paths, "answer" or "selection",
// `keys` for its lists), and `element.list` with `selection.output.count` lists exactly the elements the
// number counts, over all pages; a write command names them itself. The catalog is read only through
// `GET /v1/commands`, the commands only through `POST /v1/commands/<name>`. That every integer of an output
// is marked or listed with a reason in NOT_ELEMENT_COUNTS is the contract gate (output-checks.mjs); the walk
// in core over the same table: packages/core/src/commands/element/list-count.test.ts.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Workspace } from "@reqseq/core";
import type { FixtureOptions } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { startApiServer } from "./server.js";

interface Field {
  readonly path: string;
  readonly elements?: true | "answer" | "selection" | readonly string[];
  readonly keys?: readonly (readonly string[])[];
}

interface Entry {
  readonly name: string;
  readonly effect: string;
  readonly outputFields: readonly Field[];
}

type Key = Readonly<Record<string, unknown>>;
type Output = Readonly<Record<string, unknown>>;

interface Listed {
  readonly elements: readonly { readonly id: string; readonly repository: string; readonly file: string }[];
  readonly total: number;
  readonly incomplete?: boolean;
}

/** A server on a copy of a fixture: `call` posts a command and gives its answer, `catalog` the commands. */
interface Served {
  readonly call: (
    name: string,
    input: unknown,
  ) => Promise<{ readonly status: number; readonly body: Output }>;
  readonly run: (name: string, input: unknown) => Promise<Output>;
  readonly catalog: () => Promise<readonly Entry[]>;
}

const serve = async (options: FixtureOptions, root = "."): Promise<Served> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-api-counts-"));
  onTestFinished(() => fs.rm(cache, { recursive: true, force: true }));
  const workspace = new Workspace(fixture.path(root));
  onTestFinished(() => workspace.close());
  const server = await startApiServer({ workspace, cacheFolder: cache });
  onTestFinished(() => server.close());
  const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
  const request = (at: string, body?: unknown): Promise<{ status: number; body: Output }> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        `${server.urls[0] ?? ""}${at}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            authorization: `Bearer ${token}`,
            host: `127.0.0.1:${String(server.port)}`,
            "content-type": "application/json",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Output,
            });
          });
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const call = (name: string, input: unknown): Promise<{ status: number; body: Output }> =>
    request(`/v1/commands/${name}`, input);
  return {
    call,
    run: async (name, input) => {
      const { status, body } = await call(name, input);
      expect(status, `${name} ${JSON.stringify(body)}`).toBe(200);
      return body;
    },
    catalog: async () => (await request("/v1/commands")).body["commands"] as readonly Entry[],
  };
};

const isNumber = (field: Field): boolean =>
  field.elements !== undefined && field.elements !== true && field.elements !== "answer";

/** Every value at the path of `field` in `output`, with the key of each list entry on the way. */
const instancesAt = (output: unknown, field: Field): { key: Key[]; value: unknown }[] => {
  const keys = field.keys ?? [];
  let at: { value: unknown; key: Key[] }[] = [{ value: output, key: [] }];
  for (const segment of field.path.split(".")) {
    const list = segment.endsWith("[]");
    const name = list ? segment.slice(0, -2) : segment;
    at = at.flatMap(({ value, key }) => {
      const inner = (value as Output | undefined)?.[name];
      if (!list) {
        return inner === undefined ? [] : [{ value: inner, key }];
      }
      const fields = keys[key.length] ?? [];
      return ((inner as readonly Output[] | undefined) ?? []).map((entry) => ({
        value: entry,
        key: [...key, Object.fromEntries(fields.filter((f) => f in entry).map((f) => [f, entry[f]]))],
      }));
    });
  }
  return at;
};

/** Every page of `element.list` for `selection`, two rows a page. */
const listAll = async (served: Served, selection: unknown, extra: Output = {}): Promise<Listed> => {
  const elements: Listed["elements"][number][] = [];
  let first: Listed | undefined;
  for (let offset = 0; first === undefined || offset < first.total; offset += 2) {
    const page = (await served.run("element.list", {
      selection,
      ...extra,
      offset,
      limit: 2,
    })) as unknown as Listed;
    first ??= page;
    elements.push(...page.elements);
  }
  return { elements, total: first.total, ...(first.incomplete === true ? { incomplete: true } : {}) };
};

/** The elements of a list, a copy of a UUID (SR-088) by its file. */
const ids = (listed: Listed): string[] =>
  listed.elements.map((e) => `${e.repository} ${e.id} ${e.file}`).sort();

const X = "61061061-0000-4000-8000-0000000000";
const EXPORT: FixtureOptions = {
  fixture: "SR-061/export",
  files: {
    "system/baselines/counts.yaml":
      "reqseq-baseline: 1\nname: Counts\ndate: 2026-10-23T09:00:00Z\n" +
      "repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\n" +
      `selection: { package: ${X}d1 }\nelements:\n` +
      `  - { id: ${X}b1, version: n1:697a2ad17ed49170 }\n  - { id: ${X}b2, version: n1:0000000000000000 }\n` +
      `  - { id: ${X}b4, version: n1:1e68aa41d13d05b1 }\n  - { id: ${X}b3, version: n1:4b17a5494b8e80e5 }\n` +
      `  - { id: ${X}ff, version: n1:2222222222222222 }\n`,
    "system/baselines/by-package.yaml":
      "reqseq-baseline: 1\nname: By package\ndate: 2026-10-23T09:00:00Z\n" +
      "repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\n" +
      `selection: { package: ${X}d1 }\nelements:\n  - { id: ${X}b1, version: n1:697a2ad17ed49170 }\n`,
  },
};
/** The repository `archive` is not on this machine: its entry of the baseline is inaccessible. */
const ARCHIVE: FixtureOptions = {
  fixture: "SR-061/export",
  files: {
    "system/reqseq-workspace.yaml":
      "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
      '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }\n' +
      '  - { name: archive, url: "git@git.example.com:ws/archive.git" }\n' +
      "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n",
    "system/baselines/archive.yaml":
      "reqseq-baseline: 1\nname: Archive\ndate: 2026-10-23T09:00:00Z\n" +
      "repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\n" +
      `elements:\n  - { id: ${X}b1, version: n1:697a2ad17ed49170 }\n` +
      `  - { id: ${X}aa, version: n1:2222222222222222, repository: archive }\n`,
  },
};
/** The baselines of `options` with the one in `file` made the newest (SR-241 AK1), for baseline.prepare. */
const newest = (options: FixtureOptions, file: string): FixtureOptions => {
  const files = { ...options.files };
  files[file] = String(files[file]).replace("date: 2026-10-23", "date: 2026-10-24");
  return { ...options, files };
};
const NEWEST_COUNTS = newest(EXPORT, "system/baselines/counts.yaml");
const NEWEST_BY_PACKAGE = newest(EXPORT, "system/baselines/by-package.yaml");
const NEWEST_ARCHIVE = newest(ARCHIVE, "system/baselines/archive.yaml");
const GRAPH: FixtureOptions = { fixture: "SR-136/graph" };
const GROUP: FixtureOptions = { fixture: "SR-149/group" };
const MATRIX: FixtureOptions = { fixture: "SR-125/matrix" };
const COPIED: FixtureOptions = { fixture: "SR-088/copied-file" };
/** The same need found twice (SR-088), only its copy approved. */
const COPY_APPROVED: FixtureOptions = {
  fixture: "SR-088/copied-file",
  files: {
    "system/copies/N-00606ccf2661.md":
      "---\nid: 948a10f1-05c3-4212-bd19-00606ccf2661\ntype: need\nstatus: approved\n" +
      "title: Wind speed visible at a glance (copy)\n---\n\nThe wind speed is visible from across the room.\n",
  },
};

/** One input per read command with numbers; the paged ones on their first page of one row. */
const READS: readonly { options: FixtureOptions; root?: string; command: string; input: Output }[] = [
  { options: GRAPH, command: "evidence.degree", input: {} },
  { options: GRAPH, command: "element.list", input: { withVerification: true, group: "status", limit: 1 } },
  { options: GRAPH, command: "element.search", input: { query: "weather", withVerification: true } },
  { options: GRAPH, command: "trace.graph", input: { ref: "N-00a001" } },
  { options: GRAPH, command: "trace.neighbourhood", input: { ref: "N-00a001", limit: 1 } },
  {
    options: GRAPH,
    command: "trace.related",
    input: { refs: ["N-00a001"], direction: "children", limit: 1 },
  },
  { options: GRAPH, command: "trace.affected", input: { ref: "N-00a001", limit: 1 } },
  { options: GRAPH, command: "evidence.status", input: { limit: 1 } },
  { options: GRAPH, command: "evidence.withoutPassedTest", input: { limit: 1 } },
  { options: GRAPH, command: "trace.matrix", input: { limit: 1 } },
  { options: GRAPH, command: "tool.info", input: {} },
  { options: GRAPH, command: "metamodel.get", input: {} },
  { options: GRAPH, command: "workspace.check", input: {} },
  { options: GROUP, command: "element.list", input: { group: "package", limit: 1 } },
  { options: GROUP, command: "element.search", input: { query: "wind", group: "package", limit: 1 } },
  { options: MATRIX, command: "trace.matrix", input: { kinds: ["derives-from", "packages"], limit: 1 } },
  { options: EXPORT, root: "system", command: "trace.matrix", input: { limit: 1 } },
  { options: EXPORT, root: "system", command: "element.facets", input: {} },
  { options: EXPORT, root: "system", command: "evidence.coverage", input: {} },
  { options: EXPORT, root: "system", command: "baseline.get", input: { baseline: "Counts", limit: 1 } },
  { options: EXPORT, root: "system", command: "baseline.get", input: { baseline: "By package" } },
  { options: EXPORT, root: "system", command: "baseline.list", input: {} },
  { options: ARCHIVE, root: "system", command: "baseline.get", input: { baseline: "Archive" } },
  {
    options: EXPORT,
    root: "system",
    command: "baseline.changes",
    input: { baseline: "Counts", limit: 1 },
  },
  { options: EXPORT, root: "system", command: "baseline.changes", input: { baseline: "By package" } },
  { options: ARCHIVE, root: "system", command: "baseline.changes", input: { baseline: "Archive" } },
  { options: GRAPH, command: "baseline.prepare", input: {} },
  { options: NEWEST_COUNTS, root: "system", command: "baseline.prepare", input: {} },
  { options: NEWEST_BY_PACKAGE, root: "system", command: "baseline.prepare", input: {} },
  { options: NEWEST_ARCHIVE, root: "system", command: "baseline.prepare", input: {} },
  { options: COPIED, root: "system", command: "element.list", input: { withVerification: true } },
  {
    options: COPY_APPROVED,
    root: "system",
    command: "evidence.coverage",
    input: { selection: { where: { status: ["approved"] } } },
  },
];

/**
 * Whether the number `value` at `field` (entry `key`) counts something: every page of `element.list` with it
 * gives that many distinct elements, fewer only when incomplete; a paged input on its second page.
 */
const listsCounted = async (
  api: Served,
  command: string,
  input: Output,
  field: string,
  key: readonly Key[],
  value: number,
): Promise<boolean> => {
  const at = `${command} ${field} ${JSON.stringify(key)}`;
  const listed = await listAll(api, {
    output: { command, input: "limit" in input ? { ...input, offset: 1 } : input, count: { field, key } },
  });
  if (listed.incomplete === true) {
    expect(listed.total, at).toBeLessThanOrEqual(value);
    // Only the states of a baseline without an element in the workspace count no element of it at all
    // (`counts.*` of baseline.get, `baseline.counts.*` of the commands that give its numbers).
    if (value > 0 && !/^(baseline\.)?counts\.(missing|inaccessible)$/.test(field)) {
      expect(listed.total, at).toBeGreaterThan(0);
    }
  } else {
    expect(listed.total, at).toBe(value);
  }
  expect(new Set(ids(listed)).size, at).toBe(listed.total);
  return value > 0;
};

describe("numbers of elements in the outputs (SR-224 AK4)", () => {
  it("[SR-224/AK-h9kx] lists through element.list exactly the elements each number of a read command counts, and a write command names them", async () => {
    const servers = new Map<FixtureOptions, Served>();
    const served = async (options: FixtureOptions, root?: string): Promise<Served> => {
      const known = servers.get(options) ?? (await serve(options, root));
      servers.set(options, known);
      return known;
    };
    const catalog = await (await served(GRAPH)).catalog();
    const fieldsOf = (name: string): readonly Field[] =>
      catalog.find((entry) => entry.name === name)?.outputFields ?? [];

    // Every read command with a number has an input in the table; each number has an instance that counts.
    const walked = new Set<string>();
    const counting = new Set<string>();
    for (const { options, root, command, input } of READS) {
      const api = await served(options, root);
      const output = await api.run(command, input);
      for (const field of fieldsOf(command).filter(isNumber)) {
        walked.add(`${command} ${field.path}`);
        const instances = instancesAt(output, field);
        // The key names one entry of each list (repeated rows of a grouped list name the same element).
        const keys = instances.map(({ key }) => JSON.stringify(key));
        if (!(field.path.startsWith("rowVerification") && "group" in input)) {
          expect(new Set(keys).size, `${command} ${field.path}`).toBe(keys.length);
        }
        for (const { key, value } of instances) {
          if (await listsCounted(api, command, input, field.path, key, value as number)) {
            counting.add(`${command} ${field.path}`);
          }
        }
      }
    }
    const marked = catalog
      .filter((entry) => entry.effect === "read")
      .flatMap((entry) => entry.outputFields.filter(isNumber).map((f) => `${entry.name} ${f.path}`));
    expect(marked.filter((name) => !walked.has(name))).toEqual([]);
    // No need of the fixtures has an indirectly verified child.
    expect(marked.filter((name) => !counting.has(name) && !name.endsWith("counts.indirect"))).toEqual([]);

    // The same elements as an independent path gives them: a degree and `where` on the status in its view.
    const graph = await served(GRAPH);
    for (const status of ["open", "verified", "failed", "outdated"]) {
      const counted = await listAll(graph, {
        output: { command: "evidence.degree", input: {}, count: { field: `degree.counts.${status}` } },
      });
      const where = await listAll(graph, {
        where: { all: [{ verification: [status] }, { invalid: false }] },
      });
      expect(ids(counted), status).toEqual(ids(where));
    }
    // A group of a list, and the types and statuses of the facets, and `where`.
    const groups = await graph.run("element.list", { group: "status" });
    for (const { value } of groups["groups"] as readonly { value: string }[]) {
      const counted = await listAll(graph, {
        output: {
          command: "element.list",
          input: { group: "status" },
          count: { field: "groups[].count", key: [{ value }] },
        },
      });
      expect(ids(counted)).toEqual(ids(await listAll(graph, { where: { status: [value] } })));
    }
    const exported = await served(EXPORT, "system");
    const facets = await exported.run("element.facets", {});
    for (const [list, condition] of [
      ["types", (key: string) => ({ type: [key], subtypes: false })],
      ["statuses", (key: string) => ({ status: [key] })],
    ] as const) {
      for (const { key } of facets[list] as readonly { key: string }[]) {
        const counted = await listAll(exported, {
          output: {
            command: "element.facets",
            input: {},
            count: { field: `${list}[].count`, key: [{ key }] },
          },
        });
        expect(ids(counted), `${list} ${key}`).toEqual(
          ids(await listAll(exported, { where: condition(key) })),
        );
      }
    }
    // A state of a baseline and its entries in that state; missing and inaccessible ones are not in the store.
    const baseline = await exported.run("baseline.get", { baseline: "Counts" });
    for (const state of ["unchanged", "changed", "superseded", "removed", "missing", "inaccessible"]) {
      const counted = await listAll(exported, {
        output: {
          command: "baseline.get",
          input: { baseline: "Counts" },
          count: { field: `counts.${state}` },
        },
      });
      const entries = (baseline["elements"] as readonly { id: string; repository: string; state: string }[])
        .filter((entry) => entry.state === state && state !== "missing" && state !== "inaccessible")
        .map((entry) => `${entry.repository} ${entry.id}`)
        .sort();
      const listed = counted.elements.map((e) => `${e.repository} ${e.id}`).sort();
      expect([listed, counted.incomplete === true], state).toEqual([entries, state === "missing"]);
    }

    // A write command names the elements of its numbers itself: on committed Git repositories (a baseline
    // needs their commits), a ReqIF file it writes, and a change checked against the file's check value.
    const filter = await serve({ fixture: "SR-069/filter" });
    const P = "69069069-0000-4000-8000-0000000000";
    const statements = await serve({ fixture: "SR-058/statements" });
    const committed = await serve({ ...EXPORT, git: ["system", "sensor"] }, "system");
    const before = await filter.run("element.get", { ref: `${P}a1` });
    const writes: [Served, string, Output][] = [
      [
        filter,
        "element.update",
        { ref: `${P}a1`, text: "Changed.", expectedFileSha256: before["fileSha256"] },
      ],
      [
        filter,
        "element.bulkUpdate",
        {
          selection: { ids: [`${P}b1`, `${P}b2`, `${P}b3`] },
          property: "packages",
          operation: "add",
          value: [{ id: `${P}d2` }],
          confirm: true,
        },
      ],
      [committed, "baseline.create", { name: "Written", selection: { package: `${X}d1` } }],
      [statements, "reqif.export", { output: "out.reqif", mapping: "reqif/kunde-a.yaml", statements: true }],
    ];
    for (const [api, command, input] of writes) {
      const output = await api.run(command, input);
      const numbers = fieldsOf(command).filter((f) => Array.isArray(f.elements));
      let counted = 0;
      for (const field of numbers) {
        for (const { value } of instancesAt(output, field)) {
          counted += value as number;
          const named = (field.elements as readonly string[]).flatMap((list) =>
            instancesAt(output, { path: list }).flatMap(({ value: v }) => v as readonly unknown[]),
          );
          expect([command, field.path, named.length]).toEqual([command, field.path, value]);
        }
      }
      expect(counted, command).toBeGreaterThan(0);
    }
  });
});
