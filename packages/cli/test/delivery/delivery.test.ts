// Delivery tests of the command line and the MCP server (ADR-0014, ADR-0011, ThomasBirkmaier/ReqSeq-archive#324): they install the built
// artifacts (unpack them) and inspect and run them. Only the release workflow runs them (`pnpm test:delivery`,
// REQSEQ_DELIVERY_DIR = the folder with the artifacts); on Linux inside a network namespace with loopback only,
// as a non-root user. A test that cannot run here is skipped with its reason, never left out.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { commandPagePath } from "@reqseq/core/docs-site";
import { LineTransport } from "@reqseq/mcp";
import MiniSearch from "minisearch";
import type { DeliveryNames, DeliverySystem, FixtureWorkspace } from "@reqseq/testkit";
import {
  DELIVERY_SYSTEMS,
  DELIVERY_TARGET,
  cliTarballName,
  connectProbe,
  createFixtureWorkspace,
  deliveryArtifactName,
  deliveryLayout,
  inspectDelivery,
  installDelivery,
  offlineProblems,
} from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const names = JSON.parse(
  readFileSync(path.join(repo, "toolchain", "packaging", "names.json"), "utf8"),
) as DeliveryNames;
const { version } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string };
const deliveryDir = process.env["REQSEQ_DELIVERY_DIR"] ?? path.join(repo, "delivery");
/** ADR-0015 (SR-111): the renderer bundles them, so the notices must name them. */
const REQUIRED_NOTICES = ["@dagrejs/dagre", "@dagrejs/graphlib"];

/**
 * The tests without network (SR-078 AK2) run on Linux, in the network namespace with loopback only that
 * scripts/package/delivery-tests.sh makes and marks with REQSEQ_DELIVERY_OFFLINE=1. Without it they fail
 * instead of being skipped, and with it the namespace is checked first. macOS and Windows have no namespace.
 */
const NO_NAMESPACE = "no network namespace on this system (installation without network is tested on Linux)";
const assertOffline = async (): Promise<void> => {
  expect(
    process.env["REQSEQ_DELIVERY_OFFLINE"],
    "REQSEQ_DELIVERY_OFFLINE is not set: run the suite with scripts/package/delivery-tests.sh",
  ).toBe("1");
  expect(offlineProblems(Object.keys(os.networkInterfaces()), await connectProbe("1.1.1.1", 443))).toEqual(
    [],
  );
};

const temps: string[] = [];
const fixtures: FixtureWorkspace[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

const tempFolder = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "delivery-")));
  temps.push(folder);
  return folder;
};

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

afterAll(async () => {
  await Promise.all(temps.splice(0).map((f) => fs.rm(f, { recursive: true, force: true, maxRetries: 3 })));
});

const exited = (child: ChildProcessWithoutNullStreams): Promise<number | null> =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
    }
    child.on("exit", (code) => {
      resolve(code);
    });
  });

/** The launcher of an installed delivery with `args`, the OS cache folder inside the fixture. */
const launch = (
  launcher: string,
  args: readonly string[],
  ws: FixtureWorkspace,
): ChildProcessWithoutNullStreams => {
  const home = ws.path("home");
  const child = spawn(launcher, args, {
    cwd: ws.root,
    stdio: "pipe",
    // A .cmd file starts only through a shell.
    shell: process.platform === "win32",
    env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: home, LOCALAPPDATA: home },
  });
  children.push(child);
  return child;
};

/** The command line gives the workspace status, and the MCP server answers with the catalog's tools. */
const runCommandLineAndMcp = async (launcher: string): Promise<void> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
  fixtures.push(ws);
  const status = launch(launcher, ["workspace", "status", "--json"], ws);
  let stdout = "";
  status.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  expect(await exited(status)).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ name: "Weather station", readOnly: false });

  const mcp = launch(launcher, ["mcp"], ws);
  const client = new Client({ name: "delivery", version: "1" });
  await client.connect(new LineTransport(mcp.stdout, { write: (text) => mcp.stdin.write(text) }));
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("workspace_status");
  const result = await client.callTool({ name: "workspace_status", arguments: {} });
  expect(result.structuredContent).toMatchObject({ name: "Weather station" });
  mcp.stdin.end();
  expect(await exited(mcp)).toBe(0);
  await client.close();
};

/** Stops a launched server: a `.cmd` launcher runs through a shell on Windows, so its whole tree is ended. */
const stop = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode === null) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)]);
    } else {
      child.kill();
    }
  }
  await exited(child);
};

/** The address `serve docs` prints once it listens. */
const docsAddress = (child: ChildProcessWithoutNullStreams): Promise<string> =>
  new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const match = /documentation on (http:\/\/127\.0\.0\.1:\d+\/)/.exec(stdout);
      if (match?.[1] !== undefined) {
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => {
      reject(new Error(`serve docs exited with ${String(code)}: ${stdout}`));
    });
  });

/** The search index of the site, as packages/docs/src/search-index.ts writes it. */
interface SearchIndexFile {
  readonly fields: string[];
  readonly storeFields: string[];
  readonly searchOptions: { prefix: boolean; fuzzy: number; boost: Record<string, number> };
  readonly index: unknown;
}

/** The `<title>` of an HTML page. */
const titleOf = (html: string): string | undefined => /<title>([^<]*)<\/title>/.exec(html)?.[1];

/**
 * The documentation of an installed delivery (SR-141 AK1): `serve docs` of its launcher serves the start page and a
 * command page with the version of `tool info` in their titles, with the CSP and nosniff, and its search index,
 * searched with MiniSearch as the site's search box does, finds pages that the server then serves.
 */
const serveDocsAndSearch = async (launcher: string, docs: string): Promise<void> => {
  const info = await toolInfo(launcher);
  const title = `${names.productName} ${String(info["versions"]?.["cli"])}`;
  expect(info["versions"]?.["cli"]).toBe(version);
  const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
  fixtures.push(ws);
  const server = launch(launcher, ["serve", "docs"], ws);
  try {
    const url = await docsAddress(server);
    for (const page of ["", commandPagePath("element.get")]) {
      const response = await fetch(new URL(page, url));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(titleOf(await response.text())?.endsWith(`| ${title}`)).toBe(true);
    }
    // The search box's own steps (site/src/components/Search.astro): fetch the index from the site, load it with
    // MiniSearch and its options from the file, search.
    const index = await fetch(new URL("search-index.json", url));
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("application/json; charset=utf-8");
    // The served index is the delivered file.
    const file = (await index.json()) as SearchIndexFile;
    expect(file).toEqual(JSON.parse(readFileSync(path.join(docs, "search-index.json"), "utf8")));
    const search = MiniSearch.loadJS(file.index as Parameters<typeof MiniSearch.loadJS>[0], {
      fields: file.fields,
      storeFields: file.storeFields,
    });
    const results = search.search("baseline", file.searchOptions);
    expect(results.length).toBeGreaterThan(0);
    const hit = new URL(String(results[0]?.["url"]), url).href;
    expect(hit.startsWith(url)).toBe(true);
    const page = await fetch(hit);
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(titleOf(text)).toContain(title);
    expect(text.toLowerCase()).toContain("baseline");
  } finally {
    await stop(server);
  }
};

/** `tool info --json` of an installed delivery: the info of this delivery (SR-161 AK4). */
const toolInfo = async (launcher: string): Promise<Record<string, Record<string, unknown>>> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
  fixtures.push(ws);
  const info = launch(launcher, ["tool", "info", "--json"], ws);
  let stdout = "";
  info.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  expect(await exited(info)).toBe(0);
  return JSON.parse(stdout) as Record<string, Record<string, unknown>>;
};

describe.each(DELIVERY_SYSTEMS)("the %s delivery", (system: DeliverySystem) => {
  const target = DELIVERY_TARGET[system];
  const artifact = path.join(deliveryDir, deliveryArtifactName(names, system, version));
  const built = existsSync(artifact);
  const notBuilt = `not built: ${path.basename(artifact)}`;
  const runnable = built && process.platform === target.platform && process.arch === target.cpu;
  const notRunnable = built ? `needs ${target.platform} on ${target.cpu}` : notBuilt;
  const layout = deliveryLayout(names, system);
  let installed = "";

  beforeAll(async () => {
    if (built) {
      installed = await installDelivery(artifact, await tempFolder(), names);
    }
  });

  it(`[SR-076/AK-z5f8] the ${system} delivery contains the app, the launcher, the command line and the MCP server`, async (ctx) => {
    if (!built) {
      ctx.skip(notBuilt);
    }
    expect(await inspectDelivery(installed, names, system, REQUIRED_NOTICES)).toEqual([]);
    if (system === "mac" && process.platform === "darwin") {
      // An ad-hoc signature that does not verify makes macOS call the app damaged (ADR-0014).
      const app = path.join(installed, `${names.productName}.app`);
      const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", app], { encoding: "utf8" });
      expect(verify.stderr).toBe("");
      expect(verify.status).toBe(0);
    }
  });

  it(`[SR-076/AK-z5f8] the launcher of the ${system} delivery runs the command line and the MCP server`, async (ctx) => {
    if (!runnable) {
      ctx.skip(notRunnable);
    }
    await runCommandLineAndMcp(path.join(installed, layout.launcher));
  });

  it(`[SR-161/AK-x2b3] tool info of the ${system} delivery shows the version and the commit of this delivery`, async (ctx) => {
    if (!runnable) {
      ctx.skip(notRunnable);
    }
    const info = await toolInfo(path.join(installed, layout.launcher));
    expect(info["versions"]).toEqual({ app: version, cli: version, mcp: version });
    expect(info["build"]?.["development"]).toBeUndefined();
    expect(info["build"]?.["commit"]).toMatch(/^[0-9a-f]{40}$/);
    if (process.env["GITHUB_SHA"] !== undefined) {
      expect(info["build"]?.["commit"]).toBe(process.env["GITHUB_SHA"]);
    }
    // The command line runs on the Electron of the delivery (ADR-0014), as the app does.
    expect(info["runtime"]?.["electron"]).toBeDefined();
  });

  it(`[SR-078/AK-n50j] the ${system} delivery installs without network and its command line and MCP server run`, async (ctx) => {
    if (!runnable) {
      ctx.skip(notRunnable);
    }
    if (process.platform !== "linux") {
      ctx.skip(NO_NAMESPACE);
    }
    await assertOffline();
    // The installation happens here, inside the namespace without network.
    const fresh = await installDelivery(artifact, await tempFolder(), names);
    await runCommandLineAndMcp(path.join(fresh, layout.launcher));
  });

  it(`[SR-141/AK-k4fs] the ${system} delivery serves its documentation without network: pages and search hits of its version`, async (ctx) => {
    if (!runnable) {
      ctx.skip(notRunnable);
    }
    // Linux checks the namespace with loopback only; macOS and Windows have none and run it as it is.
    if (process.platform === "linux") {
      await assertOffline();
    }
    await serveDocsAndSearch(path.join(installed, layout.launcher), path.join(installed, layout.docs));
  });
});

describe("the CLI tarball", () => {
  const tarball = path.join(deliveryDir, cliTarballName(names, version));

  /** Installs the tarball without network into a new prefix (npm never asks the registry); gives the prefix. */
  const installTarball = async (): Promise<string> => {
    const prefix = await tempFolder();
    await promisify(execFile)("npm", [
      "install",
      "--global",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--cache",
      path.join(prefix, "cache"),
      "--prefix",
      prefix,
      tarball,
    ]);
    return prefix;
  };

  it("[SR-078/AK-n50j] the CLI tarball installs without network and runs on Node", async (ctx) => {
    if (!existsSync(tarball)) {
      ctx.skip(`not built: ${path.basename(tarball)}`);
    }
    if (process.platform !== "linux") {
      ctx.skip(NO_NAMESPACE);
    }
    await assertOffline();
    // The dependencies are inside the tarball.
    const prefix = await installTarball();
    await runCommandLineAndMcp(path.join(prefix, "bin", names.launcher));
  });

  it("[SR-141/AK-k4fs] the CLI tarball serves its documentation without network: pages and search hits of its version", async (ctx) => {
    if (!existsSync(tarball)) {
      ctx.skip(`not built: ${path.basename(tarball)}`);
    }
    if (process.platform !== "linux") {
      ctx.skip(NO_NAMESPACE);
    }
    await assertOffline();
    const prefix = await installTarball();
    const docs = path.join(prefix, "lib", "node_modules", ...`${names.packageScope}cli`.split("/"), "docs");
    await serveDocsAndSearch(path.join(prefix, "bin", names.launcher), docs);
  });
});
