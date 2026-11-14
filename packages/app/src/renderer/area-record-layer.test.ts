// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460).
import "../../../../scripts/test-support/dom-selection.mjs";
// The layers of an area drawn from a record (SR-212 AK5, `area-record.ts`): a buffer that the app does not
// read for drawing in advance is drawn hidden after the reader leaves it only from what its shown view read, and
// dropped, without a read, after any change of what it shows. Also: a hidden view read for drawing in advance
// is not read again after a change of the view of the window, and the draw a swipe asks for (SR-211 AK3).
import type { DataExportElement } from "@reqseq/core";
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
import type { DrawnBy } from "./neighbours.js";
import { NO_CHANGES } from "./outside-marks.js";
import { NO_FACETS } from "./package-summary-test-data.js";
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

const A = elementBuffer("uuid-a", "spec", "SR-00000a Left");
const B = elementBuffer("uuid-b", "spec", "SR-00000b Shown");

const elementOf = (id: string): DataExportElement => ({
  id,
  shortId: id.toUpperCase(),
  type: "requirement",
  status: "draft",
  title: id,
  text: "text",
  repository: "spec",
  file: `${id}.md`,
  properties: {},
  relations: [],
});

interface Options {
  readonly seen?: number;
  readonly call?: Call;
  readonly typeNames?: ReadonlyMap<string, string>;
  readonly stopped?: boolean;
  readonly clean?: boolean;
}

/** An area over a core that answers every read; those of the elements in `held` only at `release`. */
const harness = (gate: ReadGate) => {
  const held = new Set<string>();
  const waiting: (() => void)[] = [];
  const call = vi.fn((name: string, input: Record<string, unknown>) => {
    const ref = String(input["ref"]);
    if (name === "element.get") {
      const answer = { ok: true, output: { element: elementOf(ref), fileSha256: `sha-${ref}` } };
      return held.has(ref)
        ? new Promise((resolve) => {
            waiting.push(() => {
              resolve(answer);
            });
          })
        : Promise.resolve(answer);
    }
    if (name === "trace.neighbourhood") {
      return Promise.resolve({
        ok: true,
        output: { root: ref, nodes: [], total: 0, edges: [], incomplete: false },
      });
    }
    return Promise.resolve(name === "element.facets" ? NO_FACETS : { ok: true, output: {} });
  });
  const drop = vi.fn<(key: string) => void>();
  const ready =
    vi.fn<(key: string, mount: number, generation: number | undefined, recorded: boolean) => void>();
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
  const views = (options: Options): AreaViews => ({
    call: options.call ?? (call as unknown as Call),
    revision: options.seen ?? 0,
    seen: options.seen ?? 0,
    outside: NO_CHANGES,
    dispatch: () => undefined,
    onData: () => undefined,
    onEcho: () => undefined,
    onDrawn: () => undefined,
    typeNames: options.typeNames ?? new Map(),
    kindNames: new Map(),
    overview: {
      data: undefined,
      perspectives: [],
      recents: [],
      recent: [],
      openPerspective: () => undefined,
    },
    element,
    gate,
    ready,
    clean: () => options.clean ?? true,
    stopped: options.stopped ?? false,
    drop,
    switchSaves: 0,
  });
  const render = async (
    shown: Buffer,
    hidden: readonly (readonly [Buffer, DrawnBy])[],
    options: Options = {},
  ): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(BufferArea, {
          area: { side: "left", buffer: shown, active: true },
          split: false,
          onActivate: () => undefined,
          views: views(options),
          hidden: hidden.map(([buffer, by]) => ({ buffer, by })),
        }),
      );
      await Promise.resolve();
    });
    await settle();
  };
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 6; round += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  };
  const reads = (ref: string): number =>
    call.mock.calls.filter(([name, input]) => name === "element.get" && input["ref"] === ref).length;
  const hiddenLayers = (): number => container.querySelectorAll('[data-layer="neighbour"]').length;
  /** Shows `key` drawn, so the reads drawn in advance may go. */
  const open = async (key: string): Promise<void> => {
    gate.show(key, true);
    await settle();
  };
  const release = async (): Promise<void> => {
    for (const answer of waiting.splice(0)) {
      answer();
    }
    await settle();
  };
  return { call, held, release, drop, ready, render, settle, reads, hiddenLayers, open };
};

/** Shows A, then B with A beside it, drawn by `by`. */
const leaveA = async (area: ReturnType<typeof harness>, by: DrawnBy = "record"): Promise<void> => {
  await area.render(A, []);
  await area.open(A.key);
  await area.render(B, [[A, by]]);
  await area.open(B.key);
};

it("[SR-212/AK-tfck] a buffer left is drawn hidden from what its shown view read, without a read of the workspace", async () => {
  const gate = new ReadGate(60_000);
  const area = harness(gate);
  await leaveA(area);
  expect(area.reads("uuid-a")).toBe(1);
  expect(area.hiddenLayers()).toBe(1);
  expect(container.querySelector('[data-layer="neighbour"] article')?.getAttribute("aria-label")).toBe(
    "SR-00000a Left",
  );
  expect(area.ready).toHaveBeenCalledWith(A.key, 1, 0, true);
  expect(area.drop).not.toHaveBeenCalled();
  // It stays drawn while it stays beside the shown buffer, and reads nothing.
  await area.render(B, [[A, "record"]]);
  expect(area.reads("uuid-a")).toBe(1);
  gate.dispose();
});

it("[SR-212/AK-tfck] a buffer drawn from its record is dropped after a change of the workspace, and not read", async () => {
  const gate = new ReadGate(60_000);
  const area = harness(gate);
  await leaveA(area);
  await area.render(B, [[A, "record"]], { seen: 1 });
  expect(area.drop).toHaveBeenCalledWith(A.key);
  expect(area.reads("uuid-a")).toBe(1);
  // Its record is gone: beside the shown buffer again, it is not drawn until it was shown.
  await area.render(B, []);
  await area.render(B, [[A, "record"]], { seen: 1 });
  expect(area.hiddenLayers()).toBe(0);
  expect(area.reads("uuid-a")).toBe(1);
  gate.dispose();
});

it("[SR-212/AK-tfck] a buffer left before it was drawn misses its record: dropped, never ready, nothing sent", async () => {
  const gate = new ReadGate(60_000);
  const area = harness(gate);
  area.held.add("uuid-a");
  await leaveA(area);
  // Its read answers after it was left: that answer is not kept for it.
  area.held.clear();
  await area.release();
  expect(area.reads("uuid-a")).toBe(1);
  expect(area.drop).toHaveBeenCalledWith(A.key);
  expect(area.ready).not.toHaveBeenCalledWith(A.key, expect.anything(), 0, true);
  gate.dispose();
});

it("[SR-212/AK-tfck] a buffer drawn from its record is dropped when the names of the metamodel change or the core process stops", async () => {
  for (const change of [{ typeNames: new Map([["requirement", "Requirement"]]) }, { stopped: true }]) {
    const gate = new ReadGate(60_000);
    const area = harness(gate);
    await leaveA(area);
    expect(area.drop).not.toHaveBeenCalled();
    await area.render(B, [[A, "record"]], change);
    expect(area.drop).toHaveBeenCalledWith(A.key);
    expect(area.reads("uuid-a")).toBe(1);
    gate.dispose();
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
  }
});

it("[SR-212/AK-tfck] a buffer drawn from its record and shown while leaving the buffer before changes something is a fresh view that reads", async () => {
  const gate = new ReadGate(60_000);
  const area = harness(gate);
  await leaveA(area);
  await area.render(A, [[B, "read"]], { clean: false });
  expect(area.reads("uuid-a")).toBe(2);
  gate.dispose();
});

it("[SR-212/AK-tfck] shown again while leaving changes nothing, the view drawn from its record is the one shown, with no read", async () => {
  const gate = new ReadGate(60_000);
  const area = harness(gate);
  await leaveA(area);
  const hidden = container.querySelector('[data-layer="neighbour"] article');
  await area.render(A, [[B, "read"]]);
  expect(container.querySelector('[data-layer="main"] article')).toBe(hidden);
  expect(area.reads("uuid-a")).toBe(1);
  gate.dispose();
});

it("[SR-212/AK-tfck] a view read for drawing in advance is not read again after a change of the view of the window, also while its reads wait at the gate", async () => {
  const gate = new ReadGate(60_000);
  const area = harness(gate);
  await area.render(B, [[A, "read"]]);
  await area.open(B.key);
  expect(area.reads("uuid-a")).toBe(1);
  // Another view: a new view-bound call; the hidden view would read with it.
  const inView = vi.fn((name: string, input: Record<string, unknown>) => area.call(name, input));
  await area.render(B, [[A, "read"]], { call: inView as unknown as Call });
  expect(area.reads("uuid-a")).toBe(1);
  expect(area.drop).toHaveBeenCalledWith(A.key);
  gate.dispose();

  // Mounted during a slide, the view is chosen before its reads may go.
  const later = new ReadGate(60_000);
  const waiting = harness(later);
  later.show(B.key, true);
  later.slide(true);
  await waiting.render(B, [[A, "read"]]);
  const other = vi.fn((name: string, input: Record<string, unknown>) => waiting.call(name, input));
  await waiting.render(B, [[A, "read"]], { call: other as unknown as Call });
  later.slide(false);
  await waiting.settle();
  expect(waiting.reads("uuid-a")).toBe(0);
  expect(other.mock.calls.filter(([, input]) => input["ref"] === "uuid-a")).toEqual([]);
  expect(waiting.drop).toHaveBeenCalledWith(A.key);
  later.dispose();
});

it("a buffer drawn for a swipe reads at once, as a shown one, and then stays drawn from what it read", async () => {
  const gate = new ReadGate(60_000);
  const area = harness(gate);
  // The gate is shut: a slide runs, and the shown buffer has not drawn yet.
  gate.slide(true);
  await area.render(B, [[A, "swipe"]]);
  expect(area.reads("uuid-a")).toBe(1);
  expect(area.ready).toHaveBeenCalledWith(A.key, 0, 0, false);
  // The swipe sprang back: A stays beside B, drawn from its record, and reads no more.
  await area.render(B, [[A, "record"]]);
  gate.slide(false);
  await area.open(B.key);
  expect(area.reads("uuid-a")).toBe(1);
  expect(area.drop).not.toHaveBeenCalled();
  expect(area.ready).toHaveBeenLastCalledWith(A.key, 0, 0, true);
  gate.dispose();
});

it("a buffer drawn for a swipe reads again after a change, as a shown one, and is not drawn in advance from the read before", async () => {
  const gate = new ReadGate(60_000);
  const area = harness(gate);
  await area.render(B, []);
  await area.open(B.key);
  await area.render(B, [[A, "swipe"]]);
  expect(area.reads("uuid-a")).toBe(1);
  expect(area.ready).toHaveBeenLastCalledWith(A.key, 0, 0, false);
  // A change of the workspace while the swipe draws A: A reads again, as a shown buffer does, and is ready in
  // the new generation only once that read is in.
  await area.render(B, [[A, "swipe"]], { seen: 1 });
  expect(area.reads("uuid-a")).toBe(2);
  expect(area.drop).not.toHaveBeenCalled();
  expect(area.ready).toHaveBeenLastCalledWith(A.key, 0, 1, false);
  // The swipe springs back: A stays beside B, drawn from that read.
  await area.render(B, [[A, "record"]], { seen: 1 });
  expect(area.drop).not.toHaveBeenCalled();
  expect(area.reads("uuid-a")).toBe(2);
  gate.dispose();
});
