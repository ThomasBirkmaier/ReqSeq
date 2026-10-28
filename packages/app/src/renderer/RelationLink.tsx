// The relations of an element in its buffer: one target as a link that opens its element buffer (#416), or
// with its state when it cannot be opened, and the groups of the relations that are no property (one field
// per relation kind, incoming ones with an arrow). `element-view.ts` builds the rows and the groups.
import type { DataExportElement } from "@logreq/core";
import type { ElementBuffer } from "./buffers.js";
import { elementBuffer } from "./buffers.js";
import type { RelationRow } from "./element-view.js";
import { relationGroups, rowOfRelation } from "./element-view.js";
import { FieldBox } from "./FieldBox.js";

export interface RelationLinkProps {
  readonly row: RelationRow;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}

export const RelationLink = ({ row, onOpenRelation }: RelationLinkProps): React.JSX.Element => {
  const target =
    row.state === "available" && row.repository !== ""
      ? elementBuffer(row.id, row.repository, row.label)
      : undefined;
  return (
    <li className={target !== undefined ? "relation" : "relation unavailable"}>
      {target !== undefined ? (
        <span
          role="link"
          tabIndex={0}
          data-target-id={row.id}
          data-target-repository={row.repository}
          onClick={() => {
            onOpenRelation(target);
          }}
          onKeyDown={(event) => {
            // Enter with Ctrl, Cmd or Alt is a shortcut of the window: "Follow reference" opens the focused
            // target itself, "List elements with this value" lists it (SR-132).
            if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              onOpenRelation(target);
            }
          }}
        >
          {row.label}
        </span>
      ) : (
        <>
          <span>{row.label}</span> <span className="state">{row.state}</span>
        </>
      )}
      {row.outdated === undefined ? null : (
        <span className="outdated" title={row.outdated.message}>
          {" "}
          {row.outdated.word}
        </span>
      )}
    </li>
  );
};

export interface RelationGroupsProps {
  /** The element: its relations, and its hints, which mark the outdated ones (#702). */
  readonly element: Pick<DataExportElement, "relations" | "problems" | "repository">;
  readonly onCopy: (label: string) => void;
  /** The fields that changed outside the app and are highlighted now (SR-116), by label. */
  readonly marked: ReadonlySet<string>;
  readonly onOpenRelation: (target: ElementBuffer) => void;
}

export const RelationGroups = ({
  element,
  onCopy,
  marked,
  onOpenRelation,
}: RelationGroupsProps): React.JSX.Element => (
  <>
    {relationGroups(element.relations).map((group) => (
      <FieldBox key={group.heading} label={group.heading} onCopy={onCopy} marked={marked}>
        <section>
          <h2>{group.heading}</h2>
          <ul>
            {group.relations.map((relation, at) => (
              <RelationLink key={at} row={rowOfRelation(relation, element)} onOpenRelation={onOpenRelation} />
            ))}
          </ul>
        </section>
      </FieldBox>
    ))}
  </>
);
