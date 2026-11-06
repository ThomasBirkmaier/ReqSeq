// The start of ReqSeq over the local API in the performance suite (ADR-0011), on the generated workspace of
// N-036 with 50,000 elements and 200,000 relations: a new process of the built `reqseq serve api` loads the
// workspace before it listens (`warmWorkspace`), so the time from spawn until it answers `workspace.status` is
// the time until ReqSeq is usable over the API. The first start has an empty cache folder; the second starts
// again with the model cache the first start wrote (ADR-0008). Until the app came, these tests stood in for
// SR-082 AK1 and AK2 (ThomasBirkmaier/ReqSeq-archive#127, option 1). Those criteria name the app's start, so their tags moved to the app's
// test (packages/app/test/perf/start.spec.ts, #147); these times are recorded, with the thresholds of
// SR-082 AK1 and AK2 for comparison only. Runs with `pnpm test:perf` after `pnpm build`, nightly and on pull
// requests labelled `perf`, never in the required test run.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { CommandOutput, VersionValue } from "@reqseq/core";
import { MODEL_CACHE_FILE, Workspace, invoke, NORMAL_FORM, versionIn } from "@reqseq/core";
import type { LargeFixtureWorkspace, VersionFunction } from "@reqseq/testkit";
import {
  createFixtureWorkspace,
  defaultStandardModelFile,
  generateLargeWorkspace,
  malformedNoParentHints,
  measure,
  noParentHints,
  withoutNoParent,
  withoutParent,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bin, blockNetwork, cliEnv, requireBuiltCli } from "../support/reqseq.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK1: start with the cache (for comparison). */
const WARM_MS = 3_000;
/** SR-082 AK2: start without the cache (for comparison). */
const COLD_MS = 30_000;
/**
 * The model cache trusts an entry only when its file is older than 2 s before the load that wrote
 * the cache (`RACY_MS`, ADR-0008). The test waits that long after writing the files, as a workspace
 * checked out a while ago is.
 */
const SETTLE_MS = 2_100;

type Metamodel = CommandOutput<"metamodel.get">;

/** The standard model as `metamodel.get` gives it for a workspace with the generator's model file. */
const standardModel = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({
    files: {
      "reqseq-workspace.yaml":
        'reqseq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
      "metamodel/standard-model.yaml": await fs.readFile(defaultStandardModelFile, "utf8"),
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
    return versionIn(
      {
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
      },
      NORMAL_FORM,
    );
  };

interface Endpoint {
  readonly port: number;
  readonly token: string;
  readonly urls: readonly string[];
}

const post = (url: string, token: string, name: string): Promise<{ status: number; body: unknown }> =>
  new Promise((resolve, reject) => {
    const request = http.request(
      `${url}/v1/commands/${name}`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });

interface Started {
  readonly child: ChildProcessWithoutNullStreams;
  /** The `api.json` of the server, in the cache folder of the copy. */
  readonly endpointFile: string;
  readonly endpoint: Endpoint;
  readonly status: { status: number; body: unknown };
}

/** Spawns `reqseq serve api` and resolves once it answered `workspace.status`. */
const startApi = (cwd: string, home: string): Promise<Started> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", blockNetwork, bin, "serve", "api"], {
      cwd,
      stdio: "pipe",
      env: cliEnv(home),
    });
    let out = "";
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
    child.on("exit", (code) => {
      reject(new Error(`reqseq serve api ended with ${String(code)}: ${out}${err}`));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const endpointFile = /^Port and token: (.+)$/m.exec(out)?.[1];
      if (endpointFile !== undefined && out.includes("Stop with Ctrl-C.\n")) {
        void (async () => {
          const endpoint = JSON.parse(await fs.readFile(endpointFile, "utf8")) as Endpoint;
          const status = await post(endpoint.urls[0] ?? "", endpoint.token, "workspace.status");
          resolve({ child, endpointFile, endpoint, status });
        })().catch(reject);
      }
    });
  });

/** Stops a server and waits for its exit; it writes a pending model cache first (`workspace.close`). */
const stop = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null) {
    return;
  }
  // The listener of `startApi` would reject a start that is over by now: it goes first.
  child.removeAllListeners("exit");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
};

/** Waits until `file` exists (the model cache is written in the background after a load). */
const appeared = async (file: string, withinMs: number): Promise<void> => {
  const until = Date.now() + withinMs;
  while (!existsSync(file)) {
    if (Date.now() > until) {
      throw new Error(`${file} did not appear within ${String(withinMs)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe("start with 50,000 elements and 200,000 relations (SR-082, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  /** The generated system requirements without a derivation: each a `trace.no-parent` hint (#659). */
  let orphans = 0;
  let home = "";
  const children: ChildProcessWithoutNullStreams[] = [];

  beforeAll(async () => {
    requireBuiltCli("pnpm test:perf");
    const version = versionOf(await standardModel());
    const tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    orphans = withoutParent(tree.files);
    fixture = await writeLargeWorkspace(tree);
    home = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-082-home-"));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  }, 600_000);

  afterAll(async () => {
    await Promise.all(children.map(stop));
    await fixture?.cleanup();
    if (home !== "") {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  /** The model cache of the copy: next to `api.json` in its cache folder; set by the first start. */
  let modelCache = "";

  /** The store is complete: the check finds only the hints of the requirements without a parent (SR-022 AK6). */
  const expectComplete = (body: unknown): void => {
    const { ok, problems } = body as {
      ok: boolean;
      problems: { code: string; severity?: string; elementId?: string }[];
    };
    expect(ok).toBe(true);
    expect(malformedNoParentHints(problems)).toEqual([]);
    expect(noParentHints(problems)).toHaveLength(orphans);
    expect(withoutNoParent(problems)).toEqual([]);
  };

  /**
   * Starts the API without a cache, checks that the store is complete, waits until the model cache
   * is written and stops the API. Returns the start.
   */
  const coldStart = async (run: () => Promise<Started>): Promise<Started> => {
    const started = await run();
    children.push(started.child);
    expect(started.status.status).toBe(200);
    expect(started.status.body).toMatchObject({ readOnly: false, problems: [] });
    modelCache = path.join(path.dirname(started.endpointFile), MODEL_CACHE_FILE);
    const check = await post(started.endpoint.urls[0] ?? "", started.endpoint.token, "workspace.check");
    expectComplete(check.body);
    await appeared(modelCache, 120_000);
    await stop(started.child);
    return started;
  };

  it("records the start over the API without the cache (SR-082 AK2 asserted in the app)", async () => {
    const root = fixture?.workspaceRoot ?? "";
    await coldStart(async () => {
      const { result } = await measure(
        "reqseq serve api until workspace.status answers (new process, no cache)",
        () => startApi(root, home),
        {
          basis:
            "SR-082 AK2 (start without cache over the API; untagged, threshold for comparison only, #147)",
          thresholdMs: COLD_MS,
        },
      );
      return result;
    });
  }, 600_000);

  it("records the start over the API with the cache (SR-082 AK1 asserted in the app)", async () => {
    const root = fixture?.workspaceRoot ?? "";
    // Run alone (`-t "with the cache"`), the test writes the cache first, as the test without the cache does.
    if (modelCache === "") {
      await coldStart(() => startApi(root, home));
    }
    expect(existsSync(modelCache), `no model cache at ${modelCache}`).toBe(true);
    const written = (await fs.stat(modelCache)).mtimeMs;
    const { result: started } = await measure(
      "reqseq serve api until workspace.status answers (new process, with cache)",
      () => startApi(root, home),
      {
        basis: "SR-082 AK1 (start with cache over the API; untagged, threshold for comparison only, #147)",
        thresholdMs: WARM_MS,
      },
    );
    children.push(started.child);
    expect(started.status.status).toBe(200);
    const check = await post(started.endpoint.urls[0] ?? "", started.endpoint.token, "workspace.check");
    expectComplete(check.body);
    await stop(started.child);
    // Every entry was reused: the start did not write the cache again.
    expect((await fs.stat(modelCache)).mtimeMs).toBe(written);
  }, 600_000);
});
