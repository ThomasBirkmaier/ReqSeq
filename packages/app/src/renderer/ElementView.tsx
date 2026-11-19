// The element buffer: one element as `element.get` gives it. The title is edited in its heading, one line of
// plain text (ThomasBirkmaier/ReqSeq-archive#621, `TitleBox.tsx`), and saved and compared with the file like a box (`TITLE_FIELD`). The
// text is edited in the Markdown editor with live preview (SR-065, D-061). The properties are boxes below it
// (SR-104): a property of a text kind (text, number, date) is edited in its box, one editor with the values,
// one per line (`TextBox.tsx`); a property the metamodel marks `markdown` shows its values formatted like the
// text, with the source on the line with the caret only (SR-127). The value of a choice or relation property
// is set in the command prompt, the one control (D-062): Enter on its box asks for the allowed values or for an
// element (`property-prompts.ts`). "Add property" puts an empty box at its place, with the caret in it, or
// with the focus on it and the prompt open at once for a choice or relation. A property the type does not
// know stays a read-only box (D-012, spec question ThomasBirkmaier/ReqSeq-archive#469). Empty properties are left out; the UUID and the
// version are shown on request only. The only write is `element.update { ref, title?, text?, set?, unset? }`
// (ADR-0002): the title, the text and every box that changed go together, and a box that was emptied removes
// its property (`property-edit.ts`). It is written without a save command (SR-105, `autosave.ts`): one second
// after the last input, and at once when the buffer is left or a prompt opens; "Save element" (Ctrl/Cmd+S)
// writes at once. Undo and redo reach back to the opening of the buffer, also across saves and other buffers
// shown meanwhile (the app keeps the history, `buffer-memory.ts`); a choice or relation box has a value
// history of its own (`value-history.ts`). The unsaved text and boxes are a draft that the app keeps while
// another buffer is shown.
// A change of the file from outside the app (SR-106, SR-116) is read again when core's watcher names this
// element: the editors without input take the new text with the cursor kept at its place in the text, and
// the fields that changed are highlighted briefly when the file's bytes (`fileSha256`) differ. When the
// bytes are no longer those the input was typed on, nothing is saved until "Resolve change on disk" chose
// the version that holds, and a block "On disk" under each field with input shows the file's value; a file
// that is gone leaves the content read-only in the editors (`outside-change.ts`).
// This component holds the refs, the state and the effects and decides in the modules: the buffer towards its
// file in `disk-state.ts`, the input and the file's values per field in `field-state.ts`, what a save sends
// and says in `save-flow.ts`, the keys of the fields in `element-keys.ts`. It renders the parts without state:
// the title and the text (`ElementText.tsx`), a property box (`PropertyField.tsx`), the relation groups
// (`RelationLink.tsx`), the lines of its variants and verification status (`VariantLines.tsx`), its
// evidence records (`EvidenceLines.tsx`), the line
// and the elements of a package page (`PackageSummary.tsx`, `PackageMembers.tsx`) and a block "On disk"
// (`OnDisk.tsx`).
// Its functions are in parts of their own, called once per render in the order they always ran: factories
// without hooks for the input (`element-input.ts`), the focus and the keys (`element-navigation.ts`), the reads
// and saves (`element-file.ts`), the commands (`element-commands.ts`) and the pointer (`element-pointer.ts`),
// and hooks for the plugins of the text and the smaller helpers (`element-view-hooks.ts`) and for the controls it
// gives the app (`element-controls.ts`).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Autosave } from "./autosave.js";
import { createAutosave } from "./autosave.js";
import type { BufferKeep } from "./buffer-memory.js";
import type { DataExportElement, ElementGetOutput } from "@reqseq/core";
import type { ElementControls, Prompt } from "./action-types.js";
import type { BufferAction, ElementBuffer, ResultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { NOTHING, copyField, copyable, docOf, modelineField } from "./copy.js";
import type { ElementLoad, PropertyModel } from "./element-view.js";
import { TITLE_FIELD, isReadOnly, outdatedParent, outdatedReferences, shownElement } from "./element-view.js";
import type { EditorHandle } from "./editor/Editor.js";
import type { ReferenceTitles } from "./reference-titles.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import type { DiskState } from "./disk-state.js";
import { DISK_START, leaveSaves } from "./disk-state.js";
import type { BoxDraft, Draft, ShownFile } from "./drafts.js";
import type { Said } from "./save-flow.js";
import { staleRead } from "./save-flow.js";
import type { BufferFields } from "./field-state.js";
import { NO_FIELDS } from "./field-state.js";
import { ElementText } from "./ElementText.js";
import { OnDisk } from "./OnDisk.js";
import { shownDoc } from "./criterion-doc.js";
import { PackageMembers } from "./PackageMembers.js";
import { PackageSummaryLine } from "./PackageSummary.js";
import { PropertyField } from "./PropertyField.js";
import { RelationGroups } from "./RelationLink.js";
import { VariantLines } from "./VariantLines.js";
import { EvidenceLines } from "./EvidenceLines.js";
import type { ConflictField } from "./outside-change.js";
import { TEXT_FIELD, diskMark } from "./outside-change.js";
import type { OutsideChanges } from "./outside-marks.js";
import { NO_CHANGES, touchedSince } from "./outside-marks.js";
import { useOutsideMarks } from "./use-outside-marks.js";
import { bufferMark, useHidden, useReveal, useWhole } from "./area-slot.js";
import { isMac, isModClick, isPlainClick } from "./keys.js";
import type { TextBoxProps } from "./TextBox.js";
import type { TitleBoxProps } from "./TitleBox.js";
import { ParentsRow, useParents } from "./ParentsLine.js";
import type { BufferData } from "./modeline.js";
import type { MemberCount, PackageModel } from "./package-page.js";
import { memberAt, memberSelection, packageOf } from "./package-page.js";
import {
  addableProperties,
  allBoxes,
  isLocked,
  isKeyedBox,
  isNumberedList,
  isValueBox,
  isValueKind,
  lockNote,
  shownBoxes,
  withTitle,
} from "./property-edit.js";
import type { EditableBox } from "./property-edit.js";
import type { Pointer } from "./value-list.js";
import { NO_POINTER, listableValues, valueKeyOf } from "./value-list.js";
import { shownId } from "./id-title.js";
import type { ElementState } from "./element-input.js";
import { elementInput } from "./element-input.js";
import { elementCommands } from "./element-commands.js";
import { useElementControls } from "./element-controls.js";
import { elementLoads, elementSaves } from "./element-file.js";
import { elementFocus, elementKeys } from "./element-navigation.js";
import { elementPointer, useValueFacets } from "./element-pointer.js";
import {
  isVariantPage,
  shownOnly,
  useArea,
  useHintDates,
  useLinesAgain,
  useTextPlugins,
  useUndoMemory,
} from "./element-view-hooks.js";

export interface ElementViewProps {
  readonly call: Call;
  readonly buffer: ElementBuffer;
  /** Counts up when the workspace changed: the element is asked for again. */
  readonly revision: number;
  /**
   * The changes from outside (SR-116, SR-106): the element is asked for again when one names it, and the
   * parents line and the elements of a package page on each. Default: none.
   */
  readonly outside?: OutsideChanges;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** The view cannot draw its buffer (its read failed): a switch in motion to it starts (SR-212). Default: nothing. */
  readonly onDrawn?: (key: string) => void;
  /**
   * A read found the element gone (`ref.unknown`): when the buffer is shown and nothing was shown yet, or
   * when its file is deleted (SR-106 AK3). The app forgets its name for "Go to" (ThomasBirkmaier/ReqSeq-archive#681). Default: nothing.
   */
  readonly onGone?: (key: string) => void;
  /** A field is copied (SR-128): its name and its value as text; the app puts it on the clipboard. */
  readonly onCopy: (label: string, text: string) => void;
  /** A relation target is opened: its element buffer, by UUID and repository (ThomasBirkmaier/ReqSeq-archive#416). */
  readonly onOpenRelation: (target: ElementBuffer) => void;
  /** Opens a result buffer: the coverage behind the line of a package page (SR-036 AK2). */
  readonly onOpenResult: (buffer: ResultBuffer) => void;
  /**
   * A relation target or the target of an inline reference is opened: by its UUID, and by the repository
   * the link names (a relation has none: the output has no repository).
   */
  readonly onOpenTarget: (id: string, repository?: string) => void;
  /**
   * Calls core in no view, for the targets a relation box offers (SR-043 AK1: a view the window shows
   * narrows no offer). Absent: `call`.
   */
  readonly searchCall?: Call;
  /** The slash menu's "Reference to element" (SR-129) or `[[` (SR-066) asks for an element: the app opens a prompt. */
  readonly onPickElement: (request: ReferenceRequest) => void;
  /** The titles of reference targets in other repositories (D-058), kept by the app for the workspace. */
  readonly titles: ReferenceTitles;
  /** The command prompt asks for the property to add or the value of a choice or relation (SR-104): the app opens the prompt. */
  readonly onAsk: (prompt: Prompt) => void;
  /** The unsaved text this buffer had when it was shown last, if any, with the file text it was typed on. */
  readonly draft: Draft | undefined;
  /** The text of the buffer has unsaved changes (the draft), or has none (undefined). */
  readonly onDraft: (key: string, draft: Draft | undefined) => void;
  /** Gives the app the means to save and edit while the text is shown, and takes them back. */
  readonly register: (controls: ElementControls | undefined) => void;
  /**
   * A read said the element's type, when the buffer does not carry it yet: whether it is a package page decides
   * whether it is drawn in advance (SR-212 AK5). Default: nothing.
   */
  readonly onType?: (element: Pick<DataExportElement, "id" | "repository" | "type">) => void;
  /** The types that are packages (SR-112); an element of one shows the elements that name it. */
  readonly packages: PackageModel | undefined;
  /**
   * The types with the meaning `variant` (`metamodel.get`): the page of one is read again on every change
   * from outside, since its hints since its newest baseline depend on other files (SR-103). Default: none.
   */
  readonly variantTypes?: ReadonlySet<string>;
  /** The properties of each type (`metamodel.get`): which boxes can be edited, and which show Markdown (SR-104, SR-127). */
  readonly properties: PropertyModel;
  /** For the list of the elements of a package page: its selected row, and opening one of them. */
  readonly dispatch: (action: BufferAction) => void;
  /**
   * What the app keeps of the buffer (SR-105): the undo history, the saves of the buffer in order, and its
   * draft once the buffer is left, which the app then saves. Without it the history lasts while the buffer
   * is shown, and leaving it saves nothing.
   */
  readonly keep?: BufferKeep;
  /**
   * The view is in the active area of the window (SR-115 AK3); default true. Only the active view gives the
   * app its controls and takes the focus on its own; a view that becomes inactive saves its input, as
   * leaving the element does (SR-105 AK1).
   */
  readonly active?: boolean;
}

export const ElementView = ({
  call,
  searchCall = call,
  buffer,
  revision,
  outside = NO_CHANGES,
  onData,
  onEcho,
  onDrawn,
  onGone,
  onCopy,
  onOpenTarget,
  onOpenRelation,
  onOpenResult,
  onPickElement,
  titles,
  onAsk,
  draft,
  onDraft,
  register,
  onType,
  packages,
  variantTypes,
  properties,
  dispatch,
  keep,
  active: inArea,
}: ElementViewProps): React.JSX.Element => {
  // Drawn in advance, hidden beside the shown buffer (SR-212 AK5): it reads and draws, and does nothing a
  // reader notices until it is shown. Whatever it shows then is what a fresh view at the switch shows.
  const hidden = useHidden();
  const whole = useWhole();
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;
  const [view, setView] = useState<ElementLoad>({ status: "loading" });
  // The last answer of `element.get`, for the lines of the variants and the verification status (SR-046,
  // SR-047): a save answers without them, so they stay until the element is read again.
  const [got, setGot] = useState<
    Pick<ElementGetOutput, "element" | "names" | "criterionReferences"> | undefined
  >(undefined);
  // The text as last loaded or saved: what the document is compared with.
  const [text, setText] = useState("");
  const [handle, setHandle] = useState<EditorHandle | undefined>(undefined);
  // The same editor at once: `handle` comes with the next render, and a key can come before it.
  const textEditor = useRef<EditorHandle | undefined>(undefined);
  // "Edit text" (Enter on the buffer) came before the text editor was there, while the element loaded: the
  // caret goes into the editor when it comes, as long as the focus is still in this buffer.
  const editAsked = useRef(false);
  // What the buffer holds against its file (`field-state.ts`): the text as last loaded or saved (what the
  // document is compared with), the stored document of every box and of the title, the boxes that were added,
  // and the documents of the choices and relations set in the minibuffer. The callbacks read it; `text`,
  // `added` and `values` are the state that renders.
  const onFile = useRef<BufferFields>(NO_FIELDS);
  const loadedOnce = useRef(false);
  // The changes from outside that named this element since it was shown: each asks for it again. A removal
  // asks too, and only the answer says whether the file is gone (SR-106 AK3).
  const [touched, setTouched] = useState(0);
  // The changes from outside that did not name it: the lines of its variants and verification status
  // (SR-046, SR-047) depend on other files (a variant's exclusions, a replacing requirement, the records).
  const [elsewhere, setElsewhere] = useState(0);
  const seenChange = useRef(outside.seq);
  // The page of a variant: its hints since its newest baseline (SR-103) follow a change of a core
  // requirement or a baseline file, so every change from outside reads it again, the modeline's count too.
  const isVariant = isVariantPage(view, variantTypes);
  useEffect(() => {
    if (outside.seq !== seenChange.current) {
      const named = touchedSince(outside, buffer.id, seenChange.current);
      seenChange.current = outside.seq;
      if (named || isVariant) {
        setTouched((count) => count + 1);
      } else {
        setElsewhere((count) => count + 1);
      }
    }
  }, [outside]);
  // The file the shown answer was built from (`fileSha256`) and what its fields show: a reload with other
  // bytes after a change from outside highlights the fields that differ (SR-116), the app's own save never.
  const held = useRef<{ readonly sha: string; readonly fields: ReadonlyMap<string, string> } | undefined>(
    undefined,
  );
  const { marked, mark } = useOutsideMarks();
  // Input that came back with the file while the view was hidden: saved once it is shown.
  const saveOnReveal = useRef(false);
  // What the buffer knows of its file besides the input (SR-106, `disk-state.ts`): the bytes the input was
  // typed on, the fields with input that the file no longer agrees with (AK2: nothing is saved meanwhile),
  // whether the file is gone (AK3: the content stays, read-only, until the file is there again), and the
  // first read that found it gone (core's store does not know an element whose file is being written
  // either, so only a read after the next batch of the watcher says that the file is deleted; meanwhile
  // the buffer stays editable). The ref is what the callbacks read; the state shows the blocks "On disk"
  // and the modeline.
  const diskState = useRef<DiskState>(DISK_START);
  const [conflict, setConflict] = useState<readonly ConflictField[] | undefined>(undefined);
  const [deleted, setDeleted] = useState(false);
  // The read asked for again after a read that found the file gone (SR-106 AK3).
  const askAgain = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(askAgain.current);
    },
    [],
  );
  // The element the buffer shows, with the bytes of its file: the app keeps it with the draft, so a buffer
  // shown again after its file was deleted shows its input (`Draft.shown`).
  const shownFile = useRef<ShownFile | undefined>(undefined);
  // The draft this buffer was shown with (the app keys this component by buffer).
  const initialDraft = useRef(draft);
  const saving = useRef(false);
  // How many saves of this buffer have answered: a read asked before the last of them is stale.
  const settled = useRef(0);
  // The buffer is shown (SR-105): the answer of a save that comes after it was left changes the draft the
  // app keeps, not the editors that are gone.
  const mounted = useRef(true);
  const memory = useUndoMemory(keep);
  // Why the last save failed (`not saved` with the reason in the modeline, SR-105 AK5), and what was said
  // last about saves: an error, a hint or the number of directly affected elements (SR-024 AK2) is echoed
  // once while it stays the same, not after every pause (D-062).
  const [notSaved, setNotSaved] = useState<string | undefined>(undefined);
  const said = useRef<Said>({});
  // The number of directly affected elements of the last write that answered, for "Save element" asked
  // while that write ran (#563).
  const wrote = useRef(0);
  // Saves the input one second after the last change, and at once when asked (`autosave.ts`).
  const autosave = useRef<Autosave | undefined>(undefined);
  // Autosave lives as long as the buffer is shown. Leaving the buffer (another buffer shown, closed) saves
  // its input at once (SR-105 AK1): the app does it with the draft it keeps, since the editors go; not over
  // a change on disk or a file that is gone (SR-106).
  useEffect(() => {
    mounted.current = true;
    const made = createAutosave({
      save: () => api.current.saveInput("quiet"),
      held: () => api.current.inputGoing(),
    });
    autosave.current = made;
    return () => {
      mounted.current = false;
      made.dispose();
      now.current.keep?.left(leaveSaves(diskState.current));
    };
  }, []);
  const [article, setArticle] = useState<HTMLElement | null>(null);
  // The package page (SR-112): the elements that name this one, below its text. The heading and the
  // modeline (SR-114 AK3) give their count. The selection keeps its identity, or the list would ask
  // again after every render.
  const [members, setMembers] = useState<MemberCount | undefined>(undefined);
  // Their elements as loaded: the selected one is the marked element of the page (SR-194 AK5, SR-150).
  const [entries, setEntries] = useState<readonly (ElementBuffer | undefined)[] | undefined>(undefined);
  const [membersFocused, setMembersFocused] = useState(false);
  const markedEntry = memberAt(entries, buffer.memberCursor, membersFocused);
  // With the filter steps of the page (SR-112 AK2); the steps keep their identity while they stay.
  const selection = useMemo(
    () => memberSelection(buffer.id, buffer.memberSteps ?? []),
    [buffer.id, buffer.memberSteps],
  );
  const returning = useRef(buffer.memberCursor !== undefined);
  // The area of the view (SR-115 AK3): only the active view takes the focus on its own, and a view that
  // becomes inactive saves its input.
  const { active, membersFocus } = useArea(inArea, returning.current, () => api.current.flush());
  const packageModel = view.status === "ok" ? packageOf(packages, view.element.type) : undefined;
  const isPackage = packageModel !== undefined;
  // What the page shows of a package: nothing while hidden and read for drawing in advance, so its elements
  // are never read for it (SR-212 AK5); all of it when drawn from its record, which reads no workspace, or for
  // a swipe (SR-211 AK3).
  const pageModel = shownOnly(!whole, packageModel);
  const readOnly = isReadOnly(view);
  // The boxes that are edited (SR-104), and the editors of those with text by key. Each is compared with its
  // stored document in `onFile`, like the text with the baseline. The boxes that were added (AK2) have no
  // stored value: their base is the empty document.
  const [added, setAdded] = useState<readonly string[]>([]);
  // The title is one of them (ThomasBirkmaier/ReqSeq-archive#621): its field, saved and compared with the file like a text box.
  const boxes = useMemo(
    () =>
      view.status === "ok"
        ? withTitle(allBoxes(view.element, properties, added), view.element, properties)
        : new Map<string, EditableBox>(),
    [view, properties, added],
  );
  const shown = useMemo(
    () => (view.status === "ok" ? shownBoxes(view.element, properties, added) : []),
    [view, properties, added],
  );
  // The properties "Add property" offers: what the type has and no box shows.
  const addable = useMemo(
    () => (view.status === "ok" ? addableProperties(view.element, properties, added) : []),
    [view, properties, added],
  );
  const boxEditors = useRef(new Map<string, EditorHandle>());
  // The editor of the title is in its heading (ThomasBirkmaier/ReqSeq-archive#621): from the first time the title is entered, or the buffer
  // came back with title input, for the life of the buffer (an input it holds must never go with it). Where
  // the caret goes when it comes.
  const [titleOpen, setTitleOpen] = useState(false);
  const titleFocus = useRef<number | "start" | "end" | undefined>(undefined);
  // The documents of the boxes of a choice or relation (SR-104 AK3) that have input: set in the command prompt,
  // so no editor holds them. `onFile` is what the callbacks read, the state makes the boxes show them.
  const [, setValues] = useState<ReadonlyMap<string, string>>(new Map());
  // The box that "Add property" just added: it takes the focus (and the prompt) when it is there.
  const fresh = useRef<EditableBox | undefined>(undefined);
  // The unsaved boxes this buffer was shown with, as compared with the file (set when it first loads).
  // The input is handed to the editors that are made for it and dropped when they have taken it (a box that
  // unmounts and mounts again shows what is stored). The text is kept only when it was typed on: a draft of
  // boxes alone has the file text as its text, which may have changed since.
  const keptBoxes = useRef(new Map<string, BoxDraft>());
  const keptText = useRef<string | undefined>(undefined);
  const boxKeys = shown.map((box) => box.key);
  // What the callbacks need of the latest render.
  const now = useRef({
    buffer,
    call,
    searchCall,
    onData,
    onDraft,
    onEcho,
    onDrawn,
    onGone,
    onCopy,
    onOpenTarget,
    onPickElement,
    onAsk,
    onType,
    readOnly,
    handle,
    boxes,
    boxKeys,
    properties,
    addable,
    shown,
    keep,
    memory,
    dispatch,
  });
  now.current = {
    buffer,
    call,
    searchCall,
    onData,
    onDraft,
    onEcho,
    onDrawn,
    onGone,
    onCopy,
    onOpenTarget,
    onPickElement,
    onAsk,
    onType,
    readOnly,
    handle,
    boxes,
    boxKeys,
    properties,
    addable,
    shown,
    keep,
    memory,
    dispatch,
  };
  // The fields of the element (SR-128), and the field the focus was in last, which "Copy field" from the
  // command prompt needs: it runs while the prompt has the focus. A box copies what its editor holds.
  const fields = useRef(NOTHING);
  fields.current =
    view.status === "ok"
      ? copyable(
          view.element,
          () => docOf(now.current.handle),
          (key) => {
            const doc = boxEditors.current.get(key)?.doc();
            // The criteria box copies its texts, without their keys.
            return doc === undefined ? valueText(key) : shownDoc(now.current.boxes.get(key)?.info, doc);
          },
          shown,
        )
      : NOTHING;
  const lastField = useRef<string | undefined>(undefined);
  // The ID or the status in the modeline takes the focus for its context menu (SR-196): it is the last
  // field of the shown element then, so a command from the prompt acts on it as the menu does.
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const focused = (event: FocusEvent): void => {
      const field = modelineField(event.target);
      if (field !== undefined) {
        lastField.current = field;
      }
    };
    document.addEventListener("focusin", focused);
    return () => {
      document.removeEventListener("focusin", focused);
    };
  }, [active]);
  // What the cursor was on when a prompt opened last (SR-132).
  const pointed = useRef<Pointer>(NO_POINTER);
  const copy = (label: string | undefined): void => {
    copyField(fields.current, label, now.current.onCopy);
  };

  // What the parts of the buffer read and set: its refs, its state setters and values of this render.
  const state: ElementState = {
    buffer,
    dispatch,
    onAsk,
    article,
    members,
    boxKeys,
    mark,
    now,
    onFile,
    boxEditors,
    diskState,
    held,
    shownFile,
    autosave,
    keptBoxes,
    keptText,
    titleFocus,
    textEditor,
    editAsked,
    loadedOnce,
    initialDraft,
    hiddenNow,
    saveOnReveal,
    askAgain,
    saving,
    settled,
    mounted,
    said,
    wrote,
    fresh,
    lastField,
    pointed,
    setView,
    setGot,
    setText,
    setTouched,
    setConflict,
    setDeleted,
    setNotSaved,
    setAdded,
    setTitleOpen,
    setValues,
  };
  const input = elementInput(state);
  const { setDiskState, editorDocs, valueText, setValue, stepValue, currentDraft, keepDraft } = input;
  const { boxEdits, inputDocs, fileDocs, decide, endConflict, lockedNote, changed } = input;

  // The inline references of the text: followed on a click, and the outdated ones marked (ThomasBirkmaier/ReqSeq-archive#424). The
  // editor is configured again only when the hints about the text change.
  // The element as the buffer shows it: with the dates of its outdated hints once they are there (ThomasBirkmaier/ReqSeq-archive#702).
  const dated = useHintDates(call, buffer, view);
  const outdated = view.status === "ok" ? outdatedReferences(dated(view.element)) : undefined;
  const signature = JSON.stringify([...(outdated ?? [])]);
  const { fieldOf, titleEditable, openTitle, editTitle, enter, move, step } = elementFocus(state, {
    lockedNote,
  });
  const { pick, title, follow, plugins } = useTextPlugins({
    now,
    view,
    buffer,
    titles,
    outdated,
    signature,
    step,
  });

  const { rename, apply, failed } = elementLoads(state, {
    setDiskState,
    editorDocs,
    inputDocs,
    fileDocs,
    decide,
    keepDraft,
    currentDraft,
  });
  // The shown buffer is a new one (the app keys this component by buffer), so "loading" shows once; a
  // reload after a change of the workspace keeps the editors (focus, cursor and undo history).
  useEffect(() => {
    let current = true;
    clearTimeout(askAgain.current);
    if (!loadedOnce.current) {
      onData(buffer.key, undefined);
    }
    // Fresh when the read is asked, not when a slow answer comes: shown within 2 s of the change (SR-116).
    const changedJustNow = outside.fresh(buffer.id);
    // A buffer shown again while its save from leaving it runs reads its element after that save, with
    // the draft that is left then (SR-105): the bytes it then holds are those of its own save.
    const read = () => call("element.get", { ref: buffer.id, repository: buffer.repository });
    const asked =
      loadedOnce.current || keep === undefined
        ? read()
        : keep.ready().then((left) => {
            initialDraft.current = left;
            return read();
          });
    // An answer asked before a save of this buffer answered is older than that save's answer (autosave
    // writes while the reload of the last save is on its way).
    const writes = settled.current;
    void asked.then((answer) => {
      if (!current || staleRead(writes, settled.current)) {
        return;
      }
      if (answer.ok) {
        // The lines show what the file holds, also when `apply` keeps input over a change on disk.
        setGot(answer.output);
        apply(answer.output.element, answer.output.fileSha256, changedJustNow);
      } else {
        // An "Edit text" that waited for this element is void: it must not act when a later load succeeds.
        editAsked.current = false;
        failed(answer);
      }
    });
    return () => {
      current = false;
    };
  }, [call, buffer.key, buffer.id, buffer.repository, revision, touched]);
  // Shown after it was drawn in advance: what a first load at the switch sets, the highlight of an element
  // changed outside just now (SR-116), and the input that came back with its file is saved.
  useReveal(() => {
    if (loadedOnce.current && outside.fresh(buffer.id)) {
      mark([TITLE_FIELD]);
    }
    if (saveOnReveal.current) {
      saveOnReveal.current = false;
      autosave.current?.input();
    }
  });
  useLinesAgain(call, buffer, elsewhere, got, setGot);
  // The parents line is asked for at the same time as the element, and the element is shown with it, so
  // nothing above the title comes in later and moves the fields under the pointer (ThomasBirkmaier/ReqSeq-archive#542). Every change from
  // outside asks for the parents again (SR-116), the element only when the change names it (`touched`);
  // after such a change the parents can answer after the element, so a parent added outside moves the title
  // down once.
  const parents = useParents({
    call,
    id: buffer.id,
    repository: buffer.repository,
    revision: revision + outside.seq,
    onEcho,
  });
  // The modeline shows the element when the buffer does: once its parents line has answered too.
  const loadedElement = shownElement(view, parents.answered);
  const { facetsAsked, valueFacets } = useValueFacets(outside, now);

  // Asked once the element is shown (with its parents line), so nothing comes before the first display.
  const valueKey = valueKeyOf(loadedElement);
  // The keys of the boxes with a value that opens a list, for their context menu (SR-196 AK2).
  const [listable, setListable] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    // Only the shown element's context menu needs them (SR-196 AK2): a hidden view asks once it is shown.
    if (loadedElement === undefined || hidden) {
      return;
    }
    const answer = valueFacets(loadedElement);
    void answer.then((settled) => {
      if (mounted.current && facetsAsked.current?.answer === answer) {
        setListable(new Set(settled.ok ? listableValues(settled.output, []).map((value) => value.key) : []));
      }
    });
  }, [valueKey, outside.seq, hidden]);
  // The file changed outside under the input, or is gone (SR-106): the modeline says so.
  const disk = diskMark(deleted, conflict);
  useEffect(() => {
    if (loadedElement !== undefined) {
      onData(buffer.key, {
        kind: "element",
        element: loadedElement,
        ...(disk === undefined ? {} : { disk }),
        ...(notSaved === undefined ? {} : { notSaved }),
        ...(members === undefined || !isPackage ? {} : { members }),
        ...(markedEntry === undefined || !isPackage ? {} : { marked: markedEntry }),
      });
    }
  }, [loadedElement, disk, notSaved, members, isPackage, markedEntry]);

  const { saveInput, save, resolve, inputGoing, flush } = elementSaves(state, {
    endConflict,
    keepDraft,
    currentDraft,
    inputDocs,
    boxEdits,
    setValue,
    changed,
    lockedNote,
    rename,
    apply,
    failed,
  });

  const commands = elementCommands(state, { lockedNote, setValue, fieldOf, pick, flush });
  const { openValue } = commands;
  // A box that was added takes the focus: the caret in a text box (when its editor is there), the box itself
  // and its prompt for a choice or relation.
  useEffect(() => {
    const box = fresh.current;
    if (box === undefined) {
      return;
    }
    fieldOf(box.key)?.focus();
    if (isValueKind(box.info.kind)) {
      fresh.current = undefined;
      openValue(box);
    }
  }, [added]);

  const { enterField, onBufferKey } = elementKeys(state, {
    lockedNote,
    stepValue,
    titleEditable,
    openTitle,
    enter,
    move,
    openValue,
  });
  const pointer = elementPointer(state, { inputDocs, flush, valueFacets, enterField });
  const api = useElementControls(state, {
    handle,
    active,
    register,
    packageModel,
    conflict,
    save,
    copy,
    follow,
    ...commands,
    editTitle,
    resolve,
    saveInput,
    inputGoing,
    flush,
    ...pointer,
  });

  // The editors take no input in a read-only element, and none while its file is gone (SR-106 AK3).
  const locked = readOnly || deleted;
  // What the heading of the title shows and whether it takes input: a function of its own, so the render
  // stays small.
  const titleProps = (element: DataExportElement): Pick<TitleBoxProps, "id" | "readOnly" | "initial"> => {
    // The unsaved title this buffer was shown with, for its editor when it is made (ThomasBirkmaier/ReqSeq-archive#621).
    const kept = keptBoxes.current.get(TITLE_FIELD)?.doc;
    return {
      id: shownId(element.shortId, element.identifier),
      readOnly: locked || boxes.get(TITLE_FIELD)?.lineBreak !== false,
      ...(kept === undefined ? {} : { initial: kept }),
    };
  };
  // The block "On disk" under a field in conflict (SR-106 AK2).
  const diskBlock = (label: string): React.JSX.Element | null => {
    const field = conflict?.find((candidate) => candidate.label === label);
    return field === undefined ? null : (
      <OnDisk
        field={field}
        info={boxes.get(label)?.info}
        onResolve={resolve}
        onLeave={() => {
          article?.focus();
        }}
      />
    );
  };

  return (
    <article
      className="buffer element"
      aria-label={buffer.name}
      {...bufferMark(hidden)}
      tabIndex={0}
      ref={setArticle}
      onFocus={(event) => {
        const label = event.target.closest<HTMLElement>("[data-field]")?.dataset["field"];
        lastField.current = label;
        const box = label === undefined ? undefined : now.current.boxes.get(label);
        if (box !== undefined && isLocked(box)) {
          now.current.onEcho(lockNote(box.key, box));
        }
      }}
      onKeyDown={onBufferKey}
      onClickCapture={(event) => {
        // Ctrl/Cmd+click on a value of a property box lists the elements with it (SR-132 AK1), before the
        // link of a relation target opens it. A plain click on the value of a choice box asks for its value (SR-156).
        if (!(event.target instanceof Element)) {
          return;
        }
        if (!isModClick(event, isMac(navigator.platform))) {
          if (isPlainClick(event)) {
            api.current.clickChoice(event.target);
          }
          return;
        }
        const pointer = api.current.clickPointer(event.target);
        if (pointer.kind === "none") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void api.current.listValue(pointer);
      }}
    >
      <div className="column">
        {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
        {view.status === "ok" && parents.answered ? (
          <>
            <ParentsRow
              parents={parents.parents}
              dispatch={dispatch}
              mark={(parent) => outdatedParent(dated(view.element), parent.open.id, parent.open.repository)}
            />
            <ElementText
              title={{
                text: view.element.title,
                ...titleProps(view.element),
                open: titleOpen,
                restore: memory.editors.get(TITLE_FIELD),
                onClose: (state) => {
                  memory.editors.set(TITLE_FIELD, state);
                },
                onUpdate: () => {
                  autosave.current?.release();
                },
                onOpen: openTitle,
                onChange: (_doc, typed) => {
                  changed(undefined, typed);
                },
                onLeave: () => {
                  fieldOf(TITLE_FIELD)?.focus();
                },
                navigation: {
                  down: () => step(TITLE_FIELD, 1),
                  up: () => step(TITLE_FIELD, -1),
                },
                onHandle: (editor) => {
                  if (editor === undefined) {
                    boxEditors.current.delete(TITLE_FIELD);
                    return;
                  }
                  boxEditors.current.set(TITLE_FIELD, editor);
                  keptBoxes.current.delete(TITLE_FIELD);
                  const at = titleFocus.current;
                  titleFocus.current = undefined;
                  if (at !== undefined) {
                    editor.focus(at);
                  }
                },
              }}
              titleDisk={diskBlock(TITLE_FIELD)}
              belowTitle={
                pageModel === undefined ? undefined : (
                  <PackageSummaryLine
                    call={call}
                    id={buffer.id}
                    name={buffer.name}
                    revision={revision + outside.seq}
                    onEcho={onEcho}
                    onOpenResult={onOpenResult}
                  />
                )
              }
              text={{
                text,
                readOnly: locked,
                plugins,
                ...(keptText.current === undefined ? {} : { initial: keptText.current }),
                restore: memory.editors.get(TEXT_FIELD),
                onClose: (state) => {
                  memory.editors.set(TEXT_FIELD, state);
                },
                onUpdate: () => {
                  autosave.current?.release();
                },
                onChange: (doc, typed) => {
                  changed(doc, typed);
                },
                onEscape: () => {
                  article?.focus();
                },
                handle: (editor) => {
                  if (editor !== undefined) {
                    keptText.current = undefined;
                  }
                  textEditor.current = editor;
                  if (editor !== undefined && editAsked.current) {
                    editAsked.current = false;
                    if (article?.contains(document.activeElement) === true) {
                      editor.focus("end");
                    }
                  }
                  setHandle(editor);
                },
              }}
              textDisk={diskBlock(TEXT_FIELD)}
              onCopy={copy}
              marked={marked}
            />
            {shown.map((box) => {
              const editable = boxes.get(box.key);
              const kept = keptBoxes.current.get(box.key)?.doc;
              const value = onFile.current.values.get(box.key);
              // A box of a text kind is edited in its editor; a choice or relation is set in the minibuffer.
              const textBox: TextBoxProps | undefined =
                editable !== undefined && !isValueBox(editable)
                  ? {
                      label: box.key,
                      text: editable.doc,
                      ...(kept === undefined ? {} : { initial: kept }),
                      readOnly: locked || editable.lineBreak,
                      many: editable.info.many,
                      numbered: editable.info.many && isNumberedList(view.element.properties[box.key]),
                      markdown: editable.info.markdown,
                      criteria: isKeyedBox(editable),
                      criterionReferences:
                        got?.criterionReferences?.property === box.key
                          ? got.criterionReferences.criteria
                          : undefined,
                      outdated: outdatedReferences(dated(view.element), box.key),
                      follow,
                      title,
                      pickElement: pick.pickElement,
                      repository: pick.repository,
                      restore: memory.editors.get(box.key),
                      onClose: (state) => {
                        memory.editors.set(box.key, state);
                      },
                      onUpdate: () => {
                        autosave.current?.release();
                      },
                      onChange: (_doc, typed) => {
                        changed(undefined, typed);
                      },
                      onLeave: () => {
                        fieldOf(box.key)?.focus();
                      },
                      navigation: {
                        down: () => step(box.key, 1),
                        up: () => step(box.key, -1),
                      },
                      onHandle: (editor) => {
                        if (editor === undefined) {
                          boxEditors.current.delete(box.key);
                        } else {
                          boxEditors.current.set(box.key, editor);
                          keptBoxes.current.delete(box.key);
                          if (fresh.current?.key === box.key) {
                            // The box "Add property" added: the caret is in it.
                            fresh.current = undefined;
                            editor.focus("end");
                          }
                        }
                      },
                    }
                  : undefined;
              return (
                <PropertyField
                  key={box.key}
                  box={box}
                  editable={editable}
                  value={value}
                  textBox={textBox}
                  element={dated(view.element)}
                  listable={listable.has(box.key)}
                  onCopy={copy}
                  marked={marked}
                  onOpenRelation={onOpenRelation}
                  disk={diskBlock(box.key)}
                />
              );
            })}
            {got === undefined ? null : (
              <>
                <VariantLines output={got} onOpenRelation={onOpenRelation} />
                <EvidenceLines
                  call={call}
                  buffer={buffer}
                  revision={revision}
                  outside={outside.seq}
                  ownSaves={() => settled.current}
                  output={got}
                  onOpenRelation={onOpenRelation}
                />
              </>
            )}
            <RelationGroups
              element={dated(view.element)}
              onCopy={copy}
              marked={marked}
              onOpenRelation={onOpenRelation}
            />
            {pageModel === undefined ? null : (
              <PackageMembers
                model={pageModel}
                buffer={buffer}
                selection={selection}
                call={call}
                revision={revision}
                outside={outside}
                dispatch={dispatch}
                members={members}
                onMembers={setMembers}
                onEntries={setEntries}
                onListFocus={setMembersFocused}
                onEcho={onEcho}
                onLeave={() => {
                  article?.focus({ preventScroll: true });
                }}
                focusOnLoad={membersFocus}
              />
            )}
          </>
        ) : null}
      </div>
    </article>
  );
};
