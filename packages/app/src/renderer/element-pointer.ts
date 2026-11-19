// What the cursor and the pointer are on in the element buffer (`ElementView.tsx`): the value a click or the
// cursor points at, the list of the elements with it (SR-132), the plain click on a choice (SR-156) and the row
// of a relation box that "Follow reference" opens. `useValueFacets` holds no effect; `elementPointer` is a
// factory without hooks. `ElementView` calls each once per render where its code stood.
import { EditorView } from "@codemirror/view";
import type { RefObject } from "react";
import { useRef } from "react";
import type { DataExportElement } from "@reqseq/core";
import { filteredList } from "./buffers.js";
import type { Answer } from "./call.js";
import { PROMPT_INPUT, cursorField } from "./copy.js";
import type { ElementSaves } from "./element-file.js";
import type { ElementInput, ElementNow, ElementState } from "./element-input.js";
import type { ElementKeys } from "./element-navigation.js";
import { focusedTarget } from "./element-view-hooks.js";
import type { OutsideChanges } from "./outside-marks.js";
import type { ListableValue, Pointer } from "./value-list.js";
import {
  NO_POINTER,
  clickedValue,
  listableValues,
  pointedValue,
  valueSignature,
  valuesPrompt,
} from "./value-list.js";

/**
 * The field whose value a click on `target` is in (SR-132 AK1): not the key of a box, and not the label of
 * a reference, which a press already follows.
 */
const clickedBox = (target: Element): string | undefined => {
  const field = target.closest<HTMLElement>("[data-field]");
  const value = target.closest(".value");
  return field !== null && value !== null && field.contains(value) && target.closest(".cm-lr-ref") === null
    ? field.dataset["field"]
    : undefined;
};

/** Whether text is selected in the value `target` is in: the click ended a drag that selected it. */
const selectedIn = (target: Element): boolean => {
  const value = target.closest(".value");
  const selection = target.ownerDocument.getSelection();
  return (
    value !== null && selection !== null && !selection.isCollapsed && selection.containsNode(value, true)
  );
};

/** What a click on `target` in the box `key` points at: a target link, a line of a text or choice box, else the box. */
const clickedIn = (key: string, target: Element): Pointer => {
  const link = target.closest<HTMLElement>('[role="link"][data-target-id]');
  if (link !== null) {
    return {
      kind: "box",
      key,
      target: { id: link.dataset["targetId"] ?? "", repository: link.dataset["targetRepository"] ?? "" },
    };
  }
  const editorLine = target.closest<HTMLElement>(".cm-line");
  const editor = editorLine?.closest<HTMLElement>(".cm-editor");
  const view = editor === null || editor === undefined ? null : EditorView.findFromDOM(editor);
  if (editorLine !== null && view !== null) {
    return { kind: "box", key, line: view.state.doc.lineAt(view.posAtDOM(editorLine)).text };
  }
  const line = target.closest(".line");
  return line === null ? { kind: "box", key } : { kind: "box", key, line: line.textContent };
};

/** The values of the element that open a list, as `element.facets` gave them, and the question that is open. */
export interface ValueFacets {
  readonly facetsAsked: RefObject<
    { readonly key: string; readonly answer: Promise<Answer<"element.facets">> } | undefined
  >;
  readonly valueFacets: (element: DataExportElement) => Promise<Answer<"element.facets">>;
}

export const useValueFacets = (outside: OutsideChanges, now: RefObject<ElementNow>): ValueFacets => {
  // The values of the element that open a list (SR-132) are `element.facets` for it. They are asked when it
  // is shown and again only when its type, status or properties changed, or something changed outside (the
  // free-text rule counts the whole workspace); not after a save of the text alone (N-036).
  const facetsAsked = useRef<
    { readonly key: string; readonly answer: Promise<Answer<"element.facets">> } | undefined
  >(undefined);
  const outsideSeq = useRef(outside.seq);
  outsideSeq.current = outside.seq;
  const valueFacets = (element: DataExportElement): Promise<Answer<"element.facets">> => {
    const key = `${valueSignature(element)}\n${String(outsideSeq.current)}`;
    const asked = facetsAsked.current;
    if (asked?.key === key) {
      return asked.answer;
    }
    const answer = now.current.call("element.facets", { selection: { ids: [element.shortId] } });
    facetsAsked.current = { key, answer };
    // A failed answer is not kept: the next press asks again.
    void answer.then((settled) => {
      if (!settled.ok && facetsAsked.current?.answer === answer) {
        facetsAsked.current = undefined;
      }
    });
    return answer;
  };
  return { facetsAsked, valueFacets };
};

/** What the cursor and a click point at, and what they open. */
export interface ElementPointer {
  readonly relationFollowed: (label: string) => HTMLElement | undefined;
  readonly isRelationBox: (label: string) => boolean;
  readonly pointerNow: () => Pointer;
  readonly clickPointer: (target: Element) => Pointer;
  readonly listValue: (clicked?: Pointer) => Promise<void>;
  readonly clickChoice: (target: Element) => void;
}

export const elementPointer = (
  state: ElementState,
  parts: Pick<ElementInput, "inputDocs"> &
    Pick<ElementSaves, "flush"> &
    Pick<ValueFacets, "valueFacets"> &
    Pick<ElementKeys, "enterField">,
): ElementPointer => {
  const { article, dispatch, onAsk, now, boxEditors, lastField, pointed, shownFile, mounted } = state;
  const { inputDocs, flush, valueFacets, enterField } = parts;
  // The row of a relation box that "Follow reference" opens when no target link has the focus: the first
  // target; none when the box is no relation box, and the rows are not links when no target is available.
  // In this element only: another one may stand beside it (SR-115 AK3).
  const relationFollowed = (label: string): HTMLElement | undefined =>
    article?.querySelector<HTMLElement>(`[data-field="${CSS.escape(label)}"] .relation [role="link"]`) ??
    undefined;
  // The box is a relation box: its targets are rows, not text.
  const isRelationBox = (label: string): boolean =>
    now.current.boxes.get(label)?.info.kind === "relation" ||
    now.current.shown.some((box) => box.key === label && box.relations !== undefined);
  // What the cursor is on (SR-132): a box, the line with the caret in a text box, the focused target of a
  // relation box. A prompt takes the focus, so what it was on before the prompt opened is kept (`pointed`).
  const pointerNow = (): Pointer => {
    const label = cursorField(document.activeElement, lastField.current);
    if (label === undefined || !now.current.boxKeys.includes(label)) {
      return NO_POINTER;
    }
    const editor = boxEditors.current.get(label);
    if (editor?.hasFocus() === true) {
      const state = editor.state();
      return { kind: "box", key: label, line: state.doc.lineAt(state.selection.main.head).text };
    }
    const link = focusedTarget();
    return link?.closest<HTMLElement>("[data-field]")?.dataset["field"] === label
      ? {
          kind: "box",
          key: label,
          target: { id: link.dataset["targetId"] ?? "", repository: link.dataset["targetRepository"] ?? "" },
        }
      : { kind: "box", key: label };
  };
  // What a click on `target` points at (SR-132 AK1): a value of a property box, or nothing.
  // The property box whose value `target` is in, when it is one of the boxes shown.
  const clickedLabel = (target: Element): string | undefined => {
    const label = clickedBox(target);
    return label !== undefined && now.current.boxKeys.includes(label) ? label : undefined;
  };
  const clickPointer = (target: Element): Pointer => {
    const label = clickedLabel(target);
    return label === undefined ? NO_POINTER : clickedIn(label, target);
  };
  // The list of the elements with the value the cursor is on, or the value `clicked` (SR-132): the input is
  // saved first, so the value typed is the one listed (the list reads the files); then `element.facets` of
  // the element says which values can be listed. One value opens its list, several ask in the minibuffer.
  const listValue = async (clicked?: Pointer): Promise<void> => {
    const pointer = clicked ?? (document.activeElement?.id === PROMPT_INPUT ? pointed.current : pointerNow());
    // A save that did not happen (a change on disk, a read-only element) leaves the stored values, which
    // are what the list reads; the modeline already says why it was not saved.
    if (inputDocs().size > 0) {
      await flush();
    }
    const element = shownFile.current?.element;
    if (element === undefined) {
      return;
    }
    const answer = await valueFacets(element);
    if (!mounted.current) {
      return;
    }
    if (!answer.ok) {
      now.current.onEcho(answer.message);
      return;
    }
    const open = (value: ListableValue): void => {
      dispatch({ type: "open", buffer: filteredList([value.step]) });
    };
    const found = (clicked === undefined ? pointedValue : clickedValue)(
      listableValues(answer.output, now.current.boxKeys),
      pointer,
      element.relations,
    );
    if (found.kind === "open") {
      open(found.value);
    } else if (found.kind === "ask") {
      onAsk(valuesPrompt(found.values, open));
    } else if (clicked?.kind === "box") {
      now.current.onEcho(`No value of ${clicked.key} lists elements`);
    } else {
      now.current.onEcho(`No value of ${now.current.buffer.name} lists elements`);
    }
  };
  // A plain click on the value of a choice box opens the same prompt as Enter on the box (SR-156 AK1); a click
  // on its copy symbol is outside the value.
  // Text marked by dragging over the value is no click on it.
  const clickChoice = (target: Element): void => {
    const label = clickedLabel(target);
    if (label !== undefined && now.current.boxes.get(label)?.info.kind === "choice" && !selectedIn(target)) {
      enterField(label);
    }
  };
  return { relationFollowed, isRelationBox, pointerNow, clickPointer, listValue, clickChoice };
};
