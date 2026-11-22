// The test starter of the web UI (ADR-0020, Tests; not shipped): a generated workspace in a temporary folder and
// the UI server of `reqseq ui` on it, with the pages of `dist/` (`pnpm --filter @reqseq/web build`). The tests
// read what they expect through core's `invoke` on the same folder, never through the page.
import path from "node:path";
import type { UiServer } from "@reqseq/api";
import { createUiServer } from "@reqseq/api";
import type { CommandTypes } from "@reqseq/core";
import { Workspace, invoke } from "@reqseq/core";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";

/** The built pages. */
export const PAGES = path.join(import.meta.dirname, "..", "dist");

/** The workspaces the tests run on; each Playwright project takes one. */
export type WorkspaceKind = "spec";

/** A copy of `spec/` of this repository: a large workspace with every type of the standard model. */
const createSpecCopy = (): Promise<FixtureWorkspace> =>
  createFixtureWorkspace({ fixturesDir: path.join(import.meta.dirname, "..", "..", ".."), fixture: "spec" });

const CREATE: Readonly<Record<WorkspaceKind, () => Promise<FixtureWorkspace>>> = { spec: createSpecCopy };

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
