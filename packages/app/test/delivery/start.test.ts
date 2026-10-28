// Delivery test of the app (ADR-0014, ADR-0011, #324): installs the built artifact of this system (unpacks it)
// and starts the packaged app on a fixture workspace. Only the release workflow runs it (`pnpm test:delivery`);
// on Linux under xvfb, in a network namespace with loopback only, as a non-root user with Chromium's sandbox on.
// The packaged app has Node's inspect arguments switched off (fuse), so Playwright cannot launch it; the test
// connects through Chromium's DevTools port instead.
import type { ChildProcess } from "node:child_process";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRecentWorkspaces } from "@logreq/core/recent-workspaces";
import type { DeliveryNames, DeliverySystem } from "@logreq/testkit";
import {
  DELIVERY_SYSTEMS,
  DELIVERY_TARGET,
  connectProbe,
  deliveryArtifactName,
  deliveryLayout,
  installDelivery,
  offlineProblems,
} from "@logreq/testkit";
import { chromium } from "@playwright/test";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const names = JSON.parse(
  readFileSync(path.join(repo, "toolchain", "packaging", "names.json"), "utf8"),
) as DeliveryNames;
const { version } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string };
const deliveryDir = process.env["LOGREQ_DELIVERY_DIR"] ?? path.join(repo, "delivery");
/**
 * The tests without network (SR-078 AK2) run on Linux, in the network namespace with loopback only that
 * scripts/package/delivery-tests.sh makes and marks with LOGREQ_DELIVERY_OFFLINE=1. Without it they fail
 * instead of being skipped, and with it the namespace is checked first. macOS and Windows have no namespace.
 */
const NO_NAMESPACE = "no network namespace on this system (installation without network is tested on Linux)";
const assertOffline = async (): Promise<void> => {
  expect(
    process.env["LOGREQ_DELIVERY_OFFLINE"],
    "LOGREQ_DELIVERY_OFFLINE is not set: run the suite with scripts/package/delivery-tests.sh",
  ).toBe("1");
  expect(offlineProblems(Object.keys(os.networkInterfaces()), await connectProbe("1.1.1.1", 443))).toEqual(
    [],
  );
};
/** Chromium refuses to run as root without turning its sandbox off, which LogReq never does (ADR-0014). */
const root = process.getuid?.() === 0;

const temps: string[] = [];
const apps: ChildProcess[] = [];

const tempFolder = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "delivery-app-")));
  temps.push(folder);
  return folder;
};

afterEach(async () => {
  for (const app of apps.splice(0)) {
    if (app.exitCode === null && app.signalCode === null) {
      const ended = new Promise((resolve) => app.once("exit", resolve));
      app.kill();
      await ended;
    }
  }
});

// Windows keeps the files of an ended app locked for a moment.
afterAll(async () => {
  await Promise.all(
    temps.splice(0).map((f) => fs.rm(f, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })),
  );
});

const until = async <T>(probe: () => Promise<T | undefined>, ms: number): Promise<T | undefined> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
};

/**
 * Chromium sandboxes the app with user namespaces when the user may create them. Ubuntu 24.04 does not allow
 * it (AppArmor), so there Chromium needs its setuid helper and the documented admin step.
 */
const userNamespaces = (): boolean => spawnSync("unshare", ["-r", "true"]).status === 0;

/**
 * The documented one-time admin step on Linux (docs/delivery/README.md), where the system needs it:
 * `chrome-sandbox` owned by root with mode 4755. Done with `sudo -n`, as an administrator would; never
 * `--no-sandbox`. Gives which sandbox the app uses, for the record.
 */
const prepareSandbox = async (installed: string): Promise<string> => {
  if (userNamespaces()) {
    return "sandbox: user namespaces (no admin step needed here)";
  }
  const helper = path.join(installed, "chrome-sandbox");
  const stat = await fs.stat(helper);
  if (stat.uid !== 0 || (stat.mode & 0o7777) !== 0o4755) {
    execFileSync("sudo", ["-n", "chown", "root:root", helper]);
    execFileSync("sudo", ["-n", "chmod", "4755", helper]);
  }
  return "sandbox: setuid chrome-sandbox (the documented admin step)";
};

/**
 * Starts the installed app on a copy of a fixture with its own home, cache and user data folders (never
 * the real user's) and returns how it was seen started: the overview of the workspace through the
 * DevTools port, or, when no port opens, the workspace in the recent list the app writes on opening.
 */
const startApp = async (installed: string, system: DeliverySystem): Promise<string> => {
  const top = await tempFolder();
  const workspace = path.join(top, "workspace");
  await fs.cp(path.join(repo, "fixtures", "SR-004", "one-repository"), workspace, { recursive: true });
  const home = path.join(top, "home");
  const userData = path.join(home, "user-data");
  await fs.mkdir(userData, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    APPDATA: home,
    LOCALAPPDATA: home,
  };
  const binary = path.join(installed, deliveryLayout(names, system).app);
  const app = spawn(
    binary,
    [`--user-data-dir=${userData}`, "--remote-debugging-port=0", "--workspace", workspace],
    {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  apps.push(app);
  let stderr = "";
  app.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const port = await until(async () => {
    const text = await fs.readFile(path.join(userData, "DevToolsActivePort"), "utf8").catch(() => "");
    return /^\d+/.exec(text)?.[0];
  }, 30_000);
  if (port !== undefined) {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
      const page = await until(
        async () => Promise.resolve(browser.contexts().flatMap((c) => c.pages())[0]),
        30_000,
      );
      expect(page, "the app opened no window").toBeDefined();
      await page?.getByRole("listbox", { name: "Overview" }).waitFor({ timeout: 30_000 });
    } finally {
      await browser.close();
    }
    return "seen through the DevTools port: the overview of the workspace";
  }
  // Fallback: the app runs and has opened the workspace (SR-131 list, in the test's own cache folder).
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  expect(app.exitCode, `the app ended: ${stderr}`).toBeNull();
  const recent = await readRecentWorkspaces({ platform: process.platform, env, home });
  expect(recent.map((r) => r.root)).toContain(await fs.realpath(workspace));
  return "seen through the recent workspaces: the app runs and opened the workspace";
};

describe.each(DELIVERY_SYSTEMS)("the app of the %s delivery", (system: DeliverySystem) => {
  const target = DELIVERY_TARGET[system];
  const artifact = path.join(deliveryDir, deliveryArtifactName(names, system, version));
  const built = existsSync(artifact);
  const reason = !built
    ? `not built: ${path.basename(artifact)}`
    : process.platform !== target.platform || process.arch !== target.cpu
      ? `needs ${target.platform} on ${target.cpu}`
      : root
        ? "runs as root: the app starts only as a normal user with its sandbox on"
        : undefined;

  /** Installs (unpacks, and on Linux the admin step if needed) and starts the app; gives how it was seen. */
  const installAndStart = async (): Promise<string> => {
    const installed = await installDelivery(artifact, await tempFolder(), names);
    const sandbox = system === "linux" ? `; ${await prepareSandbox(installed)}` : "";
    return `${await startApp(installed, system)}${sandbox}`;
  };

  it(`[SR-076/AK1] the app of the ${system} delivery starts after unpacking`, async (ctx) => {
    if (reason !== undefined) {
      ctx.skip(reason);
    }
    // The record says which way the start was seen (verification/SR-076.md).
    await ctx.annotate(await installAndStart());
  }, 120_000);

  it(`[SR-078/AK2] the ${system} delivery installs without network and its app starts`, async (ctx) => {
    if (reason !== undefined) {
      ctx.skip(reason);
    }
    if (process.platform !== "linux") {
      ctx.skip(NO_NAMESPACE);
    }
    await assertOffline();
    await ctx.annotate(await installAndStart());
  }, 120_000);
});
