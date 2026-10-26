// The modeline: a display, not a control. Left the parts of the shown buffer, right the workspace.
import type { WorkspaceView } from "./modeline.js";

export const ModelineBar = ({
  parts,
  view,
  stopped,
}: {
  /** What the shown buffer is and has (`bufferView`). */
  readonly parts: readonly string[];
  /** The workspace; undefined until its status is known. */
  readonly view: WorkspaceView | undefined;
  /** The core process stopped for good. */
  readonly stopped: boolean;
}): React.JSX.Element => (
  <footer className="modeline" aria-label="Modeline">
    {view === undefined ? null : (
      <>
        <span className="parts">
          {parts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </span>
        <span className="workspace">
          <span className="name">{view.name ?? "No workspace"}</span>
          {[...view.marks, ...(stopped ? ["stopped"] : [])].map((mark) => (
            <span key={mark}>{mark}</span>
          ))}
        </span>
      </>
    )}
  </footer>
);
