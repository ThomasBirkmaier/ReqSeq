// Starts the built app (out/, `pnpm build:electron`) on a fixture workspace for one test, with its own
// cache folder, and the CLI on the same workspace for comparisons (SR-080).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "@playwright/test";

const execFileAsync = promisify(execFile);

/** `fixtures/` of the repository (fixtures/README.md). */
const FIXTURES = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));
/** packages/app: Electron starts its package.json "main" (out/main/index.js). */
const APP_FOLDER = fileURLToPath(new URL("../..", import.meta.url));
/** The built CLI (`pnpm build`). */
const CLI = fileURLToPath(new URL("../../../cli/dist/bin.js", import.meta.url));
/** The Electron binary of this package (`pnpm electron:install`). */
const ELECTRON = createRequire(import.meta.url)("electron") as string;

/**
 * A copy of a case folder of `fixtures/` (`fixture`) or of any workspace folder (`folder`, an absolute
 * path), plus `files` (relative path to content), in a temporary folder.
 */
export type Fixture = ({ readonly fixture: string } | { readonly folder: string }) & {
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
};

/** The copied workspace: its root (links resolved) and how to remove it. */
export interface FixtureWorkspace {
  readonly root: string;
  cleanup(): Promise<void>;
}

const copyFixture = async (source: Fixture): Promise<FixtureWorkspace> => {
  const { files = {} } = source;
  const from = "folder" in source ? source.folder : path.join(FIXTURES, ...source.fixture.split("/"));
  const top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-app-fixture-")));
  const root = path.join(top, "workspace");
  await fs.cp(from, root, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, ...relative.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return { root, cleanup: () => fs.rm(top, { recursive: true, force: true, maxRetries: 3 }) };
};

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly window: Page;
  /** The fixture workspace; undefined when the app started without one. */
  readonly workspace: FixtureWorkspace | undefined;
  /** What the main process wrote to standard error so far (its log). */
  stderr(): string;
  /** Runs the CLI with `--json` on the workspace, with the app's cache folder. */
  cli(
    argv: readonly string[],
  ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  /**
   * The colour scheme the pages see (Playwright emulates `prefers-color-scheme` in the renderer only).
   * Default `light`, as Playwright's; `null` leaves it to the system (Electron's nativeTheme).
   */
  readonly colorScheme?: "light" | "dark" | null;
}

/** Starts the app on a new fixture workspace (`undefined`: without a workspace). */
export const launchApp = async (
  fixture: Fixture | undefined,
  options: LaunchOptions = {},
): Promise<RunningApp> => {
  const workspace = fixture === undefined ? undefined : await copyFixture(fixture);
  // The OS cache folder (model cache, ADR-0008) lies in a temporary folder on every OS.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-app-home-"));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: home,
    LOCALAPPDATA: home,
    LOGREQ_VALIDATE_OUTPUT: "1",
  };
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [APP_FOLDER, ...(workspace === undefined ? [] : ["--workspace", workspace.root])],
    env,
    ...(options.colorScheme === undefined ? {} : { colorScheme: options.colorScheme }),
  });
  let stderr = "";
  app.process().stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const window = await app.firstWindow();
  return {
    app,
    window,
    workspace,
    stderr: () => stderr,
    cli: async (argv) => {
      const args = [
        CLI,
        ...argv,
        "--json",
        ...(workspace === undefined ? [] : ["--workspace", workspace.root]),
      ];
      try {
        const { stdout, stderr: err } = await execFileAsync(process.execPath, args, { env });
        return { code: 0, stdout, stderr: err };
      } catch (error) {
        const failed = error as { code: number; stdout: string; stderr: string };
        return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
      }
    },
    close: async () => {
      await app.close();
      await workspace?.cleanup();
      await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
    },
  };
};
