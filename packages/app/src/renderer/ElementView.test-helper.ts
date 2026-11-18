// What the tests of ElementView share: an element as core reads it, and a mounted ElementView. Test code only.
import type { DataExportElement } from "@reqseq/core";
import { act, createElement } from "react";
import type { Prompt, ElementControls } from "./actions.js";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import { elementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { EditorView } from "@codemirror/view";
import { focusEffect } from "./editor/preview.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import { ElementView } from "./ElementView.js";
import { referenceTitles } from "./reference-titles.js";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import type { PackageModel } from "./package-page.js";
import type { Draft, ShownFile } from "./drafts.js";
import type { BufferData } from "./modeline.js";
import { query, render, root } from "./components.test-helper.js";

export const read = (extra: Partial<DataExportElement> = {}): DataExportElement => ({
  id: "uuid-1",
  shortId: "SR-000001",
  identifier: "SR-036",
  type: "system-requirement",
  status: "draft",
  title: "Measure wind",
  text: "Line one\n<b>not bold</b>",
  repository: "spec",
  file: "a.md",
  properties: {
    topic: "Wind",
    empty: "",
    criteria: ["first", "second"],
    packages: [{ id: "p", title: "Stage 3" }],
  },
  relations: [
    {
      kind: "derives-from",
      direction: "out",
      id: "n1",
      repository: "spec",
      shortId: "N-000001",
      identifier: "N-1",
      title: "Need",
      accessible: true,
      targetState: "available",
      storedVersion: "n1:aa",
    },
    {
      kind: "derives-from",
      direction: "out",
      id: "n2",
      repository: "vault",
      shortId: "N-000002",
      accessible: false,
      targetState: "inaccessible",
    },
    {
      kind: "derives-from",
      direction: "in",
      id: "r1",
      repository: "platform",
      shortId: "SR-000009",
      title: "Child",
      accessible: true,
      targetState: "available",
    },
    {
      kind: "packages",
      property: true,
      direction: "out",
      id: "p",
      repository: "spec",
      accessible: true,
      targetState: "available",
      title: "Stage 3",
    },
  ],
  ...extra,
});

/** Takes the element buffer away, so the next mount starts a new one (a mount over a mounted one is a reload). */
export const fresh = async (): Promise<void> => {
  await act(async () => {
    root.render(null);
    await Promise.resolve();
  });
};
/** Puts the caret of an editor at `anchor` and gives it the focus (a selection moved while focused needs the browser). */
export const caretAt = async (view: EditorView, anchor: number): Promise<void> => {
  await act(async () => {
    // An editor that has the focus keeps it while the caret moves, as with the keyboard: a blur in between
    // makes CodeMirror report the focus lost in this update and found again only 10 ms later, which a
    // busy machine lets the test see.
    if (view.hasFocus) {
      view.dispatch({ selection: { anchor } });
    } else {
      (document.activeElement as HTMLElement | null)?.blur();
      // (happy-dom sends no focus event to the editor; the preview learns of the focus by this effect.)
      view.dispatch({ selection: { anchor }, effects: focusEffect.of(true) });
      view.focus();
    }
    await Promise.resolve();
  });
};

/** The properties of the type of `read()` (or of another type): the model the buffer gets from `metamodel.get`. */
export const modelOf = (
  properties: Record<string, PropertyInfo>,
  type = "system-requirement",
): PropertyModel => new Map([[type, new Map(Object.entries(properties))]]);

/** A mounted ElementView: what it passed to the app, and a render with another revision. */
export interface Mounted {
  dispatched: BufferAction[];
  data: [string, BufferData | undefined][];
  echoed: string[];
  copies: [string, string][];
  targets: string[];
  opened: [string, string | undefined][];
  drafts: [string, Draft | undefined][];
  shownFiles: (ShownFile | undefined)[];
  registered: (ElementControls | undefined)[];
  picks: ReferenceRequest[];
  asked: Prompt[];
  controls: () => ElementControls;
  again: (rev: number) => Promise<void>;
}

export const mount = async (
  call: Call,
  revision = 0,
  draft?: Draft,
  extra: { packages?: PackageModel; properties?: PropertyModel; buffer?: ElementBuffer } = {},
): Promise<Mounted> => {
  const dispatched: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const copies: [string, string][] = [];
  const targets: string[] = [];
  const opened: [string, string | undefined][] = [];
  const drafts: [string, Draft | undefined][] = [];
  const shownFiles: (ShownFile | undefined)[] = [];
  const registered: (ElementControls | undefined)[] = [];
  const picks: ReferenceRequest[] = [];
  const asked: Prompt[] = [];
  const titles = referenceTitles(call);
  const node = (rev: number) =>
    createElement(ElementView, {
      call,
      titles,
      buffer: extra.buffer ?? elementBuffer("uuid-1", "spec", "SR-000001 (SR-036) Measure wind"),
      revision: rev,
      onData: (key, loaded) => data.push([key, loaded]),
      onEcho: (message) => echoed.push(message),
      onCopy: (label, text) => copies.push([label, text]),
      onOpenRelation: (target) => targets.push(target.key),
      onOpenResult: () => undefined,
      onOpenTarget: (id, repository) => {
        opened.push([id, repository]);
      },
      onPickElement: (request) => picks.push(request),
      onAsk: (prompt) => asked.push(prompt),
      draft,
      // The drafts as the input they hold; the element each keeps (`Draft.shown`) is in `shownFiles`.
      onDraft: (key, kept) => {
        if (kept === undefined) {
          drafts.push([key, undefined]);
        } else {
          const { shown, ...input } = kept;
          drafts.push([key, input]);
          shownFiles.push(shown);
        }
      },
      register: (controls) => registered.push(controls),
      packages: extra.packages,
      properties: extra.properties ?? new Map(),
      dispatch: (action) => dispatched.push(action),
    });
  await render(node(revision));
  return {
    dispatched,
    data,
    echoed,
    copies,
    targets,
    opened,
    drafts,
    shownFiles,
    registered,
    picks,
    asked,
    controls: (): ElementControls => {
      const found = registered.findLast((c) => c !== undefined);
      if (found === undefined) {
        throw new Error("no controls registered");
      }
      return found;
    },
    again: (rev: number) => render(node(rev)),
  };
};
export const editorView = (): EditorView => {
  const found = EditorView.findFromDOM(query(".cm-editor"));
  if (found === null) {
    throw new Error("no editor");
  }
  return found;
};
/** Types into the editor as the user does. */
export const typeInto = async (text: string): Promise<void> => {
  await act(async () => {
    editorView().dispatch({ changes: { from: editorView().state.doc.length, insert: text } });
    await Promise.resolve();
  });
};
export const saved = (
  text: string,
  extra: Partial<DataExportElement> = {},
): { element: DataExportElement; files: string[]; affected: number } => ({
  element: read({ text, ...extra }),
  files: ["a.md"],
  affected: 0,
});
