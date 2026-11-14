// The hint list in the result buffer of "List hints" (SR-026 AK4, AK5; `hint-list.ts` lays it out): the
// count of all hints that pass the filters, then one group per kind with its count, all open when the list
// opens. A click on a heading, or Tab on it (SR-193 AK1) and Enter or Space as on every fold head, folds and
// unfolds the group; Right opens and Left closes it (SR-193 AK2), and Left on a hint closes its group. Up and Down, Ctrl+N and Ctrl+P move
// the mark over headings and hints (SR-122 AK4); Enter or a click on a hint opens its element. The full
// message is the tooltip of a hint and, for the marked hint, part of the modeline. A variant an outdated
// evidence record names by its UUID is named as the view prompt names it (`views.ts`).
import { bufferMark, useHidden } from "./area-slot.js";
import { useEffect, useMemo, useState } from "react";
import type { HintListOutput } from "@reqseq/core";
import { useIdScope } from "./area-scope.js";
import type { ResultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { FoldHead } from "./FoldSection.js";
import { foldMove, hintList, hintRows, variantViews } from "./hint-list.js";
import { shownId } from "./id-title.js";
import { rowTarget } from "./keys.js";
import type { BufferData } from "./modeline.js";
import { viewsOf } from "./views.js";
import type { WindowAction } from "./window-layout.js";

export interface HintListViewProps {
  readonly call: Call;
  readonly buffer: ResultBuffer;
  readonly output: HintListOutput;
  readonly dispatch: (action: WindowAction) => void;
  readonly onData: (key: string, data: BufferData | undefined) => void;
}

/**
 * The variants by UUID, each named by its short ID and identifier; empty until they are read, and read
 * again with each new output, so a variant added or renamed since is named too.
 */
const useVariantNames = (call: Call, output: HintListOutput): ReadonlyMap<string, string> => {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const wanted = variantViews(output).length > 0;
  useEffect(() => {
    if (!wanted) {
      return;
    }
    let live = true;
    void viewsOf(call).then((read) => {
      if (live && read.ok) {
        setNames(
          new Map(
            read.views.flatMap((view) =>
              view.shortId === undefined ? [] : [[view.view, shownId(view.shortId, view.identifier)]],
            ),
          ),
        );
      }
    });
    return () => {
      live = false;
    };
  }, [call, output, wanted]);
  return names;
};

export const HintListView = ({
  call,
  buffer,
  output,
  dispatch,
  onData,
}: HintListViewProps): React.JSX.Element => {
  const scope = useIdScope();
  // Found by `[data-buffer]` only while shown, never drawn hidden in advance (SR-212 AK5).
  const bufferAttribute = bufferMark(useHidden());
  const views = useVariantNames(call, output);
  const list = useMemo(() => hintList(output, views), [output, views]);
  // Every group is open when the list opens (SR-026 AK5).
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => hintRows(list, folded), [list, folded]);
  const cursor = Math.min(buffer.cursor, rows.length - 1);
  const marked = rows[cursor];
  const message = marked?.kind === "hint" ? marked.line.message : undefined;

  useEffect(() => {
    onData(buffer.key, {
      kind: "result",
      total: list.total,
      view: undefined,
      incomplete: list.incomplete,
      ...(message === undefined ? {} : { message }),
    });
  }, [buffer.key, list.total, list.incomplete, message, onData]);

  const mark = (at: number): void => {
    dispatch({ type: "cursor", key: buffer.key, cursor: at });
  };

  const fold = (code: string, open: boolean, at: number): void => {
    setFolded((before) => {
      const next = new Set(before);
      if (open) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
    mark(at);
  };

  const choose = (at: number): void => {
    const row = rows[at];
    mark(at);
    if (row?.kind === "head") {
      fold(row.group.code, !row.open, at);
    } else if (row?.line.open !== undefined) {
      dispatch({ type: "open", buffer: row.line.open });
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    const move = foldMove(rows, cursor, event);
    if (move !== undefined) {
      event.preventDefault();
      fold(move.code, move.open, move.cursor);
      return;
    }
    // Ctrl+P while no row is marked stays the window's "Go to", as in the other lists (SR-122).
    if (rows.length === 0) {
      return;
    }
    const to = rowTarget(event, cursor, rows.length);
    if (to !== undefined) {
      event.preventDefault();
      mark(Math.max(0, Math.min(rows.length - 1, to)));
    } else if (
      event.key === "Enter" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      // With no row marked, Enter acts on the first one and marks it.
      choose(Math.max(0, cursor));
    }
  };

  const more = list.total - list.listed;
  return (
    <div
      className="buffer result hints"
      role="listbox"
      aria-label={buffer.name}
      aria-activedescendant={marked === undefined ? undefined : `${scope}hint-${String(cursor)}`}
      {...bufferAttribute}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      <p className="hints-total">
        <span className="count">{String(list.total)}</span> {list.total === 1 ? "hint" : "hints"}
        {more > 0 ? ` · ${String(list.listed)} listed` : ""}
        {list.incomplete ? " · incomplete" : ""}
      </p>
      {rows.map((row, at) =>
        row.kind === "head" ? (
          <div
            key={`head:${row.group.code}`}
            id={`${scope}hint-${String(at)}`}
            className="hint-group"
            role="option"
            aria-selected={at === cursor}
            aria-expanded={row.open}
            data-cursor={at === cursor ? "" : undefined}
            data-code={row.group.code}
            onClick={() => {
              choose(at);
            }}
          >
            <FoldHead label={row.group.label} count={row.group.count} open={row.open} />
            {row.group.label === row.group.code ? null : <span className="code">{row.group.code}</span>}
            {row.open && row.group.lines.length < row.group.count ? (
              <span className="more">{String(row.group.count - row.group.lines.length)} not listed</span>
            ) : null}
          </div>
        ) : (
          <div
            key={`${String(at)}:${row.line.element}`}
            id={`${scope}hint-${String(at)}`}
            className="hint"
            role="option"
            aria-selected={at === cursor}
            data-cursor={at === cursor ? "" : undefined}
            title={row.line.message}
            onClick={() => {
              choose(at);
            }}
          >
            <span className="hint-element">{row.line.element}</span>
            <span className="hint-title">{row.line.title}</span>
            <span className="hint-reason">{row.line.reason}</span>
          </div>
        ),
      )}
    </div>
  );
};
