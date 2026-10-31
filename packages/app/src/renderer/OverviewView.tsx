// The overview buffer (SR-118): the first buffer of a workspace. One line per element type with the number
// of its elements, and below it the elements opened last, at most five. It lists no element of the
// workspace (AK4): the full list opens on request only ("List all elements"). The counts come from
// `element.facets`, the recent elements from `element.get`; the app only shows them (ADR-0002). A recent
// element that changed outside the app is highlighted briefly (SR-116).
import { Fragment, useEffect, useState } from "react";
import { useIdScope } from "./area-scope.js";
import type { OverviewBuffer, BufferAction } from "./buffers.js";
import { elementBuffer, elementBufferOf } from "./buffers.js";
import type { Call } from "./call.js";
import { rowTarget } from "./keys.js";
import type { BufferData } from "./modeline.js";
import type { RecentRow, TypeCount } from "./overview.js";
import { openRow, overviewRows, typeLine } from "./overview.js";
import { isGone } from "./outside-change.js";
import type { OutsideChanges } from "./outside-marks.js";
import type { RecentEntry } from "./recent.js";
import { activeRow } from "./rows.js";
import { rowClass, useOutsideMarks } from "./use-outside-marks.js";

/** What the type lines and the modeline show. */
export interface OverviewData {
  readonly types: readonly TypeCount[];
  /** All elements of the workspace. */
  readonly total: number;
  /** A repository of the workspace is missing, so the counts are partial (SR-006 AK2). */
  readonly incomplete: boolean;
}

const entryKey = (entry: RecentEntry): string => `${entry.repository}\n${entry.id}`;

/**
 * Loads what the overview shows while it is `active`: the counts once per `revision` of the workspace (a
 * return to the overview does not count again, which would take hundreds of milliseconds at 50,000
 * elements), and the recent elements again when the list or the workspace changed. An element that cannot
 * be read any more (deleted outside, repository missing) is left out silently; `gone` gives the buffer keys
 * of those that core no longer knows (`ref.unknown`), so "Go to" forgets their names (#681). `read` is the
 * last answer itself, so a name is taken from it once, not again after it was forgotten.
 */
export const useOverview = (
  call: Call,
  revision: number,
  recent: readonly RecentEntry[],
  active: boolean,
  onEcho: (message: string) => void,
): {
  readonly data: OverviewData | undefined;
  readonly recents: readonly RecentRow[];
  /** The rows of the last read of the recent elements; a new map only when a read answered. */
  readonly read: ReadonlyMap<string, RecentRow>;
  readonly gone: readonly string[];
} => {
  const [counted, setCounted] = useState<
    { readonly revision: number; readonly data: OverviewData } | undefined
  >(undefined);
  const [resolved, setResolved] = useState<ReadonlyMap<string, RecentRow>>(new Map());
  const [gone, setGone] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!active || counted?.revision === revision) {
      return;
    }
    let live = true;
    void call("element.facets", {}).then((answer) => {
      if (!live) {
        return;
      }
      if (answer.ok) {
        const { types, total, incomplete } = answer.output;
        setCounted({ revision, data: { types, total, incomplete } });
      } else {
        onEcho(answer.message);
      }
    });
    return () => {
      live = false;
    };
  }, [call, active, revision, counted?.revision, onEcho]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let live = true;
    void Promise.all(
      recent.map(async (entry) => ({
        entry,
        answer: await call("element.get", { ref: entry.id, repository: entry.repository }),
      })),
    ).then((answers) => {
      if (live) {
        setGone(
          answers.flatMap(({ entry, answer }) =>
            !answer.ok && isGone(answer.code) ? [elementBuffer(entry.id, entry.repository, "").key] : [],
          ),
        );
        setResolved(
          new Map(
            answers.flatMap(({ entry, answer }) => {
              if (!answer.ok) {
                return [];
              }
              const { element } = answer.output;
              const buffer = elementBufferOf(element);
              return [
                [
                  entryKey(entry),
                  { buffer, label: element.identifier ?? element.shortId, title: element.title },
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

  return {
    data: counted?.revision === revision ? counted.data : undefined,
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
  readonly recents: readonly RecentRow[];
  /** The changes from outside (SR-116): the line of a recent element that changed is highlighted. */
  readonly outside?: OutsideChanges;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline; undefined while it loads. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
}

export const OverviewView = ({
  buffer,
  data,
  recents,
  outside,
  dispatch,
  onData,
}: OverviewViewProps): React.JSX.Element => {
  const scope = useIdScope();
  const { marked, mark } = useOutsideMarks();
  useEffect(() => {
    if (outside !== undefined) {
      mark(recents.map((row) => row.buffer.id).filter(outside.fresh));
    }
  }, [recents]);
  const rows = data === undefined ? [] : overviewRows(data.types, recents);
  const cursor = Math.min(buffer.cursor, Math.max(0, rows.length - 1));
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
    if (row !== undefined) {
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
      data-buffer=""
      tabIndex={0}
      onKeyDown={keyDown}
    >
      {rows.map((row, at) => (
        <Fragment key={row.kind === "type" ? `type:${row.key}` : row.buffer.key}>
          {at === firstRecent ? <div className="group">Recent</div> : null}
          <div
            id={`${scope}overview-${String(at)}`}
            className={row.kind === "type" ? "line type" : rowClass("line recent", marked, row.buffer.id)}
            role="option"
            aria-selected={at === cursor}
            {...(row.kind === "type" ? { "aria-label": typeLine(row) } : {})}
            onClick={() => {
              dispatch({ type: "cursor", key: buffer.key, cursor: at });
              open(at);
            }}
          >
            {row.kind === "type" ? (
              <>
                <span className="name">{row.name}</span> <span className="count">{String(row.count)}</span>
              </>
            ) : (
              <>
                <span className="id">{row.label}</span>
                <span className="title">{row.title}</span>
              </>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  );
};
