// The title and the text of an element buffer, each with its block "On disk" when it is in conflict
// (SR-106 AK2): the title in its heading (#621, `TitleBox.tsx`), the text in the Markdown editor with live
// preview (SR-065). Layout only: `ElementView` makes the props of both editors and the blocks.
import type { EditorProps } from "./editor/Editor.js";
import { Editor } from "./editor/Editor.js";
import { TITLE_FIELD } from "./element-view.js";
import { FieldBox } from "./FieldBox.js";
import { TEXT_FIELD } from "./outside-change.js";
import type { TitleBoxProps } from "./TitleBox.js";
import { TitleBox } from "./TitleBox.js";

export interface ElementTextProps {
  readonly title: TitleBoxProps;
  readonly text: EditorProps;
  /** The block "On disk" under the title and under the text, when each is in conflict. */
  readonly titleDisk: React.ReactNode;
  readonly textDisk: React.ReactNode;
  readonly onCopy: (label: string) => void;
  /** The fields that changed outside the app and are highlighted now (SR-116), by label. */
  readonly marked: ReadonlySet<string>;
}

export const ElementText = ({
  title,
  text,
  titleDisk,
  textDisk,
  onCopy,
  marked,
}: ElementTextProps): React.JSX.Element => (
  <>
    <FieldBox label={TITLE_FIELD} focusable onCopy={onCopy} marked={marked}>
      <TitleBox {...title} />
    </FieldBox>
    {titleDisk}
    <FieldBox label={TEXT_FIELD} onCopy={onCopy} marked={marked}>
      <Editor {...text} />
    </FieldBox>
    {textDisk}
  </>
);
