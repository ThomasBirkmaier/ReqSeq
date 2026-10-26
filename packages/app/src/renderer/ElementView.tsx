// The element buffer: one element as `element.get` gives it. The text is edited in the Markdown editor
// with live preview (SR-065, D-061); the properties and the relations stay boxes and lists below it,
// read-only (property editing comes with #400). Empty properties are left out; the UUID and the version
// are shown on request only. The only write is `element.update { ref, text }` (ADR-0002), on the action
// "Save element"; the unsaved text is a draft that the app keeps while another buffer is shown.
import { useEffect, useMemo, useRef, useState } from "react";
import type { DataExportElement, DataExportRelation } from "@logreq/core";
import type { ElementControls } from "./actions.js";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import { relationBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { outdatedReferences, propertyBoxes, relationGroups } from "./element-view.js";
import type { EditorHandle } from "./editor/Editor.js";
import { Editor } from "./editor/Editor.js";
import { mergePlugins } from "./editor/plugins.js";
import { referenceAt, references } from "./editor/references.js";
import type { Reference } from "./editor/references.js";
import { afterSave, dirty, saveInput } from "./editor/save.js";
import { slashMenu } from "./editor/slash-menu.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import type { Draft } from "./drafts.js";
import { ListView } from "./ListView.js";
import type { BufferData } from "./modeline.js";
import type { MemberCount, PackageModel } from "./package-page.js";
import { memberCount, memberList, memberSummary, packageOf, packageSelection } from "./package-page.js";

export interface ElementViewProps {
  readonly call: Call;
  readonly buffer: ElementBuffer;
  /** Counts up when the workspace changed: the element is asked for again. */
  readonly revision: number;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
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

const Relation = ({
  relation,
  onOpenRelation,
}: {
  readonly relation: DataExportRelation;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}): React.JSX.Element => {
  const target = relation.targetState === "available" ? relationBuffer(relation) : undefined;
  const label = `${relation.identifier ?? relation.shortId ?? relation.id} ${relation.title ?? ""}`.trim();
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

export const ElementView = ({
  call,
  buffer,
  revision,
  onData,
  onEcho,
  onOpenTarget,
  onOpenRelation,
  onPickElement,
  draft,
  onDraft,
  register,
  packages,
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
  // What the callbacks need of the latest render.
  const now = useRef({
    buffer,
    call,
    onData,
    onDraft,
    onEcho,
    onOpenTarget,
    onPickElement,
    readOnly,
    handle,
  });
  now.current = { buffer, call, onData, onDraft, onEcho, onOpenTarget, onPickElement, readOnly, handle };

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
  const plugins = useMemo(
    () =>
      mergePlugins(
        references({
          outdated: outdated ?? new Map(),
          follow: (reference: Reference) => {
            now.current.onOpenTarget(reference.id, reference.repository);
          },
        }),
        slash,
      ),
    [signature, slash],
  );

  const setBaseline = (next: string): void => {
    baseline.current = next;
    setText(next);
  };

  // The shown buffer is a new one (the app keys this component by buffer), so "loading" shows once; a
  // reload after a change of the workspace keeps the editor (focus, cursor and undo history).
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
      // A save that runs sets the baseline itself with its answer.
      if (!saving.current) {
        if (!loadedOnce.current) {
          setBaseline(loaded);
          const kept = initialDraft.current;
          if (kept?.text === loaded) {
            // The file now holds the draft: nothing is unsaved.
            onDraft(buffer.key, undefined);
          } else if (kept !== undefined && kept.base !== loaded) {
            // Interim until the conflict rule of the external-change issues (#401, #402).
            onEcho(changedOnDisk(buffer.name));
            onDraft(buffer.key, { text: kept.text, base: loaded });
          }
        } else if (loaded !== baseline.current) {
          const editor = now.current.handle;
          const doc = editor?.doc();
          const unsaved = doc !== undefined && dirty(doc, baseline.current);
          setBaseline(loaded);
          if (unsaved) {
            // Interim until the conflict rule of the external-change issues (#401, #402).
            onEcho(changedOnDisk(buffer.name));
            onDraft(buffer.key, dirty(doc, loaded) ? { text: doc, base: loaded } : undefined);
          }
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

  const save = async (editor: EditorHandle): Promise<void> => {
    const { buffer: shown, call: run, onData: data, onDraft: draftOf, onEcho: echo } = now.current;
    if (saving.current) {
      return;
    }
    const doc = editor.doc();
    if (now.current.readOnly) {
      echo(`${shown.name} is read-only`);
    } else if (!dirty(doc, baseline.current)) {
      echo("No changes to save");
    } else {
      saving.current = true;
      const answer = await run("element.update", saveInput(shown.id, doc));
      saving.current = false;
      if (!answer.ok) {
        echo(answer.message);
        return;
      }
      const { element } = answer.output;
      const after = afterSave(doc, element.text ?? "", editor.doc());
      setBaseline(after.baseline);
      if (after.replace !== undefined) {
        editor.replace(after.replace);
      }
      const rest = editor.doc();
      draftOf(shown.key, dirty(rest, after.baseline) ? { text: rest, base: after.baseline } : undefined);
      setView({ status: "ok", element });
      data(shown.key, { kind: "element", element });
      echo(`Saved ${shown.name}`);
    }
  };

  useEffect(() => {
    if (handle === undefined) {
      return undefined;
    }
    register({
      save: () => {
        void save(handle);
      },
      edit: () => {
        handle.focus("end");
      },
      members: packageModel !== undefined,
      follow: () => {
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
      onKeyDown={(event) => {
        // Enter on the buffer itself edits the text; Escape in the editor comes back here. Enter with a
        // modifier is a shortcut ("Follow reference") and goes on to the window. Keys of a control inside
        // the buffer (the editor, the list of a package page) are not for the buffer.
        const plain =
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.target === event.currentTarget;
        if (plain && event.key === "Enter") {
          event.preventDefault();
          handle?.focus("end");
        } else if (plain && event.key === "ArrowDown" && (members?.total ?? 0) > 0) {
          // Down on the page of a package goes into its elements; Escape and Up on the first row come back.
          event.preventDefault();
          event.currentTarget.querySelector<HTMLElement>(".members .list")?.focus();
        }
      }}
    >
      <div className="column">
        {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
        {view.status === "ok" ? (
          <>
            <h1>
              {view.element.title === ""
                ? (view.element.identifier ?? view.element.shortId)
                : view.element.title}
            </h1>
            <Editor
              text={text}
              readOnly={readOnly}
              plugins={plugins}
              {...(initialDraft.current === undefined ? {} : { initial: initialDraft.current.text })}
              onChange={(doc) => {
                onDraft(
                  buffer.key,
                  dirty(doc, baseline.current) ? { text: doc, base: baseline.current } : undefined,
                );
              }}
              onEscape={() => {
                article?.focus();
              }}
              handle={setHandle}
            />
            {propertyBoxes(view.element).map((box) => (
              <div className="box" key={box.key}>
                <span className="key">{box.key}</span>
                <span className="value">
                  {box.lines.map((line, at) => (
                    <span className="line" key={at}>
                      {line}
                    </span>
                  ))}
                </span>
              </div>
            ))}
            {relationGroups(view.element.relations).map((group) => (
              <section key={group.heading}>
                <h2>{group.heading}</h2>
                <ul>
                  {group.relations.map((relation, at) => (
                    <Relation key={at} relation={relation} onOpenRelation={onOpenRelation} />
                  ))}
                </ul>
              </section>
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
