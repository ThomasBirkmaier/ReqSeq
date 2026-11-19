// How the focus moves in the element buffer (`ElementView.tsx`): into the title and the fields, from field to
// field and into the elements of a package page (SR-155), and the keys the buffer takes itself (`element-keys.ts`
// says which). Factories without hooks: `ElementView` calls each once per render where its code stood.
import { TITLE_FIELD } from "./element-view.js";
import type { ElementInput, ElementState } from "./element-input.js";
import type { ElementCommands } from "./element-commands.js";
import { fieldKey, fieldLabel, forBuffer, takesBackEdit } from "./element-keys.js";
import { ctrlStep, historyStep, isMac } from "./keys.js";
import { isLocked, isValueBox, isValueKind, lockNote } from "./property-edit.js";

/** Where the focus goes in the title and the fields. */
export interface ElementFocus {
  readonly fieldOf: (label: string) => HTMLElement | null | undefined;
  readonly titleEditable: () => boolean;
  readonly openTitle: (at: number | "start" | "end") => void;
  readonly editTitle: () => void;
  readonly enter: (label: string, at: "start" | "end", edit?: boolean) => boolean;
  readonly move: (order: readonly string[], from: string, by: 1 | -1, edit?: boolean) => boolean;
  readonly step: (from: string, by: 1 | -1) => boolean;
}

export const elementFocus = (state: ElementState, parts: Pick<ElementInput, "lockedNote">): ElementFocus => {
  const { article, members, now, diskState, boxEditors, titleFocus, setTitleOpen } = state;
  const { lockedNote } = parts;
  // The field with this label: "Text" has no tab stop of its own (its editor takes the focus).
  const fieldOf = (label: string): HTMLElement | null | undefined =>
    article?.querySelector<HTMLElement>(`[data-field="${CSS.escape(label)}"]`);
  // The title can be edited now (ThomasBirkmaier/ReqSeq-archive#621): the type has a title, the stored one holds no line break, and the
  // element is neither read-only nor gone.
  const titleEditable = (): boolean => {
    const title = now.current.boxes.get(TITLE_FIELD);
    return title !== undefined && !title.lineBreak && !now.current.readOnly && !diskState.current.deleted;
  };
  // Puts the caret into the title: its editor when it is there, else the editor comes into the heading and
  // takes the caret when it is made (two renders later).
  const openTitle = (at: number | "start" | "end"): void => {
    const editor = boxEditors.current.get(TITLE_FIELD);
    if (editor === undefined) {
      titleFocus.current = at;
      setTitleOpen(true);
    } else {
      editor.focus(at);
    }
  };
  // "Edit title": the caret at the end of the title, or why it cannot be edited.
  const editTitle = (): void => {
    const title = now.current.boxes.get(TITLE_FIELD);
    const note =
      lockedNote() ??
      (title === undefined
        ? `${now.current.buffer.name} has no title property: its type has none`
        : title.lineBreak
          ? lockNote(TITLE_FIELD, title)
          : undefined);
    if (note === undefined) {
      openTitle("end");
    } else {
      now.current.onEcho(note);
    }
  };
  // Puts the focus on a field: on the editor of a box (the text is the editor called "Text") at its start or
  // end when `edit` is set, else on the field itself. A box without a usable editor takes the focus itself.
  // False when there is nothing to take it.
  const enter = (label: string, at: "start" | "end", edit = true): boolean => {
    if (label === TITLE_FIELD && edit && titleEditable()) {
      openTitle(at);
      return true;
    }
    const editor = label === "Text" ? now.current.handle : boxEditors.current.get(label);
    // The text has no tab stop but its editor, so its editor takes the focus either way.
    if ((edit || label === "Text") && editor !== undefined && !editor.state().readOnly) {
      editor.focus(at);
      return true;
    }
    const field = fieldOf(label);
    field?.focus();
    return field?.hasAttribute("tabindex") === true;
  };
  // Moves to the next field in the order (`by` 1) or the one before, the first that can take the focus.
  const move = (order: readonly string[], from: string, by: 1 | -1, edit = true): boolean => {
    const rest =
      by === 1 ? order.slice(order.indexOf(from) + 1) : order.slice(0, order.indexOf(from)).reverse();
    return rest.some((label) => enter(label, by === 1 ? "start" : "end", edit));
  };
  // Down at the last line of an editor goes into the next field, Up at the first line into the one before:
  // the text, then the boxes in the order they are shown (`editor/box-navigation.ts`). Down at the last line of
  // the last field goes into the elements of a package page, as from a field (SR-155 AK4).
  const step = (from: string, by: 1 | -1): boolean => {
    if (move([TITLE_FIELD, "Text", ...now.current.boxKeys], from, by)) {
      return true;
    }
    const list =
      by === 1 && (members?.total ?? 0) > 0 ? article?.querySelector<HTMLElement>(".members .list") : null;
    list?.focus();
    return list !== null && list !== undefined;
  };
  return { fieldOf, titleEditable, openTitle, editTitle, enter, move, step };
};

/** The keys of the buffer and its fields. */
export interface ElementKeys {
  readonly enterField: (label: string | undefined) => void;
  readonly onBufferKey: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export const elementKeys = (
  state: ElementState,
  parts: Pick<ElementInput, "lockedNote" | "stepValue"> &
    Pick<ElementFocus, "titleEditable" | "openTitle" | "enter" | "move"> &
    Pick<ElementCommands, "openValue">,
): ElementKeys => {
  const { article, members, boxKeys, buffer, dispatch, now, boxEditors, textEditor, editAsked } = state;
  const { lockedNote, stepValue, titleEditable, openTitle, enter, move, openValue } = parts;
  // Down on the page of a package goes into its elements; Escape and Up on the first row come back.
  const intoMembers = (root: HTMLElement): void => {
    root.querySelector<HTMLElement>(".members .list")?.focus();
  };
  // Enter on a choice or relation box asks for the value in the command prompt (SR-104 AK3); on the title or a box
  // with an editor it puts the caret at the end, else (a title or a box that is not edited) in the text.
  const enterField = (label: string | undefined): void => {
    if (label === TITLE_FIELD && titleEditable()) {
      openTitle("end");
      return;
    }
    const editable = label === undefined ? undefined : now.current.boxes.get(label);
    const box = label === undefined ? undefined : boxEditors.current.get(label);
    if (editable !== undefined && isValueKind(editable.info.kind)) {
      if (editable.unmatched === true) {
        now.current.onEcho(lockNote(editable.key, editable));
      } else {
        openValue(editable);
      }
    } else if (box !== undefined && !box.state().readOnly) {
      box.focus("end");
    } else if (textEditor.current === undefined) {
      editAsked.current = true;
    } else {
      textEditor.current.focus("end");
    }
  };
  // Up and Down on a field move to the field before and after, and Down on the last one into the elements of
  // a package. Down on the element itself goes into the elements of a package, else to its first field, where
  // the highlight shows (SR-155, #552).
  const onArrow = (down: boolean, label: string | undefined, root: HTMLElement): void => {
    const fields = [TITLE_FIELD, "Text", ...boxKeys];
    const hasMembers = (members?.total ?? 0) > 0;
    if (label === undefined && !hasMembers) {
      fields.some((next) => enter(next, "start", false));
    } else if ((label === undefined || !move(fields, label, down ? 1 : -1, false)) && down && hasMembers) {
      intoMembers(root);
    }
  };
  // Enter on a box edits it (on the buffer itself, the text); Escape leaves a box for the buffer; the arrows
  // move between the fields (`onArrow`).
  const onField = (key: string, label: string | undefined, root: HTMLElement): void => {
    if (key === "Enter") {
      enterField(label);
    } else if (key === "Escape") {
      article?.focus();
    } else {
      onArrow(key === "ArrowDown", label, root);
    }
  };
  // Ctrl+N on the page of a package selects its first element (SR-122 AK4); on any other element it goes to the
  // first field, as Down does (SR-155, #552). Not from an editor or the list
  // itself (they are not the buffer); Ctrl+P on the element itself is not the page's: it is the window's. On a
  // field Ctrl+N and Ctrl+P are Down and Up, and Ctrl+P on the first field only moves, it is not "Go to" (SR-155 AK4).
  const onCtrl = (step: 1 | -1, label: string | undefined, hasMembers: boolean, root: HTMLElement): void => {
    if (label !== undefined) {
      onArrow(step === 1, label, root);
    } else if (hasMembers) {
      dispatch({ type: "cursor", key: buffer.key, cursor: 0 });
      intoMembers(root);
    } else {
      onArrow(true, undefined, root);
    }
  };
  // Undo and redo on a choice or relation box step through its value history (SR-105 AK2). True when the
  // key was one of them on such a box.
  const valueHistoryKey = (event: React.KeyboardEvent<HTMLElement>, label: string | undefined): boolean => {
    const value = label === undefined ? undefined : now.current.boxes.get(label);
    const step = historyStep(event, isMac(navigator.platform));
    if (step === undefined || value === undefined || !isValueBox(value)) {
      return false;
    }
    event.preventDefault();
    const note = lockedNote() ?? (isLocked(value) ? lockNote(value.key, value) : undefined);
    if (note === undefined) {
      stepValue(value.key, step === "undo");
    } else {
      now.current.onEcho(note);
    }
    return true;
  };
  // Enter with a modifier is a shortcut ("Follow reference") and goes on to the window. Keys of a control
  // inside the buffer (the editor, the list of a package page) are not for the buffer. A field that has the
  // focus itself (the title, a box: SR-128) is the buffer as well.
  const onBufferKey = (event: React.KeyboardEvent<HTMLElement>): void => {
    const { key, target, currentTarget } = event;
    if (!forBuffer(target, currentTarget)) {
      return;
    }
    // A later key on the buffer (Escape, an arrow) takes back an "Edit text" that still waits for the editor;
    // a modifier pressed on its own (Shift for a capital letter) does not.
    if (takesBackEdit(key)) {
      editAsked.current = false;
    }
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const label = fieldLabel(target, currentTarget);
    const hasMembers = (members?.total ?? 0) > 0;
    const ctrl = ctrlStep(event);
    if (valueHistoryKey(event, label)) {
      return;
    }
    if (plain && fieldKey(key, label)) {
      event.preventDefault();
      onField(key, label, currentTarget);
    } else if (!event.defaultPrevented && ctrl !== undefined && (label !== undefined || ctrl === 1)) {
      event.preventDefault();
      onCtrl(ctrl, label, hasMembers, currentTarget);
    }
  };
  return { enterField, onBufferKey };
};
