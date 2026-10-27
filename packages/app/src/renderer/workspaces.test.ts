// The prompt "Open workspace" (SR-131): the workspaces opened last, as main lists them.
import { describe, expect, it, vi } from "vitest";
import type { OpenWorkspaceResult, RecentWorkspaceEntry } from "../shared/protocol.js";
import type { Choice, PromptFill } from "./actions.js";
import { rankByUse } from "./usage.js";
import type { WorkspaceControls } from "./workspaces.js";
import { workspacePrompt } from "./workspaces.js";

const ENTRIES: readonly RecentWorkspaceEntry[] = [
  { root: "/req/station", state: "open" },
  { root: "/req/buoy", state: "found" },
  { root: "/mnt/usb/harbour", state: "missing" },
  { root: "/req/anemometer", state: "found" },
];

const setup = (
  options: {
    readonly entries?: readonly RecentWorkspaceEntry[];
    readonly name?: string | undefined;
    readonly answer?: OpenWorkspaceResult;
    readonly unsaved?: string;
  } = {},
) => {
  const echoed: string[] = [];
  const open = vi.fn<WorkspaceControls["open"]>(() => Promise.resolve(options.answer ?? { ok: true }));
  const workspaces: WorkspaceControls = {
    name: "name" in options ? options.name : "Weather station",
    list: () => Promise.resolve(options.entries ?? ENTRIES),
    open,
  };
  const prompt = workspacePrompt({
    workspaces,
    echo: (message) => echoed.push(message),
    unsaved: () => options.unsaved,
  });
  return { prompt, open, echoed };
};

const filled = async (fill: Promise<PromptFill> | undefined): Promise<readonly Choice[]> =>
  (await fill)?.items ?? [];

/** The names the minibuffer shows for `query`, ranked as it ranks them. */
const shown = (items: readonly Choice[], query: string): string[] =>
  rankByUse(items, (choice) => choice.name, query, undefined).map(({ item }) => item.name);

const choose = async (items: readonly Choice[], root: string): Promise<void> => {
  items.find((choice) => choice.name === root)?.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("the prompt Open workspace", () => {
  it("[SR-131/AK1] the Open workspace prompt lists the recent workspaces, the last opened first, and narrows them like the command prompt", async () => {
    const { prompt } = setup();
    // It opens at once and takes keys while main reads the list.
    expect(prompt.label).toBe("Workspace");
    expect(prompt.items).toEqual([]);
    const items = await filled(prompt.fill);
    expect(items.map((choice) => [choice.name, choice.hint])).toEqual([
      ["/req/station", "open"],
      ["/req/buoy", undefined],
      ["/mnt/usb/harbour", "not found"],
      ["/req/anemometer", undefined],
    ]);
    expect(new Set(items.map((choice) => choice.id)).size).toBe(4);
    // Nothing typed: main's order, the most recent first.
    expect(shown(items, "")).toEqual(["/req/station", "/req/buoy", "/mnt/usb/harbour", "/req/anemometer"]);
    // Typed: narrowed by the fuzzy search of the command prompt, letters in order and one slip.
    expect(shown(items, "buoy")).toEqual(["/req/buoy"]);
    expect(shown(items, "anmo")).toEqual(["/req/anemometer"]);
    expect(shown(items, "harbor")).toEqual(["/mnt/usb/harbour"]);
    expect(shown(items, "req")).toEqual(["/req/station", "/req/buoy", "/req/anemometer"]);
  });

  it("says so when no workspace was opened yet", async () => {
    const { prompt } = setup({ entries: [] });
    expect(await prompt.fill).toEqual({ label: "Workspace (none opened yet)", items: [] });
  });

  it("[SR-131/AK2] choosing another workspace asks main to open it; choosing the open one opens nothing", async () => {
    const { prompt, open, echoed } = setup();
    const items = await filled(prompt.fill);
    await choose(items, "/req/buoy");
    expect(open).toHaveBeenCalledExactlyOnceWith("/req/buoy");
    // The window learns the switch as `workspace-changed`; the prompt says nothing.
    expect(echoed).toEqual([]);
    await choose(items, "/req/station");
    expect(open).toHaveBeenCalledOnce();
    expect(echoed).toEqual(["/req/station is open"]);
  });

  it("[SR-131/AK4] a missing workspace is listed as not found, and choosing it opens nothing and says the open workspace stays", async () => {
    const { prompt, open, echoed } = setup();
    await choose(await filled(prompt.fill), "/mnt/usb/harbour");
    expect(open).not.toHaveBeenCalled();
    expect(echoed).toEqual(["/mnt/usb/harbour is not found; Weather station stays open"]);
    // Gone between the list and the choice: main says so, and the open workspace stays.
    const late = setup({ answer: { ok: false, reason: "missing" } });
    await choose(await filled(late.prompt.fill), "/req/buoy");
    expect(late.echoed).toEqual(["/req/buoy is not found; Weather station stays open"]);
    // Without an open workspace.
    const none = setup({ name: undefined, answer: { ok: false, reason: "missing" } });
    const items = await filled(none.prompt.fill);
    await choose(items, "/mnt/usb/harbour");
    await choose(items, "/req/buoy");
    expect(none.echoed).toEqual([
      "/mnt/usb/harbour is not found; no workspace is open",
      "/req/buoy is not found; no workspace is open",
    ]);
  });

  it("says when main refuses to open a workspace", async () => {
    const { prompt, echoed } = setup({ answer: { ok: false, reason: "refused" } });
    await choose(await filled(prompt.fill), "/req/buoy");
    expect(echoed).toEqual(["/req/buoy could not be opened"]);
  });

  it("with unsaved input the prompt opens nothing and names the buffer", async () => {
    const { prompt, open, echoed } = setup({ unsaved: "SR-036 Show wind speed" });
    await choose(await filled(prompt.fill), "/req/buoy");
    expect(open).not.toHaveBeenCalled();
    expect(echoed).toEqual([
      "Unsaved input in SR-036 Show wind speed: save it before opening another workspace",
    ]);
  });
});
