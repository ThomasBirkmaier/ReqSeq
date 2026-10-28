// The metamodel as text (SR-130 AK5): the answer of `metamodel.get` that the graph shows, as rows on the
// white sheet (`metamodel-text.ts` says which words stand for which field). One section per type: its
// name, prefix and key, "abstract", its parent, its properties with value kind and "required" (the
// inherited ones muted, as in the graph) and its statuses; then one line per relation kind with its
// source and target types; then the problems of the output. Greys only (D-062).
// Keys as in every list of the main window (SR-122 AK4, AK5; `rowTarget`): Down and Ctrl+N, Up and
// Ctrl+P, Page Up and Page Down, Home and End move the selection. The selected type is the graph's
// (Ctrl/Cmd+T, AK4): the text opens on it, and a type selected here is selected in the graph.
import { Fragment, useEffect, useMemo, useRef } from "react";
import { useIdScope } from "./area-scope.js";
import { rowTarget } from "./keys.js";
import type { RelationRow, TypeRow } from "./metamodel-text.js";
import { metamodelText } from "./metamodel-text.js";
import type { SheetProps } from "./MetamodelView.js";

/** The rows Page Up and Page Down move: a type's section is several lines tall. */
const SCREEN = 5;

const TypeSection = ({ row }: { readonly row: TypeRow }): React.JSX.Element => (
  <>
    <div className="mm-text-head">
      <span className="mm-text-name">{row.name}</span>
      <span className="mm-text-prefix">{row.prefix}</span>
      <span className="mm-key">{row.type}</span>
      {row.abstract ? <span className="mm-note">abstract</span> : null}
    </div>
    {row.parent === undefined ? null : (
      <div className="mm-fact" data-parent="">
        <span className="mm-fact-name">extends</span> <span className="mm-fact-value">{row.parent}</span>
      </div>
    )}
    <div className="mm-fact" data-properties="">
      <span className="mm-fact-name">Properties</span>
      {row.properties.length === 0 ? (
        <>
          {" "}
          <span className="mm-fact-value">none</span>
        </>
      ) : null}
    </div>
    {row.properties.map((property) => (
      <div
        key={property.key}
        className={property.inherited ? "mm-text-property inherited" : "mm-text-property"}
        data-property={property.key}
      >
        <span className="mm-property-name">{property.name}</span>
        <span className="mm-key">{property.key}</span>
        <span className="mm-value">{property.value}</span>
        <span className="mm-required">{property.required ? "required" : ""}</span>
      </div>
    ))}
    <div className="mm-fact" data-statuses="">
      <span className="mm-fact-name">Statuses</span>{" "}
      <span className="mm-fact-value">{row.statuses.length === 0 ? "none" : row.statuses.join(" · ")}</span>
    </div>
  </>
);

const RelationLine = ({ row }: { readonly row: RelationRow }): React.JSX.Element => (
  <div className="mm-text-head">
    <span className="mm-text-name">{row.name}</span>
    <span className="mm-key">{row.relation}</span>
    <span className="mm-sides">
      <span data-source="">{row.source}</span> → <span data-target="">{row.target}</span>
    </span>
  </div>
);

export const MetamodelTextView = ({
  shown,
  error,
  buffer,
  dispatch,
  root,
}: SheetProps): React.JSX.Element => {
  const scope = useIdScope();
  const text = useMemo(() => (shown === undefined ? undefined : metamodelText(shown.output)), [shown]);
  const rows = text?.rows ?? [];
  const has = (key: string | undefined): key is string =>
    key !== undefined && rows.some((row) => row.key === key);
  const selectedKey = has(buffer.row) ? buffer.row : has(buffer.selected) ? buffer.selected : rows[0]?.key;
  const cursor = rows.findIndex((row) => row.key === selectedKey);
  const firstRelation = rows.findIndex((row) => row.kind === "relation");
  // Whether the text has opened: it opens with the selected row at the top (on the first row, at the top
  // of the text), later rows only come into view.
  const opened = useRef(false);

  useEffect(() => {
    const row = root.current?.querySelector('[aria-selected="true"]');
    if (row === null || row === undefined) {
      return;
    }
    if (opened.current) {
      row.scrollIntoView({ block: "nearest" });
    } else if (cursor > 0) {
      row.scrollIntoView({ block: "start" });
    }
    opened.current = true;
  }, [selectedKey, text]);

  const select = (at: number): void => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, at))];
    if (row !== undefined) {
      dispatch({ type: "select", key: buffer.key, node: row.key });
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // The keys of the list and Ctrl+N/P (SR-122); Cmd+P is the window's "Go to", as are the other
    // shortcuts (Ctrl/Cmd+T back to the graph).
    const to = rowTarget(event, cursor, rows.length, SCREEN);
    if (to !== undefined) {
      event.preventDefault();
      select(to);
    }
  };

  return (
    <div
      ref={root}
      className="buffer metamodel-text"
      role="listbox"
      aria-label="Metamodel as text"
      aria-activedescendant={cursor < 0 ? undefined : `${scope}mm-row-${String(cursor)}`}
      data-buffer=""
      data-rows={text === undefined ? undefined : String(rows.length)}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      {rows.length === 0 ? (
        <p className="quiet">{text === undefined ? error : "The metamodel defines no types."}</p>
      ) : null}
      {rows.map((row, at) => (
        <Fragment key={row.key}>
          {at === 0 && row.kind === "type" ? <div className="mm-group">Types</div> : null}
          {at === firstRelation ? <div className="mm-group">Relation kinds</div> : null}
          <div
            id={`${scope}mm-row-${String(at)}`}
            className={`mm-row ${row.kind}`}
            role="option"
            aria-selected={at === cursor}
            data-row={row.key}
            onClick={() => {
              select(at);
            }}
          >
            {row.kind === "type" ? <TypeSection row={row} /> : <RelationLine row={row} />}
          </div>
        </Fragment>
      ))}
      {text === undefined || text.problems.length === 0 ? null : (
        <>
          <div className="mm-group">Problems</div>
          {text.problems.map((problem, at) => (
            <div key={at} className="mm-problem">
              {problem}
            </div>
          ))}
        </>
      )}
    </div>
  );
};
