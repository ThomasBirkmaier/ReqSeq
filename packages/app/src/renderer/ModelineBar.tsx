// The modeline: a display, not a control. Left the parts of the shown buffer, right the workspace, each
// part a segment of one rounded bar (#490). Two
// things are not just display (SR-128): the ID of an element carries the copy symbol of a field, and the
// confirmation of a copy shows briefly after the parts.
import type { DataExportElement } from "@logreq/core";
import { idField } from "./copy.js";
import { CopySymbol } from "./FieldBox.js";
import type { WorkspaceView } from "./modeline.js";

export const ModelineBar = ({
  parts,
  view,
  stopped,
  follow,
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
  /** The element that the shown buffer is: its ID, at the start of the first part, is a field to copy. */
  readonly element: DataExportElement | undefined;
  /** Copies a field (its name and its value). */
  readonly onCopy: (label: string, text: string) => void;
  /** The confirmation of a copy; empty when there is none. */
  readonly notice: string;
}): React.JSX.Element => {
  const id = element === undefined ? undefined : idField(element);
  return (
    <footer className="modeline" aria-label="Modeline">
      {view === undefined ? null : (
        <>
          <span className="parts">
            {parts.map((part, at) =>
              at === 0 && id !== undefined ? (
                <span key={part} className="segment">
                  <span className="field" data-field="ID">
                    <span>{id.text()}</span>
                    <CopySymbol
                      label={id.label}
                      onCopy={() => {
                        onCopy(id.label, id.text());
                      }}
                    />
                  </span>
                  {part.slice(id.text().length)}
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
            {[...view.marks, ...(follow === undefined ? [] : [follow]), ...(stopped ? ["stopped"] : [])].map(
              (mark) => (
                <span key={mark} className="segment">
                  {mark}
                </span>
              ),
            )}
          </span>
        </>
      )}
    </footer>
  );
};
