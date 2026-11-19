// The controls the element buffer (`ElementView.tsx`) gives the app while it is shown in the active area
// (SR-115 AK3): saving, editing, the commands and "Follow reference". One layout effect, which `ElementView`
// calls where its code stood, so it runs in the same order with the other effects.
import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";
import type { ElementControls } from "./action-types.js";
import { PROMPT_INPUT, cursorField } from "./copy.js";
import type { EditorHandle } from "./editor/Editor.js";
import { goToHeading, headings as headingsOf } from "./editor/folding.js";
import { boxReference, referenceAt } from "./editor/references.js";
import type { Reference } from "./editor/references.js";
import { TITLE_FIELD } from "./element-view.js";
import type { ElementCommands } from "./element-commands.js";
import type { ElementSaves } from "./element-file.js";
import type { ElementState } from "./element-input.js";
import type { ElementFocus } from "./element-navigation.js";
import type { ElementPointer } from "./element-pointer.js";
import { focusedTarget } from "./element-view-hooks.js";
import type { ConflictField } from "./outside-change.js";
import type { PackageModel } from "./package-page.js";

/** The latest functions of a render of the buffer, which the controls call. */
export type ElementApi = Pick<
  ElementCommands,
  | "criterionAt"
  | "copyCriterionReference"
  | "addProperty"
  | "clearProperty"
  | "insertImage"
  | "textCommand"
  | "headingCommand"
> &
  Pick<ElementFocus, "editTitle"> &
  Pick<ElementSaves, "resolve" | "saveInput" | "inputGoing" | "flush"> &
  Pick<
    ElementPointer,
    "relationFollowed" | "isRelationBox" | "pointerNow" | "clickPointer" | "clickChoice" | "listValue"
  >;

/** What the controls take of the render besides the functions. */
export interface ControlParts extends ElementApi {
  readonly handle: EditorHandle | undefined;
  readonly active: boolean;
  readonly register: (controls: ElementControls | undefined) => void;
  readonly packageModel: PackageModel | undefined;
  readonly conflict: readonly ConflictField[] | undefined;
  readonly save: () => void;
  readonly copy: (label: string | undefined) => void;
  readonly follow: (reference: Reference) => void;
}

export const useElementControls = (state: ElementState, parts: ControlParts): RefObject<ElementApi> => {
  const { now, boxEditors, lastField, pointed } = state;
  const { handle, active, register, packageModel, conflict, save, copy, follow } = parts;
  const { criterionAt, copyCriterionReference, editTitle, addProperty, clearProperty } = parts;
  const { insertImage, textCommand, headingCommand, relationFollowed, isRelationBox, resolve } = parts;
  const { saveInput, inputGoing, flush, pointerNow, clickPointer, clickChoice, listValue } = parts;
  // The latest functions of this render, for the controls the app holds on to.
  const api = useRef({
    criterionAt,
    copyCriterionReference,
    editTitle,
    addProperty,
    clearProperty,
    insertImage,
    textCommand,
    headingCommand,
    relationFollowed,
    isRelationBox,
    resolve,
    saveInput,
    inputGoing,
    flush,
    pointerNow,
    clickPointer,
    clickChoice,
    listValue,
  });
  api.current = {
    criterionAt,
    copyCriterionReference,
    editTitle,
    addProperty,
    clearProperty,
    insertImage,
    textCommand,
    headingCommand,
    relationFollowed,
    isRelationBox,
    resolve,
    saveInput,
    inputGoing,
    flush,
    pointerNow,
    clickPointer,
    clickChoice,
    listValue,
  };

  // A layout effect, like the editor's: the app has the controls in the same task as the editor (the window's
  // shortcuts of the element, such as "Copy field", read them), before any key can come.
  // Only the view of the active area gives them (SR-115 AK3): the cleanups of a commit run before its
  // setups, so the view that becomes active holds them after the one that became inactive gave them back.
  useLayoutEffect(() => {
    if (handle === undefined || !active) {
      return undefined;
    }
    register({
      save,
      flush: () => api.current.flush(),
      prompting: () => {
        // What the cursor is on before the prompt takes the focus (SR-132); a prompt over a prompt keeps it.
        if (document.activeElement?.id !== PROMPT_INPUT) {
          pointed.current = api.current.pointerNow();
        }
        // A prompt opens: typing in the element has ended, so its input is saved now (binding review,
        // point 6), unless the prompt is part of the input ("Reference to element").
        if (!api.current.inputGoing()) {
          void api.current.flush();
        }
      },
      edit: () => {
        handle.focus("end");
      },
      editTitle: () => {
        api.current.editTitle();
      },
      members: packageModel !== undefined,
      // Only while the file changed under the input (SR-106 AK2).
      ...(conflict === undefined
        ? {}
        : {
            resolve: () => {
              api.current.resolve();
            },
          }),
      copy: () => {
        copy(cursorField(document.activeElement, lastField.current));
      },
      listValue: () => {
        void api.current.listValue();
      },
      onCriterion: (pressed) => api.current.criterionAt(pressed) !== undefined,
      copyCriterionReference: (pressed) => {
        void api.current.copyCriterionReference(pressed);
      },
      addProperty: () => {
        api.current.addProperty();
      },
      clearProperty: () => {
        api.current.clearProperty();
      },
      insertImage: () => {
        api.current.insertImage();
      },
      text: (command, none, options) => {
        api.current.textCommand(command, none, options);
      },
      headings: {
        list: () => {
          const text = now.current.handle;
          return text === undefined ? [] : headingsOf(text.state());
        },
        run: (command, none) => {
          api.current.headingCommand(command, none);
        },
        goTo: (from) => {
          api.current.headingCommand(goToHeading(from), "", true);
        },
      },
      follow: () => {
        // A focused target link, in a relation box or a relation group: that target (SR-132: the link
        // leaves Ctrl/Cmd+Enter to the window, so "Follow reference" opens it).
        const link = focusedTarget();
        if (link !== null) {
          link.click();
          return;
        }
        // A box has the focus or was the last field: the reference at the caret of a Markdown box, or its first
        // reference when it has no caret; a box that is not Markdown has none. Anywhere else it is the
        // reference at the cursor of the text.
        const label = cursorField(document.activeElement, lastField.current) ?? "";
        // The title has no references (plain text): from it, the reference at the cursor of the text.
        const box = label === TITLE_FIELD ? undefined : boxEditors.current.get(label);
        if (api.current.isRelationBox(label)) {
          const row = api.current.relationFollowed(label);
          if (row === undefined) {
            now.current.onEcho(`No element reference in ${label}`);
          } else {
            row.click();
          }
          return;
        }
        if (box !== undefined) {
          const markdown = now.current.boxes.get(label)?.info.markdown === true;
          const reference = boxReference(box, markdown);
          if (reference === undefined) {
            now.current.onEcho(
              markdown && box.hasFocus()
                ? "No element reference at the cursor"
                : `No element reference in ${label}`,
            );
          } else {
            follow(reference);
          }
          return;
        }
        const state = handle.state();
        const reference = referenceAt(state, state.selection.main.head);
        if (reference === undefined) {
          now.current.onEcho("No element reference at the cursor");
        } else {
          now.current.onOpenTarget(reference.id, reference.repository);
        }
      },
    });
    return () => {
      register(undefined);
    };
  }, [handle, register, packageModel !== undefined, conflict === undefined, active]);
  return api;
};
