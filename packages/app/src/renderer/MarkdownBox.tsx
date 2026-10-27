// A property box whose property the metamodel marks `markdown` (SR-127): each value is shown formatted
// like the text, by the same live-preview editor, read-only. Only inline formatting and references:
// no image (an image in a property is no embedded image, ADR-0004, D-057), no slash menu, no `[[`.
// Until the boxes are editable (#400) there is no cursor in them, so every line shows its formatted
// form; a click on a reference follows it, and "Follow reference" follows the first one of a box that
// has the focus.
import { useMemo } from "react";
import type { EditorHandle } from "./editor/Editor.js";
import { Editor } from "./editor/Editor.js";
import { inline } from "./editor/preview.js";
import { references } from "./editor/references.js";
import type { Reference } from "./editor/references.js";

// Nothing is typed in a box (it has no cursor, so Escape never reaches it either) until #400.
// Only the inline rules of the preview: no headings, lists, quotes, rules or tables in a value.
const RULES = [inline];
const unchanged = (): void => undefined;

export interface MarkdownBoxProps {
  /** The key of the property: the name of the box. */
  readonly label: string;
  /** The values of the property, as stored (the Markdown source). */
  readonly lines: readonly string[];
  /** The outdated references in the values: `outdatedKey` to the message of the hint. */
  readonly outdated: ReadonlyMap<string, string>;
  readonly follow: (reference: Reference) => void;
  /** The editor of the value at `at` is there (or gone: undefined), for "Follow reference". */
  readonly onHandle: (at: number, handle: EditorHandle | undefined) => void;
}

export const MarkdownBox = ({
  label,
  lines,
  outdated,
  follow,
  onHandle,
}: MarkdownBoxProps): React.JSX.Element => {
  // One plugin object for all values of the box, made again only when the hints about it change (the
  // editor is configured again for a new object, so a new one per render would do it on every render).
  const signature = JSON.stringify([...outdated]);
  const plugins = useMemo(() => references({ outdated, follow }), [signature, follow]);
  return (
    <>
      {lines.map((line, at) => (
        <span className="line" key={at}>
          <Editor
            text={line}
            readOnly
            plugins={plugins}
            rules={RULES}
            label={label}
            onChange={unchanged}
            onEscape={unchanged}
            handle={(handle) => {
              onHandle(at, handle);
            }}
          />
        </span>
      ))}
    </>
  );
};
