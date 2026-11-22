// The test starter of the web UI (ADR-0020, Tests; not shipped): a generated workspace in a temporary folder and
// the UI server of `reqseq ui` on it, with the pages of `dist/` (`pnpm --filter @reqseq/web build`). The tests
// read what they expect through core's `invoke` on the same folder, never through the page.
import path from "node:path";
import type { UiServer } from "@reqseq/api";
import { createUiServer } from "@reqseq/api";
import type { CommandTypes } from "@reqseq/core";
import { Workspace, invoke } from "@reqseq/core";
import type { FixtureWorkspace, RunCommand } from "@reqseq/testkit";
import {
  createNoIdentifierWorkspace,
  createOrbitLabWorkspace,
  createSpecCopyWorkspace,
} from "@reqseq/testkit";

/** The built pages. */
export const PAGES = path.join(import.meta.dirname, "..", "dist");

/**
 * The workspaces the tests run on, each written by the test kit; each Playwright project takes one: a copy of the
 * specification with a generated Git history (`spec`), a workspace with an unusual metamodel (`orbit`), and one
 * without identifiers (`no-identifier`).
 */
export type WorkspaceKind = "spec" | "orbit" | "no-identifier";

/** Runs a catalog command in the workspace at `root`, as the test kit writes its workspaces. */
const runCommand: RunCommand = (root, command, input) =>
  runOn(root)(command as keyof CommandTypes, input as never);

const CREATE: Readonly<Record<WorkspaceKind, () => Promise<FixtureWorkspace>>> = {
  spec: () => createSpecCopyWorkspace({ run: runCommand }),
  orbit: () => createOrbitLabWorkspace({ run: runCommand }),
  "no-identifier": () => createNoIdentifierWorkspace({ run: runCommand }),
};

export const createWorkspace = (kind: WorkspaceKind): Promise<FixtureWorkspace> => CREATE[kind]();

export type Run = <K extends keyof CommandTypes>(
  command: K,
  input?: Partial<CommandTypes[K]["input"]>,
) => Promise<CommandTypes[K]["output"]>;

/** Runs a catalog command on the workspace at `root` in this process, as a fresh `Workspace` reads it. */
export const runOn =
  (root: string): Run =>
  async (command, input = {}) => {
    const workspace = new Workspace(root);
    try {
      return (await invoke(command, input, { workspace })) as never;
    } finally {
      await workspace.close();
    }
  };

/** The UI server on `workspace`, or without one. */
export const startUi = (workspace?: string): Promise<UiServer> =>
  createUiServer({ pages: PAGES, ...(workspace === undefined ? {} : { workspace }) });
