// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { asCall, container, fakeCall, press, query } from "./components.test-helper.js";
import { editorView, mount, read } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("the slash menu (SR-129)", () => {
    const typeSlash = async (query: string): Promise<void> => {
      for (const char of `/${query}`) {
        await act(async () => {
          const head = editorView().state.selection.main.head;
          editorView().dispatch({
            changes: { from: head, insert: char },
            selection: { anchor: head + 1 },
            userEvent: "input.type",
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      }
    };

    it("[SR-129/AK-y6nx] opens at the cursor when / is typed in the text of the element", async () => {
      await mount(asCall(fakeCall({ "element.get": () => ({ element: read({ text: "" }) }) })));
      await typeSlash("");
      expect(container.querySelectorAll(".cm-tooltip-autocomplete li").length).toBeGreaterThan(10);
    });

    it("[SR-129/AK-nxbm] asks the app for an element, and writes the reference: the title within the repository of the buffer", async () => {
      const { picks } = await mount(
        asCall(fakeCall({ "element.get": () => ({ element: read({ text: "" }) }) })),
      );
      await typeSlash("ref");
      await press(query(".cm-content"), "Enter");
      expect(picks).toHaveLength(1);
      act(() => {
        picks[0]?.insert({
          id: "uuid-2",
          title: "Wind",
          label: "SR-001",
          shortId: "SR-0002",
          repository: "spec",
        });
      });
      expect(editorView().state.doc.toString()).toBe("[Wind](reqseq:uuid-2)");
      act(() => {
        picks[0]?.insert({
          id: "uuid-3",
          title: "Wind",
          label: "SR-001",
          shortId: "SR-0003",
          repository: "other",
        });
      });
      expect(editorView().state.doc.toString()).toBe(
        "[Wind](reqseq:uuid-2)[SR-0003](reqseq:uuid-3?version=&repository=other)",
      );
    });
  });
});
