// The element buffer: one element as `element.get` gives it. The text is edited in the Markdown editor
// with live preview (SR-065, D-061). The properties are boxes below it (SR-104): a property of a text
// kind (text, number, date) is edited in its box, one editor with the values, one per line (`TextBox.tsx`);
// a property the metamodel marks `markdown` shows its values formatted like the text, with the source on the
// line with the caret only (SR-127); the other boxes (choice and relation values, a property the type does
// not know) and the relations stay as they are until #400 goes on. Empty properties are left out; the UUID
// and the version are shown on request only. The only write is `element.update { ref, text?, set?, unset? }`
// (ADR-0002), on the action "Save element": the text and every box that changed go together, and a box that
// was emptied removes its property (`property-edit.ts`). The unsaved text and boxes are a draft that the app
// keeps while another buffer is shown.
import { Prec } from "@codemirror/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataExportElement, DataExportRelation } from "@logreq/core";
import type { ElementControls } from "./actions.js";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import { relationBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { NOTHING, copyField, copyable, cursorField, docOf, heading } from "./copy.js";
import type { PropertyModel } from "./element-view.js";
import { outdatedReferences, propertyBoxes, relationGroups, relationLabel } from "./element-view.js";
import type { EditorHandle } from "./editor/Editor.js";
import { Editor } from "./editor/Editor.js";
import { mergePlugins } from "./editor/plugins.js";
import { referenceAt, references, referencesIn } from "./editor/references.js";
import type { Reference } from "./editor/references.js";
import { boxNavigation } from "./editor/box-navigation.js";
import { afterSave, dirty } from "./editor/save.js";
import { slashMenu } from "./editor/slash-menu.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import type { Draft } from "./drafts.js";
import { boxDrafts, makeDraft, reconcile, typedText } from "./drafts.js";
import { FieldBox } from "./FieldBox.js";
import { ListView } from "./ListView.js";
import { TextBox } from "./TextBox.js";
import { ParentsLine } from "./ParentsLine.js";
import type { BufferData } from "./modeline.js";
import type { MemberCount, PackageModel } from "./package-page.js";
import { memberCount, memberList, memberSummary, packageOf, packageSelection } from "./package-page.js";
import {
  changedBoxes,
  changedUnderEdit,
  editableBoxes,
  editsOf,
  savedHint,
  storedDocs,
  updateInput,
} from "./property-edit.js";
import type { BoxEdit, EditableBox } from "./property-edit.js";

export interface ElementViewProps {
  readonly call: Call;
  readonly buffer: ElementBuffer;
  /** Counts up when the workspace changed: the element is asked for again. */
  readonly revision: number;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** A field is copied (SR-128): its name and its value as text; the app puts it on the clipboard. */
  readonly onCopy: (label: string, text: string) => void;
  /** A relation target is opened: its element buffer, by UUID and repository (#416). */
  readonly onOpenRelation: (target: ElementBuffer) => void;
  /**
   * A relation target or the target of an inline reference is opened: by its UUID, and by the repository
   * the link names (a relation has none: the output has no repository).
   */
  readonly onOpenTarget: (id: string, repository?: string) => void;
  /** The slash menu's "Reference to element" asks for an element (SR-129): the app opens a prompt. */
  readonly onPickElement: (request: ReferenceRequest) => void;
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
}

/** What the minibuffer says when the file differs from the file text that unsaved changes were typed on. */
const changedOnDisk = (name: string): string =>
  `${name} changed on disk; your unsaved changes are kept. Saving overwrites the file.`;

type View =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ok"; readonly element: DataExportElement };

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
  relation,
  onOpenRelation,
}: {
  readonly relation: DataExportRelation;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}): React.JSX.Element => {
  const target = relation.targetState === "available" ? relationBuffer(relation) : undefined;
  const label = relationLabel(relation);
  return (
    <li className={target !== undefined ? "relation" : "relation unavailable"}>
      {target !== undefined ? (
        <span
          role="link"
          tabIndex={0}
          onClick={() => {
            onOpenRelation(target);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onOpenRelation(target);
            }
          }}
        >
          {label}
        </span>
      ) : (
        <>
          <span>{label}</span> <span className="state">{relation.targetState}</span>
        </>
      )}
      {relation.outdated === true ? <span className="outdated"> outdated</span> : null}
    </li>
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

export const ElementView = ({
  call,
  buffer,
  revision,
  onData,
  onEcho,
  onCopy,
  onOpenTarget,
  onOpenRelation,
  onPickElement,
  draft,
  onDraft,
  register,
  packages,
  properties,
  dispatch,
}: ElementViewProps): React.JSX.Element => {
  const [view, setView] = useState<View>({ status: "loading" });
  // The text as last loaded or saved: what the document is compared with.
  const [text, setText] = useState("");
  const [handle, setHandle] = useState<EditorHandle | undefined>(undefined);
  const baseline = useRef("");
  const loadedOnce = useRef(false);
  // The draft this buffer was shown with (the app keys this component by buffer).
  const initialDraft = useRef(draft);
  const saving = useRef(false);
  const [article, setArticle] = useState<HTMLElement | null>(null);
  // The package page (SR-112): the elements that name this one, below its text. The count is local to
  // this page; the modeline keeps the element. The selection keeps its identity, or the list would ask
  // again after every render.
  const [members, setMembers] = useState<MemberCount | undefined>(undefined);
  const selection = useMemo(() => packageSelection(buffer.id), [buffer.id]);
  const returning = useRef(buffer.memberCursor !== undefined);
  const packageModel = view.status === "ok" ? packageOf(packages, view.element.type) : undefined;
  const readOnly = view.status === "ok" && view.element.readOnly === true;
  // The boxes that are edited in place (SR-104), and the editors of them by key. `stored` is the document
  // of each as last loaded or saved, what an editor is compared with (like `baseline` for the text).
  const boxes = useMemo(
    () => (view.status === "ok" ? editableBoxes(view.element, properties) : new Map<string, EditableBox>()),
    [view, properties],
  );
  const boxEditors = useRef(new Map<string, EditorHandle>());
  const stored = useRef(new Map<string, string>());
  // The unsaved boxes this buffer was shown with, as compared with the file (set when it first loads).
  // The input is handed to the editors that are made for it and dropped when they have taken it (a box that
  // unmounts and mounts again shows what is stored). The text is kept only when it was typed on: a draft of
  // boxes alone has the file text as its text, which may have changed since.
  const keptBoxes = useRef(new Map<string, { readonly doc: string }>());
  const keptText = useRef<string | undefined>(undefined);
  const boxKeys = view.status === "ok" ? propertyBoxes(view.element).map((box) => box.key) : [];
  // What the callbacks need of the latest render.
  const now = useRef({
    buffer,
    call,
    onData,
    onDraft,
    onEcho,
    onCopy,
    onOpenTarget,
    onPickElement,
    readOnly,
    handle,
    boxes,
    boxKeys,
  });
  now.current = {
    buffer,
    call,
    onData,
    onDraft,
    onEcho,
    onCopy,
    onOpenTarget,
    onPickElement,
    readOnly,
    handle,
    boxes,
    boxKeys,
  };
  // The fields of the element (SR-128), and the field the focus was in last, which "Copy field" from the
  // command prompt needs: it runs while the prompt has the focus. A box copies what its editor holds.
  const fields = useRef(NOTHING);
  fields.current =
    view.status === "ok"
      ? copyable(
          view.element,
          () => docOf(now.current.handle),
          (key) => boxEditors.current.get(key)?.doc(),
        )
      : NOTHING;
  const lastField = useRef<string | undefined>(undefined);
  const copy = (label: string | undefined): void => {
    copyField(fields.current, label, now.current.onCopy);
  };

  // What the editors of the boxes hold, by key.
  const editorDocs = (): Map<string, string> =>
    new Map([...boxEditors.current].map(([key, editor]) => [key, editor.doc()]));
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
    );
  // The boxes whose document differs from the stored one: what "Save element" sends besides the text.
  const boxEdits = (): BoxEdit[] => changedBoxes(editsOf(now.current.boxes, editorDocs()));

  // The inline references of the text: followed on a click, and the outdated ones marked (#424). The
  // editor is configured again only when the hints about the text change.
  const outdated = view.status === "ok" ? outdatedReferences(view.element) : undefined;
  const signature = JSON.stringify([...(outdated ?? [])]);
  // The slash menu is created once: it holds state (the `/` typed), which a reconfiguration would keep
  // only for the same extensions.
  const slash = useMemo(
    () =>
      slashMenu({
        pickElement: (request) => {
          now.current.onPickElement(request);
        },
        repository: () => now.current.buffer.repository,
      }),
    [],
  );
  // Following a reference, in the text and in the boxes. One function, so a box keeps its plugins.
  const follow = useCallback((reference: Reference): void => {
    now.current.onOpenTarget(reference.id, reference.repository);
  }, []);
  // The field with this label: "Text" has no tab stop of its own (its editor takes the focus).
  const fieldOf = (label: string): HTMLElement | null | undefined =>
    article?.querySelector<HTMLElement>(`[data-field="${CSS.escape(label)}"]`);
  // Puts the focus on a field: on the editor of a box (the text is the editor called "Text") at its start or
  // end when `edit` is set, else on the field itself. A box without a usable editor takes the focus itself.
  // False when there is nothing to take it.
  const enter = (label: string, at: "start" | "end", edit = true): boolean => {
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
  const step = (from: string, by: 1 | -1): boolean => move(["Text", ...now.current.boxKeys], from, by);
  const stepRef = useRef(step);
  stepRef.current = step;
  const plugins = useMemo(
    () =>
      mergePlugins(references({ outdated: outdated ?? new Map(), follow }), slash, {
        // After the slash menu, which takes Down while it is open.
        extensions: [boxNavigation({ down: () => stepRef.current("Text", 1) }, Prec.high)],
      }),
    [signature, slash],
  );

  const setBaseline = (next: string): void => {
    baseline.current = next;
    setText(next);
  };

  // The file changed while the buffer is shown: a box or the text with unsaved input keeps it, the others
  // follow the file.
  const reload = (loaded: string, docs: Map<string, string>): void => {
    const typed = dirty(now.current.handle?.doc() ?? "", baseline.current);
    const held = editorDocs();
    const unsaved = (loaded !== baseline.current && typed) || changedUnderEdit(stored.current, docs, held);
    // A box without input follows the file once this render is done, so the draft already has it so.
    const shown = new Map(
      [...held].map(([key, doc]) => [key, doc === stored.current.get(key) ? (docs.get(key) ?? doc) : doc]),
    );
    setBaseline(loaded);
    stored.current = docs;
    if (unsaved) {
      // Interim until the conflict rule of the external-change issues (#401, #402).
      now.current.onEcho(changedOnDisk(now.current.buffer.name));
    }
    // The draft is on the new file text: a text that was not typed on is the new one (the editor
    // follows it after this render), so boxes alone never keep the old text.
    now.current.onDraft(now.current.buffer.key, currentDraft(typed ? undefined : loaded, loaded, shown));
  };

  // The shown buffer is a new one (the app keys this component by buffer), so "loading" shows once; a
  // reload after a change of the workspace keeps the editors (focus, cursor and undo history).
  useEffect(() => {
    let current = true;
    if (!loadedOnce.current) {
      onData(buffer.key, undefined);
    }
    void call("element.get", { ref: buffer.id, repository: buffer.repository }).then((answer) => {
      if (!current) {
        return;
      }
      if (!answer.ok) {
        setView({ status: "error", message: answer.message });
        onEcho(answer.message);
        return;
      }
      const { element } = answer.output;
      const loaded = element.text ?? "";
      const docs = storedDocs(editableBoxes(element, properties));
      // A save that runs sets the baseline itself with its answer.
      if (!saving.current) {
        if (!loadedOnce.current) {
          setBaseline(loaded);
          stored.current = docs;
          const kept = initialDraft.current;
          if (kept !== undefined) {
            // Interim until the conflict rule of the external-change issues (#401, #402).
            const compared = reconcile(kept, loaded, docs);
            if (compared.changed) {
              onEcho(changedOnDisk(buffer.name));
            }
            keptBoxes.current = new Map(compared.draft?.boxes);
            keptText.current = typedText(compared.draft);
            if (compared.draft !== kept) {
              onDraft(buffer.key, compared.draft);
            }
          }
        } else {
          reload(loaded, docs);
        }
        loadedOnce.current = true;
      }
      setView({ status: "ok", element });
      onData(buffer.key, { kind: "element", element });
    });
    return () => {
      current = false;
    };
  }, [call, buffer.key, buffer.id, buffer.repository, revision]);

  // After a save: the answer is the new baseline, the boxes show what the file holds, and what was typed
  // while the save ran stays as a draft.
  const settle = (
    output: { readonly element: DataExportElement; readonly problems?: readonly { message: string }[] },
    sent: { readonly doc: string; readonly edits: readonly BoxEdit[] },
    editor: EditorHandle,
  ): void => {
    const { buffer: shown, onData: data, onDraft: draftOf, onEcho: echo } = now.current;
    const { element } = output;
    const after = afterSave(sent.doc, element.text ?? "", editor.doc());
    const docs = storedDocs(editableBoxes(element, properties));
    setBaseline(after.baseline);
    stored.current = docs;
    if (after.replace !== undefined) {
      editor.replace(after.replace);
    }
    // A box that still holds what was sent shows what the file holds now (an emptied one is gone with its
    // property).
    for (const edit of sent.edits) {
      const saved = docs.get(edit.key);
      const box = boxEditors.current.get(edit.key);
      if (saved !== undefined && box?.doc() === edit.doc && saved !== edit.doc) {
        box.replace(saved);
      }
    }
    draftOf(shown.key, currentDraft());
    setView({ status: "ok", element });
    data(shown.key, { kind: "element", element });
    const hint = savedHint(
      output.problems,
      sent.edits.map((edit) => edit.key),
    );
    echo(hint === undefined ? `Saved ${shown.name}` : `Saved ${shown.name}. ${hint}`);
  };

  const save = async (): Promise<void> => {
    const { buffer: shown, call: run, onEcho: echo, handle: editor } = now.current;
    if (saving.current || editor === undefined) {
      return;
    }
    const doc = editor.doc();
    const edits = boxEdits();
    const textDirty = dirty(doc, baseline.current);
    if (now.current.readOnly) {
      echo(`${shown.name} is read-only`);
    } else if (!textDirty && edits.length === 0) {
      echo("No changes to save");
    } else {
      saving.current = true;
      const answer = await run("element.update", updateInput(shown.id, textDirty ? doc : undefined, edits));
      saving.current = false;
      if (answer.ok) {
        settle(answer.output, { doc, edits }, editor);
      } else {
        // Nothing was written: the text and the boxes stay as typed.
        echo(answer.message);
      }
    }
  };

  // Down on the page of a package goes into its elements; Escape and Up on the first row come back.
  const intoMembers = (root: HTMLElement): void => {
    root.querySelector<HTMLElement>(".members .list")?.focus();
  };
  // Enter on a box edits it (on the buffer itself, the text); Escape leaves a box for the buffer; Up and Down
  // on a field move to the field before and after, and Down on the last one into the elements of a package.
  const onField = (key: string, label: string | undefined, root: HTMLElement): void => {
    const box = label === undefined ? undefined : boxEditors.current.get(label);
    const down = key === "ArrowDown";
    if (key === "Enter") {
      (box !== undefined && !box.state().readOnly ? box : handle)?.focus("end");
    } else if (key === "Escape") {
      article?.focus();
    } else if (label === undefined || !move(["Title", "Text", ...boxKeys], label, down ? 1 : -1, false)) {
      if (down && (members?.total ?? 0) > 0) {
        intoMembers(root);
      }
    }
  };
  // Enter with a modifier is a shortcut ("Follow reference") and goes on to the window. Keys of a control
  // inside the buffer (the editor, the list of a package page) are not for the buffer. A field that has the
  // focus itself (the title, a box: SR-128) is the buffer as well.
  const onBufferKey = (event: React.KeyboardEvent<HTMLElement>): void => {
    const { key, target, currentTarget } = event;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const label =
      target === currentTarget
        ? undefined
        : (target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset["field"];
    const wanted = fieldKey(key, label, (members?.total ?? 0) > 0);
    if (plain && wanted && forBuffer(target, currentTarget)) {
      event.preventDefault();
      onField(key, label, currentTarget);
    }
  };

  useEffect(() => {
    if (handle === undefined) {
      return undefined;
    }
    register({
      save: () => {
        void save();
      },
      edit: () => {
        handle.focus("end");
      },
      members: packageModel !== undefined,
      copy: () => {
        copy(cursorField(document.activeElement, lastField.current));
      },
      follow: () => {
        // A box has the focus or was the last field: the reference at the caret of a Markdown box, or its first
        // reference when it has no caret; a box that is not Markdown has none. Anywhere else it is the
        // reference at the cursor of the text.
        const label = cursorField(document.activeElement, lastField.current) ?? "";
        const box = boxEditors.current.get(label);
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
  }, [handle, register, packageModel !== undefined]);

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
        if (label !== undefined && now.current.boxes.get(label)?.lineBreak === true) {
          now.current.onEcho(lineBreakNote(label));
        }
      }}
      onKeyDown={onBufferKey}
    >
      <div className="column">
        {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
        {view.status === "ok" ? (
          <>
            <ParentsLine
              call={call}
              id={buffer.id}
              repository={buffer.repository}
              revision={revision}
              dispatch={dispatch}
              onEcho={onEcho}
            />
            <FieldBox label="Title" focusable onCopy={copy}>
              <h1>{heading(view.element)}</h1>
            </FieldBox>
            <FieldBox label="Text" onCopy={copy}>
              <Editor
                text={text}
                readOnly={readOnly}
                plugins={plugins}
                {...(keptText.current === undefined ? {} : { initial: keptText.current })}
                onChange={(doc) => {
                  onDraft(buffer.key, currentDraft(doc));
                }}
                onEscape={() => {
                  article?.focus();
                }}
                handle={(editor) => {
                  if (editor !== undefined) {
                    keptText.current = undefined;
                  }
                  setHandle(editor);
                }}
              />
            </FieldBox>
            {propertyBoxes(view.element).map((box) => {
              const editable = boxes.get(box.key);
              const kept = keptBoxes.current.get(box.key)?.doc;
              return (
                <FieldBox key={box.key} label={box.key} focusable onCopy={copy}>
                  <div className="box">
                    <span className="key">{box.key}</span>
                    <span className="value">
                      {editable === undefined ? (
                        box.lines.map((line, at) => (
                          <span className="line" key={at}>
                            {line}
                          </span>
                        ))
                      ) : (
                        <TextBox
                          label={box.key}
                          text={editable.doc}
                          {...(kept === undefined ? {} : { initial: kept })}
                          readOnly={readOnly || editable.lineBreak}
                          many={editable.info.many}
                          markdown={editable.info.markdown}
                          outdated={outdatedReferences(view.element, box.key)}
                          follow={follow}
                          onChange={() => {
                            onDraft(buffer.key, currentDraft());
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
                            }
                          }}
                        />
                      )}
                    </span>
                  </div>
                </FieldBox>
              );
            })}
            {relationGroups(view.element.relations).map((group) => (
              <FieldBox key={group.heading} label={group.heading} onCopy={copy}>
                <section>
                  <h2>{group.heading}</h2>
                  <ul>
                    {group.relations.map((relation, at) => (
                      <Relation key={at} relation={relation} onOpenRelation={onOpenRelation} />
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
                  revision={revision}
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
