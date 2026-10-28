// The block "On disk" under a field in conflict (SR-106 AK2): the file's value as it is, quiet and read-only,
// with the lines the input lacks in heavier weight (meaning, no colour: D-062). It is no control: Enter on it
// asks which version holds, as "Resolve change on disk" does; Escape goes back to the buffer. The lines come
// from `outside-change.ts` (`onDisk`).
import type { PropertyInfo } from "./element-view.js";
import type { ConflictField } from "./outside-change.js";
import { onDisk } from "./outside-change.js";

export interface OnDiskProps {
  readonly field: ConflictField;
  /** The property of the box; none for the text. */
  readonly info: PropertyInfo | undefined;
  readonly onResolve: () => void;
  readonly onLeave: () => void;
}

export const OnDisk = ({ field, info, onResolve, onLeave }: OnDiskProps): React.JSX.Element => {
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
