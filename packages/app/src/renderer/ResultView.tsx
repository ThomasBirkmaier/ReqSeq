// The output page (SR-223 AK1, SR-073 AK2): the output of a catalog command run from the command prompt that
// no other buffer shows. In the calm centre column of an element (SR-148), its answer heads the page, a line
// under it says when the output is incomplete (SR-006 AK2), and below stand its lines, laid out by its shape
// under the titles of the catalog (`result.ts`); its technical values and those equal to their normal value only
// while "Show details" is on for the buffer, as details in the second grey (SR-223 AK2, AK7). Up and Down, Ctrl+N and Ctrl+P select
// a line (none is selected at first, SR-122), Enter or a click opens the element of an element row or of
// a problem, the two elements of a pair line side by side, read-only (SR-044 AK2), and the list of the elements a
// number counts that the catalog marks as a number of elements (SR-223 AK5), each such number a line of its own. The problems of one kind
// are a group line, folded at first (SR-223 AK3): Tab on it (SR-193 AK1), or a click on its triangle, opens and
// closes it, Right opens and Left closes it, also from a line of the group, and Enter or a click elsewhere on it
// opens the list of the elements of its problems (a group without elements opens and closes instead). The output of
// `trace.chain` has its evidence under the elements it belongs to and the validation records of its root
// under the root row (`chain-lines.ts`, SR-033, #646). When the
// workspace changed, it asks the command again with the same input (ADR-0002: the app runs commands and
// shows what they give); the output of a write command stays as it came (ThomasBirkmaier/ReqSeq-archive#85).
// The output of `hint.list` is the hint list, grouped by kind (`HintListView.tsx`, SR-026 AK4), and that of
// `workspace.connectAgent` for a client the setup to copy (`ConnectAgentView.tsx`, SR-227 AK7).
import { bufferMark, useHidden } from "./area-slot.js";
import { useEffect, useMemo, useRef } from "react";
import { useIdScope } from "./area-scope.js";
import type { ResultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { isHintOutput } from "./hint-list.js";
import { HintListView } from "./HintListView.js";
import { agentSetupOf } from "./connect-agent.js";
import { ConnectAgentView } from "./ConnectAgentView.js";
import { rowTarget } from "./keys.js";
import type { BufferData } from "./modeline.js";
import type { OutputField, ResultLine } from "./result.js";
import { resultAnswer, resultSummary } from "./result.js";
import { linesOf } from "./result-copy.js";
import type { WindowAction } from "./window-layout.js";

export interface ResultViewProps {
  readonly call: Call;
  readonly buffer: ResultBuffer;
  readonly revision: number;
  readonly dispatch: (action: WindowAction) => void;
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** Puts a value on the clipboard, and the modeline confirms it (SR-128 AK2); absent: nothing is copied. */
  readonly onCopy?: (label: string, text: string) => void;
  /** The fields of the command's output in the catalog (`outputFields`): their titles and normal values. */
  readonly fields?: readonly OutputField[];
}

/**
 * What `event` does to the group of `line`: open it (`true`), close it (`false`), or nothing (undefined). Tab on a
 * group line opens and closes it (SR-193 AK1); Right opens it, and Left closes it, also from one of its lines.
 */
const foldingOf = (
  event: Pick<React.KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  line: ResultLine,
): boolean | undefined => {
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  const keys = line.kind === "group" ? ["Tab", "ArrowLeft", "ArrowRight"] : ["ArrowLeft"];
  if (!plain || line.group === undefined || !keys.includes(event.key)) {
    return undefined;
  }
  return event.key === "Tab" ? line.unfolded !== true : event.key === "ArrowRight";
};

/**
 * A line that opens something when chosen: an element, a pair, a group of problems (SR-223 AK3), or a number of
 * elements, which opens their list (SR-223 AK5).
 */
const choosable = (line: ResultLine): boolean =>
  line.open !== undefined || line.kind === "group" || line.list !== undefined;

/**
 * What the line under the answer says of an incomplete output (SR-223 AK1, SR-006 AK2): only the mark, since the
 * answer already says why (`incompleteNote` of core) and the output names no repository.
 */
export const INCOMPLETE_NOTE = "Incomplete";

export const ResultView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
  onCopy,
  fields,
}: ResultViewProps): React.JSX.Element => {
  const scope = useIdScope();
  // Found by `[data-buffer]` only while shown, never drawn hidden in advance (SR-212 AK5).
  const bufferAttribute = bufferMark(useHidden());
  // The chain shows its evidence under the elements (SR-033); every other output is laid out by shape.
  const lines = useMemo(
    () =>
      linesOf(
        {
          command: buffer.command,
          input: buffer.input,
          name: buffer.name,
          output: buffer.output,
          ...(buffer.written === true ? { written: true } : {}),
          ...(buffer.details === true ? { details: true } : {}),
          ...(buffer.unfolded === undefined ? {} : { unfolded: buffer.unfolded }),
        },
        fields,
      ),
    [
      buffer.command,
      buffer.input,
      buffer.name,
      buffer.written,
      buffer.output,
      buffer.details,
      buffer.unfolded,
      fields,
    ],
  );
  const answer = resultAnswer(buffer.output);
  const { incomplete } = resultSummary(buffer.output);
  const cursor = Math.min(buffer.cursor, Math.max(0, lines.length - 1));
  const hints = buffer.command === "hint.list" && isHintOutput(buffer.output) ? buffer.output : undefined;
  const setup = agentSetupOf(buffer);

  useEffect(() => {
    // The hint list says what it shows itself, with the message of its marked hint.
    if (hints === undefined) {
      onData(buffer.key, { kind: "result", ...resultSummary(buffer.output) });
    }
  }, [buffer.key, buffer.output, hints, onData]);

  // The call the shown output is the answer of: another one (after "Choose view") asks again, so each number of
  // elements stands for the list it opens in the window's view (SR-223 AK5).
  const answeredBy = useRef(call);
  useEffect(() => {
    // The output of a write command is never asked again: that would write again.
    if (buffer.written === true || (buffer.revision === revision && answeredBy.current === call)) {
      return;
    }
    let live = true;
    void call(buffer.command, buffer.input).then((answer) => {
      if (!live) {
        return;
      }
      answeredBy.current = call;
      const { error: _before, ...rest } = buffer;
      // In place: a result in the inactive area that reads again stays there (SR-115 AK3).
      dispatch({
        type: "update",
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

  /** Opens (`open`) or closes the group `key`; the cursor goes to `at`, its group line. */
  const fold = (key: string, open: boolean, at: number): void => {
    const others = (buffer.unfolded ?? []).filter((each) => each !== key);
    const { unfolded: _before, ...rest } = buffer;
    const unfolded = open ? [...others, key] : others;
    dispatch({
      type: "update",
      buffer: { ...rest, ...(unfolded.length === 0 ? {} : { unfolded }), cursor: at },
    });
  };

  /** The group line of the group `key`. */
  const headOf = (key: string): number =>
    lines.findIndex((line) => line.kind === "group" && line.group === key);

  const open = (at: number): void => {
    const line = lines[at];
    if (line?.kind === "group" && line.group !== undefined) {
      if (line.list === undefined) {
        fold(line.group, line.unfolded !== true, at);
      } else {
        dispatch({ type: "open", buffer: line.list });
      }
    } else if (line?.list !== undefined) {
      // A number of elements: the list of exactly those elements (SR-223 AK5).
      dispatch({ type: "open", buffer: line.list });
    } else if (line?.open !== undefined) {
      dispatch(
        line.beside === undefined
          ? { type: "open", buffer: line.open }
          : { type: "side-by-side", left: line.open, right: line.beside },
      );
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // The keys of the lines and Ctrl+N/P (SR-122); Cmd+P, and Ctrl+P while no line is selected, are the
    // window's "Go to", as are the other shortcuts.
    const to = rowTarget(event, cursor, lines.length);
    const line = lines[cursor];
    const folding = line === undefined ? undefined : foldingOf(event, line);
    if (line?.group !== undefined && folding !== undefined) {
      event.preventDefault();
      fold(line.group, folding, line.kind === "group" ? cursor : headOf(line.group));
    } else if (to !== undefined) {
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

  if (hints !== undefined) {
    return (
      <HintListView
        call={call}
        buffer={buffer}
        output={hints}
        dispatch={dispatch}
        onData={onData}
        {...(fields === undefined ? {} : { fields })}
      />
    );
  }

  if (setup !== undefined) {
    return <ConnectAgentView name={buffer.name} setup={setup} attributes={bufferAttribute} onCopy={onCopy} />;
  }

  return (
    // The buffer takes the focus and the keys; the answer and the note stand above the listbox of the lines.
    <div
      className="buffer result output"
      role="group"
      aria-label={buffer.name}
      aria-activedescendant={
        lines[cursor] === undefined || !choosable(lines[cursor])
          ? undefined
          : `${scope}result-${String(cursor)}`
      }
      {...bufferAttribute}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      <div className="column">
        {answer === undefined ? null : <h1 className="answer">{answer}</h1>}
        {incomplete ? <p className="note">{INCOMPLETE_NOTE}</p> : null}
        {buffer.error === undefined ? null : <p className="quiet">{buffer.error}</p>}
        <div className="lines" role="listbox" aria-label={answer ?? buffer.name}>
          {lines.map((line, at) => (
            <div
              key={at}
              id={`${scope}result-${String(at)}`}
              className={`line ${line.kind}${line.itemStart === true ? " item-start" : ""}${line.detail === true ? " detail" : ""}${line.kind !== "group" && line.list !== undefined ? " count" : ""}`}
              title={line.title}
              // Only a line that opens something is an option; a text line is shown, not chosen.
              {...(choosable(line) ? { role: "option", "aria-selected": at === cursor } : {})}
              {...(line.kind === "group" ? { "aria-expanded": line.unfolded === true } : {})}
              data-cursor={at === cursor ? "" : undefined}
              data-depth={line.depth}
              // Only the title is indented, so the values of all depths stand in one column (`result.css`).
              style={{ "--indent": `${String(line.depth * 1.25)}rem` } as React.CSSProperties}
              onClick={() => {
                dispatch({ type: "cursor", key: buffer.key, cursor: at });
                open(at);
              }}
            >
              {line.label === "" ? null : <span className="label">{line.label}</span>}
              {line.kind === "group" ? (
                <span className="text">
                  <span
                    className="fold-mark"
                    aria-hidden="true"
                    onClick={(event) => {
                      // The triangle opens and closes the group; the rest of the line opens its list.
                      event.stopPropagation();
                      if (line.group !== undefined) {
                        fold(line.group, line.unfolded !== true, at);
                      }
                    }}
                  >
                    {line.unfolded === true ? "▾" : "▸"}
                  </span>
                  {line.text}
                </span>
              ) : (
                <span className="text">{line.text}</span>
              )}
              {line.status === undefined ? null : <span className="status">{line.status}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
