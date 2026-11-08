// The modeline: a display, not a control. Left the parts of the shown buffer, right the workspace, each
// part a segment of one rounded bar (ThomasBirkmaier/ReqSeq-archive#490). Two
// things are not just display (SR-128): the ID of an element carries the copy symbol of a field, and the
// confirmation of a copy shows briefly after the parts.
import type { DataExportElement } from "@reqseq/core";
import type { Field } from "./copy.js";
import { idField, statusField } from "./copy.js";
import { CopySymbol } from "./FieldBox.js";
import type { WorkspaceView } from "./modeline.js";

/** The part after the ID: the type, and the status as a field of its own when the part ends with it. */
const ElementRest = ({
  rest,
  status,
}: {
  readonly rest: string;
  readonly status: Field | undefined;
}): React.ReactNode => {
  const text = status?.text() ?? "";
  if (status === undefined || !rest.endsWith(` · ${text}`)) {
    return rest;
  }
  return (
    <>
      {rest.slice(0, rest.length - text.length)}
      <span className="field" data-field={status.label} data-menu="field-status" tabIndex={-1}>
        {text}
      </span>
    </>
  );
};

export const ModelineBar = ({
  parts,
  view,
  stopped,
  follow,
  shown,
  element,
  onCopy,
  notice,
}: {
  /** What the shown buffer is and has (`bufferView`). */
  readonly parts: readonly string[];
  /** The workspace; undefined until its status is known. */
  readonly view: WorkspaceView | undefined;
  /** The core process stopped for good. */
  readonly stopped: boolean;
  /** The mark of the mode „Agent folgen“ (SR-117 AK3); undefined while it is off. */
  readonly follow?: string | undefined;
  /** The view shown (SR-043 AK1, „view: A“); undefined while all elements are shown. */
  readonly shown?: string | undefined;
  /** The element that the shown buffer is: its ID, at the start of the first part, is a field to copy. */
  readonly element: DataExportElement | undefined;
  /** Copies a field (its name and its value). */
  readonly onCopy: (label: string, text: string) => void;
  /** The confirmation of a copy; empty when there is none. */
  readonly notice: string;
}): React.JSX.Element => {
  const id = element === undefined ? undefined : idField(element);
  const status = element === undefined ? undefined : statusField(element);
  return (
    <footer className="modeline" aria-label="Modeline">
      {view === undefined ? null : (
        <>
          <span className="parts">
            {parts.map((part, at) =>
              at === 0 && id !== undefined ? (
                <span key={part} className="segment">
                  {/* The ID and the status are fields with a context menu (SR-196 AK3, AK4): a right press
                      gives them the focus, so "Copy field" copies them. */}
                  <span className="field" data-field="ID" data-menu="field-short-id" tabIndex={-1}>
                    <span>{id.text()}</span>
                    <CopySymbol
                      label={id.label}
                      onCopy={() => {
                        onCopy(id.label, id.text());
                      }}
                    />
                  </span>
                  <ElementRest rest={part.slice(id.text().length)} status={status} />
                </span>
              ) : (
                <span key={part} className="segment">
                  {part}
                </span>
              ),
            )}
            {notice === "" ? null : (
              <span className="segment notice" role="status">
                {notice}
              </span>
            )}
          </span>
          <span className="workspace">
            <span className="segment name">{view.name ?? "No workspace"}</span>
            {[
              ...view.marks,
              ...(shown === undefined ? [] : [shown]),
              ...(follow === undefined ? [] : [follow]),
              ...(stopped ? ["stopped"] : []),
            ].map((mark) => (
              <span key={mark} className="segment">
                {mark}
              </span>
            ))}
          </span>
        </>
      )}
    </footer>
  );
};
