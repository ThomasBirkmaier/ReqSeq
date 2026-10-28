// The neighbourhood buffer (SR-107): the parents above the title, the children as an indented tree that
// opens level by level, and below it the incoming relations and references by kind, outdated ones marked.
// The tree and the groups are what `trace.neighbourhood` gives (ADR-0002): the tree is asked for again from
// the same element with one more level whenever a row below the fetched levels is opened. A row of an
// element that changed outside the app is highlighted briefly (SR-116).
import { useEffect, useMemo, useRef, useState } from "react";
import type { TraceNeighbourhoodOutput } from "@logreq/core";
import { useIdScope } from "./area-scope.js";
import type { BufferAction, NeighbourhoodBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { rowTarget } from "./keys.js";
import type { BufferData } from "./modeline.js";
import {
  NEIGHBOURHOOD_MAX,
  fetchDepth,
  incomingGroups,
  incomingInput,
  treeInput,
  treeRows,
} from "./neighbourhood.js";
import type { GroupEntry, TreeRow } from "./neighbourhood.js";
import type { OutsideChanges } from "./outside-marks.js";
import { ParentsLine } from "./ParentsLine.js";
import type { Row } from "./rows.js";
import { rowClass, useOutsideMarks } from "./use-outside-marks.js";

export interface NeighbourhoodViewProps {
  readonly call: Call;
  readonly buffer: NeighbourhoodBuffer;
  /** Counts up when the workspace changed: the neighbourhood is asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** The changes from outside (SR-116): a row of an element that changed is highlighted when it is shown. */
  readonly outside?: OutsideChanges;
}

/** Rows moved by Page Up and Page Down. */
const SCREEN = 10;

/** The tree as it was asked for, and the levels it reaches. */
interface Fetched {
  readonly output: TraceNeighbourhoodOutput;
  readonly depth: number;
}

const cutNote = (what: string): string => `Only the first ${String(NEIGHBOURHOOD_MAX)} ${what} are shown`;

/** The three cells of a row; `before` and `after` stand next to the title. */
const Cells = ({
  row,
  before,
  after,
}: {
  readonly row: Row;
  readonly before?: React.ReactNode;
  readonly after?: React.ReactNode;
}): React.JSX.Element => (
  <>
    <span className="id">{row.label}</span>
    <span className="title" style={{ paddingLeft: `${String(row.depth * 1.25)}rem` }}>
      {before}
      {row.title}
      {after}
    </span>
    <span className="status">{row.status}</span>
  </>
);

export const NeighbourhoodView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
  outside,
}: NeighbourhoodViewProps): React.JSX.Element => {
  const scope = useIdScope();
  const { marked, mark } = useOutsideMarks();
  const [fetched, setFetched] = useState<Fetched | undefined>(undefined);
  const [incomingOutput, setIncomingOutput] = useState<TraceNeighbourhoodOutput | undefined>(undefined);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  // Count the loads of each answer: one of an older load (a later change, a deeper tree) is dropped.
  const generation = useRef({ tree: 0, incoming: 0 });
  // The levels the tree was asked for last: a reload after a change asks for as many.
  const asked = useRef(2);

  const loadTree = (depth: number): void => {
    generation.current.tree += 1;
    const mine = generation.current.tree;
    asked.current = depth;
    void call("trace.neighbourhood", treeInput(buffer, depth)).then((answer) => {
      if (mine !== generation.current.tree) {
        return;
      }
      if (answer.ok) {
        setFetched({ output: answer.output, depth });
      } else {
        setErrors((before) => [...before, answer.message]);
        onEcho(answer.message);
      }
    });
  };

  // The rows keep what they show while they are asked again, so the sheet does not jump with every save.
  useEffect(() => {
    setErrors([]);
    loadTree(asked.current);
    generation.current.incoming += 1;
    const mine = generation.current.incoming;
    void call("trace.neighbourhood", incomingInput(buffer)).then((answer) => {
      if (mine !== generation.current.incoming) {
        return;
      }
      if (answer.ok) {
        setIncomingOutput(answer.output);
      } else {
        setErrors((before) => [...before, answer.message]);
        onEcho(answer.message);
      }
    });
    return () => {
      generation.current.tree += 1;
      generation.current.incoming += 1;
    };
  }, [call, buffer.id, buffer.repository, revision]);

  const tree = useMemo(
    () => (fetched === undefined ? undefined : treeRows(fetched.output, buffer.open)),
    [fetched, buffer.open],
  );
  const incoming = useMemo(
    () => (incomingOutput === undefined ? undefined : incomingGroups(incomingOutput)),
    [incomingOutput],
  );

  // A row that was opened below the fetched levels: ask again from the same element with more levels.
  const wanted = tree === undefined ? 0 : fetchDepth(tree.rows);
  useEffect(() => {
    if (fetched !== undefined && wanted > fetched.depth) {
      loadTree(wanted);
    }
  }, [wanted, fetched?.depth]);

  useEffect(() => {
    if (fetched !== undefined && incomingOutput !== undefined) {
      onData(buffer.key, {
        kind: "neighbourhood",
        incomplete: fetched.output.incomplete || incomingOutput.incomplete,
      });
    }
  }, [fetched, incomingOutput]);

  const treeLength = tree?.rows.length ?? 0;
  const groups = incoming?.groups ?? [];
  const entries: readonly (TreeRow | GroupEntry)[] = [
    ...(tree?.rows ?? []),
    ...groups.flatMap((group) => group.entries),
  ];

  // The rows shown after an answer: those of elements that changed outside are highlighted.
  useEffect(() => {
    if (outside !== undefined) {
      mark(entries.map((entry) => entry.row.open.id).filter(outside.fresh));
    }
  }, [tree, incoming]);
  const cursor = Math.min(buffer.cursor, Math.max(0, entries.length - 1));

  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, tree, incoming]);

  const moveTo = (to: number): void => {
    dispatch({ type: "cursor", key: buffer.key, cursor: Math.max(0, Math.min(entries.length - 1, to)) });
  };

  /**
   * Opens or closes the children of a tree row, and selects the row `at`; the buffer is replaced by itself
   * with its `open` and `cursor` changed.
   */
  const setOpened = (row: TreeRow, opened: boolean, at: number): void => {
    const rest = buffer.open.filter((key) => key !== row.key);
    dispatch({
      type: "open",
      buffer: { ...buffer, cursor: at, open: opened ? [...rest, row.key] : rest },
    });
  };

  const openElement = (at: number, row: Row): void => {
    // The row is kept as the cursor, as a click keeps it: coming back finds it.
    dispatch({ type: "cursor", key: buffer.key, cursor: at });
    dispatch({ type: "open", buffer: row.open });
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // Keys of a link in the parents line are not for the rows.
    if (event.target !== event.currentTarget) {
      return;
    }
    const to = rowTarget(event, cursor, entries.length, SCREEN);
    // Enter, Right and Left act on the selected row; with none selected, on the first, which they select.
    const at = Math.max(0, cursor);
    const row = tree?.rows[at];
    const entry = entries[at];
    const selectFirst = (): void => {
      if (cursor < 0 && entry !== undefined) {
        moveTo(0);
      }
    };
    if (to !== undefined) {
      event.preventDefault();
      moveTo(to);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (entry !== undefined) {
        openElement(at, entry.row);
      }
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row?.expandable === true && !row.opened) {
        setOpened(row, true, at);
      } else {
        selectFirst();
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row?.opened === true) {
        setOpened(row, false, at);
      } else if (row?.parent !== undefined) {
        moveTo(row.parent);
      } else {
        selectFirst();
      }
    }
  };

  let groupStart = treeLength;
  return (
    <div
      ref={root}
      className="buffer neighbourhood"
      aria-label={`Neighbourhood: ${buffer.name}`}
      data-buffer=""
      tabIndex={0}
      onKeyDown={keyDown}
    >
      <div className="column">
        <ParentsLine
          call={call}
          id={buffer.id}
          repository={buffer.repository}
          revision={revision}
          dispatch={dispatch}
          onEcho={onEcho}
        />
        <h1>{buffer.name}</h1>
        {errors.map((message, at) => (
          <p className="quiet" key={at}>
            {message}
          </p>
        ))}
        {tree === undefined ? null : (
          <section>
            <h2>Children</h2>
            <div role="tree" aria-label="Children">
              {tree.rows.map((entry, at) => (
                <div
                  key={at}
                  id={`${scope}nrow-${String(at)}`}
                  className={rowClass("row", marked, entry.row.open.id)}
                  role="treeitem"
                  aria-level={entry.level}
                  aria-expanded={entry.expandable === true ? entry.opened : undefined}
                  aria-selected={at === cursor}
                  onClick={() => {
                    openElement(at, entry.row);
                  }}
                >
                  <Cells
                    row={entry.row}
                    before={
                      <span
                        className="twisty"
                        aria-hidden="true"
                        onClick={(event) => {
                          if (entry.expandable === true) {
                            event.stopPropagation();
                            setOpened(entry, !entry.opened, at);
                          }
                        }}
                      >
                        {entry.expandable === true ? (entry.opened ? "▾" : "▸") : ""}
                      </span>
                    }
                    after={
                      <>
                        {entry.repeated ? <span className="repeated"> repeated</span> : null}
                        {entry.outdated ? <span className="outdated"> outdated</span> : null}
                      </>
                    }
                  />
                </div>
              ))}
            </div>
            {tree.rows.length === 0 ? <p className="quiet">No children</p> : null}
            {tree.cut ? <p className="quiet">{cutNote("elements of the tree")}</p> : null}
          </section>
        )}
        {groups.map((group) => {
          const start = groupStart;
          groupStart += group.entries.length;
          return (
            <section key={group.heading}>
              <h2>{group.heading}</h2>
              <div role="listbox" aria-label={group.heading}>
                {group.entries.map((entry, index) => (
                  <div
                    key={index}
                    id={`${scope}nrow-${String(start + index)}`}
                    className={rowClass("row", marked, entry.row.open.id)}
                    role="option"
                    aria-selected={start + index === cursor}
                    onClick={() => {
                      openElement(start + index, entry.row);
                    }}
                  >
                    <Cells
                      row={entry.row}
                      after={entry.outdated ? <span className="outdated"> outdated</span> : null}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {incoming?.cut === true ? <p className="quiet">{cutNote("incoming links")}</p> : null}
      </div>
    </div>
  );
};
