// The list buffer and the search buffer: rows of elements as `element.list` and `element.search` give
// them, in pages. The next page is asked for when the selection or the scroll reaches the end, so a
// workspace of 50,000 elements is never loaded at once (N-036).
import { useEffect, useRef, useState } from "react";
import type { BufferAction, ListBuffer, SearchBuffer } from "./buffers.js";
import { bufferName } from "./buffers.js";
import type { Call } from "./call.js";
import { highlightTerms } from "./highlight.js";
import type { Part } from "./highlight.js";
import type { BufferData } from "./modeline.js";
import type { Row } from "./rows.js";
import { LIST_MAX, LIST_PAGE, SEARCH_MAX, SEARCH_PAGE, firstLimit, listRows, searchRows } from "./rows.js";

export interface ListViewProps {
  readonly call: Call;
  readonly buffer: ListBuffer | SearchBuffer;
  /** Counts up when the workspace changed: the rows are asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline. */
  /** `undefined` while the buffer asks again, so the modeline never shows an old count. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
}

type Page =
  | { readonly ok: true; readonly rows: Row[]; readonly total: number; readonly incomplete: boolean }
  | { readonly ok: false; readonly message: string };

type View =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ok";
      readonly rows: readonly Row[];
      readonly total: number;
      readonly incomplete: boolean;
    };

/** Rows moved by Page Up and Page Down. */
const SCREEN = 10;
/** The next page is asked for when the selection is this close to the last loaded row. */
const NEAR_END = 5;

const fetchPage = async (
  call: Call,
  buffer: ListBuffer | SearchBuffer,
  offset: number,
  limit: number,
): Promise<Page> => {
  if (buffer.kind === "list") {
    const answer = await call("element.list", {
      ...(buffer.selection === undefined ? {} : { selection: buffer.selection }),
      ...(buffer.sort === undefined ? {} : { sort: buffer.sort }),
      limit,
      offset,
    });
    return answer.ok
      ? {
          ok: true,
          rows: listRows(answer.output),
          total: answer.output.total,
          incomplete: answer.output.incomplete === true,
        }
      : answer;
  }
  const answer = await call("element.search", { query: buffer.query, limit, offset });
  return answer.ok
    ? {
        ok: true,
        rows: searchRows(answer.output),
        total: answer.output.total,
        incomplete: answer.output.incomplete,
      }
    : answer;
};

const Marked = ({ parts }: { readonly parts: readonly Part[] }): React.JSX.Element => (
  <>
    {parts.map((part, index) =>
      part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
    )}
  </>
);

export const ListView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
}: ListViewProps): React.JSX.Element => {
  const [view, setView] = useState<View>({ status: "loading" });
  const root = useRef<HTMLDivElement>(null);
  // Counts the loads: an answer of an older one (another filter, a later change) is dropped.
  const generation = useRef(0);
  const loadingMore = useRef(false);
  const kind = buffer.kind;
  const page = kind === "list" ? LIST_PAGE : SEARCH_PAGE;
  const selection = buffer.kind === "list" ? buffer.selection : buffer.query;
  const sort = buffer.kind === "list" ? buffer.sort : undefined;

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    loadingMore.current = false;
    setView({ status: "loading" });
    onData(buffer.key, undefined);
    const limit = firstLimit(buffer.cursor, page, kind === "list" ? LIST_MAX : SEARCH_MAX);
    void fetchPage(call, buffer, 0, limit).then((loaded) => {
      if (mine !== generation.current) {
        return;
      }
      if (loaded.ok) {
        setView({ status: "ok", rows: loaded.rows, total: loaded.total, incomplete: loaded.incomplete });
        onData(buffer.key, { kind, total: loaded.total, incomplete: loaded.incomplete });
      } else {
        setView({ status: "error", message: loaded.message });
        onEcho(loaded.message);
      }
    });
    return () => {
      generation.current += 1;
    };
    // The cursor is read when the rows are asked for again; moving it must not ask again.
  }, [call, buffer.key, kind, selection, sort, revision]);

  const rows = view.status === "ok" ? view.rows : [];
  const cursor = Math.min(buffer.cursor, Math.max(0, rows.length - 1));

  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, view.status]);

  const loadMore = (): void => {
    if (view.status !== "ok" || loadingMore.current || view.rows.length >= view.total) {
      return;
    }
    loadingMore.current = true;
    const mine = generation.current;
    void fetchPage(call, buffer, view.rows.length, page).then((loaded) => {
      loadingMore.current = false;
      if (mine !== generation.current) {
        return;
      }
      if (loaded.ok) {
        setView({ ...view, rows: [...view.rows, ...loaded.rows], total: loaded.total });
        onData(buffer.key, { kind, total: loaded.total, incomplete: loaded.incomplete });
      } else {
        onEcho(loaded.message);
      }
    });
  };

  const moveTo = (to: number): void => {
    const next = Math.max(0, Math.min(rows.length - 1, to));
    dispatch({ type: "cursor", key: buffer.key, cursor: next });
    if (next >= rows.length - NEAR_END) {
      loadMore();
    }
  };

  const openRow = (row: Row | undefined): void => {
    if (row !== undefined) {
      dispatch({ type: "open", buffer: row.open });
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: cursor + 1,
      ArrowUp: cursor - 1,
      PageDown: cursor + SCREEN,
      PageUp: cursor - SCREEN,
      Home: 0,
      End: rows.length - 1,
    };
    const to = moves[event.key];
    if (to !== undefined) {
      event.preventDefault();
      moveTo(to);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openRow(rows[cursor]);
    }
  };

  return (
    <div
      ref={root}
      className="buffer list"
      role="listbox"
      aria-label={bufferName(buffer)}
      aria-activedescendant={rows.length === 0 ? undefined : `row-${String(cursor)}`}
      data-buffer=""
      tabIndex={0}
      onKeyDown={keyDown}
      onScroll={(event) => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
        if (scrollHeight - scrollTop - clientHeight < clientHeight) {
          loadMore();
        }
      }}
    >
      {rows.map((row, at) => (
        <div
          key={row.open.key}
          id={`row-${String(at)}`}
          className="row"
          role="option"
          aria-selected={at === cursor}
          onClick={() => {
            dispatch({ type: "cursor", key: buffer.key, cursor: at });
            openRow(row);
          }}
        >
          <span className="id">
            <Marked parts={highlightTerms(row.label, row.markLabel ? [row.label.toLowerCase()] : [])} />
          </span>
          <span className="title" style={{ paddingLeft: `${String(row.depth * 1.25)}rem` }}>
            <Marked parts={highlightTerms(row.title, row.terms)} />
          </span>
          <span className="status">{row.status}</span>
        </div>
      ))}
      {view.status === "ok" && rows.length === 0 ? (
        <p className="quiet">{buffer.kind === "list" ? "No elements" : `No hits for ${buffer.query}`}</p>
      ) : null}
      {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
    </div>
  );
};
