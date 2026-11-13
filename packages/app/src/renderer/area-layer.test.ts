// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460).
import "../../../../scripts/test-support/dom-selection.mjs";
// The layers of an area (SR-212 AK5): a view drawn in advance whose layer goes while its reads wait at the
// gate sends none of them when the gate opens, so a held Alt+P leaves no reads behind; and one that read is not
// read again after a change of the workspace, but dropped until the next switch.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadGate } from "./area-slot.js";
import type { AreaViews, ElementProps } from "./BufferArea.js";
import { BufferArea } from "./BufferArea.js";
import type { Buffer } from "./buffers.js";
import { elementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { NO_CHANGES } from "./outside-marks.js";
import { referenceTitles } from "./reference-titles.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const SHOWN = elementBuffer("uuid-2", "spec", "SR-000002 Shown");
const HIDDEN = elementBuffer("uuid-1", "spec", "SR-000001 Hidden");

/**
 * An area showing `SHOWN` beside the views of `hidden`. The reads of `SHOWN` never answer unless `answered`;
 * the rest answer a failure.
 */
const area = (gate: ReadGate, answered = false) => {
  const call = vi.fn((_name: string, input: Record<string, unknown>) =>
    input["ref"] === "uuid-2" && !answered
      ? new Promise(() => undefined)
      : Promise.resolve({ ok: false, code: "test", message: "not in this test" }),
  );
  const drop = vi.fn<(key: string) => void>();
  const element = (): ElementProps =>
    ({
      onCopy: () => undefined,
      onOpenRelation: () => undefined,
      onOpenResult: () => undefined,
      onOpenTarget: () => undefined,
      onPickElement: () => undefined,
      titles: referenceTitles(call as unknown as Call),
      onAsk: () => undefined,
      onDraft: () => undefined,
      register: () => undefined,
      packages: { types: new Set(["package"]), key: "packages" },
      properties: new Map(),
    }) as unknown as ElementProps;
  const views = (seen: number, switchSaves: number) =>
    ({
      call: call as unknown as Call,
      revision: seen,
      seen,
      outside: NO_CHANGES,
      dispatch: () => undefined,
      onData: () => undefined,
      onEcho: () => undefined,
      onDrawn: () => undefined,
      typeNames: new Map(),
      kindNames: new Map(),
      overview: { data: undefined, perspectives: [], recents: [], openPerspective: () => undefined },
      element,
      gate,
      ready: () => undefined,
      drop,
      switchSaves,
    }) as unknown as AreaViews;
  const render = async (hidden: readonly Buffer[], seen = 0, switchSaves = 0): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(BufferArea, {
          area: { side: "left", buffer: SHOWN, active: true },
          split: false,
          onActivate: () => undefined,
          views: views(seen, switchSaves),
          hidden,
        }),
      );
      await Promise.resolve();
    });
  };
  const reads = (ref: string): number =>
    call.mock.calls.filter(([name, input]) => name === "element.get" && input["ref"] === ref).length;
  return { render, reads, drop };
};

it("[SR-212/AK-tfck] a layer drawn in advance that goes while its reads wait at the gate sends none of them", async () => {
  // The reads of the shown element never answer, so the gate stays closed until the test opens it.
  const gate = new ReadGate(60_000);
  const { render, reads } = area(gate);
  await render([HIDDEN]);
  expect(container.querySelectorAll('[data-layer="neighbour"]')).toHaveLength(1);
  expect(reads("uuid-2")).toBe(1);
  expect(reads("uuid-1")).toBe(0);
  // The hidden layer goes; then the shown buffer is drawn and the gate opens.
  await render([]);
  expect(container.querySelectorAll('[data-layer="neighbour"]')).toHaveLength(0);
  await act(async () => {
    gate.show(SHOWN.key, true);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(gate.open).toBe(true);
  expect(reads("uuid-1")).toBe(0);
  gate.dispose();
});

it("[SR-212/AK-tfck] a layer drawn in advance is not read again after a change of the workspace, and asks to be dropped", async () => {
  const gate = new ReadGate(60_000);
  const { render, reads, drop } = area(gate, true);
  await render([HIDDEN]);
  await act(async () => {
    gate.show(SHOWN.key, true);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reads("uuid-1")).toBe(1);
  expect(drop).not.toHaveBeenCalled();
  // A change: the hidden view would read again; it sends nothing and is dropped.
  await render([HIDDEN], 1);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reads("uuid-1")).toBe(1);
  expect(drop).toHaveBeenCalledWith(HIDDEN.key);
  gate.dispose();
});

it("[SR-212/AK-tfck] a layer drawn in advance reads once more after the save of leaving an element, which belongs to the switch", async () => {
  const gate = new ReadGate(60_000);
  const { render, reads, drop } = area(gate, true);
  await render([HIDDEN]);
  await act(async () => {
    gate.show(SHOWN.key, true);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reads("uuid-1")).toBe(1);
  // The change of the save of leaving: read once more, not dropped.
  await render([HIDDEN], 1, 1);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reads("uuid-1")).toBe(2);
  expect(drop).not.toHaveBeenCalled();
  // A change after that one drops it.
  await render([HIDDEN], 2, 1);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reads("uuid-1")).toBe(2);
  expect(drop).toHaveBeenCalledWith(HIDDEN.key);
  gate.dispose();
});

it("[SR-212/AK-tfck] a layer drawn in advance that has not read yet is dropped by a change while its reads wait at the gate", async () => {
  const gate = new ReadGate(60_000);
  const { render, reads, drop } = area(gate, true);
  gate.show(SHOWN.key, true);
  gate.slide(true);
  // Mounted during a slide: its reads wait; a change (an autosave's) comes before the gate opens.
  await render([HIDDEN]);
  await render([HIDDEN], 1);
  await act(async () => {
    gate.slide(false);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reads("uuid-1")).toBe(0);
  expect(drop).toHaveBeenCalledWith(HIDDEN.key);
  gate.dispose();
});

it("[SR-212/AK-tfck] a layer drawn in advance is dropped by a save of leaving together with another change", async () => {
  const gate = new ReadGate(60_000);
  const { render, reads, drop } = area(gate, true);
  await render([HIDDEN]);
  await act(async () => {
    gate.show(SHOWN.key, true);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reads("uuid-1")).toBe(1);
  // Two changes, one of them the save of leaving: the other one drops it.
  await render([HIDDEN], 2, 1);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(reads("uuid-1")).toBe(1);
  expect(drop).toHaveBeenCalledWith(HIDDEN.key);
  gate.dispose();
});
