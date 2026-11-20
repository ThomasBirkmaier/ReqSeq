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
  const bridge: ReqSeqBridge = { ...fake.bridge, commands: () => Promise.resolve(catalog) };
  await render(bridge);
  return fake;
};

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
    const { openFolderDialog } = await start();
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
    // Create workspace: no folder is open, so the folder dialog opens one first.
    await keyDown(buffer, "ArrowDown");
    expect(buffer.getAttribute("aria-activedescendant")).toBe("start-1");
    await keyDown(buffer, "Enter");
    await flush();
    expect(openFolderDialog).toHaveBeenCalledTimes(4);
    // Connect AI agent: its prompt asks the workspace first (SR-225 AK7).
    await keyDown(buffer, "ArrowDown");
    await keyDown(buffer, "Enter");
    await flush();
    expect(query("label.prompt-label").textContent).toBe(NONE_OPENED);
  });

  it("[SR-225/AK-s5p9] in a folder without a workspace, Create workspace starts the command prompt's Create workspace there", async () => {
    const { openFolderDialog } = await start(BARE_FOLDER);
    await click(query('[aria-label="Start"] #start-1'));
    await flush();
    expect(query("label.prompt-label").textContent).toContain("Create workspace");
    expect(openFolderDialog).not.toHaveBeenCalled();
  });

  it("[SR-225/AK-tgvr] an opened workspace shows its overview, and the start commands no longer", async () => {
    const { handlers, change } = await start();
    expect(shownOne('[aria-label="Start"]')).not.toBeNull();
    handlers["workspace.status"] = () => STATUS;
    await change("opened");
    await flush();
    expect(shownOne('[aria-label="Overview"]')).not.toBeNull();
    expect(shownOne('[aria-label="Start"]')).toBeNull();
    expect(shownAll(".start-line")).toEqual([]);
  });
});
