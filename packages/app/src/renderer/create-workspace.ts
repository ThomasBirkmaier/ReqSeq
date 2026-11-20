// "Create workspace" of the start buffer (SR-225 AK4–AK6): main gives the folder (`chooseCreateFolder` of the
// bridge): the folder without a workspace the window has open, else the one chosen in the system folder dialog, which
// main opens itself, never a workspace above it. In such a folder the command prompt asks only the name, pre-filled
// with the folder's name, and Enter runs `workspace.init` there with the standard model (SR-014 AK1); the window then
// opens the new workspace as after the command prompt's "Create workspace" (SR-226 AK2). A chosen folder that is a
// workspace is opened and named. The command prompt's own "Create workspace" still asks path and name (SR-143).
// Display and order only: what is created, and why it is refused, is core's (ADR-0002).
import type { CommandListing, CreateFolderAnswer } from "../shared/protocol.js";
import type { CatalogContext } from "./catalog-arguments.js";
import { schemaOf } from "./catalog-arguments.js";
import type { Entry } from "./catalog-entry.js";
import { lineOf } from "./catalog-entry.js";
import { show } from "./catalog-preview.js";

/** The catalog command that creates a workspace. */
export const INIT_COMMAND = "workspace.init";

/** What the step says after an empty name (AK5). */
export const NAME_NEEDED = "A name is needed";

/** What the command line says when the chosen folder is itself a workspace, which opened (AK6). */
export const openedExisting = (name: string): string => `Opened the existing workspace ${name}`;

/** The folder of the new workspace, relative to the root the core process opened: that folder itself. */
const HERE = ".";

/**
 * Asks the name of the new workspace in the folder open without one (AK4): pre-filled with `initial`, the folder's
 * name at first. An empty name stays in the step and says that a name is needed, a refusal of core stays there with
 * its reason, and Escape ends the prompt: nothing is created (AK5). Enter creates the workspace there, which the
 * window then opens, and its answer goes to the command line as after the command prompt's "Create workspace".
 */
export const askWorkspaceName = (
  context: CatalogContext,
  command: CommandListing,
  initial: string,
  error?: string,
): void => {
  const entry: Entry = { command, given: [], more: false };
  const { description } = schemaOf(command, "name");
  context.ask({
    label: `${error === undefined ? "" : `${error} · `}${lineOf(entry)} · name:`,
    items: [],
    initial,
    explain: {
      name: "name",
      ...(typeof description === "string" ? { description } : {}),
      list: false,
      ends: false,
      skips: false,
      more: false,
    },
    text: (text) => {
      const name = text.trim();
      if (name === "") {
        askWorkspaceName(context, command, "", NAME_NEEDED);
        return;
      }
      void create(context, command, name);
    },
  });
};

/** Runs `workspace.init` in the folder; a refusal asks the name again with core's reason. */
const create = async (context: CatalogContext, command: CommandListing, name: string): Promise<void> => {
  const input = { path: HERE, name };
  const revision = context.revision();
  const answer = await context.call(INIT_COMMAND, input);
  if (answer.ok) {
    const entry: Entry = {
      command,
      given: [{ field: "name", value: name, label: name, rank: 1 }],
      more: false,
    };
    show(context, entry, input, answer.output, revision);
  } else {
    askWorkspaceName(context, command, name, answer.message);
  }
};

/** What the start buffer's "Create workspace" needs of the window. */
export interface CreateRunnerDeps {
  /** Main gives the folder (`chooseCreateFolder` of the bridge). */
  readonly choose: () => Promise<CreateFolderAnswer>;
  readonly echo: (message: string) => void;
  /** Main showed no dialog: the command line says so, as for "Open workspace…". */
  readonly refused: () => void;
  /** The read of the catalog while it runs, else undefined. */
  readonly catalogRead: () => Promise<void> | undefined;
  /** Asks the name in the folder open without a workspace, pre-filled with `initial` (`askWorkspaceName`). */
  readonly askName: (initial: string) => void;
}

/** "Create workspace" chosen in the start buffer, and what the window learns of the folder main opens. */
export interface CreateRunner {
  readonly start: () => void;
  /** The workspace of the window changed (`workspace-changed`). */
  readonly changed: (reason: string) => void;
  /** The status of the window's workspace arrived: the workspace's name, undefined while none is open. */
  readonly shown: (name: string | undefined) => void;
}

/** One run, from the choice until main answered, the folder opened and its status arrived. */
interface Pending {
  readonly run: symbol;
  readonly answer?: CreateFolderAnswer;
  /** The window learned that a folder opened: the next status is the folder's. */
  readonly opened: boolean;
  /** The status after the open: the workspace's name, or none. */
  readonly status?: { readonly name: string | undefined };
}

/**
 * Runs "Create workspace" of the start buffer. Main's answer, the open of the folder and its status may come in
 * any order, so the run waits for all three; the open counts from the choice on. A folder already open without a
 * workspace asks the name at once; a folder that opened without one asks it once the catalog is read; a folder that
 * opened as a workspace says so (AK6). A second open meanwhile, a stopped core process, a refusal or a cancel end
 * the run with nothing created; while one runs, another choice does nothing.
 */
export const createRunner = (deps: CreateRunnerDeps): CreateRunner => {
  let pending: Pending | undefined;
  const ask = (name: string): void => {
    void (deps.catalogRead() ?? Promise.resolve()).then(
      () => {
        deps.askName(name);
      },
      () => undefined,
    );
  };
  const settle = (): void => {
    const answer = pending?.answer;
    if (pending === undefined || answer === undefined) {
      return;
    }
    if (answer.outcome === "refused" || answer.outcome === "nothing") {
      pending = undefined;
      if (answer.outcome === "refused") {
        deps.refused();
      }
      return;
    }
    if (answer.outcome === "folder" && !answer.opening) {
      pending = undefined;
      ask(answer.name);
      return;
    }
    const { status } = pending;
    if (status === undefined) {
      return;
    }
    pending = undefined;
    // A status without the expected kind of folder (it did not open after all) says why itself.
    if (answer.outcome === "existing" && status.name !== undefined) {
      deps.echo(openedExisting(status.name));
    } else if (answer.outcome === "folder" && status.name === undefined) {
      ask(answer.name);
    }
  };
  return {
    start: () => {
      if (pending !== undefined) {
        return;
      }
      const run = Symbol("create");
      pending = { run, opened: false };
      void deps.choose().then((answer) => {
        // Only for its own run: one that ended meanwhile takes no answer.
        if (pending?.run === run) {
          pending = { ...pending, answer };
          settle();
        }
      });
    },
    changed: (reason) => {
      if (pending === undefined) {
        return;
      }
      if (reason === "stopped" || (reason === "opened" && pending.opened)) {
        pending = undefined;
      } else if (reason === "opened") {
        pending = { ...pending, opened: true };
      }
    },
    shown: (name) => {
      if (pending?.opened !== true || pending.status !== undefined) {
        return;
      }
      pending = { ...pending, status: { name } };
      settle();
    },
  };
};
