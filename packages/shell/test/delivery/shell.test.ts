// Delivery tests of the desktop shell (ADR-0021, #2379): they unpack the archive of the system they run on and start
// its shell, the release build without a test driver, and watch it from outside through the operating system's
// process table, open files and connections (processes.ts). Only the release workflow runs them
// (scripts/package/delivery-tests.sh); on Linux in a network namespace with loopback only, on a virtual display. A
// test that cannot run here is skipped with its reason, never left out.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliveryNames, FixtureWorkspace } from "@reqseq/testkit";
import {
  DELIVERY_SYSTEMS,
  DELIVERY_TARGET,
  createFixtureWorkspace,
  deliveryArtifactName,
  deliveryLayout,
  installDelivery,
} from "@reqseq/testkit";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Process } from "./processes.js";
import { connections, descendants, folderAndFiles, processes, waitFor } from "./processes.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const names = JSON.parse(
  readFileSync(path.join(repo, "toolchain", "packaging", "names.json"), "utf8"),
) as DeliveryNames;
const { version } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string };
const deliveryDir = process.env["REQSEQ_DELIVERY_DIR"] ?? path.join(repo, "delivery");

const system = DELIVERY_SYSTEMS.find(
  (s) => DELIVERY_TARGET[s].platform === process.platform && DELIVERY_TARGET[s].cpu === process.arch,
);
const artifact =
  system === undefined ? "" : path.join(deliveryDir, deliveryArtifactName(names, system, version));
const NOT_RUNNABLE =
  system === undefined ? `no delivery for ${process.platform} on ${process.arch}` : `not built: ${artifact}`;
const runnable = system !== undefined && existsSync(artifact);

const temps: string[] = [];
const fixtures: FixtureWorkspace[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

afterAll(async () => {
  await Promise.all(temps.splice(0).map((f) => fs.rm(f, { recursive: true, force: true, maxRetries: 3 })));
});

/** Unpacks the delivery of this system into a new folder; gives its folder. */
const install = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "shell-delivery-")));
  temps.push(folder);
  return installDelivery(artifact, folder);
};

/** The exit code and the standard error of a child, once it ended. */
const ended = (child: ChildProcess): Promise<{ code: number | null; stderr: string }> =>
  new Promise((resolve) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("exit", (code) => {
      resolve({ code, stderr });
    });
  });

/** A path as the operating system names it, so that a short or linked spelling compares equal. */
const real = (file: string): string => {
  try {
    const resolved = realpathSync.native(file);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  } catch {
    return file;
  }
};

/** The UI server of the release in `root`: a process that runs its `lib/dist/bin.js`. */
const serverOf = (all: readonly Process[], cli: string): Process | undefined =>
  all.find((p) => p.args.slice(1).some((arg) => real(arg) === real(cli)));

describe("SR-252: the desktop shell of the delivery", () => {
  it("[SR-252/AK-ws9r] started from a workspace folder with arguments, the shell starts `ui --no-open` of its own release where no workspace is found, and its window keeps a request with the token open", async (ctx) => {
    if (!runnable) {
      ctx.skip(NOT_RUNNABLE);
      return;
    }
    const layout = deliveryLayout(names, system);
    const installed = await install();
    const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
    fixtures.push(ws);
    const node = path.join(installed, layout.runtime);
    const cli = path.join(installed, layout.lib, "dist", "bin.js");
    // A workspace in the start folder and arguments that would name it and a port: the shell takes neither.
    const shell = spawn(
      path.join(installed, layout.shellStart),
      ["--workspace", ws.root, "--port", "4567", ws.root],
      {
        cwd: ws.root,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    children.push(shell);
    const exit = ended(shell);
    const server = await waitFor(
      () => serverOf(descendants(processes(), shell.pid ?? -1), cli),
      60_000,
      "the shell's UI server",
    );
    // The CLI of the same release on its Node, with `ui --no-open` only (no --workspace, no --port, so no browser).
    if (process.platform === "darwin") {
      // ps gives the command line, split at spaces; the unpacked folder has none.
      expect(server.args.join(" ")).toBe(`${node} ${cli} ui --no-open`);
    } else {
      expect(server.args.slice(1)).toEqual([server.args[1], "ui", "--no-open"]);
      expect(real(server.args[0] ?? "")).toBe(real(node));
      expect(real(server.args[1] ?? "")).toBe(real(cli));
    }
    // Where it runs: the root of the file system, so it finds no workspace and opens none of the start folder.
    const seen = folderAndFiles(server.pid);
    if (seen !== undefined) {
      expect(seen.cwd).toBe("/");
      expect(seen.files.filter((file) => file.startsWith(real(ws.root)))).toEqual([]);
    }
    const port = await waitFor(
      () => connections().find((c) => c.pid === server.pid && c.state === "LISTEN")?.localPort,
      30_000,
      "the server's port",
    );
    // The server answers a page request, and refuses an API request without the token.
    const page = await fetch(`http://127.0.0.1:${String(port)}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<html");
    expect((await fetch(`http://127.0.0.1:${String(port)}/api/events`)).status).toBe(401);
    // The window loaded the page and sent the event stream request with the token from the address: the server
    // keeps that stream open, where it closes a connection after a refused request within its keep-alive time of 5 s
    // and the page asks for the stream no more after a refusal (packages/web/src/events.ts).
    const stream = (): number | undefined =>
      connections().find(
        (c) =>
          c.state === "ESTABLISHED" && c.remotePort === port && c.pid !== server.pid && c.pid !== process.pid,
      )?.localPort;
    await waitFor(stream, 60_000, "a connection of the window to the server");
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    expect(stream(), "a connection of the window stays open after 10 s").toBeDefined();
    // Nothing else started below the server: no browser, no opener.
    expect(descendants(processes(), server.pid).map((p) => p.args.join(" "))).toEqual([]);
    // The end: the server goes with the shell.
    shell.kill();
    await exit;
    await waitFor(
      () => (processes().some((p) => p.pid === server.pid) ? undefined : true),
      10_000,
      "the server to end with the shell",
    );
  });

  it("[SR-252/AK-ts68] on a machine where the window cannot open, the shell ends with a code other than 0, an English reason, and no server", async (ctx) => {
    if (!runnable) {
      ctx.skip(NOT_RUNNABLE);
      return;
    }
    if (process.platform !== "linux") {
      ctx.skip("a start without a display is tested on Linux (ADR-0021)");
      return;
    }
    const layout = deliveryLayout(names, system);
    const installed = await install();
    const env = { ...process.env };
    delete env["DISPLAY"];
    delete env["WAYLAND_DISPLAY"];
    const shell = spawn(path.join(installed, layout.shellStart), [], {
      stdio: ["ignore", "ignore", "pipe"],
      env,
    });
    children.push(shell);
    const { code, stderr } = await ended(shell);
    expect(code).not.toBe(0);
    expect(code).not.toBeNull();
    expect(stderr).toMatch(/^ReqSeq: the window could not open/m);
    expect(stderr).toMatch(/^[\x20-\x7e\n]*$/);
    expect(serverOf(processes(), path.join(installed, layout.lib, "dist", "bin.js"))).toBeUndefined();
  });
});
