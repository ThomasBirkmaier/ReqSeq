// The start buffer (SR-225 AK1, AK2, `start-commands.ts`): the start commands one below the other in the middle of
// the sheet, without a frame, "Open workspace…" with the key of the menu item as a muted side text. A click on a
// line, or a line selected with the arrow keys and Enter, runs it; Enter with no line selected runs the first.
import { useEffect, useRef, useState } from "react";
import { rowTarget } from "./keys.js";
import { activeRow } from "./rows.js";
import type { StartCommand, StartLine } from "./start-commands.js";

export const StartView = ({
  lines,
  focus,
  onChoose,
}: {
  readonly lines: readonly StartLine[];
  /** No prompt and no window is open: the buffer takes the focus, so its keys work. */
  readonly focus: boolean;
  readonly onChoose: (command: StartCommand) => void;
}): React.JSX.Element => {
  // No line is selected until a key or a click selects one.
  const [cursor, setCursor] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus && list.current?.contains(document.activeElement) !== true) {
      list.current?.focus({ preventScroll: true });
    }
  }, [focus]);
  const choose = (at: number): void => {
    const line = lines[at];
    if (line !== undefined) {
      setCursor(at);
      onChoose(line.command);
    }
  };
  const keyDown = (event: React.KeyboardEvent): void => {
    const to = rowTarget(event, cursor, lines.length);
    if (to !== undefined) {
      event.preventDefault();
      setCursor(Math.max(0, Math.min(lines.length - 1, to)));
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      choose(Math.max(0, cursor));
    }
  };
  return (
    <div
      ref={list}
      className="buffer start"
      role="listbox"
      aria-label="Start"
      aria-activedescendant={activeRow("start", cursor, lines.length)}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      <div className="start-lines">
        {lines.map((line, at) => (
          <div
            key={line.command}
            id={`start-${String(at)}`}
            className="start-line"
            role="option"
            aria-selected={at === cursor}
            onClick={() => {
              choose(at);
            }}
          >
            <span className="start-label">{line.label}</span>
            {line.key === undefined ? null : <span className="start-key">{line.key}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};
