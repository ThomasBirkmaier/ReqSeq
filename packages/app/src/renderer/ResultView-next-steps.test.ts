// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { LoadingView } from "./BufferArea.js";
import type { NextStep } from "./next-steps.js";
import { NEXT_STEPS, resultLines } from "./result.js";
import type { NextSteps } from "./ResultView.js";

const CONNECT: NextStep = { command: "workspace.connectAgent", input: {}, open: ["client"], workspace: "/w" };
const CREATE: NextStep = { command: "element.create", input: {}, open: ["type", "title"], workspace: "/w" };
const OUTPUT = {
  answer: "Created workspace Station; 3 files written.",
  files: ["a.yaml"],
  next: [CONNECT, CREATE],
};

describe("the lines of the next steps (SR-226 AK5)", () => {
  it("puts the next steps last, under the title of their field, and leaves them out of the other lines", () => {
    const lines = resultLines(OUTPUT, [{ path: "next", title: "Next" }]);
    expect(lines.map((line) => [line.kind, line.text])).toEqual([
      ["text", "1"],
      ["text", "a.yaml"],
      ["heading", "Next"],
      ["step", "workspace.connectAgent"],
      ["step", "element.create"],
    ]);
    expect(lines.at(-1)?.step).toEqual(CREATE);
    expect(resultLines(OUTPUT).at(-3)?.text).toBe(NEXT_STEPS);
  });

  it("keeps a field `next` that holds no steps among the other lines", () => {
    expect(resultLines({ next: "Paste the setup" }).map((line) => line.kind)).toEqual(["text"]);
  });

  it("shows no line for an empty list of next steps", () => {
    expect(resultLines({ files: ["a.yaml"], next: [] }).map((line) => line.text)).toEqual(["1", "a.yaml"]);
  });
});

describe("the next steps of an output page (SR-226 AK5)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  /** Shows the output of `workspace.init` with the line at `cursor` selected. */
  const show = async (steps?: NextSteps, cursor = -1): Promise<void> => {
    const buffer = { ...resultBuffer("workspace.init", {}, "Create workspace", OUTPUT, 0, true), cursor };
    await act(async () => {
      root.render(
        createElement(LoadingView, {
          call: vi.fn<Call>(),
          buffer,
          revision: 0,
          dispatch: vi.fn(),
          onData: vi.fn(),
          onEcho: vi.fn(),
          ...(steps === undefined ? {} : { nextSteps: steps }),
        }),
      );
      await Promise.resolve();
    });
  };

  const stepLines = (): Element[] => [...container.querySelectorAll(".line.step")];

  it("shows each step with the name and key of its command, and Enter or a click runs it", async () => {
    const run = vi.fn();
    await show({
      entry: (command) =>
        command === "element.create"
          ? { name: "Create element", key: "Ctrl+K E" }
          : { name: "Connect AI agent" },
      run,
    });
    expect(stepLines().map((line) => line.textContent)).toEqual([
      "Connect AI agent",
      "Create elementCtrl+K E",
    ]);
    expect(container.querySelector(".line.step kbd")?.textContent).toBe("Ctrl+K E");
    // The steps are options, the last lines of the page.
    expect([...container.querySelectorAll(".line")].at(-1)).toBe(stepLines()[1]);
    expect(stepLines()[0]?.getAttribute("role")).toBe("option");
    await act(async () => {
      stepLines()[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    // With the name of a list the step opens, as the lists of an output are named.
    expect(run).toHaveBeenLastCalledWith(CREATE, "Create workspace · Next steps");
    // Enter on the selected step runs it.
    await show({ entry: () => ({ name: "Connect AI agent" }), run }, 3);
    await act(async () => {
      container
        .querySelector("[data-buffer]")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(run).toHaveBeenLastCalledWith(CONNECT, "Create workspace · Next steps");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("names a step by its command and runs nothing without the window's steps", async () => {
    await show();
    expect(stepLines().map((line) => line.textContent)).toEqual(["workspace.connectAgent", "element.create"]);
    await act(async () => {
      stepLines()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(stepLines()).toHaveLength(2);
  });
});
