// The commands of the element buffer (`ElementView.tsx`) that the app calls through its controls: the value of a
// choice or relation box (SR-104 AK3), "Add property", "Insert image", the text and heading actions, the
// criterion at the cursor with "Copy criterion reference" (SR-205 AK4) and "Clear property". A factory without
// hooks: `ElementView` calls it once per render where its code stood.
import type { Command } from "@codemirror/view";
import type { TextOptions } from "./action-types.js";
import { findElements } from "./actions.js";
import { cursorField } from "./copy.js";
import type { CriterionAt } from "./criterion-reference.js";
import { NO_CRITERION, criterionAtPos, referenceToCopy } from "./criterion-reference.js";
import type { EditorHandle } from "./editor/Editor.js";
import { TITLE_FIELD } from "./element-view.js";
import type { ElementSaves } from "./element-file.js";
import type { ElementInput, ElementState } from "./element-input.js";
import type { ElementFocus } from "./element-navigation.js";
import type { TextPlugins } from "./element-view-hooks.js";
import { pressedCriterion } from "./field-menu.js";
import { propertyAdded } from "./field-state.js";
import type { EditableBox } from "./property-edit.js";
import {
  choiceKeys,
  emptyBox,
  isKeyedBox,
  isLocked,
  isValueBox,
  lockNote,
  relationDoc,
  relationTargets,
} from "./property-edit.js";
import { addPropertyPrompt, choicePrompt, relationPrompt } from "./property-prompts.js";
import { staleRead } from "./save-flow.js";

/** The commands of the buffer. */
export interface ElementCommands {
  readonly openValue: (box: EditableBox) => void;
  readonly addProperty: () => void;
  readonly insertImage: () => void;
  readonly textCommand: (command: Command, none: string, options?: TextOptions) => void;
  readonly headingCommand: (command: Command, none: string, anywhere?: boolean) => void;
  readonly criterionAt: (pressed?: Element) => CriterionAt | undefined;
  readonly copyCriterionReference: (pressed?: Element) => Promise<void>;
  readonly clearProperty: () => void;
}

export const elementCommands = (
  state: ElementState,
  parts: Pick<ElementInput, "lockedNote" | "setValue"> &
    Pick<ElementFocus, "fieldOf"> &
    Pick<TextPlugins, "pick"> &
    Pick<ElementSaves, "flush">,
): ElementCommands => {
  const { onAsk, now, onFile, boxEditors, fresh, lastField, settled, mounted } = state;
  const { setGot, setAdded } = state;
  const { lockedNote, setValue, fieldOf, pick, flush } = parts;
  // The prompt that sets the value of a choice or relation box (SR-104 AK3): only the choices of the metamodel,
  // or the targets that are set and the elements `element.search` finds among the target types. When it ends,
  // taken or escaped, the focus goes back to the box, not to the element.
  const openValue = (box: EditableBox): void => {
    const { key } = box;
    const { searchCall: run, onEcho: echo } = now.current;
    const note = lockedNote();
    if (note !== undefined) {
      echo(note);
      return;
    }
    const doc = onFile.current.values.get(key) ?? box.doc;
    const name = box.info.name ?? key;
    const done = (): void => {
      fieldOf(key)?.focus();
    };
    if (box.info.kind === "choice") {
      onAsk(
        choicePrompt(
          name,
          box.info,
          choiceKeys(doc),
          (keys) => {
            setValue(key, keys.join("\n"));
          },
          done,
        ),
      );
      return;
    }
    const types = box.info.targetTypes;
    onAsk(
      relationPrompt(
        name,
        box.info,
        relationTargets(doc),
        (targets) => {
          setValue(key, relationDoc(targets));
        },
        types?.length === 0
          ? undefined
          : (take) =>
              findElements(
                { call: run, echo },
                take,
                types === undefined ? {} : { selection: { where: { type: [...types] } } },
              ),
        done,
      ),
    );
  };
  // "Add property" (SR-104 AK2): asks which of the properties the element lacks; the box comes empty.
  const addProperty = (): void => {
    const { addable, onEcho: echo } = now.current;
    const note = lockedNote();
    if (note !== undefined) {
      echo(note);
    } else if (addable.length === 0) {
      echo("No property to add");
    } else {
      onAsk(
        addPropertyPrompt(addable, ({ key, info }) => {
          fresh.current = emptyBox(key, info);
          onFile.current = propertyAdded(onFile.current, key);
          setAdded(onFile.current.added);
        }),
      );
    }
  };
  // "Insert image" (SR-097): the Markdown of the copied image goes to the caret of the text.
  const insertImage = (): void => {
    const { handle: editor, onEcho: echo } = now.current;
    const note = lockedNote();
    if (note !== undefined) {
      echo(note);
    } else if (editor === undefined) {
      echo("The text is not ready yet: insert the image again in a moment");
    } else {
      pick.pickImage({
        insert: (markdown) => {
          editor.insert(markdown);
        },
        // The prompt gives the focus back to the element, as after any action.
        cancel: () => undefined,
      });
    }
  };
  // A text action of the command prompt (`text-actions.ts`): the command edits the field with the cursor, or the
  // one it was in last: a Markdown box, else the text. The title is plain text and takes none.
  // The field a text action acts on, and its editor: the text, or a Markdown box (`inText`: always the text).
  const textTarget = (
    inText: boolean,
  ): { readonly label: string | undefined; readonly editor: EditorHandle | undefined } => {
    const label = inText ? "Text" : cursorField(document.activeElement, lastField.current);
    if (label === undefined || label === "Text") {
      return { label, editor: now.current.handle };
    }
    const markdownBox = now.current.boxes.get(label)?.info.markdown === true;
    return { label, editor: markdownBox ? boxEditors.current.get(label) : undefined };
  };
  const textCommand = (command: Command, none: string, options: TextOptions = {}): void => {
    const { onEcho: echo } = now.current;
    const { label, editor } = textTarget(options.inText === true);
    // A command that only reads and marks (find, SR-189 AK1) works in a read-only element too.
    const note = options.read === true ? undefined : lockedNote();
    if (note !== undefined) {
      echo(note);
    } else if (label === TITLE_FIELD || (editor === undefined && label !== undefined && label !== "Text")) {
      echo(none);
    } else if (editor === undefined) {
      echo("The text is not ready yet: try again in a moment");
    } else if (!editor.run(command, options.focus ?? true)) {
      echo(none);
    }
  };
  // An action on the headings (`heading-actions.ts`, SR-191): on the text, also when the element cannot be changed,
  // since folding and the cursor change no text. "Fold section" and "Unfold section" act at the cursor of the text
  // only; with the cursor in the title or a box they say `none`. "Go to heading" (`anywhere`) always moves into it.
  const headingCommand = (command: Command, none: string, anywhere = false): void => {
    const { handle: text, onEcho: echo } = now.current;
    const label = cursorField(document.activeElement, lastField.current);
    if (!anywhere && label !== undefined && label !== "Text") {
      echo(none);
    } else if (text === undefined) {
      echo("The text is not ready yet: try again in a moment");
    } else if (!text.run(command)) {
      echo(none);
    }
  };
  // The acceptance criterion with the cursor: the line of the criteria box the cursor is on, or was on last;
  // from the context menu, the line pressed in that box (the press gave it the focus).
  const criterionAt = (pressed?: Element): CriterionAt | undefined => {
    const label = cursorField(document.activeElement, lastField.current);
    const box = label === undefined ? undefined : now.current.boxes.get(label);
    const editor = label === undefined ? undefined : boxEditors.current.get(label);
    if (box === undefined || editor === undefined || !isKeyedBox(box)) {
      return undefined;
    }
    if (pressed !== undefined) {
      const found = pressedCriterion(pressed);
      return found !== undefined && found.field === label ? found.at : undefined;
    }
    const state = editor.state();
    return criterionAtPos(state, state.selection.main.head);
  };
  // "Copy criterion reference" (SR-205 AK4): the criterion is taken where the cursor is when the action starts
  // (the prompt gives the focus back after it); then the input is saved, so a line typed just now has its key
  // in the file, and core gives the reference (`element.get`), found by the key of the line.
  const copyCriterionReference = async (pressed?: Element): Promise<void> => {
    const at = criterionAt(pressed);
    if (at === undefined) {
      now.current.onEcho(NO_CRITERION);
      return;
    }
    await flush();
    const { onEcho: echo, onCopy: copied, buffer: shown, call: run } = now.current;
    const writes = settled.current;
    const answer = await run("element.get", { ref: shown.id, repository: shown.repository });
    if (!answer.ok) {
      echo(answer.message);
      return;
    }
    // A save that answered after this read reads the references again (`readReferences`).
    if (mounted.current && !staleRead(writes, settled.current)) {
      setGot(answer.output);
    }
    const found = referenceToCopy(answer.output.criterionReferences?.criteria, at);
    if ("reference" in found) {
      copied(found.reference, found.reference);
    } else {
      echo(found.message);
    }
  };
  // "Clear property" (SR-104 AK4): the box with the cursor, or the one it was in last, is emptied; it stays,
  // empty, until it is saved, and the property is removed from the file then.
  const clearProperty = (): void => {
    const { boxes: all, onEcho: echo } = now.current;
    const label = cursorField(document.activeElement, lastField.current);
    const box = label === undefined ? undefined : all.get(label);
    const note = lockedNote();
    if (label === undefined || !now.current.boxKeys.includes(label)) {
      echo("Put the cursor in a property box to clear it");
    } else if (note !== undefined) {
      echo(note);
    } else if (box === undefined) {
      echo(`${label} cannot be edited here: edit it in the file`);
    } else if (isLocked(box)) {
      echo(lockNote(label, box));
    } else if (isValueBox(box)) {
      setValue(label, "");
      fieldOf(label)?.focus();
    } else {
      boxEditors.current.get(label)?.set("");
      fieldOf(label)?.focus();
    }
  };
  return {
    openValue,
    addProperty,
    insertImage,
    textCommand,
    headingCommand,
    criterionAt,
    copyCriterionReference,
    clearProperty,
  };
};
