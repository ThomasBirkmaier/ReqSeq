// The overview buffer (SR-118): the first buffer of a workspace. One line per element type with the number
// of its elements, and below it the elements opened last, at most five. It lists no element of the
// workspace (AK4): the full list opens on request only ("List all elements"). The counts come from
// `element.facets`, the recent elements from `element.get`; the app only shows them (ADR-0002).
import { Fragment, useEffect, useState } from "react";
import type { OverviewBuffer, BufferAction } from "./buffers.js";
import { elementBufferOf } from "./buffers.js";
import type { Call } from "./call.js";
import type { BufferData } from "./modeline.js";
import type { RecentRow, TypeCount } from "./overview.js";
import { openRow, overviewRows, typeLine } from "./overview.js";
import type { RecentEntry } from "./recent.js";

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
 * be read any more (deleted outside, repository missing) is left out silently.
 */
export const useOverview = (
  call: Call,
  revision: number,
  recent: readonly RecentEntry[],
  active: boolean,
  onEcho: (message: string) => void,
): { readonly data: OverviewData | undefined; readonly recents: readonly RecentRow[] } => {
  const [counted, setCounted] = useState<
    { readonly revision: number; readonly data: OverviewData } | undefined
  >(undefined);
  const [resolved, setResolved] = useState<ReadonlyMap<string, RecentRow>>(new Map());

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
  };
};

export interface OverviewViewProps {
  readonly buffer: OverviewBuffer;
  /** Undefined until the counts are there: the sheet stays empty meanwhile. */
  readonly data: OverviewData | undefined;
  readonly recents: readonly RecentRow[];
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline; undefined while it loads. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
}

export const OverviewView = ({
  buffer,
  data,
  recents,
  dispatch,
  onData,
}: OverviewViewProps): React.JSX.Element => {
  const rows = data === undefined ? [] : overviewRows(data.types, recents);
  const cursor = Math.min(buffer.cursor, Math.max(0, rows.length - 1));
  const firstRecent = rows.findIndex((row) => row.kind === "recent");

  useEffect(() => {
    onData(
      buffer.key,
      data === undefined ? undefined : { kind: "overview", total: data.total, incomplete: data.incomplete },
    );
  }, [buffer.key, data, onData]);

  const open = (at: number): void => {
    const row = rows[at];
    if (row !== undefined) {
      dispatch({ type: "open", buffer: openRow(row) });
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // Ctrl/Cmd+P and the other shortcuts are the window's: only the plain keys of the list are handled.
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: cursor + 1,
      ArrowUp: cursor - 1,
      Home: 0,
      End: rows.length - 1,
    };
    const to = moves[event.key];
    if (to !== undefined) {
      event.preventDefault();
      dispatch({ type: "cursor", key: buffer.key, cursor: Math.max(0, Math.min(rows.length - 1, to)) });
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(cursor);
    }
  };

  return (
    <div
      className="buffer overview"
      role="listbox"
      aria-label="Overview"
      aria-activedescendant={rows.length === 0 ? undefined : `overview-${String(cursor)}`}
      data-buffer=""
      tabIndex={0}
      onKeyDown={keyDown}
    >
      {rows.map((row, at) => (
        <Fragment key={row.kind === "type" ? `type:${row.key}` : row.buffer.key}>
          {at === firstRecent ? <div className="group">Recent</div> : null}
          <div
            id={`overview-${String(at)}`}
            className={row.kind === "type" ? "line type" : "line recent"}
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
