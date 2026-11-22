// Delivery test of the web UI (SR-249 AK1, ADR-0020, #2308): it unpacks the archive of the system it runs on,
// starts `bin/reqseq ui --no-open` of it in a workspace, and loads the printed address in Chromium, Firefox and
// WebKit. Only the release workflow runs it (`pnpm test:delivery`, REQSEQ_DELIVERY_DIR = the folder with the
// artifacts), on Linux inside a network namespace with loopback only. A test that cannot run here is skipped with
// its reason, never left out.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserType } from "@playwright/test";
import { chromium, firefox, webkit } from "@playwright/test";
import type { DeliveryNames, FixtureWorkspace } from "@reqseq/testkit";
import {
  DELIVERY_SYSTEMS,
  DELIVERY_TARGET,
  createFixtureWorkspace,
  deliveryArtifactName,
  deliveryLayout,
  installDelivery,
} from "@reqseq/testkit";
import { afterAll, describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const names = JSON.parse(
  readFileSync(path.join(repo, "toolchain", "packaging", "names.json"), "utf8"),
) as DeliveryNames;
const { version } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string };
const deliveryDir = process.env["REQSEQ_DELIVERY_DIR"] ?? path.join(repo, "delivery");

const temps: string[] = [];
afterAll(async () => {
  await Promise.all(temps.splice(0).map((f) => fs.rm(f, { recursive: true, force: true, maxRetries: 3 })));
});

/** The address `reqseq ui` prints on its first line once it listens, with the token in the fragment. */
const uiAddress = (child: ChildProcessWithoutNullStreams): Promise<string> =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const match = /^ReqSeq UI on (\S+)$/m.exec(stdout);
      if (match?.[1] !== undefined) {
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => {
      reject(new Error(`reqseq ui exited with ${String(code)}: ${stdout}${stderr}`));
    });
  });

/** Stops `reqseq ui`: a `.cmd` launcher runs through a shell on Windows, so its whole tree is ended. */
const stop = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.on("exit", resolve));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)]);
  } else {
    child.kill();
  }
  await exited;
};

/** What went wrong while the page loaded: failed requests, answers of 400 or more, console errors, page errors. */
const loadProblems = async (browserType: BrowserType, address: string): Promise<string[]> => {
  const browser = await browserType.launch();
  const problems: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("requestfailed", (request) => {
      // The event stream is cut when the page closes; that is no failed load.
      if (!request.url().endsWith("/api/events")) {
        problems.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? "?"})`);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        problems.push(`answer ${String(response.status())}: ${response.url()}`);
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        problems.push(`console error: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    const response = await page.goto(address, { waitUntil: "load" });
    expect(response?.status()).toBe(200);
    // The page has loaded the workspace when its overview shows.
    await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor({ timeout: 30_000 });
    await page.close();
  } finally {
    await browser.close();
  }
  return problems;
};

describe.each(DELIVERY_SYSTEMS)("the web UI of the %s delivery", (system) => {
  const target = DELIVERY_TARGET[system];
  const artifact = path.join(deliveryDir, deliveryArtifactName(names, system, version));
  const runnable =
    existsSync(artifact) && process.platform === target.platform && process.arch === target.cpu;

  it(`[SR-249/AK-wsy4] after unpacking the ${system} delivery, reqseq ui answers and its page loads in Chromium, Firefox and WebKit without a failed request or console error`, async (ctx) => {
    if (!runnable) {
      ctx.skip(
        existsSync(artifact)
          ? `needs ${target.platform} on ${target.cpu}`
          : `not built: ${path.basename(artifact)}`,
      );
    }
    const dest = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "delivery-ui-")));
    temps.push(dest);
    const installed = await installDelivery(artifact, dest);
    const ws: FixtureWorkspace = await createFixtureWorkspace({
      fixture: "SR-004/one-repository",
      git: true,
    });
    const launcher = path.join(installed, deliveryLayout(names, system).launcher);
    const home = ws.path("home");
    const shell = process.platform === "win32";
    const child = spawn(shell ? `"${launcher}"` : launcher, ["ui", "--no-open"], {
      cwd: ws.root,
      stdio: "pipe",
      shell,
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: home, LOCALAPPDATA: home },
    });
    try {
      const address = await uiAddress(child);
      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=/);
      for (const browserType of [chromium, firefox, webkit]) {
        expect(await loadProblems(browserType, address), browserType.name()).toEqual([]);
      }
    } finally {
      await stop(child);
      await ws.cleanup();
    }
  });
});
