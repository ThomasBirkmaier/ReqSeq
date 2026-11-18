// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { PropertyInfo } from "./element-view.js";
import { GONE_CONFIRM_MS } from "./outside-change.js";
import { asCall, container, fakeCall, flush, press, query } from "./components.test-helper.js";
import { editorView, modelOf, mount, read, typeInto } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("a file changed outside under the input (SR-106)", () => {
    const CHANGED = 'SR-000001 (SR-036) Measure wind changed on disk. Resolve with "Resolve change on disk"';
    const DELETED =
      "SR-000001 (SR-036) Measure wind was deleted on disk; its content stays here until you close the buffer";
    /** An error of a command with its code. */
    const failure = (code: string, message: string): Error => Object.assign(new Error(message), { code });
    /**
     * The file on disk, read by `element.get` and written by `element.update` with core's precondition: an
     * `expectedFileSha256` that is not the file's refuses the write. `lag` refuses the next write as a store
     * of core that has not read the file yet does.
     */
    const mountDisk = async (properties: Record<string, PropertyInfo> = {}) => {
      const disk = {
        text: "first",
        properties: { topic: "Wind" } as Record<string, unknown>,
        sha: "sha-1",
        gone: false,
        lag: false,
        writes: 0,
      };
      const call = fakeCall({
        "element.get": () =>
          disk.gone
            ? failure("ref.unknown", "uuid-1 is no longer in a.md: the file changed on disk")
            : {
                element: read({ text: disk.text, properties: disk.properties, relations: [] }),
                fileSha256: disk.sha,
              },
        "element.update": (input) => {
          if (disk.gone) {
            return failure("ref.unknown", "uuid-1 is not an element of the workspace");
          }
          if (
            disk.lag ||
            (input["expectedFileSha256"] !== undefined && input["expectedFileSha256"] !== disk.sha)
          ) {
            disk.lag = false;
            return failure(
              "file.changed-on-disk",
              "Not written: a.md changed on disk since it was read. Read it again first.",
            );
          }
          disk.writes += 1;
          disk.text = typeof input["text"] === "string" ? input["text"] : disk.text;
          disk.properties = { ...disk.properties, ...(input["set"] as Record<string, unknown> | undefined) };
          disk.sha = `sha-saved-${String(disk.writes)}`;
          return {
            element: read({ text: disk.text, properties: disk.properties, relations: [] }),
            fileSha256: disk.sha,
            files: ["a.md"],
            affected: 0,
          };
        },
      });
      const mounted = await mount(asCall(call), 0, undefined, {
        properties: modelOf({ topic: { kind: "text", many: false, markdown: false }, ...properties }),
      });
      /** Changes the file outside the app, and the buffer reads it again. */
      let revision = 0;
      const outside = async (change: {
        text?: string;
        properties?: Record<string, unknown>;
        gone?: boolean;
      }) => {
        Object.assign(disk, change);
        disk.sha = `sha-outside-${String(revision)}`;
        revision += 1;
        await mounted.again(revision);
      };
      const updates = () =>
        call.mock.calls.filter(([name]) => name === "element.update").map(([, input]) => input);
      const choose = async (name: string): Promise<void> => {
        act(() => {
          mounted.controls().resolve?.();
        });
        await act(async () => {
          mounted.asked
            .at(-1)
            ?.items.find((item) => item.name === name)
            ?.run();
          await Promise.resolve();
        });
        await flush();
      };
      const topicView = (): EditorView => {
        const found = EditorView.findFromDOM(query('[data-field="topic"] .cm-editor'));
        if (found === null) {
          throw new Error("no editor");
        }
        return found;
      };
      return { ...mounted, disk, call, outside, updates, choose, topicView };
    };
    const blocks = (): string[] =>
      [...container.querySelectorAll<HTMLElement>("[data-on-disk]")].map((block) => block.textContent);
    /** A read that found the file gone asks again after a batch of the watcher; still gone, it is deleted. */
    const confirmGone = async (): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(GONE_CONFIRM_MS);
      });
      await flush();
    };
    afterEach(() => {
      vi.useRealTimers();
    });

    it('[SR-106/AK-ydc8] with input an outside change is not saved over: both versions are shown, and "Keep my input" writes only the fields with input on the new file', async () => {
      const { disk, outside, echoed, controls, choose, updates, data, drafts } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs", properties: { topic: "Gusts" } });
      // Not saved: the input stays in the editor, the file's version is below it, and the box without
      // input follows the file.
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(blocks()).toEqual(["On disktheirs"]);
      expect(query('[data-field="topic"]').textContent).toContain("Gusts");
      expect(echoed).toEqual([CHANGED]);
      expect(data.at(-1)?.[1]).toMatchObject({ disk: "changed" });
      // "Save element" says what to do first, and writes nothing.
      act(() => {
        controls().save();
      });
      expect(echoed.at(-1)).toBe("Resolve the change on disk first");
      expect(updates()).toEqual([]);
      await choose("Keep my input");
      expect(updates()).toEqual([{ ref: "uuid-1", text: "first!", expectedFileSha256: "sha-outside-0" }]);
      expect(disk).toMatchObject({ text: "first!", properties: { topic: "Gusts" } });
      expect(echoed.at(-1)).toBe("Saved SR-000001 (SR-036) Measure wind");
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      expect(data.at(-1)?.[1]).not.toHaveProperty("disk");
    });

    it('[SR-106/AK-ydc8] "Take the file" puts the file\'s version into the editor and writes nothing; Ctrl+Z brings the input back', async () => {
      const { disk, outside, controls, choose, updates, drafts } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs" });
      await choose("Take the file");
      expect(editorView().state.doc.toString()).toBe("theirs");
      expect(updates()).toEqual([]);
      expect(disk.text).toBe("theirs");
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      // The input is not lost: one undo brings it back, as input on the new file.
      act(() => {
        undo(editorView());
      });
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(drafts.at(-1)).toEqual([
        "element:spec:uuid-1",
        { text: "first!", base: "theirs", sha: "sha-outside-0" },
      ]);
      expect(blocks()).toEqual([]);
    });

    it('[SR-106/AK-ydc8] "Take the file" takes the file\'s value of a box with input too, and of a choice', async () => {
      const area: PropertyInfo = {
        name: "Area",
        kind: "choice",
        many: false,
        markdown: false,
        choices: [
          { key: "quality", name: "Quality" },
          { key: "interface", name: "Interface" },
        ],
      };
      const { disk, outside, choose, topicView, asked, controls } = await mountDisk({ area });
      disk.properties = { topic: "Wind", area: "quality" };
      await outside({});
      act(() => {
        topicView().dispatch({ changes: { from: 4, insert: "y" } });
      });
      await act(async () => {
        query('[data-field="area"]').focus();
        await Promise.resolve();
      });
      await press(query('[data-field="area"]'), "Enter");
      await act(async () => {
        asked
          .at(-1)
          ?.items.find((item) => item.name === "Interface")
          ?.run();
        await Promise.resolve();
      });
      await outside({ properties: { topic: "Calm", area: "quality" } });
      expect(blocks()).toEqual(["On diskCalm", "On diskQuality"]);
      await choose("Take the file");
      expect(topicView().state.doc.toString()).toBe("Calm");
      expect(query('[data-field="area"]').textContent).toContain("quality");
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
    });

    it('Enter on a block "On disk" asks which version holds, Escape goes back to the buffer', async () => {
      const { outside, asked } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs" });
      const block = query('[data-on-disk="Text"]');
      await act(async () => {
        block.focus();
        await Promise.resolve();
      });
      await press(block, "Enter", { shiftKey: true });
      expect(asked).toEqual([]);
      await press(block, "Enter");
      expect(asked.at(-1)?.label).toBe("Resolve change on disk");
      expect(asked.at(-1)?.items.map((item) => item.name)).toEqual(["Keep my input", "Take the file"]);
      await press(block, "Escape");
      expect(document.activeElement).toBe(query("article"));
    });

    it("updates the blocks on another change, and ends the conflict without asking when the file holds the input or the bytes it was typed on again", async () => {
      const { disk, outside, echoed, controls } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs" });
      await outside({ text: "theirs again" });
      expect(blocks()).toEqual(["On disktheirs again"]);
      expect(echoed).toEqual([CHANGED]);
      // The file holds the input: nothing is unsaved, nothing to resolve.
      await outside({ text: "first!" });
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
      // Typed on the file as it is now, then the file goes away from it and back to it.
      await typeInto("?");
      await outside({ text: "other" });
      expect(blocks()).toEqual(["On diskother"]);
      Object.assign(disk, { text: "first!" });
      const back = disk.sha;
      await outside({});
      disk.sha = back;
      await outside({ text: "first!" });
      expect(echoed).toHaveLength(2);
    });

    it("ends the conflict when the input is typed to what the file holds", async () => {
      const { outside, controls } = await mountDisk();
      await typeInto("!");
      await outside({ text: "first!?" });
      expect(blocks()).toEqual(["On diskfirst!?"]);
      await typeInto("?");
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
    });

    it("saves again once, silently, when core's store had not read the file the buffer shows (ThomasBirkmaier/ReqSeq-archive#493 F2)", async () => {
      const { disk, echoed, controls, updates } = await mountDisk();
      await typeInto("!");
      disk.lag = true;
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
      expect(updates()).toHaveLength(2);
      expect(disk.text).toBe("first!");
      expect(echoed).toEqual(["Saved SR-000001 (SR-036) Measure wind"]);
    });

    it("says why when the second write is refused too, and keeps the input", async () => {
      const { disk, echoed, controls, call } = await mountDisk();
      await typeInto("!");
      call.mockImplementation((name: string) =>
        Promise.resolve(
          name === "element.update"
            ? { ok: false, code: "file.changed-on-disk", message: "Not written: a.md changed on disk" }
            : { ok: true, output: { element: read({ text: "first", relations: [] }), fileSha256: disk.sha } },
        ),
      );
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
      expect(echoed).toEqual(["Not written: a.md changed on disk"]);
      expect(editorView().state.doc.toString()).toBe("first!");
    });

    it("[SR-106/AK-ydc8] follows the rule for a change from outside when a save finds the file changed before the watcher said so", async () => {
      const { disk, echoed, controls, updates } = await mountDisk();
      await typeInto("!");
      Object.assign(disk, { text: "theirs", sha: "sha-unseen" });
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
      expect(updates()).toHaveLength(1);
      expect(disk.text).toBe("theirs");
      expect(blocks()).toEqual(["On disktheirs"]);
      expect(echoed).toEqual([CHANGED]);
    });

    it("[SR-106/AK-v420] keeps the content in the read-only editor when the file is deleted, names the deletion, and writes nothing", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { outside, echoed, controls, copies, updates, data, disk } = await mountDisk();
      await typeInto("!");
      await outside({ gone: true });
      // The first read that finds the file gone is no deletion yet: a file being written is not known either.
      expect(echoed).toEqual([]);
      expect(editorView().state.readOnly).toBe(false);
      await confirmGone();
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(query(".cm-content").getAttribute("contenteditable")).toBe("false");
      expect(query('[data-field="topic"] .cm-content').getAttribute("contenteditable")).toBe("false");
      expect(echoed).toEqual([DELETED]);
      expect(data.at(-1)?.[1]).toMatchObject({ disk: "deleted" });
      // Nothing is saved or changed; the content can still be copied.
      for (const run of [
        () => {
          controls().save();
        },
        () => {
          controls().addProperty();
        },
        () => {
          query('[data-field="topic"]').focus();
          controls().clearProperty();
        },
      ]) {
        act(run);
      }
      expect(updates()).toEqual([]);
      expect(echoed.slice(1)).toEqual([DELETED, DELETED, DELETED]);
      act(() => {
        controls().copy();
      });
      expect(copies).toEqual([["topic", "Wind"]]);
      // Asked again while gone, it says nothing more.
      await outside({ gone: true });
      expect(echoed).toHaveLength(4);
      // The file comes back: the buffer is editable again, and its input on other bytes is a conflict.
      disk.gone = false;
      await outside({ gone: false });
      expect(query(".cm-content").getAttribute("contenteditable")).toBe("true");
      expect(data.at(-1)?.[1]).toMatchObject({ disk: "changed" });
      expect(editorView().state.doc.toString()).toBe("first!");
    });

    it("[SR-106/AK-v420] a save on a file that is gone finds the deletion, and the choices then say so", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { disk, outside, echoed, controls, choose } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs" });
      Object.assign(disk, { gone: true });
      await choose("Keep my input");
      expect(echoed).toEqual([CHANGED]);
      await confirmGone();
      expect(echoed).toEqual([CHANGED, DELETED]);
      await choose("Keep my input");
      await choose("Take the file");
      expect(echoed).toEqual([CHANGED, DELETED, DELETED, DELETED]);
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(controls().resolve).toBeDefined();
    });

    it("keeps the element and echoes a failed read that is no deletion", async () => {
      const { echoed, call, again } = await mountDisk();
      await typeInto("!");
      const plain = call.getMockImplementation();
      call.mockImplementation((name: string, input: Record<string, unknown>) =>
        name === "element.get"
          ? Promise.resolve({ ok: false, code: "file.faulty", message: "a.md is faulty now" })
          : (plain?.(name, input) ?? Promise.resolve({ ok: true, output: undefined })),
      );
      await again(5);
      expect(echoed).toEqual(["a.md is faulty now"]);
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(query(".cm-content").getAttribute("contenteditable")).toBe("true");
    });
  });
});
