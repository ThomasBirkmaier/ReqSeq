// The prompt "Open workspace" (SR-131): the workspaces opened last, as main lists them.
import { afterEach, describe, expect, it, vi } from "vitest";
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
  } = {},
) => {
  const echoed: string[] = [];
  const open = vi.fn<WorkspaceControls["open"]>(() => Promise.resolve(options.answer ?? { ok: true }));
  const workspaces: WorkspaceControls = {
    name: "name" in options ? options.name : "Weather station",
    list: () => Promise.resolve(options.entries ?? ENTRIES),
    open,
  };
  const prompt = workspacePrompt({ workspaces, echo: (message) => echoed.push(message) });
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("[SR-131/AK3] says nothing more when the window could not save its input: it named the element", async () => {
    const { prompt, open, echoed } = setup({ answer: { ok: false, reason: "unsaved" } });
    await choose(await filled(prompt.fill), "/req/buoy");
    expect(open).toHaveBeenCalledExactlyOnceWith("/req/buoy");
    expect(echoed).toEqual([]);
  });

  it("[SR-131/AK3] says why nothing opened when the save took too long, or another switch runs", async () => {
    const late = setup({ answer: { ok: false, reason: "timeout" } });
    await choose(await filled(late.prompt.fill), "/req/buoy");
    const busy = setup({ answer: { ok: false, reason: "busy" }, name: undefined });
    await choose(await filled(busy.prompt.fill), "/req/buoy");
    expect([...late.echoed, ...busy.echoed]).toEqual([
      "The unsaved input was not saved in time; Weather station stays open",
      "Another workspace is being opened; no workspace is open",
    ]);
  });

  it("[SR-131/AK5] a typed path is the first choice and Enter opens it", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    const { prompt, open, echoed } = setup();
    const literal = (text: string): Choice | undefined => prompt.literal?.(text);
    for (const text of ["/home/ada/req", "~", "~/req", "C:\\Work\\Spec", "c:/work", "\\\\host\\share"]) {
      expect(literal(text)?.name, text).toBe(`Open ${text}`);
      expect(literal(text)?.hint).toBe("folder");
    }
    // Spaces around the path are not part of it.
    expect(literal("  /req/buoy  ")?.name).toBe("Open /req/buoy");
    // Only path-like text: names of the list are narrowed as usual.
    for (const text of ["", "buoy", "req/buoy", "C:Work", "C:"]) {
      expect(literal(text), text).toBeUndefined();
    }
    // On macOS and Linux a path starts with `/` or `~` only: `\` and a drive are never offered there.
    for (const platform of ["MacIntel", "Linux x86_64"]) {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      for (const text of ["/home/ada/req", "~/req"]) {
        expect(literal(text)?.name, `${platform} ${text}`).toBe(`Open ${text}`);
      }
      for (const text of ["\\foo", "\\\\host\\share", "C:\\Work", "c:/work"]) {
        expect(literal(text), `${platform} ${text}`).toBeUndefined();
      }
    }
    literal("  ~/req/kestrel ")?.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(open).toHaveBeenCalledExactlyOnceWith("~/req/kestrel", { typed: true });
    // Opened: the window learns it as `workspace-changed`; the prompt says nothing.
    expect(echoed).toEqual([]);
  });

  it("says why a typed path was not opened, and that the open workspace stays", async () => {
    const run = async (answer: OpenWorkspaceResult, open = true) => {
      const { prompt, echoed } = setup(open ? { answer } : { answer, name: undefined });
      prompt.literal?.("/home/ada/notes")?.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return echoed;
    };
    expect(await run({ ok: false, reason: "no-workspace" })).toEqual([
      "No workspace in /home/ada/notes or a folder above it; Weather station stays open",
    ]);
    expect(await run({ ok: false, reason: "no-workspace" }, false)).toEqual([
      "No workspace in /home/ada/notes or a folder above it; no workspace is open",
    ]);
    // Refused by main: by its text, or because main could not load core's module of the list.
    expect(await run({ ok: false, reason: "refused" })).toEqual(["/home/ada/notes could not be opened"]);
    expect(await run({ ok: false, reason: "unsaved" })).toEqual([]);
    expect(await run({ ok: false, reason: "missing" })).toEqual([
      "/home/ada/notes is not found; Weather station stays open",
    ]);
  });
});
