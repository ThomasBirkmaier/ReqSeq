// @vitest-environment happy-dom
// The start buffer in the window (SR-225 AK1–AK3): while no workspace is open it shows the three start commands
// and nothing else, a click or the arrow keys and Enter run them, and an opened workspace shows its overview.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CommandListing, ReqSeqBridge } from "../shared/protocol.js";
import { NONE_OPENED } from "./connect-agent.js";
import {
  NO_WORKSPACE,
  STATUS,
  calls,
  click,
  fakeBridge,
  flush,
  keyDown,
  query,
  render,
  runCommand,
  shownAll,
  shownOne,
  text,
  type,
  workspace,
} from "./App.test-helper.js";

/** A catalog entry as the bridge lists it, from its schema file (the core runtime does not load under happy-dom). */
const listing = (name: string, cliUsage: string): CommandListing => ({
  ...(JSON.parse(
    readFileSync(join(__dirname, `../../../../schemas/commands/${name}.json`), "utf8"),
  ) as CommandListing),
  implemented: true,
  cliUsage,
});

/** The catalog of a core process opened for a folder without a workspace. */
const BARE_FOLDER: readonly CommandListing[] = [
  listing("workspace.init", "reqseq workspace init <path> <name>"),
  listing("workspace.connectAgent", "reqseq workspace connect-agent [options]"),
];

/** Without a workspace; `catalog` is what the bridge lists: none while no core process runs. */
const start = async (catalog: readonly CommandListing[] = [], status: unknown = NO_WORKSPACE) => {
  const fake = fakeBridge({ ...workspace(), "workspace.status": () => status });
  const listed = { catalog };
  const bridge: ReqSeqBridge = { ...fake.bridge, commands: () => Promise.resolve(listed.catalog) };
  await render(bridge);
  return { ...fake, listed };
};

/** The status of a folder opened without a workspace (core's `workspace.not-found`). */
const BARE_STATUS = (): Error =>
  Object.assign(new Error("No reqseq-workspace.yaml in the workspace folder"), {
    code: "workspace.not-found",
  });

/** The lines of the start buffer, each with its side text. */
const lines = (): string[][] =>
  shownAll('[aria-label="Start"] [role="option"]').map((line) =>
    [...line.children].map((part) => part.textContent),
  );

const START_LINES = [["Open workspace…", "Ctrl+O"], ["Create workspace"], ["Connect AI agent"]];

/** The sheet's buffers by their label. */
const sheet = (): (string | null)[] =>
  [...query('[aria-label="Sheet"]').children].map((child) => child.getAttribute("aria-label"));

describe("the start buffer", () => {
  it("[SR-225/AK-d2gk] without a workspace shows Open workspace… with its key, Create workspace and Connect AI agent, and nothing else", async () => {
    const { handlers, change, openWorkspace, recentWorkspaces } = await start();
    expect(sheet()).toEqual(["Start"]);
    expect(lines()).toEqual(START_LINES);
    // The key is a side text of its own, as in the menu item; the lines are no buttons with a frame.
    expect(query(".start-key").textContent).toBe("Ctrl+O");
    expect(shownAll('[aria-label="Start"] button')).toEqual([]);
    expect(text("Modeline")).toBe("No workspace is open.");
    // After a folder without a workspace was chosen: the same.
    handlers["workspace.status"] = () =>
      Object.assign(new Error("No reqseq-workspace.yaml in the workspace folder"), {
        code: "workspace.not-found",
      });
    await change("opened");
    expect(sheet()).toEqual(["Start"]);
    expect(lines()).toEqual(START_LINES);
    expect(text("Modeline")).toBe("No workspace is open.");
    // After opening failed: the same, and the command line says why.
    recentWorkspaces.mockResolvedValue([{ root: "/req/gone", state: "found" }]);
    openWorkspace.mockResolvedValueOnce({ ok: false, reason: "missing" });
    await runCommand("Open workspace");
    await keyDown(query("input"), "Enter");
    await flush();
    expect(openWorkspace).toHaveBeenCalledOnce();
    expect(text("Minibuffer")).toContain("/req/gone");
    expect(sheet()).toEqual(["Start"]);
    expect(lines()).toEqual(START_LINES);
    expect(text("Modeline")).toBe("No workspace is open.");
  });

  it("[SR-225/AK-d2gk] names the key of macOS there", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await start();
    expect(lines()[0]).toEqual(["Open workspace…", "⌘O"]);
  });

  it("[SR-225/AK-s5p9] a click or the arrow keys and Enter run a line: the folder dialog, Create workspace, Connect AI agent", async () => {
    const { openFolderDialog, chooseCreateFolder } = await start();
    const buffer = query('[aria-label="Start"]');
    // It has the focus, so its keys work at once.
    expect(document.activeElement).toBe(buffer);
    await click(query('[aria-label="Start"] [role="option"]'));
    expect(openFolderDialog).toHaveBeenCalledOnce();
    // Enter on the selected line runs it again.
    await keyDown(buffer, "Enter");
    expect(openFolderDialog).toHaveBeenCalledTimes(2);
    // Main refused (the input too long ago, or a dialog open): the command line says so.
    openFolderDialog.mockResolvedValueOnce(false);
    await keyDown(buffer, "Enter");
    await flush();
    expect(text("Minibuffer")).toBe("The folder dialog did not open. Press Ctrl+O to choose a folder.");
    // Create workspace: main gives the folder for it (AK4).
    await keyDown(buffer, "ArrowDown");
    expect(buffer.getAttribute("aria-activedescendant")).toBe("start-1");
    await keyDown(buffer, "Enter");
    await flush();
    expect(chooseCreateFolder).toHaveBeenCalledOnce();
    expect(openFolderDialog).toHaveBeenCalledTimes(3);
    // Connect AI agent: its prompt asks the workspace first (SR-225 AK7).
    await keyDown(buffer, "ArrowDown");
    await keyDown(buffer, "Enter");
    await flush();
    expect(query("label.prompt-label").textContent).toBe(NONE_OPENED);
  });

  it("[SR-225/AK-tgvr] an opened workspace shows its overview, and the start commands no longer; one without elements its first steps", async () => {
    const { handlers, change, listed } = await start();
    expect(shownOne('[aria-label="Start"]')).not.toBeNull();
    handlers["workspace.status"] = () => STATUS;
    await change("opened");
    await flush();
    expect(shownOne('[aria-label="Overview"]')).not.toBeNull();
    expect(shownOne('[aria-label="Start"]')).toBeNull();
    expect(shownAll(".start-line")).toEqual([]);
    // An opened workspace without elements shows the overview's own lines (SR-118 AK9), as the catalog has them;
    // a read-only one leaves out the write commands the command prompt does not offer there (SR-133 AK1).
    const empty = (readOnly: boolean): unknown => ({ name: "Buoy", readOnly });
    listed.catalog = [
      listing("element.create", "reqseq element create [options]"),
      listing("reqif.import", "reqseq reqif import <file> [options]"),
      listing("workspace.connectAgent", "reqseq workspace connect-agent [options]"),
    ];
    handlers["element.facets"] = () => ({
      total: 0,
      types: [],
      statuses: [],
      properties: [],
      incomplete: false,
    });
    handlers["workspace.status"] = () => empty(false);
    await change("opened");
    await flush();
    const steps = (): string[] =>
      shownAll('[aria-label="Overview"] .start-label').map((line) => line.textContent);
    expect(steps()).toEqual(["Create element", "Import ReqIF file", "Connect AI agent"]);
    expect(shownOne('[aria-label="Start"]')).toBeNull();
    handlers["workspace.status"] = () => empty(true);
    await change("opened");
    await flush();
    expect(steps()).not.toContain("Create element");
    expect(steps()).not.toContain("Import ReqIF file");
  });

  it("[SR-225/AK-tccz] Create workspace takes the folder main gives, asks only the name, pre-filled, and Enter creates it with the standard model and opens it", async () => {
    const { chooseCreateFolder, handlers, change, invoke, listed } = await start();
    handlers["workspace.init"] = () => ({
      answer: "Created workspace Station; 4 files written.",
      files: [],
      next: [],
    });
    // No folder is open: main shows the system folder dialog and opens the folder chosen there.
    chooseCreateFolder.mockResolvedValueOnce({ outcome: "folder", name: "Station", opening: true });
    await click(query('[aria-label="Start"] #start-1'));
    expect(chooseCreateFolder).toHaveBeenCalledOnce();
    // Nothing is asked before the folder is open and its catalog read.
    expect(shownOne("label.prompt-label")).toBeNull();
    listed.catalog = BARE_FOLDER;
    handlers["workspace.status"] = BARE_STATUS;
    await change("opened");
    await flush();
    expect(query("label.prompt-label").textContent).toBe("Create workspace · name:");
    expect((query("input") as HTMLInputElement).value).toBe("Station");
    await keyDown(query("input"), "Enter");
    await flush();
    // The folder itself, without a metamodel: the standard model (SR-014 AK1).
    expect(calls(invoke, "workspace.init")).toEqual([{ path: ".", name: "Station" }]);
    expect(text("Minibuffer")).toBe("Created workspace Station; 4 files written.");
    // The new workspace opens: its overview (SR-226 AK2).
    handlers["workspace.status"] = () => ({ name: "Station", readOnly: false });
    await change("written");
    await flush();
    expect(shownOne('[aria-label="Overview"]')).not.toBeNull();
    expect(shownOne('[aria-label="Start"]')).toBeNull();
  });

  it("[SR-225/AK-tccz] in a folder open without a workspace, no dialog: the name at once; the command prompt's Create workspace asks path and name", async () => {
    const { chooseCreateFolder, openFolderDialog, invoke } = await start(BARE_FOLDER, BARE_STATUS());
    chooseCreateFolder.mockResolvedValueOnce({ outcome: "folder", name: "Buoy", opening: false });
    await click(query('[aria-label="Start"] #start-1'));
    await flush();
    expect(query("label.prompt-label").textContent).toBe("Create workspace · name:");
    expect((query("input") as HTMLInputElement).value).toBe("Buoy");
    expect(openFolderDialog).not.toHaveBeenCalled();
    await keyDown(query("input"), "Escape");
    // From the command prompt (SR-143): the path first.
    await runCommand("Create workspace");
    expect(query("label.prompt-label").textContent).toBe("Create workspace · path:");
    expect(calls(invoke, "workspace.init")).toEqual([]);
  });

  it("[SR-225/AK-mw88] a canceled dialog, Escape or an empty name create nothing; an empty name and a refusal stay in the step and say why", async () => {
    const { chooseCreateFolder, handlers, invoke } = await start(BARE_FOLDER, BARE_STATUS());
    const create = query('[aria-label="Start"] #start-1');
    // The dialog was canceled: nothing is asked or created.
    chooseCreateFolder.mockResolvedValueOnce({ outcome: "nothing" });
    await click(create);
    expect(shownOne("label.prompt-label")).toBeNull();
    // Main started nothing: the command line says so.
    chooseCreateFolder.mockResolvedValueOnce({ outcome: "refused" });
    await click(create);
    expect(text("Minibuffer")).toBe("Create workspace did not start; choose it again.");
    // Escape in the name.
    chooseCreateFolder.mockResolvedValue({ outcome: "folder", name: "Station", opening: false });
    await click(create);
    await keyDown(query("input"), "Escape");
    expect(shownOne("label.prompt-label")).toBeNull();
    // An empty name stays in the step and says that a name is needed.
    await click(create);
    await type("");
    await keyDown(query("input"), "Enter");
    expect(query("label.prompt-label").textContent).toBe("A name is needed · Create workspace · name:");
    expect(calls(invoke, "workspace.init")).toEqual([]);
    // The name goes to core as typed, and a refusal names its reason in the step, with the name given.
    handlers["workspace.init"] = () =>
      Object.assign(new Error("The folder holds reqseq-workspace.yaml already"), { code: "input.invalid" });
    await type(" Station ");
    await keyDown(query("input"), "Enter");
    await flush();
    expect(calls(invoke, "workspace.init")).toEqual([{ path: ".", name: " Station " }]);
    expect(query("label.prompt-label").textContent).toBe(
      "The folder holds reqseq-workspace.yaml already · Create workspace · name:",
    );
    expect((query("input") as HTMLInputElement).value).toBe(" Station ");
  });

  it("[SR-225/AK-tf62] a chosen folder that is a workspace is opened, nothing is created, and the command line names it", async () => {
    const { chooseCreateFolder, handlers, change, invoke } = await start();
    chooseCreateFolder.mockResolvedValueOnce({ outcome: "existing" });
    await click(query('[aria-label="Start"] #start-1'));
    handlers["workspace.status"] = () => STATUS;
    await change("opened");
    await flush();
    expect(text("Minibuffer")).toBe("Opened the existing workspace Weather station");
    expect(shownOne('[aria-label="Overview"]')).not.toBeNull();
    expect(shownOne("label.prompt-label")).toBeNull();
    expect(calls(invoke, "workspace.init")).toEqual([]);
  });
});
