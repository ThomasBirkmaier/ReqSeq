// The context menu (D-075, SR-194 AK1): the app's own quiet menu at the pointer, not the system's. Each
// entry shows the name of the command as the command prompt does and its key; the last one, after a
// separator, opens the command prompt. The menu takes no focus (`use-context-menu.ts`), so it is announced
// as a live region and its selection is its active descendant.
import { useLayoutEffect, useRef, useState } from "react";
import type { Choice } from "./actions.js";
import type { MenuHit } from "./context-menu.js";
import type { MenuState } from "./use-context-menu.js";
import { ALL_COMMANDS, menuPosition } from "./context-menu.js";

export interface ContextMenuProps {
  readonly point: MenuHit["point"];
  /** The entries of the place, before "All commands…". */
  readonly entries: readonly Choice[];
  /** The key that opens the command prompt, the hint of "All commands…". */
  readonly allCommandsKey: string;
  /** The selected entry, the last one being "All commands…"; -1: none. */
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  /** An entry was clicked: `entries.length` is "All commands…". */
  readonly onChoose: (index: number) => void;
}

const itemId = (index: number): string => `context-menu-${String(index)}`;

export const ContextMenu = ({
  point,
  entries,
  allCommandsKey,
  selected,
  onSelect,
  onChoose,
}: ContextMenuProps): React.JSX.Element => {
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ readonly x: number; readonly y: number } | undefined>(undefined);
  // Measured before the first paint, while hidden: the menu opens right of and below the pointer, or left
  // of and above it where the window has no room (AK1).
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (box !== undefined) {
      setAt(
        menuPosition(
          point,
          { width: box.width, height: box.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    }
  }, [point.x, point.y, entries.length]);

  const item = (index: number, name: string, hint: string | undefined): React.JSX.Element => (
    <div
      key={index}
      id={itemId(index)}
      className={index === selected ? "context-item selected" : "context-item"}
      role="menuitem"
      onMouseMove={() => {
        onSelect(index);
      }}
      onClick={(event) => {
        // Only the left button runs an entry; the release of the right one that opened the menu does not.
        if (event.button === 0) {
          onChoose(index);
        }
      }}
    >
      <span className="name">{name}</span>
      {hint === undefined ? null : <span className="hint">{hint}</span>}
    </div>
  );

  return (
    <div
      ref={root}
      className="context-menu"
      role="menu"
      aria-label="Context menu"
      aria-live="polite"
      {...(selected < 0 ? {} : { "aria-activedescendant": itemId(selected) })}
      // Measured at the window's corner first, so its width is not cut by the room right of the pointer.
      style={{
        left: at?.x ?? 0,
        top: at?.y ?? 0,
        visibility: at === undefined ? "hidden" : "visible",
      }}
      // A press in the menu moves no focus and no selection: the editor or list keeps both.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      {entries.map((entry, index) => item(index, entry.name, entry.hint))}
      <div className="context-separator" role="separator" />
      {item(entries.length, ALL_COMMANDS, allCommandsKey)}
    </div>
  );
};

/** The menu while one is open: a new one for each place, so it is measured again. */
export const ContextMenuLayer = ({
  menu,
  ...props
}: Omit<ContextMenuProps, "point" | "selected"> & {
  readonly menu: MenuState | undefined;
}): React.JSX.Element | null =>
  menu === undefined ? null : (
    <ContextMenu
      key={`${String(menu.hit.point.x)},${String(menu.hit.point.y)}`}
      point={menu.hit.point}
      selected={menu.selected}
      {...props}
    />
  );
