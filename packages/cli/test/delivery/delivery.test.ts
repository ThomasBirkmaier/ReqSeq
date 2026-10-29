// Delivery tests of the command line and the MCP server (ADR-0014, ADR-0011, #324): they install the built
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
import { LineTransport } from "@reqseq/mcp";
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

  it(`[SR-076/AK2] the ${system} delivery contains the app, the launcher, the command line and the MCP server`, async (ctx) => {
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

  it(`[SR-076/AK2] the launcher of the ${system} delivery runs the command line and the MCP server`, async (ctx) => {
    if (!runnable) {
      ctx.skip(notRunnable);
    }
    await runCommandLineAndMcp(path.join(installed, layout.launcher));
  });

  it(`[SR-078/AK2] the ${system} delivery installs without network and its command line and MCP server run`, async (ctx) => {
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
});

describe("the CLI tarball", () => {
  const tarball = path.join(deliveryDir, cliTarballName(names, version));

  it("[SR-078/AK2] the CLI tarball installs without network and runs on Node", async (ctx) => {
    if (!existsSync(tarball)) {
      ctx.skip(`not built: ${path.basename(tarball)}`);
    }
    if (process.platform !== "linux") {
      ctx.skip(NO_NAMESPACE);
    }
    await assertOffline();
    const prefix = await tempFolder();
    // --offline: npm never asks the registry; the dependencies are inside the tarball.
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
    await runCommandLineAndMcp(path.join(prefix, "bin", names.launcher));
  });
});
