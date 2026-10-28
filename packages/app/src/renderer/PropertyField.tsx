// One property box of an element buffer (SR-104), with its block "On disk" when it is in conflict (SR-106
// AK2): a property of a text kind in its editor (`TextBox.tsx`), a relation as the links to its targets, a
// choice as its keys, and a property the type does not know as its lines, read-only (D-012). Layout only:
// `ElementView` makes the props of the editor and the block.
import type { DataExportRelation } from "@logreq/core";
import type { ElementBuffer } from "./buffers.js";
import type { PropertyBox } from "./element-view.js";
import { rowOfRelation } from "./element-view.js";
import { FieldBox } from "./FieldBox.js";
import type { EditableBox } from "./property-edit.js";
import { choiceKeys, relationRows } from "./property-edit.js";
import { RelationLink } from "./RelationLink.js";
import type { TextBoxProps } from "./TextBox.js";
import { TextBox } from "./TextBox.js";

export interface PropertyFieldProps {
  readonly box: PropertyBox;
  /** The box as the type knows it; none for a property the type does not know. */
  readonly editable: EditableBox | undefined;
  /** The document of a choice or relation box with input (set in the minibuffer). */
  readonly value: string | undefined;
  /** The props of its editor, for a box of a text kind; none for any other box. */
  readonly textBox: TextBoxProps | undefined;
  /** The relations of the element: the stored targets of a relation box, with their state. */
  readonly relations: readonly DataExportRelation[];
  readonly onCopy: (label: string) => void;
  /** The fields that changed outside the app and are highlighted now (SR-116), by label. */
  readonly marked: ReadonlySet<string>;
  readonly onOpenRelation: (target: ElementBuffer) => void;
  /** The block "On disk" under the box, when it is in conflict. */
  readonly disk: React.ReactNode;
}

export const PropertyField = ({
  box,
  editable,
  value,
  textBox,
  relations,
  onCopy,
  marked,
  onOpenRelation,
  disk,
}: PropertyFieldProps): React.JSX.Element => (
  <>
    <FieldBox label={box.key} focusable onCopy={onCopy} marked={marked}>
      <div className="box">
        <span className="key">{box.key}</span>
        <span className="value">
          {textBox !== undefined ? (
            <TextBox {...textBox} />
          ) : editable?.info.kind === "relation" ? (
            <ul>
              {relationRows(box.key, value ?? editable.doc, relations).map((row, at) => (
                <RelationLink key={at} row={row} onOpenRelation={onOpenRelation} />
              ))}
            </ul>
          ) : box.relations !== undefined ? (
            <ul>
              {box.relations.map(rowOfRelation).map((row, at) => (
                <RelationLink key={at} row={row} onOpenRelation={onOpenRelation} />
              ))}
            </ul>
          ) : (
            (editable === undefined ? box.lines : choiceKeys(value ?? editable.doc)).map((line, at) => (
              <span className="line" key={at}>
                {line}
              </span>
            ))
          )}
        </span>
      </div>
    </FieldBox>
    {disk}
  </>
);
