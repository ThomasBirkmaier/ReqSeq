// The overview buffer (SR-118): the first buffer of a workspace. One line per element type with the number
// of its elements, below it at most ten perspectives with the number of elements each lists (AK6), and
// below them the elements opened last, at most five. It lists no element of the workspace (AK4): the full
// list opens on request only ("List all elements"). The counts come from `element.facets`, the
// perspectives from `perspective.list` and their counts from `element.list` with the perspective, the
// recent elements from `element.get`; the app only shows them (ADR-0002). A recent element that changed
// outside the app is highlighted briefly (SR-116).
import { bufferMark, useHidden, useReveal } from "./area-slot.js";
import { Fragment, useEffect, useRef, useState } from "react";
import { useIdScope } from "./area-scope.js";
import type { OverviewBuffer, BufferAction } from "./buffers.js";
import { elementBuffer, elementBufferOf } from "./buffers.js";
import type { Call } from "./call.js";
import { rowTarget } from "./keys.js";
import type { BufferData } from "./modeline.js";
import type { OverviewRow, PerspectiveCount, PerspectiveRow, RecentRow, TypeCount } from "./overview.js";
import {
  openRow,
  overviewRows,
  perspectiveCount,
  perspectiveLine,
  shownPerspectives,
  typeLine,
} from "./overview.js";
import { isGone } from "./outside-change.js";
import type { OutsideChanges } from "./outside-marks.js";
import { countPerspective } from "./perspective-actions.js";
import type { RecentEntry } from "./recent.js";
import { entryKey, readRecent } from "./recent-read.js";
import { activeRow } from "./rows.js";
import { rowClass, useOutsideMarks } from "./use-outside-marks.js";
import { shownId } from "./id-title.js";

/** What the type lines and the modeline show. */
export interface OverviewData {
  readonly types: readonly TypeCount[];
  /** All elements of the workspace. */
  readonly total: number;
  /** A repository of the workspace is missing, so the counts are partial (SR-006 AK2). */
  readonly incomplete: boolean;
  /** The names of the perspectives shown (`shownPerspectives`). */
  readonly perspectives: readonly string[];
}

/** A turn at once, for a caller without other calls to give way to. */
const AT_ONCE = (): Promise<void> => Promise.resolve();

/**
 * Loads what the overview shows while it is `active`: the counts and the perspectives once per `revision`
 * of the workspace (a return to the overview does not count again, which would take hundreds of
 * milliseconds at 50,000 elements), and the recent elements again when the list or the workspace changed.
 * The type lines and the names of the perspectives come together; the count of each perspective follows
 * after them, one perspective after the other (SR-118 AK8), each only once the window is idle and no other
 * call is pending (`turn`), so the overview does not wait for them and a call of the user waits at most for
 * the one count in flight. The counts are asked only while the overview is shown and its revision is the
 * workspace's; shown again, it asks only for those not counted yet. An element that cannot
 * be read any more (deleted outside, repository missing) is left out silently; `gone` gives the buffer keys
 * of those that core no longer knows (`ref.unknown`), so "Go to" forgets their names (ThomasBirkmaier/ReqSeq-archive#681). `read` is the
 * last answer itself, so a name is taken from it once, not again after it was forgotten.
 */
export const useOverview = (
  call: Call,
  revision: number,
  recent: readonly RecentEntry[],
  active: boolean,
  onEcho: (message: string) => void,
  /** Resolves when a count may be asked: the window is idle and no other call is pending (`call-turn.ts`). */
  turn: () => Promise<void> = AT_ONCE,
): {
  readonly data: OverviewData | undefined;
  /** The perspectives shown, each with its count once computed. */
  readonly perspectives: readonly PerspectiveRow[];
  readonly recents: readonly RecentRow[];
  /** The rows of the last read of the recent elements; a new map only when a read answered. */
  readonly read: ReadonlyMap<string, RecentRow>;
  readonly gone: readonly string[];
} => {
  // With the call it was read with: another call (another workspace, before its revision) counts nothing.
  const [counted, setCounted] = useState<
    { readonly revision: number; readonly call: Call; readonly data: OverviewData } | undefined
  >(undefined);
  const [counts, setCounts] = useState<
    { readonly revision: number; readonly counts: ReadonlyMap<string, PerspectiveCount> } | undefined
  >(undefined);
  const [resolved, setResolved] = useState<ReadonlyMap<string, RecentRow>>(new Map());
  const [gone, setGone] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!active || counted?.revision === revision) {
      return;
    }
    let live = true;
    void Promise.all([call("element.facets", {}), call("perspective.list", {})]).then(([answer, listed]) => {
      if (!live) {
        return;
      }
      if (!answer.ok) {
        // The error of the counts, not that of the perspectives, which would overwrite it.
        onEcho(answer.message);
        return;
      }
      const { types, total, incomplete } = answer.output;
      // Without the perspectives the overview still shows the types; the minibuffer says why.
      const perspectives = listed.ok ? shownPerspectives(listed.output.perspectives) : [];
      setCounted({ revision, call, data: { types, total, incomplete, perspectives } });
      if (!listed.ok) {
        onEcho(listed.message);
      }
    });
    return () => {
      live = false;
    };
  }, [call, active, revision, counted?.revision, onEcho]);

  // The counts of the perspectives, after the overview stands: one call at a time, each shown when it
  // answers, only while the overview is shown and its revision is the workspace's. A count that answers
  // after it was left is kept for its revision; shown again, it asks only for those not counted yet.
  const countsNow = useRef(counts);
  countsNow.current = counts;
  useEffect(() => {
    // A changed call before its revision (`setShownView` on a workspace switch, before the new workspace's
    // revision) counts nothing: the names are those of the workspace before.
    if (!active || counted?.revision !== revision || counted.call !== call) {
      return;
    }
    const { revision: of, data } = counted;
    const have = countsNow.current?.revision === of ? countsNow.current.counts : undefined;
    if (have === undefined) {
      setCounts({ revision: of, counts: new Map() });
    }
    // Read through a function, so the check after each answer reads what the cleanup set meanwhile.
    const run = { live: true };
    const stopped = (): boolean => !run.live;
    void (async () => {
      for (const name of data.perspectives.filter((known) => have?.has(known) !== true)) {
        await turn();
        if (stopped()) {
          return;
        }
        const count = perspectiveCount(await countPerspective(call, name));
        setCounts((last) =>
          last?.revision === of ? { revision: of, counts: new Map(last.counts).set(name, count) } : last,
        );
        if (stopped()) {
          return;
        }
      }
    })();
    return () => {
      run.live = false;
    };
  }, [call, active, revision, counted, turn]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let live = true;
    // Names only, with one list (#1670): an element.get of each would compute its verification status too.
    void readRecent(call, recent).then((reads) => {
      if (live) {
        const answers = recent.flatMap((entry) => {
          const read = reads.get(entryKey(entry));
          return read === undefined ? [] : [{ entry, read }];
        });
        setGone(
          answers.flatMap(({ entry, read }) =>
            !read.ok && isGone(read.code) ? [elementBuffer(entry.id, entry.repository, "").key] : [],
          ),
        );
        setResolved(
          new Map(
            answers.flatMap(({ entry, read }) => {
              if (!read.ok) {
                return [];
              }
              const { element } = read;
              const buffer = elementBufferOf(element);
              return [
                [
                  entryKey(entry),
                  { buffer, label: shownId(element.shortId, element.identifier), title: element.title },
                ],
              ];
            }),
          ),
        );
      }
    });
    return () => {
      live = false;
    };
  }, [call, active, revision, recent]);

  const data = counted?.revision === revision ? counted.data : undefined;
  const known = counts?.revision === revision ? counts.counts : undefined;
  return {
    data,
    perspectives: (data?.perspectives ?? []).map((name) => {
      const found = known?.get(name);
      return found === undefined ? { name } : { name, counted: found };
    }),
    recents: recent.flatMap((entry) => {
      const row = resolved.get(entryKey(entry));
      return row === undefined ? [] : [row];
    }),
    read: resolved,
    gone,
  };
};

export interface OverviewViewProps {
  readonly buffer: OverviewBuffer;
  /** Undefined until the counts are there: the sheet stays empty meanwhile. */
  readonly data: OverviewData | undefined;
  /** The perspectives with their counts, as far as computed. */
  readonly perspectives: readonly PerspectiveRow[];
  readonly recents: readonly RecentRow[];
  /** Opens the perspective of a row as "Open perspective" does (SR-118 AK7, `openPerspective`). */
  readonly onPerspective: (name: string) => void;
  /** The changes from outside (SR-116): the line of a recent element that changed is highlighted. */
  readonly outside?: OutsideChanges;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline; undefined while it loads. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
}

export const OverviewView = ({
  buffer,
  data,
  perspectives,
  recents,
  onPerspective,
  outside,
  dispatch,
  onData,
}: OverviewViewProps): React.JSX.Element => {
  const scope = useIdScope();
  // Found by `[data-buffer]` only while shown, never drawn hidden in advance (SR-212 AK5).
  const bufferAttribute = bufferMark(useHidden());
  const { marked, mark } = useOutsideMarks();
  // Shown after it was drawn hidden in advance, it highlights them as a fresh view at the switch would.
  const markFresh = (): void => {
    if (outside !== undefined) {
      mark(recents.map((row) => row.buffer.id).filter(outside.fresh));
    }
  };
  useEffect(markFresh, [recents]);
  useReveal(markFresh);
  const rows = data === undefined ? [] : overviewRows(data.types, perspectives, recents);
  const cursor = Math.min(buffer.cursor, Math.max(0, rows.length - 1));
  const firstPerspective = rows.findIndex((row) => row.kind === "perspective");
  const firstRecent = rows.findIndex((row) => row.kind === "recent");

  const selectedRow = cursor < 0 ? undefined : rows[cursor];
  const markedRow = selectedRow?.kind === "recent" ? selectedRow.buffer : undefined;
  useEffect(() => {
    onData(
      buffer.key,
      data === undefined
        ? undefined
        : {
            kind: "overview",
            total: data.total,
            incomplete: data.incomplete,
            ...(markedRow === undefined ? {} : { marked: markedRow }),
          },
    );
  }, [buffer.key, data, onData, markedRow?.key]);

  const open = (at: number): void => {
    const row = rows[at];
    if (row?.kind === "perspective") {
      onPerspective(row.name);
    } else if (row !== undefined) {
      dispatch({ type: "open", buffer: openRow(row) });
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // The keys of the list and Ctrl+N/P (SR-122); Cmd+P, and Ctrl+P while no row is selected, are the
    // window's "Go to", as are the other shortcuts.
    const to = rowTarget(event, cursor, rows.length);
    if (to !== undefined) {
      event.preventDefault();
      dispatch({ type: "cursor", key: buffer.key, cursor: Math.max(0, Math.min(rows.length - 1, to)) });
    } else if (event.key === "Enter") {
      event.preventDefault();
      // With no row selected, Enter opens the first one and selects it.
      if (cursor < 0 && rows.length > 0) {
        dispatch({ type: "cursor", key: buffer.key, cursor: 0 });
      }
      open(Math.max(0, cursor));
    }
  };

  return (
    <div
      className="buffer overview"
      role="listbox"
      aria-label="Overview"
      aria-activedescendant={activeRow(`${scope}overview`, cursor, rows.length)}
      {...bufferAttribute}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      <div className="column">
        {rows.map((row, at) => (
          <Fragment key={rowKey(row)}>
            {at === firstPerspective ? <div className="group">Perspectives</div> : null}
            {at === firstRecent ? <div className="group">Recent</div> : null}
            <div
              id={`${scope}overview-${String(at)}`}
              className={
                row.kind === "recent" ? rowClass("line recent", marked, row.buffer.id) : `line ${row.kind}`
              }
              role="option"
              aria-selected={at === cursor}
              {...(row.kind === "recent"
                ? { "data-menu": "element-entry" }
                : { "aria-label": rowLabel(row) })}
              onClick={() => {
                dispatch({ type: "cursor", key: buffer.key, cursor: at });
                open(at);
              }}
              // A right-click selects the row before the context menu opens (SR-194 AK5).
              onContextMenu={() => {
                dispatch({ type: "cursor", key: buffer.key, cursor: at });
              }}
            >
              <RowContent row={row} />
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
};

const rowKey = (row: OverviewRow): string =>
  row.kind === "type"
    ? `type:${row.key}`
    : row.kind === "perspective"
      ? `perspective:${row.name}`
      : row.buffer.key;

const rowLabel = (row: Exclude<OverviewRow, { readonly kind: "recent" }>): string =>
  row.kind === "type" ? typeLine(row) : perspectiveLine(row);

const RowContent = ({ row }: { readonly row: OverviewRow }): React.JSX.Element => {
  if (row.kind === "type") {
    return (
      <>
        <span className="name">{row.name}</span> <span className="count">{String(row.count)}</span>
      </>
    );
  }
  if (row.kind === "perspective") {
    const { counted } = row;
    return (
      <>
        <span className="name">{row.name}</span>
        {counted === undefined ? null : " "}
        {counted === undefined ? null : "count" in counted ? (
          <span className="count">{String(counted.count)}</span>
        ) : (
          // The reason in short; the minibuffer says it in full when the row is opened.
          <span className="reason" title={counted.message}>
            {counted.reason}
          </span>
        )}
      </>
    );
  }
  return (
    <>
      <span className="id" title={row.label}>
        {row.label}
      </span>
      <span className="title">{row.title}</span>
    </>
  );
};
