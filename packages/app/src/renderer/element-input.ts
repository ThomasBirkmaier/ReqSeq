// The input of the element buffer (`ElementView.tsx`) against its file: what its fields hold, the values of
// its choice and relation boxes, the draft the app keeps, and the state of the buffer towards its file
// (`disk-state.ts`). A factory without hooks: `ElementView` calls it once per render where its code stood, with
// the refs and the state setters it reads (`ElementState`), which the other parts of the buffer read as well.
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ElementGetOutput } from "@reqseq/core";
import type { Prompt } from "./action-types.js";
import type { Autosave } from "./autosave.js";
import type { BufferKeep, UndoMemory } from "./buffer-memory.js";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { DiskState } from "./disk-state.js";
import { conflictEnded, decided, lockedNote as lockedNoteOf } from "./disk-state.js";
import type { BoxDraft, Draft, ShownFile } from "./drafts.js";
import { withShown } from "./drafts.js";
import type { EditorHandle } from "./editor/Editor.js";
import type { ElementLoad, PropertyBox, PropertyModel } from "./element-view.js";
import type { ElementViewProps } from "./ElementView.js";
import type { BufferFields } from "./field-state.js";
import {
  boxDocs as boxDocsOf,
  draftOf,
  fileDocs as fileDocsOf,
  inputDocs as inputDocsOf,
  valueDoc as valueDocOf,
  valueSet,
} from "./field-state.js";
import type { ConflictField, OutsideChange } from "./outside-change.js";
import { changedOnDisk, outsideChange } from "./outside-change.js";
import type { MemberCount } from "./package-page.js";
import type { BoxEdit, EditableBox, addableProperties } from "./property-edit.js";
import { changedBoxes, editsOf, relationTargets } from "./property-edit.js";
import type { Said } from "./save-flow.js";
import { NO_HISTORY, record, redo, undo } from "./value-history.js";
import type { OutsideMarks } from "./use-outside-marks.js";
import type { Pointer } from "./value-list.js";

/** What the callbacks of the element buffer need of the latest render (`now` in `ElementView`). */
export interface ElementNow {
  readonly buffer: ElementBuffer;
  readonly call: Call;
  readonly searchCall: Call;
  readonly onData: ElementViewProps["onData"];
  readonly onDraft: ElementViewProps["onDraft"];
  readonly onEcho: ElementViewProps["onEcho"];
  readonly onDrawn: ElementViewProps["onDrawn"];
  readonly onGone: ElementViewProps["onGone"];
  readonly onCopy: ElementViewProps["onCopy"];
  readonly onOpenTarget: ElementViewProps["onOpenTarget"];
  readonly onPickElement: ElementViewProps["onPickElement"];
  readonly onAsk: ElementViewProps["onAsk"];
  readonly onType: ElementViewProps["onType"];
  readonly readOnly: boolean;
  readonly handle: EditorHandle | undefined;
  readonly boxes: ReadonlyMap<string, EditableBox>;
  readonly boxKeys: readonly string[];
  readonly properties: PropertyModel;
  readonly addable: ReturnType<typeof addableProperties>;
  readonly shown: readonly PropertyBox[];
  readonly keep: BufferKeep | undefined;
  readonly memory: UndoMemory;
  readonly dispatch: ElementViewProps["dispatch"];
}

/** The refs, the state setters and the values of the render of `ElementView` that its parts read. */
export interface ElementState {
  readonly buffer: ElementBuffer;
  readonly dispatch: (action: BufferAction) => void;
  readonly onAsk: (prompt: Prompt) => void;
  readonly article: HTMLElement | null;
  readonly members: MemberCount | undefined;
  readonly boxKeys: readonly string[];
  readonly mark: OutsideMarks["mark"];
  readonly now: RefObject<ElementNow>;
  readonly onFile: RefObject<BufferFields>;
  readonly boxEditors: RefObject<Map<string, EditorHandle>>;
  readonly diskState: RefObject<DiskState>;
  readonly held: RefObject<
    { readonly sha: string; readonly fields: ReadonlyMap<string, string> } | undefined
  >;
  readonly shownFile: RefObject<ShownFile | undefined>;
  readonly autosave: RefObject<Autosave | undefined>;
  readonly keptBoxes: RefObject<Map<string, BoxDraft>>;
  readonly keptText: RefObject<string | undefined>;
  readonly titleFocus: RefObject<number | "start" | "end" | undefined>;
  readonly textEditor: RefObject<EditorHandle | undefined>;
  readonly editAsked: RefObject<boolean>;
  readonly loadedOnce: RefObject<boolean>;
  readonly initialDraft: RefObject<Draft | undefined>;
  readonly hiddenNow: RefObject<boolean>;
  readonly saveOnReveal: RefObject<boolean>;
  readonly askAgain: RefObject<ReturnType<typeof setTimeout> | undefined>;
  readonly saving: RefObject<boolean>;
  readonly settled: RefObject<number>;
  readonly mounted: RefObject<boolean>;
  readonly said: RefObject<Said>;
  readonly wrote: RefObject<number>;
  readonly fresh: RefObject<EditableBox | undefined>;
  readonly lastField: RefObject<string | undefined>;
  readonly pointed: RefObject<Pointer>;
  readonly setView: Dispatch<SetStateAction<ElementLoad>>;
  readonly setGot: Dispatch<
    SetStateAction<Pick<ElementGetOutput, "element" | "names" | "criterionReferences"> | undefined>
  >;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly setTouched: Dispatch<SetStateAction<number>>;
  readonly setConflict: Dispatch<SetStateAction<readonly ConflictField[] | undefined>>;
  readonly setDeleted: Dispatch<SetStateAction<boolean>>;
  readonly setNotSaved: Dispatch<SetStateAction<string | undefined>>;
  readonly setAdded: Dispatch<SetStateAction<readonly string[]>>;
  readonly setTitleOpen: Dispatch<SetStateAction<boolean>>;
  readonly setValues: Dispatch<SetStateAction<ReadonlyMap<string, string>>>;
}

/** The input of the buffer and its state towards the file. */
export interface ElementInput {
  readonly setDiskState: (next: DiskState) => void;
  readonly editorDocs: () => Map<string, string>;
  readonly valueText: (key: string) => string | undefined;
  readonly setValue: (key: string, doc: string, recorded?: boolean) => void;
  readonly stepValue: (key: string, back: boolean) => boolean;
  readonly currentDraft: (
    textDoc?: string,
    base?: string,
    boxDocs?: Map<string, string>,
  ) => Draft | undefined;
  readonly keepDraft: (kept: Draft | undefined) => void;
  readonly boxEdits: () => BoxEdit[];
  readonly inputDocs: () => Map<string, string>;
  readonly fileDocs: () => Map<string, string>;
  readonly decide: (change: OutsideChange) => void;
  readonly endConflict: (sha: string | undefined) => void;
  readonly lockedNote: () => string | undefined;
  readonly changed: (textDoc?: string, typed?: boolean) => void;
}

export const elementInput = (state: ElementState): ElementInput => {
  const { now, onFile, boxEditors, diskState, held, shownFile, autosave } = state;
  const { setConflict, setDeleted, setNotSaved, setValues } = state;
  // The next disk state: the state that shows it is set only when it changed (by identity).
  const setDiskState = (next: DiskState): void => {
    const was = diskState.current;
    diskState.current = next;
    if (next.conflict !== was.conflict) {
      setConflict(next.conflict);
    }
    if (next.deleted !== was.deleted) {
      setDeleted(next.deleted);
    }
  };
  // What the boxes hold, by key: their editors, and the documents set in the minibuffer.
  const editorDocs = (): Map<string, string> =>
    boxDocsOf(
      [...boxEditors.current].map(([key, editor]): [string, string] => [key, editor.doc()]),
      onFile.current.values,
    );
  // What a copy of a box of a choice or relation gives when it has input: the keys or the labels, one per line.
  const valueText = (key: string): string | undefined => {
    const doc = onFile.current.values.get(key);
    return doc === undefined || now.current.boxes.get(key)?.info.kind !== "relation"
      ? doc
      : relationTargets(doc)
          .map((target) => target.label)
          .join("\n");
  };
  // What a choice or relation box holds now: its input, else the stored document.
  const valueDoc = (key: string): string => valueDocOf(onFile.current, key);
  // The document of a choice or relation box is set (SR-104 AK3, AK4): the box shows it, the draft has it.
  // The change can be undone (SR-105 AK2), unless it is a step of undo or redo itself (`recorded` false).
  const setValue = (key: string, doc: string, recorded = true): void => {
    if (recorded) {
      const { values: histories } = now.current.memory;
      histories.set(key, record(histories.get(key) ?? NO_HISTORY, valueDoc(key), doc));
    }
    onFile.current = valueSet(onFile.current, key, doc);
    setValues(onFile.current.values);
    changed();
  };
  // Undo or redo on a choice or relation box: one step through its value history. False when there is
  // none to take.
  const stepValue = (key: string, back: boolean): boolean => {
    const { values: histories } = now.current.memory;
    const history = histories.get(key) ?? NO_HISTORY;
    const next = back ? undo(history, valueDoc(key)) : redo(history, valueDoc(key));
    if (next === undefined) {
      return false;
    }
    histories.set(key, next.history);
    setValue(key, next.doc, false);
    return true;
  };
  // The unsaved input of the buffer as the app keeps it: the text and every box whose editor differs from
  // what is stored. `textDoc` is the document of the text editor when its change is the reason to ask.
  const currentDraft = (
    textDoc?: string,
    base = onFile.current.baseline,
    boxDocs = editorDocs(),
  ): Draft | undefined =>
    draftOf(
      onFile.current,
      { doc: textDoc ?? now.current.handle?.doc() ?? base, base },
      boxDocs,
      diskState.current.basis,
    );
  // The app keeps the draft of the buffer, with the element it shows. Without input nothing is unsaved.
  const keepDraft = (kept: Draft | undefined): void => {
    if (kept === undefined) {
      setNotSaved(undefined);
    }
    now.current.onDraft(now.current.buffer.key, withShown(kept, shownFile.current));
  };
  // The boxes whose document differs from the stored one: what "Save element" sends besides the text.
  const boxEdits = (): BoxEdit[] => changedBoxes(editsOf(now.current.boxes, editorDocs()));
  // The fields with input and what they hold: the text when it was typed in (a text editor that is not
  // there yet holds none), and every box whose document is not the stored one.
  const inputDocs = (): Map<string, string> =>
    inputDocsOf(onFile.current, now.current.handle?.doc(), editorDocs());
  // What the file holds for each field, as last loaded or saved.
  const fileDocs = (): Map<string, string> => fileDocsOf(onFile.current);
  // What the outside change means for the buffer now (SR-106): a conflict stops saving, and says so once;
  // without one, the input is on the file as it is.
  const decide = (change: OutsideChange): void => {
    const next = decided(diskState.current, change, held.current?.sha);
    setDiskState(next.disk);
    if (next.begins) {
      now.current.onEcho(changedOnDisk(now.current.buffer.name));
    }
  };
  // The input is on the file with the bytes `sha`: nothing to resolve.
  const endConflict = (sha: string | undefined): void => {
    setDiskState(conflictEnded(diskState.current, sha));
  };
  // Why the element cannot be changed now: it is read-only, or its file is gone (SR-106 AK3), or a read
  // found it gone and the buffer asks again before it says so (nothing is written meanwhile).
  const lockedNote = (): string | undefined =>
    lockedNoteOf(diskState.current, now.current.readOnly, now.current.buffer.name);
  // The input changed: during a conflict the blocks follow it, and input that is what the file holds ends it.
  // Input (`typed`, not the file's text put into an editor) is saved one second later (SR-105 AK1).
  const changed = (textDoc?: string, typed = true): void => {
    if (diskState.current.conflict !== undefined) {
      decide(
        outsideChange(inputDocs(), diskState.current.basis, { sha: held.current?.sha, docs: fileDocs() }),
      );
    }
    keepDraft(currentDraft(textDoc));
    if (typed) {
      autosave.current?.input();
    }
  };
  return {
    setDiskState,
    editorDocs,
    valueText,
    setValue,
    stepValue,
    currentDraft,
    keepDraft,
    boxEdits,
    inputDocs,
    fileDocs,
    decide,
    endConflict,
    lockedNote,
    changed,
  };
};
