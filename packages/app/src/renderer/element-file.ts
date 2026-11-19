// The element buffer (`ElementView.tsx`) and its file: what a read of the element does to the fields and the
// draft (SR-106, SR-116), and the saves (SR-105) with the resolution of a change on disk (SR-106 AK2). The
// decisions are in `disk-state.ts`, `field-state.ts` and `save-flow.ts`; these factories apply them to the
// editors and the state in the order they always did. Without hooks: `ElementView` calls each once per render
// where its code stood, and keeps the load and autosave effects.
import type { DataExportElement } from "@reqseq/core";
import type { RenameAction } from "./buffers.js";
import { renameAction } from "./buffers.js";
import {
  failure,
  fileRead,
  goneRead,
  readFailed,
  saveNote as saveNoteOf,
  showsKept,
  takeFileEdits,
} from "./disk-state.js";
import type { Draft } from "./drafts.js";
import type { EditorHandle } from "./editor/Editor.js";
import { dirty } from "./editor/save.js";
import { awaitingReference } from "./editor/slash-menu.js";
import type { ElementInput, ElementState } from "./element-input.js";
import { firstLoad, reloaded, restored as restoredOf, settledFields } from "./field-state.js";
import { TEXT_FIELD, deletedOnDisk, isGone, outsideChange, resolvePrompt } from "./outside-change.js";
import { fieldTexts, marksOnRead } from "./outside-marks.js";
import {
  changesReferences,
  fieldBoxes,
  hintKeys,
  savedHint,
  storedDocs,
  updateInput,
} from "./property-edit.js";
import type { SaveMode, SentWrite } from "./save-flow.js";
import {
  afterRefusal,
  checkStep,
  failedSpeech,
  leftDraft,
  saveStep,
  savedLine,
  savedSpeech,
  staleRead,
} from "./save-flow.js";

/** What a read of the element does to the buffer. */
export interface ElementLoads {
  readonly rename: (action: RenameAction) => void;
  readonly apply: (answered: DataExportElement, sha: string, changedJustNow: boolean) => void;
  readonly failed: (answer: { readonly code: string; readonly message: string }) => void;
}

export const elementLoads = (
  state: ElementState,
  parts: Pick<
    ElementInput,
    "setDiskState" | "editorDocs" | "inputDocs" | "fileDocs" | "decide" | "keepDraft" | "currentDraft"
  >,
): ElementLoads => {
  const { now, mark, onFile, diskState, held, shownFile, autosave, keptBoxes, keptText } = state;
  const { loadedOnce, initialDraft, hiddenNow, saveOnReveal, askAgain, saving } = state;
  const { setView, setText, setTouched, setAdded, setTitleOpen, setValues } = state;
  const { setDiskState, editorDocs, inputDocs, fileDocs, decide, keepDraft, currentDraft } = parts;
  const setBaseline = (next: string): void => {
    onFile.current = { ...onFile.current, baseline: next };
    setText(next);
  };

  // The file was read again while the buffer is shown (SR-106): a field without input follows the file, a
  // field whose input the file now holds has none any more, and input on other bytes than it was typed on
  // is a conflict. A box with input whose property is no longer in the file stays as an added box, so no
  // input is lost.
  const reload = (loaded: string, docs: Map<string, string>, sha: string): void => {
    const input = inputDocs();
    // A box without input follows the file once this render is done, so the draft already has it so; a
    // choice or relation box with input keeps it, one without follows the file at once.
    const next = reloaded(onFile.current, loaded, docs, input, editorDocs());
    onFile.current = next.fields;
    setValues(next.fields.values);
    if (next.addedChanged) {
      setAdded(next.fields.added);
    }
    setText(loaded);
    decide(outsideChange(input, diskState.current.basis, { sha, docs: fileDocs() }));
    // The draft is on the new file text: a text that was not typed on is the new one (the editor
    // follows it after this render), so boxes alone never keep the old text.
    keepDraft(currentDraft(next.draftText, loaded, next.followed));
  };
  // The first answer for a buffer that comes back with a draft: the draft is compared with the file as it
  // is now, as a reload compares the input (SR-106).
  const restore = (kept: Draft, element: DataExportElement, docs: Map<string, string>, sha: string): void => {
    const back = restoredOf(kept, element, docs, sha, now.current.properties);
    keptBoxes.current = back.keptBoxes;
    keptText.current = back.keptText;
    // Title input comes back in the title's editor, which stays (ThomasBirkmaier/ReqSeq-archive#621).
    if (back.titleOpens) {
      setTitleOpen(true);
    }
    setDiskState({ ...diskState.current, basis: back.basis });
    if (back.change.kind === "conflict") {
      decide(back.change);
    }
    if (back.changed) {
      keepDraft(back.draft);
    }
    // The boxes of the draft that were added come back (their base is the empty document), and the
    // documents of the choices and relations set in the command prompt with them.
    onFile.current = { ...onFile.current, added: back.added };
    setAdded(back.added);
    onFile.current = { ...onFile.current, values: back.values };
    setValues(back.values);
  };
  // Names the buffers of the element as it was read or saved, when that is not the name of this buffer (#273).
  const rename = (action: RenameAction): void => {
    if (action.name !== now.current.buffer.name) {
      now.current.dispatch(action);
    }
  };
  // An answer of `element.get` for the shown element. A buffer shown read-only (SR-044 AK2) shows it as a
  // read-only element: no editor takes input, and the modeline says `read-only`.
  const apply = (answered: DataExportElement, sha: string, changedJustNow: boolean): void => {
    const element = now.current.buffer.readOnly === true ? { ...answered, readOnly: true } : answered;
    const loaded = element.text ?? "";
    const docs = storedDocs(fieldBoxes(element, now.current.properties));
    // A save that runs sets the baseline itself with its answer.
    if (!saving.current) {
      const fields = fieldTexts(element);
      mark(marksOnRead(changedJustNow, held.current, sha, fields, () => inputDocs().keys()));
      held.current = { sha, fields };
      shownFile.current = { element, sha };
      // The file is there (again): the buffer is editable as before, and input typed meanwhile is saved.
      const { disk: read, back } = fileRead(diskState.current);
      setDiskState(read);
      if (!loadedOnce.current) {
        setBaseline(loaded);
        setDiskState({ ...diskState.current, basis: sha });
        const kept = initialDraft.current;
        if (kept !== undefined) {
          restore(kept, element, docs, sha);
        }
        onFile.current = firstLoad(onFile.current, docs);
      } else {
        reload(loaded, docs, sha);
      }
      loadedOnce.current = true;
      if (back && inputDocs().size > 0) {
        // A hidden view saves nothing: its input is saved once it is shown.
        if (hiddenNow.current) {
          saveOnReveal.current = true;
        } else {
          autosave.current?.input();
        }
      }
    }
    setView({ status: "ok", element });
    if (now.current.buffer.type !== element.type) {
      now.current.onType?.(element);
    }
    // The buffers of the element take a title changed on disk (#273).
    rename(renameAction(element));
  };
  // A read of the shown element failed. Before anything was shown the buffer says why; after, it keeps
  // what it shows with its editors: a file that is gone leaves the content read-only with a hint (SR-106
  // AK3), any other failure is only echoed. A buffer shown again with a draft after its file was deleted
  // shows the element the draft was typed on, with the input, as the shown buffer does.
  const failed = (answer: { readonly code: string; readonly message: string }): void => {
    // Only reads that keep finding the file gone count towards its deletion.
    setDiskState(readFailed(diskState.current, answer.code));
    const kept = initialDraft.current?.shown;
    if (showsKept(loadedOnce.current, answer.code, kept)) {
      apply(kept.element, kept.sha, false);
    }
    // Read after `apply`, which may have loaded the kept element.
    const then = failure(loadedOnce.current, answer.code, diskState.current.deleted);
    if (then === "error") {
      setView({ status: "error", message: answer.message });
      now.current.onEcho(answer.message);
      now.current.onDrawn?.(now.current.buffer.key);
      // A buffer with a draft shows it above and is not here; it forgets the name through `gone()`.
      if (isGone(answer.code)) {
        now.current.onGone?.(now.current.buffer.key);
      }
    } else if (then === "echo") {
      now.current.onEcho(answer.message);
    } else if (then === "gone") {
      gone();
    }
  };
  // A read found the file gone: the first time the element is asked for again after a batch of the
  // watcher, and only a file still gone then is deleted (a change that names the element asks at once).
  const gone = (): void => {
    const read = goneRead(diskState.current, Date.now());
    setDiskState(read.disk);
    if (read.kind === "wait") {
      clearTimeout(askAgain.current);
      askAgain.current = setTimeout(() => {
        setTouched((count) => count + 1);
      }, read.wait);
      return;
    }
    now.current.onEcho(deletedOnDisk(now.current.buffer.name));
    now.current.onGone?.(now.current.buffer.key);
  };
  return { rename, apply, failed };
};

/** The saves of the buffer, and whether input is still going on. */
export interface ElementSaves {
  readonly saveInput: (mode: SaveMode, afterSave?: boolean) => Promise<boolean>;
  readonly save: () => void;
  readonly resolve: () => void;
  readonly inputGoing: () => boolean;
  readonly flush: () => Promise<boolean>;
}

export const elementSaves = (
  state: ElementState,
  parts: Pick<
    ElementInput,
    | "endConflict"
    | "keepDraft"
    | "currentDraft"
    | "inputDocs"
    | "boxEdits"
    | "setValue"
    | "changed"
    | "lockedNote"
  > &
    ElementLoads,
): ElementSaves => {
  const { onAsk, now, onFile, boxEditors, diskState, held, shownFile, autosave } = state;
  const { saving, settled, mounted, said, wrote } = state;
  const { setView, setGot, setText, setNotSaved, setAdded, setValues } = state;
  const { endConflict, keepDraft, currentDraft, inputDocs, boxEdits, setValue, changed, lockedNote } = parts;
  const { rename, apply, failed } = parts;
  // After a save: the answer is the new baseline, the boxes show what the file holds, and what was typed
  // while the save ran stays as a draft. A box that the save emptied (its property left the file) and that
  // was typed in meanwhile stays as an added box, so that input is not lost (ThomasBirkmaier/ReqSeq-archive#348).
  const settle = (
    output: {
      readonly element: DataExportElement;
      readonly fileSha256: string;
      readonly problems?: readonly { message: string }[];
      /** The number of directly affected elements (SR-024 AK2), said after the save. */
      readonly affected?: number;
    },
    sent: SentWrite,
    editor: EditorHandle,
    mode: SaveMode,
  ): void => {
    const { onEcho: echo } = now.current;
    const { element } = output;
    settled.current += 1;
    // The file as this save wrote it: the reload its `written` brings finds the same bytes, and what was
    // typed while the save ran is on it.
    held.current = { sha: output.fileSha256, fields: fieldTexts(element) };
    shownFile.current = { element, sha: output.fileSha256 };
    endConflict(output.fileSha256);
    const docs = storedDocs(fieldBoxes(element, now.current.properties));
    // A box that was added is a stored box now, or was left empty and is dropped (no draft); one that was
    // added or typed in while the save ran stays. Read with the editors as they are at the answer and the
    // values from before the save: nothing that runs before the loop below writes to a box editor (a
    // `replace` calls `changed` with `typed` false, which only keeps the draft; there is no conflict, it
    // ended above), so each box still holds this document when the loop reaches it.
    const result = settledFields(onFile.current, { text: element.text ?? "", docs }, sent, {
      textDoc: editor.doc(),
      boxDoc: (key) => boxEditors.current.get(key)?.doc(),
    });
    // Everything but the values first: the editors call back into `changed` while they are replaced, and
    // read the values from before the save meanwhile.
    onFile.current = { ...result.fields, values: onFile.current.values };
    setAdded(result.fields.added);
    setText(result.fields.baseline);
    if (result.textReplace !== undefined) {
      editor.replace(result.textReplace);
    }
    // The editors compare with what the file holds now, so input typed while the save ran (an undo back
    // to the text before it too) stays when they get the saved text.
    editor.rebase(result.fields.baseline);
    // A box that still holds what was sent shows what the file holds now (an emptied one is gone with its
    // property).
    for (const step of result.boxes) {
      const box = boxEditors.current.get(step.key);
      if (step.replace !== undefined) {
        box?.replace(step.replace);
      }
      if (step.rebase !== undefined) {
        box?.rebase(step.rebase);
      }
    }
    // A choice or relation box that still holds what was sent shows what the file holds now.
    onFile.current = { ...onFile.current, values: result.values };
    setValues(result.values);
    keepDraft(currentDraft());
    setView({ status: "ok", element });
    setNotSaved(undefined);
    // The buffers of the element take the title it was saved with (#273), and so does "Saved <name>".
    const named = renameAction(element);
    rename(named);
    const hint = savedHint(output.problems, hintKeys(sent.edits, element, now.current.properties));
    wrote.current = output.affected ?? 0;
    const speech = savedSpeech(said.current, mode, named.name, hint, output.affected);
    if (speech.echo !== undefined) {
      echo(speech.echo);
    }
    said.current = speech.said;
    if (changesReferences(sent.edits)) {
      readReferences();
    }
  };
  // The references of the criteria after a save that changed them (SR-205 AK1): `element.get` works them out;
  // the answer of `element.update` has none. Read in order with the saves of the buffer, and dropped when a
  // later save answered first (`staleRead`): that save reads them again.
  const readReferences = (): void => {
    const job = async (): Promise<void> => {
      const { buffer: shown, call: run } = now.current;
      const writes = settled.current;
      const answer = await run("element.get", { ref: shown.id, repository: shown.repository });
      if (mounted.current && answer.ok && !staleRead(writes, settled.current)) {
        setGot(answer.output);
      }
    };
    void (now.current.keep?.save(job) ?? job());
  };

  // Why the input cannot be saved now, or nothing: the element is read-only or its file is gone or cannot
  // be read (SR-106 AK3), or the file changed under the input (AK2: nothing is saved until the user chose).
  const saveNote = (): string | undefined =>
    saveNoteOf(diskState.current, now.current.readOnly, now.current.buffer.name);
  // Writes the input that differs from the file, in order with the other saves of the buffer. True when no
  // input is left unsaved. "Save element" (`asked`) says what happened; the other saves only what went wrong.
  const saveInput = async (mode: SaveMode, afterSave = false): Promise<boolean> => {
    const { handle: editor, onEcho: echo, buffer: shown } = now.current;
    const afterWrite = afterSave
      ? { name: shown.name, hint: said.current.hint, affected: wrote.current }
      : undefined;
    const step = saveStep({ editor, input: inputDocs().size > 0, note: saveNote(), mode, afterWrite });
    if (step.kind === "done") {
      if (step.echo !== undefined) {
        echo(step.echo);
      }
      return step.result;
    }
    const job = (): Promise<boolean> => write(step.editor, mode);
    return now.current.keep?.save(job) ?? job();
  };
  // "Save element" (Ctrl/Cmd+S): at once, after a save that runs. Asked while a save runs, it waits for that
  // save and says "Saved" when it left no input (#563: it was dropped then, and said nothing).
  const save = (): void => {
    const afterSave = autosave.current?.running() === true || saving.current;
    void autosave.current?.now(() => saveInput("asked", afterSave));
  };
  // A save that went wrong: the modeline says `not saved` with the reason while it holds (SR-105 AK5), and
  // the command prompt the reason, once while it stays the same (autosave tries again on the next input, never in a loop).
  const notWritten = (message: string, mode: SaveMode): void => {
    setNotSaved(message);
    const speech = failedSpeech(said.current, mode, message);
    if (speech.echo !== undefined) {
      now.current.onEcho(speech.echo);
    }
    said.current = speech.said;
  };
  // Writes the text and the boxes with input, on the bytes of the file the buffer shows (`expectedFileSha256`):
  // core refuses the write when the file changed since (SR-106).
  const write = async (editor: EditorHandle, mode: SaveMode, retried = false): Promise<boolean> => {
    const { buffer: shown, call: run, properties: model } = now.current;
    const doc = editor.doc();
    const edits = boxEdits();
    const textDirty = dirty(doc, onFile.current.baseline);
    const sent: SentWrite = { doc, edits, added: onFile.current.added };
    const expected = held.current?.sha;
    saving.current = true;
    const answer = await run("element.update", {
      ...updateInput(shown.id, textDirty ? doc : undefined, edits),
      ...(expected === undefined ? {} : { expectedFileSha256: expected }),
    });
    saving.current = false;
    if (!mounted.current) {
      // The buffer was left while the save ran: the app keeps its draft, and saves what is left of it.
      if (!answer.ok) {
        return false;
      }
      const { element, fileSha256: sha, affected } = answer.output;
      // The command prompt stays: it names the element that was left with its directly affected elements
      // (SR-024 AK2); 0 says nothing, as leaving says nothing.
      if (affected > 0) {
        now.current.onEcho(savedLine(renameAction(element).name, undefined, affected));
      }
      // Input typed while the save ran stays in the draft: then input is left unsaved.
      let rest: Draft | undefined;
      now.current.keep?.update((draft) => {
        // The model read before the write, as the bytes and the input were.
        rest = leftDraft(draft, { textDirty, doc, edits }, { element, sha }, model);
        return rest;
      });
      return rest === undefined;
    }
    if (answer.ok) {
      settle(answer.output, sent, editor, mode);
      // Input typed while the save ran is left for the next save.
      return inputDocs().size === 0;
    }
    if (afterRefusal(answer.code) === "check") {
      return check(editor, expected, mode, retried ? answer.message : undefined);
    }
    // Nothing was written: the text and the boxes stay as typed.
    notWritten(answer.message, mode);
    return false;
  };
  // A write was refused because the file is not the one the buffer shows: one read says what holds now.
  // When only core's store lagged behind the file (it has the bytes that were sent), the write goes again
  // once, silently; a second refusal is said (`refused`). Other bytes follow the rule for a change from
  // outside, and a file that is gone the rule for a deletion. True when no input is left unsaved.
  const check = async (
    editor: EditorHandle,
    expected: string | undefined,
    mode: SaveMode,
    refused?: string,
  ): Promise<boolean> => {
    const { buffer: shown, call: run } = now.current;
    const answer = await run("element.get", { ref: shown.id, repository: shown.repository });
    if (!answer.ok) {
      failed(answer);
      return false;
    }
    const next = checkStep(answer.output.fileSha256, expected, refused);
    if (next.kind === "apply") {
      // The lines show what the file holds, also when `apply` keeps input over a change on disk.
      setGot(answer.output);
      apply(answer.output.element, answer.output.fileSha256, false);
      // Read after `apply`, which may have found a conflict or kept input.
      return diskState.current.conflict === undefined && inputDocs().size === 0;
    }
    if (next.kind === "retry") {
      return write(editor, mode, true);
    }
    notWritten(next.message, mode);
    return false;
  };
  // "Resolve change on disk" (SR-106 AK2): which version holds. "Keep my input" writes the fields with input
  // on the file as it is now, so the outside change of every other field stays; "Take the file" puts the
  // file's values into the editors as an edit, which Ctrl/Cmd+Z takes back, so no input is lost.
  const resolve = (): void => {
    onAsk(resolvePrompt(keepInput, takeFile));
  };
  const keepInput = (): void => {
    const { handle: editor, onEcho: echo } = now.current;
    const note = lockedNote();
    if (note !== undefined) {
      echo(note);
    } else if (editor !== undefined && !saving.current && diskState.current.conflict !== undefined) {
      void autosave.current?.now(() => {
        const job = (): Promise<boolean> => write(editor, "asked");
        return now.current.keep?.save(job) ?? job();
      });
    }
  };
  const takeFile = (): void => {
    const note = lockedNote();
    if (note !== undefined) {
      now.current.onEcho(note);
      return;
    }
    const editorOf = (label: string): EditorHandle | undefined =>
      label === TEXT_FIELD ? now.current.handle : boxEditors.current.get(label);
    // Taken from the conflict as it is now: each step's edit may end it before the next one.
    for (const edit of takeFileEdits(diskState.current.conflict, (label) => editorOf(label) !== undefined)) {
      const editor = edit.via === "editor" ? editorOf(edit.label) : undefined;
      if (editor === undefined) {
        // A choice or relation box: it shows the file's value again, as a change Ctrl/Cmd+Z takes back.
        setValue(edit.label, edit.doc);
      } else {
        editor.set(edit.doc);
      }
    }
    changed();
  };
  // Input is still going on in an editor (SR-105): an input method composes, the slash menu is open, or
  // "Reference to element" or `[[` (SR-066, also in a box, SR-127 AK2) waits for its element. Autosave waits for it.
  const inputGoing = (): boolean =>
    [now.current.handle, ...boxEditors.current.values()].some(
      (editor) => editor !== undefined && (editor.busy() || awaitingReference(editor.state())),
    );
  // Saves the input now, quietly (a prompt opens, the buffer is closed, another workspace opens). True
  // when no input is left unsaved.
  const flush = (): Promise<boolean> =>
    autosave.current?.now(() => saveInput("quiet")) ?? Promise.resolve(inputDocs().size === 0);
  return { saveInput, save, resolve, inputGoing, flush };
};
