// The traceability matrix (SR-125): a list buffer in matrix mode. One row per element of the list, in its
// order; one column per relation kind and direction that occurs; each cell the elements at the other end,
// "—" where the row has none; above each column how many rows have a relation and their share. Everything
// is what `trace.matrix` gives (ADR-0002); the rows come in pages like the list's. Right and Left walk
// through the row element and its relations, Enter or a click opens the element. The row element of an
// element that changed outside the app is highlighted briefly (SR-116).
import { useEffect, useRef, useState } from "react";
import type { DataExportRelation } from "@reqseq/core";
import { useIdScope } from "./area-scope.js";
import type { BufferAction, ListBuffer } from "./buffers.js";
import { bufferName, listSort } from "./buffers.js";
import type { Call } from "./call.js";
import { relationLabel } from "./element-view.js";
import { columnCount, columnName, matrixInput, matrixRows, opening, targetsOf } from "./matrix.js";
import type { MatrixColumn, MatrixRow } from "./matrix.js";
import { rowTarget } from "./keys.js";
import { OUTDATED_WORD } from "./outdated-codes.js";
import type { BufferData } from "./modeline.js";
import type { OutsideChanges } from "./outside-marks.js";
import { rowClass, useOutsideMarks } from "./use-outside-marks.js";
import { useResetOnAsk } from "./use-reset-on-ask.js";
import { LIST_MAX, LIST_PAGE, activeRow, firstLimit } from "./rows.js";

export interface MatrixViewProps {
  readonly call: Call;
  readonly buffer: ListBuffer;
  /** Counts up when the workspace changed: the matrix is asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  /** `undefined` while the buffer asks again, so the modeline never shows an old count. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** The changes from outside (SR-116): the row element of an element that changed is highlighted. */
  readonly outside?: OutsideChanges;
}

type View =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ok";
      readonly columns: readonly MatrixColumn[];
      readonly rows: readonly MatrixRow[];
      readonly total: number;
      readonly incomplete: boolean;
    };

/** Rows moved by Page Up and Page Down. */
const SCREEN = 10;
/** The next page is asked for when the selection is this close to the last loaded row. */
const NEAR_END = 5;

const nearEnd = ({ scrollHeight, scrollTop, clientHeight }: HTMLElement): boolean =>
  scrollHeight - scrollTop - clientHeight < clientHeight;

/** One relation of a cell, with the marks of the element view: the state of an unavailable end, and "link outdated". */
const Link = ({
  relation,
  current,
  onChoose,
}: {
  readonly relation: DataExportRelation;
  readonly current: boolean;
  readonly onChoose: () => void;
}): React.JSX.Element => (
  <div className={relation.targetState === "available" ? "relation" : "relation unavailable"}>
    <span role="link" className={current ? "target current" : "target"} onClick={onChoose}>
      {relationLabel(relation)}
    </span>
    {relation.targetState === "available" ? null : <span className="state"> {relation.targetState}</span>}
    {relation.outdated === true ? <span className="outdated"> {OUTDATED_WORD}</span> : null}
  </div>
);

export const MatrixView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
  outside,
}: MatrixViewProps): React.JSX.Element => {
  const scope = useIdScope();
  const [view, setView] = useState<View>({ status: "loading" });
  const { marked, mark } = useOutsideMarks();
  // Which target of the selected row the cursor is on: 0 the row element, then its relations in order.
  const [target, setTarget] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const sort = listSort(buffer);
  const generation = useRef(0);
  const loadingMore = useRef(false);
  // The rows are asked for again (another list, a filter, a sort, a change): the rows and the cursor in
  // the old row go in the same render, not in the effect, so no commit shows them under the next name.
  useResetOnAsk([call, buffer.key, buffer.selection, sort, revision], () => {
    setTarget(0);
    setView({ status: "loading" });
  });

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    loadingMore.current = false;
    onData(buffer.key, undefined);
    const limit = firstLimit(buffer.cursor, LIST_PAGE, LIST_MAX);
    void call("trace.matrix", matrixInput(buffer, 0, limit)).then((answer) => {
      if (mine !== generation.current) {
        return;
      }
      if (answer.ok) {
        const { incomplete } = answer.output;
        const rows = matrixRows(answer.output);
        setView({
          status: "ok",
          columns: answer.output.columns,
          rows,
          total: answer.output.total,
          incomplete,
        });
        if (outside !== undefined) {
          mark(rows.map((row) => row.element.open.id).filter(outside.fresh));
        }
        onData(buffer.key, { kind: "list", total: answer.output.total, incomplete });
      } else {
        setView({ status: "error", message: answer.message });
        onEcho(answer.message);
      }
    });
    return () => {
      generation.current += 1;
    };
    // The cursor is read when the rows are asked for again; moving it must not ask again.
  }, [call, buffer.key, buffer.selection, sort, revision]);

  const rows = view.status === "ok" ? view.rows : [];
  const cursor = Math.min(buffer.cursor, Math.max(0, rows.length - 1));
  const selected = rows[cursor];
  const targets = selected === undefined ? [] : targetsOf(selected);
  const at = Math.min(target, Math.max(0, targets.length - 1));

  useEffect(() => {
    const list = root.current;
    list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    list?.querySelector(".current")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cursor, at, view.status]);

  const loadMore = (): void => {
    if (view.status !== "ok" || loadingMore.current || view.rows.length >= view.total) {
      return;
    }
    loadingMore.current = true;
    const mine = generation.current;
    void call("trace.matrix", matrixInput(buffer, view.rows.length, LIST_PAGE)).then((answer) => {
      loadingMore.current = false;
      if (mine !== generation.current) {
        return;
      }
      if (answer.ok) {
        const { incomplete } = answer.output;
        setView({ ...view, rows: [...view.rows, ...matrixRows(answer.output)], total: answer.output.total });
        onData(buffer.key, { kind: "list", total: answer.output.total, incomplete });
      } else {
        onEcho(answer.message);
      }
    });
  };

  const moveTo = (to: number): void => {
    const next = Math.max(0, Math.min(rows.length - 1, to));
    setTarget(0);
    dispatch({ type: "cursor", key: buffer.key, cursor: next });
    if (next >= rows.length - NEAR_END) {
      loadMore();
    }
  };

  /** Opens the element of a target; a relation to an element that is not there says why it opens nothing. */
  const open = (row: number, which: number): void => {
    const chosen = rows[row] === undefined ? undefined : targetsOf(rows[row]).at(which);
    if (chosen === undefined) {
      return;
    }
    // The row is kept as the cursor, as the list keeps it: Ctrl+P Enter comes back to it.
    dispatch({ type: "cursor", key: buffer.key, cursor: row });
    if (chosen.kind === "element") {
      dispatch({ type: "open", buffer: chosen.open });
      return;
    }
    const result = opening(chosen.relation);
    if (result.ok) {
      dispatch({ type: "open", buffer: result.buffer });
    } else {
      setTarget(which);
      onEcho(result.message);
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    const to = rowTarget(event, cursor, rows.length, SCREEN);
    if (to !== undefined) {
      event.preventDefault();
      moveTo(to);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (cursor >= 0) {
        setTarget(Math.max(0, Math.min(targets.length - 1, at + (event.key === "ArrowRight" ? 1 : -1))));
      } else if (rows.length > 0) {
        // No row selected: the first key selects the first row, on its element; the next one steps.
        moveTo(0);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      // With no row selected, Enter opens the element of the first row and selects it.
      open(Math.max(0, cursor), at);
    }
  };

  const columns = view.status === "ok" ? view.columns : [];
  return (
    <div
      ref={root}
      className="buffer matrix"
      onScroll={(event) => {
        if (nearEnd(event.currentTarget)) {
          loadMore();
        }
      }}
    >
      <table
        role="grid"
        aria-label={bufferName(buffer)}
        aria-activedescendant={activeRow(`${scope}matrix-row`, cursor, rows.length)}
        data-buffer=""
        tabIndex={0}
        onKeyDown={keyDown}
      >
        {rows.length === 0 ? null : (
          <thead>
            <tr>
              <th scope="col" aria-label="Element" />
              {columns.map((column) => (
                <th scope="col" key={`${column.kind}:${column.direction}`} data-direction={column.direction}>
                  <span className="name">{columnName(column, columns)}</span>
                  <span className="count">{columnCount(column)}</span>
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, index) => {
            // The targets of the row are numbered across its cells: 0 is the element.
            let next = 1;
            return (
              <tr
                key={row.element.open.key}
                id={`${scope}matrix-row-${String(index)}`}
                role="row"
                aria-selected={index === cursor}
              >
                <td className={rowClass("element", marked, row.element.open.id)} role="gridcell">
                  <span
                    role="link"
                    className={index === cursor && at === 0 ? "target current" : "target"}
                    onClick={() => {
                      open(index, 0);
                    }}
                  >
                    <span className="id">{row.element.label}</span>{" "}
                    <span className="title" style={{ paddingLeft: `${String(row.element.depth * 1.25)}rem` }}>
                      {row.element.title}
                    </span>
                  </span>
                </td>
                {row.cells.map((cell, column) => {
                  const first = next;
                  next += cell.length;
                  return (
                    <td key={column} role="gridcell" className="cell">
                      {cell.length === 0 ? (
                        <span className="gap" title="No relation">
                          —
                        </span>
                      ) : (
                        cell.map((relation, place) => (
                          <Link
                            key={`${relation.id}:${String(place)}`}
                            relation={relation}
                            current={index === cursor && at === first + place}
                            onChoose={() => {
                              open(index, first + place);
                            }}
                          />
                        ))
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {view.status === "ok" && rows.length === 0 ? <p className="quiet">No elements</p> : null}
      {view.status === "ok" && rows.length > 0 && columns.length === 0 ? (
        <p className="quiet">No element of this list has a relation</p>
      ) : null}
      {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
    </div>
  );
};
