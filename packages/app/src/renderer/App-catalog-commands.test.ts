// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ACTIONS } from "./actions.js";
import {
  fakeBridge,
  workspace,
  flush,
  render,
  text,
  shownOne,
  query,
  keyDown,
  pressed,
  type,
  click,
  mod,
  runCommand,
  renderList,
  texts,
  calls,
  container,
  NO_WORKSPACE,
} from "./App.test-helper.js";

describe("App, catalog commands in the command prompt (ThomasBirkmaier/ReqSeq-archive#85)", () => {
  const listing = (name: string, extra: object = {}) => ({
    name,
    title: name === "baseline.list" ? "List baselines" : "Show affected elements",
    summary: "A command of the catalog.",
    effect: "read",
    stage: 3,
    implements: ["SR-073"],
    arguments: name === "baseline.list" ? [] : [{ field: "ref", complete: "element" }],
    input:
      name === "baseline.list" ? { type: "object" } : { type: "object", required: ["ref"], properties: {} },
    output: { type: "object" },
    implemented: true,
    ...extra,
  });

  it("offers the catalog's read commands by title and shows the output in a result buffer", async () => {
    const fake = fakeBridge({
      ...workspace(),
      "baseline.list": () => ({ baselines: [{ name: "Release 1", file: "baselines/r1.yaml" }] }),
    });
    const bridge = {
      ...fake.bridge,
      commands: () => Promise.resolve([listing("baseline.list"), listing("trace.affected")] as never),
    };
    await render(bridge);
    await runCommand("List baselines");
    expect(text("Sheet")).toContain("baselines1");
    expect(text("Modeline")).toContain("List baselines");
    // Backspace before the first argument goes back to the command prompt.
    await runCommand("Show affected elements");
    expect(query("label").textContent).toBe("Show affected elements · ref:");
    await keyDown(query("input"), "Backspace");
    expect(query("label").textContent).toBe("Command");
  });

  it("runs a next step of an output from the command prompt with its known inputs given (SR-226 AK5)", async () => {
    const fake = fakeBridge({
      ...workspace(),
      "baseline.list": () => ({
        baselines: [],
        next: [
          { command: "trace.affected", input: {}, open: ["ref"] },
          { command: "trace.affected", input: { ref: "uuid-2" }, open: [] },
          { command: "test.none", input: {}, open: [], workspace: "/elsewhere" },
        ],
      }),
      "trace.affected": () => ({ elements: [], total: 0 }),
    });
    const bridge = {
      ...fake.bridge,
      commands: () => Promise.resolve([listing("baseline.list"), listing("trace.affected")] as never),
    };
    await render(bridge);
    await runCommand("List baselines");
    const steps = (): Element[] => [...container.querySelectorAll(".line.step")];
    const step = (at: number): Element => {
      const line = steps()[at];
      if (line === undefined) {
        throw new Error(`No step ${String(at)}`);
      }
      return line;
    };
    expect(steps().map((line) => line.textContent)).toEqual([
      "Show affected elements",
      "Show affected elements",
      "test.none",
    ]);
    // An open input: the command prompt asks it.
    await click(step(0));
    expect(query("label").textContent).toBe("Show affected elements · ref:");
    await keyDown(query("input"), "Escape");
    // Every input known: the command runs with it.
    await click(step(1));
    expect(calls(fake.invoke, "trace.affected")).toEqual([{ ref: "uuid-2" }]);
    await runCommand("List baselines");
    // No entry of the command prompt runs it here: the command line says where it runs.
    await click(step(2));
    expect(text("Minibuffer")).toBe("test.none runs in the workspace /elsewhere: open it first");
  });

  it("[SR-223/AK-gvv1] keeps the shown buffer after a write command and says its answer in the command line; a click on it opens the output, and the next message is no link", async () => {
    let written = 0;
    const fake = fakeBridge({
      ...workspace(),
      "baseline.create": () =>
        written++ === 0
          ? { answer: "Created baseline R1; 1 file written; 2 problems.", files: ["b.yaml"] }
          : new Error("Baseline R1 exists"),
    });
    const write = listing("baseline.list", {
      name: "baseline.create",
      title: "Make snapshot",
      effect: "write-files",
    });
    const bridge = { ...fake.bridge, commands: () => Promise.resolve([write] as never) };
    await render(bridge);
    const before = text("Sheet");
    await runCommand("Make snapshot");
    expect(calls(fake.invoke, "baseline.create")).toEqual([{}]);
    expect(text("Sheet")).toBe(before);
    expect(text("Minibuffer")).toBe("Created baseline R1; 1 file written; 2 problems.");
    await click(query(".echo-open"));
    expect(text("Modeline")).toContain("Make snapshot");
    expect(text("Sheet")).toContain("b.yaml");
    // Any other message ends the link.
    await runCommand("Make snapshot");
    expect(text("Minibuffer")).toBe("Baseline R1 exists");
    expect(container.querySelector(".echo-open")).toBeNull();
  });

  describe("Create workspace in a folder open without one (SR-226 AK2, SR-223 AK8)", () => {
    const init = listing("baseline.list", {
      name: "workspace.init",
      title: "Create workspace",
      effect: "write-files",
      whileReadOnly: "allow",
    });
    const setup = async () => {
      const fake = fakeBridge({
        "workspace.status": () => NO_WORKSPACE,
        "workspace.init": () => ({
          answer: "Created workspace Station; 3 files written.",
          files: ["a.yaml"],
        }),
      });
      await render({ ...fake.bridge, commands: () => Promise.resolve([init] as never) });
      await runCommand("Create workspace");
      expect(calls(fake.invoke, "workspace.init")).toEqual([{}]);
      expect(text("Minibuffer")).toBe("Created workspace Station; 3 files written.");
      return fake;
    };

    it("[SR-226/AK-sz63] shows the overview once the status names the new workspace, and keeps the answer, whose click opens the output", async () => {
      const fake = await setup();
      // The overview waits for the status of the new workspace: until then the window shows nothing new.
      expect(container.querySelector('[aria-label="Overview"]')).toBeNull();
      Object.assign(fake.handlers, workspace(), {
        "workspace.status": () => ({ name: "Station", readOnly: false }),
      });
      await fake.change("written");
      expect(container.querySelector('[aria-label="Overview"]')).not.toBeNull();
      expect(text("Modeline")).toContain("Station");
      expect(text("Minibuffer")).toBe("Created workspace Station; 3 files written.");
      await click(query(".echo-open"));
      expect(text("Sheet")).toContain("a.yaml");
    });

    it("keeps the window and the answer when the workspace was created in another folder, and a click opens the output", async () => {
      const fake = await setup();
      // The open folder still has no workspace: no overview starts.
      await fake.change("written");
      expect(container.querySelector('[aria-label="Overview"]')).toBeNull();
      expect(text("Minibuffer")).toBe("Created workspace Station; 3 files written.");
      await click(query(".echo-open"));
      expect(text("Sheet")).toContain("a.yaml");
    });

    it("ends the link when another workspace opens, and keeps the message until its status", async () => {
      const fake = await setup();
      // The status of the workspace opened has not come yet.
      fake.invoke.mockImplementation(() => new Promise(() => undefined));
      await fake.change("opened");
      expect(text("Minibuffer")).toBe("Created workspace Station; 3 files written.");
      expect(container.querySelector(".echo-open")).toBeNull();
    });
  });

  it("puts the selected row of the shown list first for an element argument", async () => {
    const fake = fakeBridge({ ...workspace(), "trace.affected": () => ({ elements: [], total: 0 }) });
    const bridge = { ...fake.bridge, commands: () => Promise.resolve([listing("trace.affected")] as never) };
    await renderList(bridge);
    // A fresh list has no row selected (SR-122): the first Down selects the first row.
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await runCommand("Show affected elements");
    expect(query("label").textContent).toBe("Show affected elements · ref:");
    expect(texts('[role="option"] .name')[0]).toBe("SR-000002 Title 2");
    await keyDown(query("input"), "Enter");
    expect(calls(fake.invoke, "trace.affected")).toEqual([{ ref: "uuid-2" }]);
  });

  it("says why the catalog could not be read, and keeps the app's actions in the command prompt", async () => {
    const fake = fakeBridge(workspace());
    const bridge = { ...fake.bridge, commands: () => Promise.reject(new Error("The catalog is unreadable")) };
    await render(bridge);
    expect(text("Minibuffer")).toBe("Error: The catalog is unreadable");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(texts('[role="option"] .name')).toContain("List all elements");
  });

  it("gives a command prompt opened while the catalog is read its commands once they are there (#1413)", async () => {
    const fake = fakeBridge({
      ...workspace(),
      "baseline.list": () => ({ baselines: [{ name: "Release 1", file: "baselines/r1.yaml" }] }),
    });
    let answer: (commands: never) => void = () => undefined;
    const bridge = {
      ...fake.bridge,
      commands: () =>
        new Promise<never>((resolve) => {
          answer = resolve;
        }),
    };
    await render(bridge);
    await keyDown(window, "P", { ...mod(), shiftKey: true });
    await type("List baselines");
    expect(texts('[role="option"] .name')).not.toContain("List baselines");
    // Enter while the catalog is read waits for it, and then takes the command.
    await keyDown(query("input"), "Enter");
    await act(async () => {
      answer([listing("baseline.list")] as never);
      await Promise.resolve();
    });
    await flush();
    expect(text("Modeline")).toContain("List baselines");
  });

  /** The two commands with a summary, details, an argument with a description and a call on the command line. */
  const helped = () => [
    listing("baseline.list", {
      details: "Baselines live in the workspace.",
      cliUsage: "reqseq baseline list [options]",
    }),
    listing("trace.affected", {
      input: {
        type: "object",
        required: ["ref"],
        properties: { ref: { description: "The element whose change is checked." } },
      },
      cliUsage: "reqseq trace affected <ref> [options]",
    }),
  ];
  const helpBridge = () => {
    const fake = fakeBridge({ ...workspace(), "baseline.list": () => ({ baselines: [] }) });
    return { fake, bridge: { ...fake.bridge, commands: () => Promise.resolve(helped() as never) } };
  };
  const marked = (): string | undefined =>
    shownOne('.candidates [aria-selected="true"] .name')?.textContent ?? undefined;
  // The open command help: closed, it stays in the card, out of sight and hidden from a screen reader.
  const helpText = (): string | undefined =>
    shownOne('#command-help[data-open="true"]')?.textContent ?? undefined;

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "[SR-210/AK-wz9v] [SR-145/AK-bfb2] [SR-145/AK-tbrz] on %s, Ctrl+H shows the command help of the marked command; Cmd+H does not",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const { fake, bridge } = helpBridge();
      await render(bridge);
      await keyDown(window, "P", { ...mod(), shiftKey: true });
      await type("Show affected elements");
      expect(marked()).toBe("Show affected elements");
      // Cmd+H is the system's (on macOS it hides the app): the prompt leaves it alone.
      const cmd = await pressed(query("input"), "h", { metaKey: true });
      expect(cmd.defaultPrevented).toBe(false);
      expect(helpText()).toBeUndefined();
      // The physical Ctrl key with H, on every system.
      const pressedCtrl = await pressed(query("input"), "h", { ctrlKey: true });
      expect(pressedCtrl.defaultPrevented).toBe(true);
      expect(query("#command-help h2").textContent).toBe("Show affected elements");
      expect(query("#command-help .help-summary").textContent).toBe("A command of the catalog.");
      expect(texts("#command-help dt")).toEqual(["ref required"]);
      expect(texts("#command-help dd")).toEqual(["The element whose change is checked."]);
      expect(query("#command-help .help-cli").textContent).toBe("reqseq trace affected <ref> [options]");
      // It lies over the hits, which stay, dimmed, with the explanation line; it is a region of its own.
      expect(query(".card-hits").getAttribute("data-help")).toBe("open");
      expect(marked()).toBe("Show affected elements");
      expect(query("#prompt-explain")).toBeDefined();
      expect(query("#command-help").getAttribute("role")).toBe("region");
      expect(query("input").getAttribute("aria-describedby")).toBe("command-help");
      expect(query("input").getAttribute("aria-expanded")).toBe("false");
      expect(query("input").getAttribute("aria-activedescendant")).toBeNull();
      const ctrl = (letter: string): string => (platform === "MacIntel" ? `⌃${letter}` : `Ctrl+${letter}`);
      expect(query("#command-help .help-keys").textContent).toBe(
        `↑ ↓ ${ctrl("N")} ${ctrl("P")} scroll · ${ctrl("H")} or Escape back to the hits · F1 Reference page`,
      );
      // F1 still opens the reference page of the command, and the help stays (SR-141 AK3); so does its link.
      await keyDown(query("input"), "F1");
      expect(fake.openDocs).toHaveBeenLastCalledWith("trace.affected");
      expect(helpText()).toBeDefined();
      fake.openDocs.mockClear();
      await click(query("#command-help .help-docs"));
      expect(fake.openDocs).toHaveBeenLastCalledWith("trace.affected");
      expect(helpText()).toBeDefined();
    },
  );

  it("[SR-210/AK-pxr7] [SR-134/AK-ykbf] [SR-134/AK-fmf6] [SR-122/AK-kjhn] [SR-122/AK-n8p6] with the help open the list keys scroll it and keep the mark; Escape, Ctrl+H, Backspace and a click on a hit close it; Enter, Ctrl/Cmd+Enter and Tab do nothing; typing closes it and acts", async () => {
    const { fake, bridge } = helpBridge();
    await render(bridge);
    await keyDown(window, "P", { ...mod(), shiftKey: true });
    await type("List baselines");
    expect(marked()).toBe("List baselines");
    // A click on "help" in the explanation line acts as Ctrl+H.
    expect(query("#prompt-explain .explain-help").textContent).toContain("help");
    await click(query("#prompt-explain .explain-help"));
    expect(query("#command-help h2").textContent).toBe("List baselines");
    expect(query("#command-help .help-details").textContent).toBe("Baselines live in the workspace.");
    expect(query("#command-help").textContent).toContain("No arguments.");
    // Ctrl+H again closes it, and the prompt stays open with its mark.
    await keyDown(query("input"), "h", { ctrlKey: true });
    expect(helpText()).toBeUndefined();
    expect(query("#command-help").getAttribute("aria-hidden")).toBe("true");
    expect(marked()).toBe("List baselines");
    // Escape closes only the help.
    await keyDown(query("input"), "h", { ctrlKey: true });
    expect(helpText()).toBeDefined();
    await keyDown(query("input"), "Escape");
    expect(helpText()).toBeUndefined();
    expect(query("label").textContent).toBe("Command");
    expect(marked()).toBe("List baselines");
    // The keys of the list scroll the help; the mark stays.
    await keyDown(query("input"), "h", { ctrlKey: true });
    const scrolled = vi.spyOn(query("#command-help"), "scrollBy").mockImplementation(() => undefined);
    for (const [key, init] of [
      ["ArrowDown", {}],
      ["ArrowUp", {}],
      ["n", { ctrlKey: true }],
      ["p", { ctrlKey: true }],
      ["PageDown", {}],
      ["PageUp", {}],
    ] as const) {
      expect((await pressed(query("input"), key, init)).defaultPrevented, key).toBe(true);
    }
    expect(scrolled).toHaveBeenCalledTimes(6);
    expect(marked()).toBe("List baselines");
    // Enter, Ctrl/Cmd+Enter and Tab do nothing.
    await keyDown(query("input"), "Enter");
    await keyDown(query("input"), "Enter", mod());
    await keyDown(query("input"), "Tab");
    expect(calls(fake.invoke, "baseline.list")).toEqual([]);
    expect(helpText()).toBeDefined();
    expect(marked()).toBe("List baselines");
    // A click on a dimmed hit closes only the help.
    const hit = query('.candidates [aria-selected="true"]');
    await act(async () => {
      hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(helpText()).toBeUndefined();
    expect(calls(fake.invoke, "baseline.list")).toEqual([]);
    // A key that changes the input closes the help and acts as without it.
    await keyDown(query("input"), "h", { ctrlKey: true });
    await type("Show affected elements");
    expect(helpText()).toBeUndefined();
    expect(marked()).toBe("Show affected elements");
    // Backspace on an empty input closes only the help; the prompt stays open.
    await type("");
    // The first entry with a command help (an element or a buffer has none, AK5).
    for (let tries = 0; helpText() === undefined && tries < 10; tries += 1) {
      await keyDown(query("input"), "ArrowDown");
      await keyDown(query("input"), "h", { ctrlKey: true });
    }
    expect(helpText()).toBeDefined();
    const before = marked();
    await keyDown(query("input"), "Backspace");
    expect(helpText()).toBeUndefined();
    expect(query("label").textContent).toBe("Command");
    expect(marked()).toBe(before);
    // Without the help, Enter takes the marked command.
    await type("List baselines");
    await keyDown(query("input"), "Enter");
    expect(calls(fake.invoke, "baseline.list")).toEqual([{}]);
  });

  it("[SR-210/AK-r2d2] [SR-145/AK-bfb2] an action of the app explains itself by its description; in Go to an element has no explanation and Ctrl+H does nothing", async () => {
    await render(helpBridge().bridge);
    await keyDown(window, "P", { ...mod(), shiftKey: true });
    await type("Open documentation");
    expect(marked()).toBe("Open documentation");
    const description = ACTIONS.find((action) => action.id === "open-documentation")?.description ?? "";
    expect(query("#prompt-explain .explain-text").textContent).toBe(description);
    // No arguments to count, but its help.
    expect(query("#prompt-explain .explain-side").textContent).toBe("Ctrl+H help");
    await keyDown(query("input"), "h", { ctrlKey: true });
    expect(query("#command-help h2").textContent).toBe("Open documentation");
    expect(query("#command-help .help-summary").textContent).toBe(description);
    // No arguments and no call on the command line: the app alone has it. Its key, if it has one.
    expect(texts("#command-help h3").filter((heading) => heading !== "Key")).toEqual([]);
    expect(shownOne("#command-help .help-cli")).toBeNull();
    await keyDown(query("input"), "Escape");
    await keyDown(query("input"), "Escape");
    // In Go to, on an element or a buffer, there is no explanation, and Ctrl+H does nothing; it is the command
    // line's, not the text's.
    await keyDown(window, "p", mod());
    expect(query("label").textContent).toBe("Go to");
    await type("Title");
    expect(shownOne("#prompt-explain")).toBeNull();
    const ctrl = await pressed(query("input"), "h", { ctrlKey: true });
    expect(ctrl.defaultPrevented).toBe(true);
    expect(helpText()).toBeUndefined();
    expect((query("input") as HTMLInputElement).value).toBe("Title");
  });

  it("[SR-133/AK-w7wd] [SR-210/AK-r2d2] All commands… explains itself with Enter; Ctrl+H and Ctrl+Enter do nothing, F1 opens the start page; Enter lists every command by name", async () => {
    const { fake, bridge } = helpBridge();
    await render(bridge);
    await keyDown(window, "P", { ...mod(), shiftKey: true });
    const opening = texts('#candidates [role="option"] .name');
    expect(opening).toHaveLength(10);
    expect(opening.at(-1)).toBe("All commands…");
    for (let step = 0; step < 9; step += 1) {
      await keyDown(query("input"), "ArrowDown");
    }
    expect(marked()).toBe("All commands…");
    expect(query("#prompt-explain .explain-text").textContent).toBe(
      "Show every command you can run here, by name.",
    );
    expect(query("#prompt-explain .explain-side").textContent).toBe("Enter");
    // Ctrl+H and Ctrl/Cmd+Enter do nothing; F1 opens the start page of the documentation.
    await keyDown(query("input"), "h", { ctrlKey: true });
    expect(helpText()).toBeUndefined();
    await keyDown(query("input"), "Enter", mod());
    expect(query("label").textContent).toBe("Command");
    expect(marked()).toBe("All commands…");
    await keyDown(query("input"), "F1");
    expect(fake.openDocs).toHaveBeenLastCalledWith(undefined);
    // Enter: every command that can run here, by name, the first one marked, under "All commands".
    await keyDown(query("input"), "Enter");
    expect(query("label").textContent).toBe("All commands");
    const all = texts('#candidates [role="option"] .name');
    expect(all.length).toBeGreaterThan(10);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(all).not.toContain("All commands…");
    for (const name of opening.slice(0, 9)) {
      expect(all).toContain(name);
    }
    expect(marked()).toBe(all[0]);
    // A typed text searches as in the command prompt, and never finds "All commands…"; cleared, the list is back.
    await type("all commands");
    expect(texts('#candidates [role="option"] .name')).not.toContain("All commands…");
    await type("toggle dark");
    expect(marked()).toBe("Toggle dark mode");
    await type("");
    expect(texts('#candidates [role="option"] .name')).toEqual(all);
    // Escape closes it (SR-134 AK2); "All commands…" recorded no use.
    await keyDown(query("input"), "Escape");
    expect(shownOne("input")).toBeNull();
    expect(window.localStorage.getItem("reqseq.usage.v1") ?? "").not.toContain("all-commands");
  });

  it("[SR-210/AK-gqgt] keeps the explanation line, empty, while no hit is left", async () => {
    await render(helpBridge().bridge);
    await keyDown(window, "P", { ...mod(), shiftKey: true });
    await type("Show affected elements");
    expect(query("#prompt-explain .explain-text").textContent).toBe("A command of the catalog.");
    expect(query("input").getAttribute("aria-describedby")).toBe("prompt-explain");
    await type("Show affected elements qqqqxz");
    expect(shownOne(".candidates")).toBeNull();
    expect(query("#prompt-explain .explain-text").textContent).toBe("");
    expect(shownOne("#prompt-explain .explain-side")).toBeNull();
    expect(query("input").getAttribute("aria-describedby")).toBeNull();
  });
});
