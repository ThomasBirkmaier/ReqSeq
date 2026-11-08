// Shared by the specs of the slash menu (SR-129) and its calendar (SR-200): a CodeMirror tooltip stands right
// under the line of the caret (above it when the window has no room below), at its start. CodeMirror shows a
// new tooltip at top -10000px until its next measure, one animation frame later, places it (#1126, #1178), so
// the place is polled, not read once. A tooltip that stays off its line still fails when the poll times out.
import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";

/** Polls until `tooltip` stands right under or above `line`, at its start. */
export const expectNextToLine = async (tooltip: Locator, line: Locator): Promise<void> => {
  const place = async (): Promise<{
    readonly vertical: boolean;
    readonly horizontal: boolean;
    readonly distances?: string;
  }> => {
    const lineBox = await line.boundingBox();
    const box = await tooltip.boundingBox();
    if (lineBox === null || box === null) {
      return { vertical: false, horizontal: false, distances: "no line or no tooltip on the screen" };
    }
    const below = Math.abs(box.y - (lineBox.y + lineBox.height));
    const above = Math.abs(box.y + box.height - lineBox.y);
    const vertical = Math.min(below, above) <= lineBox.height;
    const horizontal = Math.abs(box.x - lineBox.x) < 40;
    // The measured distances only when the place is wrong, so a failure shows them.
    return vertical && horizontal
      ? { vertical, horizontal }
      : {
          vertical,
          horizontal,
          distances: `below ${below.toFixed(1)}, above ${above.toFixed(1)}, left ${(box.x - lineBox.x).toFixed(1)}, line ${lineBox.height.toFixed(1)}`,
        };
  };
  await expect.poll(place).toEqual({ vertical: true, horizontal: true });
};
