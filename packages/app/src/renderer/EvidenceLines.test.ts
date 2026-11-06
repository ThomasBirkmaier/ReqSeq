// @vitest-environment happy-dom
// The evidence lines of an element page ask evidence.list for the element of its repository, so an element
// whose UUID a file in another repository shares (SR-088) shows its records too (#821).
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ElementGetOutput } from "@reqseq/core";
import type { Call } from "./call.js";
import { EvidenceLines } from "./EvidenceLines.js";

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

describe("EvidenceLines", () => {
  it("asks evidence.list for the element of its repository", async () => {
    const calls: unknown[] = [];
    const call = ((name: string, input: unknown) => {
      calls.push([name, input]);
      return Promise.resolve({
        ok: true,
        output: { records: [], testCases: [], problems: [], incomplete: false },
      });
    }) as Call;
    const element = { verification: [] } as unknown as ElementGetOutput["element"];
    await act(async () => {
      root.render(
        createElement(EvidenceLines, {
          call,
          buffer: { id: "uuid-1", repository: "sensor" },
          revision: 0,
          outside: 0,
          ownSaves: () => 0,
          output: { element },
          onOpenRelation: () => undefined,
        }),
      );
      await Promise.resolve();
    });
    expect(calls).toEqual([["evidence.list", { ref: "uuid-1", repository: "sensor" }]]);
  });
});
