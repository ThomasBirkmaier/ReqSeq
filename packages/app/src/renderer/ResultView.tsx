// The result buffer (SR-073 AK2): the output of a catalog command run from the command prompt that no
// other buffer shows, as lines laid out by its shape (`result.ts`). Up and Down, Ctrl+N and Ctrl+P select
// a line (none is selected at first, SR-122), Enter or a click opens the element of an element row or of a problem. When the workspace changed, it asks the
// command again with the same input (ADR-0002: the app runs commands and shows what they give).
import { useEffect, useMemo } from "react";
import type { BufferAction, ResultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { rowTarget } from "./keys.js";
import type { BufferData } from "./modeline.js";
import { resultLines, resultTotal } from "./result.js";

export interface ResultViewProps {
  readonly call: Call;
  readonly buffer: ResultBuffer;
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
}

export const ResultView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
}: ResultViewProps): React.JSX.Element => {
  const lines = useMemo(() => resultLines(buffer.output), [buffer.output]);
  const cursor = Math.min(buffer.cursor, Math.max(0, lines.length - 1));

  useEffect(() => {
    onData(buffer.key, { kind: "result", total: resultTotal(buffer.output) });
  }, [buffer.key, buffer.output, onData]);

  useEffect(() => {
    if (buffer.revision === revision) {
      return;
    }
    let live = true;
    void call(buffer.command, buffer.input).then((answer) => {
      if (!live) {
        return;
      }
      const { error: _before, ...rest } = buffer;
      dispatch({
        type: "open",
        buffer: answer.ok
          ? { ...rest, output: answer.output, revision }
          : { ...rest, output: undefined, error: answer.message, revision },
      });
      if (!answer.ok) {
        onEcho(answer.message);
      }
    });
    return () => {
      live = false;
    };
  }, [call, buffer, revision, dispatch, onEcho]);

  const open = (at: number): void => {
    const target = lines[at]?.open;
    if (target !== undefined) {
      dispatch({ type: "open", buffer: target });
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // The keys of the lines and Ctrl+N/P (SR-122); Cmd+P, and Ctrl+P while no line is selected, are the
    // window's "Go to", as are the other shortcuts.
    const to = rowTarget(event, cursor, lines.length);
    if (to !== undefined) {
      event.preventDefault();
      dispatch({ type: "cursor", key: buffer.key, cursor: Math.max(0, Math.min(lines.length - 1, to)) });
    } else if (event.key === "Enter") {
      event.preventDefault();
      // With no line selected, Enter acts on the first one and selects it.
      if (cursor < 0 && lines.length > 0) {
        dispatch({ type: "cursor", key: buffer.key, cursor: 0 });
      }
      open(Math.max(0, cursor));
    }
  };

  return (
    <div
      className="buffer result"
      role="listbox"
      aria-label={buffer.name}
      aria-activedescendant={lines[cursor]?.open === undefined ? undefined : `result-${String(cursor)}`}
      data-buffer=""
      tabIndex={0}
      onKeyDown={keyDown}
    >
      {buffer.error === undefined ? null : <p className="quiet">{buffer.error}</p>}
      {lines.map((line, at) => (
        <div
          key={at}
          id={`result-${String(at)}`}
          className={`line ${line.kind}`}
          // Only a line that opens an element is an option; a text line is shown, not chosen.
          {...(line.open === undefined ? {} : { role: "option", "aria-selected": at === cursor })}
          data-cursor={at === cursor ? "" : undefined}
          style={{ paddingLeft: `${String(0.75 + line.depth * 1.25)}rem` }}
          onClick={() => {
            dispatch({ type: "cursor", key: buffer.key, cursor: at });
            open(at);
          }}
        >
          {line.label === "" ? null : <span className="label">{line.label}</span>}
          <span className="text">{line.text}</span>
        </div>
      ))}
    </div>
  );
};
