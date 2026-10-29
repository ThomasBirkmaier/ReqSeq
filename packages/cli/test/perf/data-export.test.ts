// SR-061 and #277 in the performance suite (ADR-0011): `data.export` of the generated workspace of
// N-036 (50,000 elements, 200,000 relations) with the evidence records a project of that size keeps
// (`withEvidenceRecords`), through the command line, the local API and the MCP server. The JSON is
// larger than one string can hold (about 0.55 GB compact, V8 holds at most about 512 MB in one string),
// so every access writes it in chunks (`jsonChunks`); over MCP it is the `structuredContent` and the
// text content is the note of an output over 32 MiB (ADR-0009). Runs with `pnpm test:perf` after `pnpm build`, nightly and
// on pull requests labelled `perf`, never in the required test run. SR-061 names no time: the rows
// record the time, the peaks of the CLI process's memory (`support/peak-memory.mjs`, default heap
// flags) and the bytes; the tagged tests assert that the JSON is delivered: exit code 0 or status 200,
// the byte count of `JSON.stringify` (indent 2 on the command line, compact over the API, each with a
// line break) of an export of the same state made here (its `generated` has the same length), and the
// frame of the export (start and end). The content itself is not compared: the time of a call is in
// its `generated`, and the unit and cross-access tests compare the text.
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startApiServer } from "@logreq/api";
import { MAX_TEXT_BYTES, largeOutputNote } from "@logreq/mcp";
import type { CommandOutput, VersionValue } from "@logreq/core";
import { Workspace, computeVersion, invoke, jsonByteLength, jsonChunks } from "@logreq/core";
import type { VersionFunction } from "@logreq/testkit";
import {
  createFixtureWorkspace,
  defaultStandardModelFile,
  generateLargeWorkspace,
  measure,
  recordValue,
  withEvidenceRecords,
  writeLargeWorkspace,
} from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bin, blockNetwork, cliEnv, requireBuiltCli } from "../support/logreq.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
const MB = 1e6;

type Metamodel = CommandOutput<"metamodel.get">;

/** The standard model as `metamodel.get` gives it for a workspace with the generator's model file. */
const standardModel = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({
    files: {
      "logreq-workspace.yaml":
        'logreq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
      "metamodel/standard-model.yaml": await fsp.readFile(defaultStandardModelFile, "utf8"),
    },
  });
  const workspace = new Workspace(fixture.root);
  try {
    return (await invoke("metamodel.get", {}, { workspace })) as Metamodel;
  } finally {
    await workspace.close();
    await fixture.cleanup();
  }
};

/** Core's version (ADR-0005) for the generator, from the effective properties of each type. */
const versionOf =
  (metamodel: Metamodel): VersionFunction =>
  ({ type, text, properties }) => {
    const keys = new Set(metamodel.types.find((t) => t.key === type)?.properties ?? []);
    return computeVersion({
      text,
      properties: properties as Readonly<Record<string, VersionValue>>,
      definitions: metamodel.properties
        .filter((p) => keys.has(p.key))
        .map((p) => ({
          key: p.key,
          kind: p.kind,
          ...(p.content === undefined ? {} : { content: p.content }),
        })),
      files: [],
    });
  };

/** The peaks `support/peak-memory.mjs` wrote. */
interface PeakMemory {
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly maxRss: number;
}

const peakMemoryPreload = pathToFileURL(
  path.join(import.meta.dirname, "..", "support", "peak-memory.mjs"),
).href;

/** The first and the last bytes of a file. */
const edges = async (file: string, length: number): Promise<{ head: string; tail: string }> => {
  const handle = await fsp.open(file, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(length);
    const tail = Buffer.alloc(length);
    await handle.read(head, 0, length, 0);
    await handle.read(tail, 0, length, size - length);
    return { head: head.toString("utf8"), tail: tail.toString("utf8") };
  } finally {
    await handle.close();
  }
};

/** `logreq <args>` with stdout into `file` (the output may not fit into one string), stderr collected. */
const logreqToFile = (
  args: readonly string[],
  cwd: string,
  file: string,
  env: Readonly<Record<string, string>>,
): Promise<{ code: number | null; stderr: string }> =>
  new Promise((resolve, reject) => {
    const out = fs.openSync(file, "w");
    const child = spawn(process.execPath, ["--import", blockNetwork, bin, ...args], {
      cwd,
      stdio: ["ignore", out, "pipe"],
      env: { ...cliEnv(), ...env },
    });
    const err: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      fs.closeSync(out);
      resolve({ code, stderr: Buffer.concat(err).toString("utf8") });
    });
  });

/** One answer line of `logreq mcp`: its bytes, its first bytes and its last bytes. */
interface McpLine {
  readonly bytes: number;
  readonly head: string;
  readonly tail: string;
}

/**
 * `logreq mcp` in `cwd`: initialize, then one `tools/call` of `tool`. The answer line is scanned by
 * bytes, never held as one string. Resolves when the server exited after its standard input ended.
 */
const mcpCall = (
  tool: string,
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<{ code: number | null; stderr: string; answer: McpLine }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", blockNetwork, bin, "mcp"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...cliEnv(), ...env },
    });
    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const err: Buffer[] = [];
    let line = 0;
    let bytes = 0;
    let head: Buffer = Buffer.alloc(0);
    let tail: Buffer = Buffer.alloc(0);
    let answer: McpLine | undefined;
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.stdout.on("data", (data: Buffer) => {
      let rest = data;
      while (rest.length > 0) {
        const end = rest.indexOf(10);
        const piece = end === -1 ? rest : rest.subarray(0, end);
        bytes += piece.length;
        if (head.length < 4096) {
          head = Buffer.concat([head, piece.subarray(0, 4096 - head.length)]);
        }
        tail = Buffer.concat([tail, piece]).subarray(-64);
        if (end === -1) {
          return;
        }
        line += 1;
        if (line === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: {} } });
        } else {
          answer = { bytes, head: head.toString("utf8"), tail: tail.toString("utf8") };
          child.stdin.end();
        }
        bytes = 0;
        head = Buffer.alloc(0);
        tail = Buffer.alloc(0);
        rest = rest.subarray(end + 1);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (answer === undefined) {
        reject(new Error(`no answer from logreq mcp: ${Buffer.concat(err).toString("utf8")}`));
        return;
      }
      resolve({ code, stderr: Buffer.concat(err).toString("utf8"), answer });
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "perf", version: "1" } },
    });
  });

describe("data.export with 50,000 elements and their records (SR-061, N-036, #277)", () => {
  let root = "";
  let cleanup: (() => Promise<void>) | undefined;
  let scratch = "";
  /** UTF-8 bytes of the export made here: compact, and with indent 2. */
  let compactBytes = 0;
  let indentedBytes = 0;

  beforeAll(async () => {
    requireBuiltCli("pnpm test:perf");
    const version = versionOf(await standardModel());
    const generated = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    // Only what the tests need after the setup, so the generated tree can be collected.
    const fixture = await writeLargeWorkspace(withEvidenceRecords(generated).workspace);
    root = fixture.workspaceRoot;
    cleanup = fixture.cleanup;
    scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "logreq-sr-061-"));
    const workspace = new Workspace(root);
    try {
      const data = await invoke("data.export", {}, { workspace });
      compactBytes = jsonByteLength(data);
      for (const chunk of jsonChunks(data, { indent: 2 })) {
        indentedBytes += Buffer.byteLength(chunk);
      }
    } finally {
      await workspace.close();
    }
  }, 1_800_000);

  afterAll(async () => {
    await cleanup?.();
    if (scratch !== "") {
      await fsp.rm(scratch, { recursive: true, force: true });
    }
  });

  it("[SR-061/AK1] gives the data of every element as JSON on the command line at N-036 (data export --json)", async () => {
    const file = path.join(scratch, "export.json");
    const memoryFile = path.join(scratch, "memory.json");
    const env = {
      LOGREQ_PEAK_MEMORY: memoryFile,
      NODE_OPTIONS: `${process.env["NODE_OPTIONS"] ?? ""} --import=${peakMemoryPreload}`.trim(),
    };
    const { result: run } = await measure(
      "logreq data export --json at N-036 into a file (new CLI process, written in chunks)",
      () => logreqToFile(["data", "export", "--json"], root, file, env),
      {
        basis: "SR-061 AK1, #277 (command line, from process start to exit; recorded, no limit in the spec)",
      },
    );
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const { size } = await fsp.stat(file);
    expect(size).toBe(indentedBytes + 1);
    const { head, tail } = await edges(file, 21);
    expect(head).toBe('{\n  "logreq-data": 1,');
    expect(tail.endsWith("\n}\n")).toBe(true);
    const peak = JSON.parse(await fsp.readFile(memoryFile, "utf8")) as PeakMemory;
    await recordValue(
      `logreq data export --json at N-036: ${(size / MB).toFixed(0)} MB (compact ${(compactBytes / MB).toFixed(0)} MB); CLI process peak heap in use ${(peak.heapUsed / MB).toFixed(0)} MB (sampled), heap reserved ${(peak.heapTotal / MB).toFixed(0)} MB, resident memory ${(peak.maxRss / MB).toFixed(0)} MB`,
      0,
      { basis: "SR-061 AK1, #277 (recorded)" },
    );
  }, 1_800_000);

  it("[SR-061/AK1] gives the data of every element as JSON over the API at N-036 (streamed)", async () => {
    const workspace = new Workspace(root);
    const server = await startApiServer({ workspace, cacheFolder: scratch });
    try {
      const { token } = JSON.parse(await fsp.readFile(server.endpointFile, "utf8")) as { token: string };
      const post = (): Promise<{ status: number | undefined; bytes: number; head: string; tail: string }> =>
        new Promise((resolve, reject) => {
          const req = http.request(
            {
              host: "127.0.0.1",
              port: server.port,
              method: "POST",
              path: "/v1/commands/data.export",
              headers: { authorization: `Bearer ${token}` },
            },
            (res) => {
              let bytes = 0;
              let head = "";
              let last: Buffer = Buffer.alloc(0);
              res.on("data", (chunk: Buffer) => {
                if (bytes === 0) {
                  head = chunk.subarray(0, 17).toString("utf8");
                }
                bytes += chunk.length;
                // The last three bytes, also when the last chunk is only the line break.
                last = Buffer.concat([last, chunk]).subarray(-3);
              });
              res.on("end", () => {
                resolve({ status: res.statusCode, bytes, head, tail: last.subarray(-3).toString("utf8") });
              });
              res.on("error", reject);
            },
          );
          req.on("error", reject);
          req.end("{}");
        });
      const { result: reply } = await measure(
        "POST data.export over the local API at N-036 (streamed)",
        post,
        {
          basis: "SR-061 AK1, #277 (local API, request to the last byte; recorded, no limit in the spec)",
        },
      );
      expect(reply.status).toBe(200);
      expect(reply.bytes).toBe(compactBytes + 1);
      expect(reply.head).toBe('{"logreq-data":1,');
      expect(reply.tail.endsWith("}\n")).toBe(true);
      await recordValue(
        `POST data.export over the local API at N-036: ${(reply.bytes / MB).toFixed(0)} MB`,
        0,
        { basis: "SR-061 AK1, #277 (recorded)" },
      );
    } finally {
      await server.close();
      await workspace.close();
    }
  }, 1_800_000);

  it("[SR-061/AK1] gives the data of every element over MCP at N-036 (structuredContent, the text is the note)", async () => {
    const memoryFile = path.join(scratch, "memory-mcp.json");
    const env = {
      LOGREQ_PEAK_MEMORY: memoryFile,
      NODE_OPTIONS: `${process.env["NODE_OPTIONS"] ?? ""} --import=${peakMemoryPreload}`.trim(),
    };
    const { result: run } = await measure(
      "MCP tool call data_export at N-036 (new logreq mcp process, written in chunks)",
      () => mcpCall("data_export", root, env),
      {
        basis:
          "SR-061 AK1, SR-080, #277 (MCP over stdio, from process start to the end of the answer line; recorded, no limit in the spec)",
      },
    );
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const { answer } = run;
    expect(answer.head).toContain(JSON.stringify(largeOutputNote(MAX_TEXT_BYTES)));
    expect(answer.head).toContain('"structuredContent":{"logreq-data":1,');
    expect(answer.tail.endsWith("}")).toBe(true);
    // The structured content is the compact export; the envelope and the note add less than 1 KB.
    expect(answer.bytes).toBeGreaterThan(compactBytes);
    expect(answer.bytes).toBeLessThan(compactBytes + 1024);
    const peak = JSON.parse(await fsp.readFile(memoryFile, "utf8")) as PeakMemory;
    await recordValue(
      `MCP tool call data_export at N-036: answer line ${(answer.bytes / MB).toFixed(0)} MB (structuredContent ${(compactBytes / MB).toFixed(0)} MB, the text is the note); server process peak heap in use ${(peak.heapUsed / MB).toFixed(0)} MB (sampled), heap reserved ${(peak.heapTotal / MB).toFixed(0)} MB, resident memory ${(peak.maxRss / MB).toFixed(0)} MB`,
      0,
      { basis: "SR-061 AK1, SR-080, #277 (recorded)" },
    );
  }, 1_800_000);
});
