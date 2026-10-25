// SR-060 AK1: a reference from another tool resolved through the command line, the local API and the
// MCP server, each as another tool calls it, gives the element with title, text, status and current
// version (and, with a version, whether it is current, AK2). The cross-access test compares the four
// accesses with each other (SR-080); this one checks the content each of them gives.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { startApiServer } from "@logreq/api";
import { Workspace, createCommandRuntime } from "@logreq/core";
import { LineTransport, serveMcp } from "@logreq/mcp";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { EXIT, runCli } from "../src/index.js";

const runtime = createCommandRuntime();

/** The element "Show wind speed" of fixtures/SR-001/two-elements. */
const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const EXPECTED = {
  id: WIND,
  shortId: "SR-e88fb3",
  title: "Show wind speed",
  text: "The station shows the current wind speed.\n",
  status: "draft",
  version: expect.stringMatching(/^n1:[0-9a-f]{16}$/) as string,
};

interface Resolved {
  readonly element: Record<string, unknown>;
  readonly current: "current" | "outdated" | "unknown" | null;
}

let fixture: FixtureWorkspace;
let home = "";

beforeAll(async () => {
  fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
  // The CLI writes its model cache to the OS cache folder (SR-082): keep it in a temporary folder.
  home = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-resolve-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, home);
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fixture.cleanup();
  await fs.rm(home, { recursive: true, force: true });
});

const open = (): Workspace => {
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The current version as core gives it, to tell `current` "current" from "outdated". */
const currentVersion = async (): Promise<string> => {
  const resolved = (await runtime.invoke(
    "element.resolve",
    { ref: WIND },
    { workspace: open() },
  )) as Resolved;
  return String(resolved.element["version"]);
};

describe("element.resolve from another tool", () => {
  it("[SR-060/AK1] gives title, text, status and current version on the command line", async () => {
    let out = "";
    const code = await runCli({
      argv: ["element", "resolve", "SR-e88fb3", "--version", await currentVersion(), "--json"],
      cwd: fixture.root,
      stdin: Readable.from([]),
      stdout: { write: (t: string) => ((out += t), true) },
      stderr: { write: () => true },
      runtime,
    });
    expect(code).toBe(EXIT.ok);
    const resolved = JSON.parse(out) as Resolved;
    expect(resolved.element).toMatchObject(EXPECTED);
    expect(resolved.current).toBe("current");
  });

  it("dates the current version on the command line with --version-date (D-013)", async () => {
    let out = "";
    const code = await runCli({
      argv: ["element", "resolve", "SR-e88fb3", "--version-date", "--json"],
      cwd: fixture.root,
      stdin: Readable.from([]),
      stdout: { write: (t: string) => ((out += t), true) },
      stderr: { write: () => true },
      runtime,
    });
    expect(code).toBe(EXIT.ok);
    const resolved = JSON.parse(out) as Resolved;
    expect(resolved.element).toMatchObject(EXPECTED);
    // The fixture is no Git repository: Git cannot tell the date (ADR-0005).
    expect(resolved.element["versionDate"]).toBeNull();
    expect(resolved.current).toBeNull();
  });

  it("[SR-060/AK1] gives title, text, status and current version through the local API", async () => {
    const cache = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-resolve-api-"));
    onTestFinished(() => fs.rm(cache, { recursive: true, force: true }));
    const server = await startApiServer({ workspace: open(), runtime, cacheFolder: cache });
    onTestFinished(() => server.close());
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          method: "POST",
          path: "/v1/commands/element.resolve",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        },
        (res) => {
          let text = "";
          res.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
          res.on("end", () => {
            resolve(text);
          });
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ ref: WIND, version: "n1:0000000000000000" }));
    });
    const resolved = JSON.parse(body) as Resolved;
    expect(resolved.element).toMatchObject(EXPECTED);
    expect(resolved.current).toBe("outdated");
  });

  it("[SR-060/AK1] gives title, text, status and current version through the MCP server", async () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const served = serveMcp({
      runtime,
      workspace: open(),
      input: toServer,
      output: { write: (t) => toClient.write(t) },
    });
    const client = new Client({ name: "element-resolve", version: "1" });
    await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
    const result = await client.callTool({ name: "element_resolve", arguments: { ref: "SR-6328cee88fb3" } });
    toServer.end();
    await served;
    await client.close();
    expect(result.isError).not.toBe(true);
    const resolved = result.structuredContent as Resolved;
    expect(resolved.element).toMatchObject(EXPECTED);
    expect(resolved.current).toBeNull();
  });
});
