// Delivery test of the app (ADR-0014, ADR-0011, #324): installs the built artifact of this system (unpacks it)
// and starts the packaged app on a fixture workspace. Only the release workflow runs it (`pnpm test:delivery`);
// on Linux under xvfb, in a network namespace with loopback only, as a non-root user with Chromium's sandbox on.
// The packaged app has Node's inspect arguments switched off (fuse), so Playwright cannot launch it; the test
// connects through Chromium's DevTools port instead.
// It also loads a generated workspace above the read pool's threshold, so the core process (a utility process)
// starts the read workers of the cold load from `read-worker.js` inside `app.asar` (ADR-0008, ADR-0014, #142).
import type { ChildProcess } from "node:child_process";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRecentWorkspaces } from "@reqseq/core/recent-workspaces";
import type { DeliveryNames, DeliverySystem } from "@reqseq/testkit";
import {
  DELIVERY_SYSTEMS,
  DELIVERY_TARGET,
  connectProbe,
  deliveryArtifactName,
  deliveryLayout,
  generateLargeWorkspace,
  installDelivery,
  offlineProblems,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import type { Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const names = JSON.parse(
  readFileSync(path.join(repo, "toolchain", "packaging", "names.json"), "utf8"),
) as DeliveryNames;
const { version } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string };
const deliveryDir = process.env["REQSEQ_DELIVERY_DIR"] ?? path.join(repo, "delivery");
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
/** Chromium refuses to run as root without turning its sandbox off, which ReqSeq never does (ADR-0014). */
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
 * The documented one-time admin step on Linux (docs/guide/how-to/install-reqseq.md), where the system needs it:
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

/** How a start was seen, and what the app wrote to standard error until then. */
interface Started {
  readonly seen: string;
  readonly stderr: string;
}

interface StartOptions {
  /** The workspace to open (default: a copy of the fixture `SR-004/one-repository`). */
  readonly workspace?: (top: string) => Promise<string>;
  /** More environment of the app. */
  readonly env?: Readonly<Record<string, string>>;
  /** Checks the window once its overview shows (only when the DevTools port opened). */
  readonly check?: (page: Page) => Promise<void>;
}

const fixtureCopy = async (top: string): Promise<string> => {
  const workspace = path.join(top, "workspace");
  await fs.cp(path.join(repo, "fixtures", "SR-004", "one-repository"), workspace, { recursive: true });
  return workspace;
};

/**
 * Starts the installed app on a workspace with its own home, cache and user data folders (never the real
 * user's) and gives how it was seen started: the overview of the workspace through the DevTools port, or,
 * when no port opens, the workspace in the recent list the app writes on opening.
 */
const startApp = async (
  installed: string,
  system: DeliverySystem,
  options: StartOptions = {},
): Promise<Started> => {
  const top = await tempFolder();
  const workspace = await (options.workspace ?? fixtureCopy)(top);
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
    ...options.env,
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
      if (page !== undefined) {
        await options.check?.(page);
      }
    } finally {
      await browser.close();
    }
    return { seen: "seen through the DevTools port: the overview of the workspace", stderr };
  }
  // Fallback: the app runs and has opened the workspace (SR-131 list, in the test's own cache folder).
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  expect(app.exitCode, `the app ended: ${stderr}`).toBeNull();
  const recent = await readRecentWorkspaces({ platform: process.platform, env, home });
  expect(recent.map((r) => r.root)).toContain(await fs.realpath(workspace));
  return { seen: "seen through the recent workspaces: the app runs and opened the workspace", stderr };
};

/** More element files than the read pool's threshold of 1,000 (ADR-0008), as in the CLI's e2e test. */
const ELEMENTS = 1_200;

/**
 * Node's own trace of a worker thread (`NODE_DEBUG=worker`), written by the new thread itself
 * (`lib/internal/main/worker_thread.js`) before it loads its script: the read worker of core inside the app's
 * asar archive. It shows where the worker started from, not that it ran; the overview counts show that.
 */
const ASAR_READ_WORKER =
  /starts worker script .*app\.asar[\\/]node_modules[\\/]@reqseq[\\/]core[\\/]dist[\\/]model[\\/]read-worker\.js/g;

/** A workspace of `ELEMENTS` generated element files in `top`; the versions do not matter to a load. */
const largeWorkspace = async (top: string): Promise<string> => {
  const generated = generateLargeWorkspace({
    version: () => "n1:0000000000000000",
    elements: ELEMENTS,
    relations: ELEMENTS * 2,
  });
  return (await writeLargeWorkspace(generated, { tempDir: top })).workspaceRoot;
};

/** The counts of the overview's type lines, added up: every element of the workspace has one type. */
const overviewTotal = async (page: Page): Promise<number> => {
  const counts = await page.locator(".overview .line.type .count").allTextContents();
  return counts.reduce((sum, count) => sum + Number(count), 0);
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

  /**
   * Installs (unpacks, and on Linux the admin step if needed) and starts the app; gives how it was seen (with
   * the sandbox on Linux) and what it wrote to standard error.
   */
  const installAndStart = async (options: StartOptions = {}): Promise<Started> => {
    const installed = await installDelivery(artifact, await tempFolder(), names);
    const sandbox = system === "linux" ? `; ${await prepareSandbox(installed)}` : "";
    const started = await startApp(installed, system, options);
    return { seen: `${started.seen}${sandbox}`, stderr: started.stderr };
  };

  it(`[SR-076/AK1] the app of the ${system} delivery starts after unpacking`, async (ctx) => {
    if (reason !== undefined) {
      ctx.skip(reason);
    }
    // The record says which way the start was seen (verification/SR-076.md).
    await ctx.annotate((await installAndStart()).seen);
  }, 120_000);

  it(`[SR-078/AK2] the ${system} delivery installs without network and its app starts`, async (ctx) => {
    if (reason !== undefined) {
      ctx.skip(reason);
    }
    if (process.platform !== "linux") {
      ctx.skip(NO_NAMESPACE);
    }
    await assertOffline();
    await ctx.annotate((await installAndStart()).seen);
  }, 120_000);

  it(`the app of the ${system} delivery reads ${String(ELEMENTS)} element files in read workers from app.asar (#142)`, async (ctx) => {
    if (reason !== undefined) {
      ctx.skip(reason);
    }
    let total: number | undefined;
    const { seen, stderr } = await installAndStart({
      workspace: largeWorkspace,
      env: { NODE_DEBUG: "worker" },
      check: async (page) => {
        total = await until(async () => {
          const sum = await overviewTotal(page);
          return sum === ELEMENTS ? sum : undefined;
        }, 60_000);
        total ??= await overviewTotal(page);
      },
    });
    // A worker that cannot run fails the read and leaves the overview without counts; the core process goes
    // on (its warm load drops the failure). So only the counts show that the workers read the files, and they
    // are seen only through the DevTools port: the reference system Linux must open it, elsewhere the test is
    // skipped without it, never passed.
    if (total === undefined && system !== "linux") {
      ctx.skip(`${seen}: the overview counts could not be seen, so the read in the workers is not shown`);
    }
    expect(total, "the overview was not seen through the DevTools port").toBe(ELEMENTS);
    const workers = [...stderr.matchAll(ASAR_READ_WORKER)].length;
    expect(workers, `no read worker started from app.asar:\n${stderr}`).toBeGreaterThan(0);
    await ctx.annotate(
      `${seen}; ${String(workers)} read workers started from app.asar; the overview counts ${String(total)} elements`,
    );
  }, 240_000);
});
