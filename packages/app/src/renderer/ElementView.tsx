// The element buffer: one element as `element.get` gives it. The text is edited in the Markdown editor
// with live preview (SR-065, D-061); the properties and the relations stay boxes and lists below it,
// read-only (property editing comes with #400). Empty properties are left out; the UUID and the version
// are shown on request only. The only write is `element.update { ref, text }` (ADR-0002), on the action
// "Save element"; the unsaved text is a draft that the app keeps while another buffer is shown.
import { useEffect, useMemo, useRef, useState } from "react";
import type { DataExportElement, DataExportRelation } from "@logreq/core";
import type { ElementControls } from "./actions.js";
import type { ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { outdatedReferences, propertyBoxes, relationGroups } from "./element-view.js";
import type { EditorHandle } from "./editor/Editor.js";
import { Editor } from "./editor/Editor.js";
import { referenceAt, references } from "./editor/references.js";
import type { Reference } from "./editor/references.js";
import { afterSave, dirty, saveInput } from "./editor/save.js";
import type { Draft } from "./drafts.js";
import type { BufferData } from "./modeline.js";

export interface ElementViewProps {
  readonly call: Call;
  readonly buffer: ElementBuffer;
  /** Counts up when the workspace changed: the element is asked for again. */
  readonly revision: number;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /**
   * A relation target or the target of an inline reference is opened: by its UUID, and by the repository
   * the link names (a relation has none: the output has no repository).
   */
  readonly onOpenTarget: (id: string, repository?: string) => void;
  /** The unsaved text this buffer had when it was shown last, if any, with the file text it was typed on. */
  readonly draft: Draft | undefined;
  /** The text of the buffer has unsaved changes (the draft), or has none (undefined). */
  readonly onDraft: (key: string, draft: Draft | undefined) => void;
  /** Gives the app the means to save and edit while the text is shown, and takes them back. */
  readonly register: (controls: ElementControls | undefined) => void;
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
  onOpenTarget,
}: {
  readonly relation: DataExportRelation;
  readonly onOpenTarget: (id: string) => void;
}): React.JSX.Element => {
  const available = relation.targetState === "available";
  const label = `${relation.identifier ?? relation.shortId ?? relation.id} ${relation.title ?? ""}`.trim();
  return (
    <li className={available ? "relation" : "relation unavailable"}>
      {available ? (
        <span
          role="link"
          tabIndex={0}
          onClick={() => {
            onOpenTarget(relation.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onOpenTarget(relation.id);
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
  draft,
  onDraft,
  register,
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
  const readOnly = view.status === "ok" && view.element.readOnly === true;
  // What the callbacks need of the latest render.
  const now = useRef({ buffer, call, onData, onDraft, onEcho, onOpenTarget, readOnly, handle });
  now.current = { buffer, call, onData, onDraft, onEcho, onOpenTarget, readOnly, handle };

  // The inline references of the text: followed on a click, and the outdated ones marked (#424). The
  // editor is configured again only when the hints about the text change.
  const outdated = view.status === "ok" ? outdatedReferences(view.element) : undefined;
  const signature = JSON.stringify([...(outdated ?? [])]);
  const plugins = useMemo(
    () =>
      references({
        outdated: outdated ?? new Map(),
        follow: (reference: Reference) => {
          now.current.onOpenTarget(reference.id, reference.repository);
        },
      }),
    [signature],
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
  }, [handle, register]);

  return (
    <article
      className="buffer element"
      aria-label={buffer.name}
      data-buffer=""
      tabIndex={0}
      ref={setArticle}
      onKeyDown={(event) => {
        // Enter on the buffer itself edits the text; Escape in the editor comes back here. Enter with a
        // modifier is a shortcut ("Follow reference") and goes on to the window.
        if (
          event.key === "Enter" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.target === event.currentTarget
        ) {
          event.preventDefault();
          handle?.focus("end");
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
                    <Relation key={at} relation={relation} onOpenTarget={onOpenTarget} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        ) : null}
      </div>
    </article>
  );
};
