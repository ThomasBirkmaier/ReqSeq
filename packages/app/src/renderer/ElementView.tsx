// The element buffer: one element as `element.get` gives it. The title is edited in its heading, one line of
// plain text (#621, `TitleBox.tsx`), and saved and compared with the file like a box (`TITLE_FIELD`). The
// text is edited in the Markdown editor with live preview (SR-065, D-061). The properties are boxes below it
// (SR-104): a property of a text kind (text, number, date) is edited in its box, one editor with the values,
// one per line (`TextBox.tsx`); a property the metamodel marks `markdown` shows its values formatted like the
// text, with the source on the line with the caret only (SR-127). The value of a choice or relation property
// is set in the minibuffer, the one control (D-062): Enter on its box asks for the allowed values or for an
// element (`property-prompts.ts`). "Add property" puts an empty box at its place, with the caret in it, or
// with the focus on it and the prompt open at once for a choice or relation. A property the type does not
// know stays a read-only box (D-012, spec question #469). Empty properties are left out; the UUID and the
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
import { Prec } from "@codemirror/state";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Autosave } from "./autosave.js";
import { createAutosave } from "./autosave.js";
import type { BufferKeep, UndoMemory } from "./buffer-memory.js";
import type { DataExportElement, DataExportRelation } from "@logreq/core";
import type { ElementControls, Prompt } from "./actions.js";
import { findElements } from "./actions.js";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import { elementBuffer, filteredList } from "./buffers.js";
import type { Answer, Call } from "./call.js";
import { NOTHING, PROMPT_INPUT, copyField, copyable, cursorField, docOf } from "./copy.js";
import type { PropertyInfo, PropertyModel, RelationRow } from "./element-view.js";
import {
  TITLE_FIELD,
  isPropertyTarget,
  outdatedReferences,
  relationGroups,
  rowOfRelation,
} from "./element-view.js";
import type { EditorHandle } from "./editor/Editor.js";
import { Editor } from "./editor/Editor.js";
import { mergePlugins } from "./editor/plugins.js";
import { referenceAt, references, referencesIn } from "./editor/references.js";
import type { Reference } from "./editor/references.js";
import { boxNavigation } from "./editor/box-navigation.js";
import { afterSave, dirty } from "./editor/save.js";
import { referenceSearch } from "./editor/reference-search.js";
import type { ReferenceTitles } from "./reference-titles.js";
import { awaitingReference, slashMenu } from "./editor/slash-menu.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import type { DiskState } from "./disk-state.js";
import {
  DISK_START,
  conflictEnded,
  decided,
  failure,
  fileRead,
  goneRead,
  leaveSaves,
  lockedNote as lockedNoteOf,
  readFailed,
  saveNote as saveNoteOf,
  showsKept,
  takeFileEdits,
} from "./disk-state.js";
import type { BoxDraft, Draft, ShownFile } from "./drafts.js";
import { boxDrafts, makeDraft, rebased, sameDraft, withShown } from "./drafts.js";
import { FieldBox } from "./FieldBox.js";
import type { ConflictField, OutsideChange } from "./outside-change.js";
import {
  TEXT_FIELD,
  changedOnDisk,
  deletedOnDisk,
  diskMark,
  draftInput,
  isGone,
  keptBoxes as keptBoxesOf,
  onDisk,
  outsideChange,
  resolvePrompt,
} from "./outside-change.js";
import type { OutsideChanges } from "./outside-marks.js";
import { NO_CHANGES, fieldTexts, marksOnRead, touchedSince } from "./outside-marks.js";
import { useOutsideMarks } from "./use-outside-marks.js";
import { ctrlStep, historyStep, isMac } from "./keys.js";
import { ListView } from "./ListView.js";
import { TextBox } from "./TextBox.js";
import { TitleBox } from "./TitleBox.js";
import type { TitleBoxProps } from "./TitleBox.js";
import { ParentsRow, useParents } from "./ParentsLine.js";
import type { BufferData } from "./modeline.js";
import type { MemberCount, PackageModel } from "./package-page.js";
import { memberCount, memberList, memberSummary, packageOf, packageSelection } from "./package-page.js";
import {
  addableProperties,
  allBoxes,
  changedBoxes,
  choiceKeys,
  editsOf,
  emptyBox,
  fieldBoxes,
  hintKeys,
  isValueKind,
  relationDoc,
  relationTargets,
  savedHint,
  shownBoxes,
  storedDocs,
  updateInput,
  withTitle,
} from "./property-edit.js";
import type { BoxEdit, EditableBox } from "./property-edit.js";
import { addPropertyPrompt, choicePrompt, relationPrompt } from "./property-prompts.js";
import { NO_HISTORY, record, redo, undo } from "./value-history.js";
import type { ListableValue, Pointer } from "./value-list.js";
import { NO_POINTER, listableValues, pointedValue, valueSignature, valuesPrompt } from "./value-list.js";

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
  /**
   * A read found the element gone (`ref.unknown`): when the buffer is shown and nothing was shown yet, or
   * when its file is deleted (SR-106 AK3). The app forgets its name for "Go to" (#681). Default: nothing.
   */
  readonly onGone?: (key: string) => void;
  /** A field is copied (SR-128): its name and its value as text; the app puts it on the clipboard. */
  readonly onCopy: (label: string, text: string) => void;
  /** A relation target is opened: its element buffer, by UUID and repository (#416). */
  readonly onOpenRelation: (target: ElementBuffer) => void;
  /**
   * A relation target or the target of an inline reference is opened: by its UUID, and by the repository
   * the link names (a relation has none: the output has no repository).
   */
  readonly onOpenTarget: (id: string, repository?: string) => void;
  /** The slash menu's "Reference to element" (SR-129) or `[[` (SR-066) asks for an element: the app opens a prompt. */
  readonly onPickElement: (request: ReferenceRequest) => void;
  /** The titles of reference targets in other repositories (D-058), kept by the app for the workspace. */
  readonly titles: ReferenceTitles;
  /** The minibuffer asks for the property to add or the value of a choice or relation (SR-104): the app opens the prompt. */
  readonly onAsk: (prompt: Prompt) => void;
  /** The unsaved text this buffer had when it was shown last, if any, with the file text it was typed on. */
  readonly draft: Draft | undefined;
  /** The text of the buffer has unsaved changes (the draft), or has none (undefined). */
  readonly onDraft: (key: string, draft: Draft | undefined) => void;
  /** Gives the app the means to save and edit while the text is shown, and takes them back. */
  readonly register: (controls: ElementControls | undefined) => void;
  /** The types that are packages (SR-112); an element of one shows the elements that name it. */
  readonly packages: PackageModel | undefined;
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
}

/** What one write sent: the text, the boxes, and the boxes that were added before it went. */
interface Sent {
  readonly doc: string;
  readonly edits: readonly BoxEdit[];
  readonly added: readonly string[];
}

/** How a save speaks: "Save element" says what happened; autosave and the other saves only what went wrong. */
type SaveMode = "asked" | "quiet";

type View =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ok"; readonly element: DataExportElement };

/** The field a key press on the buffer is for: none on the buffer itself. */
const fieldLabel = (target: EventTarget, buffer: EventTarget): string | undefined =>
  target === buffer
    ? undefined
    : (target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset["field"];

/** A key press is for the buffer when its target is the buffer, or a field that has the focus itself (SR-128). */
const forBuffer = (target: EventTarget, buffer: EventTarget): boolean =>
  target === buffer || (target instanceof HTMLElement && target.matches(".field[tabindex]"));

/**
 * A key the buffer handles: Enter, Down when there is a field or the elements of a package to go to, and
 * Escape and Up on a field (on the buffer itself they are not for it).
 */
const fieldKey = (key: string, label: string | undefined, hasMembers: boolean): boolean =>
  key === "Enter" ||
  (key === "ArrowDown" && (label !== undefined || hasMembers)) ||
  (label !== undefined && (key === "Escape" || key === "ArrowUp"));

const Relation = ({
  row,
  onOpenRelation,
}: {
  readonly row: RelationRow;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}): React.JSX.Element => {
  const target =
    row.state === "available" && row.repository !== ""
      ? elementBuffer(row.id, row.repository, row.label)
      : undefined;
  return (
    <li className={target !== undefined ? "relation" : "relation unavailable"}>
      {target !== undefined ? (
        <span
          role="link"
          tabIndex={0}
          data-target-id={row.id}
          data-target-repository={row.repository}
          onClick={() => {
            onOpenRelation(target);
          }}
          onKeyDown={(event) => {
            // Enter with Ctrl, Cmd or Alt is a shortcut of the window: "Follow reference" opens the focused
            // target itself, "List elements with this value" lists it (SR-132).
            if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              onOpenRelation(target);
            }
          }}
        >
          {row.label}
        </span>
      ) : (
        <>
          <span>{row.label}</span> <span className="state">{row.state}</span>
        </>
      )}
      {row.outdated ? <span className="outdated"> outdated</span> : null}
    </li>
  );
};

/**
 * The rows of a relation box that is edited: the targets of its document, the stored ones with their state
 * and the ones that were added with the label of the hit.
 */
const rowsOf = (key: string, doc: string, all: readonly DataExportRelation[]): RelationRow[] => {
  const stored = all
    .filter((relation) => isPropertyTarget(relation) && relation.kind === key)
    .map(rowOfRelation);
  return relationTargets(doc).map(
    (target) =>
      stored.find((row) => row.id === target.id && row.repository === target.repository) ?? {
        ...target,
        state: "available",
        outdated: false,
      },
  );
};

/** The reference "Follow reference" takes in a box: at the caret, or the first one when the box has none. */
const boxReference = (box: EditorHandle, markdown: boolean): Reference | undefined => {
  if (!markdown) {
    return undefined;
  }
  const state = box.state();
  return box.hasFocus() ? referenceAt(state, state.selection.main.head) : referencesIn(state)[0];
};

/** What the minibuffer says on entering a list with a value that holds a line break (a hand-written file). */
const lineBreakNote = (key: string): string => `${key} has a value with a line break: edit it in the file`;

/** Whether a box that the type knows is not edited: a value with a line break, or a target that cannot be read. */
const isLocked = (box: EditableBox): boolean => box.lineBreak || box.unmatched === true;

/** What the minibuffer says on entering a box that `isLocked`. */
const lockNote = (key: string, box: EditableBox): string =>
  box.lineBreak ? lineBreakNote(key) : `${key} has a target that cannot be read: edit it in the file`;

/** What decides the values of the shown element that open a list (SR-132); none while it is not shown. */
/** The focused target link of a relation box or a relation group of the element buffer, if one has the focus. */
const focusedTarget = (): HTMLElement | null =>
  document.activeElement instanceof HTMLElement
    ? document.activeElement.closest<HTMLElement>("[data-buffer] [data-target-id]")
    : null;

const valueKeyOf = (element: DataExportElement | undefined): string | undefined =>
  element === undefined ? undefined : valueSignature(element);

/** The element the buffer shows: once it is loaded and its parents line has answered too. */
const shownElement = (view: View, parentsAnswered: boolean): DataExportElement | undefined =>
  view.status === "ok" && parentsAnswered ? view.element : undefined;

/**
 * The block "On disk" under a field in conflict (SR-106 AK2): the file's value as it is, quiet and read-only,
 * with the lines the input lacks in heavier weight (meaning, no colour: D-062). It is no control: Enter on it
 * asks which version holds, as "Resolve change on disk" does; Escape goes back to the buffer.
 */
const OnDisk = ({
  field,
  info,
  onResolve,
  onLeave,
}: {
  readonly field: ConflictField;
  /** The property of the box; none for the text. */
  readonly info: PropertyInfo | undefined;
  readonly onResolve: () => void;
  readonly onLeave: () => void;
}): React.JSX.Element => {
  const lines = onDisk(field, info);
  return (
    <div
      className="on-disk"
      role="group"
      aria-label={`On disk: ${field.label}`}
      data-on-disk={field.label}
      tabIndex={0}
      onKeyDown={(event) => {
        const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        if (plain && (event.key === "Enter" || event.key === "Escape")) {
          event.preventDefault();
          if (event.key === "Enter") {
            onResolve();
          } else {
            onLeave();
          }
        }
      }}
    >
      <span className="key">On disk</span>
      <span className="value">
        {lines.length === 0 ? (
          <span className="line">(empty)</span>
        ) : (
          lines.map((line, at) => (
            <span className="line" key={at}>
              {line.differs ? <mark>{line.text}</mark> : line.text}
            </span>
          ))
        )}
      </span>
    </div>
  );
};

/** The undo history of the buffer (SR-105 AK2): the app's, kept with the buffer, or else one of the view's own. */
const useUndoMemory = (keep: BufferKeep | undefined): UndoMemory => {
  const own = useRef<UndoMemory>({ editors: new Map(), values: new Map() });
  return keep?.memory ?? own.current;
};

/** The loaded element is read-only. */
const isReadOnly = (view: View): boolean => view.status === "ok" && view.element.readOnly === true;

/** Keys that only modify another key: pressed on their own they are no key of the buffer. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta"]);

/** A key on the buffer after Enter that takes back an "Edit text" still waiting for the editor. */
const takesBackEdit = (key: string): boolean => key !== "Enter" && !MODIFIER_KEYS.has(key);

export const ElementView = ({
  call,
  buffer,
  revision,
  outside = NO_CHANGES,
  onData,
  onEcho,
  onGone,
  onCopy,
  onOpenTarget,
  onOpenRelation,
  onPickElement,
  titles,
  onAsk,
  draft,
  onDraft,
  register,
  packages,
  properties,
  dispatch,
  keep,
}: ElementViewProps): React.JSX.Element => {
  const [view, setView] = useState<View>({ status: "loading" });
  // The text as last loaded or saved: what the document is compared with.
  const [text, setText] = useState("");
  const [handle, setHandle] = useState<EditorHandle | undefined>(undefined);
  // The same editor at once: `handle` comes with the next render, and a key can come before it.
  const textEditor = useRef<EditorHandle | undefined>(undefined);
  // "Edit text" (Enter on the buffer) came before the text editor was there, while the element loaded: the
  // caret goes into the editor when it comes, as long as the focus is still in this buffer.
  const editAsked = useRef(false);
  const baseline = useRef("");
  const loadedOnce = useRef(false);
  // The changes from outside that named this element since it was shown: each asks for it again. A removal
  // asks too, and only the answer says whether the file is gone (SR-106 AK3).
  const [touched, setTouched] = useState(0);
  const seenChange = useRef(outside.seq);
  useEffect(() => {
    if (outside.seq !== seenChange.current) {
      const named = touchedSince(outside, buffer.id, seenChange.current);
      seenChange.current = outside.seq;
      if (named) {
        setTouched((count) => count + 1);
      }
    }
  }, [outside]);
  // The file the shown answer was built from (`fileSha256`) and what its fields show: a reload with other
  // bytes after a change from outside highlights the fields that differ (SR-116), the app's own save never.
  const held = useRef<{ readonly sha: string; readonly fields: ReadonlyMap<string, string> } | undefined>(
    undefined,
  );
  const { marked, mark } = useOutsideMarks();
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
  // The last save failed (`not saved` in the modeline), and what was said last about saves: an error or a
  // hint is echoed once while it stays the same, not after every pause (D-062).
  const [notSaved, setNotSaved] = useState(false);
  const said = useRef<{ readonly error?: string | undefined; readonly hint?: string | undefined }>({});
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
  const selection = useMemo(() => packageSelection(buffer.id), [buffer.id]);
  const returning = useRef(buffer.memberCursor !== undefined);
  const packageModel = view.status === "ok" ? packageOf(packages, view.element.type) : undefined;
  const isPackage = packageModel !== undefined;
  const readOnly = isReadOnly(view);
  // The boxes that are edited (SR-104), and the editors of those with text by key. `stored` is the document
  // of each as last loaded or saved, what an editor is compared with (like `baseline` for the text). The
  // boxes that were added (AK2) have no stored value: their base is the empty document.
  const [added, setAdded] = useState<readonly string[]>([]);
  const addedRef = useRef<readonly string[]>([]);
  // The title is one of them (#621): its field, saved and compared with the file like a text box.
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
  const stored = useRef(new Map<string, string>());
  // The editor of the title is in its heading (#621): from the first time the title is entered, or the buffer
  // came back with title input, for the life of the buffer (an input it holds must never go with it). Where
  // the caret goes when it comes.
  const [titleOpen, setTitleOpen] = useState(false);
  const titleFocus = useRef<number | "start" | "end" | undefined>(undefined);
  // The documents of the boxes of a choice or relation (SR-104 AK3) that have input: set in the minibuffer,
  // so no editor holds them. The ref is what the callbacks read, the state makes the boxes show them.
  const [, setValues] = useState<ReadonlyMap<string, string>>(new Map());
  const values = useRef<ReadonlyMap<string, string>>(new Map());
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
    onData,
    onDraft,
    onEcho,
    onGone,
    onCopy,
    onOpenTarget,
    onPickElement,
    readOnly,
    handle,
    boxes,
    boxKeys,
    properties,
    addable,
    shown,
    keep,
    memory,
  });
  now.current = {
    buffer,
    call,
    onData,
    onDraft,
    onEcho,
    onGone,
    onCopy,
    onOpenTarget,
    onPickElement,
    readOnly,
    handle,
    boxes,
    boxKeys,
    properties,
    addable,
    shown,
    keep,
    memory,
  };
  // The fields of the element (SR-128), and the field the focus was in last, which "Copy field" from the
  // command prompt needs: it runs while the prompt has the focus. A box copies what its editor holds.
  const fields = useRef(NOTHING);
  fields.current =
    view.status === "ok"
      ? copyable(
          view.element,
          () => docOf(now.current.handle),
          (key) => boxEditors.current.get(key)?.doc() ?? valueText(key),
          shown,
        )
      : NOTHING;
  const lastField = useRef<string | undefined>(undefined);
  // What the cursor was on when a prompt opened last (SR-132).
  const pointed = useRef<Pointer>(NO_POINTER);
  const copy = (label: string | undefined): void => {
    copyField(fields.current, label, now.current.onCopy);
  };

  // What the boxes hold, by key: their editors, and the documents set in the minibuffer.
  const editorDocs = (): Map<string, string> =>
    new Map([
      ...[...boxEditors.current].map(([key, editor]): [string, string] => [key, editor.doc()]),
      ...values.current,
    ]);
  // What a copy of a box of a choice or relation gives when it has input: the keys or the labels, one per line.
  const valueText = (key: string): string | undefined => {
    const doc = values.current.get(key);
    return doc === undefined || now.current.boxes.get(key)?.info.kind !== "relation"
      ? doc
      : relationTargets(doc)
          .map((target) => target.label)
          .join("\n");
  };
  // What a choice or relation box holds now: its input, else the stored document.
  const valueDoc = (key: string): string => values.current.get(key) ?? stored.current.get(key) ?? "";
  // The document of a choice or relation box is set (SR-104 AK3, AK4): the box shows it, the draft has it.
  // The change can be undone (SR-105 AK2), unless it is a step of undo or redo itself (`recorded` false).
  const setValue = (key: string, doc: string, recorded = true): void => {
    if (recorded) {
      const { values: histories } = now.current.memory;
      histories.set(key, record(histories.get(key) ?? NO_HISTORY, valueDoc(key), doc));
    }
    values.current = new Map(values.current).set(key, doc);
    setValues(values.current);
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
    base = baseline.current,
    boxDocs = editorDocs(),
  ): Draft | undefined =>
    makeDraft(
      { doc: textDoc ?? now.current.handle?.doc() ?? base, base },
      boxDrafts(stored.current, boxDocs),
      diskState.current.basis,
    );
  // The app keeps the draft of the buffer, with the element it shows. Without input nothing is unsaved.
  const keepDraft = (kept: Draft | undefined): void => {
    if (kept === undefined) {
      setNotSaved(false);
    }
    now.current.onDraft(now.current.buffer.key, withShown(kept, shownFile.current));
  };
  // The boxes whose document differs from the stored one: what "Save element" sends besides the text.
  const boxEdits = (): BoxEdit[] => changedBoxes(editsOf(now.current.boxes, editorDocs()));
  // The fields with input and what they hold: the text when it was typed in (a text editor that is not
  // there yet holds none), and every box whose document is not the stored one.
  const inputDocs = (): Map<string, string> => {
    const doc = now.current.handle?.doc() ?? baseline.current;
    return new Map([
      ...(dirty(doc, baseline.current) ? [[TEXT_FIELD, doc] as const] : []),
      ...[...editorDocs()].filter(([key, box]) => box !== stored.current.get(key)),
    ]);
  };
  // What the file holds for each field, as last loaded or saved.
  const fileDocs = (): Map<string, string> => new Map([[TEXT_FIELD, baseline.current], ...stored.current]);
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

  // The inline references of the text: followed on a click, and the outdated ones marked (#424). The
  // editor is configured again only when the hints about the text change.
  const outdated = view.status === "ok" ? outdatedReferences(view.element) : undefined;
  const signature = JSON.stringify([...(outdated ?? [])]);
  // The slash menu and the `[[` search (SR-066) are created once: they hold state (the `/` typed), which a
  // reconfiguration would keep only for the same extensions.
  const pick = useMemo(
    () => ({
      pickElement: (request: ReferenceRequest) => {
        now.current.onPickElement(request);
      },
      repository: () => now.current.buffer.repository,
    }),
    [],
  );
  const slash = useMemo(() => slashMenu(pick), [pick]);
  const brackets = useMemo(() => referenceSearch(pick), [pick]);
  // The title of the target of a reference to another repository, when it is here (D-058): the preview of
  // the text and of the Markdown boxes shows it in place of the short ID.
  const title = titles.title;
  // Following a reference, in the text and in the boxes. One function, so a box keeps its plugins.
  const follow = useCallback((reference: Reference): void => {
    now.current.onOpenTarget(reference.id, reference.repository);
  }, []);
  // The field with this label: "Text" has no tab stop of its own (its editor takes the focus).
  const fieldOf = (label: string): HTMLElement | null | undefined =>
    article?.querySelector<HTMLElement>(`[data-field="${CSS.escape(label)}"]`);
  // The title can be edited now (#621): the type has a title, the stored one holds no line break, and the
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
  // the text, then the boxes in the order they are shown (`editor/box-navigation.ts`).
  const step = (from: string, by: 1 | -1): boolean =>
    move([TITLE_FIELD, "Text", ...now.current.boxKeys], from, by);
  const stepRef = useRef(step);
  stepRef.current = step;
  const plugins = useMemo(
    () =>
      mergePlugins(references({ outdated: outdated ?? new Map(), follow, title }), slash, brackets, {
        // After the slash menu, which takes Down while it is open.
        extensions: [
          boxNavigation(
            { down: () => stepRef.current("Text", 1), up: () => stepRef.current("Text", -1) },
            Prec.high,
          ),
        ],
      }),
    [signature, slash, brackets, title],
  );

  const setBaseline = (next: string): void => {
    baseline.current = next;
    setText(next);
  };

  // The file was read again while the buffer is shown (SR-106): a field without input follows the file, a
  // field whose input the file now holds has none any more, and input on other bytes than it was typed on
  // is a conflict. A box with input whose property is no longer in the file stays as an added box, so no
  // input is lost.
  const reload = (loaded: string, docs: Map<string, string>, sha: string): void => {
    const input = inputDocs();
    // A box that was added stays while the file has no value for the property, and so does a box with input.
    const open = [
      ...addedRef.current,
      ...[...input.keys()].filter((key) => key !== TEXT_FIELD && !addedRef.current.includes(key)),
    ].filter((key) => !docs.has(key));
    const next = new Map([...docs, ...open.map((key): [string, string] => [key, ""])]);
    const boxDocs = editorDocs();
    // A box without input follows the file once this render is done, so the draft already has it so.
    const followed = new Map(
      [...boxDocs].map(([key, doc]) => [key, doc === stored.current.get(key) ? (next.get(key) ?? doc) : doc]),
    );
    // A choice or relation box with input keeps it; one without, or with what the file now holds, follows
    // the file at once.
    values.current = new Map(
      [...values.current].filter(([key, doc]) => doc !== stored.current.get(key) && doc !== next.get(key)),
    );
    setValues(values.current);
    if (open.length !== addedRef.current.length) {
      addedRef.current = open;
      setAdded(open);
    }
    setBaseline(loaded);
    stored.current = next;
    decide(outsideChange(input, diskState.current.basis, { sha, docs: fileDocs() }));
    // The draft is on the new file text: a text that was not typed on is the new one (the editor
    // follows it after this render), so boxes alone never keep the old text.
    keepDraft(currentDraft(input.has(TEXT_FIELD) ? undefined : loaded, loaded, followed));
  };
  // The first answer for a buffer that comes back with a draft: the draft is compared with the file as it
  // is now, as a reload compares the input (SR-106).
  const restore = (kept: Draft, element: DataExportElement, docs: Map<string, string>, sha: string): void => {
    const loaded = element.text ?? "";
    const change = outsideChange(draftInput(kept), kept.sha, {
      sha,
      docs: new Map([[TEXT_FIELD, loaded], ...docs]),
    });
    const typed = kept.text !== kept.base && !change.dropped.includes(TEXT_FIELD) ? kept.text : undefined;
    keptBoxes.current = new Map(keptBoxesOf(kept, change.dropped, docs));
    keptText.current = typed;
    // Title input comes back in the title's editor, which stays (#621).
    if (keptBoxes.current.has(TITLE_FIELD)) {
      setTitleOpen(true);
    }
    setDiskState({ ...diskState.current, basis: change.kind === "conflict" ? kept.sha : sha });
    if (change.kind === "conflict") {
      decide(change);
    }
    const restored = makeDraft(
      { doc: typed ?? loaded, base: loaded },
      [...keptBoxes.current],
      diskState.current.basis,
    );
    if (!sameDraft(restored, kept)) {
      keepDraft(restored);
    }
    // The boxes of the draft that were added come back (their base is the empty document), and the
    // documents of the choices and relations set in the minibuffer with them.
    const known = [...keptBoxes.current].flatMap(([key, box]) => {
      const info = now.current.properties.get(element.type)?.get(key);
      return info === undefined ? [] : [{ key, box, info }];
    });
    addedRef.current = known
      .filter(({ key, box }) => box.base === "" && !docs.has(key))
      .map(({ key }) => key);
    setAdded(addedRef.current);
    values.current = new Map(
      known.flatMap(({ key, box, info }): [string, string][] =>
        isValueKind(info.kind) ? [[key, box.doc]] : [],
      ),
    );
    setValues(values.current);
  };
  // An answer of `element.get` for the shown element.
  const apply = (element: DataExportElement, sha: string, changedJustNow: boolean): void => {
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
        stored.current = new Map([...docs, ...addedRef.current.map((key): [string, string] => [key, ""])]);
      } else {
        reload(loaded, docs, sha);
      }
      loadedOnce.current = true;
      if (back && inputDocs().size > 0) {
        autosave.current?.input();
      }
    }
    setView({ status: "ok", element });
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
      if (!current || writes !== settled.current) {
        return;
      }
      if (answer.ok) {
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
  // The parents line is asked for at the same time as the element, and the element is shown with it, so
  // nothing above the title comes in later and moves the fields under the pointer (#542). Every change from
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

  // Asked once the element is shown (with its parents line), so nothing comes before the first display.
  const valueKey = valueKeyOf(loadedElement);
  useEffect(() => {
    if (loadedElement !== undefined) {
      void valueFacets(loadedElement);
    }
  }, [valueKey, outside.seq]);
  // The file changed outside under the input, or is gone (SR-106): the modeline says so.
  const disk = diskMark(deleted, conflict);
  useEffect(() => {
    if (loadedElement !== undefined) {
      onData(buffer.key, {
        kind: "element",
        element: loadedElement,
        ...(disk === undefined ? {} : { disk }),
        ...(notSaved ? { notSaved } : {}),
        ...(members === undefined || !isPackage ? {} : { members }),
      });
    }
  }, [loadedElement, disk, notSaved, members, isPackage]);

  // After a save: the answer is the new baseline, the boxes show what the file holds, and what was typed
  // while the save ran stays as a draft. A box that the save emptied (its property left the file) and that
  // was typed in meanwhile stays as an added box, so that input is not lost (#348).
  const settle = (
    output: {
      readonly element: DataExportElement;
      readonly fileSha256: string;
      readonly problems?: readonly { message: string }[];
    },
    sent: Sent,
    editor: EditorHandle,
    mode: SaveMode,
  ): void => {
    const { buffer: shown, onEcho: echo } = now.current;
    const { element } = output;
    settled.current += 1;
    // The file as this save wrote it: the reload its `written` brings finds the same bytes, and what was
    // typed while the save ran is on it.
    held.current = { sha: output.fileSha256, fields: fieldTexts(element) };
    shownFile.current = { element, sha: output.fileSha256 };
    endConflict(output.fileSha256);
    const after = afterSave(sent.doc, element.text ?? "", editor.doc());
    const docs = storedDocs(fieldBoxes(element, now.current.properties));
    const holds = (key: string): string =>
      boxEditors.current.get(key)?.doc() ?? values.current.get(key) ?? "";
    // A box that was added is a stored box now, or was left empty and is dropped (no draft); one that was
    // added or typed in while the save ran stays.
    const open = [
      ...addedRef.current.filter((key) => !docs.has(key) && (!sent.added.includes(key) || holds(key) !== "")),
      ...sent.edits
        .filter(
          (edit) =>
            !docs.has(edit.key) &&
            !addedRef.current.includes(edit.key) &&
            holds(edit.key) !== "" &&
            holds(edit.key) !== edit.doc,
        )
        .map((edit) => edit.key),
    ];
    addedRef.current = open;
    setAdded(open);
    setBaseline(after.baseline);
    stored.current = new Map([...docs, ...open.map((key): [string, string] => [key, ""])]);
    if (after.replace !== undefined) {
      editor.replace(after.replace);
    }
    // The editors compare with what the file holds now, so input typed while the save ran (an undo back
    // to the text before it too) stays when they get the saved text.
    editor.rebase(after.baseline);
    // A box that still holds what was sent shows what the file holds now (an emptied one is gone with its
    // property).
    for (const edit of sent.edits) {
      const saved = docs.get(edit.key);
      const box = boxEditors.current.get(edit.key);
      if (saved !== undefined && box?.doc() === edit.doc && saved !== edit.doc) {
        box.replace(saved);
      }
      if (saved !== undefined) {
        box?.rebase(saved);
      }
    }
    // A choice or relation box that still holds what was sent shows what the file holds now.
    values.current = new Map(
      [...values.current].filter(
        ([key, doc]) => !sent.edits.some((edit) => edit.key === key && edit.doc === doc),
      ),
    );
    setValues(values.current);
    keepDraft(currentDraft());
    setView({ status: "ok", element });
    setNotSaved(false);
    said.current = { ...said.current, error: undefined };
    const hint = savedHint(output.problems, hintKeys(sent.edits, element, now.current.properties));
    if (mode === "asked") {
      echo(hint === undefined ? `Saved ${shown.name}` : `Saved ${shown.name}. ${hint}`);
    } else if (hint !== undefined && hint !== said.current.hint) {
      // Autosave is silent (D-062); a hint of core is said once, not after every pause.
      echo(`Saved ${shown.name}. ${hint}`);
    }
    said.current = { ...said.current, hint };
  };

  // Why the input cannot be saved now, or nothing: the element is read-only or its file is gone or cannot
  // be read (SR-106 AK3), or the file changed under the input (AK2: nothing is saved until the user chose).
  const saveNote = (): string | undefined =>
    saveNoteOf(diskState.current, now.current.readOnly, now.current.buffer.name);
  // Writes the input that differs from the file, in order with the other saves of the buffer. True when no
  // input is left unsaved. "Save element" (`asked`) says what happened; the other saves only what went wrong.
  const saveInput = async (mode: SaveMode): Promise<boolean> => {
    const { handle: editor, onEcho: echo } = now.current;
    if (editor === undefined) {
      return true;
    }
    const input = inputDocs().size > 0;
    const note = saveNote();
    if (note !== undefined) {
      if (mode === "asked") {
        echo(note);
      }
      return !input;
    }
    if (!input) {
      if (mode === "asked") {
        echo("No changes to save");
      }
      return true;
    }
    const job = (): Promise<boolean> => write(editor, mode);
    return now.current.keep?.save(job) ?? job();
  };
  // "Save element" (Ctrl/Cmd+S): at once, after a save that runs.
  const save = (): void => {
    if (!saving.current) {
      void autosave.current?.now(() => saveInput("asked"));
    }
  };
  // A save that went wrong: the modeline says `not saved`, and the minibuffer the reason, once while it
  // stays the same (autosave tries again on the next input, never in a loop).
  const notWritten = (message: string, mode: SaveMode): void => {
    setNotSaved(true);
    if (mode === "asked" || said.current.error !== message) {
      now.current.onEcho(message);
    }
    said.current = { ...said.current, error: message };
  };
  // Writes the text and the boxes with input, on the bytes of the file the buffer shows (`expectedFileSha256`):
  // core refuses the write when the file changed since (SR-106).
  const write = async (editor: EditorHandle, mode: SaveMode, retried = false): Promise<boolean> => {
    const { buffer: shown, call: run, properties: model } = now.current;
    const doc = editor.doc();
    const edits = boxEdits();
    const textDirty = dirty(doc, baseline.current);
    const sent: Sent = { doc, edits, added: addedRef.current };
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
      const { element, fileSha256: sha } = answer.output;
      // Input typed while the save ran stays in the draft: then input is left unsaved.
      let rest: Draft | undefined;
      now.current.keep?.update((draft) => {
        rest = rebased(
          draft,
          {
            ...(textDirty ? { text: doc } : {}),
            boxes: new Map(edits.map((edit) => [edit.key, edit.doc])),
          },
          {
            element,
            sha,
            text: element.text ?? "",
            docs: storedDocs(fieldBoxes(element, model)),
          },
        );
        return rest;
      });
      return rest === undefined;
    }
    if (answer.ok) {
      settle(answer.output, sent, editor, mode);
      // Input typed while the save ran is left for the next save.
      return inputDocs().size === 0;
    }
    if (answer.code === "file.changed-on-disk" || isGone(answer.code)) {
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
    if (answer.output.fileSha256 !== expected) {
      apply(answer.output.element, answer.output.fileSha256, false);
      return diskState.current.conflict === undefined && inputDocs().size === 0;
    }
    if (refused === undefined) {
      return write(editor, mode, true);
    }
    notWritten(refused, mode);
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

  // The prompt that sets the value of a choice or relation box (SR-104 AK3): only the choices of the metamodel,
  // or the targets that are set and the elements `element.search` finds among the target types. When it ends,
  // taken or escaped, the focus goes back to the box, not to the element.
  const openValue = (box: EditableBox): void => {
    const { key } = box;
    const { call: run, onEcho: echo } = now.current;
    const note = lockedNote();
    if (note !== undefined) {
      echo(note);
      return;
    }
    const doc = values.current.get(key) ?? box.doc;
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
          addedRef.current = [...addedRef.current, key];
          stored.current.set(key, "");
          setAdded(addedRef.current);
        }),
      );
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
      echo(`${label} is not a property of this type: edit it in the file`);
    } else if (isLocked(box)) {
      echo(lockNote(label, box));
    } else if (isValueKind(box.info.kind)) {
      setValue(label, "");
      fieldOf(label)?.focus();
    } else {
      boxEditors.current.get(label)?.set("");
      fieldOf(label)?.focus();
    }
  };
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

  // Down on the page of a package goes into its elements; Escape and Up on the first row come back.
  const intoMembers = (root: HTMLElement): void => {
    root.querySelector<HTMLElement>(".members .list")?.focus();
  };
  // Enter on a choice or relation box asks for the value in the minibuffer (SR-104 AK3); on the title or a box
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
  // Enter on a box edits it (on the buffer itself, the text); Escape leaves a box for the buffer; Up and Down
  // on a field move to the field before and after, and Down on the last one into the elements of a package.
  const onField = (key: string, label: string | undefined, root: HTMLElement): void => {
    const down = key === "ArrowDown";
    if (key === "Enter") {
      enterField(label);
    } else if (key === "Escape") {
      article?.focus();
    } else if (label === undefined || !move([TITLE_FIELD, "Text", ...boxKeys], label, down ? 1 : -1, false)) {
      if (down && (members?.total ?? 0) > 0) {
        intoMembers(root);
      }
    }
  };
  // Undo and redo on a choice or relation box step through its value history (SR-105 AK2). True when the
  // key was one of them on such a box.
  const valueHistoryKey = (event: React.KeyboardEvent<HTMLElement>, label: string | undefined): boolean => {
    const value = label === undefined ? undefined : now.current.boxes.get(label);
    const step = historyStep(event, isMac(navigator.platform));
    if (step === undefined || value === undefined || !isValueKind(value.info.kind)) {
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
    if (valueHistoryKey(event, label)) {
      return;
    }
    if (plain && fieldKey(key, label, hasMembers)) {
      event.preventDefault();
      onField(key, label, currentTarget);
    } else if (hasMembers && !event.defaultPrevented && ctrlStep(event) === 1) {
      // Ctrl+N on the page of a package selects its first element (SR-122 AK4). Not from an editor or the
      // list itself (they are not the buffer); Ctrl+P is not the page's: it is the window's.
      event.preventDefault();
      dispatch({ type: "cursor", key: buffer.key, cursor: 0 });
      intoMembers(currentTarget);
    }
  };

  // The row of a relation box that "Follow reference" opens when no target link has the focus: the first
  // target; none when the box is no relation box, and the rows are not links when no target is available.
  const relationFollowed = (label: string): HTMLElement | undefined =>
    document.querySelector<HTMLElement>(
      `[data-buffer] [data-field="${CSS.escape(label)}"] .relation [role="link"]`,
    ) ?? undefined;
  // The box is a relation box: its targets are rows, not text.
  const isRelationBox = (label: string): boolean =>
    now.current.boxes.get(label)?.info.kind === "relation" ||
    now.current.shown.some((box) => box.key === label && box.relations !== undefined);
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
  // The list of the elements with the value the cursor is on (SR-132): the input is saved first, so the value
  // typed is the one listed (the list reads the files); then `element.facets` of the element says which
  // values can be listed. One value opens its list, several ask in the minibuffer.
  const listValue = async (): Promise<void> => {
    const pointer = document.activeElement?.id === PROMPT_INPUT ? pointed.current : pointerNow();
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
    const found = pointedValue(
      listableValues(answer.output, now.current.boxKeys),
      pointer,
      element.relations,
    );
    if (found.kind === "open") {
      open(found.value);
    } else if (found.kind === "ask") {
      onAsk(valuesPrompt(found.values, open));
    } else {
      now.current.onEcho(`No value of ${now.current.buffer.name} lists elements`);
    }
  };
  // The latest functions of this render, for the controls the app holds on to.
  const api = useRef({
    editTitle,
    addProperty,
    clearProperty,
    relationFollowed,
    isRelationBox,
    resolve,
    saveInput,
    inputGoing,
    flush,
    pointerNow,
    listValue,
  });
  api.current = {
    editTitle,
    addProperty,
    clearProperty,
    relationFollowed,
    isRelationBox,
    resolve,
    saveInput,
    inputGoing,
    flush,
    pointerNow,
    listValue,
  };

  // A layout effect, like the editor's: the app has the controls in the same task as the editor (the window's
  // shortcuts of the element, such as "Copy field", read them), before any key can come.
  useLayoutEffect(() => {
    if (handle === undefined) {
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
      addProperty: () => {
        api.current.addProperty();
      },
      clearProperty: () => {
        api.current.clearProperty();
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
  }, [handle, register, packageModel !== undefined, conflict === undefined]);

  // The editors take no input in a read-only element, and none while its file is gone (SR-106 AK3).
  const locked = readOnly || deleted;
  // What the heading of the title shows and whether it takes input: a function of its own, so the render
  // stays small.
  const titleProps = (element: DataExportElement): Pick<TitleBoxProps, "id" | "readOnly" | "initial"> => {
    // The unsaved title this buffer was shown with, for its editor when it is made (#621).
    const kept = keptBoxes.current.get(TITLE_FIELD)?.doc;
    return {
      id: element.identifier ?? element.shortId,
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
      data-buffer=""
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
    >
      <div className="column">
        {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
        {view.status === "ok" && parents.answered ? (
          <>
            <ParentsRow parents={parents.parents} dispatch={dispatch} />
            <FieldBox label={TITLE_FIELD} focusable onCopy={copy} marked={marked}>
              <TitleBox
                text={view.element.title}
                {...titleProps(view.element)}
                open={titleOpen}
                restore={memory.editors.get(TITLE_FIELD)}
                onClose={(state) => {
                  memory.editors.set(TITLE_FIELD, state);
                }}
                onUpdate={() => {
                  autosave.current?.release();
                }}
                onOpen={openTitle}
                onChange={(_doc, typed) => {
                  changed(undefined, typed);
                }}
                onLeave={() => {
                  fieldOf(TITLE_FIELD)?.focus();
                }}
                navigation={{
                  down: () => step(TITLE_FIELD, 1),
                  up: () => step(TITLE_FIELD, -1),
                }}
                onHandle={(editor) => {
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
                }}
              />
            </FieldBox>
            {diskBlock(TITLE_FIELD)}
            <FieldBox label="Text" onCopy={copy} marked={marked}>
              <Editor
                text={text}
                readOnly={locked}
                plugins={plugins}
                {...(keptText.current === undefined ? {} : { initial: keptText.current })}
                restore={memory.editors.get(TEXT_FIELD)}
                onClose={(state) => {
                  memory.editors.set(TEXT_FIELD, state);
                }}
                onUpdate={() => {
                  autosave.current?.release();
                }}
                onChange={(doc, typed) => {
                  changed(doc, typed);
                }}
                onEscape={() => {
                  article?.focus();
                }}
                handle={(editor) => {
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
                }}
              />
            </FieldBox>
            {diskBlock(TEXT_FIELD)}
            {shown.map((box) => {
              const editable = boxes.get(box.key);
              const kept = keptBoxes.current.get(box.key)?.doc;
              const value = values.current.get(box.key);
              const field = (
                <FieldBox label={box.key} focusable onCopy={copy} marked={marked}>
                  <div className="box">
                    <span className="key">{box.key}</span>
                    <span className="value">
                      {editable !== undefined && !isValueKind(editable.info.kind) ? (
                        <TextBox
                          label={box.key}
                          text={editable.doc}
                          {...(kept === undefined ? {} : { initial: kept })}
                          readOnly={locked || editable.lineBreak}
                          many={editable.info.many}
                          markdown={editable.info.markdown}
                          outdated={outdatedReferences(view.element, box.key)}
                          follow={follow}
                          title={title}
                          pickElement={pick.pickElement}
                          repository={pick.repository}
                          restore={memory.editors.get(box.key)}
                          onClose={(state) => {
                            memory.editors.set(box.key, state);
                          }}
                          onUpdate={() => {
                            autosave.current?.release();
                          }}
                          onChange={(_doc, typed) => {
                            changed(undefined, typed);
                          }}
                          onLeave={() => {
                            fieldOf(box.key)?.focus();
                          }}
                          navigation={{
                            down: () => step(box.key, 1),
                            up: () => step(box.key, -1),
                          }}
                          onHandle={(editor) => {
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
                          }}
                        />
                      ) : editable?.info.kind === "relation" ? (
                        <ul>
                          {rowsOf(box.key, value ?? editable.doc, view.element.relations).map((row, at) => (
                            <Relation key={at} row={row} onOpenRelation={onOpenRelation} />
                          ))}
                        </ul>
                      ) : box.relations !== undefined ? (
                        <ul>
                          {box.relations.map(rowOfRelation).map((row, at) => (
                            <Relation key={at} row={row} onOpenRelation={onOpenRelation} />
                          ))}
                        </ul>
                      ) : (
                        (editable === undefined ? box.lines : choiceKeys(value ?? editable.doc)).map(
                          (line, at) => (
                            <span className="line" key={at}>
                              {line}
                            </span>
                          ),
                        )
                      )}
                    </span>
                  </div>
                </FieldBox>
              );
              return (
                <Fragment key={box.key}>
                  {field}
                  {diskBlock(box.key)}
                </Fragment>
              );
            })}
            {relationGroups(view.element.relations).map((group) => (
              <FieldBox key={group.heading} label={group.heading} onCopy={copy} marked={marked}>
                <section>
                  <h2>{group.heading}</h2>
                  <ul>
                    {group.relations.map((relation, at) => (
                      <Relation key={at} row={rowOfRelation(relation)} onOpenRelation={onOpenRelation} />
                    ))}
                  </ul>
                </section>
              </FieldBox>
            ))}
            {packageModel === undefined ? null : (
              <section className="members" hidden={members?.total === 0}>
                {members !== undefined && members.total > 0 ? (
                  <h2>
                    ← {packageModel.key}{" "}
                    <span className="count">{memberSummary(members, buffer.memberSort)}</span>
                  </h2>
                ) : null}
                <ListView
                  part
                  call={call}
                  buffer={memberList(buffer, selection)}
                  revision={revision + outside.seq}
                  outside={outside}
                  dispatch={dispatch}
                  onData={(_key, data) => {
                    setMembers(memberCount(data));
                  }}
                  onEcho={onEcho}
                  onLeave={() => {
                    article?.focus({ preventScroll: true });
                  }}
                  focusOnLoad={returning.current}
                />
              </section>
            )}
          </>
        ) : null}
      </div>
    </article>
  );
};
